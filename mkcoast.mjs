import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.dirname(fileURLToPath(import.meta.url));   // 脚本所在目录（发布包内任意位置可用）
const OUT = path.join(ROOT, 'data')';
const UA = 'Mozilla/5.0 Chrome/126';

const r = await fetch('https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_coastline.geojson', { headers: { 'User-Agent': UA } });
const gj = JSON.parse(await r.text());
console.log('features=', gj.features.length);

// Douglas-Peucker
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
function perpDist(p, a, b) {
  const x = p[0], y = p[1], x1 = a[0], y1 = a[1], x2 = b[0], y2 = b[1];
  const dx = x2 - x1, dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(x - x1, y - y1);
  const t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy);
  const cx = x1 + Math.max(0, Math.min(1, t)) * dx, cy = y1 + Math.max(0, Math.min(1, t)) * dy;
  return Math.hypot(x - cx, y - cy);
}

let lines = [];
for (const f of gj.features) {
  const g = f.geometry;
  const arrs = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
  for (const c of arrs) {
    let s = dp(c, 0.22);
    s = s.map(p => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]);
    // drop consecutive duplicates
    const out = [];
    for (const p of s) if (!out.length || out[out.length - 1][0] !== p[0] || out[out.length - 1][1] !== p[1]) out.push(p);
    if (out.length >= 2) lines.push(out);
  }
}
lines = lines.filter(l => l.length >= 2);
console.log('lines=', lines.length, 'pts=', lines.reduce((a, l) => a + l.length, 0));

// compact encoding: "lon,lat lon,lat ..." per line
const body = lines.map(l => l.map(p => `${p[0]},${p[1]}`).join(' ')).join('|');
fs.writeFileSync(`${OUT}/coast.txt`, body, 'utf8');
console.log('coast.txt bytes=', Buffer.byteLength(body));
fs.writeFileSync(`${OUT}/coast.js.txt`, `window.COAST_DATA=${JSON.stringify(lines)};`, 'utf8');
console.log('coast.js bytes=', fs.statSync(`${OUT}/coast.js.txt`).size);
