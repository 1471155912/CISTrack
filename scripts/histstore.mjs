/* histstore.mjs —— 历史 TLE 的**合并（去重）+ 按批次分片**存取
 * ---------------------------------------------------------------------------
 * 对应两条已确认的决议：
 *   Q40：只允许**追加**，**不要重复存储同一条历史数据**。
 *   Q53：按**批次/组**分片（不是按月）—— 因为 05 章的访问模式是"选中某批次 → 取那一条曲线"，
 *        按月分片会导致画一颗星的完整曲线要 fetch 最多约 30 个文件。
 *
 * 存储格式：每个分片一个 JSON 数组，行 = `[norad, epochMs, 半长轴]`
 *   （只存一种模型、一个值 —— 用户确认；升轨速度等派生量在呈现时现算，见 climb.mjs）
 *
 * 去重键：`(norad, epoch)` —— 同一颗星的同一条轨道要素只存一次。
 *   ★ 用 epoch（而不是"按天"）是因为低轨每天会被重发 3–5 次要素，
 *     它们都是**真实的不同观测**，不该合并成一天一条；而重复运行脚本时
 *     同一 epoch 会被反复取到，必须靠这个键挡住。
 *
 * 自证：`node scripts/histstore.mjs --selftest`
 */
import fs from 'node:fs';
import path from 'node:path';

export const KEY = (norad, ms) => norad + '@' + ms;

/** 分片文件名：批次 key（5 位发射编号）→ data/history/<key>.json */
export function shardFile(dir, launchKey) {
  return path.join(dir, String(launchKey) + '.json');
}

/**
 * 追加式合并：**已有 + 新到**，按 (norad, epoch) 去重。
 * 不修改入参；返回 { merged, added, dup }（dup = 被挡下的重复条数）
 */
export function mergeRecords(existing, incoming) {
  const seen = new Set();
  for (const r of existing || []) seen.add(KEY(r[0], r[1]));
  const merged = (existing || []).slice();
  let added = 0, dup = 0;
  for (const r of incoming || []) {
    if (!Array.isArray(r) || !isFinite(r[0]) || !isFinite(r[1]) || !isFinite(r[2])) continue;  // 坏行丢弃
    // ★ 归一化到**恰好 3 个字段**（norad / 历元 / 半长轴）：上游若多带字段，
    //   截掉而不是原样存 —— 否则脏字段会一路带进分片文件。
    const rec = [r[0], r[1], r[2]];
    const k = KEY(rec[0], rec[1]);
    if (seen.has(k)) { dup++; continue; }
    seen.add(k);
    merged.push(rec);
    added++;
  }
  // 同一颗星按时间排序（跨批次合并时尤为重要：不同分片里同一颗星可能都有）
  merged.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  return { merged: merged, added: added, dup: dup };
}

/** 读一个分片（不存在当空） */
export function readShard(dir, launchKey) {
  const p = shardFile(dir, launchKey);
  if (!fs.existsSync(p)) return [];
  try { const a = JSON.parse(fs.readFileSync(p, 'utf8')); return Array.isArray(a) ? a : []; }
  catch (e) { return []; }
}

/** 写一个分片（先备份 .bak，与项目其它数据文件的做法一致） */
export function writeShard(dir, launchKey, recs) {
  fs.mkdirSync(dir, { recursive: true });
  const p = shardFile(dir, launchKey);
  if (fs.existsSync(p)) fs.writeFileSync(p + '.bak', fs.readFileSync(p));
  fs.writeFileSync(p, JSON.stringify(recs));
  return p;
}

