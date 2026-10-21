// scripts/satcat_src.mjs —— satcat 数据源的**唯一裁决处**（V2.0.0.630 / 方案 A）
//
// ============================ 为什么要这个模块 ============================
// 背景（2026-10-22 实测）：
//   · `data/satcat.csv` 是全量 NORAD 目录，**6.4 MB**（70953 行），被 `.gitignore:8` 排除；
//   · 它是**四件事的唯一数据源**：① 每批发射颗数（launchCounts，含 tot）
//     ② 已再入标记（REENTRY / goneCount）③ 搜索补池（dead / pend）④ 待编目摘要（pendingInfo）；
//   · 而部分网络环境下 celestrak.org 不可达（DNS 可解析但连接超时、经代理亦失败）；
//   · GitHub Actions 侧仍能拉到（工作流注释与缓存策略都按"能拉"设计）——
//     但它拉到了也**传不回来**，因为 6.4 MB 被 gitignore。
//   ⇒ 于是 satcat 成了唯一"两头都断"的链路（TLE 有 CI 回传，wiki 有本地出口）。
//
// 解法：CI 每轮把**本项目相关的子集**导成 `data/satcat_slim.csv` 入库。
//   实测：全量 6.4 MB / 70953 行 → 子集 **109 KB / 1274 行**（缩 60 倍）；
//   因为**表头与列序与全量完全一致**，下游 `pendingSummary` / `REENTRY` /
//   `goneCountsOf` / `searchPools` **零改动**，只需要改"读哪个文件"。
//
// ============================ 两个必须钉住的判据 ============================
// ① **子集必须按"批次前缀"整批保留，不能只保留名字匹配的行。**
//    因为 `launchCounts.tot`（该发全部载荷数，页面显示 `M/N颗` 的那个 N）需要
//    **搭车星与 R/B** —— 它们名字不属于本星座，但 COSPAR 前缀属于该批。
//    只留名字匹配行会让 `tot` 偏小 → 页面把"9/10颗"错写成"9颗"。
//
// ② **新鲜度不能看 mtime。**
//    `satcat_slim.csv` 是入库文件，`git checkout` 会把 mtime 刷成"检出时刻"
//    → 任何按 mtime 判新鲜度的写法都会把一份三个月前的子集当成"刚刚生成"。
//    所以导出时必须同时写 `data/satcat_slim.meta.json`（含 `exported` 时间戳），
//    读取时**只认 meta 里的时间**。
//
// ============================ 选源规则 ============================
// 全量与子集**谁新用谁**，同年龄时**全量优先**（它是权威、且含全部搭车星）。
// 理由：本地可能有一份"5 天前的全量"和一份"1 天前的子集"，
//   前者虽然更全但**更旧**（比如缺最新一批发射），用它反而错得更多。

import fs from 'node:fs';
import path from 'node:path';

export const SLIM_FILE = 'satcat_slim.csv';
export const SLIM_META = 'satcat_slim.meta.json';
export const FULL_FILE = 'satcat.csv';

const ageDaysOf = (ms) => (Date.now() - ms) / 86400000;

/**
 * 选出该用哪份 satcat。
 * @param {string} dir 数据目录（通常是 `<repo>/data`）
 * @returns {{path:string|null, kind:'full'|'slim'|'none', ageDays:number, rows:number,
 *            text:string, meta:object|null, fullAgeDays:number, slimAgeDays:number, note:string}}
 */
export function pickSatcat(dir) {
  const fullPath = path.join(dir, FULL_FILE);
  const slimPath = path.join(dir, SLIM_FILE);
  const metaPath = path.join(dir, SLIM_META);

  const fullOk = fs.existsSync(fullPath);
  const slimOk = fs.existsSync(slimPath);

  const fullAgeDays = fullOk ? ageDaysOf(fs.statSync(fullPath).mtimeMs) : Infinity;

  let meta = null;
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch (e) { meta = null; }
  // ⚠️ 只认 meta.exported；meta 缺失时**不**退回 mtime（见文件头判据②）
  let slimAgeDays = Infinity;
  if (slimOk && meta && meta.exported) {
    const t = Date.parse(meta.exported);
    if (Number.isFinite(t)) slimAgeDays = ageDaysOf(t);
  }

  const none = {
    path: null, kind: 'none', ageDays: Infinity, rows: 0, text: '', meta: null,
    fullAgeDays, slimAgeDays, note: '两份 satcat 都不可用'
  };
  if (!fullOk && !slimOk) return none;

  // 选源：谁新用谁；同年龄（含都不可知）时全量优先
  let kind;
  if (fullOk && !slimOk) kind = 'full';
  else if (!fullOk && slimOk) kind = 'slim';
  else kind = slimAgeDays < fullAgeDays ? 'slim' : 'full';

  const chosen = kind === 'full' ? fullPath : slimPath;
  const text = fs.readFileSync(chosen, 'utf8');
  const rows = text.split('\n').filter((l) => l && !l.startsWith('OBJECT_NAME,')).length;
  const ageDays = kind === 'full' ? fullAgeDays : slimAgeDays;

  let note = '';
  if (kind === 'slim') {
    note = meta
      ? '子集（由 CI 每天导出，' + String(meta.exported).slice(0, 16).replace('T', ' ') + ' UTC）'
      : '子集（**缺 meta，年龄不可知** —— 请检查 refresh.mjs 的导出步骤是否跑过）';
    if (!Number.isFinite(slimAgeDays)) note += '｜⚠️ 年龄未知，无法判断新鲜度';
  } else {
    note = '全量';
    if (Number.isFinite(fullAgeDays) && fullAgeDays > 3) {
      note += '｜⚠️ 已 ' + fullAgeDays.toFixed(1) + ' 天（超过 3 天，可能缺最新发射）';
    }
  }
  return { path: chosen, kind, ageDays, rows, text, meta, fullAgeDays, slimAgeDays, note };
}

