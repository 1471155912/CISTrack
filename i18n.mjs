// CISTrack 国际化（i18n）全量审计 —— V1.8.0（需求15）
// 目的：把「键漏定义 / 键写错了 / 死键 / 英文侧漏中文」这四类问题一次性揪出来，
//   并作为回归守卫长期留在仓库里（npm run i18n）。
// 做法：
//   ① 静态：模板里所有 data-i18n* 的键、app.js 里所有 t('key') 的键 → 必须都在 I18N 表里；
//   ② 静态：I18N 每条必须是 [zh, en] 两元组；en 侧不得含 CJK；
//   ③ 静态：I18N 里定义但全项目都没引用的键 → 打印为「死键」（只报告，不判失败）；
//   ④ 运行时：用 jsdom 跑真页面 → 切到英文 → 把所有可见文本节点里的 CJK 抄出来，
//      与白名单（专有名词 / 数据原文 / 站点署名）比对，白名单外的即为漏译。
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require('jsdom');

const B = fileURLToPath(new URL('.', import.meta.url));
const FILE = process.env.I18N_HTML || (B + '/星网与千帆在轨追踪.html');
const html = fs.readFileSync(FILE, 'utf8');
const tpl = fs.readFileSync(B + '/template.html', 'utf8');
const appSrc = fs.readFileSync(B + '/app.js', 'utf8');

let fails = 0;
function ok(label, cond, extra) {
  console.log((cond ? 'PASS ' : 'FAIL ') + label + (extra !== undefined && extra !== '' ? '  → ' + extra : ''));
  if (!cond) fails++;
}
function info(label) { console.log('INFO ' + label); }

// ---------------------------------------------------------------- jsdom 装载
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + ((e.detail && (e.detail.stack || e.detail.message)) || e.message)));
function makeCtx() {
  const calls = { stroke: 0, fill: 0, fillText: 0, arc: 0, clearRect: 0 };
  return new Proxy({}, {
    get(t, k) {
      if (k === 'measureText') return () => ({ width: 24 });
      if (k === '__calls') return calls;
      if (k in calls) return () => { calls[k]++; };
      return () => {};
    },
    set() { return true; }
  });
}
let w;
const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc,
  beforeParse(window) {
    w = window;
    window.HTMLCanvasElement.prototype.getContext = function () {
      if (!this.__ctx) this.__ctx = makeCtx();
      return this.__ctx;
    };
    window.HTMLCanvasElement.prototype.toBlob = function (cb) { cb(null); };
    window.Element.prototype.getBoundingClientRect = function () {
      var h = (this.tagName === 'TR') ? 41 : 460;
      return { left: 0, top: 0, x: 0, y: 0, width: 900, height: h, right: 900, bottom: h };
    };
    window.scrollTo = () => {}; window.scrollBy = () => {};
    Object.defineProperty(window, 'innerHeight', { value: 4000, configurable: true });
    Object.defineProperty(window, 'innerWidth', { value: 1400, configurable: true });
    window.addEventListener('error', e => errors.push('window.error: ' + e.message));
  }
});
const d = dom.window.document;
const $ = s => d.querySelector(s);
await new Promise(r => setTimeout(r, 500));

// ---------------------------------------------------------------- ① I18N 表
// 取法：直接从 app.js 源码里把 `var I18N = { ... };` 抠出来求值。
//   为什么不用 window.I18N —— jsdom 里实测拿不到（本机同一份产物 smoke 也从不读 app 全局，
//   只用正则 + DOM）。静态提取不依赖运行环境，且在 Node 里就能跑，更快更稳；
//   下面再用「模板/JS 引用的键必须都在表里」做闭环，等价于运行时校验。
function extractObjLiteral(src, head) {
  const at = src.indexOf(head);
  if (at < 0) return null;
  let i = at + head.length;                 // 指向 '{'
  let depth = 0, q = null, out = '';
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (q) {
      out += c;
      if (c === '\\') { out += n; i++; continue; }
      if (c === q) q = null;
      continue;
    }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { q = c; out += c; continue; }
    if (c === '{') depth++;
    if (c === '}') { depth--; out += c; if (depth === 0) break; continue; }
    out += c;
  }
  return out;
}
let I18N = null;
try {
  const lit = extractObjLiteral(appSrc, 'var I18N = ');
  I18N = lit ? new Function('return (' + lit + ');')() : null;
} catch (e) { I18N = null; }
ok('能从 app.js 源码里提取并求值 I18N 表', !!I18N && typeof I18N === 'object',
  'typeof window.I18N = ' + typeof w.I18N + ' / typeof window.S = ' + typeof w.S);
