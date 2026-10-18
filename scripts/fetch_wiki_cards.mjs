/* fetch_wiki_cards.mjs —— ★ V1.9.8（B2）：**单星词条卡片**抓取器
 * ---------------------------------------------------------------------------
 * 为什么需要它（用户 2026-10-18 口径）：
 *   「以后更新 wiki 数据的时候不要只看星网/千帆词条的表格，更要点击卫星的链接（如果有的话）
 *     查看卡片里面的标准中文名、英文名和 NORAD 编号等信息。」
 *   实测依据：
 *     · 星网/千帆词条表里的 `nameLinks` 只给"词条标题 + 链接"，**没有英文名、没有 NORAD**；
 *     · 单星词条的内页（infobox）里才有：中文名 / 英文名（如 `WHJSW 03`）/ COSPAR / NORAD；
 *     · 混编批次（如 2026-211 = 极轨26组 8 颗 + EUHT）**只能靠卡片里的 NORAD 才能定位**。
 *
 * 变更检测（用户要求"有更新才抓、没更新就用旧数据但更新时间要更新"）：
 *   用 MediaWiki API **一次批量**查 50 个词条的 `revid`：
 *     api.php?action=query&titles=A|B|C&prop=revisions&rvprop=ids|timestamp&formatversion=2
 *   revid 未变 → 复用旧卡片（**不打开页面**）；变了/新词条 → 才进抓取队列。
 *   无论有没有变化，只要本轮**全部成功**，就把 `_checkedAt` 前进（页面的"卫星百科更新时间"）。
 *
 * 链路：Cloudflare 会拦普通 HTTP（curl 实测 403），所以统一用 Edge 无头 + 真实 UA 过挑战，
 *   与 fetch_wiki_tables.mjs / fetch_wiki.mjs 同一套做法（CI 跑不了，只在本机定时任务里跑）。
 *
 * 用法：
 *   node scripts/fetch_wiki_cards.mjs            # 增量（默认）
 *   node scripts/fetch_wiki_cards.mjs --force    # 忽略 revid 缓存，全部重抓
 *   node scripts/fetch_wiki_cards.mjs --dry      # 只打印"会抓哪些"，不联网
 * 退出码：全部成功 0；有词条失败 1（保留旧数据，不写空）。
 */
import { spawn } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const { WebSocket } = require('ws');
const OUT = path.join(ROOT, 'data', 'wiki_cards.json');
const TABLES = path.join(ROOT, 'data', 'wiki_tables.json');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9491;
const HOST = 'https://sat.huijiwiki.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FORCE = process.argv.includes('--force');
const DRY = process.argv.includes('--dry');

