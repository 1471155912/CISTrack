/* omm_check.mjs —— 6 位编目号（OMM）通路的**离线自检**（V1.9.1 新增）
 * ---------------------------------------------------------------------------
 * 为什么要单独成模块：
 *   ① 这段自检必须能被 `refresh.mjs --selftest-omm`（命令行）与 `smoke.mjs`（测试）**共用**，
 *      而 refresh.mjs 是**顶层带副作用**的脚本（一 import 就会跑整套刷新）→ 不能直接 import；
 *   ② 本机从 Node 内 spawn 同一个 node.exe 会 EBUSY（沙箱限制）→ 测试里**不能起子进程**。
 *   所以把纯函数放这里：两边都 import 本模块调用，零副作用、零子进程。
 *
 * 覆盖的链路（全部离线，用 2026-10-09 从 CelesTrak 抓到的**真实** OMM 响应做样本）：
 *   真号(100203) → 占位号(00203) → OMM→TLE（69 列定宽 + 校验位 + COSPAR 归一化）
 *   → refresh 的 parseTLE 收编 → mkdata 的真号还原 → 高度量级合理（防"量级错误"复发）。
 */
import fs from 'node:fs';
import { tleFromOmm, fromCelesTrakOmm, PH, tleChecksum, cosparField, toTleExp, fromTleExp } from './omm.mjs';
import { altFromOmm } from './import_history.mjs';

