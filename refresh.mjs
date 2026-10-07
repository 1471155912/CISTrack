/* 刷新两个星座的 TLE + SATCAT
 * V1.3.7：改成「多源 + 按 COSPAR / 编号反查」。
 *   旧版只按 CelesTrak 的 GROUP=hulianwang / qianfan 分组抓，这两个分组漏掉了
 *   早期试验星（23095 / 23212 等）与部分刚入轨的批次。现在四个来源依次合并：
 *     S1 GROUP=          星座分组（主源，和旧版一致）
 *     S2 NAME=           CelesTrak 的 NAME 是前缀模糊匹配，能捞回 S1 漏掉的星
 *     S3 CATNR=          用完整 NORAD 目录按 COSPAR 前缀反查出编号后逐颗补（正式编号才查，
 *                        100xxx 是尚未编目的临时号，目录里本来就没有轨道要素，跳过）
 *     S4 tle.ivanstanojevic.me   上面都拿不到时的备源
 *   同一颗卫星多源都有时，取历元（epoch）最新的那份。
 * 用法：node refresh.mjs [--force-cat]      --force-cat 强制重下 6.7MB 的 satcat.csv
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
  const before = merged.size;
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

  // S3 目录里查得到编号、但上面没拿到的（跳过 100xxx 临时号与已再入的）
  const todo = [];
  Object.keys(catByPrefix[key] || {}).forEach(p => {
    (catByPrefix[key][p] || []).forEach(o => {
      if (o.type !== 'PAY' || o.decay) return;
      if (o.norad >= 100000) return;                        // 临时号：目录里没有轨道要素
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
      if (o.type !== 'PAY' || o.decay || o.norad >= 100000 || merged.has(o.norad)) return;
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

  // 只保留名字能对上的（避免 NAME=GW- 这类前缀误伤其它星座的卫星）
  const out = new Map();
  [...merged.values()].forEach(s => { if (MATCH[key].test(s.name)) out.set(parseInt(s.l1.slice(2, 7), 10), s); });
  report[key] = { before: before, after: out.size, added: out.size - before, from: from };
  writeTLE(file, out, path.join(D, file));

  // 仍然拿不到轨道要素的（几乎都是 100xxx 临时号）
  const miss = [];
  Object.keys(catByPrefix[key] || {}).forEach(p => {
    (catByPrefix[key][p] || []).forEach(o => {
      if (o.type !== 'PAY' || o.decay) return;
      if (!out.has(o.norad)) miss.push({ norad: o.norad, cospar: o.cospar, name: o.name, launch: o.launch, pre: o.pre });
    });
  });
  report[key].missing = miss.length;
  fs.writeFileSync(path.join(D, `missing_${key}.json`), JSON.stringify(miss, null, 1), 'utf8');
  console.log(key, '最终', out.size, '颗（原', before, '）｜仍缺轨道要素', miss.length, '颗');
}
fs.writeFileSync(path.join(D, 'refresh_report.json'), JSON.stringify(report, null, 1), 'utf8');
console.log('\n报告已写入 data/refresh_report.json');
