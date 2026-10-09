/* e2e_omm_offline.mjs —— 6 位编目号通路的**端到端离线测试**（V1.9.1 新增）
 * ---------------------------------------------------------------------------
 * 为什么需要它：
 *   V1.9.1 发现"55 颗在编卫星整批消失"，根因在 refresh.mjs 的采集通路（6 位编目号）。
 *   smoke.mjs 的自检只覆盖**纯函数**；本脚本把**整个 refresh.mjs** 真跑一遍，
 *   但把 fetch 换成"按 satcat 现场合成 OMM"的桩 → **完全离线、可重复、不碰真数据**。
 *
 * 做法：把 refresh.mjs / scripts/ / data(ct_*.tle + satcat.csv) 复制到系统临时目录 →
 *   用 `--import <stub>` 预载桩（替换 globalThis.fetch）→ 跑 `node refresh.mjs` → 断言产物。
 *
 * 用法：node scripts/e2e_omm_offline.mjs      （在项目根运行）
 * 退出码 0 = 全绿。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
// 复用纯函数模块做"数值列体检"断言（零副作用，不触发任何刷新）
import { tleHealth } from './omm.mjs';

const SRC = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cistrack-e2e-omm-'));

// ---------- 搭一个最小可跑的项目副本 ----------
fs.copyFileSync(path.join(SRC, 'refresh.mjs'), path.join(TMP, 'refresh.mjs'));
fs.mkdirSync(path.join(TMP, 'scripts'), { recursive: true });
for (const f of fs.readdirSync(path.join(SRC, 'scripts'))) {
  if (f.endsWith('.mjs')) fs.copyFileSync(path.join(SRC, 'scripts', f), path.join(TMP, 'scripts', f));
}
fs.mkdirSync(path.join(TMP, 'data', 'history'), { recursive: true });
/* ★ 起点设计（两个星座故意不同，覆盖两种"病态"起点）：
 *   gw：**剥离**全部占位号条目（NORAD < 1000）→ 模拟"修复前"（55 颗整批缺失）。
 *   qf：**保留**占位号条目，但把 L2 的 RAAN 列改写成字符串 "NaN" → 模拟
 *       "旧代码产出的坏数据已经落盘"。这条专门验证**自愈能力**：
 *       旧版 refresh 的 merged 是以上一轮 .tle 为起点、S5 又"键已存在就跳过"，
 *       于是坏行**永久滞留**（刷新一百次也修不好）。V1.9.1 的入口体检会剔除坏行 → S5 重取。
 *   本星座真实卫星的 NORAD 都是 5 位数且远大于 1000；占位号 = 6 位真号的后 5 位 → 必 < 1000。
 */