// ============================================================================
// V1.9.0（R17）：容量治理 —— 让历史库**撑得住很多年**
// ----------------------------------------------------------------------------
// 背景：历史库每天新增一批（当前 436 颗 × 每天 1~2 次刷新），若原样累积：
//   436 颗 × 365 天 × 26 字节/条 ≈ 4.1 MB/年 → 10 年 41 MB、20 年 82 MB。
//   这么大的东西既不该塞进单文件 HTML（会逐年膨胀），也超出一个静态站能舒服托管的量级。
//
// 对策 = **分层降采样（RRD 思路）**：越老的数据间隔越大。
//   近处保留细节（升轨速率要靠 ±2 天窗口，近期必须密）；远处只看趋势（升轨是月~年尺度过程，
//   两周一个点完全够看清"从 500km 爬到 1100km"这件事）。
//   分界（相对于"现在"）：
//     ≤ 120 天        → 每 1 天一点
//     120 天 ~ 3 年   → 每 4 天一点
//     > 3 年          → 每 14 天一点
//   这样每颗星的点数上限：1 年 ≈ 181、5 年 ≈ 416、10 年 ≈ 547、**20 年 ≈ 807**。
//   436 颗 × 807 ≈ 35 万条 ≈ 9 MB（20 年后）—— 一个静态站完全扛得住。
//
// 另设两道**硬上限**兜底（防任何意外让库失控）：
//   maxPtsPerSat = 3000 点/星（极端情况约 40+ 年；超了就把层间隔整体翻倍再来）
//   maxBytes     = 24 MB（超了同样整体翻倍，直到达标）
//   —— 两道都是"降精度保可用"，绝不丢最近的数据。
// ============================================================================
export const DAY = 86400000;
export const CAP = {
  layers: [
    { uptoDays: 120, stepDays: 1 },
    { uptoDays: 1095, stepDays: 4 },     // 3 年
    { uptoDays: Infinity, stepDays: 14 }
  ],
  maxPtsPerSat: 3000,
  maxBytes: 24 * 1024 * 1024
};
function stepForAge(ageDays, mul) {
  for (const L of CAP.layers) if (ageDays <= L.uptoDays) return L.stepDays * mul;
  return CAP.layers[CAP.layers.length - 1].stepDays * mul;
}
/**
 * 单颗星的分层降采样。
 * ★ 从**最新点往回**择点：保证"最近一个点"永远保留（曲线末端不能消失），
 *   然后按该点所处年代对应的间隔往前挑。
 * @param pts  [{ms, v}] 已按时间升序；v = 半长轴
 * @param nowMs 参考时刻
 * @param mul   全局倍率（硬上限触发时用它整体加粗）
 */
export function pruneSat(pts, nowMs, mul) {
  mul = mul || 1;
  if (!pts || pts.length <= 2) return (pts || []).slice();
  const out = [];
  let lastKept = Infinity;               // 已保留的最新时刻（ms）
  for (let i = pts.length - 1; i >= 0; i--) {
    const age = (nowMs - pts[i].ms) / DAY;
    const step = stepForAge(age, mul) * DAY;
    // 最新点必留；其余与"上一个保留点"的间隔够大才留
    if (lastKept === Infinity || lastKept - pts[i].ms >= step * 0.999) {
      out.push(pts[i]);
      lastKept = pts[i].ms;
    }
  }
  out.reverse();
  // ★ 最老一个点**强制保留**：从最新往回按间隔择点时，起点未必落在间隔上
  //   （自检 ⑥c 抓到：1 年数据降采样后起点丢了）。而"刚入轨时的高度"是升轨曲线
  //   最有价值的点之一 —— 没有它，曲线就讲不出"从哪爬到哪里"这件事。
  if (out.length && out[0].ms !== pts[0].ms) out.unshift(pts[0]);
  return out;
}
/** 估算一批记录序列化后的字节数（用于触发体积硬上限，避免真的 stringify 几 MB 去量） */
export function estimateBytes(recs) {
  // 形如 [57288,1791357089243.33,7492.01,] ≈ 27~30 字节/条；取 30 保守估
  return (recs || []).length * 30 + 64;
}
/**
 * 整个分片（可能含多颗星）的容量治理：按 norad 分组后逐颗降采样。
 * 返回 { recs, stats:{ before, after, sats, mul } }
 */
export function pruneRecords(recs, nowMs, opts) {
  opts = opts || {};
  const maxPts = opts.maxPtsPerSat || CAP.maxPtsPerSat;
  const maxBytes = opts.maxBytes || CAP.maxBytes;
  const bySat = new Map();
  for (const r of recs || []) {
    if (!Array.isArray(r) || r.length < 3) continue;
    const n = r[0];
    if (!bySat.has(n)) bySat.set(n, []);
    bySat.get(n).push({ ms: r[1], v: r[2] });
  }
  let mul = 1, out = [];
  for (let guard = 0; guard < 12; guard++) {
    out = [];
    let worst = 0;
    for (const [norad, pts] of bySat) {
      pts.sort((a, b) => a.ms - b.ms);
      const kept = pruneSat(pts, nowMs, mul);
      if (kept.length > worst) worst = kept.length;
      for (const p of kept) out.push([norad, p.ms, p.v]);
    }
    if (worst <= maxPts && estimateBytes(out) <= maxBytes) break;
    mul *= 2;
  }
  out.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  return { recs: out, stats: { before: (recs || []).length, after: out.length, sats: bySat.size, mul: mul } };
}

/** 把若干批次的新数据合并进分片目录，返回统计（供抓取脚本收尾打印） */
export function mergeInto(dir, batches) {
  const stat = { shards: 0, added: 0, dup: 0 };
  for (const b of batches || []) {
    const key = b.key, incoming = b.records || [];
    const old = readShard(dir, key);
    const r = mergeRecords(old, incoming);
    if (r.added) { writeShard(dir, key, r.merged); stat.shards++; }
    stat.added += r.added; stat.dup += r.dup;
  }
  return stat;
}

