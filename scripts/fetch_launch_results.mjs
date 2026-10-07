// 抓卫星百科「引导页:发射记录/<年份>」→ 提取星网 / 千帆每一次发射的任务结果与颗数
// ---------------------------------------------------------------------------
// V1.8.0（需求12 / Q6）：发射历史表要加「任务结果」列，口径 = 卫星百科的记载。
//   · 词条「星网」「千帆星座」只给总数（40/41、19/19），逐次发射的结果要到
//     https://sat.huijiwiki.com/wiki/引导页:发射记录/<年份> 查（最后写的年份 = 那一年的全球发射记录）。
//   · 本脚本与 fetch_wiki.mjs 同一套零依赖 CDP 链路（Edge headless 过 WAF），零 npm 依赖。
//   · 抓取范围 = 本项目 launch 台账里出现过的年份（2019 / 2021 / 2023 / 2024 / 2025 / 2026），
//     只保留 COSPAR 编号能对上台账的行，输出 build 用的 wiki_launches.json。
//
// 用法：node scripts/fetch_launch_results.mjs [--dump]
//   · --dump  额外把每个匹配行的原始文本打印出来（人工核对解析用）
//   · 输出：<ROOT>/wiki_launches.json；两个以上年份全失败 → 退出码 1（计划任务标红），
//     只要有任意一年成功就写文件（与 fetch_wiki.mjs 的容错口径一致）。
//   · 结果码：ok = 成功/圆满成功，part = 部分成功，fail = 失败/失利；抓不到记 "?"。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'wiki_launches.json');
const SATDATA = path.join(ROOT, 'build', 'satdata.json');
const DUMP = process.argv.includes('--dump');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
// V1.8.0：无头浏览器的用户数据目录默认落在 os.tmpdir()，本机 C 盘长期紧张 →
//   由环境变量 CISTRACK_TMP 指到其它盘，其次用系统 TEMP/TMP。
//   （V1.8.0 收尾：原来这里写死了某个本机盘符路径，已改为环境变量驱动。）
const TMPROOT = (function () {
  const cands = [process.env.CISTRACK_TMP, process.env.TEMP, process.env.TMP];
  for (const c of cands) {
    if (!c) continue;
    try { fs.mkdirSync(c, { recursive: true }); return c; } catch (e) {}
  }
  return os.tmpdir();
})();

// 台账里出现过的年份（从 satdata.json 的 launches 键自动推导；读不到就用这份兜底）
const FALLBACK_YEARS = [2019, 2021, 2023, 2024, 2025, 2026];
function ledgerYears() {
  try {
    const sd = JSON.parse(fs.readFileSync(SATDATA, 'utf8'));
    const ys = new Set();
    ['gw', 'qf'].forEach(k => {
      Object.keys((sd[k] || {}).launches || {}).forEach(key => ys.add(2000 + +key.slice(0, 2)));
    });
    return [...ys].sort();
  } catch (e) { return FALLBACK_YEARS; }
}
// 台账 COSPAR 前缀集合：'26210' → '2026-210'
function ledgerPrefixes() {
  const out = new Set();
  try {
    const sd = JSON.parse(fs.readFileSync(SATDATA, 'utf8'));
    ['gw', 'qf'].forEach(k => {
      Object.keys((sd[k] || {}).launches || {}).forEach(key => out.add('20' + key.slice(0, 2) + '-' + key.slice(2)));
    });
  } catch (e) {}
  return out;
}

// ---------------------------------------------------------------- 浏览器定位（与 fetch_wiki.mjs 相同）
function findBrowser() {
  const cands = [
    process.env.CISTRACK_EDGE,
    process.env.EDGE_PATH,
    process.env.CHROME_PATH,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/microsoft-edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ].filter(Boolean);
  for (const c of cands) { try { if (fs.existsSync(c)) return c; } catch (e) {} }
  return null;
}

