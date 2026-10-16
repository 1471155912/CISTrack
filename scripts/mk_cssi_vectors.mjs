/* mk_cssi_vectors.mjs —— ★ V1.9.5（H30①）：把 CSSI 官方 SGP4 验证用例派生为回归数据
 * ---------------------------------------------------------------------------
 * 为什么需要它
 *   本项目的轨道推算完全靠 satellite.js（MIT）这一条外部依赖。它一旦在某次升级/替换中
 *   出现回归，页面上的卫星位置会**整体偏掉**，而现有的所有闸门都看不出来 ——
 *   smoke 的断言只检查"结构/量级/单调"，不检查"数值对不对"。
 *   官方验证用例（CSSI / Spacetrack Report #3）正是"数值对不对"的唯一权威标尺：
 *   33 个场景覆盖近地/深空/共振/高偏心/衰减/错误码等，并给出每个时刻的位置与速度。
 *
 * 数据来源（**原样不改**，逐字节保留）
 *   data/cssi/SGP4-VER.TLE   —— 官方输入（TLE + 每台星的时间表 start/stop/step，分钟）
 *   data/cssi/tcppver.out    —— 官方期望输出（参考实现按时间表打印的位置/速度）
 *   获取途径：PyPI 上 `sgp4`（brandon-rhodes/python-sgp4，MIT）的 sdist 内直接附带这两份
 *   官方文件（**未修改的原文**）。校验：`sha256sum` 记录在生成结果的 meta.sourceSha256 里，
 *   重新生成时可复核。
 *
 * 派生规则（与参考实现 python-sgp4 的 tests.py 逐条对齐，不另立标准）
 *   · 时刻表：[0] + tstart..tend 每 tstep 一条；**仅当 tstart == 0 时**跳过重复的 0；
 *     末尾若 `t - tend < tstep - 1e-6` 再补一条 tend（"do not miss last line"）。
 *   · 官方文件在参考实现**报错处会截断**（如 33333/33334 是专门的错误码用例）——
 *     这些块的最后一条之后的时间点记入 `abortAt`（信息性），**不编造期望值**。
 *   · 输出为**确定性**的（同一输入必得同一字节），不带生成时间戳 → 重新生成不产生 diff。
 *
 * 用法：node scripts/mk_cssi_vectors.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC_TLE = path.join(ROOT, 'data', 'cssi', 'SGP4-VER.TLE');
const SRC_OUT = path.join(ROOT, 'data', 'cssi', 'tcppver.out');
const DEST = path.join(ROOT, 'data', 'cssi-testcases.json');

/** 参考实现对同样这 7 列的容差（python-sgp4 tests.py：`error = 2e-7`）。
 *  单位与各列一致：t 分钟、位置 km、速度 km/s。**不自造**。 */
export const TOL = 2e-7;

const sha256 = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

/** ★ 纯函数入口：派生出完整数据对象（**不写盘**）—— smoke 直接 import 它与已提交的
 *  `data/cssi-testcases.json` 做**逐字节对拍**，保证"派生物"与"原始官方案例"永远一致
 *  （本项目既有做法：验证要打到真实代码路径，不能另写一份实现）。 */