const badSeed = { gw: 0, qf: 0 };
for (const [f, key] of [['ct_hulianwang.tle', 'gw'], ['ct_qianfan.tle', 'qf']]) {
  const p = path.join(SRC, 'data', f);
  if (!fs.existsSync(p)) { console.error('缺少 ' + p + '（需要先跑过一次 refresh.mjs）'); process.exit(2); }
  const lines = fs.readFileSync(p, 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
  const keep = [];
  for (let i = 0; i + 2 < lines.length; i += 3) {
    const l1 = lines[i + 1], l2 = lines[i + 2];
    if (!/^1 /.test(l1)) continue;
    const isPh = parseInt(l1.slice(2, 7), 10) < 1000;
    if (key === 'gw') { if (isPh) continue; keep.push(lines[i], l1, l2); }
    else {
      if (isPh && l2.length >= 25) { badSeed.qf++; keep.push(lines[i], l1, l2.slice(0, 17) + '     NaN' + l2.slice(25)); }
      else keep.push(lines[i], l1, l2);
    }
  }
  fs.writeFileSync(path.join(TMP, 'data', f), keep.join('\n') + '\n');
  console.log('（起点 ' + f + ' = ' + keep.length / 3 + ' 颗' +
    (key === 'gw' ? '，已剥离占位号条目 —— 模拟修复前' : '，含 ' + badSeed.qf + ' 条 NaN 坏行 —— 模拟坏数据已落盘') + '）');
}
{
  const p = path.join(SRC, 'data', 'satcat.csv');
  if (!fs.existsSync(p)) { console.error('缺少 ' + p + '（需要先跑过一次 refresh.mjs）'); process.exit(2); }
  fs.copyFileSync(p, path.join(TMP, 'data', 'satcat.csv'));
}
fs.writeFileSync(path.join(TMP, 'data', 'omm_norad.json'), '{}');

// ---------- 跑 refresh（**同进程 import**：起子进程在本机会偶发 EBUSY，不可靠） ----------
//   refresh.mjs 是顶层带副作用的脚本 —— 这里正是要"跑它"，所以直接 import 执行；
//   它的 ROOT 由 import.meta.url 推导，因此会老老实实操作我们这个临时副本。
const rows = fs.readFileSync(path.join(TMP, 'data', 'satcat.csv'), 'utf8').split('\n');
const head = rows[0].split(','); const ix = n => head.indexOf(n);
const iNo = ix('NORAD_CAT_ID'), iId = ix('OBJECT_ID'), iNm = ix('OBJECT_NAME'),
  iPer = ix('PERIOD'), iInc = ix('INCLINATION'), iApo = ix('APOGEE'), iPeg = ix('PERIGEE');
const byNorad = new Map();
rows.slice(1).forEach(l => { if (!l) return; const c = l.split(','); const n = +c[iNo]; if (n) byNorad.set(n, c); });
function synthOmm(norad) {
  const c = byNorad.get(norad); if (!c) return null;
  const per = +c[iPer], inc = +c[iInc], apo = +c[iApo], peg = +c[iPeg];
  if (!(per > 0)) return null;
  const a = (apo + peg) / 2 + 6378.137;
  return { OBJECT_NAME: c[iNm], OBJECT_ID: c[iId], EPOCH: new Date().toISOString(),
    MEAN_MOTION: 1440 / per, ECCENTRICITY: Math.max(0, (apo - peg) / (2 * a)), INCLINATION: inc,
    RA_OF_ASC_NODE: 10, ARG_OF_PERICENTER: 20, MEAN_ANOMALY: 30,
    EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: 'U', NORAD_CAT_ID: norad,
    ELEMENT_SET_NO: 999, REV_AT_EPOCH: 100, BSTAR: 0.00005, MEAN_MOTION_DOT: 1e-7, MEAN_MOTION_DDOT: 0 };
}
const realFetch = globalThis.fetch;
let log = '';
{
  const ol = console.log;
  console.log = (...a) => { log += a.join(' ') + '\n'; ol(...a); };
  globalThis.fetch = async function (url) {
    const u = String(url);
    const R = (s, t) => ({ ok: s === 200, status: s, text: async () => t });
    if (u.includes('pub/satcat.csv')) return R(200, rows.join('\n'));
    if (u.includes('tle.ivanstanojevic.me')) return R(404, '');
    const mCat = u.match(/CATNR=(\d+)/);
    if (mCat) {
      const n = +mCat[1];
      // 真实行为：编目号 >5 位的 FORMAT=tle 一律 "No GP data found"
      if (/FORMAT=tle/i.test(u)) return R(200, String(n).length > 5 ? 'No GP data found' : '');
      const o = synthOmm(n);
      return o ? R(200, JSON.stringify([o])) : R(200, 'No GP data found');
    }
    if (/GROUP=|NAME=/.test(u)) return R(200, '');   // 模拟 S1/S2 也拿不到（最坏情况）
    return R(404, '');
  };
  try {
    await import('file:///' + path.join(TMP, 'refresh.mjs').replace(/\\/g, '/'));
  } catch (e) {
    console.error('refresh 执行失败：' + (e && e.stack || e));
    process.exit(1);
  } finally {
    globalThis.fetch = realFetch;
    console.log = ol;
  }
}

// ---------- 断言 ----------
const fails = [];
const ok = (n, c, e) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (e !== undefined ? '  → ' + e : '')); if (!c) fails.push(n); };
const PH = (n) => String(n).slice(-5).padStart(5, '0');

const s5sum = (log.match(/补到 (\d+) 颗/g) || []).reduce((a, s) => a + parseInt(/(\d+)/.exec(s)[1], 10), 0);
ok('① S5 有产出：两星座合计补到 ≥50 颗（本次 ' + s5sum + ' 颗）', s5sum >= 50,
  (log.match(/S5 OMM[^\n]*/g) || []).join(' / '));
ok('② 报告口径正确：两个星座都"仍缺轨道要素 0 颗"',
  (log.match(/仍缺轨道要素 0 颗/g) || []).length === 2,
  (log.match(/最终[^\n]*/g) || []).join(' / '));