// ---------------------------------------------------------------- 最小 CDP 客户端（与 fetch_wiki.mjs 相同）
function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0; const pend = new Map();
  const ready = new Promise((res, rej) => { ws.onopen = () => res(); ws.onerror = () => rej(new Error('WS 连接失败')); });
  ws.onmessage = (m) => {
    let d; try { d = JSON.parse(m.data); } catch (e) { return; }
    if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id;
    pend.set(i, (d) => d.error ? rej(new Error(method + ': ' + (d.error.message || JSON.stringify(d.error)))) : res(d.result || {}));
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('页面内报错: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || ''));
    return r.result ? r.result.value : undefined;
  };
  return { ready, send, evalJs, close: () => { try { ws.close(); } catch (e) {} } };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchArticle(url, { timeoutMs = 90000, pollMs = 2000 } = {}) {
  const exe = findBrowser();
  if (!exe) throw new Error('找不到 Edge/Chrome，请用 EDGE_PATH 环境变量指定可执行文件');
  const udd = fs.mkdtempSync(path.join(TMPROOT, 'cistrack-launch-'));
  const portFile = path.join(udd, 'DevToolsActivePort');
  const child = spawn(exe, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--mute-audio',
    '--remote-debugging-port=0', '--user-data-dir=' + udd, '--user-agent=' + UA, 'about:blank',
  ], { stdio: 'ignore' });
  let c = null;
  try {
    let port = 0;
    // V1.8.0：本机偶发「浏览器没能在 10s 内启动调试端口」（与残留 msedge 进程争抢有关）→
    //   等待窗口放宽到 30s，并在主流程里对整年做重试。
    for (let i = 0; i < 300; i++) {
      await sleep(100);
      try { port = parseInt(String(fs.readFileSync(portFile, 'utf8')).split(/\r?\n/)[0], 10) || 0; } catch (e) {}
      if (port) break;
    }
    if (!port) throw new Error('浏览器没能在 30s 内启动调试端口');
    let page = null;
    for (let i = 0; i < 50; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        page = list.find((t) => t.type === 'page') || list[0];
      } catch (e) {}
      if (page && page.webSocketDebuggerUrl) break;
      await sleep(100);
    }
    if (!page || !page.webSocketDebuggerUrl) throw new Error('拿不到页面调试目标');
    c = cdp(page.webSocketDebuggerUrl);
    await c.ready;
    await c.send('Page.enable'); await c.send('Runtime.enable');
    await c.send('Page.navigate', { url });
    const t0 = Date.now(); let ok = false;
    while (Date.now() - t0 < timeoutMs) {
      await sleep(pollMs);
      const title = await c.evalJs('document.title').catch(() => '');
      if (title && !/请稍候/.test(title)) { ok = true; break; }
    }
    if (!ok) throw new Error('发射记录页未通过 WAF 验证（标题一直是「请稍候…」）');
    await sleep(1500);
    // 直接在页面里把行抽成纯文本数组：每行 = [COSPAR, 整行文本]，省掉在 Node 侧切 HTML。
    const rows = await c.evalJs(`(() => {
      const out = [];
      document.querySelectorAll('tr').forEach(tr => {
        const txt = (tr.innerText || tr.textContent || '').replace(/\\s+/g, ' ').trim();
        if (!txt || txt.length > 600) return;
        // COSPAR 序号是 3 位零填充（2019-077A）；页面里可能写成 2019-77A，统一补齐到 3 位再对台账
        const m = txt.match(/\\b(\\d{4})-(\\d{1,3})\\s?[A-Z]?\\b/);
        if (!m) return;
        out.push([m[1] + '-' + String(+m[2]).padStart(3, '0'), txt]);
      });
      return out;
    })()`);
    const title = await c.evalJs('document.title').catch(() => '');
    return { rows: rows || [], title };
  } finally {
    try { c && c.close(); } catch (e) {}
    try { child.kill(); } catch (e) {}
    setTimeout(() => { try { fs.rmSync(udd, { recursive: true, force: true }); } catch (e) {} }, 400);
  }
}

