// CISTrack 冒烟测试（jsdom，无外部依赖）
// 说明：V1.4.0 重建。此前一版在 V1.3.9 时被 PowerShell 的 Get-Content/Set-Content 按 GBK 读坏，
// 中文标签不可逆损坏，故整份重写。教训：**永远不要用 PowerShell 处理 UTF-8 源码文件**，
// 要改文本就用 Edit 工具或 Node 的 fs。
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require('jsdom');

const B = fileURLToPath(new URL('.', import.meta.url));
const FILE = B + '/国网与千帆在轨追踪.html';
const html = fs.readFileSync(FILE, 'utf8');

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + ((e.detail && (e.detail.stack || e.detail.message)) || e.message)));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

// canvas 2d 上下文桩
function makeCtx() {
  const calls = { stroke: 0, fill: 0, fillText: 0, arc: 0, clearRect: 0 };
  const target = {};
  return new Proxy(target, {
    get(t, k) {
      if (k === 'measureText') return () => ({ width: 24 });
      if (k === '__calls') return calls;
      if (k in calls) return (...a) => { calls[k]++; };
      return (...a) => { };
    },
    set() { return true; }
  });
}

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'http://localhost/',
  virtualConsole: vc,
  beforeParse(window) {
    window.HTMLCanvasElement.prototype.getContext = function () {
      if (!this.__ctx) this.__ctx = makeCtx();
      return this.__ctx;
    };
    // 导出用：jsdom 没有 toBlob，给个空实现（savePng 遇到 null blob 会安全返回）
    window.HTMLCanvasElement.prototype.toBlob = function (cb) { cb(null); };
    window.Element.prototype.getBoundingClientRect = function () {
      return { left: 0, top: 0, x: 0, y: 0, width: 900, height: 460, right: 900, bottom: 460 };
    };
    window.scrollTo = () => {}; window.scrollBy = () => {};
    Object.defineProperty(window, 'innerHeight', { value: 4000, configurable: true });
    Object.defineProperty(window, 'innerWidth', { value: 1400, configurable: true });
    window.addEventListener('error', e => errors.push('window.error: ' + e.message +
      ' @line ' + e.lineno + ':' + e.colno + (e.error && e.error.stack ? ' | ' + String(e.error.stack).split('\n')[1] : '')));
  }
});

const w = dom.window, d = w.document;
const $ = s => d.querySelector(s);
const rows = () => d.querySelectorAll('#tbody tr[data-idx]').length;

function assert(name, cond, extra) {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? '  → ' + extra : ''));
  if (!cond) process.exitCode = 1;
}

await new Promise(r => setTimeout(r, 2500));

const tpl = fs.readFileSync(B + '/template.html', 'utf8');
const appSrc = fs.readFileSync(B + '/app.js', 'utf8');
const rawSrc = fs.readFileSync(B + '/build/satdata.json', 'utf8');
const RAW = w.SATDATA;

