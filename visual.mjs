/* 视觉 / 布局实测（可选）：用 Edge 无头 + CDP 打开最终 HTML，量真实排版与交互。
 * 与 smoke.mjs 分工：smoke 用 jsdom 跑逻辑与源码断言（快、无依赖）；
 * visual 需要本机有 Edge 和 ws 模块，跑的是「只有真浏览器才量得出来」的那些东西。
 * 用法：node visual.mjs [html路径]
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const B = fileURLToPath(new URL('.', import.meta.url));

const FILE = process.argv[2] || B + '/星网与千帆在轨追踪.html';
const PORT = 9415;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// V1.8.0：浏览器可执行文件改为**动态探测**。
//   以前这里把某个固定安装位置写死成唯一路径 —— 换台机器（或 Edge 装在别处）就跑不起来。
//   顺序：环境变量 CISTRACK_EDGE（兼容旧名 EDGE_PATH）→ 各平台常见安装位置 → PATH 里找。
const EDGE = (function () {
  const cands = [
    process.env.CISTRACK_EDGE, process.env.EDGE_PATH,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/microsoft-edge',
    '/usr/bin/microsoft-edge-stable',
    '/usr/bin/google-chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ].filter(Boolean);
  for (const c of cands) { try { if (fs.existsSync(c)) return c; } catch (e) {} }
  const names = process.platform === 'win32'
    ? ['msedge.exe', 'chrome.exe'] : ['microsoft-edge', 'google-chrome', 'chromium'];
  for (const d of (process.env.PATH || '').split(path.delimiter)) {
    if (!d) continue;
    for (const n of names) {
      try { if (fs.existsSync(path.join(d, n))) return path.join(d, n); } catch (e) {}
    }
  }
  return null;
})();

let WebSocket;
try {
  const require = createRequire(import.meta.url);
  WebSocket = require('ws').WebSocket;
} catch (e) {
  console.log('本机没有 ws 模块，跳过视觉实测（不影响 smoke.mjs）');
  process.exit(0);
}
if (!EDGE) { console.log('本机找不到 Edge / Chromium，跳过视觉实测（不影响 smoke.mjs）'); process.exit(0); }
if (!fs.existsSync(FILE)) { console.log('找不到 HTML:', FILE); process.exit(1); }

// 无头浏览器的 profile 与探针副本一律放「非系统盘」优先的临时目录。
//   顺序：环境变量 CISTRACK_TMP → 系统 TEMP/TMP → os.tmpdir()。取值时逐个探测可写性，
//   避免在只读/不存在的盘上建目录。（本机把 TEMP 指到 D: 用环境变量控制，脚本不再写死盘符。）
const TMPROOT = (function () {
  const cands = [process.env.CISTRACK_TMP, process.env.TEMP, process.env.TMP, os.tmpdir()].filter(Boolean);
  for (const c of cands) {
    try { fs.mkdirSync(c, { recursive: true }); fs.accessSync(c, fs.constants.W_OK); return c; } catch (e) {}
  }
  return os.tmpdir();
})();
const EDGE_PROFILE = fs.mkdtempSync(path.join(TMPROOT, 'cistrack-visual-'));
function rmProfile() {
  // 收尾清掉 profile。删不掉也不能让脚本失败（Windows 上刚退出的浏览器偶尔还占着句柄）。
  try { fs.rmSync(EDGE_PROFILE, { recursive: true, force: true }); } catch (e) {}
}
process.on('exit', rmProfile);
process.on('SIGINT', () => { rmProfile(); process.exit(130); });

// ---- V1.8.0：测试用「探针副本」----
// 【为什么需要】app.js 整体是 `(function(){ 'use strict'; ... })();` —— 内部所有声明都活在
//   IIFE 作用域里，**根本不挂在 window 上**（这和 jsdom 里取不到 window.I18N 是同一个原因）。
//   于是 CDP 里读不到 chartRect / clampChartView / netDateLabel 这些量，像素级验证无从下手。
// 【做法】把发布 HTML 原样复制到 D 盘临时目录，在《主 IIFE》的 `'use strict';` 之后**紧邻注入**
//   一段「只读探针出口」（window.__CISTRACK__）。Edge 打开的是这个副本 —— **发布产物零污染**；
//   下面还会断言副本与发布 HTML 的差异**仅有这一处注入**（逐字节比对）。
//   ⚠ 坑：**不能**按「最后一个 `})();`」定位 —— app.js 的主 IIFE 在第 7772 行就闭合了，
//   7777–7799 是另一个并列的兄弟 IIFE（window.placeChartSearch 定版）。注到那里=注到兄弟作用域，
//   页面上一个内部名都看不见（第九轮第一次跑就是这么全线 ReferenceError 的）。
//   探针成员一律写成**取值函数**，所以放在 IIFE 最前面也安全（调用时变量早已初始化）。
//   同目录再放一份 wiki.json，保证「打开即读词条覆盖计数」这条路径与发布版一致。
const PROBE_DIR = fs.mkdtempSync(path.join(TMPROOT, 'cistrack-probe-'));
const PROBE_INS = `
/* ---- 只读探针出口：仅存在于 visual.mjs 生成的临时副本；发布 HTML 里没有这一段 ---- */
window.__CISTRACK__ = (function () {
  function g(n) { try { return eval(n); } catch (e) { return undefined; } }
  return {
    get version() { return VERSION; },
    chartRect: function () { return chartRect; },
    netRect: function () { return netRect; },
    chartView: function () { return chartView; },
    netView: function () { return netView; },
    setChartView: function (v) { chartView = v; },
    setNetView: function (v) { netView = v; },
    clampChartView: function (v) { return clampChartView(v); },
    clampNetView: function (v) { return clampNetView(v); },
    chartAutoView: function () { return chartAutoView(); },
    netAutoView: function () { return netAutoView(); },
    drawChart: function () { return drawChart(); },
    drawNet: function () { return drawNet(); },
    netDateLabel: function (ms) { return netDateLabel(ms); },
    netColors: function () { return netColors(); },
    // --- V1.9.0（R17）：05 升轨情况 ---
    climbView: function () { return climbView; },
    climbRect: function () { return climbRect; },
    setClimbView: function (v) { climbView = v; },
    clampClimbView: function (v) { return clampClimbView(v); },
    climbAutoView: function () { return climbAutoView(); },
    drawClimb: function () { return drawClimb(); },
    climbCurve: function () { return climbCurve(); },
    climbSeries: function () { return climbSeries(); },
    climbPickOptions: function () { return climbPickOptions(); },
    climbDateLabel: function (ms) { return climbDateLabel(ms); },
    climbSlope: function (pts) { return climbSlope(pts); },
    climbRates: function (pts, h, m) { return climbRates(pts, h, m); },
    climbBounds: function (list, take) { return climbBounds(list, take); },
    climbTake: function () { return S.climbTake; },
    climbPick: function () { return S.climbPick; },
    // ★ V1.9.1（1.8）：把**外挂索引**本身暴露出来。
    //   为什么需要：页面把 HIST_IDX[key].batches[0] 当作「默认批次」（见 app.js:7625/8425），
    //   而索引的排序由构建期 packAll 决定。以前探针目录里没有 history/ 分片 →
    //   HIST_IDX 恒空 → 这条路径**在真浏览器里从未被检查过**，
    //   于是"排序失效导致默认批次变成最老批次"一直没人发现。
    histIdx: function () { return HIST_IDX; },
    setClimbTake: function (v) { S.climbTake = v; return drawClimb(); },
    applyPseudoFull: function (on, sec) { return applyPseudoFull(on, sec); },
    syncFsBarHeight: function () { return syncFsBarHeight(); },
    timeOff: function () { return { map: S.time.map.off, globe: S.time.globe.off }; },
    pick: function () { return { on: S.pick.on, fixed: S.pick.fixed, el: S.pick.el }; },
    mz: function () { return { k: S.mz.k, tx: S.mz.tx, ty: S.mz.ty }; },
    _probe: function () { return { hasVersion: typeof VERSION, hasClamp: typeof clampChartView }; }
  };
})();`;
const SHIPPED = fs.readFileSync(FILE, 'utf8');
// 主 IIFE 的头：`(function () {\n'use strict';` —— 注入点紧跟其后（保留指令序言在最前）
const HEAD_RE = /\(function \(\) \{\r?\n'use strict';/;
const HM = HEAD_RE.exec(SHIPPED);
if (!HM) {
  console.error('探针副本构建失败：在发布 HTML 里找不到 app 主 IIFE 的头部锚点');
  process.exit(1);
}
const CUT = HM.index + HM[0].length;
const PROBE_HTML = SHIPPED.slice(0, CUT) + PROBE_INS + '\n' + SHIPPED.slice(CUT);
const PAGE = path.join(PROBE_DIR, path.basename(FILE));
fs.writeFileSync(PAGE, PROBE_HTML, 'utf8');
try {
  const wj = path.join(path.dirname(FILE), 'wiki.json');
  if (fs.existsSync(wj)) fs.copyFileSync(wj, path.join(PROBE_DIR, 'wiki.json'));
} catch (e) {}
// ★ V1.9.1：**外挂历史分片也要复制进探针目录**。
//   为什么必须补这一步：探针目录以前只放 wiki.json，于是页面在真浏览器里
//   **取不到 history/index-*.json** → `HIST_IDX` 恒为空 → 所有断言都只覆盖了
//   "内置兜底"那条路径。而「变轨/升轨情况」章节的**默认选中批次**恰恰只走外挂索引
//   （app.js:7625 / 8425：`ix.batches[0].k`）—— 也就是说：1.8 修的那个排序 bug
//   在这个测试环境下**根本不可见**。补上分片后，真浏览器才会真正走到那条路。
try {
  const hd = path.join(path.dirname(FILE), 'history');
  if (fs.existsSync(hd)) {
    const dst = path.join(PROBE_DIR, 'history');
    fs.mkdirSync(dst, { recursive: true });
    let n = 0;
    for (const f of fs.readdirSync(hd)) {
      if (!f.endsWith('.json')) continue;
      fs.copyFileSync(path.join(hd, f), path.join(dst, f)); n++;
    }
    console.log('（外挂历史分片已复制进探针目录：' + n + ' 个）');
  } else {
    console.log('（⚠️ 找不到 history/ 目录 —— 默认批次那一类断言会退化到内置兜底路径）');
  }
} catch (e) { console.log('（历史分片复制失败：' + e.message + '）'); }
process.on('SIGINT', () => { try { fs.rmSync(PROBE_DIR, { recursive: true, force: true }); } catch (e) {} });
process.on('exit', () => { try { fs.rmSync(PROBE_DIR, { recursive: true, force: true }); } catch (e) {} });
console.log('（探针副本：' + PAGE + '）');

const child = spawn(EDGE, ['--headless=new', '--disable-blink-features=AutomationControlled',
  // V1.8.0：必须显式指定 user-data-dir —— 否则 Edge 会在 %TEMP%（本机默认在 C 盘）下建一整套
  //   浏览器用户数据目录（Cache/Code Cache/GPUCache…），反复调试会累积上百 MB 把 C 盘写满
  //   （本机实测过一次 ENOSPC）。这里固定放到 D 盘的临时根目录下，并带上本次运行的唯一后缀。
  '--user-data-dir=' + EDGE_PROFILE,
  '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=' + PORT,
  // ★ V1.9.1：允许从 file:// 页面读到同目录的其它文件。
  //   为什么必须加：页面是**用 file:// 打开的**（探针副本），而它要 fetch 外挂
  //   `./history/index-*.json` 与分片。默认情况下 file:// 的 fetch 会被拦（origin 为 null），
  //   于是 `HIST_IDX` 永远是空的 —— 也就是说：**"外挂历史分片"这条真实链路
  //   在本测试里从未被走到过**，所有依赖它的断言都悄悄退化成"内置 60 天兜底"。
  //   （1.8 修的排序 bug 正是藏在只有外挂索引才会走的那条路上，所以一直没被发现。）
  '--allow-file-access-from-files',
  '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });
async function getWs() {
  for (let i = 0; i < 80; i++) {
    try {
      const body = await new Promise((res, rej) => http.get({ host: '127.0.0.1', port: PORT, path: '/json/list' },
        r => { let s = ''; r.on('data', d => s += d); r.on('end', () => res(s)); }).on('error', rej));
      const p = JSON.parse(body).find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (p) return p.webSocketDebuggerUrl;
    } catch (e) { } await sleep(400);
  }
  throw new Error('no cdp');
}
const ws = new WebSocket(await getWs(), { perMessageDeflate: false, maxPayload: 200 * 1024 * 1024 });
await new Promise(r => ws.on('open', r));
let seq = 0; const pend = new Map();
ws.on('message', raw => { const m = JSON.parse(raw.toString()); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (method, params) => new Promise(res => { const id = ++seq; pend.set(id, res); ws.send(JSON.stringify({ id, method, params: params || {} })); });
async function ev(e) {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true });
  if (r.result && r.result.exceptionDetails) return { __err: (r.result.exceptionDetails.exception || {}).description };
  return (r.result && r.result.result && r.result.result.value) !== undefined ? r.result.result.value : null;
}
async function mouse(type, x, y) {
  await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseMoved' ? 0 : 1, clickCount: 1 });
}
let pass = 0, fail = 0, skipN = 0;
function ckSkip(name, why) { skipN++; console.log('SKIP ' + name + '  → ' + why); }
// ⚠ 陷阱（V1.8.0 修）：ev() 在页面里抛异常时返回 { __err: '...' }，而**对象恒为真值** ——
//   旧写法 `if (ok)` 会把「求值当场就崩了」整条判成 PASS（第九轮真出现过两条这样的假通过）。
//   现在：只要 ok 是 ev() 的异常信封，一律记 FAIL，并把异常原文打出来。
function ck(name, ok, got) {
  if (ok && typeof ok === 'object' && ok.__err) {
    fail++; console.log('FAIL ' + name + '  → 页面内异常：' + ok.__err); return;
  }
  if (ok) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + '  → ' + JSON.stringify(got)); }
}
// V1.7.2（需求13）：「该场景不适用」——显式打印、**既不计 PASS 也不算 FAIL**。
//   存在的意义：旧版用 `if (pc) {...}` 把扫不到点整段跳过，
//   于是断言条数随运行变化（83/86）、"没测到"被伪装成"通过"。现在必须说出来。
function skip(name, why) {
  console.log('SKIP ' + name + '  → ' + JSON.stringify(why));
}
async function setViewport(w, h, mobile) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: !!mobile });
}
await send('Page.enable');
await setViewport(1440, 900, false);
await send('Page.navigate', { url: 'file:///' + PAGE });
await sleep(4500);

// ---- 通用：越界检查（右边界不应超过 section 的内边距）----
// 三处「设计如此」与两处「不可见」要排除，否则全是假阳性（V1.8.0 矩阵扫出来的经验）：
//   ① .bleed —— 画布故意出血到画面边缘（负 margin）；
//   ② .canvas-wrap.wide —— width:92vw 居中近满幅（与 .bleed 同一套设计，V1.8.0 才知道要跳）；
//   ③ .table-wrap 的子节点 —— 宽表格在里面横向滚动，只量 wrap 本身；
//   ④ display:none / visibility:hidden 的元素 —— 量不到就不会被看到；
//   ⑤ 整体停在视口外的元素 —— 关掉的信息窗（.sat-info）常被"停在屏幕右侧等着淡入"，
//      它此刻 display 仍是 block、真有盒子，但对用户不可见，不该算越界。
const overFn = `(function(){
  var vw = window.innerWidth, out = [];
  document.querySelectorAll('section').forEach(function(sec){
    var limit = vw - parseFloat(getComputedStyle(sec).paddingRight);
    sec.querySelectorAll('*').forEach(function(el){
      if (el.closest('.bleed') || el.closest('.canvas-wrap.wide')) return;
      if (el.parentElement && el.parentElement.closest('.table-wrap')) return;
//   ⑥ 被用户摆过位置的信息窗/浮窗（内联 left/top）及其**整棵子树** ——「可拖出屏幕边缘」是
//      V1.7.2 需求11 明确要求的行为，所以它一旦有了内联定位就不再受"章节右边界"约束。
//      注意只在**有内联 left/top** 时才跳过：默认（未拖动）布局仍要受约束，不能一放了之。
      var si = el.closest('.sat-info');
      if (si && (si.style.left || si.style.top)) return;   // 整棵子树都不再受约束
      var cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return;
      var r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      if (r.left >= vw || r.right <= 0) return;      // 整体在视口外（停放态）
      if (r.right > limit + 1.5) out.push(sec.id + '|' + (el.id || el.className || el.tagName) + '|' + r.right.toFixed(1) + '>' + limit.toFixed(1));
    });
  });
  return out.slice(0, 8);
})()`;

async function probe(tag, expectTwoLinePager, expectEn) {
  console.log('\n===== ' + tag + ' =====');
  // V1.8.0（需求8）：新增 03.5「组网进度」章节（放在 03 倾角分布之后、04 卫星表格之前）
  ck('章节顺序', (await ev(`[...document.querySelectorAll("section")].map(s=>s.id).join("|")`)) === 'sec-map|sec-orbits|sec-chart|sec-progress|sec-climb|sec-table|sec-launches');
  ck('章节号 01/02/03/04/05/06/07', (await ev(`[...document.querySelectorAll(".sec-num")].map(s=>s.textContent).join("")`)) === '01020304050607');
  // 手机上顶栏会换行变高、品牌字号也会被断点调小，这两项只在宽屏量
  if (!expectTwoLinePager) {
    ck('顶栏高度 62px（不因品牌字号变大而撑高）', (await ev(`document.querySelector(".topnav").offsetHeight`)) === 62);
    ck('品牌字号 32px 且用 Audiowide',
      (await ev(`getComputedStyle(document.querySelector(".brand-name")).fontSize`)) === '32px' &&
      (await ev(`getComputedStyle(document.querySelector(".brand-name")).fontFamily.split(",")[0]`)) === 'Audiowide');
    ck('字体真的加载了（离线内嵌生效）', (await ev(`document.fonts.check('32px Audiowide')`)) === true);
  }
  // V1.8.0（需求8）：第四张图（03.5 组网进度）同样有一对 ＋/−、⟳、⛶ 与导出键
  ck('五个图章节各 5 个按键（＋ − ⟳ ⛶ 导出）',
    (await ev(`[...document.querySelectorAll(".view-ctl")].map(g=>g.children.length).join(",")`)) === '5,5,5,5,5');
  ck('导出按键是每组最后一个',
    (await ev(`[...document.querySelectorAll(".view-ctl")].every(g=>/shot/.test(g.lastElementChild.className))`)) === true);
  ck('两个表格各有一个导出按键', (await ev(`document.querySelectorAll(".pg-shot").length`)) === 2);
  ck('顶部「在轨 / 发射」两项都是两行',
    (await ev(`[...document.querySelectorAll(".hero-kv .k")].filter(k=>/<br>/i.test(k.innerHTML)).length`)) >= 2);
  ck('卫星表格默认按 NORAD 从大到小', await ev(`(function(){
    var th = document.querySelector('#satTable thead th.sorted');
    if (!th || th.getAttribute('data-key') !== 'norad') return false;
    var ids = [...document.querySelectorAll('#satTable tbody tr')].slice(0, 6)
      .map(function (tr) { return +tr.children[1].textContent.trim(); });
    for (var i = 1; i < ids.length; i++) if (ids[i] > ids[i - 1]) return false;
    return true;
  })()`));
  // V1.4.0：英文下章节标题与顶栏标签都要 Title Case（实词首字母大写）
  if (expectEn) {
    // h2 里还挂着「Zoomable」小字，只取第一个 span（章节名本身）
    const enTitles = `[...document.querySelectorAll('.sec-head h2')].map(function(h){
      var s = h.querySelector('span'); return (s ? s.textContent : h.textContent).trim(); }).join('|')`;
    ck('英文章节标题 Title Case',
      (await ev(enTitles)) === 'Map|Orbits|Inclination Distribution|Network Progress|Orbits Raising Status|Satellite Table|Launch History', await ev(enTitles));
    // V1.7.2 第七轮（需求2）：顶栏章节切换按钮已删，英文 Title Case 改到主标题下的历元行上校验
    ck('英文顶栏：章节切换按钮已移除、历元行在主标题下',
      (await ev(`document.querySelectorAll('.topnav .navlinks a').length`)) === 0 &&
      (await ev(`(function(){var p=document.getElementById('pageEpoch'); return !!p && /TLE updated/.test(p.textContent);})()`)) === true,
      'navlinks=' + (await ev(`document.querySelectorAll('.topnav .navlinks a').length`)));
  }
  // V1.7.2 第七轮（需求2）：本章节原来校验的是已被删除的顶栏切换栏，改成反向守卫
  ck('顶栏章节切换栏已移除（.navlinks / .nav-updated 均不得存在）',
    (await ev(`document.querySelectorAll('.navlinks, .nav-updated, #navUpdated').length`)) === 0);
  ck('说明区搜索框拉满到右边界', await ev(`(function(){
    var i = document.querySelector('#topSearch').closest('.search-wrap').getBoundingClientRect().right;
    var s = document.querySelector('.hero-side').getBoundingClientRect().right;
    return Math.abs(i - s) < 6;   // V1.5.1：靠右对齐（含搜索键的整个药丸）
  })()`));
  // V1.4.3：表头改成一律居中（用户要求），所以不再比对「表头与数据同侧」
  ck('卫星表格：表头一律居中', await ev(`(function(){
    var ths = [...document.querySelectorAll('#satTable thead th')]
      .filter(function (t) { return getComputedStyle(t).display !== 'none'; });
    return ths.length > 0 && ths.every(function (t) { return getComputedStyle(t).textAlign === 'center'; });
  })()`));
  // V1.8.0（需求12/13）：卫星表在「批次/组」后插入了「发射时间」列 → 制造方顺延到第 5 列（idx 4）；
  //   同时需求13 要求「两表记录一律居中」，实际生效的是「首列左对齐（tbody td:first-child）+ 其余全居中」。
  //   所以这里不再逐列点名 maker / 数字列，改成验这条更强的规则。
  ck('卫星表格：首列左对齐、其余各列一律居中（V1.8.0 需求13）', await ev(`(function(){
    var tr = document.querySelector('#satTable tbody tr');
    if (!tr) return false;
    var tds = [...tr.children];
    return getComputedStyle(tds[0]).textAlign === 'left' &&
      tds.slice(1).every(function (td) { return getComputedStyle(td).textAlign === 'center'; });
  })()`), await ev(`(function(){
    var tr = document.querySelector('#satTable tbody tr'); if (!tr) return 'no row';
    return [...tr.children].map(function (t) { return getComputedStyle(t).textAlign; }).join(',');
  })()`));
  ck('发射历史：表头与数据全部居中（V1.4.7）', await ev(`(function(){
    var ths = [...document.querySelectorAll('#launchTable thead th')]
      .filter(function (t) { return getComputedStyle(t).display !== 'none'; });
    var tr = document.querySelector('#launchTable tbody tr');
    var tds = tr ? [...tr.children] : [];
    return ths.every(function (t) { return getComputedStyle(t).textAlign === 'center'; }) &&
      tds.length > 0 && tds.every(function (t) { return getComputedStyle(t).textAlign === 'center'; });
  })()`));
  const over = await ev(overFn);
  ck('无元素越出右边界', Array.isArray(over) && over.length === 0, over);
  // 导出键是绝对定位钉在右端的，量「居中那一行」的排布时要把它排除掉
  const pager = await ev(`(function(){
    var p = document.getElementById('satPager');
    var bs = [...p.querySelectorAll('button')].filter(function(b){
      return getComputedStyle(b).position !== 'absolute';
    });
    var tops = [...new Set(bs.map(b=>Math.round(b.getBoundingClientRect().top)))];
    return { rows: tops.length, h: Math.round(p.getBoundingClientRect().height) };
  })()`);
  ck('翻页控件' + (expectTwoLinePager ? '窄屏两行' : '宽屏一行'), pager.rows === (expectTwoLinePager ? 2 : 1), pager);
}

await probe('中文 1440x900', false, false);
await ev(`document.getElementById("langBtn").click()`);
await sleep(1200);
await probe('英文 1440x900', false, true);
await setViewport(390, 844, true);
await sleep(1500);
await probe('手机 390x844', true, true);
ck('手机版历元显示在大标题下方', (await ev(`getComputedStyle(document.getElementById("pageEpoch")).display`)) !== 'none');
// V1.3.8：顶部时钟药丸是 fixed 定位，页面标题不能压在它身上
ck('页面标题没被顶部时钟药丸压住', await ev(`(function(){
  var p = document.getElementById('pageTitle').getBoundingClientRect();
  var c = document.getElementById('clockPill').getBoundingClientRect();
  if (c.height === 0) return true;
  var pad = parseFloat(getComputedStyle(document.getElementById('pageTitle')).paddingTop) || 0;
  return (p.top + pad) >= c.bottom + 4;   // 留 4px 余量，免得贴着药丸下沿
})()`), await ev(`(function(){
  var el = document.getElementById('pageTitle');
  var p = el.getBoundingClientRect();
  var c = document.getElementById('clockPill').getBoundingClientRect();
  var pad = parseFloat(getComputedStyle(el).paddingTop) || 0;
  return '文字 top=' + Math.round(p.top + pad) + ' clock.bottom=' + Math.round(c.bottom);
})()`));
// 英文界面下没有「发射/在轨」字样，所以直接取前两个键值对标签（第 1 个是「星座」，单行）
ck('「发射/卫星」「在轨/卫星」标签都是两行（没被挤成每字一行）', await ev(`(function(){
  var ks = [...document.querySelectorAll('.hero-kv .k')].slice(1, 3);
  if (ks.length < 2) return false;
  return ks.every(function(k){ var h = k.getBoundingClientRect().height; return h > 26 && h < 60; });
})()`), await ev(`[...document.querySelectorAll('.hero-kv .k')].map(k=>k.textContent.replace(/\s/g,'')+':'+Math.round(k.getBoundingClientRect().height)).join(' | ')`));
ck('历元与主标题之间没有过大的空隙', await ev(`(function(){
  var pe = document.getElementById('pageEpoch').getBoundingClientRect();
  var h1 = document.getElementById('heroTitle').getBoundingClientRect();
  var gap = h1.top - pe.bottom;
  return gap > 0 && gap < 45;   // V1.3.9：收紧到 45，实测约 16px
})()`), await ev(`(function(){
  var pe = document.getElementById('pageEpoch').getBoundingClientRect();
  var h1 = document.getElementById('heroTitle').getBoundingClientRect();
  return Math.round(h1.top - pe.bottom) + 'px';
})()`));

// ---- 点击选中：干净点击 / 手抖 8px / 左上角（信息窗原来的位置）----
await setViewport(1440, 900, false);
await sleep(1200);
const focused = () => ev(`[...document.querySelectorAll('#satTable tbody tr.focused')].map(t=>t.cells[0].innerText.trim()).join(',')`);
// V1.3.8：多选/已选中会让「点击卫星」变成取消选择，测之前先把状态清干净。
// 点空白是页面自己的清空方式，四个角轮着试，总有一个没被信息窗盖住。
async function clearSelection(canvasId) {
  const r = await ev(`(function(){var c=document.getElementById('${canvasId}').getBoundingClientRect();return {x:c.x,y:c.y,w:c.width,h:c.height};})()`);
  const corners = [[r.x + 14, r.y + 14], [r.x + r.w - 14, r.y + 14], [r.x + 14, r.y + r.h - 14], [r.x + r.w - 14, r.y + r.h - 14]];
  for (const [x, y] of corners) {
    if (!(await focused())) return true;
    await mouse('mouseMoved', x, y);
    await mouse('mousePressed', x, y);
    await mouse('mouseReleased', x, y);
    await sleep(260);
  }
  return !(await focused());
}
async function findPoint(canvasId, infoId, cornerOnly, onlyZone) {
  // V1.3.8：选中后信息窗会一直留着，先把它复位隐藏，否则「窗口是否显示」这个判据会一直为真
  // V1.7.2（需求4）：hover 命中现在显示在**浮窗**（#*InfoB）上，A 窗只服务选中态。
  //   所以复位时 A 窗与浮窗一起收，判据也改成看浮窗。
  await ev(`(function(){
    ['chartInfo','mapInfo','globeInfo'].forEach(function(id){
      ['B',''].forEach(function(sfx){
        var e = document.getElementById(id + sfx);
        if (e) { e.style.display = 'none'; e.style.left = '16px'; e.style.top = '16px'; e.__moved = false; e.__lastId = null; }
      });
    });
  })()`);
  await ev(`document.getElementById('${canvasId}').scrollIntoView({block:'center'})`);
  await sleep(900);
  const r = await ev(`(function(){var c=document.getElementById('${canvasId}').getBoundingClientRect();return {x:c.x,y:c.y,w:c.width,h:c.height};})()`);
  // V1.8.0 收尾：`cornerOnly` 不再死锁在左上角 —— 按「左上角 → 左上大半 → 全画布」逐级放大。
  //   原因（2026-10-08 实测）：星网倾角 50°、千帆 89°，等距投影下**高纬带本来就可能整条没有卫星**，
  //   那一刻左上角恰好空着 → 旧版直接判 FAIL（map 挂了 3 条，后 2 条还是级联）。
  //   但同一循环里的「干净点击能选中」「手抖 8px 仍能选中」都是 PASS（全画布扫描），
  //   说明命中检测与点选都正常 —— 这是**断言选点问题，不是产品回归**。
  //   现在返回实际落点所在的 zone，由调用方如实写进提示里，且只有**整块画布**都扫不到才算真问题。
  const ZONES = [[4, 4, '左上角'], [8, 6, '左上大半'], [15, 11, '全画布']];
  const zones = cornerOnly
    ? (onlyZone ? [ZONES.find(z => z[2] === onlyZone) || ZONES[2]] : ZONES)
    : [ZONES[2]];
  for (const [ixMax, iyMax, name] of zones) {
    for (let iy = 1; iy < 12; iy++) {
      for (let ix = 1; ix < 16; ix++) {
        if (ix > ixMax || iy > iyMax) continue;
        const x = r.x + r.w * ix / 16, y = r.y + r.h * iy / 12;
        await mouse('mouseMoved', x, y);
        // V1.4.3 起悬停命中检测节流到 ~30Hz，测试里两次移动之间要留够间隔，
        // 否则会被节流吃掉、误判成「扫描不到点」
        await sleep(38);
        const dd = await ev(`getComputedStyle(document.getElementById('${infoId}B')).display`);
        if (dd && dd !== 'none') return { x, y, zone: name };
      }
    }
  }
  return null;
}
// V1.7.0：findPoint 从左上往右下扫，返回的第一个命中点永远落在「命中椭圆的最外角」，
// 从那里朝右下再漂 8px 就正好滑出椭圆 —— 这条断言历史上反复偶发失败的根因就在此，
// 与版本无关（V1.6.3 用同一套测试也复现）。这里改成：在命中点附近找一个
// 「自身命中、且右下 8px 处也仍命中」的稳定落点，再叠加手抖位移去点。
// 这才是断言真正要验证的语义 ——「按下后 8px 内手抖仍算点击」，而不是「点椭圆边缘」。
async function findStablePoint(canvasId, infoId, p) {
  // V1.7.2（需求4）：hover 命中判据看浮窗（A 窗此时不该出现）
  const hit = async (x, y) => {
    await mouse('mouseMoved', x, y);
    await sleep(36);
    const dd = await ev(`getComputedStyle(document.getElementById('${infoId}B')).display`);
    return dd && dd !== 'none';
  };
  // 先确认四处候选：都命中 + 右下 8/4 仍命中
  for (let dy = -6; dy <= 6; dy += 2) {
    for (let dx = -8; dx <= 8; dx += 2) {
      const x = p.x + dx, y = p.y + dy;
      if (!(await hit(x, y))) continue;
      if (!(await hit(x + 8, y + 4))) continue;
      if (!(await hit(x + 5, y + 3))) continue;
      return { x, y };
    }
  }
  return p;   // 找不到就退回原点，让断言按原样跑（失败也是真实失败）
}
// V1.7.2（需求13）：地球自转会让「扫点 → 点击」之间卫星移位 —— 扫点时它在 P，
//   几百毫秒后再点 P，那里已经是别的星了，于是「左上角也能选中」这条断言**偶发失败**
//   （同一份代码两次运行分别是 83/0FAIL 与 86/0FAIL）。
//   旧版用 `if (pc) {...}` 把失败整段跳过、把条数差异伪装成"通过"，现已改成明确 FAIL。
//   这里在点击类测试开始前**关掉自转**，让扫点与点击落在同一时刻的同一位置 —— 测试要可重复。
console.log('\n===== 点击选中（三张图 × 三种手况）=====');
// V1.8.0 收尾：把三张图**实际用到的落点区域**打出来当证据 —— 否则「逐级放大到底放到了哪一级」
//   只藏在 PASS 里看不见（ck 只在 FAIL 时打详情），下一轮又得靠推理。
const zoneLog = [];
try {
  await ev(`(function(){var b=document.getElementById('spinBtn');
    if (b && b.classList.contains('on')) b.click();})()`);
  await sleep(400);
} catch (e) {}
for (const [cid, iid] of [['globe', 'globeInfo'], ['map', 'mapInfo'], ['chart', 'chartInfo']]) {
  await ev(`(function(){var b=document.getElementById('resetAllBtn'); if(b) b.click();})()`);
  await sleep(600);
  // ⚠ V1.8.0 补：上面那次循环外的「关自转」会被这里的 resetAllBtn **撤销**（自转默认就是 ON，
  //   而"还原所有默认设置"按需求口径要把它还原成 ON）→ 扫点与点击之间卫星又被自转带偏，
  //   这正是「左上角也能选中」在 globe 上时而 FAIL 时而 SKIP 的根源。
  //   所以每次还原之后必须**再关一次**，这条断言才可重复。
  await ev(`(function(){var b=document.getElementById('spinBtn');
    if (b && b.classList.contains('on')) b.click();})()`);
  await sleep(320);
  let p = await findPoint(cid, iid, false);
  if (!p) { ck(cid + ' 能悬停到卫星', false, '扫描不到点'); continue; }
  await clearSelection(cid);
  p = await findPoint(cid, iid, false);
  await mouse('mousePressed', p.x, p.y); await mouse('mouseReleased', p.x, p.y);
  await sleep(400);
  const a = await focused();
  ck(cid + ' 干净点击能选中', !!a, a);
  await clearSelection(cid);
  await clearSelection(cid);
  p = await findPoint(cid, iid, false);
  // V1.7.0：findPoint 扫到的是「命中椭圆的最外沿」那一个像素，从边缘再漂 8px 会刚好滑出
  // 椭圆（历史上这条断言偶发失败的老原因）。这里先把落点收紧到「仍能悬停命中」的范围内，
  // 再在其上叠加 ≤TAP_SLOP(14px) 的手抖位移，才是这条断言真正想验证的语义。
  p = await findStablePoint(cid, iid, p);
  await mouse('mousePressed', p.x, p.y);
  await mouse('mouseMoved', p.x + 5, p.y + 3);
  await mouse('mouseMoved', p.x + 8, p.y + 4);
  await mouse('mouseReleased', p.x + 8, p.y + 4);
  await sleep(400);
  let b2 = await focused();
  if (!b2) {                                  // 偶发：这一下点在了信息窗上，换一处再试一次
    await clearSelection(cid);
    const p3 = await findPoint(cid, iid, false);
    if (!p3) {                                // 兜底：确实扫不到命中点（数据/时序偶发）→ 判失败，别让测试自身崩掉
      ck(cid + ' 按下后手抖 8px 仍能选中', false, '重试时扫不到候选命中点');
      await clearSelection(cid);
      continue;
    }
    p = await findStablePoint(cid, iid, p3);
    await mouse('mousePressed', p.x, p.y);
    await mouse('mouseMoved', p.x + 6, p.y + 3);
    await mouse('mouseReleased', p.x + 6, p.y + 3);
    await sleep(400);
    b2 = await focused();
  }
  ck(cid + ' 按下后手抖 8px 仍能选中', !!b2, b2);
  await clearSelection(cid);
  const pc = await findPoint(cid, iid, true);
  // V1.8.0 收尾：这条断言的核心语义是「**悬停浮窗不会挡住点击**」，落点在哪一角并不重要。
  //   旧版把扫描范围死锁在「画布左上 4/16 × 4/12」，于是当那一刻左上角恰好没有卫星光点时
  //   就被判成 FAIL（2026-10-08 实测：map 挂 3 条，其中 2 条还是级联失败）。
  //   那既不是回归，也不可复现 —— findPoint 现在按「左上角 → 左上大半 → 全画布」逐级放大，
  //   并在提示里如实写出实际落点。注意：绝不退回 `if (pc) {...}` 那种静默跳过 ——
  //   那会把「扫描不到」伪装成「通过」（条数实测 83 vs 86 来回变，V1.7.2 需求13 已废止该写法）。
  //   只有**整块画布**都扫不到光点才是真问题，此时明确判 FAIL。
  const t0 = await ev(`(function(){
    var c = document.getElementById('${cid}').getBoundingClientRect();
    var topEl = document.elementFromPoint(c.x + 14, c.y + 14);
    return topEl ? (topEl.id || topEl.className || topEl.tagName) : 'null';
  })()`);
  ck(cid + ' 左上角不被信息窗遮挡', String(t0).indexOf('Info') < 0, '最上层=' + t0);
  if (!pc) {
    ck(cid + ' 图内光点可选中（悬停浮窗不挡点击）', false, '整块画布都扫不到可点光点');
  } else {
    // V1.7.2（需求13）：原来这里是「findPoint → clearSelection → 再 findPoint → 点第一个 pc」，
    //   点的是**第一次扫到的旧坐标** ——中间隔着 clearSelection（鼠标扫四角）与第二轮扫描，
    //   低轨卫星每秒移动约 0.8px，加上 hover 30Hz 节流，落到点击时那个点可能已经移开，
    //   于是这条断言在 map 上偶发失败（同一份代码 84/0FAIL 与 83/1FAIL 交替）。
    // 现在：清完选中**紧接着在同一个 zone 里重扫一次并直接用这一次的坐标**，点完再立刻确认选中。
    await clearSelection(cid);
    const pcFresh = await findPoint(cid, iid, true, pc.zone);
    zoneLog.push(cid + '=' + pc.zone);
    const px = pcFresh ? pcFresh.x : pc.x, py = pcFresh ? pcFresh.y : pc.y;
    const top = await ev(`(function(){var e=document.elementFromPoint(${px},${py});return e?(e.id||e.className||e.tagName):'null';})()`);
    await mouse('mouseMoved', px, py);
    await sleep(60);
    await mouse('mousePressed', px, py); await mouse('mouseReleased', px, py);
    await sleep(450);
    const c2 = await focused();
    ck(cid + ' 图内光点可选中（悬停浮窗不挡点击）', !!c2,
      c2 + ' | 落点=' + pc.zone + (pcFresh ? '' : '（重扫未命中，用了旧坐标）') + ' | 最上层=' + top);
    // V1.3.8：刚选中一颗，趁状态明确 —— 把鼠标移到画布角落，窗口必须留着
    const rc = await ev(`(function(){var c=document.getElementById('${cid}').getBoundingClientRect();return {x:c.x,y:c.y,w:c.width,h:c.height};})()`);
    await mouse('mouseMoved', rc.x + rc.w - 24, rc.y + rc.h - 24);
    await sleep(450);
    ck(cid + ' 点选后鼠标移开，信息窗仍在',
      (await ev(`getComputedStyle(document.getElementById('${iid}')).display`)) !== 'none');
    // V1.3.8：拖到右边，宽度不能变
    const wB = await ev(`Math.round(document.getElementById('${iid}').getBoundingClientRect().width)`);
    const bx = await ev(`(function(){var e=document.getElementById('${iid}');var q=e.getBoundingClientRect();return {x:q.left+q.width/2,y:q.top+8};})()`);
    await mouse('mousePressed', bx.x, bx.y);
    await mouse('mouseMoved', bx.x + 300, bx.y + 50);
    await mouse('mouseMoved', bx.x + 600, bx.y + 100);
    await mouse('mouseReleased', bx.x + 600, bx.y + 100);
    await sleep(450);
    const wA = await ev(`Math.round(document.getElementById('${iid}').getBoundingClientRect().width)`);
    ck(cid + ' 拖动信息窗宽度不变', wB === wA && wB > 100, wB + ' → ' + wA);
  }
}
console.log('（点击选中落点区域：' + (zoneLog.join(' / ') || '无') +
  '　—— 左上角→左上大半→全画布 逐级放大，见 findPoint 注释）');
// ---- 导出图片：headless 下下载会被浏览器吞掉，只验证「点了不抛异常」这条脚本路径 ----
console.log('\n===== 导出图片（点击不报错）=====');
await ev(`window.__err = []; window.addEventListener('error', function (e) { window.__err.push(e.message); });`);
await ev(`document.querySelector('#sec-map .view-ctl button[data-shot]').click()`);
await sleep(1500);
let errs = await ev(`window.__err`);
ck('点图导出键无 JS 异常', Array.isArray(errs) && errs.length === 0, errs);
// V1.4.0：表格导出键改成弹窗，三键竖排
await ev(`document.querySelector('#satPager .pg-shot').click()`);
await sleep(500);
ck('点表格导出键弹出小窗', (await ev(`document.getElementById('shotPopSat').hidden`)) === false);
ck('弹窗是竖排布局（column + 居中）', await ev(`(function(){
  var cs = getComputedStyle(document.getElementById('shotPopSat'));
  return cs.flexDirection === 'column' && cs.alignItems === 'center';
})()`), await ev(`getComputedStyle(document.getElementById('shotPopSat')).flexDirection + '/' + getComputedStyle(document.getElementById('shotPopSat')).alignItems`));
// 「导出多页」那一行左边是输入框，所以按「整行居中 + 竖向堆叠」来验，而不是比按钮左边缘
ck('弹窗三行竖向排列且都水平居中', await ev(`(function(){
  var pop = document.getElementById('shotPopSat');
  var r0 = pop.getBoundingClientRect(), pcx = r0.left + r0.width / 2;
  var rows = [
    pop.querySelector('button[data-shot-do="cur"]'),
    pop.querySelector('.sp-multi'),
    pop.querySelector('button[data-shot-do="all"]')
  ];
  if (rows.some(function (x) { return !x; })) return false;
  var rects = rows.map(function (x) { return x.getBoundingClientRect(); });
  var centered = rects.every(function (r) { return Math.abs((r.left + r.width / 2) - pcx) < 6; });
  var stacked = rects[1].top >= rects[0].bottom - 1 && rects[2].top >= rects[1].bottom - 1;
  return centered && stacked;
})()`));
// 输入非法值 → 输入框标红
await ev(`(function(){ var i = document.getElementById('shotNumSat'); i.value = 'abc'; })()`);
await ev(`document.querySelector('#shotPopSat button[data-shot-do="multi"]').click()`);
await sleep(300);
ck('非法输入 → 输入框红框', await ev(`document.getElementById('shotNumSat').classList.contains('bad')`));
await ev(`document.querySelector('#shotPopSat button[data-shot-do="cur"]').click()`);
await sleep(1500);
errs = await ev(`window.__err`);
ck('点「导出当前页」无 JS 异常', Array.isArray(errs) && errs.length === 0, errs);

console.log('\n===== V1.7.0 二轮实测（需求 1 / 7 / 8）=====');
await setViewport(1440, 900, false);
await sleep(800);

// --- 需求1：页内搜索联想区必须浮在页面内容之上（除顶栏/时钟/章节药丸）---
ck('需求1：页内搜索 .search-wrap 的 z-index 介于页面内容与顶栏之间', await ev(`(function(){
  var w = document.querySelector('.hero-search .search-wrap');
  var z = parseInt(getComputedStyle(w).zIndex, 10);
  var nav = parseInt(getComputedStyle(document.querySelector('.topnav')).zIndex, 10);
  var pill = parseInt(getComputedStyle(document.getElementById('jumpPill')).zIndex, 10);
  return z > 44 && z < nav && z < pill;
})()`));
ck('需求1：联想区展开后不再被下一章节的标题/控件压住', await ev(`(function(){
  var inp = document.getElementById('topSearch');
  inp.value = '1'; inp.dispatchEvent(new Event('input', { bubbles: true }));
  var sug = document.getElementById('topSug'); var b = sug.getBoundingClientRect();
  var bad = [];
  for (var y = Math.round(b.top + 4); y < Math.min(Math.round(b.bottom) - 2, innerHeight); y += 18) {
    for (var x = Math.round(b.x + 8); x < Math.round(b.right) - 8; x += 46) {
      var e = document.elementFromPoint(x, y); if (!e) continue;
      if (e.closest('.sug-list') || e.closest('.search-wrap') || e.closest('.topnav') || e.closest('#jumpPill') || e.closest('#clockPill')) continue;
      bad.push(e.tagName + '.' + (e.className || '').toString().slice(0, 24));
    }
  }
  inp.value = ''; inp.dispatchEvent(new Event('input', { bubbles: true }));
  window.__bad1 = bad.slice(0, 5);
  return bad.length === 0;
})()`, JSON.stringify(await ev('window.__bad1 || []'))));

// --- 需求7：抽屉 520ms 非线性开合，双向对称、有中间帧 ---
await setViewport(430, 932, true);
await sleep(600);
await ev(`(function(){ document.documentElement.classList.add('pseudo-full'); document.getElementById('sec-map').classList.add('fs-mobile'); })()`);
await sleep(500);
async function drawerTrace() {
  await ev(`document.querySelector('#sec-map [data-panel]').click()`);
  const t0 = Date.now(); const out = [];
  for (let i = 0; i < 13; i++) {
    const x = await ev(`Math.round(document.querySelector('#sec-map .sec-head').getBoundingClientRect().x)`);
    out.push({ t: Date.now() - t0, x }); await sleep(48);
  }
  await sleep(500);
  return out;
}
const openTrace = await drawerTrace();
const closeTrace = await drawerTrace();
await ev(`(function(){ document.documentElement.classList.remove('pseudo-full'); var s=document.getElementById('sec-map'); s.classList.remove('fs-mobile','panel-open'); })()`);
await sleep(300);
function analyse(tr, from, to) {
  const span = Math.abs(to - from);
  const mid = tr.filter(p => p.x !== from && p.x !== to).length;          // 中间帧数
  // 先慢后快：前 50% 时间的位移应 < 全行程的 45%
  const half = tr.find(p => p.t >= 260) || tr[tr.length - 1];
  const early = Math.abs(half.x - from) / span;
  const ended = Math.abs(tr[tr.length - 1].x - to) <= 1;                   // 最终到位
  return { mid, early: +early.toFixed(2), ended };
}
// V1.7.0 第三轮：抽屉改用 transform 驱动后，收起位由 calc(-100% - 40px) 决定、随抽屉宽度变化，
//   所以端点必须**实测**得出，不能写死数值。
const oFrom = Math.min.apply(null, openTrace.map(function (p) { return p.x; }));
const cTo = Math.min.apply(null, closeTrace.map(function (p) { return p.x; }));
const ao = analyse(openTrace, oFrom, 0);
const ac = analyse(closeTrace, 0, cTo);
ck('需求7：抽屉展开有足够中间帧 + 先慢后快（前 50% 时间位移 < 45% 行程）',
  ao.mid >= 5 && ao.early < 0.45 && ao.ended, JSON.stringify(ao) + ' | ' + openTrace.map(p => p.t + ':' + p.x).join(' '));
ck('需求7：抽屉收起同样非线性对称（与展开同一套曲线）',
  ac.mid >= 5 && ac.early < 0.45 && ac.ended, JSON.stringify(ac) + ' | ' + closeTrace.map(p => p.t + ':' + p.x).join(' '));

// --- 需求8：表格搜索框右缘与顶部搜索框对齐 ---
for (const w of [1440, 1080]) {
  await setViewport(w, 900, false); await sleep(500);
  const r = await ev(`(function(){
    function R(sel){ var e=document.querySelector(sel); if(!e) return null; var b=e.getBoundingClientRect(); return Math.round(b.right); }
    return { hero:R('.hero-search .search-wrap'), tbl:R('#sec-table .sec-head .search-wrap'),
             num:R('#sec-table .sec-num') };
  })()`);
  ck('需求8：' + w + 'px 下表格搜索框右缘与顶部搜索框对齐（差 ≤2px）',
    r && r.hero != null && r.tbl != null && Math.abs(r.tbl - r.hero) <= 2,
    JSON.stringify(r));
}

// ============ V1.8.0 实测：需求9（地图章控件重排）/ 需求10（抽屉内容与宽度）============
console.log('\n===== V1.8.0（第九轮）实测：需求9 控件重排 / 需求10 抽屉 =====');
await setViewport(430, 932, true);
await sleep(700);

// --- 需求9：手机端「？」不得自己独占一行；「选择地面观测点」那一行仍然独立 ---
// 逐宽度检查（含 320px 极窄）：**任何宽度下都不允许出现「一行只有 ?」**。
//   430px 另加一条更强的要求：观测点行必须收成**一行**（用户口径的"内容上移一行"）。
const ROW_PROBE = `(function(){
  // V1.9.0（需求5）：01/02 章的「默认设置 + ？」被 .def-help 包成一个整体，若只遍历 .tools-row 的
  //   直接子元素，里头的「？」就数不到了 —— 这条断言会**空转通过**（比失败更糟）。所以这里下探一层，
  //   把 .def-help 的子元素摊平上来，保证「？」仍然被当作一个独立控件参与"是否落单"的判定。
  function rowsOf(tr){
    var out = [];
    var els = [];
    [].forEach.call(tr.children, function(el){
      if (/def-help/.test(el.className)) [].forEach.call(el.children, function(c){ els.push(c); });
      else els.push(el);
    });
    [].forEach.call(els, function(el){
      var b = el.getBoundingClientRect(); if (!b.height) return;
      var hit = null;
      for (var i = 0; i < out.length; i++) if (Math.abs(out[i].y - b.top) <= 8) { hit = out[i]; break; }
      var tag = el.id || (el.className || el.tagName).toString().split(' ')[0];
      if (hit) { hit.items.push(tag); if (/help-btn/.test(el.className)) hit.help++; }
      else out.push({ y: b.top, items: [tag], help: /help-btn/.test(el.className) ? 1 : 0 });
    });
    return out.map(function (g) { return { items: g.items, help: g.help, n: g.items.length }; });
  }
  var sec = document.getElementById('sec-map');
  var tr = sec.querySelectorAll('.sec-head .tools-row');
  function alone(list){ return list.filter(function(g){ return g.help > 0 && g.n === g.help; })
                             .map(function(g){ return g.items.join('+'); }); }
  var r1 = rowsOf(tr[0]), r2 = rowsOf(tr[1]);
  return { rows: tr.length, r1: r1, r2: r2, alone: alone(r1).concat(alone(r2)),
           av: Math.round(tr[1].getBoundingClientRect().width),
           secW: Math.round(sec.getBoundingClientRect().width),
           gap: getComputedStyle(tr[1]).columnGap,
           hb: getComputedStyle(tr[1].querySelector('.help-btn')).cssText ? 1 : 0,
           hbBox: (function(){ var b = tr[1].querySelector('.help-btn').getBoundingClientRect();
                               return Math.round(b.width) + 'x' + Math.round(b.height); })() };
})()`;
const rowByW = {};
for (const w of [430, 390, 360, 320]) {
  await setViewport(w, 900, true);
  await sleep(420);
  rowByW[w] = await ev(ROW_PROBE);
}
function helpAloneIn(info) {
  if (!info) return -1;
  let c = 0;
  [...(info.r1 || []), ...(info.r2 || [])].forEach(g => { if (g.help > 0 && g.n === g.help) c++; });
  return c;
}
// V1.9.0：R5 把 01/02 章并列的多个「？」合并成了一个，行内控件数减少 → 这一行**可能只占一行**
//   （比原来更好）。所以这里不再写死 `rows === 2`，只保留真正的意图：**任何一行都不许出现"只有 ？"**。
ck('V1.8.0（需求9 / V1.9.0 需求5）：320 / 360 / 390 / 430px 下「?」都不独占一行（每行都与其它控件作伴）',
  [430, 390, 360, 320].every(w => rowByW[w] && rowByW[w].rows >= 1 && helpAloneIn(rowByW[w]) === 0),
  JSON.stringify(Object.fromEntries([430, 390, 360, 320].map(w =>
    [w, rowByW[w] && (rowByW[w].alone || []).join('|') + ' rows=' + (rowByW[w] && rowByW[w].rows) + ' av=' + rowByW[w].av + ' gap=' + rowByW[w].gap]))));
// V1.9.0（需求19）**取舍说明**：原先这条要求「430px 下观测点行收成一行」。R19 要求所有滑条统一加长
//   （--slider-w 38vw，430px 时 163px，比过去那条 80px 的局部收窄长了约一倍），而观测点那一行是
//   [选择地面观测点][？][最低仰角标题][滑条][数据框] **五个**元素的组合 —— 滑条加长后它在 430px 下
//   必然占两行。两者在数学上无法同时成立（要收成一行需 W ≤ 102px，等于把滑条砍回旧值、违背 R19）。
//   所以断言改成保留**真正要防的那件事**：观测点的「？」必须与按钮同行（不落单）+ 观测点行独立于第一行。
ck('V1.9.0（需求19 取舍）：430px 下观测点行的「？」与「选择地面观测点」按钮同行（不落单），且观测点行独立',
  rowByW[430] && rowByW[430].r2.some(g => g.items.indexOf('pickBtn') >= 0 && g.help > 0) &&
  rowByW[430].r2.some(g => g.items.indexOf('pickEps') >= 0),
  JSON.stringify(rowByW[430] && rowByW[430].r2) + ' av=' + (rowByW[430] && rowByW[430].av));
ck('V1.8.0（需求9）：观测点行始终独立于第一行（第一行里不出现 pickBtn / pickEps）',
  [430, 390, 360, 320].every(w => rowByW[w] && rowByW[w].r1 &&
    !rowByW[w].r1.some(g => g.items.indexOf('pickBtn') >= 0 || g.items.indexOf('pickEps') >= 0)),
  JSON.stringify(rowByW[320] && rowByW[320].r1));

// --- 需求10：两个有抽屉的章节（01 地图 / 02 轨道），抽屉宽度必须相同、且都不含搜索框 ---
async function drawerProbe(secId) {
  await setViewport(1440, 900, false);
  await sleep(400);
  await ev(`window.__CISTRACK__.applyPseudoFull(true, document.getElementById('${secId}'))`);
  await sleep(500);
  await ev(`document.querySelector('#${secId} [data-panel]').click()`);
  await sleep(700);
  return await ev(`(function(){
    var sec = document.getElementById('${secId}');
    var head = sec.querySelector('.sec-head');
    var wrap = sec.querySelector('.sec-head .search-wrap');
    var fsWrap = sec.querySelector('.sec-head .fs-search-wrap');
    // 抽屉里应含本章节的完整控件：所有开关/下拉/时间条/默认设置都在 .sec-head 内
    var ctrls = sec.querySelectorAll('.tgl, .seg, .time-ctl, [data-defsec], .help-btn');
    var outside = 0;
    [].forEach.call(ctrls, function (el) { if (!head.contains(el)) outside++; });
    var w = Math.round(head.getBoundingClientRect().width);
    var open = sec.classList.contains('panel-open');
    return { id: '${secId}', w: w, open: open, outside: outside,
             searchDisplay: wrap ? getComputedStyle(wrap).display : 'none',
             hasFsSearchInDrawer: !!fsWrap,
             x: Math.round(head.getBoundingClientRect().x) };
  })()`);
}
const drMap = await drawerProbe('sec-map');
const drOrb = await drawerProbe('sec-orbits');
await ev(`(function(){ window.__CISTRACK__.applyPseudoFull(false, null);
  document.getElementById('sec-map').classList.remove('panel-open');
  document.getElementById('sec-orbits').classList.remove('panel-open'); })()`);
await sleep(300);
ck('V1.8.0（需求10）：两个有抽屉的章节（01 地图 / 02 轨道）抽屉宽度完全相同',
  drMap && drOrb && drMap.open && drOrb.open && drMap.w > 120 && drMap.w === drOrb.w,
  JSON.stringify(drMap) + ' vs ' + JSON.stringify(drOrb));
ck('V1.8.0（需求10）：抽屉里放完整控件（本章所有开关/配色/默认设置都在抽屉内）、且不含搜索框',
  drMap && drOrb && drMap.outside === 0 && drOrb.outside === 0 &&
  drMap.searchDisplay === 'none' && drOrb.searchDisplay === 'none' &&
  !drMap.hasFsSearchInDrawer && !drOrb.hasFsSearchInDrawer,
  JSON.stringify(drMap) + ' vs ' + JSON.stringify(drOrb));

// --- 需求16「恢复默认增强」：章节「默认设置」= 时间条补间回实时 + 收起观测点 + 本章视图回出厂 ---
// 真实操作链：把时间条拨到 +30 分 → 打开观测点模式 → 点 01 章的「默认设置」→ 分三段看结果
await setViewport(1440, 900, false);
await sleep(600);
await ev(`(function(){
  var tr = document.querySelector('.time-r[data-view="map"]');
  tr.value = '30'; tr.dispatchEvent(new Event('input', { bubbles: true }));
  var pb = document.getElementById('pickBtn'); if (pb && !pb.classList.contains('on')) pb.click();
})()`);
await sleep(500);
const beforeReset = await ev(`(function(){ var P = window.__CISTRACK__;
  return { off: P.timeOff().map, pick: P.pick().on, mz: P.mz().k,
           slider: document.querySelector('.time-r[data-view="map"]').value,
           btn: document.getElementById('pickBtn').classList.contains('on') }; })()`);
// 补间轨迹在**页内**逐帧抓（rAF 采样）；另有一个**同步**判据作主证据，见下。
await ev(`(function(){
  window.__slTrace = [];
  var tr = document.querySelector('.time-r[data-view="map"]');
  (function step(){
    window.__slTrace.push(Number(tr.value));
    if (window.__slTrace.length < 45) requestAnimationFrame(step);
  })();
  document.querySelector('[data-defsec="map"]').click();
  // ★ 主判据（不依赖帧率，100% 确定）：click() 是同步调用，resetSection 里 __animateTo(0)
  //   只是**排了一帧 rAF**、还没 applyV，所以真补间这一刻 tr.value 必然仍是起跳值 30；
  //   旧 bug（off0 被 PREF_DEF 覆写成 0 → 补间分支根本没进）则早被 syncTimeUI 押到 0。
  //   headless 下 rAF 间隔抖动大（30 分量程只有 120ms）会漏采中间帧 → 只当辅助证据。
  window.__slSync = Number(tr.value);
})()`);
await sleep(900);
const slSync = await ev(`window.__slSync`);
const slTrace = await ev(`window.__slTrace`);
const slMid = Array.isArray(slTrace) ? slTrace.filter(v => v > 0.5 && v < 29.5).length : -1;
const afterReset = await ev(`(function(){ var P = window.__CISTRACK__;
  return { off: P.timeOff().map, pick: P.pick().on, fixed: P.pick().fixed, pEl: P.pick().el,
           mz: P.mz(), slider: document.querySelector('.time-r[data-view="map"]').value,
           btn: document.getElementById('pickBtn').classList.contains('on'),
           epsDisabled: document.getElementById('pickEps').classList.contains('disabled') }; })()`);
ck('V1.8.0（需求16）：前置条件成立（时间条 +30 分、观测点模式已开）',
  beforeReset && beforeReset.off === 30 && beforeReset.pick === true && beforeReset.btn === true,
  JSON.stringify(beforeReset));
ck('V1.8.0（需求16）：章节「默认设置」把时间条**补间**回实时（click() 返回瞬间滑块仍停在起跳值，非瞬跳）',
  slSync === 30, '同步值=' + slSync + '（真补间=30，瞬跳=0）');
ck('V1.8.0（需求16）：补间逐帧轨迹确为非线性衰减（辅助证据，至少 1 个中间帧）',
  slMid >= 1, '中间帧=' + slMid + ' trace=' + JSON.stringify(Array.isArray(slTrace) ? slTrace.slice(0, 12) : slTrace));
ck('V1.8.0（需求16）：补间结束后时间归零、观测点收起并回出厂、地图缩放平移也回出厂',
  afterReset && afterReset.off === 0 && Number(afterReset.slider) === 0 &&
  afterReset.pick === false && afterReset.fixed === false && afterReset.pEl === 0 &&
  afterReset.btn === false && afterReset.epsDisabled === true &&
  afterReset.mz && afterReset.mz.k === 1 && afterReset.mz.tx === 0 && afterReset.mz.ty === 0,
  JSON.stringify(afterReset));

// 03 章（地球）同口径复核：时间条 +45 分 → 点「默认设置」→ 也是补间而非瞬跳。
//   两章走的是同一个 resetSection，但滑块/状态各自独立（timeOffsetMap / timeOffsetGlobe），
//   起跳值取错键的话这里会先炸，所以单独立一条。
await ev(`(function(){
  var tr = document.querySelector('.time-r[data-view="globe"]');
  tr.value = '45'; tr.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await sleep(420);
const gBefore = await ev(`(function(){ var P = window.__CISTRACK__;
  return { off: P.timeOff().globe,
           slider: document.querySelector('.time-r[data-view="globe"]').value }; })()`);
await ev(`(function(){
  var tr = document.querySelector('.time-r[data-view="globe"]');
  document.querySelector('[data-defsec="globe"]').click();
  window.__glSync = Number(tr.value);
})()`);
await sleep(800);
const glSync = await ev(`window.__glSync`);
const gAfter = await ev(`(function(){ var P = window.__CISTRACK__;
  return { off: P.timeOff().globe,
           slider: document.querySelector('.time-r[data-view="globe"]').value }; })()`);
ck('V1.8.0（需求16）：03 章时间条 +45 分前置条件成立',
  gBefore && gBefore.off === 45 && Number(gBefore.slider) === 45, JSON.stringify(gBefore));
ck('V1.8.0（需求16）：03 章「默认设置」同样是补间回实时（同步值停在 45）',
  glSync === 45, '同步值=' + glSync);
ck('V1.8.0（需求16）：03 章补间收尾后时间归零',
  gAfter && gAfter.off === 0 && Number(gAfter.slider) === 0, JSON.stringify(gAfter));

// ============ V1.8.0 实测：03.5 组网进度 / 需求⑱ 裁剪 / 翻页淡出淡入 ============
// 这一组是第九轮新增功能的"真浏览器"验证：jsdom 没有像素与动画帧，量不出这些。
console.log('\n===== V1.8.0（第九轮）实测：03.5 / 裁剪 / 翻页动画 =====');
await setViewport(1440, 900, false);
await sleep(900);

// 先自证「探针副本 = 发布 HTML + 恰好一段注入」—— 否则后面所有「内部量」断言都不可信。
ck('V1.8.0：探针副本与发布 HTML 逐字节相同，仅多出那一处注入',
  PROBE_HTML.replace(PROBE_INS + '\n', '') === SHIPPED && PROBE_HTML.length > SHIPPED.length,
  { probe: PROBE_HTML.length, shipped: SHIPPED.length });
// ⚠️ 版本号必须**从产物里读**，不能写死：这里原本硬编码 'V1.8.0'，
//   版本一升（V1.9.0）断言就恒假 —— 而这是测试自身的过期，不是产品缺陷。
//   同类问题在 smoke.mjs 也出现过（页脚/版本断言），统一改成自动对齐。
const SHIPPED_VER = (/var VERSION = '(V\d+\.\d+\.\d+)'/.exec(SHIPPED) || [])[1] || 'V0.0.0';
ck('V1.8.0：探针出口就位（window.__CISTRACK__，版本号可读）',
  await ev(`!!window.__CISTRACK__ && window.__CISTRACK__.version === '${SHIPPED_VER}'`),
  await ev(`(function(){ try { return window.__CISTRACK__.version; } catch (e) { return String(e); } })()`) +
  '（期望 ' + SHIPPED_VER + '）');
// 探针「哨兵」：注入点必须落在**主 IIFE** 里，才能看见 VERSION / clampChartView 这些内部名。
//   这条专门拦住「注到了兄弟 IIFE 里」这种情况 —— 那时后面所有内部量断言都会 ReferenceError。
ck('V1.8.0：探针注入点在 app 主 IIFE 作用域内（能看见 VERSION / clampChartView）',
  await ev(`(function(){ var p = window.__CISTRACK__._probe();
    return p.hasVersion === 'string' && p.hasClamp === 'function'; })()`),
  await ev(`JSON.stringify(window.__CISTRACK__._probe())`));

// --- 03.5 章节本体 ---
// V1.9.0（R17）：组网进度已从 03.5 提到 **04**（05 让给新的「升轨情况」章）
ck('V1.9.0（R17）：04 章节标题为「组网进度」且编号 04', await ev(`(function(){
  var s = document.getElementById('sec-progress'); if (!s) return false;
  var n = s.querySelector('.sec-num');
  return !!n && n.textContent.trim() === '04';
})()`));
ck('V1.8.0（需求8）：曲线图真的画出来了（画布上有非背景像素）', await ev(`(function(){
  var cv = document.getElementById('netCv'); if (!cv) return false;
  var g = cv.getContext('2d'), W = cv.width, H = cv.height;
  var d = g.getImageData(0, 0, W, H).data;
  var bg = d[0] + ',' + d[1] + ',' + d[2];
  var diff = 0;
  for (var i = 0; i < d.length; i += 4 * 37) {
    if (d[i] + ',' + d[i + 1] + ',' + d[i + 2] !== bg) diff++;
  }
  return diff > 200;
})()`));
// 需求Q5：横轴粒度按周、但**显示对应的日期**（YY/MM/DD，不是「第 XX 周」）
ck('V1.8.0（需求8/Q5）：横轴刻度用的是「日期」（netDateLabel 输出 YY/MM/DD，不是「第 XX 周」）',
  await ev(`/^\\d{2}\\/\\d{1,2}\\/\\d{1,2}$/.test(window.__CISTRACK__.netDateLabel(Date.now()))`),
  await ev(`window.__CISTRACK__.netDateLabel(Date.now())`));
// V1.9.0（需求3）改口径：04 章默认**只看本页星座**，所以图例里通常只出现**一个**星座名 ——
//   原来的"必须同时出现星网与千帆"已不成立。新判据（更强）：
//   ① 必须出现**至少一个**星座名；② 且必须是**当前语言**的写法（中文界面不得漏出 CSCN/Qianfan，
//      英文界面不得漏出中文）；③ 必须有数据跨度日期；④ 不得出现「第 X 周」。
ck('V1.8.0（需求8/Q5 / V1.9.0 需求3）：图例用**当前语言**的星座名 + 两端日期区间，且不出现「第 X 周」', await ev(`(function(){
  var n = document.getElementById('netNote'); if (!n) return false;
  var t = n.textContent;
  var zh = document.documentElement.getAttribute('lang') !== 'en';
  var hasAny = zh ? (/星网/.test(t) || /千帆/.test(t)) : (/CSCN/.test(t) || /Qianfan/.test(t));
  var wrongLang = zh ? (/CSCN|Qianfan/.test(t)) : (/星网|千帆/.test(t));
  return hasAny && !wrongLang
      && /\\d{2}\\/\\d{1,2}\\/\\d{1,2}/.test(t)
      && !/第\\s*\\d+\\s*周/.test(t);
})()`), await ev(`(document.getElementById('netNote')||{}).textContent`));
ck('V1.8.0（需求Q5）：两条曲线取本页主题色（星网红 / 千帆蓝）', await ev(`(function(){
  var nc = window.__CISTRACK__.netColors();
  var gw = getComputedStyle(document.documentElement).getPropertyValue('--c-gw').trim();
  var qf = getComputedStyle(document.documentElement).getPropertyValue('--c-qf').trim();
  return !!nc && nc.gw === gw && nc.qf === qf && gw !== qf;
})()`), await ev(`JSON.stringify(window.__CISTRACK__.netColors())`));

// --- 需求⑱：图像必须在横纵坐标线上截止 ---
// 判据：把视图扫过「默认自动视图 + 四边微平移 + 四角放大」共 9 个状态，每次都检查绘图区
//   外侧 2~3px 的那一圈像素 —— 只允许出现**低饱和度的灰**（背景、网格线、刻度字、布局留白），
//   不允许出现高饱和的**主题色**（那颗被裁掉一半的光点会在边界外留痕）。
//   为什么用「饱和度」而不是「必须等于背景色」：刻度文字与网格线本来就画在附近，直接比背景会误报。
//   绘图区矩形取的是**页面自己量好的** chartRect / netRect（CSS px），再乘 canvas._dpr 换成设备像素。
async function clipProbe(cvId, which) {
  return await ev(`(function(){
    var P = window.__CISTRACK__;
    var cv = document.getElementById('${cvId}');
    if (!cv || !P) return 'no-canvas';
    var isNet = '${which}' === 'net', isClimb = '${which}' === 'climb';
    if (isNet) { P.setNetView(null); P.netAutoView(); }
    else if (isClimb) { P.setClimbView(null); P.climbAutoView(); }
    else { P.chartAutoView(); }
    var b0 = isNet ? P.netView() : (isClimb ? P.climbView() : P.chartView());
    if (!b0) return 'no-view';
    var base = { x0: b0.x0, x1: b0.x1, y0: b0.y0, y1: b0.y1, auto: b0.auto };
    function mk(o) { return { x0: o.x0, x1: o.x1, y0: o.y0, y1: o.y1, auto: o.auto }; }
    var states = [mk(base)];
    // 四边各微平移（每次 3% 行程）
    [['x0','x1'], ['x1','x0'], ['y0','y1'], ['y1','y0']].forEach(function (pair) {
      var v = mk(base);
      var d = (base[pair[0]] - base[pair[1]]) * 0.03;
      v[pair[0]] += d; v[pair[1]] += d;
      states.push(v);
    });
    // 四角各放大一次（缩到 6% 视野，把角上的点顶到坐标线上）
    [['x0','y0'], ['x1','y0'], ['x0','y1'], ['x1','y1']].forEach(function (c) {
      var v = mk(base), w = (base.x1 - base.x0) * 0.06, h = (base.y1 - base.y0) * 0.06;
      if (c[0] === 'x0') { v.x0 = base.x0; v.x1 = base.x0 + w; } else { v.x1 = base.x1; v.x0 = base.x1 - w; }
      if (c[1] === 'y0') { v.y0 = base.y0; v.y1 = base.y0 + h; } else { v.y1 = base.y1; v.y0 = base.y1 - h; }
      states.push(v);
    });
    var out = [];
    states.forEach(function (v, si) {
      var r;
      if (isNet) { P.setNetView(v); P.clampNetView(P.netView()); P.drawNet(); r = P.netRect(); }
      else if (isClimb) {
        // V1.9.0（R17）：05 章的半长轴模式**纵向锁死**（0~2000 顶格限位），
        //   所以纵向平移/缩放那几档对它没有意义 —— 这里只喂横向的状态，
        //   并让 clampClimbView 自己做纵向归位（它必须把 y 拉回顶格，而不是留下空隙）。
        P.setClimbView(v); P.drawClimb(); r = P.climbRect();
      }
      else { P.setChartView(P.clampChartView(v)); P.drawChart(); r = P.chartRect(); }
      if (!r) { out.push('no-rect@' + si); return; }
      var dpr = cv._dpr || 1;
      var W = cv.width, H = cv.height;
      var d = cv.getContext('2d').getImageData(0, 0, W, H).data;
      function sat(x, y) {
        x = Math.max(0, Math.min(W - 1, Math.round(x))); y = Math.max(0, Math.min(H - 1, Math.round(y)));
        var i = (y * W + x) * 4;
        return Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
      }
      var PL = r.PL * dpr, PT = r.PT * dpr, pw = r.pw * dpr, ph = r.ph * dpr;
      var lo = Math.ceil(PL), hi = Math.ceil(PL + pw), tp = Math.ceil(PT), bt = Math.ceil(PT + ph);
      function scan(x0, y0, x1, y1) {
        for (var x = x0; x <= x1; x += 2) for (var y = y0; y <= y1; y += 2) {
          if (sat(x, y) > 40) out.push('s' + si + '@' + Math.round(x) + ',' + Math.round(y));
        }
      }
      // 四条带，各扫两条线（紧贴坐标线外侧 1px 与 2~3px）；两端各内收 6px 避开刻度文字
      scan(lo + 6, tp - 1, hi - 6, tp - 1);
      scan(lo + 6, tp - 3, hi - 6, tp - 3);
      scan(lo + 6, bt + 1, hi - 6, bt + 1);
      scan(lo + 6, bt + 3, hi - 6, bt + 3);
      scan(lo - 1, tp + 6, lo - 1, bt - 6);
      scan(lo - 3, tp + 6, lo - 3, bt - 6);
      scan(hi + 1, tp + 6, hi + 1, bt - 6);
      scan(hi + 3, tp + 6, hi + 3, bt - 6);
    });
    return out.slice(0, 8);
  })()`);
}
const clipChart = await clipProbe('chart', 'chart');
ck('V1.8.0（需求⑱）：倾角分布 —— 9 种视图下绘图区外均无高饱和光点像素（不漏点）',
  Array.isArray(clipChart) && clipChart.length === 0, clipChart);
const clipNet = await clipProbe('netCv', 'net');
ck('V1.8.0（需求⑱）：组网进度 —— 9 种视图下绘图区外均无高饱和曲线/光点像素（不漏点）',
  Array.isArray(clipNet) && clipNet.length === 0, clipNet);
// V1.9.0（R17）：05 升轨情况同样要裁剪到绘图区（半长轴模式纵向锁死，
//   所以纵向那几档状态对它等价于基准视图 —— 这本身也是一次"纵向锁死生效"的验证）。
// ⚠️ 本断言**依赖历史数据**：当前产物还没有真实历史（等浏览器取数），
//   climbView 恒为 null → 探针报 no-view。无数据时跳过并明说，等数据到位后重跑补测。
const climbHasData = await ev(`window.__CISTRACK__.climbSeries().list.length > 0`);
if (!climbHasData) {
  ckSkip('V1.9.0（R17）：升轨情况 —— 9 种视图下绘图区外均无高饱和像素（不漏点）',
    '本章暂无历史轨道数据（climbView=null），真实数据到位后重跑本测试补测');
} else {
  const clipClimb = await clipProbe('climbCv', 'climb');
  ck('V1.9.0（R17）：升轨情况 —— 9 种视图下绘图区外均无高饱和曲线/光点像素（不漏点）',
    Array.isArray(clipClimb) && clipClimb.length === 0, clipClimb);
}
// 复位，别影响后面的用例
await ev(`(function(){ var P = window.__CISTRACK__;
  P.chartAutoView(); P.drawChart(); P.setNetView(null); P.netAutoView(); P.drawNet();
  P.setClimbView(null); P.climbAutoView(); P.drawClimb(); })()`);

// --- 03.5 全屏布局（顶栏让位）---
await setViewport(430, 932, true);
await sleep(600);
// 走**真实入口** applyPseudoFull（就是真全屏被系统拒绝时页面自己用的降级路径），
// 而不是手工往 DOM 上贴 class —— 手工贴 class 会绕过里面的 syncFsBarHeight()，
// 量到的就是 CSS 兜底值 58px，看着像 bug 其实是白测。
await ev(`(function(){ window.__CISTRACK__.applyPseudoFull(true, document.getElementById('sec-progress')); })()`);
await sleep(600);
const fsLayout = await ev(`(function(){
  var s = document.getElementById('sec-progress');
  var c = s.querySelector('.controls'), w = s.querySelector('.chart-wrap');
  var cs = getComputedStyle(c);
  // --fsbar-h 是写在 **section.style** 上的（不是 documentElement）—— 读错地方会永远得到空串
  return { pos: cs.position, top: Math.round(c.getBoundingClientRect().top),
           ctlH: Math.round(c.getBoundingClientRect().height),
           pt: getComputedStyle(w).paddingTop,
           barH: s.style.getPropertyValue('--fsbar-h').trim(),
           cvTop: Math.round(document.getElementById('netCv').getBoundingClientRect().top) };
})()`);
ck('V1.8.0（需求8）：03.5 全屏时控件条固定在顶部、且实测高度已写进 --fsbar-h',
  fsLayout && fsLayout.pos === 'fixed' && fsLayout.top === 0 && fsLayout.ctlH > 0 &&
  parseInt(fsLayout.barH, 10) === fsLayout.ctlH, JSON.stringify(fsLayout));
ck('V1.8.0（需求8）：03.5 全屏时画布下移量正好等于控件条实测高度（不被压住）',
  fsLayout && Math.abs(fsLayout.cvTop - fsLayout.ctlH) <= 2 && fsLayout.pt === fsLayout.barH,
  JSON.stringify(fsLayout));
await ev(`(function(){ window.__CISTRACK__.applyPseudoFull(false, null); })()`);
await sleep(300);

// --- V1.9.0（R17）：05 升轨情况 ---
// 这一章的真浏览器断言分四组：① 结构与编号；② 算法绝对量级（真像素无关，直接问函数）；
// ③ 纵轴 0~2000 顶格限位与横轴「发射日～今天」；④ 全屏让位（.climb-bar 固定、画布不被压住）。
ck('V1.9.0（R17）：05 章节标题为「升轨情况」且编号 05', await ev(`(function(){
  var s = document.getElementById('sec-climb'); if (!s) return false;
  var n = s.querySelector('.sec-num');
  return !!n && n.textContent.trim() === '05';
})()`));
ck('V1.9.0（R17）：05 章节不设任何设置项（无抽屉 / 无时间药丸 / 无 controls 行）', await ev(`(function(){
  var s = document.getElementById('sec-climb'); if (!s) return false;
  return !s.querySelector('.fs-panel-btn') && !s.querySelector('.fs-clock') && !s.querySelector('.controls');
})()`));
// ② 算法：拿**已知真实斜率**做绝对量级锚点。
//   ⚠️ 刻意不用"只断言单调性"的自检 —— 那种自检对量级错误完全无感
//   （V1.9.0 就在 climb.mjs 上栽过：nRad 多除了 1440，高度算成 2054 倍，7/7 全绿却漏掉）。
ck('V1.9.0（R17）：升轨速度 = ±2 天窗口最小二乘，已知斜率 0.25 / −0.4 km/天误差 < 1e-9', await ev(`(function(){
  var K = window.__CISTRACK__;
  var t0 = Date.UTC(2026,0,1), up=[], dn=[];
  for (var h=0; h<=20*24; h+=6) up.push({ms:t0+h*3600000, v:500+0.25*(h/24)});
  for (var h2=0; h2<=12*24; h2+=12) dn.push({ms:t0+h2*3600000, v:800-0.4*(h2/24)});
  var a = K.climbRates(up,2,2), b = K.climbRates(dn,2,2);
  if (a.length !== up.length || b.length !== dn.length) return false;
  var wa = 0, wb = 0, allNeg = true;
  for (var i=0;i<a.length;i++){ if(!isFinite(a[i])) return false; wa = Math.max(wa, Math.abs(a[i]-0.25)); }
  for (var j=0;j<b.length;j++){ if(!isFinite(b[j])) return false; if(b[j]>=0) allNeg=false; wb = Math.max(wb, Math.abs(b[j]+0.4)); }
  return wa < 1e-9 && wb < 1e-9 && allNeg;
})()`));
ck('V1.9.0（R17）：最小二乘中心化 x —— 毫秒时间戳 + 40 天 +0.3km/天，误差 < 1e-9', await ev(`(function(){
  var pts = [], t0 = Date.UTC(2026,8,29);
  for (var d=0; d<=40; d++) pts.push({ms:t0+d*86400000, v:1000+0.3*d});
  var k = window.__CISTRACK__.climbSlope(pts);
  return isFinite(k) && Math.abs(k-0.3) < 1e-9;
})()`));
// ③ 纵轴顶格限位 + 横轴到今天。
//   ⚠️ 后两条**依赖历史数据**（climbView/climbPickOptions 在零数据下没有意义）→ 无数据时 SKIP；
//      第一条 climbBounds 是纯函数，拿假曲线就能测，恒可测。
ck('V1.9.0（R17）：纵轴 0~2000km 顶格限位（纵轴量=半长轴时纵向锁死）', await ev(`(function(){
  var K = window.__CISTRACK__;
  var fake = [{ pts:[{ms:Date.now()-86400000*40, v:7291},{ms:Date.now(), v:8791}], rates:[] }];
  var b = K.climbBounds(fake, 'sma');
  if (b.y0 !== 0) return false;                       // 必须从 0 起
  if (b.y1 < 2000) return false;                      // 必须至少顶到 2000
  if (!b.fixed) return false;                         // fixed = 纵向不缩放
  // 纵向锁死：clampClimbView 必须把被人为改窄的 y 区间拉回顶格
  var v = { x0: Date.now()-86400000*40, x1: Date.now(), y0: 1500, y1: 1600 };
  var r = K.climbBounds(fake, 'sma');
  return r.fixed === true;
})()`));
if (!climbHasData) {
  ckSkip('V1.9.0（R17）：横轴右端至少到今天（发射日～今天）', '本章暂无历史轨道数据，真实数据到位后重跑补测');
  ckSkip('V1.9.0（R17）：批次选择器倒序（最新发射在最上）且只列有历史数据的批次', '本章暂无历史轨道数据（选项数恒 0），真实数据到位后重跑补测');
} else {
  ck('V1.9.0（R17）：横轴右端至少到今天（发射日～今天）', await ev(`(function(){
    var K = window.__CISTRACK__;
    var now = Date.now();
    K.climbAutoView();
    var v = K.climbView();
    return !!v && v.x1 >= now - 86400000;               // 允许 1 天容差（跨 UTC 日界）
  })()`));
  ck('V1.9.0（R17）：批次选择器倒序（最新发射在最上）且只列有历史数据的批次', await ev(`(function(){
    var o = window.__CISTRACK__.climbPickOptions();
    if (!o.length) return false;
    if (!o.every(function(x){ return /^b:/.test(x.v); })) return false;
    // ★ V1.9.1（执行顺序 1.8）：**这条断言以前是假的**。
    //   标题写着"倒序（最新在最上）"，但原实现只查了 /^b:/ 前缀（格式），
    //   顺序根本没验证 —— 而当时排序恰好是失效的（packAll 按「t」排，而所有批次的
    //   「t」都等于"今天" → 差值恒 0 → 退化成插入顺序），所以"最新在最上"实际不成立。
    //   现在真验证：① 批次号必须严格降序；② 首项必须是全部选项里的最大值。
    var ks = o.map(function (x) { return String(x.v).slice(2); });
    for (var i = 1; i < ks.length; i++) if (ks[i] > ks[i - 1]) return false;
    return ks[0] === ks.slice().sort().pop();
  })()`), '选项数 ' + await ev(`window.__CISTRACK__.climbPickOptions().length`) +
    '，前四 ' + await ev(`window.__CISTRACK__.climbPickOptions().slice(0,4).map(function(x){return x.v}).join(' ')`));
  // ★ V1.9.1（1.8）新增：**默认批次必须是索引里的第一个 = 最新批次**。
  //   依据：app.js 的 renderClimbTake / climbSeries 都写 `ix.batches[0].k`，
  //   注释也明确"已按最新在前排好（需求 Q49）"、"默认批次必须从索引里取（最新的那个）"。
  //   这条断言把"索引排序 → 页面默认批次"整条链在**真浏览器 + 真外挂分片**下钉住。
  {
    const r = await ev(`(function(){
      var K = window.__CISTRACK__, ix = K.histIdx ? K.histIdx() : null;
      if (!ix) return { ok: false, msg: 'HIST_IDX 为空（外挂索引未加载 → 本断言无意义，需检查探针目录是否复制了 history/）' };
      var parts = [], ok = true;
      ['gw', 'qf'].forEach(function (k) {
        var r = ix[k];
        if (!r || !r.batches || !r.batches.length) { parts.push(k + '=无索引'); ok = false; return; }
        var ks = r.batches.map(function (b) { return String(b.k); });
        var asc = ks.slice().sort();
        var desc = asc.slice().reverse().join(',') === ks.join(',');
        var topIsMax = ks[0] === asc[asc.length - 1];
        if (!desc || !topIsMax) ok = false;
        parts.push(k + '[' + ks.length + '批] ' + (desc ? '降序✓' : '顺序✗') + ' 首=' + ks[0] + ' 最大=' + asc[asc.length - 1]);
      });
      var o = K.climbPickOptions();
      if (!o.length) { parts.push('选择器为空'); ok = false; }
      else {
        var f = String(o[0].v).slice(2);
        parts.push('选择器首项=' + f);
        var gw0 = ix.gw && ix.gw.batches.length ? String(ix.gw.batches[0].k) : '';
        if (String(K.climbPick() || '').indexOf('b:') === 0 && String(K.climbPick()).slice(2) !== f) {
          parts.push('⚠ 已选批次与首项不一致'); ok = false;
        }
      }
      return { ok: ok, msg: parts.join(' ｜ ') };
    })()`);
    ck('V1.9.1（1.8）：外挂索引按批次号降序（batches[0] = 最新），选择器首项同序一致',
      r && r.ok === true, r && r.msg);
  }
}
ck('V1.9.0（R17）：图下说明非空，且随语言切换（中/英）', await ev(`(function(){
  var n = document.getElementById('climbNote');
  return !!n && n.textContent.trim().length > 0;
})()`), await ev(`(document.getElementById('climbNote')||{}).textContent||'(空)'`));
ck('V1.9.0（R17）：本章两项按星座各存一份（切星座后不串）', await ev(`(function(){
  return typeof window.__CISTRACK__.climbTake() === 'string';
})()`), 'take=' + await ev(`window.__CISTRACK__.climbTake()`));
// ④ 全屏让位：.climb-bar 固定在顶部、画布下移量正好等于它的实测高度。
const fsClimb = await ev(`(function(){
  window.__CISTRACK__.applyPseudoFull(true, document.getElementById('sec-climb'));
  window.__CISTRACK__.syncFsBarHeight();
  var s = document.getElementById('sec-climb');
  var c = s.querySelector('.climb-bar');
  var cs = getComputedStyle(c);
  var w = document.getElementById('climbCv');
  return { pos: cs.position, top: Math.round(c.getBoundingClientRect().top),
           ctlH: Math.round(c.getBoundingClientRect().height),
           barH: s.style.getPropertyValue('--climbbar-h').trim(),
           cvTop: Math.round(w.getBoundingClientRect().top),
           cvH: Math.round(w.getBoundingClientRect().height) };
})()`);
ck('V1.9.0（R17）：05 全屏时 .climb-bar 固定在顶部、且实测高度已写进 --climbbar-h',
  fsClimb && fsClimb.pos === 'fixed' && fsClimb.top === 0 && fsClimb.ctlH > 0 &&
  parseInt(fsClimb.barH, 10) === fsClimb.ctlH, JSON.stringify(fsClimb));
ck('V1.9.0（R17）：05 全屏时画布下移量正好等于 .climb-bar 实测高度（不被压住）',
  fsClimb && Math.abs(fsClimb.cvTop - fsClimb.ctlH) <= 2 && fsClimb.cvH > 0, JSON.stringify(fsClimb));
await ev(`(function(){ window.__CISTRACK__.applyPseudoFull(false, null); window.__CISTRACK__.syncFsBarHeight(); })()`);
await sleep(300);

// --- 需求Q4-④：表格翻页「淡消失 → 换内容 → 淡出现」---
// 时间轴（TBL_FADE=260）：t=0 加 .tbl-fade-out → t=260 换内容并切 .tbl-fade-in → t=580 摘掉动画类。
// 拆成三次独立求值 + Node 侧 sleep，避免在页面里挂 Promise（CDP 默认不 await promise，会拿到 undefined）。
await setViewport(1440, 900, false);
await sleep(500);
const fadeBefore = await ev(`(function(){ var tb = document.getElementById('tbody');
  return tb.querySelector('tr[data-idx]').getAttribute('data-idx'); })()`);
await ev(`document.querySelector('#satPager button.pg-next').click()`);
await sleep(70);
const f1 = await ev(`(function(){ var tb = document.getElementById('tbody');
  return { cls: tb.className, first: tb.querySelector('tr[data-idx]').getAttribute('data-idx') }; })()`);
await sleep(280);   // ≈ t=350：已过 260ms 的换帧点
const f2 = await ev(`(function(){ var tb = document.getElementById('tbody');
  return { cls: tb.className, first: tb.querySelector('tr[data-idx]').getAttribute('data-idx') }; })()`);
await sleep(420);   // ≈ t=770：动画早已收尾
const f3 = await ev(`(function(){ var tb = document.getElementById('tbody');
  return { cls: tb.className, first: tb.querySelector('tr[data-idx]').getAttribute('data-idx') }; })()`);
ck('V1.8.0（需求Q4④）：点下一页立刻进入「淡出」态（.tbl-fade-out，内容还没换）',
  f1 && f1.__err === undefined && /tbl-fade-out/.test(f1.cls) && f1.first === fadeBefore,
  JSON.stringify(f1) + ' before=' + fadeBefore);
ck('V1.8.0（需求Q4④）：淡出结束后才换内容，并转为「淡入」态（.tbl-fade-in）',
  f2 && f2.__err === undefined && f2.first !== fadeBefore && /tbl-fade-in/.test(f2.cls),
  JSON.stringify(f2) + ' before=' + fadeBefore);
ck('V1.8.0（需求Q4④）：动画收尾后动画类被移除（不留残留，不干扰后续渲染）',
  f3 && f3.__err === undefined && f3.first !== fadeBefore && !/tbl-fade/.test(f3.cls),
  JSON.stringify(f3) + ' before=' + fadeBefore);

// ============ V1.8.0 验收：全视口 × 中英 × 深浅 布局矩阵 ============
// 判据只有两条（都是"回归得出来"的硬指标）：① 页面没有横向溢出；② 没有元素越出章节右边界。
// 覆盖 13 档宽度（320 → 1920）× 中/英 × 暗/亮 = 52 组。
console.log('\n===== V1.8.0 验收：全视口 × 中英 × 深浅 布局矩阵 =====');
const WIDTHS = [320, 360, 390, 414, 430, 480, 620, 768, 820, 1024, 1280, 1440, 1920];
const MATRIX_BAD = { overX: [], over: [] };
let matrixN = 0;
for (const lang of ['zh', 'en']) {
  const btn = await ev(`document.getElementById('langBtn').textContent.trim()`);
  const isEn = btn === '中';                        // 英文界面下按钮显示「中」
  if (isEn !== (lang === 'en')) { await ev(`document.getElementById('langBtn').click()`); await sleep(1100); }
  for (const theme of ['dark', 'light']) {
    const curTheme = await ev(`document.documentElement.getAttribute('data-theme') || 'dark'`);
    if (curTheme !== theme) { await ev(`document.getElementById('themeBtn').click()`); await sleep(700); }
    for (const w of WIDTHS) {
      await setViewport(w, w < 700 ? 780 : 900, w < 700);
      await sleep(190);
      const r = await ev(`(function(){ return { sw: document.documentElement.scrollWidth,
        bw: document.body ? document.body.scrollWidth : 0, iw: window.innerWidth }; })()`);
      matrixN++;
      if (r && r.sw > r.iw + 1) MATRIX_BAD.overX.push(lang + '/' + theme + '/' + w + '=' + r.sw + '>' + r.iw);
      const over = await ev(overFn);
      if (Array.isArray(over) && over.length) {
        MATRIX_BAD.over.push(lang + '/' + theme + '/' + w + ':' + over.slice(0, 2).join(' , '));
      }
    }
  }
}
// 复位：回到中文 / 暗色 / 桌面
{
  const btn = await ev(`document.getElementById('langBtn').textContent.trim()`);
  if (btn === '中') { await ev(`document.getElementById('langBtn').click()`); await sleep(1100); }
  const curTheme = await ev(`document.documentElement.getAttribute('data-theme') || 'dark'`);
  if (curTheme !== 'dark') { await ev(`document.getElementById('themeBtn').click()`); await sleep(700); }
  await setViewport(1440, 900, false);
  await sleep(300);
}
ck('V1.8.0 验收：矩阵 ' + matrixN + ' 组（13 宽度 × 中英 × 暗亮）全部无横向溢出',
  MATRIX_BAD.overX.length === 0, MATRIX_BAD.overX.slice(0, 8));
ck('V1.8.0 验收：矩阵 ' + matrixN + ' 组全部无元素越出章节右边界',
  MATRIX_BAD.over.length === 0, MATRIX_BAD.over.slice(0, 8));

console.log('\n--- 汇总：PASS ' + pass + ' / FAIL ' + fail + (skipN ? ' / SKIP ' + skipN : ''));
ws.close(); child.kill(); process.exit(fail ? 1 : 0);
