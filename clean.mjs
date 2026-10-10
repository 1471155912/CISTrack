// CISTrack · 项目文件清理（白名单式，绝不删除）
// ---------------------------------------------------------------------------
// 解决的问题：开发过程中会在项目根目录堆下大量"一次性产物"—— 调试用的 HTML、
// 下划线开头的临时脚本、无头浏览器用户数据目录、测试截图与下载的导出图、
// 各种 .txt 日志。它们既不属于**现版本**（构建输入 + 文档 + 数据），
// 也不属于**留档版本**（archive/ 里的版本快照），留着只会让目录越来越乱。
//
// 三条铁律（与项目既有的 build_release.mjs 同一套思路）：
//   ① 只搬不删 —— 命中的文件一律 **移动** 到 junk/<时间戳>/ 下，随时可以整包搬回来；
//   ② 白名单保护 —— 现版本清单 + 留档目录 + .git/.github 等，任何情况下都不动；
//   ③ 默认空跑 —— 不带 --apply 只打印计划，看清楚再执行。
//
// 用法：
//   node clean.mjs                 空跑，打印「将搬走哪些 / 保留哪些」
//   node clean.mjs --apply         真的搬到 junk/<时间戳>/
//   node clean.mjs --deep          连同 过程归档/ 里的一次性补丁脚本一起清（保留 snapshots/）
//   node clean.mjs --no-profiles   暂不动无头浏览器用户数据目录（正在跑 CDP 探针时用它）
//   node clean.mjs --json          机器可读输出（给别的脚本调用）
//   node clean.mjs --dir <路径>    指定要清理的项目根目录（默认脚本所在目录）
//
// 返回码：0 = 无需清理或清理成功；2 = 命中但处于空跑；1 = 出错
//
// 另外导出 scan/applyMove/report 三个函数给 build.mjs、build_release.mjs 直接调用 ——
// 早期版本用 execFileSync 派生子进程来调本脚本，在本机会稳定报 EBUSY（Windows 下
// 同一 node.exe 被再次 spawn 时被占用），所以改成模块内调用。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- 现版本：必须原样保留
const KEEP_FILES = [
  // 构建输入
  'app.js', 'template.html', 'build.mjs',
  // 构建/刷新脚本（npm scripts 会用到，删了就没法重建数据）
  'mkdata.mjs', 'mkmaker.mjs', 'mkcoast.mjs', 'refresh.mjs',
  // 自测与清理
  'smoke.mjs', 'visual.mjs', 'clean.mjs',
  // 发布与文档
  'package.json', 'index.html', '.gitignore', 'LICENSE',
  'README.md', 'CHANGELOG.md', 'PROCESS.md', 'PERF_NOTES.md',
  // 运行时数据（HTML 会去读的同级 wiki.json）
  'wiki.json',
  // 构建产物
  '星网与千帆在轨追踪.html'
];
const KEEP_DIRS = ['archive', 'data', 'build', 'scripts', '.git', '.github', '.workbuddy', 'junk', 'node_modules',
  'logs'];   // logs/ = 计划任务（wiki 抓取）的运行日志，是运维痕迹不是垃圾
// 留档：过程归档（探针脚本 + 快照）。默认整目录保留，--deep 时才进去收一次性脚本。
const ARCHIVE_DIRS = ['过程归档'];
// 过程归档内部：永远保留
const ARCHIVE_KEEP = [/^snapshots$/, /^开发杂项$/];

// ---------------------------------------------------------------- 一次性产物：搬走
const SCRATCH_FILE = [
  /^_/,                       // _probe.html / _mkprobe.mjs / _t_check.mjs …（本次排查的调试件）
  /^\..*\.txt$/,              // .smoke.txt / .visual_out.txt / .procs.txt …（临时日志）
  /^tmp.*\.(png|jpg|jpeg|gif|webp|html|mjs|js|txt)$/i,
  /^\.edgeprof\d*$/,          // 无头 Edge 用户数据目录
  /^\.edgecdp$/,
  /^\.cdp-/,
  /^NODE_PATH\.txt$/,
  /\.tmp$/,
  /\.log$/
];
const SCRATCH_DIR = [/^shots$/, /^\.edgeprof\d*$/, /^tmp$/, /^\.cdp-/];
// 混合目录：目录本身要留（里面有现版本还在用的东西），但里面的"其余文件"是一次性产物。
// shots/ 就是这种 —— README 引用的是 v139/v140 那三张图（build_release.mjs 会同步到发布区），
// 其余的截图与"导出下载样本"都是排查时的临时产物，该清。
// V1.9.1：shots/ 里那三张 README 截图已删除（用户：过时且不完整）→ 不再需要例外；
//   现有 README 素材统一放 assets/（不在 SCRATCH_DIR，也不会被搬走）。
const MIXED_DIR = {};
// --deep：过程归档里的一次性补丁脚本（fix_* / patch_* / rename_* 等）与探针的输出 txt
const DEEP_FILE = [/\.cjs$/, /\.txt$/];
const DEEP_DIR = [/^开发杂项$/];
// 无头浏览器用户数据目录：体积极大（实测两个合计 942 MB），但正在跑 CDP 探针时不能动。
const PROFILE_RE = /^\.edgeprof\d*$|^\.edgecdp$|^\.cdp-/;

