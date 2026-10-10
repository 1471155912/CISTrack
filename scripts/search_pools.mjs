// ---------------------------------------------------------------- V1.9.1（A19）：搜索补池
// 页面搜索原先只在 `cur().sats` 里找 —— 而「已再入」与「尚未编目」这两类对象本来就不在库内
// （没有可用 TLE），于是**搜名字/NORAD 什么都搜不到**，用户会以为它们不存在。
//
// 本模块读 **satcat 文本**（零额外请求 —— 它本来就每天下载），把「属于本星座批次、
// OBJECT_TYPE=PAY、但库内没有该 NORAD」的对象分成两池：
//   · dead —— 已再入（有 DECAY_DATE）  → 页面标红   + 弹「该卫星已再入」
//   · pend —— 尚未编目（无 DECAY_DATE）→ 页面标琥珀 + 弹「该卫星尚未编目」
//
// ★ 两条边界（都容易写错，故写死在这里）：
//   ① **已在库的已再入对象不进 dead 池** —— 它们本来就在主搜索池里（如 63428），页面用
//      `st === 'r'` 判红；若也塞进 dead 池，搜索结果会**同一条出现两次**。
//   ② `c` 输出**库内口径的 6 列 COSPAR**（"26128B"），不是 satcat 的 9 字符 OBJECT_ID
//      （"2026-128B"）—— 两套格式混用是 1.6 踩过的坑（直接比对永远不等）。
//
// ★ 为什么抽成独立模块：真实数据里这两池当前**恰好都是空的**（1.1/1.4/1.6 之后已 100% 归位），
//   一个恒为空的分支**跑真实数据验证不了**。抽出来后可以用合成 satcat 逐条断言分流正确。

/** CSV 一行拆列（satcat.csv 是简单 CSV，字段内无逗号与引号 —— 与 mkdata 其余处一致）。 */
function cols(line) { return line.split(','); }

/**
 * @param {string} satcatText        data/satcat.csv 全文
 * @param {string[]} batchKeys       本星座的批次 key（COSPAR 后 5 位，如 '26128'）
 * @param {Set<number>} haveNorads   库内已有 TLE 的 NORAD 集合（= 主搜索池）
 * @param {(key:string, norad:number)=>boolean} isStowaway  搭车星判据（唯一来源在 mkdata.mjs）
 * @returns {{dead:Array, pend:Array}}
 */
export function searchPools(satcatText, batchKeys, haveNorads, isStowaway) {
  const dead = [], pend = [];
  if (!satcatText) return { dead, pend };
  const rows = satcatText.split('\n');
  if (!rows.length) return { dead, pend };
  const head = cols(rows[0]); const ix = n => head.indexOf(n);
  // 缺列直接返回空 —— 宁可没有补池，也不能靠 undefined 列位错判（错判会把在轨星标成已再入）
  const iId = ix('OBJECT_ID'), iNo = ix('NORAD_CAT_ID'), iTy = ix('OBJECT_TYPE');
  const iDec = ix('DECAY_DATE'), iNm = ix('OBJECT_NAME');
  if (iId < 0 || iNo < 0 || iTy < 0 || iNm < 0) return { dead, pend };
  for (let i = 1; i < rows.length; i++) {
    const line = rows[i];
    if (!line) continue;
    const c = cols(line);
    const id = (c[iId] || '').trim();
    const m = id.match(/^(\d{4})-(\d+)([A-Z]*)/);
    if (!m) continue;
    const key = m[1].slice(2) + String(+m[2]).padStart(3, '0');
    if (batchKeys.indexOf(key) < 0) continue;
    if ((c[iTy] || '').trim() !== 'PAY') continue;              // R/B、DEB 不是卫星
    const norad = +c[iNo];
    if (!norad) continue;
    if (isStowaway(key, norad)) continue;                       // 搭车星不属于本星座
    if (haveNorads.has(norad)) continue;                        // 已在主池 → 不进补池（边界①）
    const rec = { n: norad, nm: (c[iNm] || '').trim(), c: key + (m[3] || ''), bk: key };
    const dec = iDec >= 0 ? (c[iDec] || '').trim() : '';
    if (dec) { rec.on = dec.slice(0, 10); dead.push(rec); }      // 已再入
    else pend.push(rec);                                        // 尚未编目
  }
  dead.sort((a, b) => a.n - b.n);
  pend.sort((a, b) => a.n - b.n);
  return { dead, pend };
}

