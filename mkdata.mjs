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
// ★★ V2.0.0.630（方案 A）：satcat 的选源裁决（全量 vs 精简子集）
import { pickSatcat } from './scripts/satcat_src.mjs';
const ROOT = path.dirname(fileURLToPath(import.meta.url));   // 脚本所在目录（发布包内任意位置可用）
const D = path.join(ROOT, 'data');

// ---------------------------------------------------------------- V1.9.9.630：产物目录可重定向
// 为什么需要：`build/` 下有 **62 个 history 分片**，本脚本每次运行都要先 `rmSync(build/history)`
// 清空再重写（见下方 HIST_OUT）。而本机的**批量删除守护**按"单轮累计删除量"计数
// （阈值 50，`scope:"turn"`，报 `[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED]`）：
// 一个进程里删 62 个文件没事（实测连跑 5 轮、共 310 个也放行），
// 但**同一轮里跨进程累计**就会触顶 —— 对抗性测试 scripts/e2e_adversarial.mjs 的 E 段
// 要在同一个 turn 里连跑 4 次 mkdata（E1 基线 / E2 坏表 / E3 空表 / E4 坏台账），
// 于是 E2 之后必然被判红。那 3 条 FAIL 报的是**环境限制**，不是产品缺陷，
// 但长期让闸门挂红会训练出"这条反正是红的"的麻木 —— 比 bug 本身更危险。
//
// 治法：允许用环境变量 `CISTRACK_BUILD_DIR` 把产物目录整体挪走。
// 测试侧每个用例给一个**独立且不存在的**目录：
//   · 目标不存在 → `rmSync` 无事可做，**不产生任何删除**，自然不计数；
//   · 用例之间目录不同 → 不会互相踩产物（原本 E2/E3/E4 都在同一目录覆盖写）。
// 生产构建不设这个变量 → 行为与改动前**逐字节一致**（默认仍是 `<ROOT>/build`）。
const BUILD = process.env.CISTRACK_BUILD_DIR
  ? path.resolve(process.env.CISTRACK_BUILD_DIR)
  : path.join(ROOT, 'build');

