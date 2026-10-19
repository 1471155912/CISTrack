/* repo_hygiene.mjs —— 仓库卫生闸门（V1.9.5 起强制）
 * ---------------------------------------------------------------------------
 * 为什么需要它（用户 2026-10-15 点名）：
 *   仓库里混进了**对使用者毫无意义、只属于开发过程**的文件 —— 逐轮的任务清单 / 人工审查
 *   清单 / 核对表、一次性的核对脚本、开发笔记、本机运维小工具。用户的口径是：
 *     "除了产物 HTML、说明文档、运行时数据和重建它的源码链，其余都不该进仓库。"
 *   靠"记得别提交"是不行的（已经复发过两次）；根治办法和去敏感一样 —— **机器可执行的闸门**。
 *
 * 判据分两层：
 *   ① **根目录白名单**：根目录只允许 ALLOW_ROOT_EXACT 列出的文件、ALLOW_ROOT_RE 匹配的
 *      带版本号产物，以及 ALLOW_DIR 列出的目录。没在白名单里 → 失败并提示怎么处理；
 *   ② **全路径黑名单**：任意深度命中 BLOCK 中任一条 → 失败（任务清单/核对表/开发笔记/
 *      一次性脚本/调试件/中间产物/暂存目录…）。
 *   ⚠️ 黑名单写的是**类别**不是具体文件名；白名单也**不写死版本号**（带版本号产物用正则 +
 *      数量上限表达"只留当前版 + 上一版"这条既有约定）—— 否则每发一版都要改闸门，
 *      而"写死数据快照"正是本项目反复踩过的断言写法错误。
 *
 * 检查对象默认是 `git ls-files -c -o --exclude-standard -z`
 *   （**已跟踪 + 未被忽略的新文件**）—— 这正是 `git add -A` 会提交的那一批，
 *   所以本地随手跑、CI 的提交前步骤跑，都能拦住。
 *   （用 `-z`：git 对非 ASCII 文件名会输出带引号的八进制转义，按行解析必然误判。）
 *
 * 用法：node scripts/repo_hygiene.mjs [--files-from <NUL 分隔清单>]
 *   命中 → 退出码 1；干净 → 退出码 0。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// ---- ① 根目录白名单（写类别/角色，不写版本号）----
const ALLOW_ROOT_EXACT = new Set([
  // 产物（用户直接打开的东西）
  'CISTrack.html',              // ★ 唯一产物名（V1.9.5 起 build.mjs 直接写它；不再产出中文名的那份）
  'index.html',                 // GitHub Pages 入口（跳转到 CISTrack.html）
  // 说明与授权
  'README.md', 'README.en.md', 'CHANGELOG.md', 'CHANGELOG.en.md', 'LICENSE',
  // 重建链：源码 + 构建脚本 + 测试
  //   ⚠️ V1.9.5：`clean.mjs` / `i18n.mjs` / `visual.mjs` **不在仓库里了**（开发/验证工具，留本地），
  //   它们被下面的黑名单明确拦下；CI 唯一需要的测试是 `smoke.mjs`（依赖 jsdom）。
  'app.js', 'template.html',
  'build.mjs', 'mkcoast.mjs', 'mkdata.mjs', 'mkmanufacturers.mjs', 'refresh.mjs', 'release.mjs',
  'smoke.mjs',
  // 运行时数据与依赖清单
  'wiki.json', 'wiki_launches.json', 'package.json', 'package-lock.json',
  // 版本控制配置
  '.gitignore', '.gitattributes',
  // ★ V1.9.9：`.nojekyll` —— GitHub Pages 的**部署开关**（空文件）。
  //   为什么要它：本仓库的 Pages 是 legacy（Jekyll）构建，2026-10-19 那次发布
  //   构建直接 `Page build failed`（duration 0），站点停在上一版。本项目的产物是**纯静态**、
  //   不需要 Liquid/Jekyll 任何处理 —— 关掉它既绕开那类构建失败，也把部署时间从 ~40s 降下来。
  //   （它不是过程文件，而是"发布链的一环"，所以属于白名单里"用户会用到/重建链"这一类。）
  '.nojekyll',
]);
// 带版本号的产物：`CISTrack_v<主>.<次>.<修>.html`（数量另有限制）
const ALLOW_ROOT_RE = [/^CISTrack_v\d+\.\d+\.\d+\.html$/];
const MAX_VERSIONED_HTML = 2;   // 既有约定：只留「当前版 + 上一版」，更早的靠 git 历史回滚
// ★ V1.9.6：新增 deploy/ —— 给"下载 Release 的 zip 本地部署"用的一键更新/定时任务脚本。
//   里面只有 .bat / .sh（零依赖，Node 即可跑），不含任何过程文件。
const ALLOW_DIR = new Set(['assets', 'data', 'history', 'scripts', 'deploy', '.github']);

// ---- ② 全路径黑名单（任意深度）----
const BLOCK = [
  ['内部过程文档（任务/审查/核对清单）', /(任务清单|人工审查清单|核对表|验收检查清单|检查清单)/],
  ['开发笔记（不进仓库）', /(^|\/)(PERF_NOTES|PROCESS|NOTES)\.(md|txt)$/],
  ['一次性核对脚本', /(^|\/)audit_wiki\.mjs$/],
  ['本机运维小工具（与项目无关）', /(^|\/)recycle\.mjs$/],
  // ★ V1.9.5（H38）：开发/验证工具留本地 —— 用户 2026-10-16 明确点名（clean/i18n/visual 等
  //   "应该留在本地而不是上传到 github 仓库"）。它们不影响用户使用，也不是 CI 的重建链。
  ['开发/验证工具（留本地）', /(^|\/)(clean|i18n|visual)\.mjs$/],
  ['手工核对工具（留本地）', /(^|\/)audit_tle\.mjs$/],
  ['暂存/中间/归档目录', /(^|\/)(junk|build|archive|logs|shots|node_modules|过程归档|维护文档)\//],
  ['开发期调试件（`_` 前缀）', /(^|\/)_[^/]*$/],
  ['临时产物', /\.(tmp|log|bak)$/],
  ['删除残骸（safe-delete 改名的文件）', /\.DELETE\.[0-9a-f]+/i],
  ['无头浏览器 profile', /(^|\/)\.edge(cdp|prof)/],
];

// ---- 取清单 ----
const argi = process.argv.indexOf('--files-from');
let files;
if (argi > 0) {
  const raw = fs.readFileSync(process.argv[argi + 1], 'utf8');
  files = raw.split('\0').filter(Boolean);
} else {
  files = execFileSync('git', ['ls-files', '-c', '-o', '--exclude-standard', '-z'],
    { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
}

const bad = [];
let versioned = 0;
for (const rel of files) {
  const p = rel.replace(/\\/g, '/');
  // ★ V1.9.5：**只体检"磁盘上真实存在"的文件** —— `git ls-files` 也会列出"已删但本次提交才带走"的
  //   路径（例如 release.mjs 裁剪掉的旧版本产物），把它们计进"版本产物份数"会造成假 FAIL
  //   （实测：裁剪后本地算 3 份、CI 全新检出只有 2 份）。"tracked 但缺失"由 audit_refs 负责，不在这里重复。
  if (!fs.existsSync(path.join(ROOT, p))) continue;
  let blocked = false;
  for (const [tag, re] of BLOCK) {
    if (re.test(p)) { bad.push({ rel: p, why: tag }); blocked = true; break; }
  }
  if (blocked) continue;                        // 已被黑名单命中：不再重复报"不在白名单"
  if (!p.includes('/')) {
    if (ALLOW_ROOT_RE.some(re => re.test(p))) { versioned++; continue; }
    if (!ALLOW_ROOT_EXACT.has(p)) bad.push({ rel: p, why: '不在根目录白名单' });
  } else {
    const top = p.split('/')[0];
    if (!ALLOW_DIR.has(top)) bad.push({ rel: p, why: '不在允许的目录白名单（' + top + '/）' });
  }
}
if (versioned > MAX_VERSIONED_HTML) {
  bad.push({ rel: 'CISTrack_v*.html × ' + versioned, why: '带版本号产物超过 ' + MAX_VERSIONED_HTML + ' 份（约定：只留当前版 + 上一版）' });
}

console.log('仓库卫生检查：' + files.length + ' 个待入库文件（已跟踪 + 未忽略的新文件），不合规 ' + bad.length + ' 个');
if (bad.length) {
  console.error('\n✗ 以下文件不该进入公开仓库（用户口径：只留"用户能用的 + 重建它的源码链"）：\n');
  const seen = new Set();
  for (const b of bad) {
    if (seen.has(b.rel)) continue;
    seen.add(b.rel);
    console.error('  ' + b.rel + '    ← ' + b.why);
  }
  console.error('\n处理办法：');
  console.error('  · 若它是开发过程文档/笔记/一次性脚本 → 移到仓库外的 `维护文档/` 保存，然后 git rm');
  console.error('  · 若它是调试件或临时产物 → 直接删除（或交给 clean.mjs 收进 junk/）');
  console.error('  · 若它确实属于"用户会用到"或"重建链"→ 把名字加进本脚本的白名单，并在注释里写明理由');
  process.exit(1);
}
console.log('✓ 通过：根目录与子目录均无过程类/临时类文件');
