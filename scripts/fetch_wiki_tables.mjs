/* fetch_wiki_tables.mjs —— ★ V1.9.5（H9）：**百科单源**抓取器
 * ---------------------------------------------------------------------------
 * 为什么要有这个文件（H9 = 数据正确性"重大问题"）：
 *   百科来源的表格有错漏，根因是**同一批词条表被多个脚本各抓各的、口径还不一致**：
 *     · `scripts/fetch_launch_results.mjs` 抓「引导页:发射记录」→ 日期是 **UTC**（记 10-09）；
 *     · `mkmanufacturers.mjs` 抓「星网/千帆星座」词条表 → 日期是 **GMT+8 且带时刻**（10-10 03:27）；
 *   两者描的是同一次发射，页面却可能显示两个日期。新批次（如 2026-230）被自动补录时取了
 *   UTC 那个 → **日期错一天**。
 *
 * 单源口径（一次抓取、一处落盘、多处消费）：
 *   · 抓「星网」「千帆星座」两个词条里的发射记录表（与 mkmanufacturers 原来的同一些表）；
 *   · 产出 `data/wiki_tables.json`（**进 git**，CI 也读它 —— 与 wiki.json / wiki_launches.json 同地位）：
 *       { _fetched, _src, gw: { '2026-230': { name, d8, t8, ms8, site, siteUrl, mk:{m,url,links} } }, qf: {... } }
 *     · `d8/t8` = 词条原文的**GMT+8** 日期/时刻（`2026年10月10日03:27` → 2026-10-10 / 03:27）；
 *       `ms8` = 该时刻的 UTC 毫秒（按 GMT+8 折算，供"在轨天数"等绝对量用）；
 *     · `mk` = 研发机构（制造商）+ 词条链接；`site/siteUrl` = 发射场 + 词条链接。
 *   · 下游：`mkmanufacturers.mjs`（派生制造商索引，**不再自己抓**）、`mkdata.mjs`
 *     （发射历史/简况的**日期权威** + 自动补录 + 全量差异自检）。
 *
 * 说明：词条有 Cloudflare WAF，必须用真实浏览器（Edge headless + CDP）且首次访问要等 20–35 秒
 *   过验证 —— 与 fetch_wiki.mjs / fetch_launch_results.mjs 同一套零依赖链路。
 *   CI（数据中心 IP）过不了 WAF，所以本脚本只在**本地任务**跑（update_wiki.bat），产物进 git。
 *
 * 用法：node scripts/fetch_wiki_tables.mjs [--force]
 *   · 默认：数据新鲜（<=3 天）就跳过；加 --force 强制重抓。
 *   · 退出码：两个词条都失败 → 1（计划任务标红）；至少一个成功 → 写文件并返回 0。
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpRoot } from './tmproot.mjs';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const { WebSocket } = require('ws');
const OUT = path.join(ROOT, 'data', 'wiki_tables.json');
const PORT = 9484;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MAX_AGE_DAYS = 3;

// 新鲜度自判断（与 mkmanufacturers 同一口径：旧版"文件存在就跳过"导致缓存永不更新）
if (fs.existsSync(OUT) && !process.argv.includes('--force')) {
  try {
    const j0 = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    const ageDays = j0._fetched ? (Date.now() - Date.parse(j0._fetched)) / 86400000 : Infinity;
    console.log('缓存：gw ' + Object.keys(j0.gw || {}).length + ' / qf ' + Object.keys(j0.qf || {}).length +
      ' 项｜更新于 ' + (j0._fetched || '?') + '｜已 ' + (isFinite(ageDays) ? ageDays.toFixed(1) : '?') + ' 天');
    if (ageDays <= MAX_AGE_DAYS) { console.log('未过期，跳过重抓（--force 可强制）'); process.exit(0); }
    console.log('已过期 → 自动重抓');
  } catch (e) { /* 读失败就当没有，重抓 */ }
}

const EDGE = (function () {
  const cands = [
    process.env.CISTRACK_EDGE, process.env.EDGE_PATH,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/microsoft-edge', '/usr/bin/google-chrome',
  ].filter(Boolean);
  for (const c of cands) { try { if (fs.existsSync(c)) return c; } catch (e) {} }
  return 'msedge.exe';
})();
const TMPROOT = tmpRoot();
const PAGES = [
  ['gw', 'https://sat.huijiwiki.com/wiki/%E6%98%9F%E7%BD%91'],                 // 星网
  ['qf', 'https://sat.huijiwiki.com/wiki/%E5%8D%83%E5%B8%86%E6%98%9F%E5%BA%A7'],  // 千帆星座
];
const ch = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run',
  '--disable-blink-features=AutomationControlled',
  '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  '--user-data-dir=' + path.join(TMPROOT, 'edge-profile-fetch-wiki-tables'),
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

