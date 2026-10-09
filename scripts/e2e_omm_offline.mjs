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

const SRC = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cistrack-e2e-omm-'));

// ---------- 搭一个最小可跑的项目副本 ----------
fs.copyFileSync(path.join(SRC, 'refresh.mjs'), path.join(TMP, 'refresh.mjs'));
fs.mkdirSync(path.join(TMP, 'scripts'), { recursive: true });
for (const f of fs.readdirSync(path.join(SRC, 'scripts'))) {
  if (f.endsWith('.mjs')) fs.copyFileSync(path.join(SRC, 'scripts', f), path.join(TMP, 'scripts', f));
}
fs.mkdirSync(path.join(TMP, 'data', 'history'), { recursive: true });
for (const f of ['ct_hulianwang.tle', 'ct_qianfan.tle', 'satcat.csv']) {
  const p = path.join(SRC, 'data', f);
  if (!fs.existsSync(p)) { console.error('缺少 ' + p + '（需要先跑过一次 refresh.mjs）'); process.exit(2); }
  fs.copyFileSync(p, path.join(TMP, 'data', f));
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
ok('③ omm 映射条数 ≥50，且 value 都是 ≥6 位真号',
  Object.keys(ommMap).length >= 50 && Object.values(ommMap).every(v => String(v).length >= 6),
  Object.keys(ommMap).length + ' 条：' + Object.entries(ommMap).slice(0, 3).map(([k, v]) => k + '→' + v).join(' '));

for (const f of ['ct_hulianwang.tle', 'ct_qianfan.tle']) {
  const L = fs.readFileSync(path.join(TMP, 'data', f), 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
  let bad = 0, n = 0;
  for (let i = 0; i + 2 < L.length; i += 3) {
    if (!/^1 /.test(L[i + 1])) continue;
    n++;
    if (L[i + 1].length !== 69 || L[i + 2].length !== 69) bad++;
  }
  ok('④ ' + f + ' 全部 ' + n + ' 颗都是 69 列定宽（0 行异常）', bad === 0, bad + ' 行异常');
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
