/* import_history.mjs —— 把历史轨道要素整理成按批次分片的历史库（05 章「升轨情况」的数据来源）
 * ---------------------------------------------------------------------------
 * 用途（V1.9.0 / R17 的数据来源）：05 章「升轨情况」要画每颗卫星的半长轴随时间变化，
 *   就必须有**历史**要素。现行 TLE 只提供"当前"那一条，历史只能从历史库取。
 *
 * 数据来源与取数方式（V1.9.0 实测结论，改这一段前请先读完）：
 *   · **数据本身来自 Space-Track 的 GP（GP=General Perturbations，通用摄动）历史要素集**，
 *     每一行由 NORAD 编号 + 历元 + 平均运动等字段组成，半长轴由平均运动按布劳威尔模型反算。
 *     换源（satcat 等）也是同一类历史要素，换的只是**取数通道**，口径不变。
 *   · **命令行直连一律 401**：Space-Track 与 satcat 的接口都要求浏览器会话
 *     （带登录 Cookie），脚本环境拿不到会话就必然被拒。已实测：
 *       · 直连 basicspacedata/query/class/GP/… → 401
 *       · 直连 satcat 的历史接口 → 同样 401
 *       · **在已登录的 space-track.org 页面上跑 fetch（同源、带 Cookie）→ 正常返回**
 *     所以正式通路是"浏览器取数脚本 → cistrack-history-raw.json → 本脚本 --raw 转分片"；
 *     下面的直连分支保留，作为环境变量已配好时的便捷路径与离线自检的替身。
 *
 * 口径（按已确认的决议）：
 *   · 只导入**星网 / 千帆自己那几百颗**卫星的历史，从**各自最早一颗的最早历元**开始；
 *     每颗星从**它被发射后的第一条历史要素**开始存（不补发射日到首条之间的空白）。
 *   · 只存**布劳威尔半长轴**（与 SGP4 内部一致）—— 一种模型、一个值。
 *   · **按批次/组分片**（data/history/<批次key>.json），因为页面是"选批次 → 取该批次曲线"。
 *   · **去重靠 (NORAD, 历元)**、只追加（见 histstore.mjs）。
 *   · **每天最多留 N_TAKE 条**（默认 2）：低轨每天重发 3–5 次要素，全留会让库体积无谓膨胀；
 *     而升轨速度是 ±2 天窗口的最小二乘，2 条/天足以稳定拟合。
 *
 * 凭据：**不进仓库**。读取顺序 = 环境变量 `SPACETRACK_USER` / `SPACETRACK_PASS`
 *   → 文件 `仓库同级的 _secrets/spacetrack.json`（仓库目录之外）。
 *
 * 用法：
 *   node scripts/import_history.mjs --raw <file>  正式通路：吃浏览器脚本导出的原始 JSON
 *   node scripts/import_history.mjs --dry        只看会抓多少，不写盘
 *   node scripts/import_history.mjs --limit 20   只抓前 20 颗（试跑）
 *   node scripts/import_history.mjs             正式抓（会写 data/history/）
 *
 * 自检：node scripts/import_history.mjs --selftest  —— 用**注入的假响应**验证
 *   解析、降采样、分片、幂等，全程不联网。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeInto, readShard } from './histstore.mjs';
import { fromCelesTrakOmm, PH } from './omm.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA = path.join(ROOT, 'data');
const HIST = path.join(DATA, 'history');
const DAY = 86400000;
const N_TAKE = 2;                 // 每天最多留几条要素
const sleepMs = (ms) => new Promise(r => setTimeout(r, ms));
const RE = 6378.135, MU = 398600.4418, J2 = 1.08262668e-3;
// ★ V1.9.1 常量说明（三个数各有用途，别混）：
//   · `RE = 6378.135`（WGS-72 平均半径）—— 是 **SGP4 物理常数**，参与布劳威尔 J2 项的推导
//     （satellite.js 内部用的也是 6378.135）。**不要改成 6378.137**。
//   · `densify()` 返回的是**离地高度**（半长轴 − RE）。
//   · 而**源库/页面的存储契约是半长轴**，页面算离地高度时减的是自己的 `CLIMB_RE = 6378.137`。
//     → 所以**写库前**必须 `高度 + 6378.137`（见文件末尾的 histSmaOf 与 fetch_history.mjs 同款注释），
//       这样与页面"减 6378.137"恰好抵消，存进去再取出来的就是原始高度。
const HIST_RE = 6378.137;                    // 存储契约常数：与 app.js 的 CLIMB_RE 必须一致
const histSmaOf = (altKm) => Math.round((altKm + HIST_RE) * 100) / 100;
// ⚠️ 6 位编目号对象在 .tle 里是**占位号**（真号后 5 位）—— 必须经 sidecar 还原真号，
//   否则会把历史写到**另一颗卫星**名下（编号 203 是真实存在的另一颗星）。
const OMM_IDS = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, 'omm_norad.json'), 'utf8')); } catch (e) { return {}; }
})();
const realNorad = (raw5) => OMM_IDS[raw5] || Number(raw5);

/** 由 OMM 的平均运动算**布劳威尔半长轴高度**（与页面/SGP4 同一口径：剥掉 J2 长期项） */
export function brouwerAltKm(nRad) {
  const aKep = Math.cbrt(MU / (nRad * nRad));
  const e = 0, p = aKep * (1 - e * e);
  const dl = 1.5 * J2 * (RE / p) * (RE / p) * (1 - 1.5 * Math.pow(Math.sin(0), 2)) / Math.sqrt(1 - e * e);
  return aKep * Math.pow(1 + dl, -2 / 3) - RE;
}
/** 更一般：给定 OMM 记录，算出它那一刻的布劳威尔高度（含倾角与偏心率） */
export function altFromOmm(om) {
  const mm = Number(om.MEAN_MOTION); if (!isFinite(mm) || mm <= 0) return null;
  // rev/day → rad/s：mm / 86400 × 2π。
  // ⚠️ 这里曾经写成 `mm / 1440 * 2π / 86400`，多除了一个 1440 → 高度算成 86 万 km（而不是约 419 km）。
  //   而当时自检只断言了"单调性"（平均运动越大高度越低），**单调性对量级错误完全无感**，所以没抓出来。
  const nRad = mm * 2 * Math.PI / 86400;
  const aKep = Math.cbrt(MU / (nRad * nRad));
  const e = Number(om.ECCENTRICITY) || 0;
  const inc = (Number(om.INCLINATION) || 0) * Math.PI / 180;
  const p = aKep * (1 - e * e);
  const dl = 1.5 * J2 * (RE / p) * (RE / p) * (1 - 1.5 * Math.sin(inc) * Math.sin(inc)) / Math.sqrt(1 - e * e);
  return aKep * Math.pow(1 + dl, -2 / 3) - RE;
}

