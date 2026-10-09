/* _audit13.mjs —— 1.3 词条名单核对（一次性分析脚本，非流水线组件）
 * 口径（用户 Q22）：以卫星百科「星网」「千帆星座」两页表格为**唯一名单**，
 *   与现库逐条比对：批次是否在库、部署颗数是否相符、有无 TLE、有无历史轨道数据。
 * 用法：node audit_wiki.mjs   → 产出 logs/_audit13.md
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));   // 脚本就在项目根
const CACHE = path.join(ROOT, 'data', 'wiki_cache');

const unesc = (s) => s
  .replace(/<sup[^>]*>[\s\S]*?<\/sup>/gi, '')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();
function tables(html) {
  return (html.match(/<table[\s\S]*?<\/table>/gi) || []).map(t =>
    (t.match(/<tr[\s\S]*?<\/tr>/gi) || [])
      .map(tr => (tr.match(/<t[hd][\s\S]*?<\/t[hd]>/gi) || []).map(unesc))
      .filter(r => r.length));
}

/** COSPAR/批次号 → 现库批次 key（YY + 3 位序号） */
function batchKey(cospar) {
  const m = String(cospar || '').match(/^(\d{4})-(.+)$/);
  if (!m) return '';
  const yy = m[1].slice(2);
  const seq = m[2].match(/^\d+/) ? m[2].match(/^\d+/)[0].padStart(3, '0') : m[2];
  return yy + seq;
}

// ---------- 现库 ----------
const sd = JSON.parse(fs.readFileSync(path.join(ROOT, 'build', 'satdata.json'), 'utf8'));
const db = sd.SATDATA || sd;
const HIST = path.join(ROOT, 'data', 'history');

const live = {};      // who -> { launches, satsByKey, histByKey }
for (const who of ['gw', 'qf']) {
  const L = db[who].launches || {};
  const satsByKey = new Map();
  for (const s of (db[who].sats || [])) {
    const k = String(s.c || '').slice(0, 5).replace(/\D/g, '').padStart(5, '0');
    if (!/^\d{5}$/.test(k) && !/^\d{2}[A-Z]\d{2}$/.test(k)) continue;
    const kk = /^\d{5}$/.test(String(s.c || '').slice(0, 5)) ? String(s.c).slice(0, 5) : String(s.c).slice(0, 5);
    if (!satsByKey.has(kk)) satsByKey.set(kk, []);
    satsByKey.get(kk).push(s);
  }
  live[who] = { launches: L, satsByKey: satsByKey };
}
function histCount(key) {
  const p = path.join(HIST, key + '.json');
  if (!fs.existsSync(p)) return 0;
  try { const a = JSON.parse(fs.readFileSync(p, 'utf8')); return Array.isArray(a) ? new Set(a.map(r => r[0])).size : 0; }
  catch (e) { return 0; }
}

// ---------- 词条表 ----------
const xing = tables(fs.readFileSync(path.join(CACHE, 'wiki_xingwang.html'), 'utf8'));
const qian = tables(fs.readFileSync(path.join(CACHE, 'wiki_qianfan.html'), 'utf8'));

// 星网：表 #1 = 试验星（11 列，第 0 列「发射次数」）；表 #2 = 业务星（12 列）
const wikiG = [];
for (const [ti, kind] of [[1, '试验星'], [2, '业务星']]) {
  const rows = xing[ti] || [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.length < 11) continue;
    wikiG.push({ kind: kind, name: r[1], n: parseInt(r[2], 10) || 0, date: r[4], cospar: r[9], result: r[10] });
  }
}
// 千帆：表 #2 = 试验星（10 列，单颗）；表 #3 = 组网星（13 列，按组）
const wikiQ = [];
(qian[2] || []).slice(1).forEach(r => {
  if (r.length < 10) return;
  wikiQ.push({ kind: '试验星', name: r[0], n: 1, date: r[3], cospar: r[9], result: '' });
});
(qian[3] || []).slice(1).forEach(r => {
  if (r.length < 12) return;
  const nm = r[1] || '';
  const m = nm.match(/共(\d+)颗/);
  wikiQ.push({ kind: '组网星', name: nm.replace(/（共\d+颗）/, ''), n: m ? parseInt(m[1], 10) : 0, date: r[4], cospar: r[11], result: '' });
});

