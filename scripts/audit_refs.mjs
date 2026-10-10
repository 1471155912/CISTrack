// ---------------------------------------------------------------- V1.9.1：引用完整性体检
// 为什么需要它：`scripts/climb.mjs` 是构建期算法模块，被 smoke.mjs 直接读源码做断言 —— 但它在
//   V1.9.0 提交（e6c9fb0）时**被漏提交**（一直只是"工作区里的未跟踪文件"）。
//   于是仓库处于"自己的测试脚本引用一个仓库里不存在的文件"的状态：本机能跑、CI 不跑 smoke、
//   谁都没发现；直到该文件在工作区里丢失，smoke 当场崩在 readFileSync。
// 体检两件事：
//   ① **被引用但磁盘上不存在**的本地文件（漏提交 / 改名后忘了同步引用）
//   ② **在库里（tracked）但磁盘上不存在**的文件（误删）
//
// 用法：
//   git ls-files -z > /tmp/tracked.txt && node scripts/audit_refs.mjs /tmp/tracked.txt
//   node scripts/audit_refs.mjs                     # 无参数：只扫磁盘上的源码（跳过 ① 的 tracked 信息）
//   ⚠️ 必须用 `-z`（NUL 分隔）：默认的 `git ls-files` 会把**非 ASCII 文件名**加引号并转成八进制转义
//      （`"V1.9.1_1.3_\350\257\215…"`），照字面查磁盘必然"找不到" → 体检自己变成误报源。
//      脚本里也带了转义还原（双保险），但 `-z` 才是正路。
// 退出码：有真问题 → 1（供 CI 的 set -e 截断）

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));   // scripts/ 的上一级
const trackedFile = process.argv[2];

// 扫描时跳过的目录：都不是"源码依赖"的来源
const SKIP_DIR = new Set(['.git', 'node_modules', 'build', 'archive', 'junk', 'shots',
  'history', 'logs', 'data/history_cache', 'wiki_cache']);

// ★ 已知的"引用得到、但按设计就不存在于仓库"的文件 —— 必须是**穷尽列举**，不能写成通配，
//   否则这个体检会自己变成静默放行器。每条都要写明理由。
const OPTIONAL = {
  'satdata.json': '构建中间产物（build/，由 mkdata.mjs 生成，.gitignore）',
  'cat_objs.json': '可选输入（.gitignore，缺了只影响"按编号反查"补漏）',
  'refresh_report.json': '采集报告（.gitignore，诊断用）',
  'spacetrack.json': 'Space-Track 凭据（用户要求删除；需要补历史时临时放回）',
  '.secrets/spacetrack.json': '同上（另一个候选路径）',
  '_secrets/spacetrack.json': '同上（另一个候选路径）',
  'satcat.csv': 'CelesTrak 目录（6.7MB，.gitignore，由 refresh.mjs 下载）',
  'omm_norad.json': '6 位编目号映射（由 refresh.mjs 产出，缺了则 6 位号卫星算不出轨道）',
  'wiki.json': '词条统计（由 fetch_wiki.mjs 产出，缺了退回内置静态值）',
};
// 只出现在注释/URL/运行时拼出来的名字（不是真的文件依赖）—— 逐条列明，便于日后复核
const NOT_A_PATH = new Set([
  'pub/satcat.csv',      // 出现在 https://celestrak.org/pub/satcat.csv 与离线桩的 includes() 里
  '05-2025.txt',         // fetch_history.mjs 注释里举例的缓存文件名
  'wiki_qianfan.html',   // wiki_cache 里的抓取缓存名（运行时生成）
  'wiki_xingwang.html',
]);

const SRC_RE = /\.(mjs|js|cjs)$/;
const REF_RE = /['`](\.{0,2}\/)?([A-Za-z0-9_\.\/\-]+\.(?:mjs|js|json|csv|html|txt|cjs))['`]/g;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = path.relative(ROOT, path.join(dir, e.name)).replace(/\\/g, '/');
    if (e.isDirectory()) {
      if (SKIP_DIR.has(rel) || SKIP_DIR.has(e.name)) continue;
      walk(path.join(dir, e.name), out);
    } else if (SRC_RE.test(e.name)) out.push(rel);
  }
  return out;
}

// git 对非 ASCII 文件名会输出 C 风格转义（`"…\350\257\215…"`）→ 还原成真实路径
function unquote(s) {
  if (!(s.startsWith('"') && s.endsWith('"'))) return s;
  const body = s.slice(1, -1), bytes = [];
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\\') {
      const oct = body.slice(i + 1, i + 4);
      if (/^[0-7]{3}$/.test(oct)) { bytes.push(parseInt(oct, 8)); i += 3; continue; }
      const map = { n: 10, t: 9, r: 13, '"': 34, '\\': 92 };
      const c = map[body[i + 1]];
      if (c !== undefined) { bytes.push(c); i++; continue; }
    }
    bytes.push(body.charCodeAt(i));
  }
  return Buffer.from(bytes).toString('utf8');
}

const tracked = trackedFile && fs.existsSync(trackedFile)
  ? (() => {
      const raw = fs.readFileSync(trackedFile, 'utf8');
      // 兼容 `-z`（推荐）与按行两种导出方式
      return (raw.includes('\0') ? raw.split('\0') : raw.split('\n'))
        .map(s => unquote(s.trim())).filter(Boolean);
    })()
  : null;

const sources = tracked
  ? tracked.filter(f => SRC_RE.test(f) && fs.existsSync(path.join(ROOT, f)))
  : walk(ROOT);

let bad = 0;
console.log('引用完整性体检（扫描 ' + sources.length + ' 个源文件' +
  (tracked ? '；tracked 清单 ' + tracked.length + ' 条' : '；仅磁盘扫描') + '）');

// ---- ① 被引用但不存在 ----
const missing = new Map();
for (const f of sources) {
  const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
  let m;
  while ((m = REF_RE.exec(s))) {
    const r = m[2];
    if (NOT_A_PATH.has(r) || OPTIONAL[r]) continue;
    if (r.startsWith('http')) continue;
    const cands = [r, 'scripts/' + r, 'data/' + r, r.replace(/^\.\//, '')];
    if (cands.some(c => fs.existsSync(path.join(ROOT, c)))) continue;
    if (!missing.has(r)) missing.set(r, []);
    missing.get(r).push(f);
  }
}
if (missing.size) {
  bad++;
  console.log('\n✗ 被引用但磁盘上不存在（需要恢复或修正引用）：');
  for (const [r, where] of missing) console.log('    ' + r + '   ← 引用于 ' + [...new Set(where)].join(', '));
} else console.log('\n✓ 所有被引用的本地文件都存在（已知可选件 ' + Object.keys(OPTIONAL).length + ' 项已排除）');

// ---- ② tracked 但不存在 ----
if (tracked) {
  const gone = tracked.filter(f => !fs.existsSync(path.join(ROOT, f)));
  if (gone.length) {
    bad++;
    console.log('\n✗ 在库里但磁盘上不存在（疑似误删）：');
    gone.forEach(f => console.log('    ' + f));
  } else console.log('✓ tracked 文件全部在磁盘上');
}

console.log('\n结论：' + (bad ? '发现 ' + bad + ' 类问题' : '通过'));
process.exitCode = bad ? 1 : 0;
