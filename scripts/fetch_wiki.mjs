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
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpRoot } from './tmproot.mjs';
import { openBrowser, waitContent } from './cdp.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'wiki.json');
// V1.8.0：无头浏览器的用户数据目录默认落在 os.tmpdir()，本机 C 盘长期紧张 →
//   由环境变量 CISTRACK_TMP 指到其它盘，其次用系统 TEMP/TMP。
//   （V1.8.0 收尾：原来这里写死了某个本机盘符路径 —— 换台机器就跑不起来，
//     而且会把本机路径带进发布仓，所以一律改成环境变量驱动。）
// V1.9.1（1.4-C）：统一走 scripts/tmproot.mjs —— 本机**自动优先非系统盘**。
//   （原来的候选顺序把 TEMP 排在前，而本机 TEMP 在 C 盘 → 浏览器 profile 全落 C 盘，
//     删除又被 safe-delete 守卫改成"移入回收站"→ 只增不减，把 C 盘回收站堆到 2.4 GB。）
const TMPROOT = tmpRoot();
const PAGES = [
  ['gw', 'https://sat.huijiwiki.com/wiki/%E6%98%9F%E7%BD%91', '星网'],
  ['qf', 'https://sat.huijiwiki.com/wiki/%E5%8D%83%E5%B8%86%E6%98%9F%E5%BA%A7', '千帆星座'],
];

// ★★ V1.9.9.630：浏览器定位 / CDP / 挑战页判据已抽到 scripts/cdp.mjs（唯一权威实现）。
//   本文件原来那份 `findBrowser` / `cdp` / 挑战判据是四个脚本里**最完整**的一份
//   （V1.9.3 修过"漏英文挑战页"），但它修好后另外三个脚本并没有跟上 ——
//   这就是"同一类 bug 反复复发"的结构性原因。现在四份合一，本文件只是调用方。
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- 一次抓取
async function fetchArticle(url, { timeoutMs = 90000, pollMs = 2000 } = {}) {
  const h = await openBrowser({ tmpRoot: TMPROOT, bootMs: 30000 });
  try {
    const { c } = h;
    // 过 WAF：**标题 + 内容探针双判据**（判据细节见 scripts/cdp.mjs `waitContent`）。
    //   ★★★ V1.9.3（CI 诊断 38530602731 / 38531482688 实测抓到真因）—— 这段历史保留在此，
    //     因为它是本仓库最重要的一次"静默失败"教训，且现在成了 cdp.mjs 的固有条文：
    //   旧判据只有一句：
    //       if (title && !/请稍候/.test(title)) { ok = true; break; }
    //   而 Cloudflare 挑战页的标题是**英文** `Just a moment...`（诊断2 的裸 fetch
    //   实测确认：`<title>Just a moment...</title>`），**不含"请稍候"**。
    //   ⇒ 挑战页一出现就被判成"已通过 WAF"，`await sleep(1500)` 后直接读
    //     `body.innerHTML` —— 拿到的是那 5.7KB 的挑战页 → `infobox-label` 找不到 → 解析失败。
    //   这就是"两个星座各一半概率失败"的真因：不是限流，是**判据漏了英文标题**，
    //   每次能不能成取决于 Cloudflare 那一次要不要先甩个挑战页。
    //   新判据（两条都要满足，缺一不可）：① 标题不像挑战页；② 页面里**真的出现了
    //   infobox-label**（我们要的内容本身）。
    const w = await waitContent(c, url, {
      tries: 1,                                  // 重试由本文件的逐星座循环负责（它有自己的 8s 间隔）
      waitMs: timeoutMs, pollMs: pollMs,
      contentProbe: 'document.body && document.body.innerHTML.indexOf("infobox-label") >= 0',
      settleMs: 800,
    });
    if (!w.ok) {
      const len = await c.ev('document.body ? document.body.innerHTML.length : 0').catch(() => 0);
      throw new Error('词条未通过 WAF 验证或内容未渲染（title=' + JSON.stringify(w.title) + '，html 长度 ' + len + '）');
    }
    const html = await c.ev('document.body.innerHTML');
    return { html, title: w.title };
  } finally {
    h.cleanup();
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
  // ★ V1.9.3（CI 诊断 38530602731 实测）：两个星座**背靠背连抓**时，第二个（gw）
  //   只拿到 5467 字节、没有 infobox —— 典型的"刚过完挑战又被限流"。
  //   每个星座抓完**歇 8 秒**再抓下一个，给 Cloudflare 一个消化时间。
  //   本机任务总耗时多 8 秒无所谓，CI 上换来的是"两个都能抓到"。
  if (Object.keys(stats).length) { console.error('（间隔 8s 再抓下一个，避免刚过挑战就被限流）'); await sleep(8000); }
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
  // ★★ V1.9.9.630（治本）：**`asOf` 必须是北京时间日期，且与下面顶层的 `today` 同源。**
  //   旧写法是 `new Date().toISOString().slice(0,10)` —— 那是 **UTC** 日期。
  //   而下面的顶层 `asOf` / `checkedAt` 用的是 `bj`（北京，V1.9.8 为修"12:00 显示成 04:00"改的）。
  //   两条口径并存 → 每天**北京 00:00 那一轮必然差一天**：
  //     北京 10-21 00:00 抓取 → UTC 还是 10-20 → `gw.asOf = 2026-10-20`，
  //     而同一次运行写了 `asOf: 2026-10-21`。于是同一个文件里两个"截至日"互相矛盾。
  //   为什么这会变成**页面上看得见的回退**（实测 382957d）：
  //     mkdata.mjs 的顶层 `asOf` 取的是 `WIKI_STAT.gw.asOf`（= 这个 UTC 值）→
  //     CI 在北京 00:00 那一轮每次产出 `asOf: 2026-10-20`，把上一轮本机任务写的
  //     `2026-10-21` **改回旧日期**。build.mjs 的防回退守卫也拦不住
  //     （它只在"计数相同且日期更旧"时拦，而这里计数没变、日期确实更旧 —— 本该拦住，
  //      但它是拿 build 副本与仓库副本比，mkdata 已经把旧值写进 build 了，两侧一致 → 放过）。
  //   ⇒ 一处口径错误，污染了"抓取 → mkdata → build → 页面"整条链。**只改一处不够**，
  //     所以本轮同时改了 mkdata.mjs 的顶层取值（那里改成取 gw/qf 的 max，双向兜住）。
  const bjDay = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);   // 北京时间日期
  stats[key] = Object.assign({ asOf: bjDay, article }, st);
  console.log(key, '→', JSON.stringify(stats[key]));
}