/**
 * 从全量 satcat 文本里导出"本项目子集"。
 *
 * @param {string} text            全量 satcat.csv 全文
 * @param {(nm:string, pre:string, norad:number)=>boolean} isOurs
 *        判据：这一行是否属于本项目（调用方传入，内部**不复制**第二份名单 —— 见下）
 * @param {{rows:number,batches:number}|null} prevMeta 上一次的 meta（用于"不许变窄"守卫）
 * @returns {{csv:string, rows:number, batches:number, shrink:object|null}}
 *
 * ⚠️ 判据**必须由调用方传入**，不能在这里再写一份 MATCH/INCLUDE/CARD 清单 ——
 *   这正是本项目反复踩的"守卫用第二份手写清单，清单过期→假绿"（2026-10-22 第 4 次）。
 */
export function buildSlim(text, isOurs, prevMeta) {
  const lines = text.split('\n');
  const head = lines[0] || '';
  if (!/OBJECT_NAME,OBJECT_ID/.test(head)) {
    throw new Error('satcat 表头异常，拒绝导出子集：' + head.slice(0, 80));
  }
  const H = head.split(',');
  const iId = H.indexOf('OBJECT_ID');
  const iNm = H.indexOf('OBJECT_NAME');
  const iNo = H.indexOf('NORAD_CAT_ID');
  if (iId < 0 || iNm < 0 || iNo < 0) throw new Error('satcat 缺关键列，拒绝导出子集');

  // 第一遍：用调用方判据扫出"本项目批次前缀"
  const pres = new Set();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const c = line.split(',');
    const id = (c[iId] || '').trim();
    const m = id.match(/^(\d{4})-(\d{3})/);
    if (!m) continue;
    const pre = m[1].slice(2) + String(+m[2]).padStart(3, '0');
    const nm = (c[iNm] || '').trim();
    const norad = +c[iNo];
    if (isOurs(nm, pre, norad)) pres.add(pre);
  }

  // 第二遍：保留这些前缀下的**全部行**（含搭车星 / R/B / DEB，tot 与补池都要）
  const keep = [head];
  const batchRows = {};
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const c = line.split(',');
    const id = (c[iId] || '').trim();
    const m = id.match(/^(\d{4})-(\d{3})/);
    if (!m) continue;
    const pre = m[1].slice(2) + String(+m[2]).padStart(3, '0');
    if (!pres.has(pre)) continue;
    keep.push(line);
    batchRows[pre] = (batchRows[pre] || 0) + 1;
  }

  const rows = keep.length - 1;
  const batches = Object.keys(batchRows).length;

  // "不许变窄"守卫：批次数减少 = 有批次整批掉出子集（正是本方案要防的那类静默缺陷）
  let shrink = null;
  if (prevMeta && Number.isFinite(prevMeta.batches) && prevMeta.batches > 0) {
    if (batches < prevMeta.batches) {
      shrink = { kind: 'batches', before: prevMeta.batches, after: batches };
    } else if (Number.isFinite(prevMeta.rows) && rows < prevMeta.rows * 0.95) {
      shrink = { kind: 'rows', before: prevMeta.rows, after: rows };
    }
  }
  return { csv: keep.join('\n') + '\n', rows, batches, shrink, batchRows };
}

/** 写子集 + meta。返回写入结果。 */
export function writeSlim(dir, slim) {
  const csvPath = path.join(dir, SLIM_FILE);
  const metaPath = path.join(dir, SLIM_META);
  const prev = (() => { try { return JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch (e) { return null; } })();
  fs.writeFileSync(csvPath, slim.csv, 'utf8');
  const meta = {
    exported: new Date().toISOString(),
    rows: slim.rows,
    batches: slim.batches,
    bytes: Buffer.byteLength(slim.csv),
    // 说明这份子集的用途与生成方式，方便日后核对（也防"这文件哪来的"）
    note: 'satcat 精简子集：只含本项目的批次前缀下的全部行（含搭车星/R-B）。由 refresh.mjs 自动导出，勿手改。'
  };
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 1) + '\n', 'utf8');
  return { meta, prev };
}
