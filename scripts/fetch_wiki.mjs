// 抓卫星百科词条 → 解析顶部统计 → 更新 wiki.json
// ---------------------------------------------------------------------------
// V1.7.0 二轮（需求3）：**改成零依赖**。
//   旧版 `import { chromium } from 'playwright'`，而本项目并没有 node_modules，
//   于是在本机计划任务里一跑就 `ERR_MODULE_NOT_FOUND` —— 这就是"任务天天跑却抓不到数据"
//   的第二层原因（第一层是计划任务的电池条件，见仓库里的说明）。
//   现在只用 Node 自带能力：
//     · child_process 起一个本机 Edge（headless）并开远程调试端口；
//     · 内置 fetch 取 /json/version 拿 WebSocket 地址；
//     · 内置 WebSocket（Node ≥ 22 自带）走 CDP：导航 → 轮询标题过 WAF → 取 body.innerHTML。
//   顺便也去掉了 playwright 这个重依赖对开源使用者的门槛：装了 Edge/Chrome 就能跑。
//
// 运行：node scripts/fetch_wiki.mjs
//   · 可用环境变量 EDGE_PATH 指定浏览器可执行文件；不设则自动在常见路径里找。
//   · 抓不到（WAF 不过 / 解析失败）时以非零退出码结束，方便计划任务与 CI 标红。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'wiki.json');
// V1.8.0：无头浏览器的用户数据目录默认落在 os.tmpdir()，本机 C 盘长期紧张 →
//   由环境变量 CISTRACK_TMP 指到其它盘，其次用系统 TEMP/TMP。
//   （V1.8.0 收尾：原来这里写死了某个本机盘符路径 —— 换台机器就跑不起来，
//     而且会把本机路径带进发布仓，所以一律改成环境变量驱动。）
const TMPROOT = (function () {
  const cands = [process.env.CISTRACK_TMP, process.env.TEMP, process.env.TMP];
  for (const c of cands) {
    if (!c) continue;
    try { fs.mkdirSync(c, { recursive: true }); return c; } catch (e) {}
  }
  return os.tmpdir();
})();
const PAGES = [
  ['gw', 'https://sat.huijiwiki.com/wiki/%E6%98%9F%E7%BD%91', '星网'],
  ['qf', 'https://sat.huijiwiki.com/wiki/%E5%8D%83%E5%B8%86%E6%98%9F%E5%BA%A7', '千帆星座'],
];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// ---------------------------------------------------------------- 浏览器定位
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

// ---------------------------------------------------------------- 最小 CDP 客户端
function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0; const pend = new Map();
  const ready = new Promise((res, rej) => { ws.onopen = () => res(); ws.onerror = (e) => rej(new Error('WS 连接失败')); });
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

// ---------------------------------------------------------------- 一次抓取
async function fetchArticle(url, { timeoutMs = 90000, pollMs = 2000 } = {}) {
  const exe = findBrowser();
  if (!exe) throw new Error('找不到 Edge/Chrome，请用 EDGE_PATH 环境变量指定可执行文件');
  const udd = fs.mkdtempSync(path.join(TMPROOT, 'cistrack-wiki-'));
  const portFile = path.join(udd, 'DevToolsActivePort');
  const child = spawn(exe, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--mute-audio',
    '--remote-debugging-port=0', '--user-data-dir=' + udd, '--user-agent=' + UA, 'about:blank',
  ], { stdio: 'ignore' });
  let c = null;
  try {
    // 等 Edge 把实际端口写进 DevToolsActivePort（第一行 = 端口）
    let port = 0;
    for (let i = 0; i < 100; i++) {
      await sleep(100);
      try { port = parseInt(String(fs.readFileSync(portFile, 'utf8')).split(/\r?\n/)[0], 10) || 0; } catch (e) {}
      if (port) break;
    }
    if (!port) throw new Error('浏览器没能在 10s 内启动调试端口');
    // 注意：/json/version 给的是**浏览器级** WebSocket（只支持 Browser.* 域），
    // 要操作页面必须连 /json/list 里的 **page** 目标（否则报 "Page.enable wasn't found"）。
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

    // 过 WAF：轮询标题直到不再是「请稍候…」
    const t0 = Date.now(); let ok = false;
    while (Date.now() - t0 < timeoutMs) {
      await sleep(pollMs);
      const title = await c.evalJs('document.title').catch(() => '');
      if (title && !/请稍候/.test(title)) { ok = true; break; }
    }
    if (!ok) throw new Error('词条未通过 WAF 验证（标题一直是「请稍候…」）');
    await sleep(1500);
    const html = await c.evalJs('document.body.innerHTML');
    return { html, title: await c.evalJs('document.title').catch(() => '') };
  } finally {
    // 页面级 CDP 端点没有 Browser.close，直接结束进程树即可
    try { c && c.close(); } catch (e) {}
    try { child.kill(); } catch (e) {}
    setTimeout(() => { try { fs.rmSync(udd, { recursive: true, force: true }); } catch (e) {} }, 400);
  }
}

