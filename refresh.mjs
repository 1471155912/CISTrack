/* 刷新两个星座的 TLE + SATCAT
 * V1.3.7：改成「多源 + 按 COSPAR / 编号反查」。
 *   旧版只按 CelesTrak 的 GROUP=hulianwang / qianfan 分组抓，这两个分组漏掉了
 *   早期试验星（23095 / 23212 等）与部分刚入轨的批次。现在五个来源依次合并：
 *     S1 GROUP=          星座分组（主源）
 *     S2 NAME=           CelesTrak 的 NAME 是前缀模糊匹配，能捞回 S1 漏掉的星
 *     S3 CATNR=          用 satcat 按 COSPAR 前缀反查出编号后逐颗补（**只处理 ≤5 位编目号**：
 *                        6 位号的编目字段装不下，FORMAT=tle 一律空 → 交给 S5）
 *     S4 tle.ivanstanojevic.me   上面都拿不到时的备源（同样只管 ≤5 位）
 *     S5 CATNR= + FORMAT=json（OMM）  **兜底通路**：凡 S1–S4 仍未取到的对象都在这里试。
 *                        6 位及以上编目号（CelesTrak 自 2026-07-11 起的新规则）只能走这条，
 *                        取回后用 scripts/omm.mjs 转成"TLE 形状"（编目号填占位 = 真号后 5 位），
 *                        真号记进 data/omm_norad.json 由 mkdata.mjs 写回前端 id。
 *   同一颗卫星多源都有时，取历元（epoch）最新的那份。
 * 用法：node refresh.mjs [--force-cat]      --force-cat 强制重下 6.7MB 的 satcat.csv
 *      node refresh.mjs --selftest-omm     离线自检 S5 的 OMM 解析/占位/映射链路（不联网）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.dirname(fileURLToPath(import.meta.url));   // 脚本所在目录（发布包内任意位置可用）

const D = path.join(ROOT, 'data');
// V1.8.0（需求14 方案A）：把「写坏后天天静默失败」挡在入口 —— 任何顶层错误必须非零退出并落日志，
//   计划任务才能看见（旧版 17 行有重复 import + 多余引号，语法错 → 任务天天失败无人知）。
process.on('unhandledRejection', function (e) { console.error('[refresh] unhandledRejection', e); process.exit(1); });
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' };
const forceCat = process.argv.includes('--force-cat');

// V1.9.0：6 位编目号对象的 OMM 通路（见下方 S5）—— 占位号 → 真号的映射，落 data/omm_norad.json
import { tleFromOmm, fromCelesTrakOmm, PH, tleChecksum, tleHealth } from './scripts/omm.mjs';
// V1.9.0（R17）：自建历史库 —— 复用 import_history.mjs 里已修过量级 bug 的 altFromOmm，
//   以及 histstore.mjs 的幂等分片写入（(NORAD,历元) 去重，只追加不覆盖）。
import { altFromOmm } from './scripts/import_history.mjs';
import { mergeInto, pruneRecords, readShard, writeShard } from './scripts/histstore.mjs';
const HIST_DIR = path.join(D, 'history');
const OMM_IDS_PATH = path.join(D, 'omm_norad.json');
let OMM_IDS = {};
try { OMM_IDS = JSON.parse(fs.readFileSync(OMM_IDS_PATH, 'utf8')); } catch (e) { OMM_IDS = {}; }

const GROUPS = { gw: 'hulianwang', qf: 'qianfan' };
// 名称前缀（CelesTrak NAME= 是前缀模糊匹配；目录里的写法并不统一，所以两边都列全）
const NAMES = {
  gw: ['HULIANWANG', 'GUOWANG', 'GW-'],
  qf: ['QIANFAN', 'SPACESAIL', 'G60']
};
const MATCH = { gw: /HULIANWANG|GUOWANG|^GW-/i, qf: /QIANFAN|SPACESAIL|G60/i };

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(url, tries) {
  for (let i = 0; i < (tries || 2); i++) {
    try {
      const r = await fetch(url, { headers: UA });
      if (!r.ok) return { ok: false, status: r.status, text: '' };
      return { ok: true, status: r.status, text: (await r.text()).replace(/\r/g, '') };
    } catch (e) { if (i === (tries || 2) - 1) return { ok: false, status: 0, text: '', err: e.message }; await sleep(800); }
  }
  return { ok: false, status: 0, text: '' };
}
// TLE 文本 → Map(norad -> {name,l1,l2,epoch})
function parseTLE(txt, into) {
  const lines = txt.split('\n').map(l => l.trim()).filter(Boolean);
  let n = 0;
  for (let i = 0; i + 2 < lines.length; i += 3) {
    const l1 = lines[i + 1], l2 = lines[i + 2];
    if (!/^1 /.test(l1) || !/^2 /.test(l2)) continue;
    const id = parseInt(l1.slice(2, 7), 10); if (!id) continue;
    const ep = parseFloat(l1.slice(18, 32)) || 0;
    const old = into.get(id);
    if (old && old.epoch >= ep) continue;                  // 同一颗保留历元最新的一份
    into.set(id, { name: lines[i].trim(), l1, l2, epoch: ep, cospar: l1.slice(9, 17).trim() });
    n++;
  }
  return n;
}
function writeTLE(file, map, oldPath) {
  const lines = [];
  [...map.values()].sort((a, b) => a.cospar.localeCompare(b.cospar) || a.epoch - b.epoch)
    .forEach(s => { lines.push(s.name.padEnd(24), s.l1, s.l2); });
  const txt = lines.join('\n') + '\n';
  if (!/^1 [0-9]/m.test(txt)) { console.log('  !! 内容异常，保留旧文件 ' + file); return false; }
  if (oldPath && fs.existsSync(oldPath)) fs.writeFileSync(oldPath + '.bak', fs.readFileSync(oldPath), 'utf8');
  fs.writeFileSync(path.join(D, file), txt, 'utf8');
  console.log('  saved', file, txt.length, 'bytes,', map.size, 'sats');
  return true;
}
function readTLE(file) {
  if (!fs.existsSync(path.join(D, file))) return new Map();
  const m = new Map(); parseTLE(fs.readFileSync(path.join(D, file), 'utf8'), m); return m;
}

// ---------------------------------------------------------------- 离线自检（不联网）
// V1.9.1：S5 的 OMM 链路曾经"补到 0 颗"却看不出原因（静默 catch + 环境不可达），
//   而且原始 bug 直接导致 55 颗卫星在页面里整批消失。自检逻辑放在 **scripts/omm_check.mjs**
//   （纯函数、零副作用）—— 这里只做命令行的打印与退出码，测试（smoke.mjs）则直接 import 它。
if (process.argv.includes('--selftest-omm')) {
  const { ommSelfTest } = await import('./scripts/omm_check.mjs');
  const r = ommSelfTest();
  r.forEach(x => console.log((x.ok ? 'PASS ' : 'FAIL ') + x.name + (x.info !== undefined ? '  → ' + x.info : '')));
  const nf = r.filter(x => !x.ok).length;
  console.log('\n自检结论：' + (nf ? '失败 ' + nf + ' 项' : '全部通过'));
  process.exit(nf ? 1 : 0);
}

// ---- SATCAT：每周拉一次就够了（6.7MB，约 70s）----
const catPath = path.join(D, 'satcat.csv');
const age = fs.existsSync(catPath) ? (Date.now() - fs.statSync(catPath).mtimeMs) / 86400000 : 999;
if (forceCat || age > 7) {
  console.log('satcat.csv 拉取中（' + (age > 900 ? '首次' : '已 ' + age.toFixed(1) + ' 天') + '）…');
  const r = await get('https://celestrak.org/pub/satcat.csv', 1);
  if (r.ok && r.text.split('\n').length > 1000 && /OBJECT_NAME,OBJECT_ID/.test(r.text.split('\n')[0])) {
    fs.writeFileSync(catPath, r.text, 'utf8');
    console.log('  satcat.csv saved', r.text.length, 'bytes');
  } else console.log('  !! satcat 异常（status ' + r.status + '），沿用旧文件');
} else console.log('satcat.csv 仅 ' + age.toFixed(1) + ' 天，跳过（--force-cat 可强制）');

// 从目录里按名称反查两个星座的所有对象，按 COSPAR 前缀归批
const catByPrefix = { gw: {}, qf: {} };
if (fs.existsSync(catPath)) {
  const rows = fs.readFileSync(catPath, 'utf8').split('\n');
  const head = rows[0].split(',');
  const ix = n => head.indexOf(n);
  const iId = ix('OBJECT_ID'), iNo = ix('NORAD_CAT_ID'), iTy = ix('OBJECT_TYPE'), iNm = ix('OBJECT_NAME');
  const iLd = ix('LAUNCH_DATE'), iDec = ix('DECAY_DATE'), iPer = ix('PERIOD'), iInc = ix('INCLINATION');
  const iApo = ix('APOGEE'), iPeg = ix('PERIGEE'), iSite = ix('LAUNCH_SITE');
  const cat = { gw: [], qf: [] };
  rows.slice(1).forEach(line => {
    if (!line) return;
    const c = line.split(',');
    const nm = (c[iNm] || '').trim(), id = (c[iId] || '').trim(); if (!nm || !id) return;
    for (const k of ['gw', 'qf']) {
      if (!MATCH[k].test(nm)) continue;
      const m = id.match(/^(\d{4})-(\d{3})/); if (!m) continue;
      const pre = m[1].slice(2) + String(+m[2]).padStart(3, '0');
      const o = { norad: +c[iNo], name: nm, cospar: id, type: (c[iTy] || '').trim(), pre: pre,
        launch: (c[iLd] || '').trim(), decay: (c[iDec] || '').trim(), site: (c[iSite] || '').trim(),
        per: +c[iPer], inc: +c[iInc], apo: +c[iApo], peg: +c[iPeg] };
      (catByPrefix[k][pre] = catByPrefix[k][pre] || []).push(o);
      cat[k].push(o);
    }
  });
  fs.writeFileSync(path.join(D, 'cat_objs.json'), JSON.stringify(cat), 'utf8');
  console.log('目录命中：gw', cat.gw.length, '个对象 /', Object.keys(catByPrefix.gw).length, '批；qf',
    cat.qf.length, '个对象 /', Object.keys(catByPrefix.qf).length, '批');
}

// ---- 逐星座合并四个来源 ----
const report = {};
for (const key of ['gw', 'qf']) {
  const file = key === 'gw' ? 'ct_hulianwang.tle' : 'ct_qianfan.tle';
  const old = readTLE(file);
  const merged = new Map(old);
  // V1.9.1：入口体检 —— 剔除上一轮遗留的**坏行**（数值列含 NaN）。
  //   不做这一步的话它们会永久滞留（原因见 tleHealth 上方的长注释）。
  let droppedBad = 0;
  for (const [k, s] of [...merged]) {
    if (!tleHealth(s.l2 || '')) { merged.delete(k); droppedBad++; }
  }
  const prevN = old.size;                                  // 上一轮 .tle 里的条数（未体检）
  if (droppedBad) {
    console.log(key, '⚠️ 上轮遗留 ' + droppedBad + ' 条坏行（L2 数值列含 NaN）→ 已剔除，本轮将由 S5 重新取');
  }
  const before = merged.size;                              // 体检后的起点（S2 日志的算术用它）
  report[key] = { prevN: prevN, before: before, droppedBad: droppedBad };
  const from = { group: 0, name: 0, catnr: 0, alt: 0 };

  // S1 分组
  let r = await get(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${GROUPS[key]}&FORMAT=tle`);
  if (r.ok) from.group = parseTLE(r.text, merged); else console.log('  S1 GROUP 失败', r.status);
  console.log(key, 'S1 GROUP  →', from.group, '份');

  // S2 名称模糊
  for (const nm of NAMES[key]) {
    r = await get(`https://celestrak.org/NORAD/elements/gp.php?NAME=${encodeURIComponent(nm)}&FORMAT=tle`);
    if (r.ok) from.name += parseTLE(r.text, merged); else console.log('  S2 NAME=' + nm, r.status);
  }
  console.log(key, 'S2 NAME   → 新增', merged.size - before - from.group, '颗（累计', merged.size, '）');

  // S3 目录里查得到编号、但上面没拿到的（跳过已再入的）
  //   ⚠️ 编目号 **超过 5 位**的对象**不在这里处理** —— 经典 TLE 的编目号字段只有 5 列，
  //     对 6 位号调 FORMAT=tle 一律返回「No GP data found」（实测 100203）。它们统一走下面的 S5：
  //     用 FORMAT=json（OMM）取，再转成"TLE 形状"（编目号用占位）并把真号记进 sidecar。
  //   ★ 旧注释写的是「临时号：目录里没有轨道要素」——**这个前提是错的**（实测有完整 GP），
  //     误导过一次全库级排查，见 V1.9.1 任务清单第十轮核查。
  const todo = [];
  Object.keys(catByPrefix[key] || {}).forEach(p => {
    (catByPrefix[key][p] || []).forEach(o => {
      if (o.type !== 'PAY' || o.decay) return;
      if (String(o.norad).length > 5) return;               // >5 位 → 走 S5 的 OMM 通路
      if (merged.has(o.norad)) return;
      todo.push(o);
    });
  });
  for (const o of todo.slice(0, 60)) {
    r = await get(`https://celestrak.org/NORAD/elements/gp.php?CATNR=${o.norad}&FORMAT=tle`);
    if (r.ok && /^1 /.test(r.text)) from.catnr += parseTLE(r.text, merged);
    await sleep(120);
  }
  if (todo.length) console.log(key, 'S3 CATNR  → 目录待补', todo.length, '颗，补到', from.catnr, '颗');

  // S4 备源：tle.ivanstanojevic.me（按 NORAD）
  const still = [];
  Object.keys(catByPrefix[key] || {}).forEach(p => {
    (catByPrefix[key][p] || []).forEach(o => {
      if (o.type !== 'PAY' || o.decay) return;
      if (String(o.norad).length > 5) return;               // >5 位 → 走 S5
      if (merged.has(o.norad)) return;
      still.push(o);
    });
  });
  for (const o of still.slice(0, 40)) {
    r = await get(`https://tle.ivanstanojevic.me/api/tle/${o.norad}`);
    if (r.ok) {
      try {
        const j = JSON.parse(r.text);
        if (j && j.line1 && j.line2) {
          parseTLE((j.name || o.name) + '\n' + j.line1 + '\n' + j.line2 + '\n', merged);
          from.alt++;
        }
      } catch (e) { /* 不是 JSON：忽略 */ }
    }
    await sleep(120);
  }
  if (still.length) console.log(key, 'S4 备源   → 待补', still.length, '颗，补到', from.alt, '颗');

  // ---- S5 OMM：**兜底通路**（任何 S1–S4 没拿到的对象都在这里试） ----
  //   为什么需要它：CelesTrak 自 2026-07-11 起**新对象一律 6 位编目号**（100000+），
  //   而**经典 TLE 的编目号字段只有 5 列** → 这些对象调 FORMAT=tle 一律「No GP data found」，
  //   S1（GROUP）/S2（NAME）/S3（CATNR+tle）/S4（备源）**全都拿不到**。
  //   ★ V1.9.1 起的口径（这就是"不会再出现无法识别新编号"的保证）：
  //     · 判据**不再是"≥100000"这个魔数**，而是「**编目号位数 > 5**」——
  //       将来若出现 7 位号，同一段代码自动适用；
  //     · 而且这里**不再限定 5 位/6 位**：凡是 catByPrefix 认定属于本星座、
  //       而前面四条通路没取到的对象，**一律用 OMM 再试一次**（顺带兜住 S3/S4 的偶发失败）。
  //   做法：FORMAT=json（OMM）→ scripts/omm.mjs 转成"TLE 形状"文本（**编目号填占位 =
  //   真号后 5 位**）→ 真号记进 data/omm_norad.json，由 mkdata.mjs 写回前端 id（前端零改动）。
  //   （转换器自带往返自检：node scripts/omm.mjs --selftest。）
  const ommTodo = [];
  Object.keys(catByPrefix[key] || {}).forEach(p => {
    (catByPrefix[key][p] || []).forEach(o => {
      if (o.type !== 'PAY' || o.decay) return;
      // ★ 判据分两类（V1.9.1 定稿）：
      //   · 编目号 **>5 位**：S1–S4 那条 TLE 通路**永远**拿不到（编目字段装不下）→
      //     OMM 是唯一来源，因此**每轮都必须重取**。旧版写的是「占位号在 merged 里就跳过」，
      //     后果有两个：① 落盘的坏行（NaN）永远修不好；② 历元永远停在第一次取到的那份，
      //     TLE 不再更新（页面轨道慢慢跑偏）。两个后果都属于"看起来正常"的静默故障。
      //   · 编目号 ≤5 位：正常应被 S1/S2 覆盖，走到这里说明前四条通路都失败了 →
      //     用 OMM 兜底补一次即可，已在 merged 里就不必重取。
      if (merged.has(Number(PH(o.norad))) && String(o.norad).length <= 5) return;
      ommTodo.push(o);
    });
  });
  // ★ 静默 catch 是"补到 0 颗"却看不出原因的元凶（V1.9.0 起一直没发现）→ 现在累计错误并打印。
  let ommErr = 0; const ommErrMsg = [];
  const OMM_CAP = 400;                                   // 上限（正常规模 ~55；留足余量并防失控）
  for (const o of ommTodo.slice(0, OMM_CAP)) {
    r = await get(`https://celestrak.org/NORAD/elements/gp.php?CATNR=${o.norad}&FORMAT=json`);
    if (!r.ok) {
      ommErr++;
      if (ommErrMsg.length < 3) ommErrMsg.push(o.norad + ': HTTP ' + r.status + (r.err ? ' ' + r.err : ''));
    } else {
      try {
        const arr = JSON.parse(r.text);
        const om = Array.isArray(arr) ? arr[0] : arr;
        if (om && om.MEAN_MOTION) {
          const ph = PH(o.norad);
          const t = fromCelesTrakOmm(om);
          const [l1s, l2s] = tleFromOmm(t, ph);
          // 直接按占位号塞进 merged（名称沿用目录里的写法，便于下面的 MATCH 过滤）
          merged.set(Number(ph), { name: o.name, l1: l1s, l2: l2s,
            epoch: t.EPOCH_Y2 * 1000 + t.EPOCH_DOY, cospar: (om.OBJECT_ID || o.cospar).trim() });
          OMM_IDS[ph] = o.norad;
          from.omm = (from.omm || 0) + 1;
        } else { ommErr++; if (ommErrMsg.length < 3) ommErrMsg.push(o.norad + ': 响应无 MEAN_MOTION（' + r.text.slice(0, 60).replace(/\s+/g, ' ') + '）'); }
      } catch (e) {
        ommErr++;
        if (ommErrMsg.length < 3) ommErrMsg.push(o.norad + ': JSON 解析失败 — ' + (e && e.message));
      }
    }
    await sleep(120);
  }
  if (ommTodo.length) {
    console.log(key, 'S5 OMM    → 待补', ommTodo.length, '颗（处理', Math.min(ommTodo.length, OMM_CAP), '），补到', from.omm || 0, '颗，失败', ommErr);
    ommErrMsg.forEach(m => console.log('             · ' + m));
    // ★ 全失败时**必须显式告警**（旧版静默 → 数据静默缺失，是最难查的一类问题）
    if ((from.omm || 0) === 0 && ommErr > 0) console.log('             ⚠️ 全部失败：疑似网络/上游不可达 —— 请检查本机到 celestrak.org 的连通性');
    if (ommTodo.length > OMM_CAP) console.log('             ⚠️ 超过处理上限 ' + OMM_CAP + '，本次有 ' + (ommTodo.length - OMM_CAP) + ' 颗未处理');
  }

  // 只保留名字能对上的（避免 NAME=GW- 这类前缀误伤其它星座的卫星）
  const out = new Map();
  [...merged.values()].forEach(s => { if (MATCH[key].test(s.name)) out.set(parseInt(s.l1.slice(2, 7), 10), s); });
  Object.assign(report[key], { after: out.size, added: out.size - before, from: from });
  writeTLE(file, out, path.join(D, file));

  // ★ V1.9.1 出口体检：写盘后**立刻复查**，任何一行数值列仍是 NaN 都必须当场喊出来。
  //   理由：这类坏行是"静默污染"（长度正确、正则放过、页面算不出轨道），
  //   出口断言是最后一道网 —— 宁可 CI 红，也不要让坏数据进仓库。
  const badOut = [...out.values()].filter(s => !tleHealth(s.l2 || ''))
    .map(s => s.l1.slice(2, 7) + '/' + (s.cospar || ''));
  if (badOut.length) {
    console.log('  ❌ 出口体检：' + badOut.length + ' 颗卫星的 L2 数值列非法（' + badOut.slice(0, 5).join(', ') +
      (badOut.length > 5 ? ' …' : '') + '）—— 这批数据不可用，请检查上游');
  } else {
    console.log(key, '出口体检 → ' + out.size + ' 颗全部通过（L2 数值列均为有限数）');
  }
  report[key].badOut = badOut.length;

  // 仍然拿不到轨道要素的
  //   ⚠️ 查询键必须兼容**占位号**：6 位对象在 out / merged 里是以占位号（真号后 5 位）为键的，
  //   直接用真号 `out.has(o.norad)` 会恒为 false → 报告"仍缺 36 颗"（而文件里其实已经有），
  //   并把错误的 missing_*.json 写盘（下游会把它们当"无轨道要素"处理）。见 V1.9.1 第十轮核查。
  const miss = [];
  Object.keys(catByPrefix[key] || {}).forEach(p => {
    (catByPrefix[key][p] || []).forEach(o => {
      if (o.type !== 'PAY' || o.decay) return;
      if (out.has(o.norad) || out.has(Number(PH(o.norad)))) return;
      miss.push({ norad: o.norad, cospar: o.cospar, name: o.name, launch: o.launch, pre: o.pre });
    });
  });
  report[key].missing = miss.length;
  fs.writeFileSync(path.join(D, `missing_${key}.json`), JSON.stringify(miss, null, 1), 'utf8');
  console.log(key, '最终', out.size, '颗（上轮文件', prevN, '颗', (droppedBad ? '，其中坏行 ' + droppedBad : '') +
    '）｜仍缺轨道要素', miss.length, '颗');

  // ---------------------------------------------------------------- V1.9.0（R17）：自建历史库
  // 每次刷新都把「这一刻每颗星的半长轴」存档一条，历史库就一天天自己长起来 ——
  //   这样 05 章「升轨情况」不依赖任何外部历史源（Space-Track 的 GP 历史有严格限流，
  //   且命令行一律 401；免登录源又只给最新一条，实测 tle.ivanstanojevic.me 的历史端点 404）。
  // 口径与页面端完全一致：布劳威尔半长轴（altFromOmm 已剥掉 J2 长期项，量级错误修过一次，
  //   **不要在这里另写一份换算**）。
  // 分片按**批次 key** = COSPAR 后 5 位（如 23095），与 data/history/<key>.json 同名。
  // 幂等：mergeInto 按 (NORAD, 历元) 去重，同一天跑两次不会重复存储（用户 Q40 明确要求）。
  try {
    const byLk = new Map();
    for (const s of out.values()) {
      const mm = Number((s.l2 || '').slice(52, 63));           // TLE 第 2 行 53–63 列 = 平均运动
      const e = parseFloat('0.' + (s.l2 || '').slice(26, 33)); // 第 2 行 27–33 列 = 偏心率
      const inc = parseFloat((s.l2 || '').slice(8, 16));       // 第 2 行 9–16 列 = 倾角
      const yy = parseInt((s.l1 || '').slice(18, 20), 10);
      // ⚠️ 历元日必须取**整个 21–32 列**（含小数）：只取前 3 位（旧写法 slice(20,23)）会得到
      //   整数天，同日内多次刷新会算出**同一个 ms** → 被 mergeInto 判为重复而**存不进去**。
      const ddd = parseFloat((s.l1 || '').slice(20, 32));
      if (!(mm > 0) || !isFinite(yy) || !isFinite(ddd)) continue;
      const fullYear = yy < 57 ? 2000 + yy : 1900 + yy;
      const ms = Date.UTC(fullYear, 0, 0) + ddd * 86400000;
      const alt = altFromOmm({ MEAN_MOTION: mm, ECCENTRICITY: e, INCLINATION: inc });
      if (alt == null || !isFinite(ms)) continue;
      // COSPAR：第 1 行 10–17 列（如 "23095A "）；批次 key 只取**前 5 位数字**。
      //   ⚠️ 旧写法 slice(9,15) 会把第 6 位的分片字母（A）也带进来 → 正则 ^\d{5}$ 恒不匹配
      //   → 所有卫星都被 continue 掉，历史库一个字节都存不进去。
      const cospar = (s.l1 || '').slice(9, 14);
      const lk = /^\d{5}$/.test(cospar) ? cospar : null;
      if (!lk) continue;
      // ⚠️ 编目号必须换成**真号**：6 位对象在 .tle 里是**占位号**（真号后 5 位），
      //   若直接把占位号写进历史库，页面端 `climbSatIdx()` 拿真号（mkdata 已还原）去匹配就永远找不到 →
      //   曲线空白的**静默**故障。OMM_IDS 是本轮 S5 刚落盘的「占位号 → 真号」映射。
      const raw5 = (s.l1 || '').slice(2, 7);
      const norad = OMM_IDS[raw5] || parseInt(raw5, 10);
      if (!norad) continue;
      if (!byLk.has(lk)) byLk.set(lk, []);
      // ★ V1.9.1 常量统一：回加的地球半径必须与**页面端 CLIMB_RE 一致**（见 scripts/fetch_history.mjs
      //   同一处的长注释）。两个写库方（refresh 与 fetch_history）用不同常量，会让同一天的
      //   "半长轴"出现 2 m 级的分叉 —— 虽小，但属"存量与增量口径不一致"的隐患。
      byLk.get(lk).push([norad, ms, Math.round((alt + 6378.137) * 100) / 100]);   // 存**半长轴**（= 高度 + 地球半径）
    }
    let st = { shards: 0, added: 0, pruned: 0 };
    for (const [lk, recs] of byLk) {
      const r2 = mergeInto(HIST_DIR, [{ key: lk, records: recs }]);
      st.shards++; st.added += r2.added;
      // ★ 存档后**立刻做容量治理**：data/history 是要进 git 仓库的，
      //   不治理的话分片会逐年线性膨胀（436 颗 × 1 点/天 ≈ 4 MB/年 → 仓库越来越大）。
      //   pruneRecords 是分层降采样，只降低老数据的密度，**最近的数据一个点都不会少**。
      const cur = readShard(HIST_DIR, lk);
      if (cur.length) {
        const pr = pruneRecords(cur, Date.now());
        if (pr.recs.length !== cur.length) {
          writeShard(HIST_DIR, lk, pr.recs);
          st.pruned += (pr.stats.before - pr.stats.after);
        }
      }
    }
    console.log(key, '历史存档 → ' + st.shards + ' 个批次、新增 ' + st.added + ' 条' +
      (st.pruned ? '、治理裁掉 ' + st.pruned + ' 条' : '') + '（' + byLk.size + ' 批候选）');
    report[key].hist = st;
  } catch (e) {
    // 存档失败**绝不能**影响 TLE 刷新本身（计划任务的主职责是刷新数据）
    console.log(key, '历史存档跳过：', e && e.message);
    report[key].hist = { err: String(e && e.message || e) };
  }
}
fs.writeFileSync(path.join(D, 'refresh_report.json'), JSON.stringify(report, null, 1), 'utf8');
// V1.9.0：把「占位号 → 真号」的映射落盘，供 mkdata.mjs 把真号写回前端 id（前端代码零改动）
fs.writeFileSync(OMM_IDS_PATH, JSON.stringify(OMM_IDS, null, 1), 'utf8');
console.log('\n报告已写入 data/refresh_report.json（OMM 映射 ' + Object.keys(OMM_IDS).length + ' 条 → data/omm_norad.json）');

