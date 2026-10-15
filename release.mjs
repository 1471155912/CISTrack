/* release.mjs —— 发布产物同步（**路径无关**，本地仓库与 GitHub Actions 通用）
 * ---------------------------------------------------------------------------
 * 为什么单独有这个脚本：
 *   以前同步发布产物靠发布目录外的 build_release.mjs，里面**写死了本机 D: 盘绝对路径**，
 *   既不能在 GitHub Actions 里跑，也会被"去敏感信息"扫描判成隐私泄露。
 *   这里改成只用「脚本所在目录」，任何 checkout 下来都能直接执行。
 *
 * 做三件事（只增不删，绝不删除任何文件）：
 *   1. 星网与千帆在轨追踪.html → CISTrack.html（固定链接用） + CISTrack_v<版本>.html（快照）
 *   2. package.json 的 version 与 app.js 的 VERSION 对齐
 *   3. 报告结果
 *
 * 用法：node release.mjs [版本号]        版本号可选，默认读 app.js 的 VERSION
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
// ★ V1.9.5（H46）：产物名统一 —— build.mjs 直接写 `CISTrack.html`（不再产出中文名的那份），
//   本脚本只负责"打版本快照"与版本号同步，不再复制一份同内容的固定链接文件。
const BUNDLE = path.join(ROOT, 'CISTrack.html');

function readVersion() {
  const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const m = src.match(/var VERSION\s*=\s*'([^']+)'/);
  if (!m) throw new Error('读不到 app.js 里的 VERSION');
  return m[1];
}

const raw = process.argv[2] || readVersion();
const VER = raw.replace(/^[Vv]/, '');                 // 只留数字版本（例：1.8.0）
const ARTIFACT = 'CISTrack_v' + VER + '.html';        // 命名规范：小写 v

if (!fs.existsSync(BUNDLE)) {
  console.error('✗ 找不到构建产物 ' + BUNDLE + '，先跑 node build.mjs');
  process.exit(1);
}

const before = fs.statSync(BUNDLE).size;
fs.copyFileSync(BUNDLE, path.join(ROOT, ARTIFACT));
console.log('产物 ' + before + ' B → ' + ARTIFACT + '（固定链接 CISTrack.html 由 build.mjs 直接产出）');

// ★ V1.9.5（H28）：**旧版本自动裁剪** —— 仓库只留「当前版 + 上一版」两份带版本号产物。
//   用户 2026-10-15 明确要求："自动删除旧 html，并且除非我再指令此后无需备份老版本文件并上传"。
//   只处理本目录里形如 `CISTrack_v<主>.<次>.<修>.html` 的文件，按版本号倒序保留最新 2 份；
//   其它文件（CISTrack.html / index.html / assets/ …）一律不碰，避免误删。
//   ⚠️ 版本比较必须按分段数字，不能靠字典序 —— 否则 v1.10.0 会被判成小于 v1.9.9。
{
  const re = /^CISTrack_v(\d+)\.(\d+)\.(\d+)\.html$/;
  const cand = fs.readdirSync(ROOT).filter(function (f) { return re.test(f); }).map(function (f) {
    const m = f.match(re);
    return { f: f, k: [+m[1], +m[2], +m[3]] };
  }).sort(function (a, b) { return (b.k[0] - a.k[0]) || (b.k[1] - a.k[1]) || (b.k[2] - a.k[2]); });
  const drop = cand.slice(2);
  drop.forEach(function (d) {
    try { fs.unlinkSync(path.join(ROOT, d.f)); console.log('裁剪旧产物：' + d.f); }
    catch (e) { console.log('⚠ 裁剪失败（跳过）：' + d.f + ' — ' + (e && e.message)); }
  });
  console.log('带版本号产物保留：' + cand.slice(0, 2).map(function (x) { return x.f; }).join(' / ') +
    (drop.length ? '' : '（本次无需裁剪）'));
}

// package.json 版本号同步（以前它常年停在旧版本，与页面显示的版本号对不上）
{
  const p = path.join(ROOT, 'package.json');
  try {
    const pkg = JSON.parse(fs.readFileSync(p, 'utf8'));
    const old = pkg.version;
    if (old !== VER) {
      pkg.version = VER;
      if (pkg.devDependencies && pkg.devDependencies.playwright) delete pkg.devDependencies.playwright;
      fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
      console.log('package.json 版本: ' + old + ' → ' + VER);
    } else {
      console.log('package.json 版本已是 ' + VER);
    }
  } catch (e) {
    console.log('⚠ package.json 读不到，跳过版本同步（' + (e && e.message) + '）');
  }
}

// ★ README（双语）顶部 version 徽章同步 —— 与 package.json 同一病根：
//   版本号散落在多处（app.js 的 VERSION、package.json、README 徽章 URL），升版时靠人记住改，
//   V1.9.3/V1.9.4 就漏过徽章（停在 1.9.2）。现在 release.mjs 统一改写：
//   只匹配 shields.io 的 version 徽章 URL 里的数字段，不动其余任何内容；
//   smoke 另有一条"徽章版本 == app.js VERSION"的断言兜底（漏跑 release 也会红）。
{
  const BADGE_RE = /(img\.shields\.io\/badge\/version-)([0-9]+\.[0-9]+\.[0-9]+)/g;
  ['README.md', 'README.en.md'].forEach(function (f) {
    const p = path.join(ROOT, f);
    try {
      const src = fs.readFileSync(p, 'utf8');
      let n = 0;
      const out = src.replace(BADGE_RE, function (_, pre, ver) {
        if (ver === VER) return pre + ver;
        n++; return pre + VER;
      });
      if (n) {
        fs.writeFileSync(p, out, 'utf8');
        console.log(f + ' 版本徽章: → ' + VER + '（改 ' + n + ' 处）');
      } else {
        console.log(f + ' 版本徽章已是 ' + VER);
      }
    } catch (e) {
      console.log('⚠ ' + f + ' 读不到，跳过徽章同步（' + (e && e.message) + '）');
    }
  });
}