// ---------------------------------------------------------------- 自检（node scripts/search_pools.mjs）
const isMain = (() => {
  try { return process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop()); }
  catch (e) { return false; }
})();
if (isMain) {
  let pass = 0, fail = 0;
  const ck = (name, cond, extra) => {
    if (cond) { pass++; console.log('  ✓ ' + name); }
    else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
  };
  const HEAD = 'OBJECT_ID,NORAD_CAT_ID,OBJECT_TYPE,OBJECT_NAME,DECAY_DATE,PERIOD,INCLINATION';
  const row = (id, no, ty, nm, dec) => [id, no, ty, nm, dec, '', ''].join(',');
  const STOW = { '26128': [69473], '24226': [62185] };
  const isStow = (k, n) => !!(STOW[k] && STOW[k].indexOf(Number(n)) >= 0);

  // 合成目录：
  //  26128A 在库（主池）         → 不进任何池
  //  26128B 搭车星（已再入）     → 被排除
  //  25067A 已在库（已再入的）   → **不进 dead 池**（边界①）
  //  25067B 已再入、库内无 TLE   → dead
  //  26176A 尚未编目（100xxx）   → pend
  //  26176B R/B（非 PAY）        → 排除
  //  99999A 别的星座             → 排除
  const csv = [HEAD,
    row('2026-128A', 69472, 'PAY', 'DTC TEST OBJECT A', ''),
    row('2026-128B', 69473, 'PAY', 'CHINA MOBILE 02', '2026-08-01'),
    row('2025-067A', 63428, 'PAY', 'HULIANWANG JISHU SHIYAN 6A', '2025-10-16'),
    row('2025-067B', 63429, 'PAY', 'HULIANWANG JISHU SHIYAN 6B', '2026-01-02'),
    row('2026-176A', 100203, 'PAY', 'HULIANWANG DIGUI-200', ''),
    row('2026-176B', 100204, 'R/B', 'CZ-8A R/B', ''),
    row('2026-999A', 99999, 'PAY', 'SOMEBODY ELSE', '')
  ].join('\n');

  const p = searchPools(csv, ['26128', '25067', '26176'], new Set([69472, 63428]), isStow);
  ck('① 在库对象不进补池（26128A）', !p.dead.concat(p.pend).some(r => r.n === 69472));
  ck('② 搭车星被排除（26128B=69473）', !p.dead.concat(p.pend).some(r => r.n === 69473));
  ck('③ 已在库的已再入不进 dead（25067A=63428）', !p.dead.some(r => r.n === 63428));
  ck('④ 库内无 TLE 的已再入进 dead（25067B=63429）',
    p.dead.length === 1 && p.dead[0].n === 63429 && p.dead[0].on === '2026-01-02',
    JSON.stringify(p.dead));
  ck('⑤ 尚未编目进 pend（100203）', p.pend.length === 1 && p.pend[0].n === 100203, JSON.stringify(p.pend));
  ck('⑥ R/B 被排除（100204）', !p.pend.some(r => r.n === 100204));
  ck('⑦ 非本星座批次被排除（99999）', !p.pend.some(r => r.n === 99999));
  ck('⑧ COSPAR 归一化为库内 6 列口径', p.pend[0].c === '26176A', p.pend[0] && p.pend[0].c);
  ck('⑨ 记录字段齐备（n/nm/c/bk）',
    p.dead.concat(p.pend).every(r => r.n && r.nm && r.c && r.bk));
  ck('⑩ 空目录不炸', searchPools('', ['26128'], new Set(), isStow).pend.length === 0);
  ck('⑪ 缺列不误判（宁可空池）', searchPools('FOO,BAR\n1,2', ['26128'], new Set(), isStow).dead.length === 0);
  ck('⑫ 按 NORAD 升序', (() => {
    const q = searchPools([HEAD, row('2025-067B', 63429, 'PAY', 'B', '2026-01-02'),
      row('2025-067C', 63430, 'PAY', 'C', '2026-01-03')].join('\n'), ['25067'], new Set(), isStow);
    return q.dead[0].n === 63429 && q.dead[1].n === 63430;
  })());
  console.log('\nsearch_pools 自检：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exitCode = fail ? 1 : 0;
}
