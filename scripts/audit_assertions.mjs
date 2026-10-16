/**
 * scripts/audit_assertions.mjs —— ★ V1.9.5（H29）：smoke 的"硬编码数字"普查工具
 *
 * 为什么要它：CI 反复红的根因类型是**快照式断言** —— 断言里写死了随数据变化的数字
 *   （卫星数、标签数、批次数…），上游一刷新就红，于是"测试红"变成噪声、没人再信。
 *   H29 要求：能改成**性质判据**的（数量≥、占比、单调、贴近、至少一半…）都改掉；
 *   剩下的**真不变量**必须在断言前一行写明理由（`// H29-OK: <理由>`）。
 *
 * 用法：
 *   node scripts/audit_assertions.mjs            # 普查清单（按"疑似程度"排序）
 *   node scripts/audit_assertions.mjs --check     # 门禁：未标注的疑似快照 → 退出码 1
 *
 * 实现口径（刻意选稳妥做法，不做完整 JS 解析）：
 *   · 以 `assert(` 出现的行为锚点，取**其后 14 行**作为该断言的文本窗口（断言不会更长）；
 *   · 窗口内**先剥掉行注释**（`//` 之后）、字符串、模板串、正则字面量；
 *   · 只认两种模式：`X.length <op> N`、`<计数类变量> <op> N`（N 为字面数字）；
 *   · 分档：≥20 → DANGER（疑似数据快照，必须处理或标注）；4–19 → review；≤3 → struct。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const B = fileURLToPath(new URL('.', import.meta.url));
const SRC = path.join(B, '..', 'smoke.mjs');
const CHECK = process.argv.includes('--check');
const WIN = 14;                                    // 断言的文本窗口（行）

/** 剥注释 + 字符串 + 模板串 + 正则（顺序：先注释，再字面量） */
function scrub(text) {
  return String(text)
    .split('\n').map(l => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n')   // 行注释（不动 http:// 之类）
    .replace(/\/(?:\\.|\[(?:\\.|[^\]])*\]|[^/\\\n])+\/[gimsuy]*/g, ' /RE/ ')    // 正则字面量
    .replace(/'(?:\\.|[^'\\\n])*'/g, " '' ")
    .replace(/"(?:\\.|[^"\\\n])*"/g, ' "" ')
    .replace(/`(?:\\.|[^`\\])*`/g, ' `` ');
}

const nameOf = (line) => {
  const m = /assert\(\s*(?:'([^']{0,120})'|"([^"]{0,120})"|`([^`]{0,120})`)/.exec(line);
  return m ? (m[1] || m[2] || m[3]) : '(未解析出名字)';
};

/** ★ 可复用入口（smoke 直接 import —— 保证"门禁口径"与"人工普查"永远是同一份实现） */
export function audit(srcPath, win = WIN) {
  const lines = fs.readFileSync(srcPath, 'utf8').split('\n');
  return auditLines(lines, win);
}

export function auditLines(lines, win = WIN) {
  const rows = [];

for (let i = 0; i < lines.length; i++) {
  if (!/assert\(/.test(lines[i])) continue;
  // ★ 窗口到**下一条 assert 之前**为止（早期版本固定取 14 行，会串到下一条断言上 → 假阳性）
  let end = i + 1;
  while (end < lines.length && end < i + win && !/assert\(/.test(lines[end])) end++;
  const winTxt = lines.slice(i, end).join('\n');
  const before = lines.slice(Math.max(0, i - 8), i).join('\n');
  const marked = /H29-OK/.test(before);
  const c = scrub(winTxt);

  // 区分两类（H29 的核心口径）：
  //   snapshot  = `=== / ==` 与字面数字比 → **快照式**，数据一变就红（要改 / 要标注）
  //   threshold = `>= / > / <= / <` 与字面数字比 → **性质判据**（数量≥、量级内…），天然可接受
  const hits = [];
  const push = (op, num) => { if (Number.isFinite(num)) hits.push({ op, num }); };
  for (const m of c.matchAll(/\.length\s*(===|==|>=|>|<=|<)\s*(\d+(?:\.\d+)?)/g)) push(m[1], parseFloat(m[2]));
  for (const m of c.matchAll(/\b(\w*(?:count|Count|num|Num|rows?|items?|keys?|sats?|Sats?|pts|labels?))\s*(===|==|>=|>|<=|<)\s*(\d+(?:\.\d+)?)/g)) push(m[2], parseFloat(m[3]));
  for (const m of c.matchAll(/(\d+(?:\.\d+)?)\s*(===|==|>=|>|<=|<)\s*(?:\w*\.length|\w*(?:count|Count|num|Num|rows?|items?|keys?|sats?))/g)) push(m[2], parseFloat(m[1]));
  if (!hits.length) continue;

  const eq = hits.filter(h => h.op === '===' || h.op === '==');
  const worstEq = eq.length ? Math.max(...eq.map(h => h.num)) : -1;
  const worstAny = Math.max(...hits.map(h => h.num));
  rows.push({
    line: i + 1, name: nameOf(lines[i] + '\n' + (lines[i + 1] || '')), worst: worstAny, worstEq,
    hits: hits.length, marked,
    bucket: worstEq >= 20 ? 'DANGER' : (worstAny >= 20 ? 'THRESHOLD' : (worstAny >= 4 ? 'review' : 'struct')),
  });
}

  rows.sort((a, b) => b.worst - a.worst || a.line - b.line);
  return rows;
}

const DIRECT = process.argv[1] && /audit_assertions\.mjs$/.test(process.argv[1].replace(/\\/g, '/'));
if (DIRECT) {
const lines = fs.readFileSync(SRC, 'utf8').split('\n');
const rows = auditLines(lines);
const group = k => rows.filter(r => r.bucket === k);
const fmt = r => '  ' + (r.marked ? '[H29-OK]' : '        ') + ' L' + r.line +
  '  最大=' + r.worst + (r.worstEq > 0 ? '/═' + r.worstEq : '') + '（' + r.hits + ' 处）  ' + r.name.slice(0, 70);

console.log('smoke.mjs 行数 =', lines.length, '｜含"疑似快照"数字比较的断言 =', rows.length);
for (const k of ['DANGER', 'THRESHOLD', 'review', 'struct']) {
  const g = group(k);
  console.log('\n=== ' + k + '（' + g.length + ' 条；未标注 ' + g.filter(r => !r.marked).length + ' 条） ===');
  (k === 'struct' ? g.slice(0, 5) : g).forEach(r => console.log(fmt(r)));
  if (k === 'struct' && g.length > 5) console.log('  …（其余 ' + (g.length - 5) + ' 条同档，略）');
}

if (CHECK) {
  const bad = group('DANGER').filter(r => !r.marked);
  if (bad.length) {
    console.error('\n❌ H29 门禁：' + bad.length + ' 条"疑似数据快照"未标注理由（≥20 的字面数字比较）。');
    console.error('   两条出路：① 改成性质判据（把 `=== N` 换成 `>= N` / 占比 / 单调 / 贴近 / 至少一半）；');
    console.error('             ② 确属不变量 → 断言前一行写 `// H29-OK: 理由`。');
    bad.slice(0, 25).forEach(r => console.error('   · L' + r.line + ' ' + r.name.slice(0, 70)));
    process.exitCode = 1;
  } else {
    console.log('\n✓ H29 门禁通过：DANGER 档全部已标注理由（或已改成性质判据）。');
  }
}
}
