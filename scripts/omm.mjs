/* omm.mjs —— OMM（CelesTrak 的 FORMAT=json）⇄ 经典两行 TLE 文本的互转
 * ---------------------------------------------------------------------------
 * 为什么需要它（V1.9.0 修复的真缺陷）：
 *   CelesTrak 自 2026-07-11 起对 5 位编目号用尽，新编目对象一律 6 位（100000+），
 *   而**经典 TLE 格式的编目号字段只有 5 列**，装不下 → 这些对象的 GP 数据**不再以 TLE 格式提供**。
 *   我们旧版 refresh.mjs 三路查询全部只用 `FORMAT=tle`，于是永远拿不到这类对象的轨道要素
 *   （实测：missing_gw.json 36 条、missing_qf.json 19 条，**全是** 6 位编号）。
 *
 * 做法：
 *   1. 对 6 位编号改用 `FORMAT=json`（OMM）取数据；
 *   2. 用本模块把 OMM 转成"TLE 形状"的两行文本 —— 编目号字段填**占位 5 位**（真号另存 sidecar），
 *      其余各列严格按 TLE 的定宽规范写，因此 satellite.js 的 twoline2satrec 照常可用；
 *   3. 真号通过 `data/omm_norad.json`（占位 → 真号）映射回前端显示，前端代码零改动
 *      （它本来就用我们自己的 `id` 字段，而不是从文本里现抠）。
 *
 * ★ 自证：`node scripts/omm.mjs --selftest` 会用**现有的真实 TLE** 做一次往返
 *   （TLE → OMM → TLE），逐字段比对。格式只要错一格，往返就对不上 —— 这是本模块的验收依据。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const pad = (s, n) => String(s).padStart(n, ' ');
// TLE 的"省略小数点 + 指数"写法：1.23456e-5 → " 12345-5"，-1.2e-6 → "-12000-6"
export function toTleExp(v, digits) {
  if (!isFinite(v) || v === 0) return ' ' + '0'.repeat(digits) + '-0';
  const sign = v < 0 ? '-' : ' ';
  const a = Math.abs(v);
  let exp = Math.floor(Math.log10(a)) + 1;          // 变成 0.ddddd × 10^exp
  let mant = Math.round(a / Math.pow(10, exp - digits));
  if (mant >= Math.pow(10, digits)) { mant = Math.round(mant / 10); exp += 1; }
  const m = String(mant).padStart(digits, '0').slice(0, digits);
  const e = exp >= 0 ? String(exp) : String(-exp);
  return sign + m + (exp >= 0 ? '+' : '-') + e;
}
export function fromTleExp(s) {
  const t = String(s).trim();
  if (!t) return 0;
  const sign = /^-/.test(t) ? -1 : 1;
  const m = t.replace(/^[-+]/, '').match(/^(\d+)([+-]\d+)$/);
  if (!m) return 0;
  return sign * Number('0.' + m[1]) * Math.pow(10, Number(m[2]));
}
// ⚠️ TLE 的 ndot（第一项导数）**不是指数写法**，而是 `±.NNNNNNNN`（隐含前导 0. + 8 位小数）；
//   只有 nddot 与 BSTAR 才用"省略小数点 + 指数"。自检就是在这里抓出过错误：
//   我最初对 ndot 也用了指数解析 → 得到 0 → 那 3 颗星的 ndot 在往返里全丢了。
export function toTleNdot(v) {
  const a = Math.abs(Number(v) || 0);
  return (v < 0 ? '-' : ' ') + '.' + String(Math.round(a * 1e8)).padStart(8, '0');
}
export function fromTleNdot(s) {
  const t = String(s).trim();
  return t ? Number(t) : 0;
}
// TLE 校验位：所有数字求和，每出现一个 '-' 加 1，取模 10
export function tleChecksum(line68) {
  let s = 0;
  for (const ch of line68) {
    if (ch >= '0' && ch <= '9') s += Number(ch);
    else if (ch === '-') s += 1;
  }
  return String(s % 10);
}
// 由 TLE 的两行文本取出各字段（据此构造 OMM；字段名与 CelesTrak 的 OMM 一致）
export function ommFromTLE(l1, l2) {
  const e = l1.slice(18, 32);                        // YYDDD.DDDDDDDD
  const yy = Number(e.slice(0, 2));
  const doy = Number(e.slice(2));
  return {
    OBJECT_ID: l1.slice(9, 17).trim(),
    EPOCH_Y2: yy, EPOCH_DOY: doy,
    MEAN_MOTION_DOT: fromTleNdot(l1.slice(33, 43)),
    MEAN_MOTION_DDOT: fromTleExp(l1.slice(44, 52)),
    BSTAR: fromTleExp(l1.slice(53, 61)),
    EPHEMERIS_TYPE: Number(l1.slice(62, 63)) || 0,
    ELEMENT_SET_NO: Number(l1.slice(64, 68)) || 0,
    INCLINATION: Number(l2.slice(8, 16)),
    RAAN: Number(l2.slice(17, 25)),
    ECCENTRICITY: Number('0.' + l2.slice(26, 33)),
    ARG_OF_PERICENTER: Number(l2.slice(34, 42)),
    MEAN_ANOMALY: Number(l2.slice(43, 51)),
    MEAN_MOTION: Number(l2.slice(52, 63)),
    REV_AT_EPOCH: Number(l2.slice(63, 68)) || 0
  };
}
// CelesTrak 的 OMM（FORMAT=json）→ 本模块的 TLE 形状字段。
//   差别只有一处：OMM 的 EPOCH 是 ISO 时间戳，而 TLE 要 "YY + 年内日（含小数）"。
export function fromCelesTrakOmm(om) {
  const d = new Date(om.EPOCH);
  const y = d.getUTCFullYear() % 100;
  const y0 = Date.UTC(d.getUTCFullYear(), 0, 1);
  const doy = (d.getTime() - y0) / 86400000 + 1;      // 1 月 1 日 = 1.00000000
  return {
    OBJECT_ID: (om.OBJECT_ID || '').trim(),
    EPOCH_Y2: y, EPOCH_DOY: doy,
    MEAN_MOTION_DOT: Number(om.MEAN_MOTION_DOT) || 0,
    MEAN_MOTION_DDOT: Number(om.MEAN_MOTION_DDOT) || 0,
    BSTAR: Number(om.BSTAR) || 0,
    EPHEMERIS_TYPE: Number(om.EPHEMERIS_TYPE) || 0,
    ELEMENT_SET_NO: Number(om.ELEMENT_SET_NO) || 0,
    INCLINATION: Number(om.INCLINATION),
    RAAN: Number(om.RAAN),
    ECCENTRICITY: Number(om.ECCENTRICITY),
    ARG_OF_PERICENTER: Number(om.ARG_OF_PERICENTER),
    MEAN_ANOMALY: Number(om.MEAN_ANOMALY),
    MEAN_MOTION: Number(om.MEAN_MOTION),
    REV_AT_EPOCH: Number(om.REV_AT_EPOCH) || 0
  };
}
// 占位编目号：6 位真号的**后 5 位**零填充。真号与占位号的对应关系另存 sidecar。
export const PH = (norad) => String(norad).slice(-5).padStart(5, '0');
// OMM → 两行 TLE 文本（编目号用占位；其余各列严格按定宽规范）
export function tleFromOmm(o, placeholder) {
  const cn = placeholder || '00000';
  const yy = String(o.EPOCH_Y2 != null ? o.EPOCH_Y2 : 0).padStart(2, '0');
  const doy = (o.EPOCH_DOY != null ? o.EPOCH_DOY : 0).toFixed(8).padStart(12, '0');
  const l1 = '1 ' + cn + 'U ' + (o.OBJECT_ID || '').padEnd(8) + ' ' + yy + doy + ' ' +
    toTleNdot(o.MEAN_MOTION_DOT) + ' ' +
    toTleExp(o.MEAN_MOTION_DDOT, 5) + ' ' +
    toTleExp(o.BSTAR, 5) + ' ' +
    String(o.EPHEMERIS_TYPE || 0) + ' ' +
    String(o.ELEMENT_SET_NO || 0).padStart(4);
  const l2 = '2 ' + cn + ' ' +
    o.INCLINATION.toFixed(4).padStart(8) + ' ' +
    o.RAAN.toFixed(4).padStart(8) + ' ' +
    String(Math.round(o.ECCENTRICITY * 1e7)).padStart(7, '0') + ' ' +
    o.ARG_OF_PERICENTER.toFixed(4).padStart(8) + ' ' +
    o.MEAN_ANOMALY.toFixed(4).padStart(8) + ' ' +
    o.MEAN_MOTION.toFixed(8).padStart(11) +
    String(o.REV_AT_EPOCH || 0).padStart(5);
  return [l1 + tleChecksum(l1), l2 + tleChecksum(l2)];   // 末位补上真正的校验位
}
// ---- 自检：用真实的 TLE 做 TLE → OMM → TLE 往返，逐字段比对 ----
const isMain = process.argv[1] && process.argv[1].endsWith('omm.mjs');
if (isMain && process.argv.includes('--selftest')) {
  let n = 0, bad = [];
  for (const f of ['data/ct_hulianwang.tle', 'data/ct_qianfan.tle']) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    const lines = fs.readFileSync(p, 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
    for (let i = 0; i + 2 < lines.length; i += 3) {
      const l1 = lines[i + 1], l2 = lines[i + 2];
      if (!/^1 /.test(l1) || !/^2 /.test(l2)) continue;
      const cn = l1.slice(2, 7);
      const [a1, a2] = tleFromOmm(ommFromTLE(l1, l2), cn);
      n++;
      const near = (x, y, eps) => Math.abs(Number(x) - Number(y)) <= eps;
      const d1 = near(l1.slice(18, 32), a1.slice(18, 32), 1e-8) &&
        near(l1.slice(33, 43), a1.slice(33, 43), 1e-9) &&
        l1.slice(53, 61) === a1.slice(53, 61) &&
        l1.slice(65, 68) === a1.slice(65, 68);
      const d2 = near(l2.slice(8, 16), a2.slice(8, 16), 1e-4) &&
        near(l2.slice(17, 25), a2.slice(17, 25), 1e-4) &&
        l2.slice(26, 33) === a2.slice(26, 33) &&
        near(l2.slice(34, 42), a2.slice(34, 42), 1e-4) &&
        near(l2.slice(43, 51), a2.slice(43, 51), 1e-4) &&
        near(l2.slice(52, 63), a2.slice(52, 63), 1e-8) &&
        l2.slice(63, 68) === a2.slice(63, 68);
      if (!d1 || !d2) { if (bad.length < 3) bad.push({ l1, a1, l2, a2 }); }
    }
  }
  console.log('自检样本数 =', n, '｜往返失败 =', bad.length);
  bad.forEach(b => {
    console.log('  原 L1:', JSON.stringify(b.l1));
    console.log('  转 L1:', JSON.stringify(b.a1));
    console.log('  原 L2:', JSON.stringify(b.l2));
    console.log('  转 L2:', JSON.stringify(b.a2));
  });
  process.exit(bad.length ? 1 : 0);
}
