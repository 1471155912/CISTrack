/* 国网 / 千帆 在轨追踪 —— 全部计算在浏览器内完成（SGP4 + WGS-72） */
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
var VERSION = 'V1.4.9';          // 页脚版本号，后续更新在此改动

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
  cn_gw: ['国网', 'Guowang'], cn_qf: ['千帆', 'Qianfan'],
  cn_gw_short: ['国网', 'GW'], cn_qf_short: ['千帆', 'SS'],
  // V1.3.6：键名里插一个零宽空格作断行点 —— 窄屏固定断在「发射/卫星」「在轨/卫星」，
  // 不会再断成「发射卫/星」；两个星座共用同一套键，格式自然一致。
  kv_group: ['星座', 'Constellation'],
  // V1.3.7：这两项在中文页也是两行（在轨 / 卫星），跟英文页的排布保持一致
  kv_sats: ['在轨<br>卫星', 'Satellites<br>in orbit'],
  kv_launched: ['发射<br>卫星', 'Satellites<br>launched'],
  kv_launchok: ['发射​成功', 'Launches succeeded'],
  kv_groups: ['发射​批次', 'Launch groups'], kv_alt: ['平均轨道​高度', 'Mean orbit altitude'],
  kv_inc: ['轨道​倾角', 'Inclinations'], kv_first: ['首发​发射', 'First launch'],
  // V1.3.6：章节改名与重排 —— 01 地图 / 02 轨道 / 03 轨道分布 / 04 卫星表格 / 05 发射历史
  // V1.4.0：英文标题一律 Title Case（每个实词首字母大写）——这组键顶栏标签与页面章节标题共用
  h_map: ['地图', 'Map'], h_orbits: ['轨道', 'Orbits'], h_dist: ['轨道分布', 'Orbit Distribution'],
  h_sattable: ['卫星表格', 'Satellite Table'], h_launchhist: ['发射历史', 'Launch History'],
  // V1.3.6：三个图形章节标题右侧的小字（取代原来的缩放说明与 ＋/− 按键）
  zoomable: ['可缩放', 'Zoomable'],
  lead_chart: ['横轴是轨道倾角，纵轴是它们<b>此刻</b>的轨道高度。同一批次的卫星挤在同一条倾角线上，往上爬的是已经抬到工作高度的——一张图就能看出整个星座分布在哪些轨道面上。',
    'The X axis is orbital inclination; the Y axis is the satellites\' orbit altitude <b>right now</b>. Satellites of one group line up on the same inclination, and the ones higher up have already reached their working altitude — one chart shows which orbital planes the constellation occupies.'],
  // V1.3.6：观测点的操作步骤与「？」提示重合，只留章节本身在讲什么
  lead_map: ['星座里每一颗卫星此刻在地球上的什么位置，以及它对地面形成的可视覆盖区与前后各半圈的地面轨迹。',
    'Where every satellite of the constellation is right now, the coverage zone its signal reaches on the ground, and its ground track for half an orbit before and after now.'],
  lead_table: ['当前全部在轨卫星的轨道要素：半长轴、近地点、远地点、倾角、周期、在轨天数、轨道面升交点赤经、偏心率和轨道要素历元。默认按 NORAD 编号从大到小排列（新发射的在前），点击表头可换列或换方向；点击行选中卫星（再点一次或点空白处取消）；点击「批次」可直接选中该批次的全部卫星。',
    'Orbital elements of every in-orbit satellite: semi-major axis, perigee, apogee, inclination, period, days in orbit, RAAN, eccentricity and element epoch. Sorted by NORAD number, newest first, by default — click a header to sort by another column or reverse. Click a row to select a satellite (click again or click empty space to clear); click the group name to select the whole group.'],
  lead_launches: ['星座已发射的全部批次，含发射时间、运载火箭与发射场。标注「待编目」的批次已入轨：目录里已给出临时编号与摘要参数（周期/倾角/高度，见该行小字），但完整轨道要素尚未公开，因此不出现在图表与地图里。点击批次名即可选中该批次的全部在轨卫星（再点一次取消）。',
    'Every group launched so far, with launch time, launch vehicle and launch site. Groups marked "pending" are in orbit: the catalog already lists temporary numbers and summary parameters (period / inclination / altitude — see the small print on that row) but their full elements are not public yet, so they are absent from the chart and map. Click a group name to select all its in-orbit satellites (click again to clear).'],
  l_group: ['批次', 'Group'], l_mode: ['纵轴量', 'Y axis'], l_model: ['模型', 'Model'], l_color: ['配色', 'Colors'],
  m_sma: ['半长轴', 'SMA'], m_ha: ['远地点', 'Apogee'], m_hp: ['近地点', 'Perigee'],
  d_x_inc: ['轨道倾角', 'Inclination'],   // V1.3.6：分布图横轴标题
  md_bro: ['布劳威尔', 'Brouwer'], md_kep: ['开普勒', 'Kepler'],
  c_sat: ['按卫星', 'By satellite'], c_group: ['按批次', 'By group'],
  b_reset: ['重置视图', 'Reset view'], b_cov: ['可见倾角', 'Coverage'],
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
  notice_new_m: ['在线目录比页面内置快照多了 {n} 颗（最新 NORAD {id}），很可能又有一次发射。词条口径的统计数字不会自己更新 —— 更新 wiki.json 后刷新即可。',
    'The live catalog has {n} more satellite(s) than this page ships with (newest NORAD {id}) — likely a new launch. The article-based counts do not update themselves; refresh after updating wiki.json.'],
  notice_ok: ['知道了', 'Got it'],
  d_shot_disc: ['非官方项目，模拟基于开源 TLE 数据，不代表实际情况',
    'Unofficial project; simulation based on open TLE data, not the actual situation'],
  b_pick: ['选择地面观测点', 'Pick ground site'], b_names: ['名称', 'Names'],
  b_spin: ['自转', 'Spin'], b_tracks: ['轨道', 'Orbits'],
  // V1.3.6：按钮名精简（"显示可视锥"→"可视区域"，"显示名称"→"名称"）
  b_cone: ['可视区域', 'Coverage'],
  b_now: ['此刻', 'Now'], b_cols: ['全部列', 'All columns'],
  b_maptracks: ['显示轨道', 'Orbits'],
  b_default: ['默认设置', 'Defaults'], b_reset_all: ['还原所有默认设置', 'Restore all defaults'],
  b_readme: ['说明', 'README'],
  b_reset_all_done: ['当前已是默认设置', 'Already at defaults'],
  l_el: ['最低仰角', 'Min. elevation'], l_time: ['时间', 'Time'],
  ph_search: ['搜索卫星 / NORAD', 'Search name / NORAD'],
  t_name: ['卫星', 'Satellite'], t_launch: ['批次/组', 'Batch / Group'], t_maker: ['制造方', 'Manufacturer'], t_sma: ['半长轴, KM', 'SMA, KM'],
  t_hp: ['近地点, KM', 'Perigee, KM'], t_ha: ['远地点, KM', 'Apogee, KM'], t_inc: ['倾角, °', 'Incl., °'],
  t_period: ['周期, 分', 'Period, min'], t_raan: ['升交点, °', 'RAAN, °'], t_ecc: ['偏心率', 'Ecc.'],
  t_epoch: ['历元 (UTC)', 'Epoch (UTC)'],
  // V1.3.6：「批次」→「批次/组」，「发射场」→「发射地点」
  lt_group: ['批次/组', 'Group'],
  lt_time: ['发射时间 (北京时间)', 'Launch time (GMT+8)'], lt_rocket: ['运载火箭', 'Launch vehicle'],
  lt_site: ['发射地点', 'Launch site'], lt_inc: ['设计倾角', 'Design incl.'], lt_ele: ['轨道要素', 'Elements'],
  t_age: ['在轨日, 天', 'Days in orbit'],
  foot_data: ['轨道数据来自 NORAD 空间目标目录', 'Orbit data from the NORAD satellite catalog'],
  foot_use: ['本页素材可自由使用，注明来源即可', 'Free to use and redistribute with attribution'],
  // 动态文案
  d_epoch: ['要素历元', 'Epoch'], d_epoch2: ['更新历元：', 'Epoch: '], d_pending_suffix: ['颗待编目', 'awaiting catalog'],
  d_in_orbit: ['颗', 'in orbit'], d_more_pending: [' · 另有 ', ' · '], d_more_pending2: [' 颗待编目', ' more pending'],
  d_page_track: ['本页实时推算 ', 'This page propagates '], d_page_track2: [' 颗', ' live'],
  d_groups_stat: [' 批在轨 / 共 ', ' groups with elements / '], d_groups_total: [' 批', ' total'],
  d_groups_note: ['本页口径：只统计 CelesTrak hulianwang / qianfan 两个低轨互联网分组里的批次，比词条口径窄（不含早期试验星与国网高轨业务星）。',
    'Counted by this page: only the groups carried in the CelesTrak `hulianwang` / `qianfan` LEO internet feeds — narrower than the wiki, which also counts early test satellites and Guowang GEO service satellites.'],
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
  d_sel_all: ['全部批次（', 'All groups ('],
  d_sel_all2: [' 颗）', ')'],
  d_row_batch: ['批次', 'Group'], d_row_cat: ['目录名', 'Catalog name'],
  d_row_sub: ['星下点', 'Sub-satellite point'], d_row_alt: ['瞬时高度', 'Altitude now'],
  d_row_el: ['观测点仰角', 'Elevation at site'],
  d_row_inc: ['倾角', 'Inclination'], d_row_period: ['周期', 'Period'],
  d_row_epoch: ['历元', 'Epoch'], d_row_sma: ['半长轴', 'Semi-major axis'],
  d_row_pa: ['近地点×远地点', 'Perigee×Apogee'],
  d_latlon: ['纬度 / 经度', 'Lat / Lon'],   // V1.3.6：观测点信息窗里原先写死成英文
  d_more_sat: [' 颗', ' more'],
  d_pending_tag: ['待编目 ', 'pending ×'],
  d_pend_sum: ['目录摘要', 'catalog summary'],
  d_pend_obj: ['对象', 'objects'],
  d_row_launch: ['发射时间', 'Launched'],
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
  d_first: ['首页', 'First'], d_prev: ['上一页', 'Prev'], d_next: ['下一页', 'Next'], d_last: ['尾页', 'Last'],
  d_now_btn: ['此刻', 'Now'],
  d_title_suffix_zh: ['星座', ' constellation'],
  d_title_suffix_en: ['在轨态势', '&nbsp;live orbit status'],   // V1.3.6：窄屏隐藏换行 br 时两段不粘连
  d_satpage: ['第 ', 'Page '],
};
function t(k) { var p = I18N[k]; if (!p) return k; return LANG === 'en' ? p[1] : p[0]; }
function applyStaticLang() {
  document.querySelectorAll('[data-i18n]').forEach(function (el) { el.innerHTML = t(el.getAttribute('data-i18n')); });
  document.querySelectorAll('[data-i18n-ph]').forEach(function (el) { el.placeholder = t(el.getAttribute('data-i18n-ph')); });
  document.documentElement.setAttribute('lang', LANG === 'en' ? 'en' : 'zh-CN');
  var b = document.getElementById('langBtn');
  if (b) b.textContent = LANG === 'en' ? '中' : 'EN';
}
// 批次名的英文写法（低轨01组 → LEO Group 01 等）
function batchName(name) {
  if (LANG !== 'en') return name;
  return name.replace(/^低轨(\d+)组$/, 'LEO Group $1')
    .replace(/^极轨(\d+)组$/, 'Polar Group $1')
    .replace(/^试验星(\d+)组$/, 'Test Sat Group $1');
}
function cnName(s) {
  var n = s.name;
  if (LANG === 'en') {
    return n.replace(/^HULIANWANG DIGUI-(\d+)$/, 'Guowang LEO-$1')
      .replace(/^GUOWANG TEST OBJECT ([A-Z])$/, 'Guowang test-$1')
      .replace(/^GUOWANG (\d+) OBJECT ([A-Z])$/, 'Guowang G$1-$2')
      .replace(/^QIANFAN (\d+) OBJECT ([A-Z])$/, 'Qianfan G$1-$2')
      .replace(/^QIANFAN-(\d+)$/, 'Qianfan-$1');
  }
  return n.replace(/^HULIANWANG DIGUI-(\d+)$/, '国网低轨-$1')
    .replace(/^GUOWANG TEST OBJECT ([A-Z])$/, '国网试验-$1')
    .replace(/^GUOWANG (\d+) OBJECT ([A-Z])$/, '国网$1组$2')
    .replace(/^QIANFAN (\d+) OBJECT ([A-Z])$/, '千帆$1组$2')
    .replace(/^QIANFAN-(\d+)$/, '千帆-$1');
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
    sel: css('--sel-bg'), theme: css('--row-sel'),        // 星座主题色：国网红 / 千帆蓝
  };
  return TC;
}
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
    makers: c.makers || {}            // V1.4.2：制造方（按批次 key 索引，来自词条）
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
  sel: [],                 // 选中的卫星 idx
  focusIdx: null,          // V1.3.5：批次多选后当前「聚焦」的那颗（信息窗锁定显示它）
  hover: null,
  colorMode: { chart: 'sat', map: 'sat', globe: 'sat' },
  model: 'brouwer',
  mode: 'sma',
  launchFilter: 'all',
  timeOffset: 0,           // 分钟
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
  query: ''
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
  sortKey: 'norad', sortAsc: false, allCols: false, timeOffset: 0
};
// 「默认设置」按钮各自管哪几项（时间滑块 02/03 共用，两边都能还原）
var PREF_SEC = {
  chart: ['model', 'mode', 'launchFilter', 'cChart'],
  map: ['covOn', 'covEl', 'pickOn', 'pickEl', 'mapTrack', 'nameMap', 'cMap', 'timeOffset'],
  globe: ['coneOn', 'coneEl', 'spin', 'showTracks', 'nameGlobe', 'cGlobe', 'timeOffset'],
  table: ['sortKey', 'sortAsc', 'allCols']
};
function prefSnap() {
  return {
    model: S.model, mode: S.mode, launchFilter: S.launchFilter,
    cChart: S.colorMode.chart, cMap: S.colorMode.map, cGlobe: S.colorMode.globe,
    covOn: S.cov.on, covEl: S.cov.el, pickOn: S.pick.on, pickEl: S.pick.el,
    mapTrack: S.mapTrack, nameMap: S.names.map,
    coneOn: S.cone.on, coneEl: S.cone.el, spin: S.spin, showTracks: S.showTracks,
    nameGlobe: S.names.globe,
    sortKey: S.sortKey, sortAsc: S.sortAsc, allCols: S.allCols,
    // V1.3.6：时间滑块不落盘 —— 每次打开页面都从「现在」开始，避免上次拖到的偏移被当成当时的最新时间。
    // 它仍然留在 PREF_DEF / PREF_SEC 里，所以各章节的「默认设置」依旧能把它拨回 0。
    timeOffset: 0
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
  // V1.3.6：时间恒为「现在」。存档里若带着旧版本写入的偏移也一律忽略，
  // 保证打开页面时时间条上的时间就是最新的时刻。
  S.timeOffset = 0;
}
function prefLoad() {
  try { return JSON.parse(localStorage.getItem(PREF_KEY) || 'null'); } catch (e) { return null; }
}
function prefSave() { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefSnap())); } catch (e) {} }
function prefIsDefault() {
  var p = prefSnap();
  for (var k in PREF_DEF) if (p[k] !== PREF_DEF[k]) return false;
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
   ['globeNamesBtn', 'names.globe'], ['coneBtn', 'cone.on'], ['colsToggle', 'allCols']]
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
  setOffset(S.timeOffset);
  document.querySelectorAll('#satTable thead th').forEach(function (x) {
    x.classList.remove('sorted', 'asc');
    if (x.getAttribute('data-key') === S.sortKey) { x.classList.add('sorted'); if (S.sortAsc) x.classList.add('asc'); }
  });
  buildChartPoints();
}
function resetSection(sec) {
  var p = prefSnap();
  (PREF_SEC[sec] || []).forEach(function (k) { p[k] = PREF_DEF[k]; });
  prefApply(p);
  syncAllControls();
  chartAutoView(); drawChart(); renderLegend(); renderTable();
  mapDirty = globeDirty = true;
  touchPrefs();
}
function resetAllPrefs() {
  prefApply(Object.assign({}, PREF_DEF));
  syncAllControls();
  chartAutoView(); drawChart(); renderLegend(); renderTable();
  mapDirty = globeDirty = true;
  touchPrefs();
}
function cur() { return CONST[S.key]; }
function colOf(s, scope) {
  if (S.colorMode[scope] === 'group') return isLight() ? s.gcolorL : s.gcolor;
  return isLight() ? s.colorL : s.color;
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
function fitCanvas(cv) {
  var r = cv.getBoundingClientRect();
  var w = Math.round(r.width), h = Math.round(r.height);
  if (!(w > 20) || !(h > 20)) {
    var par = cv.parentElement;
    var pw = par ? Math.round(par.getBoundingClientRect().width) : 0;
    if (pw > 20) w = pw;
    if (!(h > 20)) h = Math.round((w > 20 ? w : 900) * (cv.id === 'map' ? 0.5 : 1));
    if (!(w > 20)) w = 900;
  }
  w = Math.max(20, w); h = Math.max(20, h);
  // V1.4.3：桌面端把采样倍率收到 1.5（像素量降约 44%，肉眼看不太出差别，但每帧填充量明显下降）；
  // 触屏设备本来就流畅，维持 2 不动。
  var dprCap = (typeof isTouch === 'function' && isTouch()) ? 2 : 1.5;
  var dpr = Math.min(window.devicePixelRatio || 1, dprCap);
  dpr = Math.max(0.5, Math.min(dpr, CANVAS_MAX_SIDE / w, CANVAS_MAX_SIDE / h));
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
  var pts = {}, last = null, moved = 0, lastDist = 0, startIn = true;
  cv.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse') return;
    // V1.4.6：起点在禁用区（地球/地图两侧空白）时，本次手势不用于平移/旋转/缩放，
    // 但【轻点选卫星】仍然有效 —— 点选是精确操作，不该被禁用区挡住（否则轨道环上
    // 超出地球切线的卫星就永远点不到了，V1.3.8 修过的老问题会回来）。
    startIn = cfg.active ? cfg.active(e.clientX, e.clientY) : true;
    pts[e.pointerId] = { x: e.clientX, y: e.clientY };
    var ids = Object.keys(pts);
    if (ids.length === 1) { moved = 0; last = { x: e.clientX, y: e.clientY }; lastDist = 0; }
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
      if (moved > 4 && cfg.pan) cfg.pan(dx, dy);
      last = { x: pts[ids[0]].x, y: pts[ids[0]].y };
    }
  });
  function up(e) {
    if (!pts[e.pointerId]) return;
    delete pts[e.pointerId];
    var ids = Object.keys(pts);
    if (!ids.length) {
      if (moved <= 4 && cfg.tap) {
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
var INFO_HIDDEN = { chart: false, map: false, globe: false };
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
      // V1.4.5：可以部分拖到屏幕以外（再选一次卫星就会重新出现），但**绝不能把页面撑宽** ——
      // 以前窗子被拖到右边界外时，body 会出现横向滚动条，顶栏时钟药丸与右下角章节药丸也跟着
      // 被推到右边。现在配合 html/body 的 overflow-x:hidden，超出部分直接被裁掉，像真的消失一样。
      var KEEP = 24, vw = window.innerWidth, vh = window.innerHeight;
      // V1.4.9：改回「留 24px 在视口内」的对称规则 —— 右侧也允许把窗子部分拉出屏幕
      //（和左侧一样），超出部分被 html/body 的 overflow-x 裁掉，页面本身绝不会被撑宽。
      var maxL = (vw - KEEP) - wrap.left;
      var minL = (KEEP - drag.w) - wrap.left;
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
function showInfo(el, key, html, idKey) {
  if (!el) return;
  var body = setupInfo(el, key);
  if (idKey !== undefined && el.__lastId !== idKey) {
    el.__lastId = idKey;
    INFO_HIDDEN[key] = false;                 // 换了目标就重新显示
    placeInfoCorner(el, key);                 // V1.3.7：换目标时才考虑挪位置，避免跟着鼠标抖
  }
  // V1.4.9：提示染当前星座的主题色（国网红 / 千帆蓝），不再固定用 --row-sel 的红
  var tipColor = S.net === 'qf' ? 'var(--c-qf)' : 'var(--c-gw)';
  body.innerHTML = html +
    '<div class="si-drag"' + (DRAGGED[key] ? ' style="display:none;color:' + tipColor + '"' : ' style="color:' + tipColor + '"') + '>' + t('d_drag_tip') + '</div>';
  el.style.display = INFO_HIDDEN[key] ? 'none' : 'flex';
}
function hideInfo(el, key) {
  if (!el) return;
  INFO_HIDDEN[key] = false;
  el.__lastId = null;
  el.style.display = 'none';
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
  chartView = { x0: x0, x1: x1, y0: yy0, y1: yy1 };
}
function chartVisiblePts() {
  if (S.launchFilter === 'all') return chartPts;
  return chartPts.filter(function (p) { return p.sat.lk === S.launchFilter; });
}
function drawChart() {
  var f = fitCanvas(chartCv), ctx = f.ctx, W = f.w, H = f.h, C = themeColors();
  var PL = 66, PR = 18, PT = 16, PB = 38;
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
        ctx.setLineDash([3, 3]); ctx.strokeStyle = C.accent; ctx.lineWidth = 1;
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
  return '<div class="si-block"><div class="si-name">' + s.name +
    '<span class="swatch" style="background:' + colOf(s, scope) + '"></span></div>' +
    '<div class="si-row"><span>' + t('d_row_batch') + '</span><span>' + batchName(L.name) + '</span></div>' +
    '<div class="si-row"><span>NORAD</span><span>' + s.norad + '</span></div>' +
    '<div class="si-row"><span>' + t('d_row_sma') + '</span><span>' + fmtNum(b ? s.smaB : s.smaK, 1) + ' km</span></div>' +
    // 最新 TLE 的近地点×远地点（两位小数）——V1.3.6 起乘号两侧不留空格，
    // 否则这一行在窄屏上会被挤成两行（用户反馈）
    '<div class="si-row"><span>' + t('d_row_pa') + '</span><span>' +
      fmtNum(b ? s.hpB : s.hpK, 2) + ' km×' + fmtNum(b ? s.haB : s.haK, 2) + ' km</span></div>' +
    '<div class="si-row"><span>' + t('d_row_inc') + '</span><span>' + fmtNum(s.inc, 2) + '°</span></div>' +
    '<div class="si-row"><span>' + t('d_row_period') + '</span><span>' + fmtNum(s.period, 3) + (LANG === 'en' ? ' min' : ' 分') + '</span></div>' +
    '<div class="si-row"><span>' + t('d_row_launch') + '</span><span>' + date +
      (days === null ? '' : ' （' + days + (LANG === 'en' ? ' d' : ' 天') + '）') + '</span></div>' +
    '<div class="si-row"><span>' + t('d_row_epoch') + '</span><span>' + fmtUTC(s.epochMs) + '</span></div>' +
    (extra || '') + '</div>';
}
function siRow(label, val) { return '<div class="si-row"><span>' + label + '</span><span>' + val + '</span></div>'; }

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
function toggleSel(idx, additive) {
  var i = S.sel.indexOf(idx);
  if (i >= 0) {
    // V1.3.5：批次多选后，点其中一颗 = 聚焦它（其余高亮与轨道都保留），点空白才整体取消
    if (S.sel.length > 1) { S.focusIdx = idx; afterSelection(); gotoSatInTable(idx); return; }
    S.sel.splice(i, 1); S.focusIdx = null;           // 只选了一颗时再点 = 取消
  } else if (additive) { S.sel.push(idx); S.focusIdx = idx; gotoSatInTable(idx); }
  else { S.sel = [idx]; S.focusIdx = idx; gotoSatInTable(idx); }
  afterSelection();
}
// V1.3.7：图 → 表联动。在图上选中一颗卫星后，表格自动翻到它所在的那一页并把它闪一下，
// 省得自己按「当前排序」去数。只翻页 + 高亮，不强行滚动页面（免得把正在看的图顶走）。
function gotoSatInTable(idx) {
  if (idx == null || !LAST_ROWS.length) return;
  var pos = -1;
  for (var i = 0; i < LAST_ROWS.length; i++) { if (LAST_ROWS[i]._s.idx === idx) { pos = i; break; } }
  if (pos < 0) return;
  var pg = Math.floor(pos / SAT_PAGE);
  if (pg !== S.tpage) { S.tpage = pg; renderTable(); }
  var tr = document.querySelector('#tbody tr[data-idx="' + idx + '"]');
  if (!tr) return;
  tr.classList.add('just-hit');
  setTimeout(function () { tr.classList.remove('just-hit'); }, 1500);
}
function clearSel() {
  if (!S.sel.length) { S.focusIdx = null; return; }
  S.sel = []; S.focusIdx = null;
  hideInfo(chartInfo, 'chart');
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
  var PX = function (lon) { return (lon + 180) / 360 * W * k + tx; };
  var PY = function (lat) { return (90 - lat) / 180 * H * k + ty; };
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
  if (S.cov.on && !pickOn) {
    for (var ci = 0; ci < st.sats.length; ci++) {
      if (hasSel && S.sel.indexOf(ci) < 0) continue;
      var g0 = states[ci]; if (!g0) continue;
      var lam0 = covLambda(g0.h, S.cov.el);
      if (lam0 <= 0.002) continue;
      var colC = colOf(st.sats[ci], 'map');
      ctx.beginPath();
      circlePath(ctx, PX, PY, g0.lat, g0.lon, lam0, 40);
      ctx.fillStyle = colC; ctx.globalAlpha = hasSel ? 0.10 : 0.05; ctx.fill();
      ctx.strokeStyle = colC; ctx.globalAlpha = hasSel ? 0.55 : 0.32; ctx.lineWidth = 1; ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
  // 轨迹：选中项最后叠加高亮；有选中或关闭「显示轨道」时不画其他卫星轨迹
  var tracks = mapTracks(ms);
  ctx.lineWidth = 1;
  function strokeTrack(si, alpha) {
    var seg = tracks[si]; if (!seg || !seg.length) return;
    ctx.globalAlpha = alpha;
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
  if (S.mapTrack && !pickOn && !hasSel) {
    for (var si = 0; si < st.sats.length; si++) strokeTrack(si, 0.3);
  }
  for (var sj = 0; sj < st.sats.length; sj++) {
    if (S.sel.indexOf(sj) >= 0) strokeTrack(sj, 0.9);
  }
  // 悬停/固定的那颗：观测点模式下其他轨迹都隐藏了，这里单独补一条，便于单星跟踪
  if (mapHover !== null && S.sel.indexOf(mapHover) < 0 && (pickOn || hasSel)) strokeTrack(mapHover, 0.75);
  // 卫星
  var labels = [];
  // V1.3.4：先给观测点那三行文字量好位置并占位，卫星标注会主动绕开它
  var siteLabel = null;
  if (pickOn) {
    var site0 = pickFixed ? S.pick
      : (S.pick.mx !== null ? { lat: my2lat(S.pick.my), lon: mx2lon(S.pick.mx) } : null);
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
    var showLabel = sel2 || mapHover === m || visHi || (S.names.map && !pickOn && !hasSel);
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
        ctx.fillStyle = C.fg; ctx.fillText(lb, best2[0], best2[1] + 6);
      }
    }
  }
  // 观测点（跟随鼠标 / 固定）
  if (pickOn) {
    var site = pickFixed ? S.pick
      : (S.pick.mx !== null ? { lat: my2lat(S.pick.my), lon: mx2lon(S.pick.mx) } : null);
    if (site && site.lat >= -90 && site.lat <= 90) {
      var lamS = covLambda(cur().avgAlt, S.pick.el);
      var ox = PX(wrapLon(site.lon)), oy = PY(site.lat);
      if (lamS > 0.002) {
        ctx.beginPath();
        circlePath(ctx, PX, PY, site.lat, site.lon, lamS, 72);
        ctx.fillStyle = C.sel; ctx.globalAlpha = 0.10; ctx.fill();
        // 虚线框用星座主题色（国网红 / 千帆蓝）
        ctx.strokeStyle = C.theme; ctx.globalAlpha = 0.9; ctx.setLineDash([5, 3]);
        ctx.lineWidth = 1.2; ctx.stroke(); ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
      ctx.beginPath(); ctx.arc(ox, oy, pickFixed ? 5 : 4, 0, 6.2832);
      ctx.fillStyle = C.theme; ctx.fill();
      if (pickFixed) { ctx.lineWidth = 1.6; ctx.strokeStyle = C.fg; ctx.stroke(); }
      // 观测点信息：三行（观测点 / 最低仰角 / 可见卫星数），位置在前面已算好并占位
      if (siteLabel) {
        ctx.font = '10px ' + MONO;
        ctx.textAlign = siteLabel.flip ? 'right' : 'left';
        ctx.fillStyle = C.theme;
        siteLabel.lines.forEach(function (s2, i2) { ctx.fillText(s2, siteLabel.tx, siteLabel.dy + i2 * 13); });
      }
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
  if (S.cone.on) {
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
      if (fullyFront) { ctx.globalAlpha = 0.06; ctx.fillStyle = colq; ctx.fill(); }
      ctx.globalAlpha = 0.30; ctx.strokeStyle = colq; ctx.lineWidth = 1; ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
  // 轨道：有选中时只画选中的轨道，其余卫星不画
  if (S.showTracks) {
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
        ctx.globalAlpha = sel3 ? (sg2.z ? 0.95 : 0.32) : (sg2.z ? 0.34 : 0.12);
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
    if (!hidden && (sel4 || G.hover === m || (S.names.globe && !hasSelG))) {
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
        ctx.fillStyle = C.fg; ctx.fillText(lb, pr2.x + 6, pr2.y);
      }
    }
  }
}

// ---------------------------------------------------------------- 表 04
var tbody = document.getElementById('tbody');
var tableRows = {};
var SAT_PAGE = 10;
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
    maker: mkRow ? mkRow.items.map(function (x) { return (LANG === 'en' && x.en) ? x.en : x.zh; }).join(' ') : '',  // V1.4.2/4.3：制造方（供排序/搜索）
    sma: b ? s.smaB : s.smaK, hp: b ? s.hpB : s.hpK, ha: b ? s.haB : s.haK,
    inc: s.inc, period: s.period, age: L.dateMs || -1,
    raan: s.raan0, ecc: s.ecc, bstar: s.bstar, epoch: s.epochMs,
    // 混合搜索用：中英卫星名、目录名、NORAD、批次名（中英）、COSPAR
    q: [s.name, nameVariants(s), String(s.norad),
        L.name, batchVariants(L.name), s.cospar,
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
  // V1.3.6：卫星名染主题色 + 下划线，点击跳到 satcat.com 的对应条目（按 NORAD 编号）
  return '<tr data-idx="' + s.idx + '" class="' + (sel ? 'focused' : '') + '">' +
    '<td class="lname"><span class="swatch" style="background:' + colOf(s, 'chart') + ';margin-right:6px"></span>' +
    '<a class="sat-link" href="' + SATCAT(r.norad) + '" target="_blank" rel="noopener" title="Satcat · ' + r.norad + '">' + r.name + '</a></td>' +
    '<td>' + r.norad + '</td>' +
    '<td><span class="batch-link" data-lk="' + s.lk + '" title="' + t('d_sel_group') + '">' + batchName(r.launch) + '</span></td>' +
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
function launchRowHtml(L) {
  var pend = L.pending > 0;
  var rocket = L.rseg && L.rseg.length
    ? L.rseg.map(linkHtml).join(' <span class="sep">/</span> ')
    : linkHtml({ t: L.rocket });
  var site = L.slink ? linkHtml(L.slink) : linkHtml({ t: L.site });
  var selLk = {};
  S.sel.forEach(function (i) { var s = cur().sats[i]; if (s) selLk[s.lk] = 1; });
  // V1.3.6：列序 批次/组 | 运载火箭(后跟 COSPAR) | 发射时间 | 发射地点 | 设计倾角 | 轨道要素
  return '<tr class="' + (selLk[L.key] ? 'focused' : '') + '" data-lk="' + L.key + '"><td class="lname"><span class="batch-link" data-lk="' + L.key + '" title="' +
    t('d_sel_group') + '">' + batchName(L.name) + '</span></td>' +
    '<td class="rk">' + rocket + ' <span class="tag">' + L.cospar + '</span></td>' +
    '<td' + (pend ? ' class="pend"' : '') + '>' + L.dateStr.replace('T', ' ') + '</td>' +
    '<td class="site">' + site + '</td><td>' + L.inc.toFixed(1) + '°</td>' +
    '<td>' + (L.sats.length ? L.sats.length + (LANG === 'en' ? ' sats' : ' 颗') : '') +
    (pend ? ' <span class="tag"' + (L.pinfo ? ' title="' + pendTitle(L.pinfo) + '"' : '') +
      '>' + t('d_pending_tag') + L.pending + '</span>' : '') +
    '</td></tr>';
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
  var pages = Math.max(1, Math.ceil(rows.length / SAT_PAGE));
  // 有选中项时，跳到「当前排序下第一个选中项」所在页
  if (jump && S.sel.length) {
    var firstIdx = rows.findIndex(function (r) { return S.sel.indexOf(r._s.idx) >= 0; });
    if (firstIdx >= 0) {
      var target = Math.floor(firstIdx / SAT_PAGE);
      if (S.tpage !== target) S.tpage = target;
    }
  }
  LAST_ROWS = rows;
  if (S.tpage >= pages) S.tpage = pages - 1;
  if (S.tpage < 0) S.tpage = 0;
  var slice = rows.slice(S.tpage * SAT_PAGE, (S.tpage + 1) * SAT_PAGE);
  var html = slice.map(satRowHtml).join('');
  tbody.innerHTML = html || '<tr><td colspan="14" class="empty">' + (LANG === 'en' ? 'No matching satellite' : '没有匹配的卫星') + '</td></tr>';
  tableRows = {};
  Array.prototype.forEach.call(tbody.querySelectorAll('tr[data-idx]'), function (tr) {
    tableRows[tr.getAttribute('data-idx')] = tr;
  });
  document.querySelectorAll('#satTable .extra').forEach(function (el) {
    el.style.display = S.allCols ? '' : 'none';
  });
  document.getElementById('tableFoot').textContent =
    t('d_tbl_foot_1') + rows.length + t('d_tbl_foot_2') +
    (S.model === 'brouwer' ? t('d_tbl_bro') : t('d_tbl_kep'));
  // 分页（V1.3.6：给每个按键一个 class，窄屏好按「上一页/指示器/下一页」+「首页/尾页」两行排）
  var pg = document.getElementById('satPager');
  pg.innerHTML = pagerHtml(S.tpage, pages, 'spg', 'd_satpage', 'sat');
  fixTableHeight('#sec-table .table-wrap');
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
    '<span class="pg-box">' + t(boxKey) + (page + 1) + (LANG === 'en' ? ' of ' : '/') + pages + (LANG === 'en' ? '' : ' 页') + '</span>' +
    btn(t('d_next'), page + 1, page >= pages - 1, 'pg-next') +
    '<span class="pg-br"></span>' +
    btn(t('d_last'), pages - 1, page >= pages - 1, 'pg-last') + shot;
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
function fileStamp() { return new Date().toISOString().slice(0, 10); }
// V1.4.0：底栏时间 = 页面当前正在模拟的时刻（把时间条偏移算进去），不是按快门的时刻。
// 格式：GMT 2026/09/30_20:18:00（+8 04:18:00）—— 括号里是本机时区偏移与对应本地时间。
function shotClock() {
  var offMin = -new Date().getTimezoneOffset();               // 东八区 = 480
  var ms = Date.now() + (S.timeOffset || 0) * 60000;          // 时间条偏移（分钟）
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
  var st = cur();
  return 'CISTrack ' + VERSION + ' · ' + st.name + ' · ' + title + ' · ' + shotClock();
}
function monoFont(px, bold) {
  return (bold ? '700 ' : '') + px + 'px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
}
function exportView(view) {
  var id = view === 'chart' ? 'chart' : (view === 'map' ? 'map' : 'globe');
  var cv = document.getElementById(id);
  if (!cv || !cv.width) return;
  var st = cur();
  var title = view === 'chart' ? t('h_dist') : (view === 'map' ? t('h_map') : t('h_orbits'));
  // V1.4.0：图表/地图/地球三块画布的物理像素比并不都是 2（地图是 1x），
  // 底栏字号必须跟画布真实缩放走，否则地图上那行字会比图还大、右侧声明也放不下。
  var dpr = (cv._w && cv.width) ? Math.max(1, Math.min(3, cv.width / cv._w)) : 1;
  var pad = Math.round(34 * dpr);
  var out = document.createElement('canvas');
  out.width = cv.width; out.height = cv.height + pad;
  var ctx = out.getContext('2d');
  ctx.fillStyle = cssVar('--bg', '#0a0c10');
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(cv, 0, 0);
  drawShotFooter(ctx, out.width, cv.height + pad / 2, shotLeft(title), dpr);
  savePng(out, 'CISTrack_' + st.name + '_' + title + '_' + fileStamp() + '.png');
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

  var dpr = 2, fs = 12 * dpr, padX = 11 * dpr, rowH = 26 * dpr, headH = 30 * dpr, topH = 34 * dpr;
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
  var titleTxt = shotLeft(shotTitle) + (rows.length / PAGE_SIZE > 1
    ? (LANG === 'en' ? ' · pages ' : ' · 第 ') + (from + 1) + '–' + (to + 1) + (LANG === 'en' ? '' : ' 页')
    : '');
  ctx.fillStyle = '#ffffff';
  ctx.font = monoFont(11 * dpr);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(titleTxt, padX, topH / 2);
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
  var footH = 34 * dpr;
  var cv2 = document.createElement('canvas');
  cv2.width = W; cv2.height = H + footH;
  var c2 = cv2.getContext('2d');
  c2.fillStyle = bg; c2.fillRect(0, 0, cv2.width, cv2.height);
  c2.drawImage(cv, 0, 0);
  drawShotFooter(c2, cv2.width, H + footH / 2, shotLeft(shotTitle), dpr);
  var pagesTxt = (from === to) ? ('p' + (to + 1)) : ('p' + (from + 1) + '-' + (to + 1));
  savePng(cv2, 'CISTrack_' + st.name + '_' + shotTitle + '_' + pagesTxt + '_' + fileStamp() + '.png');
}
function fixTableHeight(sel) {
  var wrap = document.querySelector(sel);
  if (!wrap) return;
  var tr = wrap.querySelector('tbody tr');
  if (!tr) { wrap.style.minHeight = ''; return; }
  var head = wrap.querySelector('thead');
  wrap.style.minHeight = ((head ? head.offsetHeight : 0) + tr.offsetHeight * PAGE_SIZE + 2) + 'px';
}
document.getElementById('satPager').addEventListener('click', function (e) {
  var b = e.target.closest('button[data-spg]');
  if (!b || b.disabled) return;
  S.tpage = +b.getAttribute('data-spg');
  renderTable();
});
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
  var pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  if (S.page >= pages) S.page = pages - 1;
  if (S.page < 0) S.page = 0;
  var slice = rows.slice(S.page * PAGE_SIZE, (S.page + 1) * PAGE_SIZE);
  // 选中卫星所属批次 → 高亮对应发射记录；必要时自动翻到该页
  var selLk = {};
  S.sel.forEach(function (i) { var s = st.sats[i]; if (s) selLk[s.lk] = 1; });
  var keys = Object.keys(selLk);
  if (jumpToSel && keys.length) {
    var onPage = rows.slice(S.page * PAGE_SIZE, (S.page + 1) * PAGE_SIZE)
      .some(function (L) { return selLk[L.key]; });
    if (!onPage) {
      for (var pp = 0; pp < pages; pp++) {
        if (rows.slice(pp * PAGE_SIZE, (pp + 1) * PAGE_SIZE).some(function (L) { return selLk[L.key]; })) {
          S.page = pp; break;
        }
      }
      slice = rows.slice(S.page * PAGE_SIZE, (S.page + 1) * PAGE_SIZE);
    }
  }
  LAST_LAUNCH_ROWS = rows;
  document.getElementById('launchBody').innerHTML = slice.map(launchRowHtml).join('');
  // 分页（与卫星表同款：宽屏一行、窄屏两行）
  document.getElementById('pager').innerHTML = pagerHtml(S.page, pages, 'pg', 'd_page', 'launch');
  fixTableHeight('#sec-launches .table-wrap');
}
document.getElementById('pager').addEventListener('click', function (e) {
  var b = e.target.closest('button[data-pg]');
  if (!b || b.disabled) return;
  S.page = +b.getAttribute('data-pg');
  renderLaunchTable();
});
// 批次表：整行可点（V1.3.4）= 选中整批，在图表 / 地图 / 地球与卫星表里联动高亮，
// 卫星表自动翻到当前排序下该批第一颗所在的页；点链接不触发
document.getElementById('launchBody').addEventListener('click', function (e) {
  if (e.target.closest('a')) return;
  var bl = e.target.closest('[data-lk]');
  // stopPropagation：整行点选后不再往上冒泡，避免章节级「点空白退出选择」把它清掉
  if (bl) { e.stopPropagation(); selectGroup(bl.getAttribute('data-lk')); }
});
document.getElementById('sec-launches').addEventListener('click', function (e) {
  if (e.target.closest('a') || e.target.closest('#launchBody tr')) return;
  clearSel();
});

// ---------------------------------------------------------------- 头部
function renderHeader() {
  var st = cur();
  var gw = S.key === 'gw';
  // 选中框 / 框选色带 / README 按键 / 弹窗链接 = 星座主题色（国网红 / 千帆蓝）
  document.documentElement.style.setProperty('--row-sel', gw
    ? (isLight() ? '#c92a2a' : '#ff6b6b')
    : (isLight() ? '#1864ab' : '#4dabf7'));
  document.documentElement.style.setProperty('--sel-bg', gw
    ? (isLight() ? 'rgba(201,42,42,0.10)' : 'rgba(255,107,107,0.10)')
    : (isLight() ? 'rgba(25,113,194,0.10)' : 'rgba(77,171,247,0.10)'));
  var cls = gw ? 'c-gw' : 'c-qf';
  document.getElementById('heroTitle').innerHTML =
    '<a class="tt-link ' + cls + '" href="' + (gw ? WIKI.gw : WIKI.qf) +
    '" target="_blank" rel="noopener">' + t(gw ? 'cn_gw' : 'cn_qf') + '</a>' + t('d_title_suffix_zh') +
    '<br class="br-wide">' + t('d_title_suffix_en') +
    '<span class="en" id="heroEn">' + (gw ? 'GUOWANG / SATNET — CHINA SATELLITE NETWORK' : 'QIANFAN / THOUSAND SAILS — SPACESAIL CONSTELLATION') + '</span>';
  // V1.3.5：Constellation 一行（中英都）用标准名称 + 染色粗体缩写，与下方简介同一套口径
  var ORG_EN = { gw: 'China Satellite Network Group', qf: 'Shanghai Spacecom Satellite Technology' };
  var ORG_ABBR = { gw: 'CSCN', qf: 'SPACESAIL' };
  var enLang = LANG === 'en';
  document.getElementById('kvGroupVal').innerHTML = gw
    ? (enLang ? 'Guowang · ' + ORG_EN.gw + ' (<b class="c-gw">' + ORG_ABBR.gw + '</b>)'
              : '国网 · ' + st.org)
    : (enLang ? 'Qianfan · ' + ORG_EN.qf + ' (<b class="c-qf">' + ORG_ABBR.qf + '</b>)'
              : '千帆 · ' + st.org);
  // V1.3.6：顶部三项计数一律以卫星百科词条为准，括号内分项照搬词条原文（不改写、不加"＝"）。
  // 本页真正有完整轨道要素、能实时推算位置的颗数放在下一行与 tooltip 里，作为 TLE 侧的核对。
  var wiki = (RAW[S.key] && RAW[S.key].wiki) || null;
  var ENSW = LANG === 'en';
  function wikiTitle() {
    return ENSW
      ? 'Counted as in the Satellite Wiki article "' + wiki.article + '" (' + wiki.asOf + '). This page propagates ' + st.sats.length + ' satellites live; the rest are early test satellites, Guowang GEO service satellites, or groups whose full elements are not public yet.'
      : '按卫星百科「' + wiki.article + '」词条 ' + wiki.asOf + ' 的口径计。本页实时推算其中 ' + st.sats.length + ' 颗；其余为早期试验星、国网高轨业务星，或尚未公开完整轨道要素的新批次。';
  }
  function statWiki(el, w, unit, withTrack) {
    if (!wiki || !w) {
      el.textContent = (withTrack ? st.sats.length : st.launched) + ' ' + unit;
      return;
    }
    var html = w.n + ' ' + unit + '<i class="sub2">（' + (ENSW ? w.en : w.zh) + '）</i>';
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
  document.getElementById('mAlt').textContent = fmtNum(st.avgAlt, 1) + ' km（' + fmtNum(st.minAlt, 0) + '–' + fmtNum(st.maxAlt, 0) + '）';
  document.getElementById('mInc').textContent = st.incList.map(function (v) { return v.toFixed(1) + '°'; }).join(' / ');
  document.getElementById('mFirst').textContent = isFinite(st.firstMs)
    ? new Date(st.firstMs).toISOString().slice(0, 10) + t('d_bjtime') : '—';
  // V1.3.4：英文版译名按官方口径统一，缩写加粗并用星座主题色（国网 CSCN 红 / 千帆 SPACESAIL 蓝）
  document.getElementById('heroNote').innerHTML = gw
    ? (LANG === 'en'
      ? 'The Guowang (GW) constellation is China\'s national LEO satellite internet project, led by <b>China Satellite Network Group</b> (<b class="c-gw">CSCN</b>).'
      : '中国星网GW星座，又称"国网"星座，是由中国卫星网络集团有限公司主导建设的国家级低轨卫星互联网工程。')
    : (LANG === 'en'
      ? 'The Qianfan constellation, also known as the "G60 Starlink", is a large LEO internet constellation under construction in China. Operator: <b>Shanghai Spacecom Satellite Technology</b> (<b class="c-qf">SPACESAIL</b>); manufacturers: <b>Genesat Space Technology</b> and <b>Shanghai Engineering Center for Microsatellites</b>; supporting: <b>Shanghai Diais Digital Technology</b>.'
      : '千帆星座，也称"G60星链"，是中国正在建造的大型卫星互联网星座。现阶段卫星运营方为上海垣信卫星科技有限公司，制造方为上海格思航天科技有限公司、上海微小卫星工程中心，配套方为上海迪爱斯数字科技有限公司。');
  var epochTxt = t('d_epoch') + ' ' + fmtUTC(st.epochMax) + ' UTC';
  document.getElementById('navUpdated').textContent = epochTxt;
  // V1.3.6：手机版顶栏放不下，要素历元改在页面大标题下方居中显示
  var pe = document.getElementById('pageEpoch');
  if (pe) pe.textContent = t('d_epoch2') + ' ' + fmtUTC(st.epochMax) + ' UTC';
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
  mapTrackCache.key = null; globeTrackCache.key = null;
}
function fillGroupSelect() {
  var sel = document.getElementById('groupSel'), st = cur();
  sel.innerHTML = '<option value="all">' + t('d_sel_all') + st.sats.length + t('d_sel_all2') + '</option>' +
    st.launches.filter(function (L) { return L.sats.length; }).map(function (L) {
      return '<option value="' + L.key + '">' + batchName(L.name) + ' · ' + L.sats.length + ' · ' + L.dateStr.slice(0, 10) + '</option>';
    }).join('');
  sel.value = S.launchFilter;
  if (sel.value !== S.launchFilter) S.launchFilter = 'all';
}

// 星座切换
document.getElementById('constelSeg').addEventListener('click', function (e) {
  var b = e.target.closest('button[data-c]'); if (!b) return;
  S.key = b.getAttribute('data-c'); S.sel = []; S.focusIdx = null; S.launchFilter = 'all';
  S.page = 0; S.tpage = 0;                    // 两张表格都回到第一页
  this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
  resetDragTips();                            // V1.3.6：换星座 = 换窗口，拖拽提示重新出现
  closeSug();
  rebuild();
});
// 主题
document.getElementById('themeBtn').addEventListener('click', function () {
  var light = document.documentElement.getAttribute('data-theme') === 'light';
  if (light) { document.documentElement.removeAttribute('data-theme'); localStorage.setItem('theme', 'dark'); }
  else { document.documentElement.setAttribute('data-theme', 'light'); localStorage.setItem('theme', 'light'); }
  try {
    document.querySelector('meta[name=theme-color]').setAttribute('content', light ? '#050505' : '#f7f7f5');
  } catch (e) {}
  refreshTheme();
  drawChart(); renderTable(); renderLegend();
});
// 图表控制
document.getElementById('modeSeg').addEventListener('click', function (e) {
  var b = e.target.closest('button[data-mode]'); if (!b) return;
  S.mode = b.getAttribute('data-mode');
  this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
  buildChartPoints(); chartAutoView(); drawChart(); renderHeader();
});
document.getElementById('modelSeg').addEventListener('click', function (e) {
  var b = e.target.closest('button[data-model]'); if (!b) return;
  S.model = b.getAttribute('data-model');
  this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
  buildChartPoints(); chartAutoView(); drawChart(); renderTable();
});
document.getElementById('groupSel').addEventListener('change', function () {
  S.launchFilter = this.value; chartAutoView(); drawChart();
});
document.getElementById('resetZoom').addEventListener('click', function () { chartAutoView(); drawChart(); });
document.querySelectorAll('.seg[data-scope]').forEach(function (seg) {
  seg.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-color]'); if (!b) return;
    S.colorMode[seg.getAttribute('data-scope')] = b.getAttribute('data-color');
    seg.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
    if (seg.getAttribute('data-scope') === 'chart') { drawChart(); renderLegend(); }
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
    zh: '<b>可见倾角</b>：每颗卫星此刻对地面的可视覆盖区。仰角滑块调最小仰角；选中某颗后只画它的覆盖区。',
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
    zh: '<b>时间滑块</b>：把全部卫星的位置整体前推或后推最多 ±3 小时，点「此刻」回到当前时间。',
    en: '<b>Time slider</b>: shifts every satellite position by up to ±3 hours. "Now" returns to the current time.'
  },
  zoom: {
    zh: '<b>缩放</b>：触屏双指捏合，或鼠标滚轮；放大后可拖动平移，双击复位。',
    en: '<b>Zoom</b>: pinch on touch, or the scroll wheel; drag to pan once zoomed, double-click to reset.'
  },
  // 三个章节共用的「选中 / 聚焦 / 信息窗」说明（V1.3.6 精简）
  sel: {
    zh: '<b>选中后一直看得见。</b>点光点或表格任一行即可选中（Ctrl / ⌘ + 点加选），信息窗<b>锁定显示</b>且可拖走：电脑按住拖，手机长按约半秒再拖，可以拖到画布外面。✕ 只关窗、不取消选中；点空白处才取消。<br><br><b>整批选中后可聚焦。</b>点某一批会选中整批，再点其中一颗 = 聚焦它（其余高亮保留），点空白才取消整批。',
    en: '<b>Once selected, it stays visible.</b> Click a dot or any table row to select (Ctrl / ⌘ + click adds). The info panel <b>stays pinned</b> and can be dragged — grab it on desktop, press and hold ~0.5 s on touch — even outside the canvas. ✕ closes only the panel; click empty space to clear.<br><br><b>Focus inside a group.</b> Clicking a group selects the whole batch, then clicking one satellite focuses it (the rest stay highlighted); only empty space clears the group.'
  }
};
document.querySelectorAll('.help-btn[data-help]').forEach(function (b) {
  b.addEventListener('click', function (e) {
    e.stopPropagation();
    var old = document.querySelector('.help-pop'); if (old) old.remove();
    var c = HELP[b.getAttribute('data-help')]; if (!c) return;
    var p = document.createElement('div');
    p.className = 'help-pop';
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
    host.appendChild(p);
    setTimeout(function () { document.addEventListener('click', function h() { p.remove(); document.removeEventListener('click', h); }); }, 10);
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
  if (hit) showChartInfo([hit]); else if (S.sel.length) {
    var sel = cur().sats.filter(function (s) { return S.sel.indexOf(s.idx) >= 0; });
    showChartInfo(sel.map(function (s) {
      return { x: 0, y: 0, sat: s };
    }));
  } else hideInfo(chartInfo, 'chart');
  drawChart();
});
chartCv.addEventListener('mouseleave', function () {
  chartHoverPt = null; chartDrag = null; zoomBand.style.display = 'none';
  syncSelInfo();
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
    if (nx1 - nx0 > 0.05 && ny1 - ny0 > 0) chartView = { x0: nx0, x1: nx1, y0: ny0, y1: ny1 };
    zoomBand.style.display = 'none'; drawChart();
  } else if (!moved) {
    var hit = chartHit(p.x, p.y);
    if (hit) toggleSel(hit.sat.idx, false);
    else clearSel();
  }
  chartDrag = null;
});
// V1.4.3：图表两侧各 12% 划为禁用带 —— 在这两条带子里滚轮/滑动一律翻页面，
// 只有中间那一段才用来缩放/平移图表（和地球的处理保持一致）。
function chartHitZone(clientX, clientY) {
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
  if (nx1 - nx0 > 0.05 && ny1 - ny0 > 0.0001) chartView = { x0: nx0, x1: nx1, y0: ny0, y1: ny1 };
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
  if (nx1 - nx0 > 0.05 && ny1 - ny0 > 1e-6) chartView = { x0: nx0, x1: nx1, y0: ny0, y1: ny1 };
  drawChart();
}
touchZoom(chartCv, {
  active: chartHitZone,                              // V1.4.3：同上，两侧带子不吃手势
  pan: function (dx, dy) {
    if (!chartView || !chartRect) return;
    var v = chartView, r = chartRect;
    var ddx = dx / r.pw * (v.x1 - v.x0), ddy = dy / r.ph * (v.y1 - v.y0);
    v.x0 -= ddx; v.x1 -= ddx; v.y0 += ddy; v.y1 += ddy;
    drawChart();
  },
  pinch: function (f, cx, cy) { zoomChartAt(cx, cy, 1 / f); },
  tap: function (x, y) {
    var hit = chartHit(x, y);
    if (hit) toggleSel(hit.sat.idx, false); else clearSel();
  }
});

// 地图交互（含缩放/平移/观测点模式）
function mapXY(e) { var r = mapCv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
function mx2lon(x) { return ((x - S.mz.tx) / S.mz.k / mapCv._w) * 360 - 180; }
function my2lat(y) { return 90 - ((y - S.mz.ty) / S.mz.k / mapCv._h) * 180; }
function clampMZ() {
  S.mz.k = Math.max(1, Math.min(8, S.mz.k));
  var f = { w: mapCv._w || 1, h: mapCv._h || 1 };
  S.mz.tx = Math.max(f.w - f.w * S.mz.k, Math.min(0, S.mz.tx));
  S.mz.ty = Math.max(f.h - f.h * S.mz.k, Math.min(0, S.mz.ty));
  if (S.mz.k === 1) { S.mz.tx = 0; S.mz.ty = 0; }
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
  var states = frameStates; if (!states) return null;
  var st = cur();
  for (var i = 0; i < st.sats.length; i++) {
    var g = states[i]; if (!g) continue;
    var px = (g.lon + 180) / 360 * f.w * S.mz.k + S.mz.tx;
    var py = (90 - g.lat) / 180 * f.h * S.mz.k + S.mz.ty;
    var d = Math.hypot(px - x, py - y);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
function showMapInfo(idx) {
  var st = cur(), g = frameStates && frameStates[idx];
  var s = st.sats[idx];
  // V1.4.0：与地球章节同款保护 —— 数据正在重建（刷新 TLE / 切换星座）时两个数组会短暂错位，
  // 这时候直接返回，别让 s.name / g.lat 抛异常把整帧渲染打断
  if (!g || !s) { hideInfo(mapInfo, 'map'); return; }
  var el = (S.pick.on && S.pick.fixed) ? elevationOf(g) : null;
  var extra = siRow(t('d_row_cat'), s.name) +
    siRow(t('d_row_sub'), g.lat.toFixed(2) + '°, ' + g.lon.toFixed(2) + '°') +
    siRow(t('d_row_alt'), fmtNum(g.h, 1) + ' km') +
    (el !== null ? siRow(t('d_row_el'), fmtNum(el, 1) + '°') : '');
  mapInfo.__html = satBlock(s, 'map', extra);
  showInfo(mapInfo, 'map', mapInfo.__html, 'sat' + idx);
}
function showSiteInfo(lat, lon) {
  var n = frameStates ? countVisible(frameStates, lat, lon, S.pick.el) : 0;
  mapInfo.__html = '<div class="si-block"><div class="si-name">' + t('d_site') +
    '<span class="swatch" style="background:var(--row-sel)"></span></div>' +
    siRow(t('d_latlon'), lat.toFixed(2) + '°, ' + lon.toFixed(2) + '°') +
    siRow(t('d_visible'), n) + siRow(t('l_el'), '≥ ' + S.pick.el + '°') + '</div>';
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
  var g = frameStates && frameStates[i];
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
function syncSelInfo() {
  var idx = (S.focusIdx !== null && S.sel.indexOf(S.focusIdx) >= 0) ? S.focusIdx
          : (S.sel.length ? S.sel[0] : null);
  if (idx === null || idx === undefined || !frameStates || !cur().sats[idx]) {
    hideInfo(chartInfo, 'chart'); hideInfo(mapInfo, 'map'); hideInfo(globeInfo, 'globe');
    return;
  }
  showChartInfo([{ x: 0, y: 0, sat: cur().sats[idx] }]);
  showMapInfo(idx);
  showGlobeInfo(idx);
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
  if (i !== null) showMapInfo(i);
  else if (S.pick.on && !S.pick.fixed) showSiteInfo(my2lat(p.y), mx2lon(p.x));
  else if (S.pick.on && S.pick.fixed) syncSelInfo();       // 悬停移开 → 回到已固定的那颗
  // V1.3.8：悬停移开时若还有选中项，信息窗要留在选中项上（图表章节早就这么做，前两章漏了，
  // 结果「点中卫星后鼠标一移开，窗口就消失」）
  else if (S.sel.length) syncSelInfo();
  else hideInfo(mapInfo, 'map');
  if (S.pick.on && !S.pick.fixed) mapDirty = true;
});
mapCv.addEventListener('mouseleave', function () {
  mapHover = null;
  // V1.3.8：鼠标离开画布时，只要还有选中项就把窗口留在它身上
  if ((S.pick.on && S.pick.fixed) || S.sel.length) syncSelInfo(); else hideInfo(mapInfo, 'map');
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
});
document.getElementById('covEl').addEventListener('input', function () { S.cov.el = +this.value; });
var pickBtn = document.getElementById('pickBtn');
function setPick(on) {
  S.pick.on = on;
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
function updatePickHint() {
  var h = document.getElementById('pickHint');
  if (!S.pick.on) { h.textContent = ''; return; }
  if (S.pick.fixed) {
    h.textContent = t('d_fixed_hint_1') + S.pick.lat.toFixed(1) + '°, ' + S.pick.lon.toFixed(1) + '°' + t('d_fixed_hint_2');
  } else h.textContent = isTouch() ? t('d_pick_hint_touch') : t('d_pick_hint_desktop');
}
pickBtn.addEventListener('click', function () { setPick(!S.pick.on); });
document.getElementById('pickEl').addEventListener('input', function () { S.pick.el = +this.value; });
document.getElementById('mapNamesBtn').addEventListener('click', function () {
  S.names.map = !S.names.map;
  this.classList.toggle('on', S.names.map);
  this.setAttribute('aria-pressed', String(S.names.map));
});
document.getElementById('mapTracksBtn').addEventListener('click', function () {
  S.mapTrack = !S.mapTrack;
  this.classList.toggle('on', S.mapTrack);
  this.setAttribute('aria-pressed', String(S.mapTrack));
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
});
document.getElementById('globeNamesBtn').addEventListener('click', function () {
  S.names.globe = !S.names.globe;
  this.classList.toggle('on', S.names.globe);
  this.setAttribute('aria-pressed', String(S.names.globe));
});
document.getElementById('coneBtn').addEventListener('click', function () {
  S.cone.on = !S.cone.on;
  this.classList.toggle('on', S.cone.on);
  this.setAttribute('aria-pressed', String(S.cone.on));
});
document.getElementById('coneEl').addEventListener('input', function () { S.cone.el = +this.value; });
// 时间滑块（两个视图同步）
var timeInputs = document.querySelectorAll('.time-r');
var timeVals = document.querySelectorAll('.time-val');
function setOffset(min) {
  S.timeOffset = min;
  timeInputs.forEach(function (i) { i.value = min; });
  timeVals.forEach(function (b) {
    b.textContent = min === 0 ? t('d_now_btn') : (min > 0 ? '+' : '') + min + (LANG === 'en' ? ' min' : ' 分');
    b.closest('.time-ctl').classList.toggle('shifted', min !== 0);
  });
  syncFsClockState();
  frameStates = null;
}
timeInputs.forEach(function (i) {
  i.addEventListener('input', function () { setOffset(+this.value); });
});
timeVals.forEach(function (b) {
  b.addEventListener('click', function () { setOffset(0); });
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
  if (frameStates) {
    var f = { w: globeCv._w, h: globeCv._h };
    var cx = f.w / 2, cy = f.h / 2, R = globeRadNow();
    var B = globeBasis(), st = cur();
    for (var i = 0; i < st.sats.length; i++) {
      var g = frameStates[i]; if (!g) continue;
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
function showGlobeInfo(best) {
  if (best === null) { hideInfo(globeInfo, 'globe'); return; }
  var s = cur().sats[best], g2 = frameStates && frameStates[best];
  if (!s || !g2) return;                 // V1.3.8：数据正在重建时不要抛异常
  // 与 01 章节同一套字段，再追加本视图特有的目录名 / 星下点 / 瞬时高度（V1.3.4 起删掉地心距）
  globeInfo.__html = satBlock(s, 'globe',
    siRow(t('d_row_cat'), s.name) +
    siRow(t('d_row_sub'), g2.lat.toFixed(2) + '°, ' + g2.lon.toFixed(2) + '°') +
    siRow(t('d_row_alt'), fmtNum(g2.h, 1) + ' km'));
  showInfo(globeInfo, 'globe', globeInfo.__html, 'sat' + best);
}
// V1.3.7：判定「这是一次点击还是一次拖动」时，只看按下点与松开点的直线距离（净位移）。
// 旧版用的是累计位移（每帧 |dx|+|dy| 相加），人手按下时哪怕只抖两三像素也会被算成拖动，
// 于是点击卫星永远选不中 —— 这就是「轨道章节点不中光点」的根因之一。
var TAP_SLOP = 14;                                   // px，超过这个距离才算拖动（手抖 12px 以内都算点击）
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
  // V1.3.8：同地图 —— 悬停到空白处时，有选中就回到选中项，别把窗口收掉
  if (best !== null) showGlobeInfo(best);
  else if (S.sel.length) syncSelInfo();
  else hideInfo(globeInfo, 'globe');
});
window.addEventListener('mouseup', function () { G.dragging = false; });
globeCv.addEventListener('mouseleave', function () { G.hover = null; syncSelInfo(); globeDirty = true; });
globeCv.addEventListener('click', function (e) {
  if (tapDist(e.clientX, e.clientY, G.dnx, G.dny) > TAP_SLOP) return;   // 转过地球 = 拖动，不当点击
  if (G.hover !== null) toggleSel(G.hover, false);
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
  toggleSel(+tr.getAttribute('data-idx'), false);
});
document.getElementById('colsToggle').addEventListener('click', function () {
  S.allCols = !S.allCols;
  this.classList.toggle('on', S.allCols);
  renderTable();
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
  '# 🛰️ 国网 · 千帆 在轨追踪',
  '',
  '> 中国两大低轨互联网星座 —— **国网 Guowang**（中国星网）与 **千帆 Qianfan**（G60 星链）—— 的可视化追踪页。',
  '> **单 HTML 文件 · 全部计算在浏览器内完成 · 离线可用 · MIT 开源。**',
  `> 当前版本 **${VERSION}** —— CISTrack（China LEO Internet Satellite Tracker）。`,
  '',
  '---',
  '',
  '## 📖 关于本网页',
  '',
  '**这是什么。** 中国正在同时建设两个低轨宽带互联网星座：[国网](' + WIKI.gw + ')（中国星网，SatNet）与[千帆](' + WIKI.qf + ')（Qianfan，又称 G60 星链）。本页把公开轨道要素按星座整理成图表、地图、地球和一张全量表，展示它们此刻在轨的分布与态势。画面中的位置不是预先画好的图片，而是由 SGP4 轨道模型在**你的设备**上逐颗实时推算出来的。',
  '',
  '**数据从哪来。** 轨道要素取自 NORAD 空间目标目录的公开发布（CelesTrak）：先取 `hulianwang` / `qianfan` 两个星座分组，再用**按名称查询**补回分组漏掉的早期试验星，最后以完整的 NORAD 目录按 COSPAR 编号逐颗反查；每颗卫星在多来源里取历元最新的一份；每批卫星的名称、发射时间、运载火箭与发射场取自卫星百科「星网」「千帆星座」两个词条的发射记录表；地图与地球的海岸线底图来自 Natural Earth 公有领域数据集；轨道计算使用开源实现 satellite-js。四个来源的主页：[CelesTrak](https://celestrak.org/) · [卫星百科](https://sat.huijiwiki.com/) · [Natural Earth](https://www.naturalearthdata.com/) · [satellite-js](https://github.com/shashwatak/satellite-js)',
  '',
  '**数据有多新。** 每次打开页面都会尝试联网获取最新一期轨道要素 —— 只取当前这两个星座分组，不重复下载历史数据，因此很快。若因网络环境或跨域限制没有取到，页面会自动改用文件内置的快照数据，并在顶部如实标注这期要素的历元时间，你可以据此判断数据的新旧。注意：批次、运载火箭、发射地点、卫星百科链接与**顶部的词条计数**都是构建时内置的静态资料，不随每次打开联网更新（轨道要素本身每次打开都会联网刷新）。',
  '',
  '**为什么高度有两套算法。** 目录发布的平均运动采用 Kozai 约定，其中已经计入地球扁率（J2）的长期影响。**开普勒**是直接由这个平均运动反算的 `a = (μ/n²)^⅓`，数值上等于 SGP4 实际轨道在一个周期内密切半长轴的平均值，也就是卫星真实的几何尺度。**布劳威尔**再剥掉一层 J2 长期项，得到 SGP4 内部递推所用的量：在国网 86.5° 的近极轨道上比开普勒高约 2.9 公里，在 50° 倾角轨道上低约 0.7 公里。默认展示布劳威尔口径，与目录自身的口径一致。',
  '',
  '**半长轴不等于飞行高度。** 卫星在一圈之中围绕半长轴上下摆动 ±a·e：偏心率 2×10⁻⁴ 时约 ±1.5 公里，刚完成变轨的过渡轨道上可达几十公里。要看星座整体的爬升节奏，用半长轴最干净；近地点与远地点另外提供了切换。',
  '',
  '**一颗星要爬很久。** 两个星座的组网星大多先进入两三百至八百公里的停泊轨道，再用电推进花几个月爬到一千米以上的工作高度。因此同一张图上，越新的批次位置越低 —— 它们还在路上。轨道分布图把**倾角放在横轴**：国网与千帆各占哪几条倾角带、同一批次内的高低差，一眼可见。',
  '',
  '**怎么挑选要看的东西。** 页面顶部、表格上方、以及全屏小窗里各有一个联想搜索框：输入卫星名（中英文皆可）、NORAD 编号或批次名都会实时给出候选列表，点一条即可选中；也可以直接点表格里的「批次」二字，一次选中该批次的全部在轨卫星。选中之后，图表、地图、地球都只高亮这一颗（或这一批）卫星及其轨道，其余卫星变暗淡、不再画轨道，表格里被选中的那一整行会用**一条国网红 / 千帆蓝的长边框**框住并自动翻到它所在的那一页。想退出选择：再点一次它，或点图表、地图、地球、表格的空白处即可 —— 任何位置都能取消。',

  '**信息窗：锁定显示 + 可以拖走。** 选中之后信息窗会**锁定显示**，鼠标移出画布也不会收起 —— 因为它是给你拖的：电脑按住框体直接拖，手机长按约半秒再拖（拖行期间浮层勾一圈红 / 蓝的星座主题色细边），而且**可以拖到图表外面**，放在任何不影响观看的位置。右上角的 ✕ 只关窗，不取消选中。整批选中后，点其中一颗是**聚焦**它 —— 信息窗换成这一颗（原位接班），其余卫星的高亮与轨道都保留；再点另一颗就换聚焦，只有点空白才是取消整批选择。',
  '',
  '**缩放与全屏。** 三幅图用鼠标滚轮 / 触屏双指捏合缩放，放大后拖动平移（地球是旋转），双击复位；右下角保留「恢复原始比例」和「全屏」两个按键。全屏后画布铺满整屏，手机与电脑同款：左上角有「恢复默认视图」按钮；地图与地球另有一个三角按钮，用来打开和收起左侧的设置小窗，小窗里同样带一个联想搜索框。手机上全屏还会自动转成横屏。全屏里做的选择（选星、调仰角、切换配色）在退出全屏后依然保留。地图与地球的全屏右上角还有一个和顶部同款的时间药丸：跟着实时走时是主题色细边框；一旦用时间滑块把画面推离「此刻」，它就换成 2 秒一呼吸的黄色边框，提醒你现在看到的不是实时位置。',
  '',
  '**滑条上的数字。** 每个仰角滑条右侧都有数值框，点一下就能用键盘输入（只填数字，° 已经在框外）；超出 0–85 范围或输入非法字符时，会保持你改动前的数值。',
  '',
  '**哪些卫星没有画进来。** 最近几批（国网 2026-176 / 187 / 213 / 221，千帆 2026-210 / 211 等）在目录里**已经有临时编号**（100203–100799 段）与**公开的摘要参数**（周期、倾角、近远地点 —— 把鼠标停在「发射批次」表的「待编目」标签上就能看到），但**完整的轨道要素（TLE）尚未公开发布**：CelesTrak 的 GP 接口对这类临时编号不返回数据，Space-Track 需要账号，第三方镜像（n2yo、tle.ivanstanojevic.me 等）也都查不到。举一个已核对的例子：COSPAR **2026-176A** 对应临时编号 **100203**，目录里已命名为 **HULIANWANG DIGUI-178** —— 也就是说它们并非"下落不明"，只是被编成了待分析对象、还没拿到正式编号。因此本页只能展示这些摘要，无法推算它们的位置；相应地，这三类图里都没有它们，只有「轨道高度图」上按摘要高度画出的**空心点与虚线高度区间**（不参与选中与悬停）。等它们拿到正式编号并发布要素后，重新构建一次就会自动转入正常显示。此外，两星座的早期试验星、以及国网的高轨业务星（地球同步轨道）不在低轨分组之内，也未计入。页面顶部的「发射 / 在轨卫星数量」与「发射成功次数」一律**以卫星百科词条的统计栏为准**（括号内照搬词条原文的分项）；本页真正有完整轨道要素、能实时推算位置的颗数单独写在第二行，作为 TLE 一侧的核对。',
  '',
  '**关于本项目。** 本页按 [MIT 协议](https://opensource.org/licenses/MIT)完全开源，可自由使用、修改与分发（许可全文见文末）。项目由 [小橙子的宇宙Jackoraniverse](' + BILI + ') 参照 [Где «Рассветы»](https://findrassvet.ru/)（Bureau 1440 的 Rassvet 星座追踪站）的页面风格与布局，借助 AI Agent 以协同编程（vibe coding）方式完成。',
  '',
  '**免责声明。** 本页内容由人工智能辅助生成，虽经核对，仍可能存在疏漏，请以官方发布为准。轨道要素属于公开目录数据，精度有限且随时间老化，通常几小时内位置误差在公里量级，仅供科普与参考，不应用于工程、科研或过境预报等专业用途。本页为非官方项目，与中国卫星网络集团有限公司、上海垣信卫星科技有限公司均无关联。',
  '',
  '---',
  '',
  '## ✨ 它能做什么',
  '',
  '- 🛰️ **实时态势**：所有卫星位置由 SGP4 在你的设备上按当前时间逐颗推算，图表、地图、3D 地球三视图联动；',
  '- 📈 **轨道分布（03）**：横轴 = 轨道倾角，纵轴 = 轨道高度（可选半长轴 / 远地点 / 近地点），滚轮或双指缩放、拖框放大、拖拽平移、双击复位；',
  '- ⭕ **待编目批次**：最近几批（国网 2026-176/187/213/221，千帆 2026-210/211）目录里已有 100xxx 临时编号与公开摘要参数，但没有正式 TLE。它们在高度图上以**空心点 + 虚线高度区间**标出，不参与选中与悬停，也不会出现在地图与 3D 地球里。',
  '- 🗺️ **地图**：卫星对地面的可视覆盖区（可见倾角可调，默认 35°）、前后各半圈地面轨迹、1–8 倍缩放；',
  '  - **地图仅为粗略的地球大陆海岸线轮廓示意图，不能准确代表实际投影情况。**',
  '- 📍 **地面观测点**：随鼠标实时预览"从这里能看到多大范围、可见几颗卫星"，点击固定并高亮可见卫星，再点该点解除；',
  '- 🌍 **3D 地球（02）**：自转 + 拖拽 + 缩放，轨道圈分正/背面，显示可视区域，**轨道高度按 2.4× 夸张显示**以便区分高度壳层；',
  '- 📋 **卫星表格（04）**：13 列轨道要素（含「在轨日, 天」）、混合搜索与联想、排序、每页 10 条，卫星名点击直达 satcat.com 对应条目；',
  '- 🚀 **发射历史（05）**：列序为「批次/组 · 运载火箭（后跟 COSPAR 编号）· 发射时间 · 发射地点 · 设计倾角 · 轨道要素」，火箭与发射地点染主题色带下划线可点跳转；按页浏览（每页 10 条），**整行点一下**就选中整批 —— 图表 / 地图 / 地球只高亮这一批，卫星表自动翻到当前排序下该批第一颗所在的页，批次表这一行用一条国网红 / 千帆蓝的长边框整行框住；待编目批次只标一个「待编目 ×N」标签，完整目录摘要悬停标签即可看到，不再铺开拉长表格；',
  '- 🎨 **界面**：深浅色主题、中英文切换、任意比例屏幕适配、三幅图一键全屏、右下角章节跳转药丸、顶部实时时钟。',
  '',
  '## ⚙️ 设置：全局生效、可存盘、可一键还原',
  '',
  '- 任何一处设置改动都是**全局生效**并写入浏览器本地存储（localStorage）：关掉页面再打开、或在国网 / 千帆之间来回切换，设置都还在；',
  '- 01 地图、02 轨道、03 轨道分布、04 卫星表格四个章节各有一个 **「默认设置」** 按钮，只把该章节的这几项还原成初始配置（例如地图的覆盖区开关、最低仰角、显示轨道、配色）；',
  '- 页面顶部搜索框下面靠右还有一个 **「还原所有默认设置」**：把 01–04 全部章节一次性还原。刚打开页面时它本来就是默认配置，按钮是**暗淡不可点**的，改动任意一项后才会亮起；',
  '- **初始默认配置**：纵轴 = 半长轴、模型 = 布劳威尔、配色 = 按卫星、批次 = 全部；地图覆盖区开 / 最低仰角 10°、显示轨道开、显示名称关；地球可视锥开 / 最低仰角 10°、自转开、轨道开；表格按卫星名升序、只显示常用列。',
  '',
  '## 🚀 快速开始',
  '',
  '1. 拿到 `国网与千帆在轨追踪.html`（单文件）；',
  '2. 用现代浏览器（Edge / Chrome / Firefox / Safari）双击打开 —— **无需安装、无需联网**；',
  '3. 联网时页面会自动拉取最新一期轨道要素（分组 + 按名称补漏两路并发，各约 30–40 KB，6 秒内完成或自动回落内置快照）。',
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
  '- 选中之后：图表、地图、地球只高亮选中的卫星及其轨道，其余卫星变暗淡、不画轨道与覆盖区；表格中被选中的那一整行用**一条国网红 / 千帆蓝的长边框**框住，并自动翻到当前排序下第一个被选中项所在页；',
  '- 退出选择：再点一次该项，或点击图表 / 地图 / 地球 / 表格的空白处 —— 任何视图都能全局退出（已不再需要 Ctrl 多选）；',
  '- **图 → 表联动**：在图表 / 地图 / 地球里点中一颗卫星，卫星表格会自动翻到它所在的那一页，并把那一行闪一下；',
  '',
  '## 🖼️ 导出图片',
  '',
  '- 三幅图（地图 / 轨道 / 轨道分布）右下角最下面一个按键就是导出键：把当前这一屏画布连同一行「CISTrack · 星座 · 章节 · 日期」的说明一起存成 PNG；',
  '- 两个表格（卫星表格 / 发射历史）的导出键在翻页那一行的**右端**：把当前这一页按屏幕上的列顺序画成 PNG；',
  '- 全程在本机完成，不上传任何数据；文件名形如 `CISTrack_国网_卫星表格_p3_2026-09-30.png`。',
  '',
  '## 📱 全屏与移动端',
  '',
  '- 电脑端与手机端**同款全屏**：画布铺满整屏，左上角是「恢复默认视图」按钮（等同于页面里的「重置视图」）；地图与地球另有一个三角按钮，用来打开和收起左侧的设置小窗，小窗里同样带一个联想搜索框；',
  '- **03 轨道分布全屏改用顶部设置栏**：非全屏的那排控件（批次 / 纵轴量 / 模型 / 配色 / 重置视图）原样搬到屏幕顶上横排，屏幕窄时自动换行，画布会按栏高自动让出顶部空间；在全屏里做的选择与设置，退出全屏后一律保留；',
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
  '页面顶部的「发射卫星」「在轨卫星」「发射成功」三项**照搬卫星百科词条统计栏**（2026-09-30 核对：国网 248 / 244 / 40-41，千帆 262 / 262 / 19-19），括号内为词条原文的分项。其中真正能被本页实时推算位置的只是低轨互联网分组里的那部分（写在第二行）；早期试验星、国网的高轨业务星以及尚未公开轨道要素的新批次不在其中。表格里的卫星名可点击跳转到 [satcat.com](https://www.satcat.com) 的对应条目。',
  '',
  '### 在轨日, 天',
  '',
  '表格中的「在轨日, 天」= 从该批次发射时间到现在的天数，括号内为换算后的年月日（例如 `652d（01y09m15d）`）。它衡量的是整批卫星的在轨时长，可以配合半长轴看出电推进爬升的进度。',
  '',
  '## 🔗 数据来源',
  '',
  '- 🌐 [CelesTrak](https://celestrak.org/) —— NORAD 空间目标目录公开轨道要素（TLE），国网对应 `hulianwang` 分组、千帆对应 `qianfan` 分组；',
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
  '由 [小橙子的宇宙Jackoraniverse](https://space.bilibili.com/455972735) 制作 · 参考 [Где «Рассветы»](https://findrassvet.ru/)（Bureau 1440）的页面风格'
].join('\n');
var README_EN = [
  '# 🛰️ Guowang & Qianfan Live Tracker',
  '',
  '> A visualization and tracking page for China\'s two LEO internet constellations: **Guowang** (China SatNet) and **Qianfan** (the G60 Starlink).',
  '> **One HTML file · computed entirely in the browser · works offline · MIT licensed.**',
  `> Current version **${VERSION}** — CISTrack (China LEO Internet Satellite Tracker).`,
  '',
  '---',
  '',
  '## 📖 About this page',
  '',
  '**What this is.** China is building two LEO broadband internet constellations at once: [Guowang](' + WIKI.gw + ') (China SatNet) and [Qianfan](' + WIKI.qf + ') (Qianfan, aka the G60 Starlink). This page turns public orbital elements into a chart, a map, a globe and a full table showing the constellations\' current on-orbit situation. Nothing here is a pre-rendered picture — every position is propagated live on **your device** with the SGP4 model.',
  '',
  '**Where the data comes from.** Orbital elements are published in the NORAD satellite catalog on CelesTrak: the `hulianwang` / `qianfan` constellation groups first, then a **name query** that recovers the early test satellites the groups miss, then a per-satellite lookup by COSPAR id against the full catalog; when several sources have the same satellite, the newest epoch wins; group names, launch times, vehicles and sites come from the launch records of the SatNet and Qianfan articles on the Satellite Wiki; coastlines come from the public-domain Natural Earth dataset; propagation uses the open-source satellite-js library. Homepages: [CelesTrak](https://celestrak.org/) · [Satellite Wiki](https://sat.huijiwiki.com/) · [Natural Earth](https://www.naturalearthdata.com/) · [satellite-js](https://github.com/shashwatak/satellite-js)',
  '',
  '**How fresh is it.** Each time the page opens it tries to fetch the latest set of elements — only the two current groups, never any history, so it is fast. If the network or cross-origin rules prevent it, the page falls back to the snapshot embedded in the file and honestly labels the element epoch at the top. Note: launch groups, vehicles, sites and the Satellite Wiki links are static material baked in at build time — they are not re-fetched on every open.',
  '',
  '**Why two altitude models.** The catalog mean motion follows the Kozai convention and already includes secular J2 effects. **Kepler** inverts it directly, `a = (μ/n²)^⅓` — numerically the mean osculating semi-major axis over one revolution. **Brouwer** additionally strips the J2 secular terms (what SGP4 recurses with): ~2.9 km higher than Kepler on Guowang\'s 86.5° near-polar orbits, ~0.7 km lower on 50° orbits. Brouwer is the default, matching the catalog convention.',
  '',
  '**Semi-major axis is not altitude.** A satellite oscillates around it by ±a·e each revolution: ~±1.5 km at e = 2×10⁻⁴, tens of km on transfer orbits right after launch. For the constellation\'s climbing rhythm the SMA is the cleanest quantity; perigee and apogee are one click away.',
  '',
  '**Climbing takes months.** Most satellites first enter parking orbits of a few hundred to 800 km, then use electric propulsion to climb above 1,000 km. Newer groups therefore sit lower in the chart — they are still on their way, the orbit-distribution chart puts **inclination on the X axis**: which inclination bands each constellation occupies is obvious at a glance.',
  '',
  '**How to pick what you want to inspect.** There is an autocomplete search box at the top of the page, above the table, and inside every fullscreen panel: type a satellite name (Chinese or English), a NORAD number or a group name and a candidate list appears; click one to select it. You can also click the group name inside the table to select every in-orbit satellite of that group at once. Once something is selected, the chart, map and globe highlight only that satellite (or group) and its orbit, everything else dims and hides its orbit, and the matching table row is boxed with **one long red (Guowang) / blue (Qianfan) border** around the whole row, auto-scrolled to the right page. Click it again — or click any empty area in the chart, map, globe or table — to clear the selection everywhere.',

  '**The info panel: pinned, and draggable.** Once something is selected the info panel **stays pinned** — moving the cursor off the canvas no longer closes it, because it is meant to be repositioned: grab the panel and move it on a desktop, press and hold for about half a second first on touch (a thin red / blue constellation-coloured outline appears while dragging). It can even be dragged **outside the chart** so it never covers the picture. The ✕ closes the panel without clearing the selection. Inside a selected group, clicking one satellite **focuses** it — the panel switches in place to that satellite while every other highlight and track stays — and only clicking empty space clears the whole group.',
  '',
  '**Zoom & fullscreen.** All three views zoom with the mouse wheel / two-finger pinch, drag to pan once zoomed (the globe rotates) and double-click to reset; the lower right keeps "reset to original scale" and "fullscreen". In fullscreen the canvas fills the screen on both phones and desktops: a "Reset view" button sits at the top left, and the map and globe also get a triangle button that opens and closes the settings panel on the left — that panel carries its own autocomplete search box. On phones, fullscreen also turns the view to landscape. Selections made in fullscreen (satellites, elevations, colors) survive after leaving fullscreen. The map and globe also carry a clock pill at their top-right corner in fullscreen, styled like the one at the top of the page: a thin border in the constellation colour while it tracks real time, switching to a yellow border breathing every 2 seconds once you move away from "now" — a reminder that what you see is no longer live.',
  '',
  '**Numbers on sliders.** Every elevation slider has a numeric box on its right — click it to type a value (digits only, the ° sits outside the box). Values outside 0–85 or invalid input keep your previous setting.',
  '',
  '**Which satellites are missing.** The most recent groups (Guowang 2026-176 / 187 / 213 / 221, Qianfan 2026-210 / 211, …) **are in the catalog** — with temporary NORAD numbers (100203–100799) and **published summary parameters** (period, inclination, perigee/apogee; hover the "pending" tag in the launch table to read them) — but their **full element sets (TLE) are not publicly distributed yet**: CelesTrak\'s GP endpoint returns nothing for temporary designators, Space-Track needs an account, and third-party mirrors (n2yo, tle.ivanstanojevic.me) do not carry them either. One verified example: COSPAR **2026-176A** is temporary number **100203**, already named **HULIANWANG DIGUI-178** — they are not lost, just filed as analyst objects pending permanent numbers. So this page can show the summary but cannot propagate them: they appear in none of the three views, except as **hollow dots with dashed altitude ranges** on the altitude chart (not selectable or hoverable). Once permanent numbers and elements appear, a rebuild promotes them automatically. Early test satellites and Guowang\'s GEO satellites sit outside these LEO groups and are not counted either. The "satellites launched / in orbit" and "launches succeeded" figures at the top are **taken verbatim from the Satellite Wiki statistics** (brackets quote the article\'s own breakdown); the number this page can actually propagate — objects with full published elements — sits on the second line as a TLE-side cross-check.',
  '',
  '**About this project.** Fully open source under the [MIT license](https://opensource.org/licenses/MIT) — free to use, modify and distribute (full text at the end). Built by [小橙子的宇宙Jackoraniverse](' + BILI + ') with AI-agent vibe coding, styled after [Где «Рассветы»](https://findrassvet.ru/) (Bureau 1440\'s Rassvet tracker).',
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
  '- ⭕ **Pending groups**: the newest groups (Guowang 2026-176/187/213/221, Qianfan 2026-210/211) carry temporary 100xxx numbers and published summary parameters but no full TLE. They appear on the altitude chart as **hollow dots with dashed altitude ranges**, are not selectable or hoverable, and never show on the map or the globe.',
  '- 🔗 **View → table**: picking a satellite in any view makes the satellite table jump to its page and flash the row.',
  '- **The map is only a rough outline of continental coastlines and does not accurately represent any real map projection.**',
  '- 🗺️ **Map**: per-satellite ground coverage zones (adjustable minimum elevation, 35° by default), half-orbit ground tracks, 1–8× zoom;',
  '- 📍 **Ground site picker**: hover to preview the visibility region and satellite count in real time; click to fix a site and highlight what it can see;',
  '- 🌍 **3D globe (02)**: spin + drag + zoom, orbit rings split into front/back halves, coverage zones, with **altitudes exaggerated 2.4×** so the shells are easy to tell apart;',
  '- 📋 **Satellite table (04)**: 13 element columns (including days in orbit), autocomplete search, sorting, 10 rows per page — satellite names link straight to their satcat.com entries;',
  '- 🚀 **Launch history (05)**: column order is group · vehicle (followed by the COSPAR id) · launch time · launch site · design inclination · elements; rockets and sites are rendered in the constellation colour, underlined and clickable; 10 rows per page with wiki links; **click anywhere on a row** to select that group — the chart, map and globe highlight it, the satellite table auto-pages to the first satellite of that group under the current sort, and the row is boxed with one long red (Guowang) / blue (Qianfan) border; pending groups only carry a "pending ×N" tag — the full catalog summary sits in its tooltip instead of stretching the table;',
  '- 🎨 **UI**: dark/light themes, Chinese/English, fully responsive, one-click fullscreen, a section-jump pill and a live clock.',
  '',
  '## ⚙️ Settings: global, remembered, one-click restore',
  '',
  '- Every setting is **global and remembered** (localStorage): close the page, reopen it, or switch between Guowang and Qianfan — your settings are still there;',
  '- Sections 01 map, 02 globe, 03 orbit distribution and 04 satellite table each carry a **"Defaults"** button that restores only that section\'s own settings (e.g. map coverage on/off, minimum elevation, orbits, colors);',
  '- Right-aligned under the search box at the top sits **"Restore all defaults"**, which resets sections 01–04 in one go. On a fresh page everything is already default, so the button is **dimmed and disabled** until you change something;',
  '- **Initial defaults**: Y axis = SMA, model = Brouwer, colors = by satellite, group = all; map coverage on / min. elevation 10°, orbits on, names off; globe cones on / min. elevation 10°, spin on, orbits on; table sorted by satellite name ascending with the common columns only.',
  '',
  '## 🚀 Quick start',
  '',
  '1. Get `国网与千帆在轨追踪.html` (a single file);',
  '2. Open it in a modern browser — **no install, no network required**;',
  '3. Online, it fetches the latest elements for the two constellation groups (~30–40 KB each, within 6 s, otherwise it falls back to the built-in snapshot).',
  '',
  '## 🔭 Two ways to zoom (plus reset)',
  '',
  'All three views share the same controls:',
  '',
  '1. **Touch**: pinch with two fingers; drag with one finger afterwards — pan the map, rotate the globe, pan the chart;',
  '2. **Mouse**: wheel to zoom, drag to pan once zoomed, double-click to reset;',
  'The lower right carries, top to bottom: **＋ zoom in**, **− zoom out**, **⟳ reset to the original scale**, **⛶ fullscreen** and **🖨 save image**.',
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
  '- Once selected: the chart, map and globe highlight only that satellite/group and its orbit, other satellites dim and drop their orbits and coverage zones; the matching table row is boxed with **one long red (Guowang) / blue (Qianfan) border** and the tables jump to the page holding the first selected row under the current sort order;',
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
  'The "satellites launched", "satellites in orbit" and "launches succeeded" figures at the top are quoted **verbatim from the Satellite Wiki statistics** (checked 2026-09-30: Guowang 248 / 244 / 40-41, Qianfan 262 / 262 / 19-19), with the article\'s own breakdown in brackets. Only the LEO internet groups can actually be propagated by this page (shown on the second line); early test satellites, Guowang\'s GEO satellites and groups without published elements are not among them. Satellite names in the table link to their [satcat.com](https://www.satcat.com) entries.',
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
  'Made by [小橙子的宇宙Jackoraniverse](https://space.bilibili.com/455972735), styled after [Где «Рассветы»](https://findrassvet.ru/) by Bureau 1440'
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
  var s = '(' + gmtLabel(d, clockUTC) + ') ' + y + '/' + pad(mo + 1) + '/' + pad(da) + ' T ' +
    pad(h) + ':' + pad(mi) + ':' + pad(se);
  document.getElementById('clockTxt').textContent = s;
  // V1.3.5：02/03 全屏右上角的时间药丸同步同一份文字
  document.querySelectorAll('.fs-clock span').forEach(function (el) { el.textContent = s; });
}
// 时间被推离「此刻」→ 全屏时间药丸换黄色呼吸边框；回到实时 → 主题色细边框
function syncFsClockState() {
  var late = S.timeOffset !== 0;
  document.querySelectorAll('.fs-clock').forEach(function (el) { el.classList.toggle('late', late); });
}
document.getElementById('clockPill').addEventListener('click', function () { clockUTC = !clockUTC; tickClock(); });
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
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    if (sec.requestFullscreen) sec.requestFullscreen().catch(function () {});
  });
});
// 全屏左上角「恢复默认视图」：与页面里 #resetZoom 是同一个动作（图表回到自动视野，地图/地球回到 1×）
document.querySelectorAll('.fs-reset-btn').forEach(function (b) {
  b.addEventListener('click', function (e) {
    e.stopPropagation();
    resetView(b.getAttribute('data-fsreset'));
  });
});
// 01 章节全屏顶栏的实际高度（窄屏会换行变高）→ 写进 --fsbar-h，画布据此让位
function syncFsBarHeight() {
  var sec = document.getElementById('sec-chart');
  var c = sec && sec.querySelector('.controls');
  if (!c) return;
  var h = sec.classList.contains('fs-mobile') ? Math.ceil(c.getBoundingClientRect().height) : 0;
  sec.style.setProperty('--fsbar-h', (h || 58) + 'px');
}
document.querySelectorAll('.fs-exit-btn').forEach(function (b) {
  b.addEventListener('click', function (e) {
    e.stopPropagation();
    if (document.fullscreenElement) document.exitFullscreen();
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
}
document.addEventListener('fullscreenchange', function () {
  var fsEl = document.fullscreenElement;
  if (fsEl) reqWakeLock(); else dropWakeLock();
  // 切后台回来 Wake Lock 会被浏览器自动释放，回到前台且仍在全屏时重新申请
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && document.fullscreenElement) reqWakeLock(); else dropWakeLock();
  });
});
document.addEventListener('fullscreenchange', function () {
  var fsEl = document.fullscreenElement;
  document.querySelectorAll('section').forEach(function (s) {
    // V1.3.3：电脑端与手机端同款全屏（画布铺满 + 左侧可开合的设置小窗），不再按触屏区分
    var on = !!fsEl && s === fsEl;
    s.classList.toggle('fs-mobile', on);
    if (!on) s.classList.remove('panel-open');
  });
  syncFsBarHeight();
  try {
    if (fsEl && isTouch() && screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('landscape').catch(function () {});   // 移动端全屏转横屏
    } else if (screen.orientation && screen.orientation.unlock) {
      screen.orientation.unlock();
    }
  } catch (e) {}
  setTimeout(function () { drawChart(); mapDirty = globeDirty = true; }, 90);
});

// ================================================================ V1.3.0 交互增强
var mapTapAt = 0;

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
  range.addEventListener('input', function () {
    cfg.set(+this.value); syncNumBox(kind); mapDirty = globeDirty = true;
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
      cfg.set(next);
      range.value = String(next);
      box.textContent = fmtOne(next) + '°';
      mapDirty = globeDirty = true;
    }
    inp.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
      else if (ev.key === 'Escape') { box.textContent = fmtOne(prev) + '°'; }
    });
    inp.addEventListener('blur', commit);
  });
});

// ---- 选择：整批选中 / 全局退出 / 自动跳页
function selectGroup(lk) {
  var st = cur(), idxs = [];
  st.sats.forEach(function (s) { if (s.lk === lk) idxs.push(s.idx); });
  var allSel = idxs.length > 0 && idxs.every(function (i) { return S.sel.indexOf(i) >= 0; });
  S.sel = allSel ? [] : idxs;      // 再次点击同一批次 = 取消
  afterSelection();
}
function afterSelection() {
  updateSelClasses();
  drawChart(); renderLegend();
  renderTable({ jump: true });
  renderLaunchTable(true);
  // V1.3.5：选中变化后 01/02/03 三处信息窗立即锁定显示（用户才拖得动）；
  // ✕ 关掉后只要目标没变就不会再自动弹出（showInfo 里按 idKey 判断）。
  syncSelInfo();
  mapDirty = globeDirty = true;
}

// ---- 搜索（两个输入框同步联想，候选项竖向列出）
// 中英文双向可搜：把两种语言的名字/批次名都放进匹配串
function nameVariants(s) {
  var zh = s.name.replace(/^HULIANWANG DIGUI-(\d+)$/, '国网低轨-$1')
    .replace(/^GUOWANG TEST OBJECT ([A-Z])$/, '国网试验-$1')
    .replace(/^GUOWANG (\d+) OBJECT ([A-Z])$/, '国网$1组$2')
    .replace(/^QIANFAN (\d+) OBJECT ([A-Z])$/, '千帆$1组$2')
    .replace(/^QIANFAN-(\d+)$/, '千帆-$1');
  var en = s.name.replace(/^HULIANWANG DIGUI-(\d+)$/, 'Guowang LEO-$1')
    .replace(/^GUOWANG TEST OBJECT ([A-Z])$/, 'Guowang test-$1')
    .replace(/^GUOWANG (\d+) OBJECT ([A-Z])$/, 'Guowang G$1-$2')
    .replace(/^QIANFAN (\d+) OBJECT ([A-Z])$/, 'Qianfan G$1-$2')
    .replace(/^QIANFAN-(\d+)$/, 'Qianfan-$1');
  return zh + ' ' + en;
}
function batchVariants(name) {
  var zh = name, en = name.replace(/^低轨(\d+)组$/, 'LEO Group $1')
    .replace(/^极轨(\d+)组$/, 'Polar Group $1')
    .replace(/^试验星(\d+)组$/, 'Test Sat Group $1');
  return zh + ' ' + en;
}
function searchCandidates(q) {
  var st = cur(), ql = String(q || '').trim().toLowerCase(), groups = [], sats = [];
  if (!ql) return [];
  st.launches.forEach(function (L) {
    if (!L.sats.length) return;
    var hay = (L.name + ' ' + batchVariants(L.name) + ' ' + L.cospar + ' ' + L.dateStr.slice(0, 10)).toLowerCase();
    if (hay.indexOf(ql) >= 0) groups.push(L);
  });
  st.sats.forEach(function (s) {
    var hay = (s.name + ' ' + nameVariants(s) + ' ' + s.norad + ' ' + s.launch.name + ' ' +
      batchVariants(s.launch.name) + ' ' + s.cospar).toLowerCase();
    if (hay.indexOf(ql) >= 0) sats.push(s);
  });
  return groups.slice(0, 5).concat(sats.slice(0, 12));
}
// 四处联想搜索框（V1.3.3：全屏小窗里也各有一个），输入与候选互相同步
var SEARCH_BOXES = [
  { input: 'topSearch', sug: 'topSug' },
  { input: 'tableSearch', sug: 'tableSug' },
  { input: 'fsSearchMap', sug: 'fsSugMap' },
  { input: 'fsSearchGlobe', sug: 'fsSugGlobe' }
];
function renderSug(listId, q) {
  var el = document.getElementById(listId); if (!el) return;
  if (!String(q || '').trim()) { el.classList.remove('open'); el.innerHTML = ''; return; }
  var list = searchCandidates(q);
  if (!list.length) {
    el.innerHTML = '<div class="sug-item" style="cursor:default">' + t('d_search_none') + '</div>';
    el.classList.add('open'); return;
  }
  el.innerHTML = list.map(function (o) {
    if (o.sats) {
      return '<div class="sug-item" data-kind="group" data-lk="' + o.key + '"><b>' + batchName(o.name) + '</b><span>' +
        o.dateStr.slice(0, 10) + ' · ' + o.sats.length + (LANG === 'en' ? ' sats' : ' 颗') + '</span></div>';
    }
    return '<div class="sug-item" data-kind="sat" data-idx="' + o.idx + '"><b>' + cnName(o) + '</b><span>' +
      batchName(o.launch.name) + ' · ' + o.norad + '</span></div>';
  }).join('');
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
  el.addEventListener('input', function () { applySearch(this); });
  el.addEventListener('focus', function () {
    if (this.value.trim()) renderSug(b.sug, this.value);
  });
});
SEARCH_BOXES.forEach(function (b) {
  var el = document.getElementById(b.sug); if (!el) return;
  el.addEventListener('mousedown', function (e) {
    var it = e.target.closest('.sug-item'); if (!it) return;
    e.preventDefault();
    if (it.getAttribute('data-kind') === 'group') selectGroup(it.getAttribute('data-lk'));
    else { S.sel = [+it.getAttribute('data-idx')]; afterSelection(); }
    closeSug();
  });
});
document.addEventListener('click', function (e) { if (!e.target.closest('.search-wrap')) closeSug(); });
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
var JUMP = [['top', '↑', '↑'], ['sec-map', 'M', '图'], ['sec-orbits', 'O', '轨'], ['sec-chart', 'I', '角'], ['sec-table', 'S', '星'], ['sec-launches', 'L', '箭'], ['bottom', '↓', '↓']];
var JUMP_TITLE = {
  top: { zh: '回到顶部', en: 'Back to top' },
  'sec-map': { zh: '01 地图', en: '01 Map' },
  'sec-orbits': { zh: '02 轨道', en: '02 Orbits' },
  'sec-chart': { zh: '03 轨道分布', en: '03 Orbit distribution' },
  'sec-table': { zh: '04 卫星表格', en: '04 Satellite table' },
  'sec-launches': { zh: '05 发射历史', en: '05 Launch history' },
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

// 顶栏高度 → CSS 变量（时钟药丸与锚点定位都依据它）
function layoutNav() {
  document.documentElement.style.setProperty('--nav-h', navHeight() + 'px');
}
window.addEventListener('resize', function () { layoutNav(); syncFsBarHeight(); });

// ---------------------------------------------------------------- 语言切换
document.getElementById('langBtn').addEventListener('click', function () {
  LANG = LANG === 'en' ? 'zh' : 'en';   // V1.3.6：不写 localStorage，刷新后回到默认中文
  applyStaticLang();
  renderChrome();
  refreshJumpTitles();
  rebuild();
  setOffset(S.timeOffset);
  setPick(S.pick.on);
  updatePickHint();
  mapDirty = globeDirty = true;
});
var frameStates = null, lastSec = 0, lastGlobeDraw = 0;
function loop() {
  requestAnimationFrame(loop);
  var now = performance.now();
  var ms = Date.now() + S.timeOffset * 60000;
  var sec = Math.round(ms / 1000);
  var fresh = (sec !== lastSec || !frameStates);
  if (fresh) { frameStates = propagateAll(ms); lastSec = sec; }
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
  if (isVisible(mapCv) && (mapDirty || fresh)) { drawMap(frameStates, ms); mapDirty = false; }
  // V1.4.5：自转时的重绘从 30fps 再收到 20fps（每 50ms 一帧）—— 自转是慢动作，20fps 看不出差别，
  // 但每帧要重画 400 多颗卫星与轨道圈，降下来省掉的正是这部分开销。
  if (isVisible(globeCv) && (globeDirty || fresh) && (now - lastGlobeDraw > 50)) {
    drawGlobe(frameStates, ms); globeDirty = false; lastGlobeDraw = now;
  }
}
// V1.4.5：resize 不再把地球缩放清零（改用倍数存储，见 globeRadNow），
// 也不再清 frameStates —— 推算结果与画布尺寸无关，清掉只是白算一次全量 SGP4。
window.addEventListener('resize', function () { drawChart(); });

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
  Promise.all([tryOne('gw'), tryOne('qf')]).then(function (r) {
    if (!r[0] || !r[1]) { throw new Error('empty'); }
    var ep = applyFresh(r[0], r[1]);
    checkNewSats();                     // V1.4.2：对一下在线目录与内置快照，有新卫星就提示
    setLoadEpoch(t('d_epoch') + ' ' + fmtUTC(CONST[S.key] ? CONST[S.key].epochMax : ep) + ' UTC');
    endLoad(t('d_updated'), true);      // V1.3.9：纪元只留在加载圈下面那行
  }).catch(function () {
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
rebuild();
BUILTIN_NORAD = noradSetNow();          // V1.4.2：先记下内置快照有哪些 NORAD 编号
// 第三行：内置快照的要素历元（联网成功后再刷新成最新的）
setLoadEpoch(t('d_epoch') + ' ' + fmtUTC(cur().epochMax) + ' UTC');
// V1.3.4：先恢复上次保存的设置（初始打开就是默认配置，此时「还原所有默认设置」暗淡不可点）
// V1.4.1：不再读取上次的设置 —— 每次打开都是默认初始状态（默认配置 + 实时时刻 + 暗色主题）。
// 会话内的改动照常生效，各章节「默认设置」按钮照常可用，只是不会跨会话沿用。
// prefSnap / PREF_DEF / PREF_SEC 仍然保留，供「默认设置」按钮还原使用。
syncAllControls();
syncResetAllBtn();
setOffset(S.timeOffset);
layoutNav();
updateJumpActive();
setPick(S.pick.on);
setupInfo(chartInfo, 'chart');
setupInfo(mapInfo, 'map');
setupInfo(globeInfo, 'globe');
loop();

// 各章节的「默认设置」：只还原该章节那几项
document.querySelectorAll('[data-defsec]').forEach(function (b) {
  b.addEventListener('click', function () { resetSection(b.getAttribute('data-defsec')); });
});
// 「还原所有默认设置」：01–04 全部回到初始配置
document.getElementById('resetAllBtn').addEventListener('click', function () { resetAllPrefs(); });

})();