// ---------------------------------------------------------------- 全局出口闸门（V1.9.1）
// 若产出的 .tle 里仍存在**数值列非法**的行（L2 含 NaN 之类），以非零码退出。
//   为什么必须让进程失败（而不是只打印一句）：
//     · 调用链是 `refresh.mjs && mkdata.mjs && build.mjs` —— 非零码会让后面两步**不执行**，
//       页面不会用坏数据重建；
//     · CI（update-tle.yml）里非零码 → 作业失败 → **"有变化才提交"那一步不执行** →
//       坏数据根本进不了仓库；
//     · 计划任务里非零码 → 任务列表显示失败 → 人看得见（旧版是"任务成功但数据缺失"）。
//   这是"宁可红、不要静默"的落地。
{
  const badTotal = Object.keys(report).reduce((a, k) => a + (report[k].badOut || 0), 0);
  if (badTotal) {
    console.error('❌ 出口闸门：共 ' + badTotal + ' 行卫星数据的数值列非法（L2 含 NaN）—— 这些卫星算不出轨道。');
    console.error('   可能原因：上游字段名变更 / 上游数据本身异常 / 网络不可达导致本轮回落到旧坏行。');
    console.error('   已按"不可用"处理，refresh 以非零码（3）结束，以免坏数据被下游打包或提交。');
    // ⚠️ 用 exitCode 而不是 process.exit()：端到端测试是**同进程 import** 本脚本的，
    //   process.exit() 会把测试进程当场杀掉、断言输出全丢（且无法被 try/catch 拦住）。
    //   exitCode 一样能让 `&&` 调用链与 CI 作业失败，且不影响同进程调用方。
    process.exitCode = 3;
  }
}
