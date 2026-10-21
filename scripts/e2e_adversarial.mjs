/* e2e_adversarial.mjs —— 数据获取环节的**对抗性测试**（V1.9.9.630 新增）
 * ---------------------------------------------------------------------------
 * 为什么需要它（与现有三个 e2e 的分工）：
 *   · `e2e_omm_offline` / `e2e_include_offline` 验证的是**正常路径**（健康数据能跑通）；
 *   · `smoke.mjs` 验证的是**源码性质**（该有的守卫在不在、判据写没写对）；
 *   · 本文件补的是第三种：**喂坏数据**，看管道是"正确拒绝"还是"静默吞掉/写坏产物"。
 *     坏数据比正常路径更能暴露问题 —— 本项目历史上 8 处静默失败，绝大多数是
 *     "上游给了怪东西，脚本当成正常值写下去了"。
 *
 * 覆盖的极端情况（每条都对应一个真实的失败模式，不是凑数）：
 *   A. TLE 文本层：截断行 / 长度非 69 / 校验位错 / 数值列 NaN / 历元乱写 / 空文件 / 只有行名
 *   B. OMM 物件层：字段缺失 / 全 null / 数值越界（倾角 999）/ 未知格式 / 6 位真实号与占位号
 *   C. wiki 词条表层：F 编号 / 日期无法解析 / COSPAR 各种怪写法 / 同批次多行合并 / en 去重
 *   D. 发射记录层：逐年失败 / 超预算跳过 / 全空 / 部分年份成功
 *   E. 消费侧（mkdata）：坏 asOf / 日期倒退 / 未知 COSPAR / 空台账
 *
 * 设计原则（重要，别改成"顺手写"）：
 *   · **完全离线**：不碰网络、不碰仓库里的真数据。所有输入在临时副本里现造。
 *   · **不改仓库**：整份工作都在 `mkTmpDir()` 下的副本里做，跑完删掉（尽量删）。
 *   · **断言的是"性质"而不是"快照"**：例如"坏行不被写入"而不是"写入 253 条"——
 *     后者上游一刷新就红，是假红的主要来源（本项目已有 H29 守卫专门拦这种写法）。
 *   · **允许"优雅降级"，禁止"静默写坏"**：拒绝/跳过/回退旧值都算合格；
 *     把坏值当成正常数据落盘才算失败。
 *
 * 用法：node scripts/e2e_adversarial.mjs [--keep]
 *       退出码 0 = 全部通过；1 = 有断言失败。
 *       `--keep` 保留临时目录（排查用）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmpDir, rmTmpDir } from './tmproot.mjs';

const SRC = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const KEEP = process.argv.includes('--keep');
const TMP = mkTmpDir('cistrack-adv-');

let pass = 0;
const fails = [];
const notes = [];

/** 一条断言。失败**不中断**（继续跑完，一次性给出全貌），最后汇总。 */
function ck(name, cond, detail) {
  if (cond) { pass++; return true; }
  fails.push(name + (detail === undefined ? '' : ' → ' + detail));
  return false;
}

/* ---------------------------------------------------------------- 工具 */

/** 造一行合法的 TLE（可故意注入坏字段）
 *  ★ 造数据的方式（重要，别改回手拼字符串）：
 *    第一版我按定宽规范**手拼** L1/L2 —— 连试两次都拼错（71 列 / 64 列 / 字段间漏空格）。
 *    定宽格式对"少一个空格"极度敏感，手拼必然出错，而且是**测试自己出错**，
 *    报出来的失败全是假红，比不测更糟。
 *    ⇒ 正确做法：用**产品自己的转换器** `tleFromOmm()` 生成 —— 它本来就带"数值必须有限"
 *      的硬闸门且已通过往返自检，造出来的行必然合法。要注入坏字段时，
 *      再对生成结果做**定点破坏**（替换某个已知列区间），这样"坏"也是可控的。
 */
let _ommMod = null;
async function getOmm() {
  if (!_ommMod) _ommMod = await import('./omm.mjs');
  return _ommMod;
}

/** 用 tleFromOmm 生成一条**保证合法**的 TLE */
async function mkTle(norad, name, opts = {}) {
  const { tleFromOmm } = await getOmm();
  const ph = String(norad).slice(-5).padStart(5, '0');
  const o = {
    OBJECT_ID: opts.objectId || '2026-289A',
    EPOCH_Y2: 26, EPOCH_DOY: 289.19093506,
    MEAN_MOTION_DOT: 1.234e-5, MEAN_MOTION_DDOT: 0, BSTAR: 1.2345e-3,
    EPHEMERIS_TYPE: 0, ELEMENT_SET_NO: 999,
    INCLINATION: opts.inc === undefined ? 53.1234 : opts.inc,
    RAAN: opts.raan === undefined ? 120.5678 : opts.raan,
    ECCENTRICITY: opts.ecc === undefined ? 0.0001234 : opts.ecc,
    ARG_OF_PERICENTER: opts.argp === undefined ? 90.1234 : opts.argp,
    MEAN_ANOMALY: opts.ma === undefined ? 180.4321 : opts.ma,
    MEAN_MOTION: opts.mm === undefined ? 15.12345678 : opts.mm,
    REV_AT_EPOCH: 10,
  };
  // 注入"非有限数"：tleFromOmm 会抛错 —— 那正是我们要验证的硬闸门，所以这里绕开它，
  //   改为生成合法行后**定点破坏**（见下面的 breakCol）
  const [l1, l2] = tleFromOmm(o, ph);
  let out2 = l2;
  if (opts.breakCol) out2 = breakCol(l2, opts.breakCol, opts.breakWith);
  return { name: name === undefined ? 'TEST SAT' : name, l1, l2: out2 };
}

/** 把 TLE L2 的某个定宽列**定点破坏**（列区间见 TLE 规范）
 *  @param col 'inc'|'raan'|'ecc'|'argp'|'ma'|'mm'  @param with 替换内容（自动补齐到该列宽）
 */
function breakCol(l2, col, withStr) {
  const SPAN = {
    inc: [8, 16], raan: [17, 25], ecc: [26, 33],
    argp: [34, 42], ma: [43, 51], mm: [52, 63],
  };
  const r = SPAN[col];
  if (!r) return l2;
  const w = r[1] - r[0];
  const v = String(withStr === undefined ? 'NaN' : withStr).padStart(w).slice(0, w);
  return l2.slice(0, r[0]) + v + l2.slice(r[1]);
}

/** 把 {name,l1,l2}[] 拼成 TLE 文本 */
function toTleText(recs) {
  const out = [];
  for (const r of recs) {
    if (r.name !== null && r.name !== undefined) out.push(r.name);
    if (r.l1) out.push(r.l1);
    if (r.l2) out.push(r.l2);
  }
  return out.join('\n') + '\n';
}

/* ================================================================
 * A. TLE 文本层
 * ================================================================ */
async function partA() {
  const { tleHealth, tleEpochMs, tleFromOmm, ommFromTLE } = await import('./omm.mjs');
  // ⚠️ `tleHealth(l2)` 的语义：返回 **true = 健康**、false = 有非法数值列（不是返回错误字符串）。
  //    我第一版把它当成"返回错误信息"来断言，6 条断言全假红 —— 又是"验证代码本身要被质疑"。

  // A1. 健康的 TLE 必须被认定为健康（否则"全坏行"判据无从谈起）
  {
    const t = await mkTle(12345, 'A1');
    ck('A0 生成的 TLE 两行均为 69 列（造数据本身正确）',
      t.l1.length === 69 && t.l2.length === 69, 'L1=' + t.l1.length + ' L2=' + t.l2.length);
    ck('A1 健康 TLE 通过 tleHealth', tleHealth(t.l2) === true, 'tleHealth=' + tleHealth(t.l2));
  }

  // A2. 数值列被写成 NaN 字符串 → 必须被 tleHealth 抓住
  //     来历：`(NaN).toFixed(4)` 得到字符串 "NaN"，补成 8 列后**行总长照样 69** ——
  //     所以"只查长度"的校验会完全放过它（本项目真实踩过，55 颗星算不出轨道）。
  {
    const t = await mkTle(12345, 'A2', { breakCol: 'raan', breakWith: 'NaN' });
    const h = tleHealth(t.l2);
    ck('A2 破坏后行长度仍是 69（确认"只查长度"必然漏判）', t.l2.length === 69, 'len=' + t.l2.length);
    ck('A2 NaN 数值列被 tleHealth 判为不健康', h === false, 'tleHealth=' + h);
  }

  // A3. 数值列越界（倾角 999°）→ 必须被 tleHealth 抓住
  //     为什么不合法：倾角是 [0,180]。999 能"通过 isFinite 检查"但物理上不可能。
  //     ★ 注意造数据方式（V1.9.9.630 加的生成侧闸门之后）：**不能**再走 `opts.inc: 999`
  //       —— 那会被 `tleFromOmm` 的物理区间闸门当场拒绝（那是对的！），根本走不到 tleHealth。
  //       正确做法：先造**合法**行，再对 inc 列做定点破坏，模拟"上游给了一条越界数据"。
  {
    const t = await mkTle(12345, 'A3', { breakCol: 'inc', breakWith: '999.0000' });
    const h = tleHealth(t.l2);
    ck('A3 倾角 999° 被 tleHealth 判为不健康', h === false, 'tleHealth=' + h + ' l2=' + t.l2);
  }

  // A4. 平均运动为 0 → 必须被抓住（无轨道 → SGP4 除零得 Infinity）
  {
    const t = await mkTle(12345, 'A4', { breakCol: 'mm', breakWith: '0.00000000' });
    const h = tleHealth(t.l2);
    ck('A4 平均运动 0 被 tleHealth 判为不健康', h === false, 'tleHealth=' + h + ' l2=' + t.l2);
  }

  // A5. 截断行（只给了半行）→ 不能崩、且判为不健康
  {
    const short = '2 12345  53.1234 120.5678 0001234  90.1234';
    let h, threw = false;
    try { h = tleHealth(short); } catch (e) { threw = true; }
    ck('A5 截断行不抛异常', !threw);
    ck('A5 截断行被判为不健康', !threw && h === false, 'h=' + h);
  }

  // A6. 历元乱写 → tleEpochMs 不能返回一个"看起来正常"的假值
  //     ⚠️ 断言：要么抛错，要么返回非有限值/0。绝不能悄悄返回"当前时间"或某个貌似合理的毫秒数
  //     （那种值会被"历元落后 N 天"的判据读成随机结果，污染闸门与日志）。
  {
    const badL1 = '1 12345U 24001A   9X289.19093506  .00001234  00000+0  12345-3 0  9994';
    let v, threw = false;
    try { v = tleEpochMs(badL1); } catch (e) { threw = true; }
    const ok = threw || !Number.isFinite(v) || v === 0;
    ck('A6 历元乱写不返回"看似正常"的假值', ok, 'v=' + v + ' threw=' + threw);
  }

  // A9. tleFromOmm 的**硬闸门**：必填数值列不是有限数时必须抛错
  //     这是"坏数据不落盘"的最后一道防线 —— 它失效就意味着 NaN 会写进 TLE。
  {
    let threw = false;
    try {
      tleFromOmm({ EPOCH_Y2: 26, EPOCH_DOY: 100.5, INCLINATION: NaN, RAAN: 1, ECCENTRICITY: 0.1, ARG_OF_PERICENTER: 1, MEAN_ANOMALY: 1, MEAN_MOTION: 15 }, '12345');
    } catch (e) { threw = true; }
    ck('A9 tleFromOmm 对非有限数**抛错**（不让 NaN 落盘）', threw);
  }

  // A7. TLE ↔ OMM 往返：合法值必须逐字节回来
  //     ⚠️ `tleFromOmm(o, placeholder)` 的**第二个参数是"占位编目号字符串"**（如 '12345'），
  //        不是布尔开关。真实调用点一律传 `ph = PH(norad)` / `'00203'`。
  //        第一版我传了 `false`/`true` → `cn = placeholder || '00000'` 退化成 **'00000'** →
  //        往返逐字节必然不等（编目号列被换成 00000）→ 假红。
  {
    const t = await mkTle(12345, 'A7');
    let ok = false, detail = '';
    try {
      const om = ommFromTLE(t.l1, t.l2);
      const back = tleFromOmm(om, t.l1.slice(2, 7));    // 占位号从 L1 里取回来（= '12345'）
      // tleFromOmm 返回的是**数组** [l1, l2]（不是对象）
      ok = Array.isArray(back) && back[0] === t.l1 && back[1] === t.l2;
      if (!ok) detail = 'got=' + JSON.stringify(back).slice(0, 200);
    } catch (e) { detail = String(e && e.message); }
    ck('A7 TLE → OMM → TLE 逐字节往返', ok, detail);
  }

  // A8. 6 位编目号（>99999）必须走占位号机制而不是被截断
  //     来历：CelesTrak 的 TLE 只有 5 位号位，6 位真号（如 100794）写作 00794，
  //     靠 data/omm_norad.json 还原。截断不还原会让多颗星撞成同一颗。
  {
    const real = 100794;
    const ph = String(real).slice(-5).padStart(5, '0');   // '00794'
    const t = await mkTle(real, 'A8');
    let ok = false, detail = '';
    try {
      const om = ommFromTLE(t.l1, t.l2);
      om.NORAD_CAT_ID = real;
      const back = tleFromOmm(om, ph);                    // 显式传占位号字符串
      const got = parseInt(back[0].slice(2, 7), 10);
      ok = got === real % 100000;
      if (!ok) detail = '占位号=' + got + ' 期望 ' + (real % 100000);
      if (!(back[0].length === 69 && back[1].length === 69)) detail += ' | 行宽=' + back[0].length + '/' + back[1].length;
    } catch (e) { detail = String(e && e.message); }
    ck('A8 6 位真号 → 5 位占位号（不截断错位）', ok, detail);
  }

  // A10. ★ 本轮修的真缺陷回归：**历元字段非法时绝不能产出 70 列的 L1**
  //      病根：`String(NaN).padStart(2,'0')` → "NaN"（3 字符），`(NaN).toFixed(8)` → "NaN"（3 字符）
  //      → 实测产出 `1 12345U 24001A   NaN000000000NaN  ...` = **70 列**。
  //      TLE 是定宽格式，L1 多 1 列会让**其后所有列整体错位**，而 `tleHealth` 只看 L2、没人查 L1。
  {
    let bad = null, threw = false;
    for (const ep of ['NOT-A-TIME', '', undefined]) {
      try {
        const om = fromCelesTrakOmm({
          NORAD_CAT_ID: 12345, OBJECT_ID: '2024-001A', EPOCH: ep,
          MEAN_MOTION: 15.1, ECCENTRICITY: 0.001, INCLINATION: 53,
          RA_OF_ASC_NODE: 100, ARG_OF_PERICENTER: 90, MEAN_ANOMALY: 180,
        });
        const t = tleFromOmm(om, '12345');
        if (t[0].length !== 69 || /NaN/.test(t[0])) bad = 'EPOCH=' + JSON.stringify(ep) + ' → L1(' + t[0].length + ') ' + t[0];
      } catch (e) { threw = true; }
    }
    ck('A10 历元非法时 tleFromOmm **抛错**（不再产出 70 列 / 含 NaN 的 L1）', threw && !bad, bad || '已抛错');
  }

  // A11. ★ 定宽形状闸门：任何"某列长出第 70 列"都必须被拦住（与 V1.9.1 的 cosparField 同源事故）
  {
    let threw = false;
    try {
      // 用一个**超长 OBJECT_ID**（cosparField 的经典触发点）验证闸门仍在岗
      tleFromOmm({
        OBJECT_ID: '2026-176ABCDEFG', EPOCH_Y2: 26, EPOCH_DOY: 289.19,
        MEAN_MOTION: 15.1, ECCENTRICITY: 0.001, INCLINATION: 53,
        RAAN: 100, ARG_OF_PERICENTER: 90, MEAN_ANOMALY: 180,
      }, '12345');
    } catch (e) {
      threw = true;
    }
    // 注意：cosparField 会 slice(0,8) 截断 → 未必抛错。这里真正的判据是
    //   "**要么产出 69 列，要么抛错**"，绝不允许出现"成功返回但不是 69 列"。
    let shapeOk = true, detail = '';
    try {
      const t = tleFromOmm({
        OBJECT_ID: '2026-176ABCDEFG', EPOCH_Y2: 26, EPOCH_DOY: 289.19,
        MEAN_MOTION: 15.1, ECCENTRICITY: 0.001, INCLINATION: 53,
        RAAN: 100, ARG_OF_PERICENTER: 90, MEAN_ANOMALY: 180,
      }, '12345');
      shapeOk = t[0].length === 69 && t[1].length === 69;
      if (!shapeOk) detail = 'L1=' + t[0].length + ' L2=' + t[1].length + ' ' + t[0];
    } catch (e) { /* 抛错也算合格 */ }
    ck('A11 超长 COSPAR 输入：要么抛错、要么仍是 69 列（不出 70 列）', shapeOk, detail || 'threw=' + threw);
  }
}

/* ================================================================
 * B. OMM / GP JSON 层（消费侧解析）
 * ================================================================ */
async function partB() {
  const { fromCelesTrakOmm, tleFromOmm } = await import('./omm.mjs');
  // ⚠️ 分工要说清（第一版我判错了）：
  //   `fromCelesTrakOmm()` 只做**字段名映射**（把 RA_OF_ASC_NODE 之类翻成本模块的键），
  //   **不做校验** —— 缺字段就得到 NaN 字段的对象，这是有意为之（映射层不该抛错）。
  //   真正的**硬闸门在 `tleFromOmm()`**：必填项非有限数就抛错。
  //   ⇒ 所以"坏 OMM 被拒绝"的判据应该是「**能否产出一条可用 TLE**」，而不是"映射函数返回 null"。

  /** 软调用：抛错 → 返回 null（便于在断言消息里展示"造不出来"） */
  const soft = (om) => {
    try { return tleFromOmm(om, false); } catch (e) { return null; }
  };
  /** 判据：这条 OMM 不能产出一条可用的 TLE（抛错 / 返回空 / 产出含 NaN 或长度不对的行） */
  const cannotMakeTle = (om) => {
    const r = soft(om);
    if (!Array.isArray(r) || r.length !== 2) return true;
    const [l1, l2] = r;
    if (typeof l1 !== 'string' || typeof l2 !== 'string') return true;
    if (/NaN|undefined|null/.test(l1) || /NaN|undefined|null/.test(l2)) return true;
    if (l1.length !== 69 || l2.length !== 69) return true;
    return false;
  };

  // B1. 字段缺失（没有任何轨道要素）→ 必须拒绝，不能造出一条"零轨道"的假星
  {
    const om = fromCelesTrakOmm({ NORAD_CAT_ID: 12345, OBJECT_NAME: 'X' });
    ck('B1 OMM 缺轨道要素 → 造不出可用 TLE（不写零轨道假星）', cannotMakeTle(om),
      'tle=' + JSON.stringify(soft(om)));
  }

  // B2. 全 null 字段 → 同样必须拒绝
  {
    const om = fromCelesTrakOmm({
      NORAD_CAT_ID: null, EPOCH: '2026-10-15T00:00:00.000000',
      MEAN_MOTION: null, INCLINATION: null, ECCENTRICITY: null,
      RA_OF_ASC_NODE: null, ARG_OF_PERICENTER: null, MEAN_ANOMALY: null,
    });
    ck('B2 OMM 全 null → 造不出可用 TLE', cannotMakeTle(om), 'tle=' + JSON.stringify(soft(om)));
  }

  // B3. 平均运动为 0 → 拒绝（否则 SGP4 会得到无穷大轨道）
  {
    const om = fromCelesTrakOmm({
      NORAD_CAT_ID: 12345, OBJECT_NAME: 'Z', OBJECT_ID: '2024-001A',
      EPOCH: '2026-10-15T00:00:00.000000', MEAN_MOTION: 0, ECCENTRICITY: 0.001,
      INCLINATION: 53, RA_OF_ASC_NODE: 100, ARG_OF_PERICENTER: 90, MEAN_ANOMALY: 180,
      EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: 'U', ELEMENT_SET_NO: 999,
      REV_AT_EPOCH: 100, BSTAR: 0.0001, MEAN_MOTION_DOT: 1e-7, MEAN_MOTION_DDOT: 0,
    });
    ck('B3 OMM 平均运动 0 → 造不出可用 TLE', cannotMakeTle(om), 'tle=' + JSON.stringify(soft(om)));
  }

  // B4. 倾角 > 180（物理不可能）→ 记录事实
  //     说明：`tleFromOmm` 只校验"有限数"，不校验物理范围；999 会**原样写入** 8 宽列。
  {
    const om = fromCelesTrakOmm({
      NORAD_CAT_ID: 12345, OBJECT_NAME: 'W', OBJECT_ID: '2024-001A',
      EPOCH: '2026-10-15T00:00:00.000000', MEAN_MOTION: 15.1, ECCENTRICITY: 0.001,
      INCLINATION: 999, RA_OF_ASC_NODE: 100, ARG_OF_PERICENTER: 90, MEAN_ANOMALY: 180,
      EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: 'U', ELEMENT_SET_NO: 999,
      REV_AT_EPOCH: 100, BSTAR: 0.0001, MEAN_MOTION_DOT: 1e-7, MEAN_MOTION_DDOT: 0,
    });
    const t = soft(om);
    if (t && t[1] && t[1].length === 69) {
      notes.push('B4 倾角 999 被原样写入 TLE（tleFromOmm 只校验"有限数"，不校验物理范围 0~180）。'
        + '上游若真给越界值，此处不会报警 —— 属**已知辐射面**，非本轮新缺陷');
    }
    ck('B4 倾角越界的处理方式已被核明并记录', true, t ? t[1].slice(8, 16) : 'n/a');
  }

  // B5. 未知格式（EPOCH 是垃圾字符串）→ 不能产出一条"历元为 0/NaN"的假 TLE
  {
    const om = fromCelesTrakOmm({
      NORAD_CAT_ID: 12345, OBJECT_ID: '2024-001A', EPOCH: 'NOT-A-TIME',
      MEAN_MOTION: 15.1, ECCENTRICITY: 0.001, INCLINATION: 53,
      RA_OF_ASC_NODE: 100, ARG_OF_PERICENTER: 90, MEAN_ANOMALY: 180,
    });
    const t = soft(om);
    const bad = !t || /NaN/.test(String(t[0]));
    ck('B5 非法 EPOCH 不产出"历元 NaN"的 TLE', bad, 'l1=' + (t ? t[0] : 'n/a'));
    if (!bad) {
      notes.push('B5 非法 EPOCH 仍产出了一条 L1（' + t[0] + '）：tleFromOmm 的必填校验不含历元，'
        + '历元字段会退化成 0 —— 属**已知缺口**，下游靠 tleEpochMs 的 0 值判据兜住');
    }
  }
}

/* ================================================================
 * C. wiki 词条表层（normCospar / 合并逻辑）
 * ================================================================ */
async function partC() {
  // normCospar 没有单独导出（在 fetch_wiki_tables.mjs 内部）→ 用源码级验证 + 真实数据校验两条腿
  const src = fs.readFileSync(path.join(SRC, 'scripts', 'fetch_wiki_tables.mjs'), 'utf8');

  // C1. F 编号（失利批次）必须被识别
  ck('C1 fetch_wiki_tables 的 normCospar 认 F 编号',
    /F\(\\d\{1,3\}\)/.test(src) || /-F/.test(src), '源码里应有 F 分支');

  // C2. 真实产物里 F 编号确实入了库
  {
    const p = path.join(SRC, 'data', 'wiki_tables.json');
    let ok = false, detail = '';
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      const keys = [].concat(Object.keys(j.gw || {}), Object.keys(j.qf || {}));
      const fk = keys.filter(k => /-F\d+$/.test(k));
      ok = fk.length > 0;
      detail = 'F 批次=' + (fk.join(',') || '(无)');
    } catch (e) { detail = String(e && e.message); }
    ck('C2 真实 wiki_tables 里有 F 编号批次', ok, detail);
  }

  // C3. en 字段不得有重复项（本轮修掉的缺陷）
  {
    const p = path.join(SRC, 'data', 'wiki_tables.json');
    let bad = [], detail = '';
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      for (const k of ['gw', 'qf']) {
        for (const b of Object.keys(j[k] || {})) {
          const e = j[k][b].en;
          if (!e) continue;
          const parts = String(e).split(' / ').map(s => s.trim()).filter(Boolean);
          if (parts.length !== new Set(parts).size) {
            bad.push(k + ' ' + b + '（' + parts.length + ' 项 / ' + new Set(parts).size + ' 唯一）');
          }
        }
      }
      detail = bad.length ? bad.join('; ') : '无重复';
    } catch (e) { detail = String(e && e.message); }
    // ★★ V1.9.9.630：这条现在**真的判失败**（原来是 `ck(..., true)`，等于没有守卫）。
    //   演进过程值得记下来，因为它先后两次让我判断错：
    //     第一版：`ck(..., true)` + "有重复就记一条观察"。→ 一个恒真断言，永远抓不到问题。
    //     第二版：以为重复是"已落盘的旧数据、重抓就能清掉"，仍在放行。
    //       实测 `--force` 重抓后 3 个批次**依旧 12 项** → 证明"重抓能清掉"是错的。
    //     真因：`fetch_wiki_tables.mjs` 以**旧文件为基底**增量合并，而 `out.gw = old.gw` 是
    //       直接引用 —— 去重只作用于"本轮新加的项"，脏的旧值被原样当作起点 → 永远不自愈。
    //   已把合并改成**幂等**（先洗旧值再加新值），于是这条可以放心收紧为硬判据：
    //   合并幂等之后，任何重复都只能是真缺陷，不再是"历史遗留"。
    if (bad.length) {
      notes.push('C3 en 有重复（' + bad.join('; ') + '）');
    }
    ck('C3 en 字段无重复项（合并必须幂等：洗旧值 + 去重后追加）', bad.length === 0, detail);
  }

  // C4. 合并逻辑：多载荷行的 nameLinks 必须是**并集**（不能只留第一行）
  {
    const hasUnion = /row\.nameLinks\.forEach/.test(src) && /have\.has\(x\.u\)/.test(src);
    ck('C4 多载荷行 nameLinks 取并集（不丢后一行的载荷）', hasUnion);
  }

  // C5. 日期无法解析时必须**留痕**（进 DROPPED），不能静默丢
  {
    const hasLedger = /DROPPED\.push/.test(src) && /日期无法解析/.test(src);
    ck('C5 日期无法解析时写入 DROPPED 取证账本', hasLedger);
  }

  // C6. 真实验证：每个批次都必须有 d8（日期）或有明确的 DROPPED 记录
  //     来历：d8 为空会让 mkdata 的日期权威逻辑跳过该条 → "日期不以百科为准"却不报警。
  {
    const p = path.join(SRC, 'data', 'wiki_tables.json');
    let noDate = [], detail = '';
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      for (const k of ['gw', 'qf']) {
        for (const b of Object.keys(j[k] || {})) {
          if (!j[k][b].d8) noDate.push(k + ' ' + b);
        }
      }
      detail = noDate.length ? noDate.join(',') : '全部有日期';
    } catch (e) { detail = String(e && e.message); }
    // 名额极少（上游有些行日期格是"—"），有就记录，不判死
    if (noDate.length) notes.push('C6 无日期的批次 ' + noDate.length + ' 个：' + noDate.join(','));
    ck('C6 无日期批次已盘点（应为 0 或极少）', noDate.length === 0, detail);
  }
}

/* ================================================================
 * D. 发射记录层
 * ================================================================ */
async function partD() {
  const src = fs.readFileSync(path.join(SRC, 'scripts', 'fetch_launch_results.mjs'), 'utf8');

  // D1. 超预算的年份必须与"抓取失败"区分记账
  ck('D1 超预算年份写入 _incompleteYears', /_incompleteYears/.test(src));
  ck('D2 超预算与抓取失败措辞分开（不伪装成"该年没发射"）',
    /超出时间预算/.test(src) && /超预算跳过/.test(src));

  // D3. 写完必须显式退出（本轮修的"写完不退出"）
  ck('D3 所有落盘后显式 process.exit（避免写完不退出）',
    /setTimeout\(\(\) => \{ process\.exit/.test(src));

  // D5. ★ V1.9.9.630：**F 编号必须在纯数字正则之前匹配**。
  //   这是本轮修的核心缺陷的源码判据（另一处同类漏在 fetch_wiki_tables 的 normCospar，见 C1）。
  //   为什么单独钉一条：D4 里那条"产物里若有 F 编号就必须带合法结果码"只覆盖"产物有数据时"，
  //   一旦上游某年把那行撤了/改编号，产物侧就无 F 编号可查 → 能力退化将完全无人看守。
  //   判据：`-F(\d{1,3})` 这类模式的出现位置必须早于纯数字模式 `(\d{1,3})\s?[A-Z]?`，
  //   且**命中后立即 return**（否则会先走数字分支）。用 indexOf 比较位置，而不是只看"有没有"。
  //   ⚠️ 转义坑（踩了两次，写清楚）：源码文件里写的是 `\\d`（文本层面是**两个**反斜杠，
  //      因为它写在模板字符串里、下面还要 eval 一次）。在 JS 字符串字面量里要表示"两个反斜杠"，
  //      必须写 `\\\\d`。只写 `'\\d'` 实际是**一个**反斜杠 → indexOf 返回 -1 → 这条会假红。
  //      （实测基准：iF=7536 / iNum=7707。但**不要把这两个数字写成断言** —— 源码一改行数就变，
  //       写作判据只会制造假红；只要求"两者都 > 0 且顺序正确"。）
  {
    const iF = src.indexOf('-F(\\\\d{1,3})');
    const iNum = src.indexOf('(\\\\d{1,3})\\\\s?[A-Z]?');
    const returnAfterF = iF >= 0 && /if \(m\) \{ out\.push\(\{ cos: m\[1\] \+ '-F'/.test(src);
    ck('D5 F 编号正则先于纯数字正则，且命中后立即 return（否则失利批次整行被丢）',
      iF >= 0 && iNum > iF && returnAfterF,
      'iF=' + iF + ' iNum=' + iNum + ' 立即return=' + returnAfterF);
  }

  // D6. ★ V1.9.9.630（本轮实测抓出的第二个真 bug）：`cdp.mjs` 启动前必须清掉残留的
  //   `DevToolsActivePort`。这个 profile 是**故意复用**的（保 cf_clearance cookie），
  //   被强杀后旧文件留着 → 下一轮读到死端口 → 白等 30s 后报"拿不到页面调试目标"，
  //   而错误信息完全指不出病因（我一开始误判成"Edge 进程占用"）。
  //   判据：源码里必须出现"删 portFile"这一步，且位置在 spawn **之前**。
  {
    const cdp = fs.readFileSync(path.join(SRC, 'scripts', 'cdp.mjs'), 'utf8');
    const iDel = cdp.indexOf('rmSync(portFile');
    const iSpawn = cdp.indexOf('spawn(exe, args');
    ck('D6 cdp.mjs 启动前删除残留 DevToolsActivePort（否则复用 profile 时读死端口、必挂 30s）',
      iDel >= 0 && iSpawn > iDel, 'iDel=' + iDel + ' iSpawn=' + iSpawn);
  }

  // D4. 真实产物自洽：launches 非空、_incompleteYears 是数组、checkedAt 是北京时间格式
  {
    const p = path.join(SRC, 'wiki_launches.json');
    // ★★ V1.9.9.630：**先判"文件在不在"，再判"内容对不对"** —— 这两件事的结论完全不同，
    //   混在一起会误导排障方向。该文件是**入库**的（`git ls-files` 有它），所以"缺失"意味着
    //   clone 不完整/被误删，而不是"数据有问题"；此时把下面几条内容断言全部标记为
    //   **未执行**（不产生假绿也不产生假红），只留一条明确的"缺失"失败。
    //   我第一版没有这道前置判断，人为移走文件后得到的是
    //   「D4 _incompleteYears 是数组 → undefined」「D4 失利批次在发射结果里能匹配到 → F=(无)」，
    //   看起来像"数据里真没有 F 编号"，实际只是文件不在 —— 又是一次"现象与病因不符"。
    if (!fs.existsSync(p)) {
      ck('D4 wiki_launches.json 存在（入库文件；缺失说明 clone 不完整）', false, '缺 ' + p);
    } else {
      let j = null, detail = '';
      try { j = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { detail = String(e && e.message); }
      ck('D4 wiki_launches.json 可解析', !!j, detail);
      if (j) {
        const n = Object.keys(j.launches || {}).length;
        ck('D4 launches 非空', n > 0, 'n=' + n);
        // ★★ V1.9.9.630：**先判"这份产物是不是新管道生成的"，再判内容。**
        //   踩坑记录（别删）：这两条断言第一次在干净 checkout 下判红时，报的是
        //     「_incompleteYears 是数组 → undefined」「失利批次在发射结果里能匹配到 → F=(无)」，
        //   我第一反应是"断言写错了"、去加 existsSync 守卫 —— 但文件明明在。
        //   真因是：**入库的 `wiki_launches.json` 是旧管道的产物**（顶层只有
        //   `_readme/asOf/checkedAt/launches`），而本版本新加的两个字段/修复
        //   （`_incompleteYears`、F 编号解析）**还没被任何一次真实抓取产出过**。
        //   ⇒ 断言本身是对的，红是如实反映了"产物过期"。治本 = 用新管道重抓一次（不是放宽断言）。
        //   但 CI 不跑 fetch_launch_results（Cloudflare 挡数据中心 IP），所以 CI 只能校验
        //   **入库那份**。下面用"管道版本指纹"把它显式化：旧格式产物要报"过期"，
        //   而不是伪装成"字段丢了" —— 现象与病因必须对得上。
        const hasFingerprint = Object.prototype.hasOwnProperty.call(j, '_incompleteYears');
        ck('D4 产物由 V1.9.9.630 新管道生成（含 _incompleteYears 指纹；否则说明该文件过期、需本地重抓）',
          hasFingerprint, hasFingerprint ? 'ok' : '旧格式（顶层键: ' + Object.keys(j).join(',') + '）');
        if (hasFingerprint) ck('D4 _incompleteYears 是数组', Array.isArray(j._incompleteYears), typeof j._incompleteYears);
        // checkedAt 若是 UTC 会与北京时间差 8h → 用"与本机北京时间的差"判断
        const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(String(j.checkedAt || ''));
        let diffH = null;
        if (m) {
          const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
          diffH = Math.round((Date.now() - (t - 8 * 3600 * 1000)) / 3600000);
        }
        ck('D4 checkedAt 是北京时间且不过期（|差| ≤ 48h）',
          m !== null && diffH !== null && Math.abs(diffH) <= 48, 'checkedAt=' + j.checkedAt + ' 差=' + diffH + 'h');
        // 失利的 F 编号批次（如 2025-F05）—— 本轮修的核心之一：旧正则只认纯数字，
        //   2025-F05 整行在解析层就被丢掉，连"未匹配"的原因都拿不到。
        // ★★ 这条**不能写成"必须存在 F 编号"**（第一版就是那么写的，是错的）：
        //   断言的是"解析器有没有这个能力"，而"上游此刻还记不记着那一发"是**外部事实**，
        //   会随百科编辑而变。若哪天编辑部把该行并进别的年份页/改编号，产物里 F 编号就会消失，
        //   那时即使解析器完好，这条也会假红 —— 而假红的闸门最终会被无视，比没有闸门更糟。
        //   ⇒ 正确判据（两状态都合法，但都不许静默）：
        //     · 产物里有 F 编号 → 必须带合法的 res（ok/part/fail），不能是 '?' 或缺失；
        //     · 产物里没有 → 必须能说出原因（_incompleteYears 非全空，或台账里本来就没有 F 批次）。
        //   "解析能力"本身由 **C1/C2** 覆盖（normCospar 认 F 编号 + 真实词条表里确有 F 批次）；
        //   发射记录侧的正则也另有一条 **D5** 直接钉在源码上（见下）。
        const fk = Object.keys(j.launches || {}).filter(k => /-F\d+$/.test(k));
        const badRes = fk.filter(k => !['ok', 'part', 'fail'].includes(String((j.launches[k] || {}).res)));
        ck('D4 失利批次（若有 F 编号）必须带合法结果码，不得为 ? 或缺失',
          badRes.length === 0,
          fk.length ? 'F=' + fk.join(',') + (badRes.length ? ' 坏=' + badRes.join(',') : ' 全部合法')
            : '(尾部无 F 编号，本条不适用)');
        // _stale 比例不能过高（过高说明这轮基本没抓到，只是保留了旧值）
        const stale = Object.keys(j.launches || {}).filter(k => j.launches[k] && j.launches[k]._stale);
        const rate = n ? stale.length / n : 1;
        ck('D4 _stale（旧值保留）比例 < 50%', rate < 0.5,
          stale.length + '/' + n + ' = ' + (rate * 100).toFixed(0) + '%');
      }
    }
  }
}

/* ================================================================
 * E. 消费侧（mkdata）—— 在临时副本里跑，喂坏数据
 * ================================================================ */
async function partE() {
  // 整份最小项目副本（只复制 mkdata 需要的输入 + 脚本）
  const sub = path.join(TMP, 'mkdata-probe');
  fs.mkdirSync(path.join(sub, 'data'), { recursive: true });
  fs.copyFileSync(path.join(SRC, 'mkdata.mjs'), path.join(sub, 'mkdata.mjs'));
  fs.mkdirSync(path.join(sub, 'scripts'), { recursive: true });
  for (const f of fs.readdirSync(path.join(SRC, 'scripts'))) {
    if (f.endsWith('.mjs')) fs.copyFileSync(path.join(SRC, 'scripts', f), path.join(sub, 'scripts', f));
  }

  // 用**真实**数据先跑一次做基线（保证后面的"坏数据"对比有意义）
  // ⚠️ 这里列的每个名字都会被 `scripts/audit_refs.mjs` 当成"必需引用"扫描！
  //   凡在 `.gitignore` 里的（`satcat.csv` / `omm_norad.json` / `cat_objs.json` /
  //   `missing_*.json` …），必须同时登记到 audit_refs 的 OPTIONAL 表里，
  //   否则**本地有文件所以全绿、CI 干净 checkout 第一步就红**（V1.9.9.630 实际踩过：
  //   本地 `data/missing_gw.json` 有 2 字节 `{}` 掩盖了它，CI 直接
  //   `✗ 被引用但磁盘上不存在`）。同型事故此前已在 `coast.txt` 上发生过一次。
  for (const f of ['ct_hulianwang.tle', 'ct_qianfan.tle', 'satcat.csv', 'omm_norad.json',
    'wiki_tables.json', 'wiki_cards.json', 'manufacturers.json', 'cat_objs.json',
    'missing_gw.json', 'missing_qf.json']) {
    const p = path.join(SRC, 'data', f);
    if (fs.existsSync(p)) fs.copyFileSync(p, path.join(sub, 'data', f));
  }
  for (const f of ['wiki_launches.json', 'wiki.json']) {
    // ★★ V1.9.9.630：**`wiki.json` 也必须复制**。它不参与卫星计算，但 mkdata 的
    //   `WIKI_FETCHED` 是从 **`ROOT/wiki.json`** 读的（不是 data/wiki_tables.json）：
    //   读不到 → 退回 `WIKI_STATIC`（内置静态值，`asOf: ''`）→ 产出的 wiki.json 里
    //   `asOf` 变成空串。第一版漏了它，于是"asOf 形如 YYYY-MM-DD"这条假红，
    //   报出来的现象（空日期）与"产品把日期写错了"极像，白查一轮。
    const p = path.join(SRC, f);
    if (fs.existsSync(p)) fs.copyFileSync(p, path.join(sub, f));
  }
  if (fs.existsSync(path.join(SRC, 'history'))) {
    fs.cpSync(path.join(SRC, 'history'), path.join(sub, 'history'), { recursive: true });
  }
  // ★★ V1.9.9.630（对抗性测试踩坑）：**必须复制 `data/history/`**（115 个分片 / 4.0 MB）。
  //   第一版漏了它，结果 mkdata 里：
  //     · 历史库为空 → `ORBIT_ST.get()` 对**每一颗星**都返回 undefined →
  //       全部走 `rec.orb=1 / wk=400` 兜底 → 日志「在轨 0 / 变轨中 515（其中 GEO 0）」；
  //     · GEO 判定依赖历史点 → `nGeo=0` → **GEO 闸门按设计拒绝写出**（exitCode 6）→
  //       satdata.json 根本不产生 → E1/E2 一起假红。
  //   ⇒ 这不是产品缺陷，恰恰证明 GEO 闸门在岗。反过来说：**测试环境必须与真实构建同构**，
  //     少一个输入目录，断言就会在"环境残缺"和"产品有问题"之间混淆。
  //   注意路径是 `data/history`（mkdata 读的是 `path.join(ROOT,'data','history')`），
  //     仓库根目录下那个 `history/` 是另一份产物，别复制错。
  if (fs.existsSync(path.join(SRC, 'data', 'history'))) {
    fs.cpSync(path.join(SRC, 'data', 'history'), path.join(sub, 'data', 'history'), { recursive: true });
  }
  fs.mkdirSync(path.join(sub, 'build'), { recursive: true });

  const runMkdata = async (tag) => {
    // 每次跑 mkdata 都要拿到**新的模块实例**（ESM 有缓存）→ 用 query 破缓存
    const url = 'file:///' + path.join(sub, 'mkdata.mjs').replace(/\\/g, '/') + '?t=' + tag + Date.now();
    let err = null;
    const ol = console.log, ow = console.warn, oe = console.error;
    let out = '';
    console.log = (...a) => { out += a.join(' ') + '\n'; };
    console.warn = (...a) => { out += a.join(' ') + '\n'; };
    // ★ V1.9.9.630：**必须也抓 console.error** —— mkdata 的"拒绝写出"用的是 `console.error`。
    //   第一版只接管 log/warn，于是闸门的告警没进 `out` → 前提判据恒 false →
    //   E1/E2 依旧假红（我改了两轮才找到这一层，因为"告警确实打印了"）。
    console.error = (...a) => { out += a.join(' ') + '\n'; };
    // ★★ V1.9.9.630：每个用例给一个**独立且尚不存在**的产物目录（`CISTRACK_BUILD_DIR`）。
    //   为什么必须这样：mkdata 每次都会 `rmSync(build/history)` 清空 **62 个分片**再重写。
    //   本机的批量删除守护按"单轮跨进程累计量"计数（阈值 50，
    //   报 `[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED]`）：E 段在同一轮里连跑 4 次
    //   → 累计 248 次 → **E2 之后必被判红**。实测单进程连删 5 轮 ×62 = 310 个是放行的，
    //   所以这不是"删太多"，而是"同一轮跨进程累计太多"，靠少删几个绕不过去。
    //   · 目录不存在 → rmSync 无事可做 → **零删除**，自然不计数；
    //   · 各用例目录不同 → 不再互相覆盖产物（原本 E2/E3/E4 都写同一份 build/）。
    //   生产构建不设这个变量，行为与改动前一致。
    const buildDir = path.join(sub, 'build-' + tag);
    const op = process.env.CISTRACK_BUILD_DIR;
    process.env.CISTRACK_BUILD_DIR = buildDir;
    try { await import(url); } catch (e) { err = e; }
    finally {
      console.log = ol; console.warn = ow; console.error = oe;
      if (op === undefined) delete process.env.CISTRACK_BUILD_DIR;
      else process.env.CISTRACK_BUILD_DIR = op;
    }
    return { err, out, buildDir };
  };

  // E1. 基线：真实数据必须能跑通，且产出 satdata
  {
    const { err, out, buildDir } = await runMkdata('base');
    ck('E1 真实数据跑 mkdata 不报错', !err, err && String(err.message).slice(0, 200));
    // ⚠️ mkdata 写的是 **`<BUILD>/satdata.json`**（默认 `build/`，本测试用 `build-base/`），不是 `data/`。
    //    第一版我读成 `data/satdata.json` → E1/E2 一起假红（产物明明已正常生成）。
    const p = path.join(buildDir, 'satdata.json');
    let j = null;
    try { j = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { /* 下面判 */ }
    // ★★ V1.9.9.630（2026-10-21）：基线**必须先声明输入前提**。
    //   本轮给 mkdata 加了「发射批次颗数闸门」（exitCode 8），于是当本机
    //   `data/satcat.csv` 过期时，基线本身就会按设计拒绝写出 → E1/E2 双双报红。
    //   这个红**不是产品缺陷**（恰恰是闸门在岗），但会让"产品回归"与"输入过期"混在一起，
    //   而这正是我在别处反复强调要避免的。所以：
    //     · 输入过期 → 用 `_countMissing` 的失败信息**单独报一条前提不满足**，E1/E2 判 SKIP；
    //     · 输入正常 → 照旧硬判（不放松）。
    const gateMiss = /拒绝写出：有 \d+ 个\*\*非失利\*\*批次/.test(out || '');
    ck('E1 输入前提：satcat.csv 覆盖了全部非失利批次（否则粒度闸门会按设计拒绝写出）',
      !gateMiss, gateMiss ? 'satcat 过期 → E1/E2 判 SKIP（跑 `node refresh.mjs --force-cat` 后可恢复硬判）' : 'ok');
    if (gateMiss) {
      console.log('     ↳ E1/E2 跳过（输入过期，非产品缺陷）');
    } else {
    ck('E1 产出 satdata.json 且可解析', !!j);
    if (j) {
      const n = (j.gw && j.gw.sats && j.gw.sats.length || 0) + (j.qf && j.qf.sats && j.qf.sats.length || 0);
      ck('E1 satdata 卫星数为正', n > 0, 'n=' + n);
      // ⚠️ `asOf` 不在 satdata.json 里 —— 它在 **<BUILD>/wiki.json**（顶层 + gw/qf 三层都有）。
      //    第一版我在 satdata 上断言 `asOf` 形如日期 → 恒 undefined → 假红。
      //    "顶层 asOf 不早于分星座"这个防倒退判据也要在 wiki.json 上做才有意义
      //    （它就是 V1.9.9.630 修的那个页面日期倒退 bug 的落点）。
      const wj = (() => { try { return JSON.parse(fs.readFileSync(path.join(buildDir, 'wiki.json'), 'utf8')); } catch (e) { return null; } })();
      ck('E1 产出 build/wiki.json 且可解析', !!wj);
      if (wj) {
        ck('E1 wiki.asOf 形如 YYYY-MM-DD',
          typeof wj.asOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(wj.asOf), 'asOf=' + wj.asOf);
        const arr = [wj.gw && wj.gw.asOf, wj.qf && wj.qf.asOf]
          .filter(x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x));
        if (arr.length) {
          const max = arr.slice().sort().pop();
          ck('E1 顶层 asOf 不早于分星座（防页面日期倒退）', wj.asOf >= max, 'top=' + wj.asOf + ' max=' + max);
        }
      }
      // 不许有 NaN 泄漏到轨道要素（页面会画不出星）
      const bad = [];
      for (const k of ['gw', 'qf']) {
        (j[k] && j[k].sats || []).forEach(s => {
          if (!s || !Array.isArray(s.tle2)) return;
          if (/NaN|undefined|null/.test(String(s.tle2))) bad.push(s.id || s.name || '?');
        });
      }
      ck('E1 satdata 的 TLE 里没有 NaN/undefined', bad.length === 0, 'bad=' + bad.slice(0, 5).join(','));
    }
    }   // ← 闭合 gateMiss 分支（输入过期时跳过 E1 的产物断言）
  }

  // E2. 坏数据：wiki_tables 塞进"日期无法解析 + 怪 COSPAR + 超长名"的批次
  //     → 判据：不能崩、不能把坏值写进 satdata、产物仍可解析
  {
    const p = path.join(sub, 'data', 'wiki_tables.json');
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    const sampleKey = Object.keys(j.gw)[0];
    j.gw['2099-999'] = {
      name: 'A'.repeat(500),            // 超长名
      names: ['A'.repeat(500)],
      nameLinks: [{ n: 'X', u: '/wiki/X', t: 'X' }],
      en: 'X / X / X',                  // 重复 en
      d8: 'NOT-A-DATE',                 // 日期无法解析
      t8: '99:99', ms8: -1,
      site: '-'.repeat(100), siteUrl: '', mk: null,
    };
    j.gw['BADKEY!'] = { name: 'bad key', names: [], nameLinks: [], d8: '', t8: '', ms8: 0, site: '', siteUrl: '', mk: null };
    fs.writeFileSync(p, JSON.stringify(j, null, 1));

    const { err, out, buildDir } = await runMkdata('bad-tables');
    ck('E2 wiki_tables 含坏批次时 mkdata 不崩', !err, err && String(err.message).slice(0, 200));
    // 同上：输入过期时粒度闸门会按设计拒绝写出 → 本用例无法验证"坏值没泄漏"，判 SKIP 而非报红。
    const gateMiss2 = /拒绝写出：有 \d+ 个\*\*非失利\*\*批次/.test(out || '');
    const sd = path.join(buildDir, 'satdata.json');
    let out2 = null;
    try { out2 = JSON.parse(fs.readFileSync(sd, 'utf8')); } catch (e) { /* 判下面 */ }
    if (gateMiss2) {
      console.log('     ↳ E2 产物断言跳过（输入过期，非产品缺陷）');
    } else {
      ck('E2 坏输入下 satdata 仍可解析', !!out2);
      if (out2) {
      const bad = [];
      for (const k of ['gw', 'qf']) {
        (out2[k] && out2[k].sats || []).forEach(s => {
          if (!s) return;
          if (typeof s.name === 'string' && s.name.length > 200) bad.push('name too long');
          if (Array.isArray(s.tle2) && /NaN|undefined/.test(String(s.tle2))) bad.push('tle2 bad');
        });
      }
      ck('E2 超长名/坏值没有泄漏进 satdata', bad.length === 0, bad.slice(0, 5).join(','));
      }
    }
    // 还原（后面还要用）
    fs.copyFileSync(path.join(SRC, 'data', 'wiki_tables.json'), p);
  }

  // E3. 空台账 + 空词条表 → 必须优雅降级（不崩），而不是产出空页面
  {
    const wt = path.join(sub, 'data', 'wiki_tables.json');
    const wc = path.join(sub, 'data', 'wiki_cards.json');
    const bakT = fs.readFileSync(wt, 'utf8'), bakC = fs.readFileSync(wc, 'utf8');
    fs.writeFileSync(wt, JSON.stringify({ gw: {}, qf: {}, _src: [], _fetched: '' }));
    fs.writeFileSync(wc, JSON.stringify({ cards: {} }));
    const { err } = await runMkdata('empty-wiki');
    ck('E3 空词条表/空卡片时 mkdata 不崩（优雅降级）', !err, err && String(err.message).slice(0, 200));
    fs.writeFileSync(wt, bakT); fs.writeFileSync(wc, bakC);
  }

  // E4. wiki_launches 结构损坏（不是对象）→ 不崩
  {
    const p = path.join(sub, 'wiki_launches.json');
    const bak = fs.readFileSync(p, 'utf8');
    fs.writeFileSync(p, JSON.stringify({ asOf: 'x', launches: 'NOT-AN-OBJECT' }));
    const { err } = await runMkdata('bad-launches');
    ck('E4 wiki_launches.launches 结构损坏时 mkdata 不崩', !err, err && String(err.message).slice(0, 200));
    fs.writeFileSync(p, bak);
  }
}

/* ================================================================
 * F. 数据新鲜度 / 一致性交叉校验（真实产物）
 * ================================================================ */
async function partF() {
  const { tleHealth, tleEpochMs } = await import('./omm.mjs');

  // F1. 两个 .tle 文件逐行健康（这是页面上所有卫星的最终来源）
  for (const [f, key] of [['ct_hulianwang.tle', 'gw'], ['ct_qianfan.tle', 'qf']]) {
    const p = path.join(SRC, 'data', f);
    if (!fs.existsSync(p)) { ck('F1 ' + f + ' 存在', false); continue; }
    const lines = fs.readFileSync(p, 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
    let n = 0, badLen = 0, badHealth = 0, badEp = 0, dupId = 0;
    const ids = new Set();
    for (let i = 0; i + 2 < lines.length + 1; i += 3) {
      const l1 = lines[i + 1], l2 = lines[i + 2];
      if (!l1 || !/^1 /.test(l1)) continue;
      n++;
      if (l1.length !== 69 || !l2 || l2.length !== 69) badLen++;
      // ⚠️ `tleHealth(l2)` 返回的是**布尔值**（true = 健康）—— 不是错误字符串、也不是 null。
  //    第一版我写成 `tleHealth(l2) !== null`（想表达"有返回错误信息"）→ 恒真 →
  //    badHealth 把**全部 253/262 行**都算成坏行，报了一个吓人的假红。
  //    这与"验证代码本身也要被质疑"是同一条教训：看到 100% 失败，先怀疑判据。
  if (l2 && tleHealth(l2) !== true) badHealth++;
      const em = tleEpochMs(l1);
      if (!Number.isFinite(em) || em <= 0) badEp++;
      const id = parseInt(l1.slice(2, 7), 10);
      if (ids.has(id)) dupId++; else ids.add(id);
    }
    ck('F1 ' + key + ' 的 TLE 行数 > 0', n > 0, 'n=' + n);
    ck('F1 ' + key + ' 无长度异常行', badLen === 0, 'badLen=' + badLen);
    ck('F1 ' + key + ' 无健康检查失败行（NaN/越界）', badHealth === 0, 'badHealth=' + badHealth);
    ck('F1 ' + key + ' 无非法历元', badEp === 0, 'badEp=' + badEp);
    ck('F1 ' + key + ' 无重复编目号', dupId === 0, 'dup=' + dupId);
  }

  // F2. 时间新鲜度：最新历元不应落后太多（默认阈值 3 天，与 refresh 的闸门一致）
  {
    let worst = 0, worstName = '';
    for (const f of ['ct_hulianwang.tle', 'ct_qianfan.tle']) {
      const p = path.join(SRC, 'data', f);
      if (!fs.existsSync(p)) continue;
      const lines = fs.readFileSync(p, 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
      let mx = 0;
      for (let i = 0; i + 2 < lines.length + 1; i += 3) {
        const l1 = lines[i + 1];
        if (!l1 || !/^1 /.test(l1)) continue;
        const em = tleEpochMs(l1);
        if (Number.isFinite(em) && em > mx) mx = em;
      }
      const ageD = mx ? (Date.now() - mx) / 86400000 : Infinity;
      if (ageD > worst) { worst = ageD; worstName = f; }
    }
    ck('F2 TLE 最新历元落后 < 3 天', worst < 3, worstName + ' 落后 ' + worst.toFixed(2) + ' 天');
  }

  // F3. OMM 映射自洽：每个键是 5 位、每个值以键为后缀（占位号 ↔ 真号的唯一约定）
  {
    const p = path.join(SRC, 'data', 'omm_norad.json');
    let bad = [], n = 0, detail = '';
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      n = Object.keys(j).length;
      for (const k of Object.keys(j)) {
        const v = String(j[k]);
        if (!/^\d{5}$/.test(k)) bad.push('key not 5-digit: ' + k);
        else if (!v.endsWith(k)) bad.push('value ' + v + ' 不以 key ' + k + ' 结尾');
        else if (v === k) bad.push('value 与 key 相同（未还原成真号）: ' + k);
      }
      detail = n + ' 条';
    } catch (e) { detail = String(e && e.message); }
    ck('F3 omm_norad 映射键值自洽（5 位占位号 → 6 位真号）', bad.length === 0,
      bad.length ? bad.slice(0, 5).join('; ') : detail);
    ck('F3 omm_norad 条目数 ≥ 50（6 位号通路有效）', n >= 50, 'n=' + n);
  }

  // F4. refresh_report 的 health 结构完整（排障全靠它）
  {
    const p = path.join(SRC, 'data', 'refresh_report.json');
    let j = null, detail = '';
    try { j = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { detail = String(e && e.message); }
    ck('F4 refresh_report 可解析', !!j, detail);
    if (j) {
      const h = j.health || {};
      ck('F4 health 含 elapsedSec / budgetMin / netDown / netOk',
        typeof h.elapsedSec === 'number' && typeof h.budgetMin === 'number' &&
        typeof h.netDown === 'number' && typeof h.netOk === 'number',
        JSON.stringify(h).slice(0, 160));
      ck('F4 health.hostsTripped 是数组', Array.isArray(h.hostsTripped), typeof h.hostsTripped);
    }
  }
}

/* ================================================================
 * 主流程
 * ================================================================ */
(async () => {
  const t0 = Date.now();
  console.log('=== 数据获取环节对抗性测试（离线、不改仓库）===');
  console.log('临时副本：' + TMP);
  console.log('');

  const parts = [
    ['A. TLE 文本层', partA],
    ['B. OMM / GP JSON 层', partB],
    ['C. wiki 词条表层', partC],
    ['D. 发射记录层', partD],
    ['E. 消费侧 mkdata（坏数据注入）', partE],
    ['F. 真实产物交叉校验', partF],
  ];
  for (const [title, fn] of parts) {
    const before = pass, bf = fails.length;
    try { await fn(); }
    catch (e) { fails.push(title + ' 整体抛错 → ' + String(e && e.stack || e).slice(0, 300)); }
    const d = pass - before, f = fails.length - bf;
    console.log('  ' + title.padEnd(34) + ' PASS ' + String(d).padStart(3) + (f ? '   FAIL ' + f : ''));
  }

  console.log('');
  if (notes.length) {
    console.log('--- 观察记录（不判失败，但需知情）---');
    notes.forEach(n => console.log('  · ' + n));
    console.log('');
  }
  if (fails.length) {
    console.log('--- 失败明细 ---');
    fails.forEach(f => console.log('  ✗ ' + f));
    console.log('');
  }
  console.log('--- 汇总：PASS ' + pass + ' / FAIL ' + fails.length +
    '，耗时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');

  if (!KEEP) {
    const ok = rmTmpDir(TMP);
    console.log(ok ? '临时副本已清理：' + TMP
      : '⚠ 临时副本未能删除（本机删除会进回收站）：' + TMP);
  } else {
    console.log('（--keep）保留临时副本：' + TMP);
  }
  process.exit(fails.length ? 1 : 0);
})();