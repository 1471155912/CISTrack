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

/** 给"不像 TLE"的文本归类（只用于日志措辞，不做逻辑判断） */
export function suspectKind(txt) {
  const t = String(txt || '');
  if (/^\s*[{[]/.test(t)) return 'JSON（疑似 OMM/新格式）';
  if (/^\s*(OBJECT_NAME|NORAD_CAT_ID|EPOCH|CCSDS_OMM)[,\s]/i.test(t)) return 'CSV（新格式）';
  if (/<html|<!DOCTYPE/i.test(t)) return 'HTML（疑似错误页/拦截页）';
  if (/^\s*TLE\s*$/im.test(t) || /^\s*OBJECT_NAME\s*$/im.test(t)) return '带表头的文本（新格式）';
  return '未知文本';
}

/**
 * 判定一次响应是否属于"格式异常"。
 * @returns {{ ok: boolean, kind?: string }} ok=true 表示可交给 parseTLE（含合法空结果）
 */
export function checkFormat(txt) {
  const t = String(txt || '');
  if (!t.trim()) return { ok: true };                 // 空响应：交给上层按"0 条"处理（另有网络账本兜）
  if (NO_DATA_RE.test(t)) return { ok: true };        // 合法空结果
  if (looksLikeTLE(t)) return { ok: true };
  return { ok: false, kind: suspectKind(t) };
}

// ---------------------------------------------------------------- 自测（node scripts/format_guard.mjs）
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const TLE_OK = 'HULIANWANG DIGUI-1\n1 57337U 23095A   26289.50000000  .00000000  00000-0  00000-0 0  9999\n2 57337  86.5000  10.0000 0001000  90.0000 270.0000 13.50000000 10000';
  const cases = [
    ['正常 TLE', TLE_OK, true],
    ['正常 TLE（前置空行）', '\n\n' + TLE_OK, true],
    ['无数据回执', 'No GP data found', true],
    ['无数据回执（变体）', 'No data found for satellite 100203', true],
    ['CSV 新格式', 'OBJECT_NAME,NORAD_CAT_ID,EPOCH,MEAN_MOTION\nISS,25544,2026-10-16T00:00:00,15.5', false],
    ['JSON（OMM）', '[{"OBJECT_NAME":"ISS","NORAD_CAT_ID":25544}]', false],
    ['HTML 错误页', '<!DOCTYPE html><html><body>403 Forbidden</body></html>', false],
    ['未知文本', 'something entirely different', false],
  ];
  let bad = 0;
  for (const [name, txt, want] of cases) {
    const r = checkFormat(txt);
    const got = r.ok;
    const pass = got === want;
    if (!pass) bad++;
    console.log((pass ? '  ✓ ' : '  ✗ ') + name + ' → ok=' + got + (r.kind ? '（' + r.kind + '）' : ''));
  }
  console.log(bad ? '自测失败 ' + bad + ' 例' : '自测全部通过（' + cases.length + ' 例）');
  process.exitCode = bad ? 1 : 0;
}
