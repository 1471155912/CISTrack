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
 *   · 默认：数据新鲜（<=1 天）就跳过；加 --force 强制重抓。
 *     ★ V1.9.9（O30-11）：TTL 3 天 → **1 天**。"以百科为准"的日期/发射场最长只能滞后 1 天，
 *       否则会出现"N6 删掉自动补录标签后，日期却还停在三天前"的口径裂缝。
 *   · 退出码：两个词条都失败 → 1（计划任务标红）；至少一个成功 → 写文件并返回 0。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpRoot } from './tmproot.mjs';
import { openBrowser, waitContent } from './cdp.mjs';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'data', 'wiki_tables.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));
// ★ V1.9.9（O30-11）：3 天 → 1 天（见文件头说明）。本机任务每天跑一次，正常情况都会重抓。
const MAX_AGE_DAYS = 1;

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

const TMPROOT = tmpRoot();
const PAGES = [
  ['gw', 'https://sat.huijiwiki.com/wiki/%E6%98%9F%E7%BD%91'],                 // 星网
  ['qf', 'https://sat.huijiwiki.com/wiki/%E5%8D%83%E5%B8%86%E6%98%9F%E5%BA%A7'],  // 千帆星座
];
// ★★ V1.9.9.630：浏览器/ CDP / 挑战页判据全部收进 scripts/cdp.mjs（详见该文件头的"为什么"）。
//   本脚本原来的三处毛病一起消失：
//     ① `require('ws')` —— ws 是 devDependency、node_modules 不入库 → 开源使用者 clone 后
//        `ERR_MODULE_NOT_FOUND`。现在用 Node ≥22 内置 WebSocket（cdp.mjs 内部处理）。
//     ② 挑战页判据只认中文 `请稍候` → Cloudflare 英文挑战页 `Just a moment...` 被判成"已通过"
//        → 去解析 5.7KB 挑战页 → 0 行 → 以"上游没数据"的姿态**静默写空**。
//        这次不用再靠人记住：判据在 cdp.mjs 里只有一份，而且**内容探针**（下面 EXTRACT 的
//        表头特征）必须命中才算通过 —— 光标题正常不算数。
//     ③ 自己找浏览器 + 自己拼 profile 路径 → 与其它三个脚本各写一份，修一处漏三处。
//
//   ⚠️ profile 目录**故意固定且复用**：实测全新 profile 的首次 Cloudflare 挑战耗时
//      2s ~ >136s 剧烈波动；而这个目录里已存着 `cf_clearance` cookie，首屏 1.6~2.0s。
//      `fetch_wiki_cards.mjs` 也**共用这同一个目录**（两个脚本串行跑，不抢锁）。
const PROFILE = path.join(TMPROOT, 'edge-profile-fetch-wiki-tables');
const BROWSER = await openBrowser({ profileDir: PROFILE, tmpRoot: TMPROOT, bootMs: 30000 });
const { c } = BROWSER;
const send = (m, p) => c.send(m, p);
const ev = (e, aw) => c.ev(e, aw);

// 表内提取（与 mkmanufacturers 原版同一套表头定位逻辑：按内容特征找列，不按下标硬取）
const EXTRACT = `(function(){
  var out = [];
  // ★★ V2.0.1（C6）：**采集所属章节（heading）** ★★
  //   病根：旧实现只遍历 <table>，从头到尾没看过 heading ⇒ 于是「这一行属于『试验星』
  //   还是『组网星』」这条信息**从未被采集过**，下游只能靠名字正则去猜（R15 就是这么猜错的：
  //   把 CX-26 猜成了「试验星12」）。
  //   做法：按**文档顺序**扫一遍 heading 与 table，遇到 heading 就更新当前章节，
  //   遇到 table 就把它绑定到当前章节 —— 这是唯一不会错的关联方式
  //   （用 "向上找最近 heading" 的 DOM 祖先法在 wiki 的表格嵌套布局里会漏）。
  var SEC = new Map();
  (function () {
    var cur = '', lvl = 0;
    var nodes = document.querySelectorAll('h1,h2,h3,h4,h5,h6,table');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (/^H[1-6]$/.test(n.tagName)) {
        var tx = (n.innerText || '').trim().replace(/\\s+/g, '');
        if (tx) { cur = tx; lvl = +n.tagName.slice(1); }
      } else if (n.tagName === 'TABLE') {
        SEC.set(n, { sec: cur, lvl: lvl });
      }
    }
  })();
  document.querySelectorAll('table').forEach(function (t) {
    var trs = [...t.querySelectorAll('tr')];
    if (!trs.length) return;
    var head = [...trs[0].children].map(function (c) { return (c.innerText || '').trim().replace(/\\s+/g, ''); });
    var iCos = head.findIndex(function (h) { return /COSPAR/i.test(h); });
    var iDate = head.findIndex(function (h) { return /发射日期|发射时间/.test(h); });
    var iName = head.findIndex(function (h) { return /中文名|名称/.test(h); });
    var iSite = head.findIndex(function (h) { return /发射基地|发射地点|发射场/.test(h); });
    var iMk = head.findIndex(function (h) { return /研发机构|研制单位/.test(h); });
    var iEn = head.findIndex(function (h) { return /^英文名$/.test(h); });
    if (iCos < 0 || iDate < 0) return;                       // 单源表必须有 COSPAR + 日期
    var sc = SEC.get(t) || { sec: '', lvl: 0 };              // V2.0.1（C6）：本表所属章节
    trs.slice(1).forEach(function (tr) {
      var cs = [...tr.children];
      if (cs.length <= iCos) return;
      var cos = (cs[iCos].innerText || '').trim().replace(/\\s+/g, '');
      if (!cos) return;
      var cell = iMk >= 0 ? cs[iMk] : null;
      var aList = cell ? [].slice.call(cell.querySelectorAll('a')).map(function (x) {
        return { n: (x.innerText || '').trim(), u: x.getAttribute('href') || '' };
      }).filter(function (x) { return x.n && x.u; }) : [];
      // ★ V1.9.5（H13/H19）：**名称格里每颗星都有自己的词条链接**（如「…一号 → /wiki/…一号」）。
      //   这是"单星词条"的唯一来源 —— 实测：试验星/GEO/KL 有，**低轨/极轨组网星没有**
      //   （组名没有词条，已用 wgArticleId=0 实测确认）。href 解码后即词条全名（锚文本可能是简称「二号」）。
      var nameCell = iName >= 0 ? cs[iName] : null;
      var nList = nameCell ? [].slice.call(nameCell.querySelectorAll('a')).map(function (x) {
        var u = x.getAttribute('href') || '';
        var full = u;
        try { full = decodeURIComponent(u.replace(/^\\/wiki\\//, '')); } catch (e) { full = u.replace(/^\\/wiki\\//, ''); }
        return { n: (x.innerText || '').trim(), u: u, t: full };
      }).filter(function (x) { return x.u; }) : [];
      out.push({
        cospar: cos,
        // ★ V2.0.1（C6/C7）：章节 + 章节层级 + **COSPAR 原文**
        //   cospar 是归一后的键（可能已被上游合并），cosparRaw 是表格里那一格的原文
        //   （2026-211 / 2026-211K）—— C7 要靠它判断「这是同一批的两行」还是「两批」。
        sec: sc.sec, secLvl: sc.lvl, cosparRaw: String(cs[iCos].innerText || '').trim().replace(/\\s+/g, ''),
        date: iDate >= 0 && cs[iDate] ? (cs[iDate].innerText || '').trim().replace(/\\s+/g, ' ') : '',
        name: iName >= 0 && cs[iName] ? (cs[iName].innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 80) : '',
        nameLinks: nList,
        en: (iEn >= 0 && cs[iEn]) ? (cs[iEn].innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 50) : '',
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

/** COSPAR 归一：'2026-230' / '2026-230A' / '2026-230 B' → '2026-230'；'2025-F05' → '2025-F05'
 *
 *  ★★ V1.9.9.630（治本，本轮最重要的一处数据丢失）：
 *    旧实现是 `match(/^(\d{4})-(\d{1,4})/)` —— **只认纯数字序号**。
 *    而卫星百科对**发射失败/取消**的批次写的是 `2025-F05`（F = Fail，该年第 5 次失利，
 *    没有国际编号），于是 `normCospar('2025-F05')` 返回**空串**，调用处 `if (!cos) continue;`
 *    把它**静默丢掉**。
 *
 *    实测证据（2026-10-21 探针直读真实页面）：
 *      星网词条表 #1 有 12 行，其中一行是 `2025-F05 | 卫星互联网技术试验卫星07组`；
 *      而 `data/wiki_tables.json` 里 gw 只有 41 个键、**没有任何 F 编号** → 该行从未入库。
 *    后果有两层：
 *      ① 发射历史里缺这一发（`launches` 分母对不上：词条写 41/42，台账只有 41）；
 *      ② mkdata 的 H9 日期权威**豁免**了失败批次（`res === 'fail'` 那条），
 *         但豁免的前提是"词条不收失利发射" —— 这个词条**收了**，只是我们没抓进来。
 *
 *    为什么保留 F 形态而不是丢掉字母：F 编号就是该批次的**唯一标识**（它没有国际编号）。
 *    与台账 key 的对应关系：台账写 `'25F05'`（5 位：YY + F + 序号），
 *      mkdata 侧 `'20' + k.slice(0,2) + '-' + k.slice(2)` = `2025-F05` —— **天然对齐**，
 *      所以这里只要原样返回就能被 applyWikiTables 认到（这也是修它的直接收益）。
 *
 *    返回空串只剩"真的解析不出年份/序号"的情况（例如整格是 `—` 或空）。
 */
function normCospar(c) {
  const s = String(c || '').replace(/\s+/g, '');
  // ① 常规：4 位年 + 纯数字序号（允许 1~4 位，统一**补零到 3 位**保证 key 唯一）
  let m = s.match(/^(\d{4})-(\d{1,4})/);
  if (m) return m[1] + '-' + String(+m[2]).padStart(3, '0');
  // ② 失利/取消批次：4 位年 + 'F' + 1~3 位序号（'2025-F05' / '2025-F5' 都归一到 '2025-F05'）
  m = s.match(/^(\d{4})-F(\d{1,3})/i);
  if (m) return m[1] + '-F' + String(+m[2]).padStart(2, '0');
  return '';
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
// ★ V1.9.9.630：**丢弃取证**。用户要求"抓取行为完整可重复、可追溯"——
//   凡是"页面上有、但我们没入库"的行，必须留下理由，否则事后无法回答"这条为什么没有"。
//   （2025-F05 就是这么丢的：无日志、无计数、只有 JSON 里"没有这个键"。）
const DROPPED = [];   // { key, cospar, name, reason }
for (const [key, url] of PAGES) {
  // 过 Cloudflare：**标题 + 内容探针双判据**（详见 scripts/cdp.mjs 的 waitContent）。
  //   内容探针 = 表头里出现 COSPAR 列 —— 这才是"表真的渲染出来了"。
  //   旧写法只看标题，且只认中文 `请稍候` → 英文挑战页 `Just a moment...` 被当成通过 → 抓空。
  const w = await waitContent(c, url, {
    tries: 2,
    // 原实现是 2 轮 × 40 次 × 1500ms = 60s/轮；这里保持同样的量级（waitMs 60000 + 60s 退避）
    waitMs: 60000, pollMs: 1500,
    contentProbe: '(()=>{var ts=[].slice.call(document.querySelectorAll("table"));'
      + 'for(var i=0;i<ts.length;i++){var h=[].slice.call(ts[i].querySelectorAll("tr"));if(!h.length)continue;'
      + 'var t=(h[0].innerText||"");if(/COSPAR/i.test(t)&&/发射日期|发射时间/.test(t))return true;}return false;})()',
    backoffMs: () => 60000,
    settleMs: 1500,
  });
  if (!w.ok) {
    console.log('!! ' + key + ' 词条两次都没通过验证（title=' + JSON.stringify(w.title) + '）—— **保留旧数据**（不写空）');
    DROPPED.push({ key: key, cospar: '', name: '', reason: '整页未过挑战（title=' + w.title + '）' });
    continue;
  }
  const got = await ev(EXTRACT, true);
  let arr = [];
  try { arr = JSON.parse(got || '[]'); } catch (e) { console.log(key + ' 结果解析失败'); continue; }
  if (!arr.length) { console.log(key + ' 提取到 0 行（页面可能已改版）'); }
  okPages++;
  const map = out[key];
  fetchedAt[key] = Date.now();          // 这一星座刚抓成功 → 记新时间（失败的时间戳保持旧值）
  // ★★ V2.0.1（C7）：行级明细**每轮重建** ★★
  //   本轮是整页重抓，行级信息自然完整；若不先清空，旧文件里的 rows 会被重复追加，
  //   跑 N 次就是 N 倍膨胀（与 `en` 那次"去重不幂等"是同一类坑）。
  for (const kk of Object.keys(map)) map[kk].rows = [];
  let n = 0;
  for (const r of arr) {
    const cos = normCospar(r.cospar);
    if (!cos) {
      // ★ 这里原来是一句光秃秃的 `continue`。现在**记账**：以后翻日志就能看到
      //   "上游有这一行、COSPAR 长这样、我们没认出来"。
      DROPPED.push({ key: key, cospar: String(r.cospar || ''), name: String(r.name || ''), reason: 'COSPAR 无法归一' });
      continue;
    }
    const dt = parseDate8(r.date);
    if (!dt) {
      // 日期解析不出来不阻止入库（有些行日期格是"—"），但要留痕 —— 因为 d8 空会让
      // mkdata 的 H9 日期权威跳过这一条（表现为"日期没有以百科为准"）。
      DROPPED.push({ key: key, cospar: cos, name: String(r.name || ''), reason: '日期无法解析（原文 ' + JSON.stringify(String(r.date || '').slice(0, 40)) + '）' });
    }
    const row = {
      name: r.name || '',
      names: r.name ? [r.name] : [],
      nameLinks: Array.isArray(r.nameLinks) ? r.nameLinks.slice() : [],
      en: r.en || '',
      d8: dt ? dt.d8 : '', t8: dt ? dt.t8 : '', ms8: dt ? dt.ms8 : 0,
      site: r.site || '', siteUrl: r.siteUrl || '',
      mk: r.mk ? { m: r.mk, url: r.mkUrl || '', links: r.mkLinks || [] } : null,
      // ★ V2.0.1（C6/C7）：章节落盘 + 行级明细
      //   `sec` 只有单章节时才有值；多章节时由 `secs` / `bySec` 表达（见本循环之后的派生段）。
      //   `rows` 是**表格里的原始行**：同一批次若在「试验星」与「组网星」两张表各出现一次，
      //   这里就会有两项，各自带自己的章节与载荷名 —— 这正是 R14「按章节过滤载荷」的依据。
      sec: r.sec || '', secLvl: r.secLvl || 0, cosparRaw: r.cosparRaw || '',
      rows: [{
        cosparRaw: r.cosparRaw || '', sec: r.sec || '', secLvl: r.secLvl || 0,
        name: r.name || '', en: r.en || '', d8: dt ? dt.d8 : '', t8: dt ? dt.t8 : ''
      }]
    };
    // ⚠️ 同一次发射在表里可能有多行（A/B/K 多载荷，COSPAR 只差后缀字母）→ **合并**而不是覆盖：
    //    已存在的非空字段保留，空字段由后行补齐（防止"无研发机构"的行把有机构的行覆盖成 null）。
    // ★ V1.9.5（H13/H19）：`names` / `nameLinks` 必须**并集** —— 多载荷行各带自己的载荷名与词条，
    //    "留第一个非空"会把后一行的星整批丢掉（2019-077A/B、2026-128A/B、2026-211K 实测存在）。
    //    `en`（千帆表的英文名）同理，两行都有值时用 ' / ' 连接。
    const old = map[cos];
    if (old) {
      for (const f of ['name', 'site', 'siteUrl']) if (!old[f] && row[f]) old[f] = row[f];
      if (!old.mk && row.mk) old.mk = row.mk;
      if (!old.d8 && row.d8) { old.d8 = row.d8; old.t8 = row.t8; old.ms8 = row.ms8; }
      if (!Array.isArray(old.names)) old.names = old.name ? [old.name] : [];
      row.names.forEach(nm => { if (nm && old.names.indexOf(nm) < 0) old.names.push(nm); });
      if (!Array.isArray(old.nameLinks)) old.nameLinks = [];
      const have = new Set(old.nameLinks.map(x => x && x.u));
      row.nameLinks.forEach(x => { if (x && x.u && !have.has(x.u)) { old.nameLinks.push(x); have.add(x.u); } });
      // ★★ V1.9.9.630（对抗性测试抓出）：`en` 累加**必须去重**。
      //   病根：多载荷批次（一句话里有 A/B 两颗）在千帆表里是**多行、每行都填同一个英文名对**
      //   （`KL-Alpha A / KL-Alpha B`）。旧写法 `old.en !== row.en` 只挡住"完全相同"，
      //   挡不住"A / B"与"A / B"再次相加 → 实测 3 个批次长出 12 项、其中只有 2 个唯一值：
      //     qf 2019-077 → KL-Alpha A / KL-Alpha B / …（重复 6 遍）
      //     qf 2021-070 / qf 2026-211 同病。
      //   现按 ' / ' 拆开、逐项去重（保持首次出现顺序）后再拼回。
      // ★★ V1.9.9.630（第二次修，这才是治本）：上面的去重**只作用于"新加进来的项"**，
      //   而 `out.gw = old.gw` 是**旧文件的直接引用** —— 已经写进磁盘的脏值（12 项 / 2 唯一）
      //   在合并时被原样当作 `parts` 的起点，`seen` 里全是它自己，于是**永远原样保留**。
      //   实测：重抓一次（`--force`）后 3 个批次依旧是 12 项 —— 说明"重跑就能清掉"是错的。
      //   ⇒ 正确做法是让这段**幂等**：先对 `old.en` 自身去重，再加上新项。这样跑 N 次结果一致，
      //   旧脏值也在第一次重抓时被就地洗干净（不需要手删文件、也不需要人工兜底）。
      if (row.en || old.en) {
        const parts = [];
        const seen = new Set();
        const push = (s) => { s.split(' / ').map(x => x.trim()).filter(Boolean).forEach(e => { if (!seen.has(e)) { seen.add(e); parts.push(e); } }); };
        push(String(old.en || ''));      // ← 先洗旧值（幂等的关键）
        push(String(row.en || ''));      // ← 再加本次抓到的
        old.en = parts.join(' / ');
      }
      // ★ V2.0.1（C7）：行级明细追加（每行的章节各自保留）
      if (!Array.isArray(old.rows)) old.rows = [];
      old.rows.push(row.rows[0]);
      n++;
      continue;
    }
    map[cos] = row;
    n++;
  }
  // ★★ V2.0.1（C6/C7）：从**行级明细**统一派生 `secs` / `bySec`/ `sec` ★★
  //   为什么不在合并时增量维护：增量维护最容易写错（漏一次就永久错），而 rows 是完整事实，
  //   事后一次算清既正确又幂等。C7 要的"章节不丢"，本质就是把这张表补回来。
  //     · `sec`   —— 只有一个章节时才写（绝大多数批次），下游最省事的读法
  //     · `secs`  —— 该批次跨了哪些章节（去重，保持出现顺序）
  //     · `bySec` —— { 章节: [该章节里的载荷名...] }，R14 按章节过滤载荷直接用
  for (const kk of Object.keys(map)) {
    const e = map[kk];
    const rws = Array.isArray(e.rows) ? e.rows : [];
    const secs = [];
    const bySec = {};
    for (const x of rws) {
      const s = String(x.sec || '');
      if (!s) continue;
      if (secs.indexOf(s) < 0) secs.push(s);
      if (x.name) (bySec[s] = bySec[s] || []).push(x.name);
    }
    if (secs.length) {
      e.secs = secs;
      e.bySec = bySec;
      if (secs.length === 1) e.sec = secs[0]; else delete e.sec;
    } else {
      delete e.secs; delete e.bySec; delete e.sec;
    }
  }
  console.log(key + '：' + n + ' 行（' + Object.keys(map).length + ' 个 COSPAR）'
    + '｜章节：' + [...new Set(Object.values(map).flatMap(e => e.secs || []))].join(' / '));
  // 多章节批次单独打一行 —— 它们正是 C7/R14 的对象，人工核对时看得见
  {
    const multi = Object.keys(map).filter(kk => (map[kk].secs || []).length > 1);
    if (multi.length) {
      console.log('  多章节批次 ' + multi.length + ' 个：');
      multi.slice(0, 8).forEach(kk => console.log('    ' + kk + ' → ' + JSON.stringify(map[kk].bySec)));
    }
  }
}
if (!okPages) {
  console.log('!! 两个词条都没抓到 —— 保留原文件不动（不写坏数据）');
  BROWSER.cleanup();
  process.exit(1);
}
const ts = [fetchedAt.gw, fetchedAt.qf].filter(t => t != null);
out._fetched = new Date(Math.min.apply(null, ts.length ? ts : [Date.now()])).toISOString();
if (fetchedAt.gw) out._fetched_gw = new Date(fetchedAt.gw).toISOString();
if (fetchedAt.qf) out._fetched_qf = new Date(fetchedAt.qf).toISOString();
// ★ V1.9.9.630：丢弃明细随数据一起落盘（`_dropped`），并打印一行摘要。
//   为什么不只写日志：日志会被计划任务覆盖/轮转，而"这条数据为什么没有"是**长期**问题；
//   与数据放在同一份文件里，任何时候打开都能对照。
//   形状：[{ key:'gw'|'qf', cospar:'2025-F05', name:'…', reason:'…' }]
if (DROPPED.length) {
  out._dropped = DROPPED;
  console.log('丢弃取证：' + DROPPED.length + ' 条（明细见 _dropped）');
  DROPPED.slice(0, 10).forEach(d => console.log('   · [' + d.key + '] ' + (d.cospar || '(空)') + ' ' + d.name + ' → ' + d.reason));
  if (DROPPED.length > 10) console.log('   …（其余 ' + (DROPPED.length - 10) + ' 条同类）');
} else {
  delete out._dropped;
  console.log('丢弃取证：0 条（全部行都已入库）');
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 1), 'utf8');
console.log('写入', OUT, fs.statSync(OUT).size, 'bytes');
console.log('抓取时间：gw ' + (out._fetched_gw || '?') + '｜qf ' + (out._fetched_qf || '?'));
// ★ V1.9.9.630：失利批次（F 编号）单独打一行 —— 它们是**最容易再次静默消失**的一类。
for (const k of ['gw', 'qf']) {
  const fs_ = Object.keys(out[k] || {}).filter(x => /-F\d+$/.test(x));
  if (fs_.length) console.log(k + ' 失利批次：' + fs_.join(', ') + '（来源：词条表；无国际编号，key 形如 2025-F05）');
}
// 抽样打印，人工核对用
const sample = Object.keys(out.gw).slice(-3).map(k => k + '=' + out.gw[k].d8 + (out.gw[k].t8 ? ' ' + out.gw[k].t8 : '') + '/' + (out.gw[k].mk ? out.gw[k].mk.m : '(无制造商)'));
console.log('gw 抽样:', sample.join(' | '));
BROWSER.cleanup();
process.exit(0);