/** 把一批 OMM 记录压成历史行：每天最多留 N_TAKE 条（按历元排序后等间隔抽样） */
export function densify(list, norad, take) {
  take = take || N_TAKE;
  const byDay = new Map();
  for (const om of list || []) {
    const alt = altFromOmm(om); if (alt == null) continue;
    const ms = new Date(om.EPOCH).getTime(); if (!isFinite(ms)) continue;
    const d = Math.floor(ms / DAY) * DAY;
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push({ ms: ms, alt: alt });
  }
  const out = [];
  [...byDay.keys()].sort((a, b) => a - b).forEach(d => {
    const arr = byDay.get(d).sort((a, b) => a.ms - b.ms);
    const pick = arr.length <= take ? arr : evenly(arr, take);
    pick.forEach(p => out.push([norad, p.ms, Math.round(p.alt * 1e4) / 1e4]));   // 存到 0.1 m，够用且省体积
  });
  return out;
}
function evenly(arr, k) {
  const out = [];
  for (let i = 0; i < k; i++) out.push(arr[Math.round(i * (arr.length - 1) / (k - 1 || 1))]);
  return out.filter((v, i, a) => a.indexOf(v) === i);
}

/**
 * 直连取数：Space-Track GP 历史要素查询。
 * ⚠️ 实测结论（V1.9.0）：**这条路在脚本环境里必然 401**，因为接口要浏览器登录会话。
 *   保留它有两个理由：① 环境变量已配好时是便捷路径；② 离线自检需要它作为替身。
 *   正式取数请用 --raw（见文件头）。
 */
