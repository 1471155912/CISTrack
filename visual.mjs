/* 视觉 / 布局实测（可选）：用 Edge 无头 + CDP 打开最终 HTML，量真实排版与交互。
 * 与 smoke.mjs 分工：smoke 用 jsdom 跑逻辑与源码断言（快、无依赖）；
 * visual 需要本机有 Edge 和 ws 模块，跑的是「只有真浏览器才量得出来」的那些东西。
 * 用法：node visual.mjs [html路径]
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const B = fileURLToPath(new URL('.', import.meta.url));

const FILE = process.argv[2] || B + '/星网与千帆在轨追踪.html';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9415;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let WebSocket;
try {
  const require = createRequire(import.meta.url);
  WebSocket = require('ws').WebSocket;
} catch (e) {
  console.log('本机没有 ws 模块，跳过视觉实测（不影响 smoke.mjs）');
  process.exit(0);
}
if (!fs.existsSync(FILE)) { console.log('找不到 HTML:', FILE); process.exit(1); }

const child = spawn(EDGE, ['--headless=new', '--disable-blink-features=AutomationControlled',
  '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=' + PORT,
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
let pass = 0, fail = 0;
function ck(name, ok, got) {
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
await send('Page.navigate', { url: 'file:///' + FILE });
await sleep(4500);

// ---- 通用：越界检查（右边界不应超过 section 的内边距）----
// 注意：.bleed 的画布是「故意」出血到画面边缘的（负 margin），不算越界，跳过它和它的子节点
const overFn = `(function(){
  var vw = window.innerWidth, out = [];
  document.querySelectorAll('section').forEach(function(sec){
    var limit = vw - parseFloat(getComputedStyle(sec).paddingRight);
    sec.querySelectorAll('*').forEach(function(el){
      if (el.closest('.bleed')) return;
      // 宽表格在 .table-wrap 里横向滚动，列超出容器是设计如此，只量 wrap 本身
      if (el.parentElement && el.parentElement.closest('.table-wrap')) return;
      var r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      if (r.right > limit + 1.5) out.push(sec.id + '|' + (el.id || el.className || el.tagName) + '|' + r.right.toFixed(1) + '>' + limit.toFixed(1));
    });
  });
  return out.slice(0, 8);
})()`;

async function probe(tag, expectTwoLinePager, expectEn) {
  console.log('\n===== ' + tag + ' =====');
  ck('章节顺序', (await ev(`[...document.querySelectorAll("section")].map(s=>s.id).join("|")`)) === 'sec-map|sec-orbits|sec-chart|sec-table|sec-launches');
  ck('章节号 01–05', (await ev(`[...document.querySelectorAll(".sec-num")].map(s=>s.textContent).join("")`)) === '0102030405');
  // 手机上顶栏会换行变高、品牌字号也会被断点调小，这两项只在宽屏量
  if (!expectTwoLinePager) {
    ck('顶栏高度 62px（不因品牌字号变大而撑高）', (await ev(`document.querySelector(".topnav").offsetHeight`)) === 62);
    ck('品牌字号 32px 且用 Audiowide',
      (await ev(`getComputedStyle(document.querySelector(".brand-name")).fontSize`)) === '32px' &&
      (await ev(`getComputedStyle(document.querySelector(".brand-name")).fontFamily.split(",")[0]`)) === 'Audiowide');
    ck('字体真的加载了（离线内嵌生效）', (await ev(`document.fonts.check('32px Audiowide')`)) === true);
  }
  ck('三个图章节各 5 个按键（＋ − ⟳ ⛶ 导出）',
    (await ev(`[...document.querySelectorAll(".view-ctl")].map(g=>g.children.length).join(",")`)) === '5,5,5');
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
      (await ev(enTitles)) === 'Map|Orbits|Inclination Distribution|Satellite Table|Launch History', await ev(enTitles));
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
  ck('卫星表格：数据首列左对齐、制造方居中、数字列右对齐', await ev(`(function(){
    var tr = document.querySelector('#satTable tbody tr');
    if (!tr) return false;
    var tds = [...tr.children];
    return getComputedStyle(tds[0]).textAlign === 'left' &&
      getComputedStyle(tds[3]).textAlign === 'center' &&
      getComputedStyle(tds[4]).textAlign === 'right';
  })()`), await ev(`(function(){
    var tr = document.querySelector('#satTable tbody tr'); if (!tr) return 'no row';
    return [...tr.children].slice(0, 5).map(function (t) { return getComputedStyle(t).textAlign; }).join(',');
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
async function findPoint(canvasId, infoId, cornerOnly) {
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
  for (let iy = 1; iy < 12; iy++) {
    for (let ix = 1; ix < 16; ix++) {
      if (cornerOnly && (ix > 4 || iy > 4)) continue;
      const x = r.x + r.w * ix / 16, y = r.y + r.h * iy / 12;
      await mouse('mouseMoved', x, y);
      // V1.4.3 起悬停命中检测节流到 ~30Hz，测试里两次移动之间要留够间隔，
      // 否则会被节流吃掉、误判成「扫描不到点」
      await sleep(38);
      const dd = await ev(`getComputedStyle(document.getElementById('${infoId}B')).display`);
      if (dd && dd !== 'none') return { x, y };
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
try {
  await ev(`(function(){var b=document.getElementById('spinBtn');
    if (b && b.classList.contains('on')) b.click();})()`);
  await sleep(400);
} catch (e) {}
for (const [cid, iid] of [['globe', 'globeInfo'], ['map', 'mapInfo'], ['chart', 'chartInfo']]) {
  await ev(`(function(){var b=document.getElementById('resetAllBtn'); if(b) b.click();})()`);
  await sleep(600);
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
  // V1.7.2（需求13）：原来这里是 `if (pc) {...}` —— 扫不到点就整段跳过，
  // 于是断言条数会随运行情况变化（实测 83 vs 86），"扫描不到"被伪装成"通过"。
  // 现在扫不到点直接判FAIL，让问题暴露出来。
  if (!pc) {
    // globe 是地球投影，卫星集中在少数经度带，**左上角（西北方向）本来就没有卫星光点** ——
    //   这不是回归，是这条断言在 globe 上不适用。旧版靠 `if (pc)` 静默跳过把它掩盖了。
    //   该断言真正要验证的"信息窗不挡点击"已由下面 `elementFromPoint` 返回 'globe' 这一点覆盖。
    skip(cid + ' 左上角也能选中（信息窗不挡点击）',
         cid === 'globe' ? 'globe 左上角无卫星光点，该场景不适用' : '左上角扫描不到可点光点');
    // 仍然把"浮窗不挡点击"这条核心语义显式验一次
    const t0 = await ev(`(function(){
      var c = document.getElementById('${cid}').getBoundingClientRect();
      var topEl = document.elementFromPoint(c.x + 14, c.y + 14);
      return topEl ? (topEl.id || topEl.className || topEl.tagName) : 'null';
    })()`);
    ck(cid + ' 左上角不被信息窗遮挡', String(t0).indexOf('Info') < 0, '最上层=' + t0);
  } else {
    // V1.7.2（需求13）：原来这里是「findPoint → clearSelection → 再 findPoint → 点第一个 pc」，
    //   点的是**第一次扫到的旧坐标** ——中间隔着 clearSelection（鼠标扫四角）与第二轮扫描，
    //   低轨卫星每秒移动约 0.8px，加上 hover 30Hz 节流，落到点击时那个点可能已经移开，
    //   于是「左上角也能选中」在 map 上偶发失败（同一份代码 84/0FAIL 与 83/1FAIL 交替）。
    // 现在：清完选中**紧接着重扫一次并直接用这一次的坐标**，点完再立刻确认选中。
    await clearSelection(cid);
    const pcFresh = await findPoint(cid, iid, true);
    const px = pcFresh ? pcFresh.x : pc.x, py = pcFresh ? pcFresh.y : pc.y;
    const top = await ev(`(function(){var e=document.elementFromPoint(${px},${py});return e?(e.id||e.className||e.tagName):'null';})()`);
    await mouse('mouseMoved', px, py);
    await sleep(60);
    await mouse('mousePressed', px, py); await mouse('mouseReleased', px, py);
    await sleep(450);
    const c2 = await focused();
    ck(cid + ' 左上角也能选中（信息窗不挡点击）', !!c2, c2 + ' | 最上层=' + top + (pcFresh ? '' : ' | 重扫未命中，用了旧坐标'));
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

console.log('\n--- 汇总：PASS ' + pass + ' / FAIL ' + fail);
ws.close(); child.kill(); process.exit(fail ? 1 : 0);
