import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// V1.9.0（R17）：历史库的容量治理与发布打包，见 scripts/histstore.mjs / scripts/histpack.mjs
import { pruneRecords, CAP } from './scripts/histstore.mjs';
import { packAll } from './scripts/histpack.mjs';
const ROOT = path.dirname(fileURLToPath(import.meta.url));   // 脚本所在目录（发布包内任意位置可用）
const D = path.join(ROOT, 'data');

// ---- 批次元数据（来源：卫星百科 星网 / 千帆星座 词条，发射记录表）----
const GW_LAUNCH = {
  '24240': ['低轨01组', '2024-12-16T18:00', '长征五号B Y6 / 远征二号Y2', '文昌 LC-101', 86.5],
  '25030': ['低轨02组', '2025-02-11T17:30', '长征八号甲 Y1', '文昌 LC-201', 50.0],
  '25086': ['低轨03组', '2025-04-29T04:10', '长征五号B Y7 / 远征二号Y3', '文昌 LC-101', 86.5],
  '25121': ['低轨04组', '2025-06-06T04:45', '长征六号甲 Y8', '太原 LC-9A', 86.5],
  '25159': ['低轨05组', '2025-07-27T18:03', '长征六号甲 Y14', '太原 LC-9A', 86.5],
  '25162': ['低轨06组', '2025-07-30T15:49', '长征八号甲 Y3', '海商 LCC-1', 50.0],
  '25168': ['低轨07组', '2025-08-04T18:21', '长征十二号 Y2', '海商 LCC-2', 50.0],
  '25174': ['低轨08组', '2025-08-13T14:43', '长征五号B Y8 / 远征二号Y4', '文昌 LC-101', 86.5],
  '25178': ['低轨09组', '2025-08-17T22:15', '长征六号甲 Y10', '太原 LC-9A', 86.5],
  '25187': ['低轨10组', '2025-08-26T03:08', '长征八号甲 Y2', '海商 LCC-1', 50.0],
  '25220': ['低轨11组', '2025-09-27T20:40', '长征六号甲 Y16', '太原 LC-9A', 86.5],
  '25231': ['低轨12组', '2025-10-16T09:33', '长征八号甲 Y4', '海商 LCC-1', 50.0],
  '25258': ['低轨13组', '2025-11-10T10:41', '长征十二号 Y3', '海商 LCC-2', 50.0],
  '25285': ['低轨14组', '2025-12-06T15:53', '长征八号甲 Y5', '海商 LCC-1', 50.0],
  '25287': ['低轨15组', '2025-12-09T06:11', '长征六号甲 Y15', '太原 LC-9A', 86.5],
  '25295': ['低轨16组', '2025-12-12T07:00', '长征十二号 Y4', '海商 LCC-2', 50.0],
  '25311': ['低轨17组', '2025-12-26T07:26', '长征八号甲 Y6', '海商 LCC-1', 50.0],
  '26007': ['低轨18组', '2026-01-13T23:25', '长征八号甲 Y7', '海商 LCC-1', 50.0],
  '26013': ['低轨19组', '2026-01-19T15:48', '长征十二号 Y5', '海商 LCC-2', 50.0],
  '26047': ['低轨20组', '2026-03-13T03:48', '长征八号甲 Y8', '海商 LCC-1', 50.0],
  '26076': ['低轨21组', '2026-04-09T03:38', '长征六号甲 Y17', '太原 LC-9A', 86.5],
  '26120': ['试验星11组', '2026-05-31T02:07', '长征二号丁 Y119', '西昌 LC-3', 55.0],
  '26137': ['低轨22组', '2026-06-17T10:44', '长征十二号 Y7', '海商 LCC-2', 50.0],
  // 已发射、公开目录中尚无轨道要素
  '26176': ['低轨23组', '2026-08-04T16:52', '长征八号甲 Y10', '海商 LCC-1', 50.0],
  '26187': ['低轨24组', '2026-08-16T12:10', '长征十二号 Y8', '海商 LCC-2', 50.0],
  '26213': ['低轨25组', '2026-09-17T08:32', '长征十二号 Y9', '海商 LCC-2', 50.0],
  '26221': ['低轨26组', '2026-09-23T21:32', '长征八号甲 Y11', '海商 LCC-1', 50.0],
  // ---- V1.3.7：试验星 12 次与高轨 3 星（来源：卫星百科「星网」词条发射记录表 1 / 表 2）----
  // 多源抓取（NAME= 模糊匹配）已经把 23095 / 23212 两批试验星的轨道要素捞回来了，
  // 因此这里必须补齐它们的元数据，否则页面上会缺批次名。
  '23095': ['试验星01组', '2023-07-09T19:00', '长征二号丙 Y52 / 远征一号S Y3', '酒泉 LC-43/94', 86.5],
  '23181': ['试验星02组', '2023-11-23T18:00', '长征二号丁 Y59 / 远征三号 Y2', '西昌 LC-3', 50.0],
  '23190': ['试验星03', '2023-12-06T03:24', '捷龙三号 Y2', '南海 博润九州号', 86.5],
  '23212': ['试验星04组', '2023-12-30T08:13', '长征二号丙 Y73 / 远征一号S Y17', '酒泉 LC-43/94', 50.0],
  '24226': ['试验星05', '2024-11-30T22:25', '长征十二号 Y1', '海商 LCC-2', 50.0],
  '25067': ['试验星06组', '2025-04-01T12:00', '长征二号丁 Y78', '酒泉 LC-43/94', 55.0],
  '25F05': ['试验星07组', '2025-08-15T09:17', '朱雀二号E Y3', '酒泉 LC-43/96A', 0, 'fail'],
  '25209': ['试验星08组', '2025-09-16T09:06', '长征二号丙 Y54 / 远征一号S Y11', '酒泉 LC-43/94', 50.0],
  '26078': ['试验星09', '2026-04-11T19:32', '捷龙三号 Y11', '南海 东方航天港号', 86.5],
  '26091': ['试验星10组', '2026-04-24T14:35', '长征二号丁 Y109', '西昌 LC-3', 55.0],
  '26158': ['试验星12', '2026-07-10T12:15', '长征十号乙 Y1', '海商 LCC-2', 49.99],
  '24040': ['高轨01星', '2024-02-29T21:03', '长征三号乙 Y95', '西昌 LC-2', 0],
  '24135': ['高轨02星', '2024-08-01T21:14', '长征三号乙 Y97', '西昌 LC-2', 0],
  '24181': ['高轨03星', '2024-10-10T21:50', '长征三号乙 Y100', '西昌 LC-2', 0],
};
const GW_PENDING = { '26176': 9, '26187': 9, '26213': 9, '26221': 9 };

