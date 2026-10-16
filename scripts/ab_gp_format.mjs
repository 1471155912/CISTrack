/* ab_gp_format.mjs —— ★ V1.9.5（H42）：**同一时刻对拍两种取数格式**（legacy TLE vs OMM JSON）
 * ---------------------------------------------------------------------------
 * 为什么必须有它：
 *   H42 的迁移（S1/S2/S3 的 `FORMAT=tle` → `FORMAT=json`）**唯一**真实风险是
 *   "上游两个端点给的不是同一份数据"。离线 e2e（e2e_omm_offline.mjs）只能证明**我们的解析管线**对，
 *   证明不了**上游两格式等价** —— 而那是只能对真上游跑的事实核查。
 *   于是把它做成**可重复执行**的对照：两边都取回来，逐字段比。
 *
 * 做法（刻意不另写解析）：
 *   · TLE 侧：`ommFromTLE(l1, l2)`  —— scripts/omm.mjs 的现成函数（就是往返自检用的那个）；
 *   · JSON 侧：`fromCelesTrakOmm(om)` —— **迁移后真正走的那个函数**；
 *   · 两者返回的是**同一个内部形状**，逐字段比即可。
 *   · 只比**历元相同**的对象：历元不同则轨道要素本就该不同（上游两端缓存窗口可能差一个更新周期）。
 *     ⚠️ 历元相等的判据取 2e-7 天（≈17 ms）：OMM 的 EPOCH 是 ISO 时间戳、JS 只解析到**毫秒**，
 *     而 TLE 历元有 8 位小数（≈0.86 ms）→ 用 1e-8 会贴边误判（第一版就因此多报了一批）。
 *
 * 用法：
 *   node scripts/ab_gp_format.mjs            真上游对拍（CI 上跑；本机不可达时自动 SKIP）
 *   node scripts/ab_gp_format.mjs --selftest  **离线自检比较器本身**（用本地 TLE 造"CelesTrak 风格 JSON"）
 * 退出码：0 = 一致 / 跳过（含"legacy 端点已停用"这种预期内情形）；1 = 存在字段不符。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ommFromTLE, fromCelesTrakOmm, cosparField } from './omm.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const GROUPS = { gw: 'hulianwang', qf: 'qianfan' };
const URL = (g, f) => `https://celestrak.org/NORAD/elements/gp.php?GROUP=${g}&FORMAT=${f}`;
const EP_EPS = 2e-7;                    // "同一份要素"的历元判据（天）；见文件头说明

/** 每个字段的允许偏差（按 **TLE 的打印精度** 定；两边都是数值，故用数值比较，不碰文本格式）
 *
 * ★ 指数类字段（ndot / nddot / BSTAR）的容差要**按 TLE 的打印位数**给，否则会误报：
 *   TLE 的这三个字段只打印 **5 位有效数字**（如 BSTAR `12066-3` = 1.2066e-4），
 *   而 OMM JSON 给的是**全精度**（1.2065756e-4）→ 实测差值 ≈ 半个末位（2~4e-9）。
 *   这是"JSON 比 TLE 更精确"，**不是数据不符** —— CI 第二轮就是被这里误报的（33 + 47 处）。
 *   ⇒ 判据改成 `|Δ| > max(absFloor, rel·|a|)`：absFloor = 一个打印步长（1e-8），rel = 1e-4。
 *   实测证据（CI run 38911207796，真上游）：
 *     #60385 BSTAR TLE=0.00012066      vs JSON=0.00012065756   |Δ|=2.4e-9 → 判**一致** ✓
 *     #63693 BSTAR TLE=-0.00019076…    vs JSON=-0.000190756    |Δ|=4.0e-9 → 判**一致** ✓
 *     （对照：真拿错字段/拿错星会是 1e-4 量级的差异，本判据仍能抓到。）
 *   （另注：迁移后我们写回页面的仍是 5 位定宽 TLE，故下游行为与迁移前**完全一致**。） */
