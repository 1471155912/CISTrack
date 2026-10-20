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
// ★ V1.9.1（1.4）：零值必须写成 **"+0" 而不是 "-0"**。
//   为什么：CelesTrak 的原文对 0 一律用 `00000+0`（GEO 卫星的 BSTAR 就是 0 —— 静止轨道没有
//   大气阻力），而我们旧写法返回 `-0` → 往返自检里"原文本 == 转出文本"这一比就失败。
//   数值上 +0 与 -0 完全等价（fromTleExp 两者都解析成 0），所以这是**纯格式不一致**；
//   但既然要与上游逐字节对齐（往返自检的验收标准就是这个），就按上游的写法来。
//   这个 bug 只在"BSTAR 恰为 0"时才暴露 —— LEO 卫星都有阻力（BSTAR≈1e-4），
//   所以它一直躲着，直到 1.4 把 GEO 三颗收进来才现形。
export function toTleExp(v, digits) {
  if (!isFinite(v) || v === 0) return ' ' + '0'.repeat(digits) + '+0';
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
/**
 * ★ V1.9.3（**血泪教训，务必读**）：TLE 的历元字段 → **毫秒时间戳**。
 *
 * ⚠️ 别被名字骗了：`refresh.mjs` 的 `parseTLE` 里那个 `epoch` 是
 *   **TLE 原始格式的数值**（`YYDDD.DDDDDDDD`，如 `26282.76458782` = 2026 年第 282.76 天），
 *   **不是毫秒**。它只用于"同一颗卫星保留历元最新的一份"这类**同格式比大小**的场合。
 *
 *   2026-10-13 的事故：新增的「数据新鲜度闸门」直接拿 `epoch` 当毫秒用 →
 *   `(Date.now() − 282.76) / 86400000 ≈ 20739 天` → 在**数据完全正常的 CI 上**
 *   （日志：gw 251 颗 / qf S5 补到 19 颗、失败 0）把闸门自己变成了故障源、以 exitCode 5 失败。
 *   而这正是本轮要修的"静默失败"的反面教材：**闸门误报比不报更糟**。
 *
 *   为什么本地没验出来：验证脚本里**另写了一份**解析（正确拆了 YY/DDD），
 *   打印"落后 3.41 天 ✓" —— 验的是脑子里的实现，不是代码里跑的实现。
 *   ⇒ 所以它现在住在**可被测试直接 import** 的模块里（smoke 有断言打真实函数）。
 *
 * 格式（TLE 标准，第 19-32 列）：
 *   · `YY`：57~99 → 19xx；00~56 → 20xx（沿用 TLE 的世纪约定）
 *   · `DDD.DDDDDDDD`：年内第几天，含小数（1 = 1 月 1 日 00:00 UTC）
 * 用法：`tleEpochMs(l1)`（传**整整一行**，内部取 18..32 列）
 */
export function tleEpochMs(l1) {
  const s = String(l1 || '').slice(18, 32).trim();
  // ★★ V1.9.9.630（对抗性测试抓出）：**历元列必须严格匹配 `YYDDD.DDDDDDDD`**，
  //   不能只 `parseFloat` 了事。病根（实测）：
  //     `parseInt('9X', 10)` → 9（静默吃掉后缀的 X）→ yy=2009；
  //     `parseFloat('289.19093506')` → 289.19 → 得到一个**看起来完全正常的毫秒值**。
  //   后果：坏历元不会返回 0，而是变成一个"2009 年的合法时间戳"——于是
  //     · refresh 的"N 天落后"闸门读到 6000+ 天，却仍能算出有限数，判据照样"通过计算"；
  //     · 排障时看到的是一个像模像样的日期，**根本看不出历元列本身是坏的**。
  //   这类"坏输入产出貌似合理的输出"正是本项目反复踩的静默失败形态。
  //   取舍：宁可返回 0（下游有 `em <= 0` 判据会把它抓出来），也不要编一个假日期。
  //   实测 515 行真实 TLE 全部严格匹配本正则（见 V1.9.9.630 的验证记录），零误报。
  const m = /^(\d{2})(\d{3}\.\d{8})$/.exec(s);
  if (!m) return 0;
  const yy = parseInt(m[1], 10);
  const doy = parseFloat(m[2]);
  if (!isFinite(yy) || !isFinite(doy) || !(doy >= 1)) return 0;
  const year = yy < 57 ? 2000 + yy : 1900 + yy;
  return Date.UTC(year, 0, 1) + (doy - 1) * 86400000;
}
// ★ TLE 第 2 行的**数值列体检**（V1.9.1 新增）。
//   为什么必须有它 —— 这是"静默污染"的克星：
//     `(NaN).toFixed(4)` 得到的是**字符串 "NaN"**，补到 8 列之后**行总长照样 69**，
//     于是所有"长度/正则"型的校验全部放过它，而 satellite.js 却算不出轨道。
//   实测教训：OMM 字段名写错（RAAN vs RA_OF_ASC_NODE）→ 55 颗星的 L2 全是 "     NaN"，
//     而 refresh.mjs 的 merged 是**以上一轮 .tle 为起点**的、S5 又"键已存在就跳过"，
//     所以坏行**永久滞留**（刷新一百次也不会自愈）。
//   因此这个函数被用在三处：refresh 的入口体检（剔坏行 → 促自愈）、出口体检（写盘后复查）、
//     omm_check / e2e 的断言（防复发）。
// ★ V1.9.9.630（对抗性测试抓出）：**L2 六个倾角/轨道要素的物理区间**抽成**单一真理源**。
//   为什么必须共用一份：`tleHealth()` 是"体检"、`tleFromOmm()` 是"生成"。若两边各写一套区间，
//   迟早出现"生成时放过、体检时判坏"（或反过来）的自相矛盾 —— 那时排障会被自己的工具带偏。
//   现在两处都调 `l2InRange()`：**生成的必然能过体检，体检不过的必然生成不出来**。
//   区间口径（下限侧有意保守，宁宽不严，避免误剔）：
//     · 倾角 [0,180]             —— >180 无物理意义（逆行用 180-x 表示，不会 >180）
//     · 升交点赤经 / 近地点幅角 / 平近点角 ∈ [0,360)
//     · 偏心率 [0,1)             —— 必须 <1，否则轨道不闭合（本项目踩过 e=0.96 把高度算成几千 km）
//     · 平均运动 (0,20] rev/day  —— 0 = "没有轨道"（SGP4 除零 → Infinity/NaN）；>20 超出任何地球轨道
//   实测依据：当前 515 行真实 TLE（gw 253 / qf 262）逐列全部落在区间内，**误报 0**：
//     gw: inc[0.075,86.51] raan[1.54,358.61] ecc[1e-6,1.7e-3] argp[2.87,357.35] ma[2.74,357.22] mm[1.00,15.43]
//     qf: inc[54.99,89.02] raan[1.89,349.06] ecc[1.2e-4,3.3e-3] argp[2.16,323.61] ma[36.43,357.97] mm[13.47,15.52]
export function l2InRange(inc, raan, ecc, argp, ma, mm) {
  if (!(inc >= 0 && inc <= 180)) return false;
  if (!(raan >= 0 && raan < 360)) return false;
  if (!(ecc >= 0 && ecc < 1)) return false;
  if (!(argp >= 0 && argp < 360)) return false;
  if (!(ma >= 0 && ma < 360)) return false;
  if (!(mm > 0 && mm <= 20)) return false;
  return true;
}
export function tleHealth(l2) {
  const s = String(l2 || '');
  if (s.length < 63) return false;
  const cols = [s.slice(8, 16), s.slice(17, 25), s.slice(26, 33), s.slice(34, 42), s.slice(43, 51), s.slice(52, 63)];
  // 第一关：必须是有限数（"NaN" 能撑满定宽列，长度/正则全都拦不住）
  if (!cols.every(f => isFinite(parseFloat(f)))) return false;
  // 第二关：必须是物理可能的（见 l2InRange 上方注释）
  //   病根：`isFinite` 能放过 `倾角 999°`、`平均运动 0`、`偏心率 1.5` 这类"数值合法但物理不可能"的值，
  //   它们不会被任何闸门抓住，却会让 satellite.js 算出 NaN/无穷轨道 —— 与"NaN 写进 TLE"
  //   是同一种静默污染，只是更难发现（字段看起来是数字，日志里一切正常）。
  return l2InRange(
    parseFloat(cols[0]),
    parseFloat(cols[1]),
    parseInt(cols[2], 10) / 1e7,      // 偏心率在 TLE 里是**假定小数点的 7 位整数**
    parseFloat(cols[3]),
    parseFloat(cols[4]),
    parseFloat(cols[5]));
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
  // ★★ V1.9.9.630（对抗性测试抓出的**真缺陷**，与 cosparField 是同一种病）：**历元也是必填的**。
  //   病根（实测）：`fromCelesTrakOmm()` 对坏 `EPOCH` 会算出 `Y2=NaN / DOY=NaN`，
  //   而本函数旧版把历元写成 `String(o.EPOCH_Y2 != null ? ... : 0).padStart(2,'0')`
  //   —— `String(NaN)` 是 **"NaN"（3 个字符）**，`padStart(2,'0')` 只补不截 → 输出 **"NaN"**；
  //   同理 `(NaN).toFixed(8)` → `"NaN"`（3 字符），`padStart(12,'0')` → **12 字符**。
  //   实测产出：
  //     `1 12345U 24001A   NaN000000000NaN  .00000000  00000+0  00000+0 0    03`   ← **70 列**！
  //   为什么极其危险：TLE 是**定宽**格式，下游全部按 `slice(a,b)` 取值 ——
  //     L1 多 1 列会让**该行之后的所有列整体错位**（历元、ndot、BSTAR、元素号全歪），
  //     而且 `tleHealth()` 只看 L2，**L1 完全没人查**；`tleEpochMs()` 旧版又会把它
  //     `parseFloat` 成一个 2009 年的合法时间戳 → 全线"看起来正常"。
  //   这与 V1.9.1 修过的 `cosparField` 长出第 70 列是同一类事故，只是触发源不同（历元 vs COSPAR）。
  //   修法：历元进 `req` 闸门（非有限数 → 抛错，让上游把这颗算作失败并记账），
  //   再补一道**定宽形状闸门**兜住"以后任何一列又长出第 70 列"的整类问题。
  if (!isFinite(Number(o.EPOCH_Y2)) || !isFinite(Number(o.EPOCH_DOY)) || !(Number(o.EPOCH_DOY) >= 1)) {
    throw new Error('tleFromOmm: 历元非有限数或非法（Y2=' + o.EPOCH_Y2 + ' DOY=' + o.EPOCH_DOY +
      '）—— 上游 EPOCH 字段可能是空/垃圾值；历元缺失会让 L1 变成 70 列并整体错位');
  }
  // ★★ V1.9.9.630：**生成侧也过同一套物理区间**（与 tleHealth 共用 `l2InRange`）。
  //   病根（实测）：旧版只查 `isFinite` → `MEAN_MOTION: 0` 能顺利生成
  //     `2 12345  53.0000 100.0000 0010000  90.0000 180.0000  0.00000000  ...`
  //   这条行**长度 69、校验位正确、全部是数字**，看起来完全正常；
  //   但平均运动为 0 = 轨道周期无穷 = SGP4 直接除零得到 Infinity/NaN。
  //   它与"NaN 写进 TLE"是同一种静默污染，只是更隐蔽（日志里一切都是数字）。
  //   取舍：在**生成时**就拒绝（抛错 → 上游把这颗算作失败并记账），
  //     而不是等 tleHealth 事后剔行 —— 早失败能保住"这颗星为什么没了"的因果链。
  if (!l2InRange(Number(o.INCLINATION), Number(o.RAAN), Number(o.ECCENTRICITY),
    Number(o.ARG_OF_PERICENTER), Number(o.MEAN_ANOMALY), Number(o.MEAN_MOTION))) {
    throw new Error('tleFromOmm: 轨道要素超出物理区间（inc=' + o.INCLINATION + ' raan=' + o.RAAN +
      ' ecc=' + o.ECCENTRICITY + ' argp=' + o.ARG_OF_PERICENTER + ' ma=' + o.MEAN_ANOMALY +
      ' mm=' + o.MEAN_MOTION + '）—— 见 l2InRange 的区间说明');
  }
  const cn = placeholder || '00000';
  const yy = String(o.EPOCH_Y2).padStart(2, '0');
  const doy = Number(o.EPOCH_DOY).toFixed(8).padStart(12, '0');
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
  // ★★ V1.9.9.630：**定宽形状闸门**（兜住整类"某列长出第 70 列"的事故）。
  //   为什么放在最后统一查、而不是逐列写长度：本模块已经出过两次同源事故 ——
  //     ① V1.9.1 的 `cosparField` 对 9 字符 OBJECT_ID 直接 padEnd(8) → L1 变 70 列；
  //     ② V1.9.9.630 的历元 NaN → L1 变 70 列（见上方注释）。
  //   两次都是"某一列的格式化函数产出比列宽更长/更短的字符串"，而 `padStart/padEnd`
  //   **只补不截**，多出来的部分就顶到下一列去。逐列写长度只能防住已知的那几列；
  //   这里统一断言"整行必须正好 69 列且末位校验位自洽"，将来再加列也躲不过去。
  //   同时排除字面 "NaN"/"undefined" 落进正文（`String(NaN)` 的经典陷阱）。
  const l1Out = l1 + tleChecksum(l1);
  const l2Out = l2 + tleChecksum(l2);
  if (l1Out.length !== 69 || l2Out.length !== 69) {
    throw new Error('tleFromOmm: 产出的行不是 69 列（L1=' + l1Out.length + ' L2=' + l2Out.length +
      '）—— 某列格式化后长度越界会让后续所有列错位。L1=' + JSON.stringify(l1Out));
  }
  if (/NaN|undefined|null/.test(l1Out) || /NaN|undefined|null/.test(l2Out)) {
    throw new Error('tleFromOmm: 产出含字面 NaN/undefined —— 拒绝让它落盘（会静默污染数据源）');
  }
  return [l1Out, l2Out];   // 末位已是真正的校验位
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
      // ★ V1.9.1（1.4）：**补上 nddot（第 45–52 列）的比较**。
      //   旧版只比了 ndot / BSTAR / 元素集号，**漏了 nddot** —— 于是 nddot 列的任何
      //   文本不一致都看不见（假阴性）。实测正是这里放过了 `00000+0` vs `00000-0`
      //   （198 颗卫星的 nddot 都是 0，写法却与我们生成的不同，一直没报）。
      //   教训：逐字段自检必须**列全所有字段**，少比一列就等于给那一列开了免检通道。
      const d1 = near(l1.slice(18, 32), a1.slice(18, 32), 1e-8) &&
        near(l1.slice(33, 43), a1.slice(33, 43), 1e-9) &&
        l1.slice(44, 52) === a1.slice(44, 52) &&
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
  // ★ V1.9.3：`tleEpochMs` 的自检 —— **必须打真实函数**（不能像上次那样在验证脚本里另写一份）。
  //   这几条一起守住三件事：① 单位是毫秒（不是 YYDDD 数值）；② 世纪约定正确；
  //   ③ 与真实 TLE 文件对得上（拿库里的 L1 解析，结果必须落在"近五年内"）。
  const epChecks = [];
  const ep = (name, got, want) => epChecks.push({ name, ok: Math.abs(got - want) < 1000, got, want });
  // 2026 年第 282.76458782 天 = 2026-10-09 18:21 UTC（实测本机 ct_hulianwang.tle 的最新历元）
  ep('2026 年第 282.76 天 → 2026-10-09T18:21Z',
    tleEpochMs('1 57288U 23095A   26282.76458782  .00000061  00000+0  85656-4 0  9996'),
    Date.UTC(2026, 9, 9, 18, 21, 1));
  // 世纪约定：57 起算 19xx，56 及以下算 20xx
  ep('99 → 1999', tleEpochMs('1 00001U 58001A   99001.00000000  .00000000  00000+0  00000+0 0  0000'), Date.UTC(1999, 0, 1));
  ep('00 → 2000', tleEpochMs('1 00001U 58001A   00001.00000000  .00000000  00000+0  00000+0 0  0000'), Date.UTC(2000, 0, 1));
  ep('56 → 2056', tleEpochMs('1 00001U 58001A   56001.00000000  .00000000  00000+0  00000+0 0  0000'), Date.UTC(2056, 0, 1));
  ep('57 → 1957', tleEpochMs('1 00001U 58001A   57001.00000000  .00000000  00000+0  00000+0 0  0000'), Date.UTC(1957, 0, 1));
  const epBad = epChecks.filter(c => !c.ok);
  console.log('历元解析自检 =', epChecks.length, '条｜失败 =', epBad.length);
  epBad.forEach(c => console.log('  FAIL', c.name, '得到', new Date(c.got).toISOString(), '期望', new Date(c.want).toISOString()));

  // 真实 TLE 抽样：解析出的历元必须落在"近五年内"（否则说明单位或列偏移错了）
  let epReal = 0, epStale = 0, epMax = 0;
  for (const f of ['data/ct_hulianwang.tle', 'data/ct_qianfan.tle']) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    for (const ln of fs.readFileSync(p, 'utf8').split('\n')) {
      if (!/^1 /.test(ln)) continue;
      const ms = tleEpochMs(ln);
      epReal++;
      if (ms > epMax) epMax = ms;
      if (Date.now() - ms > 5 * 365 * 86400000) epStale++;
    }
  }
  const realOk = epReal > 0 && epStale === 0;
  console.log('真实 TLE 历元抽样 =', epReal, '行｜超出五年窗口 =', epStale,
    '｜最新 =', epMax ? new Date(epMax).toISOString().slice(0, 16) + 'Z' : '(无)', realOk ? '✓' : '✗');

  const r = ommRoundTrip([path.join(ROOT, 'data/ct_hulianwang.tle'), path.join(ROOT, 'data/ct_qianfan.tle')]);
  console.log('自检样本数 =', r.n, '｜往返失败 =', r.badN);
  r.bad.forEach(b => {
    console.log('  原 L1:', JSON.stringify(b.l1));
    console.log('  转 L1:', JSON.stringify(b.a1));
    console.log('  原 L2:', JSON.stringify(b.l2));
    console.log('  转 L2:', JSON.stringify(b.a2));
  });
  process.exit((r.badN || epBad.length || !realOk) ? 1 : 0);
}