// ---------------------------------------------------------------- 结果解析
// 行文本里找结果。卫星百科发射记录表的结果列常见写法：
//   成功 / 圆满成功 / 失败 / 发射失败 / 部分成功 / 失利 / 部分失败 / 待观测…
function resultOf(text) {
  if (/部分成功|部分失败/.test(text)) return 'part';
  if (/失败|失利/.test(text)) return 'fail';
  if (/成功/.test(text)) return 'ok';          // 成功 / 圆满成功 / 完全成功
  return '?';                                   // 没写结果（有的是待观测）→ 交由构建端标「—」
}
// 行文本里找「这一发载了多少颗」：常见写法「10颗卫星」「卫星×8」「（4 颗）」。
// 抓不到就返回 null —— 页面端规则：没有对应数字就不加（Q5 口径），不猜。
function countOf(text) {
  // 卫星百科的写法不统一：「携带10颗」「10颗卫星」「卫星×8」「（共18颗）」「（4 颗）」…
  // 只要句子里出现「数字 + 颗」就采信（颗数是这一发入轨的载荷数）。
  let m = text.match(/(\d{1,3})\s*颗/);
  if (!m) return null;
  const n = +m[1];
  return (n >= 1 && n <= 500) ? n : null;
}

// ---------------------------------------------------------------- 主流程
const years = ledgerYears();
const prefixes = ledgerPrefixes();
console.log('台账年份: ' + years.join(','));
console.log('台账 COSPAR 前缀: ' + prefixes.size + ' 个');

const found = {};        // '2026-210' → { res, n, raw }
const failedYears = [];
for (const y of years) {
  const url = 'https://sat.huijiwiki.com/wiki/' + encodeURIComponent('引导页:发射记录/' + y);
  let got = null, lastErr = null;
  for (let attempt = 1; attempt <= 3 && !got; attempt++) {          // V1.8.0：逐年重试 3 次
    try { got = await fetchArticle(url); }
    catch (e) { lastErr = e; if (attempt < 3) await sleep(2500); }
  }
  if (!got) {
    console.error(y + ' 年抓取失败（3 次）：' + (lastErr && lastErr.message));
    failedYears.push(y);
    continue;
  }
  let hit = 0;
  got.rows.forEach(([cos, txt]) => {
    if (!prefixes.has(cos) || found[cos]) return;
    found[cos] = { res: resultOf(txt), n: countOf(txt), raw: txt.slice(0, 160) };
    hit++;
    if (DUMP) console.log('  [' + cos + '] ' + txt);
  });
  console.log(y + ' 年：页面行 ' + got.rows.length + '，匹配台账 ' + hit);
  if (!got.rows.length) failedYears.push(y);                        // 页面拿到但一行都没解析出来也算未读全
}

const hits = Object.keys(found).length;
if (!hits) {
  console.error('一个年份都没匹配到台账记录，放弃更新（保留原 wiki_launches.json）');
  process.exit(1);
}

const now = new Date();
const out = {
  _readme: '星网/千帆逐次发射的任务结果（来源：卫星百科「引导页:发射记录/<年>」，res: ok=成功 part=部分成功 fail=失败 ?=未记载；n=该发颗数（页面没写就不记）。由 scripts/fetch_launch_results.mjs 自动更新。',
  asOf: now.toISOString().slice(0, 10),
  checkedAt: now.toISOString().slice(0, 16).replace('T', ' '),
  launches: {},
};
// 旧文件里已有、这次没抓到的条目保留（比如某年页面临时抽风），但要带上一次的核对时间避免误导读数
let old = {};
try { old = JSON.parse(fs.readFileSync(OUT, 'utf8')).launches || {}; } catch (e) {}
Object.keys(found).forEach(k => {
  const f = found[k];
  out.launches[k] = { res: f.res, n: f.n || undefined };
});
Object.keys(old).forEach(k => {
  if (!out.launches[k]) out.launches[k] = Object.assign({ _stale: true }, old[k]);
});

fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n', 'utf8');
console.log('wiki_launches.json 已更新：台账匹配 ' + hits + '/' + prefixes.size +
  '，核对时间=' + out.checkedAt +
  (failedYears.length ? '；**未读全**（' + failedYears.join(',') + '）' : ''));
const miss = [...prefixes].filter(k => !out.launches[k]);
if (miss.length) console.log('未匹配到结果的台账条目(' + miss.length + ')：' + miss.join(', '));