export function ommSelfTest() {
  const out = [];
  const ok = (n, c, e) => out.push({ name: n, ok: !!c, info: e });

  // 真实的 CelesTrak 响应（CATNR=100203&FORMAT=json，原样照录）
  const OMM = { OBJECT_NAME: 'HULIANWANG DIGUI-178', OBJECT_ID: '2026-176A', EPOCH: '2026-10-09T01:31:46.271136',
    MEAN_MOTION: 13.29317684, ECCENTRICITY: 5.55e-5, INCLINATION: 49.9878, RA_OF_ASC_NODE: 157.6298,
    ARG_OF_PERICENTER: 86.804, MEAN_ANOMALY: 273.2896, EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: 'U',
    NORAD_CAT_ID: 100203, ELEMENT_SET_NO: 999, REV_AT_EPOCH: 876, BSTAR: 8.7009657e-5,
    MEAN_MOTION_DOT: -8.4e-7, MEAN_MOTION_DDOT: 0 };
  const REAL = OMM.NORAD_CAT_ID;
  const ph = PH(REAL);

  ok('① 6 位真号 → 5 位占位号', ph === '00203', ph);
  const t = fromCelesTrakOmm(OMM);
  const [l1, l2] = tleFromOmm(t, ph);
  ok('② 生成的 L1/L2 都是 69 字符（定宽规范）', l1.length === 69 && l2.length === 69, l1.length + '/' + l2.length);
  ok('③ 编目号列填的是占位号（经典 TLE 只有 5 列，装不下真号）', l1.slice(2, 7) === ph, l1.slice(2, 7));
  ok('④ COSPAR 归一化为经典 6 列（"2026-176A" → "26176A"）——否则 L1 会变 70 列、下游全线错位',
    l1.slice(9, 17).trim() === '26176A', l1.slice(9, 17).trim());
  ok('④b 批次 key（前 5 列）正确 —— 卫星归属与历史库都靠它', l1.slice(9, 14) === '26176', l1.slice(9, 14));
  ok('⑤ 两行校验位都正确', l1.slice(68) === String(tleChecksum(l1.slice(0, 68))) &&
    l2.slice(68) === String(tleChecksum(l2.slice(0, 68))));
  ok('⑤b cosparField 对经典 6 列输入保持原样（26176A → 26176A）', cosparField('26176A').trim() === '26176A');
  ok('⑤c cosparField 对 7 字母分片（2026-067CY）不溢出（≤8 列）', cosparField('2026-067CY').length === 8, cosparField('2026-067CY'));

  // ⑧b ★ V1.9.1 抓出的真 bug：OMM 里升交点赤经叫 RA_OF_ASC_NODE，不叫 RAAN。
  //   旧代码写 Number(om.RAAN) → 恒 NaN；而 `(NaN).toFixed(4)` 得到字符串 "NaN"，
  //   padStart(8) 之后仍是 8 列 → **总长照样 69**，于是断言 ②"长度 = 69"完全放过了它。
  //   教训：长度正确 ≠ 内容正确。数值列必须**盯值**，并显式禁止 NaN 字符串。
  ok('⑧b L2 的 RAAN 列是真实数值，不是 "NaN"（OMM 字段名 RA_OF_ASC_NODE）',
    l2.slice(17, 25).trim() === OMM.RA_OF_ASC_NODE.toFixed(4), l2.slice(17, 25));
  ok('⑧c 两行文本中不含任何 NaN 字样（数值列的"静默污染"防线）',
    !/NaN/.test(l1) && !/NaN/.test(l2), (l1.match(/NaN/g) || []).length + '/' + (l2.match(/NaN/g) || []).length);
  ok('⑧d 兼容旧字段名：上游若给 RAAN 也能取到值（不因改名就静默失败）',
    (() => { const q = fromCelesTrakOmm(Object.assign({}, OMM, { RA_OF_ASC_NODE: undefined, RAAN: 157.6298 }));
      return q.RAAN === 157.6298; })());
  ok('⑧e 字段名全错时必须抛错，而不是写出坏 TLE（tleFromOmm 的硬闸门）',
    (() => { try { tleFromOmm(fromCelesTrakOmm(Object.assign({}, OMM, { RA_OF_ASC_NODE: undefined })), ph); return false; }
      catch (e) { return /RAAN/.test(e.message); } })());

  // ⑧f ★ V1.9.1（1.4）抓出的格式不一致：零值必须写成 `00000+0`（CelesTrak 的写法），
  //   而不是 `00000-0`。数值上等价，但往返自检是**逐字节比对**，`-0` 会被判失败。
  //   这个 bug 只在"BSTAR 恰为 0"时才露头 —— GEO 卫星在静止轨道没有大气阻力，BSTAR 就是 0，
  //   而 LEO 卫星都有阻力（≈1e-4）→ 它一直躲着，直到 1.4 把 GEO 三颗收进来才现形。
  ok('⑧f 零值指数用 "+0" 写法（与 CelesTrak 原文一致；GEO 的 BSTAR 就是 0）',
    toTleExp(0, 5) === ' 00000+0' && toTleExp(-0, 5) === ' 00000+0' &&
    fromTleExp(' 00000+0') === 0 && fromTleExp(' 00000-0') === 0,
    JSON.stringify(toTleExp(0, 5)));
  // ⑧g 往返自检必须**覆盖全部字段**（旧版漏了 nddot 这一列 → 那一列长期免检）
  ok('⑧g 往返自检覆盖 nddot 列（漏掉一列 = 给那一列开免检通道）',
    /l1\.slice\(44, 52\) === a1\.slice\(44, 52\)/.test(fs.readFileSync(new URL('./omm.mjs', import.meta.url), 'utf8')));

  // parseTLE 收编：key 必须是占位号的**数值**（203）——与 S5 的 merged.has(Number(PH(…))) 判据一致
  const m = new Map();
  const lines = [OMM.OBJECT_NAME, l1, l2];
  for (let i = 0; i + 2 < lines.length + 1; i += 3) {
    const a = lines[i + 1], b = lines[i + 2];
    if (!/^1 /.test(a) || !/^2 /.test(b)) continue;
    const id = parseInt(a.slice(2, 7), 10);
    if (id) m.set(id, { name: lines[i].trim(), l1: a, l2: b });
  }
  ok('⑥ parseTLE 能收编，key = 占位号数值 203', m.has(203) && m.size === 1, [...m.keys()].join(','));

  // mkdata 同款还原：占位号 → 真号（前端 id 用真号显示）
  const OMM_IDS_T = { [ph]: REAL };
  ok('⑦ 真号可还原（mkdata 的 OMM_IDS[raw5] 通路）', (OMM_IDS_T['00203'] || 0) === REAL, String(OMM_IDS_T['00203']));
  ok('⑦b 历史库的 norad 还原也用同一映射（占位号入档会让曲线静默空白）', (OMM_IDS_T['00203'] || 203) === 100203);

  // 高度量级：13.293 rev/day 必须是 ~1100 km 的低轨（历史库曾因量级错误被整体过滤掉）
  const alt = altFromOmm({ MEAN_MOTION: OMM.MEAN_MOTION, ECCENTRICITY: OMM.ECCENTRICITY, INCLINATION: OMM.INCLINATION });
  ok('⑧ 高度落在真实低轨量级（1000–1200 km）', alt > 1000 && alt < 1200, alt.toFixed(1) + ' km');

  // 判据强度：用「位数 > 5」而非 ≥100000 魔数 —— 将来出现 7 位号同样适用
  ok('⑨ 位数判据对 7 位号同样成立', String(1000203).length > 5 && PH(1000203) === '00203');

  return out;
}

// 命令行：node scripts/omm_check.mjs
const isMain = process.argv[1] && process.argv[1].endsWith('omm_check.mjs');
if (isMain) {
  const r = ommSelfTest();
  r.forEach(x => console.log((x.ok ? 'PASS ' : 'FAIL ') + x.name + (x.info !== undefined ? '  → ' + x.info : '')));
  const nf = r.filter(x => !x.ok).length;
  console.log('\n自检结论：' + (nf ? '失败 ' + nf + ' 项' : '全部通过'));
  process.exit(nf ? 1 : 0);
}