export async function fetchElsets(user, pass, noradList) {
  const auth = 'Basic ' + Buffer.from(user + ':' + pass).toString('base64');
  const out = new Map();
  for (const n of noradList) {
    // ★ 两个已踩过的坑，都记在这里免得再犯：
    //   ① 子查询段（EPOCH/…、MEAN_MOTION/…）必须排在 **/format/JSON 之前**，写在之后路径非法；
    //   ② 数据集必须用 **/basicspacedata/query/class/GP/** —— 我原先写的
    //      `/basicspacedata/query/identifiers/…` 会被判成「No Class Specified」，
    //      而 `/gp/query/…` 直接 404。GP = General Perturbations，就是历史 TLE 所在的数据集。
    const url = 'https://www.space-track.org/basicspacedata/query/class/GP/identifiers/NORAD_CAT_ID/' + n +
      '/EPOCH/%5E1d/MEAN_MOTION/true/ECCENTRICITY/true/INCLINATION/true/RAAN/true' +
      '/ARG_OF_PERICENTER/true/MEAN_ANOMALY/true/OBJECT_ID/true/format/JSON';
    let list = [];
    try {
      const r = await fetch(url, { headers: { Authorization: auth, Accept: 'application/json' } });
      if (!r.ok) { console.log('\n  [HTTP ' + r.status + '] NORAD ' + n + ' — ' + (r.status === 401 || r.status === 403 ? '凭据/权限问题' : '查询无效')); out.set(n, []); continue; }
      const j = await r.json();
      list = Array.isArray(j) ? j : [];
    } catch (e) { console.log('\n  [ERR] NORAD ' + n + ' — ' + (e && e.message)); }
    out.set(n, list);
  }
  return out;
}

/**
 * 读 Space-Track 凭据（**绝不进仓库**）。查找顺序：
 *   1. 环境变量 SPACETRACK_USER / SPACETRACK_PASS
 *   2. 环境变量 SPACETRACK_CREDS 指向的 JSON 文件
 *   3. 仓库同级的 `_secrets/spacetrack.json`（开发机约定：数据放在仓库之外，避免误提交）
 *   4. 仓库内 `.secrets/spacetrack.json`（已被 .gitignore 挡住，作为兜底位置）
 * 都没有就返回 null，由调用方提示怎么配。
 */
export function loadCreds() {
  const env = { user: process.env.SPACETRACK_USER, pass: process.env.SPACETRACK_PASS };
  if (env.user && env.pass) return env;
  const cands = [
    process.env.SPACETRACK_CREDS,
    path.join(ROOT, '..', '_secrets', 'spacetrack.json'),
    path.join(ROOT, '.secrets', 'spacetrack.json'),
  ].filter(Boolean);
  for (const p of cands) {
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      const creds = { user: j.user || j.username, pass: j.pass || j.password };
      if (creds.user && creds.pass) return creds;
    } catch (e) { /* 换下一个候选 */ }
  }
  return null;
}