const QF_LAUNCH = {
  '24140': ['极轨01组', '2024-08-06T14:42', '长征六号甲 Y21', '太原 LC-9A', 89.0],
  '24185': ['极轨02组', '2024-10-15T19:06', '长征六号甲 Y20', '太原 LC-9A', 89.0],
  '24232': ['极轨03组', '2024-12-05T12:41', '长征六号甲 Y22', '太原 LC-9A', 89.0],
  '25016': ['极轨06组', '2025-01-23T13:15', '长征六号甲 Y6', '太原 LC-9A', 89.0],
  '25046': ['极轨04组', '2025-03-12T00:38', '长征八号 Y6', '海商 LCC-1', 89.0],
  '25233': ['极轨18组', '2025-10-17T15:08', '长征六号甲 Y24', '太原 LC-9A', 89.0],
  '26075': ['极轨07组', '2026-04-07T21:32', '长征八号 Y7', '海商 LCC-1', 89.0],
  '26104': ['极轨09组', '2026-05-12T19:59', '长征六号甲 Y23', '太原 LC-9A', 89.0],
  '26108': ['极轨10组', '2026-05-17T22:42', '长征八号 Y8', '海商 LCC-1', 89.0],
  '26121': ['极轨08组', '2026-06-01T16:40', '长征十二号乙 Y1', '酒泉 商火工位', 89.0],
  '26124': ['极轨11组', '2026-06-04T19:59', '长征六号甲 Y25', '太原 LC-9A', 89.0],
  '26125': ['极轨12组', '2026-06-05T14:34', '长征八号 Y9', '海商 LCC-1', 89.0],
  '26153': ['极轨13组', '2026-07-04T17:30', '长征六号甲', '太原 LC-9A', 89.0],
  '26155': ['极轨15组', '2026-07-05T21:43', '长征八号甲 Y9', '海商 LCC-1', 89.0],
  '26210': ['极轨19组', '2026-09-15T14:26', '朱雀二号E Y7', '酒泉 LC-43/96A', 89.0],
  '26211': ['极轨26组', '2026-09-16T06:00', '引力一号 Y3', '海阳 东海海域', 89.0],
  // ---- V1.3.7：千帆试验星 6 颗（来源：卫星百科「千帆星座」词条发射记录表 2）----
  // 词条把这 6 颗与组网星分开统计，正好对应顶部「试验星6」那一项。
  '19077': ['试验星 KL-Alpha', '2019-11-17T18:00', '快舟一号甲 Y7', '酒泉 LC-43/95A', 88.9],
  '21070': ['试验星 KL-Beta', '2021-08-04T19:01', '长征六号 Y7', '太原 LC-16', 89.0],
  '26128': ['千帆 DTC-01', '2026-06-09T16:23', '朱雀二号E Y6', '酒泉 LC-43/96A', 55.0],
};
const QF_PENDING = { '26210': 10, '26211': 8 };

// ---- V1.8.0（需求12 / Q6）：逐次发射的任务结果 ---------------------------------
// 来源：wiki_launches.json（由 scripts/fetch_launch_results.mjs 抓卫星百科「引导页:发射记录/<年>」
//   自动更新，sat.huijiwiki.com/wiki/引导页:发射记录/2026 里末尾年份即该年全球发射记录）。
// 结果码写到台账数组第 6 位：ok=成功 / part=部分成功 / fail=失败 / '?'=百科没写结果；
// 第 7 位 = 卫星百科记载的该发颗数（**没写就不写** —— 页面对「没有对应数字」的批次按不加处理，见 Q5）。
let WIKI_LAUNCHES = {};
try {
  WIKI_LAUNCHES = JSON.parse(fs.readFileSync(path.join(ROOT, 'wiki_launches.json'), 'utf8')).launches || {};
} catch (e) {
  console.warn('wiki_launches.json 读不到（' + (e.code || e.message) + '）：任务结果列只会有静态标注，' +
    '跑一次 node scripts/fetch_launch_results.mjs 即可补上。');
}
function mergeResults(meta) {
  const out = {};
  Object.keys(meta).forEach(function (k) {
    const v = meta[k].slice(0, 5).concat([meta[k][5] || '']);
    const full = '20' + k.slice(0, 2) + '-' + k.slice(2);
    const w = WIKI_LAUNCHES[full];
    if (w && w.res && w.res !== '?') v[5] = w.res;          // 百科有明确结果 → 以百科为准
    else if (w && w.res === '?' && !v[5]) v[5] = '?';       // 百科有这一发但没写结果
    if (w && w.n) v.push(w.n);                              // 百科写了颗数才带上
    out[k] = v;
  });
  return out;
}
const GW_LEDGER = mergeResults(GW_LAUNCH), QF_LEDGER = mergeResults(QF_LAUNCH);