const FIELDS = [
  ['OBJECT_ID', 'cospar'],                                 // ★ 两种写法：TLE 侧是压缩的 `24240A`、
                                                           //   OMM 侧是完整的 `2024-240A` ——
                                                           //   **归一化后比**（cosparField，代码里也是这么用的）
  ['EPOCH_Y2', 0], ['EPOCH_DOY', 3e-8],                    // TLE 打 8 位小数；ISO 只有毫秒 → 留到 ~2.6 ms
  ['MEAN_MOTION_DOT', 'rel', 1e-4, 1e-8], ['MEAN_MOTION_DDOT', 'rel', 1e-4, 1e-8], ['BSTAR', 'rel', 1e-4, 1e-8],
  ['EPHEMERIS_TYPE', 0], ['ELEMENT_SET_NO', 0], ['REV_AT_EPOCH', 0],
  ['INCLINATION', 2e-4], ['RAAN', 2e-4],                   // TLE 打 4 位小数
  ['ECCENTRICITY', 2e-7],                                  // 7 位小数
  ['ARG_OF_PERICENTER', 2e-4], ['MEAN_ANOMALY', 2e-4],
  ['MEAN_MOTION', 2e-8],                                   // 11 位小数
];

function parseTleBlocks(txt) {
  const lines = String(txt || '').split('\n').map(s => s.trim()).filter(Boolean);
  const out = [];
  for (let i = 0; i + 2 < lines.length; i += 3) {
    const l1 = lines[i + 1], l2 = lines[i + 2];
    if (!/^1 /.test(l1) || !/^2 /.test(l2)) continue;
    out.push({ norad: parseInt(l1.slice(2, 7), 10), name: lines[i], l1, l2 });
  }
  return out;
}

/**
 * 比较核心：TLE 侧对象数组 vs OMM 侧对象数组（**唯一**的比较实现，真上游与离线自检共用）。
 * @returns {{same:number,epDiff:number,miss:number,fieldBad:number,byField:object,cmp:number}}
 */
export function comparePair(tles, omms) {
  const byNorad = new Map();
  omms.forEach(om => { if (om && om.NORAD_CAT_ID !== undefined) byNorad.set(Number(om.NORAD_CAT_ID), om); });
  let same = 0, epDiff = 0, miss = 0, fieldBad = 0, cmp = 0;
  const byField = {};
  for (const t of tles) {
    const om = byNorad.get(t.norad);
    if (!om) { miss++; continue; }
    const a = ommFromTLE(t.l1, t.l2), b = fromCelesTrakOmm(om);
    if (String(a.EPOCH_Y2) !== String(b.EPOCH_Y2) || Math.abs(a.EPOCH_DOY - b.EPOCH_DOY) > EP_EPS) { epDiff++; continue; }
    same++;
    for (const [f, spec, rel, abs] of FIELDS) {
      cmp++;
      let bad;
      if (spec === 'cospar') bad = cosparField(a[f]) !== cosparField(b[f]);
      else if (spec === 'rel') bad = Math.abs(Number(a[f]) - Number(b[f])) > Math.max(abs || 1e-12, rel * Math.abs(Number(a[f])));
      else bad = Math.abs(Number(a[f]) - Number(b[f])) > spec;
      if (bad) {
        fieldBad++;
        const g = byField[f] = byField[f] || { n: 0, samples: [] };
        g.n++;
        if (g.samples.length < 2) g.samples.push('#' + t.norad + '：TLE=' + a[f] + ' vs JSON=' + b[f]);
      }
    }
  }
  return { same, epDiff, miss, fieldBad, byField, cmp };
}

/** 把一次比较结果打印成人能读的结论（真上游与自检共用措辞） */
function report(label, r) {
  const detail = Object.keys(r.byField).map(f =>
    '      ' + f + ' 不符 ' + r.byField[f].n + ' 处：' + r.byField[f].samples.join(' ｜ ')).join('\n');
  console.log((r.fieldBad === 0 && r.same > 0 ? 'PASS ' : 'FAIL ') + label + '：可比 ' + r.same + ' 颗（历元相同）/' +
    ' 历元不同 ' + r.epDiff + ' 颗未比 / TLE 有而 JSON 无 ' + r.miss + ' 颗 → 字段不符 **' + r.fieldBad + '** 处' +
    (detail ? '\n' + detail : ''));
}