// ---------------------------------------------------------------- 自检（全程离线）
const isMain = process.argv[1] && process.argv[1].endsWith('import_history.mjs');
if (isMain && process.argv.includes('--selftest')) {
  const fails = [];
  const ok = (n, c, e) => { console.log((c ? 'PASS ' : 'FAIL ') + n + (e !== undefined ? '  → ' + e : '')); if (!c) fails.push(n); };

  // 造一条已知半长轴的 OMM：MEAN_MOTION 取 15.5 rev/day（≈ 8788 km 高度量级）
  const mkOmm = (iso, mm) => ({ EPOCH: iso, MEAN_MOTION: mm, ECCENTRICITY: 0.0001, INCLINATION: 50 });

  // ① 高度换算：**既查单调性，也查绝对量级**。
  //    量级参考：15.5 rev/day → 周期 92.9 min → 半长轴约 6797 km → 高度约 **419 km**（真实低轨）。
  //    ★ 只断言单调性的话，"多除一个 1440"这种量级错误会**完全隐形** —— 首跑就踩过这个坑。
  {
    const h1 = altFromOmm(mkOmm('2026-01-01T00:00:00.000Z', 15.0));
    const h2 = altFromOmm(mkOmm('2026-01-01T00:00:00.000Z', 15.5));
    ok('① 半长轴高度随平均运动增大而降低', h1 > h2, '15.0→' + h1.toFixed(1) + 'km，15.5→' + h2.toFixed(1) + 'km');
    ok('① 15.5 rev/day 的高度落在真实低轨量级（380–460 km）', h2 > 380 && h2 < 460, '→ ' + h2.toFixed(1) + ' km');
    // 第二个锚点用**太阳同步 2000 km**（≈11.33 rev/day）：两处独立锚点才能同时锁住量级与单调性
    const h3 = altFromOmm(mkOmm('2026-01-01T00:00:00.000Z', 11.33));
    ok('① 11.33 rev/day 落在 2000 km 太阳同步量级（1900–2100 km）', h3 > 1900 && h3 < 2100, '→ ' + h3.toFixed(1) + ' km');
  }
  // ② 降采样：一天 5 条要素 → 只留 2 条
  {
    const day = '2026-01-02T';
    const list = [0, 3, 6, 9, 12].map(h => mkOmm(day + '0' + h + ':00:00.000Z', 15.3 + h * 0.001));
    const rows = densify(list, 100203, 2);
    ok('② 一天 5 条要素被降采样为 2 条', rows.length === 2, '留下 ' + rows.length + ' 条');
    ok('② 行格式为 [norad, 历元, 高度]', rows.length === 2 && rows[0][0] === 100203 && rows[0].length === 3,
      JSON.stringify(rows[0] || []));
  }
  // ③ 多天 → 每天独立 2 条，且按时间升序
  {
    const list = [];
    for (const d of ['01', '02', '03']) for (const h of [0, 6, 12]) list.push(mkOmm('2026-01-' + d + 'T0' + h + ':00:00.000Z', 15.3));
    const rows = densify(list, 100203, 2);
    const days = new Set(rows.map(r => Math.floor(r[1] / DAY))).size;
    ok('③ 三天各留 ≤2 条、按时间升序', rows.length <= 6 && days === 3 && rows.every((r, i) => i === 0 || r[1] >= rows[i - 1][1]),
      '共 ' + rows.length + ' 条 / ' + days + ' 天');
  }
  // ④ 幂等：同一批数据写两次，分片不增长
  {
    // 临时目录**每次运行都新建**：用固定目录会让"首次导入"在第二次运行时必然是 0（因为已经写过了），
    //  自检就会变得**不可重复运行** —— 这类"测试自己把状态搞脏"的问题必须从根上去掉。
    const dir = path.join(process.env.TEMP || 'D:/Temp', 'cistrack-hist-imp-selftest-' + process.pid + '-' + Date.now());
    fs.mkdirSync(dir, { recursive: true });
    const batches = [{ key: 25101, records: densify([mkOmm('2026-01-01T00:00:00.000Z', 15.2), mkOmm('2026-01-01T06:00:00.000Z', 15.25)], 100203, 2) }];
    const s1 = mergeInto(dir, batches);
    const s2 = mergeInto(dir, batches);
    ok('④ 首次写入 2 条、重复写入 0 条', s1.added === 2 && s2.added === 0, '首次 ' + s1.added + '，重复 ' + s2.added);
    ok('④ 分片内容不增长', readShard(dir, 25101).length === 2, '现有 ' + readShard(dir, 25101).length + ' 条');
  }
  // ⑤ 坏数据不炸：MEAN_MOTION 缺失 / EPOCH 非法 → 整条丢弃
  {
    const rows = densify([{ EPOCH: '2026-01-01T00:00:00Z' }, { EPOCH: 'not-a-date', MEAN_MOTION: 15 }, mkOmm('2026-01-01T00:00:00.000Z', 15.2)], 1, 2);
    ok('⑤ 坏记录被丢弃，好记录仍保留', rows.length === 1, '留下 ' + rows.length + ' 条');
  }

  console.log('\n自检结论：' + (fails.length ? '失败 ' + fails.length + ' 项' : '全部通过'));
  process.exit(fails.length ? 1 : 0);
}