// ---------------------------------------------------------------- 标题清单
/** 与 mkdata 的 expandTitles 同一套规则（区间展开：`…0001星-0004星` / `…08组A星~D星`） */
function expandTitles(titles) {
  if (!titles || titles.length < 2) return null;
  const clean = (t) => String(t || '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  const a = clean(titles[0]), b = clean(titles[titles.length - 1]);
  if (!a || !b || a === b) return null;
  const numA = /(\d+)(星?)$/.exec(a), numB = /(\d+)(星?)$/.exec(b);
  if (numA && numB && a.slice(0, a.length - numA[0].length) === b.slice(0, b.length - numB[0].length)) {
    const pre = a.slice(0, a.length - numA[0].length), tail = numA[2] || '';
    const n1 = parseInt(numA[1], 10), n2 = parseInt(numB[1], 10), w = numA[1].length;
    if (!(n2 > n1) || n2 - n1 > 60) return null;
    const out = [];
    for (let n = n1; n <= n2; n++) out.push(pre + String(n).padStart(w, '0') + tail);
    return out;
  }
  const letA = /([A-Z])(星?)$/.exec(a), letB = /([A-Z])(星?)$/.exec(b);
  if (letA && letB && a.slice(0, a.length - letA[0].length) === b.slice(0, b.length - letB[0].length)) {
    const pre = a.slice(0, a.length - letA[0].length), tail = letA[2] || '';
    const c1 = letA[1].charCodeAt(0), c2 = letB[1].charCodeAt(0);
    if (!(c2 > c1) || c2 - c1 > 26) return null;
    const out = [];
    for (let c = c1; c <= c2; c++) out.push(pre + String.fromCharCode(c) + tail);
    return out;
  }
  return null;
}
function collectTitles() {
  let T = {};
  try { T = JSON.parse(fs.readFileSync(TABLES, 'utf8')); } catch (e) {
    console.error('读不到 ' + TABLES + '，无法建立词条清单');
    process.exit(1);
  }
  const set = new Map();                       // 标题 → 来源说明
  ['gw', 'qf'].forEach((k) => {
    Object.keys(T[k] || {}).forEach((key) => {
      if (key[0] === '_') return;
      const row = T[k][key];
      const links = (row && Array.isArray(row.nameLinks)) ? row.nameLinks : [];
      if (!links.length) return;
      links.forEach((ln) => {
        const t = String((ln && (ln.t || ln.n)) || '').replace(/_/g, ' ').trim();
        if (t && !set.has(t)) set.set(t, k + ':' + key);
      });
      // 区间展开：把中间那些没给链接的也补进清单（它们一样有词条页）
      const ex = expandTitles(links.map((x) => x.t || x.n));
      if (ex) ex.forEach((t) => { if (t && !set.has(t)) set.set(t, k + ':' + key + '(range)'); });
    });
  });
  return [...set.entries()].map(([t, src]) => ({ t, src }));
}

// ---------------------------------------------------------------- 浏览器
let ws = null, msgId = 0;
const waits = new Map();
function send(method, params) {
  const mid = ++msgId;
  return new Promise((res, rej) => {
    waits.set(mid, (m) => (m.error ? rej(new Error(method + ': ' + JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
}
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result.value;
}
async function connect() {
  const ch = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-blink-features=AutomationControlled',
    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    // ★ 浏览器 profile 放系统临时目录 —— 放仓库里会被当成未跟踪文件（实测一次就 100+ MB）
    '--user-data-dir=' + path.join(os.tmpdir(), 'cistrack-wiki-cards-profile'),
    '--remote-debugging-port=' + PORT, '--window-size=1600,1200', 'about:blank'], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 80 && !target; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const j = await r.json();
      target = j.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch (e) { /* 还没起来 */ }
    if (!target) await sleep(250);
  }
  if (!target) throw new Error('Edge 调试端口没起来（' + PORT + '）');
  ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 1 << 28 });
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  ws.on('message', (buf) => {
    let m; try { m = JSON.parse(buf.toString()); } catch (e) { return; }
    if (m.id && waits.has(m.id)) { const w = waits.get(m.id); waits.delete(m.id); w(m); }
  });
  await send('Page.enable'); await send('Runtime.enable');
  return ch;
}
/** 打开一个 URL 并等 Cloudflare 挑战过去（中英文挑战页都算"没过"） */
async function goto(url, tries) {
  for (let attempt = 0; attempt < (tries || 2); attempt++) {
    await send('Page.navigate', { url });
    for (let i = 0; i < 40; i++) {
      await sleep(1500);
      let ti = '';
      try { ti = await ev('document.title'); } catch (e) { ti = ''; }
      if (ti && !/请稍候|Just a moment|Attention Required/i.test(String(ti))) { await sleep(800); return true; }
    }
    if (attempt === 0) console.log('   …挑战页未过，60s 后重试');
  }
  return false;
}

// ---------------------------------------------------------------- 解析
const EXTRACT = `(function () {
  function txt(el) { return el ? String(el.textContent || '').replace(/\\s+/g, ' ').trim() : ''; }
  var box = document.querySelector('.infobox, table.infobox, .portable-infobox') ||
            document.querySelector('.mw-parser-output table');
  var fields = {};
  if (box) {
    box.querySelectorAll('tr').forEach(function (tr) {
      var cs = tr.children;
      if (cs.length === 2) {
        var k = txt(cs[0]).replace(/[:：]$/, ''), v = txt(cs[1]);
        if (k && v && k.length <= 20) fields[k] = v;
      }
    });
    // 灰机的 infobox 也可能是 label/data 两列 div
    box.querySelectorAll('.infobox-label, .pi-data-label').forEach(function (l) {
      var k = txt(l).replace(/[:：]$/, ''), v = txt(l.nextElementSibling);
      if (k && v) fields[k] = v;
    });
  }
  var all = txt(box || document.body);
  function pick(names) {
    for (var i = 0; i < names.length; i++) if (fields[names[i]]) return fields[names[i]];
    return '';
  }
  var norad = pick(['NORAD', 'NORAD 编号', 'NORAD编号']);
  if (!norad) { var m = /NORAD\\s*(\\d{4,6})/.exec(all); if (m) norad = m[1]; }
  var cospar = pick(['国际卫星标识符', 'COSPAR', 'COSPAR 编号']);
  if (!cospar) { var c2 = /(\\d{4}-\\d{3}[A-Z]{0,3})/.exec(all); if (c2) cospar = c2[1]; }
  return {
    zh: txt(document.querySelector('#firstHeading, .page-header__title')) || document.title.replace(/\\s*-\\s*卫星百科.*$/, ''),
    en: pick(['英文名', '英文名称', 'English name', 'English']),
    norad: norad, cospar: cospar,
    fields: fields, parsed: Object.keys(fields).length >= 3
  };
})()`;

// ---------------------------------------------------------------- 主流程
(async () => {
  const titles = collectTitles();
  console.log('词条清单：' + titles.length + ' 个（来自 wiki_tables 的 nameLinks + 区间展开）');
  if (DRY) { titles.slice(0, 8).forEach((x) => console.log('   ' + x.t + '  ← ' + x.src)); console.log('   …'); return; }

  let old = { cards: {} };
  try { old = JSON.parse(fs.readFileSync(OUT, 'utf8')) || { cards: {} }; } catch (e) { /* 首次 */ }
  const oldCards = old.cards || {};

  const ch = await connect();
  let failed = 0;
  try {
    // ① 批量查 revid（一次 50 个）
    const revs = {};
    for (let i = 0; i < titles.length; i += 50) {
      const batch = titles.slice(i, i + 50).map((x) => x.t);
      const api = HOST + '/api.php?action=query&prop=revisions&rvprop=ids%7Ctimestamp&formatversion=2&format=json&titles=' +
        encodeURIComponent(batch.join('|'));
      const ok = await goto(api, 2);
      if (!ok) { console.log('!! revid 批次 ' + (i / 50 + 1) + ' 没抓到'); failed++; continue; }
      let j = null;
      try { j = JSON.parse(await ev('document.body.innerText')); } catch (e) { j = null; }
      if (!j || !j.query || !j.query.pages) { console.log('!! revid 批次解析失败'); failed++; continue; }
      j.query.pages.forEach((p) => {
        if (p.missing) return;
        const r = (p.revisions || [])[0] || {};
        revs[p.title] = { revid: r.revid, ts: r.timestamp };
      });
      await sleep(600);
    }
    console.log('revid 拿到 ' + Object.keys(revs).length + ' / ' + titles.length);

    // ② 挑出要抓的
    const todo = titles.filter((x) => {
      const r = revs[x.t];
      if (!r) return false;                                   // 词条不存在（或批次没给链接）
      if (FORCE) return true;
      const c = oldCards[x.t];
      return !c || c.revid !== r.revid;
    });
    if (!Object.keys(revs).length) {
      console.log('!! revid 一个都没拿到（大概率是 Cloudflare 挑战没过）—— **保留旧数据，不写空**');
      process.exitCode = 1;
      return;
    }
    console.log('需要抓取 ' + todo.length + ' 个（其余 ' + (titles.length - todo.length) + ' 个 revid 未变，复用旧数据）');

    // ③ 抓卡片
    const cards = {};
    Object.keys(oldCards).forEach((k) => { cards[k] = oldCards[k]; });   // 先拷贝旧数据
    for (const x of todo) {
      const url = HOST + '/wiki/' + encodeURIComponent(x.t);
      const ok = await goto(url, 2);
      if (!ok) { console.log('   !! ' + x.t + ' 没过挑战，保留旧数据'); failed++; continue; }
      let got = null;
      try { got = await ev(EXTRACT); } catch (e) { got = null; }
      if (!got || !got.zh) { console.log('   !! ' + x.t + ' 解析失败'); failed++; continue; }
      const rev = revs[x.t] || {};
      cards[x.t] = {
        revid: rev.revid || 0, ts: rev.ts || '',
        zh: got.zh, en: got.en || '', norad: got.norad ? parseInt(got.norad, 10) : 0,
        cospar: got.cospar || '', parsed: !!got.parsed, fields: got.fields || {}
      };
      console.log('   ✓ ' + x.t + ' → ' + (got.en || '(无英文名)') + ' / NORAD ' + (got.norad || '?'));
      await sleep(700);
    }

    // ④ 落盘
    const bj = new Date(Date.now() + 8 * 3600 * 1000);
    const checkedAt = bj.toISOString().slice(0, 16).replace('T', ' ');   // 北京时间
    if (!Object.keys(cards).length) {
      console.log('!! 本次一张卡片都没拿到 —— **不写文件**（保留旧数据）');
      process.exitCode = 1;
      return;
    }
    const out = {
      _src: HOST, _checkedAt: checkedAt, _force: FORCE,
      _counts: { titles: titles.length, fetched: todo.length, failed },
      cards
    };
    fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n', 'utf8');
    const n = Object.keys(cards).length;
    console.log('已写 ' + OUT + '（' + n + ' 张卡片，本次抓 ' + todo.length + '，失败 ' + failed + '）');
    console.log('核对时间：' + checkedAt + '（北京时间）');
    process.exitCode = failed ? 1 : 0;
  } finally {
    try { ws && ws.close(); } catch (e) {}
    try { spawn('taskkill', ['/PID', String(ch.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) {}
  }
})().catch((e) => { console.error('抓取失败：' + (e && e.stack || e)); process.exit(1); });