// ---------------------------------------------------------------- V1.9.1：satcat 缺失必须"喊出来"
// `data/satcat.csv` 是 .gitignore 的（6.7 MB，由 refresh.mjs 下载），但它支撑**三处功能**：
//   ① 已再入标记 `st:'r'` / `dt`（1.4-D）  ② 台账"已再入"扣减 `goneCount`（1.7）  ③ 搜索补池 dead/pend（A19）
// 它一旦缺失，上面三处**全部静默退化成空**：不报错、构建照常成功、产物看起来完全正常。
// 2026-10-10 实际发生过一次（文件不在回收站，来源不明）→ 本地重建时 `st:'r'` 一条都没有，
// 差一步就把"已再入功能失效"的产物提交上去了。→ 现在显式探测：打印醒目横幅 + 写进产物供断言。
// ★★ V2.0.0.630（方案 A）：satcat 的**选源**与"要用哪份文本"统一交给共享模块 ★★
//   为什么必须统一：mkdata 有 **5 处**读 satcat（REENTRY / goneCountsOf / 待编目摘要 /
//   台账颗数 / 搜索补池）。若各写一遍"有全量用全量、否则用子集"，
//   迟早出现"这几处用子集、那几处用全量"的口径分裂 —— 那种分裂比"整体没数据"更难查。
//   ⇒ 这里只算**一次** CAT_SRC，5 处都用它。
const CAT_SRC = pickSatcat(D);
const SATCAT = CAT_SRC.path || path.join(D, 'satcat.csv');
const SATCAT_OK = CAT_SRC.kind !== 'none';
// 所有读 satcat 的地方统一用这份**文本**（不再各自 readFileSync 一遍，
//   既省 IO，也保证 5 处读到的是**同一份**，不会出现"读到一半文件被换掉"的错配）
const SATCAT_TEXT = CAT_SRC.text || '';
if (!SATCAT_OK) {
  console.warn('\n⚠️⚠️⚠️ satcat（全量与子集）**都不存在** —— 以下功能会静默失效（产物缺内容但不报错）：');
  console.warn('    ① 已再入标记（st/dt）  ② 台账已再入扣减（goneCount）  ③ 搜索补池（dead/pend）');
  console.warn('    ④ 每批发射颗数（launchCounts）  ⑤ 待编目摘要（pendingInfo）');
  console.warn('    恢复办法：node refresh.mjs --force-cat（需能连 CelesTrak）；' +
    '或让 CI 跑一次以生成 data/satcat_slim.csv\n');
} else {
  console.log('[mkdata] satcat 采用：' + CAT_SRC.kind + ' · ' + CAT_SRC.note + ' · ' + CAT_SRC.rows + ' 行');
  if (CAT_SRC.kind === 'slim') {
    console.log('[mkdata]   ⚠️ 用的是一份**精简子集**（只含既有批次前缀）——' +
      '台账/再入/补池/待编目都齐全，但**不可能靠它发现新发射批次**');
  }
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
  // ★★ V2.0.1（R15/C1）：原名是硬编码的 **'试验星12'** —— 纯属序号发明（真名见 wiki：
  //   「卫星互联网技术试验卫星（CX-26卫星）」），用户原话是「为什么叫 CX-23 试验星12？」。
  //   批次名现在一律以 wiki 词条为准（见 applyWikiTables 的 R15 段），这里只是**兜底值**，
  //   但兜底也必须是真名，否则 wiki 抓取失败的那一轮又会把假名字显示出来。
  '26158': ['卫星互联网技术试验卫星（CX-26卫星）', '2026-07-10T12:15', '长征十号乙 Y1', '海商 LCC-2', 49.99],
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
  // ① 去尾部颗数。★ V2.0.1（R-3）：原来这里是**两条**正则（第二条注释写 defensive），
  //   实际第一条已覆盖 `(9)` / `（共10颗）` 两种形态，第二条是同一件事的兜底 —— 合并成一条。
  //   容忍：全/半角括号、`共`、`颗`、空格。
  s = s.replace(/[（(]\s*(?:共)?\s*\d{1,3}\s*颗?\s*[)）]\s*$/,'').trim();
  // ② 组网星「…低轨/极轨/高轨 + 编号 + 组|星…」→ 压成台账同款短名
  //   ★★ V2.0.1（R15/C1）：这里是**治本**的地方。旧实现紧跟一条
  //     `s.replace(/^卫星互联网技术试验卫星\s*/,'试验星')`
  //   —— 它把「卫星互联网技术试验卫星（CX-26卫星）」压成了「试验星」，再配上手工台账里
  //   硬编码的序号，就编出了根本不存在的批次名「试验星12」。用户原话：
  //     「为什么叫 CX-23 试验星12？你是不是错误地泛化应用了仅限于简化几个章节内
  //       标记卫星光点的简化称呼？」
  //   ⇒ 铁律：**组网星可以压（因为它有真实组号），试验星一律保持 wiki 原文**。
  //     压缩只对 `低轨/极轨/高轨 + 数字 + 组|星` 这一种形态生效，其余原样返回。
  const m = s.match(/^(?:卫星互联网|千帆)?\s*(?:卫星)?(低轨|极轨|高轨)\s*(\d{1,3})\s*(组|星)/);
  if (m) return m[1] + m[2] + m[3];
  // ③ 其余一律**原样返回**（含星座前缀也不削）
  //   ⚠️ 这一条与旧实现相反，是刻意的：旧实现在这里 `replace(/^卫星互联网\s*/,'')`，
  //   把「卫星互联网技术试验卫星一号、二号」削成「技术试验卫星一号、二号」——
  //   而用户在 R15 验收里明确要的是**带前缀的百科全名**。既然 ② 已经把该压的组网星压完了，
  //   剩下的就不该再动一个字（宁可不短，也不改名）。
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
  // ★ V2.0.0.630：统一用 SATCAT_TEXT（全量或子集，由 pickSatcat 裁决），不再各读一遍
  if (!SATCAT_OK) return m;
  const rows = SATCAT_TEXT.split('\n');
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
  const out = {};
  // ★ V2.0.0.630：统一用 SATCAT_TEXT
  if (!SATCAT_OK) return out;
  const rows = SATCAT_TEXT.split('\n');
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
  // ★ V2.0.0.630：统一用 SATCAT_TEXT —— 原先这里自己 readFileSync 一遍，
  //   会导致"补池读全量、台账读子集"的口径分裂（同一个文件被两种源读到）
  return searchPools(SATCAT_TEXT, batchKeys, haveNorads, isStowaway);
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
// ★★ V1.9.9（O30-9）：映射缺失**不许静默降级** ★★
//   旧行为：`OMM_IDS[raw] || parseInt(raw, 10)` —— 映射文件一旦缺失/不全，6 位号（CelesTrak 100000+）
//   会被当成 5 位占位号解析，页面上就显示成 `203` 这种三位数，而且**没有任何告警**，打包照常通过。
//   判据：真 5 位编目号不可能以 0 开头，所以 TLE 里出现 `00xxx` 却没在映射里 → 一定是占位号没还原。
//   这里只**收集**，最终的"拒绝写出"闸门在文件末尾（与 MIN_SATS / 字段覆盖同一处，避免两套退出路径）。
const OMM_MISSING = [];
function parse(file) {
  const lines = fs.readFileSync(`${D}/${file}`, 'utf8').split('\n').map(l => l.trim()).filter(l => l);
  const out = [];
  for (let i = 0; i + 2 < lines.length; i += 3) {
    const name = lines[i].trim();
    const l1 = lines[i + 1], l2 = lines[i + 2];
    if (!l1.startsWith('1 ') || !l2.startsWith('2 ')) continue;
    const raw = l1.slice(2, 7);
    const real = OMM_IDS[raw];
    if (real === undefined && /^00\d{3}$/.test(raw)) OMM_MISSING.push(file + ' · ' + name + ' · 占位号 ' + raw);
    out.push({ name, id: real || parseInt(raw, 10), c: l1.slice(9, 17).trim(), l1, l2 });
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
// ★★ V2.0.1（R15 + R14）：从 wiki 词条行的**章节分组**里取出该发的本星座载荷名 ★★
//
// 为什么需要它：`wiki_tables` 现在带 `bySec`（每个章节各自的载荷名），这是唯一权威的
//   「这一发到底发了什么、分别属于哪一类」的来源。没有它的时候，代码只能靠名字正则猜，
//   而猜错就是「试验星12」那种事故。
//
// 章节语义（2026-10-22 实测，见 fetch_wiki_tables 的 secs 分布）：
//   · gw：「试验星」12 批 / 「业务星」30 批
//   · qf：「试验星」4 批 / 「组网星」16 批
// ⇒ 组网星/业务星 = 本星座的正式组网载荷（必须排在前面）
//   试验星        = 该发的试验载荷（拼在后面，用 `+` 连接，见 R14 的 2026-211）
//
// 返回 `{ name, payloadNames }`：
//   · `name`         = 批次名（多载荷用 `+` 连接，如 `极轨26组+EUHT技术试验卫星`）
//   · `payloadNames` = 规范化后的载荷名数组（R14 页面层要用）
//   · 无可用名 → 返回 null，调用方回落到手工台账（降级链的最后一环）
const NET_SEC = /组网星|业务星/;
const TEST_SEC = /试验星/;
function launchNameFromWiki(row) {
  if (!row) return null;
  const bySec = row.bySec;
  let nets = [], tests = [];
  if (bySec && typeof bySec === 'object') {
    for (const sec of Object.keys(bySec)) {
      const names = (bySec[sec] || []).filter(Boolean);
      if (NET_SEC.test(sec)) nets = nets.concat(names);
      else if (TEST_SEC.test(sec)) tests = tests.concat(names);
      // 其它章节（如「发射记录」「导航星」等）暂不参与批次名，避免把非载荷行拼进来
    }
  }
  let all = nets.concat(tests);
  // 老数据（本轮之前抓的、没有 bySec）兜底：用 names 并集 —— 保证升级后不会突然没名字
  if (!all.length) all = (Array.isArray(row.names) ? row.names : (row.name ? [row.name] : [])).filter(Boolean);
  if (!all.length) return null;
  const seen = new Set(), out = [];
  for (const x of all) {
    const n = normBatchName(x);
    if (n && !seen.has(n)) { seen.add(n); out.push(n); }
  }
  if (!out.length) return null;
  return { name: out.join('+'), payloadNames: out };
}
// ★★ V2.0.1（R7 · 依 Q24/Q25 裁决）：**这一发里有多少颗属于"试验星"** ★★
//
// 用户裁决（Q24/Q25）：
//   · Q24：2026-211 在「不含试验星」下记 **+8** —— 按**组网星章节表**写的「共8颗」，
//     不是按"整发剔除 = +0"，也不是"总 9 颗全扣"。
//   · Q25：分类**按 COSPAR 后缀精确到单星**（8 组网 + 1 试验），不按整发归一。
//   · Q14：这个开关**只影响组网进度的点**，不影响发射历史表的行。
//
// 判据：
//   ① 该批在 wiki 里**只**出现在「试验星」章节（星网 12 个试验批、千帆 KL/DTC 等）
//      ⇒ 整批都是试验星，试验星颗数 = 该批总颗数；
//   ② 混编批次（实测只有 2026-211）⇒ 只数「试验星章节里带 COSPAR 后缀的行」，每行 1 颗；
//      `2026-211K|试验星` 有后缀 K ⇒ 1 颗；`2026-211|组网星` 不算。
//   ③ 纯组网/业务批次 ⇒ 0。
// ⚠️ 没有章节信息的旧数据返回 0（**不扣**）—— 宁可少扣也不要凭名字猜着扣。
// ⚠️ 返回值有两种形态：**数字**（混编批次，试验星颗数已确定）或字符串 **'all'**
//   （整批都是试验星）。为什么不直接给数字：纯试验星批次的"总颗数"在 applyWikiTables 里
//   还拿不到 —— 那时 `launchCounts` 尚未统计完（它要等 pendingSummary）。
//   而 `v[6]`（百科记载颗数）在星网的多个试验批上是空的（实测 23181/26158 都是 0），
//   直接用它会把"整批试验星"算成 0 颗，导致开关关掉时**一颗都不扣**（比不扣更糟：静默错数）。
//   所以这里只判断"性质"，颗数留到挂载时用 `launchCounts` 的真实值补上。
function testCountOf(row) {
  if (!row) return 0;
  const bySec = (row.bySec && typeof row.bySec === 'object') ? row.bySec : null;
  const rows = Array.isArray(row.rows) ? row.rows : [];
  const secKeys = bySec ? Object.keys(bySec) : [];
  const hasNet = secKeys.some(s2 => NET_SEC.test(s2));
  const hasTest = secKeys.some(s2 => TEST_SEC.test(s2));
  if (!hasNet && !hasTest) return 0;                  // 旧数据/无章节 → 不扣
  if (!hasNet) return 'all';                          // ① 纯试验星批次 → 整批
  if (!hasTest) return 0;                             // ③ 纯组网/业务批次
  let n = 0;                                          // ② 混编：数带后缀的试验星行
  for (const r of rows) {
    if (!TEST_SEC.test(String(r.sec || ''))) continue;
    const m = String(r.cosparRaw || '').match(/-(\d+)([A-Z]+)$/);
    n += (m && m[2]) ? m[2].length : 1;
  }
  return n;
}
function applyWikiTables(ledger, bk, tag) {
  const T = (WIKI_TABLES && WIKI_TABLES[bk]) || {};
  let nFix = 0, nAuto = 0, nFail = 0, nName = 0;
  const miss = [];
  const names = {};   // V2.0.1（R15/R14）：台账 key → 本星座载荷名数组
  const tests = {};   // V2.0.1（R7）：台账 key → 该发**试验星颗数**（Q24/Q25 口径，见 testCountOf）
  for (const k in ledger) {
    const v = ledger[k];
    // ★★ V1.9.9.630（治本，第二处）：**台账 key 不止"5 位纯数字"一种形态。**
    //   失利批次（发射失败/取消）的台账 key 是 `'25F05'` —— 含字母 F，`/^\d{5}$/` 直接不匹配
    //   → `row` 恒为 null → 走进下面的 `else if (res === 'fail') nFail++`（"失利发射豁免"）。
    //   于是词典条表**明明收录了**这一发（`2025-F05`），本函数却永远拿不到它的日期。
    //   实测（2026-10-21）：把 fetch_wiki_tables 的 normCospar 修好、2025-F05 已进表之后，
    //   这里仍然打印「失利发射豁免 1 条」—— 就是这个判据没跟上。
    //   ⇒ 判据放宽为「2 位年 + 3 位序号，允许中间有 F」：'26230' 与 '25F05' 都认，
    //     映射到词条表的 key 分别为 '2026-230' / '2025-F05'（与 normCospar 的输出格式一致）。
    const row = /^\d{2}[0-9F]\d{2}$/.test(k) ? T['20' + k.slice(0, 2) + '-' + k.slice(2)] : null;
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
    // ★★ V2.0.1（R15）：**批次名一律以 wiki 为准**，手工台账 v[0] 降级为兜底 ★★
    //   这是本轮最直接的一处「用户指正落地」：旧台账把 12 个星网试验批写成「试验星01组…试验星12」，
    //   其中 26158 的真名是「卫星互联网技术试验卫星（CX-26卫星）」，被硬编成了「试验星12」。
    //   现在优先级：wiki 词条表的载荷名 > 手工台账。
    //   ⚠️ 只在词条**确实有载荷名**时才覆盖；抓取失败（词条为空）时保持台账原值，
    //      否则一次网络抖动就会把整张表的批次名刷成「无台账」。
    const nm = launchNameFromWiki(row);
    if (nm && nm.name) {
      if (String(v[0] || '') !== nm.name) {
        console.log('  R15 批次名以词条为准：' + k + ' ' + (v[0] || '(空)') + ' → ' + nm.name);
        v[0] = nm.name;
        nName++;
      }
      names[k] = nm.payloadNames;
    }
    // R7：试验星颗数按 Q24/Q25 口径算（与名字同源，都是 wiki 章节表驱动）
    //   `'all'` 表示整批；具体颗数在挂载处用 launchCounts 补（见 testCount 的构造）
    const tc = testCountOf(row);
    if (tc === 'all' || (typeof tc === 'number' && tc > 0)) tests[k] = tc;
  }
  console.log(tag + ' H9 单源：日期修正 ' + nFix + ' 条' +
    (nName ? '｜R15 批次名以词条为准 ' + nName + ' 条' : '') +
    (nAuto ? '｜新批次未入词条 ' + nAuto + ' 条（窗口期，等本地任务刷新）' : '') +
    (nFail ? '｜失利发射豁免 ' + nFail + ' 条' : '') +
    (miss.length ? '｜⚠️⚠️ 词条缺失 ' + miss.length + ' 条：' + miss.join(', ') : '｜无缺失'));
  return { nFix: nFix, nName: nName, nAuto: nAuto, nFail: nFail, miss: miss, names: names, tests: tests };
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
/** 台账 key（'26230' 常规 / '25F05' 失利批次）→ wiki_launches / wiki_tables 的 key（'2026-230' / '2025-F05'）
 *  ★ V1.9.9.630：原判据 `/^\d{5}$/` 不认含 F 的失利批次 key → 那条永远拿不到批次词条链接。 */
function launchFull(k) {
  return /^\d{2}[0-9F]\d{2}$/.test(k) ? ('20' + k.slice(0, 2) + '-' + k.slice(2)) : '';
}

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
/** ★ V1.9.8（B1）：词条标题清洗 —— 词条 URL 路径里空格会被写成 `_`（如 `CZ_12_Y1`），
 *  但百科**卡片标题本身是带空格的**。用户口径：「本名就是 卫星互联网技术试验卫星(CZ 12 Y1)」。
 *  所以显示前必须把下划线还原成空格。 */
function cleanTitle(t) { return String(t || '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim(); }

/** ★ V1.9.8（B1）：「区间展开」——百科表格用区间写一颗以上的卫星时，把中间那些补齐。
 *  实测两种形态：
 *    · 数字尾：`…0001星` … `…0004星`   → 0001/0002/0003/0004（保留前导零宽度）
 *    · 字母尾：`…08组A星` … `…08组D星` → A/B/C/D（保留"星"字）
 *  返回 null = 认不出，交给调用方放弃（宁缺毋滥）。
 *  ⚠️ 只有「展开后条数 == 该批在库颗数」时才允许使用 —— 否则宁可不错配。 */
function expandTitles(titles) {
  if (!titles || titles.length < 2) return null;
  const a = cleanTitle(titles[0]), b = cleanTitle(titles[titles.length - 1]);
  if (!a || !b || a === b) return null;
  const numA = /(\d+)(星?)$/.exec(a), numB = /(\d+)(星?)$/.exec(b);
  if (numA && numB && a.slice(0, a.length - numA[0].length) === b.slice(0, b.length - numB[0].length)) {
    const pre = a.slice(0, a.length - numA[0].length), tail = numA[2] || '';
    const n1 = parseInt(numA[1], 10), n2 = parseInt(numB[1], 10), w = numA[1].length;
    if (!(n2 > n1) || (n2 - n1) > 60) return null;
    const out = [];
    for (let n = n1; n <= n2; n++) out.push(pre + String(n).padStart(w, '0') + tail);
    return out;
  }
  const letA = /([A-Z])(星?)$/.exec(a), letB = /([A-Z])(星?)$/.exec(b);
  if (letA && letB && a.slice(0, a.length - letA[0].length) === b.slice(0, b.length - letB[0].length)) {
    const pre = a.slice(0, a.length - letA[0].length), tail = letA[2] || '';
    const c1 = letA[1].charCodeAt(0), c2 = letB[1].charCodeAt(0);
    if (!(c2 > c1) || (c2 - c1) > 26) return null;
    const out = [];
    for (let c = c1; c <= c2; c++) out.push(pre + String.fromCharCode(c) + tail);
    return out;
  }
  return null;
}

/** ★ V1.9.8（B3）：混编批次的「哪一颗是特殊载荷」—— 只能由百科卡片给出 NORAD。
 *  实测 2026-211 = 千帆极轨26组（8 颗）+ EUHT技术试验卫星（1 颗，NORAD 100711）。
 *  优先读 `data/wiki_cards.json`，没有就退到下面这张人工核对过的表（用户 2026-10-18 亲口确认）。 */
const CARD_NORAD_FALLBACK = { 'EUHT技术试验卫星': 100711 };
function cardNoradMap() {
  const out = Object.assign({}, CARD_NORAD_FALLBACK);
  try {
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'wiki_cards.json'), 'utf8'));
    Object.keys(j.cards || {}).forEach(t => {
      const c = j.cards[t];
      if (c && isFinite(+c.norad)) out[cleanTitle(c.zh || t)] = +c.norad;
    });
  } catch (e) { /* 没有卡片文件就只用兜底表 */ }
  return out;
}
const CARD_NORAD = cardNoradMap();
/** ★ V1.9.9（D3）：卡片标题 → **英文名**。数据源与 CARD_NORAD 同一份文件（data/wiki_cards.json）。 */
const CARD_EN = (() => {
  const out = {};
  try {
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'wiki_cards.json'), 'utf8'));
    Object.keys(j.cards || {}).forEach(t => {
      const c = j.cards[t];
      if (!c || !c.en) return;
      const en = String(c.en).trim();
      // ★ 两个键都登记：卡片键（词条标题）与卡片里的中文名**可能差一个字**
      //   （例如标题「…08组B星」而 zh 写「…08组B卫星」）；只按其中一个登记会静默丢英文名。
      const k1 = cleanTitle(t), k2 = cleanTitle(c.zh || t);
      if (k1) out[k1] = en;
      if (k2) out[k2] = en;
    });
  } catch (e) { /* 没有卡片文件就没有英文名 */ }
  return out;
})();

