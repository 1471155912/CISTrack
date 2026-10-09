import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.dirname(fileURLToPath(import.meta.url));   // 脚本所在目录（发布包内任意位置可用）
const B = ROOT;
const R = B + '/data';

// ---- V1.7.0 三轮：构建前自动清理「与现版本 / 留档版本都无关」的一次性产物 ----
// 只搬不删（进 junk/<时间戳>/，随时整包搬回），且**绝不阻断构建**。
// 想跳过这次清理：设环境变量 CISTRACK_NO_CLEAN=1。
if (!process.env.CISTRACK_NO_CLEAN && fs.existsSync(B + '/clean.mjs')) {
  try {
    // 注意：这里必须**模块内调用**而不是 execFileSync 派生子进程 ——
    // 本机 spawn 同一个 node.exe 会稳定报 EBUSY（clean.mjs 因此导出了 scan/applyMove）。
    const { scan, applyMove } = await import('./clean.mjs');
    const plan = scan(B, { deep: false, noProfiles: false });
    if (plan.move.length) {
      const r = applyMove(plan);
      console.log('清理：搬走 ' + r.okN + ' 项一次性产物（' + (r.mb / 1048576).toFixed(1) + ' MB）→ junk/（可整包搬回）'
        + (r.failN ? '；' + r.failN + ' 项搬不动（多半是浏览器用户数据目录被占用），已跳过' : ''));
    }
  } catch (e) {
    console.log('清理：跳过（' + (e && e.message || e) + '）');
  }
}

let html = fs.readFileSync(`${B}/template.html`, 'utf8');
const sgp4 = fs.readFileSync(`${R}/satellite.min.js`, 'utf8');
const coast = fs.readFileSync(`${R}/coast.js.txt`, 'utf8');
const data = fs.readFileSync(`${B}/build/satdata.json`, 'utf8');
const app = fs.readFileSync(`${B}/app.js`, 'utf8');

for (const [name, code] of [['sgp4', sgp4], ['coast', coast], ['data', data], ['app', app]]) {
  if (code.includes('</script')) { console.error('!! ' + name + ' 含有 </script，需转义'); }
}

html = html
  .replace('<!--INJECT_SGP4-->', '<script>/* satellite-js v5.0.0 · MIT · https://github.com/shashwatak/satellite-js */\n' + sgp4 + '\n</script>')
  .replace('<!--INJECT_COAST-->', '<script>' + coast + '</script>')
  .replace('<!--INJECT_DATA-->', '<script>window.SATDATA=' + data + ';</script>')
  .replace('<!--INJECT_APP-->', '<script>\n' + app + '\n</script>');

const out = `${B}/星网与千帆在轨追踪.html`;
fs.writeFileSync(out, html, 'utf8');
console.log('written', out, fs.statSync(out).size, 'bytes');
console.log('placeholders left:', (html.match(/<!--INJECT/g) || []).length);

// V1.4.0：把 wiki.json 复制到 HTML 同级目录 —— 只要这两个文件一起发布，
// 页面打开就会自动读 wiki.json 覆盖顶部词条计数（只改 JSON 里的数字、不必重建 HTML）。
const wj = `${B}/build/wiki.json`;
if (fs.existsSync(wj)) {
  fs.copyFileSync(wj, `${B}/wiki.json`);
  console.log('copied wiki.json →', fs.statSync(`${B}/wiki.json`).size, 'bytes');
}

// V1.9.0（R17）：历史轨道要素库**外挂 + 按批次分片** —— 与 wiki.json 同一套路，但是一个目录。
//   规模重估后（数万~数十万颗）单个大 JSON 会撞 GitHub 100MB 硬限；分片后每个文件几十 KB，
//   页面只取选中的那一批。以后更新历史只要替换 history/ 目录，不必重新构建 HTML。
{
  const src = `${B}/build/history`, dst = `${B}/history`;
  if (fs.existsSync(src)) {
    // 清掉旧产物目录再复制。rmSync 在个别环境（安全删除钩子回收竞态）可能抛错，
    // 这里降级为「逐文件覆盖 + 兜底移走」，保证复制本身总能完成。
    try {
      fs.rmSync(dst, { recursive: true, force: true });
    } catch (e) {
      console.log('  rmSync 旧 history/ 失败，降级为逐文件覆盖（' + (e.message || '').slice(0, 60) + '）');
    }
    fs.mkdirSync(dst, { recursive: true });
    let n = 0, kb = 0;
    for (const f of fs.readdirSync(src)) {
      fs.copyFileSync(`${src}/${f}`, `${dst}/${f}`);
      n++; kb += fs.statSync(`${dst}/${f}`).size;
    }
    // 复制完成后，清掉「新分片里已不存在」的陈旧文件，避免历史文件越积越多
    const keep = new Set(fs.readdirSync(src));
    for (const f of fs.readdirSync(dst)) {
      if (!keep.has(f)) { try { fs.rmSync(`${dst}/${f}`, { force: true }); } catch (e) {} }
    }
    console.log(`copied history/ → ${n} files, ${(kb / 1024).toFixed(1)} KB`);
  } else {
    console.log('history/ 未生成（跳过复制）');
  }
}
