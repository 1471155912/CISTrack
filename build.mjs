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
    // 在同一台机器上再 spawn 一个 node.exe 去读同一份文件，Windows 上会稳定报
    // EBUSY（文件被占用），而模块内 import 不会（clean.mjs 因此导出了 scan/applyMove）。
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

// ★★ V1.9.9.630（2026-10-21 实测抓出）：**satdata 的"不倒退"守卫** —— 与下面
//   `history/`（R17）和 `wiki.json`（V1.4.0）那两道同类，但这一处此前**完全没有**。
//   事故实证：`data/satcat.csv` 停在 10-16（4.5 天）→ mkdata 的 launchCounts 少一批
//   （`26230` 低轨27组 9 颗）→ 跑 build 后产物里 `gw.launchCounts` 从 **41 批掉到 40 批**，
//   而 build 一声不吭（`build.mjs` 不跑 mkdata，只读 `build/satdata.json`；"只跑 build
//   不跑 mkdata"就会把**已发布的数据往回栽**）。
//   判据（与 history 同思路）：拿**已发布的 `CISTrack.html`** 里内嵌的 SATDATA 做对照，
//   比"批次数"和"卫星数"两个**单调量**——它们不会因合法的容量治理而变小。
//   ⚠️ 不能只看文件 mtime：mkdata 随时会重写 satdata，mtime 新不代表数据新。
const PUBLISHED = `${B}/CISTrack.html`;
function satCounts(src) {
  try {
    const m = /window\.SATDATA=(\{[\s\S]*?\});?<\/script>/.exec(src);
    if (!m) return null;
    const o = JSON.parse(m[1]);
    return {
      gwBatch: Object.keys(o.gw.launchCounts || {}).length,
      qfBatch: Object.keys(o.qf.launchCounts || {}).length,
      gwSat: (o.gw.sats || []).length,
      qfSat: (o.qf.sats || []).length,
      miss: (o.gw._countMissing || []).length + (o.qf._countMissing || []).length,
    };
  } catch (e) { return null; }
}
if (fs.existsSync(PUBLISHED) && !process.env.CISTRACK_ALLOW_SATDATA_REGRESS) {
  const prev = satCounts(fs.readFileSync(PUBLISHED, 'utf8'));
  const next = satCounts('window.SATDATA=' + data + ';</script>');
  if (prev && next) {
    const down = [];
    if (next.gwBatch < prev.gwBatch) down.push('gw 批次数 ' + prev.gwBatch + '→' + next.gwBatch);
    if (next.qfBatch < prev.qfBatch) down.push('qf 批次数 ' + prev.qfBatch + '→' + next.qfBatch);
    if (next.gwSat < prev.gwSat) down.push('gw 卫星数 ' + prev.gwSat + '→' + next.gwSat);
    if (next.qfSat < prev.qfSat) down.push('qf 卫星数 ' + prev.qfSat + '→' + next.qfSat);
    if (down.length) {
      console.error('!! satdata **拒绝写入产物**：数据比已发布的 CISTrack.html **更少** ——');
      down.forEach((d) => console.error('     · ' + d));
      console.error('   最常见原因：`data/satcat.csv` 过期（launchCounts 少批次），或"只跑 build 没跑 mkdata"。');
      console.error('   修法：`node refresh.mjs --force-cat` → `node mkdata.mjs` → 再跑 build。');
      console.error('   确实要下调数据（例如词条被更正）：设 CISTRACK_ALLOW_SATDATA_REGRESS=1。');
      process.exit(3);
    }
    if (next.miss > prev.miss) {
      console.log('⚠️ 产物含 ' + next.miss + ' 个「颗数缺失」批次（上次 ' + prev.miss + ' 个）——' +
        '真值未减少，但「发射卫星数」会偏少；跑 `refresh.mjs --force-cat` 修。');
    }
  }
}
const app = fs.readFileSync(`${B}/app.js`, 'utf8');

for (const [name, code] of [['sgp4', sgp4], ['coast', coast], ['data', data], ['app', app]]) {
  if (code.includes('</script')) { console.error('!! ' + name + ' 含有 </script，需转义'); }
}

html = html
  .replace('<!--INJECT_SGP4-->', '<script>/* satellite-js v5.0.0 · MIT · https://github.com/shashwatak/satellite-js */\n' + sgp4 + '\n</script>')
  .replace('<!--INJECT_COAST-->', '<script>' + coast + '</script>')
  .replace('<!--INJECT_DATA-->', '<script>window.SATDATA=' + data + ';</script>')
  .replace('<!--INJECT_APP-->', '<script>\n' + app + '\n</script>');

