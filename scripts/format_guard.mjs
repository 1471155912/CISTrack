/**
 * scripts/format_guard.mjs —— ★ V1.9.5（H42）：**上游格式变更探测**（纯函数，可被 smoke 直接 import）
 *
 * 为什么需要它（政策原文要点，见维护文档 §17.3）：
 *   CelesTrak 公告：**旧格式（含 legacy TLE 文本）将在 5 位目录号用尽时停用**，官方要求迁移到 CSV/JSON。
 *   若上游真的切了格式，`parseTLE` 对陌生文本只会返回 **0 条** —— 而 0 条在下游与"上游没更新"
 *   **无法区分**：任务会照常成功、数据静默停更（与 2026-10 那次"最新星网批次无制造商"同一类病）。
 *   ⇒ 必须在**数据层**分辨"这是 TLE"还是"这是别的东西"，并让本轮**响亮失败**。
 *
 * 判据刻意保守（宁可放过、不可误报）：
 *   · 只要有**任意一组**「l1 以 `1 ` 开头 + l2 以 `2 ` 开头」的相邻两行，就认作 TLE；
 *   · 上游对"查无此星"的正常回执（`No GP data found` 等）**不算**格式异常（那是合法空结果）；
 *   · 其余非空文本 → 交给 suspectKind() 归类（JSON / CSV / HTML / 未知），供日志指名道姓。
 */

/** 上游"查无此星/查无此项"的正常回执（合法空结果，不能当格式异常） */
export const NO_DATA_RE = /no gp data found|no data found|invalid query|invalid satellite/i;

/** 是不是经典 TLE 文本（卫星名 + l1 + l2 三行一组；只要有一组就算） */
export function looksLikeTLE(txt) {
  const lines = String(txt || '').split('\n').map(x => x.trim()).filter(Boolean);
  for (let i = 0; i + 2 < lines.length; i += 3) {
    if (/^1 /.test(lines[i + 1]) && /^2 /.test(lines[i + 2])) return true;
  }
  // 容错：上游偶尔会在前面加空行/注释行 → 再扫一遍"任意相邻两行"
  for (let i = 0; i + 1 < lines.length; i++) {
    if (/^1 \d/.test(lines[i]) && /^2 \d/.test(lines[i + 1])) return true;
  }
  return false;
}

