/* ab_gp_format.mjs —— ★ V1.9.5（H42）：**同一时刻对拍两种取数格式**（legacy TLE vs OMM JSON）
 * ---------------------------------------------------------------------------
 * 为什么必须有它：
 *   H42 的迁移（S1/S2/S3 的 `FORMAT=tle` → `FORMAT=json`）**唯一**真实风险是
 *   "上游两个端点给的不是同一份数据"。离线 e2e（e2e_omm_offline.mjs）只能证明**我们的解析管线**对，
 *   证明不了**上游两格式等价** —— 而那是只能对真上游跑的一次性事实核查。
 *   于是把它做成**可重复执行**的对照：两边都取回来，逐字段比。
 *
 * 做法（刻意不另写解析）：
 *   · TLE 侧：`ommFromTLE(l1, l2)`  —— scripts/omm.mjs 的现成函数（就是往返自检用的那个）；
 *   · JSON 侧：`fromCelesTrakOmm(om)` —— **迁移后真正走的那个函数**；
 *   · 两者返回的是**同一个内部形状**，逐字段比即可。
 *   · **只比历元完全相同的对象**：历元不同则轨道要素本就该不同，不可比（上游两个端点
 *     各自的缓存窗口可能差一个更新周期）—— 这类对象只计入"不可比"，不算不符。
 *
 * 退出码：0 = 一致 / 跳过（含"legacy 端点已停用"这种预期内情形）；1 = 存在字段不符。
 * 用法：node scripts/ab_gp_format.mjs
 */
import { ommFromTLE, fromCelesTrakOmm } from './omm.mjs';

const GROUPS = { gw: 'hulianwang', qf: 'qianfan' };
const URL = (g, f) => `https://celestrak.org/NORAD/elements/gp.php?GROUP=${g}&FORMAT=${f}`;

/** 每个字段的允许偏差（按 **TLE 的打印精度** 定；两边都是数值，故用数值比较，不碰文本格式） */
const FIELDS = [
  ['OBJECT_ID', 'text'],
  ['EPOCH_Y2', 0], ['EPOCH_DOY', 1e-8],                    // TLE 打 8 位小数
  ['MEAN_MOTION_DOT', 'rel', 2e-5], ['MEAN_MOTION_DDOT', 'rel', 2e-5], ['BSTAR', 'rel', 2e-5],
  ['EPHEMERIS_TYPE', 0], ['ELEMENT_SET_NO', 0], ['REV_AT_EPOCH', 0],
  ['INCLINATION', 2e-4], ['RAAN', 2e-4],                   // TLE 打 4 位小数
  ['ECCENTRICITY', 2e-7],                                  // 7 位小数
  ['ARG_OF_PERICENTER', 2e-4], ['MEAN_ANOMALY', 2e-4],
  ['MEAN_MOTION', 2e-8],                                   // 11 位小数
];

async function getText(url, timeoutMs = 30000) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return { ok: r.ok, status: r.status, text: await r.text() };
  } catch (e) { return { ok: false, status: 0, text: '', err: (e && e.message) || String(e) }; }
}
function parseTleBlocks(txt) {
  const lines = String(txt || '').split('\n').map(s => s.trim()).filter(Boolean);
  const out = new Map();
  for (let i = 0; i + 2 < lines.length; i += 3) {
    const l1 = lines[i + 1], l2 = lines[i + 2];
    if (!/^1 /.test(l1) || !/^2 /.test(l2)) continue;
    out.set(parseInt(l1.slice(2, 7), 10), { l1, l2 });
  }
  return out;
}

let skipped = false, fails = 0, cmpTotal = 0;
for (const key of Object.keys(GROUPS)) {
  const [rT, rJ] = [await getText(URL(GROUPS[key], 'tle')), await getText(URL(GROUPS[key], 'json'))];
  if (!rT.ok || !rJ.ok) {
    console.log('SKIP ' + key + '：端点不可达（TLE HTTP ' + rT.status + ' / JSON HTTP ' + rJ.status +
      (rT.err ? ' ' + rT.err : '') + '）—— 本机网络到 celestrak 受限时属正常，不判失败');
    skipped = true; continue;
  }
  // legacy 端点是否还在服务 TLE（政策预告过它会停用）→ 那时本对照自动退役
  if (!/^\s*1 \d/m.test(rT.text)) {
    console.log('SKIP ' + key + '：legacy TLE 端点已不返回 TLE（政策预告的停用发生了）→ 对照自动失效，无需再比');
    skipped = true; continue;
  }
  let jarr;
  try { jarr = JSON.parse(rJ.text); } catch (e) {
    console.log('FAIL ' + key + '：JSON 端点返回的不是合法 JSON（前 80 字：' + rJ.text.slice(0, 80).replace(/\s+/g, ' ') + '）');
    fails++; continue;
  }
  const jlist = Array.isArray(jarr) ? jarr : (jarr && Array.isArray(jarr.data) ? jarr.data : [jarr]);
  const byNorad = new Map();
  jlist.forEach(om => { if (om && om.NORAD_CAT_ID !== undefined) byNorad.set(Number(om.NORAD_CAT_ID), om); });

  const tle = parseTleBlocks(rT.text);
  let same = 0, epDiff = 0, miss = 0, fieldBad = 0;
  const samples = [];
  for (const [norad, t] of tle) {
    const om = byNorad.get(norad);
    if (!om) { miss++; continue; }
    const a = ommFromTLE(t.l1, t.l2), b = fromCelesTrakOmm(om);
    // 先比历元：不同则要素不可比（上游两端的缓存窗口可能差一个更新周期）
    if (String(a.EPOCH_Y2) !== String(b.EPOCH_Y2) || Math.abs(a.EPOCH_DOY - b.EPOCH_DOY) > 1e-8) { epDiff++; continue; }
    same++;
    for (const [f, spec, rel] of FIELDS) {
      cmpTotal++;
      let bad;
      if (spec === 'text') bad = String(a[f]).trim() !== String(b[f]).trim();
      else if (spec === 'rel') bad = Math.abs(Number(a[f]) - Number(b[f])) > Math.max(1e-12, rel * Math.abs(Number(a[f])));
      else bad = Math.abs(Number(a[f]) - Number(b[f])) > spec;
      if (bad) {
        fieldBad++;
        if (samples.length < 5) samples.push('#' + norad + ' ' + f + '：TLE=' + a[f] + ' vs JSON=' + b[f]);
      }
    }
  }
  const okAll = fieldBad === 0 && same > 0;
  if (!okAll) fails++;
  console.log((okAll ? 'PASS ' : 'FAIL ') + key + '（' + GROUPS[key] + '）：可比 ' + same + ' 颗（历元相同）/ 历元不同 ' +
    epDiff + ' 颗未比 / TLE 有而 JSON 无 ' + miss + ' 颗 → 字段不符 **' + fieldBad + '** 处' +
    (samples.length ? '\n      ' + samples.join('\n      ') : ''));
}
console.log('\n结论：' + (skipped && !fails ? '已跳过（端点不可用）' : fails ? '发现 ' + fails + ' 个星座存在不符 —— 迁移前后数据**不等价**，请先别切默认格式' :
  '两格式**逐字段一致**（共比对 ' + cmpTotal + ' 个字段）—— 迁移到 OMM JSON 是等价的'));
process.exit(fails ? 1 : 0);
