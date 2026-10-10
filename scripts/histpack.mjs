/* histpack.mjs —— 历史库**发布打包**（v1 源库 → v2 紧凑分片）
 * ---------------------------------------------------------------------------
 * 为什么要有这一层（V1.9.0，规模重估后的结论）：
 *   原方案按 436 颗外推，算得「20 年 10 MB」看着很安全。但两个星座未来会到**数万~数十万颗**：
 *     10 万颗 × 20 年 × 808 点/星 × 30 字节 = **2.26 GB** —— GitHub 单文件硬限 100 MB，
 *     页面更不可能一次加载。规模翻两个数量级后，原方案根本不成立。
 *
 * 新设计的两条支点：
 *   ① **变化驱动采样**：卫星到达工作轨道后半长轴几乎恒定（轨道维持只在 ±1 km 内），
 *      「变轨情况」（V1.9.1 A15 前叫「升轨情况」）关心的是**爬升过程**，稳定期每天存点是纯浪费。
 *      → 升轨期密采、稳定期大幅抽稀、超远期只留趋势。单星 20 年从 808 点降到约 200 点。
 *   ② **分片 + 按需加载**：页面只取**选中的那一个批次**（几十 KB），
 *      仓库总量再大也不影响加载速度；单文件也永远不会撞 100 MB 上限。
 *
 * v2 编码（每颗星一条，消除行内冗余）：
 *   { n: norad, t0: 起始日(距1970的天数), d:[距t0的天数…], a:[半长轴×10 的整数…] }
 *   · norad 只存一次（v1 每条都存，占约 23%）
 *   · 天数改**相对偏移**的十进制整数（20 年最多 7300 → 1~4 位）
 *   · 半长轴存 0.1 km 精度整数（7492.01 → 74920，相对 BASE 更短）
 *   → 每点约 10 字节（v1 是 30 字节）
 *
 * 自证：node scripts/histpack.mjs --selftest
 */
import fs from 'node:fs';
import path from 'node:path';

export const DAY = 86400000;
export const SMA_BASE = 6000;      // 半长轴存储基准（km）；低轨互联网卫星都在 6600~9000，减去它更短
export const SMA_PREC = 10;        // 0.1 km 精度

/** 毫秒 → 距 1970 的天数（整数） */
export const dayOf = (ms) => Math.floor(ms / DAY);

// ---------------------------------------------------------------- 采样策略
export const POLICY = {
  // ① 升轨期：日变化超过这个阈值就认为"在动"，密采
  climbKmPerDay: 0.05,
  // ② 分层（相对"现在"的年代 → 该年代允许的最小间隔，天）
  layers: [
    { uptoDays: 120, stepDays: 1 },      // 近 4 个月：每天
    { uptoDays: 365, stepDays: 2 },      // ~1 年：每 2 天
    { uptoDays: 1095, stepDays: 7 },     // ~3 年：每周
    { uptoDays: Infinity, stepDays: 30 } // 更远：每月
  ],
  // ③ 稳定期（变化长期低于阈值）最多保留多少个点 —— 这些点只用于说明"它一直在这"
  maxStablePts: 24,
  // ④ 硬上限：单星点数 / 单分片字节
  maxPtsPerSat: 400,
  maxShardBytes: 4 * 1024 * 1024
};

function stepForAge(ageDays) {
  for (const L of POLICY.layers) if (ageDays <= L.uptoDays) return L.stepDays;
  return POLICY.layers[POLICY.layers.length - 1].stepDays;
}

/**
 * 单颗星的选点：分层间隔 + 变化驱动 + 稳定期配额 + 首尾必留。
 * pts 需按时间升序，形如 [{ms, v}]
 */