// ---------------------------------------------------------------- 离线自检：验证**比较器本身**
/** 用本地真实 TLE 造一条"CelesTrak FORMAT=json 风格"的记录（字段名/书写形式都照上游） */
function celestrakJsonFromTle(t) {
  const a = ommFromTLE(t.l1, t.l2);
  const m = String(a.OBJECT_ID).match(/^(\d{2})(\d{3})([A-Z]{1,3})$/);
  const objectId = m ? ('20' + m[1] + '-' + m[2] + m[3]) : a.OBJECT_ID;    // 压缩形式 → 完整形式
  // EPOCH：YYDDD.DDDDDDDD → ISO（JS 只到毫秒，故这里也只能给到毫秒 —— 与真实上游同样的精度损失）
  const jan1 = Date.UTC(2000 + a.EPOCH_Y2, 0, 1);
  const iso = new Date(jan1 + (a.EPOCH_DOY - 1) * 86400000).toISOString();
  return { OBJECT_NAME: t.name.trim(), OBJECT_ID: objectId, EPOCH: iso, NORAD_CAT_ID: t.norad,
    MEAN_MOTION: a.MEAN_MOTION, ECCENTRICITY: a.ECCENTRICITY, INCLINATION: a.INCLINATION,
    RA_OF_ASC_NODE: a.RAAN, ARG_OF_PERICENTER: a.ARG_OF_PERICENTER, MEAN_ANOMALY: a.MEAN_ANOMALY,
    EPHEMERIS_TYPE: a.EPHEMERIS_TYPE, ELEMENT_SET_NO: a.ELEMENT_SET_NO, REV_AT_EPOCH: a.REV_AT_EPOCH,
    BSTAR: a.BSTAR, MEAN_MOTION_DOT: a.MEAN_MOTION_DOT, MEAN_MOTION_DDOT: a.MEAN_MOTION_DDOT };
}
function selftest() {
  let bad = 0;
  for (const [file, key] of [['data/ct_hulianwang.tle', 'gw'], ['data/ct_qianfan.tle', 'qf']]) {
    const p = path.join(ROOT, file);
    if (!fs.existsSync(p)) { console.log('SKIP ' + file + ' 不存在'); continue; }
    const tles = parseTleBlocks(fs.readFileSync(p, 'utf8'));
    const omms = tles.map(celestrakJsonFromTle);
    const r = comparePair(tles, omms);
    report('自检 ' + key + '（本地 TLE → 造 CelesTrak 风格 JSON → 逐字段比）', r);
    // 自检的期望：同一份数据换个书写形式，必须**一模一样**（0 处不符、0 颗历元不可比）
    if (r.fieldBad !== 0 || r.same !== tles.length || r.epDiff !== 0) bad++;
  }
  console.log(bad ? '\n自检失败 ' + bad + ' 项（比较器本身有问题，先修它再看真上游）'
    : '\n自检通过：两星座逐字段 0 不符 —— 比较器不会把"书写形式差异"误判成数据不符');
  process.exit(bad ? 1 : 0);
}

// ---------------------------------------------------------------- CLI
if (process.argv.includes('--selftest')) selftest();

async function getText(url, timeoutMs = 30000) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return { ok: r.ok, status: r.status, text: await r.text() };
  } catch (e) { return { ok: false, status: 0, text: '', err: (e && e.message) || String(e) }; }
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
  const r = comparePair(parseTleBlocks(rT.text), jlist);
  report(key + '（' + GROUPS[key] + '）', r);
  cmpTotal += r.cmp;
  if (!(r.fieldBad === 0 && r.same > 0)) fails++;
}
console.log('\n结论：' + (skipped && !fails ? '已跳过（端点不可用）' :
  fails ? '发现 ' + fails + ' 个星座存在不符 —— 迁移前后数据**不等价**，请先别切默认格式' :
    '两格式**逐字段一致**（共比对 ' + cmpTotal + ' 个字段）—— 迁移到 OMM JSON 是等价的'));
process.exit(fails ? 1 : 0);