// ---------------------------------------------------------------- 解析
// infobox 里 label 后面的 data 单元格
function cellAfter(html, label) {
  const i = html.indexOf(label);
  if (i < 0) return '';
  const j = html.indexOf('infobox-data', i);
  if (j < 0) return '';
  const k = html.indexOf('>', j) + 1;
  const e = html.indexOf('</td>', k);
  return e > k ? html.slice(k, e).trim() : '';
}
// 「试验星32+高轨业务星3+低轨业务星213」→ 英文（机械词替换，未识别的保持中文）
function toEn(zh) {
  return zh
    .replace(/试验星(\d+)/g, 'test $1').replace(/高轨业务星(\d+)/g, 'GEO service $1')
    .replace(/低轨业务星(\d+)/g, 'LEO service $1').replace(/组网星(\d+)/g, 'network $1')
    .replace(/\+/g, ' + ').replace(/，/g, ', ')
    // V1.7.0 第三轮（需求11）：词条里这些词此前没译，英文界面会直接漏出中文
    .replace(/理论值/g, 'theoretical').replace(/理论/g, 'theoretical');
}
function parseStats(html) {
  const launchedRaw = cellAfter(html, '发射卫星数量');
  const inOrbitRaw = cellAfter(html, '在轨卫星数量');
  const launches = cellAfter(html, '发射成功次数/发射总次数');
  if (!launchedRaw || !inOrbitRaw || !/\d+\/\d+/.test(launches)) return null;
  function split(raw) {
    const m = raw.match(/^(\d+)\s*[（(]([^)）]*)[)）]/);
    return { n: m ? +m[1] : parseInt(raw, 10) || 0, zh: m ? m[2].trim() : raw };
  }
  const L = split(launchedRaw), I = split(inOrbitRaw);
  return {
    launched: { n: L.n, zh: L.zh, en: toEn(L.zh) },
    inOrbit: { n: I.n, zh: I.zh, en: toEn(I.zh) },
    launches: launches.match(/\d+\/\d+/)[0],
  };
}

// ---------------------------------------------------------------- 主流程
const stats = {};
const failed = [];
for (const [key, url, article] of PAGES) {
  const { html } = await fetchArticle(url);
  const st = parseStats(html);
  if (!st) {
    const hasBox = html.includes('infobox-label');
    const dbg = hasBox
      ? html.slice(html.indexOf('infobox-label') - 60, html.indexOf('infobox-label') + 400).replace(/\s+/g, ' ')
      : '(页面里没有 infobox-label；html 长度 ' + html.length + ')';
    // V1.7.1（需求6）：**不再 throw**。
    //   旧版任何一个星座解析失败就整个脚本崩掉 → 计划任务记 FAILED → wiki.json 保持旧值。
    //   2026-10-05 00:00 那次就是这么丢的（qf 页面当时没渲染 infobox，html 只有 2151 字节，
    //   大概率是维基临时限流/改版）。改成：记下来、跳过这一个、另一个照常处理，
    //   最后只要**至少成功一个**就写文件（全失败才退出码 1）。
    console.error(key + ' 解析失败，已跳过。调试: ' + dbg);
    failed.push(key);
    continue;
  }
  stats[key] = Object.assign({ asOf: new Date().toISOString().slice(0, 10), article }, st);
  console.log(key, '→', JSON.stringify(stats[key]));
}

const old = JSON.parse(fs.readFileSync(OUT, 'utf8'));
if (!Object.keys(stats).length) {
  console.error('两个星座都没抓到，放弃更新（保留原 wiki.json）');
  process.exit(1);
}

// V1.7.1（需求6）+ V1.7.2（需求3 续）：判定「要不要写文件」的两条口径
//   ① **统计数字变了** → 必须写（这是数据本身更新了）
//   ② **数字没变，但今天已完整核对过一遍** → 也要写，只更新核对时间。
//      旧版只比数字，于是：词条内容没变（数字一模一样）→ 判定「无变化」→ 不写文件
//      → wiki.json 里的核对日期永远停在"最后一次数字变化的那天"。
//      2026-10-05 12:00 那次实际已完整读到 10-05，却因为数字没变而没写，
//      页面上"卫星百科更新"就一直显示 9-30 —— 用户看到的"数据好旧"就是这么来的。
// V1.7.2（需求3）：用户明确「**只要成功读取了全部应该读取的数据**，也应该显示这次更新的时间」——
//   所以核对时间**只在两个星座都成功读到时**才前进（failed 非空就保留旧时间，
//   否则页面会宣称"今天核对过"而其实有一个星座是失败/降级的，那是不诚实的）。
//   另外任务改为每天 00:00 与 12:00 各跑一次，只显示日期已经分不清是哪一次，
//   故新增 checkedAt（精确到时分），页面显示它。
const now = new Date();
const today = now.toISOString().slice(0, 10);
const checkedAt = now.toISOString().slice(0, 16).replace('T', ' ');   // YYYY-MM-DD HH:MM (UTC)
const oldAsOf = old.asOf || '';
const numbersSame = ['gw', 'qf'].every(k =>
  stats[k] && old[k] && old[k].launched.n === stats[k].launched.n &&
  old[k].inOrbit.n === stats[k].inOrbit.n && old[k].launches === stats[k].launches);
const fullyRead = failed.length === 0;            // 两个星座都成功读到
if (numbersSame && !(fullyRead && oldAsOf !== today)) {
  console.log('统计无变化' + (fullyRead ? '且今日已核对过' : '（本次未读全，核对时间不前进）') + '，跳过更新');
  process.exit(0);
}

stats._readme = old._readme;
stats.asOf = today;
stats.checkedAt = fullyRead ? checkedAt : (old.checkedAt || '');
fs.writeFileSync(OUT, JSON.stringify(stats, null, 1) + '\n', 'utf8');
console.log('wiki.json 已更新'
  + (numbersSame ? '（数字未变，仅更新核对时间）' : '')
  + (fullyRead ? '' : '；**未读全**（' + failed.join(',') + '），核对时间保持原值')
  + '  核对时间=' + (fullyRead ? checkedAt : (old.checkedAt || '无')));