function ls(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return []; }
}
function du(p) {
  let s = 0;
  try {
    const st = fs.statSync(p);
    if (!st.isDirectory()) return st.size;
    for (const e of ls(p)) s += du(path.join(p, e.name));
  } catch (e) {}
  return s;
}
function mb(n) { return (n / 1024 / 1024).toFixed(2) + ' MB'; }
function matchAny(name, res) { return res.some(r => r.test(name)); }

// ---------------------------------------------------------------- 扫描（纯读，不动任何东西）
export function scan(root, opts) {
  const o = opts || {};
  const deep = !!o.deep, noProf = !!o.noProfiles;
  const move = [], keep = [], warn = [];

  function walk(dir, relBase, deepInside) {
    for (const e of ls(dir)) {
      const abs = path.join(dir, e.name);
      const rel = relBase ? relBase + '/' + e.name : e.name;
      const isDir = e.isDirectory();
      if (deepInside) {
        if (isDir && matchAny(e.name, ARCHIVE_KEEP)) { keep.push({ rel, why: '留档（快照/原始资料）', size: du(abs) }); continue; }
        if (matchAny(e.name, DEEP_DIR)) { move.push({ abs, rel, why: '过程归档里的一次性产物目录（--deep）' }); continue; }
        if (!isDir && matchAny(e.name, DEEP_FILE)) { move.push({ abs, rel, why: '过程归档里的一次性补丁/日志（--deep）' }); continue; }
        if (isDir) { walk(abs, rel, true); continue; }
        keep.push({ rel, why: '过程归档（保留）', size: du(abs) });
        continue;
      }
      if (isDir) {
        if (KEEP_DIRS.includes(e.name)) { keep.push({ rel, why: '现版本目录', size: du(abs) }); continue; }
        if (ARCHIVE_DIRS.includes(e.name)) { keep.push({ rel, why: '留档目录（--deep 可入内清理）', size: du(abs) }); continue; }
        if (Object.prototype.hasOwnProperty.call(MIXED_DIR, e.name)) {
          const allowed = MIXED_DIR[e.name];
          for (const f of ls(abs)) {
            const fr = rel + '/' + f.name;
            if (!f.isDirectory() && allowed.includes(f.name)) { keep.push({ rel: fr, why: '现版本资产（README 引用）', size: du(path.join(abs, f.name)) }); continue; }
            move.push({ abs: path.join(abs, f.name), rel: fr, why: '一次性产物（' + e.name + '/ 里非现版本资产）' });
          }
          continue;
        }
        if (matchAny(e.name, SCRATCH_DIR)) {
          if (noProf && PROFILE_RE.test(e.name)) { keep.push({ rel, why: '浏览器用户数据目录（--no-profiles 本次跳过）', size: du(abs) }); continue; }
          move.push({ abs, rel, why: '一次性产物目录' });
          continue;
        }
        warn.push(rel + '  （未见过的目录，本次不动）');
        continue;
      }
      if (KEEP_FILES.includes(e.name)) { keep.push({ rel, why: '现版本文件', size: du(abs) }); continue; }
      // 发布区里的产物副本：CISTrack.html（固定链接）与 CISTrack_vX.Y.Z.html（各版本留档）
      if (/^CISTrack(_v[\d.]+)?\.html$/.test(e.name)) { keep.push({ rel, why: '版本留档/固定链接', size: du(abs) }); continue; }
      if (matchAny(e.name, SCRATCH_FILE)) { move.push({ abs, rel, why: '一次性产物' }); continue; }
      warn.push(rel + '  （未见过的文件，本次不动）');
    }
  }

  walk(root, '', false);
  if (deep) {
    for (const d of ARCHIVE_DIRS) {
      const abs = path.join(root, d);
      if (fs.existsSync(abs)) walk(abs, d, true);
    }
  }
  const moveSize = move.reduce((a, b) => a + du(b.abs), 0);
  return { root, move, keep, warn, moveSize, deep, noProf };
}