// ---------------------------------------------------------------- 自检
const isMain = process.argv[1] && process.argv[1].endsWith('histstore.mjs');
if (isMain && process.argv.includes('--selftest')) {
  const fails = [];
  const ok = (name, cond, extra) => {
    console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? '  → ' + extra : ''));
    if (!cond) fails.push(name);
  };

  // ① 同一批数据合并两次：第二次必须一条都加不进去（这是 Q40 的核心）
  {
    const a = [[100203, 1000, 500.1], [100203, 2000, 500.3]];
    const r1 = mergeRecords([], a);
    const r2 = mergeRecords(r1.merged, a);
    ok('① 同一批合并两次：第二次 added=0 / dup=2', r1.added === 2 && r2.added === 0 && r2.dup === 2,
      '第一次 added=' + r1.added + '，第二次 added=' + r2.added + ' dup=' + r2.dup);
    ok('① 条数不变（2 条）', r2.merged.length === 2);
  }
  // ② 部分重叠：只应加进真正的新点
  {
    const old = [[1, 1000, 500], [1, 2000, 501]];
    const inc = [[1, 2000, 501], [1, 3000, 502]];
    const r = mergeRecords(old, inc);
    ok('② 部分重叠：只加 1 条、挡 1 条', r.added === 1 && r.dup === 1 && r.merged.length === 3,
      'added=' + r.added + ' dup=' + r.dup);
  }
  // ③ 同一颗星在不同批次分片里各有一条 → 合并后按时间排序、互不覆盖
  {
    const r = mergeRecords([[100, 5000, 5]], [[100, 1000, 1], [100, 3000, 3]]);
    const times = r.merged.map(x => x[1]).join(',');
    ok('③ 跨分片的同一颗星：合并后按时间升序', times === '1000,3000,5000', '时间序=' + times);
  }
  // ④ 坏行必须被丢弃；而"多带字段"的行应被**归一化到 3 个字段**（而不是整行丢弃）
  //    —— 首跑时我把期望写成"只剩 1 条"，其实不对：多余字段不该让整行作废。
  {
    const r = mergeRecords([], [[7, 1000, 1], [8, NaN, 2], null, [9, 2000], [10, 2000, 3, 4]]);
    const norm = r.merged.filter(x => x[0] === 10)[0];
    ok('④ NaN / null / 字段不足的行被丢弃', r.merged.length === 2 && !r.merged.some(x => x[0] === 8 || x[0] === 9),
      '留下 ' + r.merged.length + ' 条');
    ok('④ 多带字段的行被归一化为 3 个字段', norm && norm.length === 3 && norm[2] === 3,
      norm ? JSON.stringify(norm) : '（无）');
  }
  // ⑤ 分片读写往返 + **幂等导入**
  //    注意：首跑时我把"第一次 added=2"写在了已经 writeShard 过的 key 上，
  //    于是第一次必然是 0 —— 那是我测试写错，不是代码错。这里改用**全新的 key**做首次导入。
  {
    // 临时目录**每次运行都新建**（固定目录会让"首次导入"在第二次运行必然是 0，自检不可重复运行）
    const dir = path.join(process.env.TEMP || 'D:/Temp', 'cistrack-hist-selftest-' + process.pid + '-' + Date.now());
    fs.mkdirSync(dir, { recursive: true });
    const recs = [[1, 100, 1.5], [2, 200, 2.5]];
    writeShard(dir, 23095, recs);
    const back = readShard(dir, 23095);
    ok('⑤ 分片写入→读回一致', back.length === 2 && back[1][2] === 2.5);
    ok('⑤ 读不存在的分片返回空数组', readShard(dir, 99999).length === 0);
    const fresh = [[3, 300, 3.5], [4, 400, 4.5]];
    const s1 = mergeInto(dir, [{ key: 24096, records: fresh }]);      // 全新 key
    const s2 = mergeInto(dir, [{ key: 24096, records: fresh }]);      // 同批再来一次
    ok('⑤ 首次导入加 2 条、重复导入加 0 条（幂等）', s1.added === 2 && s2.added === 0 && s2.dup === 2,
      '首次 ' + s1.added + '，重复 ' + s2.added + '（dup=' + s2.dup + '）');
    ok('⑤ 重复导入不增长文件内容', readShard(dir, 24096).length === 2);
  }

  // ---- V1.9.0（R17）：容量治理（分层降采样 + 两道硬上限）----
  const DAY = 86400000;
  // 造一颗"活了 N 年、每天都有一条记录"的卫星
  function makeSat(norad, days, tEnd) {
    const pts = [];
    for (let d = 0; d <= days; d++) pts.push({ ms: tEnd - (days - d) * DAY, v: 7000 + d * 0.3 });
    return pts;
  }
  // ⑥ 分层：≤120 天每天一点、≤3 年每 4 天、>3 年每 14 天
  {
    const tEnd = Date.UTC(2026, 0, 1);
    const pts = makeSat(1, 365, tEnd);                       // 整一年、每天一点 = 366 点
    const kept = pruneSat(pts, tEnd, 1);
    // 预期：最近 120 天全留（约 121 点）+ 更早 245 天每 4 天（约 61 点）≈ 182
    ok('⑥ 1 年每天一点 → 降采样到 ~180 点（不是 366）',
      kept.length > 150 && kept.length < 210, kept.length + ' 点');
    // 最新点必须保留（曲线末端不能消失）
    ok('⑥b 最新一个点必留', kept[kept.length - 1].ms === pts[pts.length - 1].ms);
    // 最老的点也应保留一个（趋势起点不能丢）
    ok('⑥c 最老一个点保留（趋势起点不丢）', kept[0].ms === pts[0].ms);
    // 严格递增
    ok('⑥d 结果按时间严格升序', kept.every((p, i) => i === 0 || p.ms > kept[i - 1].ms));
  }
  // ⑦ 多年规模：这是"撑得住很多年"的**核心承诺**，必须量化
  {
    const tEnd = Date.UTC(2026, 0, 1);
    const rows = [];
    for (const years of [1, 5, 10, 20]) {
      const pts = makeSat(1, years * 365, tEnd);
      const kept = pruneSat(pts, tEnd, 1);
      rows.push(years + '年=' + kept.length);
      // 每颗星点数必须在千级以内（否则 436 颗 × 它会爆掉）
      ok('⑦ ' + years + ' 年后单星点数 < 1000', kept.length < 1000, kept.length + ' 点');
    }
    console.log('      （单星点数量级：' + rows.join('  ') + '）');
    // 全星座 20 年总条数与体积估算
    const pts20 = pruneSat(makeSat(1, 20 * 365, tEnd), tEnd, 1);
    const total = pts20.length * 436;
    ok('⑦b 436 颗 × 20 年总条数 < 40 万', total < 400000, total.toLocaleString() + ' 条');
    const mb = estimateBytes(new Array(total)) / 1048576;
    ok('⑦c 436 颗 × 20 年体积 < 12 MB', mb < 12, mb.toFixed(1) + ' MB');
  }
  // ⑧ 硬上限：人为塞爆，必须被压到上限内且**不丢最新点**
  {
    const tEnd = Date.UTC(2026, 0, 1);
    // 每天 3 条、连续 40 年 —— 极端畸形输入
    const recs = [];
    for (let d = 0; d <= 40 * 365; d++) {
      for (let k = 0; k < 3; k++) recs.push([1, tEnd - (40 * 365 - d) * DAY + k * 3600000, 7000 + d * 0.05]);
    }
    const r = pruneRecords(recs, tEnd, { maxPtsPerSat: 3000, maxBytes: 24 * 1024 * 1024 });
    ok('⑧ 畸形输入被压到 3000 点/星以内', r.stats.after <= 3000,
      r.stats.before.toLocaleString() + ' → ' + r.stats.after + ' 点（倍率 ×' + r.stats.mul + '）');
    // 最新点仍必须在
    const last = r.recs[r.recs.length - 1];
    ok('⑧b 极端降采样后最新点仍在', last && last[1] >= tEnd - DAY,
      last ? new Date(last[1]).toISOString().slice(0, 10) : '(无)');
  }
  // ⑨ 分片级治理：多颗星一起，norad 不能串
  {
    const tEnd = Date.UTC(2026, 0, 1);
    const recs = [];
    for (const n of [1, 2, 3]) {
      for (let d = 0; d <= 400; d++) recs.push([n, tEnd - (400 - d) * DAY, 7000 + d]);
    }
    const r = pruneRecords(recs, tEnd);
    const ns = new Set(r.recs.map(x => x[0]));
    ok('⑨ 三颗星各自保留、编号不串', ns.size === 3 && [...ns].every(n => [1, 2, 3].includes(n)),
      [...ns].join(','));
    const per = {};
    r.recs.forEach(x => { per[x[0]] = (per[x[0]] || 0) + 1; });
    ok('⑨b 每颗星点数一致（同输入同输出）', per[1] === per[2] && per[2] === per[3],
      JSON.stringify(per));
    ok('⑨c 字段严格为 3 个（norad/历元/半长轴）', r.recs.every(x => x.length === 3));
  }

  console.log('\n自检结论：' + (fails.length ? '失败 ' + fails.length + ' 项' : '全部通过'));
  process.exit(fails.length ? 1 : 0);
}