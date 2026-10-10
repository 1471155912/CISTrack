import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.dirname(fileURLToPath(import.meta.url));   // 脚本所在目录（发布包内任意位置可用）
const B = ROOT;
const R = B + '/data';

// ---- V1.9.1：satcat 缺失时**拒绝出产物** ----
// 为什么要把"警告"升级成"硬失败"：satcat.csv 缺失会让 已再入标记 / 台账已再入扣减 / 搜索补池
// 三处**静默退化成空**（构建依然成功、产物看起来正常），极易把残缺产物直接提交上去。
// 产物是要发布的，所以在这里拦。CI 每次先跑 refresh.mjs 拿 satcat，正常路径不受影响。
// 确实想在无 satcat 的情况下出产物（例如只想看样式）：设 CISTRACK_ALLOW_NO_SATCAT=1。
if (!fs.existsSync(`${R}/satcat.csv`) && !process.env.CISTRACK_ALLOW_NO_SATCAT) {
  console.error('!! data/satcat.csv 缺失：已再入标记 / 台账已再入扣减 / 搜索补池 会静默失效，拒绝出产物。');
  console.error('   先跑 `node refresh.mjs --force-cat` 重建，或设 CISTRACK_ALLOW_NO_SATCAT=1 明确接受降级。');
  process.exit(2);
}

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
// ★ V1.9.1：加**"不倒退"守卫** —— 详见下面 wikiCounts 的注释（这文件是"双身份"的）。
function wikiCounts(o) {
  try {
    return ['gw', 'qf'].reduce(function (a, k) {
      var c = o && o[k];
      if (!c) return a;
      return a + ((c.launched && c.launched.n) || 0) + ((c.inOrbit && c.inOrbit.n) || 0);
    }, 0);
  } catch (e) { return 0; }
}
const wj = `${B}/build/wiki.json`;
if (fs.existsSync(wj)) {
  const tgt = `${B}/wiki.json`;
  let skip = false;
  if (fs.existsSync(tgt) && !process.env.CISTRACK_ALLOW_WIKI_REGRESS) {
    let a = null, b2 = null;
    try { a = JSON.parse(fs.readFileSync(wj, 'utf8')); b2 = JSON.parse(fs.readFileSync(tgt, 'utf8')); } catch (e) {}
    const na = wikiCounts(a), nb = wikiCounts(b2);
    if (a && b2 && na < nb) {
      skip = true;
      console.log('!! wiki.json **拒绝覆盖**：build/wiki.json 的计数 ' + na + ' < 现有 wiki.json 的 ' + nb +
        '（疑似 build/wiki.json 过期 —— 先跑 `node mkdata.mjs` 再构建）');
      console.log('   如确实要下调（例如词条被更正），设 CISTRACK_ALLOW_WIKI_REGRESS=1 或直接改 wiki.json 后跑 mkdata。');
    }
  }
  if (!skip) {
    fs.copyFileSync(wj, `${B}/wiki.json`);
    console.log('copied wiki.json →', fs.statSync(`${B}/wiki.json`).size, 'bytes');
  }
}

// V1.9.0（R17）：历史轨道要素库**外挂 + 按批次分片** —— 与 wiki.json 同一套路，但是一个目录。
//   规模重估后（数万~数十万颗）单个大 JSON 会撞 GitHub 100MB 硬限；分片后每个文件几十 KB，
//   页面只取选中的那一批。以后更新历史只要替换 history/ 目录，不必重新构建 HTML。
{
  const src = `${B}/build/history`, dst = `${B}/history`;
  if (fs.existsSync(src)) {
    // ★ V1.9.1：**陈旧检测**（与下面 wiki.json 的"不倒退"守卫同一类问题）。
    //   `history/` 是**已发布**的产物，而 `build/history` 是 mkdata 的产物 —— 它可能比数据源旧：
    //   "只跑 build、没跑 mkdata"（或跨机器拉过数据后）时，复制会把已发布的 `history/` **倒退**。
    //   2026-10-10 实测：CI 刚发布 gw 8154 点，本地 build/history 只有 8124 点，复制后
    //   **倒退了 30 个点、并删掉了一个分片文件**（gw-24181.json）—— 而 build 全程没有任何提示。
    //   判据用**文件的最后修改时间**而不是点数：点数在容量治理（prune）后**合法地**会变小，
    //   拿它当判据会误报；而"数据源比打包产物还新"则明确意味着**该重新打包**。
    const newestSrc = (() => {
      let mx = 0;
      for (const f of fs.readdirSync(`${B}/data/history`)) {
        if (f.endsWith('.bak')) continue;
        try { const m = fs.statSync(`${B}/data/history/${f}`).mtimeMs; if (m > mx) mx = m; } catch (e) {}
      }
      return mx;
    })();
    const packTime = (() => {
      try { return fs.statSync(`${src}/index-gw.json`).mtimeMs; } catch (e) { return Infinity; }
    })();
    if (newestSrc > packTime && !process.env.CISTRACK_ALLOW_STALE_HISTORY) {
      console.log('!! history/ **拒绝覆盖**：数据源 data/history 比打包产物 build/history 还新' +
        '（差 ' + ((newestSrc - packTime) / 60000).toFixed(1) + ' 分钟）——');
      console.log('   先跑 `node mkdata.mjs` 重新打包再构建；否则会把**已发布的 history/ 倒退**。');
      console.log('   确实要强制覆盖：设 CISTRACK_ALLOW_STALE_HISTORY=1。');
    } else {
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
    }
  } else {
    console.log('history/ 未生成（跳过复制）');
  }
}