// ---- 卫星百科词条链接（URL 取自百科词条原文的链接，已核对）----
const W = 'https://sat.huijiwiki.com/wiki/';
const ROCKET_URL = {
  '长征五号B': W + '%E9%95%BF%E5%BE%81%E4%BA%94%E5%8F%B7B',
  '远征二号': W + '%E8%BF%9C%E5%BE%81%E4%BA%8C%E5%8F%B7',
  '长征八号甲': W + '%E9%95%BF%E5%BE%81%E5%85%AB%E5%8F%B7%E7%94%B2',
  '长征八号': W + '%E9%95%BF%E5%BE%81%E5%85%AB%E5%8F%B7',
  '长征六号甲': W + '%E9%95%BF%E5%BE%81%E5%85%AD%E5%8F%B7%E7%94%B2',
  '长征六号': W + '%E9%95%BF%E5%BE%81%E5%85%AD%E5%8F%B7',
  '长征十二号乙': W + '%E9%95%BF%E5%BE%81%E5%8D%81%E4%BA%8C%E5%8F%B7%E4%B9%99',
  '长征十二号': W + '%E9%95%BF%E5%BE%81%E5%8D%81%E4%BA%8C%E5%8F%B7',
  '长征二号丁': W + '%E9%95%BF%E5%BE%81%E4%BA%8C%E5%8F%B7%E4%B8%81',
  '朱雀二号E': W + '%E6%9C%B1%E9%9B%80%E4%BA%8C%E5%8F%B7E',
  '引力一号': W + '%E5%BC%95%E5%8A%9B%E4%B8%80%E5%8F%B7',
  // V1.3.7：试验星与高轨批次用到的火箭
  '长征二号丙': W + '%E9%95%BF%E5%BE%81%E4%BA%8C%E5%8F%B7%E4%B8%99',
  '远征一号S': W + '%E8%BF%9C%E5%BE%81%E4%B8%80%E5%8F%B7',
  '远征三号': W + '%E8%BF%9C%E5%BE%81%E4%B8%89%E5%8F%B7',
  '捷龙三号': W + '%E6%8D%B7%E9%BE%99%E4%B8%89%E5%8F%B7',
  '长征三号乙': W + '%E9%95%BF%E5%BE%81%E4%B8%89%E5%8F%B7%E4%B9%99',
  '长征十号乙': W + '%E9%95%BF%E5%BE%81%E5%8D%81%E5%8F%B7%E4%B9%99',
  '快舟一号甲': W + '%E5%BF%AB%E8%88%9F%E4%B8%80%E5%8F%B7%E7%94%B2'
};
const SITE_URL = {
  '文昌': W + '%E6%96%87%E6%98%8C%E8%88%AA%E5%A4%A9%E5%8F%91%E5%B0%84%E5%9C%BA',
  '太原': W + '%E5%A4%AA%E5%8E%9F%E5%8D%AB%E6%98%9F%E5%8F%91%E5%B0%84%E4%B8%AD%E5%BF%83',
  '海商': W + '%E6%B5%B7%E5%8D%97%E5%95%86%E4%B8%9A%E8%88%AA%E5%A4%A9%E5%8F%91%E5%B0%84%E5%9C%BA',
  '西昌': W + '%E8%A5%BF%E6%98%8C%E5%8D%AB%E6%98%9F%E5%8F%91%E5%B0%84%E4%B8%AD%E5%BF%83',
  '酒泉': W + '%E9%85%92%E6%B3%89%E5%8D%AB%E6%98%9F%E5%8F%91%E5%B0%84%E4%B8%AD%E5%BF%83',
  '海阳': W + '%E6%B5%B7%E9%98%B3%E4%B8%9C%E6%96%B9%E8%88%AA%E5%A4%A9%E6%B8%AF'
};
// 火箭串可能是「长征五号B Y6 / 远征二号Y2」，按最长词优先匹配，逐段给出链接
// V1.3.7：链接不再逐条重复写全（每批两条 90 字符的 URL 太占体积），统一收到 URLS 数组里，
// 这里只存下标；页面端用 RAW.urls[下标] 还原。
const URLS = [];
function urlIdx(u) {
  var i = URLS.indexOf(u);
  if (i < 0) { URLS.push(u); i = URLS.length - 1; }
  return i;
}
const ROCKET_KEYS = Object.keys(ROCKET_URL).sort((a, b) => b.length - a.length);
function rocketSegs(str) {
  return String(str).split('/').map(function (p) {
    var t = p.trim();
    for (var i = 0; i < ROCKET_KEYS.length; i++) {
      if (t.indexOf(ROCKET_KEYS[i]) === 0) return { t: t, u: urlIdx(ROCKET_URL[ROCKET_KEYS[i]]) };
    }
    return { t: t };
  });
}
// V1.4.3：发射地点优先用词条里抓到的链接（mkmaker.mjs 顺带抓了「发射基地/发射地点」列），
// 这样南海海域、东方航天港号这类海上平台也能点进去；抓不到再回落到手工维护的 SITE_URL。
// 注意：MAKERS 必须在这里之前就赋值（它是 const，跑到后面才定义会触发 TDZ）。
const MAKERS = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'makers.json'), 'utf8'));
  } catch (e) {
    console.log('!! makers.json 读不到（先跑 node mkmaker.mjs）：', e.message);
    return null;
  }
})();
// 词条里这两条海上发射平台没挂链接，按需求指到海阳东方航天港词条
const HYDFHTG = W + '%E6%B5%B7%E9%98%B3%E4%B8%9C%E6%96%B9%E8%88%AA%E5%A4%A9%E6%B8%AF';   // 海阳东方航天港
const SITE_EXTRA = {
  '南海 东方航天港号': HYDFHTG,
  '南海 博润九州号': HYDFHTG
};
function siteLink(str) {
  var t = String(str);
  var key = t.split(/[\s]/)[0];
  var bySite = (MAKERS && MAKERS.bySite) || {};
  var hit = bySite[t];
  if (!hit && key) {
    Object.keys(bySite).some(function (k) {
      if (k.split(/[\s]/)[0] === key) { hit = bySite[k]; return true; }
      return false;
    });
  }
  if (!hit && SITE_EXTRA[t]) hit = { u: SITE_EXTRA[t] };
  if (hit && hit.u) {
    // 词条抓回来的是 /wiki/xxx 相对路径，统一补成绝对地址（SITE_URL 那套本来就是绝对地址）
    var abs = /^https?:/.test(hit.u) ? hit.u : (W + String(hit.u).replace(/^\/wiki\//, ''));
    return { t: t, u: urlIdx(abs) };
  }
  return SITE_URL[key] ? { t: t, u: urlIdx(SITE_URL[key]) } : { t: t };
}

// ---- V1.3.7：TLE 分组差分 ----
// 同一次发射进场的卫星，两行轨道要素里大半字符是一样的（COSPAR、历元、阻力项、倾角、
// 偏心率…）。所以按「发射批次」(=COSPAR 前缀) 做一次字符级模板：组内所有卫星在该位都
// 相同的位收进模板，不同的位留给每颗星自己存。三行记录拼成定长 162 字符（名称 24 + 两行各 69），
// 模板用 base64 掩码描述哪些位是公共位。satdata.json 因此小掉约三分之一。
const REC = 24 + 69 + 69;
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function maskToB64(fix, len) {
  let s = '';
  for (let i = 0; i < len; i += 6) {
    let v = 0;
    for (let j = 0; j < 6; j++) v = (v << 1) | (i + j < len && fix[i + j] ? 1 : 0);
    s += B64[v];
  }
  return s;
}
function encodeGroup(recs) {
  const fix = new Array(REC).fill(true);
  for (let i = 1; i < recs.length; i++) {
    for (let p = 0; p < REC; p++) if (recs[i][p] !== recs[0][p]) fix[p] = false;
  }
  let f = '', out = [];
  for (let p = 0; p < REC; p++) if (fix[p]) f += recs[0][p];
  recs.forEach(r => {
    let d = '';
    for (let p = 0; p < REC; p++) if (!fix[p]) d += r[p];
    out.push(d);
  });
  return { tpl: { m: maskToB64(fix, REC), f: f }, diffs: out };
}
// ---------------------------------------------------------------- V1.9.1（1.4-D）：「在轨状态」
// 用户要求：已再入卫星也要在卫星列表 / 变轨情况里呈现。状态来源 = satcat 的 `DECAY_DATE`：
//   · 有 DECAY_DATE → 已再入（页面标红 + 显示再入日期）
//   · 无             → 在轨（默认，不额外带字段）
// ★ 只给"已再入"的卫星带 `st`/`dt` 两个字段，在轨的一律不带 —— 这样绝大多数记录的体积零增重
//   （几百颗星每颗多两个字段，虽然也不大，但没必要）。
function reentryMap() {
  const m = new Map();
  const file = `${D}/satcat.csv`;
  if (!fs.existsSync(file)) return m;
  const rows = fs.readFileSync(file, 'utf8').split('\n');
  const head = rows[0].split(','); const ix = n => head.indexOf(n);
  const iNo = ix('NORAD_CAT_ID'), iDec = ix('DECAY_DATE'), iTy = ix('OBJECT_TYPE');
  rows.slice(1).forEach(line => {
    if (!line) return;
    const c = line.split(',');
    const n = +c[iNo], dec = (c[iDec] || '').trim();
    if (!n || !dec) return;
    if ((c[iTy] || '').trim() !== 'PAY') return;   // 只认载荷（R/B、DEB 不算"卫星"）
    m.set(n, dec.slice(0, 10));
  });
  return m;
}
const REENTRY = reentryMap();

// V1.9.1（执行顺序 1.7）：「已再入颗数」按批次统计（**动态**，不写死）。
//   任务清单 1.7 要求"25067 标注 1 颗已再入（63428）"—— 但写死一个数字会在下次有卫星再入时过期，
//   所以这里从 satcat 的 DECAY_DATE **现算**：同一 COSPAR 前缀下已再入的 PAY 颗数。
//   页面可据此在批次行/列表里标注（A10/A11 规范），"在轨数量"也能扣掉这部分。
function goneCountsOf(batchKeys) {
  const file = `${D}/satcat.csv`;
  const out = {};
  if (!fs.existsSync(file)) return out;
  const rows = fs.readFileSync(file, 'utf8').split('\n');
  const head = rows[0].split(','); const ix = n => head.indexOf(n);
  const iId = ix('OBJECT_ID'), iNo = ix('NORAD_CAT_ID'), iTy = ix('OBJECT_TYPE'), iDec = ix('DECAY_DATE');
  rows.slice(1).forEach(line => {
    if (!line) return;
    const c = line.split(',');
    const id = (c[iId] || '').trim();
    const m = id.match(/^(\d{4})-(\d+)/);
    if (!m) return;
    const key = m[1].slice(2) + String(+m[2]).padStart(3, '0');
    if (batchKeys.indexOf(key) < 0) return;
    if ((c[iTy] || '').trim() !== 'PAY') return;
    const dec = (c[iDec] || '').trim();
    if (!dec) return;
    if (isStowaway(key, +c[iNo])) return;
    (out[key] = out[key] || []).push({ n: +c[iNo], id: id, on: dec.slice(0, 10) });
  });
  return out;
}

function pack(sats) {
  const byP = {};
  sats.forEach((s, i) => {
    const p = s.c.slice(0, 5);
    (byP[p] = byP[p] || []).push({ i: i, rec: s.name.padEnd(24).slice(0, 24) + s.l1.padEnd(69) + s.l2.padEnd(69) });
  });
  const tpls = {}, out = new Array(sats.length);
  Object.keys(byP).forEach(p => {
    const list = byP[p], g = encodeGroup(list.map(x => x.rec));
    tpls[p] = g.tpl;
    list.forEach((x, k) => {
      const s = sats[x.i];
      const rec = { id: s.id, c: s.c, d: g.diffs[k] };
      const dec = REENTRY.get(s.id);
      if (dec) { rec.st = 'r'; rec.dt = dec; }     // 已再入：页面据此标红并显示再入日期
      out[x.i] = rec;
    });
  });
  return { tpls: tpls, sats: out.filter(Boolean) };
}

// V1.9.0：6 位编目号对象的"占位号 → 真号"映射（由 refresh.mjs 落盘）。
//   为什么要它：经典 TLE 的编目号字段只有 5 列，装不下 6 位号，所以 6 位对象是**用占位号**写进
//   .tle 的（见 scripts/omm.mjs）；这里把真号写回 `id`，前端照旧用自己的 id 字段显示，**零改动**。
const OMM_IDS = (() => {
  try { return JSON.parse(fs.readFileSync(`${D}/omm_norad.json`, 'utf8')); } catch (e) { return {}; }
})();
function parse(file) {
  const lines = fs.readFileSync(`${D}/${file}`, 'utf8').split('\n').map(l => l.trim()).filter(l => l);
  const out = [];
  for (let i = 0; i + 2 < lines.length; i += 3) {
    const name = lines[i].trim();
    const l1 = lines[i + 1], l2 = lines[i + 2];
    if (!l1.startsWith('1 ') || !l2.startsWith('2 ')) continue;
    const raw = l1.slice(2, 7);
    out.push({ name, id: OMM_IDS[raw] || parseInt(raw, 10), c: l1.slice(9, 17).trim(), l1, l2 });
  }
  return out;
}

const gw = parse('ct_hulianwang.tle');
const qf = parse('ct_qianfan.tle');
console.log('gw sats=', gw.length, 'qf sats=', qf.length);

// 校验：所有 COSPAR 前缀都有元数据
for (const [tag, sats, meta] of [['GW', gw, GW_LAUNCH], ['QF', qf, QF_LAUNCH]]) {
  const missing = [...new Set(sats.map(s => s.c.slice(0, 5)))].filter(k => !meta[k]);
  console.log(`${tag} missing launch meta:`, missing.join(',') || 'none');
}

// 每个批次的火箭分段链接与发射场链接
function linkMap(meta) {
  const out = {};
  Object.keys(meta).forEach(function (k) {
    out[k] = { r: rocketSegs(meta[k][2]), s: siteLink(meta[k][3]) };
  });
  return out;
}

// 待编目批次的可公开摘要（来自 data/satcat.csv：周期 / 倾角 / 近远地点 / 临时编号段）
// 说明：这些对象在目录里已有临时编号（100xxx）与摘要轨道参数，但公开渠道不发布其完整 TLE，
// 因此页面只能给出这些摘要，无法推算位置。
// ---------------------------------------------------------------- V1.9.1（执行顺序 1.7）：搭车星排除表
// 为什么需要：`pendingSummary` 是按 **satcat 的 COSPAR 前缀**数 PAY 的，而**同一次发射**里
//   完全可能有"不属于本星座"的载荷 —— 它们共享前缀，于是被一并数进来，导致该批次的颗数虚高。
//   实例（1.7 明确点名的）：`2026-128` = 千帆 DTC-01(A) + **中国移动02星(B)**，
//   词条只把 DTC-01 记入千帆名单 → 该批应是 **1 颗**，而 satcat 数出 **2 颗**。
//   而 `launchedTotal` 取 `max(counts.n, 库内颗数)`，于是这个 2 会**覆盖**掉正确的 1。
// 口径来源：卫星百科词条表格（唯一名单）+ 任务清单 Q25。
const STOWAWAY = {
  '26128': [69473],   // 2026-128B = 中国移动02星（词条不计入千帆）
  '24226': [62185]    // 2024-226A = 搭车星（词条 COSPAR 列虽写 A，但轨道高度指向 B；详见 V1.9.1_1.6 核对表）
};
function isStowaway(batchKey, norad) {
  const l = STOWAWAY[batchKey];
  return !!(l && l.indexOf(Number(norad)) >= 0);
}

function pendingSummary(keys, slim) {
  const file = `${D}/satcat.csv`;
  if (!fs.existsSync(file)) return {};
  const rows = fs.readFileSync(file, 'utf8').split('\n');
  const head = rows[0].split(',');
  const ix = n => head.indexOf(n);
  const iId = ix('OBJECT_ID'), iNo = ix('NORAD_CAT_ID'), iTy = ix('OBJECT_TYPE');
  const iPer = ix('PERIOD'), iInc = ix('INCLINATION'), iApo = ix('APOGEE'), iPeg = ix('PERIGEE');
  const iNm = ix('OBJECT_NAME');
  const acc = {};
  rows.slice(1).forEach(line => {
    if (!line) return;
    const c = line.split(',');
    const m = (c[iId] || '').trim().match(/^(\d{4})-(\d+)/);
    if (!m) return;
    const key = m[1].slice(2) + String(+m[2]).padStart(3, '0');
    if (!keys.includes(key)) return;
    (acc[key] = acc[key] || []).push({
      norad: +c[iNo], type: c[iTy], per: +c[iPer], inc: +c[iInc], apo: +c[iApo], peg: +c[iPeg],
      name: (c[iNm] || '').trim(), cospar: (c[iId] || '').trim()
    });
  });
  const out = {};
  keys.forEach(k => {
    const list = (acc[k] || []).filter(r => r.type === 'PAY' && !isStowaway(k, r.norad));
    if (!list.length) return;
    // V1.3.7：只问「这批发射了几颗」的调用方（顶部计数）用 slim，省掉每批几百字节的摘要字段
    if (slim) { out[k] = { n: list.length }; return; }
    const norads = list.map(r => r.norad).sort((a, b) => a - b);
    const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
    // 对象名：目录里这些对象多被编成 "GUOWANG 24 OBJECT A/B/C" 一类通用名，
    // 但也有已命名的（HULIANWANG DIGUI-178 …）。取首末两个做区间展示。
    const names = list.map(r => r.name).filter(Boolean);
    out[k] = {
      n: list.length,
      noradMin: norads[0], noradMax: norads[norads.length - 1],
      cospar: '20' + k.slice(0, 2) + '-' + k.slice(2),
      nm: names.length ? (names[0] === names[names.length - 1] ? [names[0]] : [names[0], names[names.length - 1]]) : [],
      period: +avg(list.map(r => r.per)).toFixed(2),
      inc: +avg(list.map(r => r.inc)).toFixed(2),
      apogee: Math.round(avg(list.map(r => r.apo))),
      perigee: Math.round(avg(list.map(r => r.peg)))
    };
  });
  return out;
}

// 已编目批次前缀集合：待编目数量按「该批次前缀是否已出现在 TLE 里」动态计算，
// 这样刷新数据后，原本待编目的批次一旦发布轨道要素就会自动转正。
function havePrefix(sats) { return new Set(sats.map(s => s.c.slice(0, 5))); }
const gwHave = havePrefix(gw), qfHave = havePrefix(qf);
function activePending(declared, have) {
  const out = {};
  Object.keys(declared).forEach(k => { if (!have.has(k)) out[k] = declared[k]; });
  return out;
}

const gwPend = activePending(GW_PENDING, gwHave), qfPend = activePending(QF_PENDING, qfHave);
const gwSum = pendingSummary(Object.keys(gwPend)), qfSum = pendingSummary(Object.keys(qfPend));
// 有目录摘要的批次，颗数以目录里的实际有效载荷数为准（声明值只作为没有摘要时的兜底）
Object.keys(gwSum).forEach(k => { if (gwPend[k]) gwPend[k] = gwSum[k].n; });
Object.keys(qfSum).forEach(k => { if (qfPend[k]) qfPend[k] = qfSum[k].n; });

// 每批「发射时搭载的卫星数」：以目录里的有效载荷数为准，缺则回落到已有 TLE 数。
// 用于顶部信息栏的「发射卫星数量」。
const gwCounts = pendingSummary(Object.keys(GW_LAUNCH), true), qfCounts = pendingSummary(Object.keys(QF_LAUNCH), true);
function launchedTotal(launchKeys, counts, satsByPrefix) {
  return launchKeys.reduce(function (a, k) {
    var n = counts[k] ? counts[k].n : 0;
    return a + Math.max(n, (satsByPrefix[k] || []).length);
  }, 0);
}
function groupPrefix(sats) {
  const m = {};
  sats.forEach(s => { const p = s.c.slice(0, 5); (m[p] = m[p] || []).push(s); });
  return m;
}
const gwByPrefix = groupPrefix(gw), qfByPrefix = groupPrefix(qf);

// 本页实际追踪到的成功发射批次数（有 TLE 或已编为待分析对象）。
// 注意：这只是「本页口径」，不等于星座的真实发射次数 —— 顶部的权威次数取自词条的 WIKI_STAT。
function launchStat(launchKeys, byPrefix, pendingKeys) {
  const ok = launchKeys.filter(k => (byPrefix[k] || []).length > 0 || pendingKeys.indexOf(k) >= 0).length;
  return { success: ok, total: ok };
}
// 顶部信息栏：只保留本页口径的「发射卫星数量」；在轨数与发射次数以词条为准（见 WIKI_STAT）。
function statsFor(launchKeys, counts, byPrefix, pend) {
  return {
    launched: launchedTotal(launchKeys, counts, byPrefix),
    launches: launchStat(launchKeys, byPrefix, Object.keys(pend))
  };
}
const gwStats = statsFor(Object.keys(GW_LAUNCH), gwCounts, gwByPrefix, gwPend);
const qfStats = statsFor(Object.keys(QF_LAUNCH), qfCounts, qfByPrefix, qfPend);
console.log('stats gw=', JSON.stringify(gwStats.launched), '/', gwStats.launches.success + '-' + gwStats.launches.total);
console.log('stats qf=', JSON.stringify(qfStats.launched), '/', qfStats.launches.success + '-' + qfStats.launches.total);
console.log('pending summary gw=', JSON.stringify(gwSum));
console.log('pending summary qf=', JSON.stringify(qfSum));
// 卫星百科词条口径（构建期静态引用，2026-09-30 抓取，来源：词条「星网」「千帆星座」统计栏）。
// 页面顶部的三项计数一律以词条为准，括号内的分项**照搬词条原文**（不改写、不加"＝"、不追加本页口径）。
// 已做的核对（详见 PROCESS.md §19）：
//  · 星网：试验星 12 次发射（含 2025-08-15 朱雀二号E Y3 失利 4 颗）+ 业务星 29 次 = 41 次发射 / 40 次成功；
//    部署 32（试验星）+ 3（高轨）+ 213（低轨 26 组）= 248；扣掉失利的 4 颗 → 在轨 244。与词条完全一致。
//  · 千帆：试验星 6 颗（3 次发射）+ 组网星 256 颗（16 次发射）= 262；共 19 次发射且全部成功。与词条完全一致。
//  · 用完整的 NORAD 目录（data/satcat.csv）逐批比对：每个 COSPAR 前缀下的 PAY 数与词条颗数逐批吻合
//    （2026-211 一箭 9 个 PAY = 极轨26组 8 + EUHT 试验星 1，正好解释词条"8"与目录"9"的差）。
//  · 词条 44 个 COSPAR 前缀里有 22 个不在 CelesTrak 的 hulianwang / qianfan 分组中
//    （星网试验星、高轨星、4 个待编目组；千帆 3 组试验星与 2 个待编目组）—— 这正是本页
//    「有完整轨道要素、能推算位置」的卫星数少于词条在轨数的原因，不是数据错误。
// V1.8.0（需求14）★ 优先用 scripts/fetch_wiki.mjs 抓到的**最新**词条统计（工作区根目录 wiki.json）。
//   旧版这里只认下面那份静态值 → 每次构建都把词条计数与日期写回"上一次人工核对的那天"，
//   于是"每次更新都注入最新卫星百科数据"永远不成立（页面上「卫星百科更新」会一直停在旧日期）。
//   现在：抓到新数据就用新的（静态那份降级为兜底 + 断网时的保底）。
let WIKI_FETCHED = null;
try {
  const w = JSON.parse(fs.readFileSync(path.join(ROOT, 'wiki.json'), 'utf8'));
  if (w && w.gw && w.qf && w.gw.launched && w.qf.launched) WIKI_FETCHED = w;
} catch (e) {}
const WIKI_STATIC = {
  gw: {
    asOf: '2026-09-30',
    article: '星网',
    launched: { n: 248, zh: '试验星32 + 高轨业务星3 + 低轨业务星213', en: 'test 32 + GEO service 3 + LEO service 213' },
    inOrbit: { n: 244, zh: '试验星28 + 高轨业务星3 + 低轨业务星213', en: 'test 28 + GEO service 3 + LEO service 213' },
    launches: '40/41'
  },
  qf: {
    asOf: '2026-09-30',
    article: '千帆星座',
    launched: { n: 262, zh: '试验星6，组网星256', en: 'test 6, network 256' },
    inOrbit: { n: 262, zh: '试验星6，组网星256，理论值', en: 'test 6, network 256, theoretical' },
    launches: '19/19'
  }
};
const WIKI_CHECKED_AT = (WIKI_FETCHED && WIKI_FETCHED.checkedAt) || '';
if (WIKI_FETCHED) console.log('词条统计：用抓取到的最新值（asOf ' + WIKI_FETCHED.asOf + '，核对 ' + (WIKI_CHECKED_AT || '未记') + '）');
else console.warn('词条统计：没读到工作区 wiki.json，退回内置静态值（asOf ' + WIKI_STATIC.gw.asOf + '）');
// 页面/产物统一读这份（抓取值优先，逐字段覆盖静态兜底）
const WIKI_STAT = {
  gw: Object.assign({}, WIKI_STATIC.gw, (WIKI_FETCHED && WIKI_FETCHED.gw) || {}),
  qf: Object.assign({}, WIKI_STATIC.qf, (WIKI_FETCHED && WIKI_FETCHED.qf) || {})
};
// V1.3.7：轨道要素按批次差分打包（satdata.json 直接小掉约三分之一），页面端负责还原
const gwPack = pack(gw), qfPack = pack(qf);
console.log('差分打包：gw', JSON.stringify(gwPack.sats).length + JSON.stringify(gwPack.tpls).length,
  'bytes（原', JSON.stringify(gw).length, '）｜qf',
  JSON.stringify(qfPack.sats).length + JSON.stringify(qfPack.tpls).length, 'bytes（原', JSON.stringify(qf).length, '）');

// V1.4.2：研发机构（制造方）—— 来自词条表格，由 mkmaker.mjs 抓取缓存到 data/makers.json。
// 先按 COSPAR 精确匹配，匹配不到再用发射日期兜底；两者都没有就留空（前端不显示这一格）。
function makerOf(key, dateStr) {
  if (!MAKERS) return null;
  const cospar = '20' + key.slice(0, 2) + '-' + key.slice(2);          // 24240 → 2024-240
  let hit = MAKERS.byCospar[cospar];
  if (!hit && dateStr) {
    const d = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);       // 2024-08-06T14:42
    if (d) hit = MAKERS.byDate[d[1] + '-' + d[2] + '-' + d[3]];
  }
  return hit ? { m: hit.maker, u: hit.url, ls: (hit.links || []).filter(function (x) { return x.n && x.u; }) } : null;
}
function makerMap(launches) {
  const out = {};
  Object.keys(launches).forEach(k => {
    const v = launches[k];
    const hit = makerOf(k, v && v[1]);
    if (hit) out[k] = hit;
  });
  return out;
}

const DATA = {
  generated: new Date().toISOString(),
  source: 'CelesTrak GP（NORAD 空间目标目录）· 多源补漏（分组 + 名称 + 编号反查）',
  gw: {
    key: 'gw', name: '星网', en: 'SatNet / CSCN', org: '中国卫星网络集团有限公司',
    sub: '低轨互联网星座',
    launches: GW_LEDGER, pending: gwPend, pendingInfo: gwSum, launchCounts: gwCounts, stats: gwStats,
    // V1.9.1（1.7）：按批次的"已再入"清单（动态；页面据此标注批次行、并在在轨数量里扣除）
    goneCount: goneCountsOf(Object.keys(GW_LAUNCH)),
    wiki: WIKI_STAT.gw,
    links: linkMap(GW_LAUNCH),
    makers: makerMap(GW_LAUNCH),
    sats: gwPack.sats, tleTpl: gwPack.tpls,
  },
  qf: {
    key: 'qf', name: '千帆', en: 'Qianfan / Thousand Sails (G60)', org: '上海垣信卫星科技有限公司',
    sub: '低轨互联网星座',
    launches: QF_LEDGER, pending: qfPend, pendingInfo: qfSum, launchCounts: qfCounts, stats: qfStats,
    goneCount: goneCountsOf(Object.keys(QF_LAUNCH)),
    wiki: WIKI_STAT.qf,
    links: linkMap(QF_LAUNCH),
    makers: makerMap(QF_LAUNCH),
    sats: qfPack.sats, tleTpl: qfPack.tpls,
  },
  urls: URLS,
};

fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });

// ---------------------------------------------------------------- V1.9.0（R17）：历史轨道要素
// data/history/<批次key>.json 里是 [norad, 历元ms, 半长轴km] 三元组（由 scripts/import_history.mjs 写入）。
// 这里只做「读进来 + 按天去重」，让页面端拿到即可直接画。
// ★ V1.9.1：**已删除量级过滤**（原为 `sma < 6700 || sma > 12000` 丢弃）—— 用户口径是
//   "历史数据不得过滤，真实记录并如实呈现"。当时加这个过滤，真正的原因是**源库里有坏数据**
//   （scripts/fetch_history.mjs 的 tle2omm 把偏心率从 l1 读出来，0.96 的 e 把高度算成几千 km）；
//   用过滤把坏数据挡在门外，等于让 `sma` 越界成为"正常现象"，**把 bug 永久掩埋**：
//   越是加过滤，越没人去查为什么会有 8 万 km 的卫星。
//   正确做法是把 generation source 修对（已修，见该处注释），然后**如实呈现**。
//   现在只保留两类**非过滤**的丢弃：① 记录结构非法（长度/非数值）；② 批次 key 不在台账里。
//   同一天多条取哪个：同一个 norad+日期只留**最后**一条（同日多条 TLE 是轨道解算的重复发布，
//   取最新 —— 这与用户"一天存一条、当天多条取平均"的口径在下游 densify/取点上等效，
//   因为源库存的本来就是按天抽样后的代表点）。
function loadHistory() {
  const dir = path.join(ROOT, 'data', 'history');
  const out = { gw: {}, qf: {} };
  const stat = { shards: 0, recs: 0, dropped: 0, days: 0 };
  if (!fs.existsSync(dir)) return { out, stat };
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json') || f.endsWith('.bak')) continue;
    const key = f.slice(0, -5);
    let arr;
    try { arr = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { continue; }
    if (!Array.isArray(arr) || !arr.length) continue;
    const byNorad = new Map();
    for (const r of arr) {
      if (!r || r.length < 3) { stat.dropped++; continue; }
      const norad = r[0] | 0, ms = +r[1], sma = +r[2];
      if (!norad || !isFinite(ms) || !isFinite(sma)) { stat.dropped++; continue; }
      const day = Math.floor(ms / 86400000);
      if (!byNorad.has(norad)) byNorad.set(norad, new Map());
      byNorad.get(norad).set(day, [norad, ms, Math.round(sma * 100) / 100]);
    }
    // 批次 key 本身决定归属：与两个星座的 launches 里出现过的 key 精确匹配
    const bucket = HIST_KEYS[key];
    if (!bucket) { stat.dropped += arr.length; continue; }
    const target = out[bucket.key];
    const perLaunch = {};
    for (const [, days] of byNorad) {
      for (const [, rec] of days) {
        (perLaunch[rec[0]] || (perLaunch[rec[0]] = [])).push(rec);
        stat.recs++;
      }
    }
    let had = false;
    for (const norad in perLaunch) {
      perLaunch[norad].sort((a, b) => a[1] - b[1]);
      (target[key] || (target[key] = [])).push(...perLaunch[norad]);
      had = true;
      stat.days += perLaunch[norad].length;
    }
    if (had) stat.shards++;
  }
  for (const bk of ['gw', 'qf']) {
    for (const key in out[bk]) out[bk][key].sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  }
  return { out, stat };
}
// 批次 key → 星座。
// ⚠️ GW_LEDGER / QF_LEDGER 是**对象**（形如 { "23095": [名称, 日期, 火箭, 场坪, 倾角, 结果], … }），
//   不是数组 —— 键本身就是批次 key（COSPAR 后 5 位），与 data/history/<key>.json 同名。
//   旧写法 `for (const L of LED)` 会当场抛 "LED is not iterable"。
const HIST_KEYS = {};
for (const [bk, LED] of [['gw', GW_LEDGER], ['qf', QF_LEDGER]]) {
  for (const k of Object.keys(LED || {})) HIST_KEYS[k] = { key: bk };
}
const HIST = loadHistory();