const keys = Object.keys(I18N || {});
info('I18N 键总数 = ' + keys.length);

// ② 每条必须是 [zh, en] 且 en 不含 CJK
const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3000-\u303F\uFF00-\uFFEF]/;
// 英文侧**故意为空**的键：英文句子把开头的量词挪到了后半句，于是前缀键为空字符串。
//   逐条列在这里（而不是放宽成"允许空串"），任何新增的空串仍会被抓出来。
const EN_EMPTY_OK = new Set(['d_tbl_foot_1']);
const bad = [];
const enCjk = [];
const enEmpty = [];
keys.forEach(k => {
  const p = I18N[k];
  if (!Array.isArray(p) || p.length !== 2) { bad.push(k); return; }
  if (typeof p[0] !== 'string' || typeof p[1] !== 'string') { bad.push(k + '(非字符串)'); return; }
  if (!p[0].length) bad.push(k + '(zh 空)');
  if (!p[1].length && !EN_EMPTY_OK.has(k)) enEmpty.push(k);
  if (CJK.test(p[1])) enCjk.push(k + ' = ' + p[1]);
});
ok('I18N 每条都是 [zh, en] 两元字符串，且 zh 均非空', bad.length === 0, bad.join(', '));
ok('I18N 的英文侧不为空（白名单：' + [...EN_EMPTY_OK].join(', ') + '）', enEmpty.length === 0, enEmpty.join(', '));
ok('I18N 的英文侧零 CJK 字符', enCjk.length === 0, enCjk.join(' | '));

// ---------------------------------------------------------------- ③ 键引用闭环
// 模板侧：data-i18n / data-i18n-title / data-i18n-ph
const tplKeys = new Set();
tpl.replace(/data-i18n(?:-title|-ph)?="([^"]+)"/g, (m, k) => { tplKeys.add(k); return m; });
// JS 侧：t('key') 与 t("key")
const jsKeys = new Set();
appSrc.replace(/\bt\(\s*'([A-Za-z0-9_]+)'\s*\)/g, (m, k) => { jsKeys.add(k); return m; });
const used = new Set([...tplKeys, ...jsKeys]);
const missingTpl = [...tplKeys].filter(k => !(k in (I18N || {})));
const missingJs = [...jsKeys].filter(k => !(k in (I18N || {})));
ok('模板里 data-i18n* 引用的键全部有定义', missingTpl.length === 0, missingTpl.join(', '));
ok("app.js 里 t('key') 引用的键全部有定义", missingJs.length === 0, missingJs.join(', '));
info('模板引用键 = ' + tplKeys.size + ' / JS 引用键 = ' + jsKeys.size + ' / 并集 = ' + used.size);

// 死键：定义了但全项目都没引用（注意有些键是由拼出来的名字驱动的，例如 h_ + view，
//   这类会出现在下一条白名单里，避免误报）。
const DYNAMIC = /^h_|^lead_|^d_def|^fs_|^res_|^nm_|^l_|^t_|^b_|^c_|^d_|^kv_|^cn_/;
const dead = keys.filter(k => !used.has(k) && !tplKeys.has(k) && !jsKeys.has(k));
info('未被静态引用的键（' + dead.length + '）：' + (dead.length ? dead.filter(k => !DYNAMIC.test(k)).join(', ') || '(全部命中动态前缀白名单)' : '无'));

