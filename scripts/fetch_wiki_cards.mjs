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
 * ★ V1.9.9（P1-D）：变更检测有**两条**路 ——
 *   ① 首选 revid（一次批量 API，便宜）；② API 走不通时**退回逐页内容哈希比对**
 *      （2026-10-19 实测：/api.php 会被 Cloudflare 长期拦在挑战页，而 /wiki/ 页面正常）。
 *
 * 变更检测（用户要求"有更新才抓、没更新就用旧数据但更新时间要更新"）：
 *   用 MediaWiki API **一次批量**查 50 个词条的 `revid`：
 *     api.php?action=query&titles=A|B|C&prop=revisions&rvprop=ids|timestamp&formatversion=2
 *   revid 未变 → 复用旧卡片（**不打开页面**）；变了/新词条 → 才进抓取队列。
 *   无论有没有变化，只要本轮**全部成功**，就把 `_checkedAt` 前进（页面的"卫星百科更新时间"）。
 *
 * ★ O30-12（V1.9.9 收尾）：抓取状态同时写进**仓库根目录的 wiki.json** 的 `cards` 键
 *   （{asOf, error, n}）—— 页面「卫星百科更新」那一行附显，失败不再只藏在日志里。
 *   data/wiki_cards.json 里同步写 `cardsAsOf` / `cardsError` 两个平铺字段（mkdata 现推用）。
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
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpRoot } from './tmproot.mjs';   // ★ V1.9.9（B1）：与 tables 脚本共用同一个**预热过的** profile
import { openBrowser, waitContent } from './cdp.mjs';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'data', 'wiki_cards.json');
const WIKI_JSON = path.join(ROOT, 'wiki.json');
const TABLES = path.join(ROOT, 'data', 'wiki_tables.json');
const HOST = 'https://sat.huijiwiki.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** ★ O30-12（V1.9.9 收尾）：把卡片抓取状态补丁进仓库根目录的 wiki.json（只动 `cards` 一个键）。
 *  页面运行时读 wiki.json（同目录 ./wiki.json → 官方 Pages 兜底 → 内置值，三级），
 *  所以状态写在这里，本地任务提交后访客刷新即可见 —— 不必等下一次 HTML 构建。
 *  形状：cards = { asOf: 'YYYY-MM-DD HH:MM'（北京时间）, error: '' | '原因…', n: 卡片张数 }
 *  任何失败都只警告不抛出：卡片是增强项，不能因为它让整个任务失败（2026-10-19 的教训）。 */
