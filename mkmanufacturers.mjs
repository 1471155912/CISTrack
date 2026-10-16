// mkmanufacturers.mjs —— ★ V1.9.5（H9）：从**百科单源**派生制造商索引（不再自己抓网页）
// ---------------------------------------------------------------------------
// 背景（H9 = "百科来源表格有错漏"的根治）：同一批词条表原来被多个脚本各抓各的 ——
//   `scripts/fetch_wiki_tables.mjs` 现在是**唯一**的抓取器（一次抓取 → data/wiki_tables.json）；
//   本脚本只做派生：把单源里的「研发机构」按 COSPAR / 日期 / 发射场建成索引，
//   写 data/manufacturers.json（供 mkdata.mjs 注入每个批次的制造商列）。
//   数据陈旧时提示去跑抓取器（本脚本**不联网** —— CI 与离线环境都能跑）。
//
// 用法：node mkmanufacturers.mjs [--cached]
//   · 默认：单源超过 3 天 → 打印提示（不抓，只提醒；抓取由 update_wiki.bat 先跑 fetch_wiki_tables.mjs）；
//   · --cached：连提示也不打（CI / 离线构建用）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const WT = path.join(ROOT, 'data', 'wiki_tables.json');     // 单源（H9）
const OUT = path.join(ROOT, 'data', 'manufacturers.json');  // 派生索引
const QUIET = process.argv.includes('--cached');
const MAX_AGE_DAYS = 3;

let WTJ = null;
try {
  WTJ = JSON.parse(fs.readFileSync(WT, 'utf8'));
} catch (e) {
  console.error('!! data/wiki_tables.json 读不到（' + (e.code || e.message) + '）——');
  console.error('   先跑一次：node scripts/fetch_wiki_tables.mjs（需要能过卫星百科 WAF 的网络环境）');
  process.exit(1);
}
const ageDays = WTJ._fetched ? (Date.now() - Date.parse(WTJ._fetched)) / 86400000 : Infinity;
console.log('单源 wiki_tables.json：gw ' + Object.keys(WTJ.gw || {}).length + ' / qf ' + Object.keys(WTJ.qf || {}).length +
  ' 项｜更新于 ' + (WTJ._fetched || '?') + '｜已 ' + (isFinite(ageDays) ? ageDays.toFixed(1) : '?') + ' 天');
if (!QUIET && (!isFinite(ageDays) || ageDays > MAX_AGE_DAYS)) {
  console.log('提示：单源已超过 ' + MAX_AGE_DAYS + ' 天 —— 跑 node scripts/fetch_wiki_tables.mjs 刷新' +
    '（本次仍用现有数据派生，不阻断构建）');
}

// ---- 派生三套索引（与旧版 manufacturers.json 的消费形状完全一致）----
const byCospar = {}, byDate = {}, bySite = {};
for (const bk of ['gw', 'qf']) {
  for (const [cos, r] of Object.entries(WTJ[bk] || {})) {
    const hit = r.mk ? { manufacturer: r.mk.m, url: r.mk.url || '', links: r.mk.links || [] } : null;
    if (hit && !byCospar[cos]) byCospar[cos] = hit;
    if (hit && r.d8 && !byDate[r.d8]) byDate[r.d8] = hit;
    if (r.site && r.siteUrl) {
      if (!bySite[r.site]) bySite[r.site] = { u: r.siteUrl };
      const k1 = String(r.site).split(/\s/)[0];
      if (k1 && !bySite[k1]) bySite[k1] = { u: r.siteUrl };
    }
  }
}
fs.writeFileSync(OUT, JSON.stringify({
  _fetched: WTJ._fetched, _src: 'derived from data/wiki_tables.json (H9 单源)',
  byCospar: byCospar, byDate: byDate, bySite: bySite,
}, null, 1), 'utf8');
console.log('写入', OUT, fs.statSync(OUT).size, 'bytes');
console.log('COSPAR 索引', Object.keys(byCospar).length, '项｜日期索引', Object.keys(byDate).length, '项｜发射场索引', Object.keys(bySite).length, '项');
console.log('样例:', Object.keys(byCospar).slice(-4).map(k => k + '=' + byCospar[k].manufacturer).join(' | '));
