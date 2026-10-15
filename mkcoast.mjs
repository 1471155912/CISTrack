/* mkcoast.mjs —— 地球模型的海岸线数据生成（V1.9.5 修）
 * ---------------------------------------------------------------------------
 * 数据源：Natural Earth（公有领域）`ne_<级>m_coastline.geojson`，经 Douglas-Peucker
 *   简化 + 坐标取整后写成两份：
 *     · data/coast.txt     紧凑文本（"lon,lat lon,lat …|…"）—— 人看/比对用
 *     · data/coast.js.txt  `window.COAST_DATA=[…];` —— **build.mjs 内嵌进单文件产物**
 *   页面端（app.js）把 COAST 预计算成 COAST_UV 供 3D 地球使用、原数组供 2D 地图使用。
 *
 * 用法：
 *   node mkcoast.mjs                  # 默认档：50m / 0.10° / 坐标 1 位小数（H24 推荐）
 *   node mkcoast.mjs 110m 0.22 1      # 复现旧的粗档（体积最小）
 *   node mkcoast.mjs 50m 0.05 2       # 更细（约 315 KB，注意单文件体积与每帧开销）
 *   node mkcoast.mjs --list           # 打印可选档位与体积参考
 *
 * ★ 为什么要有参数：H24（"地球大陆/海洋边界线更清晰"）要在「清晰度」与「单文件体积 + 每帧
 *   描边开销」之间选档，写死常量就只能改代码。实测对照（2026-10-15，与脚本内同口径统计）：
 *     110m/0.22° → 134 线 / 2 926 点 / 37 KB      （旧档）
 *     50m /0.22° → 877 线 / 7 477 点 / 94 KB
 *     50m /0.10° → 1 345 线 / 14 220 点 / 178 KB  （当前默认）
 *     50m /0.05° → 1 415 线 / 21 678 点 / 315 KB
 *   注意 02 章地球是**每帧**重描海岸线（app.js 的 drawGlobe，限流 20fps），点数直接决定帧开销。
 *
 * ★ 本脚本的历史 bug（V1.9.5 修，务必别再犯）：第 5 行原来写成
 *     const OUT = path.join(ROOT, 'data')';   ← 末尾多一个引号
 *   于是 `node --check mkcoast.mjs` 直接 SyntaxError —— **从 V1.4.8 起这个脚本就没跑过一次**，
 *   仓库里的 data/coast.js.txt 一直是更早版本留下的产物。改数值前先跑一次，别只看文件在不在。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));   // 脚本所在目录（发布包内任意位置可用）
const OUT = path.join(ROOT, 'data');
const UA = 'Mozilla/5.0 Chrome/126';
const MIRRORS = [
  'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/',
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/',
];

// 可选档位（体积为 2026-10-15 实测值，供选档时参考；不是判据）
const TIERS = [
  ['110m', 0.22, 1, '134 线 / 2 926 点 / 37 KB（旧档）'],
  ['50m', 0.22, 1, '877 线 / 7 477 点 / 94 KB'],
  ['50m', 0.10, 1, '1 345 线 / 14 220 点 / 178 KB ← 默认'],
  ['50m', 0.05, 2, '1 415 线 / 21 678 点 / 315 KB'],
  ['10m', 0.05, 2, '约 5 000 线 / 90 000+ 点 / >1.5 MB（不建议：每帧开销过大）'],
];
if (process.argv.includes('--list')) {
  console.log('可选档位（数据集 容差 坐标小数位）：');
  TIERS.forEach(t => console.log('  node mkcoast.mjs ' + t[0] + ' ' + t[1] + ' ' + t[2] + '   → ' + t[3]));
  process.exit(0);
}

const LEVEL = process.argv[2] || '50m';
const TOL = parseFloat(process.argv[3] || '0.10');
const DEC = parseInt(process.argv[4] || '1', 10);
if (!/^\d+m$/.test(LEVEL) || !isFinite(TOL) || TOL <= 0 || !(DEC >= 0 && DEC <= 4)) {
  console.error('参数不合法。用法：node mkcoast.mjs [110m|50m|10m] [容差度] [坐标小数位]；见 --list');
  process.exit(2);
}

// ---- 取数据：两个镜像各试 2 次（单源失败不该毁掉这条链路；本脚本是手工/构建期工具） ----
const NAME = 'ne_' + LEVEL + '_coastline.geojson';
let gj = null, from = null;
for (const base of MIRRORS) {
  for (let attempt = 1; attempt <= 2 && !gj; attempt++) {
    try {
      const r = await fetch(base + NAME, { headers: { 'User-Agent': UA } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      gj = JSON.parse(await r.text());
      from = base.split('/')[2];
    } catch (e) {
      console.error('取数失败（' + base.split('/')[2] + ' 第 ' + attempt + ' 次）：' + (e && e.message || e));
    }
  }
  if (gj) break;
}
if (!gj) {
  console.error('✗ 两个镜像都取不到 ' + NAME + '；保留现有 data/coast.js.txt 不动（构建不受影响）。');
  process.exit(1);
}
console.log(NAME + ' ← ' + from + '；features=' + gj.features.length);

// ---- Douglas-Peucker ----
function perpDist(p, a, b) {
  const x = p[0], y = p[1], x1 = a[0], y1 = a[1], x2 = b[0], y2 = b[1];
  const dx = x2 - x1, dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(x - x1, y - y1);
  const t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy);
  const cx = x1 + Math.max(0, Math.min(1, t)) * dx, cy = y1 + Math.max(0, Math.min(1, t)) * dy;
  return Math.hypot(x - cx, y - cy);
}
function dp(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = -1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = perpDist(pts[i], pts[a], pts[b]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

const K = Math.pow(10, DEC);
let lines = [];
for (const f of gj.features) {
  const g = f.geometry;
  const arrs = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
  for (const c of arrs) {
    let s = dp(c, TOL);
    s = s.map(p => [Math.round(p[0] * K) / K, Math.round(p[1] * K) / K]);
    // drop consecutive duplicates（取整后会出现重复点，留着只会白描线段）
    const out = [];
    for (const p of s) if (!out.length || out[out.length - 1][0] !== p[0] || out[out.length - 1][1] !== p[1]) out.push(p);
    if (out.length >= 2) lines.push(out);
  }
}
lines = lines.filter(l => l.length >= 2);
const pts = lines.reduce((a, l) => a + l.length, 0);
console.log('简化后：lines=' + lines.length + ' pts=' + pts + '（tol=' + TOL + '° dec=' + DEC + '）');

// ---- 写出 ----
// compact encoding: "lon,lat lon,lat ..." per line
const body = lines.map(l => l.map(p => `${p[0]},${p[1]}`).join(' ')).join('|');
fs.writeFileSync(path.join(OUT, 'coast.txt'), body, 'utf8');
console.log('data/coast.txt    ' + Buffer.byteLength(body) + ' B');
const js = `window.COAST_DATA=${JSON.stringify(lines)};`;
fs.writeFileSync(path.join(OUT, 'coast.js.txt'), js, 'utf8');
console.log('data/coast.js.txt ' + Buffer.byteLength(js) + ' B  ← build.mjs 会内嵌进单文件产物');

// 提示（不是判据）：超阈值时提醒体积/帧开销，别默默把产物撑大
if (Buffer.byteLength(js) > 400 * 1024) {
  console.log('⚠ 单文件体积增幅已超过 400 KB（用户口径：H24 目标 < 300 KB）—— 确认是否真要这档。');
}