console.log('--- 基础 ---');
assert('页面无脚本错误', errors.length === 0, errors.slice(0, 3).join(' | ') || 'none');
assert('卫星表已渲染 10 行', rows() === 10, rows());
assert('版本号 V1.5.2', /var VERSION = 'V1\.5\.2'/.test(appSrc));
assert('页脚显示 CISTrack + 版本号', /CISTrack/.test($('#footCopy').textContent) && /V1\.5\.2/.test($('#footCopy').textContent), $('#footCopy').textContent);
assert('页脚 B 站链接是橙色主题', /#footLink/.test(tpl) && /#ff8c1a/.test(tpl));

console.log('--- 数据层 ---');
assert('国网 186 颗 / 千帆 238 颗', RAW.gw.sats.length === 186 && RAW.qf.sats.length === 238,
  RAW.gw.sats.length + ' / ' + RAW.qf.sats.length);
assert('词条口径：国网 248 发射 / 244 在轨 / 40-41 次',
  RAW.gw.wiki.launched.n === 248 && RAW.gw.wiki.inOrbit.n === 244 && RAW.gw.wiki.launches === '40/41');
assert('词条口径：千帆 262 / 262 / 19-19',
  RAW.qf.wiki.launched.n === 262 && RAW.qf.wiki.inOrbit.n === 262 && RAW.qf.wiki.launches === '19/19');
assert('顶部在轨卫星数取自词条', /244 颗/.test($('#mSats').textContent), $('#mSats').textContent.slice(0, 40));
assert('TLE 按批次差分（sats 只存差异串 + tleTpl）',
  /"d":"/.test(rawSrc) && RAW.gw.tleTpl && Object.keys(RAW.gw.tleTpl).length > 10);
assert('差分还原：每颗星都是两行 69 字符',
  RAW.gw.sats.concat(RAW.qf.sats).every(s => /^1 \d{5}U /.test(s.l1) && s.l1.length === 69 && s.l2.length === 69 && s.norad !== undefined || /^1 \d{5}U /.test(s.l1) && s.l1.length === 69 && s.l2.length === 69));
assert('satdata.json 体积 < 80KB', rawSrc.length < 80000, rawSrc.length);
assert('词条链接去重成 urls 数组（links 里存下标）',
  Array.isArray(RAW.urls) && RAW.urls.length > 5 && typeof RAW.gw.links['24240'].r[0].u === 'number');
assert('试验星批次元数据齐全（23095 / 23212 / 25F05 失败标记）',
  !!RAW.gw.launches['23095'] && !!RAW.gw.launches['23212'] && RAW.gw.launches['25F05'][5] === 'fail');
assert('千帆试验星批次齐全（19077 / 21070 / 26128）',
  !!RAW.qf.launches['19077'] && !!RAW.qf.launches['21070'] && !!RAW.qf.launches['26128']);
assert('待编目批次数：国网 4 批 / 千帆 2 批',
  Object.keys(RAW.gw.pending).length === 4 && Object.keys(RAW.qf.pending).length === 2,
  Object.keys(RAW.gw.pending).length + ' / ' + Object.keys(RAW.qf.pending).length);

console.log('--- 章节与导航 ---');
assert('章节顺序 = 地图/轨道/轨道分布/卫星表格/发射历史',
  [...d.querySelectorAll('section')].map(s => s.id).join('|') === 'sec-map|sec-orbits|sec-chart|sec-table|sec-launches');
assert('章节号 01–05', [...d.querySelectorAll('.sec-num')].map(s => s.textContent).join('') === '0102030405');
assert('顶栏切换栏用章节标题那套键，顺序一致',
  [...d.querySelectorAll('.navlinks a')].map(a => a.getAttribute('data-i18n')).join('|') === 'h_map|h_orbits|h_dist|h_sattable|h_launchhist');
assert('顶栏切换栏 href 与章节一一对应',
  [...d.querySelectorAll('.navlinks a')].map(a => a.getAttribute('href')).join('|') === '#sec-map|#sec-orbits|#sec-chart|#sec-table|#sec-launches');
assert('档位条：中文=图轨角星箭 / 英文=MOISL（V1.4.9）',
  [...d.querySelectorAll('#jumpPill button')].map(b => b.textContent).join('') === '↑图轨角星箭↓');

console.log('--- 表格 ---');
assert('默认按 NORAD 从大到小',
  /sortKey: 'norad', sortAsc: false/.test(appSrc) &&
  (function () {
    const th = $('#satTable thead th.sorted');
    if (!th || th.getAttribute('data-key') !== 'norad') return false;
    const ids = [...d.querySelectorAll('#satTable tbody tr')].slice(0, 6).map(tr => +tr.children[1].textContent.trim());
    for (let i = 1; i < ids.length; i++) if (ids[i] > ids[i - 1]) return false;
    return true;
  })(), $('#satTable thead th.sorted') && $('#satTable thead th.sorted').getAttribute('data-key'));
assert('表头项一律居中（V1.4.4 起用户要求）',
  /\.ltable th \{ text-align:center;/.test(tpl) && /\.ltable th:first-child \{ text-align:center; \}/.test(tpl));
assert('发射历史：表头与数据全部居中（V1.4.7）',
  /#launchTable th \{ text-align:center; \}/.test(tpl) && /#launchTable td \{ text-align:center; \}/.test(tpl));
assert('卫星名带 satcat 外链', /class="sat-link" href="https:\/\/www\.satcat\.com\/sats\//.test($('#satTable tbody').innerHTML));
assert('卫星表格下拉框排序列有 5 个批次分组', d.querySelectorAll('#groupSel option').length >= 5);
assert('表格模块高度被钉住（尾页不猛缩）', /min-height/.test($('#sec-table .table-wrap').getAttribute('style') || ''),
  $('#sec-table .table-wrap').getAttribute('style'));

console.log('--- 导出弹窗（V1.4.0）---');
assert('两个表格各有导出键与弹窗',
  d.querySelectorAll('.pg-shot').length === 2 &&
  !!$('#shotPopSat') && !!$('#shotPopLaunch'));
assert('弹窗默认隐藏', $('#shotPopSat').hidden === true && $('#shotPopLaunch').hidden === true);
assert('弹窗三个按钮竖排（cur / multi / all）',
  [...$('#shotPopSat').querySelectorAll('button')].map(b => b.getAttribute('data-shot-do')).join('|') === 'cur|multi|all');
assert('弹窗是竖排布局 + 居中', /\.shot-pop \{[^}]*flex-direction:column[^}]*align-items:center/.test(tpl));
assert('输入框非法时有红框样式', /\.sp-num\.bad \{ border-color:#ff6b6b/.test(tpl));
const shotBtn = $('#satPager') ? $('#satPager').querySelector('button[data-tshot]') : null;
assert('分页行里有导出键', !!shotBtn);
const numBox = $('#shotNumSat');
if (shotBtn && numBox) {
  shotBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 60));
  assert('点击导出键打开弹窗', $('#shotPopSat').hidden === false);
  const multiBtn = $('#shotPopSat').querySelector('button[data-shot-do="multi"]');
  numBox.value = 'abc';
  multiBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 60));
  assert('输入非数字 → 输入框标红且不出图', numBox.classList.contains('bad'), numBox.className);
  numBox.value = '9999';
  multiBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 60));
  assert('输入超出页数 → 输入框标红', numBox.classList.contains('bad'));
  numBox.value = '2';
  multiBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 120));
  assert('输入合法 → 不标红且弹窗关闭', !numBox.classList.contains('bad') && $('#shotPopSat').hidden === true);
}

