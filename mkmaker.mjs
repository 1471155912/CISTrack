// 从卫星百科两个词条抓「研发机构 / 研制单位」，按 COSPAR 与发射日期建索引
// → data/makers.json（供 mkdata.mjs 注入到每个批次）
// 说明：词条有 WAF，必须用真实浏览器 + --disable-blink-features=AutomationControlled，
// 且首次访问要等 20–35 秒过验证。所以这份数据是缓存，不必每次构建都跑（--force 才重抓）。
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.dirname(fileURLToPath(import.meta.url));   // 脚本所在目录（发布包内任意位置可用）
const require = createRequire('file:///x.js');
const { WebSocket } = require('ws');
const B = ROOT;

// V1.8.0 收尾：浏览器可执行文件与 profile 目录都改成**环境变量驱动**。
//   原来这里写死了本机的 `C:/Program Files (x86)/Microsoft/Edge/...` 与 `D:/tmp/...`，
//   换台机器就跑不起来，而且会把本机路径带进发布仓。
const EDGE = (function () {
  const cands = [
    process.env.CISTRACK_EDGE, process.env.EDGE_PATH,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/microsoft-edge',
    '/usr/bin/google-chrome',
  ].filter(Boolean);
  for (const c of cands) { try { if (fs.existsSync(c)) return c; } catch (e) {} }
  return 'msedge.exe';
})();
const TMPROOT = (function () {
  const cands = [process.env.CISTRACK_TMP, process.env.TEMP, process.env.TMP];
  for (const c of cands) {
    if (!c) continue;
    try { fs.mkdirSync(c, { recursive: true }); return c; } catch (e) {}
  }
  return os.tmpdir();
})();
const OUT = B + '/data/makers.json';
const PORT = 9482;
const sleep = ms => new Promise(r => setTimeout(r, ms));

if (fs.existsSync(OUT) && !process.argv.includes('--force')) {
  console.log('已有 data/makers.json（加 --force 可重抓）');
  const j = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  console.log('  条目', Object.keys(j.byCospar || {}).length, '项｜更新时间', j._fetched || '?');
  process.exit(0);
}

const ch = spawn(EDGE,
  ['--headless=new', '--disable-gpu', '--no-first-run', '--disable-blink-features=AutomationControlled',
    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    '--user-data-dir=' + path.join(TMPROOT, 'edge-profile-mkmaker'),
    '--remote-debugging-port=' + PORT, '--window-size=1600,1200', 'about:blank'], { stdio: 'ignore' });
async function wsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const b = await new Promise((res, rej) => http.get({ host: '127.0.0.1', port: PORT, path: '/json/list' },
        r => { let s = ''; r.on('data', d => s += d); r.on('end', () => res(s)); }).on('error', rej));
      const p = JSON.parse(b).find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (p) return p.webSocketDebuggerUrl;
    } catch (e) { } await sleep(400);
  }
  throw new Error('no cdp');
}
const ws = new WebSocket(await wsUrl(), { maxPayload: 4e8 });
await new Promise(r => ws.on('open', r));
let id = 0; const pend = new Map();
ws.on('message', m => { const j = JSON.parse(m.toString()); if (j.id && pend.has(j.id)) { pend.get(j.id)(j); pend.delete(j.id); } });
const send = (m, p) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
async function ev(e, aw) {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: !!aw });
  if (r.result && r.result.exceptionDetails) return { err: (r.result.exceptionDetails.exception || {}).description };
  return (r.result && r.result.result) ? r.result.result.value : null;
}
await send('Page.enable');

