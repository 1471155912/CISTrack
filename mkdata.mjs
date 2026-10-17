import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// V1.9.0（R17）：历史库的容量治理与发布打包，见 scripts/histstore.mjs / scripts/histpack.mjs
import { pruneRecords, CAP } from './scripts/histstore.mjs';
import { packAll } from './scripts/histpack.mjs';
// V1.9.1（A19）：搜索补池（dead / pend）
import { searchPools } from './scripts/search_pools.mjs';
// V1.9.5（H10 ③b）：升轨阶段判定（两条竖虚线的数据）—— 与 app.js 同名函数同口径（smoke 有跨端对拍）
import { climbPhases } from './scripts/climb.mjs';
const ROOT = path.dirname(fileURLToPath(import.meta.url));   // 脚本所在目录（发布包内任意位置可用）
const D = path.join(ROOT, 'data');

// ---------------------------------------------------------------- V1.9.1：satcat 缺失必须"喊出来"
// `data/satcat.csv` 是 .gitignore 的（6.7 MB，由 refresh.mjs 下载），但它支撑**三处功能**：
//   ① 已再入标记 `st:'r'` / `dt`（1.4-D）  ② 台账"已再入"扣减 `goneCount`（1.7）  ③ 搜索补池 dead/pend（A19）
// 它一旦缺失，上面三处**全部静默退化成空**：不报错、构建照常成功、产物看起来完全正常。
// 2026-10-10 实际发生过一次（文件不在回收站，来源不明）→ 本地重建时 `st:'r'` 一条都没有，
// 差一步就把"已再入功能失效"的产物提交上去了。→ 现在显式探测：打印醒目横幅 + 写进产物供断言。
const SATCAT = path.join(D, 'satcat.csv');
const SATCAT_OK = fs.existsSync(SATCAT);
if (!SATCAT_OK) {
  console.warn('\n⚠️⚠️⚠️ satcat.csv 缺失 —— 以下功能会**静默失效**（产物缺内容，但不会报错）：');
  console.warn('    ① 已再入标记（st/dt）  ② 台账已再入扣减（goneCount）  ③ 搜索补池（dead/pend）');
  console.warn('    恢复办法：node refresh.mjs --force-cat（或从其它工作区拷一份 data/satcat.csv）\n');
}

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
// ★ V1.9.5（H9）：**百科单源** data/wiki_tables.json —— 由 scripts/fetch_wiki_tables.mjs 抓
//   「星网 / 千帆星座」词条表生成（**进 git**，CI 也读它，与 wiki.json / wiki_launches.json 同地位）。
//   · 日期时间一律是词条原口径 **GMT+8**（`2026年10月10日03:27`）—— 与页面端 build() 的
//     `Date.parse(v[1] + ':00+08:00')` 同口径，全链路一个时区。
//   · ⚠️ 为什么必须单源：wiki_launches.json（引导页:发射记录）记的是 **UTC** 日期 ——
//     同一次发射两边能差一天（2026-230：词条 10-10 03:27 vs 发射记录 10-09）。
//     自动补录一旦取了后者，**日期就错**（H9 报的重大问题即此）。
let WIKI_TABLES = { gw: {}, qf: {} };
try {
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'wiki_tables.json'), 'utf8'));
  if (j && typeof j === 'object') WIKI_TABLES = j;
} catch (e) {
  console.warn('⚠️ data/wiki_tables.json 读不到（' + (e.code || e.message) + '）：日期回退到台账/发射记录口径。' +
    '根治：跑 node scripts/fetch_wiki_tables.mjs（H9 单源）。');
}
function mergeResults(meta) {
  const out = {};
  Object.keys(meta).forEach(function (k) {
    // ⚠️ V1.9.4：不能只 slice(0,5) —— 第 6/7 位是 res/n，第 8 位是自动补录标记
    //   （'auto'/'auto,day'/'auto,tle'，见 autoFillLedger）。旧口径 slice(0,5) 会把标记截丢，
    //   导致页面/断言看不到"这条是自动补的"。
    const v = meta[k].slice(0, 8);
    if (meta[k][8]) v[8] = meta[k][8];
    const full = '20' + k.slice(0, 2) + '-' + k.slice(2);
    const w = WIKI_LAUNCHES[full];
    if (w && w.res && w.res !== '?') v[5] = w.res;          // 百科有明确结果 → 以百科为准
    else if (w && w.res === '?' && !v[5]) v[5] = '?';       // 百科有这一发但没写结果
    if (w && w.n) v.push(w.n);                              // 百科写了颗数才带上
    out[k] = v;
  });
  return out;
}
// 把百科行的载荷名规范化成**手工台账同款批次名**：
//   '卫星互联网低轨27组 (9)'      → '低轨27组'
//   '卫星互联网低轨27组（共9颗）'  → '低轨27组'
//   '千帆极轨19组卫星（共10颗）'   → '极轨19组'
//   '卫星互联网技术试验卫星11组A星~D星（4颗）' → '试验星11组'
// 为什么要规范化：页面端 batchName() 的英文翻译是**精确匹配**（^低轨(\d+)组$ 等），
//   百科原文带前缀/颗数后缀 → 匹配不上 → 英文界面直接漏出中文（i18n 审计当场抓到）。
// ⚠️ 只做"去前缀 + 去颗数"这类**无损**压缩；解析不出标准形态就原样返回（宁可不译也不瞎编）。
function normBatchName(payload) {
  let s = String(payload || '').trim();
  if (!s) return '';
  s = s.replace(/[（(]\s*(?:共)?\s*\d{1,3}\s*颗?\s*[)）]\s*$/,'')   // 去尾部「(9)」「（共10颗）」
         .replace(/\s*\(\s*\d{1,3}\s*\)\s*$/,'')                   // 再去一次兜底（ defensive ）
         .trim();
  s = s.replace(/^卫星互联网技术试验卫星\s*/,'试验星')               // 技术试验卫星 → 试验星
         .replace(/^卫星互联网\s*/,'')                              // 去掉星座前缀
         .replace(/^千帆\s*/,'')
         .replace(/卫星$/,'组')                                     // 「低轨27组卫星」→「低轨27组」
         .replace(/组卫星$/,'组')
         .trim();
  return s;
}
// ★★ V1.9.4：**给台账自动补新批次**（用户报的"新录入卫星没有批次/组号、制造商、在轨日"的真因）
//
// 旧管线的窗口期问题：新批次先在 CelesTrak 编目（TLE 里有星）→ 人再往 GW_LAUNCH/QF_LAUNCH
//   补元数据。窗口期内 `missing launch meta` 只打一行日志，页面显示「无台账」——
//   于是没有批次名、没有制造商、没有发射日期 → **在轨天数也算不出来**（ageText 用 L.dateMs）。
//
// 新做法：对「目录里已有卫星（satdata.sats）但台账缺失」的 COSPAR 前缀，按两个来源补：
//   A. **卫星百科发射记录行**（wiki_launches.json，V1.9.4 起保留整行拆列）—— 最全，有日期/火箭/发射场/词条链接；
//   B. **TLE 名称里的组号**（兜底）—— 百科还没收录该发时用。星网 TLE 名形如 `GUOWANG 27 OBJECT B`
//      （国网第 27 组）、千帆形如 `SPACESAIL ...` / `QIANFAN ...`，可解析出组号与批次名。
//      ★ 实测案例：26230 批 7 颗（100973~100981）在目录里、百科 2026 页**尚无该行**，
//        但 TLE 名已写明 `GUOWANG 27` → 由此得批次名「低轨27组」。
//
// A 的合成字段（wiki 有该行时）：
//     [0] 批次名    = normBatchName(payload)（去星座前缀/颗数后缀，规范成手工台账同款，见该函数）
//     [1] 发射时间  = date + 'T00:00'（百科只记到日，时刻未知 → 记当天 00:00 并标 `_dayOnly`）
//     [2] 火箭      = rocket 原文
//     [3] 发射场    = site 原文
//     [4] 目标倾角  = 0（未知；页面端对 0 走「—」分支，见 launchRowHtml）
//     [5] 结果      = wiki 的 res
//     [6] 颗数      = wiki 的 n
//     [7] 词条链接  = u（payload 格的 <a>）
//   `_auto: 1` 标记这条是自动补的（页面显示「自动补录」小标，提醒人工核对）。
//
// B 的合成字段（仅 TLE 名可解析时）：[0]=「低轨NN组」/「极轨NN组」，[1]=''（无日期，页面显示 —），
//   [4]=0，其余留空。`_auto:1, _tleName:1`。
function autoFillLedger(meta, tag, sats) {
  const have = new Set(Object.keys(meta));
  // 目录里已有卫星的 COSPAR 前缀 → '26230'
  // ⚠️ 两种形态都要认：TLE 的 l1 第 10-17 列是 `26230A`（**无连字符**），
  //   而 satdata/satcat 侧是 `2026-230`（带连字符）。这里统一取前 5 位数字。
  const inCat = new Set();
  (sats || []).forEach(function (s) {
    const c = String(s.c || '').replace(/[^0-9A-Za-z-]/g, '');
    // 两种形态：TLE 短式 `26230A`（YYDDD + 后缀字母）/ 全式 `2026-230`。
    //   台账键 = 后 5 位数字：短式直接取前 5 位；全式去掉连字符与世纪前缀。
    let m = c.match(/^(\d{2})(\d{3})[A-Za-z]?$/);                 // 26230A → 26 + 230
    if (m) { inCat.add(m[1] + m[2]); return; }
    m = c.match(/^(\d{4})-(\d{3})/);                              // 2026-230
    if (m) inCat.add(m[1].slice(2) + m[2]);
  });
  const added = [];
  Object.keys(WIKI_LAUNCHES).forEach(function (full) {          // '2026-230'
    // ⚠️ '2026-230' → '26230'：去掉连字符、去掉世纪前缀（20），得到 5 位台账键。
    //   旧写法 full.slice(5) 得到 '230'，永远匹配不上 inCat 里的 '26230'。
    const key = full.replace('-', '').slice(2);                 // '26230'
    if (have.has(key) || !inCat.has(key)) return;
    const w = WIKI_LAUNCHES[full];
    if (!w.date) return;                                        // 拆列失败的行不补（宁缺勿错）
    const v = [normBatchName(w.payload) || '新批次', w.date + 'T00:00',
      w.rocket || '', w.site || '', 0, w.res || '', w.n || 0];
    if (w.u) v.push(w.u);
    // ⚠️ 标记必须写进**数组元素**（JSON 数组会丢掉挂在对象上的自定义属性，
    //   实测 `v._auto=1` 过序列化就没了 → 页面/断言全看不到）。约定 v[8] = 标记串。
    v[8] = 'auto' + (w.date ? ',day' : '');           // 'auto,day' = 自动补录 + 只精确到日
    meta[key] = v;
    added.push(key + '(' + (v[0] || '?') + ')[百科]');
    have.add(key);
  });
  // —— B. TLE 名兜底：百科还没收录该发，但 TLE 名已写明组号 ——
  //   星网：`GUOWANG 27 OBJECT B` → 低轨27组；千帆：`SPACESAIL ...` / `QIANFAN ...` → 极轨NN组。
  //   只认**白名单形态**（GUOWANG <数字> / SPACESAIL|QIANFAN ... <数字>组），其余名字不猜。
  (sats || []).forEach(function (s) {
    const c = String(s.c || '').replace(/[^0-9A-Za-z-]/g, '');
    // 与 inCat 同口径：短式 `26230A` → '26230'；全式 `2026-230` → '26230'
    let key = '';
    let mk = c.match(/^(\d{2})(\d{3})[A-Za-z]?$/);
    if (mk) key = mk[1] + mk[2];
    else { mk = c.match(/^(\d{4})-(\d{3})/); if (mk) key = mk[1].slice(2) + mk[2]; }
    if (!key || have.has(key)) return;
    const nm = String(s.name || '').toUpperCase();
    let bn = '';
    let mm = nm.match(/^GUOWANG\s+(\d{1,3})\b/);
    if (mm) bn = '低轨' + (+mm[1]) + '组';
    if (!bn) { mm = nm.match(/(?:SPACESAIL|QIANFAN)\w*\s+.*?(\d{1,3})\s*(?:组|GROUP)/); if (mm) bn = '极轨' + (+mm[1]) + '组'; }
    if (!bn) return;                                            // 名字解析不出组号 → 不补（保持"无台账"的诚实显示）
    const v = [bn, '', '', '', 0, '', 0];
    v[8] = 'auto,tle';                                      // 标记：来自 TLE 名、无日期
    meta[key] = v;
    added.push(key + '(' + bn + ')[TLE名]');
    have.add(key);
  });
  if (added.length) {
    console.log(tag + ' 自动补台账 ' + added.length + ' 批（目录已有卫星、台账原缺失）：' + added.join(', '));
  }
  return added;
}
// ★ V1.9.4：GW_LEDGER / QF_LEDGER 在下方 gw/qf 解析之后构建（自动补录要先于合并）。

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
// V1.4.3：发射地点优先用词条里抓到的链接（mkmanufacturers.mjs 顺带抓了「发射基地/发射地点」列），
// 这样南海海域、东方航天港号这类海上平台也能点进去；抓不到再回落到手工维护的 SITE_URL。
// 注意：MANUFACTURERS 必须在这里之前就赋值（它是 const，跑到后面才定义会触发 TDZ）。
const MANUFACTURERS = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'manufacturers.json'), 'utf8'));
  } catch (e) {
    console.log('!! manufacturers.json 读不到（先跑 node mkmanufacturers.mjs）：', e.message);
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
  var bySite = (MANUFACTURERS && MANUFACTURERS.bySite) || {};
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

// ---------------------------------------------------------------- V1.9.1（执行顺序 1.7）：搭车星排除表
// 为什么需要：`pendingSummary` 是按 **satcat 的 COSPAR 前缀**数 PAY 的，而**同一次发射**里
//   完全可能有"不属于本星座"的载荷 —— 它们共享前缀，于是被一并数进来，导致该批次的颗数虚高。
//   实例（1.7 明确点名的）：`2026-128` = 千帆 DTC-01(A) + **中国移动02星(B)**，
//   词条只把 DTC-01 记入千帆名单 → 该批应是 **1 颗**，而 satcat 数出 **2 颗**。
//   而 `launchedTotal` 取 `max(counts.n, 库内颗数)`，于是这个 2 会**覆盖**掉正确的 1。
// 口径来源：卫星百科词条表格（唯一名单）+ 任务清单 Q25。
// ★ 位置：必须定义在 `goneCountsOf` / `searchPools` **之前**（它们都调用 isStowaway）。
const STOWAWAY = {
  '26128': [69473],   // 2026-128B = 中国移动02星（词条不计入千帆）
  '24226': [62185]    // 2024-226A = 搭车星（词条 COSPAR 列虽写 A，但轨道高度指向 B；详见 V1.9.1_1.6 核对表）
};
function isStowaway(batchKey, norad) {
  const l = STOWAWAY[batchKey];
  return !!(l && l.indexOf(Number(norad)) >= 0);
}

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

// ---------------------------------------------------------------- V1.9.1（A19）：搜索补池（dead / pend）
// 实现已抽到 scripts/search_pools.mjs（纯函数 + 自检），这里只负责把 satcat 文本与搭车星判据喂进去。
// 为什么抽出去：真实数据里这两池当前**恰好都是空的**（1.1/1.4/1.6 之后已 100% 归位），
//   一个恒为空的分支**跑真实数据验证不了** → 抽成纯函数后用合成 satcat 逐条断言分流正确。
function gwSearchPools(batchKeys, haveNorads) {
  const file = `${D}/satcat.csv`;
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { text = ''; }
  return searchPools(text, batchKeys, haveNorads, isStowaway);
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

// ★★ V1.9.4：自动补台账 —— 必须在 gw/qf 解析之后（补录判据要用"目录里已有卫星"）。
//   对「目录已有卫星、百科有该发记录、但 GW_LAUNCH/QF_LAUNCH 没写」的批次，
//   用 wiki_launches.json 的整行拆列合成台账条目（标记 _auto / _dayOnly）。
autoFillLedger(GW_LAUNCH, 'gw', gw);
autoFillLedger(QF_LAUNCH, 'qf', qf);
// 补录后**重新合并**（mergeResults 只跑一次的话，新补条目拿不到 res/n 的百科覆盖）
const GW_LEDGER = mergeResults(GW_LAUNCH), QF_LEDGER = mergeResults(QF_LAUNCH);

// ---------------------------------------------------------------- V1.9.5（H9）：日期权威 = 词条单源 + 全量差异自检
// 口径（用户 2026-10-15 第 12 条"根治"）：
//   ① 发射历史的**日期一律以词条表为准**（GMT+8，带时刻）——"发现即跟随更新"；
//      与台账/发射记录不一致的直接改写并打印（自检留痕）；
//   ② 单源里没有的键分三类处理：
//      · 自动补录的新批次（v[8] 含 auto）→ 词条还没收录 = 正常窗口期，提示等本地任务刷新；
//      · 任务失败（res=fail）→ 词条不收失利发射，**豁免**（25F05 即此）；
//      · 其余（老台账键）→ **真缺口**，大声告警（该进词条表却没有）。
function applyWikiTables(ledger, bk, tag) {
  const T = (WIKI_TABLES && WIKI_TABLES[bk]) || {};
  let nFix = 0, nAuto = 0, nFail = 0;
  const miss = [];
  for (const k in ledger) {
    const v = ledger[k];
    const row = /^\d{5}$/.test(k) ? T['20' + k.slice(0, 2) + '-' + k.slice(2)] : null;
    if (!row || !row.d8) {
      const flags = String(v[8] || '');
      if (flags.indexOf('auto') >= 0) nAuto++;                    // 新批次：词条未收录（窗口期）
      else if (String(v[5] || '') === 'fail') nFail++;            // 失利发射：词条不收（豁免）
      else miss.push(k + '(' + (v[0] || '?') + ')');              // 真缺口
      continue;
    }
    // 词条有时刻才带时刻；只到日的行 → 打 day 标（页面隐藏时刻，不写假的 00:00）
    const isAuto = String(v[8] || '').indexOf('auto') >= 0;
    const wantFlags = (isAuto ? 'auto' : '') + (row.t8 ? '' : ',day');
    const want = row.t8 ? (row.d8 + 'T' + row.t8) : row.d8;
    if (String(v[1] || '') !== want) {
      console.log('  H9 日期以词条为准：' + k + ' ' + (v[1] || '(空)') + ' → ' + want + (isAuto ? '（自动补录行）' : ''));
      v[1] = want;
      nFix++;
    }
    if (String(v[8] || '') !== wantFlags) v[8] = wantFlags;
  }
  console.log(tag + ' H9 单源：日期修正 ' + nFix + ' 条' +
    (nAuto ? '｜新批次未入词条 ' + nAuto + ' 条（窗口期，等本地任务刷新）' : '') +
    (nFail ? '｜失利发射豁免 ' + nFail + ' 条' : '') +
    (miss.length ? '｜⚠️⚠️ 词条缺失 ' + miss.length + ' 条：' + miss.join(', ') : '｜无缺失'));
  return { nFix: nFix, nAuto: nAuto, nFail: nFail, miss: miss };
}
const H9_GW = applyWikiTables(GW_LEDGER, 'gw', '星网');
const H9_QF = applyWikiTables(QF_LEDGER, 'qf', '千帆');

// ================================================================ ★ V1.9.5（H13）：表格链接改「卫星百科」
// 用户口径：名称链接由 satcat 改卫星百科（**单星词条 → 批次词条 → 无词条则只染主题色不加下划线不链接**）；
//   NORAD 编号加粗 + 紫色（satcat 主题色）+ 下划线，链回 satcat；wiki 每次更新要扫新词条并动态更新表格。
//
// 数据从哪来（2026-10-16 实测，见合订清单 §23.1）：
//   · **单星词条** = 词条表「名称」格里的 <a>（每颗星一条；`wiki_tables[*].nameLinks`）。
//     实测：试验星 / GEO / KL / DTC **有**；**低轨组网星（26 组）没有**（组名也没有词条 —— 用
//     MediaWiki 的 `wgArticleId` 实测为 0，即页面不存在）。
//   · **批次词条** = `wiki_launches.json` 的 `u`（引导页:发射记录 的整行拆列，60/60 全覆盖）。
//     实测：低轨组网星 → `/wiki/星网`；千帆极轨组 → `/wiki/G60`；试验星 → 该星的单星词条。
//     ⚠️ 以前 v[7] **只在 autoFillLedger（自动补录行）里写** → 手工台账里的行（绝大多数）没有词条链接。
//   · 两者都没有 → 页面不链接（第三态）。
const WIKI_HOST = 'https://sat.huijiwiki.com';
/** 词条链接统一成**绝对 URL**：数据里存的是 `/wiki/xxx`，页面/导出都可能跑在 file:// 下，
 *  相对链接在 file:// 里会解析成"本地文件路径"（旧版 v[7] 就是这么坏的，且只在自动补录行上暴露）。 */
function wikiAbs(u) {
  if (!u) return '';
  return /^https?:/i.test(u) ? u : (WIKI_HOST + (u.charAt(0) === '/' ? u : '/' + u));
}
/** 台账 key（'26230'）→ wiki_launches 的 key（'2026-230'） */
function launchFull(k) { return /^\d{5}$/.test(k) ? ('20' + k.slice(0, 2) + '-' + k.slice(2)) : ''; }

function fillLedgerWikiUrls(ledger, tag) {
  let n = 0, have = 0, nAbs = 0;
  for (const k in ledger) {
    const v = ledger[k];
    if (!Array.isArray(v)) continue;
    const w = WIKI_LAUNCHES[launchFull(k)];
    if (w && w.u) {
      if (v[7]) {
        have++;
        const abs = wikiAbs(v[7]);          // 已有的可能是相对路径（autoFillLedger 直接存了 u）→ 一并归一
        if (abs !== v[7]) { v[7] = abs; nAbs++; }
      } else { v[7] = wikiAbs(w.u); n++; }
    }
  }
  console.log(tag + ' H13 批次词条：本次补 ' + n + ' 条（原有 ' + have + ' 条，其中归一为绝对 ' + nAbs + ' 条）');
  return n;
}
fillLedgerWikiUrls(GW_LEDGER, '星网');
fillLedgerWikiUrls(QF_LEDGER, '千帆');

/** 单星词条 → **{norad: {wu, wn}}**（绝对链接 + 词条名）。
 *  ⚠️ 返回映射而不是就地改 `sats` —— `pack()` 会**重建**卫星记录（只留 id/c/d），
 *     就地写的字段会被丢掉（实测：日志说"映射 15 颗"，satdata 里一颗都没有）。
 *     真正的落地在 ORBIT_ST 回填那段（按 id 写进打包后的 rec）。
 *  映射策略（**保守，宁缺毋滥** —— 宁可回落到批次词条，也不给错链接）：
 *    · 链接数 == 该批颗数 → 按 NORAD 升序 ↔ DOM 顺序一一对应；
 *    · 该批只有 1 颗 → 直接用唯一链接；
 *    · 其余（首尾两条链接的"range"形态、混编发射）→ **按 COSPAR 后缀字母唯一匹配**
 *      （标题以「X星」结尾且 X = 该星后缀字母）→ 只认能唯一匹配的星。
 */
function satWikiMap(sats, bk, tag) {
  const T = (WIKI_TABLES && WIKI_TABLES[bk]) || {};
  const byC = {};
  sats.forEach(s => { const p = String(s.c || '').slice(0, 5); (byC[p] || (byC[p] = [])).push(s); });
  const map = {};
  let nEq = 0, nOne = 0, nLet = 0;
  Object.keys(byC).forEach(p => {
    const g = byC[p];
    const row = T[launchFull(p)];
    const links = (row && Array.isArray(row.nameLinks)) ? row.nameLinks.filter(x => x && x.u) : [];
    if (!links.length) return;
    const put = (s, ln) => {
      const title = ln.t || ln.n || '';
      const o = {};
      if (/[\u4e00-\u9fff]/.test(title)) o.wn = title;     // 纯拉丁词条名（如 "CX-26卫星"）不留作中文名
      o.wu = wikiAbs(ln.u);
      map[s.id] = o;
    };
    if (links.length === g.length) {
      g.slice().sort((a, b) => a.id - b.id).forEach((s, i) => { put(s, links[i]); nEq++; });
      return;
    }
    if (g.length === 1) { put(g[0], links[0]); nOne++; return; }
    g.forEach(s => {
      const L = (String(s.c || '').match(/([A-Z])$/) || [])[1];
      if (!L) return;
      const hit = links.filter(x => new RegExp('(^|[^A-Za-z])' + L + '星?$').test(x.t || ''));
      if (hit.length === 1) { put(s, hit[0]); nLet++; }
    });
  });
  console.log(tag + ' H13 单星词条：颗数一致 ' + nEq + ' 颗｜单颗 ' + nOne + ' 颗｜字母匹配 ' + nLet + ' 颗' +
    '（其余走批次词条 / 无词条）');
  return map;
}
const H13_GW = satWikiMap(gw, 'gw', '星网');
const H13_QF = satWikiMap(qf, 'qf', '千帆');

// V1.9.1（A19）：搜索补池 —— 「已再入」与「尚未编目」这两类库内没有 TLE 的对象，
//   页面搜索也要能搜到（现池只有 `cur().sats`）。
const GW_POOLS = gwSearchPools(Object.keys(GW_LAUNCH), new Set(gw.map(s => s.id)));
const QF_POOLS = gwSearchPools(Object.keys(QF_LAUNCH), new Set(qf.map(s => s.id)));
console.log('搜索补池：gw 已再入(库内无 TLE)', GW_POOLS.dead.length, '尚未编目', GW_POOLS.pend.length,
  '｜ qf 已再入', QF_POOLS.dead.length, '尚未编目', QF_POOLS.pend.length);

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
    const list = (acc[k] || []).filter(r => r.type === 'PAY' && !isStowaway(k, r.norad));
    if (!list.length) return;
    // ★ V1.9.3（用户要求）：加一个 `tot` = **该发全部载荷数**（PAY，**含**搭车星/他人卫星）。
    //   用途：发射历史「发射卫星数」列要按用户的格式显示 `M/N颗` ——
    //     M = 属本星座的颗数（= n，已剔除搭车星）、N = 该发一共发了几颗载荷。
    //   为什么必须由数据层算：只有 satcat 才有全部 PAY 记录（含搭车星），页面端拿不到。
    //   多数批次 M === N（整发全是本星座）→ 页面据此只写「N颗」不写分数（见 launchRowHtml）。
    const allPay = (acc[k] || []).filter(r => r.type === 'PAY');
    // V1.3.7：只问「这批发射了几颗」的调用方（顶部计数）用 slim，省掉每批几百字节的摘要字段
    if (slim) { out[k] = { n: list.length, tot: allPay.length }; return; }
    const norads = list.map(r => r.norad).sort((a, b) => a - b);
    const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
    // 对象名：目录里这些对象多被编成 "GUOWANG 24 OBJECT A/B/C" 一类通用名，
    // 但也有已命名的（HULIANWANG DIGUI-178 …）。取首末两个做区间展示。
    const names = list.map(r => r.name).filter(Boolean);
    out[k] = {
      n: list.length,
      tot: allPay.length,
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

// V1.4.2：研发机构（制造方）—— 来自词条表格，由 mkmanufacturers.mjs 抓取缓存到 data/manufacturers.json。
// 先按 COSPAR 精确匹配，匹配不到再用发射日期兜底；两者都没有就留空（前端不显示这一格）。
function manufacturerOf(key, dateStr) {
  if (!MANUFACTURERS) return null;
  const cospar = '20' + key.slice(0, 2) + '-' + key.slice(2);          // 24240 → 2024-240
  let hit = MANUFACTURERS.byCospar[cospar];
  if (!hit && dateStr) {
    const d = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);       // 2024-08-06T14:42
    if (d) hit = MANUFACTURERS.byDate[d[1] + '-' + d[2] + '-' + d[3]];
  }
  return hit ? { m: hit.manufacturer, u: hit.url, ls: (hit.links || []).filter(function (x) { return x.n && x.u; }) } : null;
}
function manufacturerMap(launches) {
  const out = {};
  Object.keys(launches).forEach(k => {
    const v = launches[k];
    const hit = manufacturerOf(k, v && v[1]);
    if (hit) out[k] = hit;
  });
  return out;
}

const DATA = {
  generated: new Date().toISOString(),
  source: 'CelesTrak GP（NORAD 空间目标目录）· 多源补漏（分组 + 名称 + 编号反查）',
  // V1.9.1：satcat 是否可用。false ⇒ 已再入标记 / goneCount / 搜索补池 三处为空是"输入缺失"导致的，
  //   不是"确实没有这类对象"—— smoke 与 CI 靠这个字段区分这两种情况（否则恒空的断言毫无意义）。
  satcatOk: SATCAT_OK,
  // ★ V1.9.3（**兼容性体检抓到的静默缺口**）：占位号 → 真号 映射，**必须进产物**。
  //   背景：CelesTrak 自 2026-07-11 起新编目对象一律 6 位号（100000+），而**经典 TLE 格式的
  //   编目号字段只有 5 列** → 这些对象在 .tle 文本里只能写成"真号后 5 位"（`100203` → `00203`）。
  //   我们构建时（本文件 `parse` 与 refresh 的 S5）都会经 `OMM_IDS` 还原成真号，所以
  //   **内置数据里是 100203**；而页面端"联网现拉最新 TLE"那条路径
  //   （app.js `parseTleText`）**没有任何还原** → 拿到的是 `203`。
  //   实证（2026-10-13，Edge 探针）：内置 36 颗 6 位号卫星 vs 联网拉到 36 颗占位号
  //   （`has6: 0`，样本 `203:HULIANWANG DIGUI-178`）→ 两套 id 对不上 →
  //   **联网的用户会看到这 36 颗从表格/图表里消失或错位**（含 GEO 三星、低轨23/26组）。
  //   修法：把映射一并注入产物，页面端在 `parseTleText` 里用同一套口径还原。
  ommMap: OMM_IDS,
  gw: {
    key: 'gw', name: '星网', en: 'SatNet / CSCN', org: '中国卫星网络集团有限公司',
    sub: '低轨互联网星座',
    launches: GW_LEDGER, pending: gwPend, pendingInfo: gwSum, launchCounts: gwCounts, stats: gwStats,
    // V1.9.1（1.7）：按批次的"已再入"清单（动态；页面据此标注批次行、并在在轨数量里扣除）
    goneCount: goneCountsOf(Object.keys(GW_LAUNCH)),
    // V1.9.1（A19）：搜索补池 —— 库内没有 TLE 的「已再入」/「尚未编目」对象（页面并联进搜索）
    dead: GW_POOLS.dead, pend: GW_POOLS.pend,
    wiki: WIKI_STAT.gw,
    links: linkMap(GW_LAUNCH),
    manufacturers: manufacturerMap(GW_LAUNCH),
    sats: gwPack.sats, tleTpl: gwPack.tpls,
  },
  qf: {
    key: 'qf', name: '千帆', en: 'Qianfan / Thousand Sails (G60)', org: '上海垣信卫星科技有限公司',
    sub: '低轨互联网星座',
    launches: QF_LEDGER, pending: qfPend, pendingInfo: qfSum, launchCounts: qfCounts, stats: qfStats,
    goneCount: goneCountsOf(Object.keys(QF_LAUNCH)),
    dead: QF_POOLS.dead, pend: QF_POOLS.pend,
    wiki: WIKI_STAT.qf,
    links: linkMap(QF_LAUNCH),
    manufacturers: manufacturerMap(QF_LAUNCH),
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

// ---------------------------------------------------------------- V1.9.2（A7）：在轨状态三态
// 任务清单 A7 要求卫星表「在轨状态」列分**三态**（在轨 / 正在变轨 / 已再入），
// 其中前两态在构建期由本段算好（第三态「已再入」走 satcat 的 DECAY_DATE，见 reentryMap）。
//
// ★ 判据是**用真实数据校准**出来的，中间换过两版（都留档，避免以后有人"优化"回去）：
//   ① 先用「最小二乘斜率」（与升轨章 climbRates 同口径）→ **失败**：
//      实测 26108 批的高度序列在 1071.4 ↔ 1086.5 之间**反复跳变**（14 天内来回 4~5 次，
//      而净变化只有 0.04 km），斜率被带偏成 -1.3 km/d → 该批 18 颗**已到位**的星全被判"变轨中"。
//   ② 改「净漂移」（窗口内**前 1/3 与后 1/3 的中位高度之差**）→ 对抖动免疫：26108 全部修正为在轨。
//   ③ 再补一条「是否已到该批工作高度」：**只在动 或 未到位** 才算变轨中——
//      否则一颗暂时静止、但明显偏低 58 km 的星（实测 26120 的 69322）会被误判成"在轨"。
//
// ★ 工作轨道高度**按批次取、不按全局**（这是清单里点明的关键结论）：
//   实测 gw 有 450/508 km（55° 新试验星，设计高度就这么低）与 1100~1171 km（组网星）两簇，
//   qf 有 800~890 km（仍在升轨）与 1071 km（工作轨道）两簇 —— 用全局范围必然误判。
//   同批多星取中位数后再档位化（Q26a：取整到 **10 km**），保证"同批同高"读起来干净。
const ORBIT_ST = (() => {
  const DAY = 86400000, RE = 6378.137;
  const WIN = 30;        // 漂移窗口（天）
  const EPS_LEO = 1.0;   // LEO 净漂移阈值（km）：轨道维持只在 ±1 km 内浮动
  const EPS_GEO = 3.0;   // GEO 位置保持的浮动更大，阈值放宽
  const NEAR = 30;       // 「已到该批工作高度」的容差（km）
  const CLUSTER_GAP = 30;// 工作高度聚类：相邻高度差 <= 它算同一簇
  const MIN_PTS = 4;     // 点数少于它 → 数据不足，改按"是否近期首现"判
  // ★ V1.9.7（§9）：改用 **2 天 LSQ 速率** 判"是否在推"，阈值 0.8 km/day ≈ 5σ
  //   （数值取自 findrassvet 的 METHODOLOGY §3.3–3.5：其估计噪声 0.11 km/day、阈值 0.8 约 5σ、无误触发）。
  const RATE_TH = 0.8;   // km/day：|速率| 超过它才算"在推"
  // 2 天窗口最小二乘速率（km/day）—— 与展示用的 rr 是**同一个函数**，避免两套口径
  const lsqRateDay = (pts, days) => {
    const H = days * DAY, tail = pts[pts.length - 1][0];
    const win = pts.filter(p => Math.abs(p[0] - tail) <= H);
    const use = win.length >= 2 ? win : pts.slice(-2);
    if (use.length < 2) return null;
    const t0 = use[0][0];
    const xs = use.map(p => (p[0] - t0) / DAY), ys = use.map(p => p[1]);
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    const den = xs.reduce((a, v) => a + (v - mx) * (v - mx), 0);
    if (!(den > 0)) return null;
    return xs.reduce((a, v, i) => a + (v - mx) * (ys[i] - my), 0) / den;
  };
  const GEO_SMA = 42000; // GEO 判据：半长轴 ≥ 42000 km（对应周期 ≈1436 min，即 Q46 的口径）
  const now = Date.now();

  // UTC+8 日期（清单要求「进入工作轨道日期」按 UTC+8）
  const ymd8 = ms => new Date(ms + 8 * 3600000).toISOString().slice(0, 10);
  const median = a => {
    const b = a.slice().sort((x, y) => x - y), m = b.length >> 1;
    return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
  };

  // ① 按 NORAD 归集历史点（同一 NORAD 只属于一个批次，故同时记下它的批次 key）
  const rows = new Map();
  for (const bk of ['gw', 'qf']) {
    for (const key in HIST.out[bk]) {
      const byn = new Map();
      for (const r of HIST.out[bk][key]) {
        if (!byn.has(r[0])) byn.set(r[0], []);
        byn.get(r[0]).push([r[1], r[2]]);
      }
      for (const [n, pts] of byn) {
        if (REENTRY.has(n)) continue;          // 已再入走 st:'r' 通道，不在本段判定
        pts.sort((a, b) => a[0] - b[0]);
        // ② 净漂移：窗口内 前 1/3 中位 vs 后 1/3 中位
        let sel = pts.filter(p => now - p[0] <= WIN * DAY);
        if (sel.length < MIN_PTS) sel = pts.slice(-MIN_PTS);
        const k = Math.max(1, Math.floor(sel.length / 3));
        const d = sel.length >= 2
          ? median(sel.slice(-k).map(p => p[1])) - median(sel.slice(0, k).map(p => p[1]))
          : null;
        const sma = pts[pts.length - 1][1];
        const geo = sma >= GEO_SMA;
        // 该星**历史最高高度** —— 用于推该批的工作轨道高度（见下）
        let hmax = -Infinity;
        for (const p of pts) if (p[1] > hmax) hmax = p[1];
        // 数据不足：近期首现（<30 天）→ 判"变轨中"（刚发射的新星）；否则保守判"在轨"
        const thin = pts.length < MIN_PTS;
        // ★★ V1.9.7（§9 主改）：**用 2 天最小二乘速率判"是否在推"，不再用首末差分。**
        //   为什么：`d` 是「末 k 点中位数 − 首 k 点中位数」，属于差分式判据 ——
        //   findrassvet 的实测（METHODOLOGY §3.2）指出这类判据的噪声足以让**被动飞行看起来像在推**；
        //   本项目的实测也印证：星网 1150km 那批明明已到位，`rr = 0`，却因 `|d| > EPS_LEO` 被判 orb=1。
        //   现在：速率用与展示完全相同的 2 天 LSQ（同一函数），阈值 ≈ 5σ（findrassvet 取 0.8 km/day）。
        const rate = lsqRateDay(pts, 2);
        rows.set(n, {
          key: key, pts: pts, sma: sma, geo: geo, drift: d, hmax: hmax - RE, rate: rate,
          moving: thin ? (now - pts[0][0] <= WIN * DAY)
                       : (rate !== null ? Math.abs(rate) > RATE_TH
                                        : (d === null || Math.abs(d) > (geo ? EPS_GEO : EPS_LEO)))
        });
      }
    }
  }

  // ③ 批次工作轨道高度（wk）—— 取**最高的一簇**的中位数，再档位化到 10 km
  //    ★ 为什么不能取"全批中位数"：实测 24185（千帆极轨02组）18 颗里**只有 4 颗**到了
  //      1071 km，其余 14 颗长期停在 800~974 km（例：61552 自 2024-11 发射后一直停在 846.9）。
  //      全批中位数只有 888 → 会把这个错误的"工作高度"再拿去判定，把 4 颗**已到位**的星也判成变轨中。
  //      改用「最高簇」：按高度降序聚合，相邻差 > CLUSTER_GAP 即断开 → 得到真正到位的那一簇。
  //      （24185 的最高簇 = 1046/1055/1073/1073/1076 → 中位 1073 → 档位 **1070** ✓ 与同族批次一致）
  const byKey = new Map();
  for (const r of rows.values()) {
    if (!byKey.has(r.key)) byKey.set(r.key, []);
    byKey.get(r.key).push(r);
  }
  for (const [, g] of byKey) {
    const geo = g[0].geo;
    let wk;
    if (geo) {
      wk = 'GEO';
    } else {
      const hs = g.map(x => x.hmax).sort((a, b) => b - a);   // 降序
      const cl = [hs[0]];
      for (let i = 1; i < hs.length; i++) {
        if (hs[i - 1] - hs[i] <= CLUSTER_GAP) cl.push(hs[i]); else break;
      }
      wk = Math.round(median(cl) / 10) * 10;
    }
    for (const x of g) x.wk = wk;
  }

  // ④ 出参：orb(0 在轨 / 1 变轨中) + wk + od(进入工作轨道日期) + rr(升轨速度)
  const out = new Map();
  for (const [n, x] of rows) {
    // 修正：未到达该批工作高度的一律算变轨中（覆盖"暂时静止但明显偏低"的情形）
    const orb = (x.moving || (!x.geo && Math.abs(x.sma - RE - x.wk) > NEAR)) ? 1 : 0;
    // 进入工作轨道日期 = 首次落在工作带内的那条 TLE（GEO 用半长轴阈值，与 Q46 的周期口径等价）
    //   ⚠️ 只对"在轨"态求值：变轨中的星在上升途中会**穿过**工作带，那不算"进入工作轨道"，
    //     若照算会得到一个早于它真正到位的日期（实测 26120 的 69321 在 10-05 穿过 510 km 带）。
    let od = null;
    if (orb === 0) {
      for (const p of x.pts) {
        const ok = x.geo ? (p[1] >= GEO_SMA) : (Math.abs(p[1] - RE - x.wk) <= NEAR);
        if (ok) { od = p[0]; break; }
      }
    }
    const rec = { orb: orb, wk: x.wk, od: od ? ymd8(od) : '' };
    if (orb) {
      // 升轨速度：直接复用前面算好的 2 天 LSQ 速率（★ V1.9.7：与 moving 判据同一份数据，不再重算一遍）
      if (x.rate !== null && x.rate !== undefined && isFinite(x.rate)) {
        rec.rr = Math.round(x.rate * 100) / 100;
      }
    }
    out.set(n, rec);
  }
  // ★ V1.9.7（§23.12-p）：**把"因哪条判据判为变轨中"打出来** —— 否则误判永远靠猜。
  //   alt  = 只因高度差（|sma−RE−wk| > NEAR）：通常是"还在爬、正处于两次点火之间的间歇"
  //   mov  = 只因速率（|rate| > RATE_TH）：正在点火
  //   both = 两条都命中
  //   ⚠️ 必须放在 IIFE **内部**：`why` 是这里声明的，模块层引用会 ReferenceError（上一轮踩过）。
  (() => {
    // 不分星座（key 的命名不保证带 gw/qf 前缀，强行分组会串味 —— 上一版就是这么错的）；
    // 总数可与 satdata 里 orb=1 的条数对照，三个分支的分布才是关键。
    let n = 0, mov = 0, alt = 0, both = 0;
    for (const [, x] of rows) {
      const altHit = (!x.geo && x.wk !== 'GEO' && Math.abs(x.sma - RE - x.wk) > NEAR);
      if (!(x.moving || altHit)) continue;
      n++;
      if (x.moving && altHit) both++;
      else if (altHit) alt++;
      else mov++;
    }
    console.log('[orb] 变轨中合计 ' + n + ' 颗｜仅速率 ' + mov + '｜仅高度差 ' + alt + '｜两者都中 ' + both);
  })();
  return out;
})();

// 把三态字段挂到 sats 记录上（DATA 里的 sats 与 gwPack.sats 是同一个数组引用，改元素即生效）
{
  let nOrb = 0, nRaising = 0, nGeo = 0, nFallback = 0, nWiki = 0;
  for (const bk of ['gw', 'qf']) {
    for (const rec of (bk === 'gw' ? gwPack : qfPack).sats) {
      // ★ V1.9.5（H13）：单星词条（在包里重建的记录上按 id 回填 —— 就地写在 pack() 里会丢）
      const w = (bk === 'gw' ? H13_GW : H13_QF)[rec.id];
      if (w) { rec.wu = w.wu; if (w.wn) rec.wn = w.wn; nWiki++; }
      const st = ORBIT_ST.get(rec.id);
      if (!st) {
        // ★ V1.9.3（CI 报错根因修复）：历史库里**没有这颗星**时的兜底。
        //   现场（2026-10-13 CI，两次红灯都卡在这里）：
        //     `A7：三态字段齐备` 报「512 颗：在轨 400 / 变轨中 105」→ 400+105=505 ≠ 512，
        //     `A7：工作轨道高度是 10 km 档位` 报 wk 集合里混进 **950**（非 10 的倍数）。
        //   根因：ORBIT_ST 的 rows 只从 **HIST**（历史库）构建 —— 一颗星还没有历史点
        //     （刚发射、刚编目、或历史池尚未覆盖）时它不在 rows 里 → `get()` 返回 undefined →
        //     本段原来的 `continue` 直接跳过 → **rec.orb / rec.wk / rec.od 三个字段全是 undefined**。
        //   为什么本地测不出来：本机历史库完整（59 分片 / 65471 条覆盖全部 505 颗），
        //     而 CI 每次先跑 refresh 拿最新 TLE —— 新编目的星**当时还没有历史点**。
        //   ⇒ 这是"只在 CI 出现的失败"，也是「测试只在本地跑过 = 没跑过」的又一例。
        //   兜底口径（有意保守，宁可说"变轨中"也不谎报"在轨"）：
        //     · 无历史点 ⇒ 无法判定是否已到位 → 判 **变轨中**（orb=1）；
        //     · wk 用**该批次已有成员的工作高度**（同批同高，可从同 COSPAR 前缀的星取）；
        //       取不到就退回 400（CLIMB_MIN_TOP 量级，属"未知但合理"的低工作高度）；
        //     · od 留空（变轨中的星本就不写"进入工作轨道日期"）。
        //   ⚠️ 一律**补齐到 10 km 档位**（`Math.round(x/10)*10`）—— 这正是 950 的来源：
        //     旧兜底路径若绕过档位化，就会把非档位值写进 wk。
        const lk5 = String(rec.c || '').slice(0, 5);
        let wkGuess = 0, nGuess = 0, sumGuess = 0;
        for (const other of (bk === 'gw' ? gwPack : qfPack).sats) {
          if (other === rec || String(other.c || '').slice(0, 5) !== lk5) continue;
          const os = ORBIT_ST.get(other.id);
          if (os && typeof os.wk === 'number') { sumGuess += os.wk; nGuess++; }
        }
        if (nGuess) wkGuess = Math.round((sumGuess / nGuess) / 10) * 10;
        else wkGuess = Math.round(400 / 10) * 10;
        rec.orb = 1; rec.wk = wkGuess; rec.od = '';
        nRaising++; nFallback++;
        continue;
      }
      rec.orb = st.orb; rec.wk = st.wk; rec.od = st.od;
      if (st.rr !== undefined) rec.rr = st.rr;
      if (st.orb) nRaising++; else nOrb++;
      if (st.wk === 'GEO') nGeo++;
    }
  }
  console.log('在轨状态（A7）：在轨 ' + nOrb + ' / 变轨中 ' + nRaising + '（其中 GEO ' + nGeo +
    (nFallback ? '，其中 ' + nFallback + ' 颗因无历史点走兜底' : '') + '）' +
    '｜H13 单星词条已挂 ' + nWiki + ' 颗');
}

// ---------------------------------------------------------------- V1.9.5（H10 ③b）：**升轨阶段**（构建期预计算）
// 为什么放构建期、而不在页面端现算（2026-10-16 样张复盘的结论）：
//   · 页面端只能拿**发布分片**（抽样后）或 60 天精简兜底 —— 升轨期的点在抽样后可能残缺，
//     "开始/结束"判定会飘；构建期直接用**源库 data/history/<批>.json** 的原始日频点，
//     与用户在别处看到的"爬坡"完全同源（用户口径："用源库预计算并随 satdata 发布"）。
//   · 顺带满足性能口径：phase 不再逐帧现算，页面 O(1) 查表；导出图与屏幕共用同一份数据。
// 结构（随 satdata 发布）：
//   phases: { b: { 批次key: [startDay, endDay|null] }, s: { norad: [startDay, endDay|null] } }
//   · 天 = 距 1970 的天数（与 history 分片同口径，省体积）；endDay=null → 只画"开始"一条线；
//   · 未收录（key 不在表里）= 没有可画的线（直送/未升轨/数据不足）；
//   · 已再入的结束时刻 = satcat 的 DECAY 日期（用户口径 ④）；若它从未升轨 → [null, 再入日]。
// 批次级 = "多数星"口径（用户原话："大部分卫星开始升轨的时间"）：
//   · 开始 = 有升轨的各星 start 的**中位数**；结束 = **过半**星已结束才画（取中位数）——
//     个别星与同组不同步（甚至从未升轨/已再入）不会把整批的线带偏。
const CLIMB_PH = (() => {
  const DAY = 86400000;
  const out = { gw: { b: {}, s: {} }, qf: { b: {}, s: {} } };
  const stat = { sats: 0, endOnly: 0, batches: 0 };
  for (const bk of ['gw', 'qf']) {
    for (const key in HIST.out[bk]) {
      const bySat = new Map();
      for (const r of HIST.out[bk][key]) {
        if (!bySat.has(r[0])) bySat.set(r[0], []);
        bySat.get(r[0]).push({ ms: r[1], v: r[2] });
      }
      const starts = [], ends = [];
      for (const [norad, pts] of bySat) {
        pts.sort((a, b) => a.ms - b.ms);
        const dec = REENTRY.get(norad);
        const ph = climbPhases(pts, dec ? { decayMs: Date.parse(dec + 'T12:00:00Z') } : null);
        if (ph.startMs === null && ph.endMs === null) continue;
        out[bk].s[norad] = [ph.startMs === null ? null : Math.floor(ph.startMs / DAY),
                            ph.endMs === null ? null : Math.floor(ph.endMs / DAY)];
        stat.sats++;
        if (ph.startMs === null) stat.endOnly++;              // 已再入、但从未升轨（只画再入线）
        else { starts.push(ph.startMs); if (ph.endMs !== null) ends.push(ph.endMs); }
      }
      if (starts.length) {
        const med = a => a.slice().sort((x, y) => x - y)[a.length >> 1];
        const done = ends.length * 2 > starts.length;         // 过半已结束 → 画结束线
        out[bk].b[key] = [Math.floor(med(starts) / DAY), done ? Math.floor(med(ends) / DAY) : null];
        stat.batches++;
      }
    }
  }
  console.log('升轨阶段（H10 ③b）：批次 ' + stat.batches + ' 条 / 单星 ' + stat.sats +
    ' 条（其中仅再入线 ' + stat.endOnly + '）');
  return out;
})();
// 挂到产物上（与 A7 的 rec.orb 同一套路：DATA 的引用在这里赋值，JSON 序列化时自然带上）
DATA.gw.phases = CLIMB_PH.gw;
DATA.qf.phases = CLIMB_PH.qf;

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

// ★★ V1.9.7（§23.3-c）：**条数下限闸门** —— 输入残缺时宁可失败，也绝不写出可发布的坏数据。
//   背景（2026-10-17 线上事故）：refresh 当时因网络退化只抓到 0 份数据，mkdata 照样产出一份
//   "少了 wu/wn 字段"的 satdata 并被发布 → 表格全变「在轨（~-, undefinedkm）」、03 章 GEO 三星消失。
//   判据只做**数量级**判断（星网/千帆各自的下限），不猜具体内容；命中即**不写文件**并非 0 退出。
//   ⚠️ 用 exitCode 而不是 process.exit()：端到端测试是**同进程 import** 本脚本的（见 refresh.mjs 同款注释）。
//   ★ V1.9.7 追加：**字段覆盖率闸门**。只数条数不够 —— 2026-10-17 那次事故里条数是够的（251 颗），
//     坏的是字段维度：表格「在轨状态」由 `wk` 拼出、三态由 `orb` 决定，任一缺失就是满屏 `undefinedkm`。
//     实测（好数据）：`wk`/`orb` 覆盖率 **100%**；而 `wu`/`wn` 只有 8.3% / 1.9%（**合法可缺**，不能拿它当判据）。
const MIN_SATS = { gw: 200, qf: 200 };
const bad = ['gw', 'qf'].filter(k => ((DATA[k] && DATA[k].sats) || []).length < MIN_SATS[k]);
const NEED = ['wk', 'orb'];          // 必须近乎全覆盖的字段
const COVER_MIN = 0.98;
const thin = [];
['gw', 'qf'].forEach(k => {
  const s = (DATA[k] && DATA[k].sats) || [];
  if (!s.length) return;
  NEED.forEach(f => {
    const c = s.filter(x => x[f] !== undefined).length / s.length;
    if (c < COVER_MIN) thin.push(k + '.' + f + ' 覆盖 ' + (100 * c).toFixed(1) + '%');
  });
});
if (bad.length || thin.length) {
  bad.forEach(k => console.error('[mkdata] 拒绝写出：' + k + ' 只有 ' +
    ((DATA[k] && DATA[k].sats) || []).length + ' 颗（下限 ' + MIN_SATS[k] + '）'));
  if (thin.length) console.error('[mkdata] 拒绝写出：字段覆盖不足（阈值 ' + (COVER_MIN * 100) + '%）→ ' + thin.join('；'));
  console.error('[mkdata] 输入疑似残缺 —— 先确认 `node refresh.mjs` 是否真的抓到了数据（输出里不应出现大量「0 份」）。');
  console.error('[mkdata] 已**不写出** build/satdata.json，避免坏数据被打包发布。');
  process.exitCode = 5;
} else {
  fs.writeFileSync(path.join(ROOT, 'build', 'satdata.json'), JSON.stringify(DATA), 'utf8');
  console.log('satdata.json bytes=', fs.statSync(path.join(ROOT, 'build', 'satdata.json')).size);
}

// V1.4.0：单独导出一份 wiki.json —— 它跟 HTML 放在同一个目录时，页面打开会自动读它并覆盖内置的词条计数。
// 用途：把这一小段 JSON 传到 GitHub Pages / 任意静态托管，以后只改这里的数字，
// 所有访客刷新就能看到新统计，不需要重新构建 HTML，也不需要我维护任何自动更新。
const WIKI_JSON = {
  gw: WIKI_STAT.gw,
  qf: WIKI_STAT.qf,
  // ★ V1.9.1：三个**元字段放在末尾** —— 与仓库里现有的 wiki.json **同一字段顺序**。
  //   为什么要在意顺序：`JSON.stringify` 保序，而仓库那份是**人工整理过的**（把 gw/qf 放前面，
  //   打开就先看到数字）；mkdata 若按自己的顺序输出，每次构建都会产生"只挪了三行"的**无意义 diff**，
  //   真实变更反而被噪音淹没。以仓库为准 → mkdata 跟随。
  _readme: '改这里就能更新网页顶部的词条计数（launched=已发射, inOrbit=在轨, launches=发射成功/总）。改完保存，访客刷新即可看到。',
  asOf: WIKI_STAT.gw.asOf,
  checkedAt: WIKI_CHECKED_AT
};
// ★ V1.9.1：末尾补一个换行 —— `JSON.stringify` 不产出行尾换行，而仓库里的 wiki.json 是
//   带换行的（编辑器保存的正常产物）→ 不加就会永远留下"最后一行少了 \n"的 diff。
fs.writeFileSync(path.join(ROOT, 'build', 'wiki.json'), JSON.stringify(WIKI_JSON, null, 1) + '\n', 'utf8');
console.log('wiki.json bytes=', fs.statSync(path.join(ROOT, 'build', 'wiki.json')).size);
