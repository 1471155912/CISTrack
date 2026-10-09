/* e2e_include_offline.mjs —— "按批次点名纳入"通路的端到端离线测试（V1.9.1 / 1.4）
 * ---------------------------------------------------------------------------
 * 为什么需要它：
 *   1.4 要补的那批卫星（CX-19/20/26、KL-Alpha/Beta、DTC-01、GEO 高轨三颗 等）的 satcat 名字
 *   **完全不含星座关键字**，只能按 COSPAR 批次点名纳入。而名字正则分布在 refresh.mjs 的
 *   **两处**（构建 catByPrefix 时 / 最终 out 过滤时）—— 漏改任一处都会出现
 *   "查到了却被丢掉"或"没查却留下了"的诡异现象，且**本机到 celestrak.org 不通**、无法真跑验证。
 *   所以用离线桩把整条 refresh 跑一遍。
 *
 * 做法：与 e2e_omm_offline.mjs 同款 —— 把 refresh/scripts/data 复制到临时目录 → 同进程 import
 *   （本机从 Node 内 spawn 同一 node.exe 会 EBUSY）→ 用合成 fetch 桩 → 断言产物。
 *   桩的行为：GROUP=/NAME= 一律空（模拟"名字路径拿不到"）；CATNR=+FORMAT=tle 用 satcat 的
 *   PERIOD/INCLINATION/APOGEE/PERIGEE 合成一份合法 TLE（经 scripts/omm.mjs 的 tleFromOmm 生成，
 *   保证 69 列 + 校验位正确）。
 *
 * 用法：node scripts/e2e_include_offline.mjs     退出码 0 = 全绿
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { tleFromOmm } from './omm.mjs';

const SRC = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cistrack-e2e-inc-'));

// ---------- 搭最小可跑副本 ----------
fs.copyFileSync(path.join(SRC, 'refresh.mjs'), path.join(TMP, 'refresh.mjs'));
fs.mkdirSync(path.join(TMP, 'scripts'), { recursive: true });
for (const f of fs.readdirSync(path.join(SRC, 'scripts'))) {
  if (f.endsWith('.mjs')) fs.copyFileSync(path.join(SRC, 'scripts', f), path.join(TMP, 'scripts', f));
}
fs.mkdirSync(path.join(TMP, 'data', 'history'), { recursive: true });
// 起点：把两个 .tle 清空（模拟"这批卫星一颗都没有"），只保留 satcat
for (const f of ['ct_hulianwang.tle', 'ct_qianfan.tle']) fs.writeFileSync(path.join(TMP, 'data', f), '');
{
  const p = path.join(SRC, 'data', 'satcat.csv');
  if (!fs.existsSync(p)) { console.error('缺少 ' + p + '（需要先跑过一次 refresh.mjs）'); process.exit(2); }
  fs.copyFileSync(p, path.join(TMP, 'data', 'satcat.csv'));
}
fs.writeFileSync(path.join(TMP, 'data', 'omm_norad.json'), '{}');

// ---------- 从 satcat 读行 ----------
const rows = fs.readFileSync(path.join(TMP, 'data', 'satcat.csv'), 'utf8').split('\n');
const head = rows[0].split(','); const ix = n => head.indexOf(n);
const iNo = ix('NORAD_CAT_ID'), iId = ix('OBJECT_ID'), iNm = ix('OBJECT_NAME'), iTy = ix('OBJECT_TYPE'),
  iDec = ix('DECAY_DATE'), iPer = ix('PERIOD'), iInc = ix('INCLINATION'),
  iApo = ix('APOGEE'), iPeg = ix('PERIGEE');
const byNorad = new Map();
rows.slice(1).forEach(l => { if (!l) return; const c = l.split(','); const n = +c[iNo]; if (n) byNorad.set(n, c); });

/** 用 satcat 的轨道参数合成一份合法 TLE（编目号用真号 —— 这些卫星都是 5 位号） */
function synthTle(norad) {
  const c = byNorad.get(norad); if (!c) return '';
  const per = +c[iPer], inc = +c[iInc], apo = +c[iApo], peg = +c[iPeg];
  if (!(per > 0) || !(inc >= 0)) return '';
  const a = (apo + peg) / 2 + 6378.137;
  const e = Math.max(0, Math.min(0.9, (apo - peg) / (2 * a)));
  const [l1, l2] = tleFromOmm({
    OBJECT_ID: (c[iId] || '').trim(), EPOCH_Y2: 26, EPOCH_DOY: 280.5,
    MEAN_MOTION_DOT: 0, MEAN_MOTION_DDOT: 0, BSTAR: 0, EPHEMERIS_TYPE: 0, ELEMENT_SET_NO: 999,
    INCLINATION: inc, RAAN: 10, ECCENTRICITY: e,
    ARG_OF_PERICENTER: 20, MEAN_ANOMALY: 30, MEAN_MOTION: 1440 / per, REV_AT_EPOCH: 100
  }, String(norad).padStart(5, '0'));
  return (c[iNm] || '').trim() + '\n' + l1 + '\n' + l2 + '\n';
}

