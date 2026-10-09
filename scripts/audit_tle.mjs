/* audit_tle.mjs —— 全量 TLE 完整性核对（V1.9.1 / 执行顺序 1.6，正式工具）
 * ---------------------------------------------------------------------------
 * 口径（用户 Q18 / Q44 定下的硬验收标准）：
 *   以卫星百科「星网」「千帆星座」两个词条的表格为**唯一名单**，逐批次判定：
 *     · 有 TLE？   —— 库（build/satdata.json）里该批次实际收录了几颗
 *     · 有历史？   —— data/history/<批>.json 里覆盖了几颗
 *     · 状态      —— 在轨 / 已再入（satcat DECAY_DATE）/ 失败（台账 result=fail）
 *   并给出差异清单：**应有而无**（必须补）/ **本不该有**（搭车、发射失败）/ **多收**（误收）。
 *
 * ★ 与 1.3 的 audit_wiki.mjs 的区别（为什么另写一个）：
 *   1.3 用的是"satcat 里 PAY 的颗数"当分母，而那个口径**会把搭车星算进来**
 *   （实例：`2026-128` 有 DTC-01(A) 与中国移动02星(B)，satcat PAY=2，而词条记 DTC-01 只 1 颗）。
 *   本脚本改用**词条记载的部署颗数**为分母、**库内实际收录数**为分子，并显式列出"排除项"，
 *   这样"颗数不符"才是真信号，而不是口径混用导致的误报。
 *
 * 用法：node scripts/audit_tle.mjs        产出 V1.9.1_1.6_TLE完整性核对表.md
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CACHE = path.join(ROOT, 'data', 'wiki_cache');

// ---------------------------------------------------------------- 词条表解析
const unesc = (s) => s.replace(/<sup[^>]*>[\s\S]*?<\/sup>/gi, '').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const tables = (html) => (html.match(/<table[\s\S]*?<\/table>/gi) || []).map(t =>
  (t.match(/<tr[\s\S]*?<\/tr>/gi) || [])
    .map(tr => (tr.match(/<t[hd][\s\S]*?<\/t[hd]>/gi) || []).map(unesc))
    .filter(r => r.length));

const batchKey = (cospar) => {
  const m = String(cospar || '').match(/^(\d{4})-(.+)$/);
  if (!m) return '';
  const yy = m[1].slice(2);
  const seq = m[2].match(/^\d+/) ? m[2].match(/^\d+/)[0].padStart(3, '0') : m[2];
  return yy + seq;
};

/* 已知例外（**必须写清理由**，否则下次有人会以为是漏收）
 *  · 2026-128B：中国移动02星。与千帆 DTC-01（128A）**同一次发射**，
 *    但词条只把 DTC-01 记入千帆名单 → 属搭车，不收。
 *  · 2024-226A：**词条自身的两列互相矛盾** —— 它的"COSPAR"列写 `2024-226A`，
 *    而它的"轨道高度"列写 `1113 km × 1095 km`。实测 satcat：
 *      226A = 994 × 1077 km（周期 105.87）
 *      226B = 1095 × 1112 km（周期 107.34）   ← 近地点 1095 **完全吻合**、远地点差 1 km
 *    任务清单 1.4 原文也写的是"2024-226B"，故**收 B 是正确的**，A 属搭车。
 *    这类"词条表自身矛盾"必须留档，不能靠脚本猜。
 */
const EXCEPTIONS = {
  '2026-128B': '搭车星（中国移动02星）',
  '2024-226A': '词条 COSPAR 列与轨道高度列矛盾；轨道参数指向 226B 才是本体'
};

const xing = tables(fs.readFileSync(path.join(CACHE, 'wiki_xingwang.html'), 'utf8'));
const qian = tables(fs.readFileSync(path.join(CACHE, 'wiki_qianfan.html'), 'utf8'));

// 星网：表1=试验星(11列)、表2=业务星(12列)；千帆：表2=试验星(10列,单颗行)、表3=组网星(13列)
const rowsG = [], rowsQ = [];
for (const [ti, kind] of [[1, '试验星'], [2, '业务星']]) {
  (xing[ti] || []).slice(1).forEach(r => {
    if (r.length < 11) return;
    rowsG.push({ kind, name: r[1], n: parseInt(r[2], 10) || 0, date: r[4], cospar: r[9], res: r[10] });
  });
}
(qian[2] || []).slice(1).forEach(r => {
  if (r.length < 10) return;
  rowsQ.push({ kind: '试验星', name: r[0], n: 1, date: r[3], cospar: r[9], res: '' });
});
(qian[3] || []).slice(1).forEach(r => {
  if (r.length < 12) return;
  const nm = r[1] || '';
  const m = nm.match(/共(\d+)颗/);
  rowsQ.push({ kind: '组网星', name: nm.replace(/（共\d+颗）/, ''), n: m ? parseInt(m[1], 10) : 0, date: r[4], cospar: r[11], res: '' });
});

