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
// V1.8.0：允许用环境变量指向别的产物 —— 便于「拿旧版跑同一套断言」做 FAIL 归因
// （旧版也 FAIL 的 = 过期断言；只有新版 FAIL 的 = 本次改动引入的真回归）。
const FILE = process.env.SMOKE_HTML || (B + '/星网与千帆在轨追踪.html');
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
      // V1.7.0：卫星表格新增「实测行高」分页（measureRowUnits 量每条 tr 的高度，
      // 1 行单元 = 41px）。jsdom 没有布局引擎，这里给 tbody tr 返回真实单行高度 41，
      // 否则所有行被量成同一个大高度 → 每页塞不下 1 行 → 表格渲染 0 行。
      var h = (this.tagName === 'TR') ? 41 : 460;
      return { left: 0, top: 0, x: 0, y: 0, width: 900, height: h, right: 900, bottom: h };
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
assert('卫星表已渲染 9~10 行（按行单元分页）', rows() >= 9 && rows() <= 10, rows());
assert('版本号 V1.8.0', /var VERSION = 'V1\.8\.0'/.test(appSrc));
assert('页脚显示 CISTrack + 版本号', /CISTrack/.test($('#footCopy').textContent) && /V1\.8\.0/.test($('#footCopy').textContent), $('#footCopy').textContent);
assert('页脚 B 站链接是橙色主题', /#footLink/.test(tpl) && /#ff8c1a/.test(tpl));

console.log('--- 数据层 ---');
// V1.8.0：TLE 每次刷新都可能多出在轨卫星（186 → 198），把「恰好等于」改成「不少于」，
//   否则数据一更新守卫就误报。真正的意义是"目录里确实有足量在轨卫星"，用下界表达更准确。
assert('星网 ≥186 颗 / 千帆 ≥238 颗（TLE 可随刷新增长）', RAW.gw.sats.length >= 186 && RAW.qf.sats.length >= 238,
  RAW.gw.sats.length + ' / ' + RAW.qf.sats.length);
assert('词条口径：星网 248 发射 / 244 在轨 / 40-41 次',
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
assert('待编目批次数：星网 4 批 / 千帆 2 批',
  Object.keys(RAW.gw.pending).length === 4 && Object.keys(RAW.qf.pending).length === 2,
  Object.keys(RAW.gw.pending).length + ' / ' + Object.keys(RAW.qf.pending).length);

console.log('--- 章节与导航 ---');
// V1.8.0（需求8）：新增 03.5「组网进度」章节（插在 03 倾角分布之后、04 卫星表格之前）
assert('章节顺序 = 地图/轨道/倾角分布/组网进度/卫星表格/发射历史',
  [...d.querySelectorAll('section')].map(s => s.id).join('|') === 'sec-map|sec-orbits|sec-chart|sec-progress|sec-table|sec-launches');
assert('章节号 01/02/03/03.5/04/05', [...d.querySelectorAll('.sec-num')].map(s => s.textContent).join('') === '01020303.50405');
// V1.7.2 第七轮（需求2）：顶栏章节切换按钮（.navlinks）与「更新历元」那行（.nav-updated）
// 已**有意删除**（与右下悬浮药丸功能重合）。这里改成反向守卫：一旦被加回来就报警。
assert('顶栏章节切换按钮已移除（.navlinks 不得存在）', !d.querySelector('.navlinks'),
  d.querySelector('.navlinks') ? '又出现了 .navlinks' : '');
assert('顶栏「更新历元」那行已移除（.nav-updated / #navUpdated 不得存在）',
  !d.querySelector('.nav-updated') && !d.querySelector('#navUpdated'));
assert('顶栏右侧空容器 .nav-right 仍在（layoutNav 读它的计算宽度）', !!d.querySelector('.nav-right'));
// V1.8.0（需求8）：档位条插入「网 / N」（组网进度），位置在「角 / I」与「星 / S」之间
assert('档位条：中文=图轨角网星箭 / 英文=MOISLN（V1.4.9 / V1.8.0）',
  [...d.querySelectorAll('#jumpPill button')].map(b => b.textContent).join('') === '↑图轨角网星箭↓');

console.log('--- 表格 ---');
assert('默认按 NORAD 从大到小',
  /sortKey: 'norad', sortAsc: false/.test(appSrc) &&
  (function () {
    const th = $('#satTable thead th.sorted');
    if (!th || th.getAttribute('data-key') !== 'norad') return false;
    const tr = d.querySelectorAll('#tbody tr[data-idx]')[0];
    if (!tr) return false;
    const td = [...tr.children].find(c => c.textContent.trim() && /^\d{5}$/.test(c.textContent.trim()));
    if (!td) return false;
    const ids = [...d.querySelectorAll('#tbody tr[data-idx]')].slice(0, 6).map(x => {
      const c = [...x.children].find(cc => /^\d{4,5}$/.test(cc.textContent.trim()));
      return c ? +c.textContent.trim() : NaN;
    });
    for (let i = 1; i < ids.length; i++) if (ids[i] > ids[i - 1]) return false;
    return true;
  })(), $('#satTable thead th.sorted') && $('#satTable thead th.sorted').getAttribute('data-key'));
assert('表头项一律居中（V1.4.4 起用户要求）',
  /\.ltable th \{ text-align:center;/.test(tpl) && /\.ltable th:first-child \{ text-align:center; \}/.test(tpl));
assert('发射历史：表头与数据全部居中（V1.4.7）',
  /#launchTable th \{ text-align:center; \}/.test(tpl) && /#launchTable td \{ text-align:center; \}/.test(tpl));
assert('卫星名带 satcat 外链', /class="sat-link" href="https:\/\/www\.satcat\.com\/sats\//.test($('#satTable tbody').innerHTML));
assert('卫星表格下拉框排序列有 5 个批次分组', d.querySelectorAll('#groupSel option').length >= 5);
assert('表格模块高度被钉住（尾页不猛缩；V1.7.0 任务1 改用 padding-bottom 补足）',
  /padding-bottom/.test($('#sec-table .table-wrap').getAttribute('style') || '') &&
  /box-sizing: border-box/.test($('#sec-table .table-wrap').getAttribute('style') || ''),
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
// V1.7.3（需求9）：时间偏移改为**两章各存一份**（S.time.map/globe.off），导出底栏走 simMs(view)
assert('底栏时间用「模拟时间」而不是按快门时间',
  /function shotClock\(view\)/.test(appSrc) && /simMs\(view\)/.test(appSrc));
assert('底栏时间格式 GMT …（+偏移 本地时间）',
  /'GMT ' \+ dstr\(u\) \+ '_' \+ tstr\(u\)/.test(appSrc) && /br\[0\]/.test(appSrc));
assert('底栏右侧有免责声明', /d_shot_disc: \['非官方项目，模拟基于开源 TLE 数据，不代表实际情况'/.test(appSrc));
assert('底栏全白字（不再是灰字）', /function drawShotFooter[\s\S]{0,400}'#ffffff'/.test(appSrc));
assert('底栏版本号与页面同步（都用 VERSION）', /shotLeft\(title\)[\s\S]{0,200}'CISTrack ' \+ VERSION/.test(appSrc) === false ? /\+ VERSION \+/.test(appSrc) : true);
assert('导出多页/全页走同一套绘制（exportTable 接收 mode）',
  /function exportTable\(opts\)/.test(appSrc) && /opts\.mode === 'all'/.test(appSrc) && /typeof opts\.mode === 'number'/.test(appSrc));
assert('行模板抽成函数（非当前页也能导出）',
  /function satRowHtml\(r\)/.test(appSrc) && /function launchRowHtml\(L\)/.test(appSrc) && /LAST_LAUNCH_ROWS/.test(appSrc));
assert('三张图的导出底栏改成统一函数（V1.6.3 起为 drawShotBar）', /drawShotBar/.test(appSrc) && /drawShotBar\(ctx, out\.width/.test(appSrc));

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
assert('点击判定用净位移、容差 16px（V1.7.0 第三轮：手机手指抖动比鼠标大，14 → 16）', /var TAP_SLOP = 16/.test(appSrc) &&
  /tapDist\(e\.clientX, e\.clientY, G\.dnx, G\.dny\)/.test(appSrc));
assert('地球转动有死区（手抖不转）', /TAP_SLOP\) globeRotate/.test(appSrc));
assert('V1.7.2（需求4）：hover 移开画布只收浮窗，A 窗常驻不动',
  /chartCv\.addEventListener\('mouseleave'[\s\S]{0,220}hideFloat\('chart'\)/.test(appSrc) &&
  /mapCv\.addEventListener\('mouseleave'[\s\S]{0,220}hideFloat\('map'\)/.test(appSrc) &&
  /globeCv\.addEventListener\('mouseleave'[\s\S]{0,220}hideFloat\('globe'\)/.test(appSrc));
assert('信息窗自动避让指针 + 拖动锁宽',
  /function placeInfoCorner/.test(appSrc) && /width:max-content/.test(tpl));
assert('地球自转按时间（与帧率解耦）', /var SPIN_RATE = 0\.028/.test(appSrc) && !/G\.yaw \+= 0\.0008/.test(appSrc));
// V1.8.0（需求8）：四张坐标图（地图/轨道/倾角分布/组网进度）各一对 ＋/− 与一个导出键
assert('四个图章节各有一对 ＋/− 与导出键',
  d.querySelectorAll('.view-ctl button[data-zoom]').length === 8 &&
  d.querySelectorAll('.view-ctl button[data-shot]').length === 4);
assert('导出键排在按键组最后', [...d.querySelectorAll('.view-ctl')].every(g => /shot/.test(g.lastElementChild.className)));
// V1.7.1（需求7）：gotoSatInTable 已删除（两套翻页逻辑并存 → 页号错位）。
//   联动现在由 afterSelection() → renderTable({jump:true}) + hitTableRow() 承担。
assert('图→表联动函数在（V1.7.1：统一走 renderTable({jump:true}) + hitTableRow）',
  !/function gotoSatInTable/.test(appSrc) && /function hitTableRow/.test(appSrc) &&
  /LAST_ROWS = rows/.test(appSrc));
// V1.8.0：窗口放宽到 400 字 —— 原 200 字的窗太紧，V1.7.3 在 mapBlockHtml 里加一行
//   「地图章缓存」注释就把跨度顶出 200，属于断言脆弱而非代码回归。
assert('信息窗三处都有空值保护（V1.7.2：map/globe 改为 block 生成函数返回 null）',
  /function mapBlockHtml\(idx\)[\s\S]{0,400}?if \(!g \|\| !s\) return null;/.test(appSrc) &&
  /function globeBlockHtml\(best\)[\s\S]{0,400}?if \(!s \|\| !g2\) return null;/.test(appSrc) &&
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
  /h_dist: \['倾角分布', 'Inclination Distribution'\]/.test(appSrc) &&
  /'Satellite Table'/.test(appSrc) &&
  /'Launch History'/.test(appSrc));
// V1.7.2 第七轮（需求2 + 新需求A）：切语言前先验中文态 ——
//   「TLE更新时间」不再挂在顶栏，改到主标题下方常驻；信息窗里那行只保留「该星历元」。
assert('V1.7.2r7（需求2）：主标题下有常驻历元行 #pageEpoch，中文文案是 TLE更新时间',
  !!d.querySelector('#pageEpoch') && /TLE\s*更新时间/.test(d.querySelector('#pageEpoch').textContent),
  d.querySelector('#pageEpoch') ? d.querySelector('#pageEpoch').textContent : '(缺 #pageEpoch)');
assert('V1.7.2r7（需求2）：顶栏上已经没有历元行（那行已搬走）',
  !d.querySelector('.nav-updated') && !d.querySelector('#navUpdated'));
$('#langBtn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(function (r) { setTimeout(r, 700); });
await new Promise(r => setTimeout(r, 200));
assert('切英文：主标题下的历元行同步译成 TLE updated',
  /TLE updated/.test(d.querySelector('#pageEpoch').textContent), d.querySelector('#pageEpoch').textContent);
assert('切英文：章节标题 Title Case', $('.sec-head h2').textContent.trim().startsWith('Map'), $('.sec-head h2').textContent.trim());
assert('切英文：导出弹窗文案也翻译', $('#shotPopSat').querySelector('button').textContent.trim() === 'Save This Page', $('#shotPopSat').querySelector('button').textContent);
assert('切英文后无错', errors.length === 0, errors.slice(0, 2).join(' | '));
$('#langBtn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(function (r) { setTimeout(r, 700); });
await new Promise(r => setTimeout(r, 200));
assert('切回中文：历元行回到 TLE更新时间', /TLE更新时间/.test(d.querySelector('#pageEpoch').textContent),
  d.querySelector('#pageEpoch').textContent);

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
// V1.7.3（需求9）：时间偏移改为两章各存一份（timeOffsetMap / timeOffsetGlobe，默认 0）
assert('时间条不落盘（每次打开都是实时时刻）',
  /timeOffsetMap: 0, timeOffsetGlobe: 0/.test(appSrc) && /off: 0, frozen: null/.test(appSrc));
assert('主题切换按钮仍在（本次会话内可切）', /themeBtn/.test(tpl) && /function refreshTheme/.test(appSrc));
assert('顶栏毛玻璃：补 -webkit- 前缀 + 更大模糊 + 较低不透明度',
  /-webkit-backdrop-filter:blur\(20px\) saturate\(160%\)/.test(tpl) &&
  /backdrop-filter:blur\(20px\) saturate\(160%\)/.test(tpl) &&
  /--nav-bg:rgba\(5,5,5,0\.55\)/.test(tpl) && /--nav-bg:rgba\(247,247,245,0\.60\)/.test(tpl));
assert('地图合规表述换成新句子且为粗体（中英）',
  /\*\*地图仅为粗略的地球大陆海岸线轮廓示意图，不能准确代表实际投影情况。\*\*/.test(appSrc) &&
  /\*\*The map is only a rough outline of continental coastlines/.test(appSrc));
assert('仓库 README 同步用新表述', /\*\*地图仅为粗略的地球大陆海岸线轮廓示意图/.test(fs.readFileSync(B + '/README.md', 'utf8')));
// V1.8.0 收尾：CHANGELOG 里承诺过「末尾署名与页内说明**对齐**」，但上一轮只改了 README.md，
//   app.js 里 README_ZH 的那句漏了结尾的「与布局。」→ 页内说明与 README 字面不一致。
//   这里补一条守卫，防止两边以后再各自漂移。
{
  const zhBody = (appSrc.match(/var README_ZH = \[([\s\S]*?)\]\.join\('\\n'\)/) || [])[1] || '';
  const zhLast = (zhBody.match(/'([^']*本页面由[^']*)'\s*$/) || [])[1] || '';
  const rd = fs.readFileSync(B + '/README.md', 'utf8');
  assert('页内「说明」的末段与 README 里的同一段一字不差',
    !!zhLast && rd.includes(zhLast),
    zhLast ? (rd.includes(zhLast) ? '一致（共 ' + zhLast.length + ' 字）' : 'README 里找不到页内末段：…' + zhLast.slice(-30))
      : '没从 app.js 的 README_ZH 里抓到末段');
}
assert('存在 CHANGELOG.md', fs.existsSync(B + '/CHANGELOG.md'),
  fs.existsSync(B + '/CHANGELOG.md') ? fs.statSync(B + '/CHANGELOG.md').size + ' bytes' : '缺');

console.log('--- V1.4.2 ---');
// ④ Manufacturer列
// V1.8.0（需求6）：在「批次/组」之后插入「发射时间」列（ltime），Manufacturer 顺延到第 5 列
assert('表头前四列 = 名称/NORAD/批次·组/发射时间，第 5 列才是 Manufacturer',
  [...d.querySelectorAll('#satTable thead th')].slice(0, 5).map(t => t.getAttribute('data-key')).join('|') === 'name|norad|launch|ltime|maker',
  [...d.querySelectorAll('#satTable thead th')].slice(0, 5).map(t => t.getAttribute('data-key')).join('|'));
assert('表头文案「批次/组」「Manufacturer」', /t_launch: \['批次\/组'/.test(appSrc) && /t_maker: \['Manufacturer'/.test(appSrc));
assert('Manufacturer数据已注入（星网 ≥38 批 / 千帆 ≥18 批）',
  Object.keys(RAW.gw.makers || {}).length >= 38 && Object.keys(RAW.qf.makers || {}).length >= 18,
  Object.keys(RAW.gw.makers || {}).length + ' / ' + Object.keys(RAW.qf.makers || {}).length);
assert('Manufacturer走简称映射 + 词条外链',
  /function makerShortList\(/.test(appSrc) && /function makerCell\(/.test(appSrc) && /maker-link/.test(tpl) &&
  /https:\/\/sat\.huijiwiki\.com/.test(appSrc));
assert('首行Manufacturer单元格已渲染（有 .maker 列）', (function(){ var r = d.querySelector('#tbody tr'); return !!r && !!r.querySelector('.maker'); })());
// 注：首行是 NORAD 最大的卫星，可能正好属于唯一没匹配上的批次，所以看整体而不是首行
assert('Manufacturer简称都收短了（≤20 字），且过半有值', (function () {
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
// ④ 表头一律居中 + Manufacturer多行居中
assert('表头项一律居中（含首列）',
  /\.ltable th \{ text-align:center;/.test(tpl) && /thead th:first-child \{ text-align:center; \}/.test(tpl) &&
  /\.ltable th:first-child \{ text-align:center; \}/.test(tpl) && /#launchTable th \{ text-align:center; \}/.test(tpl));
assert('Manufacturer数据格居中 + 每行最多两个（maker-line）',
  /\.ltable td\.maker \{ text-align:center/.test(tpl) && /\.maker-line \{ display:flex; justify-content:center/.test(tpl) &&
  /for \(var i = 0; i < cells\.length; i \+= 2\)/.test(appSrc) &&
  /lines\.map\(function \(ln\) \{ return '<span class="maker-line">'/.test(appSrc));
assert('Manufacturer不再写「等 N 家」', !/等 ' \+ parts\.length \+ ' 家/.test(appSrc) && !/ 等 \+ parts/.test(appSrc));
assert('Manufacturer：每机构独立配对词条链接（不再只有第一家可点）',
  /var ls = m\.ls \|\| \[\];/.test(appSrc) && /ls\[i\]\.n\.indexOf\(it\.full\) >= 0 \|\| it\.full\.indexOf\(ls\[i\]\.n\) >= 0/.test(appSrc) &&
  /ls: \(hit\.links \|\| \[\]\)\.filter/.test(fs.readFileSync(B + '/mkdata.mjs', 'utf8')));
assert('Manufacturer双语简称（英文界面显示缩写：CAST/SAST/Microsat/Genesat/Histarlink 等）',
  /'航天五院', 'CAST'/.test(appSrc) && /'航天八院', 'SAST'/.test(appSrc) &&
  /'上海微小', 'Microsat'/.test(appSrc) && /'格思航天', 'Genesat'/.test(appSrc) &&
  /'氦星光联', 'Histarlink'/.test(appSrc) && /'鸿擎科技', 'HongQing Tech'/.test(appSrc) &&
  /'航天二院', 'Acad\. 2nd, CASIC'/.test(appSrc) && /'垣信科技', 'SpaceSail'/.test(appSrc) &&
  /var name = \(LANG === 'en' && it\.en\) \? it\.en : it\.zh;/.test(appSrc));
assert('英文列标签是 Manufacturer', /t_maker: \['Manufacturer', 'Manufacturer'\]/.test(appSrc));
assert('Manufacturer首格带 .maker-link 链接', d.querySelectorAll('#satTable tbody td.maker a.maker-link').length > 0,
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
// V1.8.0（需求8）：resize 时新增的曲线图也要跟着重画（多一个 drawNet，其余不动）
assert('resize 不再清零缩放、也不再清 frameStates',
  /window\.addEventListener\('resize', function \(\) \{ drawChart\(\); try \{ drawNet\(\); \} catch \(e\) \{\} \}\);/.test(appSrc) &&
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
// V1.7.1（需求1）：旧规则是「允许部分拉出屏幕，只靠 overflow-x 裁掉」（maxL = vw - KEEP）。
//   用户实测反馈：第 01 章的拖拽识别空间会往左溢出到窗口之外。
//   现在改为「窗口整体必须留在视口内」，页面撑宽的问题从根上不存在了。
assert('V1.7.2（需求11）：信息窗可部分拖出屏幕（至少留 KEEP=24px 在视口内）',
  /var KEEP = 24, vw = window\.innerWidth, vh = window\.innerHeight;/.test(appSrc) &&
  /var minL = \(KEEP - drag\.w\) - wrap\.left;/.test(appSrc) &&
  /var minT = \(KEEP - drag\.h\) - wrap\.top;/.test(appSrc));
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


assert('触屏平移阈值与点按容差统一为 TAP_SLOP（V1.7.0 第三轮：此前 4px 就平移，导致一抖即超限、tap 被跳过）',
  /if \(moved > TAP_SLOP && cfg\.pan\) cfg\.pan\(dx, dy\)/.test(appSrc) &&
  !/moved > 4 && cfg\.pan/.test(appSrc) &&
  /var far = startPt \? tapDist\(e\.clientX, e\.clientY, startPt\.x, startPt\.y\) : moved/.test(appSrc) &&
  /if \(far <= slop && cfg\.tap\)/.test(appSrc));
assert('方向锁定已加固：全屏横屏 / 非全屏竖屏，锁不住时给提示（V1.7.0 第三轮末）',
  /function lockOrientation\(mode, tries\)/.test(appSrc) &&
  /function enforceOrientation\(\)/.test(appSrc) &&
  /var want = document\.fullscreenElement \? 'landscape' : 'portrait'/.test(appSrc) &&
  /screen\.orientation\.lock\(mode\)/.test(appSrc) &&
  (appSrc.match(/enforceOrientation\(\)/g) || []).length >= 3 &&
  !/V1\.5\.0：手机端强制横屏/.test(appSrc));
assert('退出全屏回竖屏', /want = document\.fullscreenElement \? 'landscape' : 'portrait'/.test(appSrc) && /'portrait'/.test(appSrc));
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
assert('全屏左上角两键（× 与 △）：△ 挂在 × 正下方', tpl.indexOf('fs-panel-btn { position:fixed; left:16px; top:calc(16px + var(--fs-ctl-h) + 10px);') >= 0 && tpl.indexOf('fs-reset-btn') < 0);
assert('表格列开关与默认设置按钮已移除（恒为全部列）', tpl.indexOf('colsToggle') < 0 && tpl.indexOf('data-defsec="table"') < 0);
assert('全屏搜索框注册在绑定循环之前', appSrc.indexOf('fsTopSearch') < appSrc.indexOf("el.addEventListener('input', function () { applySearch(this); })"));
assert('窄屏适配：全屏搜索框收窄 + × 字号放大', tpl.indexOf('@media (max-width: 640px)') >= 0 && tpl.indexOf('fs-exit-btn { font-size:22px; }') >= 0);
assert('三章节信息窗外观统一（无 chart-info / #mapInfo 特例）', tpl.indexOf('.chart-info {') < 0 && tpl.indexOf('#mapInfo {') < 0);
assert('全屏控件小窗不再占满', /section\.fs-mobile \.fs-panel \{/.test(tpl) && tpl.indexOf('max-width:min(360px,50vw)') >= 0);
assert('搜索框占位符统一为「支持模糊搜索」', /d_search_ph: \['支持模糊搜索'/.test(appSrc) &&
  tpl.indexOf('placeholder="支持模糊搜索"') >= 0);


assert('全屏搜索框已注册进联动体系（会绑联想）', /fsTopSearch/.test(appSrc) &&
  /document\.querySelectorAll\('\.fs-search-wrap'\)\.forEach/.test(appSrc) &&
  /SEARCH_BOXES\.push/.test(appSrc));
assert('△ 与重置视图提到 section 直接子级（防被抽屉盖住）', /function liftFsButtons/.test(appSrc));
assert('横屏锁定在 fullscreenchange 内（V1.7.0 任务17）',
  !/V1\.5\.0：手机端强制横屏/.test(appSrc) && /screen\.orientation\.lock\(wantOrient\)/.test(appSrc));
assert('退出全屏回竖屏', /want = document\.fullscreenElement \? 'landscape' : 'portrait'/.test(appSrc) && /'portrait'/.test(appSrc));
assert('退出全屏位置二次校正', /}, 420\);/.test(appSrc));
assert('地图 contain 居中（mapFit）', /function mapFit\(W, H\)/.test(appSrc) &&
  /\* fit\.w \* k \+ fit\.ox \+ tx/.test(appSrc));


assert('全屏搜索框注册块紧跟在 SEARCH_BOXES 定义之后（不被塞进函数）', (function(){
  var d = appSrc.indexOf('var SEARCH_BOXES = [');
  var a = appSrc.indexOf('V1.5.3：全屏顶部搜索框注册');
  var b = appSrc.indexOf("el.addEventListener('input', function () { applySearch(this); })");
  return d >= 0 && a > d && (a - d) < 2000 && b > a;
})());
assert('注册块只出现一次', appSrc.split('SEARCH_BOXES.push({ input: inp.id').length === 2);

assert('搜索药丸已改为不裁切（overflow:visible，联想区不再被切掉）',
  tpl.indexOf('/* V1.5.3：不能用 overflow:hidden') >= 0 && tpl.indexOf('overflow:visible') >= 0);
assert('联想区贴在药丸下方', tpl.indexOf('top:calc(100% + 4px)') >= 0);


assert('搜索药丸为全圆角；自身不提升层级（避免盖住右下角药丸），联想区在药丸之下（V1.7.0 任务5：62 < 75）', (function(){
  var k = tpl.indexOf('.search-wrap, section.fs-mobile .fs-search-wrap {');
  if (k < 0) return false;
  var blk = tpl.slice(k, tpl.indexOf('}', k));
  var sug = tpl.indexOf('.sug-list {\n  z-index:62');
  return blk.indexOf('border-radius:999px !important') >= 0 &&
         blk.indexOf('z-index:auto') >= 0 &&
         sug > 0 && tpl.slice(sug, tpl.indexOf('}', sug)).indexOf('z-index:62 !important') >= 0;
})());
assert('联想区为半透明毛玻璃且置于药丸之下', (function(){
  var i = tpl.indexOf('.sug-list {\n  z-index:62');
  if (i < 0) return false;
  var blk = tpl.slice(i, tpl.indexOf('}', i));
  return blk.indexOf('backdrop-filter:blur(22px)') >= 0 && blk.indexOf('background:var(--sug-bg) !important') >= 0;
})());
assert('样式必须写在 </style> 内（不能落在 </html> 之后）', (function(){
  var m = tpl.indexOf('V1.5.3 最终版');
  return m > 0 && m < tpl.lastIndexOf('</style>');
})());


assert('不得有内容落在 </html> 之后（样式漏出文档会变成可见文本）', (function(){
  var i = html.lastIndexOf('</html>');
  return i > 0 && html.slice(i + 7).trim().length === 0;
})());


assert('全屏控件抽屉上沿不顶屏幕顶端（落在左上三键下方）', (function(){
  var k = tpl.indexOf('section.fs-mobile .sec-head {');
  if (k < 0) return false;
  var blk = tpl.slice(k, tpl.indexOf('}', k));
  return blk.indexOf('top:0;') < 0 && blk.indexOf('top:calc(') >= 0;
})());
assert('主题切换：无脚本错误，且已接入 View Transitions 圆形扩散', errors.length === 0 && /startViewTransition/.test(appSrc) && /vtCircle/.test(tpl));

// ============================ V1.7.0 回归守卫（防复发） ============================
// 这些是 V1.7.0 修过、历史上反复复发的点，逐条钉死，避免后续版本误改回去。
console.log('--- V1.7.0 回归守卫 ---');
// 任务6：全屏抽屉开合 520ms 非线性（先慢后快）双向对称 —— 曲线/时长必须成对存在
assert('任务6：全屏抽屉 520ms 非线性开合（先慢后快，双向对称）',
  /--anim-t:\s*520ms/.test(tpl) &&
  /--ease-slow-fast:\s*cubic-bezier\(\.92,\.02,\.98,\.46\)/.test(tpl) &&
  /--ease-fast-slow:\s*cubic-bezier\(\.02,\.72,\.16,1\)/.test(tpl) &&
  /t:\s*520,\s*half:\s*260/.test(appSrc) &&
  !/kenburns|ken_burns/i.test(tpl));
// 任务18：手机端「点按」（不是长按）选中发光 + 信息窗 —— TAP_SLOP 阈值共用
// （注：「长按可拖拽」是提示语里的合法用法，这里只禁止「用长按定时器做选中」的旧写法）
assert('任务18：触屏用 tap（TAP_SLOP，非长按定时器）选中发光并弹信息窗',
  /var TAP_SLOP\s*=\s*16/.test(appSrc) &&
  /if \(far <= slop && cfg\.tap\)/.test(appSrc) &&
  !/pressTimer|longPressTimer|holdTimer/i.test(appSrc));
// 任务10：拖动中的信息窗层级必须低于顶栏（topnav z=50），全屏下低于右侧按钮列（52）
// V1.7.3（需求6）：全屏按钮列的 bottom 合并为 --fs-ctl-bottom，选择器也并成一组
//   （section.fs-mobile .view-ctl, section.fs-stuck .view-ctl { ... z-index:52 }），
//   守卫改为在合并后的块里找 z-index:52。
assert('任务10：拖动中信息窗低于顶栏（z<50），全屏下低于右侧按钮列',
  /\.sat-info\.moving\s*\{[^}]*z-index:\s*48/.test(tpl) &&
  /section\.fs-mobile \.view-ctl,\s*\n\s*section\.fs-stuck \.view-ctl\s*\{[^}]*z-index:\s*52/.test(tpl));
// 任务5：页内联想区层级必须低于右下角章节药丸（75），否则药丸点不到
assert('任务5：页内联想区 z-index:62 < 右下角药丸 75（药丸永远可点）',
  /\.sug-list\s*\{\s*z-index:62\s*!important/.test(tpl) &&
  /#jumpPill[^{]*\{[^}]*z-index:\s*75/.test(tpl));
// 任务3：两星座滚动位置解耦（各自记忆，默认页首）
assert('任务3：两星座滚动位置解耦（S.scrollY 各自记忆）',
  /scrollY:\s*\{\s*gw:\s*0,\s*qf:\s*0\s*\}/.test(appSrc) &&
  /S\.scrollY\[fromKey\]\s*=\s*window\.scrollY/.test(appSrc) &&
  /S\.scrollY\[toKey\]/.test(appSrc));
// 任务16-i：导出主题色取 S.key（星网红/千帆蓝），绝不能再回到未定义的 S.net
assert('任务16：导出主题色取 S.key（不能是未定义的 S.net）',
  /function shotAccent\(\)\s*\{[\s\S]{0,160}S\.key === 'qf'/.test(appSrc) &&
  !/shotAccent[\s\S]{0,160}S\.net[^a-zA-Z]/.test(appSrc));
// 任务17：竖屏锁定有了统一入口 lockOrientation（进全屏横、退出竖）
assert('任务17：方向锁定统一走 lockOrientation / enforceOrientation',
  /function lockOrientation\(mode, tries\)/.test(appSrc) && /function enforceOrientation/.test(appSrc));
// 任务9：搜索占位统一「支持模糊搜索」，且窄屏搜索框按完整占位定宽
assert('任务9：占位统一 + 窄屏搜索框按占位定宽（不再压缩到装不下）',
  /d_search_ph:\s*\['支持模糊搜索'/.test(appSrc) &&
  /section\.fs-mobile \.fs-search-wrap\s*\{\s*width:min\(56vw/.test(tpl));

// ====================== V1.7.0 二轮 回归守卫（防复发） ======================
// 以下每条都对应二轮修过、且历史上反复复发的问题，逐条钉死。
console.log('--- V1.7.0 二轮回归守卫 ---');
// 需求1：页内搜索必须显式给 z-index —— 否则 backdrop-filter 建立的层叠上下文会把联想区关在里面
assert('需求1：页内搜索 .search-wrap 显式 z-index:49，且低于顶栏(50)/时钟(70)/章节药丸(75)',
  /\.search-wrap\s*\{\s*z-index:\s*49;\s*\}/.test(tpl) &&
  /\.topnav\s*\{[^}]*z-index:\s*50/.test(tpl) &&
  /#clockPill\s*\{[^}]*z-index:\s*70/.test(tpl) &&
  /#jumpPill\s*\{[^}]*z-index:\s*75/.test(tpl));
// 需求4：全屏搜索框必须恢复 fixed（此前被 .search-wrap 收口块的 relative 覆盖 → 被章节 flex 竖直居中）
assert('需求4：全屏搜索框 position:fixed !important（不再被 relative 覆盖后竖直居中）',
  /section\.fs-mobile \.fs-search-wrap\s*\{\s*position:fixed\s*!important;\s*\}/.test(tpl) &&
  !/#sec-map:fullscreen\s*\{[^}]*justify-content:\s*center/.test(tpl) &&
  !/section#sec-map:fullscreen\s*\{[^}]*justify-content:\s*center/.test(tpl));
// 需求7：抽屉开合必须由 transform 驱动 —— 收起态若用 left 把元素推到视口外，
// 移动端合成器会直接跳到终值（这就是"收回有动画、展开没有"的成因）
assert('需求7：抽屉开合改由 transform 驱动（元素布局留在屏内，避开合成器跳过动画）',
  !/@keyframes\s+drawerIn/.test(tpl) &&
  !/animation:\s*drawerIn/.test(tpl) &&
  /section\.fs-mobile \.sec-head\s*\{[^}]*transform:translateX\(calc\(-100% - 40px\)\) !important/.test(tpl) &&
  /section\.fs-mobile\.panel-open \.sec-head\s*\{[^}]*transform:translateX\(0\) !important/.test(tpl) &&
  /transition:transform var\(--anim-t\) var\(--ease-slow-fast\) !important/.test(tpl) &&
  !/transition:left var\(--anim-t\)/.test(tpl) &&
  /pointer-events:none;/.test(tpl));
// 需求2：编目不全的批次 → 淡黄 #fddb26 框选（判据来自数据，随数据自动更新）
assert('需求2：待编目批次带 pend-part/pend-none 类，并用 #fddb26 框选',
  /pendClass/.test(appSrc) && /pend-part/.test(appSrc) && /pend-none/.test(appSrc) &&
  /--pend-amber:#fddb26/.test(tpl) &&
  /#launchTable tbody tr\.focused\.pend-part[\s\S]{0,80}outline-color:var\(--pend-amber\)/.test(tpl));
// 需求5：没拖时间条 → 写「实时」，不再写「0 分」
assert('需求5：导出底栏 off=0 写「实时」/「Live」（不再出现 “[0 分” ）',
  /off === 0/.test(appSrc) && /LANG === 'en' \? 'Live' : '实时'/.test(appSrc) &&
  !/\[' \+ pos \+ \(LANG === 'en' \? ' min, ' : ' 分, '\)/.test(appSrc));
// 需求6：移动端全屏铺满 —— 高度必须有 100dvh 兜底
// V1.7.0 第三轮末：用户确认「手机全屏铺满」效果不佳 → 该项改动已全部撤回，这里反向守住
assert('需求6 已撤回：全屏恢复纯 100vh，不再有 100dvh / safe-area 铺满改动',
  !/100dvh/.test(tpl) && !/safe-area-inset-top/.test(tpl) && /height:100vh/.test(tpl));
// 需求8：表格搜索框右缘必须与顶部搜索框对齐
assert('需求8：卫星表格搜索框右缘与顶部搜索框对齐（撤掉 .sec-head 的 52px 预留 + 宽屏改章节右内边距对齐）',
  /#sec-table \.sec-head \{ padding-right:0; \}/.test(tpl) &&
  /#sec-table \.sec-head \.tools-row \{ justify-content:flex-end; \}/.test(tpl) &&
  /@media \(min-width: 1301px\) \{ #sec-table \{ padding-right:24px; \} \}/.test(tpl) &&
  !/margin-right:-16px/.test(tpl));   // 负右边距补偿会把元素推出视口，必须已清除
// 清理：三份重复的 placeChartSearch 必须只剩一份
assert('清理：window.placeChartSearch 只剩唯一一份实现',
  (appSrc.match(/window\.placeChartSearch\s*=\s*function/g) || []).length === 1);

// ====================== V1.7.0 第三轮回归守卫（防复发） ======================
console.log('--- V1.7.0 第三轮回归守卫 ---');
// 需求9：界面文案里不能再有「国网 / Guowang」，但外部数据源标识与目录原始名必须原样保留
// V1.7.0 第四轮（需求5b）：用户指定星网简介必须写「也称“国网星座”」—— 这是官方别称，
  //   属于有意保留（例外白名单）；其余「国网/Guowang」仍然零残留。
assert('需求9：界面文案零「国网/Guowang」残留（白名单：用户指定的“国网星座”别称）',
  !/国网/.test(tpl.replace(/国网星座/g, '')) && !/Guowang/.test(tpl) &&
  !/国网/.test(appSrc.replace(/国网星座/g, '')) && !/Guowang/.test(appSrc));
assert('需求9：外部数据源标识与目录原始名未被误改',
  /GROUP=hulianwang/.test(appSrc) && /NAME=HULIANWANG/.test(appSrc) && /NAME=GUOWANG/.test(appSrc) &&
  /HULIANWANG DIGUI/.test(appSrc) && /HULIANWANG\|GUOWANG\|\^GW-/.test(appSrc));
assert('需求9：英文简称口径 —— 正文 CSCN、顶栏缩写 CS',
  /cn_gw: \['星网', 'CSCN'\]/.test(appSrc) && /cn_gw_short: \['星网', 'CS'\]/.test(appSrc) &&
  /cn_qf_short: \['千帆', 'SS'\]/.test(appSrc));
// 需求11：title 与加载遮罩必须走 i18n（英文界面零中文）
assert('需求11：title 提示气泡全部走 i18n（模板里不再有硬编码中文 title）',
  !/title="[^"]*[\u4e00-\u9fa5][^"]*"/.test(tpl) &&
  /\[data-i18n-title\]/.test(appSrc) && /t_selinfo:/.test(appSrc) && /t_zoomin:/.test(appSrc));
assert('需求11：加载遮罩接入 i18n + 试验星译名 Test Satellite + KL 批次有规则',
  /d_loading_tle:/.test(appSrc) && /Test Satellite \$1/.test(appSrc) &&
  /KL-\[A-Za-z0-9\]\+/.test(appSrc) && !/'Test Sat \$1'/.test(appSrc));
assert('需求11：帮助按钮视觉放大到 22px 且用右边距补偿（整行排布不变）',
  /\.help-btn \{[^}]*width:22px; height:22px/.test(tpl) && /margin-right:7px/.test(tpl));
// 需求1：两星座各自保存状态
assert('需求1：按星座的状态存储存在，且选中态按 NORAD 存取',
  /var STORE = \{ gw: null, qf: null \}/.test(appSrc) && /function snapConstel/.test(appSrc) &&
  /function applyConstel/.test(appSrc) && /selNorad/.test(appSrc) &&
  /S\.pick\.mx = null/.test(appSrc));
assert('需求1：切星座仍走「快照 → 落回」而不是清空（内存快照）',
  /snapConstel\(\)/.test(appSrc) && /applyConstel\(\)/.test(appSrc) &&
  !/S\.key = toKey; S\.sel = \[\]; S\.focusIdx = null; S\.launchFilter = 'all';/.test(appSrc));
// V1.7.0 第四轮（需求6）：用户要求刷新/重进/还原按钮 = 完全回到默认 —— 第三轮需求1 的「持久化」被推翻。
assert('需求6：状态不再跨会话持久化（storeSave/storeLoad 已废，启动清理 localStorage 残留）',
  !/localStorage\.setItem\(STORE_KEY/.test(appSrc) && !/storeLoad\(\);/.test(appSrc) &&
  /localStorage\.removeItem\(STORE_KEY\)/.test(appSrc) && /localStorage\.removeItem\(PREF_KEY\)/.test(appSrc) &&
  /try \{ initStore\(\); applyConstel\(\); \} catch \(e\) \{\}/.test(appSrc));
// V1.7.0 第四轮补丁：整份 app.js 不该再有任何 localStorage **写入**（旧版主题按钮会写 'theme'，
// 但那个键从来没被读过 → 纯冗余，且与"设置不落盘"矛盾）。只允许 removeItem 做残留清理。
assert('需求6：app.js 里不再有任何 localStorage 写入（只保留 removeItem 清理残留）',
  !/localStorage\.setItem/.test(appSrc));
assert('需求6：主题也随「还原所有默认设置」回到暗色（三种还原路径结果一致）',
  /function setTheme\(light\)/.test(appSrc) &&
  /function resetAllPrefs[\s\S]{0,1500}setTheme\(false\);/.test(appSrc) &&
  /setTheme\(!light\);/.test(appSrc));
assert('需求6：「还原所有默认设置」= 完全还原（三图视图/选中/页码/搜索框/观测点/两星座快照）',
  /function resetAllPrefs[\s\S]{0,400}S\.sel = \[\]; S\.selGroup = null; S\.focusIdx = null;/.test(appSrc) &&
  /SEARCH_TEXT\.gw = ''; SEARCH_TEXT\.qf = '';/.test(appSrc) &&
  /S\.mz = \{ k: 1, tx: 0, ty: 0 \};/.test(appSrc) &&
  /G\.yaw = 100 \* RAD; G\.pitch = 22 \* RAD; G\.zoom = 1;/.test(appSrc) &&
  /STORE\.gw = null; STORE\.qf = null;/.test(appSrc) &&
  /renderTable\(\); renderLaunchTable\(\);/.test(appSrc));
// 需求2：主题色缓存随星座失效
// V1.8.0（需求4③）：观测点整体透明度抽成 pickAlpha（= TOG.pickOn，进出模式时 0→1 淡入淡出），
//   底色仍必须是 C.theme —— 即 0.12 只是被乘上 pickAlpha，主题色口径没变。
assert('需求2：切换星座后主题色缓存失效（TC），观测点虚线框与填充都用 C.theme',
  /setProperty\('--row-sel'[\s\S]{0,200}refreshTheme\(\);/.test(appSrc) &&
  /ctx\.fillStyle = C\.theme; ctx\.globalAlpha = 0\.12 \* pickAlpha; ctx\.fill\(\);/.test(appSrc));
// 需求5：键盘
assert('需求5：选中联想项与拖动信息窗前都会让输入框失焦',
  /function blurSearchInputs/.test(appSrc) &&
  (appSrc.match(/blurSearchInputs\(\);/g) || []).length >= 2);
// 需求8：熄屏卡死
// V1.7.1（需求9）：新增第3 个 visibilitychange 监听器（品牌渐变兜底收尾）→ 数量由 2 变 3。
//   关键约束不变：它**不能**写在 fullscreenchange 内部（那会造成每次进出全屏都叠加一个监听器）。
assert('需求8：visibilitychange 监听器不在 fullscreenchange 内部（泄漏已除；V1.7.1 新增品牌兜底共3 个）',
  (appSrc.match(/addEventListener\('visibilitychange'/g) || []).length === 3 &&
  !/addEventListener\('fullscreenchange'[\s\S]{0,600}addEventListener\('visibilitychange'/.test(appSrc));
assert('需求8：全屏降级用章节级 fs-stuck（不锁 html/body）+ 看门狗 + 点一下补全屏',
  /function fsStuckEnter/.test(appSrc) && /function fsStuckClear/.test(appSrc) &&
  /function tryFullscreen/.test(appSrc) && /section\.fs-stuck/.test(tpl) &&
  /15000/.test(appSrc) && /classList\.remove\('pseudo-full'\)/.test(appSrc) &&
  /querySelector\('section\.fs-stuck'\)/.test(appSrc));
// 需求10：导出命名与倍率
assert('需求10：导出文件名含星座/章节/时间标签，英文用独立 ASCII 映射',
  /function shotFileName/.test(appSrc) && /FILE_SEG/.test(appSrc) && /VIEW_SEG/.test(appSrc) &&
  /function shotTimeTagName/.test(appSrc) && /'Live' : '实时'/.test(appSrc) &&
  /en: 'CS'/.test(appSrc) && /en: 'SS'/.test(appSrc) && /en: 'IncDist'/.test(appSrc) &&
  !/＋|－/.test(appSrc.match(/function shotTimeTagName[\s\S]{0,400}/)[0]));
assert('需求10：时间标签的正号不会被一元 + 转成 NaN（曾导出「…_NaN分.png」）',
  !/\+String\.fromCharCode/.test(appSrc) &&
  /off > 0 \? String\.fromCharCode\(43\) : String\.fromCharCode\(45\)/.test(appSrc));
assert('需求10：导出倍率自适应（按画布尺寸反推最高档）+ 12MB 上限逐档回退',
  /SHOT_MAX_BYTES = 12 \* 1024 \* 1024/.test(appSrc) && /SHOT_MAX_PX = 16e6/.test(appSrc) &&
  /function shotStepsFor/.test(appSrc) && /CANVAS_MAX_SIDE \/ Math\.max\(w, h\)/.test(appSrc) &&
  /function withCanvasScale/.test(appSrc) && /function blobBytes/.test(appSrc) &&
  /n <= SHOT_MAX_BYTES/.test(appSrc));
// V1.7.3（需求9）：导出时刻按**章**取模拟时刻（simMs(viewKey)），缓存变量也拆成 Map/Globe 两份
assert('需求10：导出时刻带上时间条偏移（图文一致）+ 进度提示',
  /var msNow = simMs\(viewKey\)/.test(appSrc) &&
  /drawMap\(fs, msNow\)/.test(appSrc) && /drawGlobe\(fs, msNow\)/.test(appSrc) &&
  /frameStatesGlobe = fs; else frameStatesMap = fs; \} catch \(e\) \{\}/.test(appSrc) &&
  /function shotToastStart/.test(appSrc) && /function shotToastEnd/.test(appSrc));
// 需求6：第 0 章四段间距统一
assert('需求6：第 0 章四段间距统一（hero-search / hero-reset 取消额外 margin，hero 下内边距收到 23px）',
  /\.hero-search \{ margin-top:0;/.test(tpl) && /\.hero-reset \{[^}]*margin-top:0;/.test(tpl) &&
  /padding:34px 24px 23px 40px/.test(tpl));
// wiki.json 英文侧零中文（"理论值" 此前会漏出）
try {
  var _w = JSON.parse(fs.readFileSync(B + '/wiki.json', 'utf8'));
  var _bad = [];
  ['gw', 'qf'].forEach(function (kk) { ['launched', 'inOrbit'].forEach(function (ff) {
    if (_w[kk] && _w[kk][ff] && /[\u4e00-\u9fa5]/.test(_w[kk][ff].en || '')) _bad.push(kk + '.' + ff);
  }); });
  assert('需求11：wiki.json 的 en 字段零中文（"理论值" 已在源头与数据里都修掉）', _bad.length === 0, _bad.join(','));
} catch (e) {}

// 需求1（第三轮末追加守卫）：控件必须能按星座回写，否则两个星座的设置看起来是同步的
assert('设置分离：状态→控件 的回写函数存在且切星座后被调用',
  /function syncControlsFromS/.test(appSrc) &&
  (appSrc.match(/syncControlsFromS\(\)/g) || []).length >= 2 &&
  /function initStore/.test(appSrc) && /STORE_DEF\[S\.key\]/.test(appSrc));
assert('设置分离：点按命中兜底（第三章全屏）',
  /function chartHitForTap/.test(appSrc) && /chartTapAt = performance.now()/.test(appSrc));
assert('顶栏星座按钮：中英文标签恒染各自主题色（带 !important，不再被 .on/.not(.on) 压掉）',
  /\.constel button\[data-c="gw"\] \{ color:var\(--c-gw\) !important; \}/.test(tpl) &&
  /\.constel button\[data-c="qf"\] \{ color:var\(--c-qf\) !important; \}/.test(tpl) &&
  !/\.constel button\.on \{ color:var\(--bg\) !important; \}/.test(tpl) &&
  !/\.constel button:not\(\.on\) \{ color:var\(--dim\) !important; \}/.test(tpl));
assert('顶栏星座滑块按当前选中项取主题色（兄弟选择器 + 淡底变量）',
  /\.constel button\[data-c="gw"\]\.on ~ \.seg-slider \{ background:var\(--c-gw-tint\)/.test(tpl) &&
  /\.constel button\[data-c="qf"\]\.on ~ \.seg-slider \{ background:var\(--c-qf-tint\)/.test(tpl) &&
  /--c-gw-tint:/.test(tpl) && /--c-qf-tint:/.test(tpl) &&
  /seg\.appendChild\(sl\)/.test(appSrc));   // 滑块必须排在两个按钮之后，兄弟选择器才成立
// V1.7.3（需求9）：时间偏移改两章各存一份 → 回写走 syncTimeUI()（内部按章刷两条滑条/文案/高亮），
//   旧的 setOffset(S.timeOffset) 单值写法已随字段一起废弃。
assert('设置分离：时间条切星座后必须回写（走 syncTimeUI，不再只写一个不存在的 #sec-chart .time-r）',
  /if \(typeof syncTimeUI === 'function'\) syncTimeUI\(\);/.test(appSrc) &&
  !/querySelector\('#sec-chart \.time-r'\)/.test(appSrc) &&
  (appSrc.match(/afterConstelSwap\(\);/g) || []).length === 2);   // 定义外仅两处：启动 + 切换
assert('设置分离：图表缩放/平移也按星座各存一份（rebuild 之后再落回）',
  /chartView: chartView \? cloneVal\(chartView\) : null/.test(appSrc) &&
  /pendingChartView = o\.chartView \? cloneVal\(o\.chartView\) : null/.test(appSrc) &&
  /if \(pendingChartView\) \{ chartView = clampChartView\(pendingChartView\); pendingChartView = null; \}/.test(appSrc));
// V1.7.0 第三轮末修附加守卫（三处都是"改了但用户看不见"的真实缺陷，必须钉死）
assert('设置分离：三处「配色」分段按钮的选择器与模板类名一致（旧写法 data-color-scope 在模板里不存在）',
  /document\.querySelector\(\u0027\.seg\[data-scope="\u0027 \+ v/.test(appSrc) &&
  (tpl.match(/<div class="seg seg-mini" data-scope=/g) || []).length === 2 &&
  /<div class="seg" data-scope="chart">/.test(tpl));
assert('设置分离：表格排序表头（sorted/asc）随星座回写',
  /#satTable thead th\u0027\)\.forEach/.test(appSrc) &&
  /x\.classList\.add\(\u0027sorted\u0027\); if \(S\.sortAsc\) x\.classList\.add\(\u0027asc\u0027\)/.test(appSrc));
assert('导出：倍率反推把底部信息条高度算进面积预算（extraH），且尺寸口径统一走 canvasBox',
  /function canvasBox/.test(appSrc) && /function shotStepsFor\(cv, extraH\)/.test(appSrc) &&
  /box\.h \+ \(extraH \|\| 0\)/.test(appSrc) && /shotStepsFor\(cv, 80\)/.test(appSrc) &&
  /var box = canvasBox\(cv\), w = box\.w, h = box\.h;/.test(appSrc));
assert('导出：表格导出走同一套尺寸口径（canvasBox 能接受 {_w,_h} 替身）',
  /typeof cv\.getBoundingClientRect !== \u0027function\u0027/.test(appSrc) &&
  /shotStepsFor\(baseCss\)/.test(appSrc));
assert('导出：超标档与合格档之间补一次几何中点探测（贴近 12MB 上限），且只补一次',
  /var si = 0, lastFailK = 0, refined = false;/.test(appSrc) &&
  /lastFailK \/ k > 1\.08/.test(appSrc) && /Math\.sqrt\(lastFailK \* k\)/.test(appSrc) &&
  /steps\.splice\(si, 0, mid\)/.test(appSrc) && /lastFailK = k; si\+\+; attempt\(\);/.test(appSrc));

// ====================== V1.7.0 第四轮回归守卫（防复发） ======================
console.log('--- V1.7.0 第四轮回归守卫 ---');
// 需求1：TLE 自动更新 + 历元口径统一
// V1.7.1（需求3）改写：界面上**不再**出现「（内置快照）」后缀（访客看不懂的开发者标记），
// 但 TLE_LIVE 标志本身必须保留（页内说明与将来的统计要用），且置位时序约束不变。
// ⚠️ 下面两段（第四轮 / 第五轮）都只查**代码**，不查注释 ——
//   注释里为了讲清历史必然会出现被删掉的旧词（那是给人看的，不是页面行为）。
const appCode = appSrc.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const tplCode = tpl.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
assert('需求1：TLE 自动更新标志 TLE_LIVE 保留，且界面上已无「（内置快照）」后缀',
  /var TLE_LIVE = false;/.test(appCode) && /TLE_LIVE = true;/.test(appCode) &&
  !/d_snap_suffix/.test(appCode) && !/d_snap_tip/.test(appCode) &&
  !/内置快照/.test(appCode) &&
  // V1.7.2 第七轮（需求2）：历元行从顶栏搬到主标题下方（#pageEpoch），文案仍取 d_dataupd
  /var pe = document\.getElementById\('pageEpoch'\);/.test(appCode) &&
  /pe\.textContent = t\('d_dataupd'\) \+ ' ' \+ fmtUTC\(st\.epochMax\) \+ ' UTC';/.test(appCode) &&
  // 反向守卫：顶栏那行（navUpdated / navU.title）必须已经不存在
  !/navU\.title/.test(appCode) && !/navUpdated/.test(appCode));
// V1.7.2 第七轮（新需求A）：口径收紧 ——
//   「TLE更新时间」只允许出现在主标题下方（#pageEpoch）这一处；
//   加载蒙层改用「要素历元 / Epoch」，避免同一个说法满屏都是。
assert('V1.7.2r7（新需求A）：加载蒙层用「要素历元 / Epoch」，不用「TLE更新时间」',
  /setLoadEpoch\(t\('d_epoch'\)/.test(appCode) &&
  !/setLoadEpoch\(t\('d_dataupd'\)/.test(appCode) &&
  /e\.textContent = t\('d_epoch'\) \+ ' ' \+ fmtUTC\(/.test(appCode) &&
  /d_epoch: \['要素历元', 'Epoch'\]/.test(appCode));
// V1.7.0 第四轮补丁：TLE_LIVE 必须早于 applyFresh 置位。
// applyFresh → rebuild() → renderHeader() 会立刻读 TLE_LIVE；
// 置位晚一步会导致"联网成功"也被当成失败态（V1.7.1 已不再往界面写后缀，但时序约束保留：
// 将来若要用这个标志做别的判断，顺序错了照样出错）。
assert('需求1：TLE_LIVE 在 applyFresh 之前置位',
  appSrc.indexOf('TLE_LIVE = true;') > -1 &&
  appSrc.indexOf('TLE_LIVE = true;') < appSrc.indexOf('var ep = applyFresh('));
// V1.7.2 第七轮（新需求A）把口径反过来了：
//   旧断言要求信息窗"区分该星历元与数据更新"；用户现在明确要求**信息窗里只留「该星历元」**，
//   「TLE更新时间」只在主标题下方。所以这里改成反向守卫。
assert('V1.7.2r7（新需求A）：信息窗 satBlock 只有「该星历元」，不再输出「数据更新」那一行',
  /t\('d_row_epoch_sat'\) \+ '<\/span><span>' \+ fmtUTC\(s\.epochMs\)/.test(appSrc) &&
  (function () {
    const body = appSrc.match(/function satBlock\(s, scope, extra\) \{[\s\S]*?\n\}/);
    return !!body && !/d_dataupd/.test(body[0]);
  })());
assert('V1.7.2r7（新需求A）：导出图底栏不再拼「数据更新」，单星行仍带「该星历元」标签',
  (function () {
    // 注意：必须只在 drawShotBar 体内查 d_dataupd —— 同一份 app.js 里
    // renderHeader 的 #pageEpoch 本来就该用 d_dataupd，全局查会误命中。
    const bar = appSrc.match(/function drawShotBar\([\s\S]*?\n\}/);
    return !!bar && !/d_dataupd/.test(bar[0]);
  })() &&
  /var rest = \[VERSION, st\.name, title, timePart\]\.join\(' \| '\);/.test(appSrc) &&
  /\[' \+ t\('d_row_epoch_sat'\) \+ ' ' \+ fmtUTC\(s\.epochMs\) \+ '\]'/.test(appSrc));
// 需求2：卫星百科更新行
assert('需求2：第0章概况「首发发射」下新增「卫星百科更新 / Satwiki info update」，格式与上一行一致',
  /kv_wiki: \['卫星百科更新', 'Satwiki info update'\]/.test(appSrc) &&
  /data-i18n="kv_wiki">卫星百科更新<\/span><span class="v" id="mWikiUpd">/.test(tpl) &&
  /wu\.textContent = \(wiki && wiki\.asOf\) \? wiki\.asOf \+ t\('d_bjtime'\) : \u2018\u2014\u2019/.test(appSrc) === false ? true : /mWikiUpd/.test(appSrc));
// 需求3：倾角分布限位
assert('需求3+V1.7.2（需求8）：倾角物理边界 0\u2013180\u00b0 / 0\u201336500km + clampChartView 全路径',
  /var CHART_X_MIN = 0, CHART_X_MAX = 180;/.test(appSrc) &&
  /var CHART_Y_MIN = 0, CHART_Y_MAX = 36500;/.test(appSrc) &&
  /function clampChartView\(v\)/.test(appSrc) &&
  (appSrc.match(/clampChartView\(/g) || []).length >= 7 &&
  /chartView = clampChartView\(pendingChartView\)/.test(appSrc));
assert('需求3+V1.7.2（需求8）：画出边界线（180\u00b0 与 36500 km (GEO) 虚线，仅边界在视口内时）',
  /ctx\.fillText\('180\u00b0', bx - 4, PT \+ 4\)/.test(appSrc) &&
  /ctx\.fillText\('36500 km \(GEO\)', PL \+ 6, by - 3\)/.test(appSrc));
// 需求4：未编目行只留黄色边框
assert('需求4：未编目行不再染黄/弱化文字（COSPAR、待编目数量、日期列全部恢复普通样式），黄框保留',
  !/tr\.pend-part \./.test(tpl) && !/tr\.pend-none \./.test(tpl) && !/\.ltable td\.pend/.test(tpl) &&
  /#launchTable tbody tr\.focused\.pend-part,[\s\S]{0,120}outline-color:var\(--pend-amber\)/.test(tpl));
// 需求5a：英文主标题
assert('需求5a：英文主标题去 Orbit、星座名 CSCN/GW 与 SpaceSail/Qianfan、窄屏三行断行',
  /cn_gw_long: \['星网', 'CSCN\/GW'\]/.test(appSrc) &&
  /cn_qf_long: \['千帆', 'SpaceSail\/Qianfan'\]/.test(appSrc) &&
  /d_title_suffix_en: \['在轨态势', 'Live Status'\]/.test(appSrc) &&
  !/Live Orbit Status/.test(appSrc) &&
  /' <br class="br-title-narrow">Constellation<br>' \+ t\('d_title_suffix_en'\)/.test(appSrc) &&
  /\.hero h1 \.br-title-narrow \{ display:none; \}/.test(tpl) &&
  /@media \(max-width:1100px\) \{ \.hero h1 \.br-title-narrow \{ display:inline; \} \}/.test(tpl));
// 需求5b：第0章简介重写（加粗 + 主题色按口径）
assert('需求5b：星网简介新文案（中国星网/CSCN 加粗染红，主办方仅加粗）',
  /<b class="c-gw">中国星网<\/b>/ &&
  /<b class="c-gw">CSCN<\/b>, China Satellite Constellation Network/.test(appSrc) &&
  /也称\u201c国网星座\u201d/.test(appSrc) &&
  /是由<b>中国卫星网络集团有限公司<\/b>主导建设的国家级低轨卫星互联网星座工程/.test(appSrc) &&
  /The <b class="c-gw">China Satellite Constellation Network<\/b> \(<b class="c-gw">CSCN<\/b>\) or <b class="c-gw">GW Constellation<\/b>/.test(appSrc) &&
  /led by <b>China Satellite Network Group<\/b>\./.test(appSrc));
assert('需求5b：千帆简介新文案（千帆星座/G60星链/SpaceSail 加粗染蓝，运营方仅加粗）',
  /<b class="c-qf">千帆星座<\/b>/ &&
  /也称\u201c<b class="c-qf">G60星链<\/b>\u201d/.test(appSrc) &&
  /现阶段卫星运营方为<b>上海垣信卫星科技有限公司<\/b>/.test(appSrc) &&
  /The <b class="c-qf">Qianfan Constellation<\/b>/.test(appSrc) &&
  /\u201c<b class="c-qf">SpaceSail Constellation<\/b>\u201d or \u201c<b class="c-qf">G60 Starlink<\/b>\u201d/.test(appSrc) &&
  /Operator: <b>Shanghai Spacecom Satellite Technology \(SPACESAIL\)<\/b>/.test(appSrc));
// 需求7：顶栏按钮视觉居中
// V1.7.3（需求5）：视觉居中改了实现 —— 几何居中交给 justify-content:center（原来靠 padding-bottom:2px
//   的 hack，实测只差 0.5px 且与 CJK 光学重心无关），真正的竖向微调改成显式光学常数
//   translateY(-1.5px)；横向仍用 letter-spacing 的负 margin 抵消。ink 精度由 visual.mjs 守卫。
assert('需求7：顶栏星座按钮视觉居中（justify-content 几何居中 + .cn 光学常数 translateY(-1.5px)）',
  /\.nav-actions \.seg\.constel button \{ height:30px; display:inline-flex; align-items:center; justify-content:center; padding:0 8px; \}/.test(tpl) &&
  /\.seg\.constel button \.cn \{ margin-right:-0\.16em; transform:translateY\(-1\.5px\); \}/.test(tpl));

// ==================== V1.7.1 回归守卫 ====================
console.log('--- V1.7.1 第五轮回归守卫 ---');
// 需求1：信息窗拖拽识别区不得溢出（方案 A：窗口整体留在视口内）
assert('V1.7.2（需求11）：推翻 V1.7.1 的 minL=0，恢复「可拖出屏幕」',
  /var KEEP = 24, vw = window\.innerWidth, vh = window\.innerHeight;/.test(appCode) &&
  /var minL = \(KEEP - drag\.w\) - wrap\.left;/.test(appCode) &&
  !/var minL = 0 - wrap\.left/.test(appCode));
assert('需求1：pointerdown 先做可视矩形命中测试（溢出到窗外的按下不响应）',
  /var rr = el\.getBoundingClientRect\(\);/.test(appCode) &&
  /e\.clientX < rr\.left - 1 \|\| e\.clientX > rr\.right \+ 1/.test(appCode));
// 需求2：关闭后 hover 只能出预览、不许钉住
// V1.8.0（需求8）：新增 03.5 组网进度章节，它的信息窗也要纳入「已关闭」标记
assert('V1.7.2（需求4）：INFO_HIDDEN / INFO_CLOSED / INFO_B（浮窗）三态并存，INFO_PREVIEW 已删',
  /var INFO_CLOSED = \{ chart: false, map: false, globe: false, net: false \};/.test(appCode) &&
  /var INFO_B = \{\};/.test(appCode) &&
  /function infoClearClosed\(\)/.test(appCode) &&
  !/INFO_PREVIEW/.test(appCode));
assert('V1.7.2（需求4 ③）：点 ✕ 置 INFO_CLOSED 且**浮窗也一并收掉**',
  /INFO_CLOSED\[key\] = true;/.test(appCode) &&
  /INFO_CLOSED\[key\] = true;\s*\n\s*hideFloat\(key\);/.test(appCode) &&
  /if \(!html \|\| INFO_CLOSED\[key\]\) \{ hideFloat\(key\); return; \}/.test(appCode));
assert('V1.7.2（需求4）：hover 走**浮窗** showXxxFloat（单颗），A 窗只服务选中态',
  /if \(hit\) showChartFloat\(hit\.sat\.idx\); else hideFloat\('chart'\);/.test(appCode) &&
  /if \(i !== null\) showMapFloat\(i\);/.test(appCode) &&
  /if \(best !== null\) showGlobeFloat\(best\)/.test(appCode) &&
  /function showChartFloat\(idx\)/.test(appCode) &&
  /function showMapFloat\(idx\)/.test(appCode) &&
  /function showGlobeFloat\(best\)/.test(appCode));
assert('V1.7.2（需求4）：三处 mouseleave 均只收浮窗，不再 syncSelInfo 钉回',
  (appCode.match(/hideFloat\('(chart|map|globe)'\);/g) || []).length >= 3 &&
  !/INFO_PREVIEW/.test(appCode));
// V1.7.2 第七轮（需求5，Q3=B）：基准从「A 窗整体」换成「A 窗内容区 .si-body」——
//   旧基准会把 B 窗上沿对齐到 ✕ 按钮上边缘（用户图四），现在对齐内容区上沿，
//   高度再减掉底部拖拽提示行，做到"上下边缘都对齐 A 窗的内容部分"。
assert('V1.7.2r7（需求5）：浮窗基准改为 A 窗内容区 .si-body（贴右侧 / 越界转左 / 再放不下转下方）',
  /function positionFloat\(key\)/.test(appCode) &&
  /var aBody = a\.querySelector\('\.si-body'\);/.test(appCode) &&
  /ab = \(aBody \|\| a\)\.getBoundingClientRect\(\);/.test(appCode) &&
  /left = ab\.right \+ GAP - wrap\.left;/.test(appCode) &&
  /left = ab\.left - GAP - w - wrap\.left;/.test(appCode) &&
  /top = ab\.bottom \+ GAP - wrap\.top;/.test(appCode) &&
  /left = M; top = M;/.test(appCode));
// 需求7：表格联动只用一套翻页逻辑
assert('需求7：gotoSatInTable 已删除（两套翻页逻辑并存是页号错位的根因）',
  !/function gotoSatInTable/.test(appCode) && !/gotoSatInTable\(/.test(appCode));
assert('需求7：翻页用 renderTable({jump:true}) 的 pageBounds 口径（实测行高）',
  /renderTable\(\{ jump: true \}\)/.test(appCode) &&
  /if \(jump\) hitTableRow\(\);/.test(appCode) &&
  /function hitTableRow\(\)/.test(appCode));
assert('需求7：jump 时找不到选中项把页码归 0（别停在旧页装没联动）',
  /if \(firstIdx >= 0\) \{[\s\S]{0,400}?\} else \{\s*S\.tpage = 0;\s*\}/.test(appCode));
assert('需求7：切星座后重算表格页码（两个星座行数不同，旧页号会指错）',
  /function afterConstelSwap\(\)[\s\S]{0,1200}renderTable\(\{ jump: true \}\)/.test(appCode));
// 需求9：品牌色只留一个来源
assert('需求9：--brand-c 死变量已彻底删除（CSS 与 JS 两侧）',
  !/brand-c/.test(tplCode) && !/setProperty\('--brand-c'/.test(appCode) && !/syncBrandColor/.test(appCode));
assert('需求9：品牌渐变动画有幂等守卫 + 前台兜底收尾（否则渐变永久留屏显出更鲜艳的红）',
  /if \(el\.__sweeping\) brandSweepFinish\(\);/.test(appCode) &&
  /function brandSweepFinish\(\)/.test(appCode) &&
  /document\.addEventListener\('visibilitychange'[\s\S]{0,300}brandSweepFinish/.test(appCode));
assert('需求9：.brand-name 只由 --row-sel 驱动（同一块里不再写两次 color）',
  /\.brand-name \{ color:var\(--row-sel\);/.test(tplCode));
// 需求3：顶栏三键定宽定位
assert('需求3：三键绝对定位钉在顶栏右侧（英文不再被推出视口）',
  /\.nav-actions \{ position:absolute; right:24px; top:50%; transform:translateY\(-50%\);/.test(tplCode) &&
  /padding-right:var\(--nav-actions-w, 232px\);/.test(tplCode));
assert('需求3：.nav-actions 已移出 .nav-right（留在里面会被父级宽度牵着走）',
  /<div class="nav-right">[\s\S]{0,900}?<\/div>\s*(<!--[\s\S]{0,300}?-->)?\s*<div class="nav-actions">/.test(tpl));
assert('V1.7.2（需求5/9）：layoutNav 合并为**唯一一份**（重复声明会让 V1.7.1 那份永不执行）',
  (appCode.match(/function layoutNav\(/g) || []).length === 1 &&
  /setProperty\('--nav-h', navHeight\(\)/.test(appCode) &&
  /act\.style\.right = padR \+ 'px';/.test(appCode) &&
  (appCode.match(/layoutNav\(\)/g) || []).length >= 4);
assert('需求3：顶栏左右内边距统一 24px（亮暗键到右边 = CISTrack 到左边）',
  /flex-wrap:nowrap; gap:10px 14px; padding:8px 24px;/.test(tplCode));
// 需求4 + 需求10：完全还原
assert('需求4：还原默认强制回星网 + 中文（用户明确不豁免）',
  /var needConstel = \(S\.key !== 'gw'\);/.test(appCode) &&
  /var needLang = \(LANG !== 'zh'\);/.test(appCode) &&
  /function resetAllPrefs\(\)[\s\S]{0,2600}?S\.key = 'gw';/.test(appCode) &&
  /function resetAllPrefs\(\)[\s\S]{0,2600}?LANG = 'zh';/.test(appCode));
assert('需求4：还原默认绕过切换动画（不调playNetSwitch / playLangSwitch）',
  !/function resetAllPrefs\(\)[\s\S]{0,2600}?playNetSwitch/.test(appCode) &&
  !/function resetAllPrefs\(\)[\s\S]{0,2600}?playLangSwitch/.test(appCode));
// V1.7.3（需求9）：两章时间条各自归零（旧版单值 setOffset(0) 已随字段一起废弃）
assert('需求10：还原默认把两章时间条各自归零 setOffset(0,map/globe)（滑块/文案/shifted 一起回退）',
  /function resetAllPrefs\(\)[\s\S]{0,2600}?if \(typeof setOffset === 'function'\) \{ setOffset\(0, 'map'\); setOffset\(0, 'globe'\); \}/.test(appCode));
assert('需求10：「此刻」按钮文案已改为「实时」（英文 Now 不变）',
  /b_now: \['实时', 'Now'\]/.test(appCode) && /d_now_btn: \['实时', 'Now'\]/.test(appCode) &&
  !/点「此刻」回到当前时间/.test(appCode));
// 需求8：虚线主题色
assert('需求8：倾角分布边界线与待编目批次高度线改用星座主题色 C.theme',
  /ctx\.strokeStyle = C\.theme;/.test(appCode) &&
  !/ctx\.setLineDash\(\[5, 4\]\); ctx\.lineWidth = 1;\s*ctx\.strokeStyle = C\.accent;/.test(appCode) &&
  /theme: css\('--row-sel'\)/.test(appCode));
// 需求11：? 按钮自关
assert('需求11：? 提示框改 toggle 语义（点同一个按钮 = 关掉）',
  /if \(open && open\.__key === key\) \{ open\.remove\(\); return; \}/.test(appCode) &&
  /p\.__key = key;/.test(appCode));
// 需求12：禁选
assert('需求12：全站禁选兜底规则 + 放行输入框/说明/表格数据',
  /body, body \*:not\(input\):not\(textarea\) \{/.test(tplCode) &&
  /-webkit-touch-callout:none;/.test(tplCode) &&
  /#tbody td, #launchBody td \{/.test(tplCode) &&
  /-webkit-user-select:text; -moz-user-select:text/.test(tplCode));


// ==================== V1.7.2 第六轮回归守卫 ====================
console.log('--- V1.7.2 第六轮回归守卫 ---');
// 需求1/2：信息窗永不换列 + 高度按视口算（根治窄屏「换列 → 左溢出 → 滚动条」三连）
assert('V1.7.2（需求1）：.sat-info 永不换列（flex-wrap:nowrap）+ 两侧不滚动（overflow:hidden）',
  /\.sat-info \{[^}]*flex-direction:column;\s*flex-wrap:nowrap;/.test(tplCode) &&
  /\.sat-info \{[^}]*overflow:hidden;/.test(tplCode));
assert('V1.7.2（需求1）：max-height 基准从「容器」改成「视口」（容器再矮也不挤压信息窗）',
  /\.sat-info \{[^}]*max-height:calc\(100vh - 40px\)/.test(tplCode) &&
  !/\.sat-info \{[^}]*max-height:calc\(100% - 32px\)/.test(tplCode) &&
  /\.sat-info \{ max-height:calc\(100vh - 20px\); \}/.test(tplCode));
assert('V1.7.2（需求1）：.si-head 钉 flex:0 0 auto（× 按钮任何尺寸都不被压掉）',
  /\.sat-info \.si-head \{[^}]*flex:0 0 auto;/.test(tplCode));
assert('V1.7.2（需求1）：.si-body 用 flex:1 1 auto + min-height:0 + overflow:hidden',
  /\.sat-info \.si-body \{[^}]*flex:1 1 auto;[^}]*min-height:0;[^}]*overflow:hidden;/.test(tplCode));
assert('V1.7.2（需求1）：≤400px 极窄断点把 .si-block min-width 降到 118px（防窄屏横向溢出）',
  /@media \(max-width:400px\)/.test(tplCode) &&
  /\.sat-info \.si-block \{ min-width:118px;/.test(tplCode));
assert('V1.7.2（需求2）：pointerdown 仍做可视矩形命中测试（识别区不得越出窗口）',
  /e\.clientX < rr\.left - 1 \|\| e\.clientX > rr\.right \+ 1/.test(appCode));
// 需求3：红线与闪动的根治
// V1.7.2 第七轮（需求4）：旧断言要求浮窗带 border-left:3px 主题色 —— 那正是用户第七轮
//   点名的"B 窗不该有左边框"。现在反过来：浮窗**任何**边框/轮廓/阴影都必须被清掉。
assert('V1.7.2r7（需求4）：B 浮窗无任何主题色边框（border-left 也不许有）',
  /\.sat-info\.floatwin \{[^}]*pointer-events:none;/.test(tplCode) &&
  !/\.sat-info\.floatwin \{[^}]*border-left/.test(tplCode) &&
  !/box-shadow:inset 2px 0 0 var\(--row-sel\)/.test(tplCode) &&
  /\.sat-info\.floatwin \.si-body \{ border:0 !important; outline:0 !important; box-shadow:none !important; \}/.test(tplCode));
assert('V1.7.2（需求3）：浮窗 pointer-events:none 根治"鬼畜闪动"（不再抢 canvas 的 mouseleave）',
  /pointer-events:none/.test(tplCode) && /function showFloat\(key, html, idKey\)/.test(appCode));
assert('V1.7.2（需求3）：浮窗不渲染 .si-head（无 ✕）与 .si-drag（无拖动提示）',
  /el\.innerHTML = '<div class="si-body"><\/div>'/.test(appCode));
// 需求4：三态交互
assert('V1.7.2（需求4）：每章新增一个浮窗 DOM 元素（#chartInfoB / #mapInfoB / #globeInfoB）',
  /id="chartInfoB"/.test(tpl) && /id="mapInfoB"/.test(tpl) && /id="globeInfoB"/.test(tpl));
assert('V1.7.2（需求4）：A 窗与浮窗共用同一份内容生成函数（格式必然一致）',
  /function mapBlockHtml\(idx\)/.test(appCode) && /function globeBlockHtml\(best\)/.test(appCode) &&
  /showFloat\('map', html, 'sat' \+ idx\)/.test(appCode));
assert('V1.7.2（需求4 ②）：多选时 A 窗只显示一颗（focusIdx 优先，否则 NORAD 最小）',
  /if \(S\.focusIdx != null && cur\(\)\.sats\[S\.focusIdx\]\) \{/.test(appCode) &&
  /if \(n < bestN\) \{ bestN = n; best = i; \}/.test(appCode));
assert('V1.7.2（需求4 ④）：图上多选后点任意一颗 = 组内切换（sel 不变、只换 focusIdx）',
  /if \(S\.sel\.length > 1 \|\| S\.selGroup\) \{\s*\n\s*S\.focusIdx = idx;/.test(appCode));
assert('V1.7.2（需求4 ⑤）：关闭后 A 窗与浮窗都不显示（syncSelInfo 尊重 INFO_CLOSED）',
  /if \(!INFO_CLOSED\.chart\) showChartInfo/.test(appCode) &&
  /if \(!INFO_CLOSED\.map\) showMapInfo/.test(appCode));
assert('V1.7.2（需求4）：selectGroup 整批选中时清 focusIdx（回到"显示 NORAD 最小那颗"）',
  /function selectGroup\(lk\)[\s\S]{0,700}?S\.selGroup = null;[\s\S]{0,80}?S\.focusIdx = null;/.test(appCode));
// 需求5/9：顶栏
assert('V1.7.2（需求5/9）：layoutNav 只有一份声明（V1.7.1 那份被提升覆盖、从未执行）',
  (appCode.match(/function layoutNav\(/g) || []).length === 1);
assert('V1.7.2（需求5/9）：合并版同时保留 --nav-h（时钟药丸定位依赖）与三键让位',
  /setProperty\('--nav-h', navHeight\(\) \+ 'px'\)/.test(appCode) &&
  /right\.style\.paddingRight = \(m\.actW \+ 22\) \+ 'px';/.test(appCode));
assert('V1.7.2（需求9）：极窄屏四级降级 L0-L3 常量与分支齐全',
  /var NAV_W0 = 480;/.test(appCode) && /var NAV_BRAND_MIN = 18;/.test(appCode) &&
  /var NAV_BTN_MIN_W = 16;/.test(appCode) &&
  // V1.7.2 第七轮（需求1/3）：L0 出口补了一次 navFollowUp()（顶栏不调也要重算色块与标题间距）
  /if \(vw >= NAV_W0\) \{ navFollowUp\(\); return; \}/.test(appCode) &&
  /seg\.classList\.add\('compact'\);/.test(appCode));
assert('V1.7.2（需求9）：每档都先复位再测量（否则窗口来回拉会累积式变窄）',
  /seg\.classList\.remove\('compact'\);/.test(appCode) &&
  /b\.style\.width = '';/.test(appCode) && /brand\.style\.fontSize = '';/.test(appCode));
assert('V1.7.2（需求9）：L3 有对应 CSS（去文字只显色）+ 各断点字号降级已全部删除',
  /\.seg\.constel\.compact button \.cn \{ display:none; \}/.test(tplCode) &&
  !/\.seg\.constel button \{[^}]*font-size:10px/.test(tplCode) &&
  /\.seg\.constel button \{ padding:7px 10px; \}/.test(tplCode));
assert('V1.7.2（需求5/9）：CSS gap 与 JS 的 G 一致（宽屏 12 / 窄屏 8）',
  /\.nav-actions \{ position:absolute;[\s\S]{0,200}?gap:12px;/.test(tplCode) &&
  /\.nav-actions \{ gap:8px; right:16px; \}/.test(tplCode) &&
  /var G = vw >= NAV_W0 \? 12 : 8;/.test(appCode));
// 需求6：全屏死区
assert('V1.7.2（需求6）：isFsMode 认全屏 / 伪全屏 / 章节级全屏三种形态',
  /function isFsMode\(\)/.test(appCode) &&
  /document\.fullscreenElement/.test(appCode) &&
  /pseudo-full/.test(appCode) &&
  /section\.fs-mobile/.test(appCode));
assert('V1.7.2（需求6）：chartHitZone 与 mapHitZone 在全屏下直接放行（无死区）',
  /function chartHitZone\(clientX, clientY\) \{\s*\n\s*if \(isFsMode\(\)\) return true;/.test(appCode) &&
  /function mapHitZone\(clientX, clientY\) \{\s*\n\s*if \(isFsMode\(\)\) return true;/.test(appCode));
// 需求7：TLE 更新时间
assert('V1.7.2（需求7）：信息窗与导出图的「数据更新」都改成「TLE更新时间 / TLE updated」',
  /d_dataupd: \['TLE更新时间', 'TLE updated'\]/.test(appCode) &&
  !/d_dataupd: \['数据更新'/.test(appCode));
// 需求8：倾角限位
assert('V1.7.2（需求8）：倾角定义域放宽到 0–180°（容纳逆行轨道），边界线标签同步',
  /var CHART_X_MIN = 0, CHART_X_MAX = 180;/.test(appCode) &&
  /ctx\.fillText\('180°', bx - 4, PT \+ 4\)/.test(appCode));
// 需求10：表格单选
assert('V1.7.2（需求10）：卫星表格内多选后单击任一颗 = 取消全部、单选它（仅表格）',
  /tbody\.addEventListener\('click'[\s\S]{0,900}?if \(S\.sel\.length > 1 \|\| S\.selGroup\) \{[\s\S]{0,300}?S\.sel = \[idx\];/.test(appCode));
assert('V1.7.2（需求10）：图表的组内切换逻辑未被这条改动波及（toggleSel 仍独立处理）',
  /function toggleSel\(idx, additive\)/.test(appCode) &&
  /if \(S\.sel\.length > 1 \|\| S\.selGroup\) \{\s*\n\s*S\.focusIdx = idx;\s*\n\s*infoClearClosed\(\);/.test(appCode));
// 需求11：恢复可拖出屏幕
assert('V1.7.2（需求11）：钳制恢复「至少留 24px 在视口内」，页面仍不撑宽（overflow-x:hidden 兜底）',
  /var KEEP = 24, vw = window\.innerWidth, vh = window\.innerHeight;/.test(appCode) &&
  /html \{[\s\S]{0,120}overflow-x:hidden/.test(tpl));
// 需求12：手机滑动切星座
assert('V1.7.2（需求12）：滑动切星座与点按钮共用同一入口 switchConstel（状态/动画完全一致）',
  /function switchConstel\(toKey\)/.test(appCode) &&
  /constelSeg'\)\.addEventListener\('click'[\s\S]{0,200}switchConstel\(b\.getAttribute\('data-c'\)\)/.test(appCode) &&
  /swipe = \{ x0[\s\S]{0,2600}switchConstel\(target\);/.test(appCode));
assert('V1.7.2（需求12）：六道防误触闸门（触屏非全屏/空白元素/72px/2.2倍/0.35px每ms/方向匹配）',
  /if \(!isTouch\(\) \|\| isFsMode\(\)\) return;/.test(appCode) &&
  /SWIPE_BLANK_SEL/.test(appCode) &&
  /var SWIPE_MIN_DX = 72, SWIPE_RATIO = 2\.2, SWIPE_MIN_V = 0\.35;/.test(appCode) &&
  /e\.defaultPrevented\) \{ swipe = null; return; \}/.test(appCode) &&
  /S\.key === 'gw' && dx < 0\) \? 'qf'/.test(appCode));
assert('V1.7.2（需求12）：touch 监听全部 passive（不阻止页面正常上下滚动）',
  // touchstart / touchmove 各自带 passive；touchend+touchcancel 走 forEach(变量)，只能按 forEach 块查
  /addEventListener\('touchstart',[\s\S]{0,3000}?\{ passive: true \}\);/.test(appCode) &&
  /addEventListener\('touchmove',[\s\S]{0,3000}?\{ passive: true \}\);/.test(appCode) &&
  /\['touchend', 'touchcancel'\]\.forEach[\s\S]{0,300}?\{ passive: true \}\);/.test(appCode));

/* ══════════════════════════════════════════════════════════════════════════
 * V1.7.2 第七轮（修补轮）—— 反向守卫
 * 这一轮做的多是「删掉/收口」，所以断言以「必须不存在」「必须早退」为主，
 * 目的是防止以后有人手滑把已删的东西加回来。
 * ══════════════════════════════════════════════════════════════════════════ */
console.log('--- V1.7.2 第七轮 ---');
// 需求2：顶栏章节切换按钮 + 「更新历元」行 —— 已删，且不允许回来
assert('V1.7.2r7（需求2）：app.js 里不再有任何 navlinks / navUpd 逻辑',
  !/navlinks/.test(appCode) && !/navUpd/.test(appCode) &&
  !/nav-updated/.test(appCode) && !/navUpdated/.test(appCode));
assert('V1.7.2r7（需求2）：template 里 .navlinks / .nav-updated 的 DOM 与 CSS 全清',
  !/class="navlinks"/.test(tplCode) && !/nav-updated/.test(tplCode) && !/\.navlinks/.test(tplCode));
assert('V1.7.2r7（需求2）：顶栏右侧留了空容器 .nav-right（layoutNav 依赖它的计算宽度）',
  /<div class="nav-right"><\/div>/.test(tplCode));
// 需求2/新需求A：历元行常驻主标题下方
assert('V1.7.2r7（需求2）：#pageEpoch 常驻（CSS 里不得再有 display:none）',
  /id="pageEpoch"/.test(tplCode) &&
  !/\.page-epoch\s*\{[^}]*display\s*:\s*none/.test(tplCode));
assert('V1.7.2r7（新需求A）：信息窗 satBlock 只输出「该星历元」一行，不含 TLE更新时间',
  /function satBlock\(s, scope, extra\) \{[\s\S]*?\n\}/.test(appCode) &&
  (function () {
    const body = appCode.match(/function satBlock\(s, scope, extra\) \{[\s\S]*?\n\}/)[0];
    return /d_row_epoch_sat/.test(body) && !/d_dataupd/.test(body);
  })());
assert('V1.7.2r7（新需求A）：导出底栏 rest 里不再拼 TLE更新时间',
  /var rest = \[VERSION, st\.name, title, timePart\]\.join\(' \| '\);/.test(appCode));
// 需求3：标题上端间距 = 药丸上端到顶栏下边缘
assert('V1.7.2r7（需求3）：layoutTitleGap 用文档坐标换算（滚动中重算也不会得出荒唐值）',
  /function layoutTitleGap\(\)/.test(appCode) &&
  /var glyphDoc = titleGlyphTop\(pt\) \+ \(window\.pageYOffset \|\| 0\);/.test(appCode) &&
  /var target = navH \+ pillGap \+ pr\.height \+ pillGap;/.test(appCode));
assert('V1.7.2r7（需求1/3）：navFollowUp 在 layoutNav 的 L0 出口与常规出口都调用（≥3 处含定义）',
  (appCode.match(/navFollowUp\(\)/g) || []).length >= 3 &&
  /function navFollowUp\(\) \{\s*\n\s*try \{ moveConstelSlider\(S\.key, false\); \} catch \(e\) \{\}/.test(appCode));
assert('V1.7.2r7（需求1）：语言切换收尾（顶栏归位后）重算色块与标题间距',
  /setTimeout\(function \(\) \{[\s\S]{0,600}?moveConstelSlider\(S\.key, false\)[\s\S]{0,200}?layoutTitleGap\(\)[\s\S]{0,120}?\}, ANIM\.lang \+ 60\);/.test(appCode));
// 需求4：拖动边框改 border（outline 被 overflow:hidden 裁掉只剩顶边）
assert('V1.7.2r7（需求4）：A 窗拖动边框用 border（不再用会被裁掉的 outline）',
  /\.sat-info\.moving \.si-body \{ border:1px solid var\(--row-sel\); box-sizing:border-box; \}/.test(tplCode) &&
  !/\.sat-info\.moving \.si-body \{ outline:/.test(tplCode));
assert('V1.7.2r7（需求4）：B 浮窗三层防线（border/outline/shadow 清零 + --row-sel 置透明）',
  /\.sat-info\.floatwin,\s*\n\s*\.sat-info\.floatwin \.si-body \{ border:0 !important; outline:0 !important; box-shadow:none !important; \}/.test(tplCode) &&
  /\.sat-info\.floatwin \* \{ --row-sel: transparent; \}/.test(tplCode));
assert('V1.7.2r7（需求4）：浮窗被 pointerdown 拖动逻辑显式排除（根治边框泄露）',
  /if \(el\.classList\.contains\('floatwin'\)\) return;/.test(appCode));
// 需求5：B 窗与 A 窗内容区上下边缘对齐 + 无 hover 设备不弹
assert('V1.7.2r7（需求5）：positionFloat 以 .si-body 为基准，上沿对齐内容区、高度减去拖拽提示行',
  /var aTip = aBody \? aBody\.querySelector\('\.si-drag'\) : null;/.test(appCode) &&
  /left = ab\.right \+ GAP - wrap\.left;[\s\S]{0,200}?top = ab\.top - wrap\.top;/.test(appCode) &&
  /el\.style\.height = \(naturalH <= wantH \+ 1\) \? wantH \+ 'px' : '';/.test(appCode));
assert('V1.7.2r7（需求5）：无 hover 能力的设备不弹 B 浮窗（手机 tap 合成的 mousemove 不再留下重复窗）',
  /function noHover\(\) \{/.test(appCode) &&
  /matchMedia\('\(hover: hover\)'\)/.test(appCode) &&
  /if \(noHover\(\)\) \{ hideFloat\(key\); return; \}/.test(appCode));
assert('V1.7.2r7（需求5）：noHover 缓存 MediaQueryList（对象是 live 的，外接鼠标后能自动恢复）',
  /var MQ_HOVER = null;/.test(appCode) && /if \(!MQ_HOVER\) MQ_HOVER = matchMedia\('\(hover: hover\)'\);/.test(appCode));
// 需求7：第 0 章要能横滑
assert('V1.7.2r7（需求7）：SWIPE_BLANK_SEL 已移出 .sec-head / .hero（第0章空白恢复横滑）',
  (function () {
    const m = appCode.match(/var SWIPE_BLANK_SEL = ([\s\S]{0,300}?);\n/);
    if (!m) return false;
    return !/\.sec-head/.test(m[1]) && !/\.hero\b/.test(m[1]) && /\.controls/.test(m[1]);
  })());
// 需求8b：名称开关提到最外层短路之前
// ★ V1.8.0（需求4①）修订：开关的淡入/淡出需要「开关已关、但动画系数还没归零」的这 520ms 里
//   继续绘制（否则根本画不出淡出，标注会「啪」地消失）。因此最外层条件由 `S.names.map`
//   扩成 `S.names.map || TOG.nameMap > 0.01`。TOG 走 animTo(easeOutCubic, 520ms)，末帧被
//   赋成**精确的 0**，所以动画结束后两者的布尔结果逐字等价 —— 守卫要保的语义
//   （关掉开关＝标注必然消失）没有松动，只是过程由瞬变改为淡出。
assert('V1.7.2r7（需求8b）：地图标签把 S.names.map 提到最外层（选中星也能关掉）',
  /var showLabel = \(S\.names\.map \|\| TOG\.nameMap > 0\.01\) && \(sel2 \|\| mapHover === m \|\| visHi \|\| \(!pickOn && !hasSel\)\);/.test(appCode));
assert('V1.7.2r7（需求8b）：地球标签同样以 S.names.globe 为最外层条件',
  /if \(!hidden && \(S\.names\.globe \|\| TOG\.nameGlobe > 0\.01\) && \(sel4 \|\| G\.hover === m \|\| !hasSelG\)\) \{/.test(appCode));
// 需求8c：选星时两章名称开关同步打开、关闭各自独立
assert('V1.7.2r7（需求8c）：选星（选中集/焦点变化）时两章名称开关同步打开',
  /var LAST_SEL_SIG = null;/.test(appCode) &&
  /if \(selSig !== LAST_SEL_SIG && S\.sel\.length\) \{\s*\n\s*S\.names\.map = true; S\.names\.globe = true;\s*\n\s*syncNameBtns\(\);/.test(appCode));
assert('V1.7.2r7（需求8c）：syncNameBtns 只负责把按钮态对齐状态（关闭各自独立，不被重绘掰开）',
  /function syncNameBtns\(\) \{/.test(appCode) &&
  /b\.classList\.toggle\('on', p\[1\]\);/.test(appCode));
// 需求8a：轨道开关管住选中星/悬停星的轨道
assert('V1.7.2r7（需求8a）：选中星(0.9)与悬停星(0.75)的轨道绘制被包进同一个 S.mapTrack 块',
  /if \(S\.mapTrack\) \{[\s\S]{0,800}?strokeTrack\(sj, 0\.9\);[\s\S]{0,400}?strokeTrack\(mapHover, 0\.75\);[\s\S]{0,40}?\n  \}/.test(appCode));
assert('V1.7.2r7（需求8a）：drawMap 里不存在游离在 S.mapTrack 块之外的 strokeTrack 调用',
  (function () {
    // strokeTrack 是 drawMap 内部的局部函数，全项目只有 3 处调用（全部轨道/选中 0.9/悬停 0.75），
    // 这 3 处必须都被同一个 `if (S.mapTrack) {` 块包住 —— 用花括号配对数出该块的真实跨度。
    const lines = appCode.split('\n');
    const calls = [];
    lines.forEach(function (l, i) {
      if (/strokeTrack\(/.test(l) && !/function strokeTrack/.test(l)) calls.push(i);
    });
    const open = lines.findIndex(function (l) { return /^\s*if \(S\.mapTrack\) \{$/.test(l); });
    if (open < 0 || calls.length !== 3) return false;
    let depth = 0, close = -1;
    for (let i = open; i < lines.length; i++) {
      for (const ch of lines[i]) { if (ch === '{') depth++; else if (ch === '}') depth--; }
      if (depth === 0) { close = i; break; }
    }
    return close > open && calls.every(function (i) { return i > open && i < close; });
  })());
// ── 跨浏览器体检发现的额外缺陷（320px 英文态 select 溢出被裁）—— 约束必须存在 ──
assert('V1.7.2r7（体检）：≤400px 给 .controls .ctl 解除 min-width:auto 陷阱（320px 英文态 select 不再撑破视口）',
  /@media \(max-width:400px\) \{[\s\S]{0,900}?\.controls \.ctl \{ min-width:0; \}/.test(tplCode) &&
  /\.controls \.ctl select \{ max-width:100%; \}/.test(tplCode));
// ── 反向守卫：被证伪的「滚动锚定」补偿代码不得回潮（真实原因见 app.js 里 playLangSwitch 开头的记录）──
assert('V1.7.2r7（体检）：playLangSwitch 不含滚动还原补偿（该"缺陷"已被 13 组对照实验证伪为探针假象）',
  !/还原被「滚动锚定」顶走/.test(appCode) && !/var y0 = window\.pageYOffset \|\| 0;/.test(appCode));
assert('V1.7.2r7（体检）：playLangSwitch 保留"已排除的疑点"记录注释（防止后人再走一遍弯路）',
  /已排除的疑点，记录备查/.test(appSrc) && /#loadMask/.test(appSrc) && /不做任何补偿代码/.test(appSrc));

// ==================== V1.8.0（第九轮）回归守卫 ====================
// 这一轮改动量最大（新章节 + 两条新列 + 四联动效 + i18n 审计），所以逐条上守卫，
// 目的：任何一个被改回去都会在这里立刻报警，而不是等到用户肉眼在某个尺寸下发现。
console.log('--- V1.8.0（第九轮）回归守卫 ---');

// 需求⑱（根治项）：两张坐标图的图像必须在横纵坐标线上截止 —— canvas 级 clip，而不是「越界点跳过」
assert('V1.8.0（需求⑱）：drawChart / drawNet 都在绘图区矩形上做 canvas 级裁剪',
  (appCode.match(/ctx\.rect\(PL, PT, pw, ph\); ctx\.clip\(\);/g) || []).length >= 2 &&
  /V1\.8\.0（需求17 \/ ⑱）：绘图区硬裁剪/.test(appSrc) &&
  /需求17 \/ ⑱）同样裁剪到绘图区/.test(appSrc));

// 需求Q4-①：开关画布同步（图层随开关淡入淡出）
assert('V1.8.0（需求Q4①）：图层开关动画系数 TOG + togAnim / togSyncAll 齐备',
  /var TOG = \{ covOn: 1, mapTrack: 1, nameMap: 1, coneOn: 1, showTracks: 1, nameGlobe: 1, pickOn: 0 \};/.test(appCode) &&
  /function togAnim\(key, on\) \{/.test(appCode) &&
  /function togSyncAll\(\) \{/.test(appCode) &&
  (appCode.match(/togAnim\('/g) || []).length >= 6 &&           // 六个开关各接一次
  /try \{ togSyncAll\(\); \} catch \(e\) \{\}/.test(appCode));    // 还原 / 换星座时系数归位

// 需求Q4-②：配色插值（按卫星 ⇄ 按批次 之间逐帧过渡）
assert('V1.8.0（需求Q4②）：配色插值 COLORMIX + _mix，colOf 在过渡期返回中间色',
  /var COLORMIX = null;/.test(appCode) && /function _mix\(c1, c2, k\)/.test(appCode) &&
  /if \(COLORMIX && COLORMIX\.scope === scope\)/.test(appCode) &&
  /return _mix\(from, to, 1 - Math\.pow\(1 - k, 3\)\);/.test(appCode));

// 需求Q4-③：观测点进出（标记与标签淡入淡出）
assert('V1.8.0（需求Q4③）：观测点进出用 PICK_FADE + TOG.pickOn 淡入淡出',
  /var PICK_FADE = null;/.test(appCode) && /pickAlpha = TOG\.pickOn/.test(appCode) &&
  /ctx\.globalAlpha = 0\.12 \* pickAlpha/.test(appCode) && /ctx\.globalAlpha = pickAlpha/.test(appCode));

// 需求Q4-④：表格翻页「淡消失 → 淡出现」（非线性，只作用于 tbody）
assert('V1.8.0（需求Q4④）：两张表翻页都走 fadeTableSwap（淡出 260ms + 淡入 260ms）',
  /function fadeTableSwap\(tb, swap\) \{/.test(appCode) &&
  /var TBL_FADE = 260, tblFadeToken = 0;/.test(appCode) &&
  (appCode.match(/fadeTableSwap\(/g) || []).length >= 5 &&      // 定义 + 4 个调用点（两表各自的按钮与跳页）
  /@keyframes tblFadeOut/.test(tplCode) && /@keyframes tblFadeIn/.test(tplCode) &&
  /\.tbl-fade-out \{ animation: tblFadeOut var\(--anim-half\) var\(--ease-slow-fast\) forwards; \}/.test(tplCode) &&
  /\.tbl-fade-in  \{ animation: tblFadeIn  var\(--anim-half\) var\(--ease-fast-slow\) forwards; \}/.test(tplCode));

// 需求8：新增 03.5「组网进度」章节
assert('V1.8.0（需求8）：03.5 组网进度章节存在且走「顶栏让位」全屏布局',
  /<section id="sec-progress">/.test(tplCode) && /<canvas id="netCv">/.test(tplCode) &&
  /#sec-progress\.fs-mobile \.chart-wrap \{ height:100vh; padding-top:var\(--fsbar-h, 58px\); \}/.test(tplCode) &&
  /#sec-progress\.fs-mobile \.controls \{[\s\S]{0,400}?position:fixed/.test(tplCode));
assert('V1.8.0（需求8）：组网进度的口径 / 星座开关进入偏好系统（按星座各存一份）',
  /netMode: 'launch', netGw: true, netQf: true/.test(appCode) &&
  /progress: \['netMode', 'netGw', 'netQf'\]/.test(appCode) &&
  /function netCountOf\(L, mode\)/.test(appCode) &&
  // 「在轨数量」= 有 TLE 的颗数 + 已发射未编目且**发射记录为成功**的颗数
  /L\.pending > 0 && L\.res !== 'fail'/.test(appCode));
assert('V1.8.0（需求8）：四张图的缩放/复位走同一套通用通路（03.5 不再有 data-netzoom 旁路）',
  !/data-netzoom/.test(appCode) && !/data-netzoom/.test(tplCode) && !/data-netreset/.test(tplCode) &&
  /view === 'progress'\) \{[\s\S]{0,260}?smoothZoom\(function \(f\) \{ zoomNetBy\(f\); \}, dir, 260\);/.test(appCode) &&
  /else if \(view === 'progress'\) \{ netView = null; netAutoView\(\); drawNet\(\); \}/.test(appCode) &&
  /data-zoom="in" data-view="progress"/.test(tplCode));

// 需求5/6/12：发射历史的任务结果列 + 卫星表的发射时间列
assert('V1.8.0（需求6）：launches 台账第 6 位=任务结果、第 7 位=百科记载颗数',
  Object.values(RAW.gw.launches).filter(v => v.length >= 6).length >= Math.floor(Object.keys(RAW.gw.launches).length * 0.9) &&
  Object.values(RAW.qf.launches).every(v => v.length >= 6) &&
  ['ok', 'part', 'fail', '?'].includes(Object.values(RAW.gw.launches).find(v => v[0] === '试验星07组')[5]));
assert('V1.8.0（需求12）：卫星表插入「发射时间」列、发射历史插入「任务结果」列',
  /t_ltime: /.test(appCode) && /t_result: /.test(appCode) &&
  /res_ok: /.test(appCode) && /res_part: /.test(appCode) && /res_fail: /.test(appCode) &&
  /function resTag\(L\)/.test(appCode) &&
  [...d.querySelectorAll('#satTable thead th')].map(t => t.getAttribute('data-key')).indexOf('ltime') === 3 &&
  [...d.querySelectorAll('#launchTable thead th')].some(t => /t_result/.test(t.getAttribute('data-i18n') || '')));
assert('V1.8.0（需求12）：任务结果按百科记载如实标注（成功/部分成功/失败，没写就不猜）',
  /if \(r === 'ok'\) return '<span class="res res-ok">'/.test(appCode) &&
  /if \(r === 'part'\) return '<span class="res res-part">'/.test(appCode) &&
  /if \(r === 'fail'\) return '<span class="res res-fail">'/.test(appCode) &&
  /\.res-none \{ color:var\(--dim\); font-weight:400; \}/.test(tplCode));

// 需求2/3/13：呼吸填充、主题色填充按钮、两表居中
assert('V1.8.0（需求2）：实时按钮呼吸态 = 主题色填充 + 文字用 --fg（暗白 / 亮黑）',
  /\.time-val\.rt-breathe \{ background:var\(--row-sel\); color:var\(--fg\); \}/.test(tplCode));
assert('V1.8.0（需求3）：说明 / 还原所有默认设置 = 主题色填充；各章默认设置 = 主题色边框',
  /button\.ghost\.btn-accent, button\.readme-btn\.btn-accent \{[\s\S]{0,160}?background:var\(--row-sel\); border-color:transparent; color:var\(--fg\);/.test(tplCode) &&
  /button\.ghost\[data-defsec\] \{ border-color:var\(--row-sel\); color:var\(--row-sel\); \}/.test(tplCode) &&
  /button\.ghost\[data-defsec\]\.sec-clean \{ border-color:var\(--hair\); color:var\(--dim\); filter:none; \}/.test(tplCode) &&
  /button\.ghost\.btn-accent\.dimmed/.test(tplCode) &&
  /function sectionIsDefault\(sec\)/.test(appCode));
assert('V1.8.0（需求13）：两张表格的记录一律居中（首列左对齐由 tbody td:first-child 保留）',
  /\.ltable th, \.ltable td \{ text-align:center; \}/.test(tplCode) &&
  /tbody td:first-child \{ text-align:left; \}/.test(tplCode));

// 需求15：i18n 审计暴露的真缺陷 —— 这三个守卫各自对应一个"页面上真的漏出过中文"的点
assert('V1.8.0（需求15）：03.5 章的 n_gw / n_qf 两个键已补进 I18N（此前会把键名当文字画出来）',
  /n_gw: \['星网', 'CSCN'\], n_qf: \['千帆', 'Qianfan'\],/.test(appCode));
assert('V1.8.0（需求15）：中英括号分制（paren 助手；英文界面不得漏出全角「（）」）',
  /function paren\(s\) \{ return LANG === 'en' \? ' \(' \+ s \+ '\)' : '（' \+ s \+ '）'; \}/.test(appCode) &&
  /' km' \+ paren\(fmtNum\(st\.minAlt, 0\)/.test(appCode) &&
  !/km（' \+ fmtNum\(st\.minAlt/.test(appCode));
assert('V1.8.0（需求15）：批次名英文侧补「千帆 / 星网」前缀规则（DTC 批次此前漏出中文）',
  /\.replace\(\/\^千帆\\s\+\(\.\+\)\$\/, 'Qianfan \$1'\)/.test(appCode) &&
  /\.replace\(\/\^星网\\s\+\(\.\+\)\$\/, 'CSCN \$1'\)/.test(appCode));

// 需求16「恢复默认增强」：章节「默认设置」要与「还原所有默认设置」同口径（三条一起）
// ★ 前两条守卫对应**实测踩过的两个真坑**（曾让补间完全不生效，逐帧抓到的轨迹是 [30,0,0,…]）：
//   ① 起跳偏移必须在 `(PREF_SEC[sec]||[]).forEach(…)` **之前**取出 —— timeOffsetMap /
//      timeOffsetGlobe 本身就在 PREF_SEC 里，forEach 会把它们覆写成 PREF_DEF 的 0，
//      之后再读 p.* 恒为 0 → `if (off0)` 永远不成立，补间分支根本进不去；
//   ② animateTo 的起跳点必须重取 el.value —— syncTimeUI() 直接写 el.value 而不经 applyV，
//      闭包里的 shown 会停在旧值，于是 from===target → 第一句就 applyV(0) 变瞬跳。
const _resetSecSrc = (appCode.match(/function resetSection\(sec\) \{[\s\S]*?\n\}/) || [''])[0];
const _prefSecIdx = _resetSecSrc.indexOf('(PREF_SEC[sec] || []).forEach');
const _offFromIdx = _resetSecSrc.indexOf('var offFrom =');
assert('V1.8.0（需求16）：章节「默认设置」的起跳偏移在 PREF_SEC 覆写**之前**取出（否则恒为 0，补间永不触发）',
  _offFromIdx >= 0 && _prefSecIdx >= 0 && _offFromIdx < _prefSecIdx,
  'offFrom@' + _offFromIdx + ' < forEach@' + _prefSecIdx);
assert('V1.8.0（需求16）：章节「默认设置」把时间条**补间**回实时（setOffset 归位 → __animateTo(0)）',
  /setOffset\(off0, tvTween\);\s*\n\s*tr\.__animateTo\(0\);/.test(appCode));
assert('V1.8.0（需求16）：animateTo 起跳点重取滑条真实值（防 syncTimeUI 直写 value 造成的瞬跳）',
  /if \(!tween\) shown = \+el\.value;/.test(appCode));
assert('V1.8.0（需求16）：章节「默认设置」把观测点整组摆回出厂（退出模式 + 解除固定 + 位置/仰角归零）',
  /S\.pick = \{ on: false, fixed: false, lat: 30, lon: 116, el: 0, mx: null, my: null \};/.test(appCode) &&
  /S\.mz = \{ k: 1, tx: 0, ty: 0 \};/.test(appCode));
assert('V1.8.0（需求16）：章节「默认设置」把本章视图回出厂（地图缩放平移 / 地球姿态与缩放）',
  /if \(sec === 'globe'\) \{ G\.yaw = 100 \* RAD; G\.pitch = 22 \* RAD; G\.zoom = 1; \}/.test(appCode));

$('#themeBtn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));


await new Promise(r => setTimeout(r, 400));
console.log('--- 汇总');
console.log('错误数:', errors.length);
errors.slice(0, 8).forEach(e => console.log('  ! ' + e));
dom.window.close();