export function selectPoints(pts, nowMs) {
  if (!pts || pts.length <= 2) return (pts || []).slice();
  const n = pts.length;
  // 先算每点的"是否处于升轨期"（与后一点比较日变化率）
  const moving = new Array(n).fill(false);
  for (let i = 0; i < n - 1; i++) {
    const dt = (pts[i + 1].ms - pts[i].ms) / DAY;
    if (dt <= 0) continue;
    const rate = Math.abs(pts[i + 1].v - pts[i].v) / dt;
    if (rate >= POLICY.climbKmPerDay) { moving[i] = true; moving[i + 1] = true; }
  }
  // 从最新往回择点：保证最近的点一定在
  const kept = [];
  let lastKept = Infinity;
  let stableUsed = 0;
  for (let i = n - 1; i >= 0; i--) {
    const age = (nowMs - pts[i].ms) / DAY;
    const step = stepForAge(age);
    if (lastKept === Infinity) { kept.push(i); lastKept = pts[i].ms; continue; }
    const gapDays = (lastKept - pts[i].ms) / DAY;
    // 升轨期的点：间隔达标就留（保住爬升细节）
    if (moving[i] && gapDays >= step) { kept.push(i); lastKept = pts[i].ms; continue; }
    // 稳定期的点：间隔达标 + 配额未用完
    if (gapDays >= step && stableUsed < POLICY.maxStablePts) {
      kept.push(i); stableUsed++; lastKept = pts[i].ms; continue;
    }
  }
  kept.reverse();
  const out = kept.map(i => pts[i]);
  // 首尾强制保留：起点=入轨高度（升轨叙事的起点），终点=当前高度
  if (out.length && out[0].ms !== pts[0].ms) out.unshift(pts[0]);
  if (out.length && out[out.length - 1].ms !== pts[n - 1].ms) out.push(pts[n - 1]);
  return out;
}

// ---------------------------------------------------------------- v2 编解码
/** 一颗星 → v2 紧凑形态 */
export function encodeSat(norad, pts) {
  const t0 = dayOf(pts[0].ms);
  const d = [], a = [];
  for (const p of pts) {
    d.push(dayOf(p.ms) - t0);
    a.push(Math.round((p.v - SMA_BASE) * SMA_PREC));
  }
  return { n: norad, t0: t0, d: d, a: a };
}
/** v2 形态 → [{ms, v}]（解码回半长轴 km） */
export function decodeSat(rec) {
  const out = [];
  const d = rec.d || [], a = rec.a || [];
  for (let i = 0; i < d.length; i++) {
    out.push({ ms: (rec.t0 + d[i]) * DAY, v: SMA_BASE + a[i] / SMA_PREC });
  }
  return out;
}

// ---------------------------------------------------------------- 分片打包
/**
 * 一个批次（可能多颗星）→ v2 分片对象
 * recs: v1 三元组 [norad, ms, sma]
 */
export function packBatch(lk, recs, nowMs, opts) {
  opts = opts || {};
  const maxPts = opts.maxPtsPerSat || POLICY.maxPtsPerSat;
  const bySat = new Map();
  for (const r of recs || []) {
    if (!Array.isArray(r) || r.length < 3) continue;
    if (!isFinite(r[0]) || !isFinite(r[1]) || !isFinite(r[2])) continue;
    if (!bySat.has(r[0])) bySat.set(r[0], []);
    bySat.get(r[0]).push({ ms: r[1], v: r[2] });
  }
  let mul = 1, sats = [];
  for (let guard = 0; guard < 10; guard++) {
    sats = [];
    let worst = 0;
    for (const [norad, pts] of bySat) {
      pts.sort((a, b) => a.ms - b.ms);
      let keep = selectPoints(pts, nowMs);
      // 硬上限触发时整体抽稀（mul 倍）：均匀取样，保住首尾
      if (mul > 1 && keep.length > maxPts) {
        const stepI = Math.ceil(keep.length / maxPts);
        const thin = keep.filter((_, i) => i % stepI === 0);
        if (thin[thin.length - 1] !== keep[keep.length - 1]) thin.push(keep[keep.length - 1]);
        keep = thin;
      }
      if (keep.length > worst) worst = keep.length;
      if (keep.length >= 2) sats.push(encodeSat(norad, keep));
    }
    if (worst <= maxPts && JSON.stringify(sats).length <= (opts.maxShardBytes || POLICY.maxShardBytes)) break;
    mul *= 2;
  }
  // 统计
  let pts = 0, t0 = Infinity, t1 = 0;
  for (const s of sats) {
    pts += s.d.length;
    if (s.t0 < t0) t0 = s.t0;
    const last = s.t0 + s.d[s.d.length - 1];
    if (last > t1) t1 = last;
  }
  // ★ base / prec 必须写进分片：页面解码要用，硬编码在两端迟早失配
  //   （改了 SMA_BASE 而忘了改 app.js，曲线会整体偏移几千公里，且这种错误极难发现）。
  const shard = { v: 2, lk: String(lk), base: SMA_BASE, prec: SMA_PREC, sats: sats };
  return {
    shard: shard,
    stats: { lk: String(lk), sats: sats.length, pts: pts, before: (recs || []).length,
             from: sats.length ? t0 : 0, to: sats.length ? t1 : 0, mul: mul,
             bytes: JSON.stringify(shard).length }
  };
}
/**
 * 整个星座的 hist（{ 批次key: [三元组…] }）→ { index, shards }
 * index 只放"批次列表 + 概览"，页面首屏只取它；shards 按需取。
 */