function satWikiMap(sats, bk, tag) {
  const T = (WIKI_TABLES && WIKI_TABLES[bk]) || {};
  const byC = {};
  sats.forEach(s => { const p = String(s.c || '').slice(0, 5); (byC[p] || (byC[p] = [])).push(s); });
  const map = {};
  let nEq = 0, nOne = 0, nLet = 0, nRng = 0, nCard = 0;
  Object.keys(byC).forEach(p => {
    const g = byC[p].slice().sort((a, b) => a.id - b.id);
    const row = T[launchFull(p)];
    const links = (row && Array.isArray(row.nameLinks)) ? row.nameLinks.filter(x => x && x.u) : [];
    if (!links.length) return;
    /** 用"标题 + 绝对链接"落一条记录（标题来自词条、URL 由标题反推 —— 区间补出来的没有现成 URL） */
    const put = (s, title, url) => {
      const t = cleanTitle(title);
      if (!t) return;
      const o = {};
      if (/[\u4e00-\u9fff]/.test(t)) o.wn = t;          // 纯拉丁词条名（如 "CX-26卫星"）不留作中文名
      o.wu = url ? wikiAbs(url) : wikiAbs('/wiki/' + encodeURIComponent(t));
      // ★ V1.9.9（D3，用户裁决「英文名改用词条来源、与英文模式对齐」）：
      //   卡片里的**英文名**（如 `WHJSW 08 B` / `EUHT Technology Test Satellite` / `KL-Alpha A`）
      //   随 `wn` 一起带出，页面 `enOf()` 优先用它，缺了才退回 `WHJSW-编号` 规则。
      const en = CARD_EN[t];
      if (en) o.en = en;
      map[s.id] = o;
    };
    if (links.length === g.length) {
      g.forEach((s, i) => { put(s, links[i].t || links[i].n, links[i].u); nEq++; });
      return;
    }
    if (g.length === 1) { put(g[0], links[0].t || links[0].n, links[0].u); nOne++; return; }
    // ① 区间展开（B1）：标题数与颗数一致才用
    const ex = expandTitles(links.map(x => x.t || x.n));
    if (ex && ex.length === g.length) {
      g.forEach((s, i) => { put(s, ex[i]); nRng++; });
      return;
    }
    // ② 混编批次（B3）：某条链接的 NORAD 已知 → 先把那颗钉住，其余留给"批次名"
    let left = g.slice();
    links.forEach(ln => {
      const t = cleanTitle(ln.t || ln.n);
      const n = CARD_NORAD[t];
      if (!n) return;
      const hit = left.find(s => (s.id | 0) === (n | 0));
      if (!hit) return;
      put(hit, t, ln.u); nCard++;
      left = left.filter(s => s !== hit);
    });
    // ③ 剩下的：展开结果若与剩余颗数对得上，就接着用（例如「A星~D星」只给首尾两条）
    if (left.length && links.length) {
      const ex2 = expandTitles(links.map(x => x.t || x.n));
      if (ex2 && ex2.length === left.length) { left.forEach((s, i) => { put(s, ex2[i]); nRng++; }); return; }
    }
    // ④ 最后兜底：按 COSPAR 后缀字母唯一匹配
    const linksLeft = links.filter(ln => !CARD_NORAD[cleanTitle(ln.t || ln.n)]);
    left.forEach(s => {
      const L = (String(s.c || '').match(/([A-Z])$/) || [])[1];
      if (!L) return;
      const hit = linksLeft.filter(x => new RegExp('(^|[^A-Za-z])' + L + '星?$').test(cleanTitle(x.t || x.n)));
      if (hit.length === 1) { put(s, hit[0].t || hit[0].n, hit[0].u); nLet++; }
    });
  });
  console.log(tag + ' V1.9.8 单星词条：颗数一致 ' + nEq + '｜单颗 ' + nOne + '｜区间展开 ' + nRng +
    '｜卡片 NORAD 定位 ' + nCard + '｜字母匹配 ' + nLet + '（其余走批次词条 / 无词条）');
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
  // ★ V2.0.0.630：统一用 SATCAT_TEXT
  if (!SATCAT_OK) return {};
  const rows = SATCAT_TEXT.split('\n');
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
// ★★ V2.0.0（2026-10-22 全链路侦察抓出的**真缺陷**）：上面这句注释是**承诺**，旧代码没兑现 ★★
//   病根：`pendingSummary()` 对"satcat 里查不到该批"的行是**直接 `return`**（该批不出现），
//     从来没有任何"回落到已有 TLE 数"的分支 —— 注释和实现不一致。
//   实测后果（本轮）：`26230`（低轨27组）在 **TLE 里 9 颗齐全**（`GUOWANG 27 OBJECT A…J`，
//     真号 100973~100981），但 `data/satcat.csv` 停在 2026-228、没有 2026-230 这一行
//     ⇒ `gwCounts['26230'] === undefined` ⇒ 页面「发射卫星数」整批少 9 颗，
//     且**产物本身看不出异常**（`sats` 里 9 颗都在，只是台账缺一行）。
//   为什么"回落到 TLE 数"是正确且安全的：
//     · 它只在 **satcat 查不到该批** 时启用 —— 有 satcat 数据时仍然完全以目录为准（含搭车星口径）；
//     · TLE 里的颗数是**已编目且已发布要素**的对象数，对"整批全是本星座"的常态批次 == 真实颗数；
//     · 唯一的已知偏差：若该批含搭车星且搭车星也有 TLE，会把它算进来（`tot` 也会偏大）。
//       这类批次本来就走 satcat 通路，不会落到这个回落分支。
//   ⚠️ 回落必须**留痕**（`_fallbackTle`），不能悄悄算 —— 否则又是一种"静默猜数"。
const tleCountOf = (() => {
  const acc = {};
  [gw, qf].forEach(list => list.forEach(s => {
    const p = String(s.c || '').slice(0, 5);      // '26230A' → '26230'
    if (/^\d{5}$/.test(p)) acc[p] = (acc[p] || 0) + 1;
  }));
  return acc;
})();
const withTleFallback = (counts, launchKeys) => {
  const fellBack = [];
  launchKeys.forEach(k => {
    if (counts[k] && counts[k].n > 0) return;
    const n = tleCountOf[k] || 0;
    if (!n) return;
    counts[k] = { n: n, tot: n, _fallbackTle: 1 };
    fellBack.push(k + '(' + n + '颗)');
  });
  if (fellBack.length) {
    console.log('[mkdata] 颗数回落（satcat 查不到该批，改用 TLE 已编目数）' + fellBack.join(',') +
      ' —— 仅影响「发射卫星数」的 M 值，`tot` 亦按 TLE 计');
  }
  return fellBack;
};
const gwCounts = pendingSummary(Object.keys(GW_LAUNCH), true), qfCounts = pendingSummary(Object.keys(QF_LAUNCH), true);
const GW_TLE_FB = withTleFallback(gwCounts, Object.keys(GW_LAUNCH));
const QF_TLE_FB = withTleFallback(qfCounts, Object.keys(QF_LAUNCH));

// ★★ V1.9.9.630（2026-10-21 实测抓出的**静默回退**，这是治本项）★★
//   症状：本地重建产物的 `gw.launchCounts` 只有 40 批，而已发布的 HEAD 是 41 批 ——
//         `26230`（低轨27组，9 颗）整个批次**无声消失**，页面「发射卫星数」随之少 9 颗。
//   根因链（三环，缺一不可）：
//     ① `data/satcat.csv` 停在 10-16 22:42，只覆盖到 `2026-228`，而 229/230 已发射；
//     ② `refresh.mjs` 的判据是 `age > 7` 天才重下 —— 它 4.5 天，**被判"新鲜"跳过**，
//        于是这份过期文件从未被换掉；
//     ③ `pendingSummary()` 只能从 satcat 算每批颗数，查不到就 `return`（该批不出现），
//        **面板上既不报错也不留痕** —— 产物看着完全正常，只是数据少了一批。
//   为什么必须在这里拦：① 和 ② 修好之前（本机跑不了外网）仍会复现；
//   而且这类"静默少数据"比"报错"危险得多 —— 页面会一本正经地显示错数字。
//   判据：`launches` 里有、`launchCounts` 里没有的批次 → **逐条点名**，并写进 `_partial`。
//   ⚠️ 这里**不抛错**（否则会把整条日常链路打断），但必须让它在产物里留下证据。
function auditCountsCoverage(tag, launchKeys, counts, ledger) {
  // ⚠️ 必须排除**失利批次**（`res === 'fail'`）：它们本来就没有入轨卫星，
  //   `launchCounts` 里不应出现。第一版判据漏了这一点，把 `25F05`（朱雀二号E Y3 失利）
  //   也报成"缺失" → 假红。**假警报会让真警报被无视**，所以这里按 res 精确排除。
  const isFail = (k) => {
    const row = ledger && ledger[k];
    const res = Array.isArray(row) ? row[5] : (row && row.res);
    return String(res) === 'fail';
  };
  // ⚠️⚠️ 还必须排除**刚发射、satcat 尚未编目**的批次（宽限期 3 天）。
  //   为什么（否则 CI 会每天报红）：新星座每发一次，`mkdata` 都会先从**百科**自动补一台账，
  //   而 satcat（Celestrak 的目录）对这种新目标通常要迟到几天。若不加宽限，
  //   "新发射"就会被当成"satcat 过期"，每天定时任务都红 —— 而这恰恰是**正常状态**。
  //   取 3 天：本轮那次真实事故是 **9 天**（10-10 发射、10-16 的 satcat 已覆盖到 228 却没这行），
  //   3 天足够把"正常迟到"与"文件过期"分开。
  const GRACE_DAYS = 3;
  const isTooNew = (k) => {
    const row = ledger && ledger[k];
    const d = Array.isArray(row) ? row[1] : (row && row.d);
    const t = d ? Date.parse(String(d).replace(' ', 'T')) : NaN;
    return Number.isFinite(t) && (Date.now() - t) / 86400000 < GRACE_DAYS;
  };
  const missAll = launchKeys.filter((k) => !isFail(k) && (!counts[k] || !(counts[k].n > 0)));
  const miss = missAll.filter((k) => !isTooNew(k));
  const grace = missAll.filter(isTooNew);
  if (grace.length) {
    console.log('ℹ️ [' + tag + '] ' + grace.length + ' 批刚发射、satcat 尚未编目（' + GRACE_DAYS +
      ' 天宽限内，正常）：' + grace.join(','));
  }
  if (miss.length) {
    console.warn('⚠️ [' + tag + '] launchCounts 缺 ' + miss.length + ' 批：' + miss.join(',') +
      ' —— 这些批次在 satcat.csv 里查不到（多为 satcat 过期），' +
      '「发射卫星数」会偏少；请刷新 data/satcat.csv（refresh.mjs --force-cat）。');
  }
  return miss;
}
const GW_COUNT_MISS = auditCountsCoverage('gw', Object.keys(GW_LAUNCH), gwCounts, GW_LAUNCH);
const QF_COUNT_MISS = auditCountsCoverage('qf', Object.keys(QF_LAUNCH), qfCounts, QF_LAUNCH);
// 应急放行开关（只在**明确知道** satcat 拉不到时用；默认关闭 = 缺失即失败）
const ALLOW_COUNT_MISS = process.env.CISTRACK_ALLOW_COUNT_MISS === '1';
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
    asOf: '',
    article: '星网',
    launched: { n: 248, zh: '试验星32 + 高轨业务星3 + 低轨业务星213', en: 'test 32 + GEO service 3 + LEO service 213' },
    inOrbit: { n: 244, zh: '试验星28 + 高轨业务星3 + 低轨业务星213', en: 'test 28 + GEO service 3 + LEO service 213' },
    launches: '40/41'
  },
  qf: {
    asOf: '',
    article: '千帆星座',
    launched: { n: 262, zh: '试验星6，组网星256', en: 'test 6, network 256' },
    inOrbit: { n: 262, zh: '试验星6，组网星256，理论值', en: 'test 6, network 256, theoretical' },
    launches: '19/19'
  }
};
const WIKI_CHECKED_AT = (WIKI_FETCHED && WIKI_FETCHED.checkedAt) || '';
/** ★ O30-12（V1.9.9 收尾）：**卡片抓取状态**随 wiki.json 发布（页面「卫星百科更新」行附显）。
 *  形状：{ asOf:'YYYY-MM-DD HH:MM'（北京时间）, error:''|'原因…', n:卡片张数 }；两张都没有 → null。
 * ★★ V1.9.9.630（2026-10-21 实测抓出）：**不能无条件优先用 `wiki.json` 的 `cards` 键。**
 *  事故现场：卡片脚本 07:41 已成功写完 `data/wiki_cards.json`（failed 0、cardsError 空），
 *  但 `wiki.json.cards` 还是 00:04 那份"1 个词条未过挑战"的旧状态 —— 于是构建产物把
 *  **已经修好的失败信息当作现状发布出去**，页面会一直挂着一条早已不成立的告警。
 *  为什么会这样：`wiki.json` 的 cards 是 `fetch_wiki_cards.mjs` 补丁进去的，而
 *  `fetch_wiki.mjs` 跑一轮会重写整个 wiki.json（虽然它会保留 old.cards，但保留的就是旧值）。
 *  ⇒ 正确口径：**两处都读，取 `asOf` 更新的那一份**（`data/wiki_cards.json` 是抓取的直接产物、
 *    字段最全；`wiki.json` 那份是"已发布快照"）。相等时用 wiki.json（与页面同源）。
 *  ⚠️ 必须放在 WIKI_FETCHED 定义**之后** —— 它是个 `let`，提前访问会 TDZ 抛 ReferenceError。 */
const CARDS_STATUS = (() => {
  // ① 直接产物（权威）：data/wiki_cards.json
  let direct = null;
  try {
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'wiki_cards.json'), 'utf8'));
    // 旧版卡片文件没有 cardsError 平铺字段 —— 用 _counts.failed 做失败证据，
    // 没有记录就明说"状态未知"，**不把未知谎报成正常**。
    const failedN = (j._counts && isFinite(j._counts.failed)) ? j._counts.failed : null;
    direct = {
      asOf: j.cardsAsOf || j._checkedAt || '',
      error: j.cardsError || (failedN ? '上次抓取有 ' + failedN + ' 个词条未过挑战（旧版记录，无详细状态）' : ''),
      n: Object.keys(j.cards || {}).length
    };
  } catch (e) { /* 没有就直接产物 */ }
  // ② 已发布快照：wiki.json 的 cards 键
  const fromWiki = (WIKI_FETCHED && WIKI_FETCHED.cards) || null;
  if (!direct) return (fromWiki && (fromWiki.asOf || fromWiki.n)) ? fromWiki : null;
  if (!fromWiki || !(fromWiki.asOf || fromWiki.n)) return direct;
  // ③ 两份都有 → 比 asOf（'YYYY-MM-DD HH:MM' 可直接字符串比较）
  const a = String(direct.asOf || ''), b = String(fromWiki.asOf || '');
  if (b > a) {
    console.warn('⚠️ wiki.json 的卡片状态（' + b + '）比 data/wiki_cards.json（' + a
      + '）更新 —— 说明卡片文件落后于已发布快照，本次采用 wiki.json 那份。');
    return fromWiki;
  }
  if (a > b) {
    console.log('卡片状态取更**新**的 data/wiki_cards.json（' + a + '），'
      + 'wiki.json 里那份（' + b + '）已过期、不予采用');
  }
  return direct;
})();
if (CARDS_STATUS) {
  console.log('卡片状态：n=' + CARDS_STATUS.n + '，asOf=' + (CARDS_STATUS.asOf || '未记') +
    (CARDS_STATUS.error ? '，**有失败**：' + CARDS_STATUS.error : ''));
} else {
  console.log('卡片状态：无（wiki.json 与 data/wiki_cards.json 都没有）—— 页面只显示核对时间');
}
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
    // ★ V2.0.1（R14）：每批的**本星座载荷名数组**（`+` 之前的那几项）。
    //   页面用它判断「这一发是不是多载荷」—— 有 2 项以上就不能按「单星发射」显示成 −。
    payloadNames: H9_GW.names,
    // V2.0.1（R7）：每批的试验星颗数（Q24/Q25 口径）。
    //   `'all'` → 整批都是试验星，用真实颗数（launchCounts.n，缺则百科颗数）补上。
    testCount: (function () {
      const out = {};
      for (const [kk, tv] of Object.entries(H9_GW.tests || {})) {
        const tot = (gwCounts[kk] && gwCounts[kk].n) || 0;
        const n = (tv === 'all') ? tot : tv;
        if (n > 0) out[kk] = Math.min(n, tot || n);
      }
      return out;
    })(),
    // V2.0.1（R7）：每批的试验星颗数（Q24/Q25 口径）。
    //   `'all'` 表示整批都是试验星 → 用真实颗数（launchCounts.n）补；数字则直接用。
    testCount: (function () {
      const out = {};
      for (const [kk, tv] of Object.entries(H9_GW.tests || {})) {
        const tot = (gwCounts[kk] && gwCounts[kk].n) || 0;
        const n = (tv === 'all') ? tot : tv;
        if (n > 0) out[kk] = Math.min(n, tot || n);
      }
      return out;
    })(),
    // ★ V1.9.9.630：satcat 覆盖不到的批次（见 auditCountsCoverage 的长注释）。
    //   进产物的目的是**留证**：这样"发射卫星数偏少"这件事在数据里可被追溯，而不是只在控制台闪一下。
    _countMissing: GW_COUNT_MISS,
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
    payloadNames: H9_QF.names,   // V2.0.1（R14）同 gw
    testCount: (function () {   // V2.0.1（R7）同 gw
      const out = {};
      for (const [kk, tv] of Object.entries(H9_QF.tests || {})) {
        const tot = (qfCounts[kk] && qfCounts[kk].n) || 0;
        const n = (tv === 'all') ? tot : tv;
        if (n > 0) out[kk] = Math.min(n, tot || n);
      }
      return out;
    })(),
    testCount: (function () {   // V2.0.1（R7）同 gw
      const out = {};
      for (const [kk, tv] of Object.entries(H9_QF.tests || {})) {
        const tot = (qfCounts[kk] && qfCounts[kk].n) || 0;
        const n = (tv === 'all') ? tot : tv;
        if (n > 0) out[kk] = Math.min(n, tot || n);
      }
      return out;
    })(),
    _countMissing: QF_COUNT_MISS,
    goneCount: goneCountsOf(Object.keys(QF_LAUNCH)),
    dead: QF_POOLS.dead, pend: QF_POOLS.pend,
    wiki: WIKI_STAT.qf,
    links: linkMap(QF_LAUNCH),
    manufacturers: manufacturerMap(QF_LAUNCH),
    sats: qfPack.sats, tleTpl: qfPack.tpls,
  },
  urls: URLS,
  // ★ V2.0.1（O-1）：自检结果**在这里不能内联** —— DATA 字面量的求值时间早于 SELF_CHECK
  //   （它要等 ORBIT_ST 与状态挂载都跑完才算），内联会直接 ReferenceError。
  //   统一在下面用 `DATA.selfCheck = SELF_CHECK;` 挂载（与 DATA.gw.layers 同一套路）。
};

fs.mkdirSync(BUILD, { recursive: true });

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
// ★ V1.9.7：NORAD → { 星座, 倾角 } —— 建层与判据都要用（历史点里没有倾角，只能从 TLE 取）。
//   倾角直接读 TLE 第 2 行第 9–16 列（度），不经 SGP4：这里只需要"哪条倾角带"，不需要精度。
const SAT_META = new Map();
for (const bk of ['gw', 'qf']) {
  for (const s of (bk === 'gw' ? gw : qf)) {
    const inc = parseFloat(s.l2.slice(8, 16));
    SAT_META.set(s.id, { c: bk, inc: isFinite(inc) ? inc : undefined });
  }
}
const ORBIT_ST = (() => {
  const DAY = 86400000, RE = 6378.137;
  const WIN = 30;        // 漂移窗口（天）
  const EPS_LEO = 1.0;   // LEO 净漂移阈值（km）：轨道维持只在 ±1 km 内浮动
  const EPS_GEO = 3.0;   // GEO 位置保持的浮动更大，阈值放宽
  // ★ 2026-10-20 修复（CI 连续 4 次失败的真因）：**GEO 必须用独立的速率阈值**。
  //   事故链：V1.9.7（0d80190，10-17）把 RATE_TH 从 0.8 降到 0.5 后，GEO 三星（59069/60327/61503）
  //   开始被误判成「变轨中」→ smoke A7/Q46（要求 GEO 的 orb===0）失败 → 定时任务自 10-18 12:27 起
  //   连续 4 次红、每次给作者发失败邮件。
  //   实测（history/gw-24040|24135|24181.json，逐日滚动算 2 天 LSQ）：
  //     · 59069 |rate| 最大 1.30 km/day，60327 最大 1.40，61503 最大 **1.90**
  //     · 阈值 0.5 时它们分别有 8% / 24% / 20% 的日期会被判"在推"
  //   为什么这不是数据噪声：GEO 卫星做**位置保持（station-keeping / 东西向位保机动）**时，
  //   半长轴本就会在几十公里量级内来回摆动，2 天窗口足以捕捉到 ±2 km/day 的表观速率。
  //   它和 LEO 的「持续点火爬升」在物理上是两件事，不能共用一个阈值。
  //   ⇒ GEO 取 3.0：比实测最大 1.90 留 1.6 倍余量，仍能抓住真正的 GEO 转移（真抬轨≥数百 km、
  //     速率动辄十几 km/day）。
  //   ⚠️ EPS_GEO 此前**只在 rate===null 的降级分支**里生效（几乎走不到），主路径对所有星一律用
  //     RATE_TH —— 这就是「常量定义了却没用上」的典型，注释写着"阈值放宽"但实际没放宽。
  const RATE_TH_GEO = 3.0; // km/day：GEO 位置保持的速率阈值（见上）
  const NEAR = 30;       // 「已到该批工作高度」的容差（km）
  const CLUSTER_GAP = 30;// 工作高度聚类：相邻高度差 <= 它算同一簇
  const MIN_PTS = 4;     // 点数少于它 → 数据不足，改按"是否近期首现"判
  // ★ V1.9.7（§9）：改用 **2 天 LSQ 速率** 判"是否在推"，阈值 0.8 km/day ≈ 5σ
  //   （数值取自 findrassvet 的 METHODOLOGY §3.3–3.5：其估计噪声 0.11 km/day、阈值 0.8 约 5σ、无误触发）。
  const RATE_TH = 0.5;   // km/day：|速率| 超过它才算"在推"
  //   ★ 2026-10-17 用户要求 0.8 → 0.5：仍远高于本项目的噪声水平（findrassvet 实测单点 σ=0.166 km、
  //     2 天 LSQ 后 0.11 km/day；0.5 ≈ 4.5σ），所以不会把被动飞行误判成在推，只是对**慢速爬升**更敏感。
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
    // ★★ V1.9.9（Q26 排查中发现的真缺陷，2026-10-21）：**den === 0 不等于"数据不足"** ★★
    //   病根：`den` 是时间自变量离差的平方和。当窗口内**所有点落在同一天**（d 相同）时 den=0，
    //     此时旧代码返回 null → 调用方把它当成"算不出速率"→ 走 `d`（首末差分）兜底或
    //     干脆 `rr` 缺失（`if (x.rate !== null && isFinite(x.rate))` 不成立 → 不写 rr）。
    //   实测受害样本：26153L（NORAD 69810）末 5 点半长轴**完全相同 12250**（=846.86km，连续 46 天
    //     恒定在 847km），den=0 → rate=null → rr 缺失 → 前端「变轨」行拿不到速率片段。
    //   正确语义：**高度恒定 ⇒ 速率就是 0**（一个确定的结论），绝不是"不知道"。
    //   注意区分两种情况：
    //     · xs 全相同（同一天多点）→ 时间跨度为零，横轴退化。用 ys 是否恒定来区分：
    //         ys 也全相同 → 真的平坦，速率 = 0（确定）
    //         ys 有差异   → 同一天内的高度抖动，无时间标度可言，仍返回 null（无法定义速率）
    //     · xs 有差异但 den 为 0 在数学上不可能（平方和 > 0），这里一并兜住。
    if (!(den > 0)) {
      const xsAllSame = xs.every(v => v === xs[0]);
      const ysAllSame = ys.every(v => v === ys[0]);
      if (ysAllSame) return 0;          // 横轴退化但纵轴恒定 ⇒ 平坦 = 0 km/天
      if (!xsAllSame) return 0;         // 理论上不可达，保守按 0（平方和不可能为 0 而 xs 有差异）
      return null;                      // 同一天内抖动 ⇒ 无法定义速率
    }
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
        // ★★ V2.0.1（用户裁决 A/D）：**再加一个 30 天窗口的速率** ★★
        //   2 天窗能抓住"正在点火"，但对**台阶式爬升的平台期**会读成 0（末两点等高）；
        //   30 天窗能反映"这一段的整体趋势"，是"它到底还在不在往上走"的正确尺度。
        //   两者分工：2 天 = 眼下有没有推；30 天 = 这段时间有没有在走。
        const rate30 = lsqRateDay(pts, 30);
        rows.set(n, {
          key: key, norad: n, pts: pts, sma: sma, geo: geo, drift: d, hmax: hmax - RE, rate: rate, rate30: rate30,
          thin: thin,                      // ★ V1.9.7：层/判据要用（点数不足的星不参与建层）
          moving: thin ? (now - pts[0][0] <= WIN * DAY)
                       // ★ 2026-10-20：GEO 用自己的阈值（RATE_TH_GEO=3.0），
                       //   不能套 LEO 的 0.5 —— 否则位置保持机动会被当成"在推"，判成变轨中。
                       : (rate !== null ? Math.abs(rate) > (geo ? RATE_TH_GEO : RATE_TH)
                                        : (d === null || Math.abs(d) > (geo ? EPS_GEO : EPS_LEO)))
        });
      }
    }
  }

  // ③ ★★ V1.9.7（用户裁决「治本」）：**工作轨道 = 实测层**，不再用「该批历史最高簇」当基准。
  //   旧口径的病根：wk 取「该批历史最高的一簇」→ 只要有几个成员摸到过更高的高度，整批的「工作高度」
  //   就被抬上去。实测两处翻车：
  //     · qf 69863 那批：批 wk=1090，实际全停在 1071（偏差 19 km）→ 状态里显示的高度不是它真在的高度；
  //     · qf 69800/69807/69811：人在 926~942、30 天净升 33~44 km（还在爬），只因离批 wk=950 不到 10 km
  //       就被判成「在轨」—— 这正是用户问的「每天变化很小、连着很多天累积」的那种漏判。
  //   新口径三条，全部由 TLE 历史点算出，不含任何设计值：
  //     ① 种子 = **稳定**的星：不在推（2 天速率 ≤ RATE_TH）、30 天净升 < RISE_TH、点数足够；
  //     ② 层 = 同一倾角带（0.5°）内按高度聚类（相邻差 > LAYER_GAP 断开），要求成员 ≥ LAYER_MIN
  //        且高度标准差 ≤ LAYER_SD —— 后半条专拦「一群还在爬的星刚好排成一条竖线」：
  //        实测 qf 有 31 颗稳定地散在 800~974 km（σ=57.7），不拦就会被当成一个 174 km 厚的"工作层"；
  //        层高取**众数档**（10 km，即用户要的整十数），倾角取该带档位（0.5° 才能表达 86.5°）。
  //     ③ 每颗星归到**同倾角带内最近的层**：距离 ≤ NEAR 才算"在层上"。
  //   判据（逐星，全部只依赖 TLE）：
  //     hot   = |2 天速率| > RATE_TH                       → 变轨中·点火
  //     off   = 无层 或 距层 > NEAR                         → 变轨中·间歇
  //     creep = 在层上、但最近 7 天仍净升 ≥ CREEP_TH        → 变轨中·间歇（贴层慢爬）
  //     其余                                               → 在轨
  //   ★ creep 就是「每天变化很小、连着很多天」的兜底：7 天净升 3 km ≈ 0.43 km/天，低于 2 天速率的
  //     检出线（0.5），但 7 天累计看得见 —— 稳定星同口径的噪声 p99 只有 0.54 km/14 天。
  //   ★ 为什么不用「30 天净升 ≥10」直接判：刚到位不到 30 天的星，窗口里还带着爬升段（实测 qf
  //     69857/69860/69865 三颗 Δ30=24.9 但 Δ7≈0，早就停了）。7 天窗把这类误判挡掉。
  const RISE_TH = 10;    // 30 天净升（km）：超过它就不算「稳定种子」
  const CREEP_TH = 3;    // 7 天净升（km）：贴层但仍在慢爬 → 判变轨中
  const LAYER_INC = 0.5, LAYER_GAP = 30, LAYER_MIN = 8, LAYER_SD = 8;
  const hAt = (pts, agoDays, tail) => {          // tail 之前最近一点的高度（km，离地）
    const t = tail - agoDays * DAY;
    let best = null;
    for (const p of pts) if (p[0] <= t + 1e-9) best = p;
    return best ? best[1] - RE : null;
  };
  // ① 稳定种子 + 逐星统计量
  for (const [, x] of rows) {
    const tail = x.pts[x.pts.length - 1][0];
    const h30 = hAt(x.pts, 30, tail), h7 = hAt(x.pts, 7, tail);
    x.rise30 = h30 === null ? null : (x.sma - RE) - h30;
    x.rise7 = h7 === null ? null : (x.sma - RE) - h7;
    const meta = SAT_META.get(x.norad) || {};
    x.con = meta.c || null;                      // 星座：层必须分星座建（星网 50° / 千帆 89° 各一套）
    x.inc = meta.inc;
    x.band = (x.inc === undefined || !isFinite(x.inc)) ? null : (Math.round(x.inc / LAYER_INC) * LAYER_INC).toFixed(1);
    x.stable = !x.geo && !x.thin && !x.moving && x.band !== null &&
      x.rise30 !== null && x.rise30 < RISE_TH;
    x.layer = null; x.dist = null;
  }
  // ② 分星座建层（层高 = 众数档 10 km；倾角 = 该带档位）
  const buildLayers = (list) => {
    const bands = new Map();
    for (const x of list) {
      if (!x.stable) continue;
      if (!bands.has(x.band)) bands.set(x.band, []);
      bands.get(x.band).push(x);
    }
    const res = [];
    for (const [bk, arr] of bands) {
      arr.sort((a, b) => a.sma - b.sma);
      const groups = [];
      let g = [arr[0]];
      for (let i = 1; i < arr.length; i++) {
        if (arr[i].sma - arr[i - 1].sma > LAYER_GAP) { groups.push(g); g = []; }
        g.push(arr[i]);
      }
      groups.push(g);
      for (const grp of groups) {
        if (grp.length < LAYER_MIN) continue;
        const hs = grp.map(x => x.sma - RE);
        const mean = hs.reduce((a, b) => a + b, 0) / hs.length;
        const sd = Math.sqrt(hs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / hs.length);
        if (sd > LAYER_SD) continue;             // 不像"壳"的一律不认（见上面 qf 800~974 的例子）
        const cnt = {};
        for (const h of hs) { const k = Math.round(h / 10) * 10; cnt[k] = (cnt[k] || 0) + 1; }
        let alt = 0, bn = -1;
        for (const k of Object.keys(cnt)) if (cnt[k] > bn) { bn = cnt[k]; alt = Number(k); }
        res.push({ alt: alt, inc: Number(bk), n: grp.length, sd: Math.round(sd * 10) / 10 });
      }
    }
    res.sort((a, b) => (b.n - a.n) || (a.alt - b.alt));
    return res;
  };
  const ORB_LAYERS = {};
  for (const bk of ['gw', 'qf']) {
    ORB_LAYERS[bk] = buildLayers([...rows.values()].filter(x => x.con === bk));
  }
  // ③ 逐星归层
  for (const [, x] of rows) {
    if (x.geo || x.band === null) continue;
    const cands = ORB_LAYERS[x.con] || [];
    let best = null, bd = Infinity;
    for (const L of cands) {
      if (L.inc !== Number(x.band)) continue;    // 只跟同倾角带比（50° 的星不可能落到 86.5° 的层里）
      const dd = Math.abs((x.sma - RE) - L.alt);
      if (dd < bd) { bd = dd; best = L; }
    }
    x.layer = best; x.dist = best ? bd : null;
  }
  // ④ 出参：orb(0 在轨 / 1 变轨中) + wk(参照层高度) + od(进入工作轨道日期) + rr(升轨速度)
  //
  // ★★ V1.9.9（Q26 用户裁决，2026-10-21）：**四态化 + 补「长期静止」判据** ★★
  //   用户原话：「长期静止在停泊轨道而非工作轨道在能明确识别（即你真的确认是维持在非工作轨道）
  //   的情况下标注为我们之前说过的在轨·可能异常，如果不确定则统一归为在轨·正常
  //   （"在轨·正常"这个分类应该指的是停泊和维持在预定工作轨道的卫星）」。
  //   旧判据的三个漏口（注入式探针实测）：
  //     ① `thin` 分支"近期首现即变轨中"完全不看层 → 误伤 8 颗（26176D~J + 26221G/J，
  //        同高 1148.6km、dist=1.4km，只因历史点 3 个 < MIN_PTS=4）；
  //     ② `off` 分支把"长期静止在非工作轨道"当成"正在变轨" → 误伤 25 颗（含 CX-26，
  //        历史跨度 92~1893 天、90 天漂移 −0.3~+3.2km）；
  //     ③ 没有"长期静止"这个判据，于是**永远不会**退出"变轨中"。
  //   判别器不是 `rr`（它只在 orb=1 时才写，是**结果**不是原因），而是「是否长期静止」：
  //     长期静止组 90 天漂移 −0.3~+3.2 km ｜ 真在途组 +19.2~+209.7 km —— 差一个数量级，阈值 5km 极安全。
  const PARK_SPAN = 60;      // 天：覆盖完整爬升周期（最短的真实案例 92 天）
  const PARK_DRIFT = 5;      // km：90 天净漂移阈值（实测两组相差一个数量级）
  const out = new Map();
  let nHot = 0, nIdle = 0, nCreep = 0, nOn = 0, nParked = 0, nAbn = 0, nOnLayer = 0, nThin = 0;
  for (const [n, x] of rows) {
    // 长期静止的两个统计量（与 `moving` 的 2 天 LSQ **不同**：这里看的是 90 天净漂移，
    //   专门用来回答"它是不是早就不动了"，而不是"它眼下有没有在点火"）
    const lastMs = x.pts[x.pts.length - 1][0];
    x.span = (lastMs - x.pts[0][0]) / DAY;
    {
      const sel90 = x.pts.filter(p => lastMs - p[0] <= 90 * DAY);
      if (sel90.length >= 2) {
        const kk = Math.max(1, Math.floor(sel90.length / 3));
        x.drift90 = median(sel90.slice(-kk).map(p => p[1])) - median(sel90.slice(0, kk).map(p => p[1]));
      } else x.drift90 = null;
    }
    // ★★ V2.0.1（用户裁决 D）：**"长期驻留"要有第二条判据** ★★
    //   用户原话：「很多卫星特别是试验星本身就不在一般的组网星常常部署的轨道（比如千帆DTC01），
    //   不能一味归类为等待变轨点火」。
    //   实例：26128A（千帆 DTC-01，410km）123 天净变化仅 +10 km、30 天速率 0.11，
    //   但 90 天漂移 7.1 km > 5 km 阈值 ⇒ 旧判据不认它"停住了" ⇒ 落在 `off` ⇒ 谎报"变轨中"。
    //   为什么 7.1 而不是 0：低轨（410km）大气阻力导致的高度波动天然比 1100km 大一个量级，
    //   同一个 5 km 阈值套在两种轨道上，物理基准并不统一。
    //   ⇒ 补一条与高度无关的判据：**近 30 天几乎没动（|30天速率| < RATE_TH）**也算长期驻留。
    //     它与 90 天漂移是互补的：一个看"这段时间的走向"，一个看"两端的总落差"。
    // ★ V2.0.1（A/D）：**长期驻留的第二条判据**（见上方 D 段说明）
    //   ⚠️ 这里**刻意没有**加"低于最近层就算在等爬升"的判据 —— 试过，代价太大：
    //   实测把 22 颗"低于最近层、但本来就在自己的轨道上稳定运行"的老星（57288/49059/60385…）
    //   全部翻成"变轨中"，可能异常档从 17 掉到 0。原因是 `x.layer` 是**最近的层**，
    //   不是"它该去的目标"；层被 LAYER_MIN/SD 过滤掉时，一颗在 1100 长期稳定的星
    //   会被归到 1150，然后被误判成"该爬却没爬"。
    //   ⇒ 停在低处且同批也没有任何星到位的个例（如 26153L 在 850 停 46 天），
    //     按 Q26 的「不确定一律正常」保守归入在轨 —— 与用户"不能一味归类为等待变轨点火"一致，
    //     反过来说也不能一味归为"在轨"：真在爬的（26153 那 17 颗）由 moving/off 正常判出。
    x.parked = x.span >= PARK_SPAN &&
      ((x.drift90 !== null && Math.abs(x.drift90) < PARK_DRIFT) ||
       (x.rate30 !== null && Math.abs(x.rate30) < RATE_TH));

    let orb, why;
    if (x.geo) {
      // 高轨沿用原口径（station-keeping 的浮动比 LEO 大，阈值 EPS_GEO）
      orb = x.moving ? 1 : 0; why = 'geo';
    } else if (x.thin) {
      // ★★ V1.9.9（Q26 修 ①）：thin 必须**先查层**。老写法直接"近期首现即变轨中"，
      //   把已经在层上、且不爬的星也判成变轨中。
      const inLayer = !!(x.layer && x.dist !== null && x.dist <= NEAR);
      const rising = (x.rise7 !== null && x.rise7 >= CREEP_TH);
      orb = (inLayer && !rising) ? 0 : ((Date.now() - x.pts[0][0] <= WIN * DAY) ? 1 : 0);
      why = 'thin'; nThin++;
    } else if (x.layer && x.dist !== null && x.dist <= NEAR &&
               (x.rise7 === null || x.rise7 < CREEP_TH)) {
      // ★★ V2.0.1（用户裁决 A）：**「已在工作层上」优先于「2 天速率」** ★★
      //   用户原话：「要合理区分**真在比较长的临时轨道等待变轨点火**的和**确实是位于新的工作轨道的**」。
      //   实例（实测抓到的两处误判）：
      //     · 26091D 在 510km 层上、近 7 天没爬，只因地 2 天速率 0.73 略超 0.5 → 旧判据报"变轨中·点火"；
      //       而同批 A/B/C 三颗都在"在轨" —— 同一批同高度，唯独它被一个噪声读数踢出在轨。
      //     · 26155A/D/G/L 已经停在 1070km 目标层（2 天速率 ≈0、7 天净升 ≈0），
      //       但 90 天漂移 188~219km（那段是**爬升过程**），若用长窗口速率反而会把它们误判成"还在变轨"。
      //   ⇒ 判据顺序改成「先看位置，再看速度」：
      //     已经在工作层上（dist ≤ NEAR）**且**近 7 天没爬（rise7 < CREEP_TH）⇒ 它就是到位了。
      //     真在爬的星 rise7 ≥ 3km/7天 会挡住这一条，继续走下面的 moving/off 分支，不会被误留。
      orb = 0; why = 'onLayer'; nOnLayer++; nOn++;
    } else if (x.moving) {
      // 真点火优先于"长期静止" —— 刚停下的星 2 天速率可能还没落下来，宁可继续报"变轨中"
      orb = 1; why = 'hot'; nHot++;
    } else if (x.parked) {
      // ★★ V1.9.9（Q26 修 ②）：长期静止 ⇒ 不再谎报"变轨中"。是「正常」还是「可能异常」
      //   由第二遍的同批对照判定（见下方 abn 计算）。
      orb = 0; why = 'parked'; nParked++; nOn++;
    } else if (!x.layer || x.dist > NEAR) {
      orb = 1; why = 'off'; nIdle++;
    } else if (x.rise7 !== null && x.rise7 >= CREEP_TH) {
      orb = 1; why = 'creep'; nCreep++;
    } else {
      orb = 0; why = 'on'; nOn++;
    }
    // ★★ V1.9.9（Q27 用户裁决，2026-10-21）：`wk` 语义订正为「**现在临时停泊的高度**」★★
    //   用户原话：「你这个 wk 是什么意思？什么要表达？表达在哪？如果你指的是未被简化的
    //   变轨情况完整信息段里的括号内内容，那就是**现在临时停泊的高度**。」
    //   旧口径 `wk = x.layer.alt`（**目标层高**）的病根：CX-26（26158A）实际停在 **807.3km**，
    //     却因为被归到 1100 层而显示 `wk=1100` —— 用户看到的"高度"不是它真在的高度。
    //     实测：`orb=0` 的 402 颗里，改成实际高度后只有 **4 颗**会变（1053↔1070，都是层边缘）。
    //   新口径：
    //     · `wk` = **当前实际离地高度**（10 km 档位化，与页面"整十数"口径一致）
    //     · `la` = 它**归属的层高**（设计层，用于层成员判定；`wk` 已不再承担这个职责）
    //     · `od` = 首次落进**设计层** ±NEAR 的那条 TLE（仍按 `la` 算，语义不变）
    //   ⚠️ 为什么要拆两个字段：`wk` 一旦改成实际高度，页面 `orbLayerDefs()` 里
    //     `s.wk === L.alt` 的精确相等判定会立刻失效（实际高度很少恰好等于整层高）。
    const actualAlt = Math.round((x.sma - RE) / 10) * 10;
    let la = null;                     // 归属层高（设计层），可能为 null（无层可比）
    if (!x.geo) {
      if (x.layer) la = x.layer.alt;
      else {
        const sib = [...rows.values()].filter(y => y.key === x.key && y.layer && !y.geo);
        la = sib.length
          ? Math.round((sib.reduce((a, y) => a + y.layer.alt, 0) / sib.length) / 10) * 10
          : Math.round((x.hmax) / 10) * 10;
      }
    }
    const wk = x.geo ? 'GEO' : actualAlt;
    // 进入工作轨道日期 = 首次落进**设计层** ±NEAR 的那条 TLE（只对在轨态求值：
    //   变轨中的星在上升途中会穿过工作带，那不算"进入工作轨道"）
    let od = null;
    if (orb === 0) {
      const ref = (typeof la === 'number') ? la : null;
      if (x.geo) {
        for (const p of x.pts) if (p[1] >= GEO_SMA) { od = p[0]; break; }
      } else if (ref !== null) {
        for (const p of x.pts) if (Math.abs((p[1] - RE) - ref) <= NEAR) { od = p[0]; break; }
      }
    }
    // ★ V2.0.1（O-1）：把 `alt`（实际高度）与 `bkey`（批次键）一并留在 ORBIT_ST 里 ——
    //   构建期自检要用它们算「变轨中但离停泊层多远」。ORBIT_ST 是**构建期中间表**，
    //   不进产物（只有 .layers 会被发布），所以加字段没有体积代价。
    const rec = { orb: orb, wk: wk, od: od ? ymd8(od) : '', la: la, alt: actualAlt, bkey: x.key, thin: !!x.thin,
      // ★ V2.0.1（O-1）：历史跨度也要留 —— 自检只对**跨度足够做判断**的星报错。
      //   跨度不足 60 天的星，判据会保守地把它们留在「变轨中」（无法证明"停住了"），
      //   那是**设计**，不是矛盾；把它算进自检等于让守卫误伤自己。
      span: x.span, rate30: x.rate30 };
    if (orb) {
      if (x.rate !== null && x.rate !== undefined && isFinite(x.rate)) {
        rec.rr = Math.round(x.rate * 100) / 100;
      }
    }
    out.set(n, rec);
  }
  // ★★ V2.0.1：**判据分支命中分布** —— 每个分支都必须 >0，否则说明存在不可达代码。
  //   放在这里（判据循环刚结束）而不是统计打印处：那些计数器是**本循环的局部变量**，
  //   拿到 IIFE 外层会直接 ReferenceError（第一次就插错位置，实测报 nOnLayer is not defined）。
  console.log('  判据分支：层优先 ' + nOnLayer + '｜hot ' + nHot + '｜parked ' + nParked +
    '｜off ' + nIdle + '｜creep ' + nCreep + '｜on ' + (nOn - nOnLayer) + '｜thin ' + nThin);
  // ★★ V1.9.9（Q26 第二遍）：**「在轨·可能异常」判定**（用户裁决："能明确识别才标异常，不确定一律正常"）
  //   判据（三个条件同时成立才算"确认维持在非工作轨道"）：
  //     ① 长期静止（`x.parked`：跨度 ≥60 天 且 90 天漂移 <5km）—— 它确实**停住了**，不是在爬
  //     ② 离**所有**同倾角带的层都 > ABN_NEAR（100km）—— 它确实**不在任何工作层上**
  //     ③ **同批已有成员稳稳落在层上**（`orb=0 且 dist≤NEAR`）—— 这是"确认"的关键：
  //        同批同型星都到位了，它还停在别处 ⇒ 能明确识别为异常停泊
  //   为什么必须有 ③：早期批次（如千帆极轨01~04组、KL-Alpha/Beta、星网早期试验星）
  //     整批都在 800~1030km **各自的高度上工作**，同批没有任何成员在 1070 层上 ——
  //     那种情况**不是异常**，只是本项目识别出的层没覆盖它们。缺了 ③ 会一口气误伤 25 颗。
  //   实测（注入式探针）：本判据命中 **17 颗**（24140G / 24185A~S 共 12 颗 / 24232D,G / 25046E / 25233L）。
  const ABN_NEAR = 100;
  for (const [n, x] of rows) {
    const rec = out.get(n);
    if (!rec || rec.orb !== 0) continue;
    if (x.geo || !x.parked) continue;
    // ② 离所有同倾角带的层 > ABN_NEAR
    const band = x.band === null ? null : Number(x.band);
    if (band === null) continue;
    let minD = Infinity;
    for (const L of (ORB_LAYERS[x.con] || [])) {
      if (L.inc !== band) continue;
      minD = Math.min(minD, Math.abs(rec.wk - L.alt));
    }
    if (!isFinite(minD) || minD <= ABN_NEAR) continue;
    // ③ 同批已有成员稳稳落在层上
    let landed = 0;
    for (const [n2, y] of rows) {
      if (y.key !== x.key || y === x) continue;
      const r2 = out.get(n2);
      if (r2 && r2.orb === 0 && y.dist !== null && y.dist <= NEAR) landed++;
    }
    if (!landed) continue;
    rec.st = 'abn';      // 在轨·可能异常
    rec.abn = Math.round(minD);   // 离最近设计层多远（供说明文字/自检）
    nAbn++;
  }
  // ★ V1.9.7：判据构成写进日志 —— 误判只能靠这张表定位（与旧版的 [orb] 行对应）
  console.log('[orb] 在轨 ' + nOn + '（其中长期静止 ' + nParked + '、可能异常 ' + nAbn + '）｜点火 ' + nHot +
    '｜离层 ' + nIdle + '｜贴层慢爬 ' + nCreep +
    '｜层数 ' + Object.keys(ORB_LAYERS).map(k => k + '=' + ORB_LAYERS[k].length).join(' ') +
    '｜层明细 ' + Object.keys(ORB_LAYERS).map(k =>
      k + '[' + ORB_LAYERS[k].map(L => L.alt + '/' + L.inc + '°×' + L.n + '(σ' + L.sd + ')').join(' ') + ']').join(' '));
  out.layers = ORB_LAYERS;      // 随 satdata 发布：页面第 0 章与 03 章直接用这份（单一事实来源）
  return out;
})();

// 把三态字段挂到 sats 记录上（DATA 里的 sats 与 gwPack.sats 是同一个数组引用，改元素即生效）
{
  let nOrb = 0, nRaising = 0, nGeo = 0, nFallback = 0, nWiki = 0, nAbn2 = 0;
  for (const bk of ['gw', 'qf']) {
    for (const rec of (bk === 'gw' ? gwPack : qfPack).sats) {
      // ★ V1.9.5（H13）：单星词条（在包里重建的记录上按 id 回填 —— 就地写在 pack() 里会丢）
      const w = (bk === 'gw' ? H13_GW : H13_QF)[rec.id];
      if (w) { rec.wu = w.wu; if (w.wn) rec.wn = w.wn; if (w.en) rec.en = w.en; nWiki++; }
      const st = ORBIT_ST.get(rec.id);
      // ★★ V1.9.9（Q26 排查中发现的真缺陷，2026-10-21）：**已再入的星不能走"在轨判据兜底"** ★★
      //   病根：ORBIT_ST 在构建 rows 时用 `if (REENTRY.has(n)) continue;` 把已再入的星**主动排除**
      //     （它们走 `st:'r'` + `dt` 的独立通道），所以这些星**永远拿不到 st**，必然落进下面的兜底
      //     分支 → 被赋上 `orb=1`（变轨中）、`wk=510`（同批设计层高）这类**伪在轨数据**。
      //   实测受害样本：25067A（NORAD 63428，2025-10-16 再入）。
      //     它虽因 `st==='r'` 在前端优先显示"已再入"而不至于显示错，但 `wk=510` 恰好等于
      //     gw 的 510/55° 层高 ⇒ 只要哪天 orb 判定条件放宽（比如允许 undefined 也计入，
      //     这个放宽在 orbLayerDefs 里**已经存在**），它就会被算进「510 层成员数」里。
      //     这是一颗**已经不存在的卫星**，绝不该参与任何轨道统计。
      //   ⇒ 先判再入，命中就直接收尾（orb/wk/la/od 全部按"无意义"处理），不进任何在轨判据。
      if (!st && REENTRY.has(rec.id)) {
        rec.orb = -1;          // -1 = 已再入（不参与在轨/变轨中的二分类统计）
        rec.wk = null; rec.la = null; rec.od = '';
        rec.st = 'r';
        if (!rec.dt) rec.dt = REENTRY.get(rec.id);
        continue;
      }
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
          // ★ V1.9.9（Q27）：优先取同批成员的**设计层高 `la`**（`wk` 现在是实际高度，
          //   拿它当"该批工作高度"会把落单星的实际高度当成整批的设计层，语义就错了）
          if (os && typeof os.la === 'number') { sumGuess += os.la; nGuess++; }
          else if (os && typeof os.wk === 'number') { sumGuess += os.wk; nGuess++; }
        }
        if (nGuess) wkGuess = Math.round((sumGuess / nGuess) / 10) * 10;
        else wkGuess = Math.round(400 / 10) * 10;
        rec.orb = 1; rec.wk = wkGuess; rec.la = null; rec.od = '';
        nRaising++; nFallback++;
        continue;
      }
      rec.orb = st.orb; rec.wk = st.wk; rec.od = st.od;
      // ★ V1.9.9（Q27）：`la` = 归属的设计层高（`wk` 改为实际高度后，层成员判定改用它）
      if (st.la !== undefined) rec.la = st.la;
      // ★ V1.9.9（Q26）：四态 —— `st` 覆盖 'r'（已再入，别处写）/ 'abn'（在轨·可能异常）
      if (st.st) rec.st = st.st;
      // ★ V1.9.9（Q26）：`abn` = 离最近设计层多远（km，仅 abn 态有）—— 别漏抄，
      //   `pack()` 是**白名单式**赋值，ORBIT_ST 里多出来的字段不会自己跟过来。
      if (st.abn !== undefined) rec.abn = st.abn;
      if (st.rr !== undefined) rec.rr = st.rr;
      if (st.orb) nRaising++; else nOrb++;
      if (st.st === 'abn') nAbn2++;
      if (st.wk === 'GEO') nGeo++;
    }
  }
  console.log('在轨状态（A7）：在轨 ' + nOrb + '（其中可能异常 ' + nAbn2 + '）/ 变轨中 ' + nRaising +
    '（其中 GEO ' + nGeo +
    (nFallback ? '，其中 ' + nFallback + ' 颗因无历史点走兜底' : '') + '）' +
    '｜H13 单星词条已挂 ' + nWiki + ' 颗');
}
// ★ V1.9.7（§6 治本）：把**实测工作轨道层**随 satdata 发布 —— 页面第 0 章「轨道分布」与
//   03 章的虚线椭圆直接读这份，与判定用的层是**同一份数据**（不再两处各算一遍，避免漂移）。
//   结构：[{ alt: 整十公里, inc: 0.5° 档位, n: 成员数, sd: 高度标准差 }]，按成员数降序。
// ★★ V2.0.1（O-1）：**构建期自检** —— 把「静默错判」变成可断言的数字 ★★
//
// 为什么需要它：本项目最危险的一类缺陷不是崩溃，而是**判据静默错判** ——
//   页面不报错，只是把状态显示错。历史实例：18 颗 `P` 星全被判「变轨中」、
//   「在轨·可能异常」这一档**永远显示不出来**（直到人肉探针才查到）。
//   人肉探针能查一次，查不了每一天。所以把两条**可量化**的疑点写进产物，让 smoke 每天断言。
//
// 两条判据（都是"语义矛盾"，不是"数据异常"）：
//   ① 变轨中但 2 天速率 ≈ 0（|rr| < 0.15 km/天）—— 在推就该有速率，没速率就不该叫"在推"；
//   ② 变轨中但离自己的停泊高度 > 60 km —— 要么判据把已到位的星误判成变轨，
//      要么它真的在做长途机动（正常应是个位数）。
//
// ⚠️ 超阈值只进 `warnings[]` 并让 smoke 断言，**不阻断构建**：
//   数据本身可能是对的（例如 GEO 位置保持机动），阻断会逼人把阈值放宽 —— 那就成了新的自欺。
//   （这条口径与「守卫的判据不能手写」是同一件事的两面：判据要能反映事实，不能反过来裁剪事实。）
function selfCheckOf(map, isGw) {
  let moving = 0, thin = 0, shortSpan = 0, rateZero = 0, far = 0;
  const rateZeroIds = [], farIds = [];
  for (const [norad, x] of map) {
    if (x.orb !== 1) continue;
    const inThis = isGw ? !!GW_LAUNCH[x.bkey] : !!QF_LAUNCH[x.bkey];
    if (!inThis) continue;
    moving++;
    // ⚠️ **thin（历史点不足）的星必须单独排除**，否则自检会把**设计的保守兜底**当成缺陷：
    //   `thin` 分支的判据是「首点距现在 ≤30 天 ⇒ moving」—— 刚发射的星本来就会被判「变轨中」，
    //   而它算不出速率（点太少）时 `rr` 恰好是 0。
    //   实测第一次跑：gw 14 颗 / qf 25 颗命中，6 位 NORAD（100795~100799、100973…）全是刚编目的新星。
    if (x.thin) { thin++; continue; }
    // 同理：**历史跨度 <60 天**的星判据无法证明"它停住了"，保守留在「变轨中」也是设计。
    //   （与 `parked` 的 PARK_SPAN=60 同口径 —— 判据自己都要 60 天才敢说"停住了"，
    //     自检没理由用更短的标准去指责它。）
    if (!(x.span >= 60)) { shortSpan++; continue; }
    // ★★ V2.0.1（用户裁决 A 的配套）：自检判据从 **2 天速率**改用 **30 天速率** ★★
    //   病根：2 天窗对**台阶式爬升的平台期**会读成 0（末两点等高），于是把"真在爬"报成"速率≈0"。
    //   实测：26153A/F/H/M + 26155C 五颗，2 天速率 0 但 30 天速率 1.45~1.80（100 天净爬 +109~+119km）
    //   —— 它们判"变轨中"是对的，是**自检的尺子太短**。
    //   换 30 天窗后，这五颗不再误报；真正的"停住却仍标变轨中"才会被抓住。
    if (typeof x.rate30 === 'number' && Math.abs(x.rate30) < 0.15) { rateZero++; if (rateZeroIds.length < 6) rateZeroIds.push(norad); }
    if (typeof x.alt === 'number' && typeof x.wk === 'number' && Math.abs(x.alt - x.wk) > 60) {
      far++; if (farIds.length < 6) farIds.push(norad);
    }
  }
  const warns = [];
  if (rateZero > 0) warns.push('数据充分却「变轨中·速率≈0」 ' + rateZero + ' 颗（' + rateZeroIds.join(',') + '）');
  if (far > 10) warns.push('变轨中但离停泊层 >60km ' + far + ' 颗（' + farIds.join(',') + '）');
  return { moving, thin, shortSpan, rateZero, far, rateZeroIds, farIds, warns };
}
const SELF_CHECK = { gw: selfCheckOf(ORBIT_ST, true), qf: selfCheckOf(ORBIT_ST, false) };
DATA.selfCheck = SELF_CHECK;   // V2.0.1（O-1）：自检结果随产物发布
for (const k of ['gw', 'qf']) {
  const s = SELF_CHECK[k];
  console.log('自检 ' + k + '：变轨中 ' + s.moving + ' 颗（历史点不足 ' + s.thin + '｜跨度<60天 ' + s.shortSpan + '）｜数据充分却速率≈0 ' + s.rateZero + ' 颗｜离层>60km ' + s.far + ' 颗'
    + (s.warns.length ? '  ⚠️ ' + s.warns.join('；') : '  ✓'));
}
DATA.gw.layers = ORBIT_ST.layers.gw;
DATA.qf.layers = ORBIT_ST.layers.qf;

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
  // ★ V2.0.1（R13）：`m` = 「多线」子表 —— 每个拐点在最坏情况下要画 1 或 2 根线。
  //   为什么不改 `b` 的既有形态：`b` 是**中值单值**，页面/导出/断言全都在读它；
  //   新增 `m` 并存（`b` 继续给"代表值"，`m` 给"最早/最晚"），旧产物仍能跑、新产物更精确。
  const out = { gw: { b: {}, s: {}, m: {} }, qf: { b: {}, s: {}, m: {} } };
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
        // ★★ V2.0.1（R13）：把「最早 / 最晚」也算出来 ★★
        //   用户口径（Q13/Q23）：
        //     · 虚线的本质是**标拐点**（由升转平 / 由平转升 / 进入再入），不封顶条数；
        //     · 同批各星的这个拐点若在 **≤5 天**内 → 画 **1 根**（取中值）；
        //       **>5 天** → 画 **2 根**（最早、最晚）—— 说明这一批的升轨本来就是分批进行的。
        //   ⚠️ 实测（2026-10-22）：51 个批次里 **35 个跨度 >5 天**（最大 253 天），
        //     所以这不是"极少触发的特例"，而是常态 —— 必须做，且页面要能画任意条数。
        const dOf = ms => Math.floor(ms / DAY);
        const sLo = dOf(Math.min.apply(null, starts)), sHi = dOf(Math.max.apply(null, starts));
        const eLo = ends.length ? dOf(Math.min.apply(null, ends)) : null;
        const eHi = ends.length ? dOf(Math.max.apply(null, ends)) : null;
        const MULTI_DAY = 5;
        out[bk].m[key] = {
          s: (sHi - sLo > MULTI_DAY) ? [sLo, sHi] : [Math.floor(med(starts) / DAY)],
          e: done ? ((eHi - eLo > MULTI_DAY) ? [eLo, eHi] : [Math.floor(med(ends) / DAY)]) : null
        };
        stat.batches++;
        if (sHi - sLo > MULTI_DAY) stat.multiStart = (stat.multiStart || 0) + 1;
        if (done && eHi - eLo > MULTI_DAY) stat.multiEnd = (stat.multiEnd || 0) + 1;
      }
    }
  }
  console.log('升轨阶段（H10 ③b）：批次 ' + stat.batches + ' 条 / 单星 ' + stat.sats +
    ' 条（其中仅再入线 ' + stat.endOnly + '）' +
    '｜R13 多线：开始 ' + (stat.multiStart || 0) + ' 批 / 结束 ' + (stat.multiEnd || 0) + ' 批（跨度 >5 天）');
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
// ★★ V2.0.0.630 紧急修补（2026-10-22 用户报「变轨图左侧一大片空白 + 空白里有拐点虚线」）★★
//   病根：兜底窗口 60 天，而**变轨图的横轴左端取的是"发射日 vs 数据首点"的较早者**。
//     于是打开本地 HTML（file:// 取不到 history/ 分片）时：数据只剩最近 60 天（如从 08-24 起），
//     横轴却从发射日（07-16）画起 → 左边空出 5 周多；
//     而拐点虚线来自**构建期用全量历史算的 phases**（07-16 那次抬升）→ 正好落在空白里。
//   两处一起治：① 兜底窗口 60→180 天、抽稀 2→3 天（实测 satdata 0.28→0.51 MB，
//     任何 180 天内发射的批次都能看到完整爬升段）；② 页面侧再兜一层（climbStartMs / 拐点越界丢弃），
//     即使将来窗口再变，也不会把虚线画进虚空。
const BUNDLE_DAYS = 180;     // 内置兜底只留最近 180 天
const BUNDLE_STEP = 3;       // 内置兜底每 3 天一点（≈60 点/星）
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
const HIST_OUT = path.join(BUILD, 'history');
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

// ★ V1.9.7（P0-B）：随数据发布「**在线分组/名称查询取不到**」的卫星 NORAD。
//   为什么需要：页面运行时会联网刷新，但 TLE_SRC 只有 GROUP=hulianwang/qianfan + NAME= 前缀查询，
//   而下面这些名字**一个都命中不了**（NAME= 是前缀匹配）：
//     · 星网 GEO 三星写的是 `HULIANWAN GAOGUI-01/02/03`（**单 G**）
//     · `CHUANGXIN 20A/B/C`、`CHUANGXIN 19`、`CHUANG XIN 26`、`OBJECT B`
//     · 千帆 `KL-ALPHA A/B`、`KL-BETA A/B`、`DTC TEST OBJECT A`
//   它们只能靠 refresh.mjs 的 INCLUDE 白名单点名纳入 → 页面联网后会把它们丢掉（含全部 GEO）。
//   所以把真实名单随 satdata 发布，页面用 `CATNR=` 精确补拉。
const LIVE_NAME_RE = { gw: /^(HULIANWANG|GUOWANG|GW-)/i, qf: /^(QIANFAN|SPACESAIL|G60)/i };
['gw', 'qf'].forEach(k => {
  const src = (k === 'gw' ? gw : qf) || [];
  DATA[k].extra = src.filter(s => !LIVE_NAME_RE[k].test(s.name || '')).map(s => s.id).sort((a, b) => a - b);
});
console.log('[live] 需按 CATNR 补拉：gw ' + (DATA.gw.extra || []).length + ' 颗 / qf ' +
  (DATA.qf.extra || []).length + ' 颗 → ' + JSON.stringify((DATA.gw.extra || []).concat(DATA.qf.extra || [])));

// ★★ V1.9.7（§23.3-c）：**条数下限闸门** —— 输入残缺时宁可失败，也绝不写出可发布的坏数据。
//   背景（2026-10-17 线上事故）：refresh 当时因网络退化只抓到 0 份数据，mkdata 照样产出一份
//   "少了 wu/wn 字段"的 satdata 并被发布 → 表格全变「在轨（~-, undefinedkm）」、03 章 GEO 三星消失。
//   判据只做**数量级**判断（星网/千帆各自的下限），不猜具体内容；命中即**不写文件**并非 0 退出。
//   ⚠️ 用 exitCode 而不是 process.exit()：端到端测试是**同进程 import** 本脚本的（见 refresh.mjs 同款注释）。
//   ★ V1.9.7 追加：**字段覆盖率闸门**。只数条数不够 —— 2026-10-17 那次事故里条数是够的（251 颗），
//     坏的是字段维度：表格「在轨状态」由 `wk` 拼出、三态由 `orb` 决定，任一缺失就是满屏 `undefinedkm`。
//     实测（好数据）：`wk`/`orb` 覆盖率 **100%**；而 `wu`/`wn` 只有 8.3% / 1.9%（**合法可缺**，不能拿它当判据）。
const MIN_SATS = { gw: 200, qf: 200 };
// ★ V1.9.7（A12）：GEO 条数（星网 3 颗高轨业务星）—— 它们只能按白名单纳入，是链条上最脆的一环
const nGeo = ((DATA.gw && DATA.gw.sats) || []).filter(s => s.wk === 'GEO').length;
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
if (OMM_MISSING.length) {
  // ★ V1.9.9（O30-9）：映射不全 → 拒绝写出（否则 6 位号会在页面上退化成 3 位数 `203`）
  console.error('[mkdata] 拒绝写出：6 位编目号映射不全 —— ' + OMM_MISSING.length +
    ' 颗的占位号在 data/omm_norad.json 里查不到');
  OMM_MISSING.slice(0, 10).forEach(t => console.error('[mkdata]   - ' + t));
  console.error('[mkdata] 修法：先跑 `node refresh.mjs` 重写 data/omm_norad.json（它由 OMM→TLE 转换时同步产出），再重跑本脚本。');
  console.error('[mkdata] 已**不写出** build/satdata.json —— 宁可失败，也不要带着错误编目号去打包。');
  process.exitCode = 7;
} else if (bad.length || thin.length) {
  bad.forEach(k => console.error('[mkdata] 拒绝写出：' + k + ' 只有 ' +
    ((DATA[k] && DATA[k].sats) || []).length + ' 颗（下限 ' + MIN_SATS[k] + '）'));
  if (thin.length) console.error('[mkdata] 拒绝写出：字段覆盖不足（阈值 ' + (COVER_MIN * 100) + '%）→ ' + thin.join('；'));
  console.error('[mkdata] 输入疑似残缺 —— 先确认 `node refresh.mjs` 是否真的抓到了数据（输出里不应出现大量「0 份」）。');
  console.error('[mkdata] 已**不写出** build/satdata.json，避免坏数据被打包发布。');
  process.exitCode = 5;
} else if (!nGeo) {
  // ★ V1.9.7（A12）：**GEO 闸门** —— 星网那 3 颗高轨业务星是"点名纳入"的，源站分组一变就会整批消失，
  //   而条数与字段覆盖率都察觉不到（2026-10-17 的线上退化里它们就是第一个没的）。这里宁可失败。
  console.error('[mkdata] 拒绝写出：星网 GEO 卫星 0 颗（应 ≥1；它们只能按 INCLUDE 白名单纳入，' +
    '请检查 refresh.mjs 的 INCLUDE 与 satcat 是否已变）');
  process.exitCode = 6;
} else if ((GW_COUNT_MISS.length || QF_COUNT_MISS.length) && !ALLOW_COUNT_MISS) {
  // ★★ V1.9.9.630：**发射批次颗数闸门**（见 auditCountsCoverage 的长注释）。
  //   为什么它必须是"拒绝写出"而不是"打个警告就过"：
  //     这是本轮实测到的**静默数据回退** —— 页面照常渲染、图照常画，只是「发射卫星数」少 9 颗，
  //     没有任何东西会红。而 `satcat.csv` 被 .gitignore（CI 每轮都是新下载），
  //     所以本机这份过期文件**只有靠这道闸门才会被发现**。
  //   代价可控：`CISTRACK_ALLOW_COUNT_MISS=1` 可显式放行（用于"已知 satcat 拉不到、先出产物"的应急）。
  console.error('[mkdata] 拒绝写出：有 ' + (GW_COUNT_MISS.length + QF_COUNT_MISS.length) +
    ' 个**非失利**批次在 satcat.csv 里查不到（「发射卫星数」会偏少）：' +
    [].concat(GW_COUNT_MISS.length ? ['gw: ' + GW_COUNT_MISS.join(',')] : [],
      QF_COUNT_MISS.length ? ['qf: ' + QF_COUNT_MISS.join(',')] : []).join(' | '));
  console.error('[mkdata] 修法：`node refresh.mjs --force-cat` 重下 data/satcat.csv 后重跑；' +
    '应急放行：设环境变量 CISTRACK_ALLOW_COUNT_MISS=1。');
  process.exitCode = 8;
} else {
  fs.writeFileSync(path.join(BUILD, 'satdata.json'), JSON.stringify(DATA), 'utf8');
  console.log('satdata.json bytes=', fs.statSync(path.join(BUILD, 'satdata.json')).size);
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
  // ★★ V1.9.9.630（治本）：**顶层 asOf 必须取 gw/qf 里更晚的那个，而不是直接抄 gw。**
  //   事故链（实测提交 382957d 已经真实发生）：
  //     ① `scripts/fetch_wiki.mjs` 的 `gw.asOf` 曾用 **UTC** 日期（`toISOString()`），
  //        而顶层 `asOf` 用**北京**日期 → 北京 00:00 那一轮，`gw.asOf` 落后一天；
  //     ② 本行原来写 `asOf: WIKI_STAT.gw.asOf` → 于是每次 CI（恰在北京 00:00 跑）
  //        都把页面日期**改回前一天**：`- "asOf": "2026-10-21"` / `+ "asOf": "2026-10-20"`；
  //     ③ 页面读的正是**顶层** `asOf`（app.js 的 `wiki.asOf`），所以用户在页面上
  //        看到「卫星百科更新」倒退 —— 这是纯用户可见的 bug。
  //   修法两层（缺一不可，因为两侧都可能被单独回退）：
  //     · fetch_wiki.mjs 已改用北京时间日期（根因）；
  //     · 这里取 `gw` / `qf` 的**最大值** —— 即使某天只有一侧成功刷新，顶层也不会退。
  //   为什么不取 "今天"：顶层 asOf 的语义是"**词条数据截至哪一天**"，不是"我们哪天核对的"
  //   （后者是 checkedAt）。抓不到新数据时它本就该停着不动，而不是假装更新。
  asOf: (() => {
    const a = [WIKI_STAT.gw && WIKI_STAT.gw.asOf, WIKI_STAT.qf && WIKI_STAT.qf.asOf]
      .filter(x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}/.test(x));
    return a.length ? a.sort()[a.length - 1] : '';
  })(),
  checkedAt: WIKI_CHECKED_AT,
  // ★ O30-12（V1.9.9 收尾）：卡片抓取状态（fetch_wiki_cards.mjs 补丁进来的同源键）。
  //   页面「卫星百科更新」行附显；老部署没有该键时页面只显示核对时间，行为不变。
  cards: CARDS_STATUS || undefined
};
// ★ V1.9.1：末尾补一个换行 —— `JSON.stringify` 不产出行尾换行，而仓库里的 wiki.json 是
//   带换行的（编辑器保存的正常产物）→ 不加就会永远留下"最后一行少了 \n"的 diff。
fs.writeFileSync(path.join(BUILD, 'wiki.json'), JSON.stringify(WIKI_JSON, null, 1) + '\n', 'utf8');
console.log('wiki.json bytes=', fs.statSync(path.join(BUILD, 'wiki.json')).size);