// ★ V1.9.5（H46）：产物名统一为 `CISTrack.html`（不再产出中文名的那一份）。
//   原因：中文名 `星网与千帆在轨追踪.html` 与 `CISTrack.html` 一直是**内容完全相同**的两份
//   （哈希一致），仓库里等于白占 1.46 MB，而且让读者困惑"为什么有两个一样的文件"。
//   release.mjs 仍负责写 `CISTrack_v<版本>.html` 快照。
const out = `${B}/CISTrack.html`;
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
// ★ V1.9.6：**asOf 也不许倒退**。原守卫只比"发射+在轨"计数，于是**计数相同、日期更旧**的
//   wiki.json 会被静默写回仓库根 —— 2026-10-17 实测踩到：CI 推了新统计（asOf 10-17），
//   本地 mkdata 却从一份 asOf 10-15 的输入重建，build 再把这份旧的拷回 wiki.json，
//   等于把 CI 的更新冲掉，而计数一样所以守卫完全不响。
//   口径：取 gw/qf 两者里较新的那个 asOf（ISO 日期串可直接按字典序比）；任一缺失/不可解析就不拦。
function wikiAsOf(o) {
  try {
    return ['gw', 'qf'].reduce(function (a, k) {
      var s = o && o[k] && o[k].asOf;
      return (typeof s === 'string' && s > a) ? s : a;
    }, '');
  } catch (e) { return ''; }
}
const wj = `${B}/build/wiki.json`;
if (fs.existsSync(wj)) {
  const tgt = `${B}/wiki.json`;
  let skip = false;
  // ★ V1.9.7（§23.3-d）：**必填字段校验**。
  //   原来的守卫只比"计数"和"asOf"，对**字段级残缺**完全无感 —— 一次真实风险是
  //   launched/inOrbit 里的 n 变成 undefined：计数会算成 NaN（比较恒 false）、日期还照样更新，
  //   于是守卫全绿，页面上「发射 / 在轨」直接变成空值。
  //   判据只看**页面真的会渲染的那几个字段**：gw/qf 各自的 asOf(string) + launched.n + inOrbit.n(number)。
  const wikiFieldsOk = o => {
    try {
      return ['gw', 'qf'].every(k => {
        const c = o && o[k];
        return !!c && typeof c.asOf === 'string' && !!c.asOf
          && c.launched && typeof c.launched.n === 'number' && isFinite(c.launched.n)
          && c.inOrbit && typeof c.inOrbit.n === 'number' && isFinite(c.inOrbit.n);
      });
    } catch (e) { return false; }
  };
  {
    let a0 = null;
    try { a0 = JSON.parse(fs.readFileSync(wj, 'utf8')); } catch (e) {}
    if (!wikiFieldsOk(a0)) {
      skip = true;
      console.log('!! wiki.json **拒绝覆盖**：build/wiki.json 的**必填字段不全**（需要 gw/qf 的 asOf + launched.n + inOrbit.n）。');
      console.log('   处理：先跑 `node mkdata.mjs` 重新生成；若仍如此，检查仓库根 wiki.json 是否被写坏。');
    }
  }
  if (!skip && fs.existsSync(tgt) && !process.env.CISTRACK_ALLOW_WIKI_REGRESS) {
    let a = null, b2 = null;
    try { a = JSON.parse(fs.readFileSync(wj, 'utf8')); b2 = JSON.parse(fs.readFileSync(tgt, 'utf8')); } catch (e) {}
    const na = wikiCounts(a), nb = wikiCounts(b2);
    const sa = wikiAsOf(a), sb = wikiAsOf(b2);
    if (a && b2 && na < nb) {
      skip = true;
      console.log('!! wiki.json **拒绝覆盖**：build/wiki.json 的计数 ' + na + ' < 现有 wiki.json 的 ' + nb +
        '（疑似 build/wiki.json 过期 —— 先跑 `node mkdata.mjs` 再构建）');
      console.log('   如确实要下调（例如词条被更正），设 CISTRACK_ALLOW_WIKI_REGRESS=1 或直接改 wiki.json 后跑 mkdata。');
    } else if (a && b2 && sa && sb && sa < sb) {
      // ★ V1.9.6：计数没变但日期更旧 = 同样是"用旧数据覆盖新数据"，必须一起拦
      skip = true;
      console.log('!! wiki.json **拒绝覆盖**：build/wiki.json 的 asOf ' + sa + ' **早于** 现有 wiki.json 的 ' + sb +
        '（计数相同所以旧守卫不响，但这是"拿旧统计覆盖新统计"）');
      console.log('   处理：确认 `node mkdata.mjs` 读到的 wiki.json 是不是最新的（它读仓库根那一份）；'
        + '如确实要回退日期，设 CISTRACK_ALLOW_WIKI_REGRESS=1。');
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