export function build() {
// ---------------------------------------------------------------- ① 输入侧
const tleLines = fs.readFileSync(SRC_TLE, 'utf8').split(/\r?\n/);
const blocks = [];
for (let i = 0; i < tleLines.length; i++) {
  if (!tleLines[i].startsWith('1 ')) continue;
  const l1 = tleLines[i].slice(0, 69);
  const raw2 = tleLines[i + 1] || '';
  if (!raw2.startsWith('2 ')) throw new Error('第 ' + (i + 2) + ' 行不是 TLE 第 2 行：' + raw2.slice(0, 20));
  const tail = raw2.slice(69).trim().split(/\s+/).map(Number);
  if (tail.length !== 3 || tail.some(n => !Number.isFinite(n))) {
    throw new Error('第 ' + (i + 2) + ' 行的时间表字段异常：' + JSON.stringify(raw2.slice(69)));
  }
  blocks.push({
    norad: parseInt(l1.slice(2, 7), 10), l1, l2: raw2.slice(0, 69),
    tstart: tail[0], tend: tail[1], tstep: tail[2],
  });
}
if (!blocks.length) throw new Error('没有解析出任何用例块');

// ---------------------------------------------------------------- ② 期望侧
const outLines = fs.readFileSync(SRC_OUT, 'utf8').split(/\r?\n/);
const expected = [];
let cur = null;
outLines.forEach((L, i) => {
  if (!L.trim()) return;
  if (/^\s*\d+\s+xx\s*$/.test(L)) { cur = { norad: parseInt(L.trim(), 10), rows: [] }; expected.push(cur); return; }
  if (!cur) throw new Error('第 ' + (i + 1) + ' 行出现在任何块头之前：' + L.slice(0, 40));
  const f = L.trim().split(/\s+/);
  if (f.length < 7) throw new Error('第 ' + (i + 1) + ' 行字段不足 7：' + L.slice(0, 40));
  const nums = f.slice(0, 7).map(Number);
  if (nums.some(n => !Number.isFinite(n))) throw new Error('第 ' + (i + 1) + ' 行存在非数值：' + L.slice(0, 60));
  cur.rows.push({ t: nums[0], r: nums.slice(1, 4), v: nums.slice(4, 7), lineNo: i + 1 });
});

// ---------------------------------------------------------------- ③ 对齐 + 派生
if (expected.length !== blocks.length) {
  throw new Error('块数不一致：输入 ' + blocks.length + ' / 期望 ' + expected.length);
}
/** 时刻表（与 python-sgp4 generate_satellite_output 同款规则） */
function schedule(tstart, tend, tstep) {
  const s = [0.0];
  let t = tstart;
  let guard = 0;
  while (t <= tend + 1e-9) {
    if (!(tstart === 0.0 && t === 0.0)) s.push(+t.toFixed(8));   // 跳过与首行重复的 0
    t += tstep;
    if (++guard > 200000) throw new Error('时刻表不收敛：' + [tstart, tend, tstep].join('/'));
  }
  if (t - tend < tstep - 1e-6) s.push(+tend.toFixed(8));          // 别漏了最后一条
  return s;
}

const satellites = [];
const cases = [];
let nAbort = 0;
blocks.forEach((b, bi) => {
  const e = expected[bi];
  if (e.norad !== b.norad) throw new Error('第 ' + bi + ' 块卫星号不一致：' + b.norad + ' vs ' + e.norad);
  const sched = schedule(b.tstart, b.tend, b.tstep);
  const n = Math.min(e.rows.length, sched.length);
  // 时刻必须逐条对齐 —— 不对齐说明我理解错了官方文件的排版，宁可报错也不猜
  for (let i = 0; i < n; i++) {
    if (Math.abs(e.rows[i].t - sched[i]) > 1e-6) {
      throw new Error('第 ' + bi + ' 块（' + b.norad + '）第 ' + i + ' 条时刻不对齐：' +
        e.rows[i].t + ' vs 期望 ' + sched[i] + '（行 ' + e.rows[i].lineNo + '）');
    }
  }
  const abortAt = e.rows.length < sched.length ? sched[e.rows.length] : null;
  if (abortAt !== null) nAbort++;

  satellites.push({
    norad: b.norad, l1: b.l1, l2: b.l2, nCases: n,
    range: [b.tstart, b.tend, b.tstep],
    ...(abortAt !== null ? { abortAt, abortNote: '参考实现在此报错中止，官方文件无此后的期望值（不编造）' } : {}),
  });
  for (let i = 0; i < n; i++) cases.push({ s: b.norad, t: e.rows[i].t, r: e.rows[i].r, v: e.rows[i].v });
});

const data = {
  meta: {
    title: 'CSSI / Spacetrack Report #3 官方 SGP4 验证用例（派生自官方原始文件，未改写数值）',
    why: 'satellite.js 是本项目唯一的轨道推算依赖；这组用例是"数值对不对"的权威标尺（原有闸门只查结构/量级）。',
    sourceFiles: ['data/cssi/SGP4-VER.TLE', 'data/cssi/tcppver.out'],
    provenance: 'PyPI `sgp4`(brandon-rhodes/python-sgp4, MIT) sdist 内附带的两份**未修改**官方文件' +
      '（sha256 见本文件 meta，可复核）',
    sourceSha256: { 'SGP4-VER.TLE': sha256(SRC_TLE), 'tcppver.out': sha256(SRC_OUT) },
    tolerance: TOL,
    toleranceNote: '参考实现 python-sgp4 对同样 7 列的容差（tests.py `error = 2e-7`），单位随列：min / km / km·s⁻¹',
    units: { t: 'min（相对 TLE 历元）', r: 'km（TEME）', v: 'km/s（TEME）' },
    schedule: '每台星 = [0] + tstart..tend 步进 tstep（tstart==0 时跳过重复的 0；末尾补 tend）',
    generated: 'deterministic（无时间戳，同输入必同输出）',
  },
  stats: { satellites: satellites.length, cases: cases.length, aborted: nAbort },
  satellites,
  cases,
};
return data;
}

/** 序列化（与写盘完全同款）—— smoke 用它做"逐字节对拍" */
export function serialize(data) {
  return JSON.stringify(data, null, 1) + '\n';
}

// ---------------------------------------------------------------- ④ 直跑才写盘
const DIRECT = process.argv[1] && /mk_cssi_vectors\.mjs$/.test(process.argv[1].replace(/\\/g, '/'));
if (DIRECT) {
  const data = build();
  fs.writeFileSync(DEST, serialize(data), 'utf8');
  const kb = (fs.statSync(DEST).size / 1024).toFixed(1);
  console.log('✓ ' + path.relative(ROOT, DEST).replace(/\\/g, '/') + '：' +
    data.stats.satellites + ' 台星 / ' + data.stats.cases + ' 条用例 / ' + data.stats.aborted +
    ' 块中止（无期望值）/ ' + kb + ' KB');
  console.log('  容差 = ' + TOL + '（参考实现同款）；源文件 sha256 已写入 meta');
}