/** 给"不像预期格式"的文本归类（只用于日志措辞，不做逻辑判断） */
export function suspectKind(txt) {
  const t = String(txt || '');
  if (/^\s*[{[]/.test(t)) return 'JSON（疑似 OMM/新格式）';
  if (/^\s*(OBJECT_NAME|NORAD_CAT_ID|EPOCH|CCSDS_OMM)[,\s]/i.test(t)) return 'CSV（新格式）';
  if (/<html|<!DOCTYPE/i.test(t)) return 'HTML（疑似错误页/拦截页）';
  if (/^\s*TLE\s*$/im.test(t) || /^\s*OBJECT_NAME\s*$/im.test(t)) return '带表头的文本（新格式）';
  // ★ 迁移后（H42）：期望 OMM 却收到 TLE 时，必须点名"旧格式"——
  //   与"网关返回了看不懂的东西"是**完全不同**的处置（前者是上游回退/灰度，后者是链路故障）。
  if (looksLikeTLE(t)) return 'TLE 文本（旧格式，上游似乎回退了）';
  return '未知文本';
}

/** 单条记录是否**长得像 OMM**：至少要同时有编目号与平均运动（少一个就说明不是 GP 数据） */
export function looksLikeOmmRecord(o) {
  return !!o && typeof o === 'object' && !Array.isArray(o) &&
    o.NORAD_CAT_ID !== undefined && o.MEAN_MOTION !== undefined;
}

/**
 * 是不是 **OMM JSON**（CelesTrak `FORMAT=json` 的返回：单条对象或对象数组）。
 * 判据刻意保守（宁可放过、不可误报）：
 *   · 能 `JSON.parse` 成功；
 *   · 形态是对象或数组；**数组里的每条**都要像 OMM（空数组合法 —— 等价于"查无此项"）。
 * ⚠️ 为什么不接受"任意 JSON"：错误页/网关提示也常是 JSON（`{"detail":"..."}`），
 *   若一律放过 → `parse` 得到 0 条 → 与"上游没更新"**无法区分**（这正是 H42 要治的病）。
 */
export function looksLikeOMM(txt) {
  const t = String(txt || '').trim();
  if (!/^[{[]/.test(t)) return false;
  let v;
  try { v = JSON.parse(t); } catch (e) { return false; }
  if (Array.isArray(v)) return v.length === 0 || v.every(looksLikeOmmRecord);
  if (looksLikeOmmRecord(v)) return true;
  // 兼容 CelesTrak 偶发的 {"data":[...]} 形态
  if (v && typeof v === 'object' && Array.isArray(v.data)) {
    return v.data.length === 0 || v.data.every(looksLikeOmmRecord);
  }
  return false;
}

/**
 * 判定一次响应是否属于"格式异常"。
 * @param {string} txt 响应正文
 * @param {'tle'|'omm'} [expect] 本次请求期望的格式（V1.9.5·H42 迁移后，抓取默认走 omm）
 * @returns {{ ok: boolean, kind?: string }} ok=true 表示可交给对应的 parse（含合法空结果）
 */
export function checkFormat(txt, expect = 'tle') {
  const t = String(txt || '');
  if (!t.trim()) return { ok: true };                 // 空响应：交给上层按"0 条"处理（另有网络账本兜）
  if (NO_DATA_RE.test(t)) return { ok: true };        // 合法空结果
  if (expect === 'omm') { if (looksLikeOMM(t)) return { ok: true }; }
  else if (looksLikeTLE(t)) return { ok: true };
  // ★ 迁移期（H42）：另一种格式也算"可识别的上游格式"，但**必须让调用方知道** ——
  //   所以这里仍判 ok=false（走告警），只是 kind 里点明是哪种，便于一眼分辨
  //   "上游切了格式" 与 "网关返回了垃圾"。
  return { ok: false, kind: suspectKind(t) };
}

// ---------------------------------------------------------------- 自测（node scripts/format_guard.mjs）
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const TLE_OK = 'HULIANWANG DIGUI-1\n1 57337U 23095A   26289.50000000  .00000000  00000-0  00000-0 0  9999\n2 57337  86.5000  10.0000 0001000  90.0000 270.0000 13.50000000 10000';
  const OMM_OK = '[{"OBJECT_NAME":"HULIANWANG DIGUI-1","OBJECT_ID":"2023-095A","NORAD_CAT_ID":57337,"MEAN_MOTION":13.5,"ECCENTRICITY":0.0001,"INCLINATION":86.5,"EPOCH":"2026-10-16T12:00:00"}]';
  const cases = [
    // [名称, 正文, 期望格式, 期望 ok]
    ['TLE 文本（expect=tle）', TLE_OK, 'tle', true],
    ['TLE 文本（expect=omm → 应告警：上游还是旧格式）', TLE_OK, 'omm', false],
    ['OMM 单条数组（expect=omm）', OMM_OK, 'omm', true],
    ['OMM 单对象（expect=omm）', '{"NORAD_CAT_ID":57337,"MEAN_MOTION":13.5}', 'omm', true],
    ['OMM 空数组 = 合法空结果（expect=omm）', '[]', 'omm', true],
    ['OMM 数组（expect=tle → 应告警：上游已切新格式）', OMM_OK, 'tle', false],
    ['正常 TLE（前置空行）', '\n\n' + TLE_OK, 'tle', true],
    ['无数据回执', 'No GP data found', 'omm', true],
    ['无数据回执（变体）', 'No data found for satellite 100203', 'tle', true],
    ['CSV 新格式', 'OBJECT_NAME,NORAD_CAT_ID,EPOCH,MEAN_MOTION\nISS,25544,2026-10-16T00:00:00,15.5', 'omm', false],
    ['JSON 但不像 OMM（错误对象）', '{"detail":"Forbidden"}', 'omm', false],
    ['JSON 数组但元素不像 OMM', '[{"a":1},{"b":2}]', 'omm', false],
    ['JSON 不是合法 JSON', '[{"OBJECT_NAME":', 'omm', false],
    ['HTML 错误页', '<!DOCTYPE html><html><body>403 Forbidden</body></html>', 'omm', false],
    ['未知文本', 'something entirely different', 'tle', false],
  ];
  let bad = 0;
  for (const [name, txt, expect, want] of cases) {
    const r = checkFormat(txt, expect);
    const got = r.ok;
    const pass = got === want;
    if (!pass) bad++;
    console.log((pass ? '  ✓ ' : '  ✗ ') + name + ' → ok=' + got + (r.kind ? '（' + r.kind + '）' : ''));
  }
  console.log(bad ? '自测失败 ' + bad + ' 例' : '自测全部通过（' + cases.length + ' 例）');
  process.exitCode = bad ? 1 : 0;
}
