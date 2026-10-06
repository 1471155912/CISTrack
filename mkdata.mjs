import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
    list.forEach((x, k) => { out[x.i] = { id: sats[x.i].id, c: sats[x.i].c, d: g.diffs[k] }; });
  });
  return { tpls: tpls, sats: out.filter(Boolean) };
}

function parse(file) {
  const lines = fs.readFileSync(`${D}/${file}`, 'utf8').split('\n').map(l => l.trim()).filter(l => l);
  const out = [];
  for (let i = 0; i + 2 < lines.length; i += 3) {
    const name = lines[i].trim();
    const l1 = lines[i + 1], l2 = lines[i + 2];
    if (!l1.startsWith('1 ') || !l2.startsWith('2 ')) continue;
    out.push({ name, id: parseInt(l1.slice(2, 7), 10), c: l1.slice(9, 17).trim(), l1, l2 });
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
    const list = (acc[k] || []).filter(r => r.type === 'PAY');
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
const WIKI_STAT = {
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
    launches: GW_LAUNCH, pending: gwPend, pendingInfo: gwSum, launchCounts: gwCounts, stats: gwStats,
    wiki: WIKI_STAT.gw,
    links: linkMap(GW_LAUNCH),
    makers: makerMap(GW_LAUNCH),
    sats: gwPack.sats, tleTpl: gwPack.tpls,
  },
  qf: {
    key: 'qf', name: '千帆', en: 'Qianfan / Thousand Sails (G60)', org: '上海垣信卫星科技有限公司',
    sub: '低轨互联网星座',
    launches: QF_LAUNCH, pending: qfPend, pendingInfo: qfSum, launchCounts: qfCounts, stats: qfStats,
    wiki: WIKI_STAT.qf,
    links: linkMap(QF_LAUNCH),
    makers: makerMap(QF_LAUNCH),
    sats: qfPack.sats, tleTpl: qfPack.tpls,
  },
  urls: URLS,
};

fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'build', 'satdata.json'), JSON.stringify(DATA), 'utf8');
console.log('satdata.json bytes=', fs.statSync(path.join(ROOT, 'build', 'satdata.json')).size);

// V1.4.0：单独导出一份 wiki.json —— 它跟 HTML 放在同一个目录时，页面打开会自动读它并覆盖内置的词条计数。
// 用途：把这一小段 JSON 传到 GitHub Pages / 任意静态托管，以后只改这里的数字，
// 所有访客刷新就能看到新统计，不需要重新构建 HTML，也不需要我维护任何自动更新。
const WIKI_JSON = {
  _readme: '改这里就能更新网页顶部的词条计数（launched=已发射, inOrbit=在轨, launches=发射成功/总）。改完保存，访客刷新即可看到。',
  asOf: WIKI_STAT.gw.asOf,
  gw: WIKI_STAT.gw,
  qf: WIKI_STAT.qf
};
fs.writeFileSync(path.join(ROOT, 'build', 'wiki.json'), JSON.stringify(WIKI_JSON, null, 1), 'utf8');
console.log('wiki.json bytes=', fs.statSync(path.join(ROOT, 'build', 'wiki.json')).size);