// ---------------------------------------------------------------- V1.9.0（R17）：历史库**外挂**
// 历史数据会随天数线性增长（见 scripts/histstore.mjs 的容量治理），塞进单文件 HTML
// 会让页面逐年膨胀到几十 MB。所以走和 wiki.json 同一套路：
//   · **外挂 build/history.json** —— 与 HTML 同目录托管，页面加载后 fetch 覆盖，完整版；
//   · **satdata 里只留一份精简兜底**（BUNDLE_* 口径）—— 保证本地 file:// 双击打开也有曲线可看。
// 两者都经过同一套 pruneRecords 容量治理，故任何一边都不会失控。
const NOW_MS = Date.now();
const BUNDLE_DAYS = 60;      // 内置兜底只留最近 60 天
const BUNDLE_STEP = 2;       // 内置兜底每 2 天一点（≈30 点/星）
function bundleLite(hist) {
  const out = {};
  for (const lk of Object.keys(hist || {})) {
    const cut = (hist[lk] || []).filter(r => isFinite(r[1]) && (NOW_MS - r[1]) <= BUNDLE_DAYS * 86400000);
    if (!cut.length) continue;
    // 按 BUNDLE_STEP 天抽稀：从最新往回每 N 天留一点（与 pruneSat 同思路，但用固定档）
    const bySat = new Map();
    for (const r of cut) {
      if (!bySat.has(r[0])) bySat.set(r[0], []);
      bySat.get(r[0]).push(r);
    }
    const kept = [];
    for (const [norad, rs] of bySat) {
      rs.sort((a, b) => a[1] - b[1]);
      let lastKept = Infinity;
      for (let i = rs.length - 1; i >= 0; i--) {
        if (lastKept === Infinity || lastKept - rs[i][1] >= BUNDLE_STEP * 86400000 * 0.999) {
          kept.push(rs[i]); lastKept = rs[i][1];
        }
      }
      if (kept.length && kept[kept.length - 1][1] !== rs[0][1]) kept.push(rs[0]);   // 起点也留
    }
    if (kept.length) out[lk] = kept.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  }
  return out;
}
// ① 外挂：按**批次分片** + 索引（v2 紧凑编码）
//   ⚠️ 规模重估（V1.9.0）：不做分片的话，10 万颗 × 20 年会是 2.26 GB —— 单文件超 GitHub 100MB 硬限，
//   页面更不可能一次加载。分片后：页面只取选中的那一个批次（几十 KB），总量再大也不影响速度。
//   编码与采样策略见 scripts/histpack.mjs（变化驱动 + 分层 + 稳定期配额，10 万颗×20 年 ≈ 42 MB）。
const HIST_OUT = path.join(ROOT, 'build', 'history');
fs.rmSync(HIST_OUT, { recursive: true, force: true });
fs.mkdirSync(HIST_OUT, { recursive: true });
let packTotal = { before: 0, after: 0, bytes: 0, batches: 0 };
for (const bk of ['gw', 'qf']) {
  const pk = packAll(HIST.out[bk], NOW_MS);
  fs.writeFileSync(path.join(HIST_OUT, 'index-' + bk + '.json'), JSON.stringify(pk.index), 'utf8');
  let dirBytes = 0;
  for (const lk of Object.keys(pk.shards)) {
    const s = JSON.stringify(pk.shards[lk]);
    fs.writeFileSync(path.join(HIST_OUT, bk + '-' + lk + '.json'), s, 'utf8');
    dirBytes += s.length;
  }
  packTotal.before += pk.stats.before; packTotal.after += pk.stats.after;
  packTotal.bytes += dirBytes + JSON.stringify(pk.index).length;
  packTotal.batches += pk.index.batches.length;
  console.log('  历史打包 ' + bk + '：' + pk.index.batches.length + ' 批 / ' + pk.stats.after + ' 点 / ' +
    (dirBytes / 1024).toFixed(1) + ' KB（原始 ' + pk.stats.before + ' 点）');
}
console.log('history/（外挂分片）' + packTotal.batches + ' 批  ' + packTotal.after + ' 点  ' +
  (packTotal.bytes / 1024).toFixed(1) + ' KB  （治理前 ' + packTotal.before + ' 点）');