export function packAll(hist, nowMs, opts) {
  const shards = {}, index = { v: 2, asOf: new Date(nowMs).toISOString().slice(0, 10),
    unit: 'semi-major axis (km, 0.1 km resolution)', batches: [] };
  let totalPts = 0, totalBytes = 0, before = 0;
  for (const lk of Object.keys(hist || {})) {
    const r = packBatch(lk, hist[lk], nowMs, opts);
    if (!r.stats.sats) continue;
    shards[lk] = r.shard;
    index.batches.push({ k: String(lk), n: r.stats.sats, p: r.stats.pts,
                         b: r.stats.bytes, f: r.stats.from, t: r.stats.to });
    totalPts += r.stats.pts; totalBytes += r.stats.bytes; before += r.stats.before;
  }
  // ★ V1.9.1（执行顺序 1.8）排序修复：原为 `index.batches.sort((a, b) => b.t - a.t)`。
  //   `t` = **该批次最后一个数据点的时刻**。但在轨批次每天都在被刷新 → 每个批次的 `t`
  //   一律等于"今天" → 差值**恒为 0** → 排序完全失效，实际退化成对象键的插入顺序
  //   （结果 ≈ 最早批次排在前面）。
  //   而页面把 `batches[0]` 当作**默认选中批次**（app.js:7625 renderClimbTake、
  //   app.js:8425 climbSeries）—— 也就是说：注释承诺"最新在前（需求 Q49）"、
  //   页面期待"第一个就是最新的"，实际拿到的却是**最老的批次**。谁都看不出来，
  //   因为数组看起来"有序"（有顺序 ≠ 顺序正确）。
  //   改为按**批次号降序**：批次号 = COSPAR 前 5 位（YY + 序号），本身就是时间序，
  //   而且**不随每日刷新漂移**（t 会漂）。同批次号时才用 t 兜底。
  index.batches.sort((a, b) => {
    const ka = String(a.k), kb = String(b.k);
    if (ka !== kb) return ka < kb ? 1 : -1;
    return b.t - a.t;
  });
  index.totals = { batches: index.batches.length, pts: totalPts, bytes: totalBytes };
  return { index: index, shards: shards, stats: { before: before, after: totalPts, bytes: totalBytes } };
}