/** 同款的 OMM 形态（真实 CelesTrak 的 FORMAT=json 也能取到，故两条通路都模拟） */
function synthOmm(norad) {
  const c = byNorad.get(norad); if (!c) return null;
  const per = +c[iPer], inc = +c[iInc], apo = +c[iApo], peg = +c[iPeg];
  if (!(per > 0) || !(inc >= 0)) return null;
  const a = (apo + peg) / 2 + 6378.137;
  return {
    OBJECT_NAME: (c[iNm] || '').trim(), OBJECT_ID: (c[iId] || '').trim(),
    EPOCH: new Date().toISOString(), MEAN_MOTION: 1440 / per,
    ECCENTRICITY: Math.max(0, Math.min(0.9, (apo - peg) / (2 * a))), INCLINATION: inc,
    RA_OF_ASC_NODE: 10, ARG_OF_PERICENTER: 20, MEAN_ANOMALY: 30,
    EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: 'U', NORAD_CAT_ID: norad,
    ELEMENT_SET_NO: 999, REV_AT_EPOCH: 100, BSTAR: 0.00005,
    MEAN_MOTION_DOT: 1e-7, MEAN_MOTION_DDOT: 0
  };
}

// ---------- 跑 refresh（同进程 import） ----------
const realFetch = globalThis.fetch;
let log = '';
let catHits = 0;   // 桩被"点名"查询的白名单 NORAD 集合
const asked = new Set();
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
      asked.add(n);
      if (/FORMAT=tle/i.test(u)) return R(200, String(n).length > 5 ? 'No GP data found' : synthTle(n));
      // FORMAT=json（OMM）——真实上游两条通路都能用，所以这里都模拟，
      //   这样即便某一条通路写错了（S3 的 /^1 / 就错过一次），另一条也能兜住并被断言发现。
      const om = synthOmm(n);
      return R(200, om ? JSON.stringify([om]) : 'No GP data found');
    }
    if (/GROUP=|NAME=/.test(u)) return R(200, '');   // 模拟"名字路径完全拿不到"
    return R(404, '');
  };
  try {
    await import('file:///' + path.join(TMP, 'refresh.mjs').replace(/\\/g, '/'));
  } catch (e) {
    console.error('refresh 执行失败：' + (e && e.stack || e));
    process.exit(1);
  } finally { globalThis.fetch = realFetch; console.log = ol; }
}

// ---------- 断言 ----------
const fails = [];
const ok = (n, c, e) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (e !== undefined ? '  → ' + e : '')); if (!c) fails.push(n); };

// 1.4 的名册：批次 → { 应纳入的 NORAD, 必须排除的 NORAD }
const WANT = {
  gw: [
    { lk: '23181', in: [58425, 58426, 58427], out: [], name: 'CX-20A/B/C（星网倾斜轨道试验星02组）' },
    { lk: '23190', in: [58505], out: [], name: 'CX-19（试验星03）' },
    { lk: '24226', in: [62186], out: [62185], name: 'CX 试验星（CZ-12 Y1）—— 226A 是搭车星' },
    { lk: '26158', in: [69972], out: [], name: 'CX-26' },
    { lk: '24040', in: [59069], out: [], name: '高轨业务星01（GEO）' },
    { lk: '24135', in: [60327], out: [], name: '高轨业务星02（GEO）' },
    { lk: '24181', in: [61503], out: [], name: '高轨业务星03（GEO）' }
  ],
  qf: [
    { lk: '19077', in: [44785, 44786], out: [], name: 'KL-Alpha A/B' },
    { lk: '21070', in: [49059, 49060], out: [], name: 'KL-Beta A/B' },
    { lk: '26128', in: [69472], out: [69473], name: '千帆DTC-01 —— 128B 是中国移动02星' }
  ]
};