// ---------------------------------------------------------------- 执行（只移动，不删除）
export function applyMove(plan, onFail) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const junkRoot = path.join(plan.root, 'junk', stamp);
  let okN = 0, failN = 0, movedSize = 0;
  for (const m of plan.move) {
    const dest = path.join(junkRoot, m.rel);
    const size = du(m.abs);
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.renameSync(m.abs, dest);
      okN++;
      movedSize += size;
    } catch (e) {
      failN++;
      if (onFail) onFail(m.rel, e);
    }
  }
  return { okN, failN, junkRoot, mb: movedSize, skippedMb: plan.moveSize - movedSize };
}

// ---------------------------------------------------------------- 文本报告（只讲"将要做什么"）
export function report(plan) {
  const L = [];
  L.push('CISTrack 项目清理 · 空跑' + (plan.deep ? ' · --deep' : ''));
  L.push('根目录: ' + plan.root);
  L.push('');
  if (!plan.move.length) {
    L.push('✔ 没有发现「与现版本/留档版本都无关」的文件，目录本来就是干净的。');
  } else {
    L.push('将搬走 ' + plan.move.length + ' 项（共 ' + mb(plan.moveSize) + '）→ junk/<时间戳>/：');
    for (const m of plan.move) L.push('  · ' + m.rel + '   [' + m.why + ', ' + mb(du(m.abs)) + ']');
  }
  L.push('');
  L.push('保留 ' + plan.keep.length + ' 项（共 ' + mb(plan.keep.reduce((a, b) => a + b.size, 0)) + '）：现版本文件/目录 + archive/ 留档快照'
    + (plan.deep ? '' : ' + 过程归档/'));
  if (plan.warn.length) {
    L.push('');
    L.push('⚠ 未分类（本次不动，请你确认归属）：');
    for (const w of plan.warn) L.push('  ? ' + w);
  }
  if (plan.move.length) {
    L.push('');
    L.push('（空跑结束；确认无误后加 --apply 执行搬移）');
  }
  return L.join('\n');
}

// ---------------------------------------------------------------- 命令行入口
function isMain() {
  if (!process.argv[1]) return false;
  try { return pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url; } catch (e) { return false; }
}
if (isMain()) {
  const args = process.argv.slice(2);
  const APPLY = args.includes('--apply');
  const dirAt = args.indexOf('--dir');
  const opts = {
    root: path.resolve(dirAt >= 0 && args[dirAt + 1] ? args[dirAt + 1] : HERE),
    deep: args.includes('--deep'),
    noProfiles: args.includes('--no-profiles') || process.env.CISTRACK_KEEP_PROFILES === '1'
  };
  const plan = scan(opts.root, opts);
  const JSONOUT = args.includes('--json');
  if (JSONOUT) {
    console.log(JSON.stringify({
      root: plan.root, mode: APPLY ? 'apply' : 'dry-run', deep: plan.deep,
      move: plan.move.map(m => ({ rel: m.rel, why: m.why, size: du(m.abs) })),
      keepCount: plan.keep.length, keepSize: plan.keep.reduce((a, b) => a + b.size, 0),
      warn: plan.warn
    }, null, 2));
  } else {
    console.log(report(plan));
  }
  if (!plan.move.length) process.exit(0);
  if (!APPLY) process.exit(2);
  const applied = applyMove(plan, (rel, e) => console.error('  ✗ 搬不动 ' + rel + ' —— ' + e.message));
  if (!JSONOUT) {
    console.log('\n完成：搬走 ' + applied.okN + ' 项' + (applied.failN ? '，失败 ' + applied.failN + ' 项' : '')
      + '（' + mb(applied.mb) + '），都在 ' + path.relative(plan.root, applied.junkRoot).replace(/\\/g, '/')
      + '/ 之下，需要时整包搬回即可。');
    if (applied.failN) console.log('提示：本机对某些目录加了 Deny-Delete ACL（例如浏览器用户数据目录），搬不动属正常，可直接忽略。');
  }
  process.exit(applied.failN ? 1 : 0);
}
