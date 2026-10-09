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
// 按多个候选键取值（取第一个非空者）。CelesTrak 不同接口/不同年代的字段名有过差异，
//   用候选表比写死一个键安全 —— 少一个键只是"值不对"，写错键名是"值直接变 NaN"，
//   而 NaN 会被 toFixed 渲染成字符串 "NaN" 写进 TLE（L2 定宽列被撑坏、下游算轨道得到垃圾）。
function pick(om, keys) {
  for (const k of keys) if (om[k] != null && om[k] !== '') return Number(om[k]);
  return NaN;
}
// CelesTrak 的 OMM（FORMAT=json）→ 本模块的 TLE 形状字段。
//   差别只有一处：OMM 的 EPOCH 是 ISO 时间戳，而 TLE 要 "YY + 年内日（含小数）"。
//   ★ 字段名坑（V1.9.1 修的真 bug）：升交点赤经在 OMM 里叫 **RA_OF_ASC_NODE**，
//     不叫 RAAN。旧代码写 `Number(om.RAAN)` → 恒 NaN → L2 的 RAAN 列输出 "     NaN"。
//     往返自检之所以"看起来通过"，是因为 ommFromTLE 从 L2 读回的也是 NaN，
//     两边同为 NaN 属"恒等" → 断言骗过了自己。教训：自检必须显式断言"不是 NaN"，
//     不能只比"原 == 转"。omm_check.mjs ⑧b 就是这条补丁。
export function fromCelesTrakOmm(om) {
  const d = new Date(om.EPOCH);
  const y = d.getUTCFullYear() % 100;
  const y0 = Date.UTC(d.getUTCFullYear(), 0, 1);
  const doy = (d.getTime() - y0) / 86400000 + 1;      // 1 月 1 日 = 1.00000000
  return {
    OBJECT_ID: (om.OBJECT_ID || '').trim(),
    EPOCH_Y2: y, EPOCH_DOY: doy,
    MEAN_MOTION_DOT: pick(om, ['MEAN_MOTION_DOT']) || 0,
    MEAN_MOTION_DDOT: pick(om, ['MEAN_MOTION_DDOT']) || 0,
    BSTAR: pick(om, ['BSTAR']) || 0,
    EPHEMERIS_TYPE: pick(om, ['EPHEMERIS_TYPE']) || 0,
    ELEMENT_SET_NO: pick(om, ['ELEMENT_SET_NO']) || 0,
    INCLINATION: pick(om, ['INCLINATION']),
    RAAN: pick(om, ['RA_OF_ASC_NODE', 'RAAN']),
    ECCENTRICITY: pick(om, ['ECCENTRICITY']),
    ARG_OF_PERICENTER: pick(om, ['ARG_OF_PERICENTER']),
    MEAN_ANOMALY: pick(om, ['MEAN_ANOMALY']),
    MEAN_MOTION: pick(om, ['MEAN_MOTION']),
    REV_AT_EPOCH: pick(om, ['REV_AT_EPOCH']) || 0
  };
}
// 占位编目号：6 位真号的**后 5 位**零填充。真号与占位号的对应关系另存 sidecar。
export const PH = (norad) => String(norad).slice(-5).padStart(5, '0');
// ★ TLE 第 2 行的**数值列体检**（V1.9.1 新增）。
//   为什么必须有它 —— 这是"静默污染"的克星：
//     `(NaN).toFixed(4)` 得到的是**字符串 "NaN"**，补到 8 列之后**行总长照样 69**，
//     于是所有"长度/正则"型的校验全部放过它，而 satellite.js 却算不出轨道。
//   实测教训：OMM 字段名写错（RAAN vs RA_OF_ASC_NODE）→ 55 颗星的 L2 全是 "     NaN"，
//     而 refresh.mjs 的 merged 是**以上一轮 .tle 为起点**的、S5 又"键已存在就跳过"，
//     所以坏行**永久滞留**（刷新一百次也不会自愈）。
//   因此这个函数被用在三处：refresh 的入口体检（剔坏行 → 促自愈）、出口体检（写盘后复查）、
//     omm_check / e2e 的断言（防复发）。
export function tleHealth(l2) {
  const s = String(l2 || '');
  if (s.length < 63) return false;
  const cols = [s.slice(8, 16), s.slice(17, 25), s.slice(26, 33), s.slice(34, 42), s.slice(43, 51), s.slice(52, 63)];
  return cols.every(f => isFinite(parseFloat(f)));
}
// COSPAR 字段归一化（V1.9.1 修的真 bug）：
//   经典 TLE 的 COSPAR 列只有 **6 列**（YYNNNAA…，如 "26176A"），而现代 OMM 的 OBJECT_ID 是
//   **9 字符**（"2026-176A"）。旧写法直接 padEnd(8) → 长出 1 列 → **L1 变 70 字符** →
//   下游一律按定宽切片的产品全线错位：批次的 key 会变成 "2026-"（卫星归属丢失）、
//   历史库的 `slice(9,14)` 正则失配（**历史静默不入库**）。
//   实测由 refresh.mjs --selftest-omm 的 ②④ 两条抓出。
export function cosparField(objectId) {
  const id = String(objectId || '').trim();
  const m = id.match(/^(\d{4})-(\d{3})([A-Z]{1,3})$/);
  const s = m ? (m[1].slice(2) + m[2] + m[3]) : id;
  return s.padEnd(8).slice(0, 8);            // 定宽 8 列（6 列 COSPAR + 2 列空白）
}
// OMM → 两行 TLE 文本（编目号用占位；其余各列严格按定宽规范）
//   ★ 硬闸门：所有必填的数值列必须是有限数，否则**抛错**。
//     理由：`(NaN).toFixed(4)` 会得到字符串 "NaN"，被 padStart 一补就写进 L2 —— TLE 看上去
//     "有内容"，satellite.js 却算不出轨道。这种坏数据比直接报错危险得多（静默污染数据源）。
export function tleFromOmm(o, placeholder) {
  const req = ['INCLINATION', 'RAAN', 'ECCENTRICITY', 'ARG_OF_PERICENTER', 'MEAN_ANOMALY', 'MEAN_MOTION'];
  for (const k of req) {
    if (!isFinite(Number(o[k]))) throw new Error('tleFromOmm: 字段 ' + k + ' 非有限数（' + o[k] + '）—— 检查上游 OMM 的字段名');
  }
  const cn = placeholder || '00000';
  const yy = String(o.EPOCH_Y2 != null ? o.EPOCH_Y2 : 0).padStart(2, '0');
  const doy = (o.EPOCH_DOY != null ? o.EPOCH_DOY : 0).toFixed(8).padStart(12, '0');
  const l1 = '1 ' + cn + 'U ' + cosparField(o.OBJECT_ID) + ' ' + yy + doy + ' ' +
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
// ---- 往返自检：用真实的 TLE 做 TLE → OMM → TLE，逐字段比对 ----
//   V1.9.1：抽成**可导入函数**（原先只写在 CLI 里）—— 测试（smoke.mjs）直接 import 调用，
//   避免**起子进程**（本机从 Node 内 spawn 同一个 node.exe 会 EBUSY）。
//   ★ 另外两处修正（都在 V1.9.1）：
//     ① 失败**全量计数**（badN），bad 只留 3 条样本 —— 旧版直接返回被截断的数组，
//        调用方读 .length 得到的是"3"而非真实失败数（曾把 55 颗的真实失败误读成 3 颗）；
//     ② 单条异常**不炸**：tleFromOmm 现在会为坏字段抛错，这里必须 catch 并计入失败，
//        否则一个坏样本就让整个自检进程崩溃、CI 看不到完整报告。
export function ommRoundTrip(files) {
  let n = 0, badN = 0; const bad = [];
  for (const p of files) {
    if (!fs.existsSync(p)) continue;
    const lines = fs.readFileSync(p, 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
    for (let i = 0; i + 2 < lines.length; i += 3) {
      const l1 = lines[i + 1], l2 = lines[i + 2];
      if (!/^1 /.test(l1) || !/^2 /.test(l2)) continue;
      const cn = l1.slice(2, 7);
      n++;
      let a1, a2;
      try { [a1, a2] = tleFromOmm(ommFromTLE(l1, l2), cn); }
      catch (e) { badN++; if (bad.length < 3) bad.push({ l1, a1: '⚠️ ' + e.message, l2, a2: '' }); continue; }
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
      if (!d1 || !d2) { badN++; if (bad.length < 3) bad.push({ l1, a1, l2, a2 }); }
    }
  }
  return { n: n, badN: badN, bad: bad };
}
const isMain = process.argv[1] && process.argv[1].endsWith('omm.mjs');
if (isMain && process.argv.includes('--selftest')) {
  const r = ommRoundTrip([path.join(ROOT, 'data/ct_hulianwang.tle'), path.join(ROOT, 'data/ct_qianfan.tle')]);
  console.log('自检样本数 =', r.n, '｜往返失败 =', r.badN);
  r.bad.forEach(b => {
    console.log('  原 L1:', JSON.stringify(b.l1));
    console.log('  转 L1:', JSON.stringify(b.a1));
    console.log('  原 L2:', JSON.stringify(b.l2));
    console.log('  转 L2:', JSON.stringify(b.a2));
  });
  process.exit(r.badN ? 1 : 0);
}