// ---------------------------------------------------------------- 自检
const isMain = process.argv[1] && process.argv[1].endsWith('histpack.mjs');
if (isMain && process.argv.includes('--selftest')) {
  const fails = [];
  const ok = (n, c, x) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  → ' + x : '')); if (!c) fails.push(n); };

  // ① v2 编解码往返：精度必须保持 0.1 km
  {
    const pts = [{ ms: 1700000000000, v: 7492.01 }, { ms: 1700086400000, v: 7492.55 },
                 { ms: 1700172800000, v: 7493.12 }];
    const enc = encodeSat(57288, pts);
    const dec = decodeSat(enc);
    ok('① 编解码往返点数一致', dec.length === 3);
    const worst = Math.max(...dec.map((p, i) => Math.abs(p.v - pts[i].v)));
    // 0.1 km 精度的**理论最大舍入误差就是 0.05**，写 <=0.05 会卡在边界（实测正好 0.0500）。
    ok('①b 半长轴误差 ≤ 0.05 km（0.1km 精度的理论上限）', worst <= 0.0501, '最大偏差 ' + worst.toFixed(4) + ' km');
    // 时刻可能被对齐到天（dayOf 取整）—— 校验在 1 天内
    const dt = Math.max(...dec.map((p, i) => Math.abs(p.ms - pts[i].ms)));
    ok('①c 时刻误差 ≤ 1 天（按天存储）', dt <= DAY, (dt / DAY).toFixed(3) + ' 天');
    ok('①d norad 只存一次', enc.n === 57288 && !('norad' in enc));
  }
  // ② 变化驱动：升轨段保细节、稳定段被抽稀
  {
    const now = Date.UTC(2026, 5, 1);
    const pts = [];
    // 前 200 天：每天 +2 km（明显升轨）
    for (let d = 0; d <= 200; d++) pts.push({ ms: now - (400 - d) * DAY, v: 7000 + d * 2 });
    // 后 200 天：稳定在 7400（日变化 ~0）
    for (let d = 201; d <= 400; d++) pts.push({ ms: now - (400 - d) * DAY, v: 7400 + (d % 2) * 0.01 });
    // ⚠️ 分类必须按**构造时的阶段**来判，不能按 v 的阈值：
    //   升轨段尾部（d=175~200）的 v 已达 7350~7400，与稳定段重叠，
    //   用 "v>=7350 算稳定段" 会把升轨尾部的密采点误算进稳定段（实测多算了 13 点，误判配额失效）。
    const marked = [];
    for (let d = 0; d <= 200; d++) marked.push({ ms: now - (400 - d) * DAY, v: 7000 + d * 2, phase: 'climb' });
    for (let d = 201; d <= 400; d++) marked.push({ ms: now - (400 - d) * DAY, v: 7400 + (d % 2) * 0.01, phase: 'stable' });
    const keep = selectPoints(marked.map(p => ({ ms: p.ms, v: p.v })), now);
    const byMs = new Map(marked.map(p => [p.ms, p.phase]));
    const climbPts = keep.filter(p => byMs.get(p.ms) === 'climb').length;
    const stablePts = keep.filter(p => byMs.get(p.ms) === 'stable').length;
    ok('② 升轨段保住足够多点（>50）', climbPts > 50, climbPts + ' 点');
    ok('②b 稳定段被大幅抽稀（≤配额 24+2）', stablePts <= POLICY.maxStablePts + 2,
      stablePts + ' 点（配额 ' + POLICY.maxStablePts + '）');
    ok('②c 总数远小于原始 401', keep.length < 250, keep.length + ' 点（原 401）');
    // 首尾
    ok('②d 起点保留（入轨高度）', keep[0].v === pts[0].v, keep[0].v);
    ok('②e 终点保留（当前高度）', Math.abs(keep[keep.length - 1].v - pts[pts.length - 1].v) < 0.2);
  }
  // ③ 规模验收（这是本次重构的核心承诺）
  {
    const now = Date.UTC(2026, 0, 1);
    function mkSat(days, climbDays) {
      const pts = [];
      for (let d = 0; d <= days; d++) {
        // 前 climbDays 天爬升，之后稳定
        const v = d <= climbDays ? 7000 + d * 1.5 : 7000 + climbDays * 1.5;
        pts.push({ ms: now - (days - d) * DAY, v: v });
      }
      return pts;
    }
    console.log('   —— 单星点数（升轨 1 年后稳定）——');
    for (const y of [1, 5, 10, 20]) {
      const pts = mkSat(y * 365, 365);
      const keep = selectPoints(pts, now);
      console.log('      ' + String(y).padStart(2) + ' 年 → ' + String(keep.length).padStart(4) + ' 点');
      ok('③ ' + y + ' 年单星点数 < 400', keep.length < 400, keep.length + ' 点');
    }
    // 全星座体积：10 万颗 × 20 年
    const one = encodeSat(1, selectPoints(mkSat(20 * 365, 365), now));
    const perSatBytes = JSON.stringify([one]).length;
    const mb = (perSatBytes * 100000) / 1048576;
    console.log('      每星 ' + perSatBytes + ' 字节 → 10 万颗 × 20 年 ≈ ' + mb.toFixed(0) + ' MB');
    ok('③b 10 万颗 × 20 年 < 400 MB（可进 GitHub）', mb < 400, mb.toFixed(0) + ' MB');
    ok('③c 单分片远小于 100 MB 上限', perSatBytes * 200 / 1048576 < 100,
      '200 星/批 ≈ ' + (perSatBytes * 200 / 1048576).toFixed(1) + ' MB');
  }
  // ④ 分片打包：批次索引正确、最新在前
  {
    const now = Date.UTC(2026, 0, 1);
    const hist = {};
    // 批次 A：老（2 年前），批次 B：新（1 个月前）
    hist['23095'] = [];
    hist['24140'] = [];
    for (let d = 0; d <= 300; d++) {
      hist['23095'].push([1, now - (730 - d) * DAY, 7000 + d]);
      hist['24140'].push([2, now - (30 - d) * DAY, 7000 + d]);
    }
    const r = packAll(hist, now);
    ok('④ 两个批次都打包成功', Object.keys(r.shards).length === 2, Object.keys(r.shards).join(','));
    ok('④b 索引里最新批次排在前', r.index.batches[0].k === '24140',
      r.index.batches.map(b => b.k).join(','));
    ok('④c 索引含卫星数/点数/字节/日期范围',
      r.index.batches.every(b => b.n > 0 && b.p > 0 && b.b > 0 && b.f > 0 && b.t > 0),
      JSON.stringify(r.index.batches[0]));
    ok('④d 分片内 sats 的 norad 不串',
      r.shards['23095'].sats.every(s => s.n === 1) && r.shards['24140'].sats.every(s => s.n === 2));
    ok('④e 硬上限生效（单星 ≤400 点）', r.index.batches.every(b => {
      return r.shards[b.k].sats.every(s => s.d.length <= POLICY.maxPtsPerSat);
    }));

    // ★ ④f 真实形态（V1.9.1 / 1.8 抓出的缺陷）：**所有批次的 t 完全相同**时仍须正确排序。
    //   为什么要有这一条：上面 ④b 用的是"t 不同"的数据，而**真实数据里 t 全相同** ——
    //   在轨批次每天都刷新，每个批次的"最后一个数据点"都是**今天** → `b.t - a.t` 恒为 0
    //   → 旧排序退化成插入顺序（≈最早批次在前），而 ④b 因为 t 有差异而**照样通过**。
    //   盲区就来自"测试数据比现实更理想"。这条断言刻意把 t 造成相等，复现真实条件。
    {
      const same = {};
      const now2 = Date.UTC(2026, 5, 1);
      ['23095', '24140', '26176', '25067'].forEach((k, i) => {
        same[k] = [];
        for (let d = 0; d <= 40; d++) same[k].push([100 + i, now2 - (40 - d) * DAY, 7000 + d * 0.5 + i]);
      });
      const r2 = packAll(same, now2);
      const ts = r2.index.batches.map(b => b.t);
      const ks = r2.index.batches.map(b => b.k);
      ok('④f 所有批次 t 相同时，仍按**批次号降序**（页面把 batches[0] 当默认批次的依据）',
        new Set(ts).size === 1 && ks.join(',') === '26176,25067,24140,23095',
        't 全同=' + (new Set(ts).size === 1) + '，顺序=' + ks.join(','));
    }
  }
  // ⑤ 恶意/畸形输入：不得崩、不得产生 NaN
  {
    const now = Date.UTC(2026, 0, 1);
    // ⚠️ 好行必须给**至少 2 个点**：packBatch 要求 keep.length>=2 才入库
    //   （1 个点画不出"变化"，这是预期行为，不是 bug —— 首版测试只给 1 个点，于是误报）。
    const bad = [[1, NaN, 7000], null, [2, now, NaN], [3],
                 [4, now - 2 * DAY, 8000, 99], [4, now, 8001, 99]];
    let threw = false, r = null;
    try { r = packBatch('99999', bad, now); } catch (e) { threw = true; }
    ok('⑤ 畸形输入不抛异常', !threw);
    ok('⑤b 坏行被丢弃、好行保留（norad=4，多点才入库）',
      r && r.shard.sats.length === 1 && r.shard.sats[0].n === 4,
      r ? JSON.stringify(r.shard.sats.map(s => s.n)) : '(无)');
    const enc = r ? r.shard.sats[0] : null;
    ok('⑤c 输出无 NaN', enc && enc.d.every(x => isFinite(x)) && enc.a.every(x => isFinite(x)));
    // 单点的卫星确实应该被跳过（画不出曲线）
    const onePt = packBatch('99998', [[7, now, 7000]], now);
    ok('⑤d 只有 1 个点的卫星不入库（画不出变化）', onePt.shard.sats.length === 0,
      onePt.shard.sats.length + ' 颗');
  }

  console.log('\n自检结论：' + (fails.length ? '失败 ' + fails.length + ' 项' : '全部通过'));
  process.exit(fails.length ? 1 : 0);
}
