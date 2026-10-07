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
const BUNDLE = path.join(ROOT, '星网与千帆在轨追踪.html');
const STABLE = 'CISTrack.html';

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
fs.copyFileSync(BUNDLE, path.join(ROOT, STABLE));
fs.copyFileSync(BUNDLE, path.join(ROOT, ARTIFACT));
console.log('产物 ' + before + ' B → ' + STABLE + ' / ' + ARTIFACT);

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