// ★ V1.9.3（2026-10-14 CI 诊断时暴露）：读旧 wiki.json **必须容错**。
//   旧版是裸 `JSON.parse(fs.readFileSync(OUT, 'utf8'))` —— 文件一旦不存在
//   （全新 checkout、CI 里被 rm 过、或手工清理）就抛 ENOENT **整个脚本崩掉**，
//   连"至少成功一个星座就写文件"的降级逻辑都走不到。
//   现在是：读不到/解析不了都当作"没有旧数据"（old = {}），继续往下走。
let old = {};
try { old = JSON.parse(fs.readFileSync(OUT, 'utf8')) || {}; } catch (e) {
  console.error('读旧 wiki.json 失败（' + (e && e.code ? e.code : e && e.message) + '），按"无旧数据"继续');
}
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
// ★ V1.9.8（O24/Q34）：页面把这一行标成「（北京时间）」/「(UTC+8)」，所以**必须写北京时间**。
//   旧写法用 toISOString()（UTC），于是页面上的时分永远比真实北京时间早 8 小时
//   （实测：某次 12:00 的核对被显示成 04:00）。
const bj = new Date(now.getTime() + 8 * 3600 * 1000);
const today = bj.toISOString().slice(0, 10);
const checkedAt = bj.toISOString().slice(0, 16).replace('T', ' ');   // YYYY-MM-DD HH:MM (UTC+8)
const oldAsOf = old.asOf || '';

// ★★ V1.9.9.630（治本）：**必须先把 base 补全再比"有没有变"。**
//   旧写法的分母是"这一次抓到的 stats"，而 `stats` 里**只有成功的那几个星座**
//   （失败的 key 被 `continue` 跳过了）。于是：
//     · qf 抓失败 → `numbersSame` 里的 `old.qf`、`stats.qf` 至少一个为空 → **恒 false**
//       → 判"有变化" → 写文件；
//     · 但写出去的是 `stats`（只有 gw）→ **qf 整块被抹掉**。
//   炸点在下一步：mkdata 读 wiki.json 的判据是
//       `if (w && w.gw && w.qf && w.gw.launched && w.qf.launched) WIKI_FETCHED = w;`
//   → 缺 qf ⇒ **整份 wiki.json 被丢弃** ⇒ 连"这一轮抓成功的 gw"也一起作废，
//   退回写死的 WIKI_STATIC（`asOf:''`、计数是几个版本前的老值）。
//   所以"一个星座失败"的代价不是"少一半"，而是**退到内置静态兜底**。
//   ⇒ 正确做法：以**旧文件为基底**，成功的星座覆盖上去（与 fetch_wiki_tables.mjs 的
//     `out.gw = old.gw || {}` 完全同一套口径 —— 那个脚本早就这么做，这个没跟上）。
const base = Object.assign({}, old);
['gw', 'qf'].forEach(k => { if (stats[k]) base[k] = stats[k]; });
// 比"有没有变"要用**补全后**的 base，不是只用本次抓到的
const numbersSame = ['gw', 'qf'].every(k =>
  base[k] && old[k] && old[k].launched && base[k].launched &&
  old[k].launched.n === base[k].launched.n &&
  old[k].inOrbit && base[k].inOrbit && old[k].inOrbit.n === base[k].inOrbit.n &&
  old[k].launches === base[k].launches);
const fullyRead = failed.length === 0;            // 两个星座都成功读到
if (numbersSame && !(fullyRead && oldAsOf !== today)) {
  console.log('统计无变化' + (fullyRead ? '且今日已核对过' : '（本次未读全，核对时间不前进）') + '，跳过更新');
  process.exit(0);
}
if (!fullyRead) {
  console.log('⚠️ 本次未读全（' + failed.join(',') + ' 失败）—— 该星座**沿用上一轮数据**，不写空。'
    + '（写空会让 mkdata 退回内置静态值，连抓成功的那一半也一起作废。）');
}

base._readme = old._readme;
base.asOf = today;
base.checkedAt = fullyRead ? checkedAt : (old.checkedAt || '');
// ★ O30-12（V1.9.9 收尾）：保留卡片抓取状态键 —— 本脚本不抓卡片，补丁由 fetch_wiki_cards.mjs 写；
//   这里若不保留，一次"统计无变化也要写核对时间"的更新就会把 `cards` 键抹掉（页面状态行空白）。
if (old.cards) base.cards = old.cards;
fs.writeFileSync(OUT, JSON.stringify(base, null, 1) + '\n', 'utf8');
console.log('wiki.json 已更新'
  + (numbersSame ? '（数字未变，仅更新核对时间）' : '')
  + (fullyRead ? '' : '；**未读全**（' + failed.join(',') + '），核对时间保持原值')
  + '  核对时间=' + (fullyRead ? checkedAt : (old.checkedAt || '无')));