// ---------------------------------------------------------------- 现库
const sdRaw = JSON.parse(fs.readFileSync(path.join(ROOT, 'build', 'satdata.json'), 'utf8'));
const db = sdRaw.SATDATA || sdRaw;
const HIST = path.join(ROOT, 'data', 'history');

// satcat 索引（拿在轨状态与搭车甄别）
const cat = fs.readFileSync(path.join(ROOT, 'data', 'satcat.csv'), 'utf8').split('\n');
const ch = cat[0].split(','); const ci = n => ch.indexOf(n);
const C_NO = ci('NORAD_CAT_ID'), C_ID = ci('OBJECT_ID'), C_NM = ci('OBJECT_NAME'),
  C_TY = ci('OBJECT_TYPE'), C_DEC = ci('DECAY_DATE');
const satByNorad = new Map(), satByPrefix = new Map();
cat.slice(1).forEach(l => {
  if (!l) return; const c = l.split(',');
  const no = +c[C_NO], id = (c[C_ID] || '').trim(), ty = (c[C_TY] || '').trim(), dec = (c[C_DEC] || '').trim();
  if (!no || !id) return;
  const rec = { no, id, nm: (c[C_NM] || '').trim(), ty, decay: dec, lk: batchKey(id) };
  satByNorad.set(no, rec);
  if (!satByPrefix.has(rec.lk)) satByPrefix.set(rec.lk, []);
  satByPrefix.get(rec.lk).push(rec);
});

/** 库内某批次收录了哪些卫星（id / c / 状态） */
function dbOf(who, lk) {
  const out = [];
  for (const s of (db[who] && db[who].sats) || []) {
    if (String(s.c || '').slice(0, 5) === lk) out.push(s);
  }
  return out;
}
/** 历史库里该批次的覆盖情况 */
function histOf(lk) {
  const p = path.join(HIST, lk + '.json');
  if (!fs.existsSync(p)) return { n: 0, nums: [] };
  try {
    const a = JSON.parse(fs.readFileSync(p, 'utf8'));
    const arr = Array.isArray(a) ? a : [];
    return { n: arr.length, nums: [...new Set(arr.map(r => r[0]))] };
  } catch (e) { return { n: 0, nums: [] }; }
}

// ---------------------------------------------------------------- 逐条核对
/** 汇总成"每批次一行" */
function audit(who, wiki) {
  const agg = new Map();
  for (const w of wiki) {
    const lk = batchKey(w.cospar);
    if (!agg.has(lk)) agg.set(lk, { lk, declared: 0, names: [], kinds: new Set(), cospars: [], res: '', items: [] });
    const a = agg.get(lk);
    a.declared += (w.n || 0);
    a.names.push(w.name); a.kinds.add(w.kind); a.cospars.push(w.cospar);
    if (w.res) a.res = w.res;
    a.items.push(w);
  }
  const out = [];
  for (const a of agg.values()) {
    const inDb = dbOf(who, a.lk), h = histOf(a.lk);
    // satcat 侧：该 COSPAR 前缀下的 PAY
    const pays = (satByPrefix.get(a.lk) || []).filter(x => x.ty === 'PAY');
    const gone = pays.filter(x => x.decay);
    const inDbIds = new Set(inDb.map(s => String(s.id)));
    // 「应有而无」= 词条说该有、satcat 里有这颗 PAY、但库里没有
    //   排除三类：
    //     ① 台账标**失败**的批次（发射失败 → 无在轨卫星）。
    //        ⚠️ 判据必须认中文"失败"：词条表这一列写的就是中文（早期版本只判 'fail' →
    //        整整一个失败批次被算成"缺失"，属于**口径 bug**）。
    //     ② 已知**搭车星**（不在本星座名单里）
    //     ③ **词条 COSPAR 列与它自己的轨道高度列矛盾**的已知例外（见 EXCEPTIONS）
    const failed = /失败|fail/i.test(a.res || '');
    const missing = failed ? [] : pays.filter(x => {
      if (EXCEPTIONS[x.id]) return false;          // ② ③ 都在 EXCEPTIONS 里说明
      return !inDbIds.has(String(x.no));
    });
    out.push({
      ...a, declared: a.declared, dbN: inDb.length, histN: h.n, histNums: h.nums,
      pays: pays.length, gone: gone.length, failed: failed, missing,
      // ⚠️ 两套编号体系必须分清：`s.c` 是**经典 6 列 COSPAR**（"25067A"），
      //   而 satcat 的 `OBJECT_ID` 是**9 字符**（"2025-067A"）。
      //   用 `c` 去比 satcat 的 id 会**永远不等** → 已再入那栏会误报"缺"（实测踩到）。
      //   这里统一用 **NORAD** 比（两边都有真号，最可靠）。
      dbNorads: new Set(inDb.map(s => String(s.id))),
      dbIds: inDb.map(s => s.c).sort()
    });
  }
  out.sort((x, y) => x.lk.localeCompare(y.lk));
  return out;
}

const resG = audit('gw', rowsG), resQ = audit('qf', rowsQ);