// 表内提取（与 mkmanufacturers 原版同一套表头定位逻辑：按内容特征找列，不按下标硬取）
const EXTRACT = `(function(){
  var out = [];
  document.querySelectorAll('table').forEach(function (t) {
    var trs = [...t.querySelectorAll('tr')];
    if (!trs.length) return;
    var head = [...trs[0].children].map(function (c) { return (c.innerText || '').trim().replace(/\\s+/g, ''); });
    var iCos = head.findIndex(function (h) { return /COSPAR/i.test(h); });
    var iDate = head.findIndex(function (h) { return /发射日期|发射时间/.test(h); });
    var iName = head.findIndex(function (h) { return /中文名|名称/.test(h); });
    var iSite = head.findIndex(function (h) { return /发射基地|发射地点|发射场/.test(h); });
    var iMk = head.findIndex(function (h) { return /研发机构|研制单位/.test(h); });
    if (iCos < 0 || iDate < 0) return;                       // 单源表必须有 COSPAR + 日期
    trs.slice(1).forEach(function (tr) {
      var cs = [...tr.children];
      if (cs.length <= iCos) return;
      var cos = (cs[iCos].innerText || '').trim().replace(/\\s+/g, '');
      if (!cos) return;
      var cell = iMk >= 0 ? cs[iMk] : null;
      var aList = cell ? [].slice.call(cell.querySelectorAll('a')).map(function (x) {
        return { n: (x.innerText || '').trim(), u: x.getAttribute('href') || '' };
      }).filter(function (x) { return x.n && x.u; }) : [];
      out.push({
        cospar: cos,
        date: iDate >= 0 && cs[iDate] ? (cs[iDate].innerText || '').trim().replace(/\\s+/g, ' ') : '',
        name: iName >= 0 && cs[iName] ? (cs[iName].innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 80) : '',
        site: iSite >= 0 && cs[iSite] ? (cs[iSite].innerText || '').trim().replace(/\\s+/g, ' ') : '',
        siteUrl: (iSite >= 0 && cs[iSite] && cs[iSite].querySelector('a')) ? cs[iSite].querySelector('a').getAttribute('href') : '',
        mk: cell ? (cell.innerText || '').trim().replace(/\\s+/g, '') : '',
        mkUrl: (cell && cell.querySelector('a')) ? cell.querySelector('a').getAttribute('href') : '',
        mkLinks: aList
      });
    });
  });
  return JSON.stringify(out);
})()`;

/** COSPAR 归一：'2026-230' / '2026-230A' / '2026-230 B' → '2026-230' */
function normCospar(c) {
  const m = String(c || '').replace(/\s+/g, '').match(/^(\d{4})-(\d{1,4})/);
  return m ? m[1] + '-' + m[2] : '';
}
/** 词条日期（GMT+8 口径）：'2026年10月10日03:27' → { d8:'2026-10-10', t8:'03:27', ms8:<UTC ms> } */
function parseDate8(raw) {
  const m = String(raw || '').match(/(\d{4})年(\d{1,2})月(\d{1,2})日(?:\s*(\d{1,2}):(\d{1,2}))?/);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3], h = m[4] == null ? null : +m[4], mi = m[5] == null ? null : +m[5];
  const p2 = n => (n < 10 ? '0' : '') + n;
  const d8 = y + '-' + p2(mo) + '-' + p2(d);
  const t8 = h == null ? '' : p2(h) + ':' + p2(mi || 0);
  const ms8 = Date.UTC(y, mo - 1, d, (h || 0) - 8, mi || 0);   // GMT+8 → UTC
  return { d8: d8, t8: t8, ms8: ms8 };
}