function patchWikiCards(asOf, error, n) {
  try {
    if (!fs.existsSync(WIKI_JSON)) { console.log('（wiki.json 不存在，跳过卡片状态补丁）'); return; }
    const wj = JSON.parse(fs.readFileSync(WIKI_JSON, 'utf8'));
    wj.cards = { asOf: asOf, error: error || '', n: n };
    fs.writeFileSync(WIKI_JSON, JSON.stringify(wj, null, 1) + '\n', 'utf8');
    console.log('卡片状态已补进 wiki.json（n=' + n + (error ? '，有失败：' + error : '') + '）');
  } catch (e) {
    console.log('（wiki.json 补卡片状态跳过：' + (e && e.message || e) + '）');
  }
}
/** 卡片内容的指纹（用于"逐页内容比对"这条退路；revid 拿不到时靠它判断有没有变） */
const HASH = (o) => createHash('sha1').update(JSON.stringify(o)).digest('hex').slice(0, 16);
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
// ★★ V1.9.9.630：三处一起治 ——
//   ① `require('ws')` → **Node ≥22 内置 WebSocket**（ws 是 devDependency、node_modules 不入库，
//      开源使用者 clone 后必 `ERR_MODULE_NOT_FOUND`；`fetch_wiki.mjs` 早就改了，这个没跟上）。
//   ② `const EDGE = 'C:\\Program Files (x86)\\...msedge.exe'` 写死路径 → 换台机器/换成 Chrome 就废。
//      现在统一走 cdp.mjs 的 `findBrowser()`（环境变量 CISTRACK_EDGE / EDGE_PATH / CHROME_PATH 优先，
//      然后才是各处常见安装路径，Windows/macOS/Linux 都覆盖）。
//   ③ 挑战判据只有三四个英文词 → 统一到 cdp.mjs 的 `CHALLENGE_RE`（唯一权威）。
//
//   ★ 保留了本脚本**自己**的节奏参数（这是它的取舍，不能因为"统一"就抹掉）：
//     · 窗口 180s（实测出现过 71s 与 >136s 才通过的情形）；
//     · 重试退避 30~60s **随机**（不要固定节奏，避免与挑战的风控节拍重合）；
//     · 复用 `fetch_wiki_tables.mjs` 那个**已预热**的 profile —— 实测全新 profile 的首次挑战
//       耗时 2s~>136s 剧烈波动，而预热过（已存 `cf_clearance`）的首屏 1.6~2.0s。
//       （profile 在临时目录、不进仓库；两个脚本串行执行，不会抢锁。）
const PROFILE = path.join(tmpRoot(), 'edge-profile-fetch-wiki-tables');
let BROWSER = null;      // { c, cleanup }
const send = (m, p) => BROWSER.c.send(m, p);
const ev = (expr, aw) => BROWSER.c.ev(expr, aw);
async function connect() {
  BROWSER = await openBrowser({ profileDir: PROFILE, tmpRoot: tmpRoot(), bootMs: 20000 });
  return BROWSER;
}
/** 打开一个 URL 并等 Cloudflare 挑战过去（标题 + 内容双判据，见 cdp.mjs） */
async function goto(url, tries, waitSec, contentProbe) {
  const w = await waitContent(BROWSER.c, url, {
    tries: tries || 3,
    waitMs: (waitSec || 180) * 1000,
    pollMs: 1500,
    contentProbe: contentProbe || '',
    // ★ V1.9.9（B2）：每次重试之间**随机**退避 30~60s（不要固定节奏，避免与挑战的风控节拍重合）
    backoffMs: () => 30000 + Math.round(Math.random() * 30000),
    settleMs: 800,
  });
  if (!w.ok && (tries || 3) > 1) {
    console.log('   …挑战页未过（已等 ' + (waitSec || 180) + 's，title=' + JSON.stringify(w.title) + '）');
  }
  return w.ok;
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
  // ★★ V1.9.9（P1-C）：英文名在 .infobox-above 的第 2 段，不在任何 label 行里。
  //   实测 4 例（2026-10-19）：08组B星 → WHJSW 08 B；EUHT → EUHT Technology Test Satellite；
  //   03 → WHJSW 03；α阶段A → KL-Alpha A。而 hasEnRow 全部为 false ——
  //   旧实现 pick(['英文名', …]) 永远返回空串。
  //   ⚠️ 本段在模板字符串里：注释中**不能出现反引号**（会提前结束字符串，已踩一次）。
  var above = [];
  try {
    var ab = document.querySelector('.infobox-above');
    if (ab) {
      above = String(ab.innerHTML).split(/<br\\s*\\/?>/i).map(function (x) {
        var d = document.createElement('div'); d.innerHTML = x; return txt(d);
      }).filter(Boolean);
    }
  } catch (e) { above = []; }
  var zhName = above[0] || txt(document.querySelector('#firstHeading, .page-header__title')) ||
    document.title.replace(/\\s*-\\s*卫星百科.*$/, '');
  var enName = above[1] || pick(['英文名', '英文名称', 'English name', 'English']);
  return {
    zh: zhName,
    en: enName,
    norad: norad, cospar: cospar,
    fields: fields, parsed: Object.keys(fields).length >= 3
  };
})()`;

// ---------------------------------------------------------------- 主流程
(async () => {
  const titles = collectTitles();
  console.log('词条清单：' + titles.length + ' 个（来自 wiki_tables 的 nameLinks + 区间展开）');
  // ★ V1.9.9.630：`--list` 打印**全量**清单（--dry 只印前 8 条会让人误以为清单里没有某项）。
  if (process.argv.includes('--list')) {
    titles.forEach((x, i) => console.log(String(i + 1).padStart(3) + '. ' + x.t + '  ← ' + x.src));
    return;
  }
  if (DRY) { titles.slice(0, 8).forEach((x) => console.log('   ' + x.t + '  ← ' + x.src)); console.log('   …（--list 可看全量）'); return; }

  let old = { cards: {} };
  try { old = JSON.parse(fs.readFileSync(OUT, 'utf8')) || { cards: {} }; } catch (e) { /* 首次 */ }
  const oldCards = old.cards || {};

  await connect();
  let failed = 0;
  // ★ V1.9.9.630：**逐条失败取证** —— 用户要求"抓取行为完整可重复、可追溯"。
  //   原来只有一个计数 `failed`，事后无法回答"哪几个词条没抓到、为什么"。
  const FAILS = [];   // { title, reason }
  try {
    // ① 批量查 revid（一次 50 个）
    const revs = {};
    let apiBatchFail = 0;
    for (let i = 0; i < titles.length; i += 50) {
      const batch = titles.slice(i, i + 50).map((x) => x.t);
      const api = HOST + '/api.php?action=query&prop=revisions&rvprop=ids%7Ctimestamp&formatversion=2&format=json&titles=' +
        encodeURIComponent(batch.join('|'));
      // API 只给一次机会 + 45s 窗口：过不去就说明这条路被特别保护了（见下面 NO_API 分支）
      // ★ 内容探针：`document.body.innerText` 必须以 `{` 开头 —— 挑战页/错误页都过不了这一关。
      //   旧写法只看标题 → 挑战页 200 但正文是 HTML，`JSON.parse` 失败 → 记成"解析失败"，
      //   与"API 被拦"混在一起，看不出到底哪种情况。
      const ok = await goto(api, 1, 45, '(document.body.innerText||"").trim().slice(0,1)==="{"');
      if (!ok) { console.log('!! revid 批次 ' + (i / 50 + 1) + ' 没抓到'); apiBatchFail++; continue; }
      let j = null;
      try { j = JSON.parse(await ev('document.body.innerText')); } catch (e) { j = null; }
      if (!j || !j.query || !j.query.pages) { console.log('!! revid 批次解析失败'); apiBatchFail++; continue; }
      j.query.pages.forEach((p) => {
        if (p.missing) return;
        const r = (p.revisions || [])[0] || {};
        revs[p.title] = { revid: r.revid, ts: r.timestamp };
      });
      await sleep(600);
    }
    console.log('revid 拿到 ' + Object.keys(revs).length + ' / ' + titles.length +
      (apiBatchFail ? '（' + apiBatchFail + ' 个批次请求失败 —— 见下面 NO_API 判断）' : ''));
    // ★ V1.9.9.630：批量 API 失败**不再计入 `failed`**。
    //   为什么：`failed` 的语义是"**有词条没抓到卡片**"，而 API 不通时下面的 NO_API 分支
    //   会逐页抓、照样拿得到卡片 —— 把它计进 failed 会让 `cardsError` 谎报"有词条失败"，
    //   页面就长期挂着一条假的失败提示（实测现状正是如此：37/37 全成功却报"1 个词条未过挑战"）。
    //   真正的失败只由逐条抓取那一步决定。

    // ★★ V1.9.9（P1-D）：**api.php 走不通就退回「逐页内容比对」** ★★
    //   实测（2026-10-19）：同一套预热 profile 下，`/wiki/<词条>` 页面能过 Cloudflare（fetch_wiki_tables 正常），
    //   但 `/api.php?...` 一直停在挑战页（等到 180s 也不放行）→ revid 一个都拿不到 →
    //   旧脚本在这里直接 exit 1，于是**卡片库永远是空的**（D3 的英文名也就永远不生效）。
    //   新口径：API 不可用**不算失败**，改成"打开每一页、比内容哈希" —— 慢一点（37 页），
    //   但链路上任何一环坏掉都不会再让整个卡片库停摆。
    const NO_API = !Object.keys(revs).length;
    if (NO_API) console.log('（api.php 不可用 → 改走逐页内容比对：本次会打开全部 ' + titles.length + ' 个词条）');

    // ② 挑出要抓的
    const todo = NO_API ? titles.slice() : titles.filter((x) => {
      const r = revs[x.t];
      if (!r) return false;                                   // 词条不存在（或批次没给链接）
      if (FORCE) return true;
      const c = oldCards[x.t];
      return !c || c.revid !== r.revid;
    });
    console.log('需要抓取 ' + todo.length + ' 个' + (NO_API ? '（全部：逐页比对）' :
      '（其余 ' + (titles.length - todo.length) + ' 个 revid 未变，复用旧数据）'));

    // ③ 抓卡片
    const cards = {};
    Object.keys(oldCards).forEach((k) => { cards[k] = oldCards[k]; });   // 先拷贝旧数据
    // 卡片页的内容探针 = infobox 里至少攒到 3 个字段（与下面 EXTRACT 的 `parsed` 同口径）。
    //   光标题正常不算过 —— 这正是 V1.9.3 那次"挑战页被当成功"的教训。
    const CARD_PROBE = '(()=>{var b=document.querySelector(".infobox, table.infobox, .portable-infobox")'
      + '||document.querySelector(".mw-parser-output table");if(!b)return false;var n=0;'
      + 'b.querySelectorAll("tr").forEach(function(tr){if(tr.children.length===2)n++;});return n>=3;})()';
    for (const x of todo) {
      const url = HOST + '/wiki/' + encodeURIComponent(x.t);
      const ok = await goto(url, 2, 180, CARD_PROBE);
      if (!ok) { console.log('   !! ' + x.t + ' 没过挑战', ); failed++; FAILS.push({ title: x.t, reason: '未过挑战/无 infobox' }); continue; }
      let got = null;
      try { got = await ev(EXTRACT); } catch (e) { got = null; }
      if (!got || !got.zh) { console.log('   !! ' + x.t + ' 解析失败'); failed++; FAILS.push({ title: x.t, reason: '解析失败（无中文名）' }); continue; }
      const rev = revs[x.t] || {};
      const payload = {
        zh: got.zh, en: got.en || '', norad: got.norad ? parseInt(got.norad, 10) : 0,
        cospar: got.cospar || '', parsed: !!got.parsed, fields: got.fields || {}
      };
      const hash = HASH(payload);
      const prev = oldCards[x.t];
      if (!FORCE && prev && prev.hash === hash) {
        // 内容一字未变 → 复用旧条目（连 revid 一起保留），别把"没变"写成"抓了一遍"
        cards[x.t] = prev;
        console.log('   = ' + x.t + '（内容未变，复用）');
        await sleep(300);
        continue;
      }
      cards[x.t] = Object.assign({ revid: rev.revid || 0, ts: rev.ts || '', hash: hash }, payload);
      console.log('   ✓ ' + x.t + ' → ' + (got.en || '(无英文名)') + ' / NORAD ' + (got.norad || '?'));
      await sleep(700);
    }

    // ④ 落盘
    const bj = new Date(Date.now() + 8 * 3600 * 1000);
    const checkedAt = bj.toISOString().slice(0, 16).replace('T', ' ');   // 北京时间
    // ★ O30-12（V1.9.9 收尾）：卡片抓取状态**机器可读** —— 页面「卫星百科更新」行直接附显，
    //   不再只有日志里能看到（WAF 挑战页节拍不稳，失败是常态而非例外）。
    const cardsError = failed
      ? ('本轮 ' + failed + ' 个词条未过挑战/解析失败，相关卡片沿用上次数据')
      : (!Object.keys(cards).length ? '本轮一张卡片都没抓到，全部沿用上次数据' : '');
    if (!Object.keys(cards).length) {
      console.log('!! 本次一张卡片都没拿到 —— **不写文件**（保留旧数据）');
      patchWikiCards(checkedAt, cardsError, Object.keys(oldCards).length);
      // ★ 同一处缺陷（写完不退出）的另一条出口：`return` 只会跳回 finally，
      //   而 finally 里的 cleanup 是异步 taskkill → 进程仍可能挂住。必须显式退出。
      process.exitCode = 1;
      setTimeout(() => process.exit(1), 300);
      return;
    }
    const out = {
      _src: HOST, _checkedAt: checkedAt, _force: FORCE,
      cardsAsOf: checkedAt, cardsError,
      _counts: { titles: titles.length, fetched: todo.length, failed },
      // ★ V1.9.9.630：逐条失败明细（可追溯）。旧版只有计数，事后无法回答"哪几个、为什么"。
      _fails: FAILS.length ? FAILS : undefined,
      cards
    };
    fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n', 'utf8');
    const n = Object.keys(cards).length;
    console.log('已写 ' + OUT + '（' + n + ' 张卡片，本次抓 ' + todo.length + '，失败 ' + failed + '）');
    if (FAILS.length) FAILS.forEach(f => console.log('   ✗ ' + f.title + ' → ' + f.reason));
    console.log('核对时间：' + checkedAt + '（北京时间）');
    patchWikiCards(checkedAt, cardsError, n);
    // ★★ V1.9.9.630：**必须显式 process.exit()**，不能只设 exitCode。
    //   实测（2026-10-21 07:38→07:53）：数据在 07:41 就写完了、日志也打全了，
    //   但进程**整整多挂 12 分钟不退出**，最后靠外部 taskkill 才结束。
    //   病根与 `fetch_launch_results.mjs` / `refresh.mjs` 完全同型：
    //     ① `process.exitCode = …` 只是"登记"退出码，**不会结束进程**；
    //     ② 浏览器是 `openBrowser()` 拉起的子进程，下面 `finally` 里的 `cleanup()`
    //        用的是**异步 spawn** 的 `taskkill /T /F` —— Windows 上偶有 crashpad 等孙进程
    //        在父进程死后仍短暂持有 stdout 管道 → Node 事件循环认为"还有活句柄"→ 不退出。
    //        本次实测尤其明显：外层用 `| tail -30` 接管道，管道不关就一直等。
    //   两个脚本都修过这个问题，这个漏了 ⇒ 现在统一走 `setTimeout(…, process.exit)`：
    //   给 cleanup 的 taskkill 一点时间跑完（不硬抢），然后无论句柄状态如何都强制退出。
    //   ⚠️ 退出码必须**显式传参**（`process.exit(code)` 的实参直接覆盖 exitCode，
    //      反过来"先设 exitCode 再 exit(0)"会把 1 冲成 0 —— 这坑在本仓库踩过）。
    const code = failed ? 1 : 0;
    process.exitCode = code;
    setTimeout(() => process.exit(code), 300);
  } finally {
    try { BROWSER && BROWSER.cleanup(); } catch (e) {}
  }
})().catch((e) => { console.error('抓取失败：' + (e && e.stack || e)); process.exit(1); });