// ---------------------------------------------------------------- 输出
const md = [];
md.push('# V1.9.1 执行顺序 1.6 —— 全量 TLE 完整性核对表\n');
md.push('> **名单来源**：卫星百科「星网」「千帆星座」词条表格（`data/wiki_cache/`），**唯一依据**。');
md.push('> **口径**：「部署」= 词条记载颗数；「库内」= 现库实际收录（`build/satdata.json`）；');
md.push('> 「历史」= `data/history/<批>.json` 覆盖颗数；「目录PAY」= satcat 同前缀载荷数（含搭车星，仅供对照）。');
md.push('> 判定：`✓` 齐备 / `✗` **应有而无**（须补齐）/ `—` 本不该有（发射失败）。\n');

let allMiss = [], allOk = 0, allFail = 0;
for (const [title, rows] of [['星网（SatNet / CSCN）', resG], ['千帆星座（Qianfan / G60）', resQ]]) {
  md.push('## ' + title + '\n');
  md.push('| 类别 | 名称 | 部署 | 批号 | 库内 | 历史 | 目录PAY | 已再入 | 结果 | 判定 |');
  md.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    let verdict;
    if (r.failed) { verdict = '— 发射失败'; allFail++; }
    else if (r.missing.length) { verdict = '✗ 缺 ' + r.missing.length + ' 颗'; allMiss.push({ lk: r.lk, miss: r.missing, name: r.names.join('+') }); }
    else if (r.dbN === 0) { verdict = '✗ 无 TLE'; allMiss.push({ lk: r.lk, miss: [], name: r.names.join('+') }); }
    else { verdict = '✓'; allOk++; }
    md.push('| ' + [...r.kinds].join('/') + ' | ' + r.names.join(' + ') + ' | ' + (r.declared || '?') +
      ' | `' + r.lk + '` | ' + r.dbN + (r.declared && r.dbN !== r.declared ? ' ⚠' : '') +
      ' | ' + r.histN + ' | ' + r.pays + ' | ' + (r.gone || '') + ' | ' + (r.res || '—') + ' | ' + verdict + ' |');
  }
  md.push('');
  const sum = rows.reduce((acc, r) => { acc.declared += r.declared; acc.db += r.dbN; return acc; }, { declared: 0, db: 0 });
  md.push('**小结**：' + rows.length + ' 个批次；词条部署合计 ' + sum.declared + ' 颗 / 库内合计 ' + sum.db + ' 颗。\n');
}

md.push('## 差异清单（供 1.7 台账修正用）\n');
if (allMiss.length) {
  md.push('### 应有而无（必须补齐）\n');
  md.push('| 批号 | 名称 | 缺的 NORAD |');
  md.push('|---|---|---|');
  allMiss.forEach(m => md.push('| `' + m.lk + '` | ' + m.name + ' | ' + (m.miss.length ? m.miss.map(x => x.no + '(' + x.id + ')').join(' ') : '（整批无 TLE）') + ' |'));
} else md.push('### 应有而无：**无** ✓（名单内所有批次都有 TLE）\n');
md.push('');
md.push('### 已再入（需在列表标注、历史须完整）\n');
const gones = [];
for (const [who, rows] of [['gw', resG], ['qf', resQ]]) {
  for (const r of rows) {
    (satByPrefix.get(r.lk) || []).filter(x => x.ty === 'PAY' && x.decay).forEach(x => {
      const inDb = r.dbNorads.has(String(x.no));      // 按 NORAD 比（两套 COSPAR 格式不同）
      const inHist = r.histNums.indexOf(x.no) >= 0;   // 历史是否覆盖到这颗
      gones.push('| ' + who + ' | `' + r.lk + '` | ' + x.no + ' | ' + x.id + ' | ' + x.nm + ' | ' +
        x.decay.slice(0, 10) + ' | ' + (inDb ? '✓ 在库' : '✗ 缺') + ' | ' + (inHist ? '✓ 有' : '— 无') + ' |');
    });
  }
}
if (gones.length) {
  md.push('| 星座 | 批号 | NORAD | COSPAR | 名称 | 再入日 | 在库 | 历史 |');
  md.push('|---|---|---|---|---|---|---|---|');
  md.push(...gones);
} else md.push('（无）');
md.push('');
md.push('### 本不该有（已正确排除）\n');
md.push('- 发射失败批次：' + allFail + ' 个（库内 0 颗，正确）');
md.push('- 搭车星：`2026-128B`（中国移动02星，词条不计入千帆）→ 已在 `refresh.mjs` 的 INCLUDE 里精确排除');

const f = path.join(ROOT, 'V1.9.1_1.6_TLE完整性核对表.md');
fs.writeFileSync(f, md.join('\n') + '\n', 'utf8');
console.log('已写出 ' + f);
console.log('批次判定：✓ 齐备 ' + allOk + ' / ✗ 缺失 ' + allMiss.length + ' / — 失败 ' + allFail);
if (allMiss.length) allMiss.forEach(m => console.log('  ✗ ' + m.lk + ' ' + m.name + ' → 缺 ' + m.miss.map(x => x.no).join(',')));
