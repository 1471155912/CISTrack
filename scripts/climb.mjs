/* climb.mjs —— 04 章「变轨情况」（V1.9.1 A15 前的「升轨情况」）的数据层
 * ---------------------------------------------------------------------------
 * 口径完全按用户确认的 Rassvet 算法（任务清单 Q30 / Q31）：
 *
 *   · **升轨速度（对应参考站的 ТЕМП, КМ/СУТ）**：对**每一天**，取该日**前后各两天**窗口内的
 *     全部轨道要素，做**最小二乘拟合直线的斜率**，单位 km/天。
 *     窗口是必要的 —— 要素本身的拟合抖动约 0.16 km，只用相邻两条会淹没在噪声里。
 *   · **要素不足的天跳过**；**间隔超过 2 天就断开**，不做插值（"拉一条线穿过空档等于编数据"）。
 *   · 只存**原始半长轴**（布劳威尔，与 SGP4 内部一致），升轨速度与曲线都在呈现时现算 ——
 *     所以以后修正公式**不需要重灌历史**。
 *   · 历史记录字段：`{norad, 历元, 半长轴}`（只存一种模型、一个值 —— 用户确认）。
 *
 * 自证：`node scripts/climb.mjs --selftest` —— 用**已知斜率**的合成数据反推，
 *   并验证"断档要断开""要素不足要跳过"。算法对不对，靠这个说了算，不靠肉眼。
 */

const DAY = 86400000;

/** 最小二乘拟合直线的斜率（x=天，y=km/天）
 *  ★ 必须把 x **中心化**再算：真实历史的毫秒时间戳约 1.8e12，平方后 ~3e24，
 *    与 y（~1e3）相乘再相减会出现严重的**抵消误差**（自检首跑就撞到 ~3e-9 km/天的假误差）。
 *    减去均值后 x 的量级降到"天"，精度恢复 —— 这是最小二乘的标准做法。 */
export function fitSlope(sample) {
  const n = sample.length;
  if (n < 2) return null;
  let mx = 0;
  for (const p of sample) mx += p.ms;
  mx /= n;                                        // x 的均值（毫秒）
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of sample) {
    const x = (p.ms - mx) / DAY;                  // 中心化 + 换成"天"
    const y = p.sma;
    sx += x; sy += y; sxx += x * x; sxy += x * y;
  }
  const den = n * sxx - sx * sx;
  if (Math.abs(den) < 1e-12) return null;         // 所有点同一时刻 → 斜率无定义
  return (n * sxy - sx * sy) / den;               // 单位：km/天
}

/**
 * 由「{ms, sma} 点列」算出逐日升轨速度。
 * @param pts   已按 ms 升序的原始要素点 [{ms, sma}]
 * @param half  窗口半径（天），默认 2（即"前后各两天"）
 * @param minPts 每个窗口至少几个点才算数（默认 2；不足则跳过该日）
 * @returns [{dayMs, rate, n}]，按天升序；没有有效窗口的天**不会出现在结果里**
 */
export function riseRateSeries(pts, half, minPts) {
  half = half == null ? 2 : half;
  minPts = minPts || 2;
  if (!pts || pts.length < minPts) return [];
  const t0 = Math.floor(pts[0].ms / DAY) * DAY;
  const t1 = Math.floor(pts[pts.length - 1].ms / DAY) * DAY;
  const out = [];
  for (let d = t0; d <= t1; d += DAY) {
    const lo = d - half * DAY, hi = d + half * DAY;
    const win = pts.filter(p => p.ms >= lo && p.ms <= hi);
    if (win.length < minPts) continue;            // 要素不足 → 跳过这一天
    const rate = fitSlope(win);
    if (rate != null) out.push({ dayMs: d, rate: rate, n: win.length });
  }
  return out;
}

/**
 * 按"间隔超过 maxGapDays 就断开"的规则，把序列切成若干段（不插值）。
 * @returns [[点, …], [点, …]]  —— 每段内部连续
 */
export function breakGaps(series, maxGapDays) {
  const maxGap = (maxGapDays == null ? 2 : maxGapDays) * DAY;
  const segs = [];
  let cur = null;
  for (const p of series) {
    if (cur && p.dayMs - cur[cur.length - 1].dayMs > maxGap) { segs.push(cur); cur = null; }
    if (!cur) cur = [];
    cur.push(p);
  }
  if (cur) segs.push(cur);
  return segs;
}

/**
 * 把逐日记录折成"每颗星一条曲线"（供图上按卫星/批次取用）。
 * 历史记录形如 [[norad, epochMs, sma], …] —— 与 data/history/*.json 的分片格式一致。
 */