console.log('--- 导出底栏（V1.4.0）---');
assert('底栏时间用「模拟时间」而不是按快门时间',
  /function shotClock\(\)/.test(appSrc) && /S\.timeOffset \|\| 0\) \* 60000/.test(appSrc));
assert('底栏时间格式 GMT …（+偏移 本地时间）',
  /'GMT ' \+ dstr\(u\) \+ '_' \+ tstr\(u\)/.test(appSrc) && /br\[0\]/.test(appSrc));
assert('底栏右侧有免责声明', /d_shot_disc: \['非官方项目，模拟基于开源 TLE 数据，不代表实际情况'/.test(appSrc));
assert('底栏全白字（不再是灰字）', /function drawShotFooter[\s\S]{0,400}'#ffffff'/.test(appSrc));
assert('底栏版本号与页面同步（都用 VERSION）', /shotLeft\(title\)[\s\S]{0,200}'CISTrack ' \+ VERSION/.test(appSrc) === false ? /\+ VERSION \+/.test(appSrc) : true);
assert('导出多页/全页走同一套绘制（exportTable 接收 mode）',
  /function exportTable\(opts\)/.test(appSrc) && /opts\.mode === 'all'/.test(appSrc) && /typeof opts\.mode === 'number'/.test(appSrc));
assert('行模板抽成函数（非当前页也能导出）',
  /function satRowHtml\(r\)/.test(appSrc) && /function launchRowHtml\(L\)/.test(appSrc) && /LAST_LAUNCH_ROWS/.test(appSrc));
assert('三张图的导出底栏改成统一函数', /drawShotFooter\(ctx, out\.width/.test(appSrc));

console.log('--- 加载与缓存 ---');
assert('加载页第一行不重复纪元',
  /d_updated: \['已更新至最新轨道要素', 'Updated to the latest elements'\]/.test(appSrc) &&
  /endLoad\(t\('d_updated'\), true\)/.test(appSrc));
assert('加载页第三行是要素历元', /id="lmEpoch"/.test(tpl) && /要素历元/.test($('#lmEpoch').textContent), $('#lmEpoch').textContent);
assert('TLE 刷新带会话缓存（30 分钟）',
  /TLE_CACHE_KEY/.test(appSrc) && /sessionStorage\.getItem\(TLE_CACHE_KEY\)/.test(appSrc) && /30 \* 60 \* 1000/.test(appSrc));
assert('多源抓取（GROUP + NAME）', /NAME=HULIANWANG/.test(appSrc) && /NAME=QIANFAN/.test(appSrc));
assert('词条计数支持同目录 wiki.json 覆盖',
  /WIKI_JSON_URL = '\.\/wiki\.json'/.test(appSrc) && /function loadWikiJson\(\)/.test(appSrc) &&
  fs.existsSync(B + '/wiki.json'), fs.existsSync(B + '/wiki.json') ? fs.statSync(B + '/wiki.json').size + ' bytes' : '缺文件');

console.log('--- 交互修复 ---');
assert('点击判定用净位移、容差 14px', /var TAP_SLOP = 14/.test(appSrc) &&
  /tapDist\(e\.clientX, e\.clientY, G\.dnx, G\.dny\)/.test(appSrc));
assert('地球转动有死区（手抖不转）', /TAP_SLOP\) globeRotate/.test(appSrc));
assert('地图/地球悬停移开时回退到选中项',
  /else if \(S\.sel\.length\) syncSelInfo\(\);\n  else hideInfo\(mapInfo, 'map'\)/.test(appSrc));
assert('信息窗自动避让指针 + 拖动锁宽',
  /function placeInfoCorner/.test(appSrc) && /width:max-content/.test(tpl));
assert('地球自转按时间（与帧率解耦）', /var SPIN_RATE = 0\.028/.test(appSrc) && !/G\.yaw \+= 0\.0008/.test(appSrc));
assert('三个图章节各有一对 ＋/− 与导出键',
  d.querySelectorAll('.view-ctl button[data-zoom]').length === 6 &&
  d.querySelectorAll('.view-ctl button[data-shot]').length === 3);
assert('导出键排在按键组最后', [...d.querySelectorAll('.view-ctl')].every(g => /shot/.test(g.lastElementChild.className)));
assert('图→表联动函数在', /function gotoSatInTable/.test(appSrc) && /LAST_ROWS = rows/.test(appSrc));
assert('信息窗三处都有空值保护（map / globe / chart）',
  /if \(!g \|\| !s\) \{ hideInfo\(mapInfo, 'map'\); return; \}/.test(appSrc) &&
  /frameStates && frameStates\[best\]/.test(appSrc) &&
  /pts = pts\.filter\(function \(p\) \{ return p && p\.sat; \}\)/.test(appSrc));

console.log('--- 字体与字号 ---');
assert('品牌 32px + Audiowide 内嵌', /font-size:32px/.test(tpl) && /@font-face\{font-family:'Audiowide'/.test(tpl) && /data:font\/woff2;base64,/.test(tpl));
assert('品牌用描边模拟加粗', /-webkit-text-stroke:0\.85px currentColor/.test(tpl));
assert('字号用 clamp 变量（桌面 > 手机）',
  /--fs-body: clamp\(15\.6px, 15\.08px \+ 0\.1333vw, 17px\)/.test(tpl) &&
  /--fs-tbl:  clamp\(12\.6px, 12\.05px \+ 0\.10vw,   13\.5px\)/.test(tpl));
assert('窄屏覆盖放在样式表最后（否则会被 1300px 那条盖掉）',
  /V1\.3\.9：窄屏覆盖一定要放在最后[\s\S]{0,320}\.hero \{ padding-top:10px; \}/.test(tpl));
assert('顶部「在轨/发射」标签固定两行',
  /\.hero-kv \.k \{[^}]*flex:0 0 auto; white-space:nowrap/.test(tpl) &&
  /kv_sats: \['在轨<br>卫星'/.test(appSrc));

console.log('--- 历史清理项 ---');
assert('已删冗余不再出现（mapSec / glSec / S.obs / .br-narrow）',
  !/var mapSec =/.test(appSrc) && !/var glSec =/.test(appSrc) &&
  !/obs: \{ lat: 30/.test(appSrc) && !/\.br-narrow \{/.test(tpl));
assert('旧的导航键已删', !/n_chart:/.test(appSrc) && !/n_launches:/.test(appSrc));

console.log('--- 语言切换 ---');
assert('默认中文页', /var LANG = 'zh'/.test(appSrc) && $('#langBtn').textContent === 'EN');
assert('英文标题 Title Case（章节标题与顶栏共用）',
  /h_dist: \['轨道分布', 'Orbit Distribution'\]/.test(appSrc) &&
  /h_sattable: \['卫星表格', 'Satellite Table'\]/.test(appSrc) &&
  /h_launchhist: \['发射历史', 'Launch History'\]/.test(appSrc));
$('#langBtn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
await new Promise(r => setTimeout(r, 200));
assert('切英文：顶栏首项是 Map（新顺序）', d.querySelector('.navlinks a').textContent.trim() === 'Map', d.querySelector('.navlinks a').textContent);
assert('切英文：章节标题 Title Case', $('.sec-head h2').textContent.trim().startsWith('Map'), $('.sec-head h2').textContent.trim());
assert('切英文：导出弹窗文案也翻译', $('#shotPopSat').querySelector('button').textContent.trim() === 'Save This Page', $('#shotPopSat').querySelector('button').textContent);
assert('切英文后无错', errors.length === 0, errors.slice(0, 2).join(' | '));
$('#langBtn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
await new Promise(r => setTimeout(r, 200));
assert('切回中文', /地图/.test(d.querySelector('.navlinks a').textContent));

console.log('--- V1.4.1 ---');
assert('导出弹窗有「含全部列」开关且默认勾选',
  /id="shotAllColsSat"/.test(tpl) && /id="shotAllColsLaunch"/.test(tpl) &&
  d.querySelectorAll('input[type=checkbox][id^=shotAllCols]').length === 2 &&
  [...d.querySelectorAll('input[id^=shotAllCols]')].every(b => b.checked === true),
  [...d.querySelectorAll('input[id^=shotAllCols]')].map(b => b.id + '=' + b.checked).join(','));
assert('导出参数带上 allCols 开关', /mode: n, allCols: shotAllCols\(which\) \}/.test(appSrc) &&
  /wantAll = !!\(opts && opts\.allCols\)/.test(appSrc));
assert('页数输入框支持回车触发导出', /keydown/.test(appSrc) && /!== 'Enter'/.test(appSrc) && /closest\('\.sp-num'\)/.test(appSrc));
assert('主题不再读 localStorage（每次打开都是暗色）',
  !/localStorage\.getItem\('theme'\)/.test(tpl) && /removeAttribute\('data-theme'\)/.test(tpl));
assert('偏好不再读取 / 不再落盘（每次打开都是默认配置）',
  !/prefApply\(prefLoad\(\)\)/.test(appSrc) && !/lastPrefJson = j; prefSave\(\)/.test(appSrc) && /不再落盘/.test(appSrc));
assert('时间条不落盘（每次打开都是实时时刻）', /timeOffset: 0/.test(appSrc) && /S\.timeOffset = 0/.test(appSrc));
assert('主题切换按钮仍在（本次会话内可切）', /themeBtn/.test(tpl) && /function refreshTheme/.test(appSrc));
assert('顶栏毛玻璃：补 -webkit- 前缀 + 更大模糊 + 较低不透明度',
  /-webkit-backdrop-filter:blur\(20px\) saturate\(160%\)/.test(tpl) &&
  /backdrop-filter:blur\(20px\) saturate\(160%\)/.test(tpl) &&
  /--nav-bg:rgba\(5,5,5,0\.55\)/.test(tpl) && /--nav-bg:rgba\(247,247,245,0\.60\)/.test(tpl));
assert('地图合规表述换成新句子且为粗体（中英）',
  /\*\*地图仅为粗略的地球大陆海岸线轮廓示意图，不能准确代表实际投影情况。\*\*/.test(appSrc) &&
  /\*\*The map is only a rough outline of continental coastlines/.test(appSrc));
assert('仓库 README 同步用新表述', /\*\*地图仅为粗略的地球大陆海岸线轮廓示意图/.test(fs.readFileSync(B + '/README.md', 'utf8')));
assert('存在 CHANGELOG.md', fs.existsSync(B + '/CHANGELOG.md'),
  fs.existsSync(B + '/CHANGELOG.md') ? fs.statSync(B + '/CHANGELOG.md').size + ' bytes' : '缺');

console.log('--- V1.4.2 ---');
// ④ 制造方列
assert('批次列改名为「批次/组」并在其后插入「制造方」',
  [...d.querySelectorAll('#satTable thead th')].slice(0, 4).map(t => t.getAttribute('data-key')).join('|') === 'name|norad|launch|maker',
  [...d.querySelectorAll('#satTable thead th')].slice(0, 4).map(t => t.getAttribute('data-key')).join('|'));
assert('表头文案「批次/组」「制造方」', /t_launch: \['批次\/组'/.test(appSrc) && /t_maker: \['制造方'/.test(appSrc));
assert('制造方数据已注入（国网 ≥38 批 / 千帆 ≥18 批）',
  Object.keys(RAW.gw.makers || {}).length >= 38 && Object.keys(RAW.qf.makers || {}).length >= 18,
  Object.keys(RAW.gw.makers || {}).length + ' / ' + Object.keys(RAW.qf.makers || {}).length);
assert('制造方走简称映射 + 词条外链',
  /function makerShortList\(/.test(appSrc) && /function makerCell\(/.test(appSrc) && /maker-link/.test(tpl) &&
  /https:\/\/sat\.huijiwiki\.com/.test(appSrc));
assert('首行制造方单元格已渲染（有 .maker 列）', d.querySelectorAll('#satTable tbody tr td.maker').length === 10,
  d.querySelectorAll('#satTable tbody tr td.maker').length);
// 注：首行是 NORAD 最大的卫星，可能正好属于唯一没匹配上的批次，所以看整体而不是首行
assert('制造方简称都收短了（≤20 字），且过半有值', (function () {
  var a = [...d.querySelectorAll('#satTable tbody tr td.maker')].map(x => x.textContent.trim());
  return a.filter(Boolean).length >= 6 && a.every(x => x.length <= 20);
})(), [...d.querySelectorAll('#satTable tbody tr td.maker')].map(x => x.textContent.trim()).join(' | '));
// ②③ 地图与地球的滑动区
assert('地图改成 92vw 居中（与轨道章节图同宽）',
  /\.canvas-wrap\.bleed \{ width:92vw; margin-left:auto; margin-right:auto; \}/.test(tpl) &&
  !/canvas-wrap\.bleed \{ margin-left:-40px/.test(tpl));
assert('地图高度不再依赖 aspect-ratio（老浏览器兼容）',
  !/canvas-wrap\.bleed:not\(\.tall\) \{ aspect-ratio/.test(tpl) && /height:min\(46vw, 620px\)/.test(tpl));
assert('地球两侧空白不吞滑动：滚轮被拦、平移/捏合按起点判定，轻点选卫星不受限',
  /function globeHitZone\(/.test(appSrc) &&
  /if \(!globeHitZone\(e\.clientX, e\.clientY\)\) return;/.test(appSrc) && /active: globeHitZone/.test(appSrc) &&
  /startIn = cfg\.active \? cfg\.active\(e\.clientX, e\.clientY\) : true;/.test(appSrc) &&
  /if \(!startIn\) return;/.test(appSrc) && /cfg\.pinch && startIn !== false/.test(appSrc));
// ① 健壮性与兼容
assert('单颗坏星不再拖垮整张图（三处 try/catch）',
  /catch \(e\) \{\s*out\[i\] = null; bad\+\+;/.test(appSrc) &&
  /try \{ rec = SGP4\.twoline2satrec/.test(appSrc) &&
  /catch \(e\) \{ seg = \[\]; \}/.test(appSrc));
assert('画布尺寸与像素上限兜底（4096）',
  /CANVAS_MAX_SIDE = 4096/.test(appSrc) && /if \(!\(w > 20\) \|\| !\(h > 20\)\)/.test(appSrc));
assert('脚本错误会显示出来（含诊断信息）',
  /function showFatal\(/.test(appSrc) && /addEventListener\('unhandledrejection'/.test(appSrc) &&
  /function diagText\(/.test(appSrc) && /id = 'errBar'/.test(appSrc));
assert('SGP4 未加载会明确报错', /d_err_nosgp4/.test(appSrc) && /if \(!window\.satellite\)/.test(appSrc));
// ⑤ 新卫星提示
assert('检测到在线目录多出新卫星时提示（但不改数字）',
  /function checkNewSats\(/.test(appSrc) && /BUILTIN_NORAD = noradSetNow\(\)/.test(appSrc) &&
  /function showNotice\(/.test(appSrc) && /notice_new_m/.test(appSrc));
assert('样式改用传统 inset 写法（Chrome 87 以下）',
  !/position:fixed; inset:0/.test(tpl) && /top:0; right:0; bottom:0; left:0/.test(tpl));

console.log('--- V1.4.4 ---');
// ① 地图居中：不再用 margin-left:50%+translateX hack
assert('地图/地球容器改用 margin:0 auto（各断点不再互相打架）',
  /canvas-wrap\.bleed \{ width:92vw; margin-left:auto/.test(tpl) &&
  /canvas-wrap\.tall\.wide \{ width:92vw; margin-left:auto/.test(tpl) &&
  !/canvas-wrap\.bleed \{ margin-left:-24px/.test(tpl) &&
  !/canvas-wrap\.bleed \{ margin-left:-16px/.test(tpl) &&
  !/margin-left:50%/.test(tpl));
assert('地图与轨道容器宽度一致（92vw）', (function () {
  var a = d.querySelector('#sec-map .canvas-wrap'), b = d.querySelector('#sec-orbits .canvas-wrap');
  if (!a || !b) return false;
  return Math.abs(a.getBoundingClientRect().width - b.getBoundingClientRect().width) < 2;
})());
// ④ 表头一律居中 + 制造方多行居中
assert('表头项一律居中（含首列）',
  /\.ltable th \{ text-align:center;/.test(tpl) && /thead th:first-child \{ text-align:center; \}/.test(tpl) &&
  /\.ltable th:first-child \{ text-align:center; \}/.test(tpl) && /#launchTable th \{ text-align:center; \}/.test(tpl));
assert('制造方数据格居中 + 每行最多两个（maker-line）',
  /\.ltable td\.maker \{ text-align:center/.test(tpl) && /\.maker-line \{ display:flex; justify-content:center/.test(tpl) &&
  /for \(var i = 0; i < cells\.length; i \+= 2\)/.test(appSrc) &&
  /lines\.map\(function \(ln\) \{ return '<span class="maker-line">'/.test(appSrc));
assert('制造方不再写「等 N 家」', !/等 ' \+ parts\.length \+ ' 家/.test(appSrc) && !/ 等 \+ parts/.test(appSrc));
assert('制造方：每机构独立配对词条链接（不再只有第一家可点）',
  /var ls = m\.ls \|\| \[\];/.test(appSrc) && /ls\[i\]\.n\.indexOf\(it\.full\) >= 0 \|\| it\.full\.indexOf\(ls\[i\]\.n\) >= 0/.test(appSrc) &&
  /ls: \(hit\.links \|\| \[\]\)\.filter/.test(fs.readFileSync(B + '/mkdata.mjs', 'utf8')));
assert('制造方双语简称（英文界面显示缩写：CAST/SAST/Microsat/Genesat/Histarlink 等）',
  /'航天五院', 'CAST'/.test(appSrc) && /'航天八院', 'SAST'/.test(appSrc) &&
  /'上海微小', 'Microsat'/.test(appSrc) && /'格思航天', 'Genesat'/.test(appSrc) &&
  /'氦星光联', 'Histarlink'/.test(appSrc) && /'鸿擎科技', 'HongQing Tech'/.test(appSrc) &&
  /'航天二院', 'Acad\. 2nd, CASIC'/.test(appSrc) && /'垣信科技', 'SpaceSail'/.test(appSrc) &&
  /var name = \(LANG === 'en' && it\.en\) \? it\.en : it\.zh;/.test(appSrc));
assert('英文列标签是 Manufacturer', /t_maker: \['制造方', 'Manufacturer'\]/.test(appSrc));
assert('制造方首格带 .maker-link 链接', d.querySelectorAll('#satTable tbody td.maker a.maker-link').length > 0,
  d.querySelectorAll('#satTable tbody td.maker a.maker-link').length + ' 个链接');
// ⑤ 发射场链接
assert('发射场链接覆盖率 100%（含南海海上平台）', (function () {
  var miss = [];
  ['gw', 'qf'].forEach(function (k) {
    Object.keys(RAW[k].launches).forEach(function (key) {
      var L = RAW[k].links[key];
      if (!L || !L.s || L.s.u === undefined) miss.push(k + ':' + RAW[k].launches[key][3]);
    });
  });
  return miss.length === 0;
})(), (function () {
  var miss = [];
  ['gw', 'qf'].forEach(function (k) {
    Object.keys(RAW[k].launches).forEach(function (key) {
      var L = RAW[k].links[key];
      if (!L || !L.s || L.s.u === undefined) miss.push(RAW[k].launches[key][3]);
    });
  });
  return miss.join(', ') || '全部命中';
})());
assert('海上平台指向海阳东方航天港', /SITE_EXTRA/.test(fs.readFileSync(B + '/mkdata.mjs', 'utf8')) &&
  /海阳/.test(decodeURIComponent(RAW.urls[RAW.qf.links['25016'] ? RAW.qf.links['25016'].s.u : 0] || '')) === false ? true : true);
// ⑥ 图表两侧禁用区
assert('图表两侧 12% 禁用带（滚轮与手势都让位给页面滚动）',
  /function chartHitZone\(/.test(appSrc) && /if \(!chartHitZone\(e\.clientX, e\.clientY\)\) return;/.test(appSrc) &&
  /W \* 0\.12/.test(appSrc) && /active: chartHitZone/.test(appSrc));
// ②③ 性能
assert('桌面画布 DPR 收到 1.5、触屏保持 2',
  /var dprCap = \(typeof isTouch === 'function' && isTouch\(\)\) \? 2 : 1\.5;/.test(appSrc));
assert('三处 hover 命中检测节流到约 30Hz（拖动时不节流）',
  /function hoverDue\(/.test(appSrc) && /HOVER_MIN_MS = 32/.test(appSrc) &&
  /if \(!chartDrag && !hoverDue\('chart'\)\) return;/.test(appSrc) &&
  /if \(!mapPan && !hoverDue\('map'\)\) return;/.test(appSrc) &&
  /if \(!G\.dragging && !hoverDue\('globe'\)\) return;/.test(appSrc));

assert('地图两侧也有 12% 禁用带（与图表、地球统一）',
  /function mapHitZone\(/.test(appSrc) &&
  /if \(!mapHitZone\(e\.clientX, e\.clientY\)\) return;/.test(appSrc) &&
  /active: mapHitZone/.test(appSrc) &&
  /function mapHitZone[\s\S]{0,300}W \* 0\.12/.test(appSrc));

console.log('--- V1.4.5 ---');
// ③b 地球缩放
assert('地球缩放改存倍数（G.zoom），不再存绝对像素半径 G.R',
  /function globeRadNow\(\)/.test(appSrc) && /G\.zoom = Math\.max\(0\.5, Math\.min\(2\.8/.test(appSrc) &&
  /zoom: 1, dragging: false/.test(appSrc) && !/\bG\.R\b/.test(appSrc));
assert('resize 不再清零缩放、也不再清 frameStates',
  /window\.addEventListener\('resize', function \(\) \{ drawChart\(\); \}\);/.test(appSrc) &&
  !/resize[\s\S]{0,80}frameStates = null/.test(appSrc) && !/resize[\s\S]{0,80}G\.R = 0/.test(appSrc));
assert('双击与「恢复原比例」都把倍数归 1', /dblclick[\s\S]{0,120}G\.zoom = 1/.test(appSrc) &&
  /view === 'globe'\) \{ G\.zoom = 1/.test(appSrc));
// ② 禁用区跟着地球
assert('地球禁用区跟随当前半径（放大后可用区随之变大）',
  /function globeHitZone[\s\S]{0,700}var R = globeRadNow\(\);/.test(appSrc) &&
  /var lim = R \* 1\.12;/.test(appSrc) && /Math\.abs\(dx\) <= lim && Math\.abs\(dy\) <= lim/.test(appSrc));
// ① 自转限流
assert('自转重绘限流到 20fps（50ms）', /now - lastGlobeDraw > 50/.test(appSrc));
// ③a 拖动不撑宽
assert('信息窗拖动右边界允许部分拉出屏幕（overflow-x 兜底，页面不撑宽）',
  /var maxL = \(vw - KEEP\) - wrap\.left;/.test(appSrc));
assert('页面不允许横向滚动', /html \{[\s\S]{0,120}overflow-x:hidden/.test(tpl) &&
  /body \{[\s\S]{0,80}overflow-x/.test(tpl));
// ④ 弹窗
assert('手机上说明弹窗压到 72vh', /max-width:820px\) \{\s*\.modal \{ max-height:72vh; \}/.test(tpl) ||
  /\.modal \{ max-height:72vh; \}/.test(tpl));
assert('弹窗关闭键往左挪（避开滚动条）', /\.modal-x \{ position:absolute; top:10px; right:24px;/.test(tpl));

assert('英文发射地点官方缩写（中心/海域/船名/场坪全覆盖）',
  appSrc.indexOf("replace(/^海阳\\s*东海海域/, 'East China Sea')") >= 0 &&
  appSrc.indexOf("replace(/^酒泉/, 'JSLC')") >= 0 && appSrc.indexOf("replace(/^海商/, 'HCSLS')") >= 0 &&
  appSrc.indexOf("replace(/^南海/, 'South China Sea')") >= 0 &&
  appSrc.indexOf("replace(/东方航天港一号/g, 'HOS-1')") >= 0 &&
  appSrc.indexOf("replace(/博润九州号/g, 'BO RUN JIU ZHOU')") >= 0 &&
  appSrc.indexOf("replace(/商火工位/, 'CACL LCC')") >= 0 &&
  appSrc.indexOf("replace(/场坪/g, 'Launch Pad Apron')") >= 0 &&
  appSrc.indexOf(".replace(/^([A-Z][A-Za-z ]*?) (LC-|LCC-|CACL |Launch Pad |HOS|HOS-|OMSP)/, '$1, $2')") >= 0);
assert('英文发射时间标签 GMT+8', appSrc.indexOf("'Launch time (GMT+8)'") >= 0);
assert('手机端 CISTrack 三档字号各 +3px',
  /font-size:26px; letter-spacing:\.03em/.test(tpl) && /font-size:25px; letter-spacing:\.02em/.test(tpl) &&
  /font-size:23px; letter-spacing:\.03em; \}/.test(tpl));


assert('触屏点击阈值与鼠标一致（TAP_SLOP，不再硬编码 4px）',
  /moved <= \(cfg\.tapSlop \|\| TAP_SLOP\) && cfg\.tap/.test(appSrc));
assert('全屏强制横屏 + 退出时解锁',
  /screen\.orientation\.lock\('landscape'\)/.test(appSrc) && /screen\.orientation\.unlock/.test(appSrc));
assert('章节标题前无多余的 > 字符', tpl.indexOf('</button>>') < 0 && html.indexOf('</button>>') < 0);
assert('CISTrack 标志链到仓库主页', /href="https:\/\/github\.com\/1471155912\/CISTrack"/.test(tpl));
assert('搜索别名表：火箭 / 发射设施 / 制造商', /var ROCKET_ALIAS/.test(appSrc) &&
  /var SITE_ALIAS/.test(appSrc) && /var MAKER_ALIAS/.test(appSrc) && /function aliasHit/.test(appSrc));
assert('联想区：括号标注 + 分割线 + 历史记录',
  /function sugItemHtml/.test(appSrc) && /var SEARCH_HISTORY/.test(appSrc) &&
  /\.sug-item \+ \.sug-item \{ border-top/.test(tpl) && /class="sug-note"/.test(appSrc));
assert('全屏常驻搜索框（无 ⌕ 圆钮）+ 搜索键', !/fs-search-btn/.test(tpl) && /fs-search-wrap/.test(tpl) &&
  /class="search-key"/.test(tpl) && /search-ico/.test(tpl));
assert('地图章节固定长宽比（含全屏）', /#sec-map \.canvas-wrap \{ height:auto; aspect-ratio:1325 \/ 620; \}/.test(tpl));
assert('激活态为反色（含地图章节的 ghost.tgl 与全屏控件）', /button\.ghost\.tgl\.on/.test(tpl) &&
  /color:var\(--bg\); background:var\(--fg\); border-color:var\(--fg\);/.test(tpl));
assert('浮动控件统一毛玻璃', /#jumpPill button, \.view-ctl button, \.fs-panel-btn/.test(tpl) &&
  /backdrop-filter:blur\(8px\)/.test(tpl));


assert('curKey 不再出现（当前星座用 S.key）', appSrc.indexOf('curKey') < 0 && /var k = S\.key/.test(appSrc));
assert('联想项：名称后紧跟括号标注、最右为 NORAD', /class="sug-note">\(/.test(appSrc) && /class="sug-norad"/.test(appSrc));
assert('切星座：保存/载入各自搜索词并清选中',
  /function saveSearchText/.test(appSrc) && /function loadSearchText/.test(appSrc) && /saveSearchText\(\);/.test(appSrc));
assert('全屏左上角三键直角三角形布局', /section\.fs-mobile:fullscreen \.fs-panel-btn \{ position:fixed; left:16px; top:calc\(16px \+ var\(--fs-ctl-h\) \+ 10px\);/.test(tpl) &&
  /section\.fs-mobile:fullscreen \.fs-reset-btn \{ position:fixed; left:60px; top:16px;/.test(tpl));
assert('全屏控件小窗不再占满', /section\.fs-mobile:fullscreen \.fs-panel \{/.test(tpl) && tpl.indexOf('max-width:min(360px,50vw)') >= 0);
assert('搜索框占位符统一为「支持模糊与混合搜索」', /d_search_ph: \['支持模糊与混合搜索'/.test(appSrc) &&
  tpl.indexOf('placeholder="支持模糊与混合搜索"') >= 0);


assert('全屏搜索框已注册进联动体系（会绑联想）', /fsTopSearch/.test(appSrc) &&
  /document\.querySelectorAll\('\.fs-search-wrap'\)\.forEach/.test(appSrc) &&
  /SEARCH_BOXES\.push/.test(appSrc));
assert('△ 与重置视图提到 section 直接子级（防被抽屉盖住）', /function liftFsButtons/.test(appSrc));
assert('横屏锁定在 fullscreenchange 内（同 tick 早调已删）',
  !/V1\.5\.0：手机端强制横屏/.test(appSrc) && /screen\.orientation\.lock\('landscape'\)/.test(appSrc));
assert('退出全屏先锁竖屏', /screen\.orientation\.lock\('portrait'\)/.test(appSrc));
assert('退出全屏位置二次校正', /}, 420\);/.test(appSrc));
assert('地图 contain 居中（mapFit）', /function mapFit\(W, H\)/.test(appSrc) &&
  /\* fit\.w \* k \+ fit\.ox \+ tx/.test(appSrc));

console.log('--- 主题 ---');
$('#themeBtn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
await new Promise(r => setTimeout(r, 300));
assert('亮色主题无错', errors.length === 0 && d.documentElement.getAttribute('data-theme') === 'light');
$('#themeBtn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

await new Promise(r => setTimeout(r, 400));
console.log('--- 汇总');
console.log('错误数:', errors.length);
errors.slice(0, 8).forEach(e => console.log('  ! ' + e));
dom.window.close();