// ---------- 比对 ----------
// ★ 关键归批口径：词条表里**同一 COSPAR 前缀可能对应多个条目** ——
//   因为"一次发射"里可以有多个任务/多颗单独记载的卫星。实例：
//     2026-211  = 千帆极轨26组（8 颗）+ EUHT技术试验卫星（1 颗，分片 K）
//     → 共享前缀 `26211`，库内合计 9 颗。若按"行"逐条比，两边都会误报"颗数不符"。
//   所以先把词条行**按批次 key 聚合**，再与库比 —— 这样"颗数"才是可比的量。
const out = [];
function audit(who, wiki, title) {
  const L = live[who].launches, S = live[who].satsByKey;
  // 聚合：key → { keys:[批次key], n:词条颗数合计, names:[], kind set, cospar set, result }
  const agg = new Map();
  for (const w of wiki) {
    const k = batchKey(w.cospar);
    if (!agg.has(k)) agg.set(k, { key: k, n: 0, names: [], kinds: new Set(), cospars: [], result: '', raw: [] });
    const a = agg.get(k);
    // 有些表把"共N颗"写在名字里；表 #2 的试验星是**单颗**行（n=1），累加即得批次数
    a.n += (w.n || 0);
    a.names.push(w.name);
    a.kinds.add(w.kind);
    a.cospars.push(w.cospar);
    if (w.result) a.result = w.result;
    a.raw.push(w);
  }
  const seen = new Set();
  const rows = [];
  let missBatch = 0, nDiff = 0, noTle = 0, noHist = 0;
  for (const a of agg.values()) {
    const k = a.key, has = !!L[k], inDb = S.get(k) || [], hc = histCount(k);
    if (has) seen.add(k);
    let verdict = 'OK';
    if (!has) { verdict = '**批次不在库**'; missBatch++; }
    else if (a.n && inDb.length !== a.n) { verdict = '颗数不符'; nDiff++; }
    if (has && inDb.length === 0) { noTle++; if (verdict === 'OK') verdict = '**无 TLE**'; }
    if (has && hc === 0) { noHist++; }
    rows.push({ a: a, k: k, has: has, dbN: inDb.length, hist: hc, verdict: verdict,
      result: (L[k] && L[k][5]) || a.result || '',
      names: a.names.join(' + ') });
  }
  const extra = Object.keys(L).filter(k => !seen.has(k));
  out.push({ title: title, who: who, rows: rows, extra: extra, missBatch: missBatch, nDiff: nDiff, noTle: noTle, noHist: noHist });
}
audit('gw', wikiG, '星网（SatNet / CSCN）');
audit('qf', wikiQ, '千帆星座（Qianfan / G60）');

// ---------- 输出 ----------
let md = '# V1.9.1 执行顺序 1.3 —— 词条名单核对表\n\n';
md += '> 名单来源：卫星百科词条表格（本地缓存 `data/wiki_cache/`）。\n';
md += '> 现库：`build/satdata.json`（sats 按 COSPAR 前 5 位归批）+ `data/history/<批>.json`（自建历史库）。\n';
md += '> 「部署颗数」= 词条表里该批次记载的颗数；「库内」= 现库该批次实际收录的卫星数。\n';
md += '> ⚠️ 词条行已**按批次号聚合**：同一次发射的多个任务共享 COSPAR 前缀（如 `2026-211` = 千帆26组 8 颗 + EUHT 1 颗），\n';
md += '> 逐行比会两边都误报"颗数不符"，聚合后"颗数"才可比。\n\n';
for (const a of out) {
  md += '## ' + a.title + '\n\n';
  md += '| 类别 | 名称 | 部署 | COSPAR | 批号 | 库内 | 历史 | 结果 | 判定 |\n';
  md += '|---|---|---|---|---|---|---|---|---|\n';
  a.rows.forEach(r => {
    md += '| ' + [...r.a.kinds].join('/') + ' | ' + r.names + ' | ' + (r.a.n || '?') + ' | ' +
      r.a.cospars.join('/') + ' | `' + r.k + '` | ' +
      r.dbN + (r.dbN !== r.a.n ? ' ⚠' : '') + ' | ' + (r.hist ? r.hist + ' 颗' : '—') + ' | ' +
      (r.result || '—') + ' | ' + r.verdict + ' |\n';
  });
  md += '\n**小结**：名单 ' + a.rows.length + ' 个批次；批次不在库 ' + a.missBatch +
    '；颗数不符 ' + a.nDiff + '；有批次但无 TLE ' + a.noTle + '；无历史 ' + a.noHist + '。\n';
  if (a.extra.length) md += '**库内多出的批次**（词条表未列，需确认是否搭车/未编目）：`' + a.extra.join('`, `') + '`\n';
  md += '\n';
}
const f = path.join(ROOT, 'V1.9.1_1.3_词条名单核对表.md');
fs.writeFileSync(f, md, 'utf8');
console.log('已写出 ' + f);
for (const a of out) {
  console.log(a.title + '：名单 ' + a.rows.length + ' / 缺批次 ' + a.missBatch + ' / 颗数不符 ' + a.nDiff +
    ' / 无 TLE ' + a.noTle + ' / 无历史 ' + a.noHist + ' / 库内多出 ' + a.extra.length);
}