// ---------------------------------------------------------------- 正式运行
if (isMain && !process.argv.includes('--selftest')) {
  const argv = process.argv.slice(2);
  const dry = argv.includes('--dry');
  const lim = (() => { const i = argv.indexOf('--limit'); return i >= 0 ? Number(argv[i + 1]) : Infinity; })();
  const creds = loadCreds();
  if (!creds || !creds.user || !creds.pass) {
    console.error('未找到 Space-Track 凭据。若要走 --raw 通路（推荐）不需要凭据，只需浏览器脚本导出的 raw 文件。');
    console.error('若要走直连通路，请设 SPACETRACK_USER / SPACETRACK_PASS 环境变量，' +
      '或放置 _secrets/spacetrack.json（仓库之外，勿提交）。');
    process.exit(2);
  }

  // ① 从当前要素文件里列出「每颗卫星 → 批次 key」
  //    行结构：name / l1 / l2；l1 的 3–7 位是 NORAD、10–17 位是 COSPAR（前 5 位即批次 key）。
  const sats = [];
  for (const f of ['ct_hulianwang.tle', 'ct_qianfan.tle']) {
    const p = path.join(DATA, f);
    if (!fs.existsSync(p)) continue;
    const lines = fs.readFileSync(p, 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
    for (let i = 0; i + 2 < lines.length; i += 3) {
      const l1 = lines[i + 1];
      if (!/^1 /.test(l1)) continue;
      sats.push({ norad: realNorad(l1.slice(2, 7)), lk: l1.slice(9, 14).trim(), name: lines[i] });
    }
  }
  const uniq = [...new Map(sats.map(s => [s.norad, s])).values()].sort((a, b) => a.norad - b.norad);
  const todo = uniq.slice(0, lim === Infinity ? uniq.length : Math.max(0, lim));
  console.log('凭据已加载（' + creds.user + '）。历史库目录：' + HIST);
  console.log('在编卫星 ' + uniq.length + ' 颗，本次处理 ' + todo.length + ' 颗' + (dry ? '（--dry 不联网不写盘）' : ''));
  if (!todo.length) process.exit(0);
  if (dry) {
    const byLk = {};
    todo.forEach(s => { (byLk[s.lk] = byLk[s.lk] || []).push(s.norad); });
    console.log('涉及批次 ' + Object.keys(byLk).length + ' 个：');
    Object.keys(byLk).sort().forEach(k => console.log('  ' + k + ' → ' + byLk[k].length + ' 颗'));
    process.exit(0);
  }

  // ② 两种取数来源：
  //    (a) --raw <file>：浏览器脚本取回的原始 JSON（{ "<norad>": [{E,MM,EC,IN,ID}, …] }）
  //        —— **正式通路**。Space-Track 与 satcat 的接口都要浏览器会话（命令行一律 401），
  //        这条路借用你已登录的页面会话，因此不需要把凭据交给任何脚本。
  //    (b) 无 --raw：脚本自己用凭据调接口。当前网络/会话条件下多数路径不通，仅作备用。
  const rawIdx = argv.indexOf('--raw');
  let perSat = new Map();                 // norad -> OMM 子集数组
  if (rawIdx >= 0) {
    const rf = argv[rawIdx + 1];
    let raw = {};
    try { raw = JSON.parse(fs.readFileSync(rf, 'utf8')); }
    catch (e) { console.error('读不了 raw 文件：' + rf + '（' + (e && e.message) + '）'); process.exit(3); }
    Object.keys(raw).forEach(k => { perSat.set(Number(k), (raw[k] || []).map(x => ({
      EPOCH: x.E || x.EPOCH, MEAN_MOTION: x.MM != null ? x.MM : x.MEAN_MOTION,
      ECCENTRICITY: x.EC != null ? x.EC : x.ECCENTRICITY,
      INCLINATION: x.IN != null ? x.IN : x.INCLINATION, OBJECT_ID: x.ID || x.OBJECT_ID || ''
    }))); });
    console.log('已读 raw 文件 ' + rf + '：' + perSat.size + ' 颗卫星的要素');
  } else {
    const t0 = Date.now();
    for (let i = 0; i < todo.length; i++) {
      const s = todo[i];
      let list = [];
      try { list = (await fetchElsets(creds.user, creds.pass, [s.norad])).get(s.norad) || []; }
      catch (e) { list = []; }
      perSat.set(s.norad, list);
      process.stdout.write('\r  进度 ' + (i + 1) + '/' + todo.length + '   ');
      await sleepMs(2100);
    }
    console.log('\n脚本取数完成（耗时 ' + Math.round((Date.now() - t0) / 1000) + ' s）');
  }

  // ③ 逐颗降采样 + 按批次合并（去重 + 只追加）
  const batches = new Map();
  let got = 0, empty = 0;
  todo.forEach(s => {
    // ★ V1.9.1：densify 给的是**离地高度**，写库前必须换成**半长轴**。
    //   旧代码直接把 densify 的输出写进库 → 这一条通路（正式取数通路）存的是高度（约 500），
    //   而 fetch_history / refresh 存的是半长轴（约 6878）—— **同一份库里混装两种单位**。
    //   后果：走这条路补进去的卫星，曲线会比同批其他卫星低 6378 km（直接掉出纵轴范围），
    //   而"按批次混装"让它时有时无，极难定位。
    const recs = densify(perSat.get(s.norad) || [], s.norad, N_TAKE)
      .map(([n, ms, alt]) => [n, ms, histSmaOf(alt)]);
    if (recs.length) got++; else empty++;
    if (!batches.has(s.lk)) batches.set(s.lk, []);
    batches.get(s.lk).push(...recs);
  });
  console.log('解析完成：有数据 ' + got + ' 颗 / 无数据 ' + empty + ' 颗');

  const stat = mergeInto(HIST, [...batches].map(([key, records]) => ({ key: key, records: records })));
  console.log('写入 ' + HIST + '：分片 ' + stat.shards + ' 个 / 新增 ' + stat.added + ' 行 / 挡下重复 ' + stat.dup + ' 行');
  const total = [...batches.keys()].reduce((a, k) => a + readShard(HIST, k).length, 0);
  console.log('当前历史库合计 ' + total + ' 行（去重后）');
}