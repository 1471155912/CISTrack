/* 星网 / 千帆 在轨追踪 —— 全部计算在浏览器内完成（SGP4 + WGS-72） */
(function () {
'use strict';

var RE = 6378.135;          // WGS-72 地球平均半径, km
var MU = 398600.8;          // WGS-72 地心引力常数, km^3/s^2
var J2 = 1.082616e-3;       // WGS-72 二阶带谐系数
var DEG = 180 / Math.PI, RAD = Math.PI / 180;
var DAY = 86400000;

var SGP4 = window.satellite;
var RAW = window.SATDATA;
var COAST = window.COAST_DATA || [];
var VERSION = 'V1.9.0';          // 页脚版本号，后续更新在此改动

// ---------------------------------------------------------------- V1.3.7：TLE 分组差分解码
// 构建脚本按发射批次（COSPAR 前缀）把「名称+两行要素」压成公共模板 + 每颗星的差异串，
// 这里在启动时还原成 {name,id,c,l1,l2}，后续所有代码照旧，不必知道压缩这件事。
// 运行时联网刷新拿到的本来就是完整 TLE，直接跳过。
var B64C = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function unpackSat(s, tpls) {
  var tpl = tpls && tpls[s.c.slice(0, 5)];
  if (!tpl || s.l1) return s;                       // 没有模板（或已是完整要素）→ 原样返回
  var bits = new Array(162), k = 0;
  for (var i = 0; i < tpl.m.length; i++) {
    var v = B64C.indexOf(tpl.m.charAt(i));
    for (var j = 5; j >= 0; j--) { if (k < 162) bits[k++] = (v >> j) & 1; }
  }
  var rec = '', fi = 0, di = 0;
  for (var p = 0; p < 162; p++) rec += bits[p] ? tpl.f.charAt(fi++) : s.d.charAt(di++);
  return { name: rec.slice(0, 24).trim(), id: s.id, c: s.c, l1: rec.slice(24, 93), l2: rec.slice(93, 162) };
}
function unpackAll(key) {
  var c = RAW[key];
  if (!c || !c.tleTpl) return;
  for (var i = 0; i < c.sats.length; i++) c.sats[i] = unpackSat(c.sats[i], c.tleTpl);
}
var WIKI = {
  gw: 'https://sat.huijiwiki.com/wiki/%E6%98%9F%E7%BD%91',
  qf: 'https://sat.huijiwiki.com/wiki/%E5%8D%83%E5%B8%86%E6%98%9F%E5%BA%A7'
};
var BILI = 'https://space.bilibili.com/455972735';

// ---------------------------------------------------------------- 中英文
// V1.3.6：语言不落盘 —— 每次打开都是中文页（要英文请点顶栏的 EN）。
var LANG = 'zh';
var I18N = {
  // V1.3.4：顶栏品牌固定为 CISTrack（中英同字、不翻译），原副标题移到页面顶部第一行居中
  brandNote: ['非官方项目 · 数据来自 NORAD 空间目标目录公开轨道要素',
    'Unofficial · orbit elements from the public NORAD satellite catalog'],
  pageTitle: ['中国低轨互联网卫星在轨态势', 'China LEO Internet Constellations Live'],
  cn_gw: ['星网', 'CSCN'], cn_qf: ['千帆', 'Qianfan'],
  // V1.8.0（需求15 i18n 审计）：03.5 组网进度章的星座名（图例 / 信息窗 / 星座开关按钮共用）。
  //   此前这三个地方引用了 n_gw / n_qf，但表里**根本没有这两个键** —— t() 找不到键时会原样
  //   返回键名，于是新章节会直接把「n_gw」当文字画在页面上（英文界面同样漏）。现补齐。
  n_gw: ['星网', 'CSCN'], n_qf: ['千帆', 'Qianfan'],
  // V1.9.0（需求9）：选中提示语 —— 批次/组全选、单颗选中、跨星座三种
  d_sel_all: ['已全选', 'All selected'],
  d_sel_one: ['已选择', 'Selected'],
  // V1.9.1（A3）：黄框行（`pend-part` / `pend-none`：本星座有这条发射记录，但库内**没有任何轨道要素**）
  //   被点击时弹的**反色**提示 —— 用 `.inv` 变体（暗色=白底黑字 / 亮色=黑底白字）。
  d_sel_notle: ['当前暂无TLE数据', 'No TLE data yet'],
  d_sel_cross: ['已全选，请切换星座页面查看', 'All selected — switch constellation to view'],
  // V1.9.0（需求18）：**导出图片**底栏 CISTrack 行里的星座名 —— 英文必须用 CSCN / SpaceSail，
  //   此前那行用的是 st.name（星座对象自带的中文名），所以英文图里一直漏出「星网 / 千帆」。
  shot_gw: ['星网', 'CSCN'], shot_qf: ['千帆', 'SpaceSail'],
  // V1.7.0 第四轮（需求5a）：英文主标题的星座名换全称/并称（只用于第0章主标题，顶栏按钮仍用 cn_gw_short）
  cn_gw_long: ['星网', 'CSCN/GW'], cn_qf_long: ['千帆', 'SpaceSail/Qianfan'],
  d_dataupd: ['TLE更新时间', 'TLE updated'],          // V1.7.2（需求7）：数据更新 → TLE更新时间
  //   V1.7.2 第七轮（新需求A）：这个键现在**只**给主标题下方那一行（#pageEpoch）用；
  //   信息窗与导出图都改用 d_row_epoch_sat（该星历元），不再出现"整包历元"。
  d_row_epoch_sat: ['该星历元', 'Element epoch'],     // 信息窗里那一颗卫星自己的要素历元
  // V1.7.1（需求3）：d_snap_suffix / d_snap_tip 已删除 ——
  //   它们是给开发者看的「本次没联网成功、用的是打包时内置的轨道要素」标记，访客看不懂，
  //   挂在顶栏/信息窗/导出图上反而像出了错。现在界面上只显示纯粹的历元时间，
  //   "数据怎么来的、多久更新一次、断网怎么办" 改写进页内说明的数据来源章节。
  cn_gw_short: ['星网', 'CS'], cn_qf_short: ['千帆', 'SS'],
  // V1.3.6：键名里插一个零宽空格作断行点 —— 窄屏固定断在「发射/卫星」「在轨/卫星」，
  // 不会再断成「发射卫/星」；两个星座共用同一套键，格式自然一致。
  kv_group: ['星座', 'Constellation'],
  // V1.3.7：这两项在中文页也是两行（在轨 / 卫星），跟英文页的排布保持一致
  kv_sats: ['在轨<br>卫星', 'Satellites<br>in orbit'],
  kv_launched: ['发射<br>卫星', 'Satellites<br>launched'],
  kv_launchok: ['发射​成功', 'Launches succeeded'],
  kv_groups: ['发射​批次', 'Launch groups'], kv_alt: ['平均轨道​高度', 'Mean orbit altitude'],
  kv_inc: ['轨道​倾角', 'Inclinations'], kv_first: ['首发​发射', 'First launch'],
  // V1.7.0 第四轮（需求2）：页面除 TLE 外还用了卫星百科口径的数据 —— 在「首批发射」下如实标注数据截至日
  kv_wiki: ['卫星百科更新', 'Satwiki info update'],
  // V1.3.6：章节改名与重排 —— 01 地图 / 02 轨道 / 03 轨道分布 / 04 卫星表格 / 05 发射历史
  // V1.4.0：英文标题一律 Title Case（每个实词首字母大写）——这组键顶栏标签与页面章节标题共用
  h_map: ['地图', 'Map'], h_orbits: ['轨道', 'Orbits'], h_dist: ['倾角分布', 'Inclination Distribution'],
  h_sattable: ['卫星表格', 'Satellite Table'], h_launchhist: ['发射历史', 'Launch History'],
  // V1.3.6：三个图形章节标题右侧的小字（取代原来的缩放说明与 ＋/− 按键）
  zoomable: ['可缩放', 'Zoomable'],
  lead_chart: ['横轴是轨道倾角，纵轴是它们<b>实时</b>的轨道高度。同一批次的卫星挤在同一条倾角线上，往上爬的是已经抬到工作高度的——一张图就能看出整个星座分布在哪些轨道面上。',
    'The X axis is orbital inclination; the Y axis is the satellites\' orbit altitude <b>right now</b>. Satellites of one group line up on the same inclination, and the ones higher up have already reached their working altitude — one chart shows which orbital planes the constellation occupies.'],
  // V1.3.6：观测点的操作步骤与「？」提示重合，只留章节本身在讲什么
  lead_map: ['星座里每一颗卫星实时在地球上的什么位置，以及它对地面形成的可视覆盖区与前后各半圈的地面轨迹。',
    'Where every satellite of the constellation is right now, the coverage zone its signal reaches on the ground, and its ground track for half an orbit before and after now.'],
  lead_table: ['当前全部在轨卫星的轨道要素：半长轴、近地点、远地点、倾角、周期、在轨天数、轨道面升交点赤经、偏心率和轨道要素历元。默认按 NORAD 编号从大到小排列（新发射的在前），点击表头可换列或换方向；点击行选中卫星（再点一次或点空白处取消）；点击「批次」可直接选中该批次的全部卫星。',
    'Orbital elements of every in-orbit satellite: semi-major axis, perigee, apogee, inclination, period, days in orbit, RAAN, eccentricity and element epoch. Sorted by NORAD number, newest first, by default — click a header to sort by another column or reverse. Click a row to select a satellite (click again or click empty space to clear); click the group name to select the whole group.'],
  lead_launches: ['星座已发射的全部批次，含发射时间、运载火箭与发射场。标注「待编目」的批次已入轨：目录里已给出临时编号与摘要参数（周期/倾角/高度，见该行小字），但完整轨道要素尚未公开，因此不出现在图表与地图里。点击批次名即可选中该批次的全部在轨卫星（再点一次取消）。',
    'Every group launched so far, with launch time, launch vehicle and launch site. Groups marked "pending" are in orbit: the catalog already lists temporary numbers and summary parameters (period / inclination / altitude — see the small print on that row) but their full elements are not public yet, so they are absent from the chart and map. Click a group name to select all its in-orbit satellites (click again to clear).'],
  l_group: ['批次/组', 'Batch/Group'], l_mode: ['纵轴量', 'Y axis'], l_model: ['模型', 'Model'], l_color: ['配色', 'Colors'],
  m_sma: ['半长轴', 'SMA'], m_ha: ['远地点', 'Apogee'], m_hp: ['近地点', 'Perigee'],
  d_x_inc: ['轨道倾角', 'Inclination'],   // V1.3.6：分布图横轴标题
  md_bro: ['布劳威尔', 'Brouwer'], md_kep: ['开普勒', 'Kepler'],
  c_sat: ['按卫星', 'By satellite'], c_group: ['按批次', 'By group'],
  b_reset: ['重置视图', 'Reset view'], b_cov: ['可见区域', 'Coverage'],
  b_shot: ['导出图片', 'Save image'],          // V1.3.7
  // V1.4.0：导出弹窗与导出图底栏
  shot_cur: ['导出当前页', 'Save This Page'],
  shot_multi: ['导出多页', 'Save N Pages'],
  shot_all: ['导出全页', 'Save All Pages'],
  shot_ph: ['页数', 'pages'],
  shot_all_cols: ['含全部列', 'All columns'],
  d_err_t: ['页面遇到了一个脚本错误', 'The page hit a script error'],
  d_err_copy: ['复制诊断信息', 'Copy diagnostics'],
  d_err_copied: ['已复制', 'Copied'],
  d_err_close: ['关闭', 'Dismiss'],
  d_err_nosgp4: ['轨道计算库（satellite.js）没有加载成功，卫星位置无法推算。', 'The orbit library (satellite.js) failed to load, so positions cannot be computed.'],
  notice_new_t: ['检测到新编目的卫星', 'Newly catalogued satellites detected'],
  // V1.7.1（需求3）：原文说「页面内置快照」，与被删掉的「（内置快照）」后缀是同一个说法，
  //   访客看不懂。改成「本页面打包时收录的」—— 明确指出这是"打包那一刻的目录"，不是本次联网的结果。
  notice_new_m: ['在线目录比本页面打包时收录的多了 {n} 颗（最新 NORAD {id}），很可能又有一次发射。词条口径的统计数字不会自己更新 —— 更新 wiki.json 后刷新即可。',
    'The live catalog has {n} more satellite(s) than the set bundled when this page was built (newest NORAD {id}) — likely a new launch. The article-based counts do not update themselves; refresh after updating wiki.json.'],
  notice_ok: ['知道了', 'Got it'],
  // V1.7.0 第三轮（需求11）：全部 title 提示气泡接入 i18n（此前是硬编码中文，英文界面会漏出中文）
  t_repo: ['CISTrack 项目主页（GitHub）', 'CISTrack project home (GitHub)'],
  t_lang: ['切换中英文', 'Switch language'],
  t_theme: ['切换深浅色主题', 'Toggle light / dark theme'],
  t_fstime: ['点击切换 GMT / 本地时间', 'Click to switch between GMT and local time'],
  t_exitfs: ['退出全屏 (Esc)', 'Exit full screen (Esc)'],
  t_fullscr: ['全屏', 'Full screen'],
  t_panel: ['展开/收起设置面板', 'Expand / collapse the settings panel'],
  t_zoomin: ['放大', 'Zoom in'],
  t_zoomout: ['缩小', 'Zoom out'],
  t_resetview: ['恢复原始比例', 'Reset to original scale'],
  t_shot: ['导出图片', 'Export image'],
  t_selinfo: ['选中与信息窗', 'Selection & info panel'],
  t_resetall: ['把 01–05 全部章节的设置还原为初始配置', 'Restore the default settings of sections 01–05'],
  t_defmap: ['恢复 02 地图的初始设置', 'Restore the default settings of 02 Map'],
  t_deforb: ['恢复 03 轨道的初始设置', 'Restore the default settings of 03 Orbit'],
  t_defchart: ['恢复 03 倾角分布的初始设置', 'Restore the default settings of 03 Inclination Distribution'],
  d_loading_tle: ['正在获取最新轨道要素…', 'Fetching the latest orbital elements…'],
  // V1.7.0 二轮（需求6）：真全屏被浏览器/系统拒绝时的提示
  fs_fallback_t: ['全屏未生效', 'Full screen unavailable'],
  fs_fallback_m: ['浏览器或系统没有允许真全屏，已切换为「页面内满屏」模式：内容仍然铺满，但手机顶部的状态栏/浏览器工具条会保留一点。想彻底全屏可以再点一次全屏键，或把浏览器切到无痕/独立窗口重试。',
    'The browser or system did not allow true full screen, so an in-page full view is used instead. The page still fills the viewport, but the phone status bar / browser chrome may keep a strip. Tap full screen again, or retry in a private/standalone window.'],
  d_shot_disc: ['非官方项目，模拟基于开源 TLE 数据，不代表实际情况',
    'Unofficial project; simulation based on open TLE data, not the actual situation'],
  b_pick: ['选择地面观测点', 'Pick ground site'], b_names: ['名称', 'Names'],
  b_spin: ['自转', 'Spin'], b_tracks: ['轨道', 'Orbits'],
  // V1.3.6：按钮名精简（"显示可视锥"→"可视区域"，"显示名称"→"名称"）
  b_cone: ['可见区域', 'Coverage'],
  b_now: ['实时', 'Now'], b_cols: ['全部列', 'All columns'], pg_jump: ['点击页码可输入跳页', 'Click the page number to jump'],
  b_maptracks: ['轨道', 'Orbits'],
  b_default: ['默认设置', 'Defaults'], b_reset_all: ['还原所有默认设置', 'Restore all defaults'],
  b_readme: ['说明', 'README'],
  b_reset_all_done: ['当前已是默认设置', 'Already at defaults'],
  l_el: ['最低仰角', 'Min. elevation'], l_time: ['时间', 'Time'],
  // V1.8.0（需求15 i18n 审计）：原 ph_search 键早已没有任何引用（搜索框占位符统一走
  //   d_search_ph），属于死键 —— 清掉，避免审计里长期挂着一条"未被引用"的噪声。
  // V1.9.1（A13）：修 bug —— 原为 `['Manufacturer', 'Manufacturer']`，**中文页也显示英文**。
  t_name: ['卫星', 'Satellite'], t_launch: ['批次/组', 'Batch / Group'], t_maker: ['制造商', 'Manufacturer'], t_sma: ['半长轴, KM', 'SMA, KM'],
  // V1.9.1（A13）：BSTAR 列原本**完全没有 data-i18n**（中英都写死 "BSTAR"）→ 补上键，
  //   中文用「大气阻力系数」、英文保留 `BSTAR`（业内通行写法）。
  //   注意：表头是**导出图片**的列名来源（exportTable 读 th.textContent）→ 改一处即可两处生效。
  t_bstar: ['大气阻力系数', 'BSTAR'],
  t_hp: ['近地点, KM', 'Perigee, KM'], t_ha: ['远地点, KM', 'Apogee, KM'], t_inc: ['倾角, °', 'Incl., °'],
  t_period: ['周期, 分', 'Period, min'], t_raan: ['升交点, °', 'RAAN, °'], t_ecc: ['偏心率', 'Ecc.'],
  t_epoch: ['历元 (UTC)', 'Epoch (UTC)'],
  // V1.3.6：「批次」→「批次/组」，「发射场」→「发射地点」
  lt_group: ['批次/组', 'Group'],
  lt_time: ['发射时间 (北京时间)', 'Launch time (GMT+8)'], lt_rocket: ['运载火箭', 'Launch vehicle'],
  lt_site: ['发射地点', 'Launch site'], lt_inc: ['设计倾角', 'Design incl.'], lt_ele: ['轨道要素', 'Elements'],
  // V1.8.0（需求12）：卫星表格新增「发射时间」列（同一批次的发射时刻，北京时间）；
  //   发射历史新增「任务结果」列，口径 = 卫星百科的记载（见 resTag）。
  t_ltime: ['发射时间 (GMT+8)', 'Launch (GMT+8)'], t_result: ['任务结果', 'Mission result'],
  // V1.9.1（1.4-D）：卫星表格新增「在轨状态」列 —— 用户要求已再入卫星也能在列表里看得出来。
  //   两态取值：在轨（绿）/ 已再入（红，带再入日期）。数据来源 satcat 的 DECAY_DATE（见 mkdata.mjs）。
  t_status: ['在轨状态', 'Status'], st_orbit: ['在轨', 'In orbit'], st_gone: ['已再入', 'Re-entered'],
  st_gone_tip: ['已再入，再入日期：', 'Re-entered on '],
  res_ok: ['成功', 'Success'], res_part: ['部分成功', 'Partial success'], res_fail: ['失败', 'Failure'],
  // V1.8.0（需求8）：03.5 组网进度
  h_progress: ['组网进度', 'Network Progress'],
  lead_progress: ['两条曲线分别是星网与千帆的组网推进速度。横轴按周、标的是那一周的日期；纵轴可切换「发射量（累计）」或「在轨数量」。发射量把所有发射的颗数累加（含失败与部分成功，百科没有记载颗数的不计），在轨数量 = 已有最新轨道要素的颗数 + 已发射但尚未编目的成功批次。',
    'Two curves track how fast CSCN and Qianfan build their constellations. The x axis is weekly, labelled with the actual date; the y axis switches between cumulative launches and satellites in orbit. "Launches" sums every satellite sent up (including failures and partial successes when a count is on record); "In orbit" counts satellites with fresh elements plus successful batches launched but not yet catalogued.'],
  l_netmode: ['纵轴量', 'Y axis'], nm_launch: ['发射量（累计）', 'Launches (cum.)'], nm_orbit: ['在轨数量', 'In orbit'],
  nm_unit_launch: ['累计发射卫星数', 'Cumulative satellites launched'], nm_unit_orbit: ['在轨卫星数', 'Satellites in orbit'],
  l_netshow: ['星座', 'Constellation'], d_x_date: ['日期', 'Date'],
  // V1.9.1（A15）04 章「变轨情况」：由「变轨情况」改名 + 与组网进度换位。
  //   英文按 Q32 定稿用 **Orbits Change Status**（表格里那个 Orbits Change 是导出图的短标签，
  //   底栏宽度有限，见 Q32 —— 两处不是同一个字符串，别顺手统一）。
  h_climb: ['变轨情况', 'Orbits Change Status'],
  lead_climb: ['选定一颗卫星或一个批次/组，画出它们的轨道半长轴随时间的变化 —— 刚入轨时低、随后被发动机一点点抬到工作高度的那段"爬坡"。',
    'Pick one satellite or one batch/group and see how its orbital semi-major axis changes over time — the climb from a low initial altitude up to the working height.'],
  climb_pick: ['对象', 'Object'], climb_take: ['纵轴量', 'Y axis'], climb_rate: ['升轨速度', 'Climb rate'],
  // ↓ R17 画布与说明行用到的键（全部成对，缺一个就会在页面上显示键名本身）
  climb_pick_auto: ['跟随选中（默认）', 'Follow selection (default)'],
  climb_sel_tip: ['选择要查看升轨过程的批次/组；留空则跟随你在其它章节的选中',
    'Pick the batch/group to inspect; leave empty to follow your selection elsewhere'],
  climb_none: ['本章暂无历史轨道数据', 'No historical orbit data yet'],
  climb_n_sats: ['曲线', 'curves'],
  climb_n_hist: ['历史点', 'points'],
  climb_take_sma: ['半长轴（离地高度）', 'Semi-major axis (altitude)'],
  climb_take_rate: ['升轨速度（±2 天最小二乘）', 'Climb rate (±2 d least squares)'],
  climb_y_alt: ['离地高度, km', 'Altitude, km'],
  climb_y_rate: ['升轨速度, km/天', 'Climb rate, km/day'],
  t_defclimb: ['恢复 04 变轨情况的初始设置', 'Restore the default settings of 04 Orbits Change Status'],
  // ↑↑ V1.9.0（R17）：05 章的三段式 i18n（标题/说明/选择器），其中「升轨速度」的算法口径见 climbNote
  t_defprogress: ['恢复 05 组网进度的初始设置', 'Restore the default settings of 05 Network Progress'],
  t_netinfo: ['怎么看这张图', 'How to read this chart'],
  // V1.9.0（需求8）：改名「新增批次」→「新增卫星」（内容也确实是新增的卫星/批次组）
  d_net_week: ['该周', 'Week'], d_net_batches: ['新增卫星', 'New satellites'],
  d_net_span: ['数据跨度', 'Data span'],
  t_age: ['在轨日, 天', 'Days in orbit'],
  foot_data: ['轨道数据来自 NORAD 空间目标目录', 'Orbit data from the NORAD satellite catalog'],
  foot_use: ['本页素材可自由使用，注明来源即可', 'Free to use and redistribute with attribution'],
  // 动态文案
  d_epoch: ['要素历元', 'Epoch'], d_epoch2: ['更新历元：', 'Epoch: '], d_pending_suffix: ['颗待编目', 'awaiting catalog'],
  d_in_orbit: ['颗', 'in orbit'], d_more_pending: [' · 另有 ', ' · '], d_more_pending2: [' 颗待编目', ' more pending'],
  d_page_track: ['本页实时推算 ', 'This page propagates '], d_page_track2: [' 颗', ' live'],
  d_groups_stat: [' 批在轨 / 共 ', ' groups with elements / '], d_groups_total: [' 批', ' total'],
  d_groups_note: ['本页口径：只统计 CelesTrak hulianwang / qianfan 两个低轨互联网分组里的批次，比词条口径窄（不含早期试验星与星网高轨业务星）。',
    'Counted by this page: only the groups carried in the CelesTrak `hulianwang` / `qianfan` LEO internet feeds — narrower than the wiki, which also counts early test satellites and CSCN GEO service satellites.'],
  d_bjtime: ['（北京时间）', ' (GMT+8)'],
  // V1.3.6：图表章节下方不再重复坐标轴与操作说明（只留「待编目」提示），细节移入「说明」
  d_map_note: ['地面轨迹为前后各半圈。可视覆盖区按每颗卫星的瞬时高度估算。', 'Ground tracks cover half an orbit before and after now. Coverage zones are estimated from each satellite\'s current altitude.'],
  // V1.3.6：轨道章节下方只留这一句（原「地球在自转…N 条轨道圈」与轨道高度夸张说明已移入「说明」）
  d_globe_note_1: ['卫星位置由 SGP4 实时推算。', 'Positions are propagated live with SGP4.'],
  // V1.3.6：表格脚注拆成靠左的四行
  d_tbl_foot_1: ['共 ', ''],
  d_tbl_foot_2: [' 颗\n高度均为相对地球平均半径（6378.135 km）\n轨道模型 SGP4 / WGS-72\n',
    ' satellites\nAltitudes are above the mean Earth radius (6378.135 km)\nSGP4 / WGS-72\n'],
  d_tbl_bro: ['半长轴取布劳威尔（与目录一致）', 'Semi-major axis: Brouwer mean (catalog convention)'],
  d_tbl_kep: ['半长轴取开普勒（由平均运动直接反算）', 'Semi-major axis: Keplerian (from the mean motion directly)'],
  // ★ V1.9.1（A3）键名分离：这两条**原本叫 `d_sel_all` / `d_sel_all2`**，与上面 L58 的
  //   「已全选 / All selected」**重名** → 对象字面量里后写的**覆盖**前者，于是选中提示
  //   （`showToast(t('d_sel_all'))`）显示的是「全部批次（」而不是「已全选」（现存 bug）。
  //   但它们本身是 03 章批次下拉「全部批次（N 颗）」要用的（F2：**不能删**，只能改名）。
  //   → 改名为 `d_grp_all` / `d_grp_all2`，两处各用各的，互不覆盖。
  d_grp_all: ['全部批次（', 'All groups ('],
  d_grp_all2: [' 颗）', ')'],
  d_row_batch: ['批次/组', 'Batch/Group'], d_row_cat: ['目录名', 'Catalog name'],
  d_row_sub: ['星下点', 'Sub-satellite point'], d_row_alt: ['瞬时高度', 'Altitude now'],
  d_row_el: ['观测点仰角', 'Elevation at site'],
  d_row_inc: ['倾角', 'Inclination'], d_row_period: ['周期', 'Period'],
  d_row_epoch: ['更新历元', 'Updated epoch'], d_row_sma: ['半长轴', 'Semi-major axis'],
  d_row_pa: ['近地点×远地点', 'Perigee×Apogee'],
  d_latlon: ['纬度 / 经度', 'Lat / Lon'],   // V1.3.6：观测点信息窗里原先写死成英文
  d_more_sat: [' 颗', ' more'],
  d_pending_tag: ['待编目 ', 'pending ×'],
  d_pend_sum: ['目录摘要', 'catalog summary'],
  d_pend_obj: ['对象', 'objects'],
  d_row_launch: ['发射日期', 'Launch date'],
  d_pend_ghost: ['○ 空心点 = 待编目批次：目录已给摘要参数（周期/倾角/高度），但未发布轨道要素，故只画高度区间、不能定位。',
    '○ Hollow marks = pending groups: the catalog publishes summary parameters (period / inclination / altitude) but no elements, so only the altitude range is drawn — they cannot be located.'],
  d_site: ['观测点', 'Site'], d_visible: ['可见卫星', 'Satellites visible'],
  d_fixed_hint_1: ['已固定 ', 'Site fixed '],
  d_fixed_hint_2: [' · 点击该点解除', ' · click the site to release'],
  d_pick_btn_off: ['选择地面观测点', 'Pick ground site'],
  d_pick_btn_on: ['退出观测点模式', 'Exit site mode'],
  d_loading: ['正在获取最新轨道要素…', 'Fetching the latest orbital elements…'],
  d_updated: ['已更新至最新轨道要素', 'Updated to the latest elements'],   // V1.3.9：不再缀纪元，第三行已有
  d_offline: ['未能联网更新，正在使用内置轨道要素快照', 'Could not update online — using the built-in element snapshot'],
  d_page: ['第 ', 'Page '], d_page2: [' 页', ' of '],
  d_sel_group: ['点击可选中该批次的全部卫星', 'Click to select all satellites of this group'],
  d_close_info: ['关闭信息窗（只看图）', 'Close info panel'],
  // V1.3.6：信息窗末尾那行提示（主题色小字），拖动过一次后本窗口就不再显示
  d_drag_tip: ['电脑点击/手机长按可自由拖拽', 'Click/long-press to drag freely'],
  l_search: ['搜索卫星', 'Search satellites'],
  d_pick_hint_desktop: ['电脑端可移动鼠标预览 · 点击固定观测点', 'On desktop, move the cursor to preview · click to fix the site'],
  d_pick_hint_touch: ['点击地图任意位置设置观测点', 'Tap the map anywhere to set the site'],
  d_search_none: ['没有匹配的卫星', 'No matching satellite'],
  // V1.9.1（A19）：搜索补池 —— 「已再入」与「尚未编目」这两类**库内没有 TLE** 的对象。
  //   左键点它们的联想项时：跳转到 06 卫星表格 + 弹下面这两句提示（红 / 琥珀）。
  d_pool_dead: ['已再入', 'Re-entered'],
  d_pool_pend: ['待编目', 'Not catalogued'],
  d_pool_dead_toast: ['该卫星已再入', 'This satellite has re-entered'],
  d_pool_pend_toast: ['该卫星尚未编目', 'This satellite is not catalogued yet'],
  d_search_ph: ['支持模糊搜索', 'Fuzzy search'],
  d_search_recent: ['最近', 'Recent'],
  d_first: ['首页', 'First'], d_prev: ['上一页', 'Prev'], d_next: ['下一页', 'Next'], d_last: ['尾页', 'Last'],
  d_now_btn: ['实时', 'Now'],
  d_title_suffix_zh: ['星座', ' Constellation'],
  // V1.7.0 第四轮（需求5a）：英文标题去掉 Orbit（… Constellation Live Status）；
  //         去掉前导 &nbsp;（它会让星座主标题多一个空格、破坏左对齐），改用普通空格由 CSS 控制。
  d_title_suffix_en: ['在轨态势', 'Live Status'],
  d_satpage: ['第 ', 'Page '],
};
function t(k) { var p = I18N[k]; if (!p) return k; return LANG === 'en' ? p[1] : p[0]; }
// V1.8.0（需求15 i18n 审计）：中英括号。
//   中文排版用全角「（）」且前面不留空格；英文用半角「 ()」且前面留一个空格。
//   此前几处硬编码全角括号（顶部统计的副标签、平均高度、信息窗在轨天数）在英文界面会漏出
//   CJK 标点 —— i18n 审计（npm run i18n）就是靠这条规则把它们抓出来的。
function paren(s) { return LANG === 'en' ? ' (' + s + ')' : '（' + s + '）'; }
// V1.5.3：切语言时同步刷新加载蒙层文案（它只在加载时写一次，否则切换语言后会残留旧语言）
function refreshMaskText() {
  try {
    var tx = document.getElementById('lmTxt'), e = document.getElementById('lmEpoch');
    if (tx && tx.textContent && tx.textContent.trim()) tx.textContent = t('d_updated');
    if (e && e.textContent && /[0-9]{4}-[0-9]{2}-[0-9]{2}/.test(e.textContent)) {
      // V1.7.2 第七轮（新需求A）：这里刻意用「要素历元 / Epoch」而**不是**「TLE更新时间」——
      //   用户要求「TLE更新时间」只能出现在主标题下方那一处。加载蒙层是瞬态覆盖层，
      //   说清"这是哪一版要素"即可，用另一个词既满足口径又不丢信息。
      e.textContent = t('d_epoch') + ' ' + fmtUTC(CONST[S.key] ? CONST[S.key].epochMax : e.textContent) + ' UTC';
    }
  } catch (err) {}
}
// V1.7.0 第三轮（需求5）：把焦点从搜索框让出去 ——
// 手机上选中卫星后输入框仍保持焦点，长按拖动信息框时浏览器会把焦点拉回"最近的输入框"，于是弹出键盘。
// 这里只做 blur，不改任何布局、不改 touch-action、不动长按 450ms 的手势逻辑。
function blurSearchInputs() {
  try {
    SEARCH_BOXES.forEach(function (b) { var el = document.getElementById(b.input); if (el && el.blur) el.blur(); });
    var a = document.activeElement; if (a && a.blur && /^(INPUT|TEXTAREA)$/.test(a.tagName)) a.blur();
  } catch (e) {}
}
function applyStaticLang() {
  document.querySelectorAll('[data-i18n]').forEach(function (el) { el.innerHTML = t(el.getAttribute('data-i18n')); });
  document.querySelectorAll('[data-i18n-ph]').forEach(function (el) { el.placeholder = t(el.getAttribute('data-i18n-ph')); });
  // V1.7.0 第三轮（需求11）：title 提示气泡也要跟着语言切换（此前是硬编码中文，英文界面会漏中文）
  document.querySelectorAll('[data-i18n-title]').forEach(function (el) { el.title = t(el.getAttribute('data-i18n-title')); });
  document.documentElement.setAttribute('lang', LANG === 'en' ? 'en' : 'zh-CN');
  var b = document.getElementById('langBtn');
  if (b) b.textContent = LANG === 'en' ? '中' : 'EN';
}
// V1.6.0：只在指定子树内应用静态文案（顶栏在动画一开始就换新语言，内容则延后半程）
function applyStaticLangIn(root) {
  if (!root) return;
  root.querySelectorAll('[data-i18n]').forEach(function (el) { el.innerHTML = t(el.getAttribute('data-i18n')); });
  root.querySelectorAll('[data-i18n-ph]').forEach(function (el) { el.placeholder = t(el.getAttribute('data-i18n-ph')); });
  // V1.7.0 第三轮（需求11）：title 提示气泡也要跟着语言切换
  root.querySelectorAll('[data-i18n-title]').forEach(function (el) { el.title = t(el.getAttribute('data-i18n-title')); });
}
// 批次名的英文写法（低轨01组 → LEO Group 01 等）
function batchName(name) {
  if (LANG !== 'en') return name;
  return name.replace(/^低轨(\d+)组$/, 'LEO Group $1')
    .replace(/^极轨(\d+)组$/, 'Polar Group $1')
    // V1.6.3：数据里既有「试验星03组」也有「试验星03」（无"组"），高轨则是「高轨03星」—— 都要覆盖
    .replace(/^试验星(\d+)组$/, 'Test Satellite $1')
    .replace(/^试验星(\d+)$/, 'Test Satellite $1')
    // V1.7.0 第三轮（需求11）：「试验星 KL-Alpha / KL-Beta」不匹配上面任何规则 → 英文界面直接漏出中文
    .replace(/^试验星\s+(KL-[A-Za-z0-9]+)$/, 'Test Satellite $1')
    .replace(/^高轨(\d+)星$/, 'High-Orbit Sat $1')
    .replace(/^高轨(\d+)$/, 'High-Orbit Sat $1')
    // V1.8.0（需求15 i18n 审计）：千帆的低轨直连（DTC）批次名带星座前缀「千帆 DTC-01」，
    //   上面所有规则都不匹配 → 英文界面直接漏出中文。这里按全站口径译成 Qianfan / CSCN。
    .replace(/^千帆\s+(.+)$/, 'Qianfan $1')
    .replace(/^星网\s+(.+)$/, 'CSCN $1');
}
function cnName(s) {
  var n = s.name;
  // V1.7.0 第三轮修正：**卫星的名字来自来源平台的原始命名，与星座品牌无关。**
  //   · 英文界面一律直接显示目录原名（如 HULIANWANG DIGUI-128），不再改写；
  //   · 中文界面按平台通名译出可读名：HULIANWANG DIGUI-128 → 互联网低轨-128，
  //     HULIANWANG JISHU SHIYAN / HJS → 互联网技术试验。
  if (LANG === 'en') {
    return n.replace(/^试验星(\d+)组?$/, 'Test Satellite $1')
      .replace(/^高轨(\d+)星?$/, 'High-Orbit Sat $1');
  }
  return n.replace(/^HULIANWANG DIGUI-(\d+)$/, '互联网低轨-$1')
    .replace(/^HULIANWANG JISHU SHIYAN.*$/, '互联网技术试验')
    .replace(/^HJS.*$/, '互联网技术试验')
    .replace(/^GUOWANG TEST OBJECT ([A-Z])$/, '互联网试验-$1')
    .replace(/^GUOWANG (\d+) OBJECT ([A-Z])$/, '互联网$1组$2')
    .replace(/^QIANFAN (\d+) OBJECT ([A-Z])$/, '千帆$1组$2')
    .replace(/^QIANFAN-(\d+)$/, '千帆-$1')
    .replace(/^试验星(\d+)$/, '试验星$1');
}

// ---------------------------------------------------------------- 预计算（性能）
// 海岸线与经纬网单位向量只算一次，避免每帧做数千次三角函数
var COAST_UV = COAST.map(function (ln) {
  var a = new Float32Array(ln.length * 3);
  for (var i = 0; i < ln.length; i++) {
    var la = ln[i][1] * RAD, lo = ln[i][0] * RAD, cl = Math.cos(la);
    a[i * 3] = cl * Math.cos(lo); a[i * 3 + 1] = cl * Math.sin(lo); a[i * 3 + 2] = Math.sin(la);
  }
  return { p: a, n: ln.length };
});
var GRID_LINES = (function () {
  var out = [];
  for (var lon = -180; lon < 180; lon += 30) {
    var a = new Float32Array(61 * 3), k = 0;
    for (var lat = -90; lat <= 90; lat += 3) {
      var la = lat * RAD, lo = lon * RAD, cl = Math.cos(la);
      a[k++] = cl * Math.cos(lo); a[k++] = cl * Math.sin(lo); a[k++] = Math.sin(la);
    }
    out.push({ p: a, n: 61 });
  }
  for (var lat2 = -60; lat2 <= 60; lat2 += 30) {
    var b = new Float32Array(121 * 3), k2 = 0;
    for (var lo2 = -180; lo2 <= 180; lo2 += 3) {
      var la2 = lat2 * RAD, lr2 = lo2 * RAD, cl2 = Math.cos(la2);
      b[k2++] = cl2 * Math.cos(lr2); b[k2++] = cl2 * Math.sin(lr2); b[k2++] = Math.sin(la2);
    }
    out.push({ p: b, n: 121 });
  }
  return out;
})();
// 圆周采样（cos/sin 查表，供覆盖区与可视锥复用）
var CIRC = (function () { var a = []; for (var i = 0; i <= 40; i++) { var t = i / 40 * 2 * Math.PI; a.push([Math.cos(t), Math.sin(t)]); } return a; })();
var ALT_EXAG = 2.4;             // 轨道高度显示夸张系数（让不同高度壳层分得开）
function globeRad(rKm) { return 1 + (rKm / RE - 1) * ALT_EXAG; }

if (!SGP4 || !RAW) {
  document.body.insertAdjacentHTML('afterbegin',
    '<p style="padding:40px;font-family:monospace">轨道计算库或数据未载入，页面无法工作。</p>');
  return;
}

// ---------------------------------------------------------------- 工具
function jdToMs(jd) { return (jd - 2440587.5) * DAY; }
function pad(n) { return n < 10 ? '0' + n : '' + n; }
function fmtUTC(ms) {
  var d = new Date(ms);
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) +
    ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
}
function fmtNum(v, n) { return (Math.round(v * Math.pow(10, n)) / Math.pow(10, n)).toFixed(n); }
var MONO = getComputedStyle(document.documentElement).getPropertyValue('--mono').trim();
function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
var TC = null;                          // 主题色缓存，切换主题时置空
function themeColors() {
  if (TC) return TC;
  TC = {
    bg: css('--bg'), fg: css('--fg'), dim: css('--dim'), faint: css('--faint'),
    gridX: css('--grid-x'), gridY: css('--grid-y'), tick: css('--tick'),
    coast: css('--coast'), coastG: css('--coast-globe'),
    globeFill: css('--globe-fill'), globeEdge: css('--globe-edge'),
    accent: css('--accent'), mapGrid: css('--map-grid'), mapFrame: css('--map-frame'),
    sel: css('--sel-bg'), theme: css('--row-sel'),        // 星座主题色：星网红 / 千帆蓝
  };
  return TC;
}
// V1.6.0：首屏把星座反色块放到当前项上（无动画）
function initConstelSlider() { try { moveConstelSlider(S.key, false); } catch (e) {} }
function refreshTheme() { TC = null; }
function isLight() { return document.documentElement.getAttribute('data-theme') === 'light'; }
var PALETTE = ['#4dabf7', '#51cf66', '#ffa94d', '#e599f7', '#ff6b6b', '#20c997', '#fcc419',
  '#74c0fc', '#ff922b', '#da77f2', '#63e6be', '#a9e34b', '#d0bfff', '#ffd43b', '#ff8787', '#66d9e8'];
// 浅色主题下用更深的同系色，保证白底可读
var PALETTE_L = ['#1971c2', '#2f9e44', '#e8590c', '#9c36b5', '#e03131', '#0c8599', '#e67700',
  '#4263eb', '#d9480f', '#ae3ec9', '#087f5b', '#5c940d', '#7048e8', '#b8860b', '#c92a2a', '#1098ad'];

// ---------------------------------------------------------------- 星座数据
function build(key) {
  var c = RAW[key];
  var lmap = {}, launches = [];
  Object.keys(c.launches).forEach(function (k) {
    var v = c.launches[k];
    var ln = (c.links && c.links[k]) || null;
    var L = {
      key: k, name: v[0], dateStr: v[1], rocket: v[2], site: v[3], inc: v[4], sats: [], pending: 0,
      // V1.8.0（需求12）：第 6 位 = 任务结果（ok/part/fail/'?'/'fail'），第 7 位 = 该发颗数（卫星百科记载）。
      //   mkdata 已把 wiki_launches.json 的结果合并进来；静态 'fail'（如 2025-F05 朱雀二号E 失利）作为兜底。
      res: v[5] || '', wn: v[6] || 0,
      rseg: ln ? ln.r : null,       // 火箭分段（含卫星百科链接）
      slink: ln ? ln.s : null       // 发射场（含卫星百科链接）
    };
    L.dateMs = Date.parse(v[1] + ':00+08:00');
    L.cospar = '20' + k.slice(0, 2) + '-' + k.slice(2);
    lmap[k] = L; launches.push(L);
  });
  Object.keys(c.pending || {}).forEach(function (k) {
    if (lmap[k]) lmap[k].pending = c.pending[k];
  });
  // 待编目批次的公开摘要（SATCAT：周期 / 倾角 / 近远地点 / 临时编号段）
  Object.keys(c.pendingInfo || {}).forEach(function (k) {
    if (lmap[k]) lmap[k].pinfo = c.pendingInfo[k];
  });

  var sats = [], bad = 0;
  c.sats.forEach(function (s, i) {
    var rec = null;
    try { rec = SGP4.twoline2satrec(s.l1, s.l2); } catch (e) { rec = null; }   // V1.4.2：坏行不让 build 整体失败
    if (!rec || rec.error) { bad++; return; }
    var lk = s.c.slice(0, 5);
    var L = lmap[lk] || { key: lk, name: lk, dateStr: '—', rocket: '—', site: '—', inc: rec.inclo * DEG, sats: [], pending: 0 };
    var nRad = rec.no / 60;                       // rad/s
    var aKep = Math.pow(MU / (nRad * nRad), 1 / 3); // km，由 Kozai 平均运动直接反算
    // 布劳威尔半长轴：剥掉 J2 长期项（一阶），与 SGP4 内部递推所用的一致
    var pp = aKep * (1 - rec.ecco * rec.ecco);
    var dl = 1.5 * J2 * (RE / pp) * (RE / pp) *
      (1 - 1.5 * Math.pow(Math.sin(rec.inclo), 2)) / Math.sqrt(1 - rec.ecco * rec.ecco);
    var aBro = aKep * Math.pow(1 + dl, -2 / 3);
    var o = {
      idx: sats.length, name: s.name, norad: s.id, cospar: s.c, lk: lk, rec: rec,
      launch: L, inc: rec.inclo * DEG, raan0: rec.nodeo * DEG, ecc: rec.ecco,
      bstar: rec.bstar, mm: rec.no * 1440 / (2 * Math.PI),
      smaB: aBro - RE, haB: aBro * (1 + rec.ecco) - RE, hpB: aBro * (1 - rec.ecco) - RE,
      smaK: aKep - RE, haK: aKep * (1 + rec.ecco) - RE, hpK: aKep * (1 - rec.ecco) - RE,
      period: 2 * Math.PI / rec.no,
      epochMs: jdToMs(rec.jdsatepoch)
    };
    sats.push(o); L.sats.push(o);
  });

  launches.sort(function (a, b) { return a.dateMs - b.dateMs; });
  // 批次配色（深浅主题各一套）
  launches.forEach(function (L, i) {
    L.color = PALETTE[i % PALETTE.length];
    L.colorL = PALETTE_L[i % PALETTE_L.length];
  });
  sats.forEach(function (s, i) {
    var h = (i * 137.508) % 360;
    s.color = 'hsl(' + h.toFixed(1) + ',62%,62%)';
    s.colorL = 'hsl(' + h.toFixed(1) + ',66%,40%)';
    s.gcolor = s.launch.color || '#888';
    s.gcolorL = s.launch.colorL || '#666';
  });

  var st = {
    key: key, name: c.name, en: c.en, org: c.org, sub: c.sub,
    launches: launches, sats: sats, lmap: lmap, bad: bad,
    makers: c.makers || {},            // V1.4.2：制造方（按批次 key 索引，来自词条）
    // V1.9.1（A19）：**搜索补池** —— 「已再入」与「尚未编目」这两类**库内没有 TLE** 的对象，
    //   页面的搜索原先只在 sats 里找，于是搜名字/NORAD 什么都搜不到。这里并联进来（Q35：可搜索），
    //   点击行为见 poolJump()（01/02/03 章物理上无法高亮，只跳 06 + 弹提示）。
    dead: c.dead || [], pend: c.pend || []
  };
  // 统计
  var sum = 0, incs = {};
  sats.forEach(function (s) { sum += s.smaB; incs[Math.round(s.inc * 10) / 10] = 1; });
  st.avgAlt = sum / Math.max(1, sats.length);
  st.incList = Object.keys(incs).map(Number).sort(function (a, b) { return a - b; });
  st.firstMs = Math.min.apply(null, sats.map(function (s) { return isFinite(s.launch.dateMs) ? s.launch.dateMs : Infinity; }));
  st.epochMax = Math.max.apply(null, sats.map(function (s) { return s.epochMs; }));
  st.minAlt = Math.min.apply(null, sats.map(function (s) { return s.hpB; }));
  st.maxAlt = Math.max.apply(null, sats.map(function (s) { return s.haB; }));
  st.pendingCount = launches.reduce(function (a, L) { return a + (L.pending || 0); }, 0);
  // 累计发射卫星数：以目录里的有效载荷数为准，缺则回落到已有 TLE 数——每次刷新都会重算
  var counts = (RAW[key] && RAW[key].launchCounts) || {};
  // V1.6.3：为每个批次回填颗数（数据源 launchCounts），使"没有 TLE 的已发射批次"也能显示颗数
  launches.forEach(function (L) {
    var n2 = (counts[L.key] && counts[L.key].n) ? counts[L.key].n : 0;
    L.count = Math.max(n2, L.sats.length);
  });
  st.launched = launches.reduce(function (a, L) {
    // launchCounts[key] 是 { n, noradMin… } 的摘要对象，取 .n 才是该批入轨的载荷数
    var n = counts[L.key] && counts[L.key].n ? counts[L.key].n : 0;
    return a + Math.max(n, L.sats.length);
  }, 0);
  if (!isFinite(st.launched) && RAW[key] && RAW[key].stats) st.launched = RAW[key].stats.launched;
  // 发射成功 / 总次数（总次数含已知失利，失利不入轨所以不在批次表里）
  st.launchStat = (RAW[key] && RAW[key].stats && RAW[key].stats.launches) ||
    { success: launches.length, total: launches.length, failed: [] };
  return st;
}

unpackAll('gw'); unpackAll('qf');          // V1.3.7：差分 TLE 还原成完整要素
var CONST = { gw: build('gw'), qf: build('qf') };

// ---------------------------------------------------------------- 全局状态
var S = {
  key: 'gw',
  sel: [],
  selGroup: null,                 // 选中的卫星 idx
  focusIdx: null,          // V1.3.5：批次多选后当前「聚焦」的那颗（信息窗锁定显示它）
  hover: null,
  colorMode: { chart: 'sat', map: 'sat', globe: 'sat' },
  model: 'brouwer',
  mode: 'sma',
  launchFilter: 'all',
  // V1.7.3（需求9）：时间状态**每章一份**（地图 / 地球各一套），且在 STATE_FIELDS 里
  //   → 星座维度由既有的 STORE 快照机制天然承担 → 一共 2 章 × 2 星座 = 四份完全独立的状态。
  //   off = 时间条偏移（分钟）；frozen = 拖动后冻结住的绝对时刻（ms）。
  //   实时 = off 0 且 frozen null（跟墙钟走）；拖过时间条 = frozen 固定（不再随墙钟前进，Q8=A）。
  time: { map: { off: 0, frozen: null }, globe: { off: 0, frozen: null } },
  names: { map: false, globe: true },
  // V1.3.4：地图覆盖区与地球可视锥的最小仰角默认 10°（观测点仍为 0°）
  cov: { on: true, el: 10 },
  pick: { on: false, fixed: false, lat: 30, lon: 116, el: 0, mx: null, my: null },
  cone: { on: true, el: 10 },
  mz: { k: 1, tx: 0, ty: 0 },        // 地图缩放/平移
  mapTrack: true,                     // 地图是否显示全部卫星轨道
  page: 0,                            // 发射批次表页码（0 基）
  tpage: 0,                           // 卫星表格页码（0 基）
  spin: true,
  showTracks: true,
  allCols: false,
  // V1.3.9：表格默认按 NORAD 从大到小（新的在前），点表头可改
  sortKey: 'norad', sortAsc: false,
  query: '',
  // V1.8.0（需求8）：03.5 组网进度的三项设置。**不进 STATE_FIELDS** —— 那张图同时画两个星座，
  //   按星座各存一份没有意义；它们随「默认设置 / 还原所有默认设置」还原即可。
  netMode: 'launch',          // 'launch' = 发射量累计；'orbit' = 在轨数量
  netGw: true, netQf: true,   // 两条曲线的显隐
  // V1.9.0（R17）：04 变轨情况的两项。**进 STATE_FIELDS** —— 与 04 的显隐同理按星座各存一份
  //   （切到千帆时看到的是千帆的批次，不是星网的）。
  climbPick: '',              // '' = 跟随全局选中；'b:<批次key>' = 指定批次；'s:<norad>' = 指定单星
  climbTake: 'sma',           // 'sma' = 半长轴（离地高度）；'rate' = 升轨速度 km/天
  // V1.7.0（任务3）：两个星座各自记住自己的滚动位置，切页互不影响（默认都在页首）
  scrollY: { gw: 0, qf: 0 }
};

// ---------------------------------------------------------------- 设置持久化与「默认设置」（V1.3.4）
// 只存"设置"，不存临时状态（选中、缩放平移、页码、观测点经纬度、搜索词）。
// 每次改动一律全局生效并存盘；每个章节还有一个「默认设置」按钮只还原该章节的那几项。
var PREF_KEY = 'cistrack.prefs.v1';
var PREF_DEF = {
  model: 'brouwer', mode: 'sma', launchFilter: 'all',
  cChart: 'sat', cMap: 'sat', cGlobe: 'sat',
  covOn: true, covEl: 10, pickOn: false, pickEl: 0, mapTrack: true, nameMap: false,
  coneOn: true, coneEl: 10, spin: true, showTracks: true, nameGlobe: true,
  sortKey: 'norad', sortAsc: false, allCols: false,
  netMode: 'launch',                              // V1.8.0（需求8）：03.5 组网进度
  // V1.9.0（需求3）：netGw / netQf **不再放这里** —— 它们改为按星座各存一份（见 STATE_FIELDS），
  //   出厂默认 = 只看本页星座（星网页面只显示星网、千帆页面只显示千帆），两个页面互不联动。
  // V1.9.0（R17）：05 章同理，climbPick / climbTake 也按星座各存一份（见 STATE_FIELDS），
  //   但**出厂值**（'' / 'sma'）仍写在这里，供章级「默认设置」按值还原。
  climbPick: '', climbTake: 'sma',
  timeOffsetMap: 0, timeOffsetGlobe: 0     // V1.7.3（需求9）：两章时间条各自独立
};
// 「默认设置」按钮各自管哪几项（时间滑块 02/03 共用，两边都能还原）
var PREF_SEC = {
  chart: ['model', 'mode', 'launchFilter', 'cChart'],
  map: ['covOn', 'covEl', 'pickOn', 'pickEl', 'mapTrack', 'nameMap', 'cMap', 'timeOffsetMap'],
  globe: ['coneOn', 'coneEl', 'spin', 'showTracks', 'nameGlobe', 'cGlobe', 'timeOffsetGlobe'],
  // V1.8.0（需求8）：03.5 组网进度自己那一章的默认设置
  progress: ['netMode'],
  // V1.9.0（R17）：04 变轨情况本章的默认设置 = 对象选择 + 纵轴量（视图由 resetView 归位）
  climb: ['climbPick', 'climbTake'],
  table: ['sortKey', 'sortAsc', 'allCols']
};
// V1.9.0（需求3）：03.5 组网进度的「显示星网 / 显示千帆」**按星座各存一份**（见 STATE_FIELDS），
//   出厂默认 = **只看本页星座**：星网页面只显示星网、千帆页面只显示千帆；两边互不联动，
//   且本页的「默认设置 / 还原所有默认设置」都把它算进还原范围（见 resetSection / resetAllPrefs）。
function applyNetShowDefault(key) {
  var k = key || S.key;
  S.netGw = (k === 'gw');
  S.netQf = (k === 'qf');
}
function prefSnap() {
  return {
    model: S.model, mode: S.mode, launchFilter: S.launchFilter,
    cChart: S.colorMode.chart, cMap: S.colorMode.map, cGlobe: S.colorMode.globe,
    covOn: S.cov.on, covEl: S.cov.el, pickOn: S.pick.on, pickEl: S.pick.el,
    mapTrack: S.mapTrack, nameMap: S.names.map,
    coneOn: S.cone.on, coneEl: S.cone.el, spin: S.spin, showTracks: S.showTracks,
    nameGlobe: S.names.globe,
    sortKey: S.sortKey, sortAsc: S.sortAsc, allCols: S.allCols,
    netMode: S.netMode, netGw: S.netGw, netQf: S.netQf,      // V1.8.0（需求8）
    // V1.9.0（R17）：05 章两项同样如实快照（章级「默认设置」要按 PREF_DEF 的值还原）
    climbPick: S.climbPick, climbTake: S.climbTake,
    // V1.7.1（需求10）：时间滑块**如实快照当前偏移**（理由见下）；V1.7.3（需求9）两章各拍各的。
    //   快照用真值、还原仍由 prefApply 强制归零（见 prefApply），两件事分开。
    timeOffsetMap: S.time.map.off,
    timeOffsetGlobe: S.time.globe.off
  };
}
function prefApply(p) {
  if (!p) return;
  Object.keys(PREF_DEF).forEach(function (k) { if (!(k in p)) p[k] = PREF_DEF[k]; });
  // V1.3.6：纵轴量只剩半长轴 / 远地点 / 近地点 —— 旧存档里的「倾角 / 周期」一律回落到半长轴
  if (MODES.indexOf(p.mode) < 0) p.mode = PREF_DEF.mode;
  S.model = p.model; S.mode = p.mode; S.launchFilter = p.launchFilter;
  S.colorMode.chart = p.cChart; S.colorMode.map = p.cMap; S.colorMode.globe = p.cGlobe;
  S.cov.on = p.covOn; S.cov.el = p.covEl;
  S.pick.on = p.pickOn; S.pick.el = p.pickEl;
  S.mapTrack = p.mapTrack; S.names.map = p.nameMap;
  S.cone.on = p.coneOn; S.cone.el = p.coneEl;
  S.spin = p.spin; S.showTracks = p.showTracks; S.names.globe = p.nameGlobe;
  S.sortKey = p.sortKey; S.sortAsc = p.sortAsc; S.allCols = p.allCols;
  S.netMode = p.netMode; S.netGw = !!p.netGw; S.netQf = !!p.netQf;   // V1.8.0（需求8）
  // V1.9.0（R17）：05 章两项一并落回 S（climbPick 可能是 'b:xxx'，按原样写回）
  S.climbPick = p.climbPick || ''; S.climbTake = (p.climbTake === 'rate') ? 'rate' : 'sma';
  // V1.3.6：时间恒为「现在」。存档里若带着旧版本写入的偏移也一律忽略，
  // 保证打开页面时时间条上的时间就是最新的时刻。
  // V1.7.3（需求9）：两章各自归零 + 解除冻结（任何"还原默认"都等于回实时）；
  //   章节重置时未涉及的那一章由快照原值带回（见 prefSnap）。
  S.time.map = { off: p.timeOffsetMap || 0, frozen: null };
  S.time.globe = { off: p.timeOffsetGlobe || 0, frozen: null };
}
// V1.7.0 第四轮（需求6）：prefLoad / prefSave 整体删除 ——
//   这两个函数从 V1.4.1 起就已经没有任何调用点（设置不再跨会话沿用），留着只会让人以为
//   「设置会落盘」；而且它们是全文件仅剩的 localStorage **写入**处，与「三种还原路径都要完全回到默认」
//   直接矛盾。PREF_KEY 仍然保留，只用于启动时 removeItem 清掉老访客的历史残留。
// V1.7.0 第三轮（需求1）：两星座各自的状态单独存一份，刷新后各自还在。
// 读不出来就当没有（用出厂默认），绝不报错、绝不丢用户原有设置。
var STORE_KEY = 'cistrack.store.v1';
// V1.7.0 第四轮（需求6）：STORE **只在会话内**用于「切星座互不干扰」，不再写入 localStorage ——
//   用户明确要求：刷新、重新打开链接、点「还原所有默认设置」三种情况都必须**完全**回到默认状态
//   （三图视图、全部设置、表格第一页、搜索框清空、选中清空…）。
//   旧版的 storeSave/storeLoad（跨会话恢复选中/视图/页码）与这条要求直接冲突，已整体移除；
//   启动时还会把旧访客 localStorage 里残留的 store/prefs 键清掉，保证老用户也能回到默认。
function storeSave() { /* V1.7.0 第四轮（需求6）：不再落盘 —— 会话内切星座仍走内存快照 */ }
function storeLoad() { /* 同上：启动一律从默认状态开始（见启动处的 localStorage 清理） */ }
// V1.7.1（需求10）：「有没有偏离默认」的判定**扩大**到设置之外。
//   旧版只看 PREF 里的设置项，于是下面这些"obviously 也是改动"的东西**不算改动**，
//   按钮始终暗淡不可点，用户明明选了卫星、拖了时间条、切了表格页，却点不动这个按钮：
//     · 时间条偏移（V1.7.1 已让 prefSnap 如实快照 timeOffset）
//     · 选中了卫星 / 选中了批次
//     · 表格或发射历史的页码
//     · 搜索框里有内容
//     · 地图缩放平移 / 地球姿态缩放（非出厂值）
//   现在把这些一起纳入判定：只要偏离出厂任意一项，按钮就亮。
//   注意 Earth yaw 每一帧都在自转，**不能**纳入判定（否则按钮永远亮着）。
function prefIsDefault() {
  var p = prefSnap();
  for (var k in PREF_DEF) if (p[k] !== PREF_DEF[k]) return false;
  if (S.sel && S.sel.length) return false;
  if (S.selGroup) return false;
  if (S.tpage) return false;
  if (S.page) return false;
  if (S.query) return false;
  if (SEARCH_TEXT && (SEARCH_TEXT.gw || SEARCH_TEXT.qf)) return false;
  if (S.mz && (S.mz.k !== 1 || S.mz.tx || S.mz.ty)) return false;
  if (G.zoom && Math.abs(G.zoom - 1) > 1e-6) return false;
  return true;
}
function syncResetAllBtn() {
  var b = document.getElementById('resetAllBtn');
  if (!b) return;
  var def = prefIsDefault();                       // 一开始就是默认配置 → 暗淡不可点
  b.disabled = def;
  b.classList.toggle('dimmed', def);
  b.title = def ? t('b_reset_all_done') : t('b_reset_all');
}
// V1.4.1：只用来判断「当前是否已经偏离默认」，据此决定「还原所有默认设置」按钮的暗淡状态。
// 原来这里还会把设置写进 localStorage（跨会话沿用），但按用户要求每次打开都回到默认初始状态，
// 所以不再落盘 —— 会话内的改动照常生效，只是下次打开重新从默认值开始。
var lastPrefJson = '';
function touchPrefs() {
  var j = JSON.stringify(prefSnap());
  if (j !== lastPrefJson) lastPrefJson = j;
  syncResetAllBtn();
  syncSectionResetBtns();       // V1.8.0（需求3）：各章「默认设置」的主题边框 / 灰暗态
}
// V1.8.0（需求3）：各章「默认设置」按钮的可视状态 ——
//   本章仍有偏离默认的可还原项 → 主题色边框；全都处于默认 → 灰暗（无主题边框）。
//   判定口径与 resetSection 完全一致：只看 PREF_SEC[sec] 里那几项（它还原什么就看什么）。
function sectionIsDefault(sec) {
  var keys = PREF_SEC[sec] || [];
  var p = prefSnap();
  for (var i = 0; i < keys.length; i++) if (p[keys[i]] !== PREF_DEF[keys[i]]) return false;
  return true;
}
function syncSectionResetBtns() {
  document.querySelectorAll('[data-defsec]').forEach(function (b) {
    b.classList.toggle('sec-clean', sectionIsDefault(b.getAttribute('data-defsec')));
  });
}
['click', 'input', 'change'].forEach(function (ev) {
  document.addEventListener(ev, function () { setTimeout(touchPrefs, 0); }, true);
});
// 把 S 里的设置整体刷回所有控件（初始载入 / 还原默认后都要走一遍）
function syncAllControls() {
  document.querySelectorAll('#modeSeg button').forEach(function (b) {
    b.classList.toggle('on', b.getAttribute('data-mode') === S.mode);
  });
  document.querySelectorAll('#modelSeg button').forEach(function (b) {
    b.classList.toggle('on', b.getAttribute('data-model') === S.model);
  });
  document.querySelectorAll('.seg[data-scope]').forEach(function (seg) {
    var sc = seg.getAttribute('data-scope');
    seg.querySelectorAll('button[data-color]').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-color') === S.colorMode[sc]);
    });
  });
  fillGroupSelect();
  [['covBtn', 'cov.on'], ['mapTracksBtn', 'mapTrack'], ['mapNamesBtn', 'names.map'],
   ['pickBtn', 'pick.on'], ['spinBtn', 'spin'], ['tracksBtn', 'showTracks'],
   ['globeNamesBtn', 'names.globe'], ['coneBtn', 'cone.on']]
  .forEach(function (pair) {
    var b = document.getElementById(pair[0]); if (!b) return;
    var v = pair[1].split('.').reduce(function (o, k) { return o[k]; }, S);
    b.classList.toggle('on', v);
    b.setAttribute('aria-pressed', String(v));
  });
  ['cov', 'pick', 'cone'].forEach(function (k) {
    var r = document.getElementById(NUMB[k].range); if (r) r.value = NUMB[k].get();
    syncNumBox(k);
  });
  setPick(S.pick.on);
  syncTimeUI();
  try { syncNetControls(); } catch (e) {}   // V1.8.0（需求8）：03.5 的控件与画布
  try { togSyncAll(); } catch (e) {}        // V1.8.0（需求Q4）：图层动画系数与 S 对齐（避免"开关关了画布还画着"）
  document.querySelectorAll('#satTable thead th').forEach(function (x) {
    x.classList.remove('sorted', 'asc');
    if (x.getAttribute('data-key') === S.sortKey) { x.classList.add('sorted'); if (S.sortAsc) x.classList.add('asc'); }
  });
  buildChartPoints();
}
function resetSection(sec) {
  var p = prefSnap();
  // ★ 起跳偏移必须**在覆写 p 之前**取出来：下面 forEach 会把 p.timeOffsetMap / p.timeOffsetGlobe
  //   直接改成 PREF_DEF 的 0（这两键本来就在 PREF_SEC 里），之后再读 p.* 恒为 0
  //   → 补间分支永远进不去，实测逐帧抓到的正是 [30, 0, 0, …]。
  var tvTween = (sec === 'map') ? 'map' : (sec === 'globe') ? 'globe' : null;
  var offFrom = tvTween === 'map' ? p.timeOffsetMap : tvTween === 'globe' ? p.timeOffsetGlobe : 0;
  (PREF_SEC[sec] || []).forEach(function (k) { p[k] = PREF_DEF[k]; });
  // V1.9.0（需求3）：04 章本章的「默认设置」同样把它还原成"只看本页星座"（只影响本页）。
  if (sec === 'progress') applyNetShowDefault();
  prefApply(p);
  // V1.8.0（需求16「恢复默认增强」）：章节「默认设置」原先只把本章控件变量改回去，现在与
  //   「还原所有默认设置」**同口径**：
  //   ① 时间条**补间**回实时（复用 __animateTo(0)，520ms 非线性）—— 只改变量会让滑块停在原处、
  //      按钮还写着「+X 分」、.shifted 高亮与全屏药丸黄框都不退，看上去像"没生效"；
  //   ② 观测点整组回出厂（退出模式 + 解除固定 + 位置/仰角归零），而不是只把开关关掉；
  //   ③ 本章视图回出厂（地图缩放平移 / 地球姿态与缩放），与全局还原一致。
  if (sec === 'map') {
    // 观测点：在 syncAllControls 之前把整组状态摆回出厂，setPick(false) 负责 UI
    S.pick = { on: false, fixed: false, lat: 30, lon: 116, el: 0, mx: null, my: null };
    S.mz = { k: 1, tx: 0, ty: 0 };                       // 地图缩放平移归零（同全局还原）
  }
  if (sec === 'globe') { G.yaw = 100 * RAD; G.pitch = 22 * RAD; G.zoom = 1; }
  syncAllControls();
  chartAutoView(); drawChart(); renderLegend(); renderTable();
  if (sec === 'progress') { netAutoView(); }
  try { drawNet(); } catch (e) {}      // V1.8.0（需求8）
  // V1.9.0（R17）：05 章同理 —— 控件刷回 + 视图归位 + 重绘
  if (sec === 'climb') { try { renderClimbSel(); renderClimbTake(); climbView = null; climbAutoView(); } catch (e) {} }
  try { drawClimb(); } catch (e) {}
  mapDirty = globeDirty = true;
  touchPrefs();
  // ① 时间条补间**必须放在所有重活之后**：上面 canvas 重绘 + 表格重建要几十到上百毫秒，
  //   而 animateTo 的时长按距离算只有 max(120, …)ms —— 第一帧若落在 dur 之后，k 会直接等于 1
  //   → 变成瞬跳（实测逐帧抓到的就是 [30, 0, 0, …]）。放到最后，第一帧就落在 ~16ms。
  //   起点：先让滑块与状态回到"重置前的位置"（这一帧不重绘），再从那里非线性滑回 0。
  var off0 = offFrom;
  if (tvTween && off0) {
    try {
      var tr = document.querySelector('.time-r[data-view="' + tvTween + '"]');
      if (tr && tr.__animateTo) {
        // 先把状态与滑块摆回**重置前的位置**（setOffset → syncTimeUI 会同步 el.value，
        // 而 animateTo 现在以 el.value 为起跳点），再从那里非线性滑回实时。
        setOffset(off0, tvTween);
        tr.__animateTo(0);
      } else {
        setOffset(0, tvTween);
      }
    } catch (e) {}
  }
}
// V1.9.0（需求1，**修正 V1.7.1 的旧决议**）：用户明确「顶栏三项**不**参与还原」——
//   出厂态不再包含 星座 / 语言 / 亮暗，这三项保持用户当前选择。还原只作用于
//   「页面内的设置项 + 三张图的视图位置 + 表格翻页 + 时间条 + 选中 / 搜索 / 滚动」。
//   并且**星网与千帆各自独立**：在星网页面按还原不会影响千帆页面的状态（只清本星座的会话快照）。
//   （旧的「不豁免还原 / 出厂 = 星网 + 中文 + 暗色」随之作废 —— 那段注释与代码一并删掉。）
// V1.7.0 第四轮（需求6）保留：本函数仍是「完全还原」，即把 三图视图（地图缩放平移 /
//   地球姿态缩放 / 图表自动视图）、选中与批次选中、表格与发射历史的页码、搜索框与联想区、
//   观测点、时间偏移 一起归零；时间条必须显式走 setOffset(0)，否则滑条 value / 按钮文案 /
//   .shifted 高亮 / 全屏药丸的黄色边框都不会跟着回退。
function resetAllPrefs() {
  prefApply(Object.assign({}, PREF_DEF));
  // V1.9.0（需求3）：04 章的「显示星网 / 显示千帆」也纳入还原范围 —— 还原成"只看本页星座"。
  //   因为它是**按星座各存一份**的，所以在本页点还原只影响本页，另一个星座完全不受影响。
  applyNetShowDefault();
  // 选中 / 页码 / 搜索 / 滚动位置（滚动位置按星座各存一份 → 只归零本星座）
  S.sel = []; S.selGroup = null; S.focusIdx = null; S.hover = null;
  S.query = ''; S.tpage = 0; S.page = 0;
  S.scrollY[S.key] = 0;
  SEARCH_TEXT[S.key] = '';             // V1.9.0（需求1）：搜索词也按星座各存 → 只清本页
  SEARCH_BOXES.forEach(function (b) {
    var el = document.getElementById(b.input); if (el) el.value = '';
    var sg = document.getElementById(b.sug); if (sg) { sg.classList.remove('open'); sg.innerHTML = ''; }
  });
  // 观测点回到出厂位置（不再固定、仰角 0）
  S.pick = { on: false, fixed: false, lat: 30, lon: 116, el: 0, mx: null, my: null };
  // 三图视图：地图缩放平移归零 / 地球回到出厂姿态 / 图表自动视图
  S.mz = { k: 1, tx: 0, ty: 0 };
  G.yaw = 100 * RAD; G.pitch = 22 * RAD; G.zoom = 1;
  // V1.9.0（需求1）：**不再** setTheme(false) / 回星网 / 回中文 —— 顶栏三项不参与还原。
  //   只把**本星座**的会话快照扔回出厂；另一个星座完全不受影响。
  STORE[S.key] = null;
  // V1.7.1（需求2）：还原默认也要清掉「用户已关闭信息窗」的标记，否则还原后信息窗死活不出来
  infoClearClosed();
  syncAllControls();
  syncControlsFromS();
  // V1.7.1（需求10）：时间条必须走 setOffset(0) —— prefApply 只改了变量本身，
  //   两条滑条的 value、右侧按钮文案（"实时"/"+X 分"）、.time-ctl.shifted 高亮、
  //   全屏时间药丸的黄色边框都还在原位，看上去像"没还原"。
  // V1.7.3（需求9）：两章**各自**归零解冻（prefApply 里其实已带出，这里显式兜底一次）。
  if (typeof setOffset === 'function') { setOffset(0, 'map'); setOffset(0, 'globe'); }
  chartAutoView(); drawChart(); renderLegend();
  try { netAutoView(); drawNet(); } catch (e) {}      // V1.8.0（需求8）：03.5 一并回默认视图
  // V1.9.0（R17）：05 章同样回默认（对象选择 = 跟随选中，纵轴 = 半长轴，视图回自动）
  try { renderClimbSel(); renderClimbTake(); climbView = null; climbAutoView(); drawClimb(); } catch (e) {}
  // V1.7.1（需求7）：jump:true 确保表格回到第一页且无残留高亮（缺省调用不翻页）
  renderTable({ jump: true }); renderLaunchTable(true);
  try { resetDragTips(); } catch (e) {}
  try { tickClock(); } catch (e) {}
  try { syncFsClockState(); } catch (e) {}
  mapDirty = globeDirty = true;
  touchPrefs();
  // V1.7.1（需求3）：顶栏三键改绝对定位后，nav-right 的让位 padding 依赖中英文实际宽度 → 重算
  try { layoutNav(); } catch (e) {}
}
function cur() { return CONST[S.key]; }
// V1.8.0（需求4②）：配色切换的逐帧插值状态。scope = 'chart'|'map'|'globe'，
//   from = { 卫星 idx → 旧颜色字符串 }，k = 进度（由 colOf 按 t0 现算，保证与 animTo 同步）。
var COLORMIX = null;
function _c2rgb(c) {
  c = String(c || '').trim();
  var m = c.match(/^#([0-9a-f]{6})$/i);
  if (m) {
    var n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  m = c.match(/^rgba?\(([^)]+)\)$/i);
  if (m) {
    var p = m[1].split(',').map(function (x) { return parseFloat(x); });
    return [p[0] | 0, p[1] | 0, p[2] | 0];
  }
  return null;
}
function _mix(c1, c2, k) {              // k=0 → c1，k=1 → c2
  var a = _c2rgb(c1), b = _c2rgb(c2);
  if (!a || !b) return k < 0.5 ? c1 : c2;
  return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * k) + ',' +
    Math.round(a[1] + (b[1] - a[1]) * k) + ',' + Math.round(a[2] + (b[2] - a[2]) * k) + ')';
}
function colOf(s, scope) {
  var to = (S.colorMode[scope] === 'group') ? (isLight() ? s.gcolorL : s.gcolor) : (isLight() ? s.colorL : s.color);
  if (COLORMIX && COLORMIX.scope === scope) {
    var from = COLORMIX.from[s.idx];
    var k = Math.min(1, (performance.now() - COLORMIX.t0) / ANIM.t);
    if (k >= 1) { COLORMIX = null; return to; }
    if (from != null) {
      // V1.9.0（需求3，两段式根治）：旧版这里是 `_mix(from, to, ease)` —— **A 色直接插值到 B 色**，
      //   所以看上去是"颜色慢慢变色"，而不是你要的"**先整体褪去、再染上**"。
      //   现在改成：前半程（0→0.5）把旧配色**整体淡出**（alpha 1→0），后半程（0.5→1）把新配色
      //   **淡入**（alpha 0→1）。曲线仍用 easeOutCubic（与全站 520ms 非线性动画同一族），
      //   因此观感 = 全图染色逐渐非线性褪去 → 非线性染上新色。
      if (k < 0.5) return _fade(from, 1 - (1 - Math.pow(1 - k * 2, 3)));
      return _fade(to, Math.pow((k - 0.5) * 2, 3));
    }
  }
  return to;
}
// 把任意颜色字符串换成带 alpha 的 rgba（画布 fillStyle/strokeStyle 与 HTML background 都吃）
function _fade(c, alpha) {
  var a = _c2rgb(c);
  if (!a) return c;                    // 解析不了就原样返回 —— 宁可不动，也不要出错
  var v = Math.max(0, Math.min(1, alpha));
  return 'rgba(' + a[0] + ',' + a[1] + ',' + a[2] + ',' + v.toFixed(3) + ')';
}
// V1.3.6：纵轴量只剩半长轴 / 远地点 / 近地点（倾角改作横轴，周期在表格与信息窗里看）
var MODES = ['sma', 'ha', 'hp'];
function val(s, mode) {
  var b = S.model === 'brouwer';
  if (mode === 'ha') return b ? s.haB : s.haK;
  if (mode === 'hp') return b ? s.hpB : s.hpK;
  return b ? s.smaB : s.smaK;
}
var MODE_LABEL = function (m) {
  return t({ sma: 'row_sma', ha: 'row_ha', hp: 'row_hp' }[m]);
};
var MODE_UNIT = function () { return 'km'; };
var MODE_FMT = 1;
// 补充标签（供信息浮层用）
I18N.row_sma = ['半长轴高度', 'Semi-major axis'];
I18N.row_ha = ['远地点高度', 'Apogee altitude'];
I18N.row_hp = ['近地点高度', 'Perigee altitude'];
I18N.row_inc = ['轨道倾角', 'Inclination'];
I18N.row_period = ['轨道周期', 'Orbital period'];

// ---------------------------------------------------------------- Canvas 助手
// V1.4.2：两处兜底 ——
// ① 尺寸还没算出来（老浏览器不支持 aspect-ratio、或容器宽度为 0）时，按父容器补一个合理高度，
//    否则画布是 0×1，用户看到的就是「地图上什么都没有」；
// ② 单边像素不超过 4096：不少 GPU 的纹理上限就是 4096，超过后整张画布会画不出来（常见于 4K 屏 + dpr2）。
var CANVAS_MAX_SIDE = 4096;
// V1.7.0 第三轮（需求10）：>0 表示当前正处于"导出重绘"，fitCanvas 用它替代 devicePixelRatio
var EXPORT_DPR = 0;
// V1.7.0 第三轮末修：把"量 CSS 尺寸 + 兜底"抽出来 —— 导出前要按同一个尺寸推算最高倍率，
// 两处必须完全一致，否则算出来的 kMax 与 fitCanvas 实际采用的 dpr 会对不上。
// 也接受 `{_w,_h}` 这种「纯尺寸」替身对象：导出表格时那张画布还没建出来，
// 只能按 1× 的逻辑宽高去推它该用多大 dpr（exportTable 里就是这么调的）。
function canvasBox(cv) {
  if (cv && typeof cv.getBoundingClientRect !== 'function') {
    var zw = Math.round((cv && (cv._w || cv.w)) || 0), zh = Math.round((cv && (cv._h || cv.h)) || 0);
    if (!(zw > 20)) zw = 900;
    if (!(zh > 20)) zh = Math.round(zw * (cv && cv.id === 'map' ? 0.5 : 1));
    return { w: Math.max(20, zw), h: Math.max(20, zh) };
  }
  var r = cv.getBoundingClientRect();
  var w = Math.round(r.width), h = Math.round(r.height);
  if (!(w > 20) || !(h > 20)) {
    var par = cv.parentElement;
    var pw = par ? Math.round(par.getBoundingClientRect().width) : 0;
    if (pw > 20) w = pw;
    if (!(h > 20)) h = Math.round((w > 20 ? w : 900) * (cv.id === 'map' ? 0.5 : 1));
    if (!(w > 20)) w = 900;
  }
  return { w: Math.max(20, w), h: Math.max(20, h) };
}
function fitCanvas(cv) {
  var box = canvasBox(cv), w = box.w, h = box.h;
  // V1.4.3：桌面端把采样倍率收到 1.5（像素量降约 44%，肉眼看不太出差别，但每帧填充量明显下降）；
  // 触屏设备本来就流畅，维持 2 不动。
  var dprCap = (typeof isTouch === 'function' && isTouch()) ? 2 : 1.5;
  var dpr = Math.min(window.devicePixelRatio || 1, dprCap);
  dpr = Math.max(0.5, Math.min(dpr, CANVAS_MAX_SIDE / w, CANVAS_MAX_SIDE / h));
  // V1.7.0 第三轮（需求10）：导出时用更高的倍率重绘。必须在这里覆盖，
  // 否则 fitCanvas 会按 devicePixelRatio 把临时放大的画布又缩回屏幕分辨率（导出图就不清晰）。
  if (EXPORT_DPR > 0) dpr = Math.max(0.5, Math.min(EXPORT_DPR, CANVAS_MAX_SIDE / w, CANVAS_MAX_SIDE / h));
  if (cv._w !== w || cv._h !== h || cv._dpr !== dpr) {
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    cv._w = w; cv._h = h; cv._dpr = dpr;
  }
  var ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx: ctx, w: w, h: h };
}
function niceTicks(min, max, count) {
  var span = (max - min) || Math.abs(max) || 1;
  var raw = span / count;
  var mag = Math.pow(10, Math.floor(Math.log10(raw)));
  var norm = raw / mag, step;
  if (norm < 1.5) step = 1; else if (norm < 3) step = 2; else if (norm < 7) step = 5; else step = 10;
  step *= mag;
  if (!(step > 0) || !isFinite(step)) return [min, max];
  var out = [], v = Math.ceil(min / step) * step;
  for (; v <= max + step * 0.001; v += step) out.push(v);
  return out;
}
function isVisible(el) {
  var r = el.getBoundingClientRect();
  return r.bottom > -80 && r.top < window.innerHeight + 80 && r.width > 0;
}

// ---------------------------------------------------------------- 动效 / 触摸助手
var mapDirty = true, globeDirty = true;
function animTo(dur, step) {
  var t0 = performance.now();
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) { step(1); return; }
  function frame(now) {
    var p = Math.min(1, (now - t0) / dur);
    step(1 - Math.pow(1 - p, 3));            // easeOutCubic
    if (p < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
// 以非线性动画把缩放倍数平滑推进到 target（apply 接收本次增量倍数）
function smoothZoom(apply, target, dur) {
  var prev = 0;
  animTo(dur || 300, function (e) {
    apply(Math.pow(target, e - prev));
    prev = e;
  });
}
// 触摸手势：单指拖动 / 双指捏合 / 轻点
function touchZoom(cv, cfg) {
  var pts = {}, last = null, moved = 0, lastDist = 0, startIn = true, startPt = null;
  cv.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse') return;
    // V1.4.6：起点在禁用区（地球/地图两侧空白）时，本次手势不用于平移/旋转/缩放，
    // 但【轻点选卫星】仍然有效 —— 点选是精确操作，不该被禁用区挡住（否则轨道环上
    // 超出地球切线的卫星就永远点不到了，V1.3.8 修过的老问题会回来）。
    startIn = cfg.active ? cfg.active(e.clientX, e.clientY) : true;
    pts[e.pointerId] = { x: e.clientX, y: e.clientY };
    var ids = Object.keys(pts);
    if (ids.length === 1) { moved = 0; last = { x: e.clientX, y: e.clientY }; lastDist = 0; startPt = { x: e.clientX, y: e.clientY }; }
    else if (ids.length === 2) {
      var a = pts[ids[0]], b = pts[ids[1]];
      lastDist = Math.hypot(a.x - b.x, a.y - b.y);
      moved = 99;
    }
    try { cv.setPointerCapture(e.pointerId); } catch (err) {}
  });
  cv.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'mouse' || !pts[e.pointerId]) return;
    pts[e.pointerId] = { x: e.clientX, y: e.clientY };
    var ids = Object.keys(pts);
    if (ids.length === 2) {
      var a = pts[ids[0]], b = pts[ids[1]];
      var d = Math.hypot(a.x - b.x, a.y - b.y);
      if (lastDist > 0 && cfg.pinch && startIn !== false) {
        var r = cv.getBoundingClientRect();
        cfg.pinch(d / lastDist, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      }
      lastDist = d;
    } else if (ids.length === 1 && last) {
      if (!startIn) return;                     // 起点在禁用区：不平移
      var dx = pts[ids[0]].x - last.x, dy = pts[ids[0]].y - last.y;
      moved += Math.abs(dx) + Math.abs(dy);
      // V1.7.0 第三轮（需求7）：与点按容差同一阈值（此前是 4px，导致触屏一抖就变成拖动）
      if (moved > TAP_SLOP && cfg.pan) cfg.pan(dx, dy);
      last = { x: pts[ids[0]].x, y: pts[ids[0]].y };
    }
  });
  function up(e) {
    if (!pts[e.pointerId]) return;
    delete pts[e.pointerId];
    var ids = Object.keys(pts);
    if (!ids.length) {
      // V1.5.0：这里原本是硬编码的 4px，而鼠标端用的是 TAP_SLOP(14) —— 触屏手指抖动远超 4px，
      // 导致「必须长按光点才能选中」。统一到 TAP_SLOP，并保证以后两处不会再各写一套阈值。
      var slop = cfg.tapSlop || TAP_SLOP;
      var far = startPt ? tapDist(e.clientX, e.clientY, startPt.x, startPt.y) : moved;
      if (far <= slop && cfg.tap) {
        var r = cv.getBoundingClientRect();
        cfg.tap(e.clientX - r.left, e.clientY - r.top);
      }
      last = null; lastDist = 0;
    } else if (ids.length === 1) {
      last = { x: pts[ids[0]].x, y: pts[ids[0]].y }; lastDist = 0;
    }
  }
  ['pointerup', 'pointercancel'].forEach(function (ev) { cv.addEventListener(ev, up); });
}

// ---------------------------------------------------------------- 信息悬浮窗：可拖动 + 单独关闭
// 结构：<div class="sat-info"><div class="si-head"><button class="si-close">✕</button></div><div class="si-body"></div></div>
// V1.7.1（需求2）：拆成两个状态，语义不再混用——
//   INFO_HIDDEN[key]  「当前要不要渲染」= 纯UI 状态（暂时没东西可显示时也是它）
//   INFO_CLOSED[key]  「用户主动点 ✕ 关掉了」= **意图**，必须由用户自己的操作才能解除
// 旧版只有一个 INFO_HIDDEN，同时承担这两种语义：用户点 ✕ 关掉后，只要鼠标扫到**任何另一颗**卫星，
// showInfo 里 `el.__lastId !== idKey` 就成立 → INFO_HIDDEN 被清成 false → 窗口重新出现；
// 再叠加画布 mousemove 的 `else if (S.sel.length)` 与 mouseleave 里无条件 syncSelInfo()，
// 窗口立刻"钉"在原来那颗卫星上——用户看到的就是「关掉后一动鼠标，新窗口就固定住了，像选中了新卫星」。
// 现在：hover 其它卫星走**纯预览**（不写 S.sel、默认角落、鼠标移开立即消失），
// 只有真的点了另一颗卫星（toggleSel / selectGroup / 搜索选中 / 换星座 / 还原默认）才解除 INFO_CLOSED。
var INFO_HIDDEN = { chart: false, map: false, globe: false, net: false };   // V1.8.0（需求8）：net = 03.5 组网进度
var INFO_CLOSED = { chart: false, map: false, globe: false, net: false };
// V1.7.2（需求4）：浮窗元素缓存。**必须定义在这里**（而不是浮窗函数旁边）——
//   因为下面的 setupInfo 里点击 ✕ 时会调 hideFloat()，那时代码还没执行到后面的 var 赋值。
var INFO_B = {};
function infoClearClosed() {
  Object.keys(INFO_CLOSED).forEach(function (k) { INFO_CLOSED[k] = false; });
  // 顺带把所有浮窗收掉：换星座 / 还原默认之后不应残留上一批的悬停窗
  ['chart', 'map', 'globe', 'net'].forEach(function (k) { try { hideFloat(k); } catch (e) {} });
}
function setupInfo(el, key) {
  if (!el) return null;
  if (!el.__ready) {
    el.innerHTML = '<div class="si-head"><button class="si-close" type="button">✕</button></div><div class="si-body"></div>';
    el.__ready = true;
    el.__key = key;
    var body = el.querySelector('.si-body');
    var btn = el.querySelector('.si-close');
    btn.title = t('d_close_info');
    btn.setAttribute('aria-label', t('d_close_info'));
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      // V1.7.1（需求2）：点 ✕ = 用户明确表达「我不想看这个窗」。记下意图并立刻收起来。
      // 之后**悬停不再能把它叫出来**（只能靠真正选中另一颗卫星来解除），这就是「关得掉」的关键。
      INFO_CLOSED[key] = true;
      hideFloat(key);                    // V1.7.2（需求4）：A 窗一关，浮窗也不许再冒出来
      INFO_HIDDEN[key] = true;
      el.style.display = 'none';
    });
    // 移动信息框：必须先长按 450ms 才进入移动状态，进入后用星座主题色描一圈细边，
    // 期间接管手势、禁止页面上下滑动；松手固定在新位置并去掉描边。
    var drag = null, holdT = null, cand = null;
    function noScroll(ev) { if (ev.cancelable) ev.preventDefault(); }
    function endDrag() {
      if (holdT) { clearTimeout(holdT); holdT = null; }
      cand = null;
      if (!drag) return;
      drag = null;
      el.classList.remove('moving');
      el.style.touchAction = '';
      document.removeEventListener('touchmove', noScroll);
    }
    // V1.3.4：手机上长按 450ms 才进入移动态（避免抢页面上下滑动）；电脑端按下即可拖
    function startDrag() {
      if (holdT) { clearTimeout(holdT); holdT = null; }
      if (!cand) return;
      drag = cand; cand = null;
      el.classList.add('moving');
      if (isTouch()) {
        el.style.touchAction = 'none';
        document.addEventListener('touchmove', noScroll, { passive: false });
      }
      try { el.setPointerCapture(drag.id); } catch (err) {}
    }
    el.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.si-close')) return;
      // V1.7.2 第七轮（需求4，第三层防线）：浮窗（.floatwin）**永远不可拖**，
      //   因此永远不该拿到 .moving 类 —— 而拖动时的主题色边框只挂在 .moving 上。
      //   现状靠 pointer-events:none 隐式保证（它根本收不到事件），这里再加一道显式拦截：
      //   将来若有人改了 pointer-events，也不会把边框泄露到 B 窗身上。
      if (el.classList.contains('floatwin')) return;
      // V1.7.2（需求4）：浮窗（.floatwin）根本没有 pointerdown 逻辑（它 pointer-events:none 收不到事件），
      //   这里的 setupInfo 只服务 A 窗 —— A 窗永远可拖，所以 V1.7.1 那条"预览态不许拖"的 guard 已删除。
      // V1.7.1（需求1）：按下点必须落在窗口的**可视矩形**内。
      //   旧实现只靠 CSS 的 overflow裁剪 + setPointerCapture：窗口被拖到只剩一小条在屏内时，
      //   那一小条之外的"被裁掉部分"仍然会响应 pointermove（因为指针已被捕获到元素上），
      //   视觉上就变成"拖拽识别空间往左溢出到窗口外面"—— 第 01 章最明显，
      //   因为 .chart-wrap 最宽、信息窗能横排 8 块（宽可达 700px+），minL 也就最负。
      var rr = el.getBoundingClientRect();
      if (e.clientX < rr.left - 1 || e.clientX > rr.right + 1 ||
          e.clientY < rr.top - 1 || e.clientY > rr.bottom + 1) return;
      blurSearchInputs();                       // V1.7.0 第三轮（需求5）：长按拖信息窗前先把焦点让出去
      // V1.3.5：触屏上先掐掉兼容性鼠标事件（mousedown/mouseup/click 那一串）。手指碰信息窗时浏览器
      // 会给上一个目标补一个 mouseleave，画布那一侧若因此收起信息窗，用户就会看到「长按后直接消失」。
      if (e.pointerType && e.pointerType !== 'mouse' && e.cancelable) e.preventDefault();
      var wrap = el.parentElement.getBoundingClientRect(), r = el.getBoundingClientRect();
      cand = { x: e.clientX, y: e.clientY, left: r.left - wrap.left, top: r.top - wrap.top, w: r.width, h: r.height, id: e.pointerId };
      if (isTouch()) holdT = setTimeout(startDrag, 450);
      else startDrag();
    });
    // 长按还会弹出系统菜单/放大镜，直接拦掉
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    el.addEventListener('pointermove', function (e) {
      // 长按未满就先动了 → 判定为滚动页面，不接管（仅触屏需要这条）
      // 手指多少会抖一点，阈值从 8px 放宽到 12px，免得轻轻一颤就被判成滑动页面
      if (cand && isTouch() && (Math.abs(e.clientX - cand.x) > 12 || Math.abs(e.clientY - cand.y) > 12)) {
        clearTimeout(holdT); holdT = null; cand = null;
      }
      if (!drag) return;
      // 位移不到 3px 先不动，避免单击时抖动
      if (Math.abs(e.clientX - drag.x) < 3 && Math.abs(e.clientY - drag.y) < 3) return;
      if (!drag.moved) {
        drag.moved = true;
        el.style.left = drag.left + 'px';
        el.style.top = drag.top + 'px';
        el.style.right = 'auto'; el.style.bottom = 'auto';
      }
      // V1.3.6：真的拖动过一次之后，这个窗口就不再重复显示「可拖拽」提示
      if (!DRAGGED[key]) { DRAGGED[key] = true; refreshDragTip(el, key); }
      el.__moved = true;                 // 手动拖过之后，位置由用户说了算，不再自动避让指针
      var wrap = el.parentElement.getBoundingClientRect();
      // V1.7.2（需求11）：**恢复**「可以部分拖到屏幕之外」——像 Windows 窗口那样。
      //   V1.7.1 曾把它收紧成「整体必须留在视口内」（minL = 0），那是修需求 2（识别区左溢出）
      //   时**改过头了**：真正的病根是窄屏换列（元素宽度翻倍、左边界远在内容左侧），
      //   而不是钳制边界。换列已在 CSS 侧根治（flex-wrap:nowrap + max-height 按视口算），
      //   所以这里恢复成 V1.4.5/V1.4.9 的「至少留 KEEP=24px 在屏内」。
      //   两者不冲突：钳制管「能拖到哪」，pointerdown 的可视矩形命中测试管「从哪能开始拖」。
      //   ★ 仍然不得撑宽页面 —— 靠 html/body 的 overflow-x:hidden 兜底（V1.4.5 专修过）。
      var KEEP = 24, vw = window.innerWidth, vh = window.innerHeight;
      var maxL = (vw - KEEP) - wrap.left;
      var minL = (KEEP - drag.w) - wrap.left;           // 窗口可以整体拖到只露 24px 在左侧
      var maxT = (vh - KEEP) - wrap.top;
      var minT = (KEEP - drag.h) - wrap.top;
      if (maxL < minL) { maxL = minL; }                 // 框比屏幕还宽的极端情况：至少不被推到看不见
      if (maxT < minT) { maxT = minT; }
      var nl = Math.max(minL, Math.min(maxL, drag.left + (e.clientX - drag.x)));
      var nt = Math.max(minT, Math.min(maxT, drag.top + (e.clientY - drag.y)));
      el.style.left = Math.round(nl) + 'px';
      el.style.top = Math.round(nt) + 'px';
    });
    ['pointerup', 'pointercancel'].forEach(function (ev2) {
      el.addEventListener(ev2, endDrag);
    });
  }
  el.__body = el.__body || el.querySelector('.si-body');
  return el.__body;
}
// V1.3.6：信息窗末尾那行「可拖拽」提示 —— 每个窗口各记一次，拖过就不再出现；
// 换窗口（图表/地图/地球）或换星座时重置，提示重新出现一次。
var DRAGGED = { chart: false, map: false, globe: false };
function resetDragTips() { Object.keys(DRAGGED).forEach(function (k) { DRAGGED[k] = false; }); }
function refreshDragTip(el, key) {
  var tip = el.querySelector('.si-drag');
  if (!tip) return;
  tip.style.display = DRAGGED[key] ? 'none' : '';
}
// V1.3.7：信息窗默认贴在左上角，而悬停出来的窗口正好会压住鼠标所在的那一小片画布，
// 于是「点左上区域的卫星」永远点不中 —— 点击被信息窗吃掉了。
// 这里让窗口在换目标时自动挑一个离指针最远的角落（用户手动拖过之后就不再自动挪）。
var LASTPTR = { chart: null, map: null, globe: null };
function placeInfoCorner(el, key) {
  var ptr = LASTPTR[key];
  if (!ptr || el.__moved || !el.parentElement) return;
  var wrap = el.parentElement, W = wrap.clientWidth, H = wrap.clientHeight;
  var w = el.offsetWidth || 240, h = el.offsetHeight || 200, M = 16;
  var L = parseFloat(el.style.left), T = parseFloat(el.style.top);
  if (isFinite(L) && isFinite(T) &&
      ptr.x > L - 14 && ptr.x < L + w + 14 && ptr.y > T - 14 && ptr.y < T + h + 14) {
    var cand = [[M, M], [Math.max(M, W - w - M), M],
                [M, Math.max(M, H - h - M)], [Math.max(M, W - w - M), Math.max(M, H - h - M)]];
    var best = cand[0], bd = -1;
    cand.forEach(function (c) {
      var d = Math.hypot(c[0] + w / 2 - ptr.x, c[1] + h / 2 - ptr.y);
      if (d > bd) { bd = d; best = c; }
    });
    el.style.left = Math.round(best[0]) + 'px';
    el.style.top = Math.round(best[1]) + 'px';
  }
}
// ══════════════════════════════════════════════════════════════════════════
// V1.7.2（需求2/4）：信息窗分成「A 窗」与「浮窗」两种角色 —— 三态交互的核心
//
//   A 窗（常驻，每章一个：#chartInfo / #mapInfo / #globeInfo）
//     只有选中卫星时出现；有 ✕、可拖、贴在默认角落或用户拖到的位置。
//     多选时只显示 NORAD 最小那颗（若有 focusIdx 则显示它 —— 即"组内切换"）。
//
//   浮窗（每章一个：#chartInfoB / #mapInfoB / #globeInfoB）
//     鼠标扫过光点时出现，是 A 窗的"附庸"：**无 ✕、不可拖、移开即消失**。
//     位置规则：A 窗可见 → 紧贴 A 窗右侧（右侧放不下改左侧，再不行改下方）；
//               A 窗不可见（没选中任何卫星）→ 默认角落。
//     它带 pointer-events:none → 不会抢 hover，也就不会出现"盖住鼠标 →
//     canvas mouseleave → 收掉 → 鼠标落回 canvas → 又显示"的无限闪动（V1.7.1 的老毛病）。
//
//   三态（用户明确规定）：
//     ① 未选中任何卫星  → 只有浮窗（默认位置），内容随鼠标指向动态变更；
//                        鼠标移到空白处 / 移出图像 → 不显示任何窗
//     ② 选中 1 颗或多颗 → A 窗常驻 + 浮窗紧贴其右
//     ③ 选中但按过 ✕    → A 窗与浮窗**都不显示**（沉浸式观看）。
//                        只有「取消选择 → 再选新卫星」才会重新在默认位置出现 A 窗
//                        （换星座 / 还原默认也会清除该标记，否则换星座后信息窗永远不出来）
// ══════════════════════════════════════════════════════════════════════════
function infoAEl(key) { return document.getElementById(key + 'Info'); }
function floatEl(key) {
  if (!INFO_B[key]) INFO_B[key] = document.getElementById(key + 'InfoB');
  return INFO_B[key];
}
function setupFloat(key) {
  var el = floatEl(key);
  if (!el) return null;
  if (!el.__ready) {
    // 浮窗**不渲染 .si-head**（没有 ✕）、**不渲染 .si-drag**（不能拖、也不提示）
    el.innerHTML = '<div class="si-body"></div>';
    el.__ready = true;
    el.__body = el.querySelector('.si-body');
  }
  return el.__body;
}
function hideFloat(key) {
  var el = floatEl(key); if (!el) return;
  el.__lastId = null;
  el.style.display = 'none';
}
// html 为空 / 该章 A 窗已被用户关掉（③）→ 浮窗一律不显示
function showFloat(key, html, idKey) {
  var el = floatEl(key); if (!el) return;
  if (!html || INFO_CLOSED[key]) { hideFloat(key); return; }
  // V1.7.2 第七轮（需求5 收口）：B 窗是「鼠标悬停预览」专用件，只对能 hover 的设备有意义。
  //   手机/平板纯触摸时的坑：tap 会被浏览器合成为 mouseover→mousemove→mousedown→mouseup→click，
  //   其中 mousemove 会把 B 窗叫出来；之后既不会有真正的 mouseleave，窄屏又没有横向空间
  //   （A 窗几乎满宽 → B 窗只能落到 A 窗下方，探针实测 dTopVsABody=251px），于是屏幕上
  //   多出一个永远不消失、又贴不齐 A 窗的重复信息窗。
  //   → 设备无 hover 能力时直接不弹（交给 A 窗：选中/观测点本来就走 A 窗）。
  //   注意用 (hover:hover) 而不是 isTouch()：带触控笔的平板 hover:hover 为真（笔可悬停），
  //   此时 B 窗应照常可用；装了鼠标/触控板的 iPad 同理自动恢复。
  if (noHover()) { hideFloat(key); return; }
  var body = setupFloat(key);
  if (!body) return;
  body.innerHTML = html;
  el.__lastId = idKey;
  el.__wantH = null;          // V1.7.2 第七轮（需求5）：内容换了 → 高度要重新跟随 A 窗
  // 先量尺寸再定位：借 visibility 隐藏着量，避免肉眼看到"先跳到错误位置再修正"
  el.style.visibility = 'hidden';
  el.style.display = 'flex';
  positionFloat(key);
  el.style.visibility = '';
}
// 浮窗定位 —— A 窗可见就紧贴它，否则回默认角落；结果始终夹在视口内（浮窗不可拖，必须完整可见）
// V1.7.2 第七轮（需求5，Q3=B）：基准从「A 窗整体」换成「A 窗的内容区 .si-body」。
//   为什么：A 窗顶部还有一行 ✕（.si-head，实测高 20px）与 12px 的 gap，共 32px。
//   旧实现用 A 窗整体 rect 作基准 → 实测「B 窗上沿 − A 窗 .si-body 上沿 = −32px」，
//   也就是"B 窗上沿与 × 按钮上边缘对齐"（用户图四）。
//   用户要求：B 窗上下边缘与 A 窗**内容部分**对齐（不含 ✕ 按钮、不含底部拖拽提示）。
//   → 上沿对齐 .si-body 顶部；高度 = .si-body 高 − 底部提示行高（这样下沿与"内容区去掉提示行"
//     的那条线齐平）。只在 B 窗内容不会溢出时才设高度，宁可保持 auto 也不裁内容。
function positionFloat(key) {
  var el = floatEl(key); if (!el || !el.parentElement) return;
  var wrap = el.parentElement.getBoundingClientRect();
  var vw = window.innerWidth, vh = window.innerHeight;
  var GAP = 8, M = 16;
  var a = infoAEl(key);
  var aVisible = !!(a && a.style.display !== 'none' && a.offsetWidth);
  var ab = null, tipH = 0;
  if (aVisible) {
    var aBody = a.querySelector('.si-body');
    var aTip = aBody ? aBody.querySelector('.si-drag') : null;
    tipH = aTip ? aTip.getBoundingClientRect().height : 0;
    ab = (aBody || a).getBoundingClientRect();
  }
  // ★ 高度跟随（缓存 wantH，避免每次 hover 都强制重排两次）
  if (ab) {
    var wantH = Math.round(ab.height - tipH);
    if (wantH > 0 && el.__wantH !== wantH) {
      el.style.height = '';
      var naturalH = el.scrollHeight;
      el.style.height = (naturalH <= wantH + 1) ? wantH + 'px' : '';
      el.__wantH = wantH;
    }
  } else if (el.__wantH !== 0) {
    el.style.height = ''; el.__wantH = 0;
  }
  var w = el.offsetWidth, h = el.offsetHeight;
  var left, top;
  if (ab) {
    left = ab.right + GAP - wrap.left;            // 首选：A 窗内容区右侧
    top = ab.top - wrap.top;                      // ★ 与内容区上沿齐平
    if (ab.right + GAP + w > vw) {
      left = ab.left - GAP - w - wrap.left;       // 右侧放不下 → 内容区左侧
      if (ab.left - GAP - w < 0) {
        left = ab.left - wrap.left;               // 左侧也放不下 → 内容区下方
        top = ab.bottom + GAP - wrap.top;
      }
    }
  } else {
    left = M; top = M;                            // 没选中任何卫星 → 默认角落
  }
  var minL = M - wrap.left, maxL = (vw - w - M) - wrap.left;
  var minT = M - wrap.top, maxT = (vh - h - M) - wrap.top;
  if (maxL < minL) { maxL = minL; }
  if (maxT < minT) { maxT = minT; }
  el.style.left = Math.round(Math.max(minL, Math.min(maxL, left))) + 'px';
  el.style.top = Math.round(Math.max(minT, Math.min(maxT, top))) + 'px';
  el.style.right = 'auto'; el.style.bottom = 'auto';
}

// A 窗：只有选中卫星时才用，带 ✕ 与拖动逻辑
function showInfo(el, key, html, idKey) {
  if (!el) return;
  var body = setupInfo(el, key);
  if (idKey !== undefined && el.__lastId !== idKey) {
    el.__lastId = idKey;
    INFO_HIDDEN[key] = false;                 // 换了目标就重新显示
    // V1.7.0（任务14）：信息窗的拖拽位置只对「当前这颗卫星」有效 —— 换目标（含从无到有）
    // 时把位置和「已手动移动」标记一起清掉，新窗口回到默认角落，不继承上一颗卫星的拖动位置。
    el.__moved = false;
    el.style.left = '';
    el.style.top = '';
    el.style.right = '';
    el.style.bottom = '';
    placeInfoCorner(el, key);                 // V1.3.7：换目标时才考虑挪位置，避免跟着鼠标抖
  }
  // V1.4.9：提示染当前星座的主题色（星网红 / 千帆蓝），不再固定用 --row-sel 的红
  var tipColor = S.key === 'qf' ? 'var(--c-qf)' : 'var(--c-gw)';
  body.innerHTML = html +
    '<div class="si-drag"' + (DRAGGED[key] ? ' style="display:none;color:' + tipColor + '"' : ' style="color:' + tipColor + '"') + '>' + t('d_drag_tip') + '</div>';
  el.style.display = INFO_HIDDEN[key] ? 'none' : 'flex';
  positionFloat(key);                         // A 窗位置变了 → 浮窗跟着挪（或回到默认角落）
}
function hideInfo(el, key) {
  if (!el) return;
  INFO_HIDDEN[key] = false;
  el.__lastId = null;
  el.__moved = false;
  el.style.left = ''; el.style.top = ''; el.style.right = ''; el.style.bottom = '';
  el.style.display = 'none';
  positionFloat(key);                         // A 窗没了 → 浮窗回到默认角落
}

// ---------------------------------------------------------------- 外链（V1.3.6）
var SATCAT = function (norad) { return 'https://www.satcat.com/sats/' + norad; };

// ---------------------------------------------------------------- 图 01：图表
var chartCv = document.getElementById('chart');
var chartInfo = document.getElementById('chartInfo');
var SPIN_RATE = 0.028;      // 地球自转角速度 rad/s（V1.3.8：与帧率无关）
var lastSpinMs = 0;
var zoomBand = document.getElementById('zoomBand');
var chartPts = [], chartView = null, chartRect = null;
// V1.7.0 第四轮（需求3）：倾角分布的**物理边界**与缩放限位 ——
//   横轴倾角只可能是 0–90°；纵轴轨道高度必须 > 0、< 36500 km（地球静止轨道高度，低轨星座远够不到）。
//   旧版只有『最小缩放下限』（0.05°），没有最大缩放/平移边界 → 图可以无限缩小、拖到哪儿都行。
var CHART_X_MIN = 0, CHART_X_MAX = 180;       // 倾角（°）—— V1.7.2（需求8）：90 → 180
var CHART_Y_MIN = 0, CHART_Y_MAX = 36500;     // 轨道高度（km，上界 = GEO）
function clampChartView(v) {
  if (!v) return v;
  // 视口比整个定义域还宽/高 → 直接钉到定义域（这就是「不能无限缩小」的硬闸）
  if (v.x1 - v.x0 >= CHART_X_MAX - CHART_X_MIN) { v.x0 = CHART_X_MIN; v.x1 = CHART_X_MAX; }
  if (v.y1 - v.y0 >= CHART_Y_MAX - CHART_Y_MIN) { v.y0 = CHART_Y_MIN; v.y1 = CHART_Y_MAX; }
  // 平移出界 → 整体拉回（保持视口宽度不变）
  if (v.x0 < CHART_X_MIN) { v.x1 += CHART_X_MIN - v.x0; v.x0 = CHART_X_MIN; }
  if (v.x1 > CHART_X_MAX) { v.x0 -= v.x1 - CHART_X_MAX; v.x1 = CHART_X_MAX; }
  if (v.y0 < CHART_Y_MIN) { v.y1 += CHART_Y_MIN - v.y0; v.y0 = CHART_Y_MIN; }
  if (v.y1 > CHART_Y_MAX) { v.y0 -= v.y1 - CHART_Y_MAX; v.y1 = CHART_Y_MAX; }
  return v;
}
var chartDrag = null, chartHoverPt = null;

// V1.3.6：横轴 = 轨道倾角（°），纵轴 = 选定的纵轴量（半长轴 / 远地点 / 近地点）
function buildChartPoints() {
  var st = cur(), byL = {};
  st.sats.forEach(function (s) { (byL[s.lk] || (byL[s.lk] = [])).push(s); });
  chartPts = st.sats.map(function (s) {
    var g = byL[s.lk] || [s], gi = g.indexOf(s);
    // 同一批次的倾角几乎相同，沿横轴散开 ±0.25° 免得叠成一根实线
    var jitter = g.length > 1 ? (gi / (g.length - 1) - 0.5) * 0.5 : 0;
    return { x: s.inc + jitter, y: val(s, S.mode), sat: s };
  });
}
// 待编目批次在图表上的「摘要虚影」：横轴=目录摘要倾角，纵轴=该批次摘要高度。
// 依据只有目录摘要（近远地点、倾角）——没有任何轨道要素，所以不参与选中/悬停，也不进地图与地球。
function pendVal(L) {
  var nfo = L && L.pinfo; if (!nfo) return null;
  var x = nfo.inc;
  if (!isFinite(x)) return null;
  if (S.mode === 'ha') return { x: x, y: nfo.apogee, lo: nfo.perigee, hi: nfo.apogee };
  if (S.mode === 'hp') return { x: x, y: nfo.perigee, lo: nfo.perigee, hi: nfo.apogee };
  return { x: x, y: (nfo.apogee + nfo.perigee) / 2, lo: nfo.perigee, hi: nfo.apogee };
}
function pendPts() {
  var st = cur();
  return st.launches.filter(function (L) {
    if (!(L.pending > 0) || !L.pinfo) return false;
    if (S.launchFilter !== 'all' && L.key !== S.launchFilter) return false;
    return true;
  }).map(function (L) { var p = pendVal(L); return p ? { p: p, L: L } : null; })
    .filter(Boolean);
}
function chartAutoView() {
  var src = chartVisiblePts();
  if (!src.length) { chartView = { x0: 0, x1: 1, y0: 0, y1: 1 }; return; }
  var rawMin = Infinity, rawMax = -Infinity, y0 = Infinity, y1 = -Infinity;
  src.forEach(function (p) {
    if (p.x < rawMin) rawMin = p.x;
    if (p.x > rawMax) rawMax = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
  });
  // 时间轴把待编目批次也算进来——那些发射确实发生了，只是没有要素
  pendPts().forEach(function (g) {
    if (g.p.x < rawMin) rawMin = g.p.x;
    if (g.p.x > rawMax) rawMax = g.p.x;
    var ys = [g.p.y, g.p.lo, g.p.hi].filter(function (v) { return v != null && isFinite(v); });
    ys.forEach(function (v) { if (v < y0) y0 = v; if (v > y1) y1 = v; });
  });
  var dy = (y1 - y0) || 10;
  // V1.3.6：横轴是倾角（°）—— 两侧各留一点余量，范围极窄时兜底到 ±0.4°
  var dx = (rawMax - rawMin) || 1;
  var px = Math.max(dx * 0.10, 0.4);
  var x0 = rawMin - px, x1 = rawMax + px;
  // 纵轴：默认只看 500–1800 km；若数据本身越界则以数据为准（并留一点余量）
  var pad = dy * 0.12;
  var yy0 = y0 - pad, yy1 = y1 + pad;
  yy0 = Math.max(yy0, Math.min(500, y0 - pad));
  yy1 = Math.min(yy1, Math.max(1800, y1 + pad));
  if (yy1 - yy0 < 20) { yy0 -= 10; yy1 += 10; }
  chartView = clampChartView({ x0: x0, x1: x1, y0: yy0, y1: yy1 });   // V1.7.0 第四轮（需求3）
}
function chartVisiblePts() {
  if (S.launchFilter === 'all') return chartPts;
  return chartPts.filter(function (p) { return p.sat.lk === S.launchFilter; });
}
function drawChart() {
  var f = fitCanvas(chartCv), ctx = f.ctx, W = f.w, H = f.h, C = themeColors();
  // V1.5.0：窄屏左侧留白过多 → 绘图区左边界左移；右侧离按钮列太近 → 右边界内收
  var narrow = window.innerWidth < 760;
  var PL = narrow ? 50 : 66, PR = narrow ? 34 : 18, PT = 16, PB = 38;
  var pw = W - PL - PR, ph = H - PT - PB;
  chartRect = { PL: PL, PT: PT, pw: pw, ph: ph };
  ctx.clearRect(0, 0, W, H);
  var pts = chartVisiblePts();
  var v = chartView;
  var X = function (x) { return PL + (x - v.x0) / (v.x1 - v.x0) * pw; };
  var Y = function (y) { return PT + ph - (y - v.y0) / (v.y1 - v.y0) * ph; };

  // 网格
  ctx.font = '11px ' + MONO;
  ctx.lineWidth = 1;
  var yt = niceTicks(v.y0, v.y1, 6);
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  yt.forEach(function (t) {
    var y = Y(t);
    if (y < PT - 2 || y > PT + ph + 2) return;
    ctx.strokeStyle = C.gridY; ctx.beginPath(); ctx.moveTo(PL, y); ctx.lineTo(PL + pw, y); ctx.stroke();
    ctx.fillStyle = C.tick;
    ctx.fillText(t.toFixed(MODE_FMT), PL - 8, y);
  });
  // V1.3.6：X 轴 = 轨道倾角（°），数值刻度（不再是日期）
  var xt = niceTicks(v.x0, v.x1, 6);
  var xdec = (v.x1 - v.x0) < 4 ? 2 : ((v.x1 - v.x0) < 20 ? 1 : 0);
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  xt.forEach(function (t) {
    var x = X(t);
    if (x < PL - 2 || x > PL + pw + 2) return;
    ctx.strokeStyle = C.gridX; ctx.beginPath(); ctx.moveTo(x, PT); ctx.lineTo(x, PT + ph); ctx.stroke();
    ctx.fillStyle = C.tick; ctx.fillText(t.toFixed(xdec) + '°', x, PT + ph + 9);
  });
  // 轴
  ctx.strokeStyle = C.dim; ctx.beginPath();
  ctx.moveTo(PL, PT); ctx.lineTo(PL, PT + ph); ctx.lineTo(PL + pw, PT + ph); ctx.stroke();
  ctx.save();
  ctx.translate(15, PT + ph / 2); ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = C.dim; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '10px ' + MONO;
  ctx.fillText(MODE_LABEL(S.mode) + ', ' + MODE_UNIT(S.mode), 0, 0);
  ctx.restore();
  ctx.font = '10px ' + MONO; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillStyle = C.dim;
  ctx.fillText(t('d_x_inc') + ', °', PL + pw / 2, PT + ph + 24);

  // V1.7.2（需求8）：物理边界线 —— 虚线画出 180°（倾角上限，含逆行轨道）与 36500 km（GEO 高度上限），
  //   只在边界落在当前视口内时才画；配合 clampChartView，图再也缩不出/拖不出这个框。
  //   横轴上界 90 → 180：原来 90° 把逆行轨道（倾角 > 90°）挡在定义域外，放宽后才能容纳。
  // V1.8.0（需求17 / ⑱）：绘图区硬裁剪 —— 卫星光点、待编目虚影与选中标注一律裁到
  //   横纵坐标轴围成的矩形内。此前只做了「越界点跳过」（x/y 超出 ±4px 就不画），
  //   于是正好压在轴上或半出轴的点仍会把圆点画到轴外（低倍率/窄屏/滑动时最明显）。
  //   现在改为 canvas 级 clip：无论屏幕比例、页面内还是全屏，图像都在坐标线上截止。
  ctx.save();
  ctx.beginPath(); ctx.rect(PL, PT, pw, ph); ctx.clip();

  // ★ V1.9.1（1.4）：两条**物理边界虚线**（180° 与 36500 km）挪到 clip **之后**画。
  //   为什么必须挪：它们是"上界"线，落点恰好在绘图区的边上（`by === PT`、`bx === PL+pw`），
  //   而 `lineWidth = 1` 的描边是**以线为中心**铺开的 → 顶边那条线有 0.5px 落在 PT 之上，
  //   抗锯齿后在绘图区外留下一整条高饱和像素带（视觉回归实测抓到：y=15 行、x=76…102）。
  //   以前不暴露是因为纵轴/横轴从没被撑到上界（过去最高卫星 1200 km），
  //   直到 1.4 把 GEO（35786 km，纵轴上界 36500）收进来才现形。
  //   挪进 clip 内后，溢出的那半像素被裁掉，线正好"贴在坐标轴上截止"（需求⑱ 要的效果）。
  ctx.setLineDash([5, 4]); ctx.lineWidth = 1;
  ctx.strokeStyle = C.theme;
  if (v.x1 > CHART_X_MAX - 1e-6 && CHART_X_MAX >= v.x0) {
      var bx = X(CHART_X_MAX);
      ctx.beginPath(); ctx.moveTo(bx, PT); ctx.lineTo(bx, PT + ph); ctx.stroke();
      ctx.fillStyle = C.theme; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
      ctx.fillText('180°', bx - 4, PT + 4);
  }
  if (v.y1 > CHART_Y_MAX - 1e-6 && CHART_Y_MAX >= v.y0) {
    var by = Y(CHART_Y_MAX);
    ctx.beginPath(); ctx.moveTo(PL, by); ctx.lineTo(PL + pw, by); ctx.stroke();
    ctx.fillStyle = C.theme; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    // 标签画在线的**下方**（top 基线），天然落在绘图区内（旧写法 by - 3 + bottom 基线
    // 是画在坐标轴之上，见上面那段说明）。
    ctx.fillText('36500 km (GEO)', PL + 6, by + 3);
  }
  ctx.setLineDash([]);

  // 点
  var scope = 'chart';
  pts.forEach(function (p) {
    var x = X(p.x), y = Y(p.y);
    if (x < PL - 4 || x > PL + pw + 4 || y < PT - 4 || y > PT + ph + 4) return;
    var sel = S.sel.indexOf(p.sat.idx) >= 0;
    var col = colOf(p.sat, scope);
    ctx.globalAlpha = (S.sel.length && !sel) ? 0.22 : 1;   // 有选中时其余卫星变暗
    if (sel || p === chartHoverPt) {
      ctx.beginPath(); ctx.arc(x, y, 7, 0, 6.2832);
      ctx.fillStyle = C.sel; ctx.fill();
    }
    ctx.beginPath(); ctx.arc(x, y, sel ? 4.4 : 2.7, 0, 6.2832);
    ctx.fillStyle = col; ctx.fill();
    if (sel) { ctx.lineWidth = 1.4; ctx.strokeStyle = C.fg; ctx.stroke(); }
    ctx.globalAlpha = 1;
  });
  // 待编目批次：空心点 + 虚线高度区间（仅有目录摘要，无轨道要素 → 不参与选中/悬停）
  var ghost = pendPts();
  if (ghost.length) {
    ctx.save();
    ghost.forEach(function (g) {
      var p = g.p, gx = X(p.x), gy = Y(p.y);
      if (gx < PL - 4 || gx > PL + pw + 4) return;
      ctx.globalAlpha = S.sel.length ? 0.3 : 0.8;
      if (p.lo != null && p.hi != null && p.hi > p.lo) {
        var ya = Y(p.hi), yb = Y(p.lo);
        // V1.7.1（需求8）：待编目批次的高度区间线一并改用星座主题色，与上面两条边界线统一
        ctx.setLineDash([3, 3]); ctx.strokeStyle = C.theme; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(gx, ya); ctx.lineTo(gx, yb); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(gx - 3.5, ya); ctx.lineTo(gx + 3.5, ya);
        ctx.moveTo(gx - 3.5, yb); ctx.lineTo(gx + 3.5, yb); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.beginPath(); ctx.arc(gx, gy, 3.4, 0, 6.2832);
      ctx.fillStyle = C.bg; ctx.fill();
      ctx.lineWidth = 1.3; ctx.strokeStyle = C.accent; ctx.stroke();
    });
    ctx.restore();
    ctx.globalAlpha = 1;
  }
  // 选中卫星的标注
  if (S.sel.length && S.sel.length <= 12) {
    ctx.font = '10px ' + MONO; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    S.sel.forEach(function (i) {
      var s = cur().sats[i]; if (!s) return;
      var p = null;
      for (var k = 0; k < pts.length; k++) if (pts[k].sat === s) { p = pts[k]; break; }
      if (!p) return;
      var x = X(p.x), y = Y(p.y);
      if (x < PL || x > PL + pw) return;
      ctx.fillStyle = C.fg; ctx.fillText(s.name.replace(/^HULIANWANG /, '').replace(/^QIANFAN/, 'QF'), x + 9, y);
    });
  }
  ctx.restore();      // V1.8.0（需求17 / ⑱）：结束绘图区裁剪
}
function chartHit(mx, my) {
  if (!chartRect || !chartView) return null;
  var v = chartView, r = chartRect;
  var x = v.x0 + (mx - r.PL) / r.pw * (v.x1 - v.x0);
  var y = v.y0 + (r.PT + r.ph - my) / r.ph * (v.y1 - v.y0);
  var dx = (v.x1 - v.x0) * 14 / r.pw, dy = (v.y1 - v.y0) * 14 / r.ph;
  var best = null, bd = Infinity;
  chartVisiblePts().forEach(function (p) {
    if (Math.abs(p.x - x) > dx || Math.abs(p.y - y) > dy) return;
    var d = Math.pow((p.x - x) / dx, 2) + Math.pow((p.y - y) / dy, 2);
    if (d < bd) { bd = d; best = p; }
  });
  return bd < 1.6 ? best : null;
}
// 三个视图共用的卫星信息块 —— 字段以 01 章节（图表）为准：
// 名称 / 批次 / NORAD / 半长轴高度 / 近地点 / 远地点 / 倾角 / 周期 / 发射时间（距今天数）/ 要素历元
// extra 用于追加该视图特有的行（目录名、星下点、瞬时高度、观测点仰角…）。
function satBlock(s, scope, extra) {
  var b = S.model === 'brouwer';
  var L = s.launch || {};
  var date = (L.dateStr || '').slice(0, 10) || '—';
  var ms = L.dateMs;
  var days = isFinite(ms) ? Math.max(0, Math.floor((Date.now() - ms) / DAY)) : null;
  // V1.6.3：信息窗统一版式（各章节 / 全屏 / 中英文共用）——
  // 顺序：NORAD → 批次/组 → 近地点×远地点 → 倾角 → 周期 → 发射日期 → 更新历元；
  // 已按要求去掉「半长轴」与「目录名」两项。
  return '<div class="si-block"><div class="si-name">' + s.name +
    '<span class="swatch" style="background:' + colOf(s, scope) + '"></span></div>' +
    '<div class="si-row"><span>NORAD</span><span>' + s.norad + '</span></div>' +
    '<div class="si-row"><span>' + t('d_row_batch') + '</span><span>' + batchName(L.name) + '</span></div>' +
    '<div class="si-row"><span>' + t('d_row_pa') + '</span><span>' +
      fmtNum(b ? s.hpB : s.hpK, 2) + ' km×' + fmtNum(b ? s.haB : s.haK, 2) + ' km</span></div>' +
    '<div class="si-row"><span>' + t('d_row_inc') + '</span><span>' + fmtNum(s.inc, 2) + '°</span></div>' +
    '<div class="si-row"><span>' + t('d_row_period') + '</span><span>' + fmtNum(s.period, 3) + (LANG === 'en' ? ' min' : ' 分') + '</span></div>' +
    '<div class="si-row"><span>' + t('d_row_launch') + '</span><span>' + date +
      (days === null ? '' : paren(days + (LANG === 'en' ? ' d' : ' 天'))) + '</span></div>' +
    // V1.7.2 第七轮（需求6）：**信息窗里只保留「该星历元」这一行**。
    //   用户确认：整包口径的「TLE 更新时间」只显示在主标题下方那一处即可，
    //   所有信息窗（A 窗 / 浮窗）、以及导出图片里的卫星信息行，末尾都只留单星历元。
    //   这样也不再出现"同一颗星的窗里两个日期、分不清哪个是最新"的困惑。
    '<div class="si-row"><span>' + t('d_row_epoch_sat') + '</span><span>' + fmtUTC(s.epochMs) + '</span></div>' +
    (extra || '') + '</div>';
}
function siRow(label, val) { return '<div class="si-row"><span>' + label + '</span><span>' + val + '</span></div>'; }

// A 窗（图表）：选中态常驻，可有多颗（最多 8 块）
function showChartInfo(pts) {
  if (!pts || !pts.length) { hideInfo(chartInfo, 'chart'); return; }
  // V1.4.0：过滤掉没有卫星对象的点位（数据重建瞬间会短暂出现），免得后面读 p.sat.idx 抛错
  pts = pts.filter(function (p) { return p && p.sat; });
  if (!pts.length) { hideInfo(chartInfo, 'chart'); return; }
  var list = pts.slice(0, 8);
  var html = list.map(function (p) { return satBlock(p.sat, 'chart'); }).join('');
  if (pts.length > 8) html += '<div class="si-more">+' + (pts.length - 8) + t('d_more_sat') + '</div>';
  showInfo(chartInfo, 'chart', html, pts[0].sat.idx + ':' + pts.length);
}
// V1.7.2（需求4）：浮窗（图表）—— 鼠标对准的那一颗，永远是单块
function showChartFloat(idx) {
  var s = cur() && cur().sats[idx];
  if (!s) { hideFloat('chart'); return; }
  showFloat('chart', satBlock(s, 'chart'), 'sat' + idx);
}
// V1.7.1（需求7 + 需求2）：点选卫星 → 解除「用户已关闭信息窗」的标记。
//   只有真正改变了选中态（点了另一颗卫星 / 加选 / 取消）才解除，纯 hover 不解除。
function toggleSel(idx, additive) {
  // V1.7.2（需求2④）：**多选状态下点击任何一颗**（不论它是否已在选中集合里）都视为"组内切换" ——
  //   只把 A 窗显示的内容换成这一颗；**被高亮选定的多颗保持不变、其余仍是暗淡光点**。
  //   这是 V1.3.5「聚焦」语义的扩展：旧版只对"已选中的一颗"生效，点未选中的会把选择清空。
  //   ⚠️ 与需求 10 的区别：那条只作用于**卫星表格内**的单击（= 取消全部、单选它），
  //   这里的组内切换服务于图表 / 地图 / 地球上的点击。
  if (S.sel.length > 1 || S.selGroup) {
    S.focusIdx = idx;
    infoClearClosed();          // 用户点了卫星 = 明确的操作意图 → 解除"已关闭信息窗"（需求4 ⑤）
    afterSelection();
    return;
  }
  var i = S.sel.indexOf(idx);
  if (i >= 0) {
    S.sel.splice(i, 1); S.focusIdx = null;           // 只选了一颗时再点 = 取消
  } else if (additive) { S.sel.push(idx); S.focusIdx = idx; }
  else { S.sel = [idx]; S.focusIdx = idx; }
  // V1.7.1（需求7）：**删掉这里的 gotoSatInTable(idx)**。
  //   旧函数用「固定 SAT_PAGE 行/页」算页号，但表格从V1.7.0 起已改为「按实测行高分页」
  //   （measureRowUnits / pageBounds，制造商列换行会让行变高）→ 两套算法页号必然错位，
  //   表现就是「发射记录框选对了，卫星表格却不翻页 / 翻错页」。
  //   现在统一交给 afterSelection() → renderTable({jump:true})，那里用的就是正确的 pageBounds。
  infoClearClosed();
  afterSelection();
}
// V1.7.1（需求7）：gotoSatInTable 已删除 —— 它和 renderTable({jump:true}) 是两套并存的翻页逻辑，
//   而且它用固定 SAT_PAGE 行/页算页号，与 V1.7.0 起的「实测行高分页」不一致 → 页号错位。
//   翻页 + 高亮现在全部由 renderTable({jump:true}) 与 hitTableRow() 负责（见下）。
//   只翻页 + 高亮，不强行滚动页面（免得把正在看的图顶走）。
// 在 renderTable 末尾调用：此时才知道「当前排序下第一个选中项」落在不在本页。
function hitTableRow() {
  if (!S.sel.length || !LAST_ROWS.length) return;
  // 与 renderTable 的 jump 分支同口径：当前排序下的**第一个**选中项（多选时 = 信息窗那颗，
  // 因为 syncSelInfo 取的就是 NORAD 最小的那颗）
  var firstIdx = -1;
  for (var i = 0; i < LAST_ROWS.length; i++) {
    if (S.sel.indexOf(LAST_ROWS[i]._s.idx) >= 0) { firstIdx = LAST_ROWS[i]._s.idx; break; }
  }
  if (firstIdx < 0) return;
  var tr = document.querySelector('#tbody tr[data-idx="' + firstIdx + '"]');
  if (!tr) return;                    // 不在本页（理论上不会，翻页已保证在）
  tr.classList.add('just-hit');
  setTimeout(function () { tr.classList.remove('just-hit'); }, 1500);
}
function clearSel() {
  S.focusIdx = null;                  // V1.7.2（需求2④）：取消选择同时清掉"组内切换"的焦点
  if (!S.sel.length) {
    // V1.7.0（任务12）：即使本就没有选中，也把所有信息窗收掉（换星座后绝对干净）
    [['chart', chartInfo], ['map', document.getElementById('mapInfo')], ['globe', document.getElementById('globeInfo')]]
      .forEach(function (p) { try { hideInfo(p[1], p[0]); } catch (e) {} });
    ['chart', 'map', 'globe'].forEach(function (k) { try { hideFloat(k); } catch (e) {} });
    return;
  }
  S.sel = [];
  // V1.7.0（任务12/14）：取消选中时三个章节的信息窗都要一起收起并复位，
  // 否则换星座/取消选择后会残留上一颗卫星的悬浮窗和拖动位置。
  [['chart', chartInfo], ['map', document.getElementById('mapInfo')], ['globe', document.getElementById('globeInfo')]]
    .forEach(function (p) { try { hideInfo(p[1], p[0]); } catch (e) {} });
  ['chart', 'map', 'globe'].forEach(function (k) { try { hideFloat(k); } catch (e) {} });
  afterSelection();
}
function updateSelClasses() {
  Object.keys(tableRows).forEach(function (k) {
    var tr = tableRows[k];
    if (tr && tr.isConnected !== false) tr.classList.toggle('focused', S.sel.indexOf(+k) >= 0);
  });
}
function renderLegend() {
  var el = document.getElementById('groupLegend');
  var st = cur();
  if (S.colorMode.chart === 'group') {
    el.innerHTML = st.launches.filter(function (L) { return L.sats.length; }).map(function (L) {
      return '<span><i class="sw" style="background:' + L.color + '"></i>' + batchName(L.name) + ' · ' + L.sats.length + '</span>';
    }).join('');
  } else el.innerHTML = '';
}

// ---------------------------------------------------------------- 图 02：地图
var mapCv = document.getElementById('map');
var mapInfo = document.getElementById('mapInfo');
var mapTrackCache = { key: null, tmin: null, data: null };
var mapHover = null;

// V1.4.2：逐颗 try/catch —— 以前是一整圈裸循环，**任何一颗卫星的要素有问题就会让整个函数抛错**，
// 结果整张地图与地球都不再有卫星和轨道（用户报的「Chrome 打开地图上没有卫星和光点」正是这种症状）。
// 现在坏的那颗置空跳过，其余照常画；同时把坏星数记在 S.badSat 上，便于在诊断信息里看到。
function propagateAll(ms) {
  var st = cur(), gmst = SGP4.gstime(new Date(ms));
  var out = new Array(st.sats.length);
  var bad = 0, first = '';
  for (var i = 0; i < st.sats.length; i++) {
    var s = st.sats[i];
    try {
      var pv = SGP4.propagate(s.rec, new Date(ms));
      if (!pv || !pv.position) { out[i] = null; continue; }
      var geo = SGP4.eciToGeodetic(pv.position, gmst);
      out[i] = {
        eci: pv.position, ecf: SGP4.eciToEcf(pv.position, gmst),
        lat: geo.latitude * DEG, lon: geo.longitude * DEG, h: geo.height,
        ux: pv.position.x, uy: pv.position.y, uz: pv.position.z
      };
    } catch (e) {
      out[i] = null; bad++;
      if (!first) first = (s && s.name ? s.name : ('#' + i)) + ': ' + (e && e.message);
    }
  }
  S.badSat = bad; S.badSatFirst = first;
  if (bad) console.warn('SGP4 推算失败 ' + bad + ' 颗，首例 ' + first);
  return out;
}
function wrapLon(lon) { while (lon > 180) lon -= 360; while (lon < -180) lon += 360; return lon; }
function mapTracks(ms) {
  var st = cur();
  var tmin = Math.round(ms / 60000);
  if (mapTrackCache.key === S.key && mapTrackCache.tmin === tmin) return mapTrackCache.data;
  var out = new Array(st.sats.length);
  for (var i = 0; i < st.sats.length; i++) {
    var s = st.sats[i], n = 26, half = s.period / 2;
    var seg = [];
    try {                                        // V1.4.2：单颗坏星只让它的轨迹缺失，不影响其它
      for (var k = 0; k <= n; k++) {
        var t = ms + (k / n * 2 - 1) * half * 60000;
        var pv = SGP4.propagate(s.rec, new Date(t));
        if (!pv || !pv.position) continue;
        var g = SGP4.eciToGeodetic(pv.position, SGP4.gstime(new Date(t)));
        seg.push([g.longitude * DEG, g.latitude * DEG]);
      }
    } catch (e) { seg = []; }
    out[i] = seg;
  }
  mapTrackCache = { key: S.key, tmin: tmin, data: out };
  return out;
}
// ---- 可视覆盖几何 ----
// 卫星对地面的可视覆盖区：地心半角 λ = acos(RE/(RE+h)·cos el) − el（最小仰角 el）
function covLambda(h, elDeg) {
  var el = (elDeg || 0) * RAD;
  var c = RE / (RE + Math.max(1, h)) * Math.cos(el);
  if (c >= 1) return 0;
  return Math.acos(Math.max(-1, Math.min(1, c))) - el;
}
function unitOf(lat, lon) {
  var la = lat * RAD, lo = lon * RAD;
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
}
function centralAngle(u, v) {
  var d = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  return Math.acos(Math.max(-1, Math.min(1, d)));
}
function countVisible(states, lat, lon, el) {
  var u = unitOf(lat, lon), n = 0;
  for (var i = 0; i < states.length; i++) {
    var g = states[i]; if (!g) continue;
    if (centralAngle(u, unitOf(g.lat, g.lon)) <= covLambda(g.h, el)) n++;
  }
  return n;
}
function circlePath(ctx, PX, PY, lat, lon, lam, n) {
  var prevLon = null;
  for (var a = 0; a < CIRC.length; a++) {
    var brg = a / (CIRC.length - 1) * 2 * Math.PI;
    var p = destPoint(lat, lon, brg, lam);
    var w = wrapLon(p[1]), x = PX(w), y = PY(p[0]);
    if (prevLon === null || Math.abs(w - prevLon) > 180) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
    prevLon = w;
  }
}
function drawMap(states, ms) {
  var f = fitCanvas(mapCv), ctx = f.ctx, W = f.w, H = f.h, C = themeColors();
  ctx.clearRect(0, 0, W, H);
  var k = S.mz.k, tx = S.mz.tx, ty = S.mz.ty;
  var fit = mapFit(W, H);
  var PX = function (lon) { return (lon + 180) / 360 * fit.w * k + fit.ox + tx; };
  var PY = function (lat) { return (90 - lat) / 180 * fit.h * k + fit.oy + ty; };
  var st = cur();
  var pickOn = S.pick.on, pickFixed = pickOn && S.pick.fixed;
  var hasSel = S.sel.length > 0;

  // 网格（随缩放加密）
  var gs = k >= 5 ? 5 : k >= 2.5 ? 10 : 30;
  ctx.strokeStyle = C.mapGrid; ctx.lineWidth = 1;
  for (var lon = -180; lon <= 180; lon += gs) {
    var gx = PX(lon); if (gx < -2 || gx > W + 2) continue;
    ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke();
  }
  for (var lat = -90; lat <= 90; lat += gs) {
    var gy = PY(lat); if (gy < -2 || gy > H + 2) continue;
    ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
  }
  ctx.strokeStyle = C.mapFrame;
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  // 海岸线
  ctx.strokeStyle = C.coast; ctx.lineWidth = 1;
  ctx.beginPath();
  for (var i = 0; i < COAST.length; i++) {
    var ln = COAST[i];
    for (var j = 0; j < ln.length; j++) {
      var x = PX(ln[j][0]), y = PY(ln[j][1]);
      if (j === 0) ctx.moveTo(x, y);
      else {
        var pj = ln[j - 1];
        if (Math.abs(ln[j][0] - pj[0]) > 180) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
    }
  }
  ctx.stroke();
  // 可视覆盖区（卫星对地面）。有选中时只画选中那几颗，避免干扰
  // V1.8.0（需求4①）：整层按 TOG.covOn 淡入/淡出（开关画布同步）
  if ((S.cov.on || TOG.covOn > 0.01) && !pickOn) {
    for (var ci = 0; ci < st.sats.length; ci++) {
      if (hasSel && S.sel.indexOf(ci) < 0) continue;
      var g0 = states[ci]; if (!g0) continue;
      var lam0 = covLambda(g0.h, S.cov.el);
      if (lam0 <= 0.002) continue;
      var colC = colOf(st.sats[ci], 'map');
      ctx.beginPath();
      circlePath(ctx, PX, PY, g0.lat, g0.lon, lam0, 40);
      ctx.fillStyle = colC; ctx.globalAlpha = (hasSel ? 0.10 : 0.05) * TOG.covOn; ctx.fill();
      ctx.strokeStyle = colC; ctx.globalAlpha = (hasSel ? 0.55 : 0.32) * TOG.covOn; ctx.lineWidth = 1; ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
  // 轨迹：选中项最后叠加高亮；有选中或关闭「显示轨道」时不画其他卫星轨迹
  var tracks = mapTracks(ms);
  ctx.lineWidth = 1;
  function strokeTrack(si, alpha) {
    var seg = tracks[si]; if (!seg || !seg.length) return;
    ctx.globalAlpha = alpha * TOG.mapTrack;      // V1.8.0（需求4①）：轨道层随开关淡入/淡出
    ctx.strokeStyle = colOf(st.sats[si], 'map');
    ctx.beginPath();
    for (var k2 = 0; k2 < seg.length; k2++) {
      var x2 = PX(seg[k2][0]), y2 = PY(seg[k2][1]);
      if (k2 === 0) ctx.moveTo(x2, y2);
      else if (Math.abs(seg[k2][0] - seg[k2 - 1][0]) > 180) ctx.moveTo(x2, y2);
      else ctx.lineTo(x2, y2);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // V1.7.2 第七轮（需求8a）：**整组绘制都必须服从「显示轨道」开关**。
  //   旧实现的 bug：只有"画全部轨道"那一段被 S.mapTrack 包住，而后面两段
  //   （选中星 0.9 alpha、悬停星 0.75 alpha）是**无条件执行**的 —— 于是关掉开关后，
  //   被选定的卫星和鼠标掠过的卫星仍旧画着自己的轨道。
  //   用户要求的语义与第二章（地球）完全一致：关闭 = 谁都不画（含选中与悬停）；
  //   开启 = 全部 + 选中 + 悬停一起画（各用原来的 alpha）。
  // V1.9.0（需求3，R3 下半根治）：**门禁改用补间系数，而不是布尔值**。
  //   旧写法是 `if (S.mapTrack) { ... }` —— 开关一关，整块绘制被**立刻跳过**，
  //   于是上面 strokeTrack 里那句 `alpha * TOG.mapTrack` 形同虚设：淡出动画根本没机会播，
  //   轨道是"啪"地一下消失的（这正是你反馈"第 1 章轨道开关没有第 2 章那种非线性消失/出现"的真因）。
  //   改成按 TOG.mapTrack（520ms 补间系数）判断后：
  //     · 关 → 系数从 1 平滑降到 0，期间一直在画（alpha 越来越小）= 非线性淡出；
  //     · 开 → 系数从 0 升到 1，第一帧之后即进入绘制并逐渐加浓 = 非线性淡入；
  //     · 补间结束系数为 0 → 跳过整块，**性能与旧版一致**（不白画）。
  if (TOG.mapTrack > 0.001) {
    if (!pickOn && !hasSel) {
      for (var si = 0; si < st.sats.length; si++) strokeTrack(si, 0.3);
    }
    for (var sj = 0; sj < st.sats.length; sj++) {
      if (S.sel.indexOf(sj) >= 0) strokeTrack(sj, 0.9);
    }
    // 悬停/固定的那颗：观测点模式下其他轨迹都隐藏了，这里单独补一条，便于单星跟踪
    if (mapHover !== null && S.sel.indexOf(mapHover) < 0 && (pickOn || hasSel)) strokeTrack(mapHover, 0.75);
  }
  // 卫星
  var labels = [];
  // V1.3.4：先给观测点那三行文字量好位置并占位，卫星标注会主动绕开它
  var siteLabel = null;
  if (pickOn || (PICK_FADE && TOG.pickOn > 0.01)) {
    var site0 = pickOn
      ? (pickFixed ? S.pick
        : (S.pick.mx !== null ? { lat: my2lat(S.pick.my), lon: mx2lon(S.pick.mx) } : null))
      : (PICK_FADE.mx != null ? { lat: my2lat(PICK_FADE.my), lon: mx2lon(PICK_FADE.mx) }
        : { lat: PICK_FADE.lat, lon: PICK_FADE.lon });   // V1.8.0（需求4③）：退出时用最后位置把标签一起淡出
    if (site0 && site0.lat >= -90 && site0.lat <= 90) {
      var visN0 = countVisible(states, site0.lat, site0.lon, S.pick.el);
      var lines0 = [
        (pickFixed ? t('d_fixed_hint_1') : t('d_site') + ' ') + site0.lat.toFixed(1) + '°, ' + site0.lon.toFixed(1) + '°',
        (LANG === 'en' ? 'Elev ≥ ' : '仰角 ≥ ') + S.pick.el.toFixed(1) + '°',
        t('d_visible') + ' ' + visN0 + (LANG === 'en' ? '' : ' 颗')
      ];
      ctx.font = '10px ' + MONO;
      var mw0 = 0;
      lines0.forEach(function (s2) { mw0 = Math.max(mw0, ctx.measureText(s2).width); });
      var ox0 = PX(wrapLon(site0.lon)), oy0 = PY(site0.lat);
      var flip0 = (W - (ox0 + 10)) < mw0 && (ox0 - 10) > (W - (ox0 + 10));
      var dy0 = oy0 - 6;
      if (dy0 + 34 > H) dy0 = Math.max(12, H - 40);
      if (dy0 - 12 < 0) dy0 = 16;
      var tx0 = flip0 ? ox0 - 10 : ox0 + 10;
      siteLabel = { lines: lines0, flip: flip0, tx: tx0, dy: dy0 };
      labels.push([flip0 ? tx0 - mw0 : tx0, dy0 - 8, mw0, 44]);
    }
  }
  for (var m = 0; m < st.sats.length; m++) {
    var g = states[m]; if (!g) continue;
    var sv = st.sats[m], sel2 = S.sel.indexOf(m) >= 0;
    var visHi = pickFixed && !sel2 &&
      centralAngle(unitOf(S.pick.lat, S.pick.lon), unitOf(g.lat, g.lon)) <= covLambda(g.h, S.pick.el);
    // 有选中时其余卫星暗淡；观测点模式下同样暗淡
    var dimmed = (hasSel && !sel2) || (pickOn && !sel2 && !visHi);
    var x3 = PX(g.lon), y3 = PY(g.lat);
    if (x3 < -20 || x3 > W + 20 || y3 < -20 || y3 > H + 20) continue;
    ctx.globalAlpha = dimmed ? 0.18 : 1;
    if (sel2 || mapHover === m || visHi) {
      ctx.beginPath(); ctx.arc(x3, y3, 8, 0, 6.2832); ctx.fillStyle = C.sel; ctx.fill();
    }
    ctx.beginPath(); ctx.arc(x3, y3, sel2 ? 4.4 : 2.8, 0, 6.2832);
    ctx.fillStyle = colOf(sv, 'map'); ctx.fill();
    if (sel2 || visHi) { ctx.lineWidth = 1.4; ctx.strokeStyle = C.fg; ctx.stroke(); }
    ctx.globalAlpha = 1;
    // V1.7.2 第七轮（需求8b）：**开关提到最外层** —— 旧写法把 sel2（已选中）放在最前，
    //   而 || 是短路的，于是"选中了卫星"以后无论开关是开是关，标签都会显示（关不掉）。
    //   现在：开关关 = 谁都不显示（含选中星与悬停星）；开关开 = 按原有细分规则显示
    //   （选中星、悬停星、观测点可见星；无选中时显示全部）。
    var showLabel = (S.names.map || TOG.nameMap > 0.01) && (sel2 || mapHover === m || visHi || (!pickOn && !hasSel));
    if (showLabel) {
      var lb = cnName(sv);
      ctx.font = '10px ' + MONO;
      var tw = ctx.measureText(lb).width;
      // V1.3.4：八个候选位（右→左→上→下→四个斜角）依次试，取第一个完全不重叠的；
      // 全都撞就取重叠面积最小的那个 —— 缩放、平移时标注始终错开
      var cands = [
        [x3 + 6, y3 - 6], [x3 - 6 - tw, y3 - 6], [x3 - tw / 2, y3 - 15], [x3 - tw / 2, y3 + 9],
        [x3 + 6, y3 - 16], [x3 + 6, y3 + 4], [x3 - 6 - tw, y3 - 16], [x3 - 6 - tw, y3 + 4]
      ];
      var best2 = null, bestOv = Infinity;
      for (var c = 0; c < cands.length; c++) {
        var bx = [cands[c][0], cands[c][1], tw, 12];
        if (bx[0] < 2 || bx[0] + tw > W - 2 || bx[1] < 2 || bx[1] + 12 > H - 2) continue;
        var ov = 0;
        for (var q = 0; q < labels.length; q++) {
          var b2 = labels[q];
          var ox2 = Math.min(bx[0] + bx[2], b2[0] + b2[2]) - Math.max(bx[0], b2[0]);
          var oy2 = Math.min(bx[1] + bx[3], b2[1] + b2[3]) - Math.max(bx[1], b2[1]);
          if (ox2 > 0 && oy2 > 0) ov += ox2 * oy2;
        }
        if (ov === 0) { best2 = bx; bestOv = 0; break; }
        if (ov < bestOv) { bestOv = ov; best2 = bx; }
      }
      if (best2) {
        labels.push(best2);
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.globalAlpha = TOG.nameMap;          // V1.8.0（需求4①）：标注随开关淡入/淡出
        ctx.fillStyle = C.fg; ctx.fillText(lb, best2[0], best2[1] + 6);
        ctx.globalAlpha = 1;
      }
    }
  }
  // 观测点（跟随鼠标 / 固定）
  // V1.8.0（需求4③）：进出观测点模式时整个标记淡入/淡出 —— 退出时先用 PICK_FADE 留住最后位置，
  //   等 520ms 淡出跑完再丢掉（否则标记会"啪"地消失）。
  var pickAlpha = TOG.pickOn;
  var pickSrc = pickOn ? S.pick : (PICK_FADE || null);
  if (pickSrc && pickAlpha > 0.01) {
    var site = (pickOn ? pickFixed : true) ? pickSrc
      : (pickSrc.mx !== null && pickSrc.mx !== undefined ? { lat: my2lat(pickSrc.my), lon: mx2lon(pickSrc.mx) } : null);
    if (site && site.lat >= -90 && site.lat <= 90) {
      var lamS = covLambda(cur().avgAlt, pickSrc.el || S.pick.el);
      var ox = PX(wrapLon(site.lon)), oy = PY(site.lat);
      if (lamS > 0.002) {
        ctx.beginPath();
        circlePath(ctx, PX, PY, site.lat, site.lon, lamS, 72);
        // V1.7.0 第三轮（需求2）：内部填充与虚线框统一用星座主题色（此前填充用 C.sel，颜色不一致）
        ctx.fillStyle = C.theme; ctx.globalAlpha = 0.12 * pickAlpha; ctx.fill();
        // 虚线框用星座主题色（星网红 / 千帆蓝）
        ctx.strokeStyle = C.theme; ctx.globalAlpha = 0.9 * pickAlpha; ctx.setLineDash([5, 3]);
        ctx.lineWidth = 1.2; ctx.stroke(); ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
      ctx.globalAlpha = pickAlpha;
      ctx.beginPath(); ctx.arc(ox, oy, pickOn && pickFixed ? 5 : 4, 0, 6.2832);
      ctx.fillStyle = C.theme; ctx.fill();
      if (pickOn && pickFixed) { ctx.lineWidth = 1.6; ctx.strokeStyle = C.fg; ctx.stroke(); }
      // 观测点信息：三行（观测点 / 最低仰角 / 可见卫星数），位置在前面已算好并占位
      if (siteLabel) {
        ctx.font = '10px ' + MONO;
        ctx.textAlign = siteLabel.flip ? 'right' : 'left';
        ctx.fillStyle = C.theme;
        siteLabel.lines.forEach(function (s2, i2) { ctx.fillText(s2, siteLabel.tx, siteLabel.dy + i2 * 13); });
      }
      ctx.globalAlpha = 1;
    }
  }
}
function destPoint(lat, lon, brg, d) {
  var la1 = lat * RAD, lo1 = lon * RAD;
  var la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(brg));
  var lo2 = lo1 + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
  return [la2 * DEG, lo2 * DEG];
}

// ---------------------------------------------------------------- 图 03：地球
var globeCv = document.getElementById('globe');
var globeInfo = document.getElementById('globeInfo');
var globeTrackCache = { key: null, tmin: null, data: null };
var G = { yaw: 100 * RAD, pitch: 22 * RAD, zoom: 1, dragging: false, lx: 0, ly: 0, hover: null };
var globeDragMoved = 0;
// 基准半径：留出 1.27 倍（最高轨道）的卫星环空间，避免上下被画布裁掉
function globeBaseR(w, h) { return Math.min(w * 0.30, h * 0.369); }

function globeBasis() {
  var cy = Math.cos(G.yaw), sy = Math.sin(G.yaw), cp = Math.cos(G.pitch), sp = Math.sin(G.pitch);
  return {
    view: [cp * cy, cp * sy, sp],
    right: [-sy, cy, 0],
    up: [-sp * cy, -sp * sy, cp]
  };
}
function project(p, B, cx, cy, R) {
  var dx = p[0] * B.right[0] + p[1] * B.right[1] + p[2] * B.right[2];
  var dy = p[0] * B.up[0] + p[1] * B.up[1] + p[2] * B.up[2];
  var dz = p[0] * B.view[0] + p[1] * B.view[1] + p[2] * B.view[2];
  return { x: cx + dx * R, y: cy - dy * R, z: dz };
}
function globeTracks(ms) {
  var st = cur(), tmin = Math.round(ms / 60000);
  if (globeTrackCache.key === S.key && globeTrackCache.tmin === tmin) return globeTrackCache.data;
  var out = new Array(st.sats.length);
  for (var i = 0; i < st.sats.length; i++) {
    var s = st.sats[i], n = 56, seg = [];
    try {                                        // V1.4.2：单颗坏星只丢它的轨道圈
    for (var k = 0; k <= n; k++) {
      var t = ms + k / n * s.period * 60000;
      var pv = SGP4.propagate(s.rec, new Date(t));
      if (!pv || !pv.position) continue;
      var r = pv.position, rr = Math.sqrt(r.x * r.x + r.y * r.y + r.z * r.z);
      var kk = globeRad(rr);                 // 高度夸张，便于区分轨道壳层
      // 关键：轨道圈必须和卫星点、海岸线一样画在【地固系(ECF)】里。
      // 之前直接用 ECI 单位向量，两者相差一个地球自转角，亮点就永远不在轨道圈上。
      var ecf = SGP4.eciToEcf(r, SGP4.gstime(new Date(t)));
      seg.push([ecf.x / rr * kk, ecf.y / rr * kk, ecf.z / rr * kk]);
    }
    } catch (e) { seg = []; }
    out[i] = seg;
  }
  globeTrackCache = { key: S.key, tmin: tmin, data: out };
  return out;
}
function drawGlobe(states, ms) {
  var f = fitCanvas(globeCv), ctx = f.ctx, W = f.w, H = f.h, C = themeColors();
  ctx.clearRect(0, 0, W, H);
  var cx = W / 2, cy = H / 2, R = globeRadNow();
  var B = globeBasis();
  // 球体
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832);
  ctx.fillStyle = C.globeFill; ctx.fill();
  ctx.strokeStyle = C.globeEdge; ctx.lineWidth = 1; ctx.stroke();
  // 经纬网（预计算单位向量，投影只做点积）
  ctx.strokeStyle = C.mapGrid; ctx.lineWidth = 1;
  var gi, gj, gs1;
  for (gi = 0; gi < GRID_LINES.length; gi++) {
    var gl = GRID_LINES[gi], gp = gl.p;
    ctx.beginPath(); var started = false;
    for (gj = 0; gj < gl.n; gj++) {
      var dx1 = gp[gj * 3] * B.right[0] + gp[gj * 3 + 1] * B.right[1] + gp[gj * 3 + 2] * B.right[2];
      var dy1 = gp[gj * 3] * B.up[0] + gp[gj * 3 + 1] * B.up[1] + gp[gj * 3 + 2] * B.up[2];
      var dz1 = gp[gj * 3] * B.view[0] + gp[gj * 3 + 1] * B.view[1] + gp[gj * 3 + 2] * B.view[2];
      if (dz1 <= 0) { started = false; continue; }
      gs1 = { x: cx + dx1 * R, y: cy - dy1 * R };
      if (!started) { ctx.moveTo(gs1.x, gs1.y); started = true; } else ctx.lineTo(gs1.x, gs1.y);
    }
    ctx.stroke();
  }
  // 海岸线（同样走预计算单位向量）
  ctx.strokeStyle = C.coastG; ctx.lineWidth = 1;
  ctx.beginPath();
  for (gi = 0; gi < COAST_UV.length; gi++) {
    var cl = COAST_UV[gi], cp = cl.p, started2 = false;
    for (gj = 0; gj < cl.n; gj++) {
      var dx3 = cp[gj * 3] * B.right[0] + cp[gj * 3 + 1] * B.right[1] + cp[gj * 3 + 2] * B.right[2];
      var dy3 = cp[gj * 3] * B.up[0] + cp[gj * 3 + 1] * B.up[1] + cp[gj * 3 + 2] * B.up[2];
      var dz3 = cp[gj * 3] * B.view[0] + cp[gj * 3 + 1] * B.view[1] + cp[gj * 3 + 2] * B.view[2];
      if (dz3 <= 0) { started2 = false; continue; }
      var gs3 = { x: cx + dx3 * R, y: cy - dy3 * R };
      if (!started2) { ctx.moveTo(gs3.x, gs3.y); started2 = true; } else ctx.lineTo(gs3.x, gs3.y);
    }
  }
  ctx.stroke();
  var hasSelG = S.sel.length > 0;
  var hasSelG = S.sel.length > 0;
  // 可视锥：有选中时只画选中卫星的覆盖圈（与地图一致）
  // V1.8.0（需求4①）：整层按 TOG.coneOn 淡入/淡出
  if (S.cone.on || TOG.coneOn > 0.01) {
    var stq = cur();
    for (var cq = 0; cq < stq.sats.length; cq++) {
      if (hasSelG && S.sel.indexOf(cq) < 0) continue;
      var gq = states[cq]; if (!gq) continue;
      var lamq = covLambda(gq.h, S.cone.el);
      if (lamq <= 0.004) continue;
      var uq = unitOf(gq.lat, gq.lon);
      var colq = colOf(stq.sats[cq], 'globe');
      var e1 = [-Math.sin(gq.lon * RAD), Math.cos(gq.lon * RAD), 0];
      var nv = [-Math.sin(gq.lat * RAD) * Math.cos(gq.lon * RAD),
                -Math.sin(gq.lat * RAD) * Math.sin(gq.lon * RAD),
                Math.cos(gq.lat * RAD)];
      var clq = Math.cos(lamq), slq = Math.sin(lamq);
      var dotv = uq[0] * B.view[0] + uq[1] * B.view[1] + uq[2] * B.view[2];
      var fullyFront = dotv >= Math.sin(lamq);   // 整圈都在正面才填充
      ctx.beginPath();
      var started3 = false;
      for (var aq = 0; aq < CIRC.length; aq++) {
        var caq = CIRC[aq][0], saq = CIRC[aq][1];
        var pq = [uq[0] * clq + (e1[0] * caq + nv[0] * saq) * slq,
                  uq[1] * clq + (e1[1] * caq + nv[1] * saq) * slq,
                  uq[2] * clq + (e1[2] * caq + nv[2] * saq) * slq];
        var prq = project(pq, B, cx, cy, R);
        if (prq.z <= 0) { started3 = false; continue; }
        if (!started3) { ctx.moveTo(prq.x, prq.y); started3 = true; } else ctx.lineTo(prq.x, prq.y);
      }
      if (fullyFront) { ctx.globalAlpha = 0.06 * TOG.coneOn; ctx.fillStyle = colq; ctx.fill(); }
      ctx.globalAlpha = 0.30 * TOG.coneOn; ctx.strokeStyle = colq; ctx.lineWidth = 1; ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
  // 轨道：有选中时只画选中的轨道，其余卫星不画
  // V1.8.0（需求4①）：OR 上 TOG 系数 → 关掉开关时整层淡出，而不是瞬间消失
  if (S.showTracks || TOG.showTracks > 0.01) {
    var tracks = globeTracks(ms), stt = cur();
    ctx.lineWidth = 1;
    for (var si = 0; si < stt.sats.length; si++) {
      var sAt0 = stt.sats[si], sel0 = S.sel.indexOf(si) >= 0;
      if (hasSelG && !sel0) continue;
      var sg = tracks[si]; if (!sg || !sg.length) continue;
      var sAt = sAt0, sel3 = sel0;
      ctx.strokeStyle = colOf(sAt, 'globe');
      // 分正面 / 背面两段，背面画得更淡
      var segs = [], curSeg = null, curZ = null;
      for (var k2 = 0; k2 < sg.length; k2++) {
        var pr = project(sg[k2], B, cx, cy, R);
        var zf = pr.z > 0;
        if (curZ === null || zf !== curZ) { curSeg = { z: zf, p: [] }; segs.push(curSeg); curZ = zf; }
        curSeg.p.push(pr);
      }
      segs.forEach(function (sg2) {
        ctx.globalAlpha = (sel3 ? (sg2.z ? 0.95 : 0.32) : (sg2.z ? 0.34 : 0.12)) * TOG.showTracks;   // V1.8.0（需求4①）
        ctx.beginPath();
        for (var i2 = 0; i2 < sg2.p.length; i2++) {
          if (i2 === 0) ctx.moveTo(sg2.p[i2].x, sg2.p[i2].y); else ctx.lineTo(sg2.p[i2].x, sg2.p[i2].y);
        }
        ctx.stroke();
      });
    }
    ctx.globalAlpha = 1;
  }
  // 卫星（半径按夸张系数显示，轨道壳层一眼分得开）
  var st = cur(), labels = [];
  for (var m = 0; m < st.sats.length; m++) {
    var g = states[m]; if (!g) continue;
    var rr2 = Math.sqrt(g.ux * g.ux + g.uy * g.uy + g.uz * g.uz);
    var ecf = g.ecf, k3 = globeRad(rr2);
    var v4 = [ecf.x / rr2 * k3, ecf.y / rr2 * k3, ecf.z / rr2 * k3];
    var pr2 = project(v4, B, cx, cy, R);
    var hidden = false;
    if (pr2.z < 0) {
      var ddx = (pr2.x - cx) / R, ddy = (pr2.y - cy) / R;
      if (ddx * ddx + ddy * ddy < 0.995) hidden = true;
    }
    var sv = st.sats[m], sel4 = S.sel.indexOf(m) >= 0;
    ctx.globalAlpha = hidden ? 0.12 : ((hasSelG && !sel4) ? 0.14 : 1);
    if (sel4 || G.hover === m) { ctx.beginPath(); ctx.arc(pr2.x, pr2.y, 8, 0, 6.2832); ctx.fillStyle = C.sel; ctx.fill(); }
    ctx.beginPath(); ctx.arc(pr2.x, pr2.y, sel4 ? 4.4 : 2.8, 0, 6.2832);
    ctx.fillStyle = colOf(sv, 'globe'); ctx.fill();
    if (sel4) { ctx.lineWidth = 1.4; ctx.strokeStyle = C.fg; ctx.stroke(); }
    ctx.globalAlpha = 1;
    // V1.7.2 第七轮（需求8b）：同地图 —— 开关提到最外层，选中态也受它管辖
    if (!hidden && (S.names.globe || TOG.nameGlobe > 0.01) && (sel4 || G.hover === m || !hasSelG)) {
      var lb = cnName(sv);
      ctx.font = '10px ' + MONO;
      var tw = ctx.measureText(lb).width;
      var box = [pr2.x + 6, pr2.y - 6, tw, 12], hit = false;
      for (var q = 0; q < labels.length; q++) {
        var bb = labels[q];
        if (box[0] < bb[0] + bb[2] && box[0] + box[2] > bb[0] && box[1] < bb[1] + bb[3] && box[1] + box[3] > bb[1]) { hit = true; break; }
      }
      if (!hit && pr2.x + 6 + tw < W) {
        labels.push(box);
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.globalAlpha = TOG.nameGlobe;        // V1.8.0（需求4①）：标注随开关淡入/淡出
        ctx.fillStyle = C.fg; ctx.fillText(lb, pr2.x + 6, pr2.y);
        ctx.globalAlpha = 1;
      }
    }
  }
}

// ---------------------------------------------------------------- 表 04
var tbody = document.getElementById('tbody');
var tableRows = {};
// V1.9.0（翻页等高根治）：SAT_PAGE 的单位从「标准单行数」改成「**1/4 行**」——
//   10 个标准行 = 40 个 1/4 行格。配合 measureRowUnits 的 ceil，任何一页总高都不会超过
//   10 × 41 = 410px，放不满的差额由下方留白补齐 → **翻页控件位置恒定**。
var SAT_PAGE = 40;
function ageText(ms0) {
  if (!isFinite(ms0)) return '—';
  var now = new Date();
  var days = Math.floor((now.getTime() - ms0) / DAY);
  var d = new Date(ms0);
  var y = now.getFullYear() - d.getFullYear(), m = now.getMonth() - d.getMonth(), dd = now.getDate() - d.getDate();
  if (dd < 0) { m--; dd += new Date(now.getFullYear(), now.getMonth(), 0).getDate(); }
  if (m < 0) { y--; m += 12; }
  var inner = pad(y) + 'y' + pad(m) + 'm' + pad(dd) + 'd';
  return days + 'd' + (LANG === 'en' ? ' (' + inner + ')' : '（' + inner + '）');
}
function tableVals(s) {
  var b = S.model === 'brouwer';
  var L = s.launch;
  var mkRow = makerOf(s);
  return {
    name: cnName(s), norad: s.norad, launch: L.name,
    // V1.9.1（1.4-D）：「在轨状态」列 —— 0=在轨 / 1=已再入（排序用数值：在轨排前面）。
    //   已再入的卫星在 mkdata 里带了 `st:'r'` 与 `dt`（再入日期，来自 satcat 的 DECAY_DATE）。
    status: s.st === 'r' ? 1 : 0, gone: s.st === 'r', deadOn: s.dt || '',
    // V1.8.0（需求12）：卫星表格新增「发射时间 (GMT+8)」列 —— 值取本批发射时刻（已是北京时间），
    //   排序用毫秒值（ltime），显示用 lstr；元数据缺失的批次（无台账）显示「—」。
    ltime: L.dateMs || 0, lstr: L.dateStr && L.dateStr !== '—' ? L.dateStr.replace('T', ' ') : '—',
    maker: mkRow ? mkRow.items.map(function (x) { return (LANG === 'en' && x.en) ? x.en : x.zh; }).join(' ') : '',  // V1.4.2/4.3：制造方（供排序/搜索）
    sma: b ? s.smaB : s.smaK, hp: b ? s.hpB : s.hpK, ha: b ? s.haB : s.haK,
    inc: s.inc, period: s.period, age: L.dateMs || -1,
    raan: s.raan0, ecc: s.ecc, bstar: s.bstar, epoch: s.epochMs,
    // 混合搜索用：中英卫星名、目录名、NORAD、批次名（中英）、COSPAR、在轨状态
    //   （V1.9.1 / 1.4-D：把"已再入"也纳入搜索 —— 用户口径是"已再入的不可联动但可搜索"）
    q: [s.name, nameVariants(s), String(s.norad),
        L.name, batchVariants(L.name), s.cospar,
        s.st === 'r' ? (t('st_gone') + ' ' + t('t_status')) : t('st_orbit'),
        mkRow ? mkRow.items.map(function (x) { return x.zh + ' ' + x.en + ' ' + x.full; }).join(' ') : '',
        mkRow ? mkRow.full : ''].join(' ').toLowerCase(),
    _s: s
  };
}
var LAST_ROWS = [];                    // V1.3.7：图→表联动要用「当前排序/筛选后的行序」
// ---------------------------------------------------------------- V1.4.2：制造方（研发机构）
// 数据来自卫星百科词条表格（见 mkmaker.mjs），按 COSPAR / 发射日期匹配到每个发射批次。
// 词条里写的是全称，这里统一收成简称；点简称跳词条对应机构页。
var MAKER_SHORT = [
  // 正则（匹配词条全称）             中文简称        英文缩写（英文界面用；空串 = 暂无通用缩写，保持中文）
  [/微小卫星创新研究院|上海微小卫星工程中心|微小卫星/, '上海微小', 'Microsat'],
  [/格思航天|格斯航天|格思/, '格思航天', 'Genesat'],
  [/五院|中国空间技术研究院/, '航天五院', 'CAST'],
  [/八院|上海航天技术研究院/, '航天八院', 'SAST'],
  [/二院|中国运载火箭技术研究院/, '航天二院', 'Acad. 2nd, CASIC'],
  [/银河航天/, '银河航天', 'Galaxy Space'],
  [/长光卫星|长光/, '长光卫星', 'ChangGuang'],
  [/微纳星空/, '微纳星空', 'Mino Space'],
  [/中国商业卫星|中国商星/, '中国商星', 'CACS'],
  [/工大卫星|哈工大/, '工大卫星', 'HIT Satellite'],
  [/北京邮电/, '北京邮电', 'BUPT'],
  [/中国电科|电子科学研究院|电科院/, '中国电科', 'CETC'],
  [/氦星光联/, '氦星光联', 'Histarlink'],
  [/鸿擎/, '鸿擎科技', 'HongQing Tech'],
  [/垣信/, '垣信科技', 'SpaceSail'],
];
// 把词条那一格拆成机构列表：{ zh: 中文简称, en: 英文缩写, full: 词条原文 }
// 表格里每行最多两个、行内居中；英文界面显示英文缩写（没给缩写的机构保持中文，不编造）。
function makerShortList(raw) {
  if (!raw) return [];
  var seen = {};
  return raw.split(/[、,，\/]/).map(function (one) {
    var n = one.trim().replace(/[（(][^)）]*[)）]/g, '');   // 去掉「（1颗）」这类注记
    if (!n) return '';
    var zh = n, en = '';
    var hitRule = null;
    for (var i = 0; i < MAKER_SHORT.length; i++) {
      if (MAKER_SHORT[i][0].test(n)) { hitRule = MAKER_SHORT[i]; break; }
    }
    if (hitRule) { zh = hitRule[1]; en = hitRule[2]; }
    else {
      zh = n.replace(/(有限责任公司|有限公司|股份有限公司|公司|研究院|集团)$/, '') || n;
    }
    if (seen[zh]) return '';
    seen[zh] = 1;
    return { zh: zh, en: en || zh, full: n };
  }).filter(Boolean);
}
// 每个机构各自找自己的词条链接：mokers 数据里现在带 ls（词条里这一格挂的所有 <a>），
// 按机构全称互相包含来配对 —— 此前整格只有第一个机构有链接，其余都是纯文本。
function makerOf(s) {
  var m = cur().makers && cur().makers[s.lk];
  if (!m || !m.m) return null;
  var ls = m.ls || [];
  var items = makerShortList(m.m).map(function (it) {
    var u = '';
    for (var i = 0; i < ls.length; i++) {
      if (ls[i].n && (ls[i].n.indexOf(it.full) >= 0 || it.full.indexOf(ls[i].n) >= 0)) { u = ls[i].u; break; }
    }
    return { zh: it.zh, en: it.en, full: it.full, url: u ? ('https://sat.huijiwiki.com' + u) : '' };
  });
  return { items: items, full: m.m };
}
// 制造方那一格：全部列出；每行最多两个、行内居中（1 个 → 居中；3 个 → 2+1；5 个 → 2+2+1）。
// 有词条链接的机构用主题色 + 下划线，没有的保持纯文本。
function makerCell(s) {
  var mk = makerOf(s);
  if (!mk || !mk.items.length) return '';
  var cells = mk.items.map(function (it) {
    var name = (LANG === 'en' && it.en) ? it.en : it.zh;
    return it.url
      ? '<a class="maker-link" href="' + it.url + '" target="_blank" rel="noopener" title="' + it.full + '">' + name + '</a>'
      : '<span title="' + it.full + '">' + name + '</span>';
  });
  var lines = [];
  for (var i = 0; i < cells.length; i += 2) lines.push(cells.slice(i, i + 2));
  return lines.map(function (ln) { return '<span class="maker-line">' + ln.join('') + '</span>'; }).join('');
}

// V1.4.0：把卫星表格的行模板抽成函数 —— 表格渲染与「导出多页/全页」共用同一套 HTML，
// 导出其它页时不必真的翻页渲染（避免闪屏）。
function satRowHtml(r) {
  var s = r._s, sel = S.sel.indexOf(s.idx) >= 0;
  // V1.9.0（需求9b）：**不属于任何批次/组**的卫星 —— 判据（用户口径）：
  //   ① 它所在的那次发射**只送了 1 颗**（单星发射，谈不上"批次/组"）；
  //   ② 这次发射在卫星百科里查不到元数据（L.name 回落成 COSPAR 前缀）—— 给未来"不明归属"的卫星兜底。
  //   这类卫星的「批次/组」列显示为**居中、加粗、无下划线**的「−」(U+2212)，且不再是可点链接。
  //   注：s.launch 就是 build() 里挂上去的发射对象（含 count / sats / key / name）。
  var L = s.launch;
  var lone = !L ||
    (L.name && L.key && L.name === L.key) ||
    ((L.count > 0 ? L.count : (L.sats ? L.sats.length : 0)) <= 1);
  // V1.3.6：卫星名染主题色 + 下划线，点击跳到 satcat.com 的对应条目（按 NORAD 编号）
  // V1.9.1（1.4-D）：已再入的整行加 `.gone` 类（供样式与联动控制识别）。
  return '<tr data-idx="' + s.idx + '" class="' + (sel ? 'focused' : '') + (r.gone ? ' gone' : '') + '">' +
    '<td class="lname"><span class="swatch" style="background:' + colOf(s, 'chart') + ';margin-right:6px"></span>' +
    '<a class="sat-link" href="' + SATCAT(r.norad) + '" target="_blank" rel="noopener" title="Satcat · ' + r.norad + '">' + r.name + '</a></td>' +
    '<td>' + r.norad + '</td>' +
    // V1.9.1（1.4-D）：「在轨状态」列 —— 在轨绿 / 已再入红（带再入日期 tooltip）
    '<td class="stcell ' + (r.gone ? 'st-gone' : 'st-orbit') + '"' +
      (r.gone && r.deadOn ? ' title="' + t('st_gone_tip') + r.deadOn + '"' : '') + '>' +
      (r.gone ? t('st_gone') : t('st_orbit')) + '</td>' +
    '<td>' + (lone
      ? '<span class="batch-none">\u2212</span>'
      : '<span class="batch-link" data-lk="' + s.lk + '" title="' + t('d_sel_group') + '">' + batchName(r.launch) + '</span>') + '</td>' +
    '<td class="ltime">' + r.lstr + '</td>' +
    '<td class="maker">' + makerCell(s) + '</td>' +
    '<td>' + fmtNum(r.sma, 1) + '</td>' +
    '<td>' + fmtNum(r.hp, 1) + '</td>' +
    '<td>' + fmtNum(r.ha, 1) + '</td>' +
    '<td>' + fmtNum(r.inc, 2) + '</td>' +
    '<td>' + fmtNum(r.period, 3) + '</td>' +
    '<td>' + ageText(r.age < 0 ? NaN : r.age) + '</td>' +
    '<td class="extra">' + fmtNum(r.raan, 2) + '</td>' +
    '<td class="extra">' + r.ecc.toExponential(2) + '</td>' +
    '<td class="extra">' + r.bstar.toExponential(2) + '</td>' +
    '<td>' + fmtUTC(r.epoch) + '</td></tr>';
}
var LAST_LAUNCH_ROWS = [];              // V1.4.0：发射历史的全量行（导出多页/全页用）
// V1.8.0（需求12 / Q6）：任务结果标签。口径 = 卫星百科的记载（逐次发射的结果来自
//   「引导页:发射记录/<年>」，构建期由 scripts/fetch_launch_results.mjs 抓取并合进 launches[k][5]）。
//   ok=成功 / part=部分成功 / fail=失败 / '?'=百科没写结果 / 空=没有这一发的记录 → 显示「—」（不猜）。
function resTag(L) {
  var r = L && L.res;
  if (r === 'ok') return '<span class="res res-ok">' + t('res_ok') + '</span>';
  if (r === 'part') return '<span class="res res-part">' + t('res_part') + '</span>';
  if (r === 'fail') return '<span class="res res-fail">' + t('res_fail') + '</span>';
  return '<span class="res res-none">—</span>';
}
function launchRowHtml(L) {
  var pend = L.pending > 0;
  // V1.7.0 二轮（需求2）：编目不全的批次 → 选中时用**淡黄色**框选（判据全部来自数据，随数据自动更新）。
  //   L.count       = 该批入轨载荷总数（launchCounts.n）
  //   L.pending     = 待编目颗数；> 0 即 "NORAD 编目 < 卫星百科记载" → 编目不全
  //   L.sats.length = 当前已编目（有 TLE）的颗数
  // 行类：pend-part（有部分已编目，点选时全选这些已编目卫星）、pend-none（一颗都没编目，什么都不选）。
  var catalogued = (L.sats && L.sats.length) || 0;
  var pendClass = pend ? (catalogued > 0 ? ' pend-part' : ' pend-none') : '';
  var rocket = L.rseg && L.rseg.length
    ? L.rseg.map(linkHtml).join(' <span class="sep">/</span> ')
    : linkHtml({ t: L.rocket });
  var site = L.slink ? linkHtml(L.slink) : linkHtml({ t: L.site });
  var selLk = {};
  S.sel.forEach(function (i) { var s = cur().sats[i]; if (s) selLk[s.lk] = 1; });
  // V1.3.6：列序 批次/组 | 运载火箭(后跟 COSPAR) | 发射时间 | 发射地点 | 设计倾角 | 轨道要素
  return '<tr class="' + ((selLk[L.key] || S.selGroup === L.key) ? 'focused' : '') + pendClass + '" data-lk="' + L.key + '"><td class="lname"><span class="batch-link" data-lk="' + L.key + '" title="' +
    t('d_sel_group') + '">' + batchName(L.name) + '</span></td>' +
    '<td class="rk">' + rocket + ' <span class="tag">' + L.cospar + '</span></td>' +
    '<td' + (pend ? ' class="pend"' : '') + '>' + L.dateStr.replace('T', ' ') + '</td>' +
    '<td class="site">' + site + '</td><td>' + L.inc.toFixed(1) + '°</td>' +
    '<td>' + ((L.count || L.sats.length) ? (L.count || L.sats.length) + (LANG === 'en' ? ' sats' : ' 颗') : '') +
    (pend ? ' <span class="tag"' + (L.pinfo ? ' title="' + pendTitle(L.pinfo) + '"' : '') +
      '>' + t('d_pending_tag') + L.pending + '</span>' : '') +
    '</td>' +
    '<td class="lres">' + resTag(L) + '</td></tr>';
}
// V1.7.0（任务1）：实测每一行的真实像素高 → 换算成「行单元」（1 单元 = 41px 单行基准）。
// 做法：把当前表里已有的一个 tbody 克隆出来做「离屏量尺」，逐行渲染再量高。
// 返回 function(r) → 单元数；供 pageBounds / pageCount 使用。
var _rowUnitCache = { sig: '', map: null };
function measureRowUnits(rows) {
  var tbl = document.getElementById('satTable');
  // 量尺只依赖「列宽」，而列宽由表格结构决定；用当前表格做一次克隆即可。
  var sig = rows.length + '|' + (tbl ? Math.round(tbl.getBoundingClientRect().width) : 0) + '|' + LANG;
  if (_rowUnitCache.sig === sig && _rowUnitCache.map) return function (r) { return _rowUnitCache.map[r._s.idx] || 1; };
  var map = {};
  try {
    var box = document.createElement('div');
    box.style.cssText = 'position:absolute;left:-99999px;top:0;visibility:hidden;';
    var clone = tbl.cloneNode(false);         // 只克隆 <table> 属性，含 class/样式
    var tb = document.createElement('tbody');
    clone.appendChild(tb);
    box.appendChild(clone);
    document.body.appendChild(box);
    // 逐行渲染、逐行量高（批量挂载后一次量完，减少重排）
    tb.innerHTML = rows.map(satRowHtml).join('');
    var trs = tb.children;
    var STD = 41;
    // V1.9.0（翻页等高根治）：**这里原本是 Math.round(h / STD)，就是"多行制造商的那页被顶高"的病根** ——
    //   双行制造商的行高约 58px，58 / 41 = 1.41 → round 成 **1** 个单元，于是 10 行这样的行照样被当成
    //   10 个"标准单行"，整页 580px 远超 10 × 41 = 410px 的预留高度，翻页控件因此被顶下去。
    //   现在两点一起改：
    //   ① 改成 **ceil**（宁可多算，绝不少算）—— 任何一页的总高都不会超过 410px；
    //   ② 单元粒度从「1 行」细化到「1/4 行」（见 SAT_PAGE = 40），避免"只高一点点就翻倍占格"，
    //      从而使每页尽量填满（例：58px 的行占 6/4 格 → 一页放 6 行 = 348px，填到 85%），
    //      放不满的差额由表格下方留白补齐，**翻页控件的位置因此恒定**。
    for (var i = 0; i < rows.length && i < trs.length; i++) {
      var h = trs[i].getBoundingClientRect().height || STD;
      map[rows[i]._s.idx] = Math.max(1, Math.ceil(h / (STD / 4)));
    }
    document.body.removeChild(box);
  } catch (e) {
    // 量尺失败时退化为「按文本长度估算」，保证功能不中断（同样按 1/4 行粒度返回）
    rows.forEach(function (r) {
      var a = String(r.maker || '').length, b = String(r.name || '').length;
      map[r._s.idx] = Math.max(4, Math.ceil(a / 12) * 4, Math.ceil(b / 30) * 4);
    });
  }
  _rowUnitCache = { sig: sig, map: map };
  return function (r) { return map[r._s.idx] || 1; };
}
function renderTable(opts) {
  var jump = opts && opts.jump;
  var st = cur(), q = S.query.trim().toLowerCase();
  var rows = st.sats.map(tableVals);
  if (q) rows = rows.filter(function (r) { return r.q.indexOf(q) >= 0; });
  var k = S.sortKey;
  rows.sort(function (a, b) {
    var va = a[k], vb = b[k];
    if (typeof va === 'string') { va = va.toLowerCase(); vb = vb.toLowerCase(); }
    var r = va < vb ? -1 : va > vb ? 1 : 0;
    return S.sortAsc ? r : -r;
  });
  // V1.7.0（任务1）：按"实测行高"分页 —— 高度是基准（10 × 41px = 410px），条目数是变量。
  // 卫星表的行会因制造商列换行而变高；这里先把行渲染进一个离屏表格量出真实高度，
  // 再换算成"行单元"（1 单元 = 41px），使每页总高恒等于 10 条单行行。
  var unitOf = measureRowUnits(rows);
  var pages = pageCount(rows, SAT_PAGE, unitOf);
  // 有选中项时，跳到「当前排序下第一个选中项」所在页
  // V1.7.1（需求7）：这里用 pageBounds（实测行高）算页号，是**唯一正确**的分页口径。
  //   旧版还有一个并存的 gotoSatInTable()，用固定 SAT_PAGE 行/页算，两套算法必然错位 → 已删除。
  //   找不到选中项（例如它被搜索词过滤掉了）时把页码归0，别停在上一页让人以为"没联动"。
  if (jump && S.sel.length) {
    var firstIdx = rows.findIndex(function (r) { return S.sel.indexOf(r._s.idx) >= 0; });
    if (firstIdx >= 0) {
      var target = 0;
      for (var pp = 0; pp < pages; pp++) {
        var bb = pageBounds(rows, pp, SAT_PAGE, unitOf);
        if (firstIdx >= bb[0] && firstIdx < bb[1]) { target = pp; break; }
      }
      if (S.tpage !== target) S.tpage = target;
    } else {
      S.tpage = 0;
    }
  }
  LAST_ROWS = rows;
  if (S.tpage >= pages) S.tpage = pages - 1;
  if (S.tpage < 0) S.tpage = 0;
  var _b = pageBounds(rows, S.tpage, SAT_PAGE, unitOf);
  var slice = rows.slice(_b[0], _b[1]);
  var html = slice.map(satRowHtml).join('');
  tbody.innerHTML = html || '<tr><td colspan="16" class="empty">' + (LANG === 'en' ? 'No matching satellite' : '没有匹配的卫星') + '</td></tr>';
  tableRows = {};
  Array.prototype.forEach.call(tbody.querySelectorAll('tr[data-idx]'), function (tr) {
    tableRows[tr.getAttribute('data-idx')] = tr;
  });
  document.querySelectorAll('#satTable .extra').forEach(function (el) {
    el.style.display = '';   // V1.5.3：表格始终显示全部列（列开关已移除）
  });
  document.getElementById('tableFoot').textContent =
    t('d_tbl_foot_1') + rows.length + t('d_tbl_foot_2') +
    (S.model === 'brouwer' ? t('d_tbl_bro') : t('d_tbl_kep'));
  // 分页（V1.3.6：给每个按键一个 class，窄屏好按「上一页/指示器/下一页」+「首页/尾页」两行排）
  var pg = document.getElementById('satPager');
  SAT_PAGES = pages;                              // V1.8.0（需求5）：跳页输入框的钳制上限
  pg.innerHTML = pagerHtml(S.tpage, pages, 'spg', 'd_satpage', 'sat');
  fixTableHeight('#sec-table .table-wrap');
  // V1.7.1（需求7）：选中联动的高亮闪一下 —— 必须放在**渲染之后**，
  //   因为只有渲染完才知道这一页里有没有那一行（旧版在 renderTable 之前 querySelector，必然扑空）。
  if (jump) hitTableRow();
}
// 两个表格共用：宽屏一行五个控件，窄屏两行（上一页/指示器/下一页 + 首页/尾页）
// 高度按「整页 10 行」预留，翻到尾页时模块不猛缩、翻页控件留在原位
function pagerHtml(page, pages, attr, boxKey, shotKey) {
  function btn(label, target, dis, cls) {
    return '<button class="' + cls + '" data-' + attr + '="' + target + '"' + (dis ? ' disabled' : '') + '>' + label + '</button>';
  }
  // V1.3.7：导出图片放在这一行的最右端（CSS 里绝对定位），不参与中间按键的居中
  var shot = shotKey
    ? '<button class="pg-shot" data-tshot="' + shotKey + '" type="button" title="' + t('b_shot') + '">' +
      '<svg viewBox="0 0 24 24"><path d="M7 9V3h10v6"/><path d="M5 19h14a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2z"/><path d="M7 15h10v6H7z"/></svg>' +
      '<span>' + t('b_shot') + '</span></button>'
    : '';
  return btn(t('d_first'), 0, page === 0, 'pg-first') +
    btn(t('d_prev'), page - 1, page === 0, 'pg-prev') +
    // V1.8.0（需求5）：当前页码改成**可点按钮** —— 点一下变输入框，回车/失焦跳页（越界自动钳制）
    '<span class="pg-box">' + t(boxKey) +
      '<button class="pg-cur" data-' + attr + 'jump="1" type="button" title="' + t('pg_jump') + '" aria-label="' + t('pg_jump') + '">' + (page + 1) + '</button>' +
      (LANG === 'en' ? ' of ' : '/') + pages + (LANG === 'en' ? '' : ' 页') + '</span>' +
    btn(t('d_next'), page + 1, page >= pages - 1, 'pg-next') +
    '<span class="pg-br"></span>' +
    btn(t('d_last'), pages - 1, page >= pages - 1, 'pg-last') + shot;
}
// V1.8.0（需求5）：两表的「当前页数」快照 —— 跳页输入框的越界钳制要用
var SAT_PAGES = 1, LAUNCH_PAGES = 1;
// V1.8.0（需求Q4-④）：表格翻页 —— 内容「淡消失 → 淡出现」非线性动画。
//   淡出 260ms（--ease-slow-fast，先慢后快）+ 淡入 260ms（--ease-fast-slow，先快后慢）= --anim-t（520ms），
//   与站内其它四联动效同一时长与曲线口径。只在**用户主动翻页**时触发（分页按键 / 跳页输入），
//   选中联动自动翻页、搜索/排序重画不触发，避免把无关交互也拖慢。
//   prefers-reduced-motion 下直接换内容；连续快点时由最后一次接管（token 机制），不会叠加两套动画。
var TBL_FADE = 260, tblFadeToken = 0;
function fadeTableSwap(tb, swap) {
  if (!tb || !tb.classList) { swap(); return; }
  var reduce = false;
  try { reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) {}
  if (reduce) { swap(); return; }
  var my = ++tblFadeToken;
  tb.classList.remove('tbl-fade-in');
  void tb.offsetWidth;                 // 强制回流：同一元素连点也要能重放动画
  tb.classList.add('tbl-fade-out');
  setTimeout(function () {
    if (my !== tblFadeToken) return;   // 已被更晚的一次翻页取代，交给它收尾
    swap();                            // 内容在全透明那一帧替换，肉眼看不到跳变
    tb.classList.remove('tbl-fade-out');
    void tb.offsetWidth;
    tb.classList.add('tbl-fade-in');
    setTimeout(function () {
      if (my !== tblFadeToken) return;
      tb.classList.remove('tbl-fade-in');
    }, TBL_FADE + 60);
  }, TBL_FADE);
}
// V1.8.0（需求5）：分页器跳页 —— 点当前页码 → 原位变输入框 → Enter/失焦提交，Esc 取消。
//   两张表同一套行为；无效输入不跳页、原样重画。
function bindPagerJump(boxId, attr, getPages, goPage, rerender) {
  document.getElementById(boxId).addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-' + attr + 'jump]');
    if (!btn) return;
    var pages = Math.max(1, getPages() | 0);
    var input = document.createElement('input');
    input.className = 'pg-in';
    input.type = 'text';
    input.inputMode = 'numeric';
    input.maxLength = 4;
    input.value = btn.textContent;
    input.setAttribute('aria-label', t('pg_jump'));
    btn.replaceWith(input);
    try { input.focus(); input.select(); } catch (err) {}
    var done = false;
    function commit(ok) {
      if (done) return; done = true;
      if (!ok) { rerender(); return; }
      var v = parseInt(input.value, 10);
      if (!isFinite(v)) { rerender(); return; }
      goPage(Math.max(1, Math.min(pages, v)) - 1);
    }
    input.addEventListener('keydown', function (ev) {
      ev.stopPropagation();                       // 别让全局键盘处理器（方向键等）插手
      if (ev.key === 'Enter') commit(true);
      else if (ev.key === 'Escape') commit(false);
    });
    input.addEventListener('blur', function () { commit(true); });
    input.addEventListener('click', function (ev) { ev.stopPropagation(); });
  });
}
// ---------------------------------------------------------------- V1.3.7：导出图片
// 三张图直接把画布像素另存（底下加一行出处/时间），两张表按当前页的行当场画一张 PNG。
// 全程在本地完成，不上传任何东西。
function cssVar(n, dft) {
  var v = getComputedStyle(document.documentElement).getPropertyValue(n);
  return (v && v.trim()) || dft;
}
function savePng(cv, name) {
  cv.toBlob(function (blob) {
    if (!blob) return;
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 3000);
  }, 'image/png');
}
// ---------------------------------------------------------------- V1.7.0 第三轮（需求10）：导出命名与倍率
// 文件名片段：中文用星座/章节中文名，英文一律用独立 ASCII 映射（不取 i18n 标题，避免残留非 ASCII）。
var FILE_SEG = {
  gw: { zh: '星网', en: 'CSCN' },          // V1.9.0（需求18/Q22）：英文文件名也改用 CSCN / SpaceSail
  qf: { zh: '千帆', en: 'SpaceSail' }
};
var VIEW_SEG = {
  map: { zh: '地图', en: 'Map' },
  globe: { zh: '轨道', en: 'Orbit' },
  chart: { zh: '倾角分布', en: 'IncDist' },
  progress: { zh: '组网进度', en: 'NetProgress' },   // V1.8.0（需求8）
  // V1.9.1（A15）：导出图底栏的章节短标签。英文按 Q32 定稿用 **Orbits Change**（短）。
  //   ⚠️ 硬约束：底栏宽度有限，这个字符串**由 visual.mjs 的底栏宽度断言守着**，改长会溢出。
  climb: { zh: '变轨情况', en: 'Orbits Change' },      // V1.9.0（R17）→ V1.9.1 改名
  table: { zh: '卫星表格', en: 'SatTable' },
  launches: { zh: '发射历史', en: 'Launch' }
};
// 时间标签：没拖时间条 = 实时/Live；拖了 = ±X 分 / ±Xmin（**符号一律 ASCII**）
// V1.7.3（需求9）：前两章按各自的时间状态命名；表格/发射历史没有时间条 → 恒实时
function shotTimeTagName(view) {
  var off = (view === 'map' || view === 'globe') ? S.time[view].off : 0;
  if (!off) return LANG === 'en' ? 'Live' : '实时';
  // V1.7.0 第三轮末修正④：这里原来在正号那支前面多写了一个一元加号 ——
  // 它会把字符串 "+" 强制转成数字 NaN，于是文件名变成「…_NaN分.png」。
  // 只在 off>0 时才产生 NaN、off<0 正常，所以此前一直没被发现。现在两边都只取字符。
  var sign = off > 0 ? String.fromCharCode(43) : String.fromCharCode(45);   // 只用 ASCII 符号
  return sign + Math.abs(off) + (LANG === 'en' ? 'min' : '分');
}
// 文件名安全化：去掉路径分隔符等非法字符
function safeName(s) {
  return String(s == null ? '' : s).replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
}
function shotFileName(view, extra) {
  var seg = FILE_SEG[S.key] || FILE_SEG.gw;
  var vs = VIEW_SEG[view] || VIEW_SEG.map;
  var name = (LANG === 'en' ? seg.en : seg.zh) + '_' + vs.zh;   // V1.9.0：清掉恒等三元（原两支同为 seg.zh，是笔误级死分支）
  if (LANG === 'en') name = seg.en + '_' + vs.en;
  if (extra) name += '_' + extra;
  return 'CISTrack_' + safeName(name) + '_' + fileStamp() + '_' + safeName(shotTimeTagName(view)) + '.png';
}
function fileStamp() { return new Date().toISOString().slice(0, 10); }
// V1.4.0：底栏时间 = 页面当前正在模拟的时刻（把时间条偏移算进去），不是按快门的时刻。
// 格式：GMT 2026/09/30_20:18:00（+8 04:18:00）—— 括号里是本机时区偏移与对应本地时间。
function shotClock(view) {
  var offMin = -new Date().getTimezoneOffset();               // 东八区 = 480
  var ms = (view === 'map' || view === 'globe') ? simMs(view) : Date.now();   // V1.7.3 需求9：按章取模拟时刻
  var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
  var u = new Date(ms), l = new Date(ms + offMin * 60000);
  var dstr = function (d) {
    return d.getUTCFullYear() + '/' + p2(d.getUTCMonth() + 1) + '/' + p2(d.getUTCDate());
  };
  var tstr = function (d) {
    return p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()) + ':' + p2(d.getUTCSeconds());
  };
  var sign = offMin >= 0 ? '+' : '-', abs = Math.abs(offMin);
  var off = sign + Math.floor(abs / 60) + (abs % 60 ? ':' + p2(abs % 60) : '');
  var br = LANG === 'en' ? ['(', ')'] : ['（', '）'];
  // 本地钟面时间：把偏移加到毫秒上再按 UTC 读，得到的就是当地墙上时间
  return 'GMT ' + dstr(u) + '_' + tstr(u) + br[0] + off + ' ' + tstr(l) + br[1];
}
// 底栏统一画法：左侧署名+模拟时间，右侧免责声明，**全白字**（V1.4.0 起不再是灰字）。
// 窄图放不下右侧声明时自动只留左侧。
function drawShotFooter(ctx, W, y, left, dpr) {
  var white = '#ffffff';
  var disc = t('d_shot_disc');
  ctx.textBaseline = 'middle';
  ctx.fillStyle = white;
  // 先按基准字号量一遍；放不下就整体缩一点（最多缩 6 次），保证两侧都不重叠
  var size = 11.5 * dpr, lw = 0, dw = 0;
  for (var i = 0; i < 6; i++) {
    ctx.font = monoFont(size);
    lw = ctx.measureText(left).width;
    ctx.font = monoFont(size * 0.95);
    dw = ctx.measureText(disc).width;
    if (lw + dw + 44 * dpr <= W) break;
    size *= 0.92;
  }
  ctx.textAlign = 'left';
  ctx.font = monoFont(size);
  ctx.fillText(left, 12 * dpr, y);
  ctx.font = monoFont(size * 0.95);
  ctx.textAlign = 'right';
  if (W - lw - dw > 26 * dpr) ctx.fillText(disc, W - 12 * dpr, y);
  ctx.textAlign = 'left';
}
// 底栏左侧那串：CISTrack <版本> · 星座 · 章节 · GMT …（版本号与页面同步）
function shotLeft(title) {
  return 'CISTrack ' + VERSION + ' · ' + t('shot_' + S.key) + ' · ' + title + ' · ' + shotClock();
}
function monoFont(px, bold) {
  return (bold ? '700 ' : '') + px + 'px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
}

// ============================================================ V1.6.3：图片输出改造
// 规格：条带在图片**下方**（不遮画面），与原图用主题色细线分隔；
//   · 有选中卫星时：先写卫星信息（每颗一行）→ 细线 → CISTrack 行
//   · 无选中卫星时：细线 → CISTrack 行
//   · CISTrack 用顶栏 logo 同款字体并染主题色；各部分用 "|" 分隔；
//   · 时间后标注 [实时]/[Live] 或 [+ X 分]/[+ X min]
function shotInk() { return isLight() ? '#16181d' : '#f2f2f0'; }
function shotInkDim() { return isLight() ? '#5a5f66' : '#9aa0a6'; }
// V1.7.0（任务16-i）：分隔细线与 CISTrack 字样一律用「当前星座」主题色（星网红 / 千帆蓝）。
function shotAccent() { return S.key === 'qf' ? cssVar('--c-qf', '#4dabf7') : cssVar('--c-gw', '#ff6b6b'); }
function shotBrandFont(px) { return px + 'px ' + cssVar('--brand', 'monospace'); }
// V1.7.0（任务16）：章节类别 —— 前两章（01 地图 / 02 轨道）与后两章（03 倾角分布 / 04 表格等）输出规则不同。
//   'front'：地图 / 轨道 —— 卫星行末尾保留 [历元]，CISTrack 行时间后带 [实时]/[+X 分]，且追加最低仰角
//   'back' ：表格 —— CISTrack 行时间只写 (GMT+8 YYYY-MM-DD)，去掉一切时间明细
function shotChapter(view) {
  return (view === 'map' || view === 'globe') ? 'front' : 'back';
}
// 前两章当前「最低仰角」：优先取地图覆盖区仰角，其次可视锥仰角；未设置返回 null
function shotElevation() {
  if (S.cov && S.cov.on && isFinite(S.cov.el)) return S.cov.el;
  if (S.cone && S.cone.on && isFinite(S.cone.el)) return S.cone.el;
  return null;
}
function shotTimeTag(view) {
  var off = (view === 'map' || view === 'globe') ? S.time[view].off : 0;
  if (!off) return ' ' + (LANG === 'en' ? '[Live]' : '[实时]');
  var a = Math.abs(off);
  return ' ' + (off > 0 ? '[+ ' : '[- ') + a + (LANG === 'en' ? ' min]' : ' 分]');
}
// V1.7.0（任务16-ii）：前两章的「时间[状态]」在设置了最低仰角时，把时间偏移与最低仰角合并成
// 一个方括号 [ +X 分, Y° ]（+ 后不留空格）；未设置最低仰角时保持原来的 [实时] / [+X 分]。
// 例：timeOffset=107、最低仰角=51.1 →  ' [+107 分, 51.1°]'
function shotTimeTagFront(view) {
  var el = shotElevation();
  if (el === null) return shotTimeTag(view);
  var ts = S.time[view === 'globe' ? 'globe' : 'map'] || S.time.map;
  var off = ts.off || 0;
  // V1.7.0 二轮（需求5）：**没拖动时间条**（off=0）时写「实时」而不是「0 分」；
  //   只有真的加了/减了时间，才写 [+X 分, …] / [−X 分, …]。
  //   实测旧输出：`... (GMT+8 18:36:16) [0 分, 10.0°]` → 现在为 `... [实时, 10.0°]`。
  var label = off === 0
    ? (LANG === 'en' ? 'Live' : '实时')
    : ((off > 0 ? '+' : '−') + Math.abs(off) + (LANG === 'en' ? ' min' : ' 分'));
  return ' [' + label + ', ' + fmtNum(el, 1) + '°]';
}
// V1.7.0（任务16-iv）：最后两章表格只用「设备本地日期」： (GMT+8 2026-10-03)
function shotDateOnly() {
  var offMin = -new Date().getTimezoneOffset();
  var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
  var l = new Date(Date.now() + offMin * 60000);
  var sign = offMin >= 0 ? '+' : '-', abs = Math.abs(offMin);
  var off = sign + Math.floor(abs / 60) + (abs % 60 ? ':' + p2(abs % 60) : '');
  return '(GMT' + off + ' ' + l.getUTCFullYear() + '-' + p2(l.getUTCMonth() + 1) + '-' + p2(l.getUTCDate()) + ')';
}
function shotTimeStr(view) {
  var offMin = -new Date().getTimezoneOffset();
  var ts = S.time[view === 'globe' ? 'globe' : 'map'] || S.time.map;
  var ms = (ts.frozen != null) ? ts.frozen : Date.now() + (ts.off || 0) * 60000;   // V1.7.3 需求9：冻结章用冻结时刻
  var p2 = function (n) { return (n < 10 ? '0' : '') + n; };
  var l = new Date(ms + offMin * 60000);
  var sign = offMin >= 0 ? '+' : '-', abs = Math.abs(offMin);
  var off = sign + Math.floor(abs / 60) + (abs % 60 ? ':' + p2(abs % 60) : '');
  return '(GMT' + off + ' ' + p2(l.getUTCHours()) + ':' + p2(l.getUTCMinutes()) + ':' + p2(l.getUTCSeconds()) + ')';
}
// 卫星信息行：目录名 | NORAD | 批次名 | 近地点×远地点 | 倾角 | 周期 | 发射日期(在轨天数) | [更新历元]
// V1.7.0（任务16-iii）：第三章倾角分布的输出要删掉时间相关项（末尾的 [更新历元]），
//   所以这里按 view 决定是否拼上历元；前两章与表格仍保留。
function shotSatLines(view) {
  if (view === 'progress') return [];        // V1.8.0（需求8）：03.5 是星座曲线图，不列选中卫星
  // V1.9.0（R17）：04 变轨情况 —— 导出图底栏要带**升轨速度列**（需求 R17）。
  //   列的是「当前这一章画出来的那几条曲线」，而不是全局选中：
  //   本章默认就跟着全局选中，两者一致；但用户显式选了某个批次时，
  //   底栏必须如实写这个批次的成员星，否则图与字对不上。
  if (view === 'climb') {
    var sc = climbSeries(), cl = sc.list;
    if (!cl.length) return [];
    var rowsC = cl.slice().sort(function (a, b) { return a.norad - b.norad; });
    return rowsC.map(function (c) {
      var idx = climbSatIdx(c.norad);
      var sat = idx >= 0 ? cur().sats[idx] : null;
      // 取最后一个有效速度（升轨速度是 ±2 天窗口的局部量，末端值最有意义）
      var rate = null;
      for (var i = c.rates.length - 1; i >= 0; i--) if (isFinite(c.rates[i])) { rate = c.rates[i]; break; }
      var last = c.pts[c.pts.length - 1];
      return [
        sat ? cnName(sat) : String(c.norad),
        String(c.norad),
        sat ? batchName((sat.launch || {}).name) : '',
        fmtNum(last.v - CLIMB_RE, 1) + 'km',
        (rate == null ? '—' : fmtNum(rate, 3) + (LANG === 'en' ? 'km/d' : 'km/天'))
      ].join(' | ');
    });
  }
  if (!S.sel.length) return [];
  var withEpoch = (view !== 'chart');       // 仅第三章倾角分布去掉历元
  var sats = S.sel.map(function (i) { return cur().sats[i]; }).filter(Boolean);
  sats.sort(function (a, b) { return (+a.norad || 0) - (+b.norad || 0); });
  return sats.map(function (s) {
    var L = s.launch || {};
    var d = (L.dateStr || '').slice(0, 10) || '—';
    var days = isFinite(L.dateMs) ? Math.max(0, Math.floor((Date.now() - L.dateMs) / DAY)) : null;
    var parts = [
      cnName(s),
      String(s.norad),
      batchName(L.name),
      fmtNum(s.hpK, 2) + 'km×' + fmtNum(s.haK, 2) + 'km',
      fmtNum(s.inc, 2) + '°',
      fmtNum(s.period, 3) + (LANG === 'en' ? ' min' : ' 分'),
      d + (days === null ? '' : '(' + days + (LANG === 'en' ? 'd' : '天') + ')')
    ];
    // V1.7.2 第七轮（新需求A）：导出图片里的卫星信息行**只带「该星历元」**。
    //   整包的「TLE更新时间」已从导出底栏与信息窗里全部撤掉，只保留在主标题下方那一处
    //   （见 renderHeader 的 #pageEpoch），避免同一张图里两个日期分不清哪个是最新。
    if (withEpoch) parts.push('[' + t('d_row_epoch_sat') + ' ' + fmtUTC(s.epochMs) + ']');
    return parts.join(' | ');
  });
}
// 自绘底栏：satLines（可空）+ 细线 + CISTrack 行 + 右侧声明；返回绘制高度
// V1.7.0（任务16）：新增 view 参数 —— 前两章用 shotTimeTagFront（带最低仰角），最后两章用 shotDateOnly。
//   同时修掉「CISTrack 行与右下角声明重叠」的老毛病：先按可用宽度收缩字号，仍放不下就把声明
//   单独挪到下一行（而不是叠在 CISTrack 上）。
function drawShotBar(ctx, W, yTop, title, satLines, dpr, view) {
  var pad = 10 * dpr;
  var size = 11.5 * dpr;
  var lineH = Math.round(size * 1.62);
  var y = yTop + pad;
  var st = cur();
  var chapter = shotChapter(view);
  var disco = t('d_shot_disc');

  // 卫星信息行
  if (satLines.length) {
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    satLines.forEach(function (txt, i) {
      var sz = size, tw = 0;
      for (var k = 0; k < 7; k++) {
        ctx.font = monoFont(sz);
        tw = ctx.measureText(txt).width;
        if (tw <= W - 24 * dpr) break;
        sz *= 0.9;
      }
      ctx.fillStyle = i === 0 ? shotInk() : shotInkDim();
      ctx.fillText(txt, 12 * dpr, y + lineH * i + lineH / 2);
    });
    y += lineH * satLines.length;
  }

  // 主题色细线（图片/卫星信息 与 CISTrack 行之间）
  ctx.strokeStyle = shotAccent();
  ctx.lineWidth = Math.max(1, Math.round(dpr));
  ctx.beginPath();
  ctx.moveTo(12 * dpr, Math.round(y + 3 * dpr));
  ctx.lineTo(W - 12 * dpr, Math.round(y + 3 * dpr));
  ctx.stroke();
  y += 3 * dpr + 3 * dpr;

  // CISTrack 行：CISTrack 用 logo 字体 + 主题色，其余用等宽 + 主文字色
  var x = 12 * dpr;
  var cy = y + lineH / 2;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.font = shotBrandFont(size * 1.12);
  ctx.fillStyle = shotAccent();
  var brandW = ctx.measureText('CISTrack').width;
  ctx.fillText('CISTrack', x, cy);
  x += brandW + 6 * dpr;
  // 时间部分：前两章 = 时刻 + [实时]/[+X 分] + （有最低仰角时）[+X 分, Y°]；最后两章 = 仅本地日期
  var timePart = (chapter === 'front') ? (shotTimeStr(view) + shotTimeTagFront(view)) : shotDateOnly();
  // V1.7.2 第七轮（需求6）：图片里也不再重复整包口径的「TLE 更新时间」——
  //   它只出现在页面主标题下方那一处；图片中单星信息行末尾的 [该星历元 …] 保留（见 shotSatLines）。
  var rest = [VERSION, st.name, title, timePart].join(' | ');
  // 先算右下角声明要占多宽（含 16px 间距），给 CISTrack 行留出空间，避免两者重叠
  ctx.font = monoFont(size * 0.9);
  var discW = ctx.measureText(disco).width;
  var discGap = 16 * dpr;
  var avail = W - x - 12 * dpr - discW - discGap;
  var rs = size;
  for (var j = 0; j < 8; j++) {
    ctx.font = monoFont(rs);
    if (ctx.measureText(rest).width <= avail) break;
    rs *= 0.9;
  }
  // 极端情况：缩到 0.9^8 还放不下 → 让声明换行到下方，CISTrack 行独占整行
  var discOwnLine = false;
  ctx.font = monoFont(rs);
  if (ctx.measureText(rest).width > avail) {
    discOwnLine = true;
    var avail2 = W - x - 12 * dpr;
    rs = size;
    for (var j2 = 0; j2 < 8; j2++) {
      ctx.font = monoFont(rs);
      if (ctx.measureText(rest).width <= avail2) break;
      rs *= 0.9;
    }
  }
  ctx.font = monoFont(rs);
  ctx.fillStyle = shotInk();
  ctx.fillText(rest, x, cy);
  y += lineH;

  // 右下角声明
  ctx.font = monoFont(size * 0.9);
  ctx.fillStyle = shotInkDim();
  ctx.textAlign = 'right';
  if (discOwnLine) {
    ctx.fillText(disco, W - 12 * dpr, y + lineH * 0.45);
    y += lineH * 0.9;
  } else if (discW + 24 * dpr < W) {
    ctx.fillText(disco, W - 12 * dpr, cy);
  }
  ctx.textAlign = 'left';
  // V1.7.3（需求8）：CISTrack 行下缘→图片底边的距离 = 行上缘→分割线的距离（3dpr）。
  //   旧版这里是 pad(10dpr)，加上 shotBarHeight 无条件多预留的 0.9 行高，底部空白过大。
  y += 3 * dpr;
  return y - yTop;
}
// 预计算条带高度（供 exportView 分配画布）
// V1.7.0：多留一行余量 —— drawShotBar 在极端情况下会把右下角声明换到下一行，
// 这里按「可能多一行」预留，避免声明被裁掉（多出的空白在底部很自然）。
function shotBarHeight(ctx, W, title, satLines, dpr, view) {
  var pad = 10 * dpr, size = 11.5 * dpr, lineH = Math.round(size * 1.62);
  return pad + lineH * satLines.length + 6 * dpr + lineH + lineH * 0.9 + pad;
}

// V1.7.0 第三轮末修正③：导出的 PNG 不再直接搬屏幕像素（那等于"屏幕分辨率"），
// 而是在**同一个同步函数内**把画布临时按更高倍率重建并重绘，导出后立刻还原。
// 全程同步 → 浏览器不会绘制中间态 → 页面显示完全不变、看不到任何闪烁。
//
// ★ 为什么上一版"还是只有几百 KB"：倍率写死成 SHOT_STEPS = [3, 2.5, …]，最高 3×。
//   手机端地图/轨道画布的 CSS 长边只有约 390px → 3× 也只有约 1170px 宽，
//   这种尺寸的 PNG 天然就是几百 KB。这跟"重绘"没关系，是**倍率上限**卡住了。
//   现在改成按几何关系反推最高可用倍率：`画布 CSS 长边 × 倍率 ≤ CANVAS_MAX_SIDE(4096)`，
//   于是无论桌面还是手机，导出的长边都直奔 4096px（再由下面的 12MB 上限逐档回退）。
var SHOT_MAX_BYTES = 12 * 1024 * 1024;     // 12MB 上限（用户指定）
var SHOT_MAX_PX = 16e6;                    // 像素总量安全线（≈4096²，手机防 OOM）
// 由源画布的 CSS 尺寸反推"从哪一档开始试"：k0 是能把长边顶到 4096 的倍率，
// 之后再按 0.78 的比例逐档下探，直到 toBlob 的真实字节数 ≤ 12MB。
function shotStepsFor(cv, extraH) {
  // V1.7.0 第三轮末修正③：尺寸一律走 canvasBox()，与 fitCanvas 用同一套兜底逻辑。
  //   不能用 cv.width —— 地图/轨道画布在"还没被画过"时 width 只是 HTML 默认的 300×150，
  //   拿它反推 k0 会得到 13× 这种离谱值，虽然 fitCanvas 会再夹一次，但档位表就白排了。
  // extraH：导出图底下还要接一条信息栏（CSS 高度 ≈ 60–80px）。面积预算必须把它算进去，
  //   否则 {宽×高 + 信息栏} 会顶破设备画布面积上限，白跑一趟高倍率重绘（手机上一趟要好几秒）。
  var box = canvasBox(cv);
  var w = Math.max(1, box.w), h = Math.max(1, box.h + (extraH || 0));
  var k0 = Math.min(CANVAS_MAX_SIDE / Math.max(w, h), Math.sqrt(SHOT_MAX_PX / (w * h)));
  if (!isFinite(k0) || !(k0 > 0)) k0 = 1;
  var out = [], k = k0;
  for (var i = 0; i < 9; i++) {
    out.push(Math.round(k * 100) / 100);
    if (k <= 1.02) break;
    k = k * 0.78;
    if (k < 1) k = 1;
  }
  return out.filter(function (v, i, a) { return a.indexOf(v) === i; });   // 去重，别对同一档重复编码
}
function blobBytes(cnv) {
  return new Promise(function (res) {
    try { cnv.toBlob(function (bl) { res(bl ? bl.size : 0); }, 'image/png'); }
    catch (e) { res(0); }
  });
}
// 导出进度提示：重绘是同步阻塞的，手机上要两三秒，没有提示用户会以为"点了没反应"
function showShotToast(note) {
  try {
    var el = document.createElement('div');
    el.className = 'shot-toast';
    el.innerHTML = '<i></i><span></span>';
    el.querySelector('span').textContent = note || (LANG === 'en' ? 'Re-rendering at high resolution…' : '正在重绘高清图片…');
    document.body.appendChild(el);
    return el;
  } catch (e) { return null; }
}
function hideShotToast(el, note) {
  if (!el) return;
  try {
    if (note) {
      var sp = el.querySelector('span'); if (sp) sp.textContent = note;
      var ic = el.querySelector('i'); if (ic) ic.style.display = 'none';
    }
    setTimeout(function () { try { el.remove(); } catch (e) {} }, note ? 1500 : 220);
  } catch (e) {}
}
// 表格导出会"建一次 → 量字节 → 太大就用更高/更低倍率再建一次"，期间同一个提示条要复用，
// 所以用一个模块级引用把它串起来（反正同一时刻只会有一个导出在进行）。
var shotToastEl = null;
function shotToastStart(note) { if (!shotToastEl) shotToastEl = showShotToast(note); return shotToastEl; }
function shotToastEnd(note) { var e = shotToastEl; shotToastEl = null; hideShotToast(e, note); }
// 把源画布按 k 倍重建 + 重绘（同步），画完调用 done() 再还原
function withCanvasScale(cv, k, redraw, done) {
  // 只设 EXPORT_DPR，由 fitCanvas 负责真正改画布尺寸（它还会同步 _w/_h/dpr 与 ctx 变换）
  var prev = EXPORT_DPR;
  EXPORT_DPR = k;
  try {
    cv._dpr = -1;            // 强制 fitCanvas 认为尺寸需要重建
    redraw();
    done(cv._dpr > 0 ? cv._dpr : k);
  } catch (e) {
    done(0);
  } finally {
    EXPORT_DPR = prev;
    try { cv._dpr = -1; redraw(); } catch (e) {}   // 立刻恢复屏幕分辨率与画面
  }
}
function exportView(view) {
  var id = view === 'chart' ? 'chart' : (view === 'map' ? 'map' :
           (view === 'progress' ? 'netCv' : (view === 'climb' ? 'climbCv' : 'globe')));
  var cv = document.getElementById(id);
  if (!cv || !cv.width) return;
  var title = view === 'chart' ? t('h_dist') : (view === 'map' ? t('h_map') :
              (view === 'progress' ? t('h_progress') : (view === 'climb' ? t('h_climb') : t('h_orbits'))));
  var satLines = shotSatLines(view);                    // V1.6.3：有选中卫星时先写卫星信息
  // V1.7.0 第三轮末修正③：导出时刻必须**带上时间条偏移**。
  // 旧版这里传的是裸 Date.now()，于是拖到 +120 分钟再导出，图上卫星位置其实还是"实时"的，
  // 只有底栏文字写着 [+120 分] —— 图文不符。
  // V1.7.3（需求9）：时间状态按章独立 → 导出哪章就用哪章的模拟时刻（冻结章 = 冻结时刻）。
  var viewKey = (view === 'globe') ? 'globe' : 'map';
  var msNow = simMs(viewKey);
  var redraw = function () {
    // 必须像主循环那样把 frameStates / 时间戳传进去，否则 drawMap/drawGlobe 取不到卫星状态。
    // frameStates 可能为 null（刚拖过时间条时会被清空）→ 这里就地补算一次，避免导出空白图。
    var fs = (viewKey === 'globe') ? frameStatesGlobe : frameStatesMap;
    if (!fs) { try { fs = propagateAll(msNow); if (viewKey === 'globe') frameStatesGlobe = fs; else frameStatesMap = fs; } catch (e) {} }
    if (view === 'map') drawMap(fs, msNow);
    else if (view === 'globe') drawGlobe(fs, msNow);
    else if (view === 'progress') drawNet();     // V1.8.0（需求8）：03.5 组网进度
    else if (view === 'climb') drawClimb();      // V1.9.0（R17）：04 变轨情况
    else drawChart();
  };
  var fname = shotFileName(view);
  var steps = shotStepsFor(cv, 80);   // 80 ≈ 底栏信息条在 CSS 像素下的高度（见 shotBarHeight）
  var si = 0, lastFailK = 0, refined = false;
  var toast = shotToastStart();
  function finish(note) { shotToastEnd(note); }
  function attempt() {
    if (si >= steps.length) {
      // 所有档位都没成功（例如画布过大）→ 至少把当前这一帧导出去，避免"点了没反应"
      try { savePng(cv, fname); } catch (e) {}
      finish(LANG === 'en' ? 'Exported (standard resolution)' : '已导出（标准分辨率）');
      return;
    }
    var k = steps[si];
    withCanvasScale(cv, k, redraw, function (kk) {
      var dr = Math.max(1, kk);
      var probe = document.createElement('canvas').getContext('2d');
      var pad = Math.round(shotBarHeight(probe, cv.width, title, satLines, dr, view));
      var out = document.createElement('canvas');
      out.width = cv.width; out.height = cv.height + pad;
      var ctx = out.getContext('2d');
      ctx.fillStyle = cssVar('--bg', '#0a0c10');
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(cv, 0, 0);
      // V1.7.3（需求8）：drawShotBar 返回**实际**用掉的条带高度。shotBarHeight 预留了
      //   「声明换行」的兜底行（0.9 行高），没换行时就是一大段底部空白 —— 按实际高度裁掉。
      var barH = drawShotBar(ctx, out.width, cv.height, title, satLines, dr, view);
      var save = out;
      if (barH < pad - 0.5) {
        save = document.createElement('canvas');
        save.width = out.width;
        save.height = Math.round(cv.height + barH);
        save.getContext('2d').drawImage(out, 0, 0);
      }
      blobBytes(save).then(function (n) {
        if (n > 0 && n <= SHOT_MAX_BYTES) {          // 这一档合格，用它
          // V1.7.0 第三轮末修：档位是几何递减（0.78），"上一档超标"与"这一档合格"之间
          //   往往还空着一大段（例：地图 4096 宽 14.0MB 超标 → 3195 宽 9.8MB 合格，
          //   中间 12MB 附近还有约 13% 的清晰度白白浪费）。这里再补一次**几何中点**探测，
          //   合格就用中点，不合格就退回本档；只做一次（refined 硬闸），不会拖长太多。
          if (!refined && lastFailK > 0 && lastFailK / k > 1.08) {
            var mid = Math.round(Math.sqrt(lastFailK * k) * 100) / 100;
            if (mid > k + 0.01 && mid < lastFailK - 0.01) {
              refined = true;
              steps.splice(si, 0, mid);              // 插到当前档之前 → 下一轮先试中点
              attempt();
              return;
            }
          }
          savePng(save, fname);
          finish((LANG === 'en' ? 'Exported ' : '已导出 ') + save.width + '×' + save.height);
          return;
        }
        lastFailK = k; si++; attempt();              // 太大 → 降一档重试
      });
    });
  }
  // 先让提示条真正画到屏幕上（导出重绘同步阻塞主线程），再开工
  requestAnimationFrame(function () {
    setTimeout(function () {
      try { attempt(); }
      catch (e) { try { savePng(cv, fname); } catch (e2) {} finish(); }
    }, 24);
  });
}
// 把「表格的行 HTML」临时挂进一个游离的 tbody，再逐格取纯文本 ——
// 这样导出第 N 页时不必真的去翻页渲染（避免闪屏），也能拿到非当前页的行。
var SHOT_HEADS = { sat: [], launch: [] };
function rowsTextFromHtml(html, vis, which) {
  var box = document.createElement('tbody');
  box.innerHTML = html;
  var tbl = document.getElementById(which === 'sat' ? 'satTable' : 'launchTable');
  var cols = [].slice.call(tbl.querySelectorAll('thead th'));
  return [].slice.call(box.children).map(function (tr) {
    return vis.map(function (i) {
      var td = tr.children[i];
      if (!td) return '';
      // 用「取可见列的文字」的简化版：链接只留文字，标签只留文字
      return String(td.textContent || '').replace(/\s+/g, ' ').trim();
    });
  });
}
function exportTable(opts) {
  // opts: { which:'sat'|'launch', mode:'cur'|'all'|number, allCols:boolean }
  var which = opts && opts.which ? opts.which : 'sat';
  var wantAll = !!(opts && opts.allCols);         // V1.4.1：默认开「含全部列」
  var tbl = document.getElementById(which === 'sat' ? 'satTable' : 'launchTable');
  if (!tbl) return;
  var ths = [].slice.call(tbl.querySelectorAll('thead th'));
  var vis = [];                                   // 默认只画屏幕上能看见的列；开了开关就整表导出
  ths.forEach(function (th, i) {
    if (wantAll) { vis.push(i); return; }
    if (getComputedStyle(th).display !== 'none') vis.push(i);
  });
  var heads = vis.map(function (i) { return ths[i].textContent.trim(); });

  // 全部行的 HTML（含未显示的页）→ 文本
  var allHtml = (which === 'sat')
    ? LAST_ROWS.map(satRowHtml)
    : LAST_LAUNCH_ROWS.map(launchRowHtml);
  var allText = rowsTextFromHtml(allHtml.join(''), vis, which);
  if (!allText.length) return;
  var total = Math.ceil(allText.length / PAGE_SIZE);
  var curPage = (which === 'sat' ? S.tpage : S.page);
  var from = 0, to = curPage;
  if (opts && opts.mode === 'all') { from = 0; to = total - 1; }
  else if (opts && typeof opts.mode === 'number') { from = 0; to = Math.min(opts.mode, total) - 1; }
  var rows = allText.slice(from * PAGE_SIZE, (to + 1) * PAGE_SIZE);
  if (!rows.length) return;

  // V1.7.0 第三轮末修正③：表格导出的倍率同样自适应（旧版写死 2×，手机上把 390px 宽的表
  // 按 780px 导出，字还是糊的）。这里 dpr 变成可传入参数：导出流程会先建一次量字节数，
  // 需要更清晰就带着更大的 dpr 再调一次本函数（几何全部随 dpr 线性缩放，所以只要换这一个值）。
  var dpr = (opts && opts.dpr) || 2, fs = 12 * dpr, padX = 11 * dpr, rowH = 26 * dpr, headH = 30 * dpr, topH = 34 * dpr;
  var probe = document.createElement('canvas').getContext('2d');
  probe.font = monoFont(fs, true);
  var widths = heads.map(function (h, c) {
    var w = probe.measureText(h).width;
    rows.forEach(function (r) { w = Math.max(w, probe.measureText(r[c] || '').width); });
    return Math.min(w + padX * 2, 300 * dpr);
  });
  var W = widths.reduce(function (a, b) { return a + b; }, 0);
  var H = topH + headH + rows.length * rowH + 8 * dpr;
  var cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  var ctx = cv.getContext('2d');
  var bg = cssVar('--bg', '#0a0c10'), fg = cssVar('--fg', '#e6e9ef');
  var hair = cssVar('--hair', '#222831'), dim = cssVar('--dim', '#9aa4b2');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  // 标题行（V1.4.0：改成白色，与底栏同一套）
  var st = cur();
  var shotTitle = which === 'sat' ? t('h_sattable') : t('h_launchhist');
  // V1.6.3：顶部行 = CISTrack(logo 字体 + 主题色) | 版本 | 星座 | 章节 | 时间[状态] | 第 X 页
  // （原来顶部/底部各有一行、内容重复；现底部只保留右下角声明）
  var pagesTxt2 = (LANG === 'en')
    ? ((from === to) ? ('Page ' + (to + 1)) : ('Page ' + (from + 1) + '~' + (to + 1)))
    : ((from === to) ? ('第 ' + (to + 1) + ' 页') : ('第 ' + (from + 1) + '~' + (to + 1) + ' 页'));
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  var bx = padX, by = topH / 2;
  ctx.font = shotBrandFont(12 * dpr);
  ctx.fillStyle = shotAccent();
  var bw2 = ctx.measureText('CISTrack').width;
  ctx.fillText('CISTrack', bx, by);
  bx += bw2 + 6 * dpr;
  var restTxt = [VERSION, t('shot_' + S.key), shotTitle, shotDateOnly(), pagesTxt2].join(' | ');
  ctx.font = monoFont(11 * dpr);
  ctx.fillStyle = shotInk();
  ctx.fillText(restTxt, bx, by);
  // 表头
  ctx.fillStyle = fg; ctx.font = monoFont(fs, true);
  ctx.textBaseline = 'middle';
  var y = topH;
  ctx.fillStyle = hair; ctx.fillRect(0, y + headH - Math.max(1, dpr / 2), W, Math.max(1, dpr));
  var x = 0;
  heads.forEach(function (h, c) { ctx.fillStyle = fg; ctx.fillText(h, x + padX, y + headH / 2); x += widths[c]; });
  y += headH;
  // 数据行
  ctx.font = monoFont(fs);
  rows.forEach(function (r, ri) {
    if (ri % 2) { ctx.fillStyle = 'rgba(255,255,255,.035)'; ctx.fillRect(0, y, W, rowH); }
    ctx.fillStyle = hair; ctx.fillRect(0, y, W, Math.max(1, dpr / 2));
    var xx = 0;
    r.forEach(function (cell, c) {
      ctx.fillStyle = dim;
      ctx.fillText(cell.length > 40 ? cell.slice(0, 39) + '…' : cell, xx + padX, y + rowH / 2);
      xx += widths[c];
    });
    y += rowH;
  });
  // 底栏：左=署名与模拟时间，右=免责声明（全白字）
  var footH = Math.round(30 * dpr);
  var cv2 = document.createElement('canvas');
  cv2.width = W; cv2.height = H + footH;
  var c2 = cv2.getContext('2d');
  c2.fillStyle = bg; c2.fillRect(0, 0, cv2.width, cv2.height);
  c2.drawImage(cv, 0, 0);
  // V1.6.3：底部只保留「非官方……」声明（右下角原位），不再重复 CISTrack 那一行
  var discStr = t('d_shot_disc');
  c2.font = monoFont(10 * dpr);
  c2.fillStyle = shotInkDim();
  c2.textBaseline = 'middle'; c2.textAlign = 'right';
  if (c2.measureText(discStr).width + 24 * dpr < cv2.width) {
    c2.fillText(discStr, cv2.width - 12 * dpr, H + footH / 2);
  }
  c2.textAlign = 'left';
  var pagesTxt = (from === to) ? ('p' + (to + 1)) : ('p' + (from + 1) + '-' + (to + 1));
  // V1.7.0 第三轮末修正⑥：extra 原本传的是 shotTitle，但 shotFileName 里已经拼过章节名了，
  // 于是文件名变成「…_卫星表格_卫星表格_p1…」。这里只补页码，不再重复章节名。
  var outName = shotFileName(which === 'launch' ? 'launches' : 'table', pagesTxt);
  // ---- V1.7.0 第三轮末修正③：自适应倍率 + 12MB 上限（与三个图章节同一套规则）----
  var tries = (opts && opts._try) || 0;
  var again = function (nextDpr) {
    var o2 = Object.assign({}, opts || {});
    o2.which = which; o2.dpr = nextDpr; o2._try = tries + 1;   // which 必须带回去，否则会导出另一张表
    exportTable(o2);
  };
  var baseCss = { _w: W / dpr, _h: (H + footH) / dpr };     // 这张表在 1× 下的 CSS 尺寸
  var topDpr = shotStepsFor(baseCss)[0];
  if (tries < 5 && topDpr > dpr + 0.02) {                    // 还能更清楚 → 用最高档重建
    shotToastStart(LANG === 'en' ? 'Re-rendering at high resolution…' : '正在重绘高清图片…');
    try { again(topDpr); } catch (e) { savePng(cv2, outName); shotToastEnd(); }
    return;
  }
  shotToastStart();
  blobBytes(cv2).then(function (n) {
    if (n > 0 && n <= SHOT_MAX_BYTES || dpr <= 1.05 || tries >= 5) {
      savePng(cv2, outName);
      shotToastEnd((LANG === 'en' ? 'Exported ' : '已导出 ') + cv2.width + '×' + cv2.height);
      return;
    }
    again(Math.max(1, dpr * 0.78));                          // 超过 12MB → 降一档重建
  });
}
// ===== V1.6.3：分页按"固定行高"而非固定条数 =====
// 内容长的行（多行制造商 / 长火箭名）会换行变高；此时该页少放几条，
// 使每页总高度与"整页单行行"一致 —— 既不突然收缩，也不会被顶出大块空白。
function pairUnits(v) { return Array.isArray(v) ? rowUnits(v[0], v[1]) : rowUnits(v); }
function rowUnits(text, text2) {
  // V1.7.0：允许直接传数字（发射表每行固定 1 单元）
  if (typeof text === 'number') return text;
  var a = String(text || '').length, b = String(text2 || '').length;
  // 制造商列宽约 12 字/行、卫星名列宽约 30 字/行（含图标），取两者较大者
  return Math.max(1, Math.ceil(a / 12), Math.ceil(b / 30));
}
function pageBounds(rows, page, per, textOf) {
  var start = 0;
  for (var p = 0; p < page; p++) {
    var used = 0;
    while (start < rows.length && used + pairUnits(textOf(rows[start])) <= per) {
      used += pairUnits(textOf(rows[start])); start++;
    }
  }
  var end = start, used2 = 0;
  while (end < rows.length && used2 + pairUnits(textOf(rows[end])) <= per) {
    used2 += pairUnits(textOf(rows[end])); end++;
  }
  return [start, end];
}
function pageCount(rows, per, textOf) {
  var units = 0;
  rows.forEach(function (r) { units += pairUnits(textOf(r)); });
  return Math.max(1, Math.ceil(units / per));
}
function fixTableHeight(sel) {
  var wrap = document.querySelector(sel);
  if (!wrap) return;
  var trs = wrap.querySelectorAll('tbody tr');
  if (!trs.length) { wrap.style.height = ''; wrap.style.minHeight = ''; wrap.style.paddingBottom = ''; return; }
  var head = wrap.querySelector('thead');
  var tbl = wrap.querySelector('table');
  // V1.7.0（任务1）：容器高度 = 表头 + **10 条单行行**的像素高度（高度是基准，条目数是变量）。
  // 单行行高从 CSS 基准常量取（tbody tr 高度 41px）；多行行（制造商两行）的那个页
  // 由分页算法自动少放几条，使各页总高一致。
  var STD_ROW_H = 41;                          // 与 CSS `tbody tr { height:41px }` 对齐
  var ROWS_PER_PAGE = 10;                      // 统一按 10 行高度预留（两表一致）
  // 表格自带 margin-top（18px）会把整张表往下推，这里归零，容器只按「表头 + 10 行」预留。
  if (tbl && tbl.style.marginTop !== '0px') { tbl.style.marginTop = '0'; }
  var full = (head ? Math.round(head.getBoundingClientRect().height) : 0) + STD_ROW_H * ROWS_PER_PAGE;
  // V1.7.0：不再用固定 height —— 固定 height 与 overflow:auto 组合时，当页行数不足 10 行，
  // 行盒高度与容器高度不一致，后面的翻页行会被「吸」上来几像素（实测 -6px 重叠）。
  // 改用「min-height + 底部内边距」：表格本身撑到行数高度，不足 10 行的差额用 padding-bottom 补齐，
  // 这样容器实际占位始终 = 10 行，翻页行严丝合缝贴在下方。
  var contentH = tbl ? Math.round(tbl.getBoundingClientRect().height) : 0;
  // 归零 margin-top 后重新量一次实际占位高度（表格自身可能有 border/间距）
  var tblBoxH = tbl ? Math.round(tbl.offsetHeight + (parseFloat(getComputedStyle(tbl).marginBottom) || 0)) : 0;
  var used = Math.max(contentH, tblBoxH);
  var pad = Math.max(0, full - used);
  wrap.style.height = '';
  wrap.style.minHeight = '';
  wrap.style.paddingBottom = pad + 'px';
  wrap.style.boxSizing = 'border-box';
  wrap.__fullH = full;
}
document.getElementById('satPager').addEventListener('click', function (e) {
  var b = e.target.closest('button[data-spg]');
  if (!b || b.disabled) return;
  var p = +b.getAttribute('data-spg');
  if (p === S.tpage) { renderTable(); return; }   // 点的是当前页：直绘，不做无意义的淡出
  S.tpage = p;
  fadeTableSwap(tbody, renderTable);              // V1.8.0（需求Q4-④）：淡消失 → 换页 → 淡出现
});
// V1.8.0（需求5）：两张表的分页器都支持「点当前页码 → 输入 → 跳页」
bindPagerJump('satPager', 'spg', function () { return SAT_PAGES; },
  function (p) {
    if (p === S.tpage) { renderTable(); return; }
    S.tpage = p; fadeTableSwap(tbody, renderTable);
  }, renderTable);
bindPagerJump('pager', 'pg', function () { return LAUNCH_PAGES; },
  function (p) {
    if (p === S.page) { renderLaunchTable(); return; }
    S.page = p; fadeTableSwap(document.getElementById('launchBody'), renderLaunchTable);
  }, renderLaunchTable);
function linkHtml(seg) {
  // seg: {t, u?} → 有词条链接就带链接，否则纯文本
  if (!seg) return '';
  var txt = String(seg.t == null ? '' : seg.t);
  if (LANG === 'en') txt = txt.replace(/^长征五号B/, 'CZ-5B').replace(/^长征八号甲/, 'CZ-8A')
    .replace(/^长征八号/, 'CZ-8').replace(/^长征六号甲/, 'CZ-6A').replace(/^长征六号/, 'CZ-6')
    .replace(/^长征十二号乙/, 'CZ-12B').replace(/^长征十二号/, 'CZ-12').replace(/^长征二号丁/, 'CZ-2D')
    .replace(/^朱雀二号E/, 'ZQ-2E').replace(/^引力一号/, 'Gravity-1').replace(/^远征二号/, 'YZ-2')
    // V1.3.7：试验星与高轨批次新增的火箭
    .replace(/^长征二号丙/, 'CZ-2C').replace(/^捷龙三号/, 'SD-3').replace(/^长征三号乙/, 'CZ-3B')
    .replace(/^长征十号乙/, 'CZ-10B').replace(/^快舟一号甲/, 'KZ-1A')
    .replace(/^远征一号S/, 'YZ-1S').replace(/^远征三号/, 'YZ-3')
    // V1.4.7：发射地点的英文官方口径 —— 陆地中心用缩写 + 空格 + 工位编号；
    // 海上用「海域英文名 + 空格 + 船名英文」；没有编号的场坪统一 Launch Pad Apron。
    .replace(/^海阳\s*东海海域/, 'East China Sea')
    .replace(/^南海/, 'South China Sea').replace(/^东海/, 'East China Sea')
    .replace(/^黄海/, 'Yellow Sea,').replace(/^渤海/, 'Bohai Sea')
    .replace(/^酒泉/, 'JSLC').replace(/^西昌/, 'XSLC').replace(/^太原/, 'TSLC')
    .replace(/^文昌/, 'WSLC').replace(/^海商/, 'HCSLS')
    .replace(/商火工位/, 'CACL LCC')
    .replace(/东方航天港一号/g, 'HOS-1').replace(/东方航天港号/g, 'HOS')
    .replace(/泰瑞号/g, 'TAI RUI').replace(/德渤3号/g, 'DE BO 3')
    .replace(/德浮15002/g, 'DE FU 15002').replace(/博润九州号/g, 'BO RUN JIU ZHOU')
    .replace(/德浮15001/g, 'DE FU 15001')
    .replace(/场坪/g, 'Launch Pad Apron')
    // 上面的替换会产生「JSLC LC-43/94」「South China Sea HOS」这类空格分隔，
    // 统一收紧成「, 」分隔（工位/船名与中心/海域之间）；船名内部与工位编号内部的空格不受影响。
    .replace(/^([A-Z][A-Za-z ]*?) (LC-|LCC-|CACL |Launch Pad |HOS|HOS-|OMSP)/, '$1, $2')
    .replace(/^(South China Sea|East China Sea|Yellow Sea|Bohai Sea) /, '$1, ')
    .replace(/^JSLC, CACL LCC$/, 'JSLC, CACL LCC');
  var tt = txt.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  // V1.3.7：seg.u 可能是 URL 字符串，也可能是 RAW.urls 里的下标（构建期去重后的链接表）
  var u = seg.u;
  if (typeof u === 'number') u = (RAW.urls || [])[u];
  if (!u) return tt;
  // V1.3.6：可跳转的项（运载火箭 / 发射地点）染主题色并加下划线
  return '<a class="wl" href="' + u + '" target="_blank" rel="noopener">' + tt + '</a>';
}
var PAGE_SIZE = 10;
// 待编目批次的目录摘要：不再铺在表格里，改为「待编目 ×N」标签的 title（悬停可见）
function pendTitle(p) {
  var en = LANG === 'en';
  var nm = p.nm && p.nm.length ? '（' + p.nm[0] + (p.nm.length > 1 ? ' … ' + p.nm[1] : '') + '）' : '';
  var txt = t('d_pend_sum') + '：COSPAR ' + p.cospar +
    '\nNORAD ' + p.noradMin + '–' + p.noradMax +
    '\n' + t('d_pend_obj') + ' ' + p.n + nm +
    '\nT=' + p.period.toFixed(1) + (en ? ' min' : ' 分') +
    ' · i=' + p.inc.toFixed(1) + '° · ' + (en ? 'alt ' : '高度 ') + p.perigee + '–' + p.apogee + ' km';
  return txt.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function renderLaunchTable(jumpToSel) {
  var st = cur();
  var rows = st.launches.slice().sort(function (a, b) { return b.dateMs - a.dateMs; });
  // V1.7.0（任务1）：发射表所有行都是单行（td white-space:nowrap），行高固定 41px，
  // 因此每行计 1 个「行单元」—— 不再拿火箭名+地点长度去算，否则一页只放 5 条。
  var rkText = function (L) { return 1; };
  var pages = pageCount(rows, PAGE_SIZE, rkText);
  if (S.page >= pages) S.page = pages - 1;
  if (S.page < 0) S.page = 0;
  var _lb = pageBounds(rows, S.page, PAGE_SIZE, rkText);
  var slice = rows.slice(_lb[0], _lb[1]);
  // 选中卫星所属批次 → 高亮对应发射记录；必要时自动翻到该页
  var selLk = {};
  S.sel.forEach(function (i) { var s = st.sats[i]; if (s) selLk[s.lk] = 1; });
  var keys = Object.keys(selLk);
  if (jumpToSel && keys.length) {
    var onPage = slice.some(function (L) { return selLk[L.key]; });
    if (!onPage) {
      for (var pp = 0; pp < pages; pp++) {
        var bb2 = pageBounds(rows, pp, PAGE_SIZE, rkText);
        if (rows.slice(bb2[0], bb2[1]).some(function (L) { return selLk[L.key]; })) {
          S.page = pp; break;
        }
      }
      var lb2 = pageBounds(rows, S.page, PAGE_SIZE, rkText);
      slice = rows.slice(lb2[0], lb2[1]);
    }
  }
  LAST_LAUNCH_ROWS = rows;
  document.getElementById('launchBody').innerHTML = slice.map(launchRowHtml).join('');
  // 分页（与卫星表同款：宽屏一行、窄屏两行）
  LAUNCH_PAGES = pages;                           // V1.8.0（需求5）：跳页输入框的钳制上限
  document.getElementById('pager').innerHTML = pagerHtml(S.page, pages, 'pg', 'd_page', 'launch');
  fixTableHeight('#sec-launches .table-wrap');
}
document.getElementById('pager').addEventListener('click', function (e) {
  var b = e.target.closest('button[data-pg]');
  if (!b || b.disabled) return;
  var p = +b.getAttribute('data-pg');
  if (p === S.page) { renderLaunchTable(); return; }
  S.page = p;
  fadeTableSwap(document.getElementById('launchBody'), renderLaunchTable);   // V1.8.0（需求Q4-④）
});
// 批次表：整行可点（V1.3.4）= 选中整批，在图表 / 地图 / 地球与卫星表里联动高亮，
// 卫星表自动翻到当前排序下该批第一颗所在的页；点链接不触发
document.getElementById('launchBody').addEventListener('click', function (e) {
  // 发射历史：整行可选中该批次（行带 data-lk）；点链接时照常打开，不影响选中
  var tr = e.target.closest('tr[data-lk]');
  if (tr) {
    e.stopPropagation();
    selectGroup(tr.getAttribute('data-lk'));
    return;
  }
  if (e.target.closest('a')) return;
  clearSel();
});
document.getElementById('sec-launches').addEventListener('click', function (e) {
  if (e.target.closest('a') || e.target.closest('#launchBody tr')) return;
  clearSel();
});

// ---------------------------------------------------------------- 头部
function renderHeader() {
  var st = cur();
  var gw = S.key === 'gw';
  // 选中框 / 框选色带 / README 按键 / 弹窗链接 = 星座主题色（星网红 / 千帆蓝）
  document.documentElement.style.setProperty('--row-sel', gw
    ? (isLight() ? '#c92a2a' : '#ff6b6b')
    : (isLight() ? '#1864ab' : '#4dabf7'));
  // V1.7.0 第三轮（需求2）：主题色缓存（TC）此前只在明暗切换时失效 →
  // 切星座后 C.theme 一直停在第一个星座的主题色（观测点虚线框两边同色）。这里设完立刻失效。
  refreshTheme();
  document.documentElement.style.setProperty('--sel-bg', gw
    ? (isLight() ? 'rgba(201,42,42,0.10)' : 'rgba(255,107,107,0.10)')
    : (isLight() ? 'rgba(25,113,194,0.10)' : 'rgba(77,171,247,0.10)'));
  var cls = gw ? 'c-gw' : 'c-qf';
  // V1.7.0 第四轮（需求5a）：
  //   ① 英文星座名换全称/并称（CSCN/GW、SpaceSail/Qianfan），中文不变（顶栏按钮仍是 星网/千帆、CS/SS）；
  //   ② 英文去掉 Orbit ——「… Constellation Live Status」；
  //   ③ 断行：宽屏两行（名字 + Constellation / Live Status）；窄屏三行（名字 / Constellation / Live Status）。
  //      .br-title-narrow 只在 ≤1100px 生效。**`<br>` 前面必须留一个空格**：宽屏下这个 <br> 是 display:none，
  //      没有空格就会拼成「CSCN/GWConstellation」（实测踩过）；窄屏下有 <br> 强制换行，
  //      行尾空格按 CSS 规则被吃掉，不会留下尾巴。
  var nameHtml = '<a class="tt-link ' + cls + '" href="' + (gw ? WIKI.gw : WIKI.qf) +
    '" target="_blank" rel="noopener">' + t(gw ? 'cn_gw_long' : 'cn_qf_long') + '</a>';
  var titleHtml = (LANG === 'en')
    ? nameHtml + ' <br class="br-title-narrow">Constellation<br>' + t('d_title_suffix_en')
    : nameHtml + t('d_title_suffix_zh') + '<br>' + t('d_title_suffix_en');
  document.getElementById('heroTitle').innerHTML = titleHtml +
    '<span class="en" id="heroEn">' + (gw ? 'CSCN / SATNET — CHINA SATELLITE CONSTELLATION NETWORK' : 'QIANFAN / THOUSAND SAILS — SPACESAIL CONSTELLATION') + '</span>';
  // V1.3.5：Constellation 一行（中英都）用标准名称 + 染色粗体缩写，与下方简介同一套口径
  var ORG_EN = { gw: 'China Satellite Network Group', qf: 'Shanghai Spacecom Satellite Technology' };
  var ORG_ABBR = { gw: 'CSCN', qf: 'SPACESAIL' };
  var enLang = LANG === 'en';
  document.getElementById('kvGroupVal').innerHTML = gw
    ? (enLang ? 'CSCN · ' + ORG_EN.gw + ' (<b class="c-gw">' + ORG_ABBR.gw + '</b>)'
              : '星网 · ' + st.org)
    : (enLang ? 'Qianfan · ' + ORG_EN.qf + ' (<b class="c-qf">' + ORG_ABBR.qf + '</b>)'
              : '千帆 · ' + st.org);
  // V1.3.6：顶部三项计数一律以卫星百科词条为准，括号内分项照搬词条原文（不改写、不加"＝"）。
  // 本页真正有完整轨道要素、能实时推算位置的颗数放在下一行与 tooltip 里，作为 TLE 侧的核对。
  var wiki = (RAW[S.key] && RAW[S.key].wiki) || null;
  var ENSW = LANG === 'en';
  function wikiTitle() {
    return ENSW
      ? 'Counted as in the Satellite Wiki article "' + wiki.article + '" (' + wiki.asOf + '). This page propagates ' + st.sats.length + ' satellites live; the rest are early test satellites, CSCN GEO service satellites, or groups whose full elements are not public yet.'
      : '按卫星百科「' + wiki.article + '」词条 ' + wiki.asOf + ' 的口径计。本页实时推算其中 ' + st.sats.length + ' 颗；其余为早期试验星、星网高轨业务星，或尚未公开完整轨道要素的新批次。';
  }
  function statWiki(el, w, unit, withTrack) {
    if (!wiki || !w) {
      el.textContent = (withTrack ? st.sats.length : st.launched) + ' ' + unit;
      return;
    }
    var html = w.n + ' ' + unit + '<i class="sub2">' + paren(ENSW ? w.en : w.zh) + '</i>';
    if (withTrack) {
      html += '<br><i class="sub">' + t('d_page_track') + st.sats.length + t('d_page_track2') +
        (st.pendingCount ? t('d_more_pending') + st.pendingCount + t('d_more_pending2') : '') + '</i>';
    }
    el.innerHTML = html;
    el.title = wikiTitle();
  }
  statWiki(document.getElementById('mSats'), wiki && wiki.inOrbit, t('d_in_orbit'), true);
  statWiki(document.getElementById('mLaunched'), wiki && wiki.launched, (ENSW ? 'sats' : '颗'), false);
  var okEl = document.getElementById('mLaunchOk');
  if (wiki) {
    okEl.innerHTML = wiki.launches + (ENSW ? ' launches' : ' 次');
    okEl.title = wikiTitle();
  } else {
    var ls = st.launchStat;
    okEl.innerHTML = ls.success + ' / ' + ls.total + (ENSW ? ' launches' : ' 次');
    okEl.title = '';
  }
  var mGroups = document.getElementById('mGroups');
  mGroups.textContent =
    st.launches.filter(function (L) { return L.sats.length; }).length + t('d_groups_stat') + st.launches.length + t('d_groups_total');
  mGroups.title = t('d_groups_note');
  document.getElementById('mAlt').textContent = fmtNum(st.avgAlt, 1) + ' km' + paren(fmtNum(st.minAlt, 0) + '–' + fmtNum(st.maxAlt, 0));
  document.getElementById('mInc').textContent = st.incList.map(function (v) { return v.toFixed(1) + '°'; }).join(' / ');
  document.getElementById('mFirst').textContent = isFinite(st.firstMs)
    ? new Date(st.firstMs).toISOString().slice(0, 10) + t('d_bjtime') : '—';
  // V1.7.0 第四轮（需求5b）：简介按用户口径重写 ——
  //   星座名/别称 = 加粗 + 主题色；运营方/主办方 = 仅加粗；其余（制造商等）维持原有加粗。
  document.getElementById('heroNote').innerHTML = gw
    ? (LANG === 'en'
      ? 'The <b class="c-gw">China Satellite Constellation Network</b> (<b class="c-gw">CSCN</b>) or <b class="c-gw">GW Constellation</b> is China\'s national LEO satellite internet constellation project, led by <b>China Satellite Network Group</b>.'
      : '<b class="c-gw">中国星网</b>（<b class="c-gw">CSCN</b>, China Satellite Constellation Network），也称“国网星座”，是由<b>中国卫星网络集团有限公司</b>主导建设的国家级低轨卫星互联网星座工程。')
    : (LANG === 'en'
      ? 'The <b class="c-qf">Qianfan Constellation</b>, also known as the “<b class="c-qf">SpaceSail Constellation</b>” or “<b class="c-qf">G60 Starlink</b>”, is a large LEO internet constellation under construction in China. Operator: <b>Shanghai Spacecom Satellite Technology (SPACESAIL)</b>; manufacturers: <b>Genesat Space Technology (Genesat)</b> and <b>Shanghai Engineering Center for Microsatellites (Microsat)</b>; supporting: <b>Shanghai Diais Digital Technology</b>.'
      : '<b class="c-qf">千帆星座</b>，也称“<b class="c-qf">G60星链</b>”，是中国正在建造的大型卫星互联网星座。现阶段卫星运营方为<b>上海垣信卫星科技有限公司</b>，制造方为上海格思航天科技有限公司、上海微小卫星工程中心，配套方为上海迪爱斯数字科技有限公司。');
  // V1.7.0 第四轮（需求2）：卫星百科数据截至日（wiki.json 的 asOf；构建时内置 + 运行时可被 wiki.json 覆盖）
  // V1.7.2（需求3）：卫星百科的核对时间改为显示**精确到时分**的 checkedAt
  //   （任务每天 00:00 与 12:00 各跑一次，只显示日期已经分不清是哪一次）。
  //   checkedAt 由 fetch_wiki.mjs 写入，且**只在两个星座都成功读到时**才前进 ——
  //   有星座失败/降级时保留旧值，不会宣称"今天核对过"。
  //   旧存档没有 checkedAt 时回落到 asOf（只有日期）。
  var wu = document.getElementById('mWikiUpd');
  if (wu) {
    var wTxt = (wiki && wiki.checkedAt) ? wiki.checkedAt
             : (wiki && wiki.asOf) ? wiki.asOf : '';
    wu.textContent = wTxt ? wTxt + t('d_bjtime') : '—';
  }
  // V1.7.2 第七轮（需求2/6）：顶栏那行历元已整体删除（连同五个章节链接）。
  //   现在**页面上唯一**显示「TLE 更新时间」的地方，就是主标题「中国低轨互联网卫星在轨态势」
  //   下方这一行（#pageEpoch），并且所有宽度 + 中英文都显示（不再只在窄屏出现）。
  //   命名口径统一为 TLE 更新时间（= 本星座目录里最新的那份要素历元）。
  var pe = document.getElementById('pageEpoch');
  if (pe) pe.textContent = t('d_dataupd') + ' ' + fmtUTC(st.epochMax) + ' UTC';
  // V1.7.1（需求3）：顶栏三键改绝对定位后，nav-right 需要按按钮实际宽度让位 → 重算
  layoutNav();
  var pendN = st.launches.reduce(function (a, L) { return a + (L.pending > 0 && L.pinfo ? L.pinfo.n : 0); }, 0);
  // V1.3.6：三处说明文字按用户要求精简 —— 章节下方只留最必要的一句，细节统一搬到「说明」里
  document.getElementById('chartNote').textContent = pendN ? t('d_pend_ghost') : '';
  document.getElementById('mapNote').textContent = t('d_map_note');
  document.getElementById('globeNote').textContent = t('d_globe_note_1');
}

// ---------------------------------------------------------------- 事件
function rebuild() {
  buildChartPoints(); chartAutoView();
  renderHeader(); renderTable(); renderLaunchTable(); renderLegend();
  fillGroupSelect(); drawChart();
  try { netInvalidate(); drawNet(); } catch (e) {}   // V1.8.0（需求8）：曲线颜色随星座主题色 → 重建时重画
  // V1.9.0（R17）：05 章同理。**必须在这里重画**——本章的图下说明（#climbNote）与
  //   选择器（#climbSel 的 <option>）都是 JS 用 t() 现写进 DOM 的，不带 data-i18n 属性，
  //   所以 applyStaticLang 刷不到它们；切语言时若不重画，英文界面就会残留中文
  //   （i18n.mjs 审计实测抓到过：默认项「跟随选中」与「本章暂无历史轨道数据」两处）。
  try { CLIMB = null; renderClimbSel(); renderClimbTake(); drawClimb(); } catch (e) {}
  mapTrackCache.key = null; globeTrackCache.key = null;
}
function fillGroupSelect() {
  var sel = document.getElementById('groupSel'), st = cur();
  sel.innerHTML = '<option value="all">' + t('d_grp_all') + st.sats.length + t('d_grp_all2') + '</option>' +
    st.launches.filter(function (L) { return L.sats.length; }).map(function (L) {
      return '<option value="' + L.key + '">' + batchName(L.name) + ' · ' + L.sats.length + ' · ' + L.dateStr.slice(0, 10) + '</option>';
    }).join('');
  sel.value = S.launchFilter;
  if (sel.value !== S.launchFilter) S.launchFilter = 'all';
}


// ================================================================ V1.6.0 动画编排
// 设计约定：
//  · 总时长统一 --anim-t（520ms），各动效同时开始、同时结束；
//  · 页面内容用"两段式"完成顶出效果（先滑出旧内容、再滑入新内容），两段合计 = 总时长；
//  · 除动画外不改变任何既有逻辑：数据切换仍调用原来的 update() 回调。
// V1.7.0 二轮（清理）：这里原先还有一版 window.placeChartSearch（把搜索框插到"模型"之后），
// 已被文件末尾「V1.6.1 续」的定版覆盖，属于永不会执行的死代码，已删除。
// 现存的唯一实现见文件末尾「====== 轨道分布全屏搜索框位置（定版）」。
var ANIM = { t: 520, half: 260, lang: 620, langHalf: 310 };   // V1.6.1：语言切换缩短一档   // V1.6.0：语言切换单独一档时长

// 参与水平平移的容器（排除顶栏与所有固定定位元素，避免破坏其定位）
function pgContainers() {
  return Array.prototype.slice.call(document.querySelectorAll('section, .hero, footer, .foot-wrap'));
}
function replay(el, cls) {
  el.classList.remove('pg-anim-out-l', 'pg-anim-in-r', 'pg-anim-out-r', 'pg-anim-in-l');
  void el.offsetWidth;                       // 强制重排，保证动画能重新触发
  if (cls) el.classList.add(cls);
}

// ① 星座按钮的滑动色块
function moveConstelSlider(toKey, animate) {
  var seg = document.getElementById('constelSeg'); if (!seg) return;
  var btns = seg.querySelectorAll('button[data-c]');
  var target = null;
  for (var i = 0; i < btns.length; i++) if (btns[i].getAttribute('data-c') === toKey) target = btns[i];
  if (!target) return;
  var sl = seg.querySelector('.seg-slider');
  if (!sl) {
    sl = document.createElement('div');
    sl.className = 'seg-slider';
    // V1.7.0 第三轮末修正②：滑块挂在两个按钮**之后**。
    // 这样 CSS 才能用 `.constel button[data-c="gw"].on ~ .seg-slider` 按当前选中项取主题色，
    // 不需要在 JS 里手工配颜色（也就不会在切深浅主题时留下过期的内联色）。
    // 层级不靠 DOM 顺序：按钮 z-index:2 / 滑块 z-index:1，滑块仍压在文字下面。
    seg.appendChild(sl);
  }
  var segRect = seg.getBoundingClientRect(), bRect = target.getBoundingClientRect();
  if (!animate) sl.style.transition = 'none';
  sl.style.width = Math.round(bRect.width) + 'px';
  sl.style.transform = 'translateX(' + Math.round(bRect.left - segRect.left) + 'px)';
  if (!animate) { void sl.offsetWidth; sl.style.transition = ''; }
}

// ② 顶栏 CISTrack 标志：新颜色从右往左扫过取代旧颜色
function themeAccent(key) {
  var v = getComputedStyle(document.documentElement).getPropertyValue(key === 'qf' ? '--c-qf' : '--c-gw').trim();
  return v || 'var(--fg)';
}
// dir = 1：新色从右往左扫入（星网→千帆）；dir = -1：从左往右（千帆→星网，完全对称）
// V1.7.1（需求9）：这里原来在收尾时 setProperty('--brand-c')，而 CSS 里 --brand-c 是死变量
//   （同一声明块里第二条 color:var(--row-sel) 恒赢），那个值没有任何地方在读 → 已连同 CSS 一起删掉。
//   真正要修的是**渐变可能永久留在屏幕上**：旧实现只靠一个 setTimeout 收尾，
//   一旦标签页切后台 / rAF 被节流 / 用户连续快速切星座，收尾就不执行，
//   内联的 color:transparent + background-clip:text 会一直挂着 —— 用户看到的就是
//   「品牌红偶尔比平时更鲜艳」（双色渐变中段混合色）。现在做三件事：
//   ① 幂等守卫：动画期间再来一次，先立刻收尾上一次，绝不叠加两个渐变；
//   ② 收尾函数幂等 + 显式清每一项内联属性（原来只 cssText='' 全清，会把别的代码写的内联样式也抹掉）；
//   ③ 页面切回前台时若动画还挂着，立即收尾（防后台节流）。
var SWEEP_TID = 0;
function brandSweepFinish() {
  if (SWEEP_TID) { clearTimeout(SWEEP_TID); SWEEP_TID = 0; }
  var e = document.querySelector('.brand-name'); if (!e) return;
  e.style.backgroundImage = '';
  e.style.backgroundSize = '';
  e.style.backgroundPosition = '';
  e.style.webkitBackgroundClip = '';
  e.style.backgroundClip = '';
  e.style.transition = '';
  e.style.color = '';              // 交回 CSS 的 --row-sel
  e.__sweeping = false;
}
function sweepBrandColor(dir, toKey) {
  var el = document.querySelector('.brand-name'); if (!el) return;
  if (el.__sweeping) brandSweepFinish();      // ① 上一次没收尾就先收干净
  var newC = themeAccent(toKey);
  // 旧色只认 CSS 的计算值；收尾后已清掉内联 color，这里读到的就是 --row-sel
  var oldC = getComputedStyle(el).color;
  if (!oldC || oldC === 'rgba(0, 0, 0, 0)' || oldC === 'transparent') oldC = newC;
  // 双色各占一半、紧贴无缝；靠 background-position 平移完成扫过
  var stops = dir === 1
    ? oldC + ' 0 50%, ' + newC + ' 50% 100%'
    : newC + ' 0 50%, ' + oldC + ' 50% 100%';
  var startPos = (dir === 1 ? '0%' : '100%') + ' 0';
  var endPos = (dir === 1 ? '100%' : '0%') + ' 0';
  el.__sweeping = true;
  el.style.backgroundImage = 'linear-gradient(90deg, ' + stops + ')';
  el.style.backgroundSize = '200% 100%';
  el.style.webkitBackgroundClip = 'text';
  el.style.backgroundClip = 'text';
  el.style.color = 'transparent';
  el.style.transition = 'none';
  el.style.backgroundPosition = startPos;
  void el.offsetWidth;                  // 起点先落地（强制重排）
  // V1.6.0：终点放到下一帧再设 —— 同一帧内设起点与终点会被浏览器合并，导致"瞬间变色"（反向时尤其明显）
  requestAnimationFrame(function () {
    if (!el.__sweeping) return;         // 期间已被收尾（快速连点），别再启动
    el.style.transition = 'background-position var(--anim-half) var(--ease-slow-fast)';
    el.style.backgroundPosition = endPos;
  });
  // ③ 兜底：动画时长的一半 + 一点余量。visibilitychange 里还会再补一刀。
  SWEEP_TID = setTimeout(brandSweepFinish, ANIM.half + 60);
}
document.addEventListener('visibilitychange', function () {
  // 切回前台时若品牌渐变还挂着（后台节流导致收尾没跑），立刻收干净，别让用户看见半程色
  if (!document.hidden) { try { brandSweepFinish(); } catch (e) {} }
});
// V1.7.1（需求9）：syncBrandColor 原本给 --brand-c 赋值，而该变量已在 CSS 里删除（死变量）→ 整个函数无意义，一并删。
// ③ 章节切换药丸：边框色先熄灭、再亮起为新颜色
function pulseJumpPill() {
  var pill = document.getElementById('jumpPill'); if (!pill) return;
  var cs = getComputedStyle(pill);
  var hadBorder = parseFloat(cs.borderTopWidth) > 0;
  var target = hadBorder ? cs.borderTopColor : 'transparent';
  pill.style.transition = 'border-color ' + (ANIM.half / 2) + 'ms var(--ease-slow-fast)';
  pill.style.borderColor = 'transparent';
  setTimeout(function () {
    pill.style.borderColor = hadBorder ? target : 'transparent';
    setTimeout(function () { pill.style.transition = ''; pill.style.borderColor = ''; }, ANIM.half / 2 + 40);
  }, ANIM.half / 2);
}

// ④ 统一入口：四联动效同时开始 → 半程处替换数据 → 后半程滑入新内容
function playNetSwitch(fromKey, toKey, updateFn) {
  var rightToLeft = (fromKey === 'gw' && toKey === 'qf');     // 星网在左、千帆在右
  var conts = pgContainers();
  var outCls = rightToLeft ? 'pg-anim-out-l' : 'pg-anim-out-r';
  var inCls = rightToLeft ? 'pg-anim-in-r' : 'pg-anim-in-l';
  conts.forEach(function (c) { replay(c, outCls); });          // ① 页面内容先慢后快滑出
  moveConstelSlider(toKey, true);                              // ② 反色块平滑移动
  sweepBrandColor(rightToLeft ? 1 : -1, toKey);                 // ③ 标志变色扫过（方向与页面一致）
  pulseJumpPill();                                             // ④ 药丸边框先灭后亮
  setTimeout(function () {
    try { updateFn(); } catch (e) {}
    conts.forEach(function (c) { replay(c, inCls); });          // 后半程：新内容先快后慢滑入
    setTimeout(function () {
      conts.forEach(function (c) { replay(c, null); });
    }, ANIM.half + 60);
  }, ANIM.half);
}

// ---------------------------------------------------------------- V1.7.0 第三轮（需求1）：两星座各自保存全部状态
// 此前切星座会清空选中、并让两星座共用同一份设置与视图位置。此处给每个星座一份快照：
//   · 选中态**按 NORAD 存取**（S.sel 存的是本星座数组下标，跨星座直接恢复会选错卫星）；
//   · 观测点的屏幕坐标 mx/my 属于「上一屏」，载入时必须清空，只保留经纬度/仰角/是否固定；
//   · 表格页码跨星座要 clamp（两星座行数不同）。
var STATE_FIELDS = ['selGroup', 'focusIdx', 'colorMode', 'model', 'mode', 'launchFilter',
  'time', 'names', 'cov', 'pick', 'cone', 'mz', 'mapTrack', 'page', 'tpage',
  'spin', 'showTracks', 'allCols', 'sortKey', 'sortAsc',
  'netGw', 'netQf',
  'climbPick', 'climbTake'];   // V1.9.0（需求3）：04 章的「显示星网/显示千帆」改为按星座各存一份
   // V1.9.0（R17）：05 章的「对象选择」与「纵轴量」同样按星座各存一份
   // 'time'：V1.7.3 需求9，随星座快照各存一份
var STORE = { gw: null, qf: null };   // 每个星座一份快照；null = 还没建过
// ★ V1.7.0 第三轮末修正⑤：图表的缩放/平移（chartView）也要各星座独立。
//   它不在 STATE_FIELDS 里（不是 S 的字段，而是一个独立的模块变量），
//   而且 rebuild() 里的 chartAutoView() 会把它重置成「自动」，所以
//   不能在 applyConstel 里直接写 —— 先寄存在这里，等 rebuild 之后再真正落回去。
var pendingChartView = null;
// ★ 出厂默认值：在任何用户改动之前先拍一份下来。
//   否则目标星座"还没建过快照"时只能保持当前星座的值 → 表现为「改了最低仰角，切过去另一个也跟着变」。
var STORE_DEF = null;                  // { gw:{…}, qf:{…} }
function cloneVal(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.slice();
  var o = {}; for (var k in v) o[k] = cloneVal(v[k]); return o;
}
function selNorad() {
  var out = [];
  try { S.sel.forEach(function (i) { var s = cur().sats[i]; if (s) out.push(s.norad); }); } catch (e) {}
  return out;
}
function snapConstel() {
  var o = { selNorad: selNorad(), globe: { yaw: G.yaw, pitch: G.pitch, zoom: G.zoom },
    chartView: chartView ? cloneVal(chartView) : null,
    scrollY: S.scrollY[S.key] };
  STATE_FIELDS.forEach(function (k) { o[k] = cloneVal(S[k]); });
  STORE[S.key] = o;
}
function applyConstel() {
  // 没有自己的快照 → 用出厂默认（而不是"保持当前星座的值"，那正是设置联动的根因）
  var o = STORE[S.key] || (STORE_DEF ? STORE_DEF[S.key] : null);
  if (!o) return;
  STATE_FIELDS.forEach(function (k) { if (o[k] !== undefined) S[k] = cloneVal(o[k]); });
  // 观测点的屏幕坐标属于上一屏 → 清空（否则鼠标一动就会跳）
  if (S.pick) { S.pick.mx = null; S.pick.my = null; }
  // 选中态按 NORAD 换算回本星座的下标；这个星座没有的就跳过
  S.sel = []; S.focusIdx = null;
  try {
    (o.selNorad || []).forEach(function (nid) {
      cur().sats.forEach(function (sc, i) { if (sc && sc.norad === nid) S.sel.push(i); });
    });
    if (S.focusIdx != null && S.sel.indexOf(S.focusIdx) < 0) S.focusIdx = S.sel.length ? S.sel[S.sel.length - 1] : null;
  } catch (e) {}
  if (o.globe) { G.yaw = o.globe.yaw; G.pitch = o.globe.pitch; G.zoom = o.globe.zoom; }
  // 图表视图：先寄存，等 rebuild() 的 chartAutoView() 跑完再由 afterConstelSwap 落回
  pendingChartView = o.chartView ? cloneVal(o.chartView) : null;
}
// 切换后的统一收口：重画三处 + 校正时间与页码，避免闪一帧「另一个星座的视图」
// 首次进入某个星座前，把它初始化为出厂默认（保证两个星座从一开始就是各自独立的）
function initStore() {
  if (STORE_DEF) return;
  STORE_DEF = { gw: null, qf: null };
  ['gw', 'qf'].forEach(function (k) {
    var sk = S.key, sg = S.netGw, sq = S.netQf, sp = S.climbPick, stk = S.climbTake;
    S.key = k;
    // V1.9.0（需求3）：本页出厂默认 = **只看本星座** —— 必须在这个"逐星座快照"的循环里按 k 赋值，
    //   这样 STORE_DEF.gw / STORE_DEF.qf 各自记下"只看自己"，两个页面从此天然独立、互不联动。
    applyNetShowDefault(k);
    // V1.9.0（R17）：05 章同理按星座各存一份出厂默认（对象选择跟随选中 / 纵轴看半长轴）
    S.climbPick = ''; S.climbTake = 'sma';
    STORE_DEF[k] = { selNorad: [], globe: { yaw: G.yaw, pitch: G.pitch, zoom: 1 }, scrollY: 0 };
    STATE_FIELDS.forEach(function (f) { STORE_DEF[k][f] = cloneVal(S[f]); });
    S.key = sk; S.netGw = sg; S.netQf = sq; S.climbPick = sp; S.climbTake = stk;
  });
}
// ---------------------------------------------------------------- V1.7.0 第三轮末
// 把 S 里的设置**回写到各个控件**（滑条、数值框、开关、分段按钮、下拉）。
// 之前没有这个函数：控件的显示值只来自 HTML 的 value 属性，切星座后仍是上一个星座的，
// 于是"看着就同步了"，而且用户一动还会把旧值写回 S。
function syncControlsFromS() {
  try {
    function rng(id, v) { var e = document.getElementById(id); if (e) e.value = String(v); }
    function num(id, v) { var e = document.getElementById(id); if (e) e.textContent = (Math.round(v * 10) / 10).toFixed(1) + '°'; }
    function tog(id, on) {
      var e = document.getElementById(id); if (!e) return;
      e.classList.toggle('on', !!on);
      if (e.hasAttribute('aria-pressed')) e.setAttribute('aria-pressed', String(!!on));
    }
    // 01 地图
    rng('covEl', S.cov.el); num('covNum', S.cov.el); tog('covBtn', S.cov.on);
    rng('pickEl', S.pick.el); num('pickNum', S.pick.el); tog('pickBtn', S.pick.on);
    tog('mapTracksBtn', S.mapTrack); tog('mapNamesBtn', S.names.map);
    // 02 轨道
    rng('coneEl', S.cone.el); num('coneNum', S.cone.el); tog('coneBtn', S.cone.on);
    tog('spinBtn', S.spin); tog('tracksBtn', S.showTracks); tog('namesGlobeBtn', S.names.globe);
    // 时间条：全页两条（地图 1325 区 / 轨道 1378 区），共用同一个偏移。
    // ★ 这里必须走 setOffset()，而不是只改某个 input 的 value ——
    //   V1.7.0 第三轮末修正①：原来这里查的是「#sec-chart 里的 .time-r」——
    //   但页面上**根本没有** #sec-chart .time-r 这个元素（真正的两条都在地图/轨道章节里），
    //   于是切星座时两条真实滑条一直停留在上一星座的旧值。用户一切过去看到滑条还在原位，
    //   再一拖就把旧值写回 S.timeOffset → 表现就是"两边时间条联动"，怎么改都不独立。
    //   setOffset() 同时刷新：两条滑条的 value、右侧「实时 / +X 分」按钮文案、shifted 高亮、
    //   全屏时钟状态。改完这里，时间条才真正跟着星座各走各的。
    if (typeof syncTimeUI === 'function') syncTimeUI();
    else { var tmv = document.querySelectorAll('.time-r'); for (var ti = 0; ti < tmv.length; ti++) tmv[ti].value = String(S.time[timeView(tmv[ti])].off); }
    // 染色方式（按卫星 / 按批次）
    // ★ 选择器必须是 `.seg[data-scope="X"]` —— 模板里就是这个名字（syncAllControls 用的也是它）。
    //   旧写法 `[data-color-scope="X"]` 在模板里**根本不存在**，兜底 `#sec-chart .seg-mini` 也不对
    //   （第三章那个容器是 `.seg`，没有 seg-mini），结果三处里只有地图/轨道被回写，
    //   第三章的「配色」永远显示上一星座的值 → 又一处"设置没完全独立"。
    ['chart', 'map', 'globe'].forEach(function (v) {
      var seg = document.querySelector('.seg[data-scope="' + v + '"]');
      if (!seg) return;
      seg.querySelectorAll('button').forEach(function (btn) {
        btn.classList.toggle('on', btn.getAttribute('data-color') === S.colorMode[v]);
      });
    });
    // 各下拉
    var ms = document.getElementById('modelSeg'); if (ms) ms.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-model') === S.model); });
    var ds = document.getElementById('modeSeg'); if (ds) ds.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-mode') === S.mode); });
    var gs = document.getElementById('groupSel'); if (gs && 'value' in gs) gs.value = S.launchFilter;
    // 表格排序：sortKey / sortAsc 也是「按星座各存一份」的（在 STATE_FIELDS 里），
    // 但表头那个 ▲/▼ 指示是**类名**，不同步就还是上一星座的 → 属于"设置没完全独立"的漏网项。
    document.querySelectorAll('#satTable thead th').forEach(function (x) {
      x.classList.remove('sorted', 'asc');
      if (x.getAttribute('data-key') === S.sortKey) { x.classList.add('sorted'); if (S.sortAsc) x.classList.add('asc'); }
    });
  } catch (e) {}
}
function afterConstelSwap() {
  syncControlsFromS();                                   // ★ 让控件显示的确实是本星座的设置
  // V1.8.0（需求Q4）：换星座 = 换了一套图层开关状态 → 动画系数必须**瞬间**对齐，
  //   否则新星座的画布会沿用上一星座的 TOG（表现为"刚切过去某图层先淡入一次"）。
  try { togSyncAll(); } catch (e) {}
  // ★ 图表缩放/平移：rebuild 已经把它重置成「自动」，这里把本星座自己那份放回去
  if (pendingChartView) { chartView = clampChartView(pendingChartView); pendingChartView = null; }   // V1.7.0 第四轮（需求3）
  try { syncResetAllBtn(); } catch (e) {}
  try { if (S.page < 0) S.page = 0; } catch (e) {}
  try { if (S.tpage < 0) S.tpage = 0; } catch (e) {}
  // V1.7.1（需求2）：换星座 = 换了一个全新的数据世界 → 解除所有「用户已关闭信息窗」的标记，
  //   否则新星座里点开信息窗会被上一星座的关闭状态挡住（要hover 别的卫星才出得来，很怪）。
  try { infoClearClosed(); } catch (e) {}
  // V1.7.1（需求7）：换星座后必须**重算**卫星表格页码 —— snapConstel 按 NORAD 恢复了 S.sel，
  //   而 S.tpage 是从快照里直接拿回来的旧页号；两个星座行数不同（星网 ~500 / 千帆 ~600+），
  //   旧页号在新星座里可能越界或指向完全不同的卫星。renderTable({jump:true}) 会按
  //   本星座的实测行高重新定位到选中项所在页。
  try { renderTable({ jump: true }); } catch (e) {}
  try { renderLaunchTable(true); } catch (e) {}
  // V1.9.0（R17）：换星座后 05 章必须**重建曲线缓存并重画** —— 它的数据挂在 RAW[key].hist 上，
  //   两个星座的历史完全不同；缓存里还记着 S.key，不清就会画出上一章星座的曲线。
  try { CLIMB = null; climbView = null; climbHover = null; climbAutoView(); renderClimbSel(); renderClimbTake(); drawClimb(); } catch (e) {}
  try { tickClock(); } catch (e) {}
  try { mapDirty = true; globeDirty = true; } catch (e) {}
  try { drawChart(); } catch (e) {}
  try { clampMZ(); } catch (e) {}
}
// 星座切换
// ══════════════════════════════════════════════════════════════════════════
// V1.7.2（需求12）：星座切换的唯一入口。
//   点顶栏按钮走它；手机端**页面空白处左右滑动**也走它 —— 两条路径共用同一套
//   动画 / 状态快照 / 滚动位置恢复逻辑，绝不会出现"滑动切过去但状态与点击不一致"。
// ══════════════════════════════════════════════════════════════════════════
function switchConstel(toKey) {
  var fromKey = S.key;
  if (fromKey === toKey) return false;              // V1.6.0：重复点击同一项不触发动画
  var seg = document.getElementById('constelSeg');
  var btn = seg ? seg.querySelector('button[data-c="' + toKey + '"]') : null;
  if (seg) seg.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === btn); });
  closeSug();
  // V1.6.0：四联动效同时开始（内容滑出 / 反色块平滑移动 / 标志变色 / 药丸边框先灭后亮），
  // 半程处替换数据（下面的逻辑与 V1.5.3 完全一致），后半程新内容滑入。
  playNetSwitch(fromKey, toKey, function () {
    try { saveSearchText(); } catch (err) {}
    // V1.7.0（任务3）：切出去之前先记下当前星座的滚动位置；切进来后恢复到目标星座自己的位置。
    try { S.scrollY[fromKey] = window.scrollY || 0; } catch (err) {}
    // V1.7.0 第三轮（需求1）：不再清空 —— 先把当前星座的完整状态存起来，再载入目标星座自己那份
    try { snapConstel(); } catch (err) {}      // V1.7.0 第四轮（需求6）：只存内存，不再落盘
    S.key = toKey;
    try { clearSel(); loadSearchText(); applyConstel(); } catch (err) {}
    resetDragTips();                            // V1.3.6：换星座 = 换窗口，拖拽提示重新出现
    rebuild();
    try { afterConstelSwap(); } catch (e) {}
    // 目标星座自己的滚动位置（两个星座互不干扰；默认 0 = 页首）
    var restoreY = S.scrollY[toKey] || 0;
    try { window.scrollTo(0, restoreY); } catch (err) {}
    setTimeout(function () { try { window.scrollTo(0, restoreY); } catch (err) {} }, ANIM.half + 80);
  });
  return true;
}
document.getElementById('constelSeg').addEventListener('click', function (e) {
  var b = e.target.closest('button[data-c]'); if (!b) return;
  switchConstel(b.getAttribute('data-c'));
});

// ── V1.7.2（需求12）：手机端「页面空白处左右滑动 = 切换星座」──
// 为什么条件这么严：页面上已有 **6 处** touch 手势会与它竞争同一根手指 ——
//   地图双指缩放 / 地球单指平移 / 图表拖动 / 抽屉 520ms 动画 / 表格横向滚动 / 页面上下滚动。
//   任何一个抢走手势都必须立刻放弃，否则会出现"看图看着看着星座被切了"。
// 六道闸门（任一不满足即放弃）：
//   ① 触屏设备 且 **非全屏**（全屏时横屏锁定 + 画布手势优先）
//   ② 落点命中的是"空白元素" —— 命中按钮 / 画布 / 信息窗 / 表格 / 控件一律不启动
//   ③ |dx| ≥ 72px
//   ④ |dx| ≥ |dy| × 2.2（接近 45° 的斜滑不响应，交给页面滚动）
//   ⑤ 速度 ≥ 0.35 px/ms（慢速拖动不响应）
//   ⑥ 方向与当前星座匹配（星网页只响应右→左，千帆页只响应左→右）
// 另外：手势期间若被任何组件 preventDefault（画布缩放 / 抽屉 / 表格），
//   说明"别人要这个手势"，立刻作废 —— 这就是 `e.defaultPrevented` 那一行的作用。
// V1.7.2 第七轮（需求7）：**从白名单里去掉 .hero 与 .sec-head** ——
//   这两个选择器把「第 0 章整块」（主标题 + 右侧参数栏 + 搜索框）与「各章标题行」
//   一并划成了"非空白"，于是手机端在搜索栏附近、主标题附近的空白处横滑全都没反应。
//   实测（v172r7_diag 的 heroHit）：落点在 page-title / page-epoch / BODY 上都没被拦，
//   只有落进 .hero（含中缝的 H1）才被拦 —— 正是用户说的"第一章以上到页面顶部这块滑不动"。
//   安全性逐项核对（这些交互元素仍被别的选择器拦住，不会误触）：
//     搜索框 input / 搜索按钮 / 还原默认按钮 / 全屏按钮 / 各章控件      → input、button
//     星座名外链 a.tt-link                                          → a
//     各章「按卫星 / 按批次」切换 .seg-mini、顶栏星座段 .seg.constel   → .seg
//     画布与信息窗（手势优先级最高，必须保留）                        → canvas/.canvas-wrap/.chart-wrap/.sat-info
//     表格、翻页条、弹窗、右下角章节药丸、缩放控件                     → .table-wrap/.pager/.modal/#jumpPill/.view-ctl
//   其余五道闸门（触屏且非全屏 / |dx|≥72px / |dx|≥2.2|dy| / 速度≥0.35px·ms⁻¹ /
//   方向匹配 / defaultPrevented）一字未动。
var SWIPE_BLANK_SEL = 'button,a,input,select,label,textarea,canvas,.sat-info,.table-wrap,' +
  '.modal,.modal-mask,.pager,.seg,.chart-wrap,.canvas-wrap,#jumpPill,.controls,.view-ctl';
var SWIPE_MIN_DX = 72, SWIPE_RATIO = 2.2, SWIPE_MIN_V = 0.35;
var swipe = null;
function swipeTouch(e, id) {
  var list = e.touches;
  for (var i = 0; i < list.length; i++) if (list[i].identifier === id) return list[i];
  return list.length ? list[0] : null;
}
document.addEventListener('touchstart', function (e) {
  swipe = null;
  if (!isTouch() || isFsMode()) return;                       // ①
  if (e.touches.length !== 1) return;                          // 多指 = 缩放，不参与
  var t = e.touches[0];
  var el = document.elementFromPoint(t.clientX, t.clientY);    // ②
  if (el && el.closest && el.closest(SWIPE_BLANK_SEL)) return;
  swipe = { x0: t.clientX, y0: t.clientY, t0: performance.now(), id: t.identifier, done: false };
}, { passive: true });
document.addEventListener('touchmove', function (e) {
  if (!swipe || swipe.done) return;
  if (e.defaultPrevented) { swipe = null; return; }            // 已被别的组件抢走 → 作废
  var t = swipeTouch(e, swipe.id);
  if (!t) { swipe = null; return; }
  var dx = t.clientX - swipe.x0, dy = t.clientY - swipe.y0;
  if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { swipe = null; return; }  // ④ 垂直意图
  if (Math.abs(dx) < SWIPE_MIN_DX) return;                    // ③
  if (Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return;       // ④
  var dt = performance.now() - swipe.t0;
  if (dt > 4 && Math.abs(dx) / dt < SWIPE_MIN_V) return;      // ⑤
  var target = (S.key === 'gw' && dx < 0) ? 'qf' :            // ⑥
               (S.key === 'qf' && dx > 0) ? 'gw' : null;
  if (!target) { swipe = null; return; }
  swipe.done = true;
  switchConstel(target);
}, { passive: true });
['touchend', 'touchcancel'].forEach(function (ev) {
  document.addEventListener(ev, function () { swipe = null; }, { passive: true });
});
// 主题
// V1.7.0 第四轮（需求6）：主题也算「设置」，所以抽调出一个 setTheme ——
//   三种还原路径（刷新 / 重新进入链接 / 点「还原所有默认设置」）必须落到同一状态。
//   刷新与重进链接都由 <head> 里的启动脚本强制回暗色，所以「还原所有默认设置」也得把主题拨回暗色，
//   否则按钮点完仍是浅色，而同样操作刷新一次就变暗 —— 三条路径不一致（这正是需求6要修的那种不一致）。
//   顺带删掉原来那句把 'theme' 写进 localStorage 的语句：那个键**从来没被读过**（启动脚本一律
//   removeAttribute，不读本地存储），属于纯冗余写入，也与「设置不落盘」的口径冲突。
function setTheme(light) {
  if (light) document.documentElement.setAttribute('data-theme', 'light');
  else document.documentElement.removeAttribute('data-theme');
  try {
    document.querySelector('meta[name=theme-color]').setAttribute('content', light ? '#f7f7f5' : '#050505');
  } catch (e) {}
  refreshTheme();
}
document.getElementById('themeBtn').addEventListener('click', function () {
  var light = document.documentElement.getAttribute('data-theme') === 'light';
  var done = false;
  // V1.8.0（需求7）：卡顿根治（时长 520ms 与圆形扩散形式都不动）——
  //   ① VT 回调里只做「换主题 + 重绘画布 + 图例」（都是廉价操作）；
  //      全表 DOM 重建（renderTable）挪到动画结束后 —— 它是扩散动画掉帧的主因；
  //   ② 动画期间给 <html> 挂 .vt-running，临时关掉全站 backdrop-filter（毛玻璃逐帧重合成）；
  //   ③ 旧版 120ms 兜底会再跑一遍完整重绘 —— 现在只兜「主题确实切换」，重绘只发生在收尾一次。
  var apply = function () {
    if (done) return; done = true;
    setTheme(!light);
    drawChart(); renderLegend();
    try { drawNet(); } catch (e) {}      // V1.8.0（需求8）：03.5 的曲线/网格随主题重画
  };
  var finishHeavy = function () {
    document.documentElement.classList.remove('vt-running');
    // V1.9.0（需求14/A）：主循环在扩散期间被暂停过，恢复时把两张大画布标记为脏 ——
    //   否则若"秒"没跳变，地图/地球不会重画，主题色就停留在旧值上。
    mapDirty = globeDirty = true;
    try { renderTable(); } catch (e) {}
  };
  if (typeof document.startViewTransition !== 'function') { apply(); finishHeavy(); return; }
  var r = this.getBoundingClientRect();
  var root = document.documentElement;
  root.style.setProperty('--vt-x', Math.round(r.left + r.width / 2) + 'px');
  root.style.setProperty('--vt-y', Math.round(r.top + r.height / 2) + 'px');
  var dx = Math.max(r.left + r.width / 2, window.innerWidth - (r.left + r.width / 2));
  var dy = Math.max(r.top + r.height / 2, window.innerHeight - (r.top + r.height / 2));
  root.style.setProperty('--vt-r', Math.ceil(Math.sqrt(dx * dx + dy * dy)) + 'px');
  root.classList.add('vt-running');
  var vt = null;
  try { vt = document.startViewTransition(apply); } catch (e) { vt = null; }
  if (vt && vt.finished && vt.finished.then) vt.finished.then(finishHeavy, finishHeavy);
  else { if (!done) { done = true; setTheme(!light); } setTimeout(finishHeavy, 40); }
  setTimeout(function () { if (!done) { done = true; setTheme(!light); } }, 120);   // 兜底：VT 回调未触发也保证切主题
});
// 图表控制
// V1.9.0（需求4）：第 3 章「纵轴量 / 模型」的切换 = **按钮反色块平滑过渡 + 坐标图先褪去再出现**。
//   按钮层：给 .seg button 的底色/文字色加过渡（CSS），点下去立刻平滑变色；
//   画布层：260ms 淡出 → 半程换模式并重绘 → 260ms 淡入（与"轨道 / 可见区域"开关同一条曲线、同一时长），
//   所以坐标图不会"啪"地跳到新纵轴量/新模型，而是先褪去、再以新内容浮现。
function chartSwap(apply) {
  var cv = document.getElementById('chart');
  var wrap = cv && cv.parentNode;
  if (!wrap) { try { apply(); } catch (e) {} return; }
  wrap.classList.add('chart-out');
  setTimeout(function () {
    try { apply(); } catch (e) {}
    wrap.classList.remove('chart-out');
  }, ANIM.half);
}
document.getElementById('modeSeg').addEventListener('click', function (e) {
  var b = e.target.closest('button[data-mode]'); if (!b) return;
  if (b.classList.contains('on')) return;          // 点的是当前档：不做无意义的过场
  this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
  chartSwap(function () {
    S.mode = b.getAttribute('data-mode');
    buildChartPoints(); chartAutoView(); drawChart(); renderHeader();
  });
});
document.getElementById('modelSeg').addEventListener('click', function (e) {
  var b = e.target.closest('button[data-model]'); if (!b) return;
  if (b.classList.contains('on')) return;
  this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
  chartSwap(function () {
    S.model = b.getAttribute('data-model');
    buildChartPoints(); chartAutoView(); drawChart(); renderTable();
  });
});
document.getElementById('groupSel').addEventListener('change', function () {
  S.launchFilter = this.value; chartAutoView(); drawChart();
});
var _rz = document.getElementById('resetZoom');   // V1.6.1：按钮已移除，判空避免空引用
if (_rz) _rz.addEventListener('click', function () { chartAutoView(); drawChart(); });
document.querySelectorAll('.seg[data-scope]').forEach(function (seg) {
  seg.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-color]'); if (!b) return;
    var sc = seg.getAttribute('data-scope'), nm = b.getAttribute('data-color');
    // V1.8.0（需求4②）：配色插值 —— 先把旧色板每颗星的颜色记下来，改完开关后
    //   在 520ms 内从旧色插值到新色（colOf 每帧现算），而不是整片光点"闪"一下变过来。
    if (S.colorMode[sc] !== nm) {
      var fromCol = {};
      cur().sats.forEach(function (s) { fromCol[s.idx] = colOf(s, sc); });
      (function (scope, table) {
        var t0 = performance.now();
        animTo(ANIM.t, function () {
          COLORMIX = { scope: scope, from: table, t0: t0, k: 0 };
          if (scope === 'chart') drawChart(); else { mapDirty = globeDirty = true; }
        });
      })(sc, fromCol);
    }
    S.colorMode[sc] = nm;
    seg.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
    if (sc === 'chart') { drawChart(); renderLegend(); }
    else renderTable();
  });
});
// 通用「?」提示气泡
var HELP = {
  // V1.3.6：提示只留「一句话讲清楚这是什么」，公式、推导、完整操作细节统一搬进「说明」（README）弹窗
  model: {
    zh: '<b>布劳威尔</b>：剥掉 J2 长期项后的半长轴，与目录口径一致（默认）。<br><b>开普勒</b>：由平均运动直接反算的几何半长轴。两者差几公里，推导见「说明」。',
    en: '<b>Brouwer</b>: semi-major axis with the J2 secular terms removed — matches the catalog convention (default).<br><b>Kepler</b>: geometric semi-major axis inverted from the mean motion. They differ by a few km; see "Readme" for the derivation.'
  },
  color: {
    zh: '<b>按卫星</b>：每颗一个颜色。<br><b>按批次</b>：同批发射的同色。',
    en: '<b>By satellite</b>: one color each.<br><b>By group</b>: satellites launched together share a color.'
  },
  cov: {
    zh: '<b>可见倾角</b>：每颗卫星实时对地面的可视覆盖区。仰角滑块调最小仰角；选中某颗后只画它的覆盖区。',
    en: '<b>Coverage</b>: the footprint each satellite can see right now. The slider sets the minimum elevation; once a satellite is selected only its footprint is drawn.'
  },
  pick: {
    zh: '<b>选择地面观测点</b>：鼠标在地图上移动即可预览该点的可见范围与可见颗数，点击固定，再点一次解除。',
    en: '<b>Pick ground site</b>: move the cursor over the map to preview the visibility region and count; click to fix a site, click again to release.'
  },
  cone: {
    zh: '<b>可视区域</b>：在球面上画出每颗卫星的地面覆盖圈，随卫星实时移动。',
    en: '<b>Coverage</b>: draws each satellite\'s ground footprint on the globe, moving live with the satellites.'
  },
  time: {
    zh: '<b>时间滑块</b>：把全部卫星的位置整体前推或后推最多 ±3 小时，点「实时」回到当前时间。',
    en: '<b>Time slider</b>: shifts every satellite position by up to ±3 hours. "Now" returns to the current time.'
  },
  zoom: {
    zh: '<b>缩放</b>：触屏双指捏合，或鼠标滚轮；放大后可拖动平移，双击复位。',
    en: '<b>Zoom</b>: pinch on touch, or the scroll wheel; drag to pan once zoomed, double-click to reset.'
  },
  // V1.9.0（需求5）：01 / 02 章的「？」合并成一个 —— 可见区域 + 缩放 + 选中/聚焦（三段拼接）。
  //   其中「缩放 + 选中/聚焦」两段与 03 章的 zoomsel **逐字相同**（需求5 要求三个弹窗保持一致）。
  //   （旧的 mapcov / cone / zoom / sel 四个键中，sel 仍被 04 章以外的老引用保留，其余不再被引用。）
  covsel: {
    zh: '<b>可见区域</b>：每颗卫星实时对地面的可视覆盖区（地图章）或球面覆盖圈（轨道章）。仰角滑块调最小仰角；选中某颗后只画它的覆盖区。<br><b>缩放</b>：触屏双指捏合，或鼠标滚轮；放大后可拖动平移，双击复位。<br><br><b>选中后一直看得见。</b>点光点或表格任一行即可选中（Ctrl / ⌘ + 点加选），信息窗<b>锁定显示</b>且可拖走：电脑按住拖，手机长按约半秒再拖，可以拖到画布外面。✕ 只关窗、不取消选中；点空白处才取消。<br><br><b>整批选中后可聚焦。</b>点某一批会选中整批，再点其中一颗 = 聚焦它（其余高亮保留），点空白才取消整批。',
    en: '<b>Coverage</b>: the footprint each satellite can see right now (map) or its ground circle on the globe. The slider sets the minimum elevation; once a satellite is selected only its footprint is drawn.<br><b>Zoom</b>: pinch on touch, or the scroll wheel; drag to pan once zoomed, double-click to reset.<br><br><b>Once selected, it stays visible.</b> Click a dot or any table row to select (Ctrl / ⌘ + click adds). The info panel <b>stays pinned</b> and can be dragged — grab it on desktop, press and hold ~0.5 s on touch — even outside the canvas. ✕ closes only the panel; click empty space to clear.<br><br><b>Focus inside a group.</b> Clicking a group selects the whole batch, then clicking one satellite focuses it (the rest stay highlighted); only empty space clears the group.'
  },
  // V1.9.0（需求5）：03 章的「？」= 缩放 + 选中/聚焦（**不含**可见区域 —— 这一章没有覆盖区）。
  zoomsel: {
    zh: '<b>缩放</b>：触屏双指捏合，或鼠标滚轮；放大后可拖动平移，双击复位。<br><br><b>选中后一直看得见。</b>点光点或表格任一行即可选中（Ctrl / ⌘ + 点加选），信息窗<b>锁定显示</b>且可拖走：电脑按住拖，手机长按约半秒再拖，可以拖到画布外面。✕ 只关窗、不取消选中；点空白处才取消。<br><br><b>整批选中后可聚焦。</b>点某一批会选中整批，再点其中一颗 = 聚焦它（其余高亮保留），点空白才取消整批。',
    en: '<b>Zoom</b>: pinch on touch, or the scroll wheel; drag to pan once zoomed, double-click to reset.<br><br><b>Once selected, it stays visible.</b> Click a dot or any table row to select (Ctrl / ⌘ + click adds). The info panel <b>stays pinned</b> and can be dragged — grab it on desktop, press and hold ~0.5 s on touch — even outside the canvas. ✕ closes only the panel; click empty space to clear.<br><br><b>Focus inside a group.</b> Clicking a group selects the whole batch, then clicking one satellite focuses it (the rest stay highlighted); only empty space clears the group.'
  },
  // V1.8.0（需求16）：地图章「可见倾角？」与「缩放？」合并为一个 —— 内容两段拼接
  //   （V1.9.0 起该按钮已被 covsel 取代，本键保留仅为兼容；下同 cone / zoom 两个键。）
  mapcov: {
    zh: '<b>可见倾角</b>：每颗卫星实时对地面的可视覆盖区。仰角滑块调最小仰角；选中某颗后只画它的覆盖区。<br><b>缩放</b>：触屏双指捏合，或鼠标滚轮；放大后可拖动平移，双击复位。',
    en: '<b>Coverage</b>: the footprint each satellite can see right now. The slider sets the minimum elevation; once a satellite is selected only its footprint is drawn.<br><b>Zoom</b>: pinch on touch, or the scroll wheel; drag to pan once zoomed, double-click to reset.'
  },
  // V1.8.0（需求8）：03.5 组网进度的图例说明
  progress: {
    zh: '<b>怎么看这张图</b>：每个点是一周（周一起算），横轴标的是那一周的日期。<br><b>发射量</b>＝这一周结束时两个星座累计发射了多少颗（含失败与部分成功，百科没有记载颗数的不计）。<br><b>在轨数量</b>＝已有最新轨道要素的颗数 ＋ 已发射但尚未编目的成功批次。<br><b>操作</b>：滚轮/双指缩放，拖动平移，双击复位，点某一周看当周新增的批次。',
    en: '<b>How to read it</b>: each point is one week (starting Monday); the x axis is labelled with the actual date.<br><b>Launches</b>: cumulative satellites launched by the end of that week (failures and partial successes count when a number is on record).<br><b>In orbit</b>: satellites with fresh elements plus successful batches launched but not yet catalogued.<br><b>Controls</b>: wheel/pinch to zoom, drag to pan, double-click to reset, click a week to see the batches launched in it.'
  },
  // 三个章节共用的「选中 / 聚焦 / 信息窗」说明（V1.3.6 精简）
  sel: {    zh: '<b>选中后一直看得见。</b>点光点或表格任一行即可选中（Ctrl / ⌘ + 点加选），信息窗<b>锁定显示</b>且可拖走：电脑按住拖，手机长按约半秒再拖，可以拖到画布外面。✕ 只关窗、不取消选中；点空白处才取消。<br><br><b>整批选中后可聚焦。</b>点某一批会选中整批，再点其中一颗 = 聚焦它（其余高亮保留），点空白才取消整批。',
    en: '<b>Once selected, it stays visible.</b> Click a dot or any table row to select (Ctrl / ⌘ + click adds). The info panel <b>stays pinned</b> and can be dragged — grab it on desktop, press and hold ~0.5 s on touch — even outside the canvas. ✕ closes only the panel; click empty space to clear.<br><br><b>Focus inside a group.</b> Clicking a group selects the whole batch, then clicking one satellite focuses it (the rest stay highlighted); only empty space clears the group.'
  }
};
document.querySelectorAll('.help-btn[data-help]').forEach(function (b) {
  b.addEventListener('click', function (e) {
    e.stopPropagation();
    var key = b.getAttribute('data-help');
    var c = HELP[key]; if (!c) return;
    // V1.7.1（需求11）：改成真正的 toggle —— 点同一个？= 关掉，点别的 = 换成它。
    //   旧实现是「先 remove 掉旧的，再创建一个新的」，所以点同一个按钮看起来毫无反应
    //   （旧的被关、新的又被打开），用户只能去点框外才能关。
    var open = document.querySelector('.help-pop');
    if (open && open.__key === key) { open.remove(); return; }
    if (open) open.remove();
    var p = document.createElement('div');
    p.className = 'help-pop';
    p.__key = key;
    p.innerHTML = LANG === 'en' ? c.en : c.zh;
    var r = b.getBoundingClientRect();
    // V1.3.6：必须挂进按钮所在的章节，不能挂到 body ——
    // 全屏时浏览器只渲染全屏元素（这里是 <section>）及其子树，挂在 body 上就完全看不见了
    // （这正是「全屏里点 ？没反应」的原因）。章节本身默认 static，兜底设成 relative 让 absolute 有参照。
    var host = b.closest('section') || document.body;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    var hr = host.getBoundingClientRect();
    p.style.position = 'absolute';
    p.style.left = Math.max(8, Math.min(r.left - hr.left, Math.max(8, hr.width - 452))) + 'px';
    p.style.top = (r.bottom - hr.top + 8) + 'px';
    // V1.7.1（需求12）：在提示框内部按下时别把 click 冒泡出去，否则点里面的文字会先触发下面的
    // 「点任意处关闭」，点着文字就把框关了。
    p.addEventListener('pointerdown', function (ev) { ev.stopPropagation(); });
    p.addEventListener('click', function (ev) { ev.stopPropagation(); });
    host.appendChild(p);
    setTimeout(function () {
      document.addEventListener('click', function h() { p.remove(); document.removeEventListener('click', h); });
    }, 10);
  });
});

// 图表交互
function chartXY(e) {
  var r = chartCv.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
chartCv.addEventListener('mousemove', function (e) {
  if (!chartDrag && !hoverDue('chart')) return;      // V1.4.3：非拖动状态下的悬停检测节流到 ~30Hz
  var p = chartXY(e), v = chartView, r = chartRect;
  if (chartDrag && tapDist(p.x, p.y, chartDrag.ox, chartDrag.oy) <= TAP_SLOP) {
    return;                              // V1.3.8：按下后的抖动不算平移
  }
  if (chartDrag) {
    if (chartDrag.shift) {
      var x0 = Math.min(chartDrag.x, p.x), x1 = Math.max(chartDrag.x, p.x);
      var y0 = Math.min(chartDrag.y, p.y), y1 = Math.max(chartDrag.y, p.y);
      zoomBand.style.display = 'block';
      zoomBand.style.left = x0 + 'px'; zoomBand.style.top = y0 + 'px';
      zoomBand.style.width = (x1 - x0) + 'px'; zoomBand.style.height = (y1 - y0) + 'px';
      return;
    }
    if (!r || !v) return;
    var dx = (p.x - chartDrag.x) / r.pw * (v.x1 - v.x0);
    var dy = (p.y - chartDrag.y) / r.ph * (v.y1 - v.y0);
    v.x0 -= dx; v.x1 -= dx; v.y0 += dy; v.y1 += dy;
    chartDrag.x = p.x; chartDrag.y = p.y;
    drawChart(); return;
  }
  LASTPTR.chart = p;                    // V1.3.7：供信息窗避让指针用
  var hit = chartHit(p.x, p.y);
  chartHoverPt = hit;
  // V1.7.1（需求2）：用户点 ✕ 关掉信息窗之后，鼠标扫过别的卫星**只弹临时预览**——
  //   在默认位置出现、不写选中、鼠标一移到空白或图外立刻消失。
  //   旧逻辑（无论 hover 到谁，只要S.sel 非空就 showChartInfo 回去、mouseleave 再无条件
  //   syncSelInfo）会让新窗口直接"钉"在屏幕上，看起来像选了新卫星。
  // V1.7.2（需求4）：hover 一律走**浮窗**（无 ✕、不可拖、移开即消失）。
  //   A 窗由 syncSelInfo() 常驻管理，这里不再碰它 —— 旧版在空白处把 S.sel 里所有 block
  //   都塞进 A 窗，与"多选时只显示 NORAD 最小那颗的一个信息窗"直接冲突，已去掉。
  if (hit) showChartFloat(hit.sat.idx); else hideFloat('chart');
  drawChart();
});
chartCv.addEventListener('mouseleave', function () {
  chartHoverPt = null; chartDrag = null; zoomBand.style.display = 'none';
  // V1.7.2（需求4）：鼠标出图 → 只收浮窗。A 窗常驻，由选中态决定，不受 hover 影响。
  hideFloat('chart');
  drawChart();
});
chartCv.addEventListener('mousedown', function (e) {
  var p = chartXY(e);
  chartDrag = { x: p.x, y: p.y, shift: e.shiftKey, moved: false, ox: p.x, oy: p.y };
});
window.addEventListener('mouseup', function (e) {
  if (!chartDrag) return;
  var p = chartXY(e);
  var moved = tapDist(p.x, p.y, chartDrag.ox, chartDrag.oy) > TAP_SLOP;   // V1.3.7：放宽到 10px
  if (chartDrag.shift && moved && chartRect && chartView) {
    var x0 = Math.min(chartDrag.ox, p.x), x1 = Math.max(chartDrag.ox, p.x);
    var y0 = Math.min(chartDrag.oy, p.y), y1 = Math.max(chartDrag.oy, p.y);
    var v = chartView, r = chartRect;
    var nx0 = v.x0 + (x0 - r.PL) / r.pw * (v.x1 - v.x0);
    var nx1 = v.x0 + (x1 - r.PL) / r.pw * (v.x1 - v.x0);
    var ny1 = v.y0 + (r.PT + r.ph - y0) / r.ph * (v.y1 - v.y0);
    var ny0 = v.y0 + (r.PT + r.ph - y1) / r.ph * (v.y1 - v.y0);
    if (nx1 - nx0 > 0.05 && ny1 - ny0 > 0) chartView = clampChartView({ x0: nx0, x1: nx1, y0: ny0, y1: ny1 });
    zoomBand.style.display = 'none'; drawChart();
  } else if (!moved) {
    chartTapAt = performance.now();   // V1.7.0 第三轮末：与 click 兜底去重（否则会选两次又取消）
    var hit = chartHit(p.x, p.y);
    if (hit) toggleSel(hit.sat.idx, false);
    else clearSel();
  }
  chartDrag = null;
});
// V1.4.3：图表两侧各 12% 划为禁用带 —— 在这两条带子里滚轮/滑动一律翻页面，
// 只有中间那一段才用来缩放/平移图表（和地球的处理保持一致）。
// V1.7.2（需求6）：全屏判定 —— 三种全屏形态都要认。
//   ① 真全屏 document.fullscreenElement
//   ② 伪全屏（V1.5.2 的降级方案）html.pseudo-full
//   ③ 章节级全屏 section.fs-mobile
function isFsMode() {
  return !!document.fullscreenElement
      || document.documentElement.classList.contains('pseudo-full')
      || !!document.querySelector('section.fs-mobile');
}
// V1.4.3：图表两侧各 12% 划为禁用带 —— 在这两条带子里滚轮/滑动一律翻页面，
// 只有中间那一段才用来缩放/平移图表（和地球的处理保持一致）。
// V1.7.2（需求6）：**全屏模式下取消死区** —— 死区原本是为了让用户在画布两侧也能上下滑动翻页，
//   而全屏时页面已经被锁住（overflow:hidden / touch-action:none），不存在翻页需求，
//   死区就纯属碍事（画布最边缘没法缩放/平移）。全屏时整幅画布都可用。
function chartHitZone(clientX, clientY) {
  if (isFsMode()) return true;
  var W = chartCv._w || 0;
  if (!W) return true;
  var r = chartCv.getBoundingClientRect();
  var x = clientX - r.left;
  return x >= W * 0.12 && x <= W * 0.88;
}
chartCv.addEventListener('wheel', function (e) {
  if (!chartHitZone(e.clientX, e.clientY)) return;   // 两侧带子里滚动 = 翻页面
  e.preventDefault();
  if (!chartView || !chartRect) return;
  var p = chartXY(e), v = chartView, r = chartRect;
  var fx = (p.x - r.PL) / r.pw, fy = (r.PT + r.ph - p.y) / r.ph;
  var k = e.deltaY > 0 ? 1.18 : 1 / 1.18;
  var cx = v.x0 + fx * (v.x1 - v.x0), cy = v.y0 + fy * (v.y1 - v.y0);
  var nx0 = cx - (cx - v.x0) * k, nx1 = cx + (v.x1 - cx) * k;
  var ny0 = cy - (cy - v.y0) * k, ny1 = cy + (v.y1 - cy) * k;
  if (nx1 - nx0 > 0.05 && ny1 - ny0 > 0.0001) chartView = clampChartView({ x0: nx0, x1: nx1, y0: ny0, y1: ny1 });
  drawChart();
}, { passive: false });
chartCv.addEventListener('dblclick', function () { chartAutoView(); drawChart(); });
// 图表缩放（按钮 / 双指 / 单指拖动）
function zoomChartAt(fx, fy, factor) {
  if (!chartView || !chartRect) return;
  var v = chartView, r = chartRect;
  var px = Math.min(1, Math.max(0, (fx - r.PL) / r.pw));
  var py = Math.min(1, Math.max(0, (r.PT + r.ph - fy) / r.ph));
  var cx = v.x0 + px * (v.x1 - v.x0), cy = v.y0 + py * (v.y1 - v.y0);
  var nx0 = cx - (cx - v.x0) * factor, nx1 = cx + (v.x1 - cx) * factor;
  var ny0 = cy - (cy - v.y0) * factor, ny1 = cy + (v.y1 - cy) * factor;
  // V1.3.6：横轴单位从毫秒变成度，下限相应收紧（0.05° 以下没有意义）
  if (nx1 - nx0 > 0.05 && ny1 - ny0 > 1e-6) chartView = clampChartView({ x0: nx0, x1: nx1, y0: ny0, y1: ny1 });
  drawChart();
}
touchZoom(chartCv, {
  active: chartHitZone,                              // V1.4.3：同上，两侧带子不吃手势
  pan: function (dx, dy) {
    if (!chartView || !chartRect) return;
    var v = chartView, r = chartRect;
    var ddx = dx / r.pw * (v.x1 - v.x0), ddy = dy / r.ph * (v.y1 - v.y0);
    v.x0 -= ddx; v.x1 -= ddx; v.y0 += ddy; v.y1 += ddy;
    clampChartView(v);                    // V1.7.0 第四轮（需求3）：平移不能拖出物理边界
    drawChart();
  },
  pinch: function (f, cx, cy) { zoomChartAt(cx, cy, 1 / f); },
  tap: function (x, y) {
    chartTapAt = performance.now();
    if (!chartPts || !chartPts.length) buildChartPoints();
    var hit = chartHitForTap(x, y);
    if (hit) toggleSel(hit.sat.idx, false); else clearSel();
  }
});
// V1.7.0 第三轮末（需求3·根治）：**第三章此前完全没有 click 监听** ——
// 手机上点按只能依赖 pointer 路径，一旦浏览器把它判成滚动手势就再也选不中，
// 于是"倾角分布必须长按才能选中"。地图/轨道都有 click 兜底，所以只有第三章出问题。
// 这里补上与地图完全同一套的做法：pointer 路径处理过的 600ms 内忽略随后的合成 click，避免选两次。
// 全屏下画布尺寸/视窗刚变，点位数组可能还没重建 → 先保证它有，否则任何点按都命不中
if (!chartPts || !chartPts.length) buildChartPoints();
// 全屏下手指误差更大：命中失败时再按"最近点"兜一次（12px 内）
function chartHitForTap(x, y) {
  var hit = chartHit(x, y);
  if (hit) return hit;
  var best = null, bd = 12;
  if (chartPts && chartRect && chartView) {
    for (var i = 0; i < chartPts.length; i++) {
      var q = chartPts[i]; if (!q) continue;
      var r2 = chartRect, v2 = chartView;
      var px = r2.PL + (q.px - v2.x0) / (v2.x1 - v2.x0) * r2.pw;
      var py = r2.PT + (v2.y1 - q.py) / (v2.y1 - v2.y0) * r2.ph;
      var dd = Math.hypot(px - x, py - y);
      if (dd < bd) { bd = dd; best = q; }
    }
  }
  return best || null;
}
chartCv.addEventListener('click', function (e) {
  if (performance.now() - chartTapAt < 600) return;   // 触摸轻点已处理
  if (chartDrag) { chartDrag = null; return; }        // 刚拖过视窗，不当点击
  var p = chartXY(e);
  var hit = chartHitForTap(p.x, p.y);
  if (hit) toggleSel(hit.sat.idx, false); else clearSel();
});

// 地图交互（含缩放/平移/观测点模式）
function mapXY(e) { var r = mapCv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

// V1.5.1：地图内容区 —— 全屏时按 contain（保持 1325:620 比例、上下左右居中、先占满的那一边先满），
// 放大（k>1）时内容自然超出画布、由画布边界裁掉 → 逐步填满原来留空的部分。像手机相册看照片。
// V1.7.2（需求13 全局扫描）：此处原先有一份**完全重复**的 `var MAP_AR = 1325 / 620;`
//   （文件后段还有一份同值的）。值相同所以从未出错，但重复声明属于隐患 —— 同类问题
//   （V1.7.1 的 layoutNav 被声明两次、后者覆盖前者导致前者永不执行）已经害过一次调试，
//   这里一并清掉，全项目只保留这一份。
var MAP_AR = 1325 / 620;
function mapFit(W, H) {
  var fsEl = document.fullscreenElement;
  var isPseudoFs = document.documentElement.classList.contains('pseudo-full');
  var mapFs = (fsEl && fsEl.id === 'sec-map') || isPseudoFs;
  if (!mapFs) return { w: W, h: H, ox: 0, oy: 0 };
  // V1.7.0（任务8）：全屏改为「铺满视口」（cover）—— 图片自然填满、不再上下留黑边，
  // 手机端就是放大照片的效果；按钮/搜索框/时钟仍悬浮其上。
  var w = Math.max(W, H * MAP_AR), h = w / MAP_AR;
  return { w: w, h: h, ox: (W - w) / 2, oy: (H - h) / 2 };
}
function mx2lon(x) {
  var f = mapFit(mapCv._w, mapCv._h);
  return ((x - S.mz.tx - f.ox) / S.mz.k / f.w) * 360 - 180;
}
function my2lat(y) {
  var f = mapFit(mapCv._w, mapCv._h);
  return 90 - ((y - S.mz.ty - f.oy) / S.mz.k / f.h) * 180;
}
function clampMZ() {
  S.mz.k = Math.max(1, Math.min(8, S.mz.k));
  var f = { w: mapCv._w || 1, h: mapCv._h || 1 };
  var fit = mapFit(f.w, f.h);
  var cw = fit.w * S.mz.k, ch = fit.h * S.mz.k;
  // 内容比画布小 → 不偏移（居中交给 fit.ox/oy）；比画布大 → 限制在画布内不露白边
  S.mz.tx = cw <= f.w ? 0 : Math.max(f.w - cw, Math.min(0, S.mz.tx));
  S.mz.ty = ch <= f.h ? 0 : Math.max(f.h - ch, Math.min(0, S.mz.ty));
}
function zoomMapAt(cx, cy, factor) {
  var k0 = S.mz.k;
  S.mz.k = Math.max(1, Math.min(8, k0 * factor));
  var real = S.mz.k / k0;
  S.mz.tx = cx - (cx - S.mz.tx) * real;
  S.mz.ty = cy - (cy - S.mz.ty) * real;
  clampMZ();
}
function mapHit(x, y) {
  var f = { w: mapCv._w, h: mapCv._h };
  var best = null, bd = 18;
  var states = frameStatesMap; if (!states) return null;   // V1.7.3 需求9：第一章（地图）的推算缓存
  var st = cur();
  for (var i = 0; i < st.sats.length; i++) {
    var g = states[i]; if (!g) continue;
    var mf = mapFit(f.w, f.h);
    var px = (g.lon + 180) / 360 * mf.w * S.mz.k + mf.ox + S.mz.tx;
    var py = (90 - g.lat) / 180 * mf.h * S.mz.k + mf.oy + S.mz.ty;
    var d = Math.hypot(px - x, py - y);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
// preview：true = 鼠标扫出来的临时预览（V1.7.1 需求2），false = 已选中卫星的常驻窗
// 地图信息块（A 窗与浮窗共用同一份生成逻辑 → 两窗格式必然一致）
function mapBlockHtml(idx) {
  var st = cur(), g = frameStatesMap && frameStatesMap[idx];   // V1.7.3 需求9：地图章缓存
  var s = st && st.sats[idx];
  // V1.4.0：与地球章节同款保护 —— 数据正在重建（刷新 TLE / 切换星座）时两个数组会短暂错位，
  // 这时候直接返回，别让 s.name / g.lat 抛异常把整帧渲染打断
  if (!g || !s) return null;
  var el = (S.pick.on && S.pick.fixed) ? elevationOf(g) : null;
  var extra = siRow(t('d_row_cat'), s.name) +
    siRow(t('d_row_sub'), g.lat.toFixed(2) + '°, ' + g.lon.toFixed(2) + '°') +
    siRow(t('d_row_alt'), fmtNum(g.h, 1) + ' km') +
    (el !== null ? siRow(t('d_row_el'), fmtNum(el, 1) + '°') : '');
  return satBlock(s, 'map', extra);
}
// A 窗（地图）：选中态常驻
function showMapInfo(idx) {
  var html = mapBlockHtml(idx);
  if (!html) { hideInfo(mapInfo, 'map'); return; }
  mapInfo.__html = html;
  showInfo(mapInfo, 'map', html, 'sat' + idx);
}
// V1.7.2（需求4）：浮窗（地图）—— 鼠标对准的那一颗
function showMapFloat(idx) {
  var html = mapBlockHtml(idx);
  if (!html) { hideFloat('map'); return; }
  showFloat('map', html, 'sat' + idx);
}
// 观测点信息块（拣出来单独可复用：A 窗与浮窗都要用）
function siteBlockHtml(lat, lon) {
  var n = frameStatesMap ? countVisible(frameStatesMap, lat, lon, S.pick.el) : 0;   // V1.7.3 需求9：地图章缓存
  return '<div class="si-block"><div class="si-name">' + t('d_site') +
    '<span class="swatch" style="background:var(--row-sel)"></span></div>' +
    siRow(t('d_latlon'), lat.toFixed(2) + '°, ' + lon.toFixed(2) + '°') +
    siRow(t('d_visible'), n) + siRow(t('l_el'), '≥ ' + S.pick.el + '°') + '</div>';
}
// A 窗（地图，观测点模式固定后）
function showSiteInfo(lat, lon) {
  mapInfo.__html = siteBlockHtml(lat, lon);
  showInfo(mapInfo, 'map', mapInfo.__html, 'site');
}
function elevationOf(g) {
  var obsGd = { longitude: S.pick.lon * RAD, latitude: S.pick.lat * RAD, height: 0.05 };
  var look = SGP4.ecfToLookAngles(obsGd, g.ecf);
  return look.elevation * DEG;
}
// V1.3.4：观测点已固定时，只有落在可见圈（虚线框）内的卫星才可命中与选取
function pickVisibleIdx(i) {
  if (i === null || i === undefined) return null;
  if (!S.pick.on || !S.pick.fixed) return i;
  var g = frameStatesMap && frameStatesMap[i];   // V1.7.3 需求9：地图章缓存
  if (!g) return null;
  return centralAngle(unitOf(S.pick.lat, S.pick.lon), unitOf(g.lat, g.lon)) <= covLambda(g.h, S.pick.el) ? i : null;
}
function mapHitPickable(x, y) { return pickVisibleIdx(mapHit(x, y)); }
function mapClickAt(x, y, additive) {
  // 观测点模式下不选中卫星，只做观测点的固定/解除（避免误点到卫星）
  if (!S.pick.on) {
    var i = mapHit(x, y);
    if (i !== null) { toggleSel(i, additive); return; }
    clearSel();
    return;
  }
  if (S.pick.fixed) {
    // ① 点可见圈内的卫星光点 = 选中它（再点一次取消 → 退回观测点视图）
    var pi = mapHitPickable(x, y);
    if (pi !== null) { toggleSel(pi, additive); syncSelInfo(); return; }
    var fx = (S.pick.lon + 180) / 360 * mapCv._w * S.mz.k + S.mz.tx;
    var fy = (90 - S.pick.lat) / 180 * mapCv._h * S.mz.k + S.mz.ty;
    // ② 点已固定的观测点标记 = 解除固定，恢复跟随鼠标
    if (Math.hypot(fx - x, fy - y) < 18) {
      S.pick.fixed = false; S.sel = []; S.focusIdx = null; updateSelClasses();
      updatePickHint(); mapDirty = true; return;
    }
    // ③ 点空白 = 只退回观测点视图（仍是观测点模式），不回到「全部卫星都显示」
    if (S.sel.length) { S.sel = []; S.focusIdx = null; updateSelClasses(); afterSelection(); }
    syncSelInfo();
  } else {
    S.pick.lat = Math.max(-90, Math.min(90, my2lat(y)));
    S.pick.lon = Math.max(-180, Math.min(180, mx2lon(x)));
    S.pick.fixed = true;
    updatePickHint();
  }
}
// V1.3.5：只要选中了卫星，01/02/03 三处信息窗都常显（锁定显示），用户才拖得动它。
// focusIdx 优先 —— 批次多选后点其中一颗就聚焦那颗，其余高亮与轨道保留。
// V1.7.2 第七轮（需求8c）：选区签名 —— 用来判断"用户刚刚真的做了一次新的选择"
var LAST_SEL_SIG = null;
// 两个章节的「显示卫星名称」按钮亮暗同步（第一、二章各一个）
function syncNameBtns() {
  [['mapNamesBtn', S.names.map], ['globeNamesBtn', S.names.globe]].forEach(function (p) {
    var b = document.getElementById(p[0]); if (!b) return;
    b.classList.toggle('on', p[1]);
    b.setAttribute('aria-pressed', String(p[1]));
  });
  mapDirty = true; globeDirty = true;
}
function syncSelInfo() {
  // V1.7.2 第七轮（需求8c）：**点选 / 搜索选中卫星时，第一、二章的「显示卫星名称」开关
  //   默认一起打开**（两个按钮的亮暗同步联动）。切换规则（用户规定）：
  //     · 选星 → 两个开关都打开（不管之前是什么状态）；
  //     · 在任一章节里、选中态下关掉名称显示 → 只关它自己，不影响另一章；
  //     · 下一次点选 / 搜索 → 又一起打开。
  //   实现要点：只在"选区签名发生变化 且 选中集合非空"时执行 ——
  //   缩放 / 拖时间条 / 切深浅色 / 切星座后重绘这些**签名不变**的路径不会把开关强行掰开；
  //   "取消选择 → 再点另一颗"与"组内切换"（focusIdx 变）会重新打开，正是要的行为。
  //   放在这里，是因为 syncSelInfo 是**所有**选择变化的汇聚渲染点（地图点选、图表点选、
  //   表格行点选、搜索建议、批次图例、toggleSel、clearSel 最终都走到它），
  //   一个钩子即可全覆盖，不必在六个入口各写一遍。
  var selSig = S.sel.slice().sort(function (x, y) { return x - y; }).join(',') + '|' + S.focusIdx;
  if (selSig !== LAST_SEL_SIG && S.sel.length) {
    S.names.map = true; S.names.globe = true;
    syncNameBtns();
  }
  LAST_SEL_SIG = selSig;
  // V1.6.3：多颗选中（发射记录 / 批次选择）时，各章节只保留**NORAD 编号最小**那颗的信息窗。
  // V1.7.2（需求2④）：但若用户在多选状态下点过某一颗（组内切换），focusIdx 就指向它 —— 优先显示它，
  //   其余卫星的高亮与暗淡状态都不变。这样"点谁看谁"和"多选只显示一颗"两个要求同时成立。
  var idx = null;
  if (S.sel.length) {
    if (S.focusIdx != null && cur().sats[S.focusIdx]) {
      idx = S.focusIdx;
    } else {
      var best = null, bestN = Infinity;
      S.sel.forEach(function (i) {
        var s = cur().sats[i];
        if (!s) return;
        var n = Number(s.norad);
        if (!isFinite(n)) n = 1e12;
        if (n < bestN) { bestN = n; best = i; }
      });
      idx = (best !== null) ? best : S.sel[0];
    }
  }
  // V1.6.3：去掉了 !frameStates 条件 —— 全屏（手机）时 frameStates 可能尚未重算，
  // 会导致选定卫星后信息窗始终不显示。卫星对象存在即可显示。
  // V1.7.1（需求2）/ V1.7.2（需求4）：若用户点 ✕ 关掉了窗（INFO_CLOSED），这里**不要**再把它弹回来。
  //   状态③：关闭后 A 窗与浮窗都不显示，只有「取消选择 → 再选新卫星」才会重新出现 A 窗。
  if (idx === null || idx === undefined || !cur().sats[idx]) {
    hideInfo(chartInfo, 'chart'); hideInfo(mapInfo, 'map'); hideInfo(globeInfo, 'globe');
    return;
  }
  if (INFO_CLOSED.chart && INFO_CLOSED.map && INFO_CLOSED.globe) return;   // 三处都关了就彻底不动
  if (!INFO_CLOSED.chart) showChartInfo([{ x: 0, y: 0, sat: cur().sats[idx] }]);
  if (!INFO_CLOSED.map) showMapInfo(idx);
  if (!INFO_CLOSED.globe) showGlobeInfo(idx);
}
var mapPan = null, mapPanned = false;
mapCv.addEventListener('mousemove', function (e) {
  if (!mapPan && !hoverDue('map')) return;           // V1.4.3：同上
  var p = mapXY(e);
  if (mapPan) {
    var dx = p.x - mapPan.x, dy = p.y - mapPan.y;
    // V1.3.7：按「离按下点的净位移」判定，手抖几像素不再被当成平移
    if (tapDist(p.x, p.y, mapPan.ox, mapPan.oy) > TAP_SLOP) mapPanned = true;
    if (mapPanned && S.mz.k > 1) {
      S.mz.tx += dx; S.mz.ty += dy; clampMZ();
      mapPan.x = p.x; mapPan.y = p.y;
      mapDirty = true;
      return;
    }
  }
  if (S.pick.on && !S.pick.fixed) { S.pick.mx = p.x; S.pick.my = p.y; }
  LASTPTR.map = p;                      // V1.3.7：供信息窗避让指针用
  var i = S.pick.on ? mapHitPickable(p.x, p.y) : mapHit(p.x, p.y);
  if (i !== mapHover) mapDirty = true;
  mapHover = i;
  // V1.7.2（需求4）：hover 走浮窗（A 窗由 syncSelInfo 常驻管理，不在这里碰）。
  //   观测点模式（pick 开、未固定）下鼠标位置的"观测点信息"同样是临时预览 → 也走浮窗。
  if (i !== null) showMapFloat(i);
  else if (S.pick.on && !S.pick.fixed) showFloat('map', siteBlockHtml(my2lat(p.y), mx2lon(p.x)), 'site');
  else hideFloat('map');
  if (S.pick.on && !S.pick.fixed) mapDirty = true;
});
mapCv.addEventListener('mouseleave', function () {
  mapHover = null;
  // V1.7.2（需求4）：鼠标出图 → 只收浮窗（A 窗常驻，不受影响）
  hideFloat('map');
  if (!S.pick.fixed) { S.pick.mx = null; S.pick.my = null; }
  mapDirty = true;
});
mapCv.addEventListener('mousedown', function (e) {
  var p = mapXY(e);
  mapPan = { x: p.x, y: p.y, ox: p.x, oy: p.y };
  mapPanned = false;                 // 每次按下都复位，免得上次拖动把这次点击吞掉
});
// V1.4.4：地图两侧各 12% 划为禁用带 —— 与「03 轨道分布」「02 轨道」统一规则：
// 在这两条对称带子里滚轮/手指滑动一律只翻页面，中间 76% 才用来缩放与平移地图。
function mapHitZone(clientX, clientY) {
  if (isFsMode()) return true;          // V1.7.2（需求6）：全屏无死区，整幅画布都可缩放/平移
  var W = mapCv._w || 0;
  if (!W) return true;
  var r = mapCv.getBoundingClientRect();
  var x = clientX - r.left;
  return x >= W * 0.12 && x <= W * 0.88;
}
mapCv.addEventListener('wheel', function (e) {
  if (!mapHitZone(e.clientX, e.clientY)) return;    // 两侧带子里滚动 = 翻页面
  e.preventDefault();
  var p = mapXY(e);
  zoomMapAt(p.x, p.y, e.deltaY > 0 ? 1 / 1.18 : 1.18);
  mapDirty = true;
}, { passive: false });
mapCv.addEventListener('dblclick', function () { S.mz = { k: 1, tx: 0, ty: 0 }; mapDirty = true; });
mapCv.addEventListener('click', function (e) {
  if (mapPanned) { mapPanned = false; return; }
  if (performance.now() - mapTapAt < 600) return;   // 触摸轻点已处理，忽略随后的合成 click
  var p = mapXY(e);
  mapClickAt(p.x, p.y, false);
});
window.addEventListener('mouseup', function () { mapPan = null; });
// 触摸：单指拖动平移（放大后）/ 双指捏合缩放 / 轻点选择或设定观测点
touchZoom(mapCv, {
  active: mapHitZone,                                // V1.4.4：同上，两侧带子不吃手势
  pan: function (dx, dy) {
    if (S.mz.k <= 1) return;
    S.mz.tx += dx; S.mz.ty += dy; clampMZ(); mapDirty = true;
  },
  pinch: function (f, cx, cy) { zoomMapAt(cx, cy, f); mapDirty = true; },
  tap: function (x, y) { mapTapAt = performance.now(); mapClickAt(x, y, false); }
});
// 地图工具条
var covBtn = document.getElementById('covBtn');        // V1.3.9：删掉没被引用过的 mapSec
covBtn.addEventListener('click', function () {
  S.cov.on = !S.cov.on;
  this.classList.toggle('on', S.cov.on);
  this.setAttribute('aria-pressed', String(S.cov.on));
  togAnim('covOn', S.cov.on);          // V1.8.0（需求4①）：覆盖区淡入/淡出
});
document.getElementById('covEl').addEventListener('input', function () { S.cov.el = +this.value; });
var pickBtn = document.getElementById('pickBtn');
function setPick(on) {
  var wasOn = S.pick.on;
  S.pick.on = on;
  // V1.8.0（需求4③）：退出观测点模式时留住最后的落点，让标记与标签淡出而不是瞬间消失
  if (wasOn && !on) {
    PICK_FADE = { lat: S.pick.lat, lon: S.pick.lon, el: S.pick.el, mx: S.pick.mx, my: S.pick.my };
    setTimeout(function () { PICK_FADE = null; mapDirty = true; }, ANIM.t + 80);
  } else if (on) { PICK_FADE = null; }
  togAnim('pickOn', on);
  if (!on) { S.pick.fixed = false; S.pick.mx = null; S.pick.my = null; hideInfo(mapInfo, 'map'); }
  // 未进入观测点模式时，仰角滑条不可用且为 0
  var eps = document.getElementById('pickEps');
  if (eps) eps.classList.toggle('disabled', !on);
  var el = document.getElementById('pickEl');
  if (!on) {
    S.pick.el = 0;
    if (el) { el.value = '0'; el.disabled = true; }
  } else if (el) { el.disabled = false; }
  syncNumBox('pick');
  pickBtn.classList.toggle('on', on);
  pickBtn.setAttribute('aria-pressed', String(on));
  pickBtn.textContent = on ? t('d_pick_btn_on') : t('d_pick_btn_off');
  updatePickHint();
}
// V1.4.3：鼠标移动时的命中检测（要遍历几百颗卫星算距离）节流到约 30Hz ——
// 指针事件本身可以到 120Hz+，每次重算既贵又没必要；拖动/点击不受影响。
var HOVER_MIN_MS = 32;
function hoverDue(key) {
  var t = performance.now();
  if (HOVER_MIN_MS && hoverDue['t' + key] && (t - hoverDue['t' + key]) < HOVER_MIN_MS) return false;
  hoverDue['t' + key] = t;
  return true;
}
function isTouch() {
  return (window.matchMedia && (matchMedia('(pointer: coarse)').matches || matchMedia('(hover: none)').matches)) ||
    ('ontouchstart' in window && navigator.maxTouchPoints > 0);
}
// V1.7.2 第七轮（需求5）：设备是否"根本没有 hover 能力"。
//   用于决定纯悬停件（B 浮窗）是否可用 —— 比 isTouch() 精确：只否定 hover:none 的设备，
//   触控笔平板 / 外接鼠标的平板仍返回 false（= 可以 hover），B 窗照常工作。
//   MediaQueryList 缓存一份（对象是 live 的，设备状态变了 .matches 会自己更新），
//   避免 mousemove 高频路径上反复创建。支持"旋转/外接鼠标后自动恢复"。
var MQ_HOVER = null;
function noHover() {
  try {
    if (!window.matchMedia) return false;          // 老浏览器不认识就当作有 hover，不误伤
    if (!MQ_HOVER) MQ_HOVER = matchMedia('(hover: hover)');
    return MQ_HOVER.matches === false;
  } catch (e) { return false; }
}
function updatePickHint() {
  var h = document.getElementById('pickHint');
  if (!S.pick.on) { h.textContent = ''; return; }
  if (S.pick.fixed) {
    h.textContent = t('d_fixed_hint_1') + S.pick.lat.toFixed(1) + '°, ' + S.pick.lon.toFixed(1) + '°' + t('d_fixed_hint_2');
  } else h.textContent = isTouch() ? t('d_pick_hint_touch') : t('d_pick_hint_desktop');
}
// V1.7.3（需求3）：pickHint 固定槽位测高 —— 目标：进入放置模式后
//   「按钮行下缘→文字上缘」与「文字下缘→地图上缘」两段可见留白相等（各 22px）。
//   槽外的既有间距（.sec-tools 行间 gap、controls 与地图的既有 margin）在运行时实测并补偿：
//     上内距 = 22 − 槽上沿到按钮行的既有间距；下内距 = 22 − 槽下沿到地图的既有间距。
//   用离屏克隆量当前语言/宽度下提示文案的真实行数（英文窄屏折两行）。
//   槽位恒在 → 进入/退出放置模式布局高度零变化（不跳）。
var PICK_SLOT_PAD = 22;
function layoutPickSlot() {
  var slot = document.getElementById('pickSlot'), hint = document.getElementById('pickHint');
  var map = document.getElementById('map');
  var row = slot ? slot.previousElementSibling : null;      // 按钮行（.tools-row）
  if (!slot || !hint || !row || !map) return;
  var probe = hint.cloneNode(false);
  probe.id = '';
  probe.style.cssText = 'position:absolute;visibility:hidden;left:-9999px;top:-9999px;display:block;width:' + Math.max(slot.clientWidth, 40) + 'px;';
  probe.textContent = t(isTouch() ? 'd_pick_hint_touch' : 'd_pick_hint_desktop');
  document.body.appendChild(probe);
  var hintH = probe.getBoundingClientRect().height;
  document.body.removeChild(probe);
  // 槽外既有间距（与槽自身高度无关：上方是 gap，下方是 margin）
  var sr = slot.getBoundingClientRect();
  var extTop = sr.top - row.getBoundingClientRect().bottom;
  var extGap = map.getBoundingClientRect().top - sr.bottom;  // 地图随文档流排在槽后 → 这是固定 margin
  var topPad = Math.max(0, PICK_SLOT_PAD - extTop);
  var botPad = Math.max(0, PICK_SLOT_PAD - extGap);
  slot.style.paddingTop = topPad.toFixed(1) + 'px';
  slot.style.paddingBottom = botPad.toFixed(1) + 'px';
  slot.style.height = (topPad + Math.ceil(hintH) + botPad).toFixed(1) + 'px';
}
pickBtn.addEventListener('click', function () { setPick(!S.pick.on); });
// V1.7.3（需求2）：pickEl 的跳转动画统一由下方 NUMB 循环里的 attachSliderAnim 接管
//（旧的独立 input 监听已删除，避免双通道）。
document.getElementById('mapNamesBtn').addEventListener('click', function () {
  S.names.map = !S.names.map;
  this.classList.toggle('on', S.names.map);
  this.setAttribute('aria-pressed', String(S.names.map));
  togAnim('nameMap', S.names.map);     // V1.8.0（需求4①）
});
document.getElementById('mapTracksBtn').addEventListener('click', function () {
  S.mapTrack = !S.mapTrack;
  this.classList.toggle('on', S.mapTrack);
  this.setAttribute('aria-pressed', String(S.mapTrack));
  togAnim('mapTrack', S.mapTrack);     // V1.8.0（需求4①）
});
// 任何控件交互都让三幅图重画一次（配合按需绘制，避免每帧空转）
document.addEventListener('click', function () { mapDirty = true; globeDirty = true; }, true);
document.addEventListener('input', function () { mapDirty = true; globeDirty = true; }, true);
document.addEventListener('change', function () { mapDirty = true; globeDirty = true; }, true);
// 地球工具条（V1.3.9：删掉没被引用过的 glSec）
document.getElementById('spinBtn').addEventListener('click', function () {
  S.spin = !S.spin;
  this.classList.toggle('on', S.spin);
  this.setAttribute('aria-pressed', String(S.spin));
});
document.getElementById('tracksBtn').addEventListener('click', function () {
  S.showTracks = !S.showTracks;
  this.classList.toggle('on', S.showTracks);
  this.setAttribute('aria-pressed', String(S.showTracks));
  togAnim('showTracks', S.showTracks);   // V1.8.0（需求4①）
});
document.getElementById('globeNamesBtn').addEventListener('click', function () {
  S.names.globe = !S.names.globe;
  this.classList.toggle('on', S.names.globe);
  this.setAttribute('aria-pressed', String(S.names.globe));
  togAnim('nameGlobe', S.names.globe);   // V1.8.0（需求4①）
});
document.getElementById('coneBtn').addEventListener('click', function () {
  S.cone.on = !S.cone.on;
  this.classList.toggle('on', S.cone.on);
  this.setAttribute('aria-pressed', String(S.cone.on));
  togAnim('coneOn', S.cone.on);          // V1.8.0（需求4①）
});
document.getElementById('coneEl');   // coneEl 的接线在下方 NUMB 循环里（V1.7.3 起走 attachSliderAnim）
// 时间滑块 —— V1.7.3（需求9）：两章时间状态**各自独立**；星座维度由 STORE 快照（S.time 在
// STATE_FIELDS 里）天然承担 → 2 章 × 2 星座 = 四份完全独立的状态。旧版一个 S.timeOffset
// 同时刷两条滑条（注释「两个视图同步」）已被取代。
var timeInputs = document.querySelectorAll('.time-r');
var timeVals = document.querySelectorAll('.time-val');
function timeView(el) { return el && el.getAttribute('data-view') === 'globe' ? 'globe' : 'map'; }
function timeStateOf(view) { return S.time[view === 'globe' ? 'globe' : 'map'] || S.time.map; }
// 生效的模拟时刻：实时 = 跟墙钟走；拖过时间条 = **冻在拉到的那一绝对时刻**（Q8=A），不再前进
function simMs(view) { var ts = timeStateOf(view); return ts.frozen != null ? ts.frozen : Date.now() + ts.off * 60000; }
function setOffset(min, view) {
  var ts = timeStateOf(view);
  min = Math.max(-180, Math.min(180, Math.round(min)));
  ts.off = min;
  ts.frozen = (min === 0) ? null : (Date.now() + min * 60000);
  syncTimeUI();
}
// 把两章各自的滑条 value、「实时/+X 分」按钮文案、shifted 高亮、冻结黄、全屏药丸刷成各自状态
function syncTimeUI() {
  timeInputs.forEach(function (i) { i.value = String(timeStateOf(timeView(i)).off); });
  timeVals.forEach(function (b) {
    var ts = timeStateOf(timeView(b));
    b.textContent = ts.off === 0 ? t('d_now_btn') : (ts.off > 0 ? '+' : '') + ts.off + (LANG === 'en' ? ' min' : ' 分');
    var ctl = b.closest('.time-ctl');
    if (ctl) ctl.classList.toggle('shifted', ts.off !== 0);
    b.classList.toggle('frozen', ts.off !== 0);
  });
  syncFsClockState();
  frameStatesMap = null; frameStatesGlobe = null;   // 时间语义变了 → 两章的推算缓存都重推
}
// ── V1.7.3（需求2）：滑条「跳转动画」── 点击轨道 / 键盘方向键 / 「此刻」这类**非连续**跳转
//   播非线性补间（42.5°=半量程 → 520ms，按距离比例，下限 120ms，easeInOutCubic）；
//   按住拖拽保持原生跟手不播。实现：pointerdown 后原生把值改到点击处 → input 里押回原值，
//   pointerup 判定 tap 才播动画；拖拽（移动 >6px）立即解除接管交还原生。
function sliderDur(el, from, to) {
  var half = ((+el.max || 100) - (+el.min || 0)) / 2;
  return Math.max(120, Math.round(Math.abs(to - from) / half * 520));
}
function attachSliderAnim(el, apply) {
  var tween = null, shown = +el.value, suppress = false, pd = null, kd = null;
  function applyV(v) { shown = v; apply(v); }
  function cancel() { if (tween) { cancelAnimationFrame(tween.raf); tween = null; } }
  function animateTo(target) {
    cancel();
    // V1.8.0（需求16）：起跳点以**滑条真实值**为准 —— 外部经 setOffset()/syncTimeUI() 改过偏移时，
    //   shown 仍停在旧值（syncTimeUI 直接写 el.value，不走 applyV），会出现 from===target
    //   → 第一句就 applyV(target) 瞬间到位。章节「默认设置」的补间就是死在这里。
    //   补间进行中 el.value 每帧由 step() 写入且与 shown 同步，故 tween 非空时不重取。
    if (!tween) shown = +el.value;
    var from = shown, dur = sliderDur(el, from, target), t0 = performance.now();
    if (target === from) { applyV(target); return; }
    function step(now) {
      var k = Math.min(1, (now - t0) / dur);
      var e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      var v = from + (target - from) * e;
      el.value = String(v);
      applyV(v);
      if (k < 1) tween.raf = requestAnimationFrame(step);
      else { tween = null; el.value = String(target); applyV(target); }
    }
    tween = { raf: requestAnimationFrame(step) };
  }
  el.__animateTo = animateTo;
  el.addEventListener('pointerdown', function (e) {
    if (tween) cancel();                       // 动画中再按 → 立即接管
    pd = { t: Date.now(), x: e.clientX, v: shown, moved: false, target: null };
    suppress = true;
  });
  el.addEventListener('pointermove', function (e) {
    if (!pd) return;
    if (!pd.moved && Math.abs(e.clientX - pd.x) > 6) {
      pd.moved = true;
      suppress = false;                        // 转为拖拽 → 交还原生跟手
      applyV(+el.value);
    }
  });
  el.addEventListener('pointerup', function () {
    if (!pd) return;
    var wasTap = !pd.moved && (Date.now() - pd.t) < 450;
    var target = pd.target;
    pd = null; suppress = false;
    if (wasTap && target != null && target !== shown) animateTo(target);
    else applyV(+el.value);
  });
  el.addEventListener('pointercancel', function () { pd = null; suppress = false; });
  el.addEventListener('keydown', function () { if (tween) cancel(); kd = { v: shown }; suppress = true; });
  el.addEventListener('keyup', function () { if (kd) { kd = null; suppress = false; } });
  el.addEventListener('input', function () {
    if (suppress) {
      if (pd && !pd.moved) { pd.target = +el.value; el.value = String(pd.v); return; }   // 原生点击已改值 → 押回
      if (kd) {
        var target = +el.value; el.value = String(kd.v); kd = null; suppress = false;
        if (target !== shown) animateTo(target);
        return;
      }
    }
    applyV(+el.value);
  });
  el.addEventListener('change', function () { if (!tween) applyV(+el.value); });
}
timeInputs.forEach(function (i) {
  var view = timeView(i);
  attachSliderAnim(i, function (v) { setOffset(v, view); });
});
timeVals.forEach(function (b) {
  var view = timeView(b);
  b.addEventListener('click', function () {
    var ts = timeStateOf(view);
    if (ts.off === 0) return;
    var input = document.querySelector('.time-r[data-view="' + view + '"]');
    if (input && input.__animateTo) input.__animateTo(0);   // 「此刻」→ 补间滑回实时
    else setOffset(0, view);
  });
});

// 地球交互（鼠标拖拽旋转 / 滚轮与双指缩放 / 触摸单指旋转）
function globeXY(e) { var r = globeCv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
function globeRotate(dx, dy) {
  G.yaw -= dx * 0.006;
  G.pitch = Math.max(-1.45, Math.min(1.45, G.pitch + dy * 0.006));
  globeDirty = true;
}
// V1.4.5：当前绘制半径（按画布尺寸实时算出，缩放倍数另存 G.zoom）
function globeRadNow() {
  return globeBaseR(globeCv._w || 1, globeCv._h || 1) * (G.zoom || 1);
}
function globeZoomBy(f) {
  G.zoom = Math.max(0.5, Math.min(2.8, (G.zoom || 1) * f));
  globeDirty = true;
}
function globeInfoAt(x, y) {
  var best = null, bd = 16;
  if (frameStatesGlobe) {   // V1.7.3 需求9：第二章（地球）自己的推算缓存
    var f = { w: globeCv._w, h: globeCv._h };
    var cx = f.w / 2, cy = f.h / 2, R = globeRadNow();
    var B = globeBasis(), st = cur();
    for (var i = 0; i < st.sats.length; i++) {
      var g = frameStatesGlobe[i]; if (!g) continue;
      var rr = Math.sqrt(g.ux * g.ux + g.uy * g.uy + g.uz * g.uz), kk = globeRad(rr);
      var v = [g.ecf.x / rr * kk, g.ecf.y / rr * kk, g.ecf.z / rr * kk];
      var pr = project(v, B, cx, cy, R);
      if (pr.z < 0) continue;
      var d = Math.hypot(pr.x - x, pr.y - y);
      if (d < bd) { bd = d; best = i; }
    }
  }
  return best;
}
// 地球信息块（A 窗与浮窗共用）
function globeBlockHtml(best) {
  var st = cur(); var s = st && st.sats[best], g2 = frameStatesGlobe && frameStatesGlobe[best];   // V1.7.3 需求9：改用第二章自己的推算缓存（旧 frameStates 已拆分为 frameStatesMap/Globe，漏改会导致 ReferenceError）
  if (!s || !g2) return null;                 // V1.3.8：数据正在重建时不要抛异常
  // 与 01 章节同一套字段，再追加本视图特有的目录名 / 星下点 / 瞬时高度（V1.3.4 起删掉地心距）
  return satBlock(s, 'globe',
    siRow(t('d_row_cat'), s.name) +
    siRow(t('d_row_sub'), g2.lat.toFixed(2) + '°, ' + g2.lon.toFixed(2) + '°') +
    siRow(t('d_row_alt'), fmtNum(g2.h, 1) + ' km'));
}
// A 窗（地球）：选中态常驻
function showGlobeInfo(best) {
  if (best === null) { hideInfo(globeInfo, 'globe'); return; }
  var html = globeBlockHtml(best);
  if (!html) return;
  globeInfo.__html = html;
  showInfo(globeInfo, 'globe', html, 'sat' + best);
}
// V1.7.2（需求4）：浮窗（地球）—— 鼠标对准的那一颗
function showGlobeFloat(best) {
  var html = globeBlockHtml(best);
  if (!html) { hideFloat('globe'); return; }
  showFloat('globe', html, 'sat' + best);
}
// V1.3.7：判定「这是一次点击还是一次拖动」时，只看按下点与松开点的直线距离（净位移）。
// 旧版用的是累计位移（每帧 |dx|+|dy| 相加），人手按下时哪怕只抖两三像素也会被算成拖动，
// 于是点击卫星永远选不中 —— 这就是「轨道章节点不中光点」的根因之一。
// V1.7.0 第三轮（需求7）：触屏点按容差 16px（手机手指抖动比鼠标大）。
// ★ 关键：平移阈值必须与它一致 —— 此前 touchZoom 里是 "moved > 4 就开始平移"，
//   而点按却要求累计位移 ≤ TAP_SLOP(14)：手指一抖就先转地球/平移图表，累计超限 → tap 被跳过，
//   于是"轨道与倾角分布必须长按才能选中、地图却能点按"（地图 1× 时 pan 是 no-op，所以看不出来）。
var TAP_SLOP = 16;                                   // px，超过这个距离才算拖动
function tapDist(ax, ay, bx, by) { return Math.abs(ax - bx) + Math.abs(ay - by); }
globeCv.addEventListener('mousedown', function (e) {
  G.dragging = true; G.lx = e.clientX; G.ly = e.clientY;
  G.dnx = e.clientX; G.dny = e.clientY;              // 记下按下点，松手时只看这一点
  globeDragMoved = 0;
});
globeCv.addEventListener('mousemove', function (e) {
  if (!G.dragging && !hoverDue('globe')) return;     // V1.4.3：同上
  if (G.dragging) {
    var dx = e.clientX - G.lx, dy = e.clientY - G.ly;
    G.lx = e.clientX; G.ly = e.clientY;
    globeDragMoved += Math.abs(dx) + Math.abs(dy);
    // V1.3.8：按下后的抖动先不转 —— 否则「想点一颗卫星」会顺手把地球转走一小格，
    // 松手后那颗卫星已经不在指针底下了。超过点击容差才真正开始转动。
    if (tapDist(e.clientX, e.clientY, G.dnx, G.dny) > TAP_SLOP) globeRotate(dx, dy);
    return;
  }
  var p = globeXY(e);
  LASTPTR.globe = p;                    // V1.3.7：供信息窗避让指针用
  var best = globeInfoAt(p.x, p.y);
  if (best !== G.hover) globeDirty = true;
  G.hover = best;
  // V1.7.2（需求4）：hover 走浮窗；A 窗由 syncSelInfo 常驻管理
  if (best !== null) showGlobeFloat(best);
  else hideFloat('globe');
});
window.addEventListener('mouseup', function () { G.dragging = false; });
globeCv.addEventListener('mouseleave', function () {
  G.hover = null;
  // V1.7.2（需求4）：鼠标出图 → 只收浮窗
  hideFloat('globe');
  globeDirty = true;
});
// V1.7.0 第三轮末（需求3·根治）：原实现只看 `G.hover` —— 那是**鼠标悬停**时才有的状态，
// 触屏根本没有 hover，所以手机上这条兜底路径永远走不到（只能靠 pointer 路径，一失败就选不中）。
// 改为：按点击位置直接做命中判定，并把内部坐标换算与 pointer 路径保持一致。
globeCv.addEventListener('click', function (e) {
  if (tapDist(e.clientX, e.clientY, G.dnx, G.dny) > TAP_SLOP) return;   // 转过地球 = 拖动，不当点击
  if (performance.now() - globeTapAt < 600) return;                       // 触摸轻点已处理，避免选两次
  var p = globeXY(e);
  var best = globeInfoAt(p.x, p.y);
  if (best !== null) toggleSel(best, false);
  else clearSel();   // 点空白处退出选择
});
// V1.4.2：地球章节未放大时，画布左右各有一大片空白（球体是正方形、画布很宽）。
// 落在空白上的滚轮/滑动一律交还页面滚动；只有落在球体附近（放大后放宽成中间一条竖带）
// 才当作缩放/旋转操作。这样「在两边滚页面、在中间转地球」互不打架。
function globeHitZone(clientX, clientY) {
  var W = globeCv._w || 0, H = globeCv._h || 0;
  if (!W || !H) return true;
  // V1.4.5：禁用区跟着地球走 —— 有效区 = 地球外接框 + 一圈余量（当前半径 ×1.12）。
  // 放大后地球变大，可用区随之变大；缩小时随之收紧，不会出现「放大了却有大片禁用区」的直觉冲突。
  var R = globeRadNow();
  var r = globeCv.getBoundingClientRect();
  var dx = (clientX - r.left) - W / 2, dy = (clientY - r.top) - H / 2;
  var lim = R * 1.12;
  return Math.abs(dx) <= lim && Math.abs(dy) <= lim;
}
globeCv.addEventListener('wheel', function (e) {
  if (!globeHitZone(e.clientX, e.clientY)) return;    // 在两侧空白里滚动 = 翻页面
  e.preventDefault();
  globeZoomBy(e.deltaY > 0 ? 0.9 : 1.1);
}, { passive: false });
globeCv.addEventListener('dblclick', function () { G.zoom = 1; globeDirty = true; });
touchZoom(globeCv, {
  active: globeHitZone,
  pan: function (dx, dy) { globeRotate(dx, dy); },
  pinch: function (f) { globeZoomBy(f); },
  tap: function (x, y) {
    globeTapAt = performance.now();
    var best = globeInfoAt(x, y);
    if (best !== null) toggleSel(best, false);
    else clearSel();
  }
});

// 表格
document.querySelectorAll('#satTable thead th').forEach(function (th) {
  th.addEventListener('click', function () {
    var k = th.getAttribute('data-key');
    if (S.sortKey === k) S.sortAsc = !S.sortAsc; else { S.sortKey = k; S.sortAsc = (k === 'name' || k === 'launch'); }
    document.querySelectorAll('#satTable thead th').forEach(function (x) {
      x.classList.remove('sorted', 'asc');
    });
    th.classList.add('sorted'); if (S.sortAsc) th.classList.add('asc');
    renderTable();
  });
});
tbody.addEventListener('click', function (e) {
  var bl = e.target.closest('[data-lk]');
  if (bl) { selectGroup(bl.getAttribute('data-lk')); return; }   // 点批次 = 选中整批
  var tr = e.target.closest('tr[data-idx]');
  if (!tr) { clearSel(); return; }                              // 点空白处退出选择
  var idx = +tr.getAttribute('data-idx');
  // ═══ V1.7.2（需求10）：**表格内**的单击与图上不同 ═══
  //   多选状态下（不论是用发射记录选了一批，还是点了批次/组）单击**任一颗**
  //   —— 不管它是否已被选中 —— 都**取消全部选择、改为只选这一颗**，其他章节一并跟进。
  //   这与需求 2④ 的"组内切换"是两条规则、作用在不同位置：
  //     · 卫星表格内  → 取消全部、单选它（本处）
  //     · 图表/地图/地球 → 组内切换（S.sel 不变、只换 A 窗内容，见 toggleSel）
  if (S.sel.length > 1 || S.selGroup) {
    S.selGroup = null;
    S.sel = [idx];
    S.focusIdx = idx;
    infoClearClosed();
    afterSelection();
    return;
  }
  toggleSel(idx, false);       // 单选状态下再点同一行 = 取消（原逻辑保留）
});
document.getElementById('tableSearch').addEventListener('input', function () {
  S.query = this.value; renderTable();
});

// 滚动进场动画
(function () {
  var els = document.querySelectorAll(
    '.sec-head, .sec-lead, .controls, .note, .legend-groups, .table-wrap, .chart-wrap, .canvas-wrap:not(.wide)');
  if (!('IntersectionObserver' in window)) return;
  Array.prototype.forEach.call(els, function (el) { el.classList.add('reveal'); });
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
    });
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.04 });
  Array.prototype.forEach.call(els, function (el) { io.observe(el); });
  // V1.9.0 加固（用户报的"刷新偶尔整页黑屏、切一下星座就好"）：
  //   `.reveal` 的初始态是 opacity:0，只有 IntersectionObserver 回调**成功跑过一次**才会被加上 .in。
  //   一旦那一刻因为竞态没触发（观察器回调延迟、元素在 rebuild 期间被替换、页面首帧尚未布局…），
  //   这些元素就会**永远停在 opacity:0** —— 表现出来就是"整页黑屏，但顶栏/药丸还在"（它们是固定定位、
  //   且不在 .reveal 名单里），而切星座会重建 DOM 顺带把它们揭开，所以"切一下就好"。
  //   这里加一道**兜底**：2.5 秒后如果全页**一个** .reveal.in 都没有（说明观察器确实没工作），
  //   就强制揭示全部 —— 正常路径完全不受影响（有 in 时什么都不做），只在灾难情形下兜住。
  setTimeout(function () {
    try {
      if (document.querySelectorAll('.reveal.in').length === 0) {
        Array.prototype.forEach.call(els, function (el) { el.classList.add('in'); });
      }
    } catch (e) {}
  }, 2500);
})();

// ---------------------------------------------------------------- README 弹窗（Markdown）
function escHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function mdInline(s) {
  s = escHtml(s);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return s;
}
function md2html(md) {
  var out = [], inUl = false, inOl = false, inPre = false;
  function close() { if (inUl) { out.push('</ul>'); inUl = false; } if (inOl) { out.push('</ol>'); inOl = false; } }
  md.split('\n').forEach(function (L) {
    if (/^```/.test(L)) {
      close();
      if (inPre) { out.push('</pre>'); inPre = false; }
      else { out.push('<pre>'); inPre = true; }
      return;
    }
    if (inPre) { out.push(escHtml(L)); return; }
    if (/^###\s/.test(L)) { close(); out.push('<h3>' + mdInline(L.slice(4)) + '</h3>'); }
    else if (/^##\s/.test(L)) { close(); out.push('<h2>' + mdInline(L.slice(3)) + '</h2>'); }
    else if (/^#\s/.test(L)) { close(); out.push('<h1>' + mdInline(L.slice(2)) + '</h1>'); }
    else if (/^\s*---+\s*$/.test(L)) { close(); out.push('<hr>'); }
    else if (/^>\s?/.test(L)) { close(); out.push('<blockquote>' + mdInline(L.replace(/^>\s?/, '')) + '</blockquote>'); }
    else if (/^[-*]\s+/.test(L)) { if (!inUl) { close(); out.push('<ul>'); inUl = true; } out.push('<li>' + mdInline(L.replace(/^[-*]\s+/, '')) + '</li>'); }
    else if (/^\d+\.\s+/.test(L)) { if (!inOl) { close(); out.push('<ol>'); inOl = true; } out.push('<li>' + mdInline(L.replace(/^\d+\.\s+/, '')) + '</li>'); }
    else if (L.trim() === '') { close(); }
    else { close(); out.push('<p>' + mdInline(L) + '</p>'); }
  });
  close();
  if (inPre) out.push('</pre>');
  return out.join('\n');
}
var MIT_TXT = 'MIT License\\n\\nCopyright (c) 2026 小橙子的宇宙Jackoraniverse\\n\\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\\n\\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\\n\\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.';
var README_ZH = [
  '# 🛰️ 星网 · 千帆 在轨追踪',
  '',
  '> 中国两大低轨互联网星座 —— **星网 CSCN**（中国星网）与 **千帆 Qianfan**（G60 星链）—— 的可视化追踪页。',
  '> **单 HTML 文件 · 全部计算在浏览器内完成 · 离线可用 · MIT 开源。**',
  `> 当前版本 **${VERSION}** —— CISTrack（China LEO Internet Satellite Tracker）。`,
  '',
  '---',
  '',
  '## 📖 关于本网页',
  '',
  '**这是什么。** 中国正在同时建设两个低轨宽带互联网星座：[星网](' + WIKI.gw + ')（中国星网，SatNet）与[千帆](' + WIKI.qf + ')（Qianfan，又称 G60 星链）。本页把公开轨道要素按星座整理成图表、地图、地球和一张全量表，展示它们实时在轨的分布与态势。画面中的位置不是预先画好的图片，而是由 SGP4 轨道模型在**你的设备**上逐颗实时推算出来的。',
  '',
  '**数据从哪来。** 轨道要素取自 NORAD 空间目标目录的公开发布（CelesTrak）：先取 `hulianwang` / `qianfan` 两个星座分组，再用**按名称查询**补回分组漏掉的早期试验星，最后以完整的 NORAD 目录按 COSPAR 编号逐颗反查；每颗卫星在多来源里取历元最新的一份；每批卫星的名称、发射时间、运载火箭与发射场取自卫星百科「星网」「千帆星座」两个词条的发射记录表；地图与地球的海岸线底图来自 Natural Earth 公有领域数据集；轨道计算使用开源实现 satellite-js。四个来源的主页：[CelesTrak](https://celestrak.org/) · [卫星百科](https://sat.huijiwiki.com/) · [Natural Earth](https://www.naturalearthdata.com/) · [satellite-js](https://github.com/shashwatak/satellite-js)',
  '',
  '**数据有多新。** 每次打开页面都会**自动联网获取最新一期轨道要素** —— 只取当前这两个星座分组，不重复下载历史数据，因此很快（通常几秒内完成）。顶部显示的「要素历元」就是本次实际拿到的数据时间：如果你看到的日期停在某一天，说明那次没取到、页面改用了文件里打包时收录的那一份。',
  '',
  '**两个数据源，分别怎么更新（V1.7.1 新增）。** 本页有两类数据，更新节奏完全不同：',
  '',
  '| 数据 | 来源 | 谁在更新 | 频率 |',
  '| --- | --- | --- | --- |',
  '| **轨道要素（TLE）** | CelesTrak 公开目录 | **你打开页面的那一刻，浏览器现场抓取** | 每次打开（30 分钟内重复打开走缓存） |',
  '| **词条计数**（发射 / 在轨卫星数量、发射成功次数、首发日期、卫星百科核对时间） | 卫星百科词条 | 发布方的自动任务核对后写入 | 每天 0:00 与 12:00 各核对一次 |',
  '| **批次名称、运载火箭、发射场、制造商** | 卫星百科发射记录表 | 随页面构建写入 | 随版本更新 |',
  '',
  '也就是说：**顶部的要素历元永远是你这次打开拿到的最新数据**；而「卫星百科更新」那一行是发布方的核对日期 —— 两次核对之间词条数字没变是正常的（那说明这段时间没有新发射）。',
  '',
  '**如果你的网络访问不了 CelesTrak。** 页面会先走三条直连、再走两个公共代理（共五路）；五路都失败才改用文件内置的那一份，顶部历元会停在那份数据的时间上。遇到这种情况不必担心页面坏了 —— 它只是退回到了离线兜底。发布方每天都会重新构建一次，所以内置的那份最多也就落后一天。',
  '',
  '**为什么高度有两套算法。** 目录发布的平均运动采用 Kozai 约定，其中已经计入地球扁率（J2）的长期影响。**开普勒**是直接由这个平均运动反算的 `a = (μ/n²)^⅓`，数值上等于 SGP4 实际轨道在一个周期内密切半长轴的平均值，也就是卫星真实的几何尺度。**布劳威尔**再剥掉一层 J2 长期项，得到 SGP4 内部递推所用的量：在星网 86.5° 的近极轨道上比开普勒高约 2.9 公里，在 50° 倾角轨道上低约 0.7 公里。默认展示布劳威尔口径，与目录自身的口径一致。',
  '',
  '**半长轴不等于飞行高度。** 卫星在一圈之中围绕半长轴上下摆动 ±a·e：偏心率 2×10⁻⁴ 时约 ±1.5 公里，刚完成变轨的过渡轨道上可达几十公里。要看星座整体的爬升节奏，用半长轴最干净；近地点与远地点另外提供了切换。',
  '',
  '**一颗星要爬很久。** 两个星座的组网星大多先进入两三百至八百公里的停泊轨道，再用电推进花几个月爬到一千米以上的工作高度。因此同一张图上，越新的批次位置越低 —— 它们还在路上。倾角分布图把**倾角放在横轴**：星网与千帆各占哪几条倾角带、同一批次内的高低差，一眼可见。',
  '',
  '**怎么挑选要看的东西。** 页面顶部、表格上方、以及全屏小窗里各有一个联想搜索框：输入卫星名（中英文皆可）、NORAD 编号或批次名都会实时给出候选列表，点一条即可选中；也可以直接点表格里的「批次」二字，一次选中该批次的全部在轨卫星。选中之后，图表、地图、地球都只高亮这一颗（或这一批）卫星及其轨道，其余卫星变暗淡、不再画轨道，表格里被选中的那一整行会用**一条星网红 / 千帆蓝的长边框**框住并自动翻到它所在的那一页。想退出选择：再点一次它，或点图表、地图、地球、表格的空白处即可 —— 任何位置都能取消。',

  '**信息窗：常驻窗 + 临时预览。** 选中卫星之后，它的信息窗会**常驻显示**（鼠标移出画布也不收起），可以拖到任何不影响观看的地方 —— 电脑按住框体直接拖，手机长按约半秒再拖（拖动时勾一圈红 / 蓝的主题色细边）。它**允许部分拖到屏幕之外**（像 Windows 窗口那样），但至少留一点在屏内，页面宽度不会因此被撑宽。右上角的 ✕ 只关窗，不取消选中。',
  '',
  '**选中之后，鼠标扫过其它卫星会弹出一个「临时预览」**：它贴在常驻窗的右侧（右侧放不下就换到左侧，再不行换到下方），样式与常驻窗完全一致，只是**没有 ✕、不能拖动**，鼠标一移开就消失；左边那道细竖条是在提醒你「这只是预览，点一下才会选中」。把常驻窗关掉之后，鼠标扫过任何卫星都**不会再出现任何窗口** —— 你可以安静地看图；想重新看到信息窗，取消选择再点一颗新卫星即可。整批选中时，常驻窗只显示 **NORAD 编号最小**的那一颗；在图上点另一颗卫星只是**把常驻窗的内容换成它**（那一批的高亮与暗淡状态都不变），点空白才取消整批。',
  '',
  '**缩放与全屏。** 三幅图用鼠标滚轮 / 触屏双指捏合缩放，放大后拖动平移（地球是旋转），双击复位；右下角保留「恢复原始比例」和「全屏」两个按键。全屏后画布铺满整屏，手机与电脑同款：左上角有「恢复默认视图」按钮；地图与地球另有一个三角按钮，用来打开和收起左侧的设置小窗，小窗里同样带一个联想搜索框。手机上全屏还会自动转成横屏。全屏里做的选择（选星、调仰角、切换配色）在退出全屏后依然保留。地图与地球的全屏右上角还有一个和顶部同款的时间药丸：跟着实时走时是主题色呼吸边框（与本机秒针对齐，亮在偶数秒）；一旦用时间滑块把画面推离「实时」，它就换成固定的黄色边框，提醒你现在看到的不是实时位置。',
  '',
  '**滑条上的数字。** 每个仰角滑条右侧都有数值框，点一下就能用键盘输入（只填数字，° 已经在框外）；超出 0–85 范围或输入非法字符时，会保持你改动前的数值。',
  '',
  '**哪些卫星没有画进来。** 最近几批（星网 2026-176 / 187 / 213 / 221，千帆 2026-210 / 211 等）在目录里**已经有临时编号**（100203–100799 段）与**公开的摘要参数**（周期、倾角、近远地点 —— 把鼠标停在「发射批次」表的「待编目」标签上就能看到），但**完整的轨道要素（TLE）尚未公开发布**：CelesTrak 的 GP 接口对这类临时编号不返回数据，Space-Track 需要账号，第三方镜像（n2yo、tle.ivanstanojevic.me 等）也都查不到。举一个已核对的例子：COSPAR **2026-176A** 对应临时编号 **100203**，目录里已命名为 **HULIANWANG DIGUI-178** —— 也就是说它们并非"下落不明"，只是被编成了待分析对象、还没拿到正式编号。因此本页只能展示这些摘要，无法推算它们的位置；相应地，这三类图里都没有它们，只有「轨道高度图」上按摘要高度画出的**空心点与虚线高度区间**（不参与选中与悬停）。等它们拿到正式编号并发布要素后，重新构建一次就会自动转入正常显示。此外，两星座的早期试验星、以及星网的高轨业务星（地球同步轨道）不在低轨分组之内，也未计入。页面顶部的「发射 / 在轨卫星数量」与「发射成功次数」一律**以卫星百科词条的统计栏为准**（括号内照搬词条原文的分项）；本页真正有完整轨道要素、能实时推算位置的颗数单独写在第二行，作为 TLE 一侧的核对。',
  '',
  '**关于本项目。** 本页按 [MIT 协议](https://opensource.org/licenses/MIT)完全开源，可自由使用、修改与分发（许可全文见文末）。本页面由 [小橙子的宇宙Jackoraniverse](' + BILI + ') 使用 AI 工具生成，灵感与最初版本来自于 [Где «Рассветы»](https://findrassvet.ru/)（Bureau 1440 的 Rassvet 星座追踪站）的页面风格与布局。',
  '',
  '**免责声明。** 本页内容由人工智能辅助生成，虽经核对，仍可能存在疏漏，请以官方发布为准。轨道要素属于公开目录数据，精度有限且随时间老化，通常几小时内位置误差在公里量级，仅供科普与参考，不应用于工程、科研或过境预报等专业用途。本页为非官方项目，与中国卫星网络集团有限公司、上海垣信卫星科技有限公司均无关联。',
  '',
  '---',
  '',
  '## ✨ 它能做什么',
  '',
  '- 🛰️ **实时态势**：所有卫星位置由 SGP4 在你的设备上按当前时间逐颗推算，图表、地图、3D 地球三视图联动；',
  '- 📈 **倾角分布（03）**：横轴 = 轨道倾角，纵轴 = 轨道高度（可选半长轴 / 远地点 / 近地点），滚轮或双指缩放、拖框放大、拖拽平移、双击复位；',
  '- ⭕ **待编目批次**：目录里已给出编号与摘要参数、但上游尚未发布完整 TLE 的对象，会以**空心点 + 虚线高度区间**标出，不参与选中与悬停，也不出现在地图与 3D 地球里。**当前两个星座没有待编目对象**（V1.9.1 修好 6 位编号采集通路后已全部收录）。',
  '- 🗺️ **地图**：卫星对地面的可视覆盖区（可见倾角可调，默认 35°）、前后各半圈地面轨迹、1–8 倍缩放；',
  '  - **地图仅为粗略的地球大陆海岸线轮廓示意图，不能准确代表实际投影情况。**',
  '- 📍 **地面观测点**：随鼠标实时预览"从这里能看到多大范围、可见几颗卫星"，点击固定并高亮可见卫星，再点该点解除；',
  '- 🌍 **3D 地球（02）**：自转 + 拖拽 + 缩放，轨道圈分正/背面，显示可视区域，**轨道高度按 2.4× 夸张显示**以便区分高度壳层；',
  // V1.9.1（A15）：章节号 04/05 互换后，帮助里的特性列表也要**按新编号补齐** ——
  //   原文缺了「变轨情况」与「组网进度」两条，且把卫星表格写成（04）、发射历史写成（05）。
  '- 🛰️ **变轨情况（04）**：选定一颗卫星或一个批次/组，画出它的**轨道半长轴随时间的变化** —— 刚入轨时低、随后被发动机一点点抬到工作高度的那段"爬坡"；可切换纵轴量为「升轨速度」；已再入的卫星标红并有独立标记；',
  '- 📶 **组网进度（05）**：两条曲线分别是星网与千帆的组网推进速度，横轴按周、纵轴可切「发射量（累计）」或「在轨数量」；',
  '- 📋 **卫星表格（06）**：13 列轨道要素（含「在轨日, 天」与**「在轨状态」**）、混合搜索与联想、排序、每页 10 条，卫星名点击直达 satcat.com 对应条目；',
  '- 🚀 **发射历史（07）**：列序为「批次/组 · 运载火箭（后跟 COSPAR 编号）· 发射时间 · 发射地点 · 设计倾角 · 轨道要素」，火箭与发射地点染主题色带下划线可点跳转；按页浏览（每页 10 条），**整行点一下**就选中整批 —— 图表 / 地图 / 地球只高亮这一批，卫星表自动翻到当前排序下该批第一颗所在的页，批次表这一行用一条星网红 / 千帆蓝的长边框整行框住；待编目批次只标一个「待编目 ×N」标签，完整目录摘要悬停标签即可看到，不再铺开拉长表格；',
  '- 🎨 **界面**：深浅色主题、中英文切换、任意比例屏幕适配、三幅图一键全屏、右下角章节跳转药丸、顶部实时时钟。',
  '',
  '## ⚙️ 设置：本会话内全局生效、可一键还原',
  '',
  '- 任何一处设置改动都**全局生效**（改完立即对整个页面起作用，不区分章节）：**刷新页面、重新打开链接、点「还原所有默认设置」这三种情况都会把全部设置、三张图的视图、表格页码与所有搜索框一并还原成初始状态**；设置不写入浏览器本地存储，所以不会跨会话残留；',
  // V1.9.1（A15）：这句原本写"01 地图、02 轨道、03 倾角分布、04 卫星表格四个章节" ——
  //   两处都不对：卫星表格**没有**「默认设置」按钮，而真正有按钮的变轨情况/组网进度被漏掉了。
  '- 01 地图、02 轨道、03 倾角分布、04 变轨情况、05 组网进度五个章节各有一个 **「默认设置」** 按钮，只把该章节的这几项还原成初始配置（例如地图的覆盖区开关、最低仰角、显示轨道、配色）；',
  '- 页面顶部搜索框下面靠右还有一个 **「还原所有默认设置」**：把 01–05 全部章节、三张图的视图、表格与发射历史的页码、所有搜索框、**时间条**一起还原成初始状态。刚打开页面时它本来就是默认配置，按钮是**暗淡不可点**的，改动任意一项后才会亮起；',
  '- **初始默认配置（V1.7.1 起扩到「完全一致」）**：**中文界面 + 星网 + 暗色主题**，纵轴 = 半长轴、模型 = 布劳威尔、配色 = 按卫星、批次 = 全部；地图覆盖区开 / 最低仰角 10°、显示轨道开、显示名称关；地球可视锥开 / 最低仰角 10°、自转开、轨道开；表格按卫星名升序、只显示常用列；**时间条回到「实时」**。点「还原所有默认设置」会把星座与语言也一并拨回中文星网（不播动画，直接到位）；',
  '',
  '## 🚀 快速开始',
  '',
  '1. 拿到 `星网与千帆在轨追踪.html`（单文件）；',
  '2. 用现代浏览器（Edge / Chrome / Firefox / Safari）双击打开 —— **无需安装、无需联网**；',
  '3. 联网时页面会自动拉取最新一期轨道要素（三路分组/名称查询并发 + 两个公共代理兜底，各约 30–40 KB，6 秒内完成；全部失败时改用打包时内置的那一份）。',
  '',
  '## 🔭 两种缩放方式（含恢复原始比例）',
  '',
  '三幅图（图表 / 地图 / 地球）都支持同一套操作：',
  '',
  '1. **触屏**：双指捏合缩放；缩放后单指拖动 —— 地图平移、地球旋转、图表平移；',
  '2. **鼠标**：滚轮缩放；放大后按住拖动平移；双击复位；',
  '右下角从上到下依次是 **＋ 放大**、**− 缩小**、**⟳ 恢复原始比例**、**⛶ 全屏**、**🖨 导出图片**。',
  '',
  '> 地图缩放范围 1–8 倍；地球缩放范围约 0.5–2.8 倍基准半径；图表放到底约 1 天量级的时间跨度。点「恢复原始比例」即刻回到默认无放大的视图。',
  '',
  '## 🔠 字体与字号',
  '',
  '- 顶栏的 **CISTrack** 用 [Audiowide](https://fonts.google.com/specimen/Audiowide)（SIL Open Font License 1.1，已以 base64 内嵌进本文件，离线打开也是这个字形）32px；它只有一个字重，所以「加粗」是用描边（text-stroke）描出来的，比浏览器合成的伪粗体干净；',
  '- 正文、表格、信息窗的字号全部走 CSS `clamp()` 随窗口宽度**连续**变化 —— 以前只有「桌面」和「≤620px」两档，1080×2400 那种大屏手机被迫用小屏那一套，平板上又会在断点处突然跳一档；',
  '- 桌面端基准比手机端再大一档（正文字号 390px 宽时约 15.6px、1440px 宽时 17px），表头与数据改用同一侧对齐，数字列不再看起来「错位」。',
  '',
  '## 🔎 搜索与选择',
  '',
  '- 页面顶部（简介下方）、表格上方、以及地图与地球的全屏小窗里各有一个搜索框，四处**同步联想**：输入卫星名（中英文）、NORAD 编号或批次名，会以竖向候选表格列出匹配项，点一条即选中；',
  '- 也可以直接点击表格里的**批次名**，一次选中该批次的全部在轨卫星（再点一次取消）；',
  '- 选中之后：图表、地图、地球只高亮选中的卫星及其轨道，其余卫星变暗淡、不画轨道与覆盖区；表格中被选中的那一整行用**一条星网红 / 千帆蓝的长边框**框住，并自动翻到当前排序下第一个被选中项所在页；',
  '- 退出选择：再点一次该项，或点击图表 / 地图 / 地球 / 表格的空白处 —— 任何视图都能全局退出（已不再需要 Ctrl 多选）；',
  '- **图 → 表联动**：在图表 / 地图 / 地球里点中一颗卫星，卫星表格会自动翻到它所在的那一页，并把那一行闪一下；',
  '',
  '## 🖼️ 导出图片',
  '',
  '- 三幅图（地图 / 轨道 / 倾角分布）右下角最下面一个按键就是导出键：把当前这一屏画布连同一行「CISTrack · 星座 · 章节 · 日期」的说明一起存成 PNG；',
  '- 两个表格（卫星表格 / 发射历史）的导出键在翻页那一行的**右端**：把当前这一页按屏幕上的列顺序画成 PNG；',
  '- 全程在本机完成，不上传任何数据；文件名形如 `CISTrack_星网_卫星表格_p3_2026-09-30.png`。',
  '',
  '## 📱 全屏与移动端',
  '',
  '- 电脑端与手机端**同款全屏**：画布铺满整屏，左上角是「恢复默认视图」按钮（等同于页面里的「重置视图」）；地图与地球另有一个三角按钮，用来打开和收起左侧的设置小窗，小窗里同样带一个联想搜索框；',
  '- **03 倾角分布全屏改用顶部设置栏**：非全屏的那排控件（批次 / 纵轴量 / 模型 / 配色 / 重置视图）原样搬到屏幕顶上横排，屏幕窄时自动换行，画布会按栏高自动让出顶部空间；在全屏里做的选择与设置，退出全屏后一律保留；',
  '- 手机上全屏还会**自动转为横屏**（浏览器支持时）；面板之外的地图/地球仍可拖动与缩放（不雾化背景）；',
  '- 观测点模式在手机上为「点哪算哪」：轻点地图任意位置即设定观测点，仰角滑条默认 0° 且在未开启该模式前不可用；',
  '- 仰角滑条右侧的数值框点击即可键盘输入（只填数字，° 在框外；非法值保持原值）。',
  '',
  '## 🗺️ 地图：覆盖区与地面观测点',
  '',
  '- **可见倾角**（默认开启，**最低仰角默认 10°**）：画出每颗卫星对地面的可视覆盖区；把最低仰角调小到 0° 就是地平线可见的最大范围。',
  '- **显示轨道**（默认开启）：是否画出全部卫星的地面轨迹。',
  '- **选择地面观测点**：开启后卫星变暗、隐藏轨迹；鼠标移动时虚线圈（星座主题色）实时跟随，显示"此处可见 N 颗"；点击固定观测点后，可见圈内的卫星亮起 —— 此时**可以点这些亮起的卫星**：它们的信息窗与地面轨迹会一直显示，便于单星跟踪；再点一次该星、或点空白处，只是**退回观测点视图**（不会退回全部卫星都亮的视图）；点已固定的观测点才解除固定。',
  '- **单击任意卫星**（非观测点模式）：只保留该卫星的亮点、标签与轨道，其余卫星变暗、轨道隐藏；再次点击它或点空白处即可退出。',
  '- **标注自动避让**：卫星名与观测点那三行文字会动态挑选上下左右八个候选位，缩放与平移时始终互相错开，不会叠在一起。',
  '',
  '## 🌍 3D 地球：为什么要夸张高度',
  '',
  '真实的低轨星座都挤在地球半径 6%–19% 的薄壳里，直接按比例画会重叠成一层。本页把**轨道高度按 2.4× 夸张显示**，于是 400 km 停泊轨道、800 km 过渡轨道与 1000–1200 km 工作轨道会落在明显不同的壳层上，"两个星座各占几条高度壳层"一眼可见。',
  '',
  '> 夸张只影响显示半径，不影响倾角、轨道面夹角、覆盖区大小与所有数值。',
  '',
  '## 📊 科学口径',
  '',
  '### 半长轴的两套算法',
  '',
  '目录发布的平均运动采用 Kozai 约定（已含 J2 长期项）。**开普勒**半长轴 `a = (μ/n²)^(1/3)` 数值上等于密切半长轴在一个周期内的平均（本页用 Python sgp4 抽样核对，差 1 米量级）；**布劳威尔**半长轴再剥掉 J2 长期项，是 SGP4 内部递推真正使用的量：86.5° 近极轨道上比开普勒高约 2.9 km，50° 轨道上低约 0.7 km。默认展示布劳威尔（与目录口径一致）。',
  '',
  '### 可视覆盖区',
  '',
  '以星下点为中心的圆，地心半角 `λ = acos(Re/(Re+h)·cos ε) − ε`，`h` 为卫星瞬时高度、`ε` 为最小仰角。地图的「可见倾角」与地球的「可视区域」共用这一几何。',
  '',
  '### 顶部的星座计数：以卫星百科词条为准',
  '',
  '页面顶部的「发射卫星」「在轨卫星」「发射成功」三项**照搬卫星百科词条统计栏**（2026-09-30 核对：星网 248 / 244 / 40-41，千帆 262 / 262 / 19-19），括号内为词条原文的分项。其中真正能被本页实时推算位置的只是低轨互联网分组里的那部分（写在第二行）；早期试验星、星网的高轨业务星以及尚未公开轨道要素的新批次不在其中。表格里的卫星名可点击跳转到 [satcat.com](https://www.satcat.com) 的对应条目。',
  '',
  '### 在轨日, 天',
  '',
  '表格中的「在轨日, 天」= 从该批次发射时间到现在的天数，括号内为换算后的年月日（例如 `652d（01y09m15d）`）。它衡量的是整批卫星的在轨时长，可以配合半长轴看出电推进爬升的进度。',
  '',
  '## 🔗 数据来源',
  '',
  '- 🌐 [CelesTrak](https://celestrak.org/) —— NORAD 空间目标目录公开轨道要素（TLE），星网对应 `hulianwang` 分组、千帆对应 `qianfan` 分组；',
  '- 📚 [卫星百科](https://sat.huijiwiki.com/) —— 「星网」「千帆星座」词条的发射记录（批次、时间、运载火箭、发射地点）与**顶部星座总计数**（发射 / 在轨卫星数量、发射成功次数）均以词条记载为准，本页所有火箭 / 发射地点链接取自其词条原文；',
  '- 🗺️ [Natural Earth](https://www.naturalearthdata.com/) —— 公有领域海岸线底图（110m，经 Douglas-Peucker 简化后内联）；',
  '- 🧮 [satellite-js](https://github.com/shashwatak/satellite-js) —— MIT 协议的 SGP4 轨道推算开源实现。',
  '',
  '## 🧩 本地重建（开发者）',
  '',
  '源码与本文件同目录分发：`template.html`（页面骨架）、`app.js`（全部逻辑）、`mkdata.mjs`（TLE + 批次元数据 → satdata.json）、`refresh.mjs`（拉取当期 TLE）、`mkcoast.mjs`（海岸线）、`build.mjs`（组装单文件）、`smoke.mjs`（jsdom 冒烟测试）。',
  '',
  '```',
  'node refresh.mjs    # 可选：拉当期两组 TLE',
  'node mkdata.mjs     # 生成 build/satdata.json',
  'node build.mjs      # 组装单文件 HTML',
  'node smoke.mjs      # 冒烟测试',
  '```',
  '',
  '只需 Node.js（18+），没有其他依赖。',
  '',
  '## ⚠️ 精度与时效',
  '',
  '低轨要素每天发布数次，离历元几小时内的位置误差通常在公里量级；公开目录未发布轨道要素的批次（临时 10xxxx 号段）标为「待编目」，只计数量不参与计算。本页适合科普与"现在大概在哪"的展示，**不适用于过境预报、工程或科研用途**。',
  '',
  '## 📄 免责声明',
  '',
  '> 本项目由 AI（Agent 协同编程）辅助生成，虽经核对仍可能存在疏漏，请以官方发布为准。轨道数据来自公开目录，仅供科普与参考。本页为非官方项目，与中国卫星网络集团有限公司、上海垣信卫星科技有限公司均无关联。',
  '',
  '## ⚖️ 许可证',
  '',
  '本项目以 **MIT License** 发行（全文如下），可自由使用、修改、分发，包括商用 —— 只需保留版权与许可声明。',
  '',
  '```',
  MIT_TXT,
  '```',
  '',
  '---',
  '',
  '本页面由 [小橙子的宇宙Jackoraniverse](https://space.bilibili.com/455972735) 使用 AI 工具生成，灵感与最初版本来自于跟踪俄罗斯**[「黎明」星座](https://sat.huijiwiki.com/wiki/%E9%BB%8E%E6%98%8E%E6%98%9F%E5%BA%A7)**（Rassvet）态势的网站**[findrassvet.ru](https://findrassvet.ru/)**。'
].join('\n');
var README_EN = [
  '# 🛰️ CSCN & Qianfan Live Tracker',
  '',
  '> A visualization and tracking page for China\'s two LEO internet constellations: **CSCN** (China SatNet) and **Qianfan** (the G60 Starlink).',
  '> **One HTML file · computed entirely in the browser · works offline · MIT licensed.**',
  `> Current version **${VERSION}** — CISTrack (China LEO Internet Satellite Tracker).`,
  '',
  '---',
  '',
  '## 📖 About this page',
  '',
  '**What this is.** China is building two LEO broadband internet constellations at once: [CSCN](' + WIKI.gw + ') (China SatNet) and [Qianfan](' + WIKI.qf + ') (Qianfan, aka the G60 Starlink). This page turns public orbital elements into a chart, a map, a globe and a full table showing the constellations\' current on-orbit situation. Nothing here is a pre-rendered picture — every position is propagated live on **your device** with the SGP4 model.',
  '',
  '**Where the data comes from.** Orbital elements are published in the NORAD satellite catalog on CelesTrak: the `hulianwang` / `qianfan` constellation groups first, then a **name query** that recovers the early test satellites the groups miss, then a per-satellite lookup by COSPAR id against the full catalog; when several sources have the same satellite, the newest epoch wins; group names, launch times, vehicles and sites come from the launch records of the SatNet and Qianfan articles on the Satellite Wiki; coastlines come from the public-domain Natural Earth dataset; propagation uses the open-source satellite-js library. Homepages: [CelesTrak](https://celestrak.org/) · [Satellite Wiki](https://sat.huijiwiki.com/) · [Natural Earth](https://www.naturalearthdata.com/) · [satellite-js](https://github.com/shashwatak/satellite-js)',
  '',
  '**How fresh is it.** Each time the page opens it **automatically fetches the latest set of elements** — only the two current groups, never any history, so it only takes seconds. The element epoch at the top is the timestamp of the data you actually got: if that date looks stuck on some day, the fetch failed and the page fell back to the copy bundled in the file.',
'**The two data sources and who updates them (new in V1.7.1).** They refresh on completely different schedules:',
'| Data | Source | Who updates it | How often |',
'| --- | --- | --- | --- |',
'| **Orbital elements (TLE)** | CelesTrak public catalog | **Your own browser, at the moment the page opens** | Every visit (repeat opens within 30 min use a cache) |',
'| **Article counts** (launched / in-orbit, launch successes, first launch, "Satwiki info update") | Satellite Wiki articles | The scheduled job | Checked twice a day, 00:00 and 12:00 |',
'| **Group names, vehicles, sites, manufacturers** | Satellite Wiki launch tables | Baked in when the page is built | With each release |',
'',
'So: **the element epoch at the top is always the freshest data for this visit**, while the "Satwiki info update" line is the date the maintainer last checked. The counts not changing between two checks is normal — it means no new launch in that window.',
'',
'**If your network cannot reach CelesTrak.** The page tries three direct routes, then two public proxies — five in all — and only falls back to the bundled copy if all five fail, in which case the epoch at the top stops at the date of that copy. The page is not broken in that case; it is simply using its offline fallback. The maintainer rebuilds daily, so even that fallback is at most a day old.',
  '',
  '**Why two altitude models.** The catalog mean motion follows the Kozai convention and already includes secular J2 effects. **Kepler** inverts it directly, `a = (μ/n²)^⅓` — numerically the mean osculating semi-major axis over one revolution. **Brouwer** additionally strips the J2 secular terms (what SGP4 recurses with): ~2.9 km higher than Kepler on CSCN\'s 86.5° near-polar orbits, ~0.7 km lower on 50° orbits. Brouwer is the default, matching the catalog convention.',
  '',
  '**Semi-major axis is not altitude.** A satellite oscillates around it by ±a·e each revolution: ~±1.5 km at e = 2×10⁻⁴, tens of km on transfer orbits right after launch. For the constellation\'s climbing rhythm the SMA is the cleanest quantity; perigee and apogee are one click away.',
  '',
  '**Climbing takes months.** Most satellites first enter parking orbits of a few hundred to 800 km, then use electric propulsion to climb above 1,000 km. Newer groups therefore sit lower in the chart — they are still on their way, the orbit-distribution chart puts **inclination on the X axis**: which inclination bands each constellation occupies is obvious at a glance.',
  '',
  '**How to pick what you want to inspect.** There is an autocomplete search box at the top of the page, above the table, and inside every fullscreen panel: type a satellite name (Chinese or English), a NORAD number or a group name and a candidate list appears; click one to select it. You can also click the group name inside the table to select every in-orbit satellite of that group at once. Once something is selected, the chart, map and globe highlight only that satellite (or group) and its orbit, everything else dims and hides its orbit, and the matching table row is boxed with **one long red (CSCN) / blue (Qianfan) border** around the whole row, auto-scrolled to the right page. Click it again — or click any empty area in the chart, map, globe or table — to clear the selection everywhere.',

  '**The info panel: pinned, and draggable.** Once something is selected the info panel **stays pinned** — moving the cursor off the canvas no longer closes it, because it is meant to be repositioned: grab the panel and move it on a desktop, press and hold for about half a second first on touch (a thin red / blue constellation-coloured outline appears while dragging). The panel may be dragged **partly off the screen** (like a Windows window) but always keeps a sliver visible, and it never widens the page. The ✕ closes it without clearing the selection. **With a satellite selected, sweeping the cursor over another one raises a temporary preview.** It sits right next to the panel (or on its left / below when there is no room), looks exactly the same, but has **no ✕ and cannot be dragged**; it disappears as soon as you move off. A thin bar on its left edge marks it as a preview. Once you close the panel with ✕, **no window appears again** — hover anything you like; cancel the selection and pick a new satellite to bring it back. When a whole group is selected the panel shows only the satellite with the **lowest NORAD number**; clicking another satellite in the view just switches the panel to it while the group’s highlights stay exactly as they were.',
  '',
  '**Zoom & fullscreen.** All three views zoom with the mouse wheel / two-finger pinch, drag to pan once zoomed (the globe rotates) and double-click to reset; the lower right keeps "reset to original scale" and "fullscreen". In fullscreen the canvas fills the screen on both phones and desktops: a "Reset view" button sits at the top left, and the map and globe also get a triangle button that opens and closes the settings panel on the left — that panel carries its own autocomplete search box. On phones, fullscreen also turns the view to landscape. Selections made in fullscreen (satellites, elevations, colors) survive after leaving fullscreen. The map and globe also carry a clock pill at their top-right corner in fullscreen, styled like the one at the top of the page: a border in the constellation colour, breathing in sync with your device clock (bright on even seconds) while it tracks real time, switching to a steady yellow border once you move away from "now" — a reminder that what you see is no longer live.',
  '',
  '**Numbers on sliders.** Every elevation slider has a numeric box on its right — click it to type a value (digits only, the ° sits outside the box). Values outside 0–85 or invalid input keep your previous setting.',
  '',
  '**Which satellites are missing.** The most recent groups (CSCN 2026-176 / 187 / 213 / 221, Qianfan 2026-210 / 211, …) **are in the catalog** — with temporary NORAD numbers (100203–100799) and **published summary parameters** (period, inclination, perigee/apogee; hover the "pending" tag in the launch table to read them) — but their **full element sets (TLE) are not publicly distributed yet**: CelesTrak\'s GP endpoint returns nothing for temporary designators, Space-Track needs an account, and third-party mirrors (n2yo, tle.ivanstanojevic.me) do not carry them either. One verified example: COSPAR **2026-176A** is temporary number **100203**, already named **HULIANWANG DIGUI-178** — they are not lost, just filed as analyst objects pending permanent numbers. So this page can show the summary but cannot propagate them: they appear in none of the three views, except as **hollow dots with dashed altitude ranges** on the altitude chart (not selectable or hoverable). Once permanent numbers and elements appear, a rebuild promotes them automatically. Early test satellites and CSCN\'s GEO satellites sit outside these LEO groups and are not counted either. The "satellites launched / in orbit" and "launches succeeded" figures at the top are **taken verbatim from the Satellite Wiki statistics** (brackets quote the article\'s own breakdown); the number this page can actually propagate — objects with full published elements — sits on the second line as a TLE-side cross-check.',
  '',
  '**About this project.** Fully open source under the [MIT license](https://opensource.org/licenses/MIT) — free to use, modify and distribute (full text at the end). This page was created by [小橙子的宇宙Jackoraniverse](' + BILI + ') using AI tools, inspired by and originally based on [Где «Рассветы»](https://findrassvet.ru/) (Bureau 1440\'s Rassvet tracker).',
  '',
  '**Disclaimer.** This page was generated with the help of AI and reviewed, but may still contain errors; official sources prevail. Public catalog elements are limited in accuracy and age over time — typical position errors are kilometers within hours — for outreach and reference only, not for engineering, research or pass prediction. Unofficial project, not affiliated with China Satellite Network Group or Shanghai Spacecom Satellite Technology.',
  '',
  '---',
  '',
  '## ✨ What it does',
  '',
  '- 🛰️ **Live situation**: every position is propagated on your device with SGP4; chart, map and 3D globe stay in sync;',
  '- 🖼️ **Save image**: the bottom button of each view saves that canvas as a PNG; each table has one at the right end of its pager row. All local, nothing uploaded.',
  '- 📈 **Orbit distribution (03)**: X axis = orbital inclination, Y axis = orbit altitude (SMA / apogee / perigee), wheel or pinch zoom, box zoom, drag pan, double-click reset;',
  '- ⭕ **Pending groups**: objects that already carry a catalogue number and published summary parameters but whose full TLE has not been released upstream are drawn as **hollow dots with a dashed altitude band**; they take no part in selection or hover and never appear on the map or the 3D globe. **Neither constellation currently has any pending object** (V1.9.1 fixed the six-digit catalogue-number path, so everything is now ingested).',
  '- 🔗 **View → table**: picking a satellite in any view makes the satellite table jump to its page and flash the row.',
  '- **The map is only a rough outline of continental coastlines and does not accurately represent any real map projection.**',
  '- 🗺️ **Map**: per-satellite ground coverage zones (adjustable minimum elevation, 35° by default), half-orbit ground tracks, 1–8× zoom;',
  '- 📍 **Ground site picker**: hover to preview the visibility region and satellite count in real time; click to fix a site and highlight what it can see;',
  '- 🌍 **3D globe (02)**: spin + drag + zoom, orbit rings split into front/back halves, coverage zones, with **altitudes exaggerated 2.4×** so the shells are easy to tell apart;',
  // V1.9.1（A15）：按新编号补齐（原文缺「变轨情况」「组网进度」，且表格/发射历史编号是旧的 04/05）
  '- 🛰️ **Orbits Change Status (04)**: pick one satellite or one batch/group and see how its orbital **semi-major axis changes over time** — the climb from a low initial altitude up to the working altitude. The Y axis can be switched to *climb rate*; re-entered satellites are flagged in red.',
  '- 📶 **Network progress (05)**: two curves track how fast CSCN and Qianfan build their constellations; the X axis is weekly, the Y axis switches between cumulative launches and satellites in orbit.',
  '- 📋 **Satellite table (06)**: 13 element columns (including days in orbit and **orbit status**), autocomplete search, sorting, 10 rows per page — satellite names link straight to their satcat.com entries;',
  '- 🚀 **Launch history (07)**: column order is group · vehicle (followed by the COSPAR id) · launch time · launch site · design inclination · elements; rockets and sites are rendered in the constellation colour, underlined and clickable; 10 rows per page with wiki links; **click anywhere on a row** to select that group — the chart, map and globe highlight it, the satellite table auto-pages to the first satellite of that group under the current sort, and the row is boxed with one long red (CSCN) / blue (Qianfan) border; pending groups only carry a "pending ×N" tag — the full catalog summary sits in its tooltip instead of stretching the table;',
  '- 🎨 **UI**: dark/light themes, Chinese/English, fully responsive, one-click fullscreen, a section-jump pill and a live clock.',
  '',
  '## ⚙️ Settings: global within the session, one-click restore',
  '',
  '- Every setting is **global within the session** (it applies to the whole page the moment you change it): **refreshing the page, reopening the link, or clicking "Restore all defaults" returns every setting, all three chart views, the table page and all search boxes to their initial state**; nothing is written to browser storage, so no state is carried over between visits;',
  '- Sections 01 map, 02 globe, 03 orbit distribution, 04 orbits-change status and 05 network progress each carry a **"Defaults"** button that restores only that section\'s own settings (e.g. map coverage on/off, minimum elevation, orbits, colors);',
  '- Right-aligned under the search box at the top sits **"Restore all defaults"**, which resets sections 01–05 plus all three chart views, the table and launch-history page numbers, every search box **and the time slider** in one go. On a fresh page everything is already default, so the button is **dimmed and disabled** until you change something;',
  '- **Initial defaults (V1.7.1: now fully consistent)**: **the page always opens in Chinese, on the CSCN constellation, in the dark theme**; Y axis = SMA, model = Brouwer, colors = by satellite, group = all; map coverage on / min. elevation 10°, orbits on, names off; globe cones on / min. elevation 10°, spin on, orbits on; table sorted by satellite name ascending with the common columns only; **time slider back to live**. "Restore all defaults" also switches the language back to Chinese and the constellation back to CSCN (instantly, no animation).',
  '',
  '## 🚀 Quick start',
  '',
  '1. Get `星网与千帆在轨追踪.html` (a single file);',
  '2. Open it in a modern browser — **no install, no network required**;',
  '3. Online, it fetches the latest elements for the two constellation groups (~30–40 KB each, within 6 s, otherwise it falls back to the built-in snapshot).',
  '',
  '## 🔭 Two ways to zoom (plus reset)',
  '',
  'All three views share the same controls:',
  '',
  '1. **Touch**: pinch with two fingers; drag with one finger afterwards — pan the map, rotate the globe, pan the chart;',
  '2. **Mouse**: wheel to zoom, drag to pan once zoomed, double-click to reset;',
  // V1.8.0（需求15 i18n 审计）：这里的加号改用半角 `+` —— 原文是全角「＋」（U+FF0B），
  //   属 CJK 标点，英文界面漏出会被审计抓出来。中文那一份（README_ZH）保留全角。
  'The lower right carries, top to bottom: **+ zoom in**, **− zoom out**, **⟳ reset to the original scale**, **⛶ fullscreen** and **🖨 save image**.',
  '',
  '> Map zoom range 1–8×; globe zoom ≈0.5–2.8× of the base radius; the chart can zoom down to roughly a one-day time span. "Reset" returns instantly to the default unzoomed view.',
  '',
  '## 🔠 Type and sizing',
  '',
  '- The **CISTrack** wordmark uses [Audiowide](https://fonts.google.com/specimen/Audiowide) (SIL Open Font License 1.1, embedded as base64 so the single file works offline) at 32px. It ships one weight only, so "bold" is drawn with a text stroke — cleaner than the browser-synthesised faux bold;',
  '- Body, table and info-window sizes all use CSS `clamp()` and scale **continuously** with window width, instead of jumping one notch at a breakpoint;',
  '- Desktop sizes sit one notch above phones (body ≈ 15.6px at 390px wide, 17px at 1440px); table headers and cells now align on the same side, so numeric columns no longer look offset.',
  '',
  '## 🔎 Search and selection',
  '',
  '- Four search boxes — top of the page, above the table, and inside the map/globe fullscreen panels — stay in sync: type a satellite name (Chinese or English), a NORAD number or a group name and pick from the vertical suggestion list;',
  '- Or click a **group name** inside the table to select every in-orbit satellite of that group (click again to clear);',
  '- Once selected: the chart, map and globe highlight only that satellite/group and its orbit, other satellites dim and drop their orbits and coverage zones; the matching table row is boxed with **one long red (CSCN) / blue (Qianfan) border** and the tables jump to the page holding the first selected row under the current sort order;',
  '- To clear: click the same item again, or click any empty area of the chart, map, globe or table — it works globally (Ctrl multi-select is gone).',
  '',
  '## 📱 Fullscreen and mobile',
  '',
  '- **Identical fullscreen on desktop and phone**: the canvas fills the screen, with a "Reset view" button at the top left (same as "Reset view" on the page); the map and globe also get a triangle button that opens and closes the settings panel on the left — that panel carries its own autocomplete search box;',
  '- **Section 03 uses a top settings bar instead**: the normal controls (group / Y axis / model / colors / reset view) move to a bar across the top of the screen, wrapping to more lines on narrow screens; the canvas reserves room for it automatically. Selections and settings made in fullscreen survive after you leave it.',
  '- Fullscreen on phones also switches to **landscape** where supported; the map and globe remain interactive behind the panel (no backdrop blur);',
  '- Ground-site mode on touch is "tap where you mean": tap anywhere on the map to set the site. The elevation slider starts disabled at 0° until the mode is on;',
  '- Click any elevation number box to type a value (digits only, the ° sits outside; invalid input keeps the previous value).',
  '',
  '## 🗺️ Map: coverage and ground sites',
  '',
  '- **Coverage** (on by default, **minimum elevation 10\u00b0**): draws each satellite\'s ground footprint; set the minimum elevation to 0\u00b0 for the horizon-limited maximum.',
  '- **Orbits** (on by default): whether to draw every satellite\'s ground track.',
  '- **Pick ground site**: satellites dim and tracks hide; the dashed circle (drawn in the constellation colour) follows the cursor showing how many satellites would be visible; click to fix the site and the satellites inside the circle light up. **You can then click those lit satellites** \u2014 their info panel and ground track stay up for single-satellite tracking. Clicking that satellite again, or clicking empty space, only **returns to the site view**, never back to "every satellite lit"; clicking the fixed site itself releases it.',
  '- **Click any satellite** (outside site mode): only that satellite keeps its dot, label and orbit \u2014 all others dim and their orbits are hidden. Click it again or click empty space to clear.',
  '- **Label avoidance**: satellite names and the three site lines pick among eight candidate offsets (up / down / left / right and the diagonals), so they never pile up while you zoom or pan;',
  '',
  '## 🌍 Why the globe exaggerates altitude',
  '',
  'Real LEO constellations sit in a thin shell between 6% and 19% of Earth\'s radius, which overlaps into a single band when drawn to scale. This page draws **orbital altitude exaggerated 2.4×**, so 400 km parking orbits, 800 km transfer orbits and 1,000–1,200 km working orbits land on clearly different shells. The exaggeration affects the drawn radius only — never inclinations, plane geometry, coverage sizes or any numeric value.',
  '',
  '## 📊 Accuracy & data',
  '',
  '### Two semi-major axis conventions',
  '',
  'The catalog mean motion follows the Kozai convention (secular J2 included). **Kepler**: `a = (μ/n²)^(1/3)`, numerically the mean osculating SMA over one revolution. **Brouwer**: with the J2 secular terms removed — what SGP4 recurses with: ~2.9 km higher than Kepler on 86.5° near-polar orbits, ~0.7 km lower at 50°. Brouwer is shown by default, matching the catalog.',
  '',
  '### Coverage geometry',
  '',
  'A circle centred on the sub-satellite point with geocentric radius `λ = acos(Re/(Re+h)·cos ε) − ε`, where `h` is the current altitude and `ε` the minimum elevation.',
  '',
  '### The counters at the top: per the Satellite Wiki',
  '',
  'The "satellites launched", "satellites in orbit" and "launches succeeded" figures at the top are quoted **verbatim from the Satellite Wiki statistics** (checked 2026-09-30: CSCN 248 / 244 / 40-41, Qianfan 262 / 262 / 19-19), with the article\'s own breakdown in brackets. Only the LEO internet groups can actually be propagated by this page (shown on the second line); early test satellites, CSCN\'s GEO satellites and groups without published elements are not among them. Satellite names in the table link to their [satcat.com](https://www.satcat.com) entries.',
  '',
  '### Days in orbit',
  '',
  'The "Days in orbit" column counts from the group\'s launch date to now, with a years/months/days breakdown in brackets (e.g. `652d (01y09m15d)`).',
  '',
  '## 🔗 Sources',
  '',
  '- 🌐 [CelesTrak](https://celestrak.org/) — public NORAD catalog elements (`hulianwang` / `qianfan` groups);',
  '- 📚 [Satellite Wiki](https://sat.huijiwiki.com/) — launch records of the SatNet and Qianfan articles **and the constellation totals at the top of the page** (all rocket/site links come from those pages);',
  '- 🗺️ [Natural Earth](https://www.naturalearthdata.com/) — public-domain coastlines (110m, Douglas-Peucker simplified);',
  '- 🧮 [satellite-js](https://github.com/shashwatak/satellite-js) — MIT-licensed SGP4 implementation.',
  '',
  '## 🧩 Rebuild (developers)',
  '',
  'Source files ship next to the HTML: `template.html`, `app.js`, `mkdata.mjs`, `refresh.mjs`, `mkcoast.mjs`, `build.mjs`, `smoke.mjs`.',
  '',
  '```',
  'node refresh.mjs   # optional: fetch current TLEs',
  'node mkdata.mjs    # build satdata.json',
  'node build.mjs     # assemble the single HTML file',
  'node smoke.mjs     # smoke test',
  '```',
  '',
  'Node.js 18+ only, no other dependencies.',
  '',
  '## ⚠️ Disclaimer',
  '',
  '> Generated with AI assistance and reviewed, but errors may remain; official sources prevail. Orbit data comes from the public catalog and is for outreach and reference only — not for pass prediction, engineering or research. Unofficial project, not affiliated with China Satellite Network Group or Shanghai Spacecom Satellite Technology.',
  '',
  '## ⚖️ License',
  '',
  'Released under the **MIT License** (full text below). Free to use, modify and distribute, including commercially — just keep the copyright and license notice.',
  '',
  '```',
  MIT_TXT,
  '```',
  '',
  '---',
  '',
  'This page was created by [小橙子的宇宙Jackoraniverse](https://space.bilibili.com/455972735) using AI tools, inspired by **[findrassvet.ru](https://findrassvet.ru/)**, a site tracking Russia\'s **[Rassvet Constellation](https://sat.huijiwiki.com/wiki/%E9%BB%8E%E6%98%8E%E6%98%9F%E5%BA%A7)**.'
].join('\n');
var readmeOpen = false;
function renderReadme() {
  document.getElementById('readmeBody').innerHTML = md2html(LANG === 'en' ? README_EN : README_ZH);
}
function openReadme() {
  renderReadme();
  readmeOpen = true;
  document.documentElement.classList.add('modal-open');   // 锁住背景滚动
  document.getElementById('readmeMask').classList.remove('hide');
}
function closeReadme() {
  readmeOpen = false;
  document.documentElement.classList.remove('modal-open');
  document.getElementById('readmeMask').classList.add('hide');
}
document.getElementById('readmeBtn').addEventListener('click', openReadme);
document.getElementById('readmeX').addEventListener('click', closeReadme);
document.getElementById('readmeMask').addEventListener('click', function (e) {
  if (e.target === this) closeReadme();
});
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && readmeOpen) closeReadme();
});

// ---------------------------------------------------------------- 顶部时钟药丸
var clockUTC = false;
function gmtLabel(d, utc) {
  if (utc) return 'GMT';
  var m = -d.getTimezoneOffset();
  var sg = m >= 0 ? '+' : '-';
  m = Math.abs(m);
  var hh = Math.floor(m / 60), mm = m % 60;
  return 'GMT' + sg + (mm ? hh + ':' + pad(mm) : '' + hh);
}
function tickClock() {
  var d = new Date();
  var y, mo, da, h, mi, se;
  if (clockUTC) { y = d.getUTCFullYear(); mo = d.getUTCMonth(); da = d.getUTCDate(); h = d.getUTCHours(); mi = d.getUTCMinutes(); se = d.getUTCSeconds(); }
  else { y = d.getFullYear(); mo = d.getMonth(); da = d.getDate(); h = d.getHours(); mi = d.getMinutes(); se = d.getSeconds(); }
  var hms = pad(h) + ':' + pad(mi) + ':' + pad(se);
  // V1.6.3：主页药丸始终显示完整日期时间，且日期与时间之间用**一个空格**（不再用 T）
  var fullTxt = '(' + gmtLabel(d, clockUTC) + ') ' + y + '/' + pad(mo + 1) + '/' + pad(da) + ' ' + hms;
  var clockTxtEl = document.getElementById('clockTxt');
  if (clockTxtEl) clockTxtEl.textContent = fullTxt;
  // V1.7.0（任务7）：02/03 全屏右上角时间药丸 —— 可点击在「本地(GMT+8) ↔ GMT」间切换（默认本地）。
  // 用独立状态 fsClockGMT，避免影响主页药丸；GMT 显示为简化形式「GMT HH:MM:SS」。
  var fh, fmi, fse, flabel;
  if (fsClockGMT) {
    var du = new Date();
    fh = du.getUTCHours(); fmi = du.getUTCMinutes(); fse = du.getUTCSeconds();
    flabel = 'GMT';
  } else {
    fh = d.getHours(); fmi = d.getMinutes(); fse = d.getSeconds();
    flabel = gmtLabel(d, false);
  }
  var fsShort = flabel + ' ' + pad(fh) + ':' + pad(fmi) + ':' + pad(fse);
  document.querySelectorAll('.fs-clock span').forEach(function (el) { el.textContent = fsShort; });
}
// 时间被推离「实时」→ 该章全屏时间药丸**固定黄色边框**（V1.7.3 需求9/10：不再呼吸）；
// 回到实时 → 主题色呼吸边框（呼吸由 loop() 的 updateBreath 逐帧驱动，与本机秒针对齐）。
function syncFsClockState() {
  var cm = document.getElementById('fsClockMap'), cg = document.getElementById('fsClockGlobe');
  if (cm) cm.classList.toggle('late', S.time.map.off !== 0);
  if (cg) cg.classList.toggle('late', S.time.globe.off !== 0);
}
// ── V1.7.3（需求9 + 需求10）：时间药丸「呼吸灯」──────────────────────────────
//   实时章：.time-val 用主题色（--row-sel，星网红/千帆蓝）呼吸亮灭（亮→无色透明→亮，2s 对称）；
//           全屏 .fs-clock 呼吸主题色边框（文字保持可读）。
//   冻结章：.time-val 黄色常亮填充（#f59f00，同「未编目发射记录」标签）；.fs-clock 固定黄边框。
//   对齐规则：**亮相必须落在本机偶数秒**——rAF 逐帧按 Date.now() % 2 计算亮度，
//   天然与秒针对齐；任何操作（拖动/恢复）后的下一帧即按当前墙钟重新对齐（等价"空周期重对齐"）。
function hexToRgba(hex, a) {
  var m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return hex;
  var n = parseInt(m[1], 16);
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a.toFixed(3) + ')';
}
var BREATH_FLOOR = 0.15;                       // 灭相位保底透明度（完全不可见会像按钮坏了）
function updateBreath() {
  var p = (Date.now() / 1000) % 2;             // 0..2；p=0 即偶数秒
  var b = Math.abs(p - 1);                     // 1→0→1：偶数秒最亮，奇数秒最暗
  ['map', 'globe'].forEach(function (v) {
    var ts = S.time[v];
    var tv = document.querySelector('.time-val[data-view="' + v + '"]');
    if (tv) {
      if (ts.off !== 0) {                      // 冻结：黄色常亮（清掉呼吸的内联样式）
        tv.classList.add('frozen');
        tv.classList.remove('rt-breathe');
        tv.style.opacity = ''; tv.style.color = ''; tv.style.borderColor = ''; tv.style.background = '';
      } else {                                 // 实时：主题色呼吸 —— V1.8.0（需求2）：改**填充呼吸**
        tv.classList.remove('frozen');
        tv.classList.add('rt-breathe');        // 关掉 CSS 过渡，逐帧内联样式不被 .2s 过渡拖慢
        var c = cssVar('--row-sel', '#ff6b6b');
        tv.style.color = 'var(--fg)';          // 文字恒 --fg：暗色=白 / 亮色=黑（需求2 口径）
        tv.style.borderColor = '';             // 边框不再参与呼吸
        tv.style.opacity = '';                 // 整体透明度不再参与呼吸
        tv.style.background = hexToRgba(c, BREATH_FLOOR + (1 - BREATH_FLOOR) * b);
      }
    }
    var fc = document.getElementById(v === 'map' ? 'fsClockMap' : 'fsClockGlobe');
    if (fc) {
      if (ts.off !== 0) fc.style.borderColor = '';          // 冻结：交给 .late 的固定黄边框
      else fc.style.borderColor = hexToRgba(cssVar('--row-sel', '#ff6b6b'), 0.25 + 0.75 * b);
    }
  });
}
// V1.7.3（需求10）：药丸点按的 Q 弹动画（弹一下：缩小→回弹过冲→回正）
function popPill(el) {
  if (!el) return;
  el.classList.remove('pill-pop');
  void el.offsetWidth;                          // 强制重排，连点也能重启动画
  el.classList.add('pill-pop');
  el.addEventListener('animationend', function h() { el.classList.remove('pill-pop'); el.removeEventListener('animationend', h); });
}
document.getElementById('clockPill').addEventListener('click', function () { clockUTC = !clockUTC; tickClock(); popPill(this); });
// V1.7.0（任务7）：全屏右上角的时钟药丸点击切换「本地(GMT+8) ↔ GMT」，默认本地
var fsClockGMT = false;
document.querySelectorAll('.fs-clock').forEach(function (el) {
  el.style.cursor = 'pointer';
  el.addEventListener('click', function (e) {
    e.stopPropagation();
    fsClockGMT = !fsClockGMT;
    tickClock();
    popPill(this);
  });
});
// V1.7.3（需求10）：药丸**固定宽度** —— 定到「GMT+X」这种更长形态的宽度；显示短形态「GMT」时
//   内容居中（左右留空），切换时药丸不再变宽变窄。按各药丸自己的计算字体离屏实测（手机 fs-clock
//   有独立的 10px 字号断点），resize / 换语言 / 首帧延迟补测都会重算。
function fixPillWidths() {
  var jobs = [];
  var pill = document.getElementById('clockPill');
  var txt = document.getElementById('clockTxt');
  if (pill && txt) jobs.push({ pill: pill, txt: txt, sample: '(' + pillLabel() + ') 00/00/0000 00:00:00' });
  document.querySelectorAll('.fs-clock').forEach(function (fc) {
    var sp = fc.querySelector('span');
    if (sp) jobs.push({ pill: fc, txt: sp, sample: pillLabel() + ' 00:00:00' });
  });
  jobs.forEach(function (j) {
    var st = getComputedStyle(j.txt);
    var probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;left:-9999px;top:-9999px;white-space:pre;';
    probe.style.font = st.font;
    probe.style.letterSpacing = st.letterSpacing;
    probe.textContent = j.sample;
    document.body.appendChild(probe);
    var w = probe.getBoundingClientRect().width;
    document.body.removeChild(probe);
    var ps = getComputedStyle(j.pill);
    var extra = (parseFloat(ps.paddingLeft) || 0) + (parseFloat(ps.paddingRight) || 0) +
                (parseFloat(ps.borderLeftWidth) || 0) + (parseFloat(ps.borderRightWidth) || 0);
    j.pill.style.minWidth = Math.ceil(w + extra) + 'px';
    j.pill.style.boxSizing = 'border-box';
    j.pill.style.justifyContent = 'center';
    if (j.pill.id === 'clockPill') j.pill.style.display = 'flex';
  });
}
// 量宽用的「最长本地时区标签」：GMT 本身比 GMT+8 短 → 用 GMT+8 量；GMT+HH:MM 这类更长的按实际量
function pillLabel() {
  var lbl = gmtLabel(new Date(), false);
  return (lbl && lbl.length >= 5) ? lbl : 'GMT+8';
}
setInterval(tickClock, 500);

// ---------------------------------------------------------------- 画布控件：放大 / 缩小 / 恢复 / 全屏
var ZOOM_STEP = 1.25;                 // 每一级的放大倍数（级数更细，共 1–8 倍约 9 级）
document.querySelectorAll('.view-ctl button[data-zoom]').forEach(function (b) {
  b.addEventListener('click', function (e) {
    e.stopPropagation();
    var dir = b.getAttribute('data-zoom') === 'in' ? ZOOM_STEP : 1 / ZOOM_STEP;
    var view = b.getAttribute('data-view');
    if (view === 'chart') {
      smoothZoom(function (f) {
        zoomChartAt(chartCv._w / 2, chartCv._h / 2, 1 / f);
      }, dir, 260);
    } else if (view === 'map') {
      smoothZoom(function (f) { zoomMapAt(mapCv._w / 2, mapCv._h / 2, f); mapDirty = true; }, dir, 260);
    } else if (view === 'globe') {
      smoothZoom(function (f) { globeZoomBy(f); }, dir, 260);
    } else if (view === 'progress') {
      // V1.8.0（需求8）：03.5 组网进度 —— 与地图/地球同向（factor>1 = 放大），
      //   同样走 smoothZoom，使四张图的 ＋/− 手感与时长完全一致。
      smoothZoom(function (f) { zoomNetBy(f); }, dir, 260);
    } else if (view === 'climb') {
      // V1.9.0（R17）：04 变轨情况 —— 第五张图，同样走 smoothZoom / 260ms，
      //   与前四张的手感、时长严格一致（不新写一套动画）。
      smoothZoom(function (f) { zoomClimbBy(f); }, dir, 260);
    }
  });
});
// V1.3.7：导出图片（三个图章节的按键组最下面一个 / 两个表格右下角）
document.querySelectorAll('.view-ctl button[data-shot]').forEach(function (b) {
  b.addEventListener('click', function (e) {
    e.stopPropagation();
    exportView(b.getAttribute('data-shot'));
  });
});
// V1.4.0：点导出键不再直接出图，而是弹一个小窗（当前页 / 多页 / 全页），三键竖排居中
function shotPopEls(which) {
  return {
    pop: document.getElementById(which === 'sat' ? 'shotPopSat' : 'shotPopLaunch'),
    num: document.getElementById(which === 'sat' ? 'shotNumSat' : 'shotNumLaunch')
  };
}
function shotTotalPages(which) {
  var n = (which === 'sat') ? LAST_ROWS.length : LAST_LAUNCH_ROWS.length;
  return Math.max(1, Math.ceil(n / PAGE_SIZE));
}
function closeShotPops() {
  ['shotPopSat', 'shotPopLaunch'].forEach(function (id) {
    var p = document.getElementById(id);
    if (!p) return;
    p.hidden = true;
    var inp = p.querySelector('.sp-num');
    if (inp) inp.classList.remove('bad');
  });
}
function openShotPop(which) {
  closeShotPops();
  var e = shotPopEls(which);
  if (!e.pop) return;
  if (e.num) {
    e.num.value = '';
    e.num.placeholder = (LANG === 'en' ? 'pages 1-' : '页数 1–') + shotTotalPages(which);
  }
  e.pop.hidden = false;
}
document.addEventListener('click', function (e) {
  var b = e.target.closest && e.target.closest('button[data-tshot]');
  if (b) { e.stopPropagation(); openShotPop(b.getAttribute('data-tshot')); return; }
  var doBtn = e.target.closest && e.target.closest('button[data-shot-do]');
  if (doBtn) {
    var pop = doBtn.closest('.shot-pop');
    if (!pop) return;
    var which = (pop.id === 'shotPopSat') ? 'sat' : 'launch';
    var mode = doBtn.getAttribute('data-shot-do');
    if (mode === 'multi') {
      if (!shotMulti(which)) return;              // 非法/越界 → 红框，不关窗
    } else {
      exportTable({ which: which, mode: mode, allCols: shotAllCols(which) });
    }
    closeShotPops();
    return;
  }
  if (!e.target.closest || !e.target.closest('.pager-wrap')) closeShotPops();
});
// V1.4.1：读开关；默认勾选（含全部列）
function shotAllCols(which) {
  var box = document.getElementById(which === 'sat' ? 'shotAllColsSat' : 'shotAllColsLaunch');
  return !box || box.checked;
}
// V1.4.1：多页导出（点按钮或按 Enter 都走这里）
function shotMulti(which) {
  var inp = shotPopEls(which).num, total = shotTotalPages(which);
  var v = String(inp.value || '').trim();
  var n = /^\d+$/.test(v) ? parseInt(v, 10) : NaN;
  if (!(n >= 1 && n <= total)) { inp.classList.add('bad'); inp.focus(); return false; }
  inp.classList.remove('bad');
  exportTable({ which: which, mode: n, allCols: shotAllCols(which) });
  return true;
}
// V1.4.1：在页数输入框里按 Enter = 点「导出多页」
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Enter') return;
  var inp = e.target.closest && e.target.closest('.sp-num');
  if (!inp) return;
  var pop = inp.closest('.shot-pop');
  if (!pop) return;
  e.preventDefault();
  var which = pop.id === 'shotPopSat' ? 'sat' : 'launch';
  if (shotMulti(which)) closeShotPops();
});
// 恢复原始比例（默认不放大）
function resetView(view) {
  if (view === 'chart') { chartAutoView(); drawChart(); }
  else if (view === 'map') { S.mz = { k: 1, tx: 0, ty: 0 }; mapDirty = true; }
  else if (view === 'globe') { G.zoom = 1; globeDirty = true; }
  else if (view === 'progress') { netView = null; netAutoView(); drawNet(); }   // V1.8.0（需求8）
  else if (view === 'climb') { climbView = null; climbAutoView(); drawClimb(); } // V1.9.0（R17）
}
document.querySelectorAll('.view-ctl button[data-reset]').forEach(function (b) {
  b.addEventListener('click', function (e) {
    e.stopPropagation();
    resetView(b.getAttribute('data-reset'));
  });
});
document.querySelectorAll('.view-ctl button[data-fs]').forEach(function (b) {
  b.addEventListener('click', function (e) {
    e.stopPropagation();
    var sec = document.getElementById(b.getAttribute('data-fs'));
    if (!sec) return;
    // V1.8.0（D2）：补 webkit 全屏（iOS Safari 只有 webkit 前缀或根本没有）
    var fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
    window.__fsScrollY = window.scrollY || 0;   // V1.5.1：进入前那一刻记录，退出时精确回到这里
    // V1.8.0（D2）：iOS 等浏览器没有 requestFullscreen（至多只有 webkit 前缀）——
    //   旧版 `if (sec.requestFullscreen)` 直接整段跳过 = 按钮点了没反应、无降级无提示。
    //   现在：标准 API → webkit 前缀 → 都没有就走伪全屏降级并提示一次，绝不静默。
    var req = sec.requestFullscreen || sec.webkitRequestFullscreen;
    var p = null;
    if (req) {
      try { p = req.call(sec); } catch (err) {}
      if (p && p.catch) p.catch(function () { applyPseudoFull(true, sec); notifyFsFallback(); });
      setTimeout(function () {
        if (!document.fullscreenElement && !document.webkitFullscreenElement) { applyPseudoFull(true, sec); notifyFsFallback(); }
      }, 500);
    } else {
      applyPseudoFull(true, sec); notifyFsFallback();
    }
  });
});
// V1.7.0 二轮（需求6）：真全屏失败时的提示（同一会话只提示一次）
var _fsHinted = false;
function notifyFsFallback() {
  if (_fsHinted) return;
  _fsHinted = true;
  try {
    showNotice(t('fs_fallback_t'), t('fs_fallback_m'));
  } catch (e) {}
}
// 全屏左上角「恢复默认视图」：与页面里 #resetZoom 是同一个动作（图表回到自动视野，地图/地球回到 1×）
// 01 章节全屏顶栏的实际高度（窄屏会换行变高）→ 写进 --fsbar-h，画布据此让位
function syncFsBarHeight() {
  // V1.8.0（需求8）：03.5 组网进度沿用同一套「全屏顶栏让位」机制 → 两章各量各的
  ['sec-chart', 'sec-progress'].forEach(function (id) {
    var sec = document.getElementById(id);
    if (!sec) return;
    var c = sec.querySelector('.controls');
    if (!c) return;
    var h = sec.classList.contains('fs-mobile') ? Math.ceil(c.getBoundingClientRect().height) : 0;
    sec.style.setProperty('--fsbar-h', (h || 58) + 'px');
  });
  // V1.9.0（R17）：04 变轨情况全屏时把 .climb-bar 固定到顶部（它没有 .controls 行，
  //   所以量的是 climb-bar 自己），高度写进 --climbbar-h，画布按 100vh − 两者 让位。
  //   不量的话窄屏下 climb-bar 会换行变高（实测能到 60px+），画布就会多出一截空白。
  var sc = document.getElementById('sec-climb');
  if (sc) {
    var cb = sc.querySelector('.climb-bar');
    if (cb) {
      var ch = sc.classList.contains('fs-mobile') ? Math.ceil(cb.getBoundingClientRect().height) : 0;
      sc.style.setProperty('--climbbar-h', (ch || 40) + 'px');
    }
  }
}
// （V1.8.0 需求8 已把上面那个函数改成两章通用；旧的单章实现删除，避免死代码。）

function renderFsSug(el, q) {
  if (!el) return;
  var raw = String(q || '').trim();
  if (!raw) {
    var h = SEARCH_HISTORY[S.key] || [];
    if (!h.length) { el.classList.remove('open'); el.innerHTML = ''; return; }
    el.innerHTML = h.slice(0, window.innerHeight < 520 ? 3 : 6).map(function (o) { return sugItemHtml(o, t('d_search_recent')); }).join('');
    el.classList.add('open'); return;
  }
  var list = searchCandidates(raw).slice(0, window.innerHeight < 520 ? 3 : 6);
  if (!list.length) { el.innerHTML = '<div class="sug-item" style="cursor:default">' + t('d_search_none') + '</div>'; el.classList.add('open'); return; }
  el.innerHTML = list.map(function (o) { return sugItemHtml(o, ''); }).join('');
  el.classList.add('open');
}


// V1.5.1：搜索键 —— 点击选中联想第一项（没有候选时只是聚焦）
document.querySelectorAll('.search-key').forEach(function (k) {
  k.addEventListener('click', function (e) {
    e.stopPropagation();
    var wrap = k.closest('.search-wrap') || k.closest('.fs-search-wrap');
    var input = wrap && wrap.querySelector('input');
    var sug = wrap && wrap.querySelector('.sug-list');
    var first = sug && sug.querySelector('.sug-item[data-kind]');
    if (first) first.click();
    else if (input) input.focus();
  });
});


// V1.5.2：把 △ 与「重置视图」从 .fs-bar 里提到 section 直接子级 —— 它们在 .fs-bar
// （自带 z-index 与定位上下文）里时，展开控件抽屉后会被盖住，看起来像「按钮消失了」。
(function liftFsButtons() {
  document.querySelectorAll('.fs-panel-btn').forEach(function (b) {
    var sec = b.closest('section');
    if (sec && b.parentElement !== sec) sec.appendChild(b);
  });
})();

document.querySelectorAll('.fs-exit-btn').forEach(function (b) {
  b.addEventListener('click', function (e) {
    e.stopPropagation();
    var fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
    // V1.8.0（D3）：伪全屏降级态下没有 fullscreenElement，旧版 × 点了完全没反应 ——
    //   这里补上降级态的退出：摘 fs-mobile/pseudo-full、恢复滚动、回到进入前位置。
    var sec = b.closest ? b.closest('section') : null;
    if (sec) sec.classList.remove('fs-mobile', 'panel-open');
    document.querySelectorAll('section.fs-mobile').forEach(function (x) { x.classList.remove('fs-mobile', 'panel-open'); });
    document.documentElement.classList.remove('pseudo-full');
    document.documentElement.style.overflow = '';
    try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch (e2) {}
    var y = (typeof preFsScrollY === 'number') ? preFsScrollY : (window.__fsScrollY || 0);
    try { window.scrollTo(0, y); } catch (e3) {}
    // V1.9.0（需求11）：这里原来是 `if (ORI_HINT_ON) orientHint(false);` —— 随"删掉方向提示遮罩"
    //   一起作废（orientHint 与 ORI_HINT_ON 都已删除）。**留着会是一句悬空引用**：
    //   虽然被 try/catch 吞掉、表现上无害，但属于死代码，且会掩盖真正的错误。故整行移除。
  });
});
// V1.4.9：全屏期间保持屏幕常亮（Wake Lock）。手机端「熄屏后全屏自动退出」是移动浏览器的
// 系统行为（熄屏会连带释放全屏），网页拦不住 —— 但让屏幕根本不熄，问题就绕过去了。
var wakeLockSentinel = null;
function reqWakeLock() {
  try {
    if ('wakeLock' in navigator && document.fullscreenElement && !wakeLockSentinel) {
      navigator.wakeLock.request('screen').then(function (l) { wakeLockSentinel = l; }).catch(function () {});
    }
  } catch (e) {}
}
function dropWakeLock() {
  try { if (wakeLockSentinel) { wakeLockSentinel.release().catch(function () {}); wakeLockSentinel = null; } } catch (e) {}
  // V1.5.2：退出全屏时先试锁竖屏（此刻仍全屏、权限还在），失败再解锁交给系统
  try {
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('portrait').catch(function () {
        try { screen.orientation.unlock(); } catch (e2) {}
      });
    } else if (screen.orientation && screen.orientation.unlock) {
      screen.orientation.unlock();
    }
  } catch (e) {}
}
// V1.5.1：全屏时锁住页面滚动 —— 图表消费不了的滚轮/触摸此前会穿透到主页面，
// 导致「全屏时页面其实一直在被滚动」，退出后就停在了错误的位置。

// V1.5.1：地图全屏尺寸 —— cover（填满且不变形，超出部分裁切）
//   （原先此处重复声明了一次 MAP_AR，V1.7.2 已合并到文件前段那唯一的声明处）
function applyMapFsSize() {
  var wrap = document.querySelector('#sec-map .canvas-wrap');
  if (!wrap) return;
  var fsEl = document.fullscreenElement;
  var isMapFs = !!fsEl && fsEl.id === 'sec-map';
  // V1.5.1：不再改尺寸（cover 那套会让画布超出视口、把按钮挤出屏幕），
  // 只保证清掉历史内联值；全屏尺寸由 CSS 的 height:100vh 负责，内容居中由 mapFit 负责
  ['width', 'height', 'aspectRatio', 'maxWidth', 'maxHeight', 'position', 'left', 'top', 'transform'].forEach(function (p) {
    wrap.style[p] = '';
  });
  if (typeof mapDirty !== 'undefined') mapDirty = true;
}
window.addEventListener('resize', function () { try { tickClock(); } catch (e) {} applyMapFsSize(); try { moveConstelSlider(S.key, false); } catch (e) {} try { enforceOrientation(); } catch (e) {} });
window.addEventListener('load', function () {
  initConstelSlider();
  // V1.7.1（需求9）：原来这里还调 syncBrandColor()，它只给已删除的死变量 --brand-c 赋值 → 已去掉
  // V1.7.0（任务17）：手机端首页固定竖屏（未全屏时才锁；非全屏调用可能被浏览器拒绝，静默降级）
  try { if (isTouch() && !document.fullscreenElement) { lockOrientation('portrait', 0); setTimeout(function(){ try { enforceOrientation(); } catch (e) {} }, 400); } } catch (e) {}
});

var preFsScrollY = 0;



// V1.6.3：手机熄屏/切到别的应用再回来，浏览器会退出全屏 —— 回来时自动重新进入，
// 若浏览器要求用户手势而拒绝，则退化为"伪全屏"（CSS 满屏，页面与视图保持不变，时间照常走）。
var wasFullscreen = false, pseudoFull = false;
function applyPseudoFull(on, sec) {
  pseudoFull = on;
  document.documentElement.classList.toggle('pseudo-full', on);
  // V1.8.0（D3）：全屏布局选择器是 `section.fs-mobile:fullscreen, html.pseudo-full section.fs-mobile`
  //   —— 两个条件都要求 fs-mobile，而它此前只在 fullscreenchange 里添加。降级时若不挂上，
  //   画布不铺满、× 退出键 / 时钟 / 抽屉 / 全屏搜索框全部不出现，还锁死滚动 = "假全屏卡死"。
  //   现在：进入伪全屏时把 fs-mobile 挂到目标章节；退出（on=false）时全部摘除。
  document.querySelectorAll('section').forEach(function (s) {
    var onSec = !!on && !!sec && s === sec;
    s.classList.toggle('fs-mobile', onSec);
    if (!onSec) s.classList.remove('panel-open');
  });
  if (on) {
    try { window.scrollTo(0, 0); } catch (e) {}
    try { syncFsBarHeight(); } catch (e) {}
    try { applyMapFsSize(); } catch (e) {}
    try { drawChart(); } catch (e) {}
    mapDirty = true; globeDirty = true;
  }
}
// V1.7.0 第三轮（需求8）：熄屏/切后台再回来 —— 重新进入全屏，失败则走章节级降级。
// 【原来的问题】熄屏时浏览器已强制退出全屏；解锁后 requestFullscreen() 没有用户手势通常被拒 →
//   旧代码 applyPseudoFull(true) 给 <html> 打上 pseudo-full，而 CSS 里 html.pseudo-full{overflow:hidden}
//   会把整页滚动锁死；此时章节上又没有 fs-mobile（全屏已退），于是看不到全屏界面、也滚不动 = "卡死"。
// 【现在的做法】失败时改用**章节级** fs-stuck：只有那个章节保持全屏外观，**不碰 html/body 的滚动**；
//   用户下一次点击（真实手势）自动补一次真全屏；另有 15 秒看门狗兜底。
var fsStuckTimer = null, lastFsId = null;
function fsStuckClear() {
  if (fsStuckTimer) { clearTimeout(fsStuckTimer); fsStuckTimer = null; }
  try {
    document.querySelectorAll('section.fs-stuck').forEach(function (x) { x.classList.remove('fs-stuck'); });
    // V1.8.0（D3）：伪全屏可能给章节挂了 fs-mobile —— 复位时一并摘除（真全屏路径会在
    //   fullscreenchange 里重新按 fsEl 挂回，先摘后挂幂等）。
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      document.querySelectorAll('section.fs-mobile').forEach(function (x) { x.classList.remove('fs-mobile'); });
      document.documentElement.classList.remove('pseudo-full');
    }
  } catch (e) {}
}
function fsStuckEnter(sec) {
  try {
    lastFsId = sec.id;
    sec.classList.add('fs-stuck');
    document.documentElement.classList.remove('pseudo-full');   // 绝不留会锁滚动的伪全屏
    if (fsStuckTimer) clearTimeout(fsStuckTimer);
    fsStuckTimer = setTimeout(function () {          // 看门狗：15 秒还没进真全屏就复位
      fsStuckTimer = null;
      fsStuckClear();
      wasFullscreen = false;
    }, 15000);
  } catch (e) {}
}
function tryFullscreen(sec) {
  if (!sec || !sec.requestFullscreen) { fsStuckEnter(sec); return; }
  var p = null;
  try { p = sec.requestFullscreen(); } catch (e) { fsStuckEnter(sec); return; }
  if (p && p.catch) p.catch(function () { fsStuckEnter(sec); });
  setTimeout(function () { if (!document.fullscreenElement) fsStuckEnter(sec); else fsStuckClear(); }, 500);
}
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState !== 'visible') {
    wasFullscreen = wasFullscreen || !!document.fullscreenElement;
    if (document.fullscreenElement) lastFsId = document.fullscreenElement.id;
    return;
  }
  if (!wasFullscreen) return;
  var sec = (lastFsId && document.getElementById(lastFsId)) || document.querySelector('section.fs-mobile') || document.querySelector('section');
  if (!sec) return;
  if (!document.fullscreenElement) tryFullscreen(sec);
});
// 降级态下用户点一下屏幕（这算真实手势）→ 自动补一次真全屏
document.addEventListener('click', function () {
  var sec = document.querySelector('section.fs-stuck');
  if (!sec || document.fullscreenElement) return;
  tryFullscreen(sec);
}, true);
document.addEventListener('fullscreenchange', function () {
  var fsEl = document.fullscreenElement;
  if (fsEl) {
    preFsScrollY = (typeof window.__fsScrollY === 'number') ? window.__fsScrollY : (window.scrollY || 0);
    document.documentElement.style.overflow = 'hidden';
    fsStuckClear();
  } else {
    document.documentElement.style.overflow = '';
    window.scrollTo(0, preFsScrollY);
    // V1.5.2：转屏与布局重排是异步的，稍后再校正一次，确保停在进入全屏前的位置
    setTimeout(function () { window.scrollTo(0, preFsScrollY); }, 120);
    setTimeout(function () { window.scrollTo(0, preFsScrollY); }, 420);
    // V1.7.0 第三轮（需求8）自愈兜底：没有全屏元素却还挂着伪全屏/降级态 → 立刻清掉，绝不把页面锁死
    fsStuckClear();
  }
  try { applyMapFsSize(); } catch (e) {}
  if (fsEl) reqWakeLock(); else dropWakeLock();
});
// V1.7.0 第三轮（需求8）：Wake Lock 的续申请原本**写在 fullscreenchange 内部**，
// 每进出全屏一次就多注册一个 visibilitychange 监听器且永不回收 —— 熄屏解锁一次会同时跑十几个处理器，
// 这是「越用越卡、最后卡死」的直接原因。现在只注册一次。
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'visible' && document.fullscreenElement) reqWakeLock(); else dropWakeLock();
});
// V1.7.0（任务17）：手机端竖屏锁定 —— 首页固定竖屏，全屏时锁横屏，退出全屏自动转回竖屏。
// 说明：screen.orientation.lock 需要「全屏 + 用户手势」才生效，非全屏时调用必被拒，
// 这里用 try/catch 静默降级；被拒时系统仍会自动转屏（安卓）或保持用户当前方向（iOS）。
// V1.7.0 第三轮末（用户反馈：主页能横屏、全屏能竖屏、退出全屏不回竖屏）——重新加固。
// 现实约束：screen.orientation.lock() **只在全屏且带用户手势时**才有效，主页里调用必被拒。
// 所以这里做三层保障：
//   ① 能锁就锁（全屏时锁横屏、退出锁回竖屏，带重试）；
//   ② 锁不住就**提示**：主页在横屏时显示"请竖屏浏览"的遮罩；全屏在竖屏时显示"请横屏观看"的遮罩；
//   ③ 任何状态切换都重新校正一次（orientationchange 时再跑一遍）。
// V1.9.0（需求11）：**去掉"请竖屏/请横屏"的提示遮罩** —— 用户明确「不用提示遮罩，维持老版本
//   只做 lock 和 unlock」。旧的 orientHint() 与 ORI_HINT_ON 一并删除（保留 lockOrientation/unlock）。
function lockOrientation(mode, tries) {
  try {
    if (!isTouch()) return;
    if (!screen.orientation || !screen.orientation.lock) return;
    var p = screen.orientation.lock(mode);
    if (p && p.catch) p.catch(function () {
      if ((tries || 0) < 5) setTimeout(function () { lockOrientation(mode, (tries || 0) + 1); }, 200);
    });
  } catch (e) {}
}
// 统一的"当前应该是什么方向"检查：全屏 → 横屏；非全屏 → 竖屏。只锁方向，不打扰用户。
function enforceOrientation() {
  if (!isTouch()) return;
  var want = document.fullscreenElement ? 'landscape' : 'portrait';
  lockOrientation(want, 0);
}
document.addEventListener('fullscreenchange', function () {
  var fsEl = document.fullscreenElement;
  if (fsEl) { wasFullscreen = true; applyPseudoFull(false); }
  else if (document.visibilityState === 'visible') { wasFullscreen = false; }   // 用户主动退出全屏
  document.querySelectorAll('section').forEach(function (s) {
    // V1.3.3：电脑端与手机端同款全屏（画布铺满 + 左侧可开合的设置小窗），不再按触屏区分
    var on = !!fsEl && s === fsEl;
    s.classList.toggle('fs-mobile', on);
    if (!on) s.classList.remove('panel-open');
    try { if (s.id === 'sec-chart') placeChartSearch(on); } catch (e) {}
  });
  syncFsBarHeight();
  try { applyMapFsSize(); } catch (e) {}
  try { enforceOrientation(); } catch (e) {}
  // V1.7.0 二轮（需求6）：进入真全屏后，强制把滚动归零并重算尺寸。
  // 有些手机在元素全屏时仍保留状态栏/挖孔那一条，可视高度与进入前不同；
  // 若还停在原来的滚动位置，画布顶部就会露出一条空白（"横屏时摄像头那一侧留白"的现象之一）。
  if (fsEl) {
    setTimeout(function () {
      try { window.scrollTo(0, 0); } catch (e) {}
      try { document.documentElement.scrollTop = 0; if (document.body) document.body.scrollTop = 0; } catch (e) {}
      try { applyMapFsSize(); } catch (e) {}
      try { syncFsBarHeight(); } catch (e) {}
      try { drawChart(); mapDirty = globeDirty = true; } catch (e) {}
      try { drawNet(); } catch (e) {}          // V1.8.0（需求8）：03.5 一并按新尺寸重画
    }, 60);
    setTimeout(function () { try { applyMapFsSize(); } catch (e) {} try { drawChart(); } catch (e) {} try { drawNet(); } catch (e) {} }, 320);
  }
  // V1.7.0（任务17）：全屏锁横屏、退出全屏锁回竖屏（不再 unlock 放任自由旋转）。
  // 全屏是异步过渡，立刻 lock 常被拒 → 稍后重试几次，确保真的锁上。
  try {
    var wantOrient = fsEl ? 'landscape' : 'portrait';
    var lockTries = 0;
    (function tryLock() {
      try {
        if (!isTouch() || !screen.orientation || !screen.orientation.lock) return;
        screen.orientation.lock(wantOrient).catch(function () {
          if (++lockTries < 5) setTimeout(tryLock, 150);
        });
      } catch (e) {}
    })();
  } catch (e) {}
  setTimeout(function () { drawChart(); mapDirty = globeDirty = true; }, 90);
});

// ================================================================ V1.3.0 交互增强
var mapTapAt = 0, chartTapAt = 0, globeTapAt = 0;

// ---- 滑条数值框（点击变键盘输入，° 显示在输入框外）
function fmtOne(v) { return (Math.round(v * 10) / 10).toFixed(1); }
var NUMB = {
  cov: { range: 'covEl', box: 'covNum', get: function () { return S.cov.el; }, set: function (v) { S.cov.el = v; }, min: 0, max: 85 },
  pick: { range: 'pickEl', box: 'pickNum', get: function () { return S.pick.el; }, set: function (v) { S.pick.el = v; }, min: 0, max: 85 },
  cone: { range: 'coneEl', box: 'coneNum', get: function () { return S.cone.el; }, set: function (v) { S.cone.el = v; }, min: 0, max: 85 }
};
function syncNumBox(kind) {
  var cfg = NUMB[kind]; if (!cfg) return;
  var box = document.getElementById(cfg.box);
  if (!box || box.querySelector('input')) return;   // 正在编辑时不覆盖
  box.textContent = fmtOne(cfg.get()) + '°';
}
Object.keys(NUMB).forEach(function (kind) {
  var cfg = NUMB[kind];
  var box = document.getElementById(cfg.box), range = document.getElementById(cfg.range);
  if (!box || !range) return;
  // V1.7.3（需求2）：三条最低仰角滑条接入跳转动画（点击轨道 / 键盘 → 补间；拖拽原生跟手）。
  //   映射规则与时间条一致：42.5° = 半量程 → 520ms，按距离比例，下限 120ms。
  attachSliderAnim(range, function (v) {
    cfg.set(v); syncNumBox(kind); mapDirty = globeDirty = true;
  });
  box.addEventListener('click', function (e) {
    e.stopPropagation();
    if (box.querySelector('input')) return;
    var prev = cfg.get();
    box.innerHTML = '<input type="text" inputmode="decimal" value="' + fmtOne(prev) + '">°';
    var inp = box.querySelector('input');
    inp.focus(); inp.select();
    function commit() {
      if (!box.querySelector('input')) return;
      var v = parseFloat(String(inp.value).replace(/[^0-9.]/g, ''));
      var ok = isFinite(v) && v >= cfg.min && v <= cfg.max;
      var next = ok ? Math.round(v * 10) / 10 : prev;   // 非法值 → 保持改动前的角度
      box.textContent = fmtOne(next) + '°';
      // V1.7.3（需求2）：数值框输入的跳转也播补间动画（apply 逐帧 cfg.set）
      if (range.__animateTo && next !== cfg.get()) { range.__animateTo(next); return; }
      cfg.set(next);
      range.value = String(next);
      mapDirty = globeDirty = true;
    }
    inp.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
      else if (ev.key === 'Escape') { box.textContent = fmtOne(prev) + '°'; }
    });
    inp.addEventListener('blur', commit);
  });
});

// ------------------------------------------------------------------ V1.9.0（需求9）选中提示
// 「已全选」绿色提示：位置在**顶部时间药丸的正下方、水平居中**（运行时按药丸的实际底边定位，
//   所以任何语言/宽度/是否全屏都贴着它），与药丸同层悬浮于页面内容之上；1.8s 后淡出。
var toastEl = null, toastTimer = 0;
// V1.9.1（A19）：第二个参数升级为"模式"（原先只有布尔）——
//   'dead' → 红（.pool-dead，与卫星表「已再入」同色）／'pend' → 琥珀（.pool-pend）。
//   V1.9.1（A3）再加 'inv' → **反色**（暗色模式=白底黑字 / 亮色模式=黑底白字），
//   用于"无 TLE 的黄框行"点击提示。
//   旧的 `true/false` 语义原样保留（true 仍映射到 .cross），所以既有调用点一个都不用改。
function showToast(txt, mode) {
  try {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.id = 'selToast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = txt;
    var isCross = (mode === true || mode === 'cross');
    toastEl.classList.toggle('cross', isCross);
    toastEl.classList.toggle('pool-dead', mode === 'dead');
    toastEl.classList.toggle('pool-pend', mode === 'pend');
    toastEl.classList.toggle('inv', mode === 'inv');
    var pill = document.getElementById('clockPill');
    if (pill) {
      var r = pill.getBoundingClientRect();
      toastEl.style.top = Math.round(r.bottom + 10) + 'px';
    }
    clearTimeout(toastTimer);
    toastEl.classList.remove('show');
    void toastEl.offsetWidth;               // 强制回流：保证连续触发时也能重新淡入
    toastEl.classList.add('show');
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 1800);
  } catch (e) {}
}
// V1.9.1（A19）：搜索补池（已再入 / 尚未编目）条目的点击行为 —— 任务清单 Q35。
//   ① **01/02/03 章物理上无法高亮**：那三章画的是"库内有可推算 TLE 的卫星"，补池对象不在其中，
//      所以这里**只**跳到 06 卫星表格 + 弹提示，绝不假装在图上高亮了一个不存在的点；
//   ② 06 卫星表格：该 NORAD 若**在库**就框选它那一行（A10/A17 把已再入/待编目也列进表格后自动生效）；
//      不在库（A19 两池的定义就是这样）→ 退一步按**批次**高亮 —— 反馈落在 07 发射历史那一行；
//   ③ 04 变轨情况：**跟随选中**（selectGroup → afterSelection → climbFollowSelection），
//      该批次有曲线时会一并高亮，没曲线就没有可高亮的东西。
function poolJump(kind, norad, bk) {
  var hit = -1;
  cur().sats.forEach(function (s) { if (s.norad === norad) hit = s.idx; });
  if (hit >= 0) { infoClearClosed(); S.sel = [hit]; S.focusIdx = hit; afterSelection(); }
  else selectGroup(bk);
  // ⚠️ 提示必须放在 selectGroup **之后**：selectGroup 内部可能自己弹「已全选」，
  //   先弹的话会被它覆盖掉（这里要的是"该卫星已再入/尚未编目"这句）。
  showToast(t(kind === 'dead' ? 'd_pool_dead_toast' : 'd_pool_pend_toast'), kind === 'dead' ? 'dead' : 'pend');
  var sec = document.getElementById('sec-table');
  if (sec) smoothScrollTo(sec.getBoundingClientRect().top + window.scrollY - navHeight() - 8, 720);
  updateJumpActive('sec-table');
}
// 跨星座全选：把"全选"写进**另一个星座的会话快照**（STORE[other].selNorad + selGroup）。
//   这样用户切过去时 applyConstel() 会自然恢复出"五个章节都选中该批次"的状态 —— 全程不需要切页面。
function selCrossConstel(otherKey, lk) {
  try {
    var other = CONST[otherKey];
    if (!other) return false;
    var ids = other.sats.filter(function (s) { return s.lk === lk; }).map(function (s) { return s.norad; });
    if (!ids.length) return false;
    var o = STORE[otherKey] || (STORE_DEF ? cloneVal(STORE_DEF[otherKey]) : null);
    if (!o) return false;
    o.selNorad = ids;
    o.selGroup = lk;
    STORE[otherKey] = o;
    return true;
  } catch (e) { return false; }
}
// ---- 选择：整批选中 / 全局退出 / 自动跳页
function selectGroup(lk) {
  var st = cur(), idxs = [];
  st.sats.forEach(function (s) { if (s.lk === lk) idxs.push(s.idx); });
  // V1.7.1（需求2）：整批选中也是「用户主动选了东西」→ 解除信息窗的关闭标记
  infoClearClosed();
  if (!idxs.length) {
    // V1.9.0（需求9）：先看是不是"**另一个星座**的批次" —— 是的话在那边全选并提示切页
    var otherKey = (S.key === 'gw') ? 'qf' : 'gw';
    if (selCrossConstel(otherKey, lk)) {
      showToast(t('d_sel_cross'), true);
      S.selGroup = null; S.sel = [];
      afterSelection();
      return;
    }
    // V1.6.3：该批次暂无入轨卫星（待编目 / 尚无 TLE）—— 仍给出行级选中反馈，不再毫无反应
    // V1.9.1（A3）：**无 TLE 的黄框行**（`pend-part` / `pend-none`）→ 行级反馈 +
    //   **反色**药丸「当前暂无TLE数据」。再次点击是取消，不再提示（与「已全选」同口径）。
    var wasOn = (S.selGroup === lk);
    S.selGroup = wasOn ? null : lk;
    S.sel = [];
    afterSelection();
    if (!wasOn) showToast(t('d_sel_notle'), 'inv');
    return;
  }
  S.selGroup = null;
  // V1.7.2（需求2）：整批选中 → 清掉"组内切换"的焦点，回到「显示 NORAD 最小那颗」的默认口径
  S.focusIdx = null;
  var allSel = idxs.every(function (i) { return S.sel.indexOf(i) >= 0; });
  S.sel = allSel ? [] : idxs;      // 再次点击同一批次 = 取消
  // V1.9.0（需求9）：只有"真的全选了"才提示；再点一次是取消，不该说"已全选"
  // V1.9.1（A3）：**单颗**（该条发射记录在库内只有 1 颗）改说「已选择」，且由 afterSelection
  //   统一负责 —— 这样"图上点选 / 表里点选 / 搜索选中 / 选择框选单星"四条路径共用同一句提示（Q12）。
  if (!allSel && idxs.length > 1) showToast(t('d_sel_all'), false);
  afterSelection();
}
function afterSelection() {
  // V1.6.3：只要确定了卫星（搜索 / 点选 / 批次），倾角分布的批次选择框自动退回"全部"
  if (S.sel.length && S.launchFilter && S.launchFilter !== 'all') {
    S.launchFilter = 'all';
    var _gs = document.getElementById('groupSel');
    if (_gs) _gs.value = 'all';
  }
  updateSelClasses();
  drawChart(); renderLegend();
  // V1.7.1（需求7）：jump:true 让表格自己按 pageBounds 翻到选中项所在页，并在渲染后闪一下。
  //   发射历史用 renderLaunchTable(true) 一并联动 —— 两者在同一次调用里完成，顺序即"同时"。
  renderTable({ jump: true });
  renderLaunchTable(true);
  // V1.3.5：选中变化后 01/02/03 三处信息窗立即锁定显示（用户才拖得动）；
  // V1.7.1（需求2）：只有「真正改变了选中态」才解除 INFO_CLOSED；纯 hover 不调afterSelection，天然不受影响。
  syncSelInfo();
  mapDirty = globeDirty = true;
  // V1.9.0（R17）：04 变轨情况**跟随全局选中** —— 这是需求里的"双向联动"的一个方向。
  //   用户没显式选批次/单星时才跟随（显式选了就以用户意图为准，不被别处的操作改掉）。
  try { climbFollowSelection(); } catch (e) {}
  // V1.9.1（A3 + Q12）：**单颗**选定统一在这里提示「已选择」——
  //   收口在此处的原因：四条路径（图上点选 / 表里点选 / 搜索选中 / 选择框选单星）**都会**走到
  //   afterSelection，放在这里才可能真的做到"全局应用"，否则要在四个入口各写一遍、漏一个就少一路。
  //   多颗（>1）与"无 TLE"两种情况各自在 selectGroup 里提示（它们的文案不同、且要区分"取消"语义）。
  if (S.sel.length === 1) showToast(t('d_sel_one'), false);
}

// ---- 搜索（两个输入框同步联想，候选项竖向列出）
// 中英文双向可搜：把两种语言的名字/批次名都放进匹配串
function nameVariants(s) {
  var zh = s.name.replace(/^HULIANWANG DIGUI-(\d+)$/, '互联网低轨-$1')
    .replace(/^HULIANWANG JISHU SHIYAN.*$/, '互联网技术试验')
    .replace(/^HJS.*$/, '互联网技术试验')
    .replace(/^GUOWANG TEST OBJECT ([A-Z])$/, '互联网试验-$1')
    .replace(/^GUOWANG (\d+) OBJECT ([A-Z])$/, '互联网$1组$2');
  // V1.7.0 第三轮修正：英文一律用**目录原名**，不再改写成星座品牌名
  var en = s.name;
  return zh + ' ' + en;
}
function batchVariants(name) {
  var zh = name, en = name.replace(/^低轨(\d+)组$/, 'LEO Group $1')
    .replace(/^极轨(\d+)组$/, 'Polar Group $1')
    .replace(/^试验星(\d+)组$/, 'Test Satellite Group $1');
  return zh + ' ' + en;
}
// ============================================================ V1.5.0：搜索别名表
// 火箭：中文全称 / 简称 / 英文 / 拼音 都指向同一个型号；遥号（Y10、遥十…）单独匹配
var ROCKET_ALIAS = [
  ['长征五号B', ['长征五号B', '长五乙', '长5乙', 'cz-5b', 'cz5b', 'cz 5b', 'longmarch-5b', 'longmarch5b', 'longmarch 5b', 'changzheng5b', 'changzheng5yi', 'changzheng5b']],
  ['长征八号甲', ['长征八号甲', '长征八号A', '长八甲', '长八A', 'cz-8a', 'cz8a', 'cz 8a', 'longmarch-8a', 'longmarch8a', 'longmarch 8a', 'changzheng8a', 'changzheng8jia']],
  ['长征八号', ['长征八号', '长八', 'cz-8', 'cz8', 'cz 8', 'longmarch-8', 'longmarch8', 'changzheng8']],
  ['长征六号甲', ['长征六号甲', '长六甲', 'cz-6a', 'cz6a', 'longmarch-6a', 'changzheng6a']],
  ['长征六号', ['长征六号', '长六', 'cz-6', 'cz6', 'longmarch-6', 'changzheng6']],
  ['长征十二号乙', ['长征十二号乙', '长十二乙', 'cz-12b', 'cz12b', 'longmarch-12b', 'changzheng12b']],
  ['长征十二号', ['长征十二号', '长十二', 'cz-12', 'cz12', 'longmarch-12', 'changzheng12']],
  ['长征二号丁', ['长征二号丁', '长二丁', 'cz-2d', 'cz2d', 'longmarch-2d', 'changzheng2d']],
  ['长征二号丙', ['长征二号丙', '长二丙', 'cz-2c', 'cz2c', 'longmarch-2c', 'changzheng2c']],
  ['长征三号乙', ['长征三号乙', '长三乙', 'cz-3b', 'cz3b', 'longmarch-3b', 'changzheng3b']],
  ['长征十号乙', ['长征十号乙', '长十乙', 'cz-10b', 'cz10b', 'longmarch-10b', 'changzheng10b']],
  ['捷龙三号', ['捷龙三号', '捷三', 'sd-3', 'sd3', 'jielong3', 'jielong-3']],
  ['快舟一号甲', ['快舟一号甲', '快一甲', 'kz-1a', 'kz1a', 'kuaizhou1a', 'kuaizhou-1a']],
  ['朱雀二号E', ['朱雀二号E', '朱雀二号e', 'zq-2e', 'zq2e', 'zhuque2e', 'zhuque-2e']],
  ['引力一号', ['引力一号', 'gravity-1', 'gravity1', 'yinli1', 'yinli-1']]
];
// 发射设施：场 / 工位 / 船 / 海域（中英全称简称拼音）
var SITE_ALIAS = [
  ['酒泉', ['酒泉', '酒泉卫星发射中心', 'jslc', 'jiuquan', 'jiuquan satellite launch center']],
  ['西昌', ['西昌', '西昌卫星发射中心', 'xslc', 'xichang', 'xichang satellite launch center']],
  ['太原', ['太原', '太原卫星发射中心', 'tslc', 'taiyuan', 'taiyuan satellite launch center']],
  ['文昌', ['文昌', '文昌航天发射场', '文昌卫星发射中心', 'wslc', 'wenchang', 'wenchang space launch site']],
  ['海商', ['海商', '海南商发', '海南商业航天发射场', 'hcsls', 'hainan', 'hainanshangfa']],
  ['东方航天港', ['东方航天港', '东方航天港号', '东方航天港一号', 'hos', 'hos-1', 'dongfanghangtiangang']],
  ['南海', ['南海', '南中国海', 'south china sea', 'nanhai']],
  ['东海', ['东海', 'east china sea', 'donghai']],
  ['黄海', ['黄海', 'yellow sea', 'huanghai']],
  ['渤海', ['渤海', 'bohai sea', 'bohai']]
];
// 制造商：中文简称 / 全称 / 英文缩写 / 拼音
var MAKER_ALIAS = [
  ['中国科学院微小卫星创新研究院（上海微小）', ['微小卫星', '上海微小', '卫星创新院', '中科院微小', '微小', 'microsat', 'shanghai micro satellite', 'shanghaiweixiao', 'weixiaoweixing', 'weixiao', 'zhongguokexueyuan', 'kexueyuan', 'zhongkeyuan', 'shanghaiweixiaoweixing', 'wxy', 'zkywx', 'wxwxgccxyjy', 'shwxwxgcczx']],
  ['航天科技五院（中国空间技术研究院）', ['五院', '航天五院', '空间技术研究院', 'cast', 'china academy of space technology', 'hangtianwuyuan', 'wuyuan', 'kongjianjishuyanjiuyuan', 'zhongguokongjianjishu', 'ht5y', 'wuy', 'zgkjjsyjy']],
  ['银河航天', ['银河', '银河航天', 'galaxy space', 'galaxyspace', 'yinhehangtian', 'yinhe', 'yhht', 'yinghe', 'yinghehangtian', 'yingheht']],
  ['格思航天', ['格思', '格思航天', '上海格思', 'shgs', 'genesat', 'genespace', 'gesihangtian', 'gesi', 'gshi', 'gsht']],
  ['中国商业卫星公司', ['中国商星', '中国商业卫星', '商业卫星', '商星', 'cacs', 'china commercial satellites group', 'zhongguoshangxing', 'shangxing', 'zhongguoshangyeweixing', 'sywx', 'sx']],
  ['航天科技八院（上海航天技术研究院）', ['八院', '上海八院', '航天八院', '上海航天', 'sast', 'shanghai academy of spaceflight technology', 'hangtianbayuan', 'bayuan', 'shanghaihangtian', 'ht8y', 'by', 'shhtjsyjy']],
  ['长光卫星', ['长光', '长光卫星', '长光卫星技术', 'changguang', 'chang guang satellite technology', 'changguangweixing', 'cgwx', 'cg']],
  ['微纳星空', ['微纳', '微纳星空', 'mino space', 'minospace', 'weinaxingkong', 'weina', 'wnxk', 'wn']],
  ['工大卫星', ['工大卫星', '哈工大卫星', 'hit satellite', 'hitsatellite', 'gongda', 'gongdaweixing', 'hagongda', 'gdwx', 'gd']],
  ['北京邮电大学', ['北京邮电', '北邮', '北邮大学', 'bupt', 'beijing university of posts and telecommunications', 'beijingyoudian', 'beiyou', 'bjyd', 'bjyddx']],
  ['鸿擎科技', ['鸿擎', '鸿擎科技', '蓝箭鸿擎', 'hong qing', 'hongqing tech', 'hongqing', 'hongqingkeji', 'hongq', 'hqkj']],
  ['航天科工二院', ['科工二院', '航天二院', '二院', 'casic acad.2nd', 'casic 2nd academy', 'hangtianeryuan', 'eryuan', 'ht2y', 'kg2y', 'ey']],
  ['中国电科电子科学研究院', ['中国电科', '电科电子', 'cetc', 'zhongguodianke', 'diankedianzi', 'dianke', 'dky', 'zgdk', 'dzkxyjy']],
  ['氦星光联', ['氦星', '氦星光联', 'histarlink', 'haixingguanglian', 'haixing', 'hxgl', 'hx']],
  ['垣信卫星', ['垣信', 'yuanxin', 'spacesail', 'yuanxin weixing', 'yuanxinweixing', 'yxwx', 'yx']]
];
// 数据里出现的「带颗数后缀」的原始制造商名（如「银河航天（2颗）」）—— 用于精确反向命中
var MAKER_RAW = {
  '上海微小卫星工程中心': '中国科学院微小卫星创新研究院（上海微小）',
  '中国科学院微小卫星创新研究院': '中国科学院微小卫星创新研究院（上海微小）',
  '五院': '航天科技五院（中国空间技术研究院）',
  '八院': '航天科技八院（上海航天技术研究院）',
  '二院': '航天科工二院',
  '银河航天': '银河航天',
  '格思航天': '格思航天',
  '长光卫星技术有限公司': '长光卫星',
  '长光卫星': '长光卫星',
  '微纳星空': '微纳星空',
  '工大卫星': '工大卫星',
  '北京邮电大学联合长光卫星技术有限公司': '北京邮电大学',
  '北京邮电大学': '北京邮电大学',
  '中国商业卫星公司': '中国商业卫星公司',
  '鸿擎科技': '鸿擎科技',
  '中国电科电子科学研究院': '中国电科电子科学研究院',
  '氦星光联': '氦星光联',
  '垣信卫星': '垣信卫星'
};
// 遥号归一：Y10 / 遥十 / y10 / 010 → 数字 10
function rocketSerial(str) {
  var s = String(str || '');
  var m = s.match(/(?:^|[\s\-])(?:y|遥)\s*([0-9]{1,3})/i);
  if (m) return parseInt(m[1], 10);
  var cn = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  var m2 = s.match(/遥([一二三四五六七八九十]{1,3})/);
  if (m2) {
    var v = m2[1];
    if (v.length === 1) return cn[v] || 0;
    if (v.indexOf('十') === 0) return 10 + (cn[v[1]] || 0);
    return (cn[v[0]] || 0) * 10;
  }
  return 0;
}
// V1.9.1（A19-F43）：判断一个词是否是**某个火箭别名的完整写法**（精确相等，不用前缀/子串）。
//   只服务于"连写遥号"的提取：`长征八号甲Y8` 剥掉尾部的 `Y8` 后得到 `长征八号甲` → 精确命中 ✓。
//   ★ 为什么**必须**是精确相等：`gravity1`（引力一号的别名）里就含 `y1`，用前缀/子串判断会让
//     它被误当成"引力一号 遥号1"，然后 `rocketSerial('引力一号 Y3')=3 !== 1` → 把结果**全部过滤光**。
//     这是"为了让新场景工作而引入回归"的典型坑，所以判据刻意收得最紧。
function rocketNameExact(s) {
  var w = String(s || '').trim().toLowerCase();
  if (!w) return false;
  for (var i = 0; i < ROCKET_ALIAS.length; i++) {
    var ns = ROCKET_ALIAS[i][1];
    for (var j = 0; j < ns.length; j++) if (String(ns[j]).toLowerCase() === w) return true;
  }
  return false;
}
// 一句话判断：这个词是不是命中了某个别名组（返回别名组，否则 null）
// V1.7.0：拼音支持 —— 允许「子串命中」（yinghe → yinhehangtian / yhht），不再只认前缀；
//         同时把数据里的「原名」（含（N颗）后缀）也并入匹配集合。
function aliasNames(table) {
  return table;
}
function aliasEntry(word, table) {
  var w = String(word || '').toLowerCase();
  if (!w) return null;
  for (var i = 0; i < table.length; i++) {
    var names = table[i][1];
    for (var j = 0; j < names.length; j++) {
      var a2 = String(names[j]).toLowerCase();
      if (w === a2) return table[i];
      // 中文/英文：前缀命中（长度≥3 才放宽，避免「五」命中一切）
      if (w.length >= 3 && a2.indexOf(w) === 0) return table[i];
      // V1.7.0 拼音：长度≥3 时允许「别名是输入的子串」或「输入是别名的子串」
      if (w.length >= 3 && a2.indexOf(w) >= 0) return table[i];
      if (w.length >= 3 && w.indexOf(a2) >= 0 && a2.length >= 3) return table[i];
    }
  }
  return null;
}
function aliasHit(word, table) {
  var e = aliasEntry(word, table);
  return e ? e[0] : '';
}
// V1.7.0：输入 → 规范制造商名的全部候选（含数据原名映射），供搜索时双向匹配
function makerAliasSet(word) {
  var e = aliasEntry(word, MAKER_ALIAS);
  if (!e) return null;
  var canon = e[0];
  var names = [canon].concat(e[1] || []);
  // 把数据里的原始名（含（1颗）等后缀）也加进来
  Object.keys(MAKER_RAW).forEach(function (raw) { if (MAKER_RAW[raw] === canon) names.push(raw); });
  return { canon: canon, names: names };
}
// 截断：超长时保留前几个字 + 省略号（联想区尾部标注用）
function clip(s, max) {
  s = String(s || '');
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
function b(s) { return '<b>' + s + '</b>'; }

// ============================================================ V1.5.0：主搜索
// 输入：任意字符串（中英、别名、拼音、数字、空格分隔的多个词）
// 输出：候选数组，每项 { kind, launch|sat, score, note }，已按「接近度 → 新到旧」排序
// V1.9.1（A19-F43）★ 两个**已裁决的口径**，改代码前先看这里：
//   ① **星座名（星网 / 千帆）不做关键词匹配** —— 搜索本来就在各自的星座页面内独立进行
//      （页面自身已经决定了星座），所以「星网」「千帆」这类词**没有任何匹配意义**，故不实现。
//      由此 `千帆 极轨11组` 这类混写会因「千帆」无命中而交集为空 —— 这是**预期行为**，不是缺陷；
//      正确用法是只搜「极轨11组」。
//   ② **遥号是合理的模糊搜索类别** —— `遥8` / `Y8` / `遥八`，单独搜或与火箭名一起搜都必须有效（见 ⓪ 分支）。
function searchCandidates(q) {
  var st = cur();
  var raw = String(q || '').trim();
  if (!raw) return [];
  var words = raw.toLowerCase().split(/[\s,，、]+/).filter(Boolean);
  var out = [], seenSat = {}, seenGroup = {};
  // V1.9.1（A19-S）：**命中词表** —— 键 → { 词: 1 }。
  //   为什么需要它：多词搜索的交集本来用「候选条数 ≥ 词数」判断，而候选在 push 时**已按 NORAD 去重**
  //   → 同一个对象被两个词命中时只会留下一条 → `arr.length` 恒为 1 → **多词搜索一律返回"没有匹配的卫星"**
  //   （实测 'HULIANWANG DIGUI-01'、'长征八号甲 Y1' 全空）。
  //   现在改为在**去重之前**按对象记下"哪些词命中过它"，交集按**命中词数**判断。
  var hitWords = {}, curW = '';
  function okey(o) {
    return o.kind === 'sat' ? ('sat:' + o.sat.norad)
      : o.kind === 'group' ? ('group:' + o.launch.cospar)
        : (o.kind + ':' + o.pool.n);
  }
  function markHit(o) {
    var k = okey(o);
    (hitWords[k] || (hitWords[k] = {}))[curW] = 1;
  }

  function pushSat(s, score, note) {
    var o = { kind: 'sat', sat: s, score: score, note: note, t: s.launch ? s.launch.dateMs : 0 };
    markHit(o);                                    // ★ 必须在去重**之前**记
    if (seenSat[s.norad]) return;
    seenSat[s.norad] = 1;
    out.push(o);
  }
  function pushGroup(L, score, note) {
    var o = { kind: 'group', launch: L, score: score, note: note, t: L.dateMs };
    markHit(o);
    if (seenGroup[L.cospar]) return;
    seenGroup[L.cospar] = 1;
    out.push(o);
  }
  function pushLaunchSats(L, score, note) {
    L.sats.forEach(function (s) { pushSat(s, score, note); });
  }
  // ---- V1.9.1（A19）：搜索补池 ----
  // 「已再入」与「尚未编目」这两类对象**库内没有 TLE**（satdata 的 dead / pend 两池），
  // 原先搜索只在 sats 里找 → 搜它们的名字/NORAD 一律"没有匹配的卫星"。
  // 这里把它们并联进候选：kind 直接就是 'dead' / 'pend'（渲染与点击都按它分派）。
  var seenPool = {};
  function pushPool(rec, kind, score, note) {
    var o = { kind: kind, pool: rec, score: score, note: note, t: 0 };
    var k = kind + ':' + rec.n;
    var L = null;
    for (var i = 0; i < st.launches.length; i++) if (st.launches[i].key === rec.bk) { L = st.launches[i]; break; }
    // t（时间）用所属批次的发射时刻 —— 排序时"新到旧"这一维度要跟主池一致
    o.t = L ? L.dateMs : 0;
    markHit(o);                                    // ★ 同样要在去重之前记
    if (seenPool[k]) return;
    seenPool[k] = 1;
    out.push(o);
  }
  function poolEach(fn) {
    (st.dead || []).forEach(function (r) { fn(r, 'dead'); });
    (st.pend || []).forEach(function (r) { fn(r, 'pend'); });
  }
  // 补池对象的可搜字段：目录名 + 库内口径 6 列 COSPAR + NORAD + 批次号
  function poolHay(rec) { return (rec.nm + ' ' + rec.c + ' ' + rec.n + ' ' + rec.bk).toLowerCase(); }

  words.forEach(function (w) {
    curW = w;                                        // V1.9.1（A19-S）：供 markHit 记录"哪个词命中的"
    var num = w.match(/^[0-9]+$/) ? w : '';

    // —— ⓪ V1.9.1（A19-F43）：**遥号**独立成词（`Y8` / `遥8` / `遥八`）
    //   用户裁决：遥号是**合理的模糊搜索类别** —— 单独搜遥号、或与火箭名一起搜，都必须有效。
    //   为什么原先单独成词无效：`Y8` 既不是纯数字（走不了 ④），也不出现在任何名称/COSPAR 里（走不了 ⑤）
    //     → 这个词一个候选都推不出来 → 与火箭名做交集时**恒为空**（实测 `长征八号甲 Y1` 全空）。
    //   三个判据缺一不可：
    //     · `serialOnly > 0` —— 提取不到遥号就交给后面的分支（`遥0` / `yabc` 之类都不该在这里命中）；
    //     · `!aliasHit(w, ROCKET_ALIAS)` —— 这个词本身**不是**火箭型号名。
    //       连写形式（`长征八号甲Y8`）会因"输入包含别名"而命中火箭名 → 让它继续走 ① 的连写通路（那里本就能过滤遥号）；
    //     · `不是纯数字` —— 纯数字的语义是 NORAD / 名称里的数字，与"遥号"完全不同，不能抢。
    //       （aliasEntry 只在 `w.length >= 3` 时才做宽松匹配，所以 `Y8` / `遥8` 这种 2 字符不会被误当型号名。）
    var serialOnly = /^[0-9]+$/.test(w) ? 0 : rocketSerial(w);
    if (serialOnly && !aliasHit(w, ROCKET_ALIAS)) {
      st.launches.forEach(function (L) {
        if (!L.sats.length) return;
        if (rocketSerial(L.rocket) !== serialOnly) return;
        pushLaunchSats(L, 6, b(clip(L.rocket, 14)));
      });
      return;
    }

    // —— ① 火箭（含遥号）：命中型号 → 该型号（+遥号）发射的全部卫星
    var rk = aliasHit(w, ROCKET_ALIAS);
    var serial = rocketSerial(w);
    // V1.9.1（A19-F43）：**连写**遥号（`长征八号甲Y8`）—— 遥号紧贴在型号名后面，
    //   而 `rocketSerial` 的正则要求 y/遥 前面是开头或空格/连字符，认不出紧贴的 → serial 恒为 0
    //   → 遥号过滤**失效**（退化成"命中该型号的全部批次"）。
    //   这里补一次"末尾遥号"提取，且**要求剥掉遥号后剩下的部分是某个火箭别名的完整写法**
    //   （精确相等，见 rocketNameExact 的注释 —— 否则 `gravity1` 会被误判成"引力一号 遥1"）。
    if (rk && !serial) {
      var tm = w.match(/^(.*?)(?:y|遥)\s*([0-9]{1,3})$/i);
      if (tm && rocketNameExact(tm[1])) serial = parseInt(tm[2], 10);
    }
    if (rk) {
      st.launches.forEach(function (L) {
        if (!L.sats.length) return;
        var rn = String(L.rocket || '');
        if (rn.indexOf(rk) < 0) return;
        if (serial && rocketSerial(rn) !== serial) return;
        pushLaunchSats(L, 0, b(clip(rn, 14)));
      });
      return;
    }
    // —— ② 发射设施：命中场/工位/船/海域 → 该批次全部卫星
    var site = aliasHit(w, SITE_ALIAS);
    if (site) {
      st.launches.forEach(function (L) {
        if (!L.sats.length) return;
        var sn = String(L.site || '');
        if (sn.indexOf(site) < 0) return;
        pushLaunchSats(L, 1, b(clip(sn, 14)));
      });
      return;
    }
    // —— ③ 制造商：命中 → 该制造商参与批次的全部卫星
    // V1.7.0：支持拼音（yinghe / yhht / yinghehangtian）+ 大小写不敏感 + 数据原名（含（N颗）后缀）
    var mkset = makerAliasSet(w);
    var mk = mkset ? mkset.canon : '';
    if (mk) {
      // V1.6.3：用该机构的全部别名（含数据里的原名）与记录双向包含匹配，
      // 避免"别名带括号后缀 / 数据里是简称"导致漏配。
      var mkNames = mkset.names.map(function (x) { return String(x).toLowerCase(); });
      // V1.6.3：制造商数据在全局 SATDATA 里（键 = COSPAR 裸号，值 = { m, ls:[{n}] }），
      // 与内部 CONST 的字段名/键格式都不一致 —— 之前一直取不到记录。改为直接用 SATDATA 双向匹配。
      var SD = (typeof SATDATA !== 'undefined' && SATDATA) ? (SATDATA[st.key] || SATDATA[S.key]) : null;
      var MKD = (SD && SD.makers) ? SD.makers : (st.makers || null);
      if (MKD) {
        Object.keys(MKD).forEach(function (ck) {
          var rec = MKD[ck];
          var mm = rec.m || (rec.ls || []).map(function (x) { return x && x.n; })
            .filter(Boolean).join('、');
          if (!mm) return;
          var mml = String(mm).toLowerCase();
          // V1.7.0：把「银河航天（2颗）」这类后缀剥掉再比对；并支持子串双向命中
          var mmBase = mml.replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '').trim();
          var hitMk = mkNames.some(function (nm) {
            if (!nm) return false;
            return mml.indexOf(nm) >= 0 || nm.indexOf(mml) >= 0 ||
                   mmBase.indexOf(nm) >= 0 || nm.indexOf(mmBase) >= 0;
          });
          if (!hitMk) return;
          // V1.6.3 真因修复：L.cospar 形如 '2023-095'（自带 '20' 前缀），而 makers 的键是裸号 '23095'，
          // 归一化后仍不相等 → 之前恒不匹配。这里直接用 L.key（其值就是 makers 的键）比对。
          st.launches.forEach(function (L) {
            if (!L || !L.sats || !L.sats.length) return;
            if (String(L.key) !== String(ck)) return;
            pushLaunchSats(L, 1, b(clip(mm, 12)));
          });
        });
      }
      return;
    }
    // —— ④ 纯数字：名称数字 → 批次号数字 → COSPAR 序号对应火箭 → NORAD 数字
    if (num) {
      var lv = 0;
      st.sats.forEach(function (s) {
        var nm = (s.name + ' ' + nameVariants(s)).toLowerCase();
        if (nm.indexOf(num) >= 0) pushSat(s, 2 + (nm.indexOf(num) === 0 ? 0 : 1), b(clip(s.name, 16)));
      });
      st.launches.forEach(function (L) {
        if (!L.sats.length) return;
        var bn = (L.name + ' ' + batchVariants(L.name)).toLowerCase();
        if (bn.indexOf(num) >= 0) { pushLaunchSats(L, 4, b(clip(L.name, 14))); lv = 1; }
        else if (String(L.cospar).indexOf(num) >= 0) { pushLaunchSats(L, 6, b(clip(L.cospar, 12))); lv = 1; }
      });
      st.sats.forEach(function (s) {
        if (String(s.norad).indexOf(num) >= 0) pushSat(s, 8, b(clip(String(s.norad), 10)));
      });
      // V1.9.1（A19）：补池也按 NORAD 数字命中（排在主池之后 —— 主池那颗能算出轨道，优先级更高）
      poolEach(function (rec, kind) {
        if (String(rec.n).indexOf(num) >= 0) pushPool(rec, kind, 9, b(clip(String(rec.n), 10)));
      });
      return;
    }
    // —— ⑤ 普通词：批次名 / 卫星名 / NORAD / COSPAR / 日期
    st.launches.forEach(function (L) {
      if (!L.sats.length) return;
      var hay = (L.name + ' ' + batchVariants(L.name) + ' ' + L.cospar + ' ' + L.dateStr.slice(0, 10)).toLowerCase();
      var p = hay.indexOf(w);
      if (p >= 0) pushGroup(L, p === 0 ? 0 : 2, b(clip(L.name, 14)));
    });
    st.sats.forEach(function (s) {
      var nm = (s.name + ' ' + nameVariants(s)).toLowerCase();
      var p = nm.indexOf(w);
      if (p >= 0) { pushSat(s, p === 0 ? 0 : 3, b(clip(s.name, 16))); return; }
      if (String(s.norad).indexOf(w) === 0) { pushSat(s, 1, b(clip(String(s.norad), 10))); return; }
      var cn = (s.launch.cospar || '').toLowerCase();
      if (cn.indexOf(w) >= 0) pushSat(s, 4, b(clip(s.launch.cospar, 12)));
    });
    // V1.9.1（A19）：补池同样按「目录名 / 6 列 COSPAR / NORAD / 批次号」模糊命中
    poolEach(function (rec, kind) {
      var p = poolHay(rec).indexOf(w);
      if (p >= 0) pushPool(rec, kind, p === 0 ? 1 : 5, b(clip(rec.c, 12)));
    });
  });

  // 多词同时输入时：必须每个词都命中（取各词结果的交集）
  // ★ V1.9.1（A19-S）：判据由「候选条数 ≥ 词数」改为「**命中词数** ≥ 词数」——
  //   前者恒不成立（候选按 NORAD 去重，同一对象被 N 个词命中也只留一条），
  //   结果就是多词搜索**永远返回空**。见上面 hitWords 的说明。
  if (words.length > 1) {
    var byKey = {};
    out.forEach(function (o) {
      var k = okey(o);
      var e = byKey[k] || (byKey[k] = { best: null, notes: [] });
      if (e.best === null || o.score < e.best.score) e.best = o;
      if (e.notes.indexOf(o.note) < 0) e.notes.push(o.note);
    });
    var inter = [];
    Object.keys(byKey).forEach(function (k) {
      if (Object.keys(hitWords[k] || {}).length < words.length) return;
      var e = byKey[k];
      e.best.note = e.notes.join(' ');       // 合并标注：多个命中都列出来（如「氦星光联 航天二院」）
      inter.push(e.best);
    });
    out = inter;
  }

  out.sort(function (a, c) { return (a.score - c.score) || (c.t - a.t); });
  return out.slice(0, 18);
}
// 单条联想项：卫星名 / 批次名 + 右侧括号内标注命中字段（粗体，过长截断）
// V1.7.0：括号内的命中关键词按当前语言输出（英文界面不留中文）；
//         并把「被输入命中的那一段」加粗（原来是整段 <b> 包住，现在按命中片段高亮）。
function sugItemHtml(o, mark) {
  var name, right, tail, attrs, cls = '';
  if (o.kind === 'sat') {
    var s = o.sat;
    name = cnName(s);
    right = o.note || clip(String(s.norad), 10);
    tail = String(s.norad);
    // V1.6.3：批次项的 data-lk 必须是 launch.key（裸号，如 23095）—— 此前误用 cospar（2023-095），
    // 导致从联想区点击批次时 selectGroup 匹配不到、毫无反应。
    attrs = ' data-kind="sat" data-idx="' + s.idx + '"';
  } else if (o.kind === 'dead' || o.kind === 'pend') {
    // V1.9.1（A19）：搜索补池条目 —— 库内没有 TLE，所以**没有** data-idx（点不了"选中卫星"）。
    //   右侧尾标注直接写「已再入 / 待编目」（红 / 琥珀由 .sug-pool + data-kind 上色）。
    var pr = o.pool;
    name = pr.nm || pr.c;
    right = o.note || clip(pr.c, 12);
    tail = t(o.kind === 'dead' ? 'd_pool_dead' : 'd_pool_pend');
    attrs = ' data-kind="' + o.kind + '" data-norad="' + pr.n + '" data-bk="' + pr.bk + '"';
    cls = ' sug-pool';
  } else {
    var L = o.launch;
    name = batchName(L.name);
    right = o.note || L.name;
    tail = L.sats.length + (LANG === 'en' ? ' sats' : ' 颗');
    attrs = ' data-kind="group" data-lk="' + L.key + '"';
  }
  // V1.7.0：note 里可能带 <b>...</b>（表示命中字段），把它按语言转写：
  //   英文界面下，把括号里的中文关键词转换成对应英文（用 makerAliasSet 反查规范名）。
  right = localizeNote(right);
  return '<div class="sug-item' + cls + '"' + attrs + '>' +
    '<span class="sug-name">' + (mark ? '<i class="sug-mark">' + mark + '</i>' : '') + name +
    ' <i class="sug-note">(' + right + ')</i></span>' +
    '<span class="sug-norad">' + tail + '</span></div>';
}
// V1.7.0：把括号内的「命中关键词」按当前语言本地化（英文界面 → 英文规范名/别名）
function localizeNote(raw) {
  var s = String(raw == null ? '' : raw);
  if (LANG !== 'en') return s;
  // note 形如 <b>银河航天</b> 或 <b>长征八号甲 Y8</b> 等；先把 <b> 摘出来单独处理
  return s.replace(/<b>([^<]*)<\/b>/g, function (_, inner) {
    var en = enKeyword(inner);
    return '<b>' + en + '</b>';
  });
}
// 关键词中→英：先查制造商别名表，再查火箭/设施规则，最后原样返回
function enKeyword(kw) {
  var w = String(kw || '').trim();
  if (!w) return w;
  // 1) 制造商（含（N颗）后缀 → 规范名）
  var base = w.replace(/（[^）]*）/g, '').replace(/\([^)]*\)/g, '').trim();
  for (var i = 0; i < MAKER_ALIAS.length; i++) {
    var canon = MAKER_ALIAS[i][0];
    var names = MAKER_ALIAS[i][1];
    for (var j = 0; j < names.length; j++) {
      if (base === names[j] || base.indexOf(names[j]) === 0 || names[j].indexOf(base) >= 0) {
        return EN_MAKER[canon] || canon;
      }
    }
  }
  // 2) 火箭 / 设施：套用 linkHtml 里那套替换规则的「共享部分」
  return zh2enKw(w);
}
// 制造商规范名 → 英文名
var EN_MAKER = {
  '中国科学院微小卫星创新研究院（上海微小）': 'Shanghai Micro Satellite',
  '航天科技五院（中国空间技术研究院）': 'CAST (5th Academy)',
  '银河航天': 'Galaxy Space',
  '格思航天': 'Genesat',
  '中国商业卫星公司': 'China Commercial Satellites',
  '航天科技八院（上海航天技术研究院）': 'SAST (8th Academy)',
  '长光卫星': 'Chang Guang Satellite',
  '微纳星空': 'MinoSpace',
  '工大卫星': 'HIT Satellite',
  '北京邮电大学': 'BUPT',
  '鸿擎科技': 'Hongqing Tech',
  '航天科工二院': 'CASIC 2nd Academy',
  '中国电科电子科学研究院': 'CETC',
  '氦星光联': 'HiStarLink',
  '垣信卫星': 'Spacesail'
};
// 通用的中文关键词 → 英文（火箭型号 / 发射设施 / 批次名）
function zh2enKw(txt) {
  return String(txt)
    .replace(/长征五号B/, 'CZ-5B').replace(/长征八号甲/, 'CZ-8A').replace(/长征八号/, 'CZ-8')
    .replace(/长征六号甲/, 'CZ-6A').replace(/长征六号/, 'CZ-6').replace(/长征十二号乙/, 'CZ-12B')
    .replace(/长征十二号/, 'CZ-12').replace(/长征二号丁/, 'CZ-2D').replace(/长征二号丙/, 'CZ-2C')
    .replace(/长征三号乙/, 'CZ-3B').replace(/长征十号乙/, 'CZ-10B')
    .replace(/朱雀二号E/, 'ZQ-2E').replace(/引力一号/, 'Gravity-1')
    .replace(/远征二号/, 'YZ-2').replace(/远征一号S/, 'YZ-1S').replace(/远征三号/, 'YZ-3')
    .replace(/捷龙三号/, 'SD-3').replace(/快舟一号甲/, 'KZ-1A')
    .replace(/低轨(\d+)组/, 'LEO Group $1').replace(/极轨(\d+)组/, 'Polar Group $1')
    .replace(/试验星(\d+)组?/, 'Test Satellite $1').replace(/高轨(\d+)星?/, 'High-Orbit Sat $1')
    .replace(/酒泉/, 'JSLC').replace(/西昌/, 'XSLC').replace(/太原/, 'TSLC')
    .replace(/文昌/, 'WSLC').replace(/海商/, 'HCSLS');
}

// 四处联想搜索框（V1.3.3：全屏小窗里也各有一个），输入与候选互相同步
var SEARCH_BOXES = [
  { input: 'topSearch', sug: 'topSug' },
  { input: 'tableSearch', sug: 'tableSug' },
  { input: 'fsSearchMap', sug: 'fsSugMap' },
  { input: 'fsSearchGlobe', sug: 'fsSugGlobe' }
];

// V1.5.3：全屏顶部搜索框注册 —— 必须在下面那段统一绑定循环【之前】执行，
// 且用 try/catch 隔离，避免任何意外影响主页面搜索框的绑定。
try {
  document.querySelectorAll('.fs-search-wrap').forEach(function (w, i) {
    var inp = w.querySelector('.fs-search-input'), sg = w.querySelector('.sug-list');
    if (!inp || !sg) return;
    if (!inp.id) inp.id = 'fsTopSearch' + i;
    if (!sg.id) sg.id = 'fsTopSug' + i;
    if (!SEARCH_BOXES.some(function (b) { return b.input === inp.id; })) {
      SEARCH_BOXES.push({ input: inp.id, sug: sg.id });
    }
  });
} catch (e) {}

// V1.5.0：搜索历史（按星座独立、中英共享，刷新即清空）
var SEARCH_HISTORY = { gw: [], qf: [] };
function rememberSearch(o) {
  var k = S.key, h = SEARCH_HISTORY[k] || (SEARCH_HISTORY[k] = []);
  var id = o.kind === 'sat' ? ('s' + o.sat.norad) : ('g' + o.launch.cospar);
  for (var i = 0; i < h.length; i++) if (h[i].id === id) h.splice(i, 1);
  h.unshift(o);
  if (h.length > 6) h.length = 6;
}
// V1.5.1：搜索框内容按星座分别保存（星网与千帆互不干扰）
var SEARCH_TEXT = { gw: '', qf: '' };
function saveSearchText() {
  SEARCH_BOXES.forEach(function (b) {
    var el = document.getElementById(b.input);
    if (el && String(el.value || '').trim()) SEARCH_TEXT[S.key] = el.value;
  });
}
function loadSearchText() {
  var v = SEARCH_TEXT[S.key] || '';
  SEARCH_BOXES.forEach(function (b) {
    var el = document.getElementById(b.input);
    if (el) { el.value = v; var sg = document.getElementById(b.sug); if (sg) { sg.classList.remove('open'); sg.innerHTML = ''; } }
  });
}
function renderSug(listId, q) {
  var el = document.getElementById(listId); if (!el) return;
  var raw = String(q || '').trim();
  if (!raw) {                                   // 空输入 → 显示本次打开后的最近 6 条浏览记录
    var h = SEARCH_HISTORY[S.key] || [];
    if (!h.length) { el.classList.remove('open'); el.innerHTML = ''; return; }
    el.innerHTML = h.map(function (o) {
      return sugItemHtml(o, t('d_search_recent'));
    }).join('');
    el.classList.add('open'); return;
  }
  var list = searchCandidates(raw);
  if (!list.length) {
    el.innerHTML = '<div class="sug-item" style="cursor:default">' + t('d_search_none') + '</div>';
    el.classList.add('open'); return;
  }
  el.innerHTML = list.map(function (o) { return sugItemHtml(o, ''); }).join('');
  el.classList.add('open');
}
function closeSug() {
  SEARCH_BOXES.forEach(function (b) {
    var el = document.getElementById(b.sug);
    if (el) { el.classList.remove('open'); el.innerHTML = ''; }
  });
}
function applySearch(src) {
  var q = src.value;
  S.query = q;
  SEARCH_BOXES.forEach(function (b) {
    var el = document.getElementById(b.input);
    if (el && el !== src) el.value = q;
  });
  S.tpage = 0;
  renderTable();
  SEARCH_BOXES.forEach(function (b) { renderSug(b.sug, q); });
}

SEARCH_BOXES.forEach(function (b) {
  var el = document.getElementById(b.input); if (!el) return;
  // V1.6.0：联想区已展开时，再次点击输入框即收起（走同一套非线性动画）
  el.addEventListener('mousedown', function (e) {
    var sg = document.getElementById(b.sug);
    if (sg && sg.classList.contains('open')) { closeSug(); e.preventDefault(); }
  });
  el.addEventListener('input', function () { applySearch(this); });
  el.addEventListener('blur', function () { setTimeout(function () { closeSug(); }, 180); });   // blur 收起联想区
  el.addEventListener('focus', function () {
    if (this.value.trim()) renderSug(b.sug, this.value);
  });
});
SEARCH_BOXES.forEach(function (b) {
  var el = document.getElementById(b.sug); if (!el) return;
  el.addEventListener('mousedown', function (e) {
    var it = e.target.closest('.sug-item'); if (!it) return;
    var kd0 = it.getAttribute('data-kind');
    // V1.9.1（A19）：补池条目走单独分支 —— **不进「最近浏览」**（Q40：库里没有 TLE 的对象
    //   不该出现在"最近"里，否则那 6 条会被它们长期占住）。
    if (kd0 === 'dead' || kd0 === 'pend') {
      e.preventDefault();
      blurSearchInputs();
      poolJump(kd0, +it.getAttribute('data-norad'), it.getAttribute('data-bk'));
      closeSug();
      return;
    }
    try {                                        // V1.5.0：记入本次会话的浏览记录
      var kd = it.getAttribute('data-kind');
      if (kd === 'sat') {
        var ss = cur().sats[+it.getAttribute('data-idx')];
        if (ss) rememberSearch({ kind: 'sat', sat: ss, note: b(clip(ss.name, 16)) });
      } else {
        var LL = cur().launches.filter(function (x) { return x.key === it.getAttribute('data-lk'); })[0];
        if (LL) rememberSearch({ kind: 'group', launch: LL, note: b(clip(LL.name, 14)) });
      }
    } catch (err) {}
    e.preventDefault();
    blurSearchInputs();                       // V1.7.0 第三轮（需求5）：选完就让输入框失焦，避免手机弹出键盘
    if (it.getAttribute('data-kind') === 'group') selectGroup(it.getAttribute('data-lk'));
    else {
      // V1.7.2（需求4 ⑤）：搜索选中也是「用户选择新卫星」→ 必须解除"已关闭信息窗"，
      //   否则之前点过 ✕ 的话，搜索选完卫星仍然看不到信息窗（只有点图上的光点才会解锁）。
      infoClearClosed();
      S.sel = [+it.getAttribute('data-idx')];
      S.focusIdx = +it.getAttribute('data-idx');
      afterSelection();
    }
    closeSug();
  });
});
// V1.6.0：点空白收起联想区（覆盖主页面与全屏的全部搜索框）
document.addEventListener('click', function (e) {
  if (!e.target.closest('.search-wrap') && !e.target.closest('.fs-search-wrap')) closeSug();
});
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSug(); });

// ---- 全屏小窗：三角按钮开合左侧设置面板（手机端与电脑端同款）
document.querySelectorAll('[data-panel]').forEach(function (b) {
  b.addEventListener('click', function (e) {
    e.stopPropagation();
    var sec = b.closest('section');
    if (sec) sec.classList.toggle('panel-open');
  });
});


// ---------------------------------------------------------------- 右下角章节跳转药丸
// V1.3.6：章节重排后档位条改用「↑MOISL↓」——
// M=地图 Map · O=轨道 Orbits · I=轨道分布 Inclination · S=卫星表格 Satellite table · L=发射历史 Launch history
// V1.4.9：字母改成三列 [id, 英文, 中文] —— 中文界面显示「图轨角星箭」（图=地图 轨=轨道
// 角=轨道分布 星=卫星表格 箭=发射历史），英文界面仍用 MOISL；中文字号稍大便于辨认，
// 但按钮 26×24 尺寸固定，药丸条本身不变。
var JUMP = [['top', '↑', '↑'], ['sec-map', 'M', '图'], ['sec-orbits', 'O', '轨'], ['sec-chart', 'I', '角'], ['sec-climb', 'C', '变'], ['sec-progress', 'P', '进'], ['sec-table', 'S', '星'], ['sec-launches', 'L', '箭'], ['bottom', '↓', '↓']];
var JUMP_TITLE = {
  top: { zh: '回到顶部', en: 'Back to top' },
  'sec-map': { zh: '01 地图', en: '01 Map' },
  'sec-orbits': { zh: '02 轨道', en: '02 Orbits' },
  'sec-chart': { zh: '03 倾角分布', en: '03 Inclination Distribution' },
  // V1.9.1（A15）：04/05 互换 —— 变轨情况前移到 04、组网进度后移到 05。
  //   ⚠️ 顺带修两处**早就存在的编号 bug**：sec-table 原写「04 卫星表格」、sec-launches 原写「05 发射历史」，
  //   而它们实际是 06/07（F24 早就记过，这次一并改对）。
  'sec-climb': { zh: '04 变轨情况', en: '04 Orbits Change Status' },
  'sec-progress': { zh: '05 组网进度', en: '05 Network progress' },
  'sec-table': { zh: '06 卫星表格', en: '06 Satellite table' },
  'sec-launches': { zh: '07 发射历史', en: '07 Launch history' },
  bottom: { zh: '到页面底部', en: 'Go to bottom' }
};
var jumpPill = document.getElementById('jumpPill');
function buildJumpPill() {
  jumpPill.innerHTML = JUMP.map(function (j) {
    var tt = JUMP_TITLE[j[0]];
    var label = LANG === 'en' ? j[1] : j[2];
    return '<button data-j="' + j[0] + '" type="button" title="' +
      (tt ? (LANG === 'en' ? tt.en : tt.zh) : j[0]) + '">' + label + '</button>';
  }).join('');
  jumpPill.classList.toggle('zh-labels', LANG !== 'en');
}
buildJumpPill();
// 切语言时重建档位条（字母与 title 都跟语言走）
function refreshJumpTitles() { buildJumpPill(); }
function navHeight() {
  var n = document.querySelector('.topnav');
  return n ? n.offsetHeight : 60;
}
function smoothScrollTo(y, dur) {
  y = Math.max(0, Math.min(document.documentElement.scrollHeight - window.innerHeight, y));
  var root = document.documentElement;
  var prevSB = root.style.scrollBehavior;
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  root.style.scrollBehavior = 'auto';   // 关掉 CSS 的原生平滑滚动，避免与 rAF 动画打架
  if (reduced) { window.scrollTo(0, y); root.style.scrollBehavior = prevSB; return; }
  var x0 = window.scrollY, d = y - x0, t0 = performance.now();
  function frame(now) {
    var p = Math.min(1, (now - t0) / dur);
    var e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;   // easeInOutCubic
    window.scrollTo(0, x0 + d * e);
    if (p < 1) requestAnimationFrame(frame);
    else { window.scrollTo(0, y); root.style.scrollBehavior = prevSB; }
  }
  requestAnimationFrame(frame);
}
jumpPill.addEventListener('click', function (e) {
  var b = e.target.closest('button[data-j]');
  if (!b) return;
  var id = b.getAttribute('data-j');
  if (id === 'top') smoothScrollTo(0, 720);
  else if (id === 'bottom') smoothScrollTo(document.documentElement.scrollHeight, 900);
  else {
    var el = document.getElementById(id);
    if (el) smoothScrollTo(el.getBoundingClientRect().top + window.scrollY - navHeight() - 8, 720);
  }
  updateJumpActive(id);
});
var jumpTick = false, jumpHideT = null;
function updateJumpActive(forceId) {
  if (forceId) {
    jumpPill.querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-j') === forceId);
    });
    return;
  }
  var mid = window.scrollY + window.innerHeight * 0.5;
  var active = 'top';
  JUMP.forEach(function (j) {
    if (j[0] === 'top' || j[0] === 'bottom') return;
    var el = document.getElementById(j[0]);
    if (el && el.getBoundingClientRect().top + window.scrollY <= mid) active = j[0];
  });
  if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4) active = 'bottom';
  jumpPill.querySelectorAll('button').forEach(function (b) {
    b.classList.toggle('on', b.getAttribute('data-j') === active);
  });
}
window.addEventListener('scroll', function () {
  if (jumpTick) return;
  jumpTick = true;
  // V1.3.5：一开始滑动就滑出屏幕右侧，停止滑动 1s 后再非线性滑回来，免得挡住想看的内容
  jumpPill.classList.add('off');
  if (jumpHideT) clearTimeout(jumpHideT);
  jumpHideT = setTimeout(function () { jumpPill.classList.remove('off'); }, 1000);
  requestAnimationFrame(function () { jumpTick = false; updateJumpActive(); });
}, { passive: true });

// ══════════════════════════════════════════════════════════════════════════
// 顶栏布局：高度变量 + 三键定宽定位 + 极窄屏四级降级
//
// ⚠️ 这个函数以前**被声明了两次**（V1.7.1 新增的那份因函数声明提升被下面这份覆盖，
//    从未执行过 —— 所以"顶栏溢出检测"长期靠 CSS 兜底值侥幸通过，极窄屏会重叠）。
//    现在合并成唯一一份：既负责 --nav-h（时钟药丸与锚点定位依赖它），又负责三键布局。
//
// 四级降级（用户明确规定，窗口变窄时按序牺牲）：
//   L0  视口 ≥ NAV_W0（手机与电脑的正常宽度都走这档）→ **什么都不调**
//   L1  放不下 → 两个星座按钮**等比例收窄宽度**（保持 1:1、**字号不变**、文字左右上下居中）
//   L2  L1 已到下限 → **缩小 CISTrack**（23px → 18px）
//   L3  L2 已到下限 → **去掉按钮内文字、只留色块**（可继续缩到 1:1，极限 高:宽 = 2:1）
//
// 不变式：`CISTrack 右缘 → 星座段左缘` 的距离 == `星座段右缘 → 中英文键左缘` 的距离 == G。
// ══════════════════════════════════════════════════════════════════════════
var NAV_W0 = 480;          // L0 → L1 的临界视口宽度
var NAV_BRAND_MIN = 18;    // L2 的 CISTrack 字号下限
var NAV_BTN_MIN_W = 16;    // L3 的极限按钮宽（按钮高 32px → 高:宽 = 2:1）
function layoutNav() {
  // ① 顶栏高度 → CSS 变量（时钟药丸与锚点定位都依据它）
  document.documentElement.style.setProperty('--nav-h', navHeight() + 'px');

  var nav = document.querySelector('.topnav');
  var act = document.querySelector('.nav-actions');
  var right = document.querySelector('.nav-right');
  var seg = document.getElementById('constelSeg');
  var brand = document.querySelector('.brand-name');
  if (!nav || !act || !right || !seg) return;

  var vw = window.innerWidth;
  var G = vw >= NAV_W0 ? 12 : 8;       // CISTrack↔星座段 与 .nav-actions 内部 gap 取同一值

  // ── 复位到"自然尺寸"再测量：否则上一档的收窄会累积（窗口来回拉时越缩越小）
  seg.classList.remove('compact');
  seg.style.flex = ''; seg.style.width = ''; seg.style.minWidth = '';
  Array.prototype.forEach.call(seg.querySelectorAll('button'), function (b) {
    b.style.width = ''; b.style.minWidth = ''; b.style.flex = '';
  });
  if (brand) brand.style.fontSize = '';

  var padR = parseFloat(getComputedStyle(nav).paddingRight) || 24;
  var padL = parseFloat(getComputedStyle(nav).paddingLeft) || 24;

  function measure() {
    var brandW = brand ? Math.ceil(brand.getBoundingClientRect().width) : 0;
    var segW = Math.ceil(seg.getBoundingClientRect().width);
    var aW = Math.ceil(act.getBoundingClientRect().width);
    return { brandW: brandW, segW: segW, actW: aW, othersW: aW - segW };
  }
  // 按钮区允许占的最大宽度：保证 CISTrack 与星座段之间至少留 G
  function maxActW(brandW) { return nav.clientWidth - padL - padR - brandW - G; }

  var m = measure();
  if (!m.actW) return;                        // 还没布局（首帧），下次再算
  // 三键钉在右侧；让位宽度 = 按钮总宽 + 与内容的间距
  act.style.right = padR + 'px';
  right.style.paddingRight = (m.actW + 22) + 'px';

  // ── V1.7.2 第七轮（需求2）：这里的「顶栏中段溢出收敛」整段已删除 ──
  //   它服务的是 .nav-right 里的两样东西：五个章节链接（英文 652px，「Inclination Distribution」
  //   单项就 209px）与"要素历元"（≈208px）。V1.7.1 曾实测出：英文界面下 .nav-right 被撑到
  //   1566px、最后一个链接右缘伸进三键区 173px，elementFromPoint 在重叠处返回 BUTTON
  //   —— 于是有了"收 gap → 历元让位 → 兜底裁剪"三步迭代收敛。
  //   现在这两个节点都已从 DOM 删除（章节入口改由右下角悬浮药丸承担，历元改到主标题下方），
  //   收敛逻辑失去对象，一并清掉。**L1–L3 必须保留** —— 那是窄屏下"CISTrack 与三键不打架"
  //   的唯一保障（320px 实测仍在生效）。

  if (vw >= NAV_W0) { navFollowUp(); return; }        // ═══ L0：不调 ═══

  // ── L1–L3 改成「迭代收敛」而不是逐档递进 ──
  //   逐档递进有个实测出来的坑：L1 收窄后如果还差一点，L2 缩 CISTrack 让出的空间往往已经够用，
  //   于是永远进不到 L3（或者进了 L3 但 targetSegW3 被前面几档的残留影响），
  //   最终停在"按钮没收窄、字号也没缩"的状态 —— 320/300/280px 三个断点就是这么重叠的。
  //   迭代式：每一轮都**重新测量**、按当前真实余量决定该做什么，最多 3 轮（对应 L1→L2→L3），
  //   任何一轮只要"已经不重叠"就立即收工。这样与各档的先后顺序无关，收敛必然。
  function segRight() { return seg.getBoundingClientRect().left; }
  // V1.7.3（需求4）：收缩启动边界改为「星网按钮左缘到 CISTrack 右缘的距离 ≤ 2×按钮间距」。
  //   旧判据 overlaps()（两者接触）太晚；而 ≤900px 媒体查询里的 padding 收窄又太早
  //   （900px 实测间距还剩 567.8px 就骤缩 54→39.5px）。需求5 定长 97px 后，媒体查询
  //   只改 padding 不再改尺寸，收缩完全由这里的判据驱动：间距还剩 2×G（24/16px）以上
  //   就保持黄金比例标准长度，低于才按比例收窄。
  function overlaps() { return brand.getBoundingClientRect().right > segRight() - 0.5; }
  function tooTight() {
    var gap = segRight() - brand.getBoundingClientRect().right;
    return gap < 2 * G - 0.5 || overlaps();
  }
  function btnLimit() {                       // 每个按钮允许的最大宽度
    var allowed = maxActW(measure().brandW);   // 按钮区总额度
    var others = measure().othersW;            // 语言键 + 主题键 + 内部 gap
    return Math.max(NAV_BTN_MIN_W, Math.floor((allowed - others) / 2));
  }
  function applyBtnWidth(w) {
    // ★ 宽度必须设在**容器 `.seg` 上**，不能只设按钮的 width ——
    //   实测（320px）：给 button 写 style.width=34px 之后 getBoundingClientRect().width
    //   仍然是 56px，min-width 写成 0、flex 写成 0 0 34px 也一样无效
    //   （flex item 的 min-width:auto 会解析成 min-content = nowrap 文字宽度）。
    //   改成「容器定宽 + 两个按钮 flex:1 平分」，绕开这条路径，稳定生效。
    seg.style.flex = '0 0 ' + (w * 2) + 'px';
    seg.style.width = (w * 2) + 'px';
    seg.style.minWidth = (w * 2) + 'px';
    Array.prototype.forEach.call(seg.querySelectorAll('button'), function (b) {
      b.style.width = 'auto';
      b.style.minWidth = '0';
      b.style.flex = '1 1 0';
    });
  }
  for (var round = 0; round < 3; round++) {
    if (!tooTight()) break;                    // 间距还够（≥2×G）→ 收工，保持标准长度
    if (round === 0) {                         // L1：等比例收窄两个按钮（字号不动、文字居中）
      var lim = btnLimit();
      if (lim < (seg.getBoundingClientRect().width / 2) - 0.5) {
        applyBtnWidth(lim);
        continue;
      }
    }
    if (round <= 1) {                         // L2：缩小 CISTrack 到下限
      var fs = parseFloat(getComputedStyle(brand).fontSize) || 23;
      if (fs > NAV_BRAND_MIN + 0.1) {
        brand.style.fontSize = Math.max(NAV_BRAND_MIN, fs - 2).toFixed(1) + 'px';
        continue;
      }
    }
    // L3：去掉按钮内文字、只留色块（可继续缩到 1:1，极限 高:宽 = 2:1）
    seg.classList.add('compact');
    applyBtnWidth(btnLimit());
  }
  m = measure();
  // 收尾：让位宽度跟着最终宽度走（三键是绝对定位，内容仍需要避开它们）
  right.style.paddingRight = (m.actW + 22) + 'px';
  navFollowUp();
}

// ══════════════════════════════════════════════════════════════════════════
// V1.7.2 第七轮（需求1 + 需求3）：顶栏布局定稿后的两件「跟随动作」
//
//  ① moveConstelSlider —— 星座选中态色块（.seg-slider）的宽度与位移是用
//     getBoundingClientRect() 量出来写成内联样式的。而 L1–L3 会改按钮宽度、
//     语言切换（星网/千帆 ⇄ CS/SS）也会改按钮宽度（实测 54 → 44px，手机 39 → 30px）。
//     实测证据（v172r7b_diag）：语言切换后不重算时，色块仍是 54px 而按钮只有 44px，
//     右缘越界 9px 压在第二个按钮上 —— 用户看到的"星网按钮盖住了一部分千帆按钮"。
//     它不是两个按钮真的重叠（实测盒子重叠恒为 0），而是这个色块没跟上。
//  ② layoutTitleGap —— 页面顶部间距校准（见下）。
// ══════════════════════════════════════════════════════════════════════════
function navFollowUp() {
  try { moveConstelSlider(S.key, false); } catch (e) {}
  try { layoutTitleGap(); } catch (e) {}
}

// 取元素内文字的**字形上端**（用 Range 量文本行盒，比元素 rect + padding 推断更准）
function titleGlyphTop(el) {
  try {
    var rg = document.createRange();
    rg.selectNodeContents(el);
    var r = rg.getBoundingClientRect();
    if (r && r.height > 0) return r.top;
  } catch (e) {}
  return el.getBoundingClientRect().top + (parseFloat(getComputedStyle(el).paddingTop) || 0);
}
// ══════════════════════════════════════════════════════════════════════════
// V1.7.2 第七轮（需求3）：把「主标题文字上端 → 时间药丸下端」的距离，
//   校准成与「时间药丸上端 → 顶栏下边缘」完全相等（= 药丸自己的上边距，实测 10px）。
//
//   用户原话："当主页面滑动到顶部的时候『中国低轨互联网卫星在轨态势』这标题上端
//   到时间药丸窗的下端的视觉距离要等于现在时间药丸窗的上端到顶栏下边缘的视觉距离"。
//
//   ★ 全部换算成「文档坐标」再比较 —— 页面可能已经滚动过（resize 时尤其常见），
//     标题的视口 rect 会随滚动平移，直接相减会算出一个荒唐的 padding。
//     · 标题：视口 rect + scrollY = 文档坐标，滚动不变；
//     · 药丸是 position:fixed，它的"滚动到顶"位置 = --nav-h + pillGap；
//     · pillGap（药丸上端 ↔ 顶栏下边缘）在 sticky 顶栏下恒为 10px，与滚动无关。
//
//   为什么必须用 JS 校准而不是写死 padding：目标取决于三件随环境变化的东西 ——
//   顶栏高度（--nav-h，中英/断点不同）、药丸高度（桌面 28 / 手机 24）、
//   以及标题的**字形**上端（字号 clamp(15px,1.7vw,21px)，字号一变字形上端就变）。
//   做法与 layoutNav 一致：先把 padding-top 清零量出字形自然位置，再反算需要的值。
//   同一帧内完成读-算-写，不会有可见跳动；函数幂等（每次都从 0 起算）。
// ══════════════════════════════════════════════════════════════════════════
function layoutTitleGap() {
  var pt = document.getElementById('pageTitle');
  var pill = document.getElementById('clockPill');
  var nav = document.querySelector('.topnav');
  if (!pt || !pill || !nav) return;
  pt.style.paddingTop = '0px';
  var navH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-h'));
  if (!isFinite(navH) || navH <= 0) navH = nav.getBoundingClientRect().height || 0;
  // ★ V1.9.0 加固：顶栏高度的**量级兜底**。正常只有几十像素；一旦上游（navHeight / --nav-h）
  //   在启动那一瞬读出异常值，会把下面的 need 顶成几百像素 → 页面顶部出现一大段空白。
  if (!isFinite(navH) || navH <= 0) navH = 0;
  if (navH > 200) navH = 0;
  var navBottomVP = nav.getBoundingClientRect().bottom;
  var pr = pill.getBoundingClientRect();
  var pillGap = pr.top - navBottomVP;                    // 药丸上端 → 顶栏下边缘（= 10px）
  var target = navH + pillGap + pr.height + pillGap;     // 标题字形上端应有的文档坐标
  var glyphDoc = titleGlyphTop(pt) + (window.pageYOffset || 0);
  var need = Math.round(target - glyphDoc);
  // ★ 关键安全网：本函数算出的是「标题上方该留多少空白」，正常值只有 **几十像素**。
  //   一旦算成几百上千像素，页面顶部就会出现**超长空白**（内容被整体顶下去），
  //   而切换星座会因为重跑本函数而"自愈" —— 这正是那个怪现象的完整成因链。
  //   因此这里做**双向钳制**：非数/负数 → 0；超过上限 → 0（宁可间距不准，也绝不允许出现空白）。
  if (!isFinite(need) || need <= 0) need = 0;
  if (need > 160) need = 0;
  pt.style.paddingTop = need + 'px';
}
// ★ 启动后再复算一次：启动那一瞬的测量可能落在字体/布局未稳的时机上，
//   复算一次即可把任何误测量纠正回来（幂等，代价可忽略）。
try {
  window.addEventListener('load', function () { setTimeout(layoutTitleGap, 0); });
  if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
    document.fonts.ready.then(function () { setTimeout(layoutTitleGap, 0); }).catch(function () {});
  }
} catch (e) {}
window.addEventListener('resize', function () { layoutNav(); syncFsBarHeight(); layoutPickSlot(); try { fixPillWidths(); } catch (e) {} });
// V1.7.2（需求9）：resize 事件在某些环境下不触发或只触发一次
//   （实测：CDP 的 Emulation.setDeviceMetricsOverride 就不触发 resize，导致极窄屏下
//   L0–L3 完全没跑、按钮与 CISTrack 重叠）。这里用 rAF + 250ms 延迟各补一次，
//   覆盖「一进来就是窄屏」「切换设备旋转」「开发者工具反复开关」等路径。
// ⚠️ **刻意不用 ResizeObserver**：它观察 documentElement，而 layoutNav 自己会改按钮宽度、
//   改 .nav-right 的 padding —— 于是「改尺寸 → 触发 RO → 再跑 layoutNav → 开头又把宽度复位」
//   形成**自激循环**，结果按钮宽度永远停在自然值（实测 320px 下 JS 已设 width:34px、
//   computed min-width 却回到 56px，L1 收窄彻底失效）。resize 事件不依赖布局变化，不会自激。
window.addEventListener('resize', function () {
  requestAnimationFrame(function () { try { layoutNav(); layoutPickSlot(); fixPillWidths(); } catch (e) {} });
  setTimeout(function () { try { layoutNav(); layoutPickSlot(); fixPillWidths(); } catch (e) {} }, 250);
  // V1.7.2 第七轮：设备 hover 能力可能随外接鼠标插拔而变，若变没了就把残留的 B 浮窗收掉
  try { if (noHover()) { hideFloat('map'); hideFloat('globe'); hideFloat('chart'); } } catch (e) {}
});

// ---------------------------------------------------------------- 语言切换

// ================================================================ V1.6.0 语言切换动画
// 方向：中文在上、英文在下 → 中→英 时新字自下而上顶入、内容自下而上擦除后又自下而上长出；
//       英→中 完全对称反向。
function txSwap(el, oldText, newText, dir) {
  if (!el || oldText === newText) return;
  el.textContent = '';
  el.classList.add('tx-swap');
  var inner = document.createElement('div');
  inner.className = 'tx-in';
  var a = document.createElement('span'); a.className = 'tx-a'; a.textContent = oldText;
  var b = document.createElement('span'); b.className = 'tx-b'; b.textContent = newText;
  if (dir === 1) { inner.appendChild(a); inner.appendChild(b); }    // 新字在下 → 向上顶
  else { inner.appendChild(b); inner.appendChild(a); }              // 新字在上 → 向下压
  el.appendChild(inner);
  inner.style.transition = 'none';
  inner.style.transform = (dir === 1 ? 'translateY(0)' : 'translateY(-50%)');
  void inner.offsetWidth;
  requestAnimationFrame(function () {
    inner.style.transition = 'transform var(--anim-half) var(--ease-slow-fast)';
    inner.style.transform = (dir === 1 ? 'translateY(-50%)' : 'translateY(0)');
  });
  setTimeout(function () {
    el.classList.remove('tx-swap');
    el.textContent = newText;
    el.style.overflow = '';
  }, ANIM.half + 60);
}
function langSwapTargets() {
  var list = [];
  ['langBtn', 'brandNote'].forEach(function (id) {
    var e = document.getElementById(id); if (e) list.push(e);
  });
  // V1.7.2 第七轮（需求2）：原来这里还会收集 '.topnav .navlinks a'，
  //   顶栏章节切换按钮删掉后该选择器恒为空，属死代码，一并移除。
  document.querySelectorAll('#constelSeg button .cn').forEach(function (e) { list.push(e); });
  return list;
}
function langBlocks() {
  return Array.prototype.slice.call(document.querySelectorAll('section, footer, .hero'));
}
// 编排：擦除（先快后慢）→ 半程替换语言 → 长出（先快后慢），总时长 = --anim-t
// V1.9.0（需求1/6）：本函数已升格为**通用过场** —— 语言切换、还原所有默认设置、章级默认设置
//   三处共用同一套曲线与时长（620ms、--ease-slow-fast），保证观感完全一致。
//   `dir` 形参已废（函数体里本来就没用到），改由 playLangSwitch 这个薄包装承接旧调用。
var curtainBusy = false;                 // V1.9.0：动画进行中再点无效（防连点叠加）
function playCurtain(updateFn) {
  if (curtainBusy) return;               // V1.9.0：过场闸门
  curtainBusy = true;
  // V1.6.3：主内容用"亮度降到黑/白 → 换文案 → 逐渐显出"，与顶栏"上收→下拉"同时开始、同时结束，
  // 两段互为镜像、均为「先慢后快」。覆盖层(z-index:78)同时盖住顶部药丸与右下角章节药丸，
  // 使它们也一并参与动画（此前它们完全不动）。
  var nav = document.querySelector('.topnav');
  var veil = document.getElementById('langVeil');
  var T = ANIM.langHalf;
  var EASE = 'var(--ease-slow-fast)';
  // V1.7.2 第七轮（已排除的疑点，记录备查）：跨浏览器实测里曾出现「切英文后 scrollY 被顶高 18px、
  //   主标题钻到时间药丸底下（gap 10 → -8）」，一度判定为浏览器的**滚动锚定**在作祟。
  //   后续用 13 组对照实验把它钉死了：真正原因是**探针自身** —— Playwright 的 page.click()
  //   会先等元素可交互并做 scrollIntoViewIfNeeded，而此刻 #loadMask 加载蒙层尚未撤去
  //   （蒙层最多挂 6 秒），撤去瞬间顶栏正处于 translateY(-100%) 的位移动画中，于是被判为
  //   "按钮不在视口"而预滚了 18px。改用原生事件 page.mouse.click()（不做预滚动）后，
  //   中/英/320/390/768/1440 全部 y=0、gap=10；先滚到 300 再切语言，y 也精确保持 300。
  //   → 网页本身无此缺陷，不做任何补偿代码（避免在动画期间误改用户自己的滚动位置）。

  // ── 阶段一：顶栏上收 + 覆盖层淡入（画面渐暗/渐白）
  if (nav) { nav.style.transition = 'transform ' + T + 'ms ' + EASE; nav.style.transform = 'translateY(-100%)'; }
  if (veil) {
    veil.style.display = 'block';
    veil.style.transition = 'none';
    veil.style.opacity = '0';
    void veil.offsetWidth;
    veil.style.transition = 'opacity ' + T + 'ms ' + EASE;
    veil.style.opacity = '1';
  }

  // ── 半程：换文案（此时画面全黑/全白，任何跳变都看不见）
  setTimeout(function () {
    try { updateFn(); } catch (e) {}
    // ── 阶段二：顶栏下拉 + 覆盖层淡出（新语言逐渐显出）
    var n2 = document.querySelector('.topnav');
    if (n2) {
      n2.style.transition = 'none';
      n2.style.transform = 'translateY(-100%)';
      void n2.offsetWidth;
      n2.style.transition = 'transform ' + T + 'ms ' + EASE;
      n2.style.transform = 'translateY(0)';
    }
    var v2 = document.getElementById('langVeil');
    if (v2) {
      v2.style.transition = 'none';
      v2.style.opacity = '1';
      void v2.offsetWidth;
      v2.style.transition = 'opacity ' + T + 'ms ' + EASE;
      v2.style.opacity = '0';
    }
  }, T);

  // ── 收尾
  setTimeout(function () {
    var n3 = document.querySelector('.topnav');
    if (n3) { n3.style.transition = ''; n3.style.transform = ''; }
    var v3 = document.getElementById('langVeil');
    if (v3) { v3.style.transition = ''; v3.style.opacity = '0'; v3.style.display = 'none'; }
    // V1.7.2 第七轮（需求1/3）：顶栏刚复位到正常位置，这一刻必须再跟随一次 ——
    //   半程那次（updateFn → renderChrome → layoutNav → navFollowUp）虽然按钮宽度已经换成
    //   新语言的，但顶栏当时还挂在 translateY(-100%) 上，药丸/页脚的 rect 都处于偏移状态；
    //   顶部间距的校准必须在顶栏归位后重做，否则会留下一个错误的 padding。
    try { moveConstelSlider(S.key, false); } catch (e) {}
    try { layoutTitleGap(); } catch (e) {}
    curtainBusy = false;                 // V1.9.0：过场收尾，解除闸门
  }, ANIM.lang + 60);
}
// V1.9.0（需求1/6）：语言切换 = 通用过场 + 切换语言本身（外观与还原默认完全同款）。
function playLangSwitch(dir, updateFn) { playCurtain(updateFn); }
document.getElementById('langBtn').addEventListener('click', function () {
  var newLang = LANG === 'en' ? 'zh' : 'en';
  var dir = (LANG === 'zh' && newLang === 'en') ? 1 : -1;   // V1.6.0：中→英 自下而上，英→中 对称
  playLangSwitch(dir, function () {
    LANG = newLang;
    applyStaticLang();
    refreshMaskText();
    renderChrome();
    refreshJumpTitles();
    rebuild();
    syncTimeUI();
    setPick(S.pick.on);
    updatePickHint();
    layoutPickSlot();
    syncSelInfo();                 // V1.6.3：切语言后信息窗也要跟着换语言
    mapDirty = globeDirty = true;
  });
});
var frameStatesMap = null, frameStatesGlobe = null, lastSecMap = 0, lastSecGlobe = 0, lastGlobeDraw = 0;
function loop() {
  requestAnimationFrame(loop);
  // V1.9.0（需求14，A 方案的性能部分）：主题切换（View Transition 圆形扩散）期间**暂停主循环**。
  //   扩散动画的每一帧都在与"卫星推算 + 画布重绘"抢主线程，这是卡顿的主要来源之一；
  //   暂停 520ms 对画面无影响（卫星位置与秒针在半秒内看不出差别），但掉帧会明显减少。
  //   ★ 效果与时长**一律不动**（用户明确要求）：这里只改"谁在什么时候干活"，不碰任何视觉参数。
  //   vt-running 由主题按钮在动画开始时挂上、结束时摘下（见 finishHeavy），摘掉后本循环自然恢复。
  if (document.documentElement.classList.contains('vt-running')) return;
  var now = performance.now();
  // V1.7.3（需求9）：两章时间**各自独立** —— 各自的模拟时刻、各自的 SGP4 推算缓存。
  //   实时章跟墙钟每秒一推；冻结章的 simMs 恒定 → sec 不再变化 → 不重复推算（顺带省电）。
  var msMap = simMs('map'), msGlobe = simMs('globe');
  var secMap = Math.round(msMap / 1000), secGlobe = Math.round(msGlobe / 1000);
  var freshMap = (secMap !== lastSecMap || !frameStatesMap);
  var freshGlobe = (secGlobe !== lastSecGlobe || !frameStatesGlobe);
  if (freshMap) { frameStatesMap = propagateAll(msMap); lastSecMap = secMap; }
  if (freshGlobe) {
    // 两章时刻相同（典型：都实时）→ 直接复用同一份推算，不白算第二遍
    frameStatesGlobe = (msGlobe === msMap && frameStatesMap) ? frameStatesMap : propagateAll(msGlobe);
    lastSecGlobe = secGlobe;
  }
  updateBreath();
  // V1.3.8：自转从「每帧固定角度」改成「按经过的时间」。
  // 旧写法与帧率绑死：没选卫星时每帧要画 400 多颗，帧率掉到十几帧，地球慢得像停了；
  // 选中一颗后只画一颗，帧率翻几倍，地球就转得飞快。现在固定 0.028 rad/s（约 224 秒一圈，
  // 正好是旧版「慢」与「快」的中间），与帧率彻底解耦。
  var spinDt = lastSpinMs ? Math.min(200, now - lastSpinMs) : 0;
  lastSpinMs = now;
  if (S.spin && isVisible(globeCv) && spinDt > 0) {
    G.yaw += SPIN_RATE * spinDt / 1000;
    globeDirty = true;
  }
  // 按需绘制：地图每秒一次 + 交互时；地球自转时限流到约 30fps
  if (isVisible(mapCv) && (mapDirty || freshMap)) { drawMap(frameStatesMap, msMap); mapDirty = false; }
  // V1.4.5：自转时的重绘从 30fps 再收到 20fps（每 50ms 一帧）—— 自转是慢动作，20fps 看不出差别，
  // 但每帧要重画 400 多颗卫星与轨道圈，降下来省掉的正是这部分开销。
  if (isVisible(globeCv) && (globeDirty || freshGlobe) && (now - lastGlobeDraw > 50)) {
    drawGlobe(frameStatesGlobe, msGlobe); globeDirty = false; lastGlobeDraw = now;
  }
}
// V1.4.5：resize 不再把地球缩放清零（改用倍数存储，见 globeRadNow），
// 也不再清 frameStates —— 推算结果与画布尺寸无关，清掉只是白算一次全量 SGP4。
window.addEventListener('resize', function () { drawChart(); try { drawNet(); } catch (e) {} });

// ---------------------------------------------------------------- 页脚 / 侧边导航 / 关于
function renderChrome() {
  var a = document.getElementById('footLink');
  if (a) { a.textContent = '小橙子的宇宙Jackoraniverse'; a.href = BILI; }   // V1.3.5：去掉与页脚重复的版本号
  var c = document.getElementById('footCopy');
  // V1.3.5：产品名统一 CISTrack，版本号用白色（页面主色）而非灰色
  if (c) c.innerHTML = 'CISTrack<i class="foot-ver"> · ' + VERSION + '</i>';
  // 信息窗关闭按钮的提示随语言刷新
  document.querySelectorAll('.sat-info .si-close').forEach(function (b) {
    b.title = t('d_close_info');
    b.setAttribute('aria-label', t('d_close_info'));
  });
  layoutNav();
  updateJumpActive();
}

// ---------------------------------------------------------------- 联网刷新最新轨道要素
// V1.3.7：不再只认 CelesTrak 的两个分组 —— 分组会漏掉早期试验星（2023 年的 23095 / 23212 等），
// 所以再补一次按名称的查询（cCelesTrak 的 NAME= 是前缀模糊匹配），两路合并、同编号取历元最新的。
// 这样只拿到本 HTML 的人，打开页面也能拿到和构建时同样全的一批要素；失败则继续用内置快照。
// V1.7.0 第四轮（需求1）/ V1.7.1（需求3）：TLE_LIVE 记录是否已联网拿到最新目录。
//   V1.7.1 起**界面上不再显示任何联网状态标记**（原来的「（内置快照）」后缀已删，访客看不懂）；
//   这个变量保留给页内说明与将来的统计用。
// 打开页面**一定会**自动尝试联网更新（三路直连 CelesTrak + 两个公共代理，30 分钟 sessionStorage 缓存），
// 成功则 applyFresh → rebuild → renderHeader 把顶栏/加载页/信息窗/导出图全部刷成新历元；失败才退回内置快照。
var TLE_LIVE = false;
var TLE_SRC = {
  gw: ['https://celestrak.org/NORAD/elements/gp.php?GROUP=hulianwang&FORMAT=tle',
       'https://celestrak.org/NORAD/elements/gp.php?NAME=HULIANWANG&FORMAT=tle',
       'https://celestrak.org/NORAD/elements/gp.php?NAME=GUOWANG&FORMAT=tle'],
  qf: ['https://celestrak.org/NORAD/elements/gp.php?GROUP=qianfan&FORMAT=tle',
       'https://celestrak.org/NORAD/elements/gp.php?NAME=QIANFAN&FORMAT=tle',
       'https://celestrak.org/NORAD/elements/gp.php?NAME=SPACESAIL&FORMAT=tle']
};
// 名称口径必须与构建脚本一致，避免 NAME= 的前缀匹配把别的星座也捞进来
var NAME_OK = { gw: /HULIANWANG|GUOWANG|^GW-/i, qf: /QIANFAN|SPACESAIL|G60/i };
var PROXIES = [
  function (u) { return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u); },
  function (u) { return 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(u); }
];
function parseTleText(txt) {
  var lines = String(txt).split('\n').map(function (l) { return l.trim(); }).filter(function (l) { return l; });
  var out = [];
  for (var i = 0; i + 2 < lines.length; i += 3) {
    var l1 = lines[i + 1], l2 = lines[i + 2];
    if (!/^1 /.test(l1) || !/^2 /.test(l2)) continue;
    out.push({ name: lines[i], id: parseInt(l1.slice(2, 7), 10), c: l1.slice(9, 17).trim(), l1: l1, l2: l2 });
  }
  return out;
}
function fetchText(url, timeoutMs) {
  return new Promise(function (res, rej) {
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var to = setTimeout(function () { if (ctl) ctl.abort(); rej(new Error('timeout')); }, timeoutMs || 6000);
    fetch(url, ctl ? { signal: ctl.signal } : undefined).then(function (r) {
      clearTimeout(to);
      if (!r.ok) { rej(new Error('HTTP ' + r.status)); return; }
      return r.text();
    }).then(function (t) { if (t) res(t); }).catch(function (e) { clearTimeout(to); rej(e); });
  });
}
function epochOf(s) { return parseFloat(s.l1.slice(18, 32)) || 0; }
// 多源合并：同一个 NORAD 编号取历元（epoch）最新的一份
function mergeTle(lists) {
  var map = new Map();
  lists.forEach(function (list) {
    (list || []).forEach(function (s) {
      var old = map.get(s.id);
      if (!old || epochOf(s) > epochOf(old)) map.set(s.id, s);
    });
  });
  var out = [];
  map.forEach(function (s) { out.push(s); });
  return out.sort(function (a, b) { return a.c.localeCompare(b.c) || a.id - b.id; });
}
// V1.4.0：同一次浏览会话里，30 分钟内不重复拉同一批要素 —— 省流量、二次打开瞬间完成。
// 用 sessionStorage（关掉标签页就失效），所以不会让人看到过期很久的数据；读写失败一律忽略。
var TLE_CACHE_KEY = 'cistrack.tle.v1', TLE_CACHE_MS = 30 * 60 * 1000;
function cacheGet(group) {
  try {
    var raw = sessionStorage.getItem(TLE_CACHE_KEY);
    if (!raw) return null;
    var e = JSON.parse(raw)[group];
    if (!e || !e.t || (Date.now() - e.t) > TLE_CACHE_MS) return null;
    return (e.s && e.s.length > 20) ? e.s : null;
  } catch (err) { return null; }
}
function cacheSet(group, list) {
  try {
    var raw = sessionStorage.getItem(TLE_CACHE_KEY);
    var o = raw ? JSON.parse(raw) : {};
    o[group] = { t: Date.now(), s: list };
    sessionStorage.setItem(TLE_CACHE_KEY, JSON.stringify(o));
  } catch (err) { }
}
function tryOne(group) {
  var hit = cacheGet(group);
  if (hit) return Promise.resolve(hit);
  // 三路并发，各自失败就算了（Promise.allSettled 在老浏览器没有，手写一份）
  var jobs = TLE_SRC[group].map(function (u) {
    return fetchText(u, 5000).then(function (t) {
      return parseTleText(t).filter(function (s) { return NAME_OK[group].test(s.name); });
    }).catch(function () { return []; });
  });
  var direct = Promise.all(jobs).then(function (lists) { return mergeTle(lists); });
  var fallback = PROXIES.reduce(function (chain, mk) {
    return chain.then(function (list) {
      if (list && list.length > 20) return list;
      return fetchText(mk(TLE_SRC[group][0]), 6000).then(function (t) {
        return parseTleText(t).filter(function (s) { return NAME_OK[group].test(s.name); });
      }).catch(function () { return list; });
    });
  }, direct);
  return fallback.then(function (list) {
    if (list && list.length > 20) { cacheSet(group, list); return list; }
    return null;
  });
}
function applyFresh(gwList, qfList) {
  RAW.gw.sats = gwList; RAW.qf.sats = qfList;
  CONST.gw = build('gw'); CONST.qf = build('qf');
  S.sel = []; S.focusIdx = null; S.launchFilter = 'all';
  rebuild();
  return CONST.gw.epochMax;
}
// V1.3.6：加载页第三行是「要素历元」；遮罩显示期间给 <html> 挂 .loading 锁住背后页面的滑动，
// 收起遮罩时同步摘掉（否则页面会一直不能滚）。
function setLoadEpoch(txt) {
  var e = document.getElementById('lmEpoch');
  if (e) e.textContent = txt;
}
function hideMask(m) {
  if (!m) return;
  m.classList.add('hide');
  document.documentElement.classList.remove('loading');
  setTimeout(function () { m.style.display = 'none'; }, 500);
}
function endLoad(msg, ok) {
  var m = document.getElementById('loadMask'), tx = document.getElementById('lmTxt');
  if (tx) tx.textContent = msg;
  setTimeout(function () { hideMask(m); }, ok ? 420 : 1100);
}
// ---------------------------------------------------------------- V1.4.0：词条计数可外部覆盖
// 为什么不做「页面直接抓词条」：卫星百科的 WAF 对非浏览器请求一律 403（连 api.php 也拦），
// 而且响应不带 CORS 头，页面里 fetch 拿不到。所以改成「同目录放一份 wiki.json」：
//   把 wiki.json 和 HTML 一起托管（GitHub Pages / 任意静态站），以后只改 JSON 里的数字，
//   所有访客刷新就能看到新统计 —— 既不用重新构建，也不依赖任何自动抓取。
var WIKI_JSON_URL = './wiki.json';
function loadWikiJson() {
  return fetchText(WIKI_JSON_URL, 6000).then(function (txt) {
    var j = JSON.parse(txt);
    if (!j || !j.gw || !j.qf) return false;
    var hit = false;
    ['gw', 'qf'].forEach(function (k) {
      var w = j[k];
      if (!RAW[k] || !w || !w.launched || !w.inOrbit) return;
      var old = RAW[k].wiki || {};
      RAW[k].wiki = {
        asOf: j.asOf || old.asOf || '',
        article: old.article || (k === 'gw' ? '星网' : '千帆星座'),
        launched: w.launched, inOrbit: w.inOrbit, launches: w.launches || old.launches
      };
      hit = true;
    });
    if (hit) renderHeader();          // 覆盖成功后立刻重画顶部那几项
    return hit;
  }).catch(function () { return false; });
}
// ---------------------------------------------------------------- V1.9.0（R17）：历史轨道要素外挂
// 与 wiki.json 完全同一套路：同目录 fetch → 成功则覆盖内置 → 失败静默回退。
//   覆盖后必须**重画 05 章**：曲线缓存 CLIMB 是按 RAW[key].hist 建的，
//   数据换了而缓存不清，画出来的仍是内置那份（或一片空白）。
// ============================================================================
// 规模重估后的设计（V1.9.0）：历史库**按批次分片 + 按需加载**
// ----------------------------------------------------------------------------
// 为什么不是一个大 history.json：两个星座未来会到数万~数十万颗，
//   10 万颗 × 20 年 = 2.26 GB（原方案）→ 超 GitHub 单文件 100 MB 硬限，页面更不可能一次加载。
//   分片后页面**只取选中的那一个批次**（几十 KB），仓库总量再大也不影响速度。
// 目录结构（与 HTML 同级）：
//   history/index-gw.json    批次索引（列表 + 每批卫星数/点数/字节/日期范围）—— 首屏只取这两个
//   history/index-qf.json
//   history/gw-23095.json    单个批次的 v2 紧凑数据 —— 选中时才取
//   history/qf-24140.json
// 编码：{ v:2, base, prec, sats:[{ n, t0, d:[天偏移], a:[半长轴×prec] }] }
//   解码后写回 RAW[key].hist[lk] 成内部统一的三元组 —— 绘制层完全不用改。
// 三级降级：外挂分片 → 内置精简兜底 → 「暂无历史数据」，任何一级失败都不报错。
// ============================================================================
var HIST_DIR_URL = './history/';
var HIST_IDX = { gw: null, qf: null };        // 批次索引（null = 没拉到）
var HIST_LOADED = { gw: {}, qf: {} };         // 已解码入库的批次
var HIST_PENDING = { gw: {}, qf: {} };        // 正在拉取的批次（避免重复请求）
var HIST_CACHE_MAX = 24;                      // 最多缓存多少个批次（防长时间浏览后内存膨胀）
function histIndexUrl(bk) { return HIST_DIR_URL + 'index-' + bk + '.json'; }
function histShardUrl(bk, lk) { return HIST_DIR_URL + bk + '-' + lk + '.json'; }
function loadHistIndex(bk) {
  if (HIST_IDX[bk]) return Promise.resolve(HIST_IDX[bk]);
  if (typeof fetchText !== 'function') return Promise.resolve(null);
  return fetchText(histIndexUrl(bk), 8000).then(function (txt) {
    var j = JSON.parse(txt);
    HIST_IDX[bk] = (j && j.batches) ? j : null;
    return HIST_IDX[bk];
  }).catch(function () { HIST_IDX[bk] = null; return null; });
}
/** 把 v2 分片解码成内部三元组 [norad, ms, sma]，写进 RAW[bk].hist[lk] */
function decodeHistShard(bk, lk, j) {
  var sats = (j && j.sats) || [];
  var base = (j && isFinite(j.base)) ? j.base : 6000;
  var prec = (j && isFinite(j.prec) && j.prec > 0) ? j.prec : 10;
  var recs = [];
  for (var i = 0; i < sats.length; i++) {
    var s = sats[i], d = s.d || [], a = s.a || [];
    for (var k = 0; k < d.length && k < a.length; k++) {
      recs.push([s.n, (s.t0 + d[k]) * 86400000, base + a[k] / prec]);
    }
  }
  if (!recs.length) return false;
  if (!RAW[bk]) return false;
  RAW[bk].hist = RAW[bk].hist || {};
  RAW[bk].hist[lk] = recs;
  HIST_LOADED[bk][lk] = true;
  // 缓存上限：超出就丢掉最早加载的那批（简单 LRU，防内存无限增长）
  var keys = Object.keys(HIST_LOADED[bk]);
  if (keys.length > HIST_CACHE_MAX) {
    var drop = keys[0];
    delete HIST_LOADED[bk][drop];
    if (RAW[bk].hist) delete RAW[bk].hist[drop];
  }
  CLIMB = null;                              // ★ 数据变了必须重建曲线缓存
  return true;
}
/** 确保某批次已加载；返回 Promise<boolean> */
function ensureHistBatch(bk, lk) {
  if (!lk) return Promise.resolve(false);
  if (HIST_LOADED[bk] && HIST_LOADED[bk][lk]) return Promise.resolve(true);
  if (HIST_PENDING[bk] && HIST_PENDING[bk][lk]) return HIST_PENDING[bk][lk];
  if (typeof fetchText !== 'function') return Promise.resolve(false);
  var p = fetchText(histShardUrl(bk, lk), 8000).then(function (txt) {
    return decodeHistShard(bk, lk, JSON.parse(txt));
  }).catch(function () { return false; }).then(function (ok) {
    HIST_PENDING[bk][lk] = null;
    return ok;
  });
  HIST_PENDING[bk][lk] = p;
  return p;
}
/** 索引里该批次的概览（没索引就返回 null） */
function histBatchInfo(bk, lk) {
  var ix = HIST_IDX[bk];
  if (!ix || !ix.batches) return null;
  for (var i = 0; i < ix.batches.length; i++) if (ix.batches[i].k === String(lk)) return ix.batches[i];
  return null;
}
function loadHistoryJson() {
  if (typeof fetchText !== 'function') return Promise.resolve(false);
  return Promise.all([loadHistIndex('gw'), loadHistIndex('qf')]).then(function (r) {
    var hit = !!(r[0] || r[1]);
    if (hit) {
      // 索引到了 → 立刻把**默认批次**（最新的那个）拉下来，首屏就有曲线。
      // ⚠️ 默认批次必须**从索引里取**，不能用 climbSeries()：
      //   内置兜底每颗星往往只有 1 个点（画不出变化 → climbCurve 为空），
      //   于是 climbSeries() 算不出默认批次 → 一个分片都不加载 → 页面仍显示"暂无历史数据"。
      //   （端到端验证实测抓到过：分片明明可取，页面却一直空着。）
      try { renderClimbSel(); renderClimbTake(); } catch (e) {}
      var ix = HIST_IDX[S.key];
      var lk = (ix && ix.batches && ix.batches.length) ? String(ix.batches[0].k) : '';
      if (!lk) { var d0 = climbSeries(); lk = d0.lk || ''; }
      if (lk) {
        return ensureHistBatch(S.key, lk).then(function () {
          try { climbView = null; climbAutoView(); renderClimbSel(); drawClimb(); } catch (e) {}
          return true;
        });
      }
    }
    return hit;
  }).catch(function () { return false; });
}
(function refresh() {
  var started = Date.now();
  // 硬性兜底：6 秒内无论结果如何都收起遮罩（更新在后台完成后仍会生效）
  setTimeout(function () {
    var m = document.getElementById('loadMask');
    if (m && !m.classList.contains('hide')) {
      if (document.getElementById('lmTxt').textContent === t('d_loading'))
        document.getElementById('lmTxt').textContent = t('d_offline');
      hideMask(m);
    }
  }, Math.max(0, 6000 - (Date.now() - started)));
  // V1.4.0：顺手读同目录下的 wiki.json —— 词条计数可以「改一个 JSON 就全网更新」，
  // 不必重新构建 HTML。读不到（本地 file:// 打开、或没放这个文件）就继续用内置值。
  loadWikiJson();
  // V1.9.0（R17）：05 章的历史轨道要素同样外挂 —— 但不是单个文件，而是 **history/ 分片目录**。
  //   规模重估后（数万~数十万颗）单个大 JSON 会撞 GitHub 100MB 硬限，故按批次分片 + 索引，
  //   页面只取选中的那一批。读不到（file:// 打开、或没放）→ 用 satdata 里的**精简内置兜底**。
  loadHistoryJson();
  Promise.all([tryOne('gw'), tryOne('qf')]).then(function (r) {
    if (!r[0] || !r[1]) { throw new Error('empty'); }
    // V1.7.0 第四轮（需求1）：必须在 applyFresh 之前置位 —— applyFresh→rebuild()→renderHeader()
    // 会立刻按 TLE_LIVE 决定顶栏要不要带「（内置快照）」后缀；若置位晚一步，联网成功也会被误标成快照。
    TLE_LIVE = true;
    var ep = applyFresh(r[0], r[1]);
    checkNewSats();                     // V1.4.2：对一下在线目录与打包时收录的那份，有新卫星就提示
    setLoadEpoch(t('d_epoch') + ' ' + fmtUTC(CONST[S.key] ? CONST[S.key].epochMax : ep) + ' UTC');
    endLoad(t('d_updated'), true);      // V1.3.9：纪元只留在加载圈下面那行
  }).catch(function () {
    // V1.7.1（需求3）：联网失败时**不再**显示「（内置快照）」—— 访客看不懂这个说法。
    //   成功与失败现在显示的都是同一种格式的时间，口径一致；区别只体现在标题（已更新 / 离线），
    //   断网时用打包时的内置要素这件事写进页内说明的数据来源章节。
    setLoadEpoch(t('d_epoch') + ' ' + fmtUTC(cur().epochMax) + ' UTC');
    endLoad(t('d_offline'), false);
  });
})();

// ---------------------------------------------------------------- V1.4.2：让错误看得见
// 之前任何脚本报错都是静默的 —— 用户只会看到「图上没东西」，既说不清也没法排查。
// 现在顶部浮出一条可关闭、可复制的提示，里面带上浏览器与版本信息，直接截图就能定位问题。
function diagText(msg, extra) {
  return [
    '页面版本: ' + VERSION,
    '时间: ' + new Date().toISOString(),
    '浏览器: ' + (navigator.userAgent || '?'),
    '视口: ' + window.innerWidth + '×' + window.innerHeight + ' @dpr' + (window.devicePixelRatio || 1),
    'SGP4: ' + (window.satellite ? '已加载' : '未加载'),
    '画布: ' + ['map', 'globe', 'chart'].map(function (id) {
      var c = document.getElementById(id);
      return id + '=' + (c ? c.width + 'x' + c.height : '无');
    }).join(' '),
    '坏星: ' + (S.badSat || 0) + (S.badSatFirst ? (' (' + S.badSatFirst + ')') : ''),
    '错误: ' + msg + (extra ? '  ' + extra : '')
  ].join('\n');
}
var ERR_SHOWN = false;
function showFatal(msg, file, line) {
  if (ERR_SHOWN) return;
  ERR_SHOWN = true;
  try {
    var box = document.createElement('div');
    box.id = 'errBar';
    box.innerHTML = '<div class="eb-t">⚠ ' + t('d_err_t') + '</div>' +
      '<div class="eb-m"></div>' +
      '<div class="eb-a"><button type="button" id="ebCopy">' + t('d_err_copy') + '</button>' +
      '<button type="button" id="ebX">' + t('d_err_close') + '</button></div>';
    document.body.appendChild(box);
    box.querySelector('.eb-m').textContent = String(msg).slice(0, 300);
    box.querySelector('#ebCopy').addEventListener('click', function () {
      var txt = diagText(msg, file ? (file + ':' + line) : '');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(function () {
          box.querySelector('#ebCopy').textContent = t('d_err_copied');
        }, function () { });
      } else {
        window.prompt('复制下面的诊断信息：', txt);
      }
    });
    box.querySelector('#ebX').addEventListener('click', function () { box.remove(); ERR_SHOWN = false; });
  } catch (e) { }
}
// V1.4.2：打开时顺带对一下「在线 NORAD 目录」与「页面内置快照」。
// 多出来的编号 = 新编目卫星 ≈ 又有一次发射。页面拿不到词条统计（WAF 拦非浏览器请求、响应无 CORS），
// 所以这里只提示、不改数字；看到提示去更新同目录的 wiki.json 即可。
var BUILTIN_NORAD = null;
function noradSetNow() {
  var out = {};
  try { cur().sats.forEach(function (x) { out[x.norad] = 1; }); } catch (e) { }
  return out;
}
function checkNewSats() {
  if (!BUILTIN_NORAD) return;
  var now = noradSetNow(), added = [];
  Object.keys(now).forEach(function (id) { if (!BUILTIN_NORAD[id]) added.push(id); });
  if (!added.length) return;
  added.sort(function (a, b) { return (+a || 0) - (+b || 0); });
  showNotice(t('notice_new_t'),
    t('notice_new_m').replace('{n}', added.length).replace('{id}', added[added.length - 1]));
}
function showNotice(title, body) {
  try {
    if (document.getElementById('noticeBar')) return;
    var box = document.createElement('div');
    box.id = 'noticeBar';
    box.innerHTML = '<div class="nb-t"></div><div class="nb-m"></div>' +
      '<div class="nb-a"><button type="button" id="nbX">' + t('notice_ok') + '</button></div>';
    document.body.appendChild(box);
    box.querySelector('.nb-t').textContent = title;
    box.querySelector('.nb-m').textContent = body;
    box.querySelector('#nbX').addEventListener('click', function () { box.remove(); });
  } catch (e) { }
}
window.addEventListener('error', function (e) { showFatal(e.message || 'unknown', e.filename, e.lineno); });
window.addEventListener('unhandledrejection', function (e) {
  var r = e.reason;
  showFatal('Promise 未处理: ' + (r && (r.message || r) || 'unknown'));
});
// SGP4 没加载出来是最致命的一种 —— 单独提前报
if (!window.satellite) {
  window.addEventListener('DOMContentLoaded', function () {
    showFatal(t('d_err_nosgp4'));
  });
}

// 启动
document.getElementById('lmTxt').textContent = t('d_loading');
// V1.3.6：遮罩还在时锁住背后页面的滑动（hideMask 会摘掉 .loading）
document.documentElement.classList.add('loading');
document.getElementById('sec-orbits').querySelector('.time-r').max = 180;
applyStaticLang();
renderChrome();
// V1.7.0 第三轮（需求1）：先把「两个星座各自的状态」读回来，再首次重建 ——
// 这样刷新页面后，回到上次停留的星座时，它自己的选中/设置/视图位置都还在。
// V1.7.0 第四轮（需求6）：启动一律从默认状态开始 —— 清掉旧访客 localStorage 里的残留
// （旧版存过 cistrack.store.v1 / cistrack.prefs.v1，不清理的话老用户刷新仍会带回旧状态），
// 然后按出厂默认初始化两星座快照（initStore + applyConstel，不再 storeLoad）。
try { localStorage.removeItem(STORE_KEY); localStorage.removeItem(PREF_KEY); } catch (e) {}
// ================================================================ V1.8.0（需求4）：520ms 非线性动画四件套
//   ① 开关画布同步：开关某个图层时，该图层在画布上淡入/淡出，而不是"啪"地出现/消失；
//   ② 配色插值：切换「按卫星 / 按批次」时，光点颜色在两套色板之间逐帧插值；
//   ③ 观测点进出：进入/退出观测点模式时，观测点标记与标签淡入/淡出；
//   ④ 表格翻页：换页时整表淡出 → 换内容 → 淡入（非线性 cubic-bezier，见 CSS 的 .tbl-fade-out/.tbl-fade-in）。
// 一律走 animTo（easeOutCubic，520ms），与站内其它动画同一套时长与曲线。
var TOG = { covOn: 1, mapTrack: 1, nameMap: 1, coneOn: 1, showTracks: 1, nameGlobe: 1, pickOn: 0 };
function togAnim(key, on) {
  var to = on ? 1 : 0;
  var from = (typeof TOG[key] === 'number') ? TOG[key] : to;
  TOG[key] = from;
  if (Math.abs(from - to) < 0.001) { TOG[key] = to; mapDirty = globeDirty = true; return; }
  animTo(ANIM.t, function (k) {
    TOG[key] = (k >= 1) ? to : (from + (to - from) * k);
    mapDirty = globeDirty = true;
  });
}
// 「还原默认 / 换星座 / 首帧」这些强制把状态拨回去的场合：动画系数必须与状态对齐，
// 否则会出现「开关是关的、画布上却还画着」（TOG 停在 1）这种自相矛盾。
function togSyncAll() {
  TOG.covOn = S.cov.on ? 1 : 0;
  TOG.mapTrack = S.mapTrack ? 1 : 0;
  TOG.nameMap = S.names.map ? 1 : 0;
  TOG.coneOn = S.cone.on ? 1 : 0;
  TOG.showTracks = S.showTracks ? 1 : 0;
  TOG.nameGlobe = S.names.globe ? 1 : 0;
  TOG.pickOn = S.pick.on ? 1 : 0;
}
// 退出观测点模式时，标记要淡出而不是瞬间消失 → 先把最后位置记下来，动画结束再丢
var PICK_FADE = null;

// 需求原文：新增一章折线图，画两个星座的组网推进速度。
// 决定口径（Q5）：
//   · 粒度**按周**，横轴不写「第 XX 周」，直接**标出对应的日期**；
//   · 纵轴「发射量」= 所有发射的颗数累加（含发射失败与部分成功的；**没有对应数字就不加**）；
//   · 纵轴「在轨数量」= 有最新 TLE 的颗数 + 已发射未编目、且发射记录为成功的颗数
//     （例：最近成功发射 8 颗未编目 → 在现有 TLE 数目上 +8）；
//   · 曲线颜色用本页页面主题色：星网红 / 千帆蓝。
// 数据来源：构建期写进 satdata 的 launches（含第 6 位任务结果、第 7 位百科记载颗数）+
//   launchCounts（目录里数出来的颗数）+ pending（待编目颗数）。访客端零请求，离线可用。
var netCv = document.getElementById('netCv');
var netInfo = document.getElementById('netInfo');
// V1.9.0（修复问题2）：「信息窗是否已被点击固定」—— 固定后 mouseleave 不再把它收走，
//   于是它既能停住被阅读，也能被拖动（旧版一移开鼠标就没了，两个症状是同一个根因）。
var netPinned = false;
// V1.9.0（需求8）：04 章信息窗里「新增卫星」的批次/组链接 —— 点击 = 全选该批次（与卫星表格里的
//   批次链接同款行为，走同一个 selectGroup）。用事件委托，避免每次重绘信息窗都要重新绑定。
//   阻止冒泡，免得被画布的空白点击当成"取消选择"。
if (netInfo) netInfo.addEventListener('click', function (e) {
  var a = e.target.closest ? e.target.closest('[data-lk]') : null;
  if (!a) return;
  e.preventDefault(); e.stopPropagation();
  selectGroup(a.getAttribute('data-lk'));
});
var netRect = null, netView = null, netHoverIdx = null, NET = null;
var NET_WK = 7 * 86400000;

function netMonday(ms) {                      // 该时刻所在周的周一 00:00（本地时区）
  var d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime() - ((d.getDay() + 6) % 7) * 86400000;
}
// 单次发射在某个口径下记多少颗
function netCountOf(L, mode) {
  if (mode === 'orbit') {
    // 在轨 = 已有 TLE 的颗数 + 成功但尚未编目的颗数（失利批次不补，因为它根本没进轨道）
    return L.sats.length + ((L.pending > 0 && L.res !== 'fail') ? L.pending : 0);
  }
  // 发射量：优先用目录里数出来的颗数（launchCounts，最全）；目录里数不出来（如失利的那一发、
  // 或还没有任何编目对象的批次）才用卫星百科记载的颗数；两者都没有 → 这一发不计（Q5 明确要求）
  if (L.count > 0) return L.count;
  return L.wn > 0 ? L.wn : 0;
}
function netBuild() {
  var mode = S.netMode, now = Date.now();
  var evs = [], minMs = Infinity, maxMs = 0;
  ['gw', 'qf'].forEach(function (key) {
    CONST[key].launches.forEach(function (L) {
      if (!isFinite(L.dateMs)) return;
      // V1.9.0（需求8）：把批次 key（5 位发射编号）一并带上 —— 信息窗里「新增卫星」的批次/组名
      //   要能点击 = 全选该批次（与表格里的批次链接同款行为），而旧版这里只带了 name。
      evs.push({ ms: L.dateMs, key: key, n: netCountOf(L, mode), name: L.name, lk: L.key,
        res: L.res, pend: L.pending || 0, cnt: L.count || 0, wn: L.wn || 0 });
      if (L.dateMs < minMs) minMs = L.dateMs;
      if (L.dateMs > maxMs) maxMs = L.dateMs;
    });
  });
  if (!isFinite(minMs)) minMs = now - 4 * NET_WK;
  var last = Math.max(maxMs, now);
  var w0 = netMonday(minMs), w1 = netMonday(last);
  var weeks = [];
  for (var t = w0; t <= w1; t += NET_WK) weeks.push(t);
  if (weeks.length < 2) { weeks.push(weeks[0] + NET_WK); }
  var series = { gw: [], qf: [] }, delta = { gw: [], qf: [] }, lastN = { gw: 0, qf: 0 };
  ['gw', 'qf'].forEach(function (key) {
    var list = evs.filter(function (e) { return e.key === key; }).sort(function (a, b) { return a.ms - b.ms; });
    var cum = 0, i = 0;
    weeks.forEach(function (w) {
      var end = w + NET_WK, add = 0, items = [];
      while (i < list.length && list[i].ms < end) {
        cum += list[i].n; add += list[i].n;
        items.push(list[i]);
        i++;
      }
      series[key].push(cum);
      delta[key].push({ add: add, items: items });
    });
    lastN[key] = cum;
  });
  return { mode: mode, weeks: weeks, series: series, delta: delta, lastN: lastN, now: now };
}
function netData() {
  if (!NET || NET.mode !== S.netMode) NET = netBuild();
  return NET;
}
function netInvalidate() { NET = null; }
function netAutoView() {
  var d = netData();
  var x0 = d.weeks[0], x1 = d.weeks[d.weeks.length - 1] + NET_WK;
  var hi = Math.max(S.netGw ? d.lastN.gw : 0, S.netQf ? d.lastN.qf : 0, 1);
  var top = hi * 1.10;
  netView = clampNetView({ x0: x0, x1: x1, y0: 0, y1: top, auto: hi });
}
function clampNetView(v) {
  if (!v) return v;
  var d = netData();
  var fullX = (d.weeks[d.weeks.length - 1] + NET_WK) - d.weeks[0];
  if (v.x1 - v.x0 >= fullX) { v.x0 = d.weeks[0]; v.x1 = d.weeks[d.weeks.length - 1] + NET_WK; }
  var topMost = Math.max(v.auto || 0, d.lastN.gw, d.lastN.qf, 1) * 1.35;
  if (v.y1 - v.y0 >= topMost * 1.6 || v.y1 - v.y0 >= topMost) {
    // 放到最大范围时钉住 0 下界（不会出现负的颗数）
    v.y1 = Math.min(topMost, v.y1); v.y0 = Math.max(0, v.y1 - (topMost));
    v.y0 = Math.max(0, v.y0);
  }
  if (v.x0 < d.weeks[0]) { v.x1 += d.weeks[0] - v.x0; v.x0 = d.weeks[0]; }
  if (v.x1 > d.weeks[d.weeks.length - 1] + NET_WK) { v.x0 -= v.x1 - (d.weeks[d.weeks.length - 1] + NET_WK); v.x1 = d.weeks[d.weeks.length - 1] + NET_WK; }
  if (v.x0 < d.weeks[0]) { v.x0 = d.weeks[0]; }
  if (v.y0 < 0) { v.y1 += -v.y0; v.y0 = 0; }
  if (v.y1 > topMost) { v.y0 -= v.y1 - topMost; v.y1 = topMost; if (v.y0 < 0) { v.y1 -= v.y0; v.y0 = 0; } }
  if (v.y1 - v.y0 < 4) { v.y1 = v.y0 + 4; }
  return v;
}
// 日期标签：2025-12-29 → 25/12/29（窄屏只留 MM-DD 由调用方决定）
function netDateLabel(ms) {
  var d = new Date(ms);
  return pad(d.getFullYear() % 100) + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate());
}
function netColors() {
  return { gw: cssVar('--c-gw', '#ff6b6b'), qf: cssVar('--c-qf', '#4dabf7') };
}
function drawNet() {
  if (!netCv) return;
  var f = fitCanvas(netCv), ctx = f.ctx, W = f.w, H = f.h, C = themeColors();
  var narrow = window.innerWidth < 760;
  var PL = narrow ? 46 : 62, PR = narrow ? 30 : 18, PT = 16, PB = 40;
  var pw = W - PL - PR, ph = H - PT - PB;
  netRect = { PL: PL, PT: PT, pw: pw, ph: ph };
  ctx.clearRect(0, 0, W, H);
  var d = netData();
  if (!netView) netAutoView();
  var v = netView;
  var X = function (ms) { return PL + (ms - v.x0) / (v.x1 - v.x0) * pw; };
  var Y = function (n) { return PT + ph - (n - v.y0) / (v.y1 - v.y0) * ph; };
  var NC = netColors();
  var wkStep = NET_WK;

  // 网格 + 纵轴刻度
  ctx.font = '11px ' + MONO; ctx.lineWidth = 1;
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  niceTicks(v.y0, v.y1, 6).forEach(function (t) {
    var y = Y(t);
    if (y < PT - 2 || y > PT + ph + 2) return;
    if (t < 0) return;
    ctx.strokeStyle = C.gridY; ctx.beginPath(); ctx.moveTo(PL, y); ctx.lineTo(PL + pw, y); ctx.stroke();
    ctx.fillStyle = C.tick; ctx.fillText(Math.round(t), PL - 8, y);
  });
  // 横轴刻度：**随缩放自适应**（V1.9.0 需求16 根治）。
  //   旧版是 `stride = round((nWeeks-1)/tcount)` 的固定步长、tcount 固定 4/6 —— 于是无论怎么放大，
  //   横轴永远只有那 6 条刻度（纵轴用 niceTicks 会随缩放变细，两者观感不一致）。
  //   现在按**当前可视时间跨度**从"档位梯"里挑步长（1/2/3 天 → 周 → 双周 → 4 周 → 季 → 半年 → 年 …），
  //   并保证**至少 3 个刻度**（避免放大后只剩孤零零一条）；刻度对齐到步长边界（如整周、整月起点）。
  var spanD = (v.x1 - v.x0) / 86400000;
  var nWeeks = d.weeks.length;          // 下方"年初分隔线"那一段仍要用到它（别删）
  var LADDER = [1, 2, 3, 7, 14, 28, 56, 91, 182, 365, 730, 1825];
  // ⚠️ 搜索方向必须是**从粗到细**：取"仍能满足目标刻度数的最小步长"。
  //   上一版我写成从细到粗（`spanD / LADDER[li] >= 3` 就 break）→ 一上来就命中 1 天，
  //   于是最大尺度下几百条刻度糊成一片灰（用户当场看到的现象）。现在按目标刻度数挑，
  //   与倾角分布章的 niceTicks 同一种思路：任何缩放档位下都是大约 4–6 条刻度，
  //   放大 → 自动换到更细的档，缩小 → 自动换回更粗的档。
  var want = narrow ? 4 : 6;
  var stepD = LADDER[LADDER.length - 1];
  for (var li = LADDER.length - 1; li >= 0; li--) {
    if (spanD / LADDER[li] >= want) { stepD = LADDER[li]; break; }
  }
  var stepMs = stepD * 86400000;
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (var tm = Math.ceil(v.x0 / stepMs) * stepMs; tm <= v.x1; tm += stepMs) {
    var x = X(tm);
    if (x < PL - 2 || x > PL + pw + 2) continue;
    ctx.strokeStyle = C.gridX; ctx.beginPath(); ctx.moveTo(x, PT); ctx.lineTo(x, PT + ph); ctx.stroke();
    ctx.fillStyle = C.tick;
    ctx.fillText(netDateLabel(tm), x, PT + ph + 9);
  }
  ctx.save();
  for (var j = 0; j < nWeeks; j++) {
    var wj = d.weeks[j];
    var dj = new Date(wj);
    if (dj.getMonth() === 0 && dj.getDate() <= 7 && j > 0) {
      var xy = X(wj);
      if (xy >= PL && xy <= PL + pw) {
        ctx.setLineDash([4, 4]); ctx.strokeStyle = C.dim; ctx.globalAlpha = 0.7;
        ctx.beginPath(); ctx.moveTo(xy, PT); ctx.lineTo(xy, PT + ph); ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 1;
        ctx.fillStyle = C.dim; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText(String(dj.getFullYear()), xy + 3, PT + 3);
      }
    }
  }
  ctx.restore();
  // 轴
  ctx.strokeStyle = C.dim; ctx.beginPath();
  ctx.moveTo(PL, PT); ctx.lineTo(PL, PT + ph); ctx.lineTo(PL + pw, PT + ph); ctx.stroke();
  ctx.save();
  ctx.translate(13, PT + ph / 2); ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = C.dim; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '10px ' + MONO;
  ctx.fillText(t(S.netMode === 'orbit' ? 'nm_unit_orbit' : 'nm_unit_launch'), 0, 0);
  ctx.restore();
  ctx.font = '10px ' + MONO; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillStyle = C.dim;
  // V1.9.0（小修改）：横轴标题由「日期（按周）」改为**「日期」** —— 刻度现在随缩放自适应
  //   （可能是天/周/月/季），再写「（按周）」就不准了。（d_week_unit 这个键随之删除。）
  ctx.fillText(t('d_x_date'), PL + pw / 2, PT + ph + 24);

  // 曲线：V1.8.0（需求17 / ⑱）同样裁剪到绘图区 —— 端点数值标签也不会跑到坐标线外
  ctx.save();
  ctx.beginPath(); ctx.rect(PL, PT, pw, ph); ctx.clip();
  ['gw', 'qf'].forEach(function (key) {
    if (!(key === 'gw' ? S.netGw : S.netQf)) return;
    var arr = d.series[key], col = NC[key];
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    ctx.beginPath();
    for (var k = 0; k < arr.length; k++) {
      var px = X(d.weeks[k] + NET_WK / 2), py = Y(arr[k]);
      if (k === 0) ctx.moveTo(X(d.weeks[k]), py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
    // 周节点：点太密时只画最后一个 + 悬停那个
    var sparse = arr.length <= 90;
    for (var m = 0; m < arr.length; m++) {
      if (!sparse && m !== arr.length - 1 && m !== netHoverIdx) continue;
      if (arr[m] === 0 && m < arr.length - 1 && !sparse) continue;
      ctx.beginPath(); ctx.arc(X(d.weeks[m] + NET_WK / 2), Y(arr[m]), m === netHoverIdx ? 4 : 2.2, 0, 6.2832);
      ctx.fillStyle = col; ctx.fill();
    }
    // 末端数值
    var li = arr.length - 1;
    ctx.font = '11px ' + MONO; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
    ctx.fillStyle = col;
    ctx.fillText(String(arr[li]), X(d.weeks[li] + NET_WK / 2) - 4, Y(arr[li]) - 4);
  });
  ctx.restore();

  // 悬停十字
  if (netHoverIdx != null && d.weeks[netHoverIdx] != null) {
    var hx = X(d.weeks[netHoverIdx] + NET_WK / 2);
    if (hx >= PL && hx <= PL + pw) {
      ctx.save();
      ctx.strokeStyle = C.dim; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(hx, PT); ctx.lineTo(hx, PT + ph); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }
  // 底部图例（画在画布外的 DOM 里，见 netNote）
  var note = document.getElementById('netNote');
  if (note) {
    var keys = [];
    if (S.netGw) keys.push('<span class="net-key"><i style="background:' + NC.gw + '"></i>' + t('n_gw') + ' ' + d.lastN.gw + '</span>');
    if (S.netQf) keys.push('<span class="net-key"><i style="background:' + NC.qf + '"></i>' + t('n_qf') + ' ' + d.lastN.qf + '</span>');
    note.innerHTML = keys.join('') + '<span class="net-key">' + t('d_net_span') + ' ' + netDateLabel(d.weeks[0]) + ' – ' + netDateLabel(d.now) + '</span>';
  }
}
function netWeekAt(mx) {
  if (!netRect || !netView) return null;
  var d = netData(), v = netView, r = netRect;
  var ms = v.x0 + (mx - r.PL) / r.pw * (v.x1 - v.x0) - NET_WK / 2;
  var best = -1, bd = Infinity;
  for (var i = 0; i < d.weeks.length; i++) {
    var dd = Math.abs(d.weeks[i] - ms);
    if (dd < bd && d.weeks[i] + NET_WK > v.x0 && d.weeks[i] < v.x1) { bd = dd; best = i; }
  }
  return best >= 0 ? best : null;
}
function netShowInfoAt(i) {
  if (i == null || !netInfo) return;
  var d = netData();
  var w = d.weeks[i];
  if (w == null) return;
  var en = LANG === 'en';
  var endStr = netDateLabel(w + NET_WK - 86400000);
  var rows = ['<div class="si-row"><span>' + t('d_net_week') + '</span><span>' + netDateLabel(w) + ' – ' + endStr + '</span></div>'];
  // V1.9.0（需求8）：**固定顺序 = 该周 → 星网 → 千帆 → 新增卫星**。
  //   旧版把「新增批次」写在 forEach 循环体内，于是星网那一格的新增批次正好夹在星网行与千帆行**中间**
  //   （用户看到的"新增卫星跑到星网行和千帆行中间去了"）。现在拆成两趟：先两行累计，再一整块新增卫星。
  var ddOf = {};
  ['gw', 'qf'].forEach(function (key) {
    var dd = d.delta[key][i] || { add: 0, items: [] };
    ddOf[key] = dd;
    if (!(key === 'gw' ? S.netGw : S.netQf)) return;
    rows.push('<div class="si-row"><span>' + t(key === 'gw' ? 'n_gw' : 'n_qf') + '</span><span>' +
      (d.series[key][i] || 0) + (en ? ' cum.' : ' 累计') + (dd.add ? (en ? ' (+' : '（+') + dd.add + (en ? ')' : '）') : '') + '</span></div>');
  });
  // 「新增卫星」：**星网一行 / 千帆一行，上下两部分**；某一行过长时由它自己换行（不挤到另一行去）。
  //   批次/组名染该星座的主题色 + 下划线 + 可点击（点击 = 全选该批次）；**「×N」不染色不下划线**。
  var addLines = [];
  ['gw', 'qf'].forEach(function (key) {
    if (!(key === 'gw' ? S.netGw : S.netQf)) return;
    var dd = ddOf[key];
    if (!dd.items.length) return;
    var sep = en ? ', ' : '、';
    addLines.push('<div class="net-add-line">' + dd.items.map(function (e) {
      return '<a class="batch-link net-add-' + key + '" data-lk="' + e.lk + '" href="javascript:void(0)" title="' + t('d_sel_group') + '">' +
        batchName(e.name) + '</a><span class="net-add-n">×' + e.n + '</span>';
    }).join(sep) + '</div>');
  });
  if (addLines.length) {
    rows.push('<div class="si-row net-add"><span class="net-add-lbl">' + t('d_net_batches') + '</span>' +
      '<div class="net-add-body">' + addLines.join('') + '</div></div>');
  }
  // V1.9.0（需求7）：**这是 04 章信息窗"看起来是透的"的根因** —— 前三章的内容都由 satBlock() 包在
  //   `.si-block` 里（不透明底 --info-bg + 1px 边框 + 内边距），而这一章原先把 si-row 直接塞进
  //   `.si-body`，压根没有那一层。补上 .si-block 后，它与前三章的不透明背景、边框、拖动时的主题色
  //   边框（.sat-info.moving .si-body）以及右上角 ✕ 就完全一致了。
  showInfo(netInfo, 'net', '<div class="si-block">' + rows.join('') + '</div>', 'net-' + i);
  var el = document.getElementById('netCv');
  if (el) placeInfoCorner(netInfo, 'net');
  netHoverIdx = i;
}
function netHit(x, y) {
  var i = netWeekAt(x);
  return i;
}
function syncNetControls() {
  document.querySelectorAll('#netModeSeg button').forEach(function (b) {
    b.classList.toggle('on', b.getAttribute('data-netmode') === S.netMode);
  });
  document.querySelectorAll('#netShowSeg button').forEach(function (b) {
    var k = b.getAttribute('data-net');
    b.classList.toggle('on', k === 'gw' ? S.netGw : S.netQf);
    b.setAttribute('aria-pressed', String(k === 'gw' ? S.netGw : S.netQf));
  });
}
function netSetMode(m) {
  S.netMode = m;
  syncNetControls();
  netAutoView(); drawNet();
  touchPrefs();
}
function zoomNetAt(fx, fy, factor) {
  var v = netView, r = netRect;
  if (!v || !r) return;
  var px = v.x0 + (fx - r.PL) / r.pw * (v.x1 - v.x0);
  var py = v.y0 + (r.PT + r.ph - fy) / r.ph * (v.y1 - v.y0);
  v.x0 = px - (px - v.x0) / factor; v.x1 = px + (v.x1 - px) / factor;
  v.y0 = py - (py - v.y0) / factor; v.y1 = py + (v.y1 - py) / factor;
  clampNetView(v);
  drawNet();
}
function zoomNetBy(factor) {
  var r = netRect;
  if (!r) return;
  zoomNetAt(r.PL + r.pw / 2, r.PT + r.ph / 2, factor);
}
function netInit() {
  if (!netCv) return;
  netAutoView();
  drawNet();
  var segM = document.getElementById('netModeSeg');
  if (segM) segM.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-netmode]');
    if (!b) return;
    netSetMode(b.getAttribute('data-netmode'));
  });
  var segS = document.getElementById('netShowSeg');
  if (segS) segS.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-net]');
    if (!b) return;
    if (b.getAttribute('data-net') === 'gw') S.netGw = !S.netGw; else S.netQf = !S.netQf;
    if (!S.netGw && !S.netQf) { S.netGw = S.netQf = true; }     // 两条都关掉没有意义 → 至少留一条
    syncNetControls();
    netView = null; netAutoView(); drawNet();
    touchPrefs();
    syncSectionResetBtns();
  });
  // V1.8.0（需求8）：＋/− 与「恢复原始比例」不再在此绑定 —— 已统一改用
  //   .view-ctl button[data-zoom|data-reset] 的通用处理器（见 resetView / 画布控件一节），
  //   与地图/轨道/倾角分布三张图共享同一份逻辑与同一条 smoothZoom 曲线。
  // V1.9.0（修复问题2）：补两件缺的东西 ——
  //   ① **信息窗固定**：`netPinned`。旧版 mouseleave 无条件 hideInfo，于是点一下之后鼠标一移开
  //      （或者想去拖动它时）窗口就没了 —— 表现出来就是"点不住、更拖不了"。现在点击 = 固定，
  //      点空白处才取消固定并收起。
  //   ② **鼠标拖动平移**：原先只有滚轮缩放 + 触摸的 touchZoom，鼠标按着拖**没有任何反应**。
  var netDrag = null, netDragMoved = false;
  netCv.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'touch') return;              // 触摸走 touchZoom，别抢
    netDrag = { x: e.clientX, y: e.clientY };
    netDragMoved = false;
    try { netCv.setPointerCapture(e.pointerId); } catch (err) {}
  });
  netCv.addEventListener('pointermove', function (e) {
    if (!netDrag || e.pointerType === 'touch') return;
    var dx = e.clientX - netDrag.x, dy = e.clientY - netDrag.y;
    if (!netDragMoved && Math.abs(dx) + Math.abs(dy) < 3) return;   // 3px 以内不算拖，留给点击
    netDragMoved = true;
    netDrag.x = e.clientX; netDrag.y = e.clientY;
    if (!netView) netAutoView();
    var r2 = netRect; if (!r2 || !netView) return;
    netView.x0 -= dx / r2.pw * (netView.x1 - netView.x0);
    netView.x1 -= dx / r2.pw * (netView.x1 - netView.x0);
    netView.y0 += dy / r2.ph * (netView.y1 - netView.y0);
    netView.y1 += dy / r2.ph * (netView.y1 - netView.y0);
    clampNetView(netView); drawNet();
  });
  function netDragEnd() { netDrag = null; }
  netCv.addEventListener('pointerup', netDragEnd);
  netCv.addEventListener('pointercancel', netDragEnd);
  netCv.addEventListener('wheel', function (e) {
    e.preventDefault();
    var r = netCv.getBoundingClientRect();
    zoomNetAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.12 : 1 / 1.12);
  }, { passive: false });
  netCv.addEventListener('dblclick', function () { netView = null; netAutoView(); drawNet(); });
  netCv.addEventListener('mousemove', function (e) {
    var r = netCv.getBoundingClientRect();
    var i = netWeekAt(e.clientX - r.left);
    if (i !== netHoverIdx) { netHoverIdx = i; drawNet(); }
  });
  netCv.addEventListener('mouseleave', function () {
    if (netHoverIdx != null) { netHoverIdx = null; drawNet(); }
    if (netInfo && !netPinned) hideInfo(netInfo, 'net');   // V1.9.0：已固定的窗口不再被移开鼠标收走
  });
  netCv.addEventListener('click', function (e) {
    if (netDragMoved) { netDragMoved = false; return; }    // 刚才那下是拖动，不当作点击
    var r = netCv.getBoundingClientRect();
    var i = netWeekAt(e.clientX - r.left);
    if (i != null) { netPinned = true; netShowInfoAt(i); }                 // 点击 = 固定
    else { netPinned = false; if (netInfo) hideInfo(netInfo, 'net'); }     // 点空白 = 取消固定
  });
  touchZoom(netCv, {
    active: function () { return true; },
    pan: function (dx, dy) {
      if (!netView) return;
      var r = netRect;
      netView.x0 -= dx / r.pw * (netView.x1 - netView.x0);
      netView.x1 -= dx / r.pw * (netView.x1 - netView.x0);
      netView.y0 += dy / r.ph * (netView.y1 - netView.y0);
      netView.y1 += dy / r.ph * (netView.y1 - netView.y0);
      clampNetView(netView); drawNet();
    },
    pinch: function (k, x, y) { zoomNetAt(x, y, k); },
    tap: function (x, y) { var i = netHit(x, y); if (i != null) netShowInfoAt(i); }
  });
}

// ============================================================================
// V1.9.0（需求17 / R17）：04 变轨情况 —— 半长轴随时间的"爬坡"曲线
// ----------------------------------------------------------------------------
// 口径说明（这一段是本章全部算法的唯一依据，改动前请先读）：
//  · 画的是**布劳威尔半长轴**（km），不是高度。半长轴不含 ±a·e 的周期性抖动，
//    是"这颗星所在轨道有多大"的干净量；高度（近地点/远地点）会随每次近地点点火而变。
//    第三章卫星表格里的「半长轴」是同一口径，两处数值可直接对照。
//  · 历史点来自构建期写入的 RAW[key].hist = { <批次key>: [ [norad, 历元ms, 半长轴km], … ] }。
//    每颗星按天去重（每天留一条）—— 升轨是月尺度过程，一天一点绰绰有余，
//    而原始历史 TLE 每颗动辄上千条，全塞进单文件会让页面膨胀到几十 MB。
//  · **升轨速度**用 ±2 天窗口的最小二乘斜率（km/天），与 Rassvet 的 ТЕМП 同一种思路。
//    最小二乘必须先把 x（毫秒时间戳）**中心化**：直接对 1.75e12 量级的 x 求和再乘 x，
//    会有 catastrophic cancellation（实测斜率误差从 3e-14 劣化到 2.9e-9），
//    中心化后 x 只有 ±1e9 量级，精度才够。
//  · 纵轴 **0~2000 km 顶格限位**（需求 Q47）：低轨星座半长轴 = 半径 + 高度 ≈ 6791 + h，
//    也就是曲线落在 7000~8900 km 这个带里；0 起画会把所有细节压成一条贴底的直线。
//    真正的"离地高度"由纵轴刻度减去 6791 得到，本章不额外画第二条轴。
//  · 没有历史数据的批次/卫星会在下方说明里点名（见 renderClimbNote），不静默空白。
// ============================================================================
var climbCv = document.getElementById('climbCv');
var climbInfo = document.getElementById('climbInfo');
var climbInfoB = document.getElementById('climbInfoB');
var climbRect = null, climbView = null, CLIMB = null;
var climbHover = null;                 // 悬停的 { key, idx }（批次级）或 { norad }
var climbPinned = false;
// 05 章只有两个状态字段，且都按星座各存一份（与 04 章的 netGw/netQf 同理）
var CLIMB_DEF = { pick: '', take: 'sma' };
// 半长轴常量：地球赤道半径 6378.137 km，与第三章表格里 hp/ha 的算法一致
var CLIMB_RE = 6378.137;

// ---------------------------------------------------------------- 历史数据 → 曲线
/** 取本星座的历史点：{ 批次key: [ [norad, ms, sma], … ] }；没有则空对象 */
function climbRaw() {
  var c = RAW[S.key];
  return (c && c.hist && typeof c.hist === 'object') ? c.hist : {};
}
/** 最小二乘斜率（x 已中心化）—— 返回 km/天 */
function climbSlope(pts) {
  var n = pts.length;
  if (n < 2) return null;
  // 第一遍：求 x̄（毫秒差，用相对首点的偏移，避免大数相减）
  var t0 = pts[0].ms, sx = 0, i;
  for (i = 0; i < n; i++) sx += (pts[i].ms - t0);
  var xm = sx / n;                       // 相对毫秒的均值（量级 ~1e9，平方 ~1e18，仍在双精度安全区）
  var sxy = 0, sxx = 0, ym = 0;
  for (i = 0; i < n; i++) ym += pts[i].v;
  ym /= n;
  for (i = 0; i < n; i++) {
    var dx = (pts[i].ms - t0) - xm;      // ← 中心化：这一步是精度的全部关键
    sxy += dx * (pts[i].v - ym);
    sxx += dx * dx;
  }
  if (!(sxx > 0)) return null;
  var k = sxy / sxx * 86400000;          // 每毫秒 → 每天
  return isFinite(k) ? k : null;
}
/** ±half 天窗口的逐点升轨速度；点数不足或窗口外无点的返回 null */
function climbRates(pts, half, minPts) {
  half = half || 2; minPts = minPts || 2;
  var H = half * 86400000, out = new Array(pts.length);
  for (var i = 0; i < pts.length; i++) {
    var lo = pts[i].ms - H, hi = pts[i].ms + H, win = [];
    for (var j = i; j >= 0 && pts[j].ms >= lo; j--) win.push(pts[j]);
    for (j = i + 1; j < pts.length && pts[j].ms <= hi; j++) win.push(pts[j]);
    out[i] = win.length >= minPts ? climbSlope(win) : null;
  }
  return out;
}
/** 断档断开：相邻有效速度之间若隔了 > maxGapDays 天，就不连线（避免把一段空白画成直线） */
function climbBreakGaps(series, maxGapDays) {
  maxGapDays = maxGapDays || 2;
  var G = maxGapDays * 86400000, segs = [], curSeg = [], prevMs = null;
  for (var i = 0; i < series.length; i++) {
    var r = series[i];
    if (!r || !isFinite(r.rate)) { prevMs = null; continue; }
    if (prevMs != null && r.ms - prevMs > G) { if (curSeg.length) segs.push(curSeg); curSeg = []; }
    curSeg.push(r); prevMs = r.ms;
  }
  if (curSeg.length) segs.push(curSeg);
  return segs;
}
/** 构建曲线缓存：{ 批次key: [ { norad, name, pts:[{ms,v}], rates:[{ms,rate}] } ] } */
function climbBuild() {
  if (CLIMB && CLIMB.key === S.key) return CLIMB.data;
  var raw = climbRaw(), out = {};
  Object.keys(raw).forEach(function (lk) {
    var bySat = {}, list = raw[lk];
    if (!Array.isArray(list)) return;
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!r || r.length < 3) continue;
      var norad = r[0] | 0, ms = +r[1], v = +r[2];
      if (!norad || !isFinite(ms) || !isFinite(v)) continue;
      (bySat[norad] || (bySat[norad] = [])).push({ ms: ms, v: v });
    }
    var arr = [];
    Object.keys(bySat).forEach(function (nk) {
      var pts = bySat[nk].sort(function (a, b) { return a.ms - b.ms; });
      if (pts.length < 2) return;                    // 只有一个点画不出"变化"，跳过
      arr.push({ norad: +nk, pts: pts, rates: climbRates(pts, 2, 2) });
    });
    if (arr.length) out[lk] = arr;
  });
  CLIMB = { key: S.key, data: out };
  return out;
}
function climbCurve() { return climbBuild(); }
/** 该批次在本星座里的显示名与发射时间（找不到就退化） */
function climbBatchMeta(lk) {
  var L = null;
  try {
    var ls = cur().launches || [];
    for (var i = 0; i < ls.length; i++) if (ls[i].key === lk) { L = ls[i]; break; }
  } catch (e) {}
  return L || { key: lk, name: lk, dateMs: 0, sats: [] };
}
/** 卫星在表里的下标（找不到 -1），用于选中联动 */
function climbSatIdx(norad) {
  try {
    var ss = cur().sats;
    for (var i = 0; i < ss.length; i++) if ((ss[i].norad | 0) === (norad | 0)) return i;
  } catch (e) {}
  return -1;
}
// 纵轴：半长轴模式固定 0~2000 km 的**高度带**（即半长轴 6791~8791），
//   升轨速度模式按当前批次速度的极值取景（速度没有绝对锚点，只能自适应）。
var CLIMB_TOP = 2000;
function climbBounds(list, take) {
  if (take === 'rate') {
    var mn = Infinity, mx = -Infinity;
    list.forEach(function (c) {
      c.rates.forEach(function (r) {
        if (!r || !isFinite(r.rate)) return;
        if (r.rate < mn) mn = r.rate;
        if (r.rate > mx) mx = r.rate;
      });
    });
    if (!isFinite(mn)) { mn = -1; mx = 1; }
    if (mx - mn < 0.4) { var mid = (mx + mn) / 2; mn = mid - 0.2; mx = mid + 0.2; }
    var padv = (mx - mn) * 0.12;                   // 上下各留 12% 余量，曲线不贴边
    return { y0: mn - padv, y1: mx + padv, fixed: false };
  }
  // 半长轴：0~2000 km 顶格限位（需求 Q47）。但若真有曲线超出 2000（异常高轨），
  //   也不能把曲线裁掉 —— 此时才放宽，且至少留到数据最大值。
  var top = CLIMB_TOP;
  list.forEach(function (c) {
    c.pts.forEach(function (p) {
      var alt = p.v - CLIMB_RE;
      if (alt > top) top = alt;
    });
  });
  return { y0: 0, y1: Math.max(CLIMB_TOP, top * 1.05), fixed: true };
}
/** 当前选中要画的曲线列表：批次（含全部成员星） */
function climbSeries() {
  var C = climbCurve(), pick = S.climbPick || '';
  if (pick && pick.indexOf('b:') === 0) {
    var lk = pick.slice(2);
    return { lk: lk, list: C[lk] || [] };
  }
  if (pick && pick.indexOf('s:') === 0) {
    var n = +pick.slice(2), all = [];
    Object.keys(C).forEach(function (k) {
      C[k].forEach(function (c) { if (c.norad === n) all.push(c); });
    });
    return { lk: '', list: all, single: n };
  }
  // 未选 = 跟随全局选中；有选中就画选中的那些，没有就画全部（首个批次太多时只画第一个）
  if (S.sel && S.sel.length) {
    var want = {}, any = false;
    S.sel.forEach(function (i) {
      var s = cur().sats[i]; if (!s) return;
      Object.keys(C).forEach(function (k) {
        C[k].forEach(function (c) { if (c.norad === (s.norad | 0)) { want[k] = 1; any = true; } });
      });
    });
    if (any) {
      var l2 = [];
      Object.keys(C).forEach(function (k) { if (want[k]) l2 = l2.concat(C[k]); });
      return { lk: '', list: l2, follow: true };
    }
  }
  var keys = Object.keys(C);
  if (!keys.length) {
    // 曲线缓存为空（数据还没拉到），但**索引里可能已经有批次** → 返回最新批次 key，
    //   让上层据此触发按需拉取（否则永远停在"暂无数据"，见 loadHistoryJson 的同一处说明）。
    var ixb = HIST_IDX[S.key];
    if (ixb && ixb.batches && ixb.batches.length) return { lk: String(ixb.batches[0].k), list: [] };
    return { lk: '', list: [] };
  }
  // 默认：最新批次（发射时间最大者）
  var best = keys[0], bestMs = -Infinity;
  keys.forEach(function (k) {
    var ms = climbBatchMeta(k).dateMs || 0;
    if (ms > bestMs) { bestMs = ms; best = k; }
  });
  return { lk: best, list: C[best] };
}
function climbAutoView() {
  var s = climbSeries(), d = s.list;
  if (!d.length) { climbView = null; return; }
  var t0 = Infinity, t1 = 0, b = climbBounds(d, S.climbTake);
  d.forEach(function (c) {
    c.pts.forEach(function (p) {
      if (p.ms < t0) t0 = p.ms;
      if (p.ms > t1) t1 = p.ms;
    });
  });
  if (!isFinite(t0)) { climbView = null; return; }
  if (t1 <= t0) t1 = t0 + 86400000 * 7;
  // 横轴右端至少到"今天"（需求 Q45：发射日～今天），否则新发射的批次看不到"现在在哪"
  var now = Date.now();
  if (now > t1) t1 = now;
  if (now - t0 < 3 * 86400000) t0 = t1 - 3 * 86400000;
  climbView = { x0: t0 - (t1 - t0) * 0.02, x1: t1 + (t1 - t0) * 0.02, y0: b.y0, y1: b.y1 };
}
function clampClimbView(v) {
  if (!v) return v;
  var s = climbSeries(), d = s.list;
  if (!d.length) return v;
  var b = climbBounds(d, S.climbTake);
  if (b.fixed) { v.y0 = b.y0; v.y1 = b.y1; }      // 半长轴是顶格限位，纵向不允许缩放
  var t0 = Infinity, t1 = 0;
  d.forEach(function (c) { c.pts.forEach(function (p) { if (p.ms < t0) t0 = p.ms; if (p.ms > t1) t1 = p.ms; }); });
  if (!isFinite(t0)) return v;
  if (v.x1 <= v.x0) v.x1 = v.x0 + 86400000;
  var minSpan = 86400000 * 2, maxSpan = Math.max((t1 - t0) * 1.6, minSpan * 4);
  if (v.x1 - v.x0 < minSpan) { var c0 = (v.x0 + v.x1) / 2; v.x0 = c0 - minSpan / 2; v.x1 = c0 + minSpan / 2; }
  if (v.x1 - v.x0 > maxSpan) { var c1 = (v.x0 + v.x1) / 2; v.x0 = c1 - maxSpan / 2; v.x1 = c1 + maxSpan / 2; }
  if (v.x0 < t0) { v.x1 += t0 - v.x0; v.x0 = t0; }
  if (v.x1 > t1) { v.x0 -= v.x1 - t1; v.x1 = t1; }
  if (v.x0 < t0) v.x0 = t0;
  if (v.x1 <= v.x0) v.x1 = v.x0 + 86400000;
  if (!b.fixed && v.y1 - v.y0 < 1e-6) v.y1 = v.y0 + 1;
  return v;
}
function zoomClimbAt(mx, my, factor) {
  var v = climbView; if (!v || !climbRect) return;
  var r = climbRect;
  var fx = Math.max(0, Math.min(1, (mx - r.PL) / r.pw));
  var fy = Math.max(0, Math.min(1, (my - r.PT) / r.ph));
  var kx = 1 / factor;
  v.x0 = v.x0 + (v.x1 - v.x0) * fx * (1 - kx);
  v.x1 = v.x0 + (v.x1 - v.x0) * kx;
  if (S.climbTake !== 'rate') {
    // 半长轴纵向锁死（顶格限位），只有升轨速度模式允许纵向缩放
  } else {
    var ky = 1 / factor;
    v.y0 = v.y0 + (v.y1 - v.y0) * fy * (1 - ky);
    v.y1 = v.y0 + (v.y1 - v.y0) * ky;
  }
  clampClimbView(v); drawClimb();
}
function zoomClimbBy(f) {
  var r = climbRect; if (!r) return;
  zoomClimbAt(r.PL + r.pw / 2, r.PT + r.ph / 2, f);
}

// ---------------------------------------------------------------- 画布
var CLIMB_DAY = 86400000;
function climbDateLabel(ms) {
  var d = new Date(ms);
  return pad(d.getFullYear() % 100) + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate());
}
function climbColors() {
  var base = cssVar(S.key === 'qf' ? '--c-qf' : '--c-gw', '#4dabf7');
  return { main: base };
}
/** 纵轴标签：半长轴模式画"离地高度 km"（半长轴 − 6378.137），这才是读者能直接理解的量 */
function climbYLabel(take, v) {
  if (take === 'rate') return fmtNum(v, 2);
  return fmtNum(v, 0);
}
function drawClimb() {
  if (!climbCv) return;
  var f = fitCanvas(climbCv), ctx = f.ctx, W = f.w, H = f.h, C = themeColors();
  var narrow = window.innerWidth < 760;
  var PL = narrow ? 50 : 66, PR = narrow ? 34 : 20, PT = 16, PB = 40;
  var pw = W - PL - PR, ph = H - PT - PB;
  climbRect = { PL: PL, PT: PT, pw: pw, ph: ph };
  ctx.clearRect(0, 0, W, H);
  var s = climbSeries(), d = s.list;
  if (!d.length) {
    ctx.fillStyle = C.dim; ctx.font = '12px ' + MONO;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(t('climb_none'), PL + pw / 2, PT + ph / 2);
    renderClimbNote();
    return;
  }
  if (!climbView) climbAutoView();
  var v = clampClimbView(climbView);
  var take = S.climbTake || 'sma';
  var X = function (ms) { return PL + (ms - v.x0) / (v.x1 - v.x0) * pw; };
  var Y = function (val) { return PT + ph - (val - v.y0) / (v.y1 - v.y0) * ph; };
  var COL = climbColors();

  // ---- 网格 + 纵轴刻度（半长轴模式画"离地高度"，读数直观）
  ctx.font = '11px ' + MONO; ctx.lineWidth = 1;
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  niceTicks(v.y0, v.y1, 6).forEach(function (tk) {
    var y = Y(tk);
    if (y < PT - 2 || y > PT + ph + 2) return;
    var zero = Math.abs(tk) < 1e-9;
    ctx.strokeStyle = zero ? C.dim : C.gridY;
    ctx.beginPath(); ctx.moveTo(PL, y); ctx.lineTo(PL + pw, y); ctx.stroke();
    ctx.fillStyle = C.tick; ctx.fillText(climbYLabel(take, tk), PL - 8, y);
  });
  // ---- 横轴刻度：从粗到细按目标刻度数挑（与 04 章同一套档位梯，任何缩放档位都是 4~6 条）
  var spanD = (v.x1 - v.x0) / CLIMB_DAY;
  var LADDER = [1, 2, 3, 7, 14, 28, 56, 91, 182, 365, 730, 1825];
  var want = narrow ? 4 : 6;
  var stepD = LADDER[LADDER.length - 1];
  for (var li = LADDER.length - 1; li >= 0; li--) {
    if (spanD / LADDER[li] >= want) { stepD = LADDER[li]; break; }
  }
  var stepMs = stepD * CLIMB_DAY;
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (var tm = Math.ceil(v.x0 / stepMs) * stepMs; tm <= v.x1; tm += stepMs) {
    var x = X(tm);
    if (x < PL - 2 || x > PL + pw + 2) continue;
    ctx.strokeStyle = C.gridX; ctx.beginPath(); ctx.moveTo(x, PT); ctx.lineTo(x, PT + ph); ctx.stroke();
    ctx.fillStyle = C.tick; ctx.fillText(climbDateLabel(tm), x, PT + ph + 9);
  }
  // 轴
  ctx.strokeStyle = C.dim; ctx.beginPath();
  ctx.moveTo(PL, PT); ctx.lineTo(PL, PT + ph); ctx.lineTo(PL + pw, PT + ph); ctx.stroke();
  ctx.save();
  ctx.translate(14, PT + ph / 2); ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = C.dim; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '10px ' + MONO;
  ctx.fillText(take === 'rate' ? t('climb_y_rate') : t('climb_y_alt'), 0, 0);
  ctx.restore();
  ctx.font = '10px ' + MONO; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillStyle = C.dim;
  ctx.fillText(t('d_x_date'), PL + pw / 2, PT + ph + 24);

  // ---- 曲线
  ctx.save();
  ctx.beginPath(); ctx.rect(PL, PT, pw, ph); ctx.clip();
  var selNor = {};
  if (S.sel && S.sel.length) S.sel.forEach(function (i) { var x2 = cur().sats[i]; if (x2) selNor[x2.norad | 0] = 1; });
  var hovNor = (climbHover && climbHover.norad) ? climbHover.norad : 0;
  var maxPts = 0;
  d.forEach(function (c) {
    var isSel = selNor[c.norad], isHov = hovNor === c.norad;
    // 一颗星的点通常几百个；全批次（上百颗）时只画线不画点，否则糊成一片实心
    var drawDots = d.length <= 3;
    if (take === 'rate') {
      // 升轨速度：按断档分段画（断档处不连直线）
      var segs = climbBreakGaps(c.rates.map(function (r, i) {
        return { ms: c.pts[i].ms, rate: r };
      }).filter(function (r) { return isFinite(r.rate); }), 2);
      ctx.strokeStyle = isSel || isHov ? COL.main : C.dim;
      ctx.globalAlpha = (isSel || isHov) ? 1 : 0.5;
      ctx.lineWidth = (isSel || isHov) ? 2 : 1.2;
      ctx.lineJoin = 'round';
      segs.forEach(function (seg) {
        ctx.beginPath();
        for (var i2 = 0; i2 < seg.length; i2++) {
          var px2 = X(seg[i2].ms), py2 = Y(seg[i2].rate);
          if (i2 === 0) ctx.moveTo(px2, py2); else ctx.lineTo(px2, py2);
        }
        ctx.stroke();
      });
      // y=0 参考线（升轨 vs 降轨的分界）
      if (v.y0 < 0 && v.y1 > 0) {
        ctx.globalAlpha = 0.5; ctx.strokeStyle = C.dim; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(PL, Y(0)); ctx.lineTo(PL + pw, Y(0)); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.globalAlpha = 1;
      if (isSel || isHov) {
        for (var m2 = 0; m2 < segs.length; m2++) {
          segs[m2].forEach(function (r2) {
            ctx.beginPath(); ctx.arc(X(r2.ms), Y(r2.rate), 2.2, 0, 6.2832);
            ctx.fillStyle = COL.main; ctx.fill();
          });
        }
      }
    } else {
      ctx.strokeStyle = isSel || isHov ? COL.main : C.dim;
      ctx.globalAlpha = (isSel || isHov) ? 1 : 0.45;
      ctx.lineWidth = (isSel || isHov) ? 2 : 1.1;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (var k2 = 0; k2 < c.pts.length; k2++) {
        var px3 = X(c.pts[k2].ms), py3 = Y(c.pts[k2].v - CLIMB_RE);
        if (k2 === 0) ctx.moveTo(px3, py3); else ctx.lineTo(px3, py3);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (drawDots) {
        var sparse = c.pts.length <= 200;
        for (var m3 = 0; m3 < c.pts.length; m3++) {
          if (!sparse && m3 !== c.pts.length - 1) continue;
          ctx.beginPath(); ctx.arc(X(c.pts[m3].ms), Y(c.pts[m3].v - CLIMB_RE), 1.8, 0, 6.2832);
          ctx.fillStyle = (isSel || isHov) ? COL.main : C.dim; ctx.fill();
        }
      }
    }
    // 末端数值标签：只给选中/悬停的那几颗，避免上百个标签叠成一团
    if (isSel || isHov) {
      var last = c.pts[c.pts.length - 1];
      var lv = take === 'rate' ? (function () {
        for (var z = c.rates.length - 1; z >= 0; z--) if (isFinite(c.rates[z])) return c.rates[z];
        return null;
      })() : (last.v - CLIMB_RE);
      if (lv != null) {
        ctx.font = '11px ' + MONO; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
        ctx.fillStyle = COL.main;
        ctx.fillText(fmtNum(lv, take === 'rate' ? 2 : 0), X(last.ms) - 4, Y(lv) - 4);
      }
    }
    if (c.pts.length > maxPts) maxPts = c.pts.length;
  });
  ctx.restore();

  // ---- 悬停十字
  if (climbHover && climbHover.ms != null && climbHover.norad) {
    var hx = X(climbHover.ms);
    if (hx >= PL && hx <= PL + pw) {
      ctx.save();
      ctx.strokeStyle = C.dim; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(hx, PT); ctx.lineTo(hx, PT + ph); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }
  renderClimbNote();
}
/** 图下说明：批次名 + 颗数 + 时间跨度 + 当前纵轴口径（Q54） */
function renderClimbNote() {
  var note = document.getElementById('climbNote');
  if (!note) return;
  var s = climbSeries(), d = s.list;
  if (!d.length) {
    note.innerHTML = '<span class="net-key">' + t('climb_none') + '</span>';
    return;
  }
  var t0 = Infinity, t1 = 0;
  d.forEach(function (c) { c.pts.forEach(function (p) { if (p.ms < t0) t0 = p.ms; if (p.ms > t1) t1 = p.ms; }); });
  var bits = [];
  if (s.lk) {
    var L = climbBatchMeta(s.lk);
    bits.push('<span class="net-key"><i style="background:' + climbColors().main + '"></i>' + batchName(L.name) + '</span>');
  }
  bits.push('<span class="net-key">' + t('climb_n_sats') + ' ' + d.length + '</span>');
  bits.push('<span class="net-key">' + climbDateLabel(t0) + ' – ' + climbDateLabel(t1) + '</span>');
  bits.push('<span class="net-key">' + t(S.climbTake === 'rate' ? 'climb_take_rate' : 'climb_take_sma') + '</span>');
  note.innerHTML = bits.join('');
}
/** 找出离 (mx,my) 最近的历史点 → { norad, ms, rate } */
function climbHitAt(mx, my) {
  var s = climbSeries(), d = s.list;
  if (!d.length || !climbView || !climbRect) return null;
  var r = climbRect, v = climbView;
  if (mx < r.PL - 6 || mx > r.PL + r.pw + 6 || my < r.PT - 6 || my > r.PT + r.ph + 6) return null;
  var take = S.climbTake || 'sma';
  var best = null, bd = Infinity, bestDy = Infinity;
  for (var i = 0; i < d.length; i++) {
    var c = d[i];
    var arr = take === 'rate'
      ? c.rates.map(function (rr, k) { return isFinite(rr) ? { ms: c.pts[k].ms, v: rr } : null; }).filter(Boolean)
      : c.pts.map(function (p) { return { ms: p.ms, v: p.v - CLIMB_RE }; });
    // 先按纵向距离筛掉明显不在附近的曲线（最多留 4 条候选），再比横向
    var cand = [];
    for (var j = 0; j < arr.length; j++) {
      var py = r.PT + r.ph - (arr[j].v - v.y0) / (v.y1 - v.y0) * r.ph;
      var dy = Math.abs(py - my);
      if (dy < r.ph * 0.5) cand.push({ j: j, dy: dy });
    }
    cand.sort(function (a, b) { return a.dy - b.dy; });
    if (cand.length > 4) cand.length = 4;
    for (var q = 0; q < cand.length; q++) {
      var it = arr[cand[q].j];
      var px = r.PL + (it.ms - v.x0) / (v.x1 - v.x0) * r.pw;
      var dx = Math.abs(px - mx), dd = Math.hypot(dx, cand[q].dy);
      if (dd < bd || (dd < r.ph * 0.2 && cand[q].dy < bestDy * 0.4)) { bd = dd; bestDy = cand[q].dy; best = { norad: c.norad, ms: it.ms, v: it.v }; }
    }
  }
  return best;
}
function climbShowInfoAt(h) {
  if (!h || !climbInfo) return;
  var s = climbSeries();
  var idx = climbSatIdx(h.norad);
  var sat = idx >= 0 ? cur().sats[idx] : null;
  var c = null;
  for (var i = 0; i < s.list.length; i++) if (s.list[i].norad === h.norad) { c = s.list[i]; break; }
  var take = S.climbTake || 'sma';
  // ⚠️ 键名与 01/02 章信息窗**保持一致**（d_row_batch / d_row_epoch_sat …），
  //   且值一律用 <span>（旧版信息窗的第二格就是 span，用 <b> 会与相邻行粗细不一致）。
  var rows = [];
  rows.push('<div class="si-row"><span>' + t('t_name') + '</span><span>' + (sat ? cnName(sat) : h.norad) + '</span></div>');
  rows.push('<div class="si-row"><span>NORAD</span><span>' + h.norad + '</span></div>');
  if (sat) {
    var L = sat.launch || {};
    if (L.name) rows.push('<div class="si-row"><span>' + t('d_row_batch') + '</span><span>' + batchName(L.name) + '</span></div>');
    rows.push('<div class="si-row"><span>' + t('d_row_epoch_sat') + '</span><span>' + fmtUTC(h.ms) + '</span></div>');
    if (take === 'rate') {
      // 找该时刻的速度
      var rr = null;
      if (c) for (var k = 0; k < c.rates.length; k++) if (c.pts[k].ms === h.ms && isFinite(c.rates[k])) rr = c.rates[k];
      rows.push('<div class="si-row"><span>' + t('climb_rate') + '</span><span>' +
        (rr == null ? '—' : fmtNum(rr, 3) + (LANG === 'en' ? ' km/day' : ' km/天')) + '</span></div>');
    }
    rows.push('<div class="si-row"><span>' + (take === 'rate' ? t('climb_y_alt') : t('m_sma')) + '</span><span>' +
      fmtNum(take === 'rate' ? h.v : h.v + CLIMB_RE, take === 'rate' ? 3 : 2) + ' km</span></div>');
    var hist = c ? c.pts.length : 0;
    rows.push('<div class="si-row"><span>' + t('climb_n_hist') + '</span><span>' + hist + '</span></div>');
  }
  showInfo(climbInfo, 'climb', '<div class="si-block">' + rows.join('') + '</div>', 'climb-' + h.norad + '-' + h.ms);
  var el = document.getElementById('climbCv');
  if (el) placeInfoCorner(climbInfo, 'climb');
  // B 窗（触屏/窄屏用）
  if (climbInfoB) {
    climbInfoB.innerHTML = '<div class="si-block">' + rows.join('') + '</div>';
    climbInfoB.style.display = INFO_HIDDEN.climb ? 'none' : 'flex';
  }
}

// ---------------------------------------------------------------- 选择器
function climbPickOptions() {
  var C = climbCurve(), st = cur(), out = [];
  // ★ 优先用**外挂索引**：它包含所有批次（含尚未加载的），否则选择器只会列出已加载的那几个。
  //   索引里已按"最新在前"排好（packAll 里 sort 过），与需求 Q49 一致。
  var ix = HIST_IDX[S.key];
  if (ix && ix.batches && ix.batches.length) {
    ix.batches.forEach(function (b) {
      var L = climbBatchMeta(b.k);
      var nm = (L && L.name) ? batchName(L.name) : b.k;
      out.push({ v: 'b:' + b.k, label: nm + paren(b.n) });
    });
    return out;
  }
  var ls = (st.launches || []).slice();
  // 只列出**有历史数据**的批次，且按发射时间**倒序**（需求 Q49：最新的在最上）
  ls.sort(function (a, b) { return (b.dateMs || 0) - (a.dateMs || 0); });
  ls.forEach(function (L) {
    if (!C[L.key]) return;
    out.push({ v: 'b:' + L.key, label: batchName(L.name) + paren(C[L.key].length) });
  });
  return out;
}
/** 选中批次后：若数据未加载则异步拉取，拉完重画（规模方案下这是唯一的取数时机） */
function climbEnsureAndDraw(lk) {
  if (!lk) { try { drawClimb(); } catch (e) {} return; }
  ensureHistBatch(S.key, lk).then(function () {
    try { climbView = null; climbAutoView(); renderClimbSel(); drawClimb(); } catch (e) {}
  });
}
function renderClimbSel() {
  var sel = document.getElementById('climbSel');
  if (!sel) return;
  var opts = climbPickOptions(), C = climbCurve();
  // 当前选中的批次若已无历史数据（切星座后），回落到"跟随选中"
  var cur_ = S.climbPick || '';
  var valid = (cur_ === '') || (cur_.indexOf('b:') === 0 && !!C[cur_.slice(2)]) ||
              (cur_.indexOf('s:') === 0 && climbSatIdx(+cur_.slice(2)) >= 0);
  if (!valid) S.climbPick = '';
  var html = '<option value="">' + t('climb_pick_auto') + '</option>';
  opts.forEach(function (o) { html += '<option value="' + o.v + '">' + o.label + '</option>'; });
  sel.innerHTML = html;
  sel.value = S.climbPick || '';
  // 悬停某个批次名 → 列出该批次的成员星（不改变当前选择，避免误触）
  sel.title = t('climb_sel_tip');
}
/** 全局选中变化 → 05 章跟随（需求：双向联动） */
function climbFollowSelection() {
  var sel = document.getElementById('climbSel');
  if (!sel || sel.__lock) return;
  // 若用户显式选了批次/单星，就**不**被全局选中覆盖（用户意图优先）
  if (S.climbPick) return;
  CLIMB = null;                    // 曲线内容与选中无关，缓存可留；视图要重算
  climbView = null;
  renderClimbSel();
  drawClimb();
}
function climbSelect(v) {
  S.climbPick = v || '';
  climbView = null;
  // 规模方案下批次数据是**按需拉取**的：先切过去（画面立即响应），数据到了再重画
  if (v && v.indexOf('b:') === 0) climbEnsureAndDraw(v.slice(2));
  // 选了单星 → 同步全局选中（另一个方向的联动）
  if (v && v.indexOf('s:') === 0) {
    var idx = climbSatIdx(+v.slice(2));
    if (idx >= 0) { S.sel = [idx]; S.focusIdx = idx; S.selGroup = null; afterSelection(); }
  }
  renderClimbSel();
  drawClimb();
}
function renderClimbTake() {
  var seg = document.getElementById('climbTakeSeg');
  if (!seg) return;
  seg.querySelectorAll('button[data-take]').forEach(function (b) {
    b.classList.toggle('on', b.getAttribute('data-take') === (S.climbTake || 'sma'));
  });
}
function climbInit() {
  if (!climbCv) return;
  climbAutoView();
  renderClimbSel();
  renderClimbTake();
  drawClimb();
  var seg = document.getElementById('climbTakeSeg');
  if (seg) seg.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('button[data-take]') : null;
    if (!b) return;
    var v = b.getAttribute('data-take');
    if ((S.climbTake || 'sma') === v) return;
    S.climbTake = v; climbView = null;
    renderClimbTake(); drawClimb();
    touchPrefs();
    syncSectionResetBtns();
  });
  var sel = document.getElementById('climbSel');
  if (sel) sel.addEventListener('change', function () { climbSelect(sel.value); touchPrefs(); });
  // ---- 鼠标：滚轮缩放 / 拖动平移 / 悬停读数 / 点击选中
  var drag = null;
  climbCv.addEventListener('wheel', function (e) {
    e.preventDefault();
    var r = climbCv.getBoundingClientRect();
    zoomClimbAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.18 : 1 / 1.18);
  }, { passive: false });
  climbCv.addEventListener('pointerdown', function (e) {
    if (e.pointerType !== 'mouse') return;
    var r = climbCv.getBoundingClientRect();
    drag = { x: e.clientX, y: e.clientY, moved: 0 };
    try { climbCv.setPointerCapture(e.pointerId); } catch (err) {}
  });
  climbCv.addEventListener('pointermove', function (e) {
    var r = climbCv.getBoundingClientRect();
    var mx = e.clientX - r.left, my = e.clientY - r.top;
    if (drag) {
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      if (drag.moved > TAP_SLOP && climbView) {
        var v = climbView, rc = climbRect;
        if (S.climbTake === 'rate') {
          v.y0 += dy / rc.ph * (v.y1 - v.y0);
          v.y1 += dy / rc.ph * (v.y1 - v.y0);
        }
        v.x0 -= dx / rc.pw * (v.x1 - v.x0);
        v.x1 -= dx / rc.pw * (v.x1 - v.x0);
        clampClimbView(v); drawClimb();
        drag.x = e.clientX; drag.y = e.clientY;
      }
      return;
    }
    var h = climbHitAt(mx, my);
    var same = (h && climbHover) ? (h.norad === climbHover.norad && h.ms === climbHover.ms) : !h && !climbHover;
    if (!same) {
      climbHover = h;
      if (h) climbShowInfoAt(h); else if (climbInfo && !climbPinned) hideInfo(climbInfo, 'climb');
      drawClimb();
    }
  });
  function climbUp(e) {
    if (drag && drag.moved <= TAP_SLOP) {
      var r = climbCv.getBoundingClientRect();
      var h = climbHitAt(e.clientX - r.left, e.clientY - r.top);
      if (h) {
        var idx = climbSatIdx(h.norad);
        if (idx >= 0) { toggleSel(idx, e.ctrlKey || e.metaKey); climbPinned = true; }
      }
    }
    drag = null;
  }
  climbCv.addEventListener('pointerup', climbUp);
  climbCv.addEventListener('pointercancel', function () { drag = null; });
  climbCv.addEventListener('mouseleave', function () {
    drag = null;
    if (climbHover) { climbHover = null; drawClimb(); }
    if (climbInfo && !climbPinned) hideInfo(climbInfo, 'climb');
  });
  climbCv.addEventListener('dblclick', function () { climbView = null; climbAutoView(); drawClimb(); });
  touchZoom(climbCv, {
    active: function () { return true; },
    pan: function (dx, dy) {
      if (!climbView) return;
      var rc = climbRect;
      if (S.climbTake === 'rate') {
        climbView.y0 += dy / rc.ph * (climbView.y1 - climbView.y0);
        climbView.y1 += dy / rc.ph * (climbView.y1 - climbView.y0);
      }
      climbView.x0 -= dx / rc.pw * (climbView.x1 - climbView.x0);
      climbView.x1 -= dx / rc.pw * (climbView.x1 - climbView.x0);
      clampClimbView(climbView); drawClimb();
    },
    pinch: function (k, x, y) { zoomClimbAt(x, y, k); },
    tap: function (x, y) { var h = climbHitAt(x, y); if (h) { climbShowInfoAt(h); climbPinned = true; } }
  });
}

try { initStore(); applyConstel(); } catch (e) {}
rebuild();
try { afterConstelSwap(); } catch (e) {}
BUILTIN_NORAD = noradSetNow();          // V1.4.2：先记下打包时收录的那份有哪些 NORAD 编号
// 第三行：内置快照的要素历元（联网成功后再刷新成最新的）
setLoadEpoch(t('d_epoch') + ' ' + fmtUTC(cur().epochMax) + ' UTC');
// V1.3.4：先恢复上次保存的设置（初始打开就是默认配置，此时「还原所有默认设置」暗淡不可点）
// V1.4.1：不再读取上次的设置 —— 每次打开都是默认初始状态（默认配置 + 实时时刻 + 暗色主题）。
// 会话内的改动照常生效，各章节「默认设置」按钮照常可用，只是不会跨会话沿用。
// prefSnap / PREF_DEF / PREF_SEC 仍然保留，供「默认设置」按钮还原使用。
syncAllControls();
syncResetAllBtn();
syncSectionResetBtns();       // V1.8.0（需求3）：首帧就按「是否有改动」定各章默认设置按钮的边框态
syncTimeUI();
layoutNav();
layoutPickSlot();                    // V1.7.3（需求3）：首帧布局定稿后再量一次槽高（首次 layoutNav 后字体/宽度才稳定）
try { fixPillWidths(); } catch (e) {}   // V1.7.3（需求10）：首帧补测定宽（字体就绪后再来一次，见 resize 的 250ms 补测）
updateJumpActive();
setPick(S.pick.on);
setupInfo(chartInfo, 'chart');
setupInfo(mapInfo, 'map');
setupInfo(globeInfo, 'globe');
netInit();                           // V1.8.0（需求8）：03.5 组网进度
climbInit();                         // V1.9.0（R17）：04 变轨情况
loop();

// 各章节的「默认设置」：只还原该章节那几项
// V1.9.0（需求6）：章级「默认设置」的过场 —— 与「还原所有默认设置」**同一套观感**
//   （本章内容先非线性消失 → 在半程换成已还原的设置 → 再非线性出现），但**作用域限定在本章**：
//   不动顶栏、也完全不动其他章节。章节标题与编号（.sec-head）按要求**保持不动**。
//   实现上只在动画期间给子元素挂 transition（.sf-anim），避免影响页面上其它动画。
var SF_SEC = { map: 'sec-map', globe: 'sec-orbits', chart: 'sec-chart',
  progress: 'sec-progress', climb: 'sec-climb', table: 'sec-table', launches: 'sec-launches' };
function playSectionCurtain(sec, updateFn) {
  var el = document.getElementById(SF_SEC[sec] || ('sec-' + sec));
  if (!el) { try { updateFn(); } catch (e) {} return; }
  var T = ANIM.half;
  el.classList.add('sf-anim');
  void el.offsetWidth;                 // 强制回流，保证下一帧的 opacity 变化能触发过渡
  el.classList.add('sf-out');
  setTimeout(function () {
    try { updateFn(); } catch (e) {}
    el.classList.remove('sf-out');
    setTimeout(function () { el.classList.remove('sf-anim'); }, T + 40);
  }, T);
}
document.querySelectorAll('[data-defsec]').forEach(function (b) {
  b.addEventListener('click', function () {
    var sec = b.getAttribute('data-defsec');
    playSectionCurtain(sec, function () { resetSection(sec); });
  });
});
// 「还原所有默认设置」：01–04 全部回到初始配置
// V1.9.0（需求1）：还原所有默认设置改用**通用过场**（620ms，与语言切换一模一样的顶栏上收/下拉），
//   关键点：还原发生在**遮罩全黑的那一帧**（半程回调里），所以页面内各项不会当着用户的面跳变 ——
//   用户看到的是「旧页面 → 渐暗 → 新页面直接浮现」，符合"由非线性动画分成两部分、不突兀"的要求。
document.getElementById('resetAllBtn').addEventListener('click', function () {
  playCurtain(function () { resetAllPrefs(); });
});

})();

// V1.7.0 二轮（清理）：这里原先还有一版 window.placeChartSearch（"V1.6.1 覆盖版"，
// 把搜索框 append 到控件行末尾、并把 × 搬进控件行），已被文件末尾「V1.6.1 续」的定版覆盖，
// 属于永不会执行的死代码，已删除。现存的唯一实现见下方「====== 轨道分布全屏搜索框位置（定版）」。

// ================================================================ V1.6.1 续：轨道分布全屏搜索框位置（定版）
(function () {
  var home = null;
  window.placeChartSearch = function (inFull) {
    var sec = document.getElementById('sec-chart');
    if (!sec) return;
    var wrap = sec.querySelector('.fs-search-wrap');
    var controls = sec.querySelector('.controls');
    if (!wrap || !controls) return;
    if (inFull) {
      if (!home) home = { parent: wrap.parentNode, next: wrap.nextSibling };
      // 插到 .ctl-btns（含"默认设置"）之前 —— 即"按批次"与"默认设置"之间
      var btns = controls.querySelector('.ctl-btns');
      if (btns && btns.parentNode === controls) controls.insertBefore(wrap, btns);
      else controls.appendChild(wrap);
    } else if (home && home.parent) {
      home.parent.insertBefore(wrap, home.next);
      home = null;
    }
  };
  // × 按钮保持在屏幕左上角（不再搬进控件行），仅由 CSS 对齐第一行
})();

