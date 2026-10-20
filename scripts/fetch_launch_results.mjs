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
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpRoot } from './tmproot.mjs';
import { openBrowser, waitContent } from './cdp.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'wiki_launches.json');
const SATDATA = path.join(ROOT, 'build', 'satdata.json');
const DUMP = process.argv.includes('--dump');
// V1.8.0：无头浏览器的用户数据目录默认落在 os.tmpdir()，本机 C 盘长期紧张 →
//   由环境变量 CISTRACK_TMP 指到其它盘，其次用系统 TEMP/TMP。
//   （V1.8.0 收尾：原来这里写死了某个本机盘符路径，已改为环境变量驱动。）
// V1.9.1（1.4-C）：统一走 scripts/tmproot.mjs —— 本机**自动优先非系统盘**。
//   （原来的候选顺序把 TEMP 排在前，而本机 TEMP 在 C 盘 → 浏览器 profile 全落 C 盘，
//     删除又被 safe-delete 守卫改成"移入回收站"→ 只增不减。）
const TMPROOT = tmpRoot();

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
// ★ V1.9.4：**目录里已有卫星的 COSPAR 前缀**（不管台账补没补）。
//   新批次的生命周期：先被 CelesTrak 编目（TLE 里有星）→ 人看到后再往台账加元数据。
//   旧口径只认台账 → 这个窗口期内的行全被丢掉。现在两侧并集，窗口期也能抓到。
function catalogPrefixes() {
  const out = new Set();
  try {
    const sd = JSON.parse(fs.readFileSync(SATDATA, 'utf8'));
    ['gw', 'qf'].forEach(k => {
      ((sd[k] || {}).sats || []).forEach(s => {
        const c = String(s.c || '');
        if (/^\d{4}-\d{3}/.test(c)) out.add(c.slice(0, 8));
      });
    });
  } catch (e) {}
  return out;
}
// 行 → 结构化字段。发射记录表的列序为：COSPAR | 日期 | 运载火箭 | 发射场 | 载荷 | 结果 | 备注
//   （列数/顺序各年份页可能不同，所以**按内容特征定位**，不按下标硬取）：
//     · 日期   = 匹配 YYYY年M月D日 的格
//     · 火箭   = 日期格之后、发射场之前（含「长征/朱雀/引力/快舟/捷龙」等字样）
//     · 发射场 = 命中已知发射场名单的格
//     · 载荷   = 发射场之后到结果之前的格（批次名/颗数在这格）
//     · 结果   = 命中结果词的格
function parseRow(row) {
  const cells = row.cells || [];
  const iDate = cells.findIndex(c => /\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日/.test(c.t));
  if (iDate < 0) return null;
  const dm = cells[iDate].t.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  const date = dm[1] + '-' + dm[2].padStart(2, '0') + '-' + dm[3].padStart(2, '0');
  const SITES = ['文昌', '太原', '西昌', '酒泉', '海阳', '海商', '东方航天港', '南海', '东海', '黄海'];
  let iSite = -1, iRes = -1;
  for (let i = iDate + 1; i < cells.length; i++) {
    if (iSite < 0 && SITES.some(s => cells[i].t.indexOf(s) >= 0)) { iSite = i; continue; }
    if (iRes < 0 && /成功|失败|失利|圆满成功|部分成功|待观测/.test(cells[i].t)) { iRes = i; }
  }
  if (iSite < 0 || iRes < 0) return null;
  const rocket = (cells[iDate + 1] && iDate + 1 !== iSite) ? cells[iDate + 1].t : '';
  const site = cells[iSite].t;
  const payCells = cells.slice(iSite + 1, iRes);
  const payload = payCells.map(c => c.t).join(' ');
  return {
    date: date,
    rocket: rocket,
    site: site,
    payload: payload,
    res: resultOf(row.txt),
    n: countOf(payload) || countOf(row.txt),
    // 词条链接：优先取载荷格里的链接（批次词条），其次发射场格（发射场词条）
    u: (payCells.find(c => c.u) || {}).u || (cells[iSite] || {}).u || ''
  };
}

// ---------------------------------------------------------------- 浏览器 / CDP（★ V1.9.9.630 起走 scripts/cdp.mjs）
// 本文件原来自己写了一份 `findBrowser()` + `cdp()` + **只认中文的**挑战判据
//   （`if (title && !/请稍候/.test(title)) { ok = true; break; }`）。
//   那是本仓库最危险的一类 bug 的活标本：
//     · Cloudflare 挑战页的标题是**英文** `Just a moment...`
//       （`fetch_wiki.mjs` 在 V1.9.3 就实测确认过，并因此崩溃过几个月）；
//     · 只认中文 → 挑战页被判成"已通过" → 接着去页面里查 `<tr>` → **0 行**；
//     · 而 0 行在本脚本里的含义是"那一年真的没有发射"（`if (!got.rows.length) failedYears.push(y);`
//       —— 连 failed 都只是"未读全"的提示，不是失败）→ 于是**整年的发射结果静默丢失**，
//       下次运行还会用 `_stale` 把旧值保留下来，看起来一切正常。
//   ⇒ 判据只该有一份。这里改成调用 cdp.mjs 的 `waitContent`，并且**必须用内容探针**
//     （页面上真的出现了"年份 + COSPAR 编号"的行）才算过 —— 光标题正常不算数。
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 页面里是否真的有一张"发射记录表"（内容探针，交给 cdp.mjs 轮询） */
const HAS_LAUNCH_TABLE = `(() => {
  const trs = document.querySelectorAll('tr');
  let n = 0;
  for (const tr of trs) {
    const t = (tr.innerText || '');
    if (/\\b\\d{4}-\\d{1,3}\\s?[A-Z]?\\b/.test(t) || /\\d{4}\\s*年\\s*\\d{1,2}\\s*月/.test(t)) n++;
    if (n >= 3) return true;                     // 至少 3 行像发射记录 → 认定表真的渲染了
  }
  return false;
})()`;