const ommMap = JSON.parse(fs.readFileSync(path.join(TMP, 'data', 'omm_norad.json'), 'utf8'));
// 映射表的语义 = "占位号 → 真号"，所以**只有 6 位号对象才该有条目**。
// V1.9.1（1.4）起 S5 同时是全量兜底通路（也处理 ≤5 位号），曾一度把 `44785→44785`
// 这类自映射也记进来（统计失真）→ refresh 已改为只记真号位数 > 5 的。
const six = Object.entries(ommMap).filter(([k, v]) => String(v).length >= 6);
ok('③ omm 映射 ≥50 条（全是"占位号 → 6 位真号"，无 ≤5 位号的自映射）',
  six.length >= 50 && six.length === Object.keys(ommMap).length &&
  six.every(([k, v]) => Number(v) > 99999 && k === String(v).slice(-5).padStart(5, '0')),
  six.length + ' 条 6 位号映射 / 总 ' + Object.keys(ommMap).length + ' 条：' +
  six.slice(0, 3).map(([k, v]) => k + '→' + v).join(' '));

for (const f of ['ct_hulianwang.tle', 'ct_qianfan.tle']) {
  const L = fs.readFileSync(path.join(TMP, 'data', f), 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
  let bad = 0, n = 0, nan = 0;
  for (let i = 0; i + 2 < L.length; i += 3) {
    if (!/^1 /.test(L[i + 1])) continue;
    n++;
    if (L[i + 1].length !== 69 || L[i + 2].length !== 69) bad++;
    // ★ 长度正确 ≠ 内容正确：(NaN).toFixed(4) = "NaN" 也是 8 列，总长照样 69。
    //   这正是 RAAN 字段名写错那个 bug 能躲过所有"长度/正则"校验的原因 → 必须盯值。
    if (!tleHealth(L[i + 2]) || /NaN/.test(L[i + 2])) nan++;
  }
  ok('④ ' + f + ' 全部 ' + n + ' 颗都是 69 列定宽（0 行异常）', bad === 0, bad + ' 行异常');
  ok('④b ' + f + ' 数值列无 NaN/非法值（0 行坏数据）', nan === 0, nan + ' 行坏数据');
}

// ⑥ ★ 自愈：起点注入的坏行必须被修掉（这验证的正是"坏数据不会永久滞留"）
{
  const L = fs.readFileSync(path.join(TMP, 'data', 'ct_qianfan.tle'), 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
  const phLines = [];
  for (let i = 0; i + 2 < L.length; i += 3) {
    if (!/^1 /.test(L[i + 1])) continue;
    if (parseInt(L[i + 1].slice(2, 7), 10) < 1000) phLines.push(L[i + 2]);
  }
  // synthOmm 里 RA_OF_ASC_NODE 固定为 10 → 修好之后该列必然是 "10.0000"
  const fixed = phLines.filter(l => l.slice(17, 25) === 10..toFixed(4).padStart(8));
  ok('⑥ 起点注入的 ' + badSeed.qf + ' 条 NaN 坏行已被自愈（占位号条目重取后 RAAN = 10.0000）',
    badSeed.qf > 0 && phLines.length >= badSeed.qf && fixed.length >= badSeed.qf,
    '占位号条目 ' + phLines.length + ' 条，其中 RAAN 已修正 ' + fixed.length + ' 条');
  ok('⑥b refresh 日志明确报出了"坏行"（可观测性：不静默）',
    /坏行/.test(log) && /已剔除/.test(log),
    (log.match(/⚠️[^\n]*坏行[^\n]*/g) || []).join(' / '));
}

// ⑤ 历史库必须存**真号**（占位号会让曲线静默空白）
const histDir = path.join(TMP, 'data', 'history');
const hf = fs.readdirSync(histDir).filter(x => x.endsWith('.json'));
const withSix = hf.filter(x => {
  const recs = JSON.parse(fs.readFileSync(path.join(histDir, x), 'utf8'));
  const arr = Array.isArray(recs) ? recs : (recs.records || []);
  return arr.some(r => r[0] >= 100000);
});
ok('⑤ 历史库里出现 ≥100000 的**真号**（确认没有把占位号入档）', withSix.length > 0,
  withSix.length + ' 个分片含真号，例如 ' + withSix.slice(0, 3).join(','));

console.log('\n端到端结论：' + (fails.length ? '失败 ' + fails.length + ' 项' : '全部通过'));
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
process.exit(fails.length ? 1 : 0);