const out = { _fetched: new Date().toISOString(), _src: PAGES.map(p => p[1]), gw: {}, qf: {} };
// ⚠️ H9 实测（2026-10-16）：WAF 通过是**概率性**的（gw 词条那一轮没过验证）。旧写法"整块重建再写"，
//   只要有一个星座失败，另一个星座的数据就被**写空**（qf-only 文件，gw 全丢）。
//   → 以**旧文件为基底**、按星座增量更新：哪个词条抓成功就换哪个，失败的保留旧数据。
//   抓取时间也按星座分别记（_fetched_gw / _fetched_qf），整体的 _fetched 取**最旧**一侧 ——
//   这样"只更新了一个星座"的文件在新鲜度门槛上仍会被判陈旧，下一轮继续重试另一个。
const fetchedAt = { gw: null, qf: null };
try {
  const old = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  if (old && typeof old === 'object') {
    out.gw = old.gw || {}; out.qf = old.qf || {};
    const oldT = old._fetched ? Date.parse(old._fetched) : NaN;
    fetchedAt.gw = old._fetched_gw ? Date.parse(old._fetched_gw) : (isFinite(oldT) ? oldT : null);
    fetchedAt.qf = old._fetched_qf ? Date.parse(old._fetched_qf) : (isFinite(oldT) ? oldT : null);
  }
} catch (e) { /* 没有旧文件就从空开始 */ }
let okPages = 0;
for (const [key, url] of PAGES) {
  await send('Page.navigate', { url: url });
  // 过 Cloudflare 验证：轮询标题（中英文挑战页都算"没过"）；单页重试一次（WAF 是概率性的）
  let ok = false;
  for (let attempt = 0; attempt < 2 && !ok; attempt++) {
    if (attempt) console.log(key + ' 第 1 次没过验证，60s 后重试…');
    for (let i = 0; i < 40; i++) {
      await sleep(1500);
      const ti = await ev('document.title');
      if (ti && !/请稍候|Just a moment/.test(ti)) { ok = true; break; }
    }
  }
  if (!ok) { console.log('!! ' + key + ' 词条两次都没通过验证 —— **保留旧数据**（不写空）'); continue; }
  await sleep(1500);
  const got = await ev(EXTRACT, true);
  if (got && got.err) { console.log(key + ' 提取失败：' + got.err); continue; }
  let arr = [];
  try { arr = JSON.parse(got || '[]'); } catch (e) { console.log(key + ' 结果解析失败'); continue; }
  okPages++;
  const map = out[key];
  fetchedAt[key] = Date.now();          // 这一星座刚抓成功 → 记新时间（失败的时间戳保持旧值）
  let n = 0;
  for (const r of arr) {
    const cos = normCospar(r.cospar);
    if (!cos) continue;
    const dt = parseDate8(r.date);
    const row = {
      name: r.name || '',
      d8: dt ? dt.d8 : '', t8: dt ? dt.t8 : '', ms8: dt ? dt.ms8 : 0,
      site: r.site || '', siteUrl: r.siteUrl || '',
      mk: r.mk ? { m: r.mk, url: r.mkUrl || '', links: r.mkLinks || [] } : null
    };
    // ⚠️ 同一次发射在表里可能有多行（A/B/K 多载荷，COSPAR 只差后缀字母）→ **合并**而不是覆盖：
    //    已存在的非空字段保留，空字段由后行补齐（防止"无研发机构"的行把有机构的行覆盖成 null）。
    const old = map[cos];
    if (old) {
      for (const f of ['name', 'site', 'siteUrl']) if (!old[f] && row[f]) old[f] = row[f];
      if (!old.mk && row.mk) old.mk = row.mk;
      if (!old.d8 && row.d8) { old.d8 = row.d8; old.t8 = row.t8; old.ms8 = row.ms8; }
      n++;
      continue;
    }
    map[cos] = row;
    n++;
  }
  console.log(key + '：' + n + ' 行（' + Object.keys(map).length + ' 个 COSPAR）');
}
if (!okPages) {
  console.log('!! 两个词条都没抓到 —— 保留原文件不动（不写坏数据）');
  try { ws.close(); } catch (e) {}
  try { spawn('taskkill', ['/PID', String(ch.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) {}
  process.exit(1);
}
const ts = [fetchedAt.gw, fetchedAt.qf].filter(t => t != null);
out._fetched = new Date(Math.min.apply(null, ts.length ? ts : [Date.now()])).toISOString();
if (fetchedAt.gw) out._fetched_gw = new Date(fetchedAt.gw).toISOString();
if (fetchedAt.qf) out._fetched_qf = new Date(fetchedAt.qf).toISOString();
fs.writeFileSync(OUT, JSON.stringify(out, null, 1), 'utf8');
console.log('写入', OUT, fs.statSync(OUT).size, 'bytes');
console.log('抓取时间：gw ' + (out._fetched_gw || '?') + '｜qf ' + (out._fetched_qf || '?'));
// 抽样打印，人工核对用
const sample = Object.keys(out.gw).slice(-3).map(k => k + '=' + out.gw[k].d8 + (out.gw[k].t8 ? ' ' + out.gw[k].t8 : '') + '/' + (out.gw[k].mk ? out.gw[k].mk.m : '(无制造商)'));
console.log('gw 抽样:', sample.join(' | '));
try { ws.close(); } catch (e) {}
try { spawn('taskkill', ['/PID', String(ch.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) {}
process.exit(0);