// ② satdata 里只留精简兜底（离线 file:// 打开也能看到曲线）
const histLite = { gw: {}, qf: {} };
['gw', 'qf'].forEach(bk => { histLite[bk] = bundleLite(HIST.out[bk]); });

// ② satdata 里只留精简兜底（离线 file:// 打开也能看到曲线）
DATA.gw.hist = histLite.gw;
DATA.qf.hist = histLite.qf;
const liteN = Object.keys(histLite.gw).concat(Object.keys(histLite.qf))
  .reduce((a, k) => a + ((histLite.gw[k] || histLite.qf[k] || []).length), 0);
console.log('history: 分片 ' + HIST.stat.shards + '  历史点 ' + HIST.stat.days +
  '  丢弃 ' + HIST.stat.dropped + '  (gw ' + Object.keys(HIST.out.gw).length +
  ' 批 / qf ' + Object.keys(HIST.out.qf).length + ' 批)  → 内置精简 ' + liteN + ' 条');

fs.writeFileSync(path.join(ROOT, 'build', 'satdata.json'), JSON.stringify(DATA), 'utf8');
console.log('satdata.json bytes=', fs.statSync(path.join(ROOT, 'build', 'satdata.json')).size);

// V1.4.0：单独导出一份 wiki.json —— 它跟 HTML 放在同一个目录时，页面打开会自动读它并覆盖内置的词条计数。
// 用途：把这一小段 JSON 传到 GitHub Pages / 任意静态托管，以后只改这里的数字，
// 所有访客刷新就能看到新统计，不需要重新构建 HTML，也不需要我维护任何自动更新。
const WIKI_JSON = {
  _readme: '改这里就能更新网页顶部的词条计数（launched=已发射, inOrbit=在轨, launches=发射成功/总）。改完保存，访客刷新即可看到。',
  asOf: WIKI_STAT.gw.asOf,
  checkedAt: WIKI_CHECKED_AT,
  gw: WIKI_STAT.gw,
  qf: WIKI_STAT.qf
};
fs.writeFileSync(path.join(ROOT, 'build', 'wiki.json'), JSON.stringify(WIKI_JSON, null, 1), 'utf8');
console.log('wiki.json bytes=', fs.statSync(path.join(ROOT, 'build', 'wiki.json')).size);