// 产物里"批次 → 该批的 NORAD 集合"
const prod = {};
for (const who of ['gw', 'qf']) {
  const f = who === 'gw' ? 'ct_hulianwang.tle' : 'ct_qianfan.tle';
  const L = fs.readFileSync(path.join(TMP, 'data', f), 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
  const m = new Map();
  for (let i = 0; i + 1 < L.length; i++) {
    const l1 = L[i], l2 = L[i + 1];
    if (!/^1 \d/.test(l1) || !/^2 \d/.test(l2)) continue;
    const norad = parseInt(l1.slice(2, 7), 10);
    const lk = l1.slice(9, 14).trim();
    if (!m.has(lk)) m.set(lk, []);
    m.get(lk).push({ norad: norad, l1: l1, l2: l2 });
    i++;
  }
  prod[who] = m;
}

let totalIn = 0, totalOut = 0;
for (const who of ['gw', 'qf']) {
  console.log('\n--- ' + who + ' ---');
  for (const w of WANT[who]) {
    const got = (prod[who].get(w.lk) || []).map(x => x.norad);
    const miss = w.in.filter(n => got.indexOf(n) < 0);
    const leak = w.out.filter(n => got.indexOf(n) >= 0);
    totalIn += w.in.length; totalOut += w.out.length;
    ok('纳入 ' + w.lk + '：' + w.name + '（应得 ' + w.in.length + ' 颗）',
      miss.length === 0 && leak.length === 0,
      '实得 ' + got.length + ' 颗 [' + got.join(',') + ']' +
      (miss.length ? ' ｜ 缺 ' + miss.join(',') : '') +
      (leak.length ? ' ｜ **误收搭车星** ' + leak.join(',') : ''));
    // 顺带查这两行是不是合法定宽（合成 TLE 的 69 列 + 校验位）
    const bad = (prod[who].get(w.lk) || []).filter(x => x.l1.length !== 69 || x.l2.length !== 69);
    ok('  └ ' + w.lk + ' 的行都是 69 列定宽', bad.length === 0, bad.length + ' 行异常');
  }
}

// 全局：不得把**非本星座**的对象收进来（这是白名单最大的风险）
{
  const all = [...prod.gw.values(), ...prod.qf.values()].flat().map(x => x.norad);
  ok('无关对象未被误收（白名单只放行点名的 14 颗，不是"整批照单全收"）',
    all.indexOf(25544) < 0 && all.indexOf(62185) < 0 && all.indexOf(69473) < 0,
    '样例 ISS25544=' + (all.indexOf(25544) >= 0) + ' 搭车62185=' + (all.indexOf(62185) >= 0) +
    ' 搭车69473=' + (all.indexOf(69473) >= 0));
  // ★ 同批的 R/B 必须被精确列表挡住（这是"整批全收"写法会踩的坑，测试实测抓到过：
  //   gw 命中数曾从 10 变 13，多出的正是 24040B / 24135B / 24181B 三个 R/B）
  const rbLeak = [59070, 60328, 61504, 58428, 58506, 58507].filter(n => all.indexOf(n) >= 0);
  ok('同批的 R/B 未被误收（GEO 三批各有一个 R/B 紧跟在业务星后面）',
    rbLeak.length === 0, rbLeak.length ? '误收 ' + rbLeak.join(',') : '0 个泄漏');
  ok('白名单实际被查询（说明走的是 S3 点名，不是名字路径）',
    [58425, 58505, 62186, 69972, 59069, 60327, 61503, 44785, 49059, 69472].every(n => asked.has(n)),
    '被查询的 NORAD 数 = ' + asked.size);
  ok('日志里能看到"按批次点名纳入"的战绩（可观测性）',
    /按批次点名纳入/.test(log),
    (log.match(/├ [^\n]*/g) || []).slice(0, 4).join(' / '));
}

// GEO 三颗的高度量级（半长轴应约 42164 km —— 抓"量级错误"这类静默污染）
{
  const geo = [];
  for (const w of ['gw']) {
    for (const lk of ['24040', '24135', '24181']) {
      (prod[w].get(lk) || []).forEach(x => {
        const mm = parseFloat(x.l2.slice(52, 63));
        if (mm > 0) geo.push(mm);
      });
    }
  }
  const mmOk = geo.length === 3 && geo.every(v => v > 0.9 && v < 1.1);   // GEO ≈ 1.0027 rev/day
  ok('GEO 三颗的平均运动约 1.00 rev/day（静止轨道量级，不是 LEO 的 13~15）',
    mmOk, geo.map(v => v.toFixed(4)).join(', '));
}

console.log('\n端到端结论：' + (fails.length ? '失败 ' + fails.length + ' 项' : '全部通过'));
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
process.exit(fails.length ? 1 : 0);