const PAGES = [
  ['qf', 'https://sat.huijiwiki.com/wiki/%E5%8D%83%E5%B8%86%E6%98%9F%E5%BA%A7'],
  ['gw', 'https://sat.huijiwiki.com/wiki/%E6%98%9F%E7%BD%91'],
];
const rows = [];
for (const [key, url] of PAGES) {
  await send('Page.navigate', { url: url });
  // 过验证：轮询标题，直到不是「请稍候…」
  let ok = false;
  for (let i = 0; i < 40; i++) {
    await sleep(1500);
    const ti = await ev('document.title');
    if (ti && !/请稍候/.test(ti)) { ok = true; break; }
  }
  if (!ok) { console.log(key + ' 词条没通过验证，跳过'); continue; }
  await sleep(1500);
  const got = await ev(`(function(){
    var out = [];
    document.querySelectorAll('table').forEach(function (t) {
      var trs = [...t.querySelectorAll('tr')];
      if (!trs.length) return;
      var head = [...trs[0].children].map(function (c) { return (c.innerText || '').trim().replace(/\\s+/g, ''); });
      var iMk = head.findIndex(function (h) { return /研发机构|研制单位/.test(h); });
      var iCos = head.findIndex(function (h) { return /COSPAR/i.test(h); });
      var iDate = head.findIndex(function (h) { return /发射日期|发射时间/.test(h); });
      var iName = head.findIndex(function (h) { return /中文名|名称/.test(h); });
      var iSite = head.findIndex(function (h) { return /发射基地|发射地点|发射场/.test(h); });
      if (iMk < 0 || (iCos < 0 && iDate < 0)) return;
      trs.slice(1).forEach(function (tr) {
        var cs = [...tr.children];
        if (cs.length <= iMk) return;
        var cell = cs[iMk];
        var a = cell.querySelector('a');
        var maker = (cell.innerText || '').trim().replace(/\\s+/g, '');
        var aList = [].slice.call(cell.querySelectorAll('a')).map(function (x) {
          return { n: (x.innerText || '').trim(), u: x.getAttribute('href') || '' };
        }).filter(function (x) { return x.n && x.u; });
        if (!maker) return;
        out.push({
          maker: maker,
          url: a ? a.getAttribute('href') : '',
          links: aList,
          cospar: iCos >= 0 && cs[iCos] ? (cs[iCos].innerText || '').trim().replace(/\\s+/g, '') : '',
          date: iDate >= 0 && cs[iDate] ? (cs[iDate].innerText || '').trim().replace(/\\s+/g, '') : '',
          site: iSite >= 0 && cs[iSite] ? (cs[iSite].innerText || '').trim().replace(/\\s+/g, ' ') : '',
          siteUrl: (iSite >= 0 && cs[iSite] && cs[iSite].querySelector('a')) ? cs[iSite].querySelector('a').getAttribute('href') : '',
          name: iName >= 0 && cs[iName] ? (cs[iName].innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 60) : '',
          grp: '${key}'
        });
      });
    });
    return JSON.stringify(out);
  })()`, true);
  const arr = JSON.parse(got || '[]');
  console.log(key + ' 抓到 ' + arr.length + ' 行');
  rows.push(...arr);
}
const byCospar = {}, byDate = {}, bySite = {};
for (const r of rows) {
  let c = (r.cospar || '').replace(/[^0-9-]/g, '');
  if (c) {
    const m = c.match(/^(\d{4})-(\d{1,4})/);
    if (m) c = m[1] + '-' + m[2];
    if (c && !byCospar[c]) byCospar[c] = { maker: r.maker, url: r.url, links: r.links || [] };
  }
  if (r.site && r.siteUrl) {
    if (!bySite[r.site]) bySite[r.site] = { u: r.siteUrl };
    const k1 = String(r.site).split(/\s/)[0];
    if (k1 && !bySite[k1]) bySite[k1] = { u: r.siteUrl };
  }
  const d = (r.date || '').match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (d) {
    const k = d[1] + '-' + ('0' + d[2]).slice(-2) + '-' + ('0' + d[3]).slice(-2);
    if (!byDate[k]) byDate[k] = { maker: r.maker, url: r.url, links: r.links || [] };
  }
}
fs.writeFileSync(OUT, JSON.stringify({
  _fetched: new Date().toISOString(), _src: PAGES.map(p => p[1]),
  byCospar: byCospar, byDate: byDate, bySite: bySite, raw: rows
}, null, 1), 'utf8');
console.log('写入', OUT, fs.statSync(OUT).size, 'bytes');
console.log('COSPAR 索引', Object.keys(byCospar).length, '项｜日期索引', Object.keys(byDate).length, '项｜发射场索引', Object.keys(bySite).length, '项');
console.log('样例:', Object.keys(byCospar).slice(0, 12).map(k => k + '=' + byCospar[k].maker).join(' | '));
ws.close(); ch.kill(); process.exit(0);