// ---------------------------------------------------------------- ④ 运行时英文化
const langBtn = $('#langBtn');
langBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));   // zh → en
await new Promise(r => setTimeout(r, 900));
ok('切换到英文后页面无脚本错误', errors.length === 0, errors.slice(0, 2).join(' | '));
// 语言按钮显示的是「切过去的那个语言」：zh 态显示 EN、en 态显示 中 —— 用它确认当前语言
ok('切换后语言按钮显示「中」（确实处于英文界面）', langBtn.textContent === '中', langBtn.textContent);

// 把所有可见文本节点里的 CJK 抄出来。
//   排除：
//     · script/style/noscript —— 不是界面文案；
//     · #loadMask —— 启动遮罩（英文态下已撤除，内容无意义）；
//     · #readmeMask —— 说明弹窗默认隐藏，由 ensureReadmeOpen() 单独打开后再扫；
//     · #langBtn —— 语言按钮显示的是"点下去会切到的那门语言"（英文态显示「中」），属正常；
//     · 「小橙子的宇宙」—— 站点署名的专有名词，英文界面按惯例保留中文原名。
const ACCEPT = [
  /小橙子的宇宙/,                 // 站点署名（专有名词）
  /星网与千帆在轨追踪\.html/,      // 说明里写死的**真实文件名**，不能翻译
  /^[\s·—\-–—|/()（）]+$/
];
const found = [];
function walk(node, path, skipIds) {
  if (node.nodeType === 3) {
    const t = node.nodeValue;
    if (t && CJK.test(t) && !ACCEPT.some(re => re.test(t.trim()))) {
      found.push((path || '?') + ' :: ' + t.trim().replace(/\s+/g, ' ').slice(0, 90));
    }
    return;
  }
  if (node.nodeType !== 1) return;
  const tag = node.tagName.toLowerCase();
  if (tag === 'script' || tag === 'style' || tag === 'noscript') return;
  if (node.id && skipIds.has(node.id)) return;
  if (node.id === 'langBtn') return;                 // 语言按钮：显示"切过去的语言"
  const cls = '.' + (node.className || '').toString().split(/\s+/).filter(Boolean).join('.');
  const id = node.id ? '#' + node.id : '';
  const p = path + tag + id + (cls === '.' ? '' : cls);
  for (const c of node.childNodes) walk(c, p, skipIds);
}
function scanBody(skipIds, label) {
  const before = found.length;
  walk(d.body, '', skipIds);
  info(label + '：新增 ' + (found.length - before) + ' 条');
}
// 第 1 遍：英文态首页整屏
scanBody(new Set(['loadMask', 'readmeMask']), '英文态首页');

// 第 2 遍：选中一颗卫星（信息窗 A 窗 / 浮窗 / 目录名 / 发射日期等都在这里才出现）
const tr = $('#tbody tr[data-idx]');
if (tr) { tr.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); await new Promise(r => setTimeout(r, 300)); }
scanBody(new Set(['loadMask', 'readmeMask']), '英文态 + 选中卫星');

// 第 3 遍：打开「说明」弹窗（正文最长，最容易漏译）
const rmBtn = $('#readmeBtn');
if (rmBtn) { rmBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); await new Promise(r => setTimeout(r, 300)); }
scanBody(new Set(['loadMask']), '英文态 + 说明弹窗');
if (rmBtn) { rmBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); await new Promise(r => setTimeout(r, 300)); }

// 第 4 遍：切到千帆（另一套数据/文案，可能有只在蓝星座出现的字符串）
const qfBtn = $('.constel button[data-c="qf"]');
if (qfBtn) { qfBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); await new Promise(r => setTimeout(r, 1200)); }
scanBody(new Set(['loadMask', 'readmeMask']), '英文态 + 千帆星座');

ok('英文界面可见文本里没有漏译的中文', found.length === 0, found.slice(0, 12).join('\n      '));
if (found.length > 12) info('（另有 ' + (found.length - 12) + ' 条同上，省略）');

console.log('--- 汇总 ---');
console.log(fails === 0 ? 'i18n 审计全部通过（0 失败）' : 'i18n 审计失败 ' + fails + ' 项');
process.exit(fails === 0 ? 0 : 1);