async function fetchArticle(url, { timeoutMs = 90000, pollMs = 2000 } = {}) {
  // V1.8.0：本机偶发「浏览器没能在 10s 内启动调试端口」（与残留 msedge 进程争抢有关）→
  //   等待窗口 30s，并由主流程对这一整年再重试 3 次。
  const h = await openBrowser({ tmpRoot: TMPROOT, bootMs: 30000 });
  try {
    const { c } = h;
    // 过 WAF：**标题 + 内容探针双判据**（详见 scripts/cdp.mjs `waitContent`；
    //   本文件原来只判中文标题 —— 那是"整年发射结果静默丢失"的根因，见上方长注释）
    const w = await waitContent(c, url, {
      tries: 1,                       // 重试交给主流程的"逐年 3 次"（那里还带 2.5s 退避）
      waitMs: timeoutMs, pollMs: pollMs,
      contentProbe: HAS_LAUNCH_TABLE, settleMs: 1500,
    });
    if (!w.ok) {
      throw new Error('发射记录页未通过 WAF 验证或表格未渲染（title=' + JSON.stringify(w.title) + '）');
    }
    // 在页面里把每一行拆成「单元格数组」：每格 = { t: 文本, u: 词条链接 }。
    // ★ V1.9.4：改成**保留全部本星座行**（原先只留台账已有的 COSPAR）。
    //   为什么：新批次（如 26230）先在 TLE 目录里出现、台账还没人手补 → 旧口径直接把它
    //   丢掉，页面就永远显示「无台账」、没有批次名/制造商/发射日期/词条链接。
    //   新口径：凡是**目录里已有该批次卫星**的行一律保留（全球其它发射与本研究无关）。
    const rows = await c.ev(`(() => {
      const out = [];
      document.querySelectorAll('tr').forEach(tr => {
        const cells = [].slice.call(tr.querySelectorAll('td,th')).map(function (el) {
          var a = el.querySelector('a[href]');
          return {
            t: (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim(),
            u: a ? a.getAttribute('href') : ''
          };
        });
        var txt = (tr.innerText || tr.textContent || '').replace(/\\s+/g, ' ').trim();
        if (!txt || txt.length > 600 || !cells.length) return;
        // COSPAR 序号是 3 位零填充（2019-077A）；页面里可能写成 2019-77A，统一补齐到 3 位。
        // ★★ V1.9.9.630（治本）：**必须先认 F 编号**（发射失利/取消批次，如 2025-F05）——
        //   这类批次没有国际编号，卫星百科用「年-F序号」标记。旧正则只认纯数字
        //   （四位年 + 短横 + 一到三位数字），遇到 2025-F05 直接 return → 整行被丢在解析层，
        //   连"台账未匹配"的提示都拿不到原因。与 fetch_wiki_tables 的 normCospar 是同一类漏，
        //   两处都要认，否则词条表里有这一发、发射结果却永远缺它。
        //   实测（2026-10-21）：修前 "未匹配到结果的台账条目(1)：2025-F05"；
        //   修后应能匹配到（发射记录页 2025 年确有这一行）。
        var m = txt.match(/\\b(\\d{4})-F(\\d{1,3})\\b/i);
        if (m) { out.push({ cos: m[1] + '-F' + String(+m[2]).padStart(2, '0'), txt: txt, cells: cells }); return; }
        m = txt.match(/\\b(\\d{4})-(\\d{1,3})\\s?[A-Z]?\\b/);
        if (!m) return;
        out.push({ cos: m[1] + '-' + String(+m[2]).padStart(3, '0'), txt: txt, cells: cells });
      });
      return out;
    })()`);
    const title = w.title;
    return { rows: rows || [], title };
  } finally {
    h.cleanup();
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
const want = new Set([...ledgerPrefixes(), ...catalogPrefixes()]);   // 台账 ∪ 目录（V1.9.4）
console.log('台账年份: ' + years.join(','));
console.log('保留行口径: 台账 ' + ledgerPrefixes().size + ' 个 ∪ 目录 ' + catalogPrefixes().size + ' 个 COSPAR');

const found = {};        // '2026-210' → { res, n, date, rocket, site, payload, u }
const failedYears = [];
// ★★ V1.9.9.630：**全局时间预算**（抗干扰，与 refresh.mjs 同一思路）。
//   病根：每个年份最多重试 3 次、每次 90s 超时 → 6 年最坏 27 分钟。
//   这个脚本在 CI 里跑在 `timeout-minutes: 15`（update-wiki.yml）之下，
//   一旦 WAF 变慢/网络抖动，job 会被**无声强杀**：没有日志、没有退出码、也没写盘，
//   看起来就像"这轮没跑"——最难查的那种失败。
//   取舍：宁可**少抓一年**并显式记账，也不要跑到被强杀、什么都没留下。
//   （已读到的年份照常写盘；跳过的年份进 `skippedYears` 并打印，不伪装成"该年没有发射"。）
const BUDGET_MS = (() => {
  const v = Number(process.env.CISTRACK_LAUNCH_BUDGET_MIN);
  return (isFinite(v) && v > 0 ? v : 11) * 60000;      // 默认 11 分钟（< CI 的 15 分钟上限）
})();
const T0 = Date.now();
const elapsedMs = () => Date.now() - T0;
const skippedYears = [];
for (const y of years) {
  // 预算用尽 → 后续年份不再尝试（已抓到的照常保留、照常写盘）
  if (elapsedMs() > BUDGET_MS) {
    skippedYears.push(y);
    continue;
  }
  const url = 'https://sat.huijiwiki.com/wiki/' + encodeURIComponent('引导页:发射记录/' + y);
  let got = null, lastErr = null;
  for (let attempt = 1; attempt <= 3 && !got; attempt++) {          // V1.8.0：逐年重试 3 次
    // 重试前也看一眼预算：别为了第 3 次重试把整个 job 拖进超时
    if (elapsedMs() > BUDGET_MS) { lastErr = new Error('超出时间预算，放弃剩余重试'); break; }
    try { got = await fetchArticle(url); }
    catch (e) { lastErr = e; if (attempt < 3) await sleep(2500); }
  }
  if (!got) {
    // 区分"预算用尽"与"真失败"：前者不是故障，别用"抓取失败"这种词吓人，
    //   但**必须显式说出来**（否则读者会以为"这一年真的没有发射"）。
    const outOfBudget = elapsedMs() > BUDGET_MS;
    if (outOfBudget) {
      console.error(y + ' 年：**超出时间预算（' + Math.round(BUDGET_MS / 60000) + ' 分钟）未抓取**'
        + ' —— 不是故障，但这一年的数据仍是上一轮的（已标 _stale 保留）。'
        + '如需抓全，调大 CISTRACK_LAUNCH_BUDGET_MIN 再单独跑一次。');
      skippedYears.push(y);
    } else {
      console.error(y + ' 年抓取失败（3 次）：' + (lastErr && lastErr.message));
      failedYears.push(y);
    }
    continue;
  }
  let hit = 0, newHit = 0;
  got.rows.forEach((row) => {
    if (!want.has(row.cos) || found[row.cos]) return;
    const p = parseRow(row);
    if (!p) { if (DUMP) console.log('  [' + row.cos + '] 拆列失败: ' + row.txt.slice(0, 100)); return; }
    found[row.cos] = p;
    hit++;
    // V1.9.4：台账里没有、目录里有卫星的新批次 —— 单独计数，构建端据此补元数据
    if (!ledgerPrefixes().has(row.cos)) { newHit++; if (DUMP) console.log('  [新批次 ' + row.cos + '] ' + JSON.stringify(p)); }
    if (DUMP) console.log('  [' + row.cos + '] ' + row.txt);
  });
  console.log(y + ' 年：页面行 ' + got.rows.length + '，保留 ' + hit + '（其中台账外新批次 ' + newHit + '）');
  if (!got.rows.length) failedYears.push(y);                        // 页面拿到但一行都没解析出来也算未读全
}

const hits = Object.keys(found).length;
if (!hits) {
  console.error('一个年份都没匹配到台账记录，放弃更新（保留原 wiki_launches.json）');
  process.exit(1);
}

const now = new Date();
// ★★ V1.9.9.630：日期/时间一律**北京时间**（与 fetch_wiki.mjs 同一口径）。
//   旧实现用 `now.toISOString()`（UTC）→ 北京 00:00 那轮会写成前一天 16:00，
//   与 wiki.json 的 `checkedAt`（北京时间）对不上，页面「卫星百科更新」看起来像落后一天。
const bjNow = new Date(now.getTime() + 8 * 3600 * 1000);
const out = {
  _readme: '星网/千帆逐次发射的任务结果（来源：卫星百科「引导页:发射记录/<年>」，res: ok=成功 part=部分成功 fail=失败 ?=未记载；n=该发颗数（页面没写就不记）；date/rocket/site/payload = V1.9.4 起保留的整行拆列，供构建端给"目录里已有卫星但台账未补"的新批次自动补元数据；u = 词条链接）。由 scripts/fetch_launch_results.mjs 自动更新。',
  asOf: bjNow.toISOString().slice(0, 10),
  checkedAt: bjNow.toISOString().slice(0, 16).replace('T', ' '),
  // ★ V1.9.9.630：把"这轮读全了没有"写进产物 —— 否则"某年没抓到"这件事
  //   在下游完全不可见（页面照常显示，只是那年的结果变旧了）。
  //   空数组 = 全读全；有值 = 该年未读全（预算用尽 / 抓取失败，日志里已逐条说明原因）。
  _incompleteYears: [...new Set([...failedYears, ...skippedYears])].sort(),
  launches: {},
};
// 旧文件里已有、这次没抓到的条目保留（比如某年页面临时抽风），但要带上一次的核对时间避免误导读数
let old = {};
try { old = JSON.parse(fs.readFileSync(OUT, 'utf8')).launches || {}; } catch (e) {}
Object.keys(found).forEach(k => {
  const f = found[k];
  out.launches[k] = {
    res: f.res, n: f.n || undefined,
    date: f.date, rocket: f.rocket, site: f.site, payload: f.payload, u: f.u || undefined
  };
});
Object.keys(old).forEach(k => {
  if (!out.launches[k]) out.launches[k] = Object.assign({ _stale: true }, old[k]);
});

fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n', 'utf8');
// V1.9.4：保留口径 = 台账 ∪ 目录（见 want），所以"未匹配"只对**台账**那部分有意义 ——
//   目录侧的新批次本来就是要补的，百科没有才该提示（mkdata 的自动补录会处理）。
const wantLedger = ledgerPrefixes();
console.log('wiki_launches.json 已更新：台账匹配 ' + hits + '/' + wantLedger.size +
  '（保留口径含目录新批次，见上），核对时间=' + out.checkedAt +
  '，耗时 ' + Math.round(elapsedMs() / 1000) + 's（预算 ' + Math.round(BUDGET_MS / 60000) + ' 分钟）' +
  (failedYears.length ? '；**未读全·抓取失败**（' + failedYears.join(',') + '）' : '') +
  (skippedYears.length ? '；**未读全·超预算跳过**（' + skippedYears.join(',') + '）' : ''));
const miss = [...wantLedger].filter(k => !out.launches[k]);
if (miss.length) {
  // ★★ V1.9.9.630：未匹配**必须带原因**，不能只报个 key。
  //   教训：本轮的 `2025-F05` 就只报了个 key，得靠人去读源码才发现是 COSPAR 正则漏了 F 编号。
  //   现在按"F 编号 / 常规"两类给提示，F 编号还额外说明"失利批次常不进发射记录页"这一可能。
  const fMiss = miss.filter(k => /F\d+$/.test(k));
  console.log('未匹配到结果的台账条目(' + miss.length + ')：' + miss.join(', '));
  if (fMiss.length) {
    console.log('  ⓘ 其中 ' + fMiss.length + ' 条是**失利/取消批次**（' + fMiss.join(', ') + '，无国际编号）：'
      + '若发射记录页确实没记这一发，属上游未收录（不是抓取失败）；'
      + '本次已确认 F 编号正则生效——若仍缺，请到对应年份页人工核对。');
  }
  if (miss.length > fMiss.length) {
    console.log('  ⓘ 其余 ' + (miss.length - fMiss.length) + ' 条为常规批次：请检查该年份页是否抓取失败（见上面"未读全"提示）。');
  }
}

// ★★ V1.9.9.630：**写盘完成后显式退出**。
//   为什么必须显式 `process.exit()`（实测踩过）：
//     本脚本全程通过 `openBrowser()` 拉起 msedge 子进程，`cleanup()` 里虽然有
//     `taskkill /T /F`，但那是**异步 spawn**，且 Windows 上偶尔有孙进程（crashpad 等）
//     在父进程 `child.kill()` 之后仍短暂持有 stdout 管道 → Node 的事件循环认为
//     "还有活的句柄"，于是**文件已写完、日志已打完，进程却迟迟不退出**。
//     实测：用 `timeout 120` 包住跑，日志早已打印"wiki_launches.json 已更新（耗时 5s）"，
//     但整条命令耗到 4 分钟才被 timeout 杀掉（EXIT=124）。
//     在 CI 里这会表现为"步骤莫名耗满 timeout-minutes 然后被强杀" —— 明明活干完了。
//   取舍：写到这一步所有落盘动作（writeFileSync）都已完成，是**同步**写、不依赖事件循环，
//     所以此时强制退出不会丢数据；退出码用 exitCode 里已有的值（成功即 0）。
//     `setTimeout` 留 250ms 让最后一批 console 输出 flush 完（Windows 管道偶有缓冲）。
setTimeout(() => { process.exit(typeof process.exitCode === 'number' ? process.exitCode : 0); }, 250);