export function buildCurve(records, opts) {
  opts = opts || {};
  const bySat = new Map();
  for (const r of records) {
    const [norad, ms, sma] = r;
    if (!isFinite(sma) || !isFinite(ms)) continue;
    if (!bySat.has(norad)) bySat.set(norad, []);
    bySat.get(norad).push({ ms: ms, sma: sma });
  }
  const out = new Map();
  bySat.forEach((pts, norad) => {
    pts.sort((a, b) => a.ms - b.ms);
    out.set(norad, {
      pts: pts,
      rates: breakGaps(riseRateSeries(pts, opts.half, opts.minPts), opts.maxGapDays)
    });
  });
  return out;
}

// ---------------------------------------------------------------- 自检
const isMain = process.argv[1] && process.argv[1].endsWith('climb.mjs');
if (isMain && process.argv.includes('--selftest')) {
  const fails = [];
  const ok = (name, cond, extra) => {
    console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? '  → ' + extra : ''));
    if (!cond) fails.push(name);
  };

  // ① 已知斜率：每天 +0.25 km，每 6 小时一个点，共 20 天 —— 算出来的速度必须是 0.25
  {
    const pts = [];
    const t0 = Date.UTC(2026, 0, 1);
    for (let h = 0; h <= 20 * 24; h += 6) pts.push({ ms: t0 + h * 3600000, sma: 500 + 0.25 * (h / 24) });
    const s = riseRateSeries(pts, 2, 2);
    const worst = Math.max.apply(null, s.map(p => Math.abs(p.rate - 0.25)));
    ok('① 已知斜率 0.25 km/天 → 逐日速度误差 < 1e-9', worst < 1e-9, 'max|Δ|=' + worst.toExponential(2));
  }
  // ② 倒退（降轨）：每天 −0.4 km，速度必须为负
  {
    const pts = [];
    const t0 = Date.UTC(2026, 0, 1);
    for (let h = 0; h <= 12 * 24; h += 12) pts.push({ ms: t0 + h * 3600000, sma: 800 - 0.4 * (h / 24) });
    const s = riseRateSeries(pts, 2, 2);
    const allNeg = s.every(p => p.rate < 0);
    const worst = Math.max.apply(null, s.map(p => Math.abs(p.rate + 0.4)));
    ok('② 降轨 −0.4 km/天 → 速度全为负且误差 < 1e-9', allNeg && worst < 1e-9, 'max|Δ|=' + worst.toExponential(2));
  }
  // ③ 断档：中间空 10 天 → 必须断成两段（而不是拉一条线穿过去）
  {
    const t0 = Date.UTC(2026, 0, 1);
    const pts = [];
    for (let d = 0; d <= 6; d++) pts.push({ ms: t0 + d * DAY, sma: 500 + d * 0.2 });
    for (let d = 17; d <= 23; d++) pts.push({ ms: t0 + d * DAY, sma: 503 + (d - 17) * 0.2 });
    const segs = breakGaps(riseRateSeries(pts, 2, 2), 2);
    ok('③ 中间空 10 天 → 断成 2 段（不插值穿过空档）', segs.length === 2, '段数=' + segs.length);
  }
  // ④ 要素不足：某天窗口里只有 1 个点 → 该天必须被跳过
  {
    const t0 = Date.UTC(2026, 0, 1);
    const pts = [];
    pts.push({ ms: t0, sma: 500 });                       // 只有这一个孤立点
    const pts2 = pts.concat([
      { ms: t0 + 40 * DAY, sma: 520 }, { ms: t0 + 41 * DAY, sma: 520.2 }
    ]);
    const s = riseRateSeries(pts2, 2, 2);
    const hasIsolated = s.some(p => Math.abs(p.dayMs - t0) < DAY);
    ok('④ 孤立单点的那一天被跳过（窗口内点数不足 2）', !hasIsolated);
  }
  // ⑤ buildCurve：分片记录 → 每颗星一条曲线 + 断档信息
  {
    const t0 = Date.UTC(2026, 0, 1);
    const recs = [];
    for (let d = 0; d <= 5; d++) { recs.push([100203, t0 + d * DAY, 500 + d * 0.3]); recs.push([100204, t0 + d * DAY, 600 + d * 0.1]); }
    const m = buildCurve(recs);
    const c1 = m.get(100203), c2 = m.get(100204);
    ok('⑤ buildCurve 按 NORAD 拆成两条曲线、点数正确',
      m.size === 2 && c1.pts.length === 6 && c2.pts.length === 6, '曲线数=' + m.size);
    const r1 = c1.rates[0][1].rate;
    ok('⑤ 第一条曲线首日速度 ≈ 0.3 km/天', Math.abs(r1 - 0.3) < 1e-9, 'rate=' + r1.toFixed(6));
  }

  console.log('\n自检结论：' + (fails.length ? '失败 ' + fails.length + ' 项' : '全部通过'));
  process.exit(fails.length ? 1 : 0);
}
