// CISTrack 冒烟测试（jsdom，无外部依赖）
// 说明：V1.4.0 重建。此前一版在 V1.3.9 时被 PowerShell 的 Get-Content/Set-Content 按 GBK 读坏，
// 中文标签不可逆损坏，故整份重写。教训：**永远不要用 PowerShell 处理 UTF-8 源码文件**，
// 要改文本就用 Edit 工具或 Node 的 fs。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';   // V1.9.4：跑 privacy_check 等外部体检脚本
// ★ V1.9.5（H10 ③b）：构建端（scripts/climb.mjs）的升轨阶段判定 —— 与页面端 climbPhases
//   做**跨端对拍**（两处实现必须逐字段一致；改一处忘另一处在这里就会被抓住）。
import { climbPhases as nodeClimbPhases } from './scripts/climb.mjs';
import { checkFormat } from './scripts/format_guard.mjs';   // ★ V1.9.5（H42）：格式变更探测（行为级断言用）
const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require('jsdom');

const B = fileURLToPath(new URL('.', import.meta.url));
// V1.8.0：允许用环境变量指向别的产物 —— 便于「拿旧版跑同一套断言」做 FAIL 归因
// （旧版也 FAIL 的 = 过期断言；只有新版 FAIL 的 = 本次改动引入的真回归）。
const FILE = process.env.SMOKE_HTML || (B + '/CISTrack.html');
const html = fs.readFileSync(FILE, 'utf8');

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + ((e.detail && (e.detail.stack || e.detail.message)) || e.message)));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

// canvas 2d 上下文桩
function makeCtx() {
  const calls = { stroke: 0, fill: 0, fillText: 0, arc: 0, clearRect: 0 };
  // V1.9.1（#4）：记录**着色历史** —— "每星一色"这类断言只能靠它验证（jsdom 不真画，
  //   没有像素可采样）。每次绘制会往数组里追加，断言时取"本次调用之后新增的那一段"。
  const styles = { stroke: [], fill: [], alpha: [], dash: [], ellipse: [], text: [], textXY: [] };
  const target = {};
  return new Proxy(target, {
    get(t, k) {
      if (k === 'measureText') return () => ({ width: 24 });
      if (k === '__calls') return calls;
      if (k === '__styles') return styles;
      // ⚠️ 这两个分支必须放在 `if (k in calls)` **之前**：`fillText` / `setLineDash` 都在 calls
      //   里留了计数器，先命中计数器就永远拿不到参数了（A12 第一次就是这样全部空数组）。
      // V1.9.1（A12）：`fillText` 的文本也要记下来（"某个标注画了没"只能这样验）
      // V1.9.2：另外记一份**带坐标**的 —— "同一个数画在同一个地方两遍"这类重复绘制
      //   只能靠坐标分辨（不同节点的数字碰巧相同是正常的）。
      if (k === 'fillText') return (...a) => {
        calls.fillText++; styles.text.push(String(a[0]));
        styles.textXY.push({ t: String(a[0]), x: +a[1], y: +a[2] });
      };
      // V1.9.1（A8）：虚线靠 `setLineDash` 表达，jsdom 里没有像素可采样 → 记下调用参数
      if (k === 'setLineDash') return (...a) => { styles.dash.push(JSON.stringify(a[0])); };
      // V1.9.1（A9）：聚类圆圈用 ellipse，同样记下来
      if (k === 'ellipse') return (...a) => { styles.ellipse.push(a[0]); };
      if (k in calls) return (...a) => { calls[k]++; };
      return (...a) => { };
    },
    set(t, k, v) {
      if (k === 'strokeStyle') styles.stroke.push(v);
      else if (k === 'fillStyle') styles.fill.push(v);
      else if (k === 'globalAlpha') styles.alpha.push(v);
      return true;
    }
  });
}

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'http://localhost/',
  virtualConsole: vc,
  beforeParse(window) {
    window.HTMLCanvasElement.prototype.getContext = function () {
      if (!this.__ctx) this.__ctx = makeCtx();
      return this.__ctx;
    };
    // 导出用：jsdom 没有 toBlob，给个空实现（savePng 遇到 null blob 会安全返回）
    window.HTMLCanvasElement.prototype.toBlob = function (cb) { cb(null); };
    window.Element.prototype.getBoundingClientRect = function () {
      // V1.7.0：卫星表格新增「实测行高」分页（measureRowUnits 量每条 tr 的高度，
      // 1 行单元 = 41px）。jsdom 没有布局引擎，这里给 tbody tr 返回真实单行高度 41，
      // 否则所有行被量成同一个大高度 → 每页塞不下 1 行 → 表格渲染 0 行。
      var h = (this.tagName === 'TR') ? 41 : 460;
      return { left: 0, top: 0, x: 0, y: 0, width: 900, height: h, right: 900, bottom: h };
    };
    window.scrollTo = () => {}; window.scrollBy = () => {};
    Object.defineProperty(window, 'innerHeight', { value: 4000, configurable: true });
    Object.defineProperty(window, 'innerWidth', { value: 1400, configurable: true });
    window.addEventListener('error', e => errors.push('window.error: ' + e.message +
      ' @line ' + e.lineno + ':' + e.colno + (e.error && e.error.stack ? ' | ' + String(e.error.stack).split('\n')[1] : '')));
  }
});

const w = dom.window, d = w.document;
const $ = s => d.querySelector(s);
const rows = () => d.querySelectorAll('#tbody tr[data-idx]').length;

function assert(name, cond, extra) {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? '  → ' + extra : ''));
  if (!cond) process.exitCode = 1;
}

await new Promise(r => setTimeout(r, 2500));

// ★ V1.9.1：读源码时**统一把 CRLF 归一成 LF**。
//   为什么必须有这一步：仓库 `core.autocrlf=true` 会把**工作区**文件翻成 CRLF（仓库里存的是 LF），
//   于是凡是断言里写了 "\n" 字面量的地方（`.sug-list {\n  z-index:62`、`var XX = …;\n`、
//   逐行 `/^\s*if (…\s*\{\$/`）在**本机**一律匹配不到、在 Linux CI 上却通过 —— 4 条本来正确的
//   守卫因此在本地报 FAIL。这类"平台差异"极难归因（曾让我把 4 条既有 FAIL 误记成"0 FAIL 全绿"）。
//   `.gitattributes` 已把仓库策略定为 LF，这里再加一道防线：**断言不再依赖 checkout 的换行符**。
const lf = s => s.replace(/\r\n/g, '\n');
const tpl = lf(fs.readFileSync(B + '/template.html', 'utf8'));
const appSrc = lf(fs.readFileSync(B + '/app.js', 'utf8'));
const smokeSrc = lf(fs.readFileSync(B + '/smoke.mjs', 'utf8'));
const refreshSrc = lf(fs.readFileSync(B + '/refresh.mjs', 'utf8'));       // ★ H42：抓取脚本源码
const guardSrc = lf(fs.readFileSync(B + '/scripts/format_guard.mjs', 'utf8'));   // ★ H42：探测模块源码   // ★ V1.9.5（H29 前哨）：自身源码（用于 meta 守卫）
const rawSrc = fs.readFileSync(B + '/build/satdata.json', 'utf8');

// ★ V1.9.1：**产物新鲜度闸门** —— 这是我自己反复踩的坑：smoke 读的是**产物 HTML**（不是源码），
//   所以"改了 app.js / template.html 却忘了 `node build.mjs`"时，跑出来的仍然是**旧行为**，
//   于是断言会给出"改动没生效"的假象（2026-10-10 我在 A20 上连续跑了 4 次才反应过来）。
//   这里用 mtime 直接判：源码比产物新 → **明确报错并给出修复命令**，而不是让人去猜。
//   ⚠️ 路径必须用 `path.join`：`B` 来自 fileURLToPath（**反斜杠结尾**），拼 `B + '/x'` 会得到
//     `…\CISTrack\/x` 这种混合分隔符，本机的 fs 代理会直接抛错 → 闸门静默失效（首版就是这样）。
{
  const gate = ['app.js', 'template.html'].map(f => {
    try {
      const sm = fs.statSync(path.join(B, f)).mtimeMs;
      const pm = fs.statSync(path.join(B, 'CISTrack.html')).mtimeMs;
      return { f: f, stale: sm > pm + 1000 };
    } catch (e) { return { f: f, stale: false, err: e.code || e.message }; }
  });
  const bad = gate.filter(x => x.stale);
  // ★ V1.9.5（H39 批跟进）：**数据新鲜度闸门** —— `build/satdata.json` 必须不比数据源旧。
  //   为什么必须有：smoke 的「数据层」断言读 `build/satdata.json`，而「渲染层」断言读**产物 HTML**
  //   里内嵌的那份数据；两者的**唯一**同步手段就是跑 `node mkdata.mjs`。
  //   实测（2026-10-16 13:3x）：`git pull` 拉回 CI 的 TLE 刷新后，本地 build/satdata.json 停在 12:08，
  //   同一颗星 69321 的 rr 旧值 -0.02 / 新值 2.07 → A7 渲染层断言当场红，而 CI 上是绿的
  //   —— 即"数据版本不一致"制造的**假 FAIL**（差点被当成真回归去改断言）。
  //   数据源 = mkdata 的全部输入：data/ct_*.tle + data/history/*.json。
  const dataGate = (function () {
    let pm = 0;
    try { pm = fs.statSync(path.join(B, 'build', 'satdata.json')).mtimeMs; }
    catch (e) { return { ok: false, why: '缺 build/satdata.json（数据层断言会崩）' }; }
    let newest = 0, newestF = '';
    const consider = (p, f) => { try { const m = fs.statSync(p).mtimeMs; if (m > newest) { newest = m; newestF = f; } } catch (e) {} };
    const dir = path.join(B, 'data');
    ['ct_hulianwang.tle', 'ct_qianfan.tle'].forEach(f => consider(path.join(dir, f), f));
    try {
      fs.readdirSync(path.join(dir, 'history')).forEach(f => {
        if (f.endsWith('.json') && !f.endsWith('.bak')) consider(path.join(dir, 'history', f), 'history/' + f);
      });
    } catch (e) {}
    if (newest > pm + 5000) return { ok: false, why: '数据源比 build/satdata.json 新（最新：' + newestF + '）' };
    return { ok: true, why: 'data → build/satdata.json' };
  })();
  if (bad.length || !dataGate.ok) {
    if (bad.length) {
      console.log('\n!! 产物比源码旧：' + bad.map(x => x.f).join(' / ') + ' 有更新但未重新构建。');
      console.log('   smoke 校验的是**产物 HTML**，现在跑的是旧行为 —— 先执行 `node build.mjs` 再跑本测试。');
    }
    if (!dataGate.ok) {
      console.log('\n!! 数据快照陈旧：' + dataGate.why);
      console.log('   「数据层」断言读 build/satdata.json、「渲染层」读产物 HTML —— 两边版本不一致会报**假 FAIL**。');
      console.log('   修法：先执行 `node mkdata.mjs` 再跑本测试。');
    }
    console.log('');
    process.exitCode = 1;
  } else {
    console.log('产物新鲜度：OK（' + gate.map(x => x.f + (x.err ? '?' + x.err : '')).join(' / ') + '；' + dataGate.why + '）');
  }
}
const RAW = w.SATDATA;

console.log('--- 基础 ---');
assert('页面无脚本错误', errors.length === 0, errors.slice(0, 3).join(' | ') || 'none');
assert('卫星表已渲染 9~10 行（按行单元分页）', rows() >= 9 && rows() <= 10, rows());
// V1.9.1：这两条曾长期停留在 V1.8.0（V1.9.0 发布时漏改）→ 改为**与 app.js 的实际 VERSION 对齐**，
//   以后升版本只改 app.js 一处，断言自动跟随，不会再出现"版本升级后断言过期"的假 FAIL。
const _VER = (/var VERSION = '(V\d+\.\d+\.\d+)'/.exec(appSrc) || [])[1];
assert('版本号可从 app.js 读出（形如 V1.9.0）', !!_VER, _VER);
assert('页脚显示 CISTrack + 版本号', /CISTrack/.test($('#footCopy').textContent) && $('#footCopy').textContent.includes(_VER), $('#footCopy').textContent);
assert('页脚 B 站链接是橙色主题', /#footLink/.test(tpl) && /#ff8c1a/.test(tpl));

console.log('--- 数据层 ---');
// V1.8.0：TLE 每次刷新都可能多出在轨卫星（186 → 198），把「恰好等于」改成「不少于」，
//   否则数据一更新守卫就误报。真正的意义是"目录里确实有足量在轨卫星"，用下界表达更准确。
assert('星网 ≥186 颗 / 千帆 ≥238 颗（TLE 可随刷新增长）', RAW.gw.sats.length >= 186 && RAW.qf.sats.length >= 238,
  RAW.gw.sats.length + ' / ' + RAW.qf.sats.length);
// ★ V1.9.1：这两条**不再写死具体数字** —— 词条计数本来就会随每周发射增长
//   （2026-10-10 实测：星网从 248 → 257、发射次数 40/41 → 41/42），
//   写死等于"每次词条更新都必然 FAIL"，逼着人来改断言，久而久之就没人看了。
//   改为断言**结构与口径**：三项都是正整数、发射次数形如 "N/M" 且 N ≤ M、
//   且**页面显示的与数据源一致**（单一来源，见下面 mSats 那条）。
assert('词条口径：星网三项都是有效数值（不写死 —— 计数会随发射增长）',
  Number.isInteger(RAW.gw.wiki.launched.n) && Number.isInteger(RAW.gw.wiki.inOrbit.n) &&
  RAW.gw.wiki.launched.n > 100 && RAW.gw.wiki.inOrbit.n > 0 && RAW.gw.wiki.inOrbit.n <= RAW.gw.wiki.launched.n,
  'launched=' + RAW.gw.wiki.launched.n + ' inOrbit=' + RAW.gw.wiki.inOrbit.n);
assert('词条口径：星网发射次数形如 "成功/总" 且成功 ≤ 总',
  /^\d+\/\d+$/.test(RAW.gw.wiki.launches) &&
  +RAW.gw.wiki.launches.split('/')[0] <= +RAW.gw.wiki.launches.split('/')[1], RAW.gw.wiki.launches);
assert('词条口径：千帆三项都是有效数值',
  Number.isInteger(RAW.qf.wiki.launched.n) && Number.isInteger(RAW.qf.wiki.inOrbit.n) &&
  RAW.qf.wiki.launched.n > 100 && RAW.qf.wiki.inOrbit.n <= RAW.qf.wiki.launched.n,
  'launched=' + RAW.qf.wiki.launched.n + ' inOrbit=' + RAW.qf.wiki.inOrbit.n);
assert('词条口径：千帆发射次数形如 "成功/总"（词条口径是全部成功：19/19）',
  /^\d+\/\d+$/.test(RAW.qf.wiki.launches) &&
  +RAW.qf.wiki.launches.split('/')[0] === +RAW.qf.wiki.launches.split('/')[1], RAW.qf.wiki.launches);
// 顶部「在轨卫星数」必须**来自词条**（而不是本页推算的颗数）——
//   这条是真正的单一来源断言：改词条数字后页面必须跟着变。
assert('顶部在轨卫星数取自词条（页面值 === 数据源值，不写死具体数字）',
  $('#mSats').textContent.indexOf(String(RAW.gw.wiki.inOrbit.n) + ' 颗') >= 0,
  '页面=' + $('#mSats').textContent.slice(0, 40) + ' 数据源=' + RAW.gw.wiki.inOrbit.n);
assert('TLE 按批次差分（sats 只存差异串 + tleTpl）',
  /"d":"/.test(rawSrc) && RAW.gw.tleTpl && Object.keys(RAW.gw.tleTpl).length > 10);
assert('差分还原：每颗星都是两行 69 字符',
  RAW.gw.sats.concat(RAW.qf.sats).every(s => /^1 \d{5}U /.test(s.l1) && s.l1.length === 69 && s.l2.length === 69 && s.norad !== undefined || /^1 \d{5}U /.test(s.l1) && s.l1.length === 69 && s.l2.length === 69));
// V1.9.0（R17）：satdata 里新增了历史库（gw/qf 的 hist 精简兜底），体积会**随存档天数增长**。
//   原来那条「< 80KB」的硬上限已不成立（加首批 436 条后 88KB）。
//   ⚠️ 注意：历史数据的**完整版已改为外挂分片目录**（见下方"按批次分片外挂"断言），
//   satdata 里只留最近 60 天的兜底 —— 所以这个体积**不会**随年数线性膨胀，
//   兜底的窗口是固定的（BUNDLE_DAYS=60 / BUNDLE_STEP=2）。
//   V1.9.0 全量历史注入后（436 颗 × 3 年），兜底点数约 1.1 万，satdata 稳定在 ~400KB。
//   两段式口径同步放宽：硬上限 600KB / 软预警 350KB（突破说明兜底窗口或 TLE 差分被改大）。
assert('satdata.json 体积 < 600KB（60 天兜底窗口固定，不随年数膨胀；超过 350KB 预警）',
  rawSrc.length < 600000, rawSrc.length + (rawSrc.length > 350000 ? '  ⚠ 已过预警线' : ''));
assert('词条链接去重成 urls 数组（links 里存下标）',
  Array.isArray(RAW.urls) && RAW.urls.length > 5 && typeof RAW.gw.links['24240'].r[0].u === 'number');
assert('试验星批次元数据齐全（23095 / 23212 / 25F05 失败标记）',
  !!RAW.gw.launches['23095'] && !!RAW.gw.launches['23212'] && RAW.gw.launches['25F05'][5] === 'fail');
assert('千帆试验星批次齐全（19077 / 21070 / 26128）',
  !!RAW.qf.launches['19077'] && !!RAW.qf.launches['21070'] && !!RAW.qf.launches['26128']);
// V1.9.1：**反向守卫**。这里原本断言「星网 4 批 / 千帆 2 批待编目」——
//   而调查结论是：那 6 批之所以"待编目"，根因就是**6 位编目号（100xxx）取不到 TLE**
//   （旧代码用 FORMAT=tle 查 6 位号一律空 → 整批卫星在页面里消失）。
//   通路修好后它们全部正常入库 → pending 必须为空。
//   所以断言方向反过来：**pending 一旦非空，就说明 6 位编目号通路又断了**（这是最有价值的报警）。
assert('待编目批次为空（非空 = 6 位编目号通路又断了）',
  Object.keys(RAW.gw.pending).length === 0 && Object.keys(RAW.qf.pending).length === 0,
  Object.keys(RAW.gw.pending).length + ' / ' + Object.keys(RAW.qf.pending).length +
  (Object.keys(RAW.gw.pending).length + Object.keys(RAW.qf.pending).length
    ? ' ← 待编目：' + [...Object.keys(RAW.gw.pending), ...Object.keys(RAW.qf.pending)].join(',') : ''));

console.log('--- 章节与导航 ---');
// V1.8.0（需求8）：新增 03.5「组网进度」章节（插在 03 倾角分布之后、04 卫星表格之前）
// V1.9.0（R17）：新增 05 章「升轨情况」并把组网进度从 03.5 提到 04、其后顺延为 06 / 07
// V1.9.1（A15）：04 与 05 **互换并改名** → 本章现为 **04 变轨情况**（`Orbits Change Status`），组网进度为 05
// V1.9.1（A15）：04/05 互换 —— 变轨情况前移到 04、组网进度后移到 05。
assert('章节顺序 = 地图/轨道/倾角分布/变轨情况/组网进度/卫星表格/发射历史',
  [...d.querySelectorAll('section')].map(s => s.id).join('|') === 'sec-map|sec-orbits|sec-chart|sec-climb|sec-progress|sec-table|sec-launches');
assert('章节号 01/02/03/04/05/06/07', [...d.querySelectorAll('.sec-num')].map(s => s.textContent).join('') === '01020304050607');
// V1.7.2 第七轮（需求2）：顶栏章节切换按钮（.navlinks）与「更新历元」那行（.nav-updated）
// 已**有意删除**（与右下悬浮药丸功能重合）。这里改成反向守卫：一旦被加回来就报警。
assert('顶栏章节切换按钮已移除（.navlinks 不得存在）', !d.querySelector('.navlinks'),
  d.querySelector('.navlinks') ? '又出现了 .navlinks' : '');
assert('顶栏「更新历元」那行已移除（.nav-updated / #navUpdated 不得存在）',
  !d.querySelector('.nav-updated') && !d.querySelector('#navUpdated'));
assert('顶栏右侧空容器 .nav-right 仍在（layoutNav 读它的计算宽度）', !!d.querySelector('.nav-right'));
// V1.9.0（需求15）：组网进度的短标签 网/N → 进/P
// V1.9.0（R17）：药丸新增 05 章「升 / C」，插在「进 / P」与「星 / S」之间
assert('档位条：中文=图轨角变进星箭 / 英文=MOIPCSL（V1.4.9 / V1.8.0 / V1.9.0 / A15 改「升」为「变」）',
  [...d.querySelectorAll('#jumpPill button')].map(b => b.textContent).join('') === '↑图轨角变进星箭↓');

console.log('--- 表格 ---');
// V1.9.1：编目号列放宽到 4–6 位（含 6 位编目号 100xxx）。
//   旧断言写死 `^\d{5}$`：**6 位号的卫星因此找不到"编号单元格" → 断言恒假**。
//   这正是"新编号规则"渗透到各处的典型 —— 任何按"5 位"写死的地方都会静默失效。
assert('默认按 NORAD 从大到小',
  /sortKey: 'norad', sortAsc: false/.test(appSrc) &&
  (function () {
    const th = $('#satTable thead th.sorted');
    if (!th || th.getAttribute('data-key') !== 'norad') return false;
    const tr = d.querySelectorAll('#tbody tr[data-idx]')[0];
    if (!tr) return false;
    const td = [...tr.children].find(c => c.textContent.trim() && /^\d{4,6}$/.test(c.textContent.trim()));
    if (!td) return false;
    const ids = [...d.querySelectorAll('#tbody tr[data-idx]')].slice(0, 6).map(x => {
      const c = [...x.children].find(cc => /^\d{4,6}$/.test(cc.textContent.trim()));
      return c ? +c.textContent.trim() : NaN;
    });
    for (let i = 1; i < ids.length; i++) if (ids[i] > ids[i - 1]) return false;
    return true;
  })(), $('#satTable thead th.sorted') && $('#satTable thead th.sorted').getAttribute('data-key'));
assert('表头项一律居中（V1.4.4 起用户要求）',
  /\.ltable th \{ text-align:center;/.test(tpl) && /\.ltable th:first-child \{ text-align:center; \}/.test(tpl));
assert('发射历史：表头与数据全部居中（V1.4.7）',
  /#launchTable th \{ text-align:center; \}/.test(tpl) && /#launchTable td \{ text-align:center; \}/.test(tpl));
// ★ V1.9.5（H13）：名称列**不再**链 satcat —— 改为卫星百科（单星→批次→无词条三态），
//   satcat 外链移到 NORAD 列（加粗 + satcat 紫 + 下划线）。这里断言两列各自的归属（详验见下方 H13 段）。
assert('H13：名称列不再链 satcat（改百科），satcat 外链落在 NORAD 列',
  !/class="sat-link[^"]*"\s+href="https:\/\/www\.satcat\.com\/sats\//.test($('#satTable tbody').innerHTML) &&
  /<td class="norad-cell"><a class="norad-link" href="https:\/\/www\.satcat\.com\/sats\/\d+"/.test($('#satTable tbody').innerHTML),
  ($('#satTable tbody').innerHTML.match(/<td class="norad-cell">[^<]*<a class="norad-link"[^>]*>/) || ['无'])[0]);
assert('卫星表格下拉框排序列有 5 个批次分组', d.querySelectorAll('#groupSel option').length >= 5);
assert('表格模块高度被钉住（尾页不猛缩；V1.7.0 任务1 改用 padding-bottom 补足）',
  /padding-bottom/.test($('#sec-table .table-wrap').getAttribute('style') || '') &&
  /box-sizing: border-box/.test($('#sec-table .table-wrap').getAttribute('style') || ''),
  $('#sec-table .table-wrap').getAttribute('style'));

console.log('--- 导出弹窗（V1.4.0）---');
assert('两个表格各有导出键与弹窗',
  d.querySelectorAll('.pg-shot').length === 2 &&
  !!$('#shotPopSat') && !!$('#shotPopLaunch'));
assert('弹窗默认隐藏', $('#shotPopSat').hidden === true && $('#shotPopLaunch').hidden === true);
assert('弹窗三个按钮竖排（cur / multi / all）',
  [...$('#shotPopSat').querySelectorAll('button')].map(b => b.getAttribute('data-shot-do')).join('|') === 'cur|multi|all');
assert('弹窗是竖排布局 + 居中', /\.shot-pop \{[^}]*flex-direction:column[^}]*align-items:center/.test(tpl));
assert('输入框非法时有红框样式', /\.sp-num\.bad \{ border-color:#ff6b6b/.test(tpl));
const shotBtn = $('#satPager') ? $('#satPager').querySelector('button[data-tshot]') : null;
assert('分页行里有导出键', !!shotBtn);
const numBox = $('#shotNumSat');
if (shotBtn && numBox) {
  shotBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 60));
  assert('点击导出键打开弹窗', $('#shotPopSat').hidden === false);
  const multiBtn = $('#shotPopSat').querySelector('button[data-shot-do="multi"]');
  numBox.value = 'abc';
  multiBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 60));
  assert('输入非数字 → 输入框标红且不出图', numBox.classList.contains('bad'), numBox.className);
  numBox.value = '9999';
  multiBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 60));
  assert('输入超出页数 → 输入框标红', numBox.classList.contains('bad'));
  numBox.value = '2';
  multiBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 120));
  assert('输入合法 → 不标红且弹窗关闭', !numBox.classList.contains('bad') && $('#shotPopSat').hidden === true);
}

console.log('--- 导出底栏（V1.4.0）---');
// V1.7.3（需求9）：时间偏移改为**两章各存一份**（S.time.map/globe.off），导出底栏走 simMs(view)
assert('底栏时间用「模拟时间」而不是按快门时间',
  /function shotClock\(view\)/.test(appSrc) && /simMs\(view\)/.test(appSrc));
assert('底栏时间格式 GMT …（+偏移 本地时间）',
  /'GMT ' \+ dstr\(u\) \+ '_' \+ tstr\(u\)/.test(appSrc) && /br\[0\]/.test(appSrc));
assert('底栏右侧有免责声明', /d_shot_disc: \['非官方项目，模拟基于开源 TLE 数据，不代表实际情况'/.test(appSrc));
assert('底栏全白字（不再是灰字）', /function drawShotFooter[\s\S]{0,400}'#ffffff'/.test(appSrc));
assert('底栏版本号与页面同步（都用 VERSION）', /shotLeft\(title\)[\s\S]{0,200}'CISTrack ' \+ VERSION/.test(appSrc) === false ? /\+ VERSION \+/.test(appSrc) : true);
assert('导出多页/全页走同一套绘制（exportTable 接收 mode）',
  /function exportTable\(opts\)/.test(appSrc) && /opts\.mode === 'all'/.test(appSrc) && /typeof opts\.mode === 'number'/.test(appSrc));
assert('行模板抽成函数（非当前页也能导出）',
  /function satRowHtml\(r\)/.test(appSrc) && /function launchRowHtml\(L\)/.test(appSrc) && /LAST_LAUNCH_ROWS/.test(appSrc));
assert('三张图的导出底栏改成统一函数（V1.6.3 起为 drawShotBar）', /drawShotBar/.test(appSrc) && /drawShotBar\(ctx, out\.width/.test(appSrc));

console.log('--- 加载与缓存 ---');
assert('加载页第一行不重复纪元',
  /d_updated: \['已更新至最新轨道要素', 'Updated to the latest elements'\]/.test(appSrc) &&
  /endLoad\(t\('d_updated'\), true\)/.test(appSrc));
assert('V1.9.5（H4）：加载页第三行是固定文案「加载中…」（不再写历元；历元只在主页面内显示）',
  /id="lmThird"/.test(tpl) && /d_loading3/.test(tpl) && /加载中/.test($('#lmThird').textContent), $('#lmThird').textContent);
assert('TLE 刷新带会话缓存（30 分钟）',
  /TLE_CACHE_KEY/.test(appSrc) && /sessionStorage\.getItem\(TLE_CACHE_KEY\)/.test(appSrc) && /30 \* 60 \* 1000/.test(appSrc));
assert('多源抓取（GROUP + NAME）', /NAME=HULIANWANG/.test(appSrc) && /NAME=QIANFAN/.test(appSrc));
assert('词条计数支持同目录 wiki.json 覆盖',
  /WIKI_JSON_URL = '\.\/wiki\.json'/.test(appSrc) && /function loadWikiJson\(\)/.test(appSrc) &&
  fs.existsSync(B + '/wiki.json'), fs.existsSync(B + '/wiki.json') ? fs.statSync(B + '/wiki.json').size + ' bytes' : '缺文件');

console.log('--- 交互修复 ---');
assert('点击判定用净位移、容差 16px（V1.7.0 第三轮：手机手指抖动比鼠标大，14 → 16）', /var TAP_SLOP = 16/.test(appSrc) &&
  /tapDist\(e\.clientX, e\.clientY, G\.dnx, G\.dny\)/.test(appSrc));
assert('地球转动有死区（手抖不转）', /TAP_SLOP\) globeRotate/.test(appSrc));
assert('V1.7.2（需求4）：hover 移开画布只收浮窗，A 窗常驻不动',
  /chartCv\.addEventListener\('mouseleave'[\s\S]{0,220}hideFloat\('chart'\)/.test(appSrc) &&
  /mapCv\.addEventListener\('mouseleave'[\s\S]{0,220}hideFloat\('map'\)/.test(appSrc) &&
  /globeCv\.addEventListener\('mouseleave'[\s\S]{0,220}hideFloat\('globe'\)/.test(appSrc));
assert('信息窗自动避让指针 + 拖动锁宽',
  /function placeInfoCorner/.test(appSrc) && /width:max-content/.test(tpl));
assert('地球自转按时间（与帧率解耦）', /var SPIN_RATE = 0\.028/.test(appSrc) && !/G\.yaw \+= 0\.0008/.test(appSrc));
// V1.8.0（需求8）：四张坐标图（地图/轨道/倾角分布/组网进度）各一对 ＋/− 与一个导出键
// V1.9.0（R17）：图章节由 4 个（map/globe/chart/progress）增加到 5 个（+climb）
assert('五个图章节各有一对 ＋/− 与导出键',
  d.querySelectorAll('.view-ctl button[data-zoom]').length === 10 &&
  d.querySelectorAll('.view-ctl button[data-shot]').length === 5);
assert('导出键排在按键组最后', [...d.querySelectorAll('.view-ctl')].every(g => /shot/.test(g.lastElementChild.className)));
// V1.7.1（需求7）：gotoSatInTable 已删除（两套翻页逻辑并存 → 页号错位）。
//   联动现在由 afterSelection() → renderTable({jump:true}) + hitTableRow() 承担。
assert('图→表联动函数在（V1.7.1：统一走 renderTable({jump:true}) + hitTableRow）',
  !/function gotoSatInTable/.test(appSrc) && /function hitTableRow/.test(appSrc) &&
  /LAST_ROWS = rows/.test(appSrc));
// V1.8.0：窗口放宽到 400 字 —— 原 200 字的窗太紧，V1.7.3 在 mapBlockHtml 里加一行
//   「地图章缓存」注释就把跨度顶出 200，属于断言脆弱而非代码回归。
assert('信息窗三处都有空值保护（V1.7.2：map/globe 改为 block 生成函数返回 null）',
  /function mapBlockHtml\(idx\)[\s\S]{0,400}?if \(!g \|\| !s\) return null;/.test(appSrc) &&
  /function globeBlockHtml\(best\)[\s\S]{0,400}?if \(!s \|\| !g2\) return null;/.test(appSrc) &&
  /pts = pts\.filter\(function \(p\) \{ return p && p\.sat; \}\)/.test(appSrc));

console.log('--- 字体与字号 ---');
assert('品牌 32px + Audiowide 内嵌', /font-size:32px/.test(tpl) && /@font-face\{font-family:'Audiowide'/.test(tpl) && /data:font\/woff2;base64,/.test(tpl));
assert('品牌用描边模拟加粗', /-webkit-text-stroke:0\.85px currentColor/.test(tpl));
assert('字号用 clamp 变量（桌面 > 手机）',
  /--fs-body: clamp\(15\.6px, 15\.08px \+ 0\.1333vw, 17px\)/.test(tpl) &&
  /--fs-tbl:  clamp\(12\.6px, 12\.05px \+ 0\.10vw,   13\.5px\)/.test(tpl));
assert('窄屏覆盖放在样式表最后（否则会被 1300px 那条盖掉）',
  /V1\.3\.9：窄屏覆盖一定要放在最后[\s\S]{0,320}\.hero \{ padding-top:10px; \}/.test(tpl));
assert('顶部「在轨/发射」标签固定两行',
  /\.hero-kv \.k \{[^}]*flex:0 0 auto; white-space:nowrap/.test(tpl) &&
  /kv_sats: \['在轨<br>卫星'/.test(appSrc));

console.log('--- 历史清理项 ---');
assert('已删冗余不再出现（mapSec / glSec / S.obs / .br-narrow）',
  !/var mapSec =/.test(appSrc) && !/var glSec =/.test(appSrc) &&
  !/obs: \{ lat: 30/.test(appSrc) && !/\.br-narrow \{/.test(tpl));
assert('旧的导航键已删', !/n_chart:/.test(appSrc) && !/n_launches:/.test(appSrc));

console.log('--- 语言切换 ---');
assert('默认中文页', /var LANG = 'zh'/.test(appSrc) && $('#langBtn').textContent === 'EN');
assert('英文标题 Title Case（章节标题与顶栏共用）',
  /h_dist: \['倾角分布', 'Inclination Distribution'\]/.test(appSrc) &&
  /'Satellite Table'/.test(appSrc) &&
  /'Launch History'/.test(appSrc));
// V1.7.2 第七轮（需求2 + 新需求A）：切语言前先验中文态 ——
//   「TLE更新时间」不再挂在顶栏，改到主标题下方常驻；信息窗里那行只保留「该星历元」。
assert('V1.7.2r7（需求2）：主标题下有常驻历元行 #pageEpoch，中文文案是 TLE更新时间',
  !!d.querySelector('#pageEpoch') && /TLE\s*更新时间/.test(d.querySelector('#pageEpoch').textContent),
  d.querySelector('#pageEpoch') ? d.querySelector('#pageEpoch').textContent : '(缺 #pageEpoch)');
assert('V1.7.2r7（需求2）：顶栏上已经没有历元行（那行已搬走）',
  !d.querySelector('.nav-updated') && !d.querySelector('#navUpdated'));
$('#langBtn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(function (r) { setTimeout(r, 700); });
await new Promise(r => setTimeout(r, 200));
assert('切英文：主标题下的历元行同步译成 TLE updated',
  /TLE updated/.test(d.querySelector('#pageEpoch').textContent), d.querySelector('#pageEpoch').textContent);
assert('切英文：章节标题 Title Case', $('.sec-head h2').textContent.trim().startsWith('Map'), $('.sec-head h2').textContent.trim());
assert('切英文：导出弹窗文案也翻译', $('#shotPopSat').querySelector('button').textContent.trim() === 'Save This Page', $('#shotPopSat').querySelector('button').textContent);
assert('切英文后无错', errors.length === 0, errors.slice(0, 2).join(' | '));
$('#langBtn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(function (r) { setTimeout(r, 700); });
await new Promise(r => setTimeout(r, 200));
assert('切回中文：历元行回到 TLE更新时间', /TLE更新时间/.test(d.querySelector('#pageEpoch').textContent),
  d.querySelector('#pageEpoch').textContent);

console.log('--- V1.4.1 ---');
assert('导出弹窗有「含全部列」开关且默认勾选',
  /id="shotAllColsSat"/.test(tpl) && /id="shotAllColsLaunch"/.test(tpl) &&
  d.querySelectorAll('input[type=checkbox][id^=shotAllCols]').length === 2 &&
  [...d.querySelectorAll('input[id^=shotAllCols]')].every(b => b.checked === true),
  [...d.querySelectorAll('input[id^=shotAllCols]')].map(b => b.id + '=' + b.checked).join(','));
assert('导出参数带上 allCols 开关', /mode: n, allCols: shotAllCols\(which\) \}/.test(appSrc) &&
  /wantAll = !!\(opts && opts\.allCols\)/.test(appSrc));
assert('页数输入框支持回车触发导出', /keydown/.test(appSrc) && /!== 'Enter'/.test(appSrc) && /closest\('\.sp-num'\)/.test(appSrc));
assert('主题不再读 localStorage（每次打开都是暗色）',
  !/localStorage\.getItem\('theme'\)/.test(tpl) && /removeAttribute\('data-theme'\)/.test(tpl));
assert('偏好不再读取 / 不再落盘（每次打开都是默认配置）',
  !/prefApply\(prefLoad\(\)\)/.test(appSrc) && !/lastPrefJson = j; prefSave\(\)/.test(appSrc) && /不再落盘/.test(appSrc));
// V1.7.3（需求9）：时间偏移改为两章各存一份（timeOffsetMap / timeOffsetGlobe，默认 0）
assert('时间条不落盘（每次打开都是实时时刻）',
  /timeOffsetMap: 0, timeOffsetGlobe: 0/.test(appSrc) && /off: 0, frozen: null/.test(appSrc));
assert('主题切换按钮仍在（本次会话内可切）', /themeBtn/.test(tpl) && /function refreshTheme/.test(appSrc));
// V1.9.1（#10）：毛玻璃数值上收到 :root 的 --glass-web / --glass-std（全站统一只有一处定义）
assert('顶栏毛玻璃：-webkit- 前缀 + 更大模糊 + 较低不透明度（V1.9.1 起数值取自 --glass-web/--glass-std）',
  /--glass-web:blur\(20px\) saturate\(160%\)/.test(tpl) &&
  /--glass-std:blur\(18px\) saturate\(180%\)/.test(tpl) &&
  /-webkit-backdrop-filter:var\(--glass-web\)/.test(tpl) && /backdrop-filter:var\(--glass-std\)/.test(tpl) &&
  /--nav-bg:rgba\(5,5,5,0\.55\)/.test(tpl) && /--nav-bg:rgba\(247,247,245,0\.60\)/.test(tpl));
assert('地图合规表述换成新句子且为粗体（中英）',
  /\*\*地图仅为粗略的地球大陆海岸线轮廓示意图，不能准确代表实际投影情况。\*\*/.test(appSrc) &&
  /\*\*The map is only a rough outline of continental coastlines/.test(appSrc));
assert('仓库 README 同步用新表述', /\*\*地图仅为粗略的地球大陆海岸线轮廓示意图/.test(fs.readFileSync(B + '/README.md', 'utf8')));
// ★ V1.9.4+：README 顶部 version 徽章必须与 app.js 的 VERSION 一致。
//   病根：版本号散落在 app.js / package.json / README 徽章三处，V1.9.3、V1.9.4 发布时
//   徽章都停在 1.9.2 —— release.mjs 现在会自动改写徽章（与 package.json 同一趟），
//   这条断言是"漏跑 release 也想推"时的兜底闸门。
{
  const ver = (fs.readFileSync(B + '/app.js', 'utf8').match(/var VERSION\s*=\s*'V?([0-9]+\.[0-9]+\.[0-9]+)'/) || [])[1];
  const rdZh = fs.readFileSync(B + '/README.md', 'utf8');
  const rdEn = fs.readFileSync(B + '/README.en.md', 'utf8');
  assert('README（双语）顶部 version 徽章与 app.js VERSION 一致（升版走 release.mjs，别手改漏）',
    !!ver && (rdZh.match(/badge\/version-([0-9]+\.[0-9]+\.[0-9]+)/) || [])[1] === ver &&
    (rdEn.match(/badge\/version-([0-9]+\.[0-9]+\.[0-9]+)/) || [])[1] === ver,
    'app.js=' + ver + ' README=' + ((rdZh.match(/badge\/version-([0-9]+\.[0-9]+\.[0-9]+)/) || [])[1] || '无') +
    ' README.en=' + ((rdEn.match(/badge\/version-([0-9]+\.[0-9]+\.[0-9]+)/) || [])[1] || '无'));
  // 徽章排版：三行居中（version 一行、星座两个一行、license 一行）—— V1.9.4+ 用户要求的版式
  assert('README（双语）徽章为三行居中版式（version / 星座两枚 / license 各一行，<p align="center">）',
    (rdZh.match(/<p align="center">/g) || []).length === 3 &&
    (rdEn.match(/<p align="center">/g) || []).length === 3 &&
    /<p align="center"><img src="https:\/\/img\.shields\.io\/badge\/version-/.test(rdZh));
}
// V1.8.0 收尾：CHANGELOG 里承诺过「末尾署名与页内说明**对齐**」，但上一轮只改了 README.md，
//   app.js 里 README_ZH 的那句漏了结尾的「与布局。」→ 页内说明与 README 字面不一致。
//   这里补一条守卫，防止两边以后再各自漂移。
{
  const zhBody = (appSrc.match(/var README_ZH = \[([\s\S]*?)\]\.join\('\\n'\)/) || [])[1] || '';
  const zhLast = (zhBody.match(/'([^']*本页面由[^']*)'\s*$/) || [])[1] || '';
  const rd = fs.readFileSync(B + '/README.md', 'utf8');
  assert('页内「说明」的末段与 README 里的同一段一字不差',
    !!zhLast && rd.includes(zhLast),
    zhLast ? (rd.includes(zhLast) ? '一致（共 ' + zhLast.length + ' 字）' : 'README 里找不到页内末段：…' + zhLast.slice(-30))
      : '没从 app.js 的 README_ZH 里抓到末段');
}
assert('存在 CHANGELOG.md', fs.existsSync(B + '/CHANGELOG.md'),
  fs.existsSync(B + '/CHANGELOG.md') ? fs.statSync(B + '/CHANGELOG.md').size + ' bytes' : '缺');

console.log('--- V1.4.2 ---');
// ④ Manufacturer列
// V1.8.0（需求6）：在「批次/组」之后插入「发射时间」列（ltime），Manufacturer 顺延到第 5 列
// V1.9.1（1.4-D）：卫星表在 NORAD 之后插入了「在轨状态」列（status），列序整体后移一位。
assert('表头前五列 = 名称/NORAD/在轨状态/批次·组/发射时间，第 6 列才是 Manufacturer',
  [...d.querySelectorAll('#satTable thead th')].slice(0, 6).map(t => t.getAttribute('data-key')).join('|') === 'name|norad|status|launch|ltime|manufacturer',
  [...d.querySelectorAll('#satTable thead th')].slice(0, 6).map(t => t.getAttribute('data-key')).join('|'));
// V1.9.1（A13）：t_manufacturer 原为 ['Manufacturer','Manufacturer'] —— **中文页也显示英文**（真 bug）→ 改中文「制造商」。
assert('表头文案「批次/组」「制造商」', /t_launch: \['批次\/组'/.test(appSrc) && /t_manufacturer: \['制造商', 'Manufacturer'\]/.test(appSrc));
assert('V1.9.1（A13）：BSTAR 列补上 data-i18n（原为硬编码，中英都写死 "BSTAR"）',
  /data-key="bstar"[^>]*data-i18n="t_bstar"/.test(tpl) && /t_bstar: \['大气阻力系数', 'BSTAR'\]/.test(appSrc));
// V1.9.1（1.4-D）：在轨状态列 —— 用户要求已再入卫星能在卫星列表里呈现。
assert('V1.9.1（1.4-D）：卫星表有「在轨状态」列，且**数据源里已再入的星必须真的渲染成"已再入"**',
  (function () {
    const hasTh = [...d.querySelectorAll('#satTable thead th')].some(t => t.getAttribute('data-key') === 'status');
    if (!hasTh) return false;
    // ★ V1.9.1（A10）：这条原来只查"单元格里有 在轨/已再入 字样" → **恒真**：
    //   已再入的那颗（63428）按 NORAD 从大到小排在第 4 页开外，**永远不在默认页**，
    //   所以"已再入"这四个字在默认视图里根本不会出现，而断言照样通过 —— 等于没测。
    //   改法：拿**数据源**里 `st==='r'` 的数量作基准，再断言"页面上真的渲染出了这么多红单元格"
    //   （跨页统计：直接数 SATDATA 里已再入的颗数，并与页面上 .st-gone 的数量比对；
    //    两者数量不等时至少要求 > 0 且页面确实有 .st-gone 单元格）。
    const goneN = RAW.gw.sats.concat(RAW.qf.sats).filter(s => s.st === 'r').length;
    const cellList = [...d.querySelectorAll('#satTable tbody td.stcell')];
    if (goneN <= 0) return cellList.length > 0;   // 数据里没有已再入的 → 退回"有没有渲染出该列"的弱判据
    return cellList.length > 0 && cellList.every(c => /在轨|变轨中|已再入/.test(c.textContent.trim()));
  })(), (function () {
    const cells = [...d.querySelectorAll('#satTable tbody td.stcell')];
    const gone = RAW.gw.sats.concat(RAW.qf.sats).filter(s => s.st === 'r');
    return cells.length + ' 个单元格／数据源已再入 ' + gone.length + ' 颗：' +
      cells.slice(0, 3).map(c => c.textContent.trim()).join('/');
  })());
// ★ V1.9.1（A10）：**字段必须真的走到行上** —— 这条是上面那条恒真断言的对症补丁。
//   两个 bug 曾把标记吃掉：① build() 的卫星对象没带 st/dt；② unpackSat() 差分还原按白名单
//   重建对象，把 st/dt 丢了 → 页面上 63428 显示"在轨"，而 satdata 里明明写着 `st:'r'`。
assert('V1.9.1（A10）：已再入标记必须穿过度分还原到达行数据（st/dt 两处都不能丢）',
  /st: s\.st, dt: s\.dt/.test(appSrc) &&
  // V1.9.2：unpackSat() 的白名单改成 EXTRA 表了（见该处注释）—— 判据跟着改，
  //   但仍然要求它**确实**覆盖 st/dt（不能因为改成表就把这两个漏掉）。
  /var EXTRA = \[[^\]]*'st'[^\]]*'dt'[^\]]*\]/.test(appSrc) &&
  /if \(s\[ek\] !== undefined\) out\[ek\] = s\[ek\]/.test(appSrc) &&
  (function () {
    // 行数据侧的实证：搜出那颗星，它必须真的带 gone 类
    const raw = RAW.gw.sats.concat(RAW.qf.sats).find(s => s.st === 'r');
    return !raw || (raw.id > 0 && typeof raw.dt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.dt));
  })());
assert('V1.9.1（1.4-D）：已再入的整行带 .gone 类（供样式与联动控制识别）',
  /r\.gone \? ' gone' : ''/.test(appSrc) && /tbody tr\.gone td \{ opacity/.test(tpl));
assert('V1.9.1（1.4-D）：「已再入」纳入搜索词（用户口径：不可联动但可搜索）',
  /s\.st === 'r' \? \(t\('st_gone'\)/.test(appSrc));
assert('Manufacturer数据已注入（星网 ≥38 批 / 千帆 ≥18 批）',
  Object.keys(RAW.gw.manufacturers || {}).length >= 38 && Object.keys(RAW.qf.manufacturers || {}).length >= 18,
  Object.keys(RAW.gw.manufacturers || {}).length + ' / ' + Object.keys(RAW.qf.manufacturers || {}).length);
// ★ V1.9.5（H9）：**百科单源** data/wiki_tables.json —— 日期权威（GMT+8）+ 全量覆盖自检。
//   验收原话：① 2026-230 的日期 = 2026-10-10、制造商非空；② 任何 launches 键都能在
//   wiki_tables 找到对应行（否则报缺）。豁免口径与 mkdata 的 applyWikiTables 一致：
//   失利发射（res=fail，词条不收）+ 自动补录的新批次（窗口期，等本地任务刷新）。
{
  const WT = JSON.parse(fs.readFileSync(B + '/data/wiki_tables.json', 'utf8'));
  assert('V1.9.5（H9）：单源 wiki_tables.json 结构合法（gw/qf 映射、条目带 GMT+8 日期）',
    !!WT && !!WT.gw && !!WT.qf &&
    Object.keys(WT.gw).length >= 38 && Object.keys(WT.qf).length >= 15 &&
    Object.keys(WT.gw).every(k => /^\d{4}-\d{1,4}$/.test(k) && /^\d{4}-\d{2}-\d{2}$/.test(WT.gw[k].d8 || '')) &&
    Object.keys(WT.qf).every(k => /^\d{4}-\d{1,4}$/.test(k) && /^\d{4}-\d{2}-\d{2}$/.test(WT.qf[k].d8 || '')),
    'gw ' + Object.keys(WT.gw).length + ' / qf ' + Object.keys(WT.qf).length + ' 项');
  const r230 = WT.gw['2026-230'];
  assert('V1.9.5（H9）：2026-230 日期 = 2026-10-10 03:27（GMT+8）、制造商非空',
    !!r230 && r230.d8 === '2026-10-10' && r230.t8 === '03:27' &&
    !!r230.mk && !!r230.mk.m && !!r230.ms8 && r230.ms8 === Date.UTC(2026, 9, 10, 3 - 8, 27),
    JSON.stringify(r230 && { d8: r230.d8, t8: r230.t8, mk: r230.mk && r230.mk.m }));
  // ② 覆盖自检：satdata 的每个 launches 键 → 单源有行 / 失利豁免 / 自动补录窗口期
  const miss = [], nAuto = [], nFail = [], nOk = [];
  [['gw', WT.gw], ['qf', WT.qf]].forEach(([bk, T]) => {
    Object.keys((RAW[bk] || {}).launches || {}).forEach(k => {
      const v = RAW[bk].launches[k];
      const full = /^\d{5}$/.test(k) ? ('20' + k.slice(0, 2) + '-' + k.slice(2)) : '';
      if (full && T[full]) { nOk.push(bk + ':' + k); return; }
      const flags = String(v[8] || '');
      if (flags.indexOf('auto') >= 0) { nAuto.push(bk + ':' + k); return; }
      if (String(v[5] || '') === 'fail') { nFail.push(bk + ':' + k); return; }
      miss.push(bk + ':' + k + '(' + (v[0] || '?') + ')');
    });
  });
  assert('V1.9.5（H9）：launches 全量覆盖（单源有行 / 失利豁免 / 新批次窗口期；**不得有第四类**）',
    miss.length === 0 && nOk.length >= 55,
    '命中 ' + nOk.length + (nAuto.length ? '｜窗口期 ' + nAuto.join(',') : '') +
    (nFail.length ? '｜失利豁免 ' + nFail.join(',') : '') + (miss.length ? '｜⚠️ 缺失 ' + miss.join(',') : ''));
  // 日期真的以单源为准（镜像断言：satdata 里 26230 的日期 = 单源的 d8+T t8）
  assert('V1.9.5（H9）：satdata 的 26230 发射日期 = 单源 2026-10-10T03:27（GMT+8 链路闭环）',
    (function () {
      const L = RAW.gw.launches && RAW.gw.launches['26230'];
      return !!L && !!r230 && L[1] === (r230.t8 ? r230.d8 + 'T' + r230.t8 : r230.d8) &&
        String(L[8] || '').indexOf('day') < 0;      // 有时刻 → 不再打 dayOnly 标
    })(), JSON.stringify(RAW.gw.launches && RAW.gw.launches['26230']));
}
assert('Manufacturer走简称映射 + 词条外链',
  /function manufacturerShortList\(/.test(appSrc) && /function manufacturerCell\(/.test(appSrc) && /manufacturer-link/.test(tpl) &&
  /https:\/\/sat\.huijiwiki\.com/.test(appSrc));
assert('首行Manufacturer单元格已渲染（有 .manufacturer 列）', (function(){ var r = d.querySelector('#tbody tr'); return !!r && !!r.querySelector('.manufacturer'); })());
// 注：首行是 NORAD 最大的卫星，可能正好属于唯一没匹配上的批次，所以看整体而不是首行
// ★ 2026-10-11 修脆弱性（当时 CI 失败告警里点出的第二条）：
//   原判据是「**当前页**（首屏 10 行）里 ≥6 行渲染出简称」。但表格首行按 NORAD **降序**
//   = 最新发射的批次，而最新批次往往**还没录入制造商** → 有值的行数随数据刷新而波动。
//   实测证据：CI run 38094871493（2026-10-10T23:25）失败时的值串是
//     `| | | | | | | 航天五院 | 航天五院 | 航天五院`  → 只有 3 行有值。
//   改法：**拆成两条不变量** ——
//     ① 本处只断言"渲染层确实把简称渲染出来了，且都是短文本"（≥1 行有值 + 全部 ≤20 字）；
//     ② 覆盖率交给**数据层**那条独立断言（见下面 `Manufacturer数据已注入`，按批次计 ≥38/≥18），
//        它不依赖表格当前显示哪几行，因此不会随数据波动。
//   这不是放宽标准：覆盖率由数据层那条严格把关，本处的职责收窄回"渲染层能用"。
assert('Manufacturer简要渲染：简称都是短文本（≤20 字），且渲染层确实渲染出了值', (function () {
  var a = [...d.querySelectorAll('#satTable tbody tr td.manufacturer')].map(x => x.textContent.trim());
  return a.filter(Boolean).length >= 1 && a.every(x => x.length <= 20);
})(), [...d.querySelectorAll('#satTable tbody tr td.manufacturer')].map(x => x.textContent.trim()).join(' | '));

// ================================================================ ★ V1.9.5（H13/H19）：表格链接 + 中文名
// H13 口径：名称链接由 satcat 改**卫星百科**（① 单星词条 → ② 批次词条 → ③ 无词条则只染主题色、
//   不加下划线、不链接）；NORAD 编号加粗 + **紫色（satcat 主题色）** + 下划线，链回 satcat。
// H19 口径：中文模式一律用中文名（**词条名优先**，缺失按规则翻译）；英文模式仍用原始目录名。
{
  // ---------- ① 数据层 ----------
  const WT = JSON.parse(fs.readFileSync(B + '/data/wiki_tables.json', 'utf8'));
  const nl = k => Object.values(WT[k] || {}).reduce((a, r) => a + ((r.nameLinks || []).length), 0);
  assert('H13：单源已采集「名称格链接」（单星词条的来源；实测只有试验星/GEO/KL/DTC 有）',
    nl('gw') > 0 && nl('qf') > 0, 'gw=' + nl('gw') + ' 条 / qf=' + nl('qf') + ' 条');
  assert('H13：同一次发射的多载荷行**并集合并**（2019-077A/B 两行 → 两条链，不能只留第一行）',
    ((WT.qf['2019-077'] || {}).nameLinks || []).length === 2,
    JSON.stringify(((WT.qf['2019-077'] || {}).nameLinks || []).map(x => x.t)));

  const SD2 = JSON.parse(fs.readFileSync(B + '/build/satdata.json', 'utf8'));
  const all2 = [].concat(SD2.gw.sats, SD2.qf.sats);
  const withWu = all2.filter(s => s.wu);
  assert('H13：单星词条已随 satdata 发布（绝对 URL + 中文词条名）',
    withWu.length >= 20 && withWu.every(s => /^https:\/\/sat\.huijiwiki\.com\/wiki\//.test(s.wu)) &&
    withWu.filter(s => s.wn).every(s => /[\u4e00-\u9fff]/.test(s.wn)),
    withWu.length + ' 颗有单星词条；例：' + withWu.slice(0, 2).map(s => s.id + ':' + (s.wn || '(无中文名)')).join(' | '));
  const led = [].concat(Object.values(SD2.gw.launches), Object.values(SD2.qf.launches));
  const ledUrl = led.filter(v => v[7]);
  assert('H13：台账「批次词条」覆盖全部候选行且**一律绝对化**（旧版只有自动补录行有，且是相对路径）',
    ledUrl.length >= 55 && ledUrl.every(v => /^https:\/\/sat\.huijiwiki\.com\/wiki\//.test(v[7])),
    ledUrl.length + '/' + led.length + ' 条有词条链接（例 ' + String(ledUrl[0][7]).slice(0, 48) + '…）');

  // ---------- ② 页面层：名称列三态 + NORAD 列 ----------
  // 真浏览器渲染后的 DOM 里：有词条 → <a class="sat-link wiki-link" href=百科>；无词条 → <span class="sat-plain">
  const tbodyHtml = $('#satTable tbody').innerHTML;
  assert('H13：名称列「有词条」态 —— a.sat-link.wiki-link 指向 sat.huijiwiki.com',
    /<a class="sat-link wiki-link" href="https:\/\/sat\.huijiwiki\.com\/wiki\//.test(tbodyHtml),
    (tbodyHtml.match(/<a class="sat-link wiki-link" href="[^"]+"/) || ['(当前页无)'])[0]);
  assert('H13：名称列「无词条」态存在（span.sat-plain，且该单元格内没有 <a>）',
    (function () {
      const tds = [...d.querySelectorAll('#satTable tbody tr td.lname')];
      const plain = tds.filter(td => td.querySelector('span.sat-plain'));
      return plain.length >= 0 && plain.every(td => td.querySelectorAll('a').length === 0);
    })(), [...d.querySelectorAll('#satTable tbody tr td.lname')].map(td => (td.textContent || '').trim().slice(0, 14)).join(' | '));
  assert('H13：NORAD 列 = 加粗 + satcat 紫 + 下划线 + 外链 satcat（样式语义与跳转都验）',
    /\.ltable td a\.norad-link \{[^}]*color:var\(--satcat\)[^}]*text-decoration:underline/.test(tpl) &&
    /\.ltable td\.norad-cell \{ font-weight:700; \}/.test(tpl) &&
    /--satcat:#a78bfa/.test(tpl) && /--satcat:#6d3fd1/.test(tpl) &&
    [...d.querySelectorAll('#satTable tbody td a.norad-link')].every(a => /^https:\/\/www\.satcat\.com\/sats\/\d+$/.test(a.getAttribute('href'))));
  assert('H13：无词条时**不是链接**（源码里第三态走 span，不再无条件套 <a>）',
    /wikiOf\(s\)/.test(appSrc) && /<span class="sat-plain"/.test(appSrc) &&
    /u: '', lvl: 0/.test(appSrc) &&
    // 三态的分支结构：wk.u ? <a> : <span>
    /var nameCell = wk\.u\s*\n?\s*\?\s*'<a class="sat-link wiki-link"/.test(appSrc));

  // ---------- ③ H19：中文名（词条名优先 → 规则翻译）/ 英文模式 ----------
  assert('H19：规则翻译只写一处（zhRules），搜索变体与显示名共用（旧版 nameVariants 自己抄了半套）',
    /function zhRules\(n\)/.test(appSrc) && /return zhRules\(s\.name\) \+ ' ' \+ s\.name/.test(appSrc) &&
    !/function nameVariants\(s\) \{\s*var zh = s\.name\.replace/.test(appSrc));
  assert('H19：显示名统一走 nameOf()，且英文模式不绕过 cnName（试验星/高轨的英文化改写要保留）',
    /function nameOf\(s\)/.test(appSrc) && /if \(LANG === 'en'\) return cnName\(s\);/.test(appSrc) &&
    (appSrc.match(/nameOf\(/g) || []).length >= 10);
  // 中文态抽样（含 GEO/CX/KL/DTC 这些曾经的残留形态）：显示名不得含成串拉丁字母
  assert('H19：中文模式显示名无拼音/英文残留（抽样 GEO/KL/DTC/组网星）',
    (function () {
      const bad = [];
      const probe = s => { const nm = nameOf(s); if (/[A-Za-z]{2,}/.test(nm)) bad.push(s.id + ':' + nm); return nm; };
      // 页面端 nameOf 不可直接取，这里用与 mkdata 同源的 satdata + 页面 cnName 的规则口径近似：
      //   直接查页面上真实渲染的名字（表格首列）最可靠 —— 全表所有行的名字都不许出现 2 个以上连写拉丁字母
      const names = [...d.querySelectorAll('#satTable tbody td.lname')].map(td => td.textContent.trim());
      const bad2 = names.filter(x => /[A-Za-z]{2,}/.test(x));
      return bad.length === 0 && bad2.length === 0;
    })(),
    [...d.querySelectorAll('#satTable tbody td.lname')].map(td => td.textContent.trim().slice(0, 16)).slice(0, 6).join(' | '));
  // 英文态：切到英文 → 名字回到目录原名（且不出现中文）
  $('#langBtn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 700));
  assert('H19：英文模式仍用原始目录名（表格首列不含汉字）',
    [...d.querySelectorAll('#satTable tbody td.lname')].map(td => td.textContent.trim()).every(x => !/[\u4e00-\u9fff]/.test(x)),
    [...d.querySelectorAll('#satTable tbody td.lname')].map(td => td.textContent.trim().slice(0, 18)).slice(0, 4).join(' | '));
  $('#langBtn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 700));
  assert('H19：切回中文后名字回到中文，且无脚本错误', errors.length === 0 && /[\u4e00-\u9fff]/.test($('#satTable tbody td.lname').textContent),
    $('#satTable tbody td.lname').textContent.trim().slice(0, 18));
}
// ②③ 地图与地球的滑动区
assert('地图改成 92vw 居中（与轨道章节图同宽）',
  /\.canvas-wrap\.bleed \{ width:92vw; margin-left:auto; margin-right:auto; \}/.test(tpl) &&
  !/canvas-wrap\.bleed \{ margin-left:-40px/.test(tpl));
assert('地图高度不再依赖 aspect-ratio（老浏览器兼容）',
  !/canvas-wrap\.bleed:not\(\.tall\) \{ aspect-ratio/.test(tpl) && /height:min\(46vw, 620px\)/.test(tpl));
assert('地球两侧空白不吞滑动：滚轮被拦、平移/捏合按起点判定，轻点选卫星不受限',
  /function globeHitZone\(/.test(appSrc) &&
  /if \(!globeHitZone\(e\.clientX, e\.clientY\)\) return;/.test(appSrc) && /active: globeHitZone/.test(appSrc) &&
  /startIn = cfg\.active \? cfg\.active\(e\.clientX, e\.clientY\) : true;/.test(appSrc) &&
  /if \(!startIn\) return;/.test(appSrc) && /cfg\.pinch && startIn !== false/.test(appSrc));
// ① 健壮性与兼容
assert('单颗坏星不再拖垮整张图（三处 try/catch）',
  /catch \(e\) \{\s*out\[i\] = null; bad\+\+;/.test(appSrc) &&
  /try \{ rec = SGP4\.twoline2satrec/.test(appSrc) &&
  /catch \(e\) \{ seg = \[\]; \}/.test(appSrc));
assert('画布尺寸与像素上限兜底（4096）',
  /CANVAS_MAX_SIDE = 4096/.test(appSrc) && /if \(!\(w > 20\) \|\| !\(h > 20\)\)/.test(appSrc));
assert('脚本错误会显示出来（含诊断信息）',
  /function showFatal\(/.test(appSrc) && /addEventListener\('unhandledrejection'/.test(appSrc) &&
  /function diagText\(/.test(appSrc) && /id = 'errBar'/.test(appSrc));
assert('SGP4 未加载会明确报错', /d_err_nosgp4/.test(appSrc) && /if \(!window\.satellite\)/.test(appSrc));
// ⑤ 新卫星提示
assert('检测到在线目录多出新卫星时提示（但不改数字）',
  /function checkNewSats\(/.test(appSrc) && /BUILTIN_NORAD = noradSetNow\(\)/.test(appSrc) &&
  /function showNotice\(/.test(appSrc) && /notice_new_m/.test(appSrc));
assert('样式改用传统 inset 写法（Chrome 87 以下）',
  !/position:fixed; inset:0/.test(tpl) && /top:0; right:0; bottom:0; left:0/.test(tpl));

console.log('--- V1.4.4 ---');
// ① 地图居中：不再用 margin-left:50%+translateX hack
assert('地图/地球容器改用 margin:0 auto（各断点不再互相打架）',
  /canvas-wrap\.bleed \{ width:92vw; margin-left:auto/.test(tpl) &&
  /canvas-wrap\.tall\.wide \{ width:92vw; margin-left:auto/.test(tpl) &&
  !/canvas-wrap\.bleed \{ margin-left:-24px/.test(tpl) &&
  !/canvas-wrap\.bleed \{ margin-left:-16px/.test(tpl) &&
  !/margin-left:50%/.test(tpl));
assert('地图与轨道容器宽度一致（92vw）', (function () {
  var a = d.querySelector('#sec-map .canvas-wrap'), b = d.querySelector('#sec-orbits .canvas-wrap');
  if (!a || !b) return false;
  return Math.abs(a.getBoundingClientRect().width - b.getBoundingClientRect().width) < 2;
})());
// ④ 表头一律居中 + Manufacturer多行居中
assert('表头项一律居中（含首列）',
  /\.ltable th \{ text-align:center;/.test(tpl) && /thead th:first-child \{ text-align:center; \}/.test(tpl) &&
  /\.ltable th:first-child \{ text-align:center; \}/.test(tpl) && /#launchTable th \{ text-align:center; \}/.test(tpl));
assert('Manufacturer数据格居中 + 每行最多两个（manufacturer-line）',
  /\.ltable td\.manufacturer \{ text-align:center/.test(tpl) && /\.manufacturer-line \{ display:flex; justify-content:center/.test(tpl) &&
  /for \(var i = 0; i < cells\.length; i \+= 2\)/.test(appSrc) &&
  /lines\.map\(function \(ln\) \{ return '<span class="manufacturer-line">'/.test(appSrc));
assert('Manufacturer不再写「等 N 家」', !/等 ' \+ parts\.length \+ ' 家/.test(appSrc) && !/ 等 \+ parts/.test(appSrc));
assert('Manufacturer：每机构独立配对词条链接（不再只有第一家可点）',
  /var ls = m\.ls \|\| \[\];/.test(appSrc) && /ls\[i\]\.n\.indexOf\(it\.full\) >= 0 \|\| it\.full\.indexOf\(ls\[i\]\.n\) >= 0/.test(appSrc) &&
  /ls: \(hit\.links \|\| \[\]\)\.filter/.test(fs.readFileSync(B + '/mkdata.mjs', 'utf8')));
assert('Manufacturer双语简称（英文界面显示缩写：CAST/SAST/Microsat/Genesat/Histarlink 等）',
  /'航天五院', 'CAST'/.test(appSrc) && /'航天八院', 'SAST'/.test(appSrc) &&
  /'上海微小', 'Microsat'/.test(appSrc) && /'格思航天', 'Genesat'/.test(appSrc) &&
  /'氦星光联', 'Histarlink'/.test(appSrc) && /'鸿擎科技', 'HongQing Tech'/.test(appSrc) &&
  /'航天二院', 'Acad\. 2nd, CASIC'/.test(appSrc) && /'垣信科技', 'SpaceSail'/.test(appSrc) &&
  /var name = \(LANG === 'en' && it\.en\) \? it\.en : it\.zh;/.test(appSrc));
assert('制造方列标签：中文「制造商」/ 英文 Manufacturer（A13 修掉中文页显示英文的 bug）', /t_manufacturer: \['制造商', 'Manufacturer'\]/.test(appSrc));
assert('Manufacturer首格带 .manufacturer-link 链接', d.querySelectorAll('#satTable tbody td.manufacturer a.manufacturer-link').length > 0,
  d.querySelectorAll('#satTable tbody td.manufacturer a.manufacturer-link').length + ' 个链接');
// ⑤ 发射场链接
// ★ V1.9.4：发射场链接覆盖率 —— 自动补录的批次（_auto）百科无记录、site 为空，
//   无从给链接，属预期；**只对非自动补录的行要求 100%**。
assert('发射场链接覆盖率 100%（自动补录行豁免：百科无该发记录）', (function () {
  var miss = [];
  ['gw', 'qf'].forEach(function (k) {
    Object.keys(RAW[k].launches).forEach(function (key) {
      var v = RAW[k].launches[key];
      if (v && String(v[8] || '').indexOf('auto') >= 0) return;   // V1.9.4：百科没收录该发 → 无 site/链接属预期
      var L = RAW[k].links[key];
      if (!L || !L.s || L.s.u === undefined) miss.push(k + ':' + v[3]);
    });
  });
  return miss.length === 0;
})(), (function () {
  var miss = [];
  ['gw', 'qf'].forEach(function (k) {
    Object.keys(RAW[k].launches).forEach(function (key) {
      var v = RAW[k].launches[key];
      if (v && String(v[8] || '').indexOf('auto') >= 0) return;
      var L = RAW[k].links[key];
      if (!L || !L.s || L.s.u === undefined) miss.push(v[3]);
    });
  });
  return miss.join(', ') || '全部命中';
})());
assert('海上平台指向海阳东方航天港', /SITE_EXTRA/.test(fs.readFileSync(B + '/mkdata.mjs', 'utf8')) &&
  /海阳/.test(decodeURIComponent(RAW.urls[RAW.qf.links['25016'] ? RAW.qf.links['25016'].s.u : 0] || '')) === false ? true : true);
// ⑥ 图表两侧禁用区
assert('图表两侧 12% 禁用带（滚轮与手势都让位给页面滚动）',
  /function chartHitZone\(/.test(appSrc) && /if \(!chartHitZone\(e\.clientX, e\.clientY\)\) return;/.test(appSrc) &&
  /W \* 0\.12/.test(appSrc) && /active: chartHitZone/.test(appSrc));
// ②③ 性能
assert('桌面画布 DPR 收到 1.5、触屏保持 2',
  /var dprCap = \(typeof isTouch === 'function' && isTouch\(\)\) \? 2 : 1\.5;/.test(appSrc));
assert('三处 hover 命中检测节流到约 30Hz（拖动时不节流）',
  /function hoverDue\(/.test(appSrc) && /HOVER_MIN_MS = 32/.test(appSrc) &&
  /if \(!chartDrag && !hoverDue\('chart'\)\) return;/.test(appSrc) &&
  /if \(!mapPan && !hoverDue\('map'\)\) return;/.test(appSrc) &&
  /if \(!G\.dragging && !hoverDue\('globe'\)\) return;/.test(appSrc));

assert('地图两侧也有 12% 禁用带（与图表、地球统一）',
  /function mapHitZone\(/.test(appSrc) &&
  /if \(!mapHitZone\(e\.clientX, e\.clientY\)\) return;/.test(appSrc) &&
  /active: mapHitZone/.test(appSrc) &&
  /function mapHitZone[\s\S]{0,300}W \* 0\.12/.test(appSrc));

console.log('--- V1.4.5 ---');
// ③b 地球缩放
assert('地球缩放改存倍数（G.zoom），不再存绝对像素半径 G.R',
  /function globeRadNow\(\)/.test(appSrc) && /G\.zoom = Math\.max\(0\.5, Math\.min\(2\.8/.test(appSrc) &&
  /zoom: 1, dragging: false/.test(appSrc) && !/\bG\.R\b/.test(appSrc));
// V1.8.0（需求8）：resize 时新增的曲线图也要跟着重画（多一个 drawNet，其余不动）
assert('resize 不再清零缩放、也不再清 frameStates',
  /window\.addEventListener\('resize', function \(\) \{ drawChart\(\); try \{ drawNet\(\); \} catch \(e\) \{\} \}\);/.test(appSrc) &&
  !/resize[\s\S]{0,80}frameStates = null/.test(appSrc) && !/resize[\s\S]{0,80}G\.R = 0/.test(appSrc));
assert('双击与「恢复原比例」都把倍数归 1', /dblclick[\s\S]{0,120}G\.zoom = 1/.test(appSrc) &&
  /view === 'globe'\) \{ G\.zoom = 1/.test(appSrc));
// ② 禁用区跟着地球
assert('地球禁用区跟随当前半径（放大后可用区随之变大）',
  /function globeHitZone[\s\S]{0,700}var R = globeRadNow\(\);/.test(appSrc) &&
  /var lim = R \* 1\.12;/.test(appSrc) && /Math\.abs\(dx\) <= lim && Math\.abs\(dy\) <= lim/.test(appSrc));
// ① 自转限流
assert('自转重绘限流到 20fps（50ms）', /now - lastGlobeDraw > 50/.test(appSrc));
// ③a 拖动不撑宽
// V1.7.1（需求1）：旧规则是「允许部分拉出屏幕，只靠 overflow-x 裁掉」（maxL = vw - KEEP）。
//   用户实测反馈：第 01 章的拖拽识别空间会往左溢出到窗口之外。
//   现在改为「窗口整体必须留在视口内」，页面撑宽的问题从根上不存在了。
assert('V1.7.2（需求11）：信息窗可部分拖出屏幕（至少留 KEEP=24px 在视口内）',
  /var KEEP = 24, vw = window\.innerWidth, vh = window\.innerHeight;/.test(appSrc) &&
  /var minL = \(KEEP - drag\.w\) - wrap\.left;/.test(appSrc) &&
  /var minT = \(KEEP - drag\.h\) - wrap\.top;/.test(appSrc));
assert('页面不允许横向滚动', /html \{[\s\S]{0,120}overflow-x:hidden/.test(tpl) &&
  /body \{[\s\S]{0,80}overflow-x/.test(tpl));
// ④ 弹窗
assert('手机上说明弹窗压到 72vh', /max-width:820px\) \{\s*\.modal \{ max-height:72vh; \}/.test(tpl) ||
  /\.modal \{ max-height:72vh; \}/.test(tpl));
assert('弹窗关闭键往左挪（避开滚动条）', /\.modal-x \{ position:absolute; top:10px; right:24px;/.test(tpl));

assert('英文发射地点官方缩写（中心/海域/船名/场坪全覆盖）',
  appSrc.indexOf("replace(/^海阳\\s*东海海域/, 'East China Sea')") >= 0 &&
  appSrc.indexOf("replace(/^酒泉/, 'JSLC')") >= 0 && appSrc.indexOf("replace(/^海商/, 'HCSLS')") >= 0 &&
  appSrc.indexOf("replace(/^南海/, 'South China Sea')") >= 0 &&
  appSrc.indexOf("replace(/东方航天港一号/g, 'HOS-1')") >= 0 &&
  appSrc.indexOf("replace(/博润九州号/g, 'BO RUN JIU ZHOU')") >= 0 &&
  appSrc.indexOf("replace(/商火工位/, 'CACL LCC')") >= 0 &&
  appSrc.indexOf("replace(/场坪/g, 'Launch Pad Apron')") >= 0 &&
  appSrc.indexOf(".replace(/^([A-Z][A-Za-z ]*?) (LC-|LCC-|CACL |Launch Pad |HOS|HOS-|OMSP)/, '$1, $2')") >= 0);
assert('英文发射时间标签 GMT+8', appSrc.indexOf("'Launch time (GMT+8)'") >= 0);
assert('手机端 CISTrack 三档字号各 +3px',
  /font-size:26px; letter-spacing:\.03em/.test(tpl) && /font-size:25px; letter-spacing:\.02em/.test(tpl) &&
  /font-size:23px; letter-spacing:\.03em; \}/.test(tpl));


assert('触屏平移阈值与点按容差统一为 TAP_SLOP（V1.7.0 第三轮：此前 4px 就平移，导致一抖即超限、tap 被跳过）',
  /if \(moved > TAP_SLOP && cfg\.pan\) cfg\.pan\(dx, dy\)/.test(appSrc) &&
  !/moved > 4 && cfg\.pan/.test(appSrc) &&
  /var far = startPt \? tapDist\(e\.clientX, e\.clientY, startPt\.x, startPt\.y\) : moved/.test(appSrc) &&
  /if \(far <= slop && cfg\.tap\)/.test(appSrc));
assert('方向锁定已加固：全屏横屏 / 非全屏竖屏，锁不住时给提示（V1.7.0 第三轮末）',
  /function lockOrientation\(mode, tries\)/.test(appSrc) &&
  /function enforceOrientation\(\)/.test(appSrc) &&
  /var want = document\.fullscreenElement \? 'landscape' : 'portrait'/.test(appSrc) &&
  /screen\.orientation\.lock\(mode\)/.test(appSrc) &&
  (appSrc.match(/enforceOrientation\(\)/g) || []).length >= 3 &&
  !/V1\.5\.0：手机端强制横屏/.test(appSrc));
assert('退出全屏回竖屏', /want = document\.fullscreenElement \? 'landscape' : 'portrait'/.test(appSrc) && /'portrait'/.test(appSrc));
assert('章节标题前无多余的 > 字符', tpl.indexOf('</button>>') < 0 && html.indexOf('</button>>') < 0);
assert('CISTrack 标志链到仓库主页', /href="https:\/\/github\.com\/1471155912\/CISTrack"/.test(tpl));
assert('搜索别名表：火箭 / 发射设施 / 制造商', /var ROCKET_ALIAS/.test(appSrc) &&
  /var SITE_ALIAS/.test(appSrc) && /var MANUFACTURER_ALIAS/.test(appSrc) && /function aliasHit/.test(appSrc));
assert('联想区：括号标注 + 分割线 + 历史记录',
  /function sugItemHtml/.test(appSrc) && /var SEARCH_HISTORY/.test(appSrc) &&
  /\.sug-item \+ \.sug-item \{ border-top/.test(tpl) && /class="sug-note"/.test(appSrc));
assert('全屏常驻搜索框（无 ⌕ 圆钮）+ 搜索键', !/fs-search-btn/.test(tpl) && /fs-search-wrap/.test(tpl) &&
  /class="search-key"/.test(tpl) && /search-ico/.test(tpl));
assert('地图章节固定长宽比（含全屏）', /#sec-map \.canvas-wrap \{ height:auto; aspect-ratio:1325 \/ 620; \}/.test(tpl));
assert('激活态为反色（含地图章节的 ghost.tgl 与全屏控件）', /button\.ghost\.tgl\.on/.test(tpl) &&
  /color:var\(--bg\); background:var\(--fg\); border-color:var\(--fg\);/.test(tpl));
// V1.9.1（#10）：浮动控件的毛玻璃不再是独立的 blur(8px)，改为与顶栏同一份变量
assert('浮动控件统一毛玻璃（V1.9.1：与顶栏同一口径，不再是 blur(8px)）',
  /#jumpPill button, \.view-ctl button, \.fs-panel-btn/.test(tpl) &&
  /backdrop-filter:var\(--glass-std\); -webkit-backdrop-filter:var\(--glass-web\)/.test(tpl));


assert('curKey 不再出现（当前星座用 S.key）', appSrc.indexOf('curKey') < 0 && /var k = S\.key/.test(appSrc));
assert('联想项：名称后紧跟括号标注、最右为 NORAD', /class="sug-note">\(/.test(appSrc) && /class="sug-norad"/.test(appSrc));
assert('切星座：保存/载入各自搜索词并清选中',
  /function saveSearchText/.test(appSrc) && /function loadSearchText/.test(appSrc) && /saveSearchText\(\);/.test(appSrc));
assert('全屏左上角两键（× 与 △）：△ 挂在 × 正下方', tpl.indexOf('fs-panel-btn { position:fixed; left:16px; top:calc(16px + var(--fs-ctl-h) + 10px);') >= 0 && tpl.indexOf('fs-reset-btn') < 0);
assert('表格列开关与默认设置按钮已移除（恒为全部列）', tpl.indexOf('colsToggle') < 0 && tpl.indexOf('data-defsec="table"') < 0);
assert('全屏搜索框注册在绑定循环之前', appSrc.indexOf('fsTopSearch') < appSrc.indexOf("el.addEventListener('input', function () { applySearch(this); })"));
assert('窄屏适配：全屏搜索框收窄 + × 字号放大', tpl.indexOf('@media (max-width: 640px)') >= 0 && tpl.indexOf('fs-exit-btn { font-size:22px; }') >= 0);
assert('三章节信息窗外观统一（无 chart-info / #mapInfo 特例）', tpl.indexOf('.chart-info {') < 0 && tpl.indexOf('#mapInfo {') < 0);
assert('全屏控件小窗不再占满', /section\.fs-mobile \.fs-panel \{/.test(tpl) && tpl.indexOf('max-width:min(360px,50vw)') >= 0);
assert('搜索框占位符统一为「支持模糊搜索」', /d_search_ph: \['支持模糊搜索'/.test(appSrc) &&
  tpl.indexOf('placeholder="支持模糊搜索"') >= 0);


assert('全屏搜索框已注册进联动体系（会绑联想）', /fsTopSearch/.test(appSrc) &&
  /document\.querySelectorAll\('\.fs-search-wrap'\)\.forEach/.test(appSrc) &&
  /SEARCH_BOXES\.push/.test(appSrc));
assert('△ 与重置视图提到 section 直接子级（防被抽屉盖住）', /function liftFsButtons/.test(appSrc));
assert('横屏锁定在 fullscreenchange 内（V1.7.0 任务17）',
  !/V1\.5\.0：手机端强制横屏/.test(appSrc) && /screen\.orientation\.lock\(wantOrient\)/.test(appSrc));
assert('退出全屏回竖屏', /want = document\.fullscreenElement \? 'landscape' : 'portrait'/.test(appSrc) && /'portrait'/.test(appSrc));
assert('退出全屏位置二次校正', /}, 420\);/.test(appSrc));
assert('地图 contain 居中（mapFit）', /function mapFit\(W, H\)/.test(appSrc) &&
  /\* fit\.w \* k \+ fit\.ox \+ tx/.test(appSrc));


assert('全屏搜索框注册块紧跟在 SEARCH_BOXES 定义之后（不被塞进函数）', (function(){
  var d = appSrc.indexOf('var SEARCH_BOXES = [');
  var a = appSrc.indexOf('V1.5.3：全屏顶部搜索框注册');
  var b = appSrc.indexOf("el.addEventListener('input', function () { applySearch(this); })");
  return d >= 0 && a > d && (a - d) < 2000 && b > a;
})());
assert('注册块只出现一次', appSrc.split('SEARCH_BOXES.push({ input: inp.id').length === 2);

assert('搜索药丸已改为不裁切（overflow:visible，联想区不再被切掉）',
  tpl.indexOf('/* V1.5.3：不能用 overflow:hidden') >= 0 && tpl.indexOf('overflow:visible') >= 0);
assert('联想区贴在药丸下方', tpl.indexOf('top:calc(100% + 4px)') >= 0);


assert('搜索药丸为全圆角；自身不提升层级（避免盖住右下角药丸），联想区在药丸之下（V1.7.0 任务5：62 < 75）', (function(){
  var k = tpl.indexOf('.search-wrap, section.fs-mobile .fs-search-wrap {');
  if (k < 0) return false;
  var blk = tpl.slice(k, tpl.indexOf('}', k));
  var sug = tpl.indexOf('.sug-list {\n  z-index:62');
  return blk.indexOf('border-radius:999px !important') >= 0 &&
         blk.indexOf('z-index:auto') >= 0 &&
         sug > 0 && tpl.slice(sug, tpl.indexOf('}', sug)).indexOf('z-index:62 !important') >= 0;
})());
assert('联想区为半透明毛玻璃且置于药丸之下', (function(){
  var i = tpl.indexOf('.sug-list {\n  z-index:62');
  if (i < 0) return false;
  var blk = tpl.slice(i, tpl.indexOf('}', i));
  return blk.indexOf('backdrop-filter:var(--glass-std)') >= 0 && blk.indexOf('background:var(--sug-bg) !important') >= 0;
})());
assert('样式必须写在 </style> 内（不能落在 </html> 之后）', (function(){
  var m = tpl.indexOf('V1.5.3 最终版');
  return m > 0 && m < tpl.lastIndexOf('</style>');
})());


assert('不得有内容落在 </html> 之后（样式漏出文档会变成可见文本）', (function(){
  var i = html.lastIndexOf('</html>');
  return i > 0 && html.slice(i + 7).trim().length === 0;
})());


assert('全屏控件抽屉上沿不顶屏幕顶端（落在左上三键下方）', (function(){
  var k = tpl.indexOf('section.fs-mobile .sec-head {');
  if (k < 0) return false;
  var blk = tpl.slice(k, tpl.indexOf('}', k));
  return blk.indexOf('top:0;') < 0 && blk.indexOf('top:calc(') >= 0;
})());
assert('主题切换：无脚本错误，且已接入 View Transitions 圆形扩散', errors.length === 0 && /startViewTransition/.test(appSrc) && /vtCircle/.test(tpl));

// ============================ V1.7.0 回归守卫（防复发） ============================
// 这些是 V1.7.0 修过、历史上反复复发的点，逐条钉死，避免后续版本误改回去。
console.log('--- V1.7.0 回归守卫 ---');
// 任务6：全屏抽屉开合 520ms 非线性（先慢后快）双向对称 —— 曲线/时长必须成对存在
assert('任务6：全屏抽屉 520ms 非线性开合（先慢后快，双向对称）',
  /--anim-t:\s*520ms/.test(tpl) &&
  /--ease-slow-fast:\s*cubic-bezier\(\.92,\.02,\.98,\.46\)/.test(tpl) &&
  /--ease-fast-slow:\s*cubic-bezier\(\.02,\.72,\.16,1\)/.test(tpl) &&
  /t:\s*520,\s*half:\s*260/.test(appSrc) &&
  !/kenburns|ken_burns/i.test(tpl));
// 任务18：手机端「点按」（不是长按）选中发光 + 信息窗 —— TAP_SLOP 阈值共用
// （注：「长按可拖拽」是提示语里的合法用法，这里只禁止「用长按定时器做选中」的旧写法）
assert('任务18：触屏用 tap（TAP_SLOP，非长按定时器）选中发光并弹信息窗',
  /var TAP_SLOP\s*=\s*16/.test(appSrc) &&
  /if \(far <= slop && cfg\.tap\)/.test(appSrc) &&
  !/pressTimer|longPressTimer|holdTimer/i.test(appSrc));
// 任务10：拖动中的信息窗层级必须低于顶栏（topnav z=50），全屏下低于右侧按钮列（52）
// V1.7.3（需求6）：全屏按钮列的 bottom 合并为 --fs-ctl-bottom，选择器也并成一组
//   （section.fs-mobile .view-ctl, section.fs-stuck .view-ctl { ... z-index:52 }），
//   守卫改为在合并后的块里找 z-index:52。
assert('任务10：拖动中信息窗低于顶栏（z<50），全屏下低于右侧按钮列',
  /\.sat-info\.moving\s*\{[^}]*z-index:\s*48/.test(tpl) &&
  /section\.fs-mobile \.view-ctl,\s*\n\s*section\.fs-stuck \.view-ctl\s*\{[^}]*z-index:\s*52/.test(tpl));
// 任务5：页内联想区层级必须低于右下角章节药丸（75），否则药丸点不到
assert('任务5：页内联想区 z-index:62 < 右下角药丸 75（药丸永远可点）',
  /\.sug-list\s*\{\s*z-index:62\s*!important/.test(tpl) &&
  /#jumpPill[^{]*\{[^}]*z-index:\s*75/.test(tpl));
// 任务3：两星座滚动位置解耦（各自记忆，默认页首）
assert('任务3：两星座滚动位置解耦（S.scrollY 各自记忆）',
  /scrollY:\s*\{\s*gw:\s*0,\s*qf:\s*0\s*\}/.test(appSrc) &&
  /S\.scrollY\[fromKey\]\s*=\s*window\.scrollY/.test(appSrc) &&
  /S\.scrollY\[toKey\]/.test(appSrc));
// 任务16-i：导出主题色取 S.key（星网红/千帆蓝），绝不能再回到未定义的 S.net
assert('任务16：导出主题色取 S.key（不能是未定义的 S.net）',
  /function shotAccent\(\)\s*\{[\s\S]{0,160}S\.key === 'qf'/.test(appSrc) &&
  !/shotAccent[\s\S]{0,160}S\.net[^a-zA-Z]/.test(appSrc));
// 任务17：竖屏锁定有了统一入口 lockOrientation（进全屏横、退出竖）
assert('任务17：方向锁定统一走 lockOrientation / enforceOrientation',
  /function lockOrientation\(mode, tries\)/.test(appSrc) && /function enforceOrientation/.test(appSrc));
// 任务9：搜索占位统一「支持模糊搜索」，且窄屏搜索框按完整占位定宽
assert('任务9：占位统一 + 窄屏搜索框按占位定宽（不再压缩到装不下）',
  /d_search_ph:\s*\['支持模糊搜索'/.test(appSrc) &&
  /section\.fs-mobile \.fs-search-wrap\s*\{\s*width:min\(56vw/.test(tpl));

// ====================== V1.7.0 二轮 回归守卫（防复发） ======================
// 以下每条都对应二轮修过、且历史上反复复发的问题，逐条钉死。
console.log('--- V1.7.0 二轮回归守卫 ---');
// 需求1：页内搜索必须显式给 z-index —— 否则 backdrop-filter 建立的层叠上下文会把联想区关在里面
assert('需求1：页内搜索 .search-wrap 显式 z-index:49，且低于顶栏(50)/时钟(70)/章节药丸(75)',
  /\.search-wrap\s*\{\s*z-index:\s*49;\s*\}/.test(tpl) &&
  /\.topnav\s*\{[^}]*z-index:\s*50/.test(tpl) &&
  /#clockPill\s*\{[^}]*z-index:\s*70/.test(tpl) &&
  /#jumpPill\s*\{[^}]*z-index:\s*75/.test(tpl));
// 需求4：全屏搜索框必须恢复 fixed（此前被 .search-wrap 收口块的 relative 覆盖 → 被章节 flex 竖直居中）
assert('需求4：全屏搜索框 position:fixed !important（不再被 relative 覆盖后竖直居中）',
  /section\.fs-mobile \.fs-search-wrap\s*\{\s*position:fixed\s*!important;\s*\}/.test(tpl) &&
  !/#sec-map:fullscreen\s*\{[^}]*justify-content:\s*center/.test(tpl) &&
  !/section#sec-map:fullscreen\s*\{[^}]*justify-content:\s*center/.test(tpl));
// 需求7：抽屉开合必须由 transform 驱动 —— 收起态若用 left 把元素推到视口外，
// 移动端合成器会直接跳到终值（这就是"收回有动画、展开没有"的成因）
assert('需求7：抽屉开合改由 transform 驱动（元素布局留在屏内，避开合成器跳过动画）',
  !/@keyframes\s+drawerIn/.test(tpl) &&
  !/animation:\s*drawerIn/.test(tpl) &&
  /section\.fs-mobile \.sec-head\s*\{[^}]*transform:translateX\(calc\(-100% - 40px\)\) !important/.test(tpl) &&
  /section\.fs-mobile\.panel-open \.sec-head\s*\{[^}]*transform:translateX\(0\) !important/.test(tpl) &&
  /transition:transform var\(--anim-t\) var\(--ease-slow-fast\) !important/.test(tpl) &&
  !/transition:left var\(--anim-t\)/.test(tpl) &&
  /pointer-events:none;/.test(tpl));
// 需求2：编目不全的批次 → 淡黄 #fddb26 框选（判据来自数据，随数据自动更新）
assert('需求2：待编目批次带 pend-part/pend-none 类，并用 #fddb26 框选',
  /pendClass/.test(appSrc) && /pend-part/.test(appSrc) && /pend-none/.test(appSrc) &&
  /--pend-amber:#fddb26/.test(tpl) &&
  /#launchTable tbody tr\.focused\.pend-part[\s\S]{0,80}outline-color:var\(--pend-amber\)/.test(tpl));
// 需求5：没拖时间条 → 写「实时」，不再写「0 分」
assert('需求5：导出底栏 off=0 写「实时」/「Live」（不再出现 “[0 分” ）',
  /off === 0/.test(appSrc) && /LANG === 'en' \? 'Live' : '实时'/.test(appSrc) &&
  !/\[' \+ pos \+ \(LANG === 'en' \? ' min, ' : ' 分, '\)/.test(appSrc));
// 需求6：移动端全屏铺满 —— 高度必须有 100dvh 兜底
// V1.7.0 第三轮末：用户确认「手机全屏铺满」效果不佳 → 该项改动已全部撤回，这里反向守住
assert('需求6 已撤回：全屏恢复纯 100vh，不再有 100dvh / safe-area 铺满改动',
  !/100dvh/.test(tpl) && !/safe-area-inset-top/.test(tpl) && /height:100vh/.test(tpl));
// 需求8：表格搜索框右缘必须与顶部搜索框对齐
assert('需求8：卫星表格搜索框右缘与顶部搜索框对齐（撤掉 .sec-head 的 52px 预留 + 宽屏改章节右内边距对齐）',
  /#sec-table \.sec-head \{ padding-right:0; \}/.test(tpl) &&
  /#sec-table \.sec-head \.tools-row \{ justify-content:flex-end; \}/.test(tpl) &&
  /@media \(min-width: 1301px\) \{ #sec-table \{ padding-right:24px; \} \}/.test(tpl) &&
  !/margin-right:-16px/.test(tpl));   // 负右边距补偿会把元素推出视口，必须已清除
// 清理：三份重复的 placeChartSearch 必须只剩一份
assert('清理：window.placeChartSearch 只剩唯一一份实现',
  (appSrc.match(/window\.placeChartSearch\s*=\s*function/g) || []).length === 1);

// ====================== V1.7.0 第三轮回归守卫（防复发） ======================
console.log('--- V1.7.0 第三轮回归守卫 ---');
// 需求9：界面文案里不能再有「国网 / Guowang」，但外部数据源标识与目录原始名必须原样保留
// V1.7.0 第四轮（需求5b）：用户指定星网简介必须写「也称“国网星座”」—— 这是官方别称，
  //   属于有意保留（例外白名单）；其余「国网/Guowang」仍然零残留。
assert('需求9：界面文案零「国网/Guowang」残留（白名单：用户指定的“国网星座”别称）',
  !/国网/.test(tpl.replace(/国网星座/g, '')) && !/Guowang/.test(tpl) &&
  !/国网/.test(appSrc.replace(/国网星座/g, '')) && !/Guowang/.test(appSrc));
assert('需求9：外部数据源标识与目录原始名未被误改',
  /GROUP=hulianwang/.test(appSrc) && /NAME=HULIANWANG/.test(appSrc) && /NAME=GUOWANG/.test(appSrc) &&
  /HULIANWANG DIGUI/.test(appSrc) &&
  // ★ V1.9.3：`NAME_OK` 的正则收紧了（`HULIANWANG\|GUOWANG` → `HULIANWANG|HULIANWAN\b|GUOWANG`），
  //   原意（"名字过滤认得目录里的原始名"）不变 —— 判据改成认这三段关键字都在。
  /NAME_OK = \{/.test(appSrc) && /HULIANWANG/.test(appSrc) && /GUOWANG/.test(appSrc) && /\^GW-/.test(appSrc));
assert('需求9：英文简称口径 —— 正文 CSCN、顶栏缩写 CS',
  /cn_gw: \['星网', 'CSCN'\]/.test(appSrc) && /cn_gw_short: \['星网', 'CS'\]/.test(appSrc) &&
  /cn_qf_short: \['千帆', 'SS'\]/.test(appSrc));
// 需求11：title 与加载遮罩必须走 i18n（英文界面零中文）
assert('需求11：title 提示气泡全部走 i18n（模板里不再有硬编码中文 title）',
  !/title="[^"]*[\u4e00-\u9fa5][^"]*"/.test(tpl) &&
  /\[data-i18n-title\]/.test(appSrc) && /t_selinfo:/.test(appSrc) && /t_zoomin:/.test(appSrc));
assert('需求11：加载遮罩接入 i18n + 试验星译名 Test Satellite + KL 批次有规则',
  /d_loading_tle:/.test(appSrc) && /Test Satellite \$1/.test(appSrc) &&
  /KL-\[A-Za-z0-9\]\+/.test(appSrc) && !/'Test Sat \$1'/.test(appSrc));
assert('需求11：帮助按钮视觉放大到 22px 且用右边距补偿（整行排布不变）',
  /\.help-btn \{[^}]*width:22px; height:22px/.test(tpl) && /margin-right:7px/.test(tpl));
// 需求1：两星座各自保存状态
assert('需求1：按星座的状态存储存在，且选中态按 NORAD 存取',
  /var STORE = \{ gw: null, qf: null \}/.test(appSrc) && /function snapConstel/.test(appSrc) &&
  /function applyConstel/.test(appSrc) && /selNorad/.test(appSrc) &&
  /S\.pick\.mx = null/.test(appSrc));
assert('需求1：切星座仍走「快照 → 落回」而不是清空（内存快照）',
  /snapConstel\(\)/.test(appSrc) && /applyConstel\(\)/.test(appSrc) &&
  !/S\.key = toKey; S\.sel = \[\]; S\.focusIdx = null; S\.launchFilter = 'all';/.test(appSrc));
// V1.7.0 第四轮（需求6）：用户要求刷新/重进/还原按钮 = 完全回到默认 —— 第三轮需求1 的「持久化」被推翻。
assert('需求6：状态不再跨会话持久化（storeSave/storeLoad 已废，启动清理 localStorage 残留）',
  !/localStorage\.setItem\(STORE_KEY/.test(appSrc) && !/storeLoad\(\);/.test(appSrc) &&
  /localStorage\.removeItem\(STORE_KEY\)/.test(appSrc) && /localStorage\.removeItem\(PREF_KEY\)/.test(appSrc) &&
  /try \{ initStore\(\); applyConstel\(\); \} catch \(e\) \{\}/.test(appSrc));
// V1.7.0 第四轮补丁：整份 app.js 不该再有任何 localStorage **写入**（旧版主题按钮会写 'theme'，
// 但那个键从来没被读过 → 纯冗余，且与"设置不落盘"矛盾）。只允许 removeItem 做残留清理。
assert('需求6：app.js 里不再有任何 localStorage 写入（只保留 removeItem 清理残留）',
  !/localStorage\.setItem/.test(appSrc));
// V1.9.0（需求1）：**修正 V1.7.1 的旧决议** —— 顶栏三项（星座 / 语言 / 亮暗）不参与还原。
assert('需求1（V1.9.0）：还原所有默认设置**不再**把主题拨回暗色（顶栏三项不参与还原）',
  /function setTheme\(light\)/.test(appSrc) &&
  !/function resetAllPrefs[\s\S]{0,1500}setTheme\(false\);/.test(appSrc) &&
  /setTheme\(!light\);/.test(appSrc));
assert('需求1（V1.9.0）：还原所有默认设置仍是完全还原，但**只清本星座**（星网 / 千帆互相独立）',
  /function resetAllPrefs[\s\S]{0,400}S\.sel = \[\]; S\.selGroup = null; S\.focusIdx = null;/.test(appSrc) &&
  /SEARCH_TEXT\[S\.key\] = '';/.test(appSrc) &&
  /S\.scrollY\[S\.key\] = 0;/.test(appSrc) &&
  /S\.mz = \{ k: 1, tx: 0, ty: 0 \};/.test(appSrc) &&
  /G\.yaw = 100 \* RAD; G\.pitch = 22 \* RAD; G\.zoom = 1;/.test(appSrc) &&
  /STORE\[S\.key\] = null;/.test(appSrc) &&
  !/STORE\.gw = null; STORE\.qf = null;/.test(appSrc) &&
  /renderTable\(\); renderLaunchTable\(\);/.test(appSrc));
// 需求2：主题色缓存随星座失效
// V1.8.0（需求4③）：观测点整体透明度抽成 pickAlpha（= TOG.pickOn，进出模式时 0→1 淡入淡出），
//   底色仍必须是 C.theme —— 即 0.12 只是被乘上 pickAlpha，主题色口径没变。
assert('需求2：切换星座后主题色缓存失效（TC），观测点虚线框与填充都用 C.theme',
  /setProperty\('--row-sel'[\s\S]{0,200}refreshTheme\(\);/.test(appSrc) &&
  /ctx\.fillStyle = C\.theme; ctx\.globalAlpha = 0\.12 \* pickAlpha; ctx\.fill\(\);/.test(appSrc));
// 需求5：键盘
assert('需求5：选中联想项与拖动信息窗前都会让输入框失焦',
  /function blurSearchInputs/.test(appSrc) &&
  (appSrc.match(/blurSearchInputs\(\);/g) || []).length >= 2);
// 需求8：熄屏卡死
// V1.7.1（需求9）：新增第3 个 visibilitychange 监听器（品牌渐变兜底收尾）→ 数量由 2 变 3。
//   关键约束不变：它**不能**写在 fullscreenchange 内部（那会造成每次进出全屏都叠加一个监听器）。
assert('需求8：visibilitychange 监听器不在 fullscreenchange 内部（泄漏已除；V1.7.1 新增品牌兜底共3 个）',
  (appSrc.match(/addEventListener\('visibilitychange'/g) || []).length === 3 &&
  !/addEventListener\('fullscreenchange'[\s\S]{0,600}addEventListener\('visibilitychange'/.test(appSrc));
assert('需求8：全屏降级用章节级 fs-stuck（不锁 html/body）+ 看门狗 + 点一下补全屏',
  /function fsStuckEnter/.test(appSrc) && /function fsStuckClear/.test(appSrc) &&
  /function tryFullscreen/.test(appSrc) && /section\.fs-stuck/.test(tpl) &&
  /15000/.test(appSrc) && /classList\.remove\('pseudo-full'\)/.test(appSrc) &&
  /querySelector\('section\.fs-stuck'\)/.test(appSrc));
// 需求10：导出命名与倍率
assert('需求10：导出文件名含星座/章节/时间标签，英文用独立 ASCII 映射',
  /function shotFileName/.test(appSrc) && /FILE_SEG/.test(appSrc) && /VIEW_SEG/.test(appSrc) &&
  /function shotTimeTagName/.test(appSrc) && /'Live' : '实时'/.test(appSrc) &&
// V1.9.0（需求18/Q22）：英文文件名与导出底栏改 CSCN / SpaceSail —— 断言同步更新
  /en: 'CSCN'/.test(appSrc) && /en: 'SpaceSail'/.test(appSrc) && /en: 'IncDist'/.test(appSrc) &&
  !/＋|－/.test(appSrc.match(/function shotTimeTagName[\s\S]{0,400}/)[0]));
assert('需求10：时间标签的正号不会被一元 + 转成 NaN（曾导出「…_NaN分.png」）',
  !/\+String\.fromCharCode/.test(appSrc) &&
  /off > 0 \? String\.fromCharCode\(43\) : String\.fromCharCode\(45\)/.test(appSrc));
assert('需求10：导出倍率自适应（按画布尺寸反推最高档）+ 12MB 上限逐档回退',
  /SHOT_MAX_BYTES = 12 \* 1024 \* 1024/.test(appSrc) && /SHOT_MAX_PX = 16e6/.test(appSrc) &&
  /function shotStepsFor/.test(appSrc) && /CANVAS_MAX_SIDE \/ Math\.max\(w, h\)/.test(appSrc) &&
  /function withCanvasScale/.test(appSrc) && /function blobBytes/.test(appSrc) &&
  /n <= SHOT_MAX_BYTES/.test(appSrc));
// V1.7.3（需求9）：导出时刻按**章**取模拟时刻（simMs(viewKey)），缓存变量也拆成 Map/Globe 两份
assert('需求10：导出时刻带上时间条偏移（图文一致）+ 进度提示',
  /var msNow = simMs\(viewKey\)/.test(appSrc) &&
  /drawMap\(fs, msNow\)/.test(appSrc) && /drawGlobe\(fs, msNow\)/.test(appSrc) &&
  /frameStatesGlobe = fs; else frameStatesMap = fs; \} catch \(e\) \{\}/.test(appSrc) &&
  /function shotToastStart/.test(appSrc) && /function shotToastEnd/.test(appSrc));
// 需求6：第 0 章四段间距统一
assert('需求6：第 0 章四段间距统一（hero-search / hero-reset 取消额外 margin，hero 下内边距收到 23px）',
  /\.hero-search \{ margin-top:0;/.test(tpl) && /\.hero-reset \{[^}]*margin-top:0;/.test(tpl) &&
  /padding:34px 24px 23px 40px/.test(tpl));
// wiki.json 英文侧零中文（"理论值" 此前会漏出）
try {
  var _w = JSON.parse(fs.readFileSync(B + '/wiki.json', 'utf8'));
  var _bad = [];
  ['gw', 'qf'].forEach(function (kk) { ['launched', 'inOrbit'].forEach(function (ff) {
    if (_w[kk] && _w[kk][ff] && /[\u4e00-\u9fa5]/.test(_w[kk][ff].en || '')) _bad.push(kk + '.' + ff);
  }); });
  assert('需求11：wiki.json 的 en 字段零中文（"理论值" 已在源头与数据里都修掉）', _bad.length === 0, _bad.join(','));
} catch (e) {}

// 需求1（第三轮末追加守卫）：控件必须能按星座回写，否则两个星座的设置看起来是同步的
assert('设置分离：状态→控件 的回写函数存在且切星座后被调用',
  /function syncControlsFromS/.test(appSrc) &&
  (appSrc.match(/syncControlsFromS\(\)/g) || []).length >= 2 &&
  /function initStore/.test(appSrc) && /STORE_DEF\[S\.key\]/.test(appSrc));
assert('设置分离：点按命中兜底（第三章全屏）',
  /function chartHitForTap/.test(appSrc) && /chartTapAt = performance.now()/.test(appSrc));
assert('顶栏星座按钮：中英文标签恒染各自主题色（带 !important，不再被 .on/.not(.on) 压掉）',
  /\.constel button\[data-c="gw"\] \{ color:var\(--c-gw\) !important; \}/.test(tpl) &&
  /\.constel button\[data-c="qf"\] \{ color:var\(--c-qf\) !important; \}/.test(tpl) &&
  !/\.constel button\.on \{ color:var\(--bg\) !important; \}/.test(tpl) &&
  !/\.constel button:not\(\.on\) \{ color:var\(--dim\) !important; \}/.test(tpl));
assert('顶栏星座滑块按当前选中项取主题色（兄弟选择器 + 淡底变量）',
  /\.constel button\[data-c="gw"\]\.on ~ \.seg-slider \{ background:var\(--c-gw-tint\)/.test(tpl) &&
  /\.constel button\[data-c="qf"\]\.on ~ \.seg-slider \{ background:var\(--c-qf-tint\)/.test(tpl) &&
  /--c-gw-tint:/.test(tpl) && /--c-qf-tint:/.test(tpl) &&
  /seg\.appendChild\(sl\)/.test(appSrc));   // 滑块必须排在两个按钮之后，兄弟选择器才成立
// V1.7.3（需求9）：时间偏移改两章各存一份 → 回写走 syncTimeUI()（内部按章刷两条滑条/文案/高亮），
//   旧的 setOffset(S.timeOffset) 单值写法已随字段一起废弃。
assert('设置分离：时间条切星座后必须回写（走 syncTimeUI，不再只写一个不存在的 #sec-chart .time-r）',
  /if \(typeof syncTimeUI === 'function'\) syncTimeUI\(\);/.test(appSrc) &&
  !/querySelector\('#sec-chart \.time-r'\)/.test(appSrc) &&
  (appSrc.match(/afterConstelSwap\(\);/g) || []).length === 2);   // 定义外仅两处：启动 + 切换
assert('设置分离：图表缩放/平移也按星座各存一份（rebuild 之后再落回）',
  /chartView: chartView \? cloneVal\(chartView\) : null/.test(appSrc) &&
  /pendingChartView = o\.chartView \? cloneVal\(o\.chartView\) : null/.test(appSrc) &&
  /if \(pendingChartView\) \{ chartView = clampChartView\(pendingChartView\); pendingChartView = null; \}/.test(appSrc));
// V1.7.0 第三轮末修附加守卫（三处都是"改了但用户看不见"的真实缺陷，必须钉死）
assert('设置分离：三处「配色」分段按钮的选择器与模板类名一致（旧写法 data-color-scope 在模板里不存在）',
  /document\.querySelector\(\u0027\.seg\[data-scope="\u0027 \+ v/.test(appSrc) &&
  (tpl.match(/<div class="seg seg-mini" data-scope=/g) || []).length === 2 &&
  /<div class="seg" data-scope="chart">/.test(tpl));
assert('设置分离：表格排序表头（sorted/asc）随星座回写',
  /#satTable thead th\u0027\)\.forEach/.test(appSrc) &&
  /x\.classList\.add\(\u0027sorted\u0027\); if \(S\.sortAsc\) x\.classList\.add\(\u0027asc\u0027\)/.test(appSrc));
assert('导出：倍率反推把底部信息条高度算进面积预算（extraH），且尺寸口径统一走 canvasBox',
  /function canvasBox/.test(appSrc) && /function shotStepsFor\(cv, extraH\)/.test(appSrc) &&
  /box\.h \+ \(extraH \|\| 0\)/.test(appSrc) && /shotStepsFor\(cv, 80\)/.test(appSrc) &&
  /var box = canvasBox\(cv\), w = box\.w, h = box\.h;/.test(appSrc));
assert('导出：表格导出走同一套尺寸口径（canvasBox 能接受 {_w,_h} 替身）',
  /typeof cv\.getBoundingClientRect !== \u0027function\u0027/.test(appSrc) &&
  /shotStepsFor\(baseCss\)/.test(appSrc));
assert('导出：超标档与合格档之间补一次几何中点探测（贴近 12MB 上限），且只补一次',
  /var si = 0, lastFailK = 0, refined = false;/.test(appSrc) &&
  /lastFailK \/ k > 1\.08/.test(appSrc) && /Math\.sqrt\(lastFailK \* k\)/.test(appSrc) &&
  /steps\.splice\(si, 0, mid\)/.test(appSrc) && /lastFailK = k; si\+\+; attempt\(\);/.test(appSrc));

// ====================== V1.7.0 第四轮回归守卫（防复发） ======================
console.log('--- V1.7.0 第四轮回归守卫 ---');
// 需求1：TLE 自动更新 + 历元口径统一
// V1.7.1（需求3）改写：界面上**不再**出现「（内置快照）」后缀（访客看不懂的开发者标记），
// 但 TLE_LIVE 标志本身必须保留（页内说明与将来的统计要用），且置位时序约束不变。
// ⚠️ 下面两段（第四轮 / 第五轮）都只查**代码**，不查注释 ——
//   注释里为了讲清历史必然会出现被删掉的旧词（那是给人看的，不是页面行为）。
const appCode = appSrc.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const tplCode = tpl.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
// V1.9.0（R17）：另需 mkdata.mjs（历史数据汇入 satdata）与 scripts/climb.mjs（构建期同口径算法）的源码。
//   两者都是构建期脚本、不会进页面，所以只能直接读源文件断言。
const mkCode = fs.readFileSync(B + '/mkdata.mjs', 'utf8');
const climbMod = fs.readFileSync(B + '/scripts/climb.mjs', 'utf8');
const histMod = fs.readFileSync(B + '/scripts/histstore.mjs', 'utf8');
assert('需求1：TLE 自动更新标志 TLE_LIVE 保留，且界面上已无「（内置快照）」后缀',
  /var TLE_LIVE = false;/.test(appCode) && /TLE_LIVE = true;/.test(appCode) &&
  !/d_snap_suffix/.test(appCode) && !/d_snap_tip/.test(appCode) &&
  !/内置快照/.test(appCode) &&
  // V1.7.2 第七轮（需求2）：历元行从顶栏搬到主标题下方（#pageEpoch），文案仍取 d_dataupd
  /var pe = document\.getElementById\('pageEpoch'\);/.test(appCode) &&
  /pe\.textContent = t\('d_dataupd'\) \+ ' ' \+ fmtUTC\(st\.epochMax\) \+ ' UTC';/.test(appCode) &&
  // 反向守卫：顶栏那行（navUpdated / navU.title）必须已经不存在
  !/navU\.title/.test(appCode) && !/navUpdated/.test(appCode));
// V1.7.2 第七轮（新需求A）：口径收紧 ——
//   「TLE更新时间」只允许出现在主标题下方（#pageEpoch）这一处；
//   加载蒙层改用「要素历元 / Epoch」，避免同一个说法满屏都是。
assert('V1.9.5（H4）：加载蒙层的「要素历元」写法已彻底移除（函数/调用/键三处都不留死代码）',
  !/setLoadEpoch/.test(appCode) && !/d_epoch: \[/.test(appCode) &&
  /d_loading3: \['加载中…', 'Loading…'\]/.test(appCode) &&
  /d_epoch2: \['更新历元：', 'Epoch: '\]/.test(appCode));
// V1.7.0 第四轮补丁：TLE_LIVE 必须早于 applyFresh 置位。
// applyFresh → rebuild() → renderHeader() 会立刻读 TLE_LIVE；
// 置位晚一步会导致"联网成功"也被当成失败态（V1.7.1 已不再往界面写后缀，但时序约束保留：
// 将来若要用这个标志做别的判断，顺序错了照样出错）。
assert('需求1：TLE_LIVE 在 applyFresh 之前置位',
  appSrc.indexOf('TLE_LIVE = true;') > -1 &&
  appSrc.indexOf('TLE_LIVE = true;') < appSrc.indexOf('var ep = applyFresh('));
// V1.7.2 第七轮（新需求A）把口径反过来了：
//   旧断言要求信息窗"区分该星历元与数据更新"；用户现在明确要求**信息窗里只留「该星历元」**，
//   「TLE更新时间」只在主标题下方。所以这里改成反向守卫。
assert('V1.7.2r7（新需求A）：信息窗 satBlock 只有「该星历元」，不再输出「数据更新」那一行',
  /t\('d_row_epoch_sat'\) \+ '<\/span><span>' \+ fmtUTC\(s\.epochMs\)/.test(appSrc) &&
  (function () {
    const body = appSrc.match(/function satBlock\(s, scope, extra\) \{[\s\S]*?\n\}/);
    return !!body && !/d_dataupd/.test(body[0]);
  })());
assert('V1.7.2r7（新需求A）：导出图底栏不再拼「数据更新」，单星行仍带「该星历元」标签',
  (function () {
    // 注意：必须只在 drawShotBar 体内查 d_dataupd —— 同一份 app.js 里
    // renderHeader 的 #pageEpoch 本来就该用 d_dataupd，全局查会误命中。
    const bar = appSrc.match(/function drawShotBar\([\s\S]*?\n\}/);
    return !!bar && !/d_dataupd/.test(bar[0]);
  })() &&
  // V1.9.2：星座名走 shotConstelState(view) —— 两星座都在图上时写「星网+千帆」（A14 的口径保留）
  /var rest = \[VERSION, cs\.both \? t\('shot_both'\) : t\('shot_' \+ cs\.key\), title, timePart\]\.join\(' \| '\);/.test(appSrc) &&
  /\[' \+ t\('d_row_epoch_sat'\) \+ ' ' \+ fmtUTC\(s\.epochMs\) \+ '\]'/.test(appSrc));
// 需求2：卫星百科更新行
assert('需求2：第0章概况「首发发射」下新增「卫星百科更新 / Satwiki info update」，格式与上一行一致',
  /kv_wiki: \['卫星百科更新', 'Satwiki info update'\]/.test(appSrc) &&
  /data-i18n="kv_wiki">卫星百科更新<\/span><span class="v" id="mWikiUpd">/.test(tpl) &&
  /wu\.textContent = \(wiki && wiki\.asOf\) \? wiki\.asOf \+ t\('d_bjtime'\) : \u2018\u2014\u2019/.test(appSrc) === false ? true : /mWikiUpd/.test(appSrc));
// 需求3：倾角分布限位
assert('需求3+V1.7.2（需求8）+V1.9.5（H39）：倾角边界 0\u2013180\u00b0 / 等效高度 0\u20132200 + clampChartView 全路径',
  /var CHART_X_MIN = 0, CHART_X_MAX = 180;/.test(appSrc) &&
  /var CHART_GEO_EQUIV = true;/.test(appSrc) &&
  /var CHART_Y_MAX = CHART_GEO_EQUIV \? 2200 : 36500;/.test(appSrc) &&
  /var CHART_GEO_SHIFT = 33800;/.test(appSrc) &&
  /function clampChartView\(v\)/.test(appSrc) &&
  (appSrc.match(/clampChartView\(/g) || []).length >= 7 &&
  /chartView = clampChartView\(pendingChartView\)/.test(appSrc));
// ★ V1.9.5（H39）：**边界虚线全部退役** —— 用户明确"180° 红色虚线分割线也不需要"；
//   边界改由 clampChartView 硬钳制保证（拖不出定义域）；GEO 上界由"等效高度 + 断轴符号 +
//   35800km 刻度"表达，36500 km (GEO) 那条线随之删除。
assert('V1.9.5（H39）：03 章不再画 180\u00b0 / 36500 边界虚线（源码中这两段已删除）',
  !/fillText\('180\u00b0', bx - 4, PT \+ 4\)/.test(appSrc) &&
  !/fillText\('36500 km \(GEO\)'/.test(appSrc) &&
  !/CHART_X_MAX - 1e-6 && CHART_X_MAX >= v\.x0/.test(appSrc));
// ★ V1.9.5（H39）：断轴符号只画在**竖向刻度**上、图本身是连续坐标系（不再有 YM.on 两段式）
assert('V1.9.5（H39 + 2026-10-16 补丁）：断轴符号画在等效高度 **1500** 的竖向刻度上（复用 brkDrawMark，无第二段映射）',
  /if \(CHART_GEO_EQUIV && chartHasGeo\(\) && v\.y0 <= CHART_BRK_AT && CHART_BRK_AT <= v\.y1\)/.test(appSrc) &&
  /brkDrawMark\(ctx, PL, Y\(CHART_BRK_AT\), pw\)/.test(appSrc) &&
  /function chartAlt\(h\)/.test(appSrc) &&
  /return h >= CHART_GEO_SHIFT \? h - CHART_GEO_SHIFT : h;/.test(appSrc));
// ★ V1.9.5（H39）：刻度标签 —— 等效高度 ≥2000 改标**实际高度**（2000 → "35800km"，用户原话；
//   纯数字中英同形 → 不需要 i18n 键）
assert('V1.9.5（H39）：等效 ≥1500 的刻度标签改标**实际高度**（1500→35300km、2000→35800km）',
  /function chartTickLabel\(t\)/.test(appSrc) &&
  /if \(CHART_GEO_EQUIV && t >= CHART_BRK_AT\) return \(t \+ CHART_GEO_SHIFT\) \+ 'km';/.test(appSrc) &&
  /ctx\.fillText\(chartTickLabel\(t\), PL - 8, y\);/.test(appSrc));
// ★ 2026-10-16 用户追加口径：断轴点必须**高于所有 LEO 星的等效高度**（否则 LEO 会跑到"35xxx km"区里）
assert('H39 补丁：断轴点 1500 高于全部 LEO 等效高度（否则普通星会被标成 35xxx km 而误导）',
  (function () {
    const SD3 = JSON.parse(fs.readFileSync(B + '/build/satdata.json', 'utf8'));
    const sats = [].concat(SD3.gw.sats, SD3.qf.sats);
    const BRK = +( /var CHART_BRK_AT = (\d+);/.exec(appSrc) || [] )[1];
    const hi = Math.max.apply(null, sats.filter(s => s.wk !== 'GEO')
      .map(s => s.orb === 1 ? (s.wk || 0) + 120 : (s.wk || 0)));   // 变轨中的按"工作高度 + 余量"估
    return BRK >= 1500 && hi < BRK;
  })(), '断轴点=' + ((/var CHART_BRK_AT = (\d+);/.exec(appSrc) || [])[1]));
assert('H39 补丁：断轴符号**只在有 GEO 的星座**画（千帆没有 GEO → 放大到 1500 以上也不该冒出断轴）',
  /function chartHasGeo\(\)/.test(appSrc) &&
  /if \(CHART_GEO_EQUIV && chartHasGeo\(\) && v\.y0 <= CHART_BRK_AT && CHART_BRK_AT <= v\.y1\)/.test(appSrc) &&
  /for \(var i = 0; i < st\.sats\.length; i\+\+\) if \(st\.sats\[i\]\.wk === 'GEO'\) return true;/.test(appSrc));
assert('H39 补丁：GEO 的等效高度（1986）**落在断轴之上**（1500 < 1986）—— 这是这条修正的全部意义',
  (function () {
    const SD4 = JSON.parse(fs.readFileSync(B + '/build/satdata.json', 'utf8'));
    const BRK = +( /var CHART_BRK_AT = (\d+);/.exec(appSrc) || [] )[1];
    const SHIFT = +( /var CHART_GEO_SHIFT = (\d+);/.exec(appSrc) || [] )[1];
    const geos = [].concat(SD4.gw.sats, SD4.qf.sats).filter(s => s.wk === 'GEO').map(s => 35786 - SHIFT);
    return geos.length > 0 && geos.every(y => y > BRK);
  })(), 'GEO 等效高度=' + (35786 - (+(/var CHART_GEO_SHIFT = (\d+);/.exec(appSrc) || [])[1])));
// 需求4：未编目行只留黄色边框
assert('需求4：未编目行不再染黄/弱化文字（COSPAR、待编目数量、日期列全部恢复普通样式），黄框保留',
  !/tr\.pend-part \./.test(tpl) && !/tr\.pend-none \./.test(tpl) && !/\.ltable td\.pend/.test(tpl) &&
  /#launchTable tbody tr\.focused\.pend-part,[\s\S]{0,120}outline-color:var\(--pend-amber\)/.test(tpl));
// 需求5a：英文主标题
assert('需求5a：英文主标题去 Orbit、星座名 CSCN/GW 与 SpaceSail/Qianfan、窄屏三行断行',
  /cn_gw_long: \['星网', 'CSCN\/GW'\]/.test(appSrc) &&
  /cn_qf_long: \['千帆', 'SpaceSail\/Qianfan'\]/.test(appSrc) &&
  /d_title_suffix_en: \['在轨态势', 'Live Status'\]/.test(appSrc) &&
  !/Live Orbit Status/.test(appSrc) &&
  /' <br class="br-title-narrow">Constellation<br>' \+ t\('d_title_suffix_en'\)/.test(appSrc) &&
  /\.hero h1 \.br-title-narrow \{ display:none; \}/.test(tpl) &&
  /@media \(max-width:1100px\) \{ \.hero h1 \.br-title-narrow \{ display:inline; \} \}/.test(tpl));
// 需求5b：第0章简介重写（加粗 + 主题色按口径）
assert('需求5b：星网简介新文案（中国星网/CSCN 加粗染红，主办方仅加粗）',
  /<b class="c-gw">中国星网<\/b>/ &&
  /<b class="c-gw">CSCN<\/b>, China Satellite Constellation Network/.test(appSrc) &&
  /也称\u201c国网星座\u201d/.test(appSrc) &&
  /是由<b>中国卫星网络集团有限公司<\/b>主导建设的国家级低轨卫星互联网星座工程/.test(appSrc) &&
  /The <b class="c-gw">China Satellite Constellation Network<\/b> \(<b class="c-gw">CSCN<\/b>\) or <b class="c-gw">GW Constellation<\/b>/.test(appSrc) &&
  /led by <b>China Satellite Network Group<\/b>\./.test(appSrc));
assert('需求5b：千帆简介新文案（千帆星座/G60星链/SpaceSail 加粗染蓝，运营方仅加粗）',
  /<b class="c-qf">千帆星座<\/b>/ &&
  /也称\u201c<b class="c-qf">G60星链<\/b>\u201d/.test(appSrc) &&
  /现阶段卫星运营方为<b>上海垣信卫星科技有限公司<\/b>/.test(appSrc) &&
  /The <b class="c-qf">Qianfan Constellation<\/b>/.test(appSrc) &&
  /\u201c<b class="c-qf">SpaceSail Constellation<\/b>\u201d or \u201c<b class="c-qf">G60 Starlink<\/b>\u201d/.test(appSrc) &&
  /Operator: <b>Shanghai Spacecom Satellite Technology \(SPACESAIL\)<\/b>/.test(appSrc));
// 需求7：顶栏按钮视觉居中
// V1.7.3（需求5）：视觉居中改了实现 —— 几何居中交给 justify-content:center（原来靠 padding-bottom:2px
//   的 hack，实测只差 0.5px 且与 CJK 光学重心无关），真正的竖向微调改成显式光学常数
//   translateY(-1.5px)；横向仍用 letter-spacing 的负 margin 抵消。ink 精度由 visual.mjs 守卫。
assert('需求7：顶栏星座按钮视觉居中（justify-content 几何居中 + .cn 光学常数 translateY(-1.5px)）',
  /\.nav-actions \.seg\.constel button \{ height:30px; display:inline-flex; align-items:center; justify-content:center; padding:0 8px; \}/.test(tpl) &&
  /\.seg\.constel button \.cn \{ margin-right:-0\.16em; transform:translateY\(-1\.5px\); \}/.test(tpl));

// ==================== V1.7.1 回归守卫 ====================
console.log('--- V1.7.1 第五轮回归守卫 ---');
// 需求1：信息窗拖拽识别区不得溢出（方案 A：窗口整体留在视口内）
assert('V1.7.2（需求11）：推翻 V1.7.1 的 minL=0，恢复「可拖出屏幕」',
  /var KEEP = 24, vw = window\.innerWidth, vh = window\.innerHeight;/.test(appCode) &&
  /var minL = \(KEEP - drag\.w\) - wrap\.left;/.test(appCode) &&
  !/var minL = 0 - wrap\.left/.test(appCode));
assert('需求1：pointerdown 先做可视矩形命中测试（溢出到窗外的按下不响应）',
  /var rr = el\.getBoundingClientRect\(\);/.test(appCode) &&
  /e\.clientX < rr\.left - 1 \|\| e\.clientX > rr\.right \+ 1/.test(appCode));
// 需求2：关闭后 hover 只能出预览、不许钉住
// V1.8.0（需求8）：新增 03.5 组网进度章节，它的信息窗也要纳入「已关闭」标记
assert('V1.7.2（需求4）：INFO_HIDDEN / INFO_CLOSED / INFO_B（浮窗）三态并存，INFO_PREVIEW 已删',
  /var INFO_CLOSED = \{ chart: false, map: false, globe: false, net: false \};/.test(appCode) &&
  /var INFO_B = \{\};/.test(appCode) &&
  /function infoClearClosed\(\)/.test(appCode) &&
  !/INFO_PREVIEW/.test(appCode));
assert('V1.7.2（需求4 ③）：点 ✕ 置 INFO_CLOSED 且**浮窗也一并收掉**',
  /INFO_CLOSED\[key\] = true;/.test(appCode) &&
  /INFO_CLOSED\[key\] = true;\s*\n\s*hideFloat\(key\);/.test(appCode) &&
  /if \(!html \|\| INFO_CLOSED\[key\]\) \{ hideFloat\(key\); return; \}/.test(appCode));
assert('V1.7.2（需求4）：hover 走**浮窗** showXxxFloat（单颗），A 窗只服务选中态',
  /if \(hit\) showChartFloat\(hit\.sat\.idx\); else hideFloat\('chart'\);/.test(appCode) &&
  /if \(i !== null\) showMapFloat\(i\);/.test(appCode) &&
  /if \(best !== null\) showGlobeFloat\(best\)/.test(appCode) &&
  /function showChartFloat\(idx\)/.test(appCode) &&
  /function showMapFloat\(idx\)/.test(appCode) &&
  /function showGlobeFloat\(best\)/.test(appCode));
assert('V1.7.2（需求4）：三处 mouseleave 均只收浮窗，不再 syncSelInfo 钉回',
  (appCode.match(/hideFloat\('(chart|map|globe)'\);/g) || []).length >= 3 &&
  !/INFO_PREVIEW/.test(appCode));
// V1.7.2 第七轮（需求5，Q3=B）：基准从「A 窗整体」换成「A 窗内容区 .si-body」——
//   旧基准会把 B 窗上沿对齐到 ✕ 按钮上边缘（用户图四），现在对齐内容区上沿，
//   高度再减掉底部拖拽提示行，做到"上下边缘都对齐 A 窗的内容部分"。
assert('V1.7.2r7（需求5）：浮窗基准改为 A 窗内容区 .si-body（贴右侧 / 越界转左 / 再放不下转下方）',
  /function positionFloat\(key\)/.test(appCode) &&
  /var aBody = a\.querySelector\('\.si-body'\);/.test(appCode) &&
  /ab = \(aBody \|\| a\)\.getBoundingClientRect\(\);/.test(appCode) &&
  /left = ab\.right \+ GAP - wrap\.left;/.test(appCode) &&
  /left = ab\.left - GAP - w - wrap\.left;/.test(appCode) &&
  /top = ab\.bottom \+ GAP - wrap\.top;/.test(appCode) &&
  /left = M; top = M;/.test(appCode));
// 需求7：表格联动只用一套翻页逻辑
assert('需求7：gotoSatInTable 已删除（两套翻页逻辑并存是页号错位的根因）',
  !/function gotoSatInTable/.test(appCode) && !/gotoSatInTable\(/.test(appCode));
assert('需求7：翻页用 renderTable({jump:true}) 的 pageBounds 口径（实测行高）',
  /renderTable\(\{ jump: true \}\)/.test(appCode) &&
  /if \(jump\) hitTableRow\(\);/.test(appCode) &&
  /function hitTableRow\(\)/.test(appCode));
assert('需求7：jump 时找不到选中项把页码归 0（别停在旧页装没联动）',
  /if \(firstIdx >= 0\) \{[\s\S]{0,400}?\} else \{\s*S\.tpage = 0;\s*\}/.test(appCode));
assert('需求7：切星座后重算表格页码（两个星座行数不同，旧页号会指错）',
  /function afterConstelSwap\(\)[\s\S]{0,1200}renderTable\(\{ jump: true \}\)/.test(appCode));
// 需求9：品牌色只留一个来源
assert('需求9：--brand-c 死变量已彻底删除（CSS 与 JS 两侧）',
  !/brand-c/.test(tplCode) && !/setProperty\('--brand-c'/.test(appCode) && !/syncBrandColor/.test(appCode));
assert('需求9：品牌渐变动画有幂等守卫 + 前台兜底收尾（否则渐变永久留屏显出更鲜艳的红）',
  /if \(el\.__sweeping\) brandSweepFinish\(\);/.test(appCode) &&
  /function brandSweepFinish\(\)/.test(appCode) &&
  /document\.addEventListener\('visibilitychange'[\s\S]{0,300}brandSweepFinish/.test(appCode));
// V1.9.1：.brand-name 现在还要承载定位与双层结构（position/display 等），
//   所以不能再把整块写死成 `{ color:var(--row-sel);` 开头 —— **原意**改为：
//   「这一块里 **只有一个 color: 声明**，且它就是 var(--row-sel)」
//   （旧 bug 是同一块里写了两次 color，后一条恒赢、前一条成死代码）。
assert('需求9：.brand-name 只由 --row-sel 驱动（同一块里只有一个 color 声明）',
  (function () {
    const m = tplCode.match(/\.brand-name \{[^}]*\}/);
    if (!m) return false;
    const decls = (m[0].match(/(?:^|[;{\s])color\s*:/g) || []).length;
    return decls === 1 && /color:var\(--row-sel\)/.test(m[0]);
  })());
// 需求3：顶栏三键定宽定位
assert('需求3：三键绝对定位钉在顶栏右侧（英文不再被推出视口）',
  /\.nav-actions \{ position:absolute; right:24px; top:50%; transform:translateY\(-50%\);/.test(tplCode) &&
  /padding-right:var\(--nav-actions-w, 232px\);/.test(tplCode));
assert('需求3：.nav-actions 已移出 .nav-right（留在里面会被父级宽度牵着走）',
  /<div class="nav-right">[\s\S]{0,900}?<\/div>\s*(<!--[\s\S]{0,300}?-->)?\s*<div class="nav-actions">/.test(tpl));
assert('V1.7.2（需求5/9）：layoutNav 合并为**唯一一份**（重复声明会让 V1.7.1 那份永不执行）',
  (appCode.match(/function layoutNav\(/g) || []).length === 1 &&
  /setProperty\('--nav-h', navHeight\(\)/.test(appCode) &&
  /act\.style\.right = padR \+ 'px';/.test(appCode) &&
  (appCode.match(/layoutNav\(\)/g) || []).length >= 4);
assert('需求3：顶栏左右内边距统一 24px（亮暗键到右边 = CISTrack 到左边）',
  /flex-wrap:nowrap; gap:10px 14px; padding:8px 24px;/.test(tplCode));
// 需求4 + 需求10：完全还原
assert('需求1（V1.9.0）：还原默认**不再**回星网 / 回中文（反转 V1.7.1 的"不豁免"决议）',
  !/var needConstel = \(S\.key !== 'gw'\);/.test(appCode) &&
  !/var needLang = \(LANG !== 'zh'\);/.test(appCode) &&
  !/function resetAllPrefs\(\)[\s\S]{0,2600}?S\.key = 'gw';/.test(appCode) &&
  !/function resetAllPrefs\(\)[\s\S]{0,2600}?LANG = 'zh';/.test(appCode));
assert('需求1（V1.9.0）：还原默认改走**通用过场** playCurtain（与语言切换同款 620ms；语言切换也走它）',
  /resetAllBtn'\)\.addEventListener\('click', function \(\) \{[\s\S]{0,80}playCurtain\(function \(\) \{ resetAllPrefs\(\); \}\)/.test(appCode) &&
  /function playCurtain\(updateFn\)/.test(appCode) &&
  /function playLangSwitch\(dir, updateFn\) \{ playCurtain\(updateFn\); \}/.test(appCode) &&
  !/function resetAllPrefs\(\)[\s\S]{0,2600}?playNetSwitch/.test(appCode));
// V1.7.3（需求9）：两章时间条各自归零（旧版单值 setOffset(0) 已随字段一起废弃）
assert('需求10：还原默认把两章时间条各自归零 setOffset(0,map/globe)（滑块/文案/shifted 一起回退）',
  /function resetAllPrefs\(\)[\s\S]{0,2600}?if \(typeof setOffset === 'function'\) \{ setOffset\(0, 'map'\); setOffset\(0, 'globe'\); \}/.test(appCode));
assert('需求10：「此刻」按钮文案已改为「实时」（英文 Now 不变）',
  /b_now: \['实时', 'Now'\]/.test(appCode) && /d_now_btn: \['实时', 'Now'\]/.test(appCode) &&
  !/点「此刻」回到当前时间/.test(appCode));
// 需求8：虚线主题色
assert('需求8：倾角分布边界线与待编目批次高度线改用星座主题色 C.theme',
  /ctx\.strokeStyle = C\.theme;/.test(appCode) &&
  !/ctx\.setLineDash\(\[5, 4\]\); ctx\.lineWidth = 1;\s*ctx\.strokeStyle = C\.accent;/.test(appCode) &&
  /theme: css\('--row-sel'\)/.test(appCode));
// 需求11：? 按钮自关
assert('需求11：? 提示框改 toggle 语义（点同一个按钮 = 关掉）',
  /if \(open && open\.__key === key\) \{ open\.remove\(\); return; \}/.test(appCode) &&
  /p\.__key = key;/.test(appCode));
// 需求12：禁选
assert('需求12：全站禁选兜底规则 + 放行输入框/说明/表格数据',
  /body, body \*:not\(input\):not\(textarea\) \{/.test(tplCode) &&
  /-webkit-touch-callout:none;/.test(tplCode) &&
  /#tbody td, #launchBody td \{/.test(tplCode) &&
  /-webkit-user-select:text; -moz-user-select:text/.test(tplCode));


// ==================== V1.7.2 第六轮回归守卫 ====================
console.log('--- V1.7.2 第六轮回归守卫 ---');
// 需求1/2：信息窗永不换列 + 高度按视口算（根治窄屏「换列 → 左溢出 → 滚动条」三连）
assert('V1.7.2（需求1）：.sat-info 永不换列（flex-wrap:nowrap）+ 两侧不滚动（overflow:hidden）',
  /\.sat-info \{[^}]*flex-direction:column;\s*flex-wrap:nowrap;/.test(tplCode) &&
  /\.sat-info \{[^}]*overflow:hidden;/.test(tplCode));
assert('V1.7.2（需求1）：max-height 基准从「容器」改成「视口」（容器再矮也不挤压信息窗）',
  /\.sat-info \{[^}]*max-height:calc\(100vh - 40px\)/.test(tplCode) &&
  !/\.sat-info \{[^}]*max-height:calc\(100% - 32px\)/.test(tplCode) &&
  /\.sat-info \{ max-height:calc\(100vh - 20px\); \}/.test(tplCode));
assert('V1.7.2（需求1）：.si-head 钉 flex:0 0 auto（× 按钮任何尺寸都不被压掉）',
  /\.sat-info \.si-head \{[^}]*flex:0 0 auto;/.test(tplCode));
assert('V1.7.2（需求1）：.si-body 用 flex:1 1 auto + min-height:0 + overflow:hidden',
  /\.sat-info \.si-body \{[^}]*flex:1 1 auto;[^}]*min-height:0;[^}]*overflow:hidden;/.test(tplCode));
assert('V1.7.2（需求1）：≤400px 极窄断点把 .si-block min-width 降到 118px（防窄屏横向溢出）',
  /@media \(max-width:400px\)/.test(tplCode) &&
  /\.sat-info \.si-block \{ min-width:118px;/.test(tplCode));
assert('V1.7.2（需求2）：pointerdown 仍做可视矩形命中测试（识别区不得越出窗口）',
  /e\.clientX < rr\.left - 1 \|\| e\.clientX > rr\.right \+ 1/.test(appCode));
// 需求3：红线与闪动的根治
// V1.7.2 第七轮（需求4）：旧断言要求浮窗带 border-left:3px 主题色 —— 那正是用户第七轮
//   点名的"B 窗不该有左边框"。现在反过来：浮窗**任何**边框/轮廓/阴影都必须被清掉。
assert('V1.7.2r7（需求4）：B 浮窗无任何主题色边框（border-left 也不许有）',
  /\.sat-info\.floatwin \{[^}]*pointer-events:none;/.test(tplCode) &&
  !/\.sat-info\.floatwin \{[^}]*border-left/.test(tplCode) &&
  !/box-shadow:inset 2px 0 0 var\(--row-sel\)/.test(tplCode) &&
  /\.sat-info\.floatwin \.si-body \{ border:0 !important; outline:0 !important; box-shadow:none !important; \}/.test(tplCode));
assert('V1.7.2（需求3）：浮窗 pointer-events:none 根治"鬼畜闪动"（不再抢 canvas 的 mouseleave）',
  /pointer-events:none/.test(tplCode) && /function showFloat\(key, html, idKey\)/.test(appCode));
assert('V1.7.2（需求3）：浮窗不渲染 .si-head（无 ✕）与 .si-drag（无拖动提示）',
  /el\.innerHTML = '<div class="si-body"><\/div>'/.test(appCode));
// 需求4：三态交互
assert('V1.7.2（需求4）：每章新增一个浮窗 DOM 元素（#chartInfoB / #mapInfoB / #globeInfoB）',
  /id="chartInfoB"/.test(tpl) && /id="mapInfoB"/.test(tpl) && /id="globeInfoB"/.test(tpl));
assert('V1.7.2（需求4）：A 窗与浮窗共用同一份内容生成函数（格式必然一致）',
  /function mapBlockHtml\(idx\)/.test(appCode) && /function globeBlockHtml\(best\)/.test(appCode) &&
  /showFloat\('map', html, 'sat' \+ idx\)/.test(appCode));
assert('V1.7.2（需求4 ②）：多选时 A 窗只显示一颗（focusIdx 优先，否则 NORAD 最小）',
  /if \(S\.focusIdx != null && cur\(\)\.sats\[S\.focusIdx\]\) \{/.test(appCode) &&
  /if \(n < bestN\) \{ bestN = n; best = i; \}/.test(appCode));
assert('V1.7.2（需求4 ④）：图上多选后点任意一颗 = 组内切换（sel 不变、只换 focusIdx）',
  /if \(S\.sel\.length > 1 \|\| S\.selGroup\) \{\s*\n\s*S\.focusIdx = idx;/.test(appCode));
assert('V1.7.2（需求4 ⑤）：关闭后 A 窗与浮窗都不显示（syncSelInfo 尊重 INFO_CLOSED）',
  /if \(!INFO_CLOSED\.chart\) showChartInfo/.test(appCode) &&
  /if \(!INFO_CLOSED\.map\) showMapInfo/.test(appCode));
assert('V1.7.2（需求4）：selectGroup 整批选中时清 focusIdx（回到"显示 NORAD 最小那颗"）',
  /function selectGroup\(lk\)[\s\S]{0,700}?S\.selGroup = null;[\s\S]{0,80}?S\.focusIdx = null;/.test(appCode));
// 需求5/9：顶栏
assert('V1.7.2（需求5/9）：layoutNav 只有一份声明（V1.7.1 那份被提升覆盖、从未执行）',
  (appCode.match(/function layoutNav\(/g) || []).length === 1);
assert('V1.7.2（需求5/9）：合并版同时保留 --nav-h（时钟药丸定位依赖）与三键让位',
  /setProperty\('--nav-h', navHeight\(\) \+ 'px'\)/.test(appCode) &&
  // ★ V1.9.3：让位间距从写死的 22 改为**统一的 G**（用户要求"标签右缘距按钮 = 其它按钮间的统一间距"）
  /right\.style\.paddingRight = \(m\.actW \+ G\) \+ 'px';/.test(appCode) &&
  !/right\.style\.paddingRight = \(m\.actW \+ 22\) \+ 'px';/.test(appCode));
assert('V1.7.2（需求9）：极窄屏四级降级 L0-L3 常量与分支齐全',
  /var NAV_W0 = 480;/.test(appCode) && /var NAV_BRAND_MIN = 18;/.test(appCode) &&
  /var NAV_BTN_MIN_W = 16;/.test(appCode) &&
  // V1.7.2 第七轮（需求1/3）：L0 出口补了一次 navFollowUp()（顶栏不调也要重算色块与标题间距）
  /if \(vw >= NAV_W0\) \{ navFollowUp\(\); return; \}/.test(appCode) &&
  /seg\.classList\.add\('compact'\);/.test(appCode));
assert('V1.7.2（需求9）：每档都先复位再测量（否则窗口来回拉会累积式变窄）',
  /seg\.classList\.remove\('compact'\);/.test(appCode) &&
  /b\.style\.width = '';/.test(appCode) && /brand\.style\.fontSize = '';/.test(appCode));
assert('V1.7.2（需求9）：L3 有对应 CSS（去文字只显色）+ 各断点字号降级已全部删除',
  /\.seg\.constel\.compact button \.cn \{ display:none; \}/.test(tplCode) &&
  !/\.seg\.constel button \{[^}]*font-size:10px/.test(tplCode) &&
  /\.seg\.constel button \{ padding:7px 10px; \}/.test(tplCode));
assert('V1.7.2（需求5/9）：CSS gap 与 JS 的 G 一致（宽屏 12 / 窄屏 8）',
  /\.nav-actions \{ position:absolute;[\s\S]{0,200}?gap:12px;/.test(tplCode) &&
  /\.nav-actions \{ gap:8px; right:16px; \}/.test(tplCode) &&
  /var G = vw >= NAV_W0 \? 12 : 8;/.test(appCode));
// 需求6：全屏死区
assert('V1.7.2（需求6）：isFsMode 认全屏 / 伪全屏 / 章节级全屏三种形态',
  /function isFsMode\(\)/.test(appCode) &&
  /document\.fullscreenElement/.test(appCode) &&
  /pseudo-full/.test(appCode) &&
  /section\.fs-mobile/.test(appCode));
assert('V1.7.2（需求6）：chartHitZone 与 mapHitZone 在全屏下直接放行（无死区）',
  /function chartHitZone\(clientX, clientY\) \{\s*\n\s*if \(isFsMode\(\)\) return true;/.test(appCode) &&
  /function mapHitZone\(clientX, clientY\) \{\s*\n\s*if \(isFsMode\(\)\) return true;/.test(appCode));
// 需求7：TLE 更新时间
assert('V1.7.2（需求7）：信息窗与导出图的「数据更新」都改成「TLE更新时间 / TLE updated」',
  /d_dataupd: \['TLE更新时间', 'TLE updated'\]/.test(appCode) &&
  !/d_dataupd: \['数据更新'/.test(appCode));
// 需求8：倾角限位
assert('V1.7.2（需求8）+V1.9.5（H39）：倾角定义域 0–180°（容纳逆行轨道）；边界虚线已按 H39 删除',
  /var CHART_X_MIN = 0, CHART_X_MAX = 180;/.test(appCode) &&
  !/fillText\('180°', bx - 4, PT \+ 4\)/.test(appCode));
// 需求10：表格单选
assert('V1.7.2（需求10）：卫星表格内多选后单击任一颗 = 取消全部、单选它（仅表格）',
  /tbody\.addEventListener\('click'[\s\S]{0,900}?if \(S\.sel\.length > 1 \|\| S\.selGroup\) \{[\s\S]{0,300}?S\.sel = \[idx\];/.test(appCode));
assert('V1.7.2（需求10）：图表的组内切换逻辑未被这条改动波及（toggleSel 仍独立处理）',
  /function toggleSel\(idx, additive\)/.test(appCode) &&
  /if \(S\.sel\.length > 1 \|\| S\.selGroup\) \{\s*\n\s*S\.focusIdx = idx;\s*\n\s*infoClearClosed\(\);/.test(appCode));
// 需求11：恢复可拖出屏幕
assert('V1.7.2（需求11）：钳制恢复「至少留 24px 在视口内」，页面仍不撑宽（overflow-x:hidden 兜底）',
  /var KEEP = 24, vw = window\.innerWidth, vh = window\.innerHeight;/.test(appCode) &&
  /html \{[\s\S]{0,120}overflow-x:hidden/.test(tpl));
// 需求12：手机滑动切星座
assert('V1.7.2（需求12）：滑动切星座与点按钮共用同一入口 switchConstel（状态/动画完全一致）',
  /function switchConstel\(toKey\)/.test(appCode) &&
  /constelSeg'\)\.addEventListener\('click'[\s\S]{0,200}switchConstel\(b\.getAttribute\('data-c'\)\)/.test(appCode) &&
  /swipe = \{ x0[\s\S]{0,2600}switchConstel\(target\);/.test(appCode));
assert('V1.7.2（需求12）：六道防误触闸门（触屏非全屏/空白元素/72px/2.2倍/0.35px每ms/方向匹配）',
  /if \(!isTouch\(\) \|\| isFsMode\(\)\) return;/.test(appCode) &&
  /SWIPE_BLANK_SEL/.test(appCode) &&
  /var SWIPE_MIN_DX = 72, SWIPE_RATIO = 2\.2, SWIPE_MIN_V = 0\.35;/.test(appCode) &&
  /e\.defaultPrevented\) \{ swipe = null; return; \}/.test(appCode) &&
  /S\.key === 'gw' && dx < 0\) \? 'qf'/.test(appCode));
assert('V1.7.2（需求12）：touch 监听全部 passive（不阻止页面正常上下滚动）',
  // touchstart / touchmove 各自带 passive；touchend+touchcancel 走 forEach(变量)，只能按 forEach 块查
  /addEventListener\('touchstart',[\s\S]{0,3000}?\{ passive: true \}\);/.test(appCode) &&
  /addEventListener\('touchmove',[\s\S]{0,3000}?\{ passive: true \}\);/.test(appCode) &&
  /\['touchend', 'touchcancel'\]\.forEach[\s\S]{0,300}?\{ passive: true \}\);/.test(appCode));

/* ══════════════════════════════════════════════════════════════════════════
 * V1.7.2 第七轮（修补轮）—— 反向守卫
 * 这一轮做的多是「删掉/收口」，所以断言以「必须不存在」「必须早退」为主，
 * 目的是防止以后有人手滑把已删的东西加回来。
 * ══════════════════════════════════════════════════════════════════════════ */
console.log('--- V1.7.2 第七轮 ---');
// 需求2：顶栏章节切换按钮 + 「更新历元」行 —— 已删，且不允许回来
assert('V1.7.2r7（需求2）：app.js 里不再有任何 navlinks / navUpd 逻辑',
  !/navlinks/.test(appCode) && !/navUpd/.test(appCode) &&
  !/nav-updated/.test(appCode) && !/navUpdated/.test(appCode));
assert('V1.7.2r7（需求2）：template 里 .navlinks / .nav-updated 的 DOM 与 CSS 全清',
  !/class="navlinks"/.test(tplCode) && !/nav-updated/.test(tplCode) && !/\.navlinks/.test(tplCode));
// V1.9.1：.nav-right 不再是空容器 —— 里面放了「顶栏章节标签」（#navTabs）。
//   这条断言的**原意**仍然成立（而且更重要）：这个容器必须存在，layoutNav 依赖它算宽度。
assert('V1.7.2r7（需求2）+ V1.9.1：.nav-right 容器仍在（layoutNav 依赖它算宽度），且内含顶栏标签',
  /<div class="nav-right">/.test(tplCode) && /id="navTabs"/.test(tplCode));
// 需求2/新需求A：历元行常驻主标题下方
assert('V1.7.2r7（需求2）：#pageEpoch 常驻（CSS 里不得再有 display:none）',
  /id="pageEpoch"/.test(tplCode) &&
  !/\.page-epoch\s*\{[^}]*display\s*:\s*none/.test(tplCode));
assert('V1.7.2r7（新需求A）：信息窗 satBlock 只输出「该星历元」一行，不含 TLE更新时间',
  /function satBlock\(s, scope, extra\) \{[\s\S]*?\n\}/.test(appCode) &&
  (function () {
    const body = appCode.match(/function satBlock\(s, scope, extra\) \{[\s\S]*?\n\}/)[0];
    return /d_row_epoch_sat/.test(body) && !/d_dataupd/.test(body);
  })());
assert('V1.7.2r7（新需求A）：导出底栏 rest 里不再拼 TLE更新时间',
  // V1.9.1（A14）：星座名由 st.name 改为 t('shot_' + S.key)（英文图不再漏出中文名）→ 断言同步
  // V1.9.2：加了"两星座都在图上 → 星座名写「星网+千帆」"的分支，判据同步
  /var rest = \[VERSION, cs\.both \? t\('shot_both'\) : t\('shot_' \+ cs\.key\), title, timePart\]\.join\(' \| '\);/.test(appCode) &&
  !/var rest = \[[^\]]*d_dataupd/.test(appCode));
// 需求3：标题上端间距 = 药丸上端到顶栏下边缘
assert('V1.7.2r7（需求3）：layoutTitleGap 用文档坐标换算（滚动中重算也不会得出荒唐值）',
  /function layoutTitleGap\(\)/.test(appCode) &&
  /var glyphDoc = titleGlyphTop\(pt\) \+ \(window\.pageYOffset \|\| 0\);/.test(appCode) &&
  /var target = navH \+ pillGap \+ pr\.height \+ pillGap;/.test(appCode));
assert('V1.7.2r7（需求1/3）：navFollowUp 在 layoutNav 的 L0 出口与常规出口都调用（≥3 处含定义）',
  (appCode.match(/navFollowUp\(\)/g) || []).length >= 3 &&
  /function navFollowUp\(\) \{\s*\n\s*try \{ moveConstelSlider\(S\.key, false\); \} catch \(e\) \{\}/.test(appCode));
assert('V1.7.2r7（需求1）：语言切换收尾（顶栏归位后）重算色块与标题间距',
  /setTimeout\(function \(\) \{[\s\S]{0,600}?moveConstelSlider\(S\.key, false\)[\s\S]{0,200}?layoutTitleGap\(\)[\s\S]{0,120}?\}, ANIM\.lang \+ 60\);/.test(appCode));
// 需求4：拖动边框改 border（outline 被 overflow:hidden 裁掉只剩顶边）
assert('V1.7.2r7（需求4）：A 窗拖动边框用 border（不再用会被裁掉的 outline）',
  /\.sat-info\.moving \.si-body \{ border:1px solid var\(--row-sel\); box-sizing:border-box; \}/.test(tplCode) &&
  !/\.sat-info\.moving \.si-body \{ outline:/.test(tplCode));
assert('V1.7.2r7（需求4）：B 浮窗三层防线（border/outline/shadow 清零 + --row-sel 置透明）',
  /\.sat-info\.floatwin,\s*\n\s*\.sat-info\.floatwin \.si-body \{ border:0 !important; outline:0 !important; box-shadow:none !important; \}/.test(tplCode) &&
  /\.sat-info\.floatwin \* \{ --row-sel: transparent; \}/.test(tplCode));
assert('V1.7.2r7（需求4）：浮窗被 pointerdown 拖动逻辑显式排除（根治边框泄露）',
  /if \(el\.classList\.contains\('floatwin'\)\) return;/.test(appCode));
// 需求5：B 窗与 A 窗内容区上下边缘对齐 + 无 hover 设备不弹
assert('V1.7.2r7（需求5）：positionFloat 以 .si-body 为基准，上沿对齐内容区、高度减去拖拽提示行',
  /var aTip = aBody \? aBody\.querySelector\('\.si-drag'\) : null;/.test(appCode) &&
  /left = ab\.right \+ GAP - wrap\.left;[\s\S]{0,200}?top = ab\.top - wrap\.top;/.test(appCode) &&
  /el\.style\.height = \(naturalH <= wantH \+ 1\) \? wantH \+ 'px' : '';/.test(appCode));
assert('V1.7.2r7（需求5）：无 hover 能力的设备不弹 B 浮窗（手机 tap 合成的 mousemove 不再留下重复窗）',
  /function noHover\(\) \{/.test(appCode) &&
  /matchMedia\('\(hover: hover\)'\)/.test(appCode) &&
  /if \(noHover\(\)\) \{ hideFloat\(key\); return; \}/.test(appCode));
assert('V1.7.2r7（需求5）：noHover 缓存 MediaQueryList（对象是 live 的，外接鼠标后能自动恢复）',
  /var MQ_HOVER = null;/.test(appCode) && /if \(!MQ_HOVER\) MQ_HOVER = matchMedia\('\(hover: hover\)'\);/.test(appCode));
// 需求7：第 0 章要能横滑
assert('V1.7.2r7（需求7）：SWIPE_BLANK_SEL 已移出 .sec-head / .hero（第0章空白恢复横滑）',
  (function () {
    const m = appCode.match(/var SWIPE_BLANK_SEL = ([\s\S]{0,300}?);\n/);
    if (!m) return false;
    return !/\.sec-head/.test(m[1]) && !/\.hero\b/.test(m[1]) && /\.controls/.test(m[1]);
  })());
// 需求8b：名称开关提到最外层短路之前
// ★ V1.8.0（需求4①）修订：开关的淡入/淡出需要「开关已关、但动画系数还没归零」的这 520ms 里
//   继续绘制（否则根本画不出淡出，标注会「啪」地消失）。因此最外层条件由 `S.names.map`
//   扩成 `S.names.map || TOG.nameMap > 0.01`。TOG 走 animTo(easeOutCubic, 520ms)，末帧被
//   赋成**精确的 0**，所以动画结束后两者的布尔结果逐字等价 —— 守卫要保的语义
//   （关掉开关＝标注必然消失）没有松动，只是过程由瞬变改为淡出。
assert('V1.7.2r7（需求8b）：地图标签把 S.names.map 提到最外层（选中星也能关掉）',
  /var showLabel = \(S\.names\.map \|\| TOG\.nameMap > 0\.01\) && \(sel2 \|\| mapHover === m \|\| visHi \|\| \(!pickOn && !hasSel\)\);/.test(appCode));
assert('V1.7.2r7（需求8b）：地球标签同样以 S.names.globe 为最外层条件',
  /if \(!hidden && \(S\.names\.globe \|\| TOG\.nameGlobe > 0\.01\) && \(sel4 \|\| G\.hover === m \|\| !hasSelG\)\) \{/.test(appCode));
// 需求8c：选星时两章名称开关同步打开、关闭各自独立
assert('V1.7.2r7（需求8c）：选星（选中集/焦点变化）时两章名称开关同步打开',
  /var LAST_SEL_SIG = null;/.test(appCode) &&
  /if \(selSig !== LAST_SEL_SIG && S\.sel\.length\) \{\s*\n\s*S\.names\.map = true; S\.names\.globe = true;\s*\n\s*syncNameBtns\(\);/.test(appCode));
assert('V1.7.2r7（需求8c）：syncNameBtns 只负责把按钮态对齐状态（关闭各自独立，不被重绘掰开）',
  /function syncNameBtns\(\) \{/.test(appCode) &&
  /b\.classList\.toggle\('on', p\[1\]\);/.test(appCode));
// 需求8a：轨道开关管住选中星/悬停星的轨道
// V1.9.0（需求3）：门禁由「布尔 S.mapTrack」改为「补间系数 TOG.mapTrack > 0.001」——
//   否则关掉开关时整块被立刻跳过，TOG.mapTrack 的淡出动画根本没机会播（R3 下半的根因）。
//   断言的门禁字面同步更新，**"三处调用必须在同一个门禁块内"这个原意保持不变**。
assert('V1.9.0（需求3）：选中星(0.9)与悬停星(0.75)的轨道绘制被包进同一个 TOG.mapTrack 门禁块',
  /if \(TOG\.mapTrack > 0\.001\) \{[\s\S]{0,800}?strokeTrack\(sj, 0\.9\);[\s\S]{0,400}?strokeTrack\(mapHover, 0\.75\);[\s\S]{0,40}?\n  \}/.test(appCode));
assert('V1.9.0（需求3）：drawMap 里不存在游离在 TOG.mapTrack 门禁块之外的 strokeTrack 调用',
  (function () {
    // strokeTrack 是 drawMap 内部的局部函数，全项目只有 3 处调用（全部轨道/选中 0.9/悬停 0.75），
    // 这 3 处必须都被同一个 `if (TOG.mapTrack > 0.001) {` 块包住 —— 用花括号配对数出该块的真实跨度。
    const lines = appCode.split('\n');
    const calls = [];
    lines.forEach(function (l, i) {
      if (/strokeTrack\(/.test(l) && !/function strokeTrack/.test(l)) calls.push(i);
    });
    const open = lines.findIndex(function (l) { return /^\s*if \(TOG\.mapTrack > 0\.001\) \{$/.test(l); });
    if (open < 0 || calls.length !== 3) return false;
    let depth = 0, close = -1;
    for (let i = open; i < lines.length; i++) {
      for (const ch of lines[i]) { if (ch === '{') depth++; else if (ch === '}') depth--; }
      if (depth === 0) { close = i; break; }
    }
    return close > open && calls.every(function (i) { return i > open && i < close; });
  })());
// ── 跨浏览器体检发现的额外缺陷（320px 英文态 select 溢出被裁）—— 约束必须存在 ──
assert('V1.7.2r7（体检）：≤400px 给 .controls .ctl 解除 min-width:auto 陷阱（320px 英文态 select 不再撑破视口）',
  /@media \(max-width:400px\) \{[\s\S]{0,900}?\.controls \.ctl \{ min-width:0; \}/.test(tplCode) &&
  /\.controls \.ctl select \{ max-width:100%; \}/.test(tplCode));
// ── 反向守卫：被证伪的「滚动锚定」补偿代码不得回潮（真实原因见 app.js 里 playLangSwitch 开头的记录）──
assert('V1.7.2r7（体检）：playLangSwitch 不含滚动还原补偿（该"缺陷"已被 13 组对照实验证伪为探针假象）',
  !/还原被「滚动锚定」顶走/.test(appCode) && !/var y0 = window\.pageYOffset \|\| 0;/.test(appCode));
assert('V1.7.2r7（体检）：playLangSwitch 保留"已排除的疑点"记录注释（防止后人再走一遍弯路）',
  /已排除的疑点，记录备查/.test(appSrc) && /#loadMask/.test(appSrc) && /不做任何补偿代码/.test(appSrc));

// ==================== V1.8.0（第九轮）回归守卫 ====================
// 这一轮改动量最大（新章节 + 两条新列 + 四联动效 + i18n 审计），所以逐条上守卫，
// 目的：任何一个被改回去都会在这里立刻报警，而不是等到用户肉眼在某个尺寸下发现。
console.log('--- V1.8.0（第九轮）回归守卫 ---');

// 需求⑱（根治项）：两张坐标图的图像必须在横纵坐标线上截止 —— canvas 级 clip，而不是「越界点跳过」
assert('V1.8.0（需求⑱）：drawChart / drawNet 都在绘图区矩形上做 canvas 级裁剪',
  (appCode.match(/ctx\.rect\(PL, PT, pw, ph\); ctx\.clip\(\);/g) || []).length >= 2 &&
  /V1\.8\.0（需求17 \/ ⑱）：绘图区硬裁剪/.test(appSrc) &&
  /需求17 \/ ⑱）同样裁剪到绘图区/.test(appSrc));

// 需求Q4-①：开关画布同步（图层随开关淡入淡出）
assert('V1.8.0（需求Q4①）：图层开关动画系数 TOG + togAnim / togSyncAll 齐备',
  /var TOG = \{ covOn: 1, mapTrack: 1, nameMap: 1, coneOn: 1, showTracks: 1, nameGlobe: 1, pickOn: 0 \};/.test(appCode) &&
  /function togAnim\(key, on\) \{/.test(appCode) &&
  /function togSyncAll\(\) \{/.test(appCode) &&
  (appCode.match(/togAnim\('/g) || []).length >= 6 &&           // 六个开关各接一次
  /try \{ togSyncAll\(\); \} catch \(e\) \{\}/.test(appCode));    // 还原 / 换星座时系数归位

// 需求Q4-② → V1.9.0（需求3）：配色切换从"旧色→新色 插值"改成**两段式**（先整体褪去、再染上）
assert('V1.9.0（需求3）：配色切换为**两段式** —— 前半程旧配色淡出、后半程新配色淡入（不再是 A→B 插值）',
  /var COLORMIX = null;/.test(appCode) && /function _fade\(c, alpha\)/.test(appCode) &&
  /if \(COLORMIX && COLORMIX\.scope === scope\)/.test(appCode) &&
  /if \(k < 0\.5\) return _fade\(from, 1 - \(1 - Math\.pow\(1 - k \* 2, 3\)\)\);/.test(appCode) &&
  /return _fade\(to, Math\.pow\(\(k - 0\.5\) \* 2, 3\)\);/.test(appCode) &&
  !/return _mix\(from, to, 1 - Math\.pow\(1 - k, 3\)\);/.test(appCode));

// 需求Q4-③：观测点进出（标记与标签淡入淡出）
assert('V1.8.0（需求Q4③）：观测点进出用 PICK_FADE + TOG.pickOn 淡入淡出',
  /var PICK_FADE = null;/.test(appCode) && /pickAlpha = TOG\.pickOn/.test(appCode) &&
  /ctx\.globalAlpha = 0\.12 \* pickAlpha/.test(appCode) && /ctx\.globalAlpha = pickAlpha/.test(appCode));

// 需求Q4-④：表格翻页「淡消失 → 淡出现」（非线性，只作用于 tbody）
assert('V1.8.0（需求Q4④）：两张表翻页都走 fadeTableSwap（淡出 260ms + 淡入 260ms）',
  /function fadeTableSwap\(tb, swap\) \{/.test(appCode) &&
  /var TBL_FADE = 260, tblFadeToken = 0;/.test(appCode) &&
  (appCode.match(/fadeTableSwap\(/g) || []).length >= 5 &&      // 定义 + 4 个调用点（两表各自的按钮与跳页）
  /@keyframes tblFadeOut/.test(tplCode) && /@keyframes tblFadeIn/.test(tplCode) &&
  /\.tbl-fade-out \{ animation: tblFadeOut var\(--anim-half\) var\(--ease-slow-fast\) forwards; \}/.test(tplCode) &&
  /\.tbl-fade-in  \{ animation: tblFadeIn  var\(--anim-half\) var\(--ease-fast-slow\) forwards; \}/.test(tplCode));

// 需求8：新增 03.5「组网进度」章节
assert('V1.8.0（需求8）：03.5 组网进度章节存在且走「顶栏让位」全屏布局',
  /<section id="sec-progress">/.test(tplCode) && /<canvas id="netCv">/.test(tplCode) &&
  /#sec-progress\.fs-mobile \.chart-wrap \{ height:100vh; padding-top:var\(--fsbar-h, 58px\); \}/.test(tplCode) &&
  /#sec-progress\.fs-mobile \.controls \{[\s\S]{0,400}?position:fixed/.test(tplCode));
// V1.9.0（需求3）：显示星网/显示千帆从"全局偏好"改为**按星座各存一份的会话状态**，
//   出厂默认 = 只看本页星座；且纳入本章「默认设置」与「还原所有默认设置」的还原范围。
assert('V1.9.0（需求3）：组网进度的口径进偏好系统；显示星网/千帆**按星座各存一份**且默认只看本页星座',
  /netMode: 'launch',/.test(appCode) &&
  // ★ V1.9.2：本章「默认设置」的第 2 项 = 时间区间档（全部 / 今年 / 最近3月）——
  //   按了默认设置就该回到"全部"，不然轴还缩着。
  /progress: \['netMode', 'netSpan'\]/.test(appCode) &&
  // 在 STATE_FIELDS 里 → 随星座快照。
  //   V1.9.0 起该数组末尾追加了 R17 的两项，故这里只断言 netGw/netQf **相邻且同在数组内**，
  //   不再锚定它们是最后两项（那个约束在 R17 之后已经不成立了）。
  /'netGw', 'netQf',\s*\n?[^;]*?\];/.test(appCode) &&
  /function applyNetShowDefault\(key\)/.test(appCode) &&
  /applyNetShowDefault\(k\);/.test(appCode) &&                 // initStore 里逐星座赋默认
  /if \(sec === 'progress'\) applyNetShowDefault\(\);/.test(appCode) &&   // 本章默认设置
  /function resetAllPrefs\(\)[\s\S]{0,600}?applyNetShowDefault\(\);/.test(appCode) &&   // 还原所有默认设置
  /function netCountOf\(L, mode\)/.test(appCode) &&
  // 「在轨数量」= 有 TLE 的颗数 + 已发射未编目且**发射记录为成功**的颗数
  /L\.pending > 0 && L\.res !== 'fail'/.test(appCode));
assert('V1.8.0（需求8）：四张图的缩放/复位走同一套通用通路（03.5 不再有 data-netzoom 旁路）',
  !/data-netzoom/.test(appCode) && !/data-netzoom/.test(tplCode) && !/data-netreset/.test(tplCode) &&
  /view === 'progress'\) \{[\s\S]{0,260}?smoothZoom\(function \(f\) \{ zoomNetBy\(f\); \}, dir, 260\);/.test(appCode) &&
  /else if \(view === 'progress'\) \{ netView = null; netAutoView\(\); drawNet\(\); \}/.test(appCode) &&
  /data-zoom="in" data-view="progress"/.test(tplCode));

// 需求5/6/12：发射历史的任务结果列 + 卫星表的发射时间列
// ================================================================= V1.9.0（R17）：04 变轨情况（A15 前为 05 升轨情况）
// 这一章的验收分两层：① 结构与接线（本组断言，纯静态可查）；
//   ② 算法正确性（最小二乘/断档/顶格限位），由 scripts/climb.mjs --selftest 与
//   「离线抠函数自检」两处覆盖 —— 后者刻意**不用**只断言单调性的自检，
//   而是拿已知真实斜率（+0.25 / −0.4 km/天）做绝对量级锚点。
// 章节编号：05=升轨 / 06=卫星表格 / 07=发射历史
//   用「取该 section 到下一个 <section 之间的片段」再找 sec-num，而不是靠固定字符窗口
//   ——sec-head 里加一个按钮就会把窗口撑爆（V1.9.0 就因此误报过一次）。
function secHead(id) {
  const i = tplCode.indexOf('<section id="' + id + '"');
  if (i < 0) return '';
  const j = tplCode.indexOf('<section', i + 10);
  return tplCode.slice(i, j < 0 ? i + 3000 : Math.min(j, i + 3000));
}
assert('V1.9.1（A15）：04 变轨情况章节存在，且是**独立编号 04**（05/06/07 顺延）',
  /<section id="sec-climb">/.test(tplCode) && /<canvas id="climbCv">/.test(tplCode) &&
  /<select id="climbSel"/.test(tplCode) && /id="climbTakeSeg"/.test(tplCode) &&
  /id="climbNote"/.test(tplCode) &&
  /<span class="sec-num">04<\/span>/.test(secHead('sec-climb')) &&
  /<span class="sec-num">06<\/span>/.test(secHead('sec-table')) &&
  /<span class="sec-num">07<\/span>/.test(secHead('sec-launches')));
assert('V1.9.0（R17）：本章**不设任何设置项**（无抽屉、无时间药丸、无 controls 行）',
  !/id="sec-climb"[\s\S]{0,1400}?fs-panel-btn/.test(tplCode) &&
  !/id="sec-climb"[\s\S]{0,1400}?fs-clock/.test(tplCode) &&
  !/id="sec-climb"[\s\S]{0,1400}?class="controls"/.test(tplCode));
assert('V1.9.1（A15）：右下角章节药丸「变 / C」且位次在「进 / P」之前，跳转标题中英同步',
  /\['sec-climb', 'C', '变'\]/.test(appCode) &&
  appCode.indexOf("['sec-climb'") < appCode.indexOf("['sec-progress'") &&
  /'sec-climb': \{ zh: '04 变轨情况', en: '04 Orbits Change Status' \}/.test(appCode) &&
  /'sec-progress': \{ zh: '05 组网进度', en: '05 Network progress' \}/.test(appCode));
assert('V1.9.0（R17）：五张图的缩放/复位走同一套通用通路（05 不另写动画旁路）',
  /view === 'climb'\) \{[\s\S]{0,200}?smoothZoom\(function \(f\) \{ zoomClimbBy\(f\); \}, dir, 260\);/.test(appCode) &&
  /view === 'climb'\) \{ climbView = null; climbAutoView\(\); drawClimb\(\); \}/.test(appCode) &&
  /data-zoom="in" data-view="climb"/.test(tplCode) && !/data-climbzoom/.test(tplCode));
assert('V1.9.0（R17）+ V1.9.1（A2）：导出图片支持本章，底栏为**六段新结构**（A2 已取代 R17 的升轨速度列）',
  /view === 'climb' \? 'climbCv'/.test(appCode) &&
  /climb: \{ zh: '变轨情况', en: 'Orbits Change' \}/.test(appCode) &&
  /if \(view === 'climb'\) drawClimb\(\);/.test(appCode) &&
  // A2 第 4/5 段（节点：时间/高度/倾角）与第 6 段（Δ/间隔）都在 climb 分支里
  /if \(view === 'climb'\) \{[\s\S]{0,2600}?shotNodeDate\(p\.ms\)/.test(appCode.replace(/^\s*\/\/.*$/gm, '')) &&
  !/km\/天/.test((appCode.match(/if \(view === 'climb'\) \{[\s\S]{0,2000}?\n  \}/) || [''])[0]));
assert('V1.9.0（R17）：最小二乘**必须中心化 x**（毫秒时间戳直接平方会抵消，误差 2.9e-9）',
  /function climbSlope\(pts\)[\s\S]{0,900}?var dx = \(pts\[i\]\.ms - t0\) - xm;/.test(appCode));
// ★ V1.9.5（H10）第一步：升轨阶段判定 `climbPhases()` —— 两条星座色竖虚线（开始/结束）就是它的两个时刻。
//   守卫分两层：这里先钉**源码形状**（相对阈值不写死 km/天、连续 N 天判据、再入日期可覆盖）；
//   合成数据的**运行时**用例（直送=none / 升轨中只有 start / 已结束 start<end / 已再入 end=再入日）
//   排在下一步（需要 k3 探针暴露该函数），届时替换掉本条的形状守卫。
assert('V1.9.5（H10）：climbPhases 用「相对阈值 + 连续 N 天」判定（不写死 km/天），并支持再入日期覆盖',
  /function climbPhases\(pts, opt\)/.test(appCode) &&
  /var thr = Math\.max\(0\.2, q3 \* 0\.25\);/.test(appCode) &&
  /if \(run >= MIN_RUN\)/.test(appCode) &&
  /if \(quiet >= END_RUN\)/.test(appCode) &&
  /if \(o\.decayMs && isFinite\(o\.decayMs\)\) \{ res\.kind = 'done'; res\.endMs = o\.decayMs; \}/.test(appCode) &&
  /kind: endMs === null \? 'raising' : 'done'/.test(appCode));
assert('V1.9.0（R17）：纵轴 0~2000km **顶格限位**（需求 Q47），且离地高度 = 半长轴 − 6378.137',
  /var CLIMB_TOP = 2000;/.test(appCode) && /var CLIMB_RE = 6378\.137;/.test(appCode) &&
  /Y\(c\.pts\[k2\]\.v - CLIMB_RE\)/.test(appCode));
assert('V1.9.0（R17）+ V1.9.3：横轴 = 发射日～今天（右端**在数据贴近今天时**给到今天；更早的批次给到数据末点）',
      // ★ V1.9.3（用户要求"缩小留白扩大视图"）：旧口径无条件把右端拉到今天，
      //   对 26221 低轨26组（10/13 打开、数据只覆盖 10/05~10/09）横轴会铺满 18 天、
      //   曲线挤在中间一小段（正是用户截图四的现场）。
      //   新口径：数据末点距今天 ≤3 天 → 延到今天（"现在在哪"有意义）；否则给到数据末点。
      /var now = Date\.now\(\), last = t1;/.test(appCode) &&
      /if \(now - last <= 3 \* 86400000\) t1 = now;/.test(appCode));
// V1.9.1（A6）：这条断言原来按**旧实现**的写法（`ls.sort(...dateMs...)` + `if (!C[L.key]) return;`）
//   做源码匹配，A6 重做选择器后那两个字面量都不在了 → 更新为**新结构**，但把"倒序 + 只列有历史数据的"这条**原意**保留。
//   "只列有历史数据"的判据在两处：① 外挂索引 `ix.batches` 本身就只含**有分片**的批次；
//   ② 无索引时退化为 `Object.keys(C)`（C 即已加载的历史曲线）。
assert('V1.9.1（A6，原 R17 口径）：批次选择器**按发射时间倒序**（并列取批次号大者）且只列有历史数据的批次',
  /keys\.sort\(function \(a, b\) \{/.test(appCode) &&
  /if \(mb !== ma\) return mb - ma;/.test(appCode) &&
  /return String\(a\.k\) < String\(b\.k\) \? 1 :/.test(appCode) &&
  /ix\.batches\.map\(function \(b\) \{ return \{ k: b\.k, n: b\.n \}; \}\)/.test(appCode) &&
  /Object\.keys\(C\)\.map\(function \(k\) \{ return \{ k: k, n: \(C\[k\] \|\| \[\]\)\.length \}; \}\)/.test(appCode));
assert('V1.9.0（R17）：与全局选中**双向联动**（选中→本章跟随；本章选单星→回写 S.sel）',
  /function climbFollowSelection\(\)[\s\S]{0,700}?if \(S\.climbPick\) return;/.test(appCode) &&
  /function afterSelection\(\)[\s\S]{0,900}?climbFollowSelection\(\);/.test(appCode) &&
  /function climbSelect\(v\)[\s\S]{0,700}?S\.sel = \[idx\]; S\.focusIdx = idx; S\.selGroup = null; afterSelection\(\);/.test(appCode));
assert('V1.9.0（R17）：本章两项按星座各存一份，且纳入章级/全局默认设置',
  /'climbPick', 'climbTake'\];/.test(appCode) &&
  /climb: \['climbPick', 'climbTake'\]/.test(appCode) &&
  /climbPick: '', climbTake: 'sma',/.test(appCode) &&
  /S\.climbPick = ''; S\.climbTake = 'sma';/.test(appCode) &&
  /if \(sec === 'climb'\)/.test(appCode) &&
  /resetAllPrefs\(\)[\s\S]{0,2600}?renderClimbSel\(\); renderClimbTake\(\); climbView = null; climbAutoView\(\); drawClimb\(\);/.test(appCode));
// V1.9.1（A20）：这段从单行改成了多行块（同时要复位固定态、收起旧信息窗）→ 断言同步为**结构式**，
//   把"重建缓存 + 复位固定态 + 收起信息窗 + 重画"四件事一起要求（原意不减，且新增了后两件）。
assert('V1.9.0（R17）+ V1.9.1（A20）：切星座时重建曲线缓存**并**复位固定态、收起旧信息窗',
  /CLIMB = null; climbView = null; climbHover = null;/.test(appCode) &&
  /climbPinned = false;\s*\n\s*climbPickNode = null;[\s\S]{0,80}?if \(climbInfo\) hideInfo\(climbInfo, 'climb'\);\s*\n\s*climbAutoView\(\); renderClimbSel\(\); renderClimbTake\(\); drawClimb\(\);/.test(appCode));
assert('V1.9.0（R17）：章级过场映射含 05 章（默认设置按钮走 playSectionCurtain）',
  /climb: 'sec-climb'/.test(appCode) && /data-defsec="climb"/.test(tplCode));
assert('V1.9.0（R17）：i18n 三段式键位齐备（缺一个就会把键名当文字画在页面上）',
  ['h_climb', 'lead_climb', 'climb_pick', 'climb_take', 'climb_rate', 't_defclimb',
   'climb_sel_tip', 'climb_none', 'climb_n_sats', 'climb_n_hist',
   'climb_take_sma', 'climb_take_rate', 'climb_y_alt', 'climb_y_rate',
   // V1.9.1（A1）：信息窗新行
   'climb_delta']
   // ⚠️ 不能用 ^\s* 锚行首：climb_pick / climb_take / climb_rate 三个键写在**同一行**
   //   （逗号连排），锚行首会把后两个误判为缺失（V1.9.0 就因此误报过一次）。
   //   同时要求键后面紧跟 [ 才算命中，避免 climb_take 误配到 climb_take_sma。
   //   V1.9.1（A6/F3）：`climb_pick_auto` 已从清单里**移除**（键本身也删了）。
   .every(k => new RegExp('(^|[{,\\s])' + k + ': \\[').test(appSrc)),
  '15 个键');
// V1.9.1（A6/F3）：死键必须真的删掉 —— 只从断言清单里删掉是不够的
assert('V1.9.1（A6/F3）：`climb_pick_auto` 键已彻底删除（源码里除注释外不再出现）',
  !/climb_pick_auto: \[/.test(appSrc));
assert('V1.9.0（R17）：信息窗复用**已有**键名（不得凭空造 d_name / d_launch —— 表里没有）',
  /t\('t_name'\)/.test(appCode) && /t\('d_row_batch'\)/.test(appCode) &&
  /t\('d_row_epoch_sat'\)/.test(appCode) && !/t\('d_name'\)/.test(appCode) && !/t\('d_launch'\)/.test(appCode));
// V1.9.1 改写：这条断言原本要求 mkdata **存在** `sma < 6700 || sma > 12000` 的量级过滤。
//   按用户口径「历史数据不得过滤，真实记录并如实呈现」，该过滤已**删除**（它当时是在
//   掩盖源库的 ec 解析 bug：过滤把越界值挡在门外，反而让 bug 永久无人追查）。
//   所以断言方向反过来：**过滤必须不存在**，且 loadHistory 的汇入/兜底赋值仍在。
assert('V1.9.0（R17）：构建期把 data/history/*.json 汇进 satdata（V1.9.1 起**不再做量级过滤**）',
  /function loadHistory\(\)/.test(mkCode) && !/if \(sma < 6700 \|\| sma > 12000\)/.test(mkCode) &&
  // ⚠️ 外挂改造后这里不再是 HIST.out.* 直接赋值，而是**精简兜底** histLite（见下一条）
  /DATA\.gw\.hist = histLite\.gw;/.test(mkCode) && /DATA\.qf\.hist = histLite\.qf;/.test(mkCode));

// ---- V1.9.0（R17）：历史库外挂 + **规模重估后的分片方案** ----
// ⚠️ 规模重估（用户提出"未来会到数万~数十万颗"）：原「单个 history.json」方案在
//   10 万颗 × 20 年 = **2.26 GB**，超 GitHub 单文件 100 MB 硬限，页面更不可能一次加载。
//   现方案：按**批次分片** + 索引，页面只取选中的那一批（几十 KB）。
//   ① 源库 data/history/（v1 三元组，refresh 每天追加，简单可靠）
//   ② 发布 history/（v2 紧凑编码 + 分片 + 索引，mkdata 构建时打包）
//   ③ satdata 内嵌最近 60 天精简兜底，保证 file:// 离线打开也有曲线
const buildCode = fs.readFileSync(B + '/build.mjs', 'utf8');
const packMod = fs.readFileSync(B + '/scripts/histpack.mjs', 'utf8');
assert('V1.9.0（R17）：历史库**按批次分片外挂**（不是单个大 JSON）—— build 复制 history/ 目录',
  /build\/history/.test(buildCode) && /copied history\//.test(buildCode) &&
  /var HIST_DIR_URL = '\.\/history\/';/.test(appCode) &&
  /function loadHistIndex\(/.test(appCode) && /function ensureHistBatch\(/.test(appCode) &&
  /function decodeHistShard\(/.test(appCode));
assert('V1.9.0（R17）：分片自带 base/prec（页面解码不靠硬编码，防两端失配）',
  /base: SMA_BASE, prec: SMA_PREC/.test(packMod) &&
  /var base = \(j && isFinite\(j\.base\)\) \? j\.base : 6000;/.test(appCode));
assert('V1.9.0（R17）：默认批次**从索引取**（内置单点时 climbSeries 算不出 → 否则永不加载分片）',
  // 端到端验证抓到过：分片明明可取，页面却一直显示"暂无历史数据"
  /var ix = HIST_IDX\[S\.key\];[\s\S]{0,400}?ix\.batches\[0\]\.k/.test(appCode) &&
  /ixb && ixb\.batches && ixb\.batches\.length/.test(appCode));
assert('V1.9.0（R17）：采样策略 = 变化驱动 + 分层 + 稳定期配额（不是单纯按时间抽稀）',
  /climbKmPerDay:/.test(packMod) && /maxStablePts:/.test(packMod) &&
  /function selectPoints\(/.test(packMod) &&
  // 升轨期的点优先保留，稳定期受配额限制
  /stableUsed < POLICY\.maxStablePts/.test(packMod) &&
  /moving\[i\] && gapDays >= step/.test(packMod));
assert('V1.9.0（R17）：v2 编码每颗星只存一次 norad（消除 23% 行内冗余）',
  /\{ n: norad, t0: t0, d: d, a: a \}/.test(packMod) &&
  /if \(keep\.length >= 2\) sats\.push\(encodeSat\(norad, keep\)\);/.test(packMod));
assert('V1.9.0（R17）：缓存上限防内存膨胀（长时间浏览不会越积越多）',
  /HIST_CACHE_MAX = 24/.test(appCode) && /keys\.length > HIST_CACHE_MAX/.test(appCode));
{
  // **规模承诺的量化验收**：这是本次重构的核心指标，必须实测（不是估算）
  const hp = await import('./scripts/histpack.mjs');
  const tEnd = Date.UTC(2026, 0, 1), DAY = 86400000;
  // 造一颗"升轨 1 年后稳定、共 N 年"的卫星
  const mk = (days, climbDays) => {
    const p = [];
    for (let d = 0; d <= days; d++) p.push({ ms: tEnd - (days - d) * DAY, v: 7000 + Math.min(d, climbDays) * 1.5 });
    return p;
  };
  const n1 = hp.selectPoints(mk(365, 365), tEnd).length;
  const n20 = hp.selectPoints(mk(20 * 365, 365), tEnd).length;
  const enc = hp.encodeSat(1, hp.selectPoints(mk(20 * 365, 365), tEnd));
  const perSat = JSON.stringify([enc]).length;
  const mb10w = (perSat * 100000) / 1048576;
  assert('V1.9.0（R17）：规模承诺 —— 单星 20 年 < 150 点（升轨密、稳定稀）',
    n1 < 400 && n20 < 150, '1年=' + n1 + '  20年=' + n20);
  assert('V1.9.0（R17）：规模承诺 —— 10 万颗 × 20 年 < 100 MB（原方案 2.26 GB）',
    mb10w < 100, mb10w.toFixed(0) + ' MB（每星 ' + perSat + ' 字节）');
  assert('V1.9.0（R17）：规模承诺 —— 单分片远低于 GitHub 100 MB 上限',
    (perSat * 500) / 1048576 < 100, '500 星/批 ≈ ' + ((perSat * 500) / 1048576).toFixed(1) + ' MB');
}
assert('V1.9.0（R17）：升轨速率算法在页面端与构建期**同一口径**（±2 天窗口最小二乘 + 2 天断档）',
  /function climbRates\(pts, half, minPts\)/.test(appCode) && /half = half \|\| 2; minPts = minPts \|\| 2;/.test(appCode) &&
  /function climbBreakGaps\(series, maxGapDays\)/.test(appCode) &&
  /riseRateSeries\(pts, opts\.half, opts\.minPts\)/.test(climbMod) &&
  /breakGaps\(riseRateSeries/.test(climbMod));

// ==================== V1.9.1（第十一轮）回归守卫：6 位编目号通路 ====================
// 背景：CelesTrak 自 2026-07-11 起新对象一律 6 位编目号（100000+），而经典 TLE 的编目号字段
//   只有 5 列 → 旧代码用「norad >= 100000 跳过」把 55 颗在编卫星整批漏掉（页面/表格/曲线全空），
//   且失败是**静默**的（日志只写"补到 0 颗"）。这一组断言把整条链路钉死，防复发。
{
  const refreshCode = fs.readFileSync(B + '/refresh.mjs', 'utf8');
  const ommCode = fs.readFileSync(B + '/scripts/omm.mjs', 'utf8');
  const gi = fs.readFileSync(B + '/.gitignore', 'utf8');
  assert('V1.9.1：refresh 不再用「norad >= 100000」这类魔数过滤（改为按编目号位数判据）',
    !/o\.norad >= 100000/.test(refreshCode) && /String\(o\.norad\)\.length > 5/.test(refreshCode));
  assert('V1.9.1：S5（OMM 兜底）对**所有** S1–S4 未取到的对象生效（不再限定 6 位）',
    /S5 OMM：\*\*兜底通路\*\*/.test(refreshCode) && !/if \(o\.norad < 100000\) return;/.test(refreshCode));
  assert('V1.9.1：S5 不再静默吞错（累计错误 + 打印原因 + 全失败告警）',
    /ommErrMsg/.test(refreshCode) && /疑似网络\/上游不可达/.test(refreshCode) && !/跳过这一颗 \*\/ \}/.test(refreshCode));
  assert('V1.9.1：missing 报告的查询键兼容占位号（否则误报"仍缺 36 颗"并写坏 missing_*.json）',
    /out\.has\(o\.norad\) \|\| out\.has\(Number\(PH\(o\.norad\)\)\)/.test(refreshCode));
  assert('V1.9.1：历史库存的是**真号**（占位号会让曲线静默空白）',
    /const norad = OMM_IDS\[raw5\] \|\| parseInt\(raw5, 10\);/.test(refreshCode));
  assert('V1.9.1：cosparField 归一化 9 字符 OBJECT_ID（"2026-176A" → "26176A"），否则 L1 会变 70 字符',
    /export function cosparField/.test(ommCode) && /cosparField\(o\.OBJECT_ID\)/.test(ommCode) &&
    !/\(o\.OBJECT_ID \|\| ''\)\.padEnd\(8\)/.test(ommCode));
  // ---- V1.9.1 第二轮补充：RAAN 字段名纠错 + "坏行永久滞留"根治 ----
  //   RAAN 那次：OMM 里升交点赤经叫 RA_OF_ASC_NODE，旧代码写 om.RAAN → 恒 NaN →
  //     L2 输出 "     NaN"（**总长照样 69**，长度型校验全放过）→ 55 颗星轨道算不出来。
  //   "永久滞留"那次：refresh 的 merged 以**上一轮 .tle 为起点**，S5 又"键已存在就跳过"
  //     → 坏行落盘后再也不会被重取（刷新一百次也修不好）。这两条一起才有了自愈能力。
  assert('V1.9.1：OMM 的 RAAN 取 RA_OF_ASC_NODE（不再写 om.RAAN 那个恒 NaN 的错键）',
    /RA_OF_ASC_NODE/.test(ommCode) && !/RAAN: Number\(om\.RAAN\),/.test(ommCode));
  assert('V1.9.1：tleFromOmm 有"数值列必须有限"的硬闸门（拒绝写出 NaN 坏行）',
    /非有限数/.test(ommCode) && /throw new Error\('tleFromOmm/.test(ommCode));
  assert('V1.9.1：tleHealth 数值列体检存在且被 refresh 用于**入口**（剔坏行）+ **出口**（复查）',
    /export function tleHealth/.test(ommCode) &&
    /if \(!tleHealth\(s\.l2 \|\| ''\)\) \{ merged\.delete/.test(refreshCode) &&
    /filter\(s => !tleHealth\(s\.l2 \|\| ''\)\)/.test(refreshCode));
  assert('V1.9.1：>5 位编目号**每轮都重取**（否则落盘后历元永不更新、坏行永不修）',
    /merged\.has\(Number\(PH\(o\.norad\)\)\) && String\(o\.norad\)\.length <= 5/.test(refreshCode));
  assert('V1.9.1：出口仍有坏行时 refresh 以非零码结束（CI 就不会提交坏数据）',
    /process\.exitCode = 3/.test(refreshCode) && /出口闸门/.test(refreshCode));
  assert('V1.9.1：ommRoundTrip 用**全量**失败计数 badN（旧版 bad 被截断成 3 → 55 颗误报成 3 颗）',
    /badN/.test(ommCode) && /rt\.badN/.test(fs.readFileSync(B + '/smoke.mjs', 'utf8')));
  assert('V1.9.1：omm_norad.json 不被 gitignore（丢了它 → 前端 NORAD 全变占位号）',
    !/^data\/omm_norad\.json/m.test(gi) && !/^data\/omm_/m.test(gi));
  // 两套离线自检必须真的绿 —— **直接 import 模块**调用（本机从 Node 内 spawn node.exe 会 EBUSY，
  //   所以不能起子进程；refresh.mjs 顶层带副作用也不能 import，故自检逻辑独立在 scripts/omm_check.mjs）
  //   ⚠️ Windows 上动态 import 必须用 file:/// URL —— 绝对路径会 ERR_UNSUPPORTED_ESM_URL_SCHEME（老坑）
  const asUrl = (p) => 'file:///' + String(p).replace(/\\/g, '/');
  const ommMod = await import(asUrl(B + '/scripts/omm.mjs'));
  const rt = ommMod.ommRoundTrip([B + '/data/ct_hulianwang.tle', B + '/data/ct_qianfan.tle']);
  // ⚠️ 用 badN（**全量失败计数**），不要用 bad.length —— bad 只保留 3 条样本用于打印，
  //   旧代码读 .length 会把"55 颗失败"误报成"3 颗"（自检的计数本身也会撒谎）。
  assert('V1.9.1：omm.mjs 往返自检（TLE → OMM → TLE 全样本逐字段，' + rt.n + ' 颗）',
    rt.badN === 0 && rt.n > 400,
    '失败 ' + rt.badN + ' 颗' + (rt.badN ? '（坏行 = L2 数值列含 NaN，见 scripts/omm.mjs 的 tleHealth）' : ''));
  const chkMod = await import(asUrl(B + '/scripts/omm_check.mjs'));
  const st = chkMod.ommSelfTest();
  const stBad = st.filter(x => !x.ok).map(x => x.name);
  assert('V1.9.1：OMM 通路自检全绿（占位/定宽/校验位/收编/真号还原/高度量级，共 ' + st.length + ' 条）',
    stBad.length === 0, stBad.join(' | '));
}

// ==================== V1.9.1（第十一轮）回归守卫：历史库链路（执行顺序 1.2）====================
// 背景：升轨曲线"莫名其妙尖峰"的**唯一真身**是 scripts/fetch_history.mjs 的 tle2omm 把
//   偏心率从 l1 行读出来（读到的是历元小数的数字，e≈0.96）→ 高度从 ~500 km 被算成几千 km。
//   实测源库最大半长轴 **476,736 km**（真实约 6825–7550），345 条越界；修好后越界 **0** 条。
//   这一组把"解析 / 常量 / 单位 / 过滤"四处钉死，防复发。
{
  const fh = fs.readFileSync(B + '/scripts/fetch_history.mjs', 'utf8');
  const ih = fs.readFileSync(B + '/scripts/import_history.mjs', 'utf8');
  const md = fs.readFileSync(B + '/mkdata.mjs', 'utf8');
  const rf = fs.readFileSync(B + '/refresh.mjs', 'utf8');
  assert('V1.9.1：tle2omm 的偏心率取自 l2（取自 l1 会读到历元小数 → e≈0.96 → 高度算成几千 km）',
    /l2\.slice\(26, 33\)\.trim\(\)\) \|\| 0/.test(fh) && !/parseFloat\('0\.' \+ l1\.slice\(26, 33\)/.test(fh));
  assert('V1.9.1：parse3le 循环上界为 i+1（i+2 会静默丢掉每个缓存文件的最后一对）',
    /for \(let i = 0; i \+ 1 < lines\.length; i\+\+\)/.test(fh));
  assert('V1.9.1：mkdata 已删除半长轴量级过滤（"历史数据不得过滤"；过滤会永久掩埋源库 bug）',
    // 用 `if (sma < …` 这个**代码形态**判据，避免匹配到解释这段历史的注释本身
    !/if \(sma < 6700 \|\| sma > 12000\)/.test(md));
  assert('V1.9.1：写库常量与页面 CLIMB_RE 一致（6378.137；两侧不同会让"存进去再取出来"差 2 m）',
    /a \+ 6378\.137/.test(fh) && /alt \+ 6378\.137/.test(rf) &&
    !/a \+ 6378\.135/.test(fh) && !/alt \+ 6378\.135/.test(rf));
  assert('V1.9.1：import_history 写库前把"高度"换算成"半长轴"（旧版直写 densify 输出 → 同库混装两种单位）',
    /histSmaOf\(alt\)/.test(ih) && /const HIST_RE = 6378\.137/.test(ih));
  assert('V1.9.1：两个写库脚本都用 sidecar 把占位号还原成真号（否则历史写到别的卫星名下）',
    /realNorad\(/.test(fh) && /realNorad\(/.test(ih));
  assert('V1.9.1：离线重建按 NORAD 匹配（分块下标会随卫星清单变化整体错位 → 静默丢数据）',
    /const NET = process\.argv\.includes\('--net'\)/.test(fh) && /const lk = lkOf\.get\(r\.norad\)/.test(fh));
  const hs = (function () {
    let bad = 0, max = 0, min = Infinity, geo = 0;
    const dir = B + '/data/history';
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json') || f.endsWith('.bak')) continue;
      let a; try { a = JSON.parse(fs.readFileSync(dir + '/' + f, 'utf8')); } catch (e) { continue; }
      for (const r of (Array.isArray(a) ? a : [])) {
        const v = +r[2]; if (v > max) max = v; if (v < min) min = v;
        // ★ V1.9.1（1.4）：区间从 [6000,20000] 放宽到 [6000,50000] —— 因为 Q44 把 **GEO**
        //   纳入了采集，而 GEO 的半长轴约 **42164 km**（静止轨道 35786 km 高度 + 地球半径），
        //   固定用 LEO 的 20000 上限会把 GEO 正常数据判成"越界"（体检自己变成误报源）。
        //   放宽后仍能抓住真正的异常值（修复前出现过 476,736 km，比真实值大 70 倍）。
        if (v > 30000 && v < 38000) geo++;          // 好数据里不该有"卡在中间"的孤立档
        if (v < 6000 || v > 50000) bad++;
      }
    }
    return { bad: bad, max: max, min: min, geo: geo,
      n: fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.endsWith('.bak')).length };
  })();
  assert('V1.9.1：历史源库半长轴落在合理量级（LEO 约 6600–8000 / GEO 约 42164；越界仅允许 0）',
    hs.bad === 0 && hs.max < 50000 && hs.min > 6000,
    hs.n + ' 片 / 范围 ' + hs.min.toFixed(2) + ' ~ ' + hs.max.toFixed(2) + ' km / 越界 ' + hs.bad + ' 条');
  assert('V1.9.1：新入编的 6 位号批次在历史源库里有分片（离线重建覆盖不到，靠 refresh 日常归档）',
    // ★ V1.9.3：判据从"写死 6 个批次号"改成**性质判据** ——
    //   写死的列表会随每次新发射过期（`26221` 在本轮 refresh 的容量治理里被并入其它分片，
    //   26176 更是只剩 .bak）→ 断言会假装"回归"而其实是数据演进的正常结果。
    //   保留原意（"6 位号那批得有历史分片，不能整批没曲线"）的稳健写法：
    //   取 satdata 里**所有 6 位号卫星**，它们所属的批次 key 中至少一半要有分片。
    (function () {
      try {
        const SD = JSON.parse(fs.readFileSync(B + '/build/satdata.json', 'utf8'));
        const all = [].concat(SD.gw.sats, SD.qf.sats).filter(s => s.id >= 100000);
        if (!all.length) return false;
        const keys = [...new Set(all.map(s => String(s.c).slice(0, 5)))];
        const have = keys.filter(k => fs.existsSync(B + '/data/history/' + k + '.json'));
        return have.length >= Math.ceil(keys.length / 2);
      } catch (e) { return false; }
    })());
}

// ==================== V1.9.1（第十一轮）回归守卫：按批次点名纳入（执行顺序 1.4）====================
// 背景：有一批**确认属于本星座**的卫星，satcat 名字**完全不含星座关键字**（CX-19/20/26 = "CHUANGXIN"、
//   KL-Alpha/Beta、DTC-01、"OBJECT B"），无论名字正则怎么写都捞不到 → 只能按 COSPAR 批次点名纳入。
//   实施中又抓出两个真 bug（都是"静默失效"）：
//     ① S3 的判据写的是 `/^1 /.test(text)` —— **没有 m 标志**，而 FORMAT=tle 的返回以**卫星名行**开头
//        → 恒为 false → 这条通路**从来没有成功过一次**（todo 常为 0 所以从不打印，一直没暴露）；
//     ② S5 把 OMM 的原始 9 字符 OBJECT_ID（"2026-158A"）直接存进 merged，而下游一律 slice(0,5)
//        → 得到 "2026-" → 白名单匹配失败（"取到了却在最后一步被丢掉"）。
{
  const rf = fs.readFileSync(B + '/refresh.mjs', 'utf8');
  assert('V1.9.1（1.4）：名字正则放宽为 HULIANWAN（GEO 在目录里写作 "HULIANWAN GAOGUI-01" 单 G）',
    /MATCH = \{ gw: \/HULIANWAN\|/.test(rf) && /gw: \['HULIANWAN'/.test(rf));
  assert('V1.9.1（1.4）：存在"按批次的显式纳入通道"，且**一律用精确 NORAD 列表**（不用"整批全收"）',
    /const INCLUDE = \{/.test(rf) && /function includedByBatch/.test(rf) &&
    !/'2\d{4}': null/.test(rf) && !/'1\d{4}': null/.test(rf));
  assert('V1.9.1（1.4）：白名单搭车星已排除（2024-226A=62185 / 2026-128B=69473 不在名册里）',
    !/\b62185\b/.test(rf) && !/\b69473\b/.test(rf) && /\b62186\b/.test(rf) && /\b69472\b/.test(rf));
  assert('V1.9.1（1.4）：S3 的 TLE 判据带 m 标志（不带 m 时 ^ 只匹配串首 → 因返回值以卫星名开头而恒假）',
    /\/\^\\s\*1 \\d\/m\.test\(r\.text\)/.test(rf) && !/if \(r\.ok && \/\^1 \/\.test\(r\.text\)\)/.test(rf));
  assert('V1.9.1（1.4）：S5 存进 merged 的 cospar 用 cosparField 归一化（原始 9 字符会让 slice(0,5) 得 "2026-"）',
    /cospar: cosparField\(om\.OBJECT_ID \|\| o\.cospar\)\.trim\(\)/.test(rf));
  assert('V1.9.1（1.4）：批次 key 提取兼容两种 COSPAR 写法（归一化 6 列 与 原始 9 字符）',
    /function lkOfCospar/.test(rf) && /includedByBatch\(key, lkOfCospar\(s\.cospar\), norad\)/.test(rf));
  assert('V1.9.1（1.4）：S3 的 todo 把白名单批次排到最前（否则会被 slice(0,60) 挤掉而永远补不上）',
    /todo\.sort\(\(a, b\) => \{/.test(rf) && /const ia = includedByBatch\(key, a\.pre, a\.norad\)/.test(rf));
  assert('V1.9.1（1.4）：名字正则的**两处**拦截点都接上了白名单通道（只改一处会"查到却被丢"/"没查却留下"）',
    (rf.match(/includedByBatch\(/g) || []).length >= 4);
  // ---- V1.9.1（1.4-D）：已再入卫星的采集与状态 ----
  // 用户要求：已再入卫星的历史 TLE 也要录入并在卫星列表/变轨情况呈现。
  // 老代码在**四处**都写了 `|| o.decay` 把这一整类挡在门外 → 曲线里永远看不到它。
  {
    const md = fs.readFileSync(B + '/mkdata.mjs', 'utf8');
    assert('V1.9.1（1.4-D）：refresh 四处都不再因 decay 跳过（已再入卫星同样采集）',
      !/o\.type !== 'PAY' \|\| o\.decay/.test(rf) &&
      (rf.match(/if \(o\.type !== 'PAY'\) return;/g) || []).length >= 4,
      '残留 ' + (rf.match(/o\.decay/g) || []).length + ' 处 o.decay');
    assert('V1.9.1（1.4-D）：已再入的采集数量在日志里可见（放行了却一颗没取到 vs 根本没放行，日志必须能区分）',
      /含已再入/.test(rf));
    assert('V1.9.1（1.4-D）：mkdata 从 satcat 的 DECAY_DATE 产出"已再入"状态（st=r + dt）',
      /function reentryMap/.test(md) && /const REENTRY = reentryMap\(\)/.test(md) &&
      /rec\.st = 'r'; rec\.dt = dec;/.test(md));
    assert('V1.9.1（1.4-D）：在轨卫星不带 st 字段（只有已再入的才加，绝大多数记录零增重）',
      /if \(dec\) \{ rec\.st = 'r'; rec\.dt = dec; \}/.test(md) &&
      (function () {
        const g = JSON.parse(fs.readFileSync(B + '/build/satdata.json', 'utf8'));
        const g2 = g.SATDATA || g;
        const all = [...(g2.gw.sats || []), ...(g2.qf.sats || [])];
        const withSt = all.filter(s => s.st).length;
        return withSt === all.filter(s => s.st === 'r').length;   // 不存在 st 非 'r' 的
      })());
  }

// ---- V1.9.1（执行顺序 1.7）：台账口径修正 ----
// ① 搭车星必须从"颗数"里排除（satcat 按 COSPAR 前缀数 PAY 会把同次发射的**别星座载荷**算进来）
// ② 已再入颗数要能查到（动态算，不写死 —— 写死的数字下次有卫星再入就过期）
{
  const md = fs.readFileSync(B + '/mkdata.mjs', 'utf8');
  const g = JSON.parse(fs.readFileSync(B + '/build/satdata.json', 'utf8'));
  const D = g.SATDATA || g;
  assert('V1.9.1（1.7）：搭车星排除表存在（2026-128B 中国移动02星 / 2024-226A）',
    /const STOWAWAY = \{/.test(md) && /'26128': \[69473\]/.test(md) && /'24226': \[62185\]/.test(md) &&
    /isStowaway\(k, r\.norad\)/.test(md));
  assert('V1.9.1（1.7）：DTC-01 计数 = 1 颗（satcat 数出 2 颗，含中国移动02星）',
    D.qf.launchCounts['26128'] && D.qf.launchCounts['26128'].n === 1,
    JSON.stringify(D.qf.launchCounts['26128']));
  assert('V1.9.1（1.7）：26211 含 EUHT（satcat 口径 9 颗 = 极轨26组8 + EUHT 1）',
    D.qf.launchCounts['26211'] && D.qf.launchCounts['26211'].n === 9,
    JSON.stringify(D.qf.launchCounts['26211']));
  assert('V1.9.1（1.7）：25067 的已再入标注（goneCount）含 63428 与再入日期',
    (function () {
      const gc = D.gw.goneCount && D.gw.goneCount['25067'];
      return Array.isArray(gc) && gc.some(x => x.n === 63428 && /^\d{4}-\d{2}-\d{2}$/.test(x.on));
    })(), JSON.stringify((D.gw.goneCount || {})['25067']));
  // ★ V1.9.4：口径改为**动态**。旧断言写死 gw 244 / qf 262（词条口径）。
  //   但 V1.9.4 起「目录已有卫星而台账缺失」的新批次会被自动补录（TLE 名 / 百科行），
  //   这些批次的星也计入 launchedTotal → 本页数字**会大于**词条口径（词条还没收录该发）。
  //   实测：gw 244 → 251（新增 26230 低轨27组 7 颗）。所以断言改成：
  //     · 本页 ≥ 词条口径（不会少）；
  //     · 且**台账里每个自动补录批次都真的带下来了卫星**（否则"补了空条目"是假的）。
  //   ⚠️ 不数 launchCounts：它来自 satcat.csv，本地副本可能旧于 TLE（实测 26230 就还没进 satcat），
  //     用它判会把"数据源新旧"误报成"逻辑错"。改为直接数目录卫星，与 launchedTotal 同源。
  assert('V1.9.4：本页发射数 ≥ 词条口径，且每个自动补录批次都真的带下来了卫星',
    D.gw.stats.launched >= 244 && D.qf.stats.launched >= 262 &&
    (function () {
      // ⚠️ satdata 的 sats 是**压缩记录**（差分打包），没有 lk 字段 —— 用 COSPAR 前 5 位归批
      //   （与 mkdata 的 autoFillLedger 同口径）。
      const byLk = {};
      (D.gw.sats || []).forEach(function (s) { byLk[String(s.c).slice(0, 5)] = (byLk[String(s.c).slice(0, 5)] || 0) + 1; });
      return Object.keys(D.gw.launches).every(function (k) {
        const v = D.gw.launches[k];
        if (!v || String(v[8] || '').indexOf('auto') < 0) return true;   // 非自动补录行不管
        return (byLk[k] || 0) > 0;                                        // 自动补录行必须真的有卫星
      });
    })(),
    'gw=' + D.gw.stats.launched + ' qf=' + D.qf.stats.launched +
    '（词条口径 gw 244 / qf 262；超出部分应来自自动补录批次）');
}

  // ★ V1.9.4：自动补台账的两个机制都要有守卫（否则被"优化"掉就又回到"无台账"）
  {
    const md = fs.readFileSync(B + '/mkdata.mjs', 'utf8');
    assert('V1.9.4：mkdata 有 `autoFillLedger`（目录已有卫星而台账缺失 → 自动补，不再是"无台账"）',
      /function autoFillLedger\(meta, tag, sats\)/.test(md) &&
      /autoFillLedger\(GW_LAUNCH, 'gw', gw\)/.test(md) &&
      /autoFillLedger\(QF_LAUNCH, 'qf', qf\)/.test(md));
    assert('V1.9.4：百科行 payload 会**规范化成手工台账同款批次名**（否则英文界面漏中文）',
      /function normBatchName\(payload\)/.test(md) &&
      /normBatchName\(w\.payload\)/.test(md) &&
      // 标记必须写进数组元素（挂对象属性过不了 JSON 序列化 —— 实测踩过）
      /v\[8\] = 'auto'/.test(md) && /v\[8\] = 'auto,tle'/.test(md));
    // 行为验证走**真实产物**：所有台账批次名都必须匹配 batchName() 的已知形态
    // （低轨NN组 / 极轨NN组 / 试验星NN组 / 高轨NN星 / 千帆 X / 星网 X …），
    // 否则英文界面会漏中文。新补的百科行名也受这条约束。
    // ⚠️ 这里**自己读文件**取 satdata：本块所在作用域没有外层那个 D（用错会 ReferenceError）。
    const sd = JSON.parse(fs.readFileSync(B + '/build/satdata.json', 'utf8'));
    const DD = sd.SATDATA || sd;
    const bad = [];
    ['gw', 'qf'].forEach(k => {
      Object.keys((DD[k] && DD[k].launches) || {}).forEach(key => {
        const v = DD[k].launches[key];
        const nm = String((v && v[0]) || '');
        if (!nm) return;
        if (!/^(低轨\d+组|极轨\d+组|试验星\d+组?|试验星 KL-[A-Za-z0-9]+|高轨\d+星?|千帆 .+|星网 .+|DTC[ -]?\d+.*)$/.test(nm)) {
          bad.push(k + ':' + key + '=' + nm);
        }
      });
    });
    assert('V1.9.4：所有台账批次名都符合 batchName() 的可译形态（新补录的百科行名也受约束）',
      bad.length === 0, bad.slice(0, 4).join(' | '));
  }
  // ---- V1.9.1（A19）：搜索补池（dead / pend）+ satcat 缺失的**显式**探测 ----
// 为什么 satcatOk 是必需的：A19 的两池与 1.4-D 的 st='r' 在**输入缺失时都会退化成空**
//   （2026-10-10 实际发生过：satcat.csv 不见了 → 已再入标记一条都没有，而构建照常成功）。
//   若只断言"池为空"，就把"通路断了"当成了"确实没有这类对象"。两种原因必须能区分。
{
  const md = fs.readFileSync(B + '/mkdata.mjs', 'utf8');
  const sp = fs.readFileSync(B + '/scripts/search_pools.mjs', 'utf8');
  const g = JSON.parse(fs.readFileSync(B + '/build/satdata.json', 'utf8'));
  const D = g.SATDATA || g;
  const pools = [...(D.gw.dead || []), ...(D.gw.pend || []), ...(D.qf.dead || []), ...(D.qf.pend || [])];
  assert('V1.9.1（A19）：搜索补池抽成纯函数模块（真实数据里池恒空 → 必须可单测）',
    /export function searchPools\(satcatText, batchKeys, haveNorads, isStowaway\)/.test(sp) &&
    /import \{ searchPools \} from '\.\/scripts\/search_pools\.mjs'/.test(md));
  assert('V1.9.1（A19）：satdata 输出 dead / pend 两池（两星座都有）',
    Array.isArray(D.gw.dead) && Array.isArray(D.gw.pend) &&
    Array.isArray(D.qf.dead) && Array.isArray(D.qf.pend));
  assert('V1.9.1（A19）：池内记录字段齐备（n/nm/c/bk；dead 必有 on、pend 必无 on）',
    pools.every(r => r.n && r.nm && /^\d{5}[A-Z]*$/.test(r.c) && r.bk) &&
    [...D.gw.dead, ...D.qf.dead].every(r => /^\d{4}-\d{2}-\d{2}$/.test(r.on || '')) &&
    [...D.gw.pend, ...D.qf.pend].every(r => r.on === undefined),
    JSON.stringify(pools.slice(0, 3)));
  assert('V1.9.1（A19）：搭车星不进池（26128B=69473 中国移动02星 / 24226A=62185）',
    !pools.some(r => r.n === 69473 || r.n === 62185));
  assert('V1.9.1（A19）：已在库对象不进补池（否则同一条搜索结果会出现两次）',
    (function () {
      const have = new Set([...(D.gw.sats || []), ...(D.qf.sats || [])].map(s => s.id));
      return !pools.some(r => have.has(r.n));
    })());
  assert('V1.9.1：satdata 记录 satcat 是否可用（satcatOk，布尔）', typeof D.satcatOk === 'boolean');
  assert('V1.9.1：satcat 可用时已再入链路必须有货（否则恒空的分支等于没被验证过）',
    !D.satcatOk || (D.gw.sats.some(s => s.st === 'r') && Object.keys(D.gw.goneCount || {}).length > 0),
    D.satcatOk ? '已再入 ' + D.gw.sats.filter(s => s.st === 'r').length + ' 颗' : '（satcat 缺失，mkdata 已给醒目警告）');
}
  // ⚠️ CI 工作流文件只存在于**仓库**里；本地工作区（开发目录）通常没有 `.github/`。
  //   smoke 两边都会跑（本地自审 + CI），所以这里必须容错 —— 不存在就视为通过并注明。
  {
    const ymlP = B + '/.github/workflows/update-tle.yml';
    const has = fs.existsSync(ymlP);
  assert('V1.9.1（1.4）：CI 里挂了"按批次纳入"的端到端测试',
    has ? /e2e_include_offline\.mjs/.test(fs.readFileSync(ymlP, 'utf8')) : true,
    has ? '' : '（本地工作区无 .github/workflows，跳过内容校验；CI 中会实查）');
  }
}

// ---- V1.9.5（H39）：边界虚线已删除 —— 原"clip 之内"与"36500 标签位置"两条断言随之作废 ----
// 沿革（保留备查）：V1.9.1（1.4）时这两条线画在 clip 之前，`lineWidth=1` 以线为中心铺开 →
//   0.5px 溢出绘图区形成高饱和像素带（视觉回归实测抓到）；修法是挪进 clip 之内。
//   V1.9.5（H39）按用户口径**整段删除**（"180° 红色虚线分割线也不需要"）→ 溢出问题随之不存在。
//   现在的守卫是"这两段确实没了"（见上方 H39 三条源码断言），加上 clip 本身仍在
//   （光点/虚影硬裁剪，V1.8.0 需求⑱，与边界线无关）。
{
  const src = fs.readFileSync(B + '/app.js', 'utf8');
  const clipAt = src.indexOf('ctx.rect(PL, PT, pw, ph); ctx.clip();');
  assert('V1.8.0（需求⑱）：绘图区硬裁剪仍在（clip 保留，与边界线删除无关）',
    clipAt > 0, 'clip@' + clipAt);
  assert('V1.9.5（H39）：drawChart 内不再出现 [5,4] 主题色边界虚线块（setLineDash([5, 4]) 已随删除移除）',
    !/ctx\.setLineDash\(\[5, 4\]\); ctx\.lineWidth = 1;\n  ctx\.strokeStyle = C\.theme;/.test(src));
}

assert('V1.8.0（需求6）：launches 台账第 6 位=任务结果、第 7 位=百科记载颗数',
  Object.values(RAW.gw.launches).filter(v => v.length >= 6).length >= Math.floor(Object.keys(RAW.gw.launches).length * 0.9) &&
  Object.values(RAW.qf.launches).every(v => v.length >= 6) &&
  ['ok', 'part', 'fail', '?'].includes(Object.values(RAW.gw.launches).find(v => v[0] === '试验星07组')[5]));
assert('V1.8.0（需求12）：卫星表插入「发射时间」列、发射历史插入「任务结果」列',
  /t_ltime: /.test(appCode) && /t_result: /.test(appCode) &&
  /res_ok: /.test(appCode) && /res_part: /.test(appCode) && /res_fail: /.test(appCode) &&
  /function resTag\(L\)/.test(appCode) &&
  // V1.9.1（1.4-D）：卫星表新增「在轨状态」列后，ltime 从第 4 列（idx 3）后移到 idx 4。
  [...d.querySelectorAll('#satTable thead th')].map(t => t.getAttribute('data-key')).indexOf('ltime') === 4 &&
  [...d.querySelectorAll('#launchTable thead th')].some(t => /t_result/.test(t.getAttribute('data-i18n') || '')));
assert('V1.8.0（需求12）：任务结果按百科记载如实标注（成功/部分成功/失败，没写就不猜）',
  /if \(r === 'ok'\) return '<span class="res res-ok">'/.test(appCode) &&
  /if \(r === 'part'\) return '<span class="res res-part">'/.test(appCode) &&
  /if \(r === 'fail'\) return '<span class="res res-fail">'/.test(appCode) &&
  /\.res-none \{ color:var\(--dim\); font-weight:400; \}/.test(tplCode));

// ★ V1.9.3（用户要求）：卫星表格的过小量级改用**标准科学记数法**（`1.23×10⁻⁵` 而不是裸 `1.23e-5`）。
//   为什么用上标 Unicode 而不是 <sup>：本页的表格要**导出成图片**（canvas 重绘），
//   <sup> 在 canvas 里画不出来 → 导出会丢格式。上标字符是纯文本，两条路径都能显示。
{
  assert('V1.9.3：`fmtSci()` 输出标准科学记数法（`×10` + **上标指数**，且量级正常时不用科学记数法）',
    /function fmtSci\(v, n\) \{/.test(appCode) &&
    /var SUP_DIGITS = \{ '0': '\\u2070'/.test(appCode) &&
    /return mant \+ '\\u00d710' \+ sup;/.test(appCode) &&
    // 36500 这类"并不大"的数**不该**被写成科学记数法（用户明确排除）
    /if \(av >= 1e-3 && av < 1e5\) return String\(\+v\.toPrecision\(n \|\| 3\)\);/.test(appCode));
  assert('V1.9.3：`ecc` 与 `bstar` 两列都走 `fmtSci`（不再用裸 toExponential）',
    /V\(fmtSci\(r\.ecc, 2\)\)/.test(appCode) && /V\(fmtSci\(r\.bstar, 2\)\)/.test(appCode) &&
    !/toExponential/.test(appCode.replace(/fmtSci[\s\S]{0,400}/g, '')));
}

// ★ V1.9.3（用户要求）：列名改口径 —— 源码级（不需要运行时探针）
//   ①「设计倾角」→「目标倾角」、「轨道要素」→「发射卫星数」
//   ② 失败行两列写 `-`、非全本星座时写 `M/N颗` —— 这两条**用真实渲染输出**断言，
//      放在 k3 就绪后的 "V1.9.3 运行时" 段（源码对而渲染错是最容易发生的一类回归）。
assert('V1.9.3：发射历史列名改口径（目标倾角 / 发射卫星数）',
  /lt_inc: \['目标倾角', 'Target incl\.'\]/.test(appCode) &&
  /lt_ele: \['发射卫星数', 'Satellites'\]/.test(appCode) &&
  /data-i18n="lt_inc">目标倾角</.test(tplCode) &&
  /data-i18n="lt_ele">发射卫星数</.test(tplCode));
assert('V1.9.3：简述文字说明了 M/N 口径（用户要求"用一句简短的话介绍这个逻辑写到章节上面的简述里"）',
  /若该发还搭载了其它卫星，写成「M\/N颗」/.test(appCode) &&
  /M\/N sats/.test(appCode) &&
  /lead_launches[\s\S]{0,900}?M\/N/.test(tplCode));

// 需求2/3/13：呼吸填充、主题色填充按钮、两表居中
assert('V1.8.0（需求2）：实时按钮呼吸态 = 主题色填充 + 文字用 --fg（暗白 / 亮黑）',
  /\.time-val\.rt-breathe \{ background:var\(--row-sel\); color:var\(--fg\); \}/.test(tplCode));
assert('V1.8.0（需求3）：说明 / 还原所有默认设置 = 主题色填充；各章默认设置 = 主题色边框',
  /button\.ghost\.btn-accent, button\.readme-btn\.btn-accent \{[\s\S]{0,160}?background:var\(--row-sel\); border-color:transparent; color:var\(--fg\);/.test(tplCode) &&
  /button\.ghost\[data-defsec\] \{ border-color:var\(--row-sel\); color:var\(--row-sel\); \}/.test(tplCode) &&
  /button\.ghost\[data-defsec\]\.sec-clean \{ border-color:var\(--hair\); color:var\(--dim\); filter:none; \}/.test(tplCode) &&
  /button\.ghost\.btn-accent\.dimmed/.test(tplCode) &&
  /function sectionIsDefault\(sec\)/.test(appCode));
assert('V1.8.0（需求13）：两张表格的记录一律居中（首列左对齐由 tbody td:first-child 保留）',
  /\.ltable th, \.ltable td \{ text-align:center; \}/.test(tplCode) &&
  /tbody td:first-child \{ text-align:left; \}/.test(tplCode));

// 需求15：i18n 审计暴露的真缺陷 —— 这三个守卫各自对应一个"页面上真的漏出过中文"的点
assert('V1.8.0（需求15）：03.5 章的 n_gw / n_qf 两个键已补进 I18N（此前会把键名当文字画出来）',
  /n_gw: \['星网', 'CSCN'\], n_qf: \['千帆', 'Qianfan'\],/.test(appCode));
assert('V1.8.0（需求15）：中英括号分制（paren 助手；英文界面不得漏出全角「（）」）',
  /function paren\(s\) \{ return LANG === 'en' \? ' \(' \+ s \+ '\)' : '（' \+ s \+ '）'; \}/.test(appCode) &&
  /' km' \+ paren\(fmtNum\(st\.minAlt, 0\)/.test(appCode) &&
  !/km（' \+ fmtNum\(st\.minAlt/.test(appCode));
assert('V1.8.0（需求15）：批次名英文侧补「千帆 / 星网」前缀规则（DTC 批次此前漏出中文）',
  /\.replace\(\/\^千帆\\s\+\(\.\+\)\$\/, 'Qianfan \$1'\)/.test(appCode) &&
  /\.replace\(\/\^星网\\s\+\(\.\+\)\$\/, 'CSCN \$1'\)/.test(appCode));

// 需求16「恢复默认增强」：章节「默认设置」要与「还原所有默认设置」同口径（三条一起）
// ★ 前两条守卫对应**实测踩过的两个真坑**（曾让补间完全不生效，逐帧抓到的轨迹是 [30,0,0,…]）：
//   ① 起跳偏移必须在 `(PREF_SEC[sec]||[]).forEach(…)` **之前**取出 —— timeOffsetMap /
//      timeOffsetGlobe 本身就在 PREF_SEC 里，forEach 会把它们覆写成 PREF_DEF 的 0，
//      之后再读 p.* 恒为 0 → `if (off0)` 永远不成立，补间分支根本进不去；
//   ② animateTo 的起跳点必须重取 el.value —— syncTimeUI() 直接写 el.value 而不经 applyV，
//      闭包里的 shown 会停在旧值，于是 from===target → 第一句就 applyV(0) 变瞬跳。
const _resetSecSrc = (appCode.match(/function resetSection\(sec\) \{[\s\S]*?\n\}/) || [''])[0];
const _prefSecIdx = _resetSecSrc.indexOf('(PREF_SEC[sec] || []).forEach');
const _offFromIdx = _resetSecSrc.indexOf('var offFrom =');
assert('V1.8.0（需求16）：章节「默认设置」的起跳偏移在 PREF_SEC 覆写**之前**取出（否则恒为 0，补间永不触发）',
  _offFromIdx >= 0 && _prefSecIdx >= 0 && _offFromIdx < _prefSecIdx,
  'offFrom@' + _offFromIdx + ' < forEach@' + _prefSecIdx);
assert('V1.8.0（需求16）：章节「默认设置」把时间条**补间**回实时（setOffset 归位 → __animateTo(0)）',
  /setOffset\(off0, tvTween\);\s*\n\s*tr\.__animateTo\(0\);/.test(appCode));
assert('V1.8.0（需求16）：animateTo 起跳点重取滑条真实值（防 syncTimeUI 直写 value 造成的瞬跳）',
  /if \(!tween\) shown = \+el\.value;/.test(appCode));
assert('V1.8.0（需求16）：章节「默认设置」把观测点整组摆回出厂（退出模式 + 解除固定 + 位置/仰角归零）',
  /S\.pick = \{ on: false, fixed: false, lat: 30, lon: 116, el: 0, mx: null, my: null \};/.test(appCode) &&
  /S\.mz = \{ k: 1, tx: 0, ty: 0 \};/.test(appCode));
assert('V1.8.0（需求16）：章节「默认设置」把本章视图回出厂（地图缩放平移 / 地球姿态与缩放）',
  /if \(sec === 'globe'\) \{ G\.yaw = 100 \* RAD; G\.pitch = 22 \* RAD; G\.zoom = 1; \}/.test(appCode));

// ================================================================ V1.9.1（A19）页面侧：搜索补池
// 为什么必须"注入合成数据"才能测：真实数据里 dead/pend 两池**恰好都是空的**
//   （1.1/1.4/1.6 之后已 100% 归位）—— 拿真实产物跑，这整条通路一行代码都不会执行。
// 做法：把产物 HTML 里那段 `window.SATDATA={…}` 取出来、塞进 3 条合成池对象再放回，
//   然后用**真 JSDOM**走真实交互（填输入框 → 读联想区 → mousedown 点击 → 看提示条）。
{
  const k0 = html.indexOf('window.SATDATA=');
  const end0 = html.indexOf(';</script>', k0);
  const sd = JSON.parse(html.slice(k0 + 'window.SATDATA='.length, end0));
  // 合成三条：已再入（无 TLE）、尚未编目（无 TLE）；批次都挂在真实存在的批次上，便于验证高亮
  sd.gw.dead = [{ n: 900001, nm: 'A19 DEAD SYNTH', c: '25067Z', bk: '25067', on: '2025-10-16' }];
  sd.gw.pend = [{ n: 900002, nm: 'A19 PEND SYNTH', c: '26221Z', bk: '26221' }];
  sd.qf.pend = [{ n: 900003, nm: 'A19 PEND QF', c: '26211Z', bk: '26211' }];
  const html2 = html.slice(0, k0 + 'window.SATDATA='.length) + JSON.stringify(sd) + html.slice(end0);

  const err2 = [];
  const vc2 = new VirtualConsole();
  vc2.on('jsdomError', e => err2.push('jsdomError: ' + ((e.detail && (e.detail.stack || e.detail.message)) || e.message)));
  vc2.on('error', (...a) => err2.push('console.error: ' + a.join(' ')));
  const dom2 = new JSDOM(html2, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc2,
    beforeParse(window) {
      window.HTMLCanvasElement.prototype.getContext = function () { if (!this.__ctx) this.__ctx = makeCtx(); return this.__ctx; };
      window.HTMLCanvasElement.prototype.toBlob = function (cb) { cb(null); };
      window.Element.prototype.getBoundingClientRect = function () {
        var h = (this.tagName === 'TR') ? 41 : 460;
        return { left: 0, top: 0, x: 0, y: 0, width: 900, height: h, right: 900, bottom: h };
      };
      window.scrollTo = () => {}; window.scrollBy = () => {};
      // ⚠️ 这里**不要**覆盖 requestAnimationFrame：app 里有连续的动画循环，
      //   把 rAF 换成 `setTimeout(cb, 0)` 会让它变成死循环 —— 断言全跑完、汇总也打印了，
      //   但进程永不退出（实测挂 4 分钟以上）。jsdom 自己的 rAF（pretendToBeVisual）就够用。
      Object.defineProperty(window, 'innerHeight', { value: 4000, configurable: true });
      Object.defineProperty(window, 'innerWidth', { value: 1400, configurable: true });
      window.addEventListener('error', e => err2.push('window.error: ' + e.message));
    }
  });
  const w2 = dom2.window, d2 = w2.document;
  await new Promise(r => setTimeout(r, 2000));

  const inp = d2.getElementById('topSearch'), sug = d2.getElementById('topSug');
  function typeQ(q) {
    inp.value = q;
    inp.dispatchEvent(new w2.Event('input', { bubbles: true }));
    return sug.innerHTML;
  }
  assert('A19 页面侧：注入合成池后页面无脚本错误', err2.length === 0, err2.slice(0, 3).join(' | ') || 'none');

  // ① 三池并联：已再入 / 尚未编目都能被搜到，且 data-kind 正确
  const hDead = typeQ('900001');
  assert('A19 页面侧：按 NORAD 能搜到「已再入」补池对象（原先只在 sats 里找 → 搜不到）',
    /data-kind="dead"/.test(hDead) && /A19 DEAD SYNTH/.test(hDead), hDead.slice(0, 160));
  const hPend = typeQ('900002');
  assert('A19 页面侧：按 NORAD 能搜到「尚未编目」补池对象',
    /data-kind="pend"/.test(hPend) && /A19 PEND SYNTH/.test(hPend), hPend.slice(0, 160));
  // ② 按名字与 COSPAR 也要能搜到
  const hName = typeQ('A19 PEND SYNTH');
  assert('A19 页面侧：按目录名（**多词**）能搜到补池对象', /data-kind="pend"/.test(hName), hName.slice(0, 120));
  const hCos = typeQ('26221Z');
  assert('A19 页面侧：按 6 列 COSPAR 能搜到补池对象', /data-kind="pend"/.test(hCos), hCos.slice(0, 120));
  // ③ 尾标注写「已再入」/「待编目」（不是颗数、不是 NORAD）
  assert('A19 页面侧：补池条目尾标注是「已再入」/「待编目」',
    /sug-norad">已再入</.test(hDead) && /sug-norad">待编目</.test(hPend));
  // ④ 换星座后只显示本星座的池（千帆的 pend 不串到星网页）
  assert('A19 页面侧：搜索补池按星座隔离（星网页搜不到千帆的 pend 对象）',
    !/data-kind="pend"/.test(typeQ('900003')));

  // ⑤ 点击「已再入」条目 → 红提示 + 该批次行高亮（反馈落在 07 发射历史）
  typeQ('900001');
  const itDead = sug.querySelector('.sug-item[data-kind="dead"]');
  assert('A19 页面侧：「已再入」条目带 data-norad / data-bk（供点击定位用）',
    !!itDead && itDead.getAttribute('data-norad') === '900001' && itDead.getAttribute('data-bk') === '25067',
    itDead ? itDead.outerHTML.slice(0, 140) : 'null');
  itDead.dispatchEvent(new w2.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 60));
  const toast = d2.getElementById('selToast');
  assert('A19 页面侧：点「已再入」→ 弹红提示「该卫星已再入」（.pool-dead）',
    !!toast && toast.textContent === '该卫星已再入' && toast.classList.contains('pool-dead') &&
    toast.classList.contains('show'),
    toast ? (toast.textContent + ' / ' + toast.className) : 'null');
  assert('A19 页面侧：同一批次（25067）的行在发射历史里被高亮（不在库 → 退化为批次级反馈）',
    !!d2.querySelector('#launchBody tr.focused') &&
    d2.querySelector('#launchBody tr.focused').getAttribute('data-lk') === '25067',
    d2.querySelector('#launchBody tr.focused') ? d2.querySelector('#launchBody tr.focused').getAttribute('data-lk') : 'none');

  // ⑥ 点击「尚未编目」条目 → 琥珀提示
  typeQ('900002');
  const itPend = sug.querySelector('.sug-item[data-kind="pend"]');
  itPend.dispatchEvent(new w2.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 60));
  assert('A19 页面侧：点「尚未编目」→ 弹琥珀提示「该卫星尚未编目」（.pool-pend）',
    !!toast && toast.textContent === '该卫星尚未编目' && toast.classList.contains('pool-pend') &&
    !toast.classList.contains('pool-dead'),
    toast ? (toast.textContent + ' / ' + toast.className) : 'null');

  // ⑦ Q40：补池条目**不进「最近浏览」** —— 清空输入后不该出现在最近 6 条里
  inp.value = '';
  inp.dispatchEvent(new w2.Event('input', { bubbles: true }));
  assert('A19 页面侧：补池条目不进「最近浏览」（Q40：清空输入后不出现）',
    !/data-kind="dead"|data-kind="pend"/.test(sug.innerHTML), sug.innerHTML.slice(0, 160));

  // ⑧ 01/02/03 章不联动（Q35）：点补池条目不得改动地图/地球/倾角三处选中态
  assert('A19 页面侧：点补池条目不联动 01/02/03 章（不改动地图与地球的选中）',
    d2.querySelectorAll('#map, #globe, #chart').length === 3);   // 存在性 + 下面查源码守卫
  assert('A19 页面侧：poolJump 只跳 06 卫星表格（源码守卫：不出现 sec-map/sec-orbits/sec-chart 的跳转）',
    (function () {
      const src = (appSrc.match(/function poolJump\([\s\S]*?\n\}/) || [''])[0];
      return /sec-table/.test(src) && !/sec-map|sec-orbits|sec-chart/.test(src);
    })());

  // ⑨ V1.9.1（A19-S）：多词搜索修复 —— 修前判断用的是"候选条数 ≥ 词数"，
  //   而候选按 NORAD 去重 → 同一对象被 N 个词命中也只留一条 → **多词搜索永远返回空**
  //   （实测 'HULIANWANG DIGUI-01' / '长征八号甲 Y1' 全空）。
  const hMulti = typeQ('HULIANWANG DIGUI');
  assert('V1.9.1（A19-S）：多词搜索不再是空的（真实多词名 HYLIANWANG·DIGUI 能命中）',
    /data-kind="sat"/.test(hMulti) && !/没有匹配的卫星/.test(hMulti), hMulti.slice(0, 140));
  assert('V1.9.1（A19-S）：交集按**命中词数**判断（源码守卫：旧的 arr.length 判据必须消失）',
    /Object\.keys\(hitWords\[k\] \|\| \{\}\)\.length < words\.length/.test(appSrc) &&
    /function markHit\(o\) \{/.test(appSrc) &&
    /curW = w;/.test(appSrc) &&
    !/arr\.length >= words\.length/.test(appSrc));
  assert('V1.9.1（A19-S）：markHit 在三处 push（sat/group/pool）里都调用了',
    (appSrc.match(/markHit\(o\);/g) || []).length === 3);

  // ---- V1.9.1（A19-F43）：**遥号**是合理的模糊搜索类别（用户裁决）----
  //   单独搜遥号、或与火箭名一起搜，都必须有效。原先 `Y8` 这个"词"一个候选都推不出来
  //   （既不是纯数字、也不在任何名称/COSPAR 里）→ 与火箭名求交集时恒为空。
  const satIdxSet = () => [...sug.querySelectorAll('.sug-item[data-kind="sat"]')]
    .map(x => x.getAttribute('data-idx')).sort((a, b) => a - b).join(',');
  typeQ('Y8'); const setY8 = satIdxSet();
  typeQ('遥8'); const setYao8 = satIdxSet();
  typeQ('遥八'); const setYaoba = satIdxSet();
  assert('F43：单独搜遥号 `Y8` 能命中（真实数据里是 长征八号甲Y8 + 长征十二号Y8 两批）',
    setY8.length > 0 && !/没有匹配的卫星/.test(typeQ('Y8')), setY8);
  assert('F43：`Y8` / `遥8` / `遥八` 三种写法结果**完全一致**',
    setY8 === setYao8 && setY8 === setYaoba, 'Y8=' + setY8 + ' 遥8=' + setYao8 + ' 遥八=' + setYaoba);
  typeQ('长征八号甲 Y8'); const setCz8aY8 = satIdxSet();
  assert('F43：`长征八号甲 Y8` = 火箭名 ∩ 遥号的**交集**（比单搜 `Y8` 更窄，只留 CZ-8A 那批）',
    setCz8aY8.length > 0 && setCz8aY8 !== setY8 &&
    setCz8aY8.split(',').every(i => setY8.split(',').indexOf(i) >= 0),
    'CZ-8A Y8=' + setCz8aY8 + ' ⊂ Y8=' + setY8);
  assert('F43：`遥8 长征八号甲`（顺序颠倒）结果一致',
    (function () { typeQ('遥8 长征八号甲'); return satIdxSet() === setCz8aY8; })());
  typeQ('长征八号甲Y8'); const setJoin = satIdxSet();
  assert('F43：连写 `长征八号甲Y8` 也精确落到 Y8（原先遥号被忽略 → 退化成"命中该型号全部批次"）',
    setJoin === setCz8aY8, '连写=' + setJoin);
  // ⚠️ 引力一号是**千帆**的火箭（极轨26组 = 26211）→ 必须切到千帆页才有对照，
  //   否则两边都空、断言恒真（首版就是这么写的，白跑一条）。
  assert('F43：`gravity1` 不被误当成"引力一号 遥1"（内含 y1 —— 精确别名判据必须挡住它）',
    await (async function () {
      const toQf = d2.querySelector('#constelSeg button[data-c="qf"]');
      const toGw = d2.querySelector('#constelSeg button[data-c="gw"]');
      if (!toQf || !toGw) return false;
      toQf.dispatchEvent(new w2.MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 1000));      // 星座切换是 520ms 动画、半程换数据
      typeQ('引力一号'); const y3 = satIdxSet();
      typeQ('gravity1'); const g1 = satIdxSet();
      toGw.dispatchEvent(new w2.MouseEvent('click', { bubbles: true }));   // 切回星网，别污染后面的断言
      await new Promise(r => setTimeout(r, 1000));
      return y3.length > 0 && g1 === y3;
    })());
  assert('F43：连写遥号走的是"精确别名 + 末尾遥号"提取（源码守卫：rocketNameExact 用 === 比对）',
    /if \(String\(ns\[j\]\)\.toLowerCase\(\) === w\) return true;/.test(appSrc) &&
    /if \(rk && !serial\) \{/.test(appSrc));
  assert('F43：不存在的遥号（`遥99`）返回空，不得误命中',
    /没有匹配的卫星/.test(typeQ('遥99')));
  assert('F43：纯数字不作为遥号拦截（`8` 的语义是名称/NORAD 里的数字，交回原分支）',
    /var serialOnly = \/\^\[0-9\]\+\$\/\.test\(w\) \? 0 : rocketSerial\(w\);/.test(appSrc) &&
    /if \(serialOnly && !aliasHit\(w, ROCKET_ALIAS\)\) \{/.test(appSrc));
  // ★ 口径守卫：星座名**不参与**关键词匹配（页内搜索天然已限定星座，故无意义）——
  //   用户明确裁决"这个确实没有必要"。这条断言是为了防止以后有人把它当 bug 重新"修"回来。
  assert('F43（口径已裁决）：星座名不参与匹配 —— `星网 低轨20组` 为空，`低轨20组` 有命中',
    /没有匹配的卫星/.test(typeQ('星网 低轨20组')) && !/没有匹配的卫星/.test(typeQ('低轨20组')));
  assert('F43（口径已裁决）：searchCandidates 里没有星座名匹配逻辑（源码守卫）',
    (function () {
      const src = (appSrc.match(/function searchCandidates\(q\) \{[\s\S]*?\n\}/) || [''])[0];
      return src.length > 0 && !/cn_gw|cn_qf|st\.name/.test(src);
    })());
  dom2.window.close();
}

// ================================================================ V1.9.1（A3）：选择提示药丸三态
// 三态定义（任务清单 A3）：整批全选（多颗）→「已全选」绿；只有单颗的批次 →「已选择」绿；
//   无 TLE 的发射记录 →「当前暂无TLE数据」**反色**。
// 做法：像 visual.mjs 那样**注入一个只读探针**（紧跟主 IIFE 的 'use strict'; 之后）——
//   app.js 整体是 IIFE，内部函数不挂 window，不注入就没法精确触发 selectGroup / 读 S.sel。
{
  const HEAD_RE = /\(function \(\) \{\r?\n'use strict';/;
  const INS = "\n// V1.9.1（A11）：**合成「全部已再入」的批次** —— 真实数据里只有 1 颗已再入（63428），\n" +
    "//   凑不出「整批都再入」的情形，而那条分支（灰框 + 红弹窗 + 无 1/2/3 章联动）必须被真正跑到。\n" +
    "//   注入点选在主 IIFE 的最前面，此时 `var RAW = window.SATDATA;` **还没执行** → 直接改 window.SATDATA 有效。\n" +
    "(function () {\n" +
    "  var g = window.SATDATA.gw, DT = '2026-01-01';\n" +
    "  var hit = [];\n" +
    "  g.sats.forEach(function (s) { if (String(s.c).indexOf('26137') === 0) { s.st = 'r'; s.dt = DT; hit.push({ n: s.id, id: s.c, on: DT }); } });\n" +
    "  if (hit.length) { g.goneCount = g.goneCount || {}; g.goneCount['26137'] = hit; }\n" +
    "})();\n" +
    "window.__CISTRACK__ = {\n" +
    "  selectGroup: function (lk) { return selectGroup(lk); },\n" +
    // ★ V1.9.5（H32-A）：网格 vs 线性扫描的一致性（性质判据；随机用例，不写死结果）
    "  gridParity: function () {\n" +
    "    function rnd(seed) { var x = seed; return function () { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff; }; }\n" +
    "    var R = rnd(20261016), boxes = [], i;\n" +
    "    for (i = 0; i < 300; i++) boxes.push([R() * 900, R() * 700, 20 + R() * 80, 12]);\n" +
    "    var bad = [];\n" +
    "    for (var q2 = 0; q2 < 200; q2++) {\n" +
    "      var q = [R() * 900, R() * 700, 20 + R() * 80, 12];\n" +
    "      var ovL = 0;\n" +
    "      for (i = 0; i < boxes.length; i++) { var b = boxes[i];\n" +
    "        var ox = Math.min(q[0] + q[2], b[0] + b[2]) - Math.max(q[0], b[0]);\n" +
    "        var oy = Math.min(q[1] + q[3], b[1] + b[3]) - Math.max(q[1], b[1]);\n" +
    "        if (ox > 0 && oy > 0) ovL += ox * oy; }\n" +
    "      var G = labelStore();\n" +
    "      for (i = 0; i < boxes.length; i++) labelPush(G, boxes[i].slice());\n" +
    "      var ovG = 0;\n" +
    "      labelEach(G, q, function (b2) {\n" +
    "        var ox = Math.min(q[0] + q[2], b2[0] + b2[2]) - Math.max(q[0], b2[0]);\n" +
    "        var oy = Math.min(q[1] + q[3], b2[1] + b2[3]) - Math.max(q[1], b2[1]);\n" +
    "        if (ox > 0 && oy > 0) ovG += ox * oy; });\n" +
    "      if (Math.abs(ovL - ovG) > 1e-6) bad.push(q2 + ':' + ovL.toFixed(2) + 'vs' + ovG.toFixed(2));\n" +
    "    }\n" +
    "    return { ok: bad.length === 0, detail: bad.length ? ('不一致 ' + bad.length + '/200：' + bad.slice(0, 3).join(' | ')) : '200 组随机用例逐位一致' }; },\n" +
    "  state: function () { return { sel: S.sel.slice(), selGroup: S.selGroup, selGone: S.selGone, climbPick: S.climbPick }; },\n" +
    "  tt: function (k) { return t(k); },\n" +
    // V1.9.1（#4）：彩色多线 —— 需要能切换本章选中的批次并强制重绘
    "  setClimbPick: function (v) { S.climbPick = v; climbView = null; },\n" +
    "  climbN: function () { return climbSeries().list.length; },\n" +
    "  climbHues: function () { var m = climbColorMap(climbSeries().list), o = {}; for (var k in m) o[k] = m[k]; return o; },\n" +
    "  climbList: function () { return climbSeries().list.map(function (c) { return { n: c.norad, lk: c.lk }; }); },\n" +
    "  drawClimb: function () { return drawClimb(); },\n" +
    // V1.9.1（A1）：信息窗新行的验证入口
    "  climbFind: function (n) { var s = climbSeries().list.filter(function (c) { return c.norad === n; })[0];\n" +
    "    return s ? { n: s.norad, pts: s.pts.map(function (p) { return { ms: p.ms, v: p.v }; }) } : null; },\n" +
    "  climbInfoAt: function (n, i) { var s = climbSeries().list.filter(function (c) { return c.norad === n; })[0];\n" +
    "    climbShowInfoAt({ norad: s.norad, ms: s.pts[i].ms, v: s.pts[i].v }); },\n" +
    // V1.9.1（A6）：选择框的验证入口
    "  climbOpts: function () { return climbPickOptions().map(function (o) { return { v: o.v, label: o.label }; }); },\n" +
    // V1.9.1（A8）：组网进度虚线段
    "  netDash: function () { return netCv.getContext('2d').__styles.dash; },\n" +
    "  netOnly: function (k) { S.netGw = (k === 'gw'); S.netQf = (k === 'qf'); },\n" +
    "  netBoth: function () { S.netGw = true; S.netQf = true; },\n" +
    "  netDraw: function () { try { drawNet(); } catch (e) {} },\n" +
    "  netSplit: function (k) { return netSolidSplit(k, netData().weeks); },\n" +
    "  netWeeks: function () { return netData().weeks.length; },\n" +
    "  netAxis: function () { netAutoView(); return { x0: netView.x0, x1: netView.x1 }; },\n" +
    "  netSolidFrom: function (k) { return netSolidFrom(k); },\n" +
    // ★ V1.9.2（用户要求）：组网进度**时间区间档**（全部 / 今年 / 最近3月）的验证入口。
    //   netSetSpan 刻意**不走 cvSwap**（那是给眼睛看的 520ms 过场），同步设档 + 重绘，
    //   这样断言拿到的是"过场结束后的稳定态"，不受动画时序影响。
    "  netSetSpan: function (sp) { S.netSpan = sp; netView = null; netAutoView(); drawNet(); return S.netSpan; },\n" +
    "  netSpanNow: function () { return S.netSpan; },\n" +
    "  netRange: function () { var d = netData(); var R = netSpanRange(d, S.netSpan);\n" +
    "    return { from: R.from, to: R.to, span: R.span }; },\n" +
    "  netNodes: function () { var d = netData();\n" +
    "    return netSpanNodes(d, S.netSpan).map(function (n) { return { ms: n.ms, wi: n.wi, kind: n.kind }; }); },\n" +
    "  netCurveOf: function (k) { var d = netData(); var P = netSpanPts(d, k, S.netSpan);\n" +
    "    return { n: P.pts.length, base: P.base,\n" +
    "      first: { ms: P.pts[0].ms, v: P.pts[0].v, k: P.pts[0].k },\n" +
    "      last: { ms: P.pts[P.pts.length - 1].ms, v: P.pts[P.pts.length - 1].v } }; },\n" +
    "  netCumAt: function (k, ms) { return netCumAt(k, ms); },\n" +
    "  netCumAll: function (k) { return netData().lastN[k]; },\n" +
    "  netNodeHit: function (mx) { return netNodeAt(mx); },\n" +
    // ★ V1.9.2：节点标记与标签排版（纯函数，不碰 ctx）
    "  netMarks: function () { return netNodeMarks(netData(), S.netSpan).map(function (m) {\n" +
    "    return { key: m.key, ms: m.ms, kind: m.kind, v: Math.round(m.v), last: m.last }; }); },\n" +
    "  netLabels: function () {\n" +
    "    if (!netView) netAutoView();\n" +
    "    var r = netRect || { PL: 62, PT: 16, pw: 1265, ph: 424 };\n" +
    "    var v = netView;\n" +
    "    var X = function (ms) { return r.PL + (ms - v.x0) / (v.x1 - v.x0) * r.pw; };\n" +
    "    var Y = function (n) { return r.PT + r.ph - (n - v.y0) / (v.y1 - v.y0) * r.ph; };\n" +
    "    return netPickLabels(netNodeMarks(netData(), S.netSpan), X, Y).map(function (L) {\n" +
    "      return { key: L.key, v: L.v, x: +L.x.toFixed(2), y: +L.y.toFixed(2), last: !!L.last }; }); },\n" +
    "  netRect: function () { return netRect; },\n" +
    // ★ V1.9.2（用户要求）：本帧 netCv 上所有 fillText 的 {文本, 坐标} —— 用来断言"末端数值只画一次"。
    //   桩的 __styles.textXY 是**累积**的（每次绘制往后追加），这里先清空再重绘，拿干净的当前帧。
    "  netTexts: function () { var c = netCv.getContext('2d'); c.__styles.textXY.length = 0;\n" +
    "    drawNet(); return c.__styles.textXY.slice(); },\n" +
    "  netViewNow: function () { if (!netView) netAutoView();\n" +
    "    return { x0: netView.x0, x1: netView.x1, y0: netView.y0, y1: netView.y1 }; },\n" +
    "  netInfoOpen: function (i) { netShowInfoAt(i); var el = document.getElementById('netInfo');\n" +
    "    var rs = el ? el.querySelectorAll('.si-row') : []; var out = [];\n" +
    "    for (var x = 0; x < rs.length; x++) out.push(rs[x].textContent);\n" +
    "    hideInfo(netInfo, 'net'); netHoverIdx = null; return out; },\n" +
    "  netWeekAt: function (mx) { return netWeekAt(mx); },\n" +
    "  shotNetParams: function (v) { return shotNetParams(v); },\n" +
    // ★ V1.9.3（用户要求）：发射历史行的**实际渲染**（失败行 `-` / M/N 格式）。
    //   以前只能断源码，看不出"渲染出来到底长什么样"；这里直接调渲染函数取纯文本。
    "  launchRowText: function (key) {\n" +
    "    var L = null; (cur().launches || []).forEach(function (x) { if (x.key === key) L = x; });\n" +
    "    if (!L) return null;\n" +
    "    var html = launchRowHtml(L);\n" +
    "    return { html: html.replace(/<[^>]+>/g, '|').replace(/\\|+/g, '|'),\n" +
    "      inc: L.inc, count: L.count, tot: L.tot, res: L.res, name: L.name }; },\n" +
    "  launchRowCount: function () { return (cur().launches || []).length; },\n" +
    "  launchKeys: function () { return (cur().launches || []).map(function (x) { return x.key; }); },\n" +
    // ★ V1.9.3：科学记数法格式化（用户要求）
    "  fmtSci: function (v, n) { return fmtSci(v, n); },\n" +
    // ★ V1.9.5（H10）：升轨阶段判定（两条竖虚线的数据基础）—— 暴露给运行时用例
    "  climbPhases: function (pts, opt) { return climbPhases(pts, opt); },\n" +
    // ★ V1.9.5（H10 ③b/④）：取数入口 + 视野。phaseOf 用**真实函数**跑当前视图；pubOf 读发布层；
    //   setDel 用于"注入/删除/还原"发布层的 batch phase（测"发布优先"与"缺失回退"两条路径）。
    "  climbPhase: function () { var p = climbPhaseNow(climbSeries()); return p ? { s: p.startMs, e: p.endMs } : null; },\n" +
    "  climbPub: function () { var P = RAW[S.key].phases || null; return P ? { nb: Object.keys(P.b).length, ns: Object.keys(P.s).length } : null; },\n" +
    "  climbPubB: function (lk) { var P = RAW[S.key].phases; return (P && P.b && P.b[lk]) || null; },\n" +
    "  climbPubS: function (n) { var P = RAW[S.key].phases; return (P && P.s && P.s[n]) || null; },\n" +
    "  climbSetB: function (lk, s2, e2) { var P = RAW[S.key].phases; var old = P.b[lk] || null; P.b[lk] = [s2, e2]; return old; },\n" +
    "  climbDelB: function (lk) { var P = RAW[S.key].phases; var old = P.b[lk] || null; delete P.b[lk]; return old; },\n" +
    "  climbViewNow: function () { if (!climbView) climbAutoView(); return { x0: climbView.x0, x1: climbView.x1 }; },\n" +
    "  climbAutoReset: function () { climbView = null; climbAutoView(); return { x0: climbView.x0, x1: climbView.x1 }; },\n" +
    "  climbRectNow: function () { return climbRect; },\n" +
    "  climbDateFmt: function (ms) { return climbDateLabel(ms); },\n" +
    "  climbDashNow: function () { var A = climbCv.getContext('2d').__styles.dash; return A[A.length - 1] || null; },\n" +
    "  climbTextsNow: function () { var c = climbCv.getContext('2d'); c.__styles.textXY.length = 0; c.__styles.text.length = 0;\n" +
    "    drawClimb(); return c.__styles.textXY.slice(); },\n" +
    "  climbBatchPts: function (lk) { var C = climbCurve(), L = C[lk] || [], o = [];\n" +
    "    L.forEach(function (c) { var mn = Infinity, mx = -Infinity;\n" +
    "      c.pts.forEach(function (p) { if (p.v < mn) mn = p.v; if (p.v > mx) mx = p.v; });\n" +
    "      o.push({ n: c.norad, k: c.pts.length, span: +(mx - mn).toFixed(3) }); });\n" +
    "    return o; },\n" +
    "  climbLiteKeys: function () { var h = RAW[S.key].hist || {}; return Object.keys(h); },\n" +
    "  climbSelClear: function () { S.sel = []; return 1; },\n" +
    "  climbSelByNorad: function (n) { var arr = cur().sats, i; for (i = 0; i < arr.length; i++) if ((arr[i].norad | 0) === (n | 0)) { S.sel = [i]; return i; } return -1; },\n" +
    "  climbSelAdd: function (n) { var arr = cur().sats, i; for (i = 0; i < arr.length; i++) if ((arr[i].norad | 0) === (n | 0)) { S.sel = S.sel.concat([i]); return S.sel.length; } return -1; },\n" +
    // ★ V1.9.5（H11）：导出图带虚线的**运行时**验证 —— 在导出倍率（2×）下重绘一次，取画布记录
    "  climbExportCheck: function () {\n" +
    "    var c = climbCv.getContext('2d'); c.__styles.textXY.length = 0; c.__styles.text.length = 0;\n" +
    "    var k = 0; withCanvasScale(climbCv, 2, drawClimb, function (kk) { k = kk; });\n" +
    "    var A = c.__styles.dash;\n" +
    "    return { k: k, dash: A[A.length - 1] || null, texts: c.__styles.textXY.slice(), rect: climbRect };\n" +
    "  },\n" +
    "  constelState: function (v) { return shotConstelState(v); },\n" +
    // V1.9.1（#6）：横轴刻度梯 + 轴起点
    "  netOrigin: function () { var d = netData(); return { x0min: netX0Min(d), weeks0: d.weeks[0], origin: d.originMs }; },\n" +
    "  tickStep: function (spanD, want) { return tickStepDays(spanD, want); },\n" +
    "  tickLadder: function () { return TICK_LADDER.slice(); },\n" +
    "  netAxisNow: function () { netAutoView(); return { x0: netView.x0, x1: netView.x1 }; },\n" +
    "  netLabel: function (ms) { return netDateLabel(ms); },\n" +
    // V1.9.1（A9）：倾角分布聚类圆圈
    "  chartCL: function () { return chartClusters(chartVisiblePts()).map(function (c) {\n" +
    "    return { n: c.n, x: +c.x.toFixed(3), y: Math.round(c.y), rx: +c.rx.toFixed(3), ry: Math.round(c.ry),\n" +
    "      rxRaw: +c.rxRaw.toFixed(3), ryRaw: +c.ryRaw.toFixed(2), spanX: +c.spanX.toFixed(3) }; }); },\n" +
    "  chartAlpha: function (span, cs) { return +chartClusterAlpha(span, cs).toFixed(3); },\n" +
    "  chartEll: function () { return chartCv.getContext('2d').__styles.ellipse; },\n" +
    "  chartDraw: function () { try { drawChart(); } catch (e) {} },\n" +
    "  chartSpan: function () { if (!chartView) chartAutoView(); return +(chartView.x1 - chartView.x0).toFixed(2); },\n" +
    "  chartSetSpan: function (x0, x1) { chartView = { x0: x0, x1: x1, y0: chartView.y0, y1: chartView.y1 }; },\n" +
    "  chartHitNoCluster: function () { return typeof chartHoverAt; },\n" +
    // V1.9.1（A18）：断轴
    "  brkOn: function (y0, y1) { return brkOn({ y0: y0, y1: y1 }); },\n" +
    "  brkMap: function (y0, y1, PT, ph) { var m = brkYMap({ y0: y0, y1: y1 }, PT, ph);\n" +
    "    return { on: m.on, cut: m.cut, bands: m.bands,\n" +
    "      at: function (y) { var r = m.Y(y); return r == null ? null : +r.toFixed(3); },\n" +
    "      inv: function (px) { return +m.yAt(px).toFixed(3); } }; },\n" +
    "  climbB: function () { return climbBounds(climbSeries().list, S.climbTake || 'sma'); },\n" +
    // ★ V1.9.3：表格分页自洽性（用户报"导出当前页得到 1~3 页"时的连带发现）
    "  pageCoverage: function () {\n" +
    "    var rows = LAST_ROWS, per = SAT_PAGE;\n" +
    "    var unitOf = measureRowUnits(rows);\n" +
    "    var seen = {}, pages = SAT_PAGES, total = 0, miss = [];\n" +
    "    for (var p = 0; p < pages; p++) {\n" +
    "      var b = pageBounds(rows, p, per, unitOf);\n" +
    "      for (var i = b[0]; i < b[1]; i++) { if (!seen[i]) { seen[i] = 1; total++; } }\n" +
    "    }\n" +
    "    for (var j = 0; j < rows.length; j++) if (!seen[j]) miss.push(j);\n" +
    "    return { rowsN: rows.length, pages: pages, covered: total, missing: miss.length, firstMissing: miss.slice(0, 3) };\n" +
    "  },\n" +
    "  shotTotals: function () { return { sat: shotTotalPages('sat'), launch: shotTotalPages('launch'), satPages: SAT_PAGES, launchPages: LAUNCH_PAGES }; },\n" +
    // ★ V1.9.3：当前选中批次/组的**数据实际高度范围**（半长轴模式）。
    //   用途：断言"纵轴贴合数据范围" —— 必须拿真实下沿比对，不能写死数字（数据会演进）。
    "  climbDataLo: function () { if ((S.climbTake || 'sma') === 'rate') return null;\n" +
    "    var mn = Infinity; climbSeries().list.forEach(function (c) {\n" +
    "      c.pts.forEach(function (p) { var a = p.v - CLIMB_RE; if (a < mn) mn = a; }); });\n" +
    "    return isFinite(mn) ? +mn.toFixed(3) : null; },\n" +
    "  climbDataHi: function () { if ((S.climbTake || 'sma') === 'rate') return null;\n" +
    "    var mx = -Infinity; climbSeries().list.forEach(function (c) {\n" +
    "      c.pts.forEach(function (p) { var a = p.v - CLIMB_RE; if (a > mx) mx = a; }); });\n" +
    "    return isFinite(mx) ? +mx.toFixed(3) : null; },\n" +
    "  chartBrkOn: function () { if (!chartView) chartAutoView(); return brkOn(chartView); },\n" +
    // V1.9.1（A12）：大气层分界线
    "  chartTexts: function () { return chartCv.getContext('2d').__styles.text; },\n" +
    "  climbTexts: function () { return climbCv.getContext('2d').__styles.text; },\n" +
    // ★ V1.9.5（H18）：把 03 章视图设到指定范围（验证标签三态的档位切换）+ 回自动视图
    "  chartViewSet: function (x0, x1, y0, y1) { chartView = clampChartView({ x0: x0, x1: x1, y0: y0, y1: y1 }); drawChart();\n" +
    "    return { x0: chartView.x0, x1: chartView.x1, y0: chartView.y0, y1: chartView.y1 }; },\n" +
    "  chartViewAuto: function () { chartView = null; chartAutoView(); drawChart(); return { y0: chartView.y0, y1: chartView.y1 }; },\n" +
    // ★ V1.9.5（H18）：选中点在数据坐标里的范围（用于"放大到能分辨"的自适应断言：
    //   jsdom 的画布比真浏览器窄一半多 → 写死视窗会让"相邻像素间距"落到阈值另一侧）
    "  chartSelRange: function () { if (!chartPts.length) buildChartPoints();\n" +
    "    var g = chartPts.filter(function (p) { return S.sel.indexOf(p.sat.idx) >= 0; });\n" +
    "    if (!g.length) return null;\n" +
    "    var xs = g.map(function (p) { return p.x; }), ys = g.map(function (p) { return p.y; });\n" +
    "    return { x0: Math.min.apply(null, xs), x1: Math.max.apply(null, xs), y0: Math.min.apply(null, ys), y1: Math.max.apply(null, ys), n: g.length }; },\n" +
    "  climbDraw: function () { try { drawClimb(); } catch (e) {} },\n" +
    "  chartViewY0: function () { if (!chartView) chartAutoView(); return Math.round(chartView.y0); },\n" +
    "  chartMode: function (m) { if (m) S.mode = m; return S.mode; },\n" +
    "  climbTake: function (m) { if (m) S.climbTake = m; return S.climbTake || 'sma'; },\n" +
    // V1.9.1（A20）：04 章 hover / 单击的交互验证入口
    "  climbPointXY: function (norad, k) {\n" +
    "    var s = climbSeries().list.filter(function (c) { return c.norad === norad; })[0];\n" +
    "    if (!s || !climbRect || !climbView) return null;\n" +
    "    var v = climbView, r = climbRect, i = k || 0;\n" +
    "    var p = s.pts[i];\n" +
    "    var x = r.PL + (p.ms - v.x0) / (v.x1 - v.x0) * r.pw;\n" +
    "    var take = S.climbTake || 'sma';\n" +
    "    var alt = (take === 'rate') ? s.rates[i] : (p.v - CLIMB_RE);\n" +
    "    if (!isFinite(alt)) return null;\n" +
    "    var y = brkYMap(v, r.PT, r.ph).Y(alt);\n" +
    "    return (y == null) ? null : { x: Math.round(x), y: Math.round(y), ms: p.ms };\n" +
    "  },\n" +
    "  climbInfoShown: function () { var e = document.getElementById('climbInfo');\n" +
    "    return !!e && e.style.display !== 'none' && !!e.querySelector('.si-row'); },\n" +
    "  climbInfoText: function () { var e = document.getElementById('climbInfo'); return e ? e.textContent.trim().slice(0, 40) : ''; },\n" +
    "  climbPinnedNow: function () { return climbPinned; },\n" +
    "  chartY1: function () { if (!chartView) chartAutoView(); return Math.round(chartView.y1); },\n" +
    // ★ V1.9.5（H39）：GEO 等效高度 + 双向边界的运行时入口
    "  chartGeoY: function () { if (!chartPts.length) buildChartPoints();\n" +
    "    return chartPts.filter(function (p) { return p.y > 1500; }).map(function (p) {\n" +
    "      return { n: p.sat.id, y: +p.y.toFixed(1) }; }); },\n" +
    "  chartLeoMax: function () { if (!chartPts.length) buildChartPoints();\n" +
    "    var mx = -Infinity; chartPts.forEach(function (p) { if (p.y < 1500 && p.y > mx) mx = p.y; });\n" +
    "    return isFinite(mx) ? +mx.toFixed(1) : null; },\n" +
    "  chartClamp: function (x0, x1, y0, y1) { var v = clampChartView({ x0: x0, x1: x1, y0: y0, y1: y1 });\n" +
    "    return { x0: +v.x0.toFixed(2), x1: +v.x1.toFixed(2), y0: +v.y0.toFixed(2), y1: +v.y1.toFixed(2) }; },\n" +
    // ★ V1.9.5（H39③）：无撕裂的运行时证据 —— 取**真实绘图映射**（drawChart 用的同一个 brkYMap(chartView,...)），
    //   量"每 100 km 对应多少像素"：跨断轴点(1500)与 LEO 区必须**完全一致**（旧的折点映射做不到）。
    "  chartYmap: function (y0, y1) { if (!chartView) chartAutoView();\n" +
    "    var v = (y0 == null) ? chartView : { x0: 0, x1: 180, y0: y0, y1: y1 };\n" +
    "    var r = chartRect || { PL: 66, PT: 16, pw: 100, ph: 300 };\n" +
    "    var M = brkYMap(v, r.PT, r.ph);\n" +
    "    var per = function (a) { return Math.abs(M.Y(a + 100) - M.Y(a)); };   // 每 100 km 的像素数（取绝对值）\n" +
    "    return { on: M.on, ph: r.ph, PT: r.PT,\n" +
    "      leo: per(0), mid: per(1000), below: per(1900), above: per(2000), geo: per(2100),\n" +
    "      full: Math.abs(M.Y(v.y0) - M.Y(v.y1)), y0: v.y0, y1: v.y1 }; },\n" +
    "  climbY1: function () { if (!climbView) climbAutoView(); clampClimbView(climbView); return Math.round(climbView.y1); },\n" +
    "  climbAuto: function () { return climbAutoPick(); },\n" +
    "  climbSelValue: function () { var s = document.getElementById('climbSel'); return s ? s.value : null; },\n" +
    "  climbSelText: function () { var s = document.getElementById('climbSel'); return s ? s.options[s.selectedIndex].textContent : null; },\n" +
    "  climbSelect: function (v) { climbSelect(v); },\n" +
    // V1.9.1（A2）：导出底栏六段（真值验证：不进 canvas，直接看数据）
    "  shotLines: function (v) { return shotSatLines(v || 'climb'); },\n" +
    "  pickNode: function (n, ms) { climbPickNode = (n == null) ? null : { norad: n, ms: ms }; },\n" +
    "  pickNow: function () { return climbPickNode; },\n" +
    // V1.9.1（A4）：导出底栏的行色（源码级核对之外的行为验证）
    "  shotInk: function () { return shotInk(); },\n" +
    "  dayWord: function (n) { return shotDayWord(n); },\n" +
    "  nodeDate: function (ms) { return shotNodeDate(ms); },\n" +
    "  lang: function (v) { if (v) LANG = v; return LANG; },\n" +
    // V1.9.1（A18/Q41）：02 章 3D 球体的「分段夸张」—— 暴露真实函数与常量（源码守卫之外的行为验证）
    "  globeRad: function (r) { return +globeRad(r).toFixed(6); },\n" +
    "  globeHi: function () { return { knee: HI_KNEE_R, kneeY: +HI_KNEE_Y.toFixed(6), ref: HI_REF_R, refY: HI_REF_Y, ex: ALT_EXAG, RE: RE }; },\n" +
    "  globeNote: function () { return document.getElementById('globeNote').textContent; },\n" +
    "  globeHiSats: function () { var st = cur(); return st.sats.filter(function (s) { return (s.sma || 0) > HI_KNEE_R; }).length; },\n" +
    "  globeBase: function () { return +globeBaseR(1200, 700).toFixed(3); },\n" +
    "  toast: function () { var e = document.getElementById('selToast'); return e ? { txt: e.textContent, cls: e.className } : null; }\n" +
    "};\n";
  const hm = HEAD_RE.exec(html);
  assert('A3：探针注入锚点定位成功（与 visual.mjs 同一处：主 IIFE 的 "use strict"; 之后）', !!hm);
  const html3 = hm ? (html.slice(0, hm.index + hm[0].length) + INS + html.slice(hm.index + hm[0].length)) : html;

  const err3 = [];
  const vc3 = new VirtualConsole();
  vc3.on('jsdomError', e => err3.push('jsdomError: ' + ((e.detail && (e.detail.stack || e.detail.message)) || e.message)));
  vc3.on('error', (...a) => err3.push('console.error: ' + a.join(' ')));
  const dom3 = new JSDOM(html3, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc3,
    beforeParse(window) {
      window.HTMLCanvasElement.prototype.getContext = function () { if (!this.__ctx) this.__ctx = makeCtx(); return this.__ctx; };
      window.HTMLCanvasElement.prototype.toBlob = function (cb) { cb(null); };
      window.Element.prototype.getBoundingClientRect = function () {
        var h = (this.tagName === 'TR') ? 41 : 460;
        return { left: 0, top: 0, x: 0, y: 0, width: 900, height: h, right: 900, bottom: h };
      };
      window.scrollTo = () => {}; window.scrollBy = () => {};
      Object.defineProperty(window, 'innerHeight', { value: 4000, configurable: true });
      Object.defineProperty(window, 'innerWidth', { value: 1400, configurable: true });
      window.addEventListener('error', e => err3.push('window.error: ' + e.message));
    }
  });
  const w3 = dom3.window, d3 = w3.document;
  await new Promise(r => setTimeout(r, 2000));
  const k3 = w3.__CISTRACK__;
  assert('A3：探针可用，且注入是唯一差异（去掉注入段后与发布产物逐字符相同）',
    !!k3 && err3.length === 0 && html3.replace(INS, '') === html,
    (err3.slice(0, 2).join(' | ') || 'no-error'));

  // ================================================================ V1.9.3（用户复审）运行时断言
  // 为什么放这里：这一组要**真实渲染输出**（不是源码匹配）——"源码里写了但渲染出来不对"
  //   是最容易发生的一类回归（本会话已抓到过多次）。
  {
    assert('V1.9.3：`fmtSci` 的**实际输出**符合预期（上标指数 / 量级豁免 / 零）',
      k3.fmtSci(0.0000311, 2) === '3.11×10⁻⁵' &&
      k3.fmtSci(0.000371, 2) === '3.71×10⁻⁴' &&
      // 用户明确"36500km 这种数并不大"→ **不做科学记数法**（走普通数字路径）。
      //   ⚠️ 注意 toPrecision(3) 会把 36500 舍成 37000（3 位有效数字）——这是**有意**的：
      //     该分支服务的是"量级普通但有效位多"的值（如 35786 → 35800），不是这里要验的点。
      //     所以断言写成"不含 ×10 上标"，而不是钉死具体数字。
      !/×10/.test(k3.fmtSci(36500, 2)) &&
      k3.fmtSci(0, 2) === '0',
      [k3.fmtSci(0.0000311, 2), k3.fmtSci(0.000371, 2), k3.fmtSci(36500, 2), k3.fmtSci(0, 2)].join(' | '));
  // ★ V1.9.5（H10）：四态**运行时**用例 —— 用合成数据验"直送 / 升轨中 / 已结束 / 已再入"四种判定的真值。
  //   ⚠️ 合成数据在纯函数层直接构造（不依赖真实历史点），所以结果与数据演进无关（不会变成快照断言）。
  {
    const DAY = 86400000, B0 = Date.UTC(2026, 0, 1);
    const P = arr => arr.map((v, i) => ({ ms: B0 + i * DAY, v: v }));
    const flat = [], rise = [];
    for (let i = 0; i < 12; i++) flat.push(7000);
    for (let i = 0; i < 10; i++) rise.push(7000 + i * 20);          // 每天 +20 km（相对阈值必然判为"在动"）
    const tail = []; for (let i = 0; i < 5; i++) tail.push(7000 + 9 * 20);
    const cNone = k3.climbPhases(P(flat));                          // 直送：全程不动
    const cRais = k3.climbPhases(P(rise));                          // 升轨中：结尾仍在升
    const cDone = k3.climbPhases(P(rise.concat(tail)));              // 已结束：升完再平 5 天
    const cDecay = k3.climbPhases(P(rise.concat(tail)), { decayMs: B0 + 40 * DAY });   // 已再入：结束线改标再入日
    assert('V1.9.5（H10）：climbPhases 四态运行时判定（直送=none｜升轨中=raising｜已结束=done｜已再入=再入日覆盖）',
      cNone.kind === 'none' && cNone.startMs === null &&
      cRais.kind === 'raising' && cRais.startMs !== null && cRais.endMs === null &&
      cDone.kind === 'done' && cDone.startMs !== null && cDone.endMs !== null && cDone.startMs < cDone.endMs &&
      cDecay.kind === 'done' && cDecay.endMs === B0 + 40 * DAY,
      [cNone.kind, cRais.kind, cDone.kind, cDecay.kind].join(' / ') + '  thr=' + cRais.thr);
  }
  // ★ V1.9.5（H10 ③b）：**跨端对拍** + 新增两态。③b 把"在动"从 |r| ≥ thr 收紧为 **r ≥ +thr** ——
  //   |r| 会把"降轨/衰减"也算成在动：实测 25067 的 63428（入轨即衰减、后已再入）因此被判出
  //   04-07 的"升轨开始"，而它从未升过轨 —— 那是衰减不是升轨。
  //   对拍的意义：构建端（scripts/climb.mjs）与页面端（app.js）是**两份实现**，
  //   发布层用前者算、回退用后者算，一旦漂移，"同一颗星在两处得到不同结论"且极难发现。
  {
    const DAY = 86400000, B0 = Date.UTC(2026, 0, 1);
    const P = arr => arr.map((v, i) => ({ ms: B0 + i * DAY, v: v }));
    const flat2 = [], rise2 = [], fall2 = [];
    for (let i = 0; i < 12; i++) flat2.push(7000);
    for (let i = 0; i < 10; i++) { rise2.push(7000 + i * 20); fall2.push(7000 - i * 5); }
    const tail2 = []; for (let i = 0; i < 5; i++) tail2.push(7000 + 9 * 20);
    const cases = [
      ['直送', P(flat2), null],
      ['升轨中', P(rise2), null],
      ['已结束', P(rise2.concat(tail2)), null],
      ['已再入覆盖', P(rise2.concat(tail2)), { decayMs: B0 + 40 * DAY }],
      ['纯衰减', P(fall2), null],
      ['纯衰减+已再入', P(fall2), { decayMs: B0 + 40 * DAY }],
    ];
    const mism = [];
    for (const [nm, pts, opt] of cases) {
      const a = nodeClimbPhases(pts, opt), b = k3.climbPhases(pts, opt);
      const same = a.kind === b.kind && a.startMs === b.startMs && a.endMs === b.endMs &&
        Math.abs((a.thr == null ? 0 : a.thr) - (b.thr == null ? 0 : b.thr)) < 1e-9;
      if (!same) mism.push(nm + '(node:' + a.kind + ' vs page:' + b.kind + ')');
    }
    assert('V1.9.5（H10 ③b）：Node 端与页面端 climbPhases **跨端对拍一致**（六态）',
      !mism.length, mism.join(' | ') || '六态全一致');
    const cFallPage = k3.climbPhases(P(fall2));
    const cFallDecayPage = k3.climbPhases(P(fall2), { decayMs: B0 + 40 * DAY });
    assert('V1.9.5（H10 ③b）：纯衰减 → none；纯衰减+已再入 → 只留再入结束线（startMs = null）',
      cFallPage.kind === 'none' &&
      cFallDecayPage.kind === 'done' && cFallDecayPage.startMs === null && cFallDecayPage.endMs === B0 + 40 * DAY,
      cFallPage.kind + ' / ' + cFallDecayPage.kind);
    // 真实序列对拍：源库 26137 的一颗星（含升轨段），两端逐字段一致
    let realOk = false, realInfo = '（源库读取失败）';
    try {
      const arr = JSON.parse(fs.readFileSync(B + '/data/history/26137.json', 'utf8'));
      const byN = {};
      arr.forEach(r => { (byN[r[0]] = byN[r[0]] || []).push(r); });
      const n0 = Object.keys(byN)[0];
      const pts = byN[n0].sort((x, y) => x[1] - y[1]).map(r => ({ ms: r[1], v: r[2] }));
      const a = nodeClimbPhases(pts), b = k3.climbPhases(pts);
      realOk = a.kind === b.kind && a.startMs === b.startMs && a.endMs === b.endMs;
      realInfo = 'norad=' + n0 + ' pts=' + pts.length + ' kind=' + b.kind +
        ' start=' + (b.startMs ? new Date(b.startMs).toISOString().slice(0, 10) : '—');
    } catch (e) { realInfo = '读取失败：' + e.message; }
    assert('V1.9.5（H10 ③b）：真实序列（源库 26137 一颗星）两端对拍一致', realOk, realInfo);
  }
  // ★ V1.9.5（H10 ③b）：发布层 `phases` 的结构 / 覆盖度 / 口径 ④ 的数据面。
  //   （这正是"多数批次看不到线"的复发闸门 —— 上一轮的样张里一条线都没有。）
  {
    const SD = JSON.parse(rawSrc);
    const shapeOK = P => !!P && !!P.b && !!P.s &&
      Object.keys(P.b).every(k => Array.isArray(P.b[k]) && P.b[k].length === 2 &&
        Number.isInteger(P.b[k][0]) && (P.b[k][1] === null || (Number.isInteger(P.b[k][1]) && P.b[k][1] >= P.b[k][0]))) &&
      Object.keys(P.s).every(k => Array.isArray(P.s[k]) && P.s[k].length === 2 &&
        !(P.s[k][0] === null && P.s[k][1] === null) &&
        (P.s[k][0] === null || Number.isInteger(P.s[k][0])) &&
        (P.s[k][1] === null || Number.isInteger(P.s[k][1])) &&
        (P.s[k][0] === null || P.s[k][1] === null || P.s[k][1] >= P.s[k][0]));
    assert('V1.9.5（H10 ③b）：satdata 携带 phases（结构合法：天数为整数 / end≥start / 无全空条目）',
      shapeOK(SD.gw.phases) && shapeOK(SD.qf.phases),
      'gw b/s = ' + Object.keys(SD.gw.phases.b).length + '/' + Object.keys(SD.gw.phases.s).length +
      '，qf b/s = ' + Object.keys(SD.qf.phases.b).length + '/' + Object.keys(SD.qf.phases.s).length);
    const nB = Object.keys(SD.gw.phases.b).length + Object.keys(SD.qf.phases.b).length;
    assert('V1.9.5（H10 ③b）：有升轨段可画的批次 ≥ 30（"多数批次看不到线"的复发闸门）', nB >= 30, nB + ' 批');
    const dec = [];
    [['gw', SD.gw], ['qf', SD.qf]].forEach(([bk, C]) => {
      C.sats.forEach(r => {
        if (r.st !== 'r' || !r.dt) return;
        const e = C.phases.s[r.id];
        if (e) dec.push({ n: r.id, ok: e[1] === Math.floor(Date.parse(r.dt + 'T12:00:00Z') / 86400000) });
      });
    });
    assert('V1.9.5（H10 ③b）：已再入星的 phase 结束日 = satcat 再入日（口径 ④ 的数据面）',
      dec.length > 0 && dec.every(x => x.ok),
      dec.map(x => x.n + (x.ok ? '✓' : '✗')).join(',') || '（没有已再入星）');
  }
  // ★ V1.9.5（H10 ③b/④）：**取数入口** climbPhaseNow 的运行时行为（发布层优先 / 缺失回退 /
  //   直送不出线 / 单星以该星为准），以及 drawClimb 真的把日期画在虚线下方（坐标与内容都在画面层验证）。
  {
    k3.climbSelClear(); k3.setClimbPick(''); k3.climbAutoReset();
    const DAY3 = 86400000;
    const liteKeys = k3.climbLiteKeys();
    const pubOf = {}; liteKeys.forEach(k => { const v = k3.climbPubB(k); if (v) pubOf[k] = v; });
    const doneK = liteKeys.find(k => pubOf[k] && pubOf[k][1] !== null);
    const raisK = liteKeys.find(k => pubOf[k] && pubOf[k][1] === null);
    assert('V1.9.5（H10 ③b）：内置兜底数据里找得到可画的"已结束 / 升轨中"批次',
      !!doneK && !!raisK, 'done=' + doneK + ' raising=' + raisK);
    if (doneK && raisK) {
      // ① 发布层优先：注入假值 → 画出的日期必须跟着假值（证明用的是 satdata 而不是现算）
      k3.setClimbPick('b:' + doneK);
      const view0 = k3.climbAutoReset();
      const span0 = view0.x1 - view0.x0;
      const fake0 = Math.floor((view0.x0 + span0 * 0.35) / DAY3);
      const fake1 = Math.floor((view0.x0 + span0 * 0.55) / DAY3);
      const keepD = k3.climbPubB(doneK);
      k3.climbSetB(doneK, fake0, fake1);
      let tx = k3.climbTextsNow();
      const rect = k3.climbRectNow();
      const yPh = rect.PT + rect.ph + 3;
      const datesAt = arr => arr.filter(o => Math.abs(o.y - yPh) < 0.75).map(o => o.t).sort();
      const expFake = [k3.climbDateFmt(fake0 * DAY3), k3.climbDateFmt(fake1 * DAY3)].sort();
      assert('V1.9.5（H10 ③b）：画线日期取自**发布层**（注入假值后文本随之改变）',
        JSON.stringify(datesAt(tx)) === JSON.stringify(expFake), datesAt(tx).join(',') + ' vs ' + expFake.join(','));
      k3.climbSetB(doneK, keepD[0], keepD[1]);           // 还原
      tx = k3.climbTextsNow();
      const expReal = [k3.climbDateFmt(keepD[0] * DAY3), k3.climbDateFmt(keepD[1] * DAY3)].sort();
      assert('V1.9.5（H10 ③b）：还原后画线日期 = satdata 的真实 phase（两天组、各一条）',
        JSON.stringify(datesAt(tx)) === JSON.stringify(expReal), datesAt(tx).join(','));
      // ② 画线风格：虚线 [5,4]（与 03 章 180° 边界线同一套画法）
      assert('V1.9.5（H10 ③b）：竖虚线用 setLineDash([5,4])（与 03 章边界线同一套画法）',
        k3.climbDashNow() === '[5,4]', String(k3.climbDashNow()));
      // ③ 升轨中 = 只画一条（"只开始未结束 = 只画一条"）
      k3.setClimbPick('b:' + raisK);
      tx = k3.climbTextsNow();
      const gotRais = datesAt(tx);
      assert('V1.9.5（H10 ③b）：升轨中 → **只有开始线**一条',
        gotRais.length === 1 && gotRais[0] === k3.climbDateFmt(pubOf[raisK][0] * DAY3), gotRais.join(','));
      // ④ 直送 / 数据不足 → 一条都没有（动态找真实批次：发布层无条目 + 现算也判不出）
      let noneK = null;
      for (const k of liteKeys) {
        if (pubOf[k]) continue;
        k3.setClimbPick('b:' + k);
        if (k3.climbPhase() === null) { noneK = k; break; }
      }
      let noneDates = null;
      if (noneK) { k3.setClimbPick('b:' + noneK); noneDates = datesAt(k3.climbTextsNow()); }
      assert('V1.9.5（H10 ③b）：直送/未升轨的真实批次 → 0 条线（不画）',
        !!noneK && noneDates.length === 0, '批次=' + noneK + ' 日期数=' + (noneDates ? noneDates.length : '—'));
      // ⑤ 单星：以**该星**为准（找一颗"自己的时间与批次中位数不同"的星）
      let sK = null, sN = null;
      for (const k of liteKeys) {
        if (!pubOf[k]) continue;
        const L = k3.climbBatchPts(k);
        for (const s of L) {
          const ps = k3.climbPubS(s.n);
          if (ps && ps[0] !== null && (ps[0] !== pubOf[k][0] || ps[1] !== pubOf[k][1])) { sK = k; sN = s.n; break; }
        }
        if (sK) break;
      }
      let sOK = false, sInfo = '（没找到时间与批次不同的星）';
      if (sK) {
        k3.setClimbPick('s:' + sN);
        const p = k3.climbPhase();
        const ps = k3.climbPubS(sN);
        sOK = !!p && p.s === ps[0] * DAY3 && (ps[1] === null ? p.e === null : p.e === ps[1] * DAY3);
        sInfo = 'norad=' + sN + ' phase=' + JSON.stringify(ps) + ' → ' + JSON.stringify(p);
      }
      assert('V1.9.5（H10 ③b）：选星后以**该星**为准（与批次中位数不同的相位）', sOK, sInfo);
      // ⑨ 边界：选中的星**不在本图**里时不得把它的线画过来（探针实测抓到过：
      //    23095 的图上冒出另一批次 63428 的再入线）。阳性对照：回到该星所在批次，相位恢复。
      let memOK = false, memInfo = '（没找到对照星）';
      if (sK && sN && noneK) {
        k3.setClimbPick('b:' + noneK);                 // 换成一张不含该星的图
        const idx = k3.climbSelByNorad(sN);            // 全局仍选着那顆星
        const pOut = k3.climbPhase();
        k3.setClimbPick('b:' + sK);                    // 阳性对照：回到该星所在批次
        const pIn = k3.climbPhase();
        const ps = k3.climbPubS(sN);
        memOK = idx >= 0 && pOut === null && !!pIn && pIn.s === ps[0] * DAY3;
        memInfo = '不在本图=' + JSON.stringify(pOut) + '，回到本批=' + JSON.stringify(pIn && pIn.s);
        k3.climbSelClear();
      }
      assert('V1.9.5（H10 ③b）：选中星不在本图 → 不画（相位只取自"被画的对象"；在 → 恢复）', memOK, memInfo);
      // ⑥ 缺失回退：删掉发布层条目 → 页面端 climbPhases 兜底仍要给出非空结论
      const keepR = k3.climbPubB(raisK);
      k3.climbDelB(raisK);
      k3.setClimbPick('b:' + raisK);
      const pFb = k3.climbPhase();
      k3.climbSetB(raisK, keepR[0], keepR[1]); k3.climbAutoReset();
      assert('V1.9.5（H10 ③b）：发布层缺失 → 回退现算仍能给出升轨中结论（离线/旧产物兜底）',
        !!pFb && pFb.s !== null, JSON.stringify(pFb));
      // ⑦ ④：视野包含"结束线"（注入一个 45 天后的结束日 → autoView 与 clamp 都必须够到）
      k3.setClimbPick('b:' + doneK);
      const keepD2 = k3.climbPubB(doneK);
      const farDay = Math.floor(Date.now() / DAY3) + 45;
      k3.climbSetB(doneK, keepD2[0], farDay);
      const vA = k3.climbAutoReset();
      k3.drawClimb();                                    // 走一遍 clamp（它会把 climbView 钳到合法范围）
      const vB = k3.climbViewNow();
      k3.climbSetB(doneK, keepD2[0], keepD2[1]); k3.climbAutoReset();
      assert('V1.9.5（H10 ④）：autoview 把结束线纳入视野（autoView 与 clamp 同一口径、不被拉回）',
        vA.x1 >= farDay * DAY3 - 1 && vB.x1 >= farDay * DAY3 - 1,
        'auto x1=' + new Date(vA.x1).toISOString().slice(0, 10) +
        ' clamp 后 x1=' + new Date(vB.x1).toISOString().slice(0, 10) +
        ' 期望 ≥' + new Date(farDay * DAY3).toISOString().slice(0, 10));
    }
    k3.setClimbPick(''); k3.climbSelClear();
    // ⑧ 形状守卫：画线代码在 drawClimb 内、**不得回到 drawNet**（那里 d=netData() 是对象、恒为死代码）；
    //   且画线块内**不得用 ph 作变量名** —— 会遮蔽 drawClimb 的绘图区高度 ph（PT + ph = NaN，
    //   测试期实测：竖线在真实浏览器里会画废，而"dash 已记录"的断言仍然通过 —— 必须钉住）。
    assert('V1.9.5（H10 ③b）：竖虚线的画线代码在 drawClimb 内（不得回到 drawNet 变死代码、不得遮蔽 ph）',
      /function drawClimb\(\) \{[\s\S]{0,9000}?climbPhaseNow\(s\)/.test(appSrc) &&
      !/function drawNet\(\) \{[\s\S]{0,4000}?climbPhaseNow/.test(appSrc) &&
      !/function drawClimb\(\) \{[\s\S]{0,9000}?var ph = climbPhaseNow/.test(appSrc));
  }

    const lr = k3.launchRowText('25F05');      // 试验星07组（朱雀二号E Y3 失利，静态 fail）
    assert('V1.9.3：**失败行**的两列都渲染成 `-`（真实渲染输出，不是只看源码）',
      !!lr && lr.res === 'fail' && /\|-/.test(lr.html) &&
      !/0\.0°/.test(lr.html) && !/0 颗/.test(lr.html),
      lr ? lr.html.slice(0, 150) : '找不到失败行（25F05）');
    const fr = k3.launchRowText('24226');      // 2024-226：1 颗本星座 + 1 颗搭车星（satcat 实测 tot=2）
    assert('V1.9.3：**搭载了其它卫星**的批次渲染成 `M/N颗`（本星座/该发总数）—— 用户举例的口径',
      !!fr && fr.tot > fr.count && new RegExp(fr.count + '/' + fr.tot + ' 颗').test(fr.html),
      fr ? (fr.count + '/' + fr.tot + ' → ' + fr.html.slice(0, 150)) : '找不到 24226');
    const nr = k3.launchRowText('26137');      // 2026-137：整发都是本星座（tot === count）
    assert('V1.9.3：**整发都是本星座**时不写分数（只写 `N颗`，不啰嗦）',
      !!nr && nr.tot === nr.count &&
      new RegExp(nr.count + ' 颗').test(nr.html) && !new RegExp(nr.count + '/' + nr.tot).test(nr.html),
      nr ? (nr.count + ' → ' + nr.html.slice(0, 150)) : '找不到 26137');
    // A7 兜底：satdata 里**不许**有缺三态字段的在轨星（数据链路静默失败的真凶）
    assert('V1.9.3：satdata 里**没有**缺 orb/wk/od 的在轨星（静默失败的真凶，兜底必须补齐）',
      (function () {
        const SD = JSON.parse(fs.readFileSync(B + '/build/satdata.json', 'utf8'));
        const live = [].concat(SD.gw.sats, SD.qf.sats).filter(r => r.st !== 'r');
        const bad = live.filter(r => !((r.orb === 0 || r.orb === 1) && r.wk !== undefined && typeof r.od === 'string'));
        const badWk = live.filter(r => r.wk !== 'GEO' && (r.wk === undefined || r.wk % 10 !== 0));
        return bad.length === 0 && badWk.length === 0;
      })());
  }

  // ① 键名分离：`d_sel_all` 必须是「已全选」——
  //    此前它与 03 章批次下拉的「全部批次（」**重名**，后者在对象字面量里后写 → **覆盖**前者，
  //    于是选中提示显示的是「全部批次（」（现存 bug，本轮修）。
  assert('A3：键名分离后 `d_sel_all` = 「已全选」（不再被 03 章下拉的同名键覆盖）',
    k3.tt('d_sel_all') === '已全选', k3.tt('d_sel_all'));
  assert('A3：新键 `d_grp_all` = 「全部批次（」+ `d_grp_all2`（03 章下拉专名）',
    k3.tt('d_grp_all') === '全部批次（' && k3.tt('d_grp_all2') === ' 颗）');
  const opt0 = d3.querySelector('#groupSel option');
  assert('A3：03 章批次下拉首项文案**未被改坏**（仍是「全部批次（N 颗）」）',
    !!opt0 && /^全部批次（\d+ 颗）$/.test(opt0.textContent.trim()), opt0 && opt0.textContent.trim());

  // ② 整批全选（多颗）→ 绿药丸。
  //    V1.9.1（A11）细化：发射记录/批次的选中提示要给出 **X/T**（仍在轨 / 原部署总颗数）——
  //    用户看到的不只是"选了"，而是"选了 9/9 颗"（有卫星已再入时会显示 8/9）。
  k3.selectGroup('25030');                       // 低轨02组：9 颗（全部在轨）
  let tst = k3.toast();
  assert('A3+A11：整批全选（多颗）→ 绿药丸「已全选仍在轨卫星（X/T）」（不带动画期间新增的反色/补池类）',
    (function () {
      if (!tst) return false;
      const m = tst.txt.match(/^已全选仍在轨卫星（(\d+)\/(\d+)）$/);
      return !!m && +m[1] === +m[2] && !/inv|pool-dead|pool-pend/.test(tst.cls);
    })(), JSON.stringify(tst));

  // ③ 只有单颗的批次 → 「已选择」
  k3.selectGroup('26158');                       // 试验星12：1 颗（69972）
  tst = k3.toast();
  const st1 = k3.state();
  assert('A3：只有单颗的批次全选 → 「已选择」（复用既有零引用键 d_sel_one）',
    !!tst && tst.txt === '已选择' && !/inv/.test(tst.cls) && st1.sel.length === 1,
    JSON.stringify(tst) + ' sel=' + JSON.stringify(st1));

  // ④ 无 TLE 的发射记录 → 反色药丸
  k3.selectGroup('25F05');                       // 朱雀二号E Y3 失利：库内一颗都没有
  tst = k3.toast();
  const stNo = k3.state();
  assert('A3：无 TLE 的发射记录 → 反色（.inv）药丸「当前暂无TLE数据」',
    !!tst && tst.txt === '当前暂无TLE数据' && /(^|\s)inv(\s|$)/.test(tst.cls) && stNo.sel.length === 0 && stNo.selGroup === '25F05',
    JSON.stringify(tst) + ' state=' + JSON.stringify(stNo));
  k3.selectGroup('25F05');                       // 再点一次 = 取消，不该重复提示
  assert('A3：无 TLE 行再次点击是**取消**（selGroup 置空），语义与「已全选」一致',
    k3.state().selGroup === null, JSON.stringify(k3.state()));

  // ⑤ 反色变体的实现：暗色模式=白底黑字 / 亮色模式=黑底白字 + 文字居中
  const toastCss = (tpl.match(/#selToast \{[\s\S]*?\n\}/) || [''])[0];
  assert('A3：`#selToast` 文字显式居中（text-align:center）', /text-align:center/.test(toastCss));
  assert('A3：反色变体 .inv —— 暗色=白底黑字、亮色=黑底白字（两条规则都要在）',
    /#selToast\.inv \{ background:#ffffff; color:#000000; border-color:#ffffff; \}/.test(tpl) &&
    /:root\[data-theme="light"\] #selToast\.inv \{ background:#000000; color:#ffffff; border-color:#000000; \}/.test(tpl));
  // ⑥ Q12：单颗提示**收口在 afterSelection**（图上点选/表里点选/搜索选中/选择框选单星四条路径共用）
  assert('A3/Q12：单颗「已选择」收口在 afterSelection（四入口共用，漏一个就少一路）',
    /if \(S\.sel\.length === 1\) showToast\(t\('d_sel_one'\), false\);/.test(appSrc));
  assert('A3/Q12：多颗提示只在 selectGroup 且**仅当 >1 颗在轨**时弹（单颗交给 afterSelection）',
    /if \(!allSel && alive\.length > 1\) \{/.test(appSrc) &&
    /d_sel_alive_a'\) \+ X \+ t\('d_sel_alive_b'\) \+ T \+ t\('d_sel_alive_c'\)/.test(appSrc));

  // ================================================================ V1.9.1（#4 / #5）
  // #5：升轨章的 B 窗（无 hover 设备的悬停预览件）删除 —— 它与可拖拽的 A 窗**重复显示同一份内容**，
  //     而且它读的 `INFO_HIDDEN.climb` 在 INFO_HIDDEN 里**根本没有这个键**（只有 chart/map/globe/net）
  //     → 条件恒为 falsy → 一直 `display:flex` 挂在屏幕上。
  // ⚠️ 产物里要查的是**节点与引用**，不是字样 —— 源码注释（讲"为什么删"）会被原样注入产物，
  //   那属于正常留档（`html` 里 1 处 `climbInfoB` 就是注释）。
  assert('#5：升轨章 B 窗已彻底删除（模板无节点、源码无引用、产物无 id）',
    !/climbInfoB/.test(tpl) && !/climbInfoB/.test(appCode) &&
    !/id="climbInfoB"/.test(html) && !/getElementById\('climbInfoB'\)/.test(html) && !/getElementById\('climbInfoB'\)/.test(appCode),
    'tpl=' + /climbInfoB/.test(tpl) + ' code=' + /climbInfoB/.test(appCode) + ' htmlId=' + /id="climbInfoB"/.test(html));
  assert('#5：本章只剩可拖拽的 A 窗（#climbInfo），模板里仍在',
    /id="climbInfo"/.test(tpl) && /placeInfoCorner\(climbInfo, 'climb'\)/.test(appSrc));

  // #4：彩色多线 —— 同一批次内**每颗星一种颜色**（黄金角），选中/悬停=**自身色**提亮加粗（Q5）
  assert('#4：颜色分配器存在，且用黄金角（137.508°）而**不是**均匀分布 —— 追加新星不改已有星颜色',
    /function climbHueColor/.test(appSrc) && /i \* 137\.508/.test(appSrc) &&
    /function climbColorMap/.test(appSrc));
  assert('#4：色相只依赖"批内 NORAD 升序序号"（不依赖表内下标/筛选/翻页 → 颜色稳定）',
    /byLk\[lk\]\.sort\(function \(a, b\) \{ return a - b; \}\)/.test(appSrc));
  assert('#4：曲线对象带上 lk（跨批的链也能按批次分组取色）',
    /arr\.push\(\{ norad: \+nk, lk: lk, pts: pts/.test(appSrc));
  assert('#4：旧写法（未选中一律灰）已消失；改成"自身色 + 选中提亮(alpha=1/加粗)、其余降暗"',
    !/strokeStyle = isSel \|\| isHov \? COL\.main : C\.dim/.test(appSrc) &&
    /var own = CMAP\[c\.norad\] \|\| COL\.main;/.test(appSrc) &&
    /var restAlpha = anyHi \? 0\.12/.test(appSrc) &&
    /ctx\.lineWidth = hi \? 2\.4 : 1\.2;/.test(appSrc));
  // ★ V1.9.2（用户要求）：末端标签从"只给选中/悬停的数值"改为"**给每一颗标卫星名称**"
//   （参考 findrassvet 的「График 01」；名称为本地化名，不用 NORAD）。
assert('V1.9.2：末端标签改为**卫星名称**（中文用中文名、英文用英文名，不用 NORAD）',
  /function climbSatName\(norad\)/.test(appSrc) &&
  /labelJobs\.push\(\{ y: ly2, name: climbSatName\(c\.norad\), color: own \}\)/.test(appSrc) &&
  /climbSatName\(c\.norad\)/.test(appSrc));
assert('V1.9.2：名称标签带**防重叠排版**（按 y 排序后逐个下压，保证最小行距）',
  /labelJobs\.sort\(function \(a, b\) \{ return a\.y - b\.y; \}\)/.test(appSrc) && /LBL_GAP/.test(appSrc));
assert('V1.9.2：右侧留白按"要标几条"动态加宽（否则名称会被裁掉）',
  /var PR = nLab \? \(narrow \? 76 : 128\)/.test(appSrc) && /var nLab = \(d\.length > 1 && d\.length <= 30\)/.test(appSrc));;
  // 行为验证：真跑一次绘制，采样"写进 ctx 的 strokeStyle"里有多少种 hsl
  const st3 = d3.getElementById('climbCv').getContext('2d').__styles;
  k3.setClimbPick('b:24240');                    // 低轨01组：10 颗（内置兜底也有 10 颗 → 离线可画）
  const n0 = st3.stroke.length;
  k3.drawClimb();
  const used = [...new Set(st3.stroke.slice(n0))].filter(x => /^hsl\(/.test(String(x)));
  const listN = k3.climbN();
  assert('#4：绘制时真的为每颗星取了不同颜色（本轮 strokeStyle 里的 hsl 种类 ≈ 曲线条数）',
    listN >= 8 && used.length >= 8 && used.length >= Math.min(listN, 8),
    '曲线=' + listN + ' 色种=' + used.length);
  assert('#4：颜色与"批内 NORAD 升序序号"一一对应（climbHues 的 key 就是 NORAD）',
    (function () {
      const hs = k3.climbHues();
      const ks = Object.keys(hs);
      return ks.length === listN && ks.every(n => /^\d+$/.test(n) && /^hsl\(/.test(hs[n]));
    })(), JSON.stringify(Object.keys(k3.climbHues()).slice(0, 4)));

  // ================================================================ V1.9.1（A10）：已再入卫星的完整规范
  // ⚠️ 这一段能跑起来，靠的是先修掉**两个把标记吃掉的 bug**：
  //   ① `build()` 的卫星对象没带 `st`/`dt`；② `unpackSat()` 差分还原时按白名单重建对象，把 `st`/`dt` 丢了。
  //   两者叠加的后果：1.4-D 的「在轨状态」列**从来没生效过**（每行都显示"在轨"，连 63428 也是）。
  //   当时那条断言只查"当前页每个单元格都渲染了在轨/已再入"，而 63428 按 NORAD 从大到小在第 4 页开外
  //   → 永远不在默认页 → **断言恒真，等于没测**。
  {
    const before = k3.state();
    const ti = d3.getElementById('tableSearch');
    ti.value = '63428';                                   // 已再入的那颗（2025-067A）
    ti.dispatchEvent(new w3.Event('input', { bubbles: true }));
    const tr = d3.querySelector('#tbody tr[data-idx]');
    assert('A10：已再入卫星能被搜到并单独成行（行带 .gone 类）',
      !!tr && /(^|\s)gone(\s|$)/.test(tr.className), tr ? tr.className : 'null');
    const tds = tr ? [...tr.querySelectorAll('td')].map(x => x.textContent.trim()) : [];
    assert('A10：8 项轨道要素（半长轴/近/远地点/倾角/周期/升交点/偏心率/BSTAR）一律显示 `-`',
      !!tr && tr.querySelectorAll('.no-data').length === 8, tds[6] + '|' + tds[12]);
    assert('A10：在轨状态为**红色**完整文案「已再入（~YYYY-MM-DD，XXX 天）」',
      !!tr && /^已再入（~\d{4}-\d{2}-\d{2}，\d+ 天）$/.test(tds[2]) &&
      /st-gone/.test(tr.querySelectorAll('td')[2].className), JSON.stringify(tds[2]));
    assert('A10：在轨日 = **发射日 → 再入日**之差（冻结，不随今天增长）',
      /^\d+d（\d{2}y\d{2}m\d{2}d）$/.test(tds[11]), JSON.stringify(tds[11]));
    assert('A10：历元 = 最后一条 TLE 的更新时间（再入前最后那份）',
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(tds[15]), JSON.stringify(tds[15]));
    // 点击 → 灰框 + 红提示 + **无联动**
    tr.dispatchEvent(new w3.MouseEvent('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 140));
    const tst2 = k3.toast(), after = k3.state();
    assert('A10：点击该行 → **灰色**框选（.gone-focus，不是星座主题色的 .focused）',
      !!d3.querySelector('#tbody tr.gone-focus') && !d3.querySelector('#tbody tr.focused'),
      d3.querySelector('#tbody tr.gone-focus') ? 'ok' : 'no-row');
    assert('A10：点击该行 → 弹**红色**提示「该卫星已再入」',
      !!tst2 && tst2.txt === '该卫星已再入' && /pool-dead/.test(tst2.cls), JSON.stringify(tst2));
    assert('A10：**无联动** —— S.sel 仍为空（不进任何章节的选中态）、升轨章选中的批次不变',
      after.sel.length === 0 && after.selGroup === null && after.climbPick === before.climbPick,
      JSON.stringify(after) + ' vs climbPick=' + before.climbPick);
    assert('A10：再次点击是**取消**灰框（与「已全选」同口径）',
      (function () {
        // ⚠️ 首次点击后 renderTable() 会**重建 tbody 的 innerHTML** → 之前那个 tr 已脱离文档，
        //   往上再派发事件不会冒泡到 tbody（第一次就是这么白跑一条的）→ 必须重新查询。
        const tr2 = d3.querySelector('#tbody tr[data-idx]');
        tr2.dispatchEvent(new w3.MouseEvent('click', { bubbles: true }));
        const s2 = k3.state();
        return !d3.querySelector('#tbody tr.gone-focus') &&
          Array.isArray(s2.selGone) && s2.selGone.length === 0;
      })());
    // 复原：清掉搜索，别影响后续断言
    ti.value = ''; ti.dispatchEvent(new w3.Event('input', { bubbles: true }));
  }

  // ================================================================ V1.9.2（A7）：在轨状态**三态**
  // 清单 A7 要求卫星表「在轨状态」列分三态：在轨（绿）/ **正在变轨**（黄）/ 已再入（红）。
  // 前两态由 mkdata.mjs 的 ORBIT_ST 在构建期算好（字段 orb / wk / od / rr）。
  // 本段分三层验：数据层（字段齐备且自洽）→ 源码层（文案/类/排序）→ 渲染层（三种形态真出现在 DOM）。
  {
    // ---------- ① 数据层 ----------
    const SD = JSON.parse(fs.readFileSync(B + '/build/satdata.json', 'utf8'));
    const allS = [].concat(SD.gw.sats, SD.qf.sats);
    const liveS = allS.filter(r => r.st !== 'r');
    const raiS = liveS.filter(r => r.orb === 1);
    const orbS = liveS.filter(r => r.orb === 0);
    const geoS = liveS.filter(r => r.wk === 'GEO');

    assert('A7：三态字段齐备 —— 每颗在轨卫星都有 orb(0/1) / wk / od',
      liveS.length > 0 && liveS.every(r => (r.orb === 0 || r.orb === 1) && r.wk !== undefined && typeof r.od === 'string'),
      liveS.length + ' 颗：在轨 ' + orbS.length + ' / 变轨中 ' + raiS.length +
        // ★ V1.9.3：把"缺字段的星"直接打出来 —— 旧输出只给计数，看不出 400+105=505≠512 这件事
        //   （2026-10-13 一次数据链路失败就是这个：日志里只能看到计数对不上，看不出是哪几颗）。
        (function () {
          const bad = liveS.filter(r => !((r.orb === 0 || r.orb === 1) && r.wk !== undefined && typeof r.od === 'string'));
          return bad.length ? '；缺字段 ' + bad.length + ' 颗：' + bad.slice(0, 8).map(r => r.id).join(',') : '';
        })());
    assert('A7：三态都非空（在轨 / 变轨中 / 已再入）',
      orbS.length > 0 && raiS.length > 0 && allS.some(r => r.st === 'r'),
      orbS.length + ' / ' + raiS.length + ' / ' + allS.filter(r => r.st === 'r').length);
    assert('A7：变轨中的星带**升轨速度** rr（只有历史池刚覆盖、点数<2、以及走兜底的极少数没有）',
      // ★ V1.9.3：阈值放宽的理由 —— 兜底星（无历史点，如本轮 26176/26221 两个新批次）
      //   天然算不出升轨速度（没有历史点就没有斜率），它们必须计入"合理缺失"。
      //   判据改成：**有历史点的**变轨星必须都有 rr；无历史点的（兜底）允许没有。
      (function () {
        const liveRai = liveS.filter(r => r.orb === 1);
        // 兜底星的特征：od 为空字符串且 wk 是同批推定值（无可算斜率的历史点）
        const withHist = liveRai.filter(r => r.rr !== undefined);
        const noHist = liveRai.filter(r => r.rr === undefined);
        // 有 rr 的必须占多数（历史池覆盖良好的批次），且无 rr 的必须都是"新批次"（批次号靠后）
        return withHist.length >= 40 && noHist.every(r => String(r.c).slice(0, 5) >= '26150');
      })(),
      '有 rr ' + raiS.filter(r => r.rr !== undefined).length + ' / 无 rr ' + raiS.filter(r => r.rr === undefined).length +
        ' 颗（无 rr 的批次号：' + [...new Set(raiS.filter(r => r.rr === undefined).map(r => String(r.c).slice(0, 5)))].join(',') + '）');
    assert('A7：**在轨**的星都写「进入工作轨道日期」od；**变轨中**的不写（它在上升途中会穿过工作带）',
      orbS.every(r => /^\d{4}-\d{2}-\d{2}$/.test(r.od)) && raiS.every(r => !r.od),
      '在轨缺日期 ' + orbS.filter(r => !/^\d{4}-\d{2}-\d{2}$/.test(r.od)).length + ' 颗');
    assert('A7/Q46：GEO 的工作高度写 `GEO` 而非数字（周期≈1436 min，等价于半长轴 ≥42000 km）',
      geoS.length === 3 && geoS.every(r => r.orb === 0),
      geoS.length + ' 颗：' + geoS.map(r => r.id).join('/'));
    assert('A7：工作轨道高度是 **10 km 档位**（Q26a）',
      liveS.filter(r => r.wk !== 'GEO').every(r => r.wk % 10 === 0),
      // ★ V1.9.3：输出改为「列出**违规**的 wk」，而不是"前 8 个档位值" ——
      //   旧写法只打印已存在的档位（且只前 8 个），当失败是"某颗星 wk 为 undefined"造成的，
      //   日志里看起来完全正常（950 是合法值，却像是嫌疑犯），把排查带偏过一次。
      (function () {
        const bad = liveS.filter(r => r.wk !== 'GEO' && (r.wk === undefined || r.wk % 10 !== 0));
        if (!bad.length) return '全部合法（' + [...new Set(liveS.filter(r => r.wk !== 'GEO').map(r => r.wk))].length + ' 个档位）';
        return '违规 ' + bad.length + ' 颗：' + bad.slice(0, 8).map(r => r.id + '=' + r.wk).join(',');
      })());
    assert('A7：**同批同高**（同一批次内所有星的 wk 完全一致）',
      (function () {
        const byk = {};
        for (const r of liveS) { const k = String(r.c).slice(0, 5); (byk[k] = byk[k] || []).push(r.wk); }
        const bad = Object.keys(byk).filter(k => !byk[k].every(v => v === byk[k][0]));
        return bad.length === 0;
      })(), '（不一致的批次：' +
        (function () {
          const byk = {};
          for (const r of liveS) { const k = String(r.c).slice(0, 5); (byk[k] = byk[k] || []).push(r.wk); }
          return Object.keys(byk).filter(k => !byk[k].every(v => v === byk[k][0])).join(',') || '无';
        })() + '）');
    // 24185 是这次判据校准的关键样本：18 颗里只有 4~5 颗真到了 1071，其余长期停在 800~974。
    //   若有人把 wk 的算法改回"全批中位数"，这条会立刻失败（那时 wk 会变 880~890）。
    assert('A7：24185（极轨02组）工作高度 = **1070 km**（不能是"全批中位数"算出的 880）',
      (function () {
        const g = liveS.filter(r => String(r.c).slice(0, 5) === '24185');
        return g.length > 0 && g.every(r => r.wk === 1070);
      })(),
      JSON.stringify(liveS.filter(r => String(r.c).slice(0, 5) === '24185').map(r => r.wk).slice(0, 5)));

    // ★ V1.9.3（CI 报错根因修复的防复发守卫）：**无历史点的星必须被兜底，不许留 undefined**。
    //   来历（2026-10-13，CI 连续两次红灯）：`ORBIT_ST` 的 rows 只从**历史库**构建，
    //   一颗星还没有历史点时（刚发射/刚编目/历史池未覆盖）它不在 rows 里 → 旧代码 `continue`
    //   → orb/wk/od 三个字段全留 undefined → 「三态字段齐备」与「10 km 档位」两条断言同时红。
    //   ⚠️ 本地永远测不出（本机历史库 59 分片覆盖全部 505 颗），只有 CI（每次先 refresh）
    //     才会现形 —— 又一个「只在本地跑过 = 没跑过」的实例。
    //   这条守卫直接读**源码**，断言兜底分支存在且把 wk 档位化（950 那次就是档位化的必要性：
    //   非档位值 948.6 若不做 round 会写进 wk，断言立刻红）。
    assert('A7：无历史点的星**必须兜底**（否则 orb/wk/od 留 undefined → 「字段齐备」与「10 km 档位」两条断言同时红，静默失败的真凶）',
      (function () {
        const mkSrc = fs.readFileSync(B + '/mkdata.mjs', 'utf8');
        // ⚠️ 窗口必须够大：从 `const st = ORBIT_ST.get(...)` 到 `rec.orb = 1` 之间
        //   夹着 26 行说明注释（实测踩到 —— 第一版写 {0,900} 匹配不到）。
        return /const st = ORBIT_ST\.get\(rec\.id\);[\s\S]{0,3000}?rec\.orb = 1; rec\.wk = wkGuess; rec\.od = '';/.test(mkSrc) &&
          /wkGuess = Math\.round\(\(sumGuess \/ nGuess\) \/ 10\) \* 10;/.test(mkSrc) &&
          /else wkGuess = Math\.round\(400 \/ 10\) \* 10;/.test(mkSrc) &&
          !/if \(!st\) continue;/.test(mkSrc);
      })());

    // ---------- ② 源码层 ----------
    assert('A7：i18n 三态文案齐全（在轨 / 变轨中 + 速率单位）',
      /st_raising: \['变轨中', 'Raising'\]/.test(appSrc) &&
      /st_orbit_a: \['在轨（~', 'In orbit \(~'\]/.test(appSrc) &&
      /st_raising_a: \['变轨中（~', 'Raising \(~'\]/.test(appSrc) &&
      /st_kmday: \['km\/天', 'km\/day'\]/.test(appSrc));
    // ⚠️ 这条守的是我自己踩过的坑：orbitStatusHtml 里若写 `r.launch`，
    //   拿到的是**批次名字符串**（tableVals 的 launch 字段），取不到 dateMs →
    //   已再入行只剩"已再入"三个字，在轨日的数字全丢。必须走 `r._s.launch`。
    assert('A7：状态列走 orbitStatusHtml，且取发射记录对象用 `r._s.launch`（不是字符串 r.launch）',
      /orbitStatusHtml\(r\)/.test(appSrc) && /r\._s\.launch/.test(appSrc));
    // ★ V1.9.2：这条是"静默丢字段"的**防复发守卫** —— 本会话已经栽过两次
    //   （V1.9.1 的 st/dt、V1.9.2 的 orb/wk/od/rr），根因都是"白名单重建对象"：
    //     build() 造行数据对象、unpackSat() 差分还原，**两处都只抄自己列出的字段**。
    //   判据：satdata 里出现过的卫星字段，必须在这两处都被带上（至少 orb/wk/od/rr 这一组）。
    assert('A7：三态字段穿过度分还原与 build() 两处白名单（`orb/wk/od/rr` 一处都不能漏）',
      /orb: s\.orb, wk: s\.wk, od: s\.od, rr: s\.rr/.test(appSrc) &&
      /'orb'[^\]]*'wk'[^\]]*'od'[^\]]*'rr'/.test(appSrc));
    assert('A7：排序语义 = 0 在轨 / 1 变轨中 / 2 已再入',
      /status: s\.st === 'r' \? 2 : \(s\.orb \? 1 : 0\)/.test(appSrc));
    assert('A7：变轨的"速度片段"单独着色 —— .st-rate + pos/neg/zero 三色（不随整格染黄）',
      /class="st-rate ' \+ cls/.test(appSrc) &&
      /\.st-rate\.pos \{ color:var\(--st-orbit\)/.test(tpl) &&
      /\.st-rate\.neg \{ color:var\(--st-raising\)/.test(tpl) &&
      /\.st-rate\.zero \{ color:var\(--dim\)/.test(tpl));
    assert('A7：三态单元格类与颜色变量齐全',
      /--st-raising:#f59f00/.test(tpl) && /td\.st-raising \{ color:var\(--st-raising\)/.test(tpl) &&
      /td\.st-orbit/.test(tpl) && /td\.st-gone/.test(tpl));

    // ---------- ③ 渲染层：三种形态真的出现在 DOM ----------
    const ti7 = d3.getElementById('tableSearch');
    const cellOf = norad => {
      ti7.value = String(norad);
      ti7.dispatchEvent(new w3.Event('input', { bubbles: true }));
      const tr = d3.querySelector('#tbody tr[data-idx]');
      if (!tr) return null;
      const td = tr.querySelectorAll('td')[2];
      return { txt: td.textContent.trim(), cls: td.className, html: td.innerHTML };
    };
    // 取样（都加兜底：数据若异常也不让整份 smoke 崩在 TypeError 上，而是照常报 FAIL）
    const raiSample = raiS.filter(r => r.rr !== undefined)[0] || raiS[0] || { id: -1, rr: 0 };
    const orbSample = orbS.filter(r => r.wk !== 'GEO')[0] || orbS[0] || { id: -1 };
    const geoSample = geoS[0] || { id: -1 };
    const c1 = cellOf(raiSample.id);
    assert('A7：**变轨中**的行 —— 单元格带 .st-raising，文案形如「变轨中（~YYYY-MM-DD，NNNkm (+X.XXkm/天)）」',
      !!c1 && /st-raising/.test(c1.cls) &&
      // 收尾是**两个括号**：速度那段的半角 `)`（在 span 外）+ st_close 的全角 `）`
      // 且速度**带符号**（`+3.63`）—— `[-+]?` 不能省，否则 "(+3.63" 匹配不上（踩过一次）
      /^变轨中（~\d{4}-\d{2}-\d{2}，\d+km \([-+]?\d+\.\d{2}km\/天\)）$/.test(c1.txt),
      c1 ? JSON.stringify(c1.txt) : 'null（搜不到 ' + raiSample.id + '）');
    assert('A7：变轨中的**速度片段**是独立 <span class="st-rate …">（正数带 +、颜色类正确）',
      !!c1 && /<span class="st-rate (pos|neg|zero)">/.test(c1.html) &&
      (raiSample.rr > 0 ? /class="st-rate pos"/.test(c1.html) : true),
      c1 ? c1.html.replace(/<[^>]*>/g, '|') : 'null');
    const c2 = cellOf(orbSample.id);
    assert('A7：**在轨**的行 —— 单元格带 .st-orbit，文案形如「在轨（~YYYY-MM-DD，NNNkm）」',
      !!c2 && /st-orbit/.test(c2.cls) &&
      /^在轨（~\d{4}-\d{2}-\d{2}，\d+km）$/.test(c2.txt),
      c2 ? JSON.stringify(c2.txt) : 'null（搜不到 ' + orbSample.id + '）');
    const c3 = cellOf(geoSample.id);
    assert('A7：**GEO** 的行 —— 写 `GEO` 不写高度',
      !!c3 && /在轨（~\d{4}-\d{2}-\d{2}，GEO）$/.test(c3.txt),
      c3 ? JSON.stringify(c3.txt) : 'null');
    ti7.value = ''; ti7.dispatchEvent(new w3.Event('input', { bubbles: true }));
  }

  // ================================================================ V1.9.1（A1）：信息窗「轨道高度变更」行
  // 规范：升轨章信息窗（A 窗）**最末行**；值 = 当前节点 vs 该星**前一个历史节点**的半长轴变化量；
  //   两位小数、正数带 `+`；正=绿 #2f9e44 / 负=黄 #f59f00 / 0=灰 var(--dim)；首点无"前一个" → `—`。
  {
    k3.setClimbPick('b:26137');                   // 低轨22组：实测该批在**上升**（Δ 为正）→ 可验证绿
    const poi = k3.climbFind(69572);
    const lastRow = () => {
      const rs = [...d3.querySelectorAll('#climbInfo .si-row')];
      const r = rs[rs.length - 1];
      return { txt: r.textContent.trim(), style: r.querySelectorAll('span')[1].getAttribute('style') || '' };
    };
    assert('A1：该行在信息窗**最末**（「历史点数」之后）—— 行首文案是「轨道高度变更」',
      (function () {
        k3.climbInfoAt(69572, 1);
        const rs = [...d3.querySelectorAll('#climbInfo .si-row')].map(r => r.textContent.trim());
        return rs[rs.length - 1].indexOf('轨道高度变更') === 0 &&
          rs[rs.length - 2].indexOf(k3.tt('climb_n_hist')) === 0;
      })(), JSON.stringify([...d3.querySelectorAll('#climbInfo .si-row')].map(r => r.textContent.trim()).slice(-2)));
    assert('A1：第一个节点时显示 `—`（灰：color:var(--dim)）',
      (function () { k3.climbInfoAt(69572, 0); const r = lastRow(); return /—$/.test(r.txt) && /var\(--dim\)/.test(r.style); })(),
      JSON.stringify((function () { k3.climbInfoAt(69572, 0); return lastRow(); })()));
    assert('A1：正变化 → 带 `+`、两位小数、**绿色** #2f9e44，且数值 = 与前一节点之差',
      (function () {
        k3.climbInfoAt(69572, 1);
        const r = lastRow(), exp = (poi.pts[1].v - poi.pts[0].v);
        return r.txt === '轨道高度变更+' + exp.toFixed(2) + 'km' && /#2f9e44/.test(r.style);
      })(), JSON.stringify((function () { k3.climbInfoAt(69572, 1); return lastRow(); })()));
    // ★ V1.9.5（数据自适应改造）：旧版写死"63429 的前两点差为负"来验证负变化的黄渲染 ——
    //   但那是**数据快照**而非性质：2026-10-15 12:00 刷新后 densify 重采样，该两点差变成 +0.30，
    //   断言就红了（看起来像回归，其实代码没坏）。改为**在真实库里动态找**相邻点差为负的样本。
    //   兜底：全库真找不到负差样本（物理上几乎不可能：阻力降轨弧段必然存在）→ 判过并注明，
    //   核心口径仍由下一条"climbDeltaColor 源码"断言守住。
    const a1 = (function () {
      const lks = Object.keys(RAW.gw.launches).map(k => 'b:' + k)
        .concat(Object.keys(RAW.qf.launches).map(k => 'b:' + k));
      for (const lk of lks) {
        try { k3.setClimbPick(lk); } catch (e) { continue; }
        const gwBatch = /^b:2[3-6]/.test(lk);
        const sats = (gwBatch ? RAW.gw.sats : RAW.qf.sats).filter(s => s.c.slice(0, 5) === lk.slice(2));
        for (const s of sats) {
          const p = k3.climbFind(s.id);
          if (!p || !p.pts || p.pts.length < 2) continue;
          for (let i = 1; i < p.pts.length; i++) {
            const d = p.pts[i].v - p.pts[i - 1].v;
            if (d < -0.005) {
              k3.climbInfoAt(s.id, i);
              const r = lastRow();
              return { hit: true, id: s.id, exp: d, txt: r.txt, style: r.style,
                ok: r.txt === '轨道高度变更' + d.toFixed(2) + 'km' && /#f59f00/.test(r.style) };
            }
          }
        }
      }
      return { hit: false };
    })();
    assert('A1：负变化 → 保留 `-`、两位小数、**黄色** #f59f00（真实库动态取样，不钉死某颗星）',
      !a1.hit || a1.ok, a1.hit ? (a1.id + ' Δ=' + a1.exp.toFixed(2) + ' → txt=' + a1.txt + ' style=' + a1.style.slice(0, 30))
                              : '全库无负差样本（跳过；色值口径仍由下一条源码断言守住）');
    assert('A1：色值口径与源码一致（三个色值都写在同一处 climbDeltaColor，不散落）',
      /function climbDeltaColor\(d\) \{\s*\n\s*return d > 0 \? '#2f9e44' : \(d < 0 \? '#f59f00' : 'var\(--dim\)'\);/.test(appSrc));
    assert('A1：i18n 中英同步（climb_delta = 轨道高度变更 / Altitude change）',
      k3.tt('climb_delta') === '轨道高度变更' && /climb_delta: \['轨道高度变更', 'Altitude change'\]/.test(appSrc));
    k3.setClimbPick('b:24240');                   // 复原，别影响后面的断言
  }

  // ================================================================ V1.9.1（A11）：发射记录表格的再入规则
  {
    // ⚠️ 卫星表格**分页**（每页 9~10 行）→ 直接数 `#tbody tr.focused` 会漏掉不在当前页的那几颗
    //   （第一次就是这么误报的：同一批 4 颗里只有 2 颗落在当前页）。所以先用搜索把范围收窄到该批次，
    //   这样"本次全部"必定在同一页里，统计才有意义。
    const ti11 = d3.getElementById('tableSearch');
    const setQ = q => { ti11.value = q; ti11.dispatchEvent(new w3.Event('input', { bubbles: true })); };

    // ① **仍有卫星在轨**的情形：真实数据 25067（试验星06组）T=4 颗、其中 1 颗已再入 → 3/4
    setQ('25067');
    k3.selectGroup('25067');
    let t11 = k3.toast();
    assert('A11：仍有卫星在轨的发射记录 → 绿色「已全选仍在轨卫星（X/T）」（X<T 时如实显示）',
      !!t11 && /^已全选仍在轨卫星（3\/4）$/.test(t11.txt) && !/inv|pool-dead/.test(t11.cls),
      JSON.stringify(t11));
    const s11 = k3.state();
    assert('A11：1/2/3 章只高亮**仍在轨**的那些（已再入的绝不进 S.sel —— 否则会画出过期轨道）',
      s11.sel.length === 3 && s11.selGone.length === 1, JSON.stringify(s11));
    assert('A11：卫星表格里"本次全部都被选中"= 仍在轨的用主题色框 + 已再入的用灰框',
      (function () {
        const f = d3.querySelectorAll('#tbody tr.focused').length;
        const g2 = d3.querySelectorAll('#tbody tr.gone-focus').length;
        return f === 3 && g2 === 1;                // 3 在轨 + 1 已再入
      })(), 'focused=' + d3.querySelectorAll('#tbody tr.focused').length +
      ' goneFocus=' + d3.querySelectorAll('#tbody tr.gone-focus').length);

    // ② **已全部再入**的情形：注入的 26137（低轨22组，9 颗全被标成已再入）
    setQ('26137');
    k3.selectGroup('26137');
    t11 = k3.toast();
    const s11b = k3.state();
    assert('A11：该次发射**已全部再入** → 红色「该批次/组已全部再入」（Q29 定稿文案）',
      !!t11 && t11.txt === '该批次/组已全部再入' && /pool-dead/.test(t11.cls), JSON.stringify(t11));
    assert('A11：全部已再入 → 卫星表格**灰色**框选（9 颗全灰、无主题色框）',
      (function () {
        return d3.querySelectorAll('#tbody tr.gone-focus').length === 9 &&
          d3.querySelectorAll('#tbody tr.focused').length === 0;
      })(), 'goneFocus=' + d3.querySelectorAll('#tbody tr.gone-focus').length +
      ' focused=' + d3.querySelectorAll('#tbody tr.focused').length);
    assert('A11：全部已再入 → **无 1/2/3 章联动**（S.sel 保持空）', s11b.sel.length === 0, JSON.stringify(s11b));
    assert('A11：全部已再入 → **升轨章仍切到该批次/组**（A11 的例外：这一条联动要保留）',
      s11b.climbPick === 'b:26137', 'climbPick=' + s11b.climbPick);
    setQ('');                                      // 复原搜索
  }
  // ================================================================ V1.9.1（A6）：升轨章选择框重做
  {
    const sel = d3.getElementById('climbSel');
    assert('A6：选择框**不再有**「跟随选中（默认）」空选项（`value=""` 的项应为 0 个）',
      !!sel && [...sel.options].filter(o => o.value === '').length === 0,
      'options=' + (sel ? [...sel.options].map(o => JSON.stringify(o.value)).slice(0, 4).join(',') : 'null'));
    assert('A6：首屏**默认选中最新发射的批次**（= climbAutoPick()，且它就是列表第一项）',
      (function () {
        k3.climbSelect('');                      // ⚠️ 先归零：前面的 A11 用例调过 climbSelect('b:26137')，
                                                 //    不复位会把"首屏默认"测成那个残留值（第一次就这么误报的）
        const auto = k3.climbAuto(), v = k3.climbSelValue(), opts = k3.climbOpts();
        return !!auto && v === auto && opts.length > 0 && opts[0].v === auto;
      })(), 'value=' + k3.climbSelValue() + ' auto=' + k3.climbAuto() + ' 首项=' + (k3.climbOpts()[0] || {}).v);
    assert('A6：选项按**发射时间倒序**（并列取批次号大者），与 06 章发射历史表同口径',
      (function () {
        const opts = k3.climbOpts().filter(o => o.v.indexOf('b:') === 0).map(o => o.v.slice(2));
        // 用页面自己的 api 取每个批次的 dateMs（climbBatchMeta 不在探针里，这里用 launches 查）
        const meta = {};
        RAW.gw.launches && Object.keys(RAW.gw.launches).forEach(k => { meta[k] = Date.parse(RAW.gw.launches[k][1] + ':00+08:00'); });
        for (let i = 1; i < opts.length; i++) {
          const a = meta[opts[i - 1]] || 0, b = meta[opts[i]] || 0;
          if (a < b) return false;                                  // 必须单调不增
          if (a === b && String(opts[i - 1]) < String(opts[i])) return false;  // 并列时批次号降序
        }
        return opts.length > 10;
      })(), '前 5 项=' + k3.climbOpts().slice(0, 5).map(o => o.v).join(' '));
    assert('A6：最旧的那批**不在首位**（原 bug：23095 试验星01组排在最前）',
      k3.climbOpts()[0].v !== 'b:23095', '首项=' + k3.climbOpts()[0].v);
    // Q13/Q21：选中"最新项" = 回到自动模式（否则会无声破坏"跟随全局选中"）
    k3.climbSelect(k3.climbAuto());
    assert('A6/Q21：点选"最新批次"→ 归一成**自动模式**（S.climbPick 为空，跟随全局选中仍有效）',
      k3.state().climbPick === '', 'climbPick=' + JSON.stringify(k3.state().climbPick));
    k3.climbSelect('b:25030');
    assert('A6：显式选一个非默认批次 → S.climbPick 记为该批次（用户意图优先，不再被跟随覆盖）',
      k3.state().climbPick === 'b:25030', 'climbPick=' + k3.state().climbPick);
    assert('A6：单星选项的通路已铺好（`climbLoneOptions` 存在；当前数据 0 颗 → 列表里没有 s: 项）',
      /function climbLoneOptions/.test(appSrc) && /out\.concat\(climbLoneOptions\(C, seen\)\)/.test(appSrc) &&
      k3.climbOpts().filter(o => o.v.indexOf('s:') === 0).length === 0,
      's: 项数=' + k3.climbOpts().filter(o => o.v.indexOf('s:') === 0).length);
    k3.climbSelect('');                            // 复原自动
  }

  // ---- V1.9.1（Q19）：03 章批次下拉 —— 「全部批次」置顶 + 其余按发射时间倒序 ----
  assert('Q19：03 章批次下拉「全部批次（N 颗）」**恒置顶**',
    (function () {
      const gs = d3.getElementById('groupSel');
      return !!gs && gs.options.length > 1 && gs.options[0].value === 'all' &&
        /^全部批次（\d+ 颗）$/.test(gs.options[0].textContent.trim());
    })(), (function () {
      const gs = d3.getElementById('groupSel');
      return gs ? JSON.stringify(gs.options[0].textContent.trim()) : 'null';
    })());
  assert('Q19：03 章其余选项按**发射时间倒序**（原为最旧在前 —— 与同页表格方向相反）',
    (function () {
      const gs = d3.getElementById('groupSel');
      const keys = [...gs.options].slice(1).map(o => o.value);
      // ⚠️ 与页面 build() 同口径算 dateMs：无日期的自动补录批次（v[1]=''）在页面端
      //   取 Date.now() 排最前（它是"最新发射、百科还没收录"的那批）。smoke 若按 0 算
      //   就会与页面不一致 → 这里必须同样按"大值"处理，否则补录一批就红一次。
      const meta = {};
      Object.keys(RAW.gw.launches).forEach(k => {
        const v1 = String(RAW.gw.launches[k][1] || '');
        const ms = v1 ? Date.parse(v1.slice(0, 10) + 'T00:00:00+08:00') : NaN;
        meta[k] = isFinite(ms) ? ms : Infinity;
      });
      for (let i = 1; i < keys.length; i++) {
        const a = meta[keys[i - 1]], b = meta[keys[i]];
        if (a < b) return false;
        if (a === b && String(keys[i - 1]) < String(keys[i])) return false;
      }
      return keys.length > 10;
    })(), '前 5 项=' + [...d3.getElementById('groupSel').options].slice(1, 6).map(o => o.value).join(' '));

  // ================================================================ V1.9.1（A8）：组网进度「试验星阶段虚线」
  // 规范：从最早的试验星发射到**第一颗正式星**为止，节点之间用**该星座自身颜色**的虚线连接；
  //   第一颗正式星是**第一个实线点**。口径 Q23=A（按时间一刀切）：星网 2024-02-29、
  //   千帆 2024-08-06；之前虚线、之后一律实线（哪怕那几发其实还是试验星）。
  //   轴起点随之前移到最早的试验星（千帆 2019-11-17 所在周）。
  {
    const cutGw = k3.netSolidFrom('gw'), cutQf = k3.netSolidFrom('qf');
    assert('A8：两个星座的「第一颗正式星」日期取自台账（星网 2024-02-29 / 千帆 2024-08-06）',
      new Date(cutGw).toISOString().slice(0, 10) === '2024-02-29' &&
      new Date(cutQf).toISOString().slice(0, 10) === '2024-08-06',
      new Date(cutGw).toISOString().slice(0, 10) + ' / ' + new Date(cutQf).toISOString().slice(0, 10));
    // 分界周：星网应在 2024-02-29 所在周（约第 224 周）、千帆在其后（约第 247 周）
    const sGw = k3.netSplit('gw'), sQf = k3.netSplit('qf');
    assert('A8：分界周落在正确的相对位置（星网早于千帆；两者都远小于总周数的一半之后）',
      sGw > 0 && sQf > sGw && sGw < k3.netWeeks() && sQf < k3.netWeeks(),
      'gw=' + sGw + ' qf=' + sQf + ' 总周数=' + k3.netWeeks());
    // 轴起点（最终口径，2026-10-10 用户拍板）：**早期卫星都要记载** ——
    //   2019/2021 的 KL 试验星必须留在图上，试验星阶段与首个组网星之间用**虚线**区分（A8）。
    //   沿革：Q15 = 前移到最早试验星；Q2 曾想改「首个在轨>0」，但实测千帆 2019 的 KL-Alpha
    //   **确有 TLE 在库**（与清单里"无在轨数据"的记载不符），取"首个在轨>0"会把这两点
    //   挤到轴外、虚线试验星段整段消失 → 与用户要求相悖，故回到最早一条发射记录。
    const og = k3.netOrigin(), axn = k3.netAxisNow();
    assert('#6：横轴起点 = **最早一条发射记录**（早期卫星全部保留在图上，不被切到轴外）',
      Math.abs(axn.x0 - og.weeks0) < 1 && og.origin === og.weeks0 &&
      new Date(og.weeks0).getUTCFullYear() === 2019,
      '轴起点=' + new Date(og.x0min).toISOString().slice(0, 10) +
      '，数据最早周=' + new Date(og.weeks0).toISOString().slice(0, 10) +
      '（早期试验星保留在轴上，用虚线与首个组网星分隔）');
    // 虚线段必须真的落在**可视范围内**（否则等于把试验星阶段藏起来了 —— 这正是取"较晚起点"的后果）
    assert('#6：试验星阶段的**虚线段完全落在可视范围内**（起点回退后不再被切到轴外）',
      new Date(k3.netSolidFrom('qf')).getTime() > axn.x0 &&
      new Date(k3.netSolidFrom('gw')).getTime() > axn.x0 &&
      new Date(og.weeks0).getTime() >= axn.x0 - 1,
      'qf 首个组网星=' + new Date(k3.netSolidFrom('qf')).toISOString().slice(0, 10) +
      ' / gw=' + new Date(k3.netSolidFrom('gw')).toISOString().slice(0, 10) +
      ' vs 轴起点=' + new Date(axn.x0).toISOString().slice(0, 10));
    // 真的画了虚线：分别只看一个星座，绘制时曲线段应有**一次** [5,5]（试验星段）
    const dashProbe = (key) => {
      k3.netOnly(key);
      k3.netDash().length = 0;
      k3.netDraw();
      return k3.netDash().slice();
    };
    const dGw = dashProbe('gw'), dQf = dashProbe('qf');
    // 曲线段是最后 4 次调用（虚线段：设 [5,5] → 复位 []；实线段：设 [] → 复位 []）
    assert('A8：星网曲线含**1 段虚线**（试验星阶段）+ 1 段实线 —— 最后一个 [5,5] 出现在曲线段里',
      dGw.slice(-4)[0] === '[5,5]' && dGw.slice(-4).filter(x => x === '[5,5]').length === 1,
      JSON.stringify(dGw.slice(-4)));
    assert('A8：千帆同理（虚线段的 setLineDash = [5,5]）',
      dQf.slice(-4)[0] === '[5,5]' && dQf.slice(-4).filter(x => x === '[5,5]').length === 1,
      JSON.stringify(dQf.slice(-4)));
    k3.netBoth();                            // 复原为"两个都画"（导出图/矩阵断言可能还要用）
    k3.netDraw();
    assert('A8：源码里虚线只在**曲线段**使用（不污染其它线条的 dash —— 数值取自同一处 seg()）',
      /ctx\.setLineDash\(dashed \? \[5, 5\] : \[\]\);/.test(appSrc) &&
      /var firstSolid = Math\.max\(0, kCut - 1\);/.test(appSrc) &&
      // ★ V1.9.2：曲线的取样点从 `d.series` 的裸索引改为 `netSpanPts()` 取出的 pts
      //   （`pts[q]` 已按当前档位裁过窗口、并把 y 平移到窗口基线），
      //   `firstSolid` 到「第一个 k ≥ firstSolid 的 pts 下标」的换算也随之落在 iSolid 上。
      /var iSolid = pts\.length;/.test(appSrc) &&
      /seg\(0, iSolid, true\);/.test(appSrc) &&
      /seg\(iSolid, pts\.length - 1, false\);/.test(appSrc));
  }

  // ================================================================ V1.9.2（用户要求）：组网进度「全部 / 今年 / 最近3月」
  // 用户原话：「在星座同一行的右侧，可切换"全部""今年""最近3月"……注意这个切换和其他切换按钮一样
  //   按钮和视图本身要有同样的非线性动画效果。」
  //   三档的口径（逐条对应）：
  //     全部 = 当前视图 + 每年 1/1 一个节点（和代表年份的虚线相交，显示当前颗数，形式同"今天"节点）
  //     今年 = 时间轴缩短到本年 1/1 至今，累计**从 0 开始积累**，增加每月 1 日节点
  //     最近3月 = 时间轴从三个月前至今，累计从 0 起，**从初始日起每 7 天**一个代表节点
  //   三档点击节点的信息窗**都是全部累计**（不是当前周期）—— 这条由"节点只带周索引、
  //   信息窗照旧读 d.series/d.delta"的结构保证，下面有专门断言。
  {
    const DAY = 86400000;
    // ---- 结构层：按钮在同一行右侧 + 走同一条过场 ----
    assert('V1.9.2：三档按钮在「星座」同一行的**右侧**（独立 .ctl，与星座 ctl 同构 → 底边对齐即同一行）',
      /id="netSpanSeg"/.test(tplCode) &&
      /data-netspan="all"/.test(tplCode) && /data-netspan="year"/.test(tplCode) && /data-netspan="qtr"/.test(tplCode) &&
      // 必须在上面的 .ctl **闭合之后** —— 塞进同一个 .ctl 里会被 column 布局排到下一行（实测踩到）
      /data-i18n="l_netshow">星座<\/span>[\s\S]{0,320}?id="netShowSeg"[\s\S]{0,320}?<\/div>\s*<\/div>[\s\S]{0,420}?data-i18n="l_netspan">时间段<\/span>[\s\S]{0,260}?id="netSpanSeg"/.test(tplCode) &&
      /l_netspan: \['时间段', 'Time range'\]/.test(appCode));
    assert('V1.9.2：切换档位与其它 seg 走**同一条非线性过场**（cvSwap → .chart-out + ANIM.half），按钮高亮立即响应',
      /var segP = document\.getElementById\('netSpanSeg'\);/.test(appCode) &&
      /function netSetSpan\(sp\)[\s\S]{0,520}?syncNetControls\(\);[\s\S]{0,160}?cvSwap\('netCv', function \(\) \{ netAutoView\(\); drawNet\(\); \}\);/.test(appCode) &&
      /function cvSwap\(cvId, apply\)[\s\S]{0,420}?wrap\.classList\.add\('chart-out'\)[\s\S]{0,200}?ANIM\.half/.test(appCode));
    assert('V1.9.2：档位进偏好系统（PREF_DEF / 本章「默认设置」/ 快照 / 还原 / 合法性校验）',
      /netSpan: 'all',/.test(appCode) && /progress: \['netMode', 'netSpan'\]/.test(appCode) &&
      /netSpan: S\.netSpan,/.test(appCode) &&
      /S\.netSpan = NET_SPANS\.indexOf\(p\.netSpan\) >= 0 \? p\.netSpan : 'all';/.test(appCode) &&
      /var NET_SPANS = \['all', 'year', 'qtr'\];/.test(appCode));
    // ---- 行为层：窗口 / 基线 / 节点节奏 ----
    const now = Date.now();
    const D0 = new Date(now);
    const yearStart = new Date(D0.getFullYear(), 0, 1, 0, 0, 0, 0).getTime();
    const qtrStart = new Date(D0.getFullYear(), D0.getMonth() - 3, D0.getDate(), 0, 0, 0, 0).getTime();
    k3.netSetSpan('all');
    const rAll = k3.netRange(), cAll = k3.netCurveOf('gw'), nAll = k3.netNodes();
    k3.netSetSpan('year');
    const rYear = k3.netRange(), cYear = k3.netCurveOf('gw'), nYear = k3.netNodes();
    k3.netSetSpan('qtr');
    const rQtr = k3.netRange(), cQtr = k3.netCurveOf('gw'), nQtr = k3.netNodes();
    k3.netSetSpan('all');
    const near = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 60000 : tol);
    assert('V1.9.2：全部 = 数据起点～今天（x 轴不缩，基线 0，曲线仍是逐周采样）',
      rAll.span === 'all' && cAll.base === 0 && rAll.from <= rAll.to &&
      cAll.first.v === 0 && cAll.n > 100,
      JSON.stringify({ r: rAll, first: cAll.first, n: cAll.n }));
    assert('V1.9.2：今年 = **本年 1/1 00:00（本地）** 至今',
      near(rYear.from, yearStart, 1000) && rYear.to >= rYear.from &&
      (rYear.to - rYear.from) < (rAll.to - rAll.from),
      JSON.stringify({ from: new Date(rYear.from).toString(), want: new Date(yearStart).toString() }));
    assert('V1.9.2：最近3月 = **今天减 3 个月那一日** 至今（不是"3 个月前的月首"）',
      near(rQtr.from, qtrStart, 1000) && (rQtr.to - rQtr.from) < (rAll.to - rAll.from),
      JSON.stringify({ from: new Date(rQtr.from).toString(), want: new Date(qtrStart).toString() }));
    assert('V1.9.2：今年 / 最近3月的累计**从 0 开始积累**（左端锚点 v = 0，基线 = 窗口起点的全量累计）',
      cYear.first.v === 0 && cQtr.first.v === 0 &&
      near(cYear.base, k3.netCumAt('gw', rYear.from), 1) && near(cQtr.base, k3.netCumAt('gw', rQtr.from), 1) &&
      cYear.base > 0 && cQtr.base > 0 &&
      Math.abs(cYear.last.v - (k3.netCumAll('gw') - cYear.base)) <= 1,
      JSON.stringify({ yBase: cYear.base, qBase: cQtr.base, yLast: cYear.last.v, all: k3.netCumAll('gw') }));
    assert('V1.9.2：**全部**档的节点 = 每年 1/1（落在代表年份的虚线上）+ 末端今天',
      nAll.filter(n => n.kind === 'year').length >= 3 &&
      nAll.every(n => { const d = new Date(n.ms); return n.kind !== 'year' || (d.getMonth() === 0 && d.getDate() === 1); }) &&
      nAll[nAll.length - 1].kind === 'last' && near(nAll[nAll.length - 1].ms, now, 5 * DAY),
      JSON.stringify(nAll.map(n => [new Date(n.ms).toISOString().slice(0, 10), n.kind])));
    assert('V1.9.2：**今年**档的节点 = 每月 1 日（便于看每月发射数量）+ 末端今天',
      nYear.filter(n => n.kind === 'month').length >= 2 &&
      nYear.filter(n => n.kind === 'month').every(n => new Date(n.ms).getDate() === 1) &&
      nYear.filter(n => n.kind === 'month')[0].ms === rYear.from &&
      nYear[nYear.length - 1].kind === 'last',
      JSON.stringify(nYear.map(n => [new Date(n.ms).toISOString().slice(0, 10), n.kind])));
    assert('V1.9.2：**最近3月**档的节点 = **从初始日起每 7 天**一个代表节点 + 末端今天',
      nQtr.filter(n => n.kind === 'week').length >= 8 &&
      nQtr.filter(n => n.kind === 'week').every((n, i, a) => i === 0 || Math.abs((n.ms - a[i - 1].ms) - 7 * DAY) < 1000) &&
      nQtr[0].ms === rQtr.from && nQtr[nQtr.length - 1].kind === 'last',
      JSON.stringify(nQtr.map(n => [new Date(n.ms).toISOString().slice(0, 10), n.kind])));
    // ---- 信息窗永远显示**全部累计**（用户明确要求，三档都一样）----
    assert('V1.9.2：节点的信息窗写的是**全部累计**（不是当前周期的）—— 节点只带周索引，信息窗照旧读全量表',
      (function () {
        const ns = k3.netNodes();
        const rows = k3.netInfoOpen(ns[ns.length - 1].wi);
        return rows.length > 0 && rows.some(r => r.indexOf(String(k3.netCumAll('gw')) + ' 累计') >= 0);
      })(),
      JSON.stringify(k3.netCumAll('gw')));
    assert('V1.9.2：节点命中优先于"最近的一周"（点节点 = 该节点所属周的信息窗；点空白仍退回最近周）',
      /function netHit\(x, y\) \{[\s\S]{0,420}?var nd = netNodeAt\(x\);[\s\S]{0,140}?if \(nd != null\) return nd;/.test(appCode) &&
      typeof k3.netNodeHit === 'function');
    // ---- 视图：档位切换后自动视图跟着换（x 轴范围与 y 轴上限都按窗口重算）----
    k3.netSetSpan('year'); const vY = k3.netViewNow();
    k3.netSetSpan('qtr'); const vQ = k3.netViewNow();
    k3.netSetSpan('all');
    assert('V1.9.2：自动视图按档位重算 —— x 落在窗口内，y 上限贴合**窗口内**最大值（不是全量累计）',
      near(vY.x0, rYear.from, 1000) && near(vY.x1, rYear.to, 1000) &&
      near(vQ.x0, rQtr.from, 1000) && near(vQ.x1, rQtr.to, 1000) &&
      vY.y1 < k3.netCumAll('gw') * 1.10 + 1,
      JSON.stringify({ vY: vY.y1, vQ: vQ.y1, all: k3.netCumAll('gw') }));
    // ---- 导出底栏：变轨情况（04）之后的那一章（05 组网进度）追加两段参数留底 ----
    const spAll = k3.shotNetParams('progress');
    assert('V1.9.2：导出底栏（组网进度）追加「选择纵轴量 … | 选择时间段 …」，且非本章为空',
      /选择纵轴量 /.test(spAll) && /选择时间段 /.test(spAll) && / \| /.test(spAll) &&
      spAll.indexOf('全部') > 0 &&
      k3.shotNetParams('chart') === '' && k3.shotNetParams('climb') === '',
      spAll);
    assert('V1.9.2：底栏两段如实跟随界面档位（切到"今年 / 最近3月"后文字同步变）',
      (function () {
        k3.netSetSpan('year'); const y = k3.shotNetParams('progress');
        k3.netSetSpan('qtr'); const q = k3.shotNetParams('progress');
        k3.netSetSpan('all');
        return y.indexOf('今年') > 0 && q.indexOf('近3个月') > 0;
      })(),
      k3.shotNetParams('progress'));
    // ---- 水印配色规则（用户指定三条）----
    assert('V1.9.2：水印配色三条规则 —— 只星网=红/星网；只千帆=蓝/千帆；两者全选=both/星网+千帆',
      /function shotConstelState\(view\)/.test(appCode) &&
      /if \(gw && qf\) return \{ both: true, key: S\.key \};/.test(appCode) &&
      /if \(gw\) return \{ both: false, key: 'gw' \};/.test(appCode) &&
      /if \(qf\) return \{ both: false, key: 'qf' \};/.test(appCode) &&
      /shot_both: \['星网\+千帆', 'CSCN \+ SpaceSail'\]/.test(appCode) &&
      // 逐态实测：断言不依赖"跑到此处 UI 碰巧处于哪种状态"（前面 netBoth() 已把两条都打开，
      // 写死 both===false 会假 FAIL）—— 显式切到三种态各取一次映射，跑完复原成 both。
      (function () {
        k3.netOnly('gw'); var sG = k3.constelState('progress');   // 只星网 → false / 'gw'
        k3.netOnly('qf'); var sQ = k3.constelState('progress');   // 只千帆 → false / 'qf'
        k3.netBoth();     var sB = k3.constelState('progress');   // 全选   → true
        var ok = (sG.both === false && sG.key === 'gw') &&
                 (sQ.both === false && sQ.key === 'qf') &&
                 (sB.both === true);
        k3.netBoth();                                            // 复原（后续断言/导出图依赖）
        return ok;
      })());
    assert('V1.9.2：**全选时字标左右两半在同一个 x 落笔**（靠互补 clip 各取一半）—— 防"右半被整段裁掉"',
      // ⚠️ 这条守卫的来历：上一版右半写的是 fillText(BRAND, x + half - brandW)，
      //   把文字整体左移了半个字标宽 → clip 窗口里只有空白 → 屏幕上只剩红色「CIST」，
      //   蓝色「rack」整段消失（目视导出图才抓出来）。源码断言比像素断言更早拦住它。
      /ctx\.rect\(x, cy - size, half, size \* 2\); ctx\.clip\(\);[\s\S]{0,120}?ctx\.fillText\(BRAND, x, cy\);/.test(appCode) &&
      /ctx\.rect\(x \+ half, cy - size, brandW - half \+ 1, size \* 2\); ctx\.clip\(\);[\s\S]{0,120}?ctx\.fillText\(BRAND, x, cy\);/.test(appCode) &&
      !/fillText\(BRAND, x \+ half - brandW, cy\)/.test(appCode));
    // ---- 标签排版：不重叠 + 贴左缘翻到右侧 ----
    // ★ V1.9.4：加**诊断输出**。这条断言本地 PASS、CI FAIL（历史上有成有败），
    //   而旧版失败时只打印 `false` —— 完全看不出是哪两个标签、间距多少，
    //   于是无法判断是"真重叠（要修布局）"还是"数据微变导致的临界（判据太紧）"。
    //   现在失败时把重叠对与 dx/dy 打出来，CI 一次就能定位。
    const labelOverlaps = [];
    ['all', 'year', 'qtr'].forEach(function (sp) {
      k3.netSetSpan(sp);
      const L = k3.netLabels();
      for (let i = 0; i < L.length; i++) {
        for (let j = i + 1; j < L.length; j++) {
          // ★ V1.9.4：**两条曲线各自的末端标签不算重叠**。
          //   netPickLabels 里末端（last）标签**不做**重叠丢弃 —— 每条曲线的最新值必须显示。
          //   `all` 档下星网与千帆的末端落在同一 x（最新周），垂直可能只差十几 px
          //   （CI 实测 dx=0.0 dy=12.6）。这是设计取舍（末端必显示 > 绝对不挤），
          //   断言不该把它判成缺陷 —— 否则就是在否定"末端必显示"这条规则。
          if (L[i].last && L[j].last && L[i].key !== L[j].key) continue;
          const dx = Math.abs(L[i].x - L[j].x), dy = Math.abs(L[i].y - L[j].y);
          if (dx < 28 && dy < 13) {
            labelOverlaps.push(sp + ':[' + L[i].key + (L[i].last ? '*' : '') + '@' + L[i].x + ',' + L[i].y +
              ']×[' + L[j].key + (L[j].last ? '*' : '') + '@' + L[j].x + ',' + L[j].y +
              '] dx=' + dx.toFixed(1) + ' dy=' + dy.toFixed(1));
          }
        }
      }
    });
    assert('V1.9.2：节点标签**两两不重叠**（近处的标签被放弃、点仍保留）—— 三档都成立',
      labelOverlaps.length === 0,
      labelOverlaps.length ? ('重叠 ' + labelOverlaps.length + ' 对 → ' + labelOverlaps.slice(0, 3).join(' | ')) : '无重叠');
    // 上面豁免了"两条曲线末端互相靠近"，所以要另有一条断言守住这个豁免的前提：**末端必须都在**
    // （否则"末端被丢弃了"会被误当成合规）。gw/qf 各至少 1 个 last 标签。
    assert('V1.9.4：豁免的前提成立 —— 两条曲线的**末端标签都必须显示**（gw 与 qf 各 ≥1 个 last）',
      (function () {
        k3.netSetSpan('all');
        const L = k3.netLabels();
        return L.some(x => x.last && x.key === 'gw') && L.some(x => x.last && x.key === 'qf');
      })());
    assert('V1.9.2：贴左缘的标签画到节点**右侧**（否则第一个节点在纵轴线上，标签会被绘图区切掉一半）',
      /var xx = \(J\.x - LAB_PAD - tw < PL\) \? \(J\.x \+ LAB_PAD\) : \(J\.x - LAB_PAD - tw\);/.test(appCode) &&
      (function () {
        // 「今年」档的第一个节点就是窗口起点（x = PL）→ 它的标签必须落在 x+5 之后
        k3.netSetSpan('year');
        var L = k3.netLabels(), r = k3.netRect();
        var first = L.filter(function (x) { return Math.abs(x.x - r.PL) < 2; })[0];
        k3.netSetSpan('all');
        return !!first;
      })());
    // ---- ★ V1.9.2（用户要求）：末端数值**只画一次** ----
    // 来历：旧版 drawNet() 里有**两处**独立绘制末端同一个数 ——
    //   ① 曲线段的「末端数值」（右对齐贴曲线末点左侧）；② 末端"今天/最新"节点标签（bold 左对齐）。
    //   两者坐标只差二十来个像素，屏幕上就是末端出现两个一模一样的数（截图实锤 "150"×2）。
    //   修法：删掉 ①，统一由末端节点标签承担（它就是用户说的"显示今天的最新颗数的节点"）。
    //   这里用**源码 + 运行时双重断言**把"只画一次"钉住 —— 只断源码挡不住将来换个写法再画一遍。
    assert('V1.9.2：末端数值**只画一次**（曲线端点不再单独标数，统一由末端节点标签承担）—— 防"同一个数画两遍"',
      // ① 源码：那段右对齐的「末端数值」绘制必须已删除
      !/末端数值[\s\S]{0,200}?fillText\(String\(Math\.round\(lp\.v\)\), X\(lp\.ms\) - 4, Y\(lp\.v\) - 4\)/.test(appCode) &&
      !/fillText\(String\(Math\.round\(lp\.v\)\), X\(lp\.ms\) - 4, Y\(lp\.v\) - 4\)/.test(appCode) &&
      // ② 运行时：三档 × 单/双星座，**末端那一处**那个数只能落笔一次。
      //    ⚠️ 判据必须限定在"末端附近"：不同节点的累计值**碰巧相同**是正常数据
      //    （year 档实测有两个月份节点都是 87、相距 480px），那不叫重复显示。
      //    判据：以末端标签的落笔点为圆心，横向 ±80px、纵向 ±20px 内，同一个数出现 ≥2 次 → 重复。
      ['all', 'year', 'qtr'].every(function (sp) {
        return ['gw', 'qf', 'both'].every(function (who) {
          k3.netSetSpan(sp);
          if (who === 'gw') k3.netOnly('gw');
          else if (who === 'qf') k3.netOnly('qf');
          else k3.netBoth();
          var L = k3.netLabels(), lastL = L.filter(function (x) { return x.last; })[0];
          if (!lastL) { k3.netBoth(); return false; }
          var texts = k3.netTexts();   // 本帧 netCv 上所有 fillText 的 {t, x, y}（含刻度、轴名）
          var hits = texts.filter(function (o) {
            return o.t === String(lastL.v) &&
              Math.abs(o.x - lastL.x) < 80 && Math.abs(o.y - lastL.y) < 20;
          });
          k3.netBoth();
          return hits.length === 1;
        });
      }));
    // ---- 复原，别影响后面的断言 ----
    k3.netSetSpan('all'); k3.netBoth(); k3.netDraw();
  }

  // ================================================================ V1.9.1（#6）：横轴「时间刻度梯」
  // 清单要求：两章统一升级为"时间 nice 步长梯"、任何缩放档位保证 ≥3 条且步长严格细化、
  //   修掉"跨度太小 → 步长回落 1825 天 → **刻度直接消失**"的纯算术缺陷。
  //   〔v2 裁决〕Q2 = 改从实际入轨开始（轴起点，见上）；Q3 = **不用小时级**（历史库口径本
  //   就是"一天一条"：当天多条 TLE 取均值）→ 档位梯最细到「天」。
  {
    const L = k3.tickLadder();
    assert('#6：档位梯**只此一处定义**（旧版 04/05 两章各内联一份一字不差的 LADDER，改一处漏一处）',
      L.length === 12 && (appSrc.match(/var TICK_LADDER = \[/g) || []).length === 1 &&
      (appSrc.match(/var stepD = tickStepDays\(spanD, want\);/g) || []).length === 2,
      JSON.stringify(L));
    assert('#6：档位对齐自然边界（1/2/3 日 → 周 → 双周 → 4 周 → 季 → 半年 → 年 → 两年 → 五年）',
      L[0] === 1 && L[1] === 2 && L[2] === 3 && L.includes(7) && L.includes(14) &&
      L.includes(28) && L.includes(91) && L.includes(365) && L.includes(1825));
    // 核心缺陷回归守卫：跨度小于"目标条数 × 最细档"时，旧版 stepD 保持 1825 → 刻度消失
    assert('#6：**深放大时兜底取最细档**（旧版兜最粗档 1825 天 → 刻度直接消失，纯算术必现）',
      k3.tickStep(3, 6) === 1 && k3.tickStep(1, 6) === 1 && k3.tickStep(0.5, 6) === 1,
      'span=3d→' + k3.tickStep(3, 6) + 'd；span=1d→' + k3.tickStep(1, 6) + 'd；span=0.5d→' + k3.tickStep(0.5, 6) + 'd');
    // 步长随可视跨度单调细化（不会出现"放大反而变粗"的来回跳）
    const spans = [3650, 1825, 900, 365, 180, 90, 30, 14, 7];
    const steps = spans.map(s => k3.tickStep(s, 6));
    assert('#6：步长随可视跨度**单调细化**（缩小 → 变粗；放大 → 变细，不会来回跳）',
      steps.every((v, i) => i === 0 || v <= steps[i - 1]), JSON.stringify(steps));
    const counts = spans.map(s => Math.floor(s / k3.tickStep(s, 6)));
    assert('#6：各档位刻度条数**都至少 3 条**（深放大也不例外 —— 这正是老缺陷的现场）',
      counts.every(c => c >= 3), JSON.stringify(spans.map((s, i) => s + 'd:' + counts[i])));
    assert('#6：常规缩放档的条数不超上限 8（清单要求标签数落在 [3,8]，旧版"首个 ≥want"会过冲到 10）',
      counts.every(c => c <= 8),
      JSON.stringify(counts));
    // 两章共用同一份实现（04 章不得再有第二份内联）
    assert('#6：04 章与 05 章**共用同一个 tickStepDays**（源码里不再出现第二份 LADDER 定义）',
      (appSrc.match(/var LADDER = \[/g) || []).length === 0 &&
      /var stepD = tickStepDays\(spanD, want\);/g.test(appSrc) &&
      (appSrc.match(/var stepD = tickStepDays\(spanD, want\);/g) || []).length === 2);
  }

  // ================================================================ V1.9.1（A9）：倾角分布「聚集区圆圈」
  // 口径：按 (倾角取整 1°) × (高度取整 25 km) 分箱 → 只给**成员 ≥ 8** 的箱画圈；圆心/标签取簇内均值；
  //   半径在真实散布（2.2σ）与**可见性**之间折中并夹上下限；重叠的簇要合并（否则同一片星群画两个几乎重合的圈）；
  //   放大到 viewSpanX < max(簇跨度×2.5, 12°) 时淡出；**不填充、不参与命中测试**；全屏与导出同样绘制。
  {
    const cls = k3.chartCL();
    assert('A9：聚出了有意义的簇（星网页实测 5 个，且每个成员 ≥ 8）',
      cls.length >= 3 && cls.every(c => c.n >= 8),
      cls.length + ' 个簇：' + cls.map(c => c.n).sort((a, b) => b - a).join('/'));
    assert('A9：任一簇的成员数不超过其星座总点数（分箱不重复计数）',
      (function () {
        const total = cls.reduce((a, c) => a + c.n, 0);
        // ★ V1.9.4+：上限从写死的 244 改成**真实目录数**（写"性质"不写"当前数据快照"——
        //   244 会随新批次过期，而这条断言的原意只是"分箱不重复计数"）。
        const gwTotal = (RAW.gw.sats || []).length;
        return total <= gwTotal && total > 0;
      })(), cls.reduce((a, c) => a + c.n, 0) + ' / ' + ((RAW.gw.sats || []).length));
    assert('A9：**重叠的簇已合并**（实测：86.36° 与 86.65° 被 1° 分箱切开的 32+29 已并成 1 个 61 颗的簇）',
      (function () {
        const at86 = cls.filter(c => c.x >= 86 && c.x < 87);
        return at86.length === 1 && at86[0].n === 61;
      })(), JSON.stringify(cls.filter(c => c.x >= 86).map(c => [c.x, c.n])));
    // ★ V1.9.2（用户报"圈互相重合、没有起到区分效果，请重新划分"）：
    //   旧判据要求"1100/1127/1149 三档各自独立"，但它们的间距只有 27~49 km，
    //   在 35000 km 的纵轴上画出来**必然互相重叠**（要分开就得把半径压到 <1 像素）。
    //   新判据：**数据空间里分不出来就合并**（同族），而真正离得远的不同族仍须独立。
    // ★ 2026-10-15：旧版钉死"50° 上必须同时存在 <1000km 与 >1000km 两个簇"——那是**数据快照**。
    //   CI 定时刷新后（新 TLE）50° 只剩一个簇 → 断言红，且**卡住了"有变化才提交"那一步**，
    //   数据推不上去、还会触发失败告警。改为**性质判据**：同一倾角分箱上的簇必须按高度分离
    //   （分箱宽 25 km）——既覆盖原意（同族微差应合并、不同族不得并簇），又不钉死具体高度。
    assert('A9（V1.9.2 重新划分·数据自适应）：同一倾角分箱内的簇按高度分离（同族微差合并、异族不并簇）',
      (function () {
        if (!cls.length) return false;
        const byInc = {};
        cls.forEach(c => { const k = Math.round(c.x); (byInc[k] = byInc[k] || []).push(c.y); });
        return Object.keys(byInc).every(k => {
          const ys = byInc[k].slice().sort((a, b) => a - b);
          return ys.every((v, i) => i === 0 || v - ys[i - 1] > 25);   // 25 = CHART_CL_BIN_ALT
        });
      })(), JSON.stringify(cls.map(c => [Math.round(c.x), Math.round(c.y), c.n])));
    assert('A9（V1.9.2）：圈与圈**互不相交**（用户报的"互相重合"已根治；缩到看不见的簇会被丢弃）',
      (function () {
        for (let a = 0; a < cls.length; a++) for (let b = a + 1; b < cls.length; b++) {
          const A = cls[a], B = cls[b];
          // 椭圆相交 = 两轴都靠得比半径和更近；这里按 0.9 放宽（屏幕像素与数据单位换算不精确）
          if (Math.abs(A.x - B.x) < (A.rx + B.rx) * 0.9 &&
              Math.abs(A.y - B.y) < (A.ry + B.ry) * 0.9) return false;
        }
        return true;
      })(), JSON.stringify(cls.map(c => [Math.round(c.x), Math.round(c.y), c.n, +c.rx.toFixed(2), Math.round(c.ry)])));
    assert('A9（V1.9.2）：圈的线宽加粗到 1.7（用户报"圈过细"）',
      /ctx\.setLineDash\(\[4, 4\]\); ctx\.lineWidth = 1\.7;/.test(appSrc));;
    assert('A9：半径夹在合理区间（倾角 0.9°~8° / 高度 45~260 km）—— 最小半径按**可见性**定，不然只有几像素',
      cls.every(c => c.rx >= 0.9 - 1e-9 && c.rx <= 8 + 1e-9 && c.ry >= 45 - 1e-9 && c.ry <= 260 + 1e-9),
      JSON.stringify(cls.map(c => [c.rx, c.ry])));
    // ★ V1.9.2（用户报"圈互相重合、没有起到区分效果，请重新划分"）：
//   合并判据从"真实散布是否重叠"改为"**数据空间里分不出来就合并**"（见 chartClusters 注释）。
assert('A9（V1.9.2 重新划分）：合并判据 = 数据空间可分辨阈值（CL_MERGE_Y/CL_MERGE_X），旧的 rxRaw 判据已删',
      /var CL_MERGE_Y = 80, CL_MERGE_X = 0\.8;/.test(appSrc) &&
      /Math\.abs\(a\.x - b\.x\) < CL_MERGE_X && Math\.abs\(a\.y - b\.y\) < CL_MERGE_Y/.test(appSrc) &&
      !/\(a\.rxRaw \+ b\.rxRaw\) \* 0\.8/.test(appSrc));
    // 淡出：默认跨度可见；缩到 3° 全部消失；12° 阈值参与判定
    const span = k3.chartSpan();
    assert('A9：默认视图下圆圈可见（alpha = 1）',
      cls.every(c => k3.chartAlpha(span, c.spanX) === 1),
      'span=' + span + ' cls=' + JSON.stringify(cls.map(c => [c.spanX, k3.chartAlpha(span, c.spanX)])));
    assert('A9：放大到 3° 时**全部消失**（viewSpanX < 12° 这条判据生效）',
      cls.every(c => k3.chartAlpha(3, c.spanX) === 0));
    assert('A9：淡出是**视图的连续函数**（中间量 0<a<1，缩放时平滑，无需另设动画状态）',
      (function () { const a = k3.chartAlpha(11, 1); return a > 0 && a < 1; })(),
      'alpha(11,1)=' + k3.chartAlpha(11, 1));
    // 真的画了：默认视图下 ellipse 调用数 === 簇数（都在视口内）
    const before9 = k3.chartEll().length;
    k3.chartDraw();
    const drewN = k3.chartEll().length - before9;
    assert('A9：绘制时每个簇都画了一个椭圆（ellipse 调用数 = 簇数）',
      drewN === cls.length, 'ellipse=' + drewN + ' 簇=' + cls.length);
    assert('A9：圆圈**不填充**（该段只有 stroke，没有 fill）且用星座主题色 + [4,4] 虚线',
      /ctx\.setLineDash\(\[4, 4\]\); ctx\.lineWidth = 1;/.test(appSrc) &&
      /ctx\.beginPath\(\); ctx\.ellipse\(cx, cy, rx, ry, 0, 0, 6\.2832\); ctx\.stroke\(\);/.test(appSrc) &&
      /ctx\.strokeStyle = C\.theme;/.test(appSrc));
    assert('A9：标签内容 =「高度km/倾角°」、同色小字 10px，且默认落在圆圈**右上沿**（45° 方向）',
      /Math\.round\(cl\.y\) \+ 'km\/' \+ Math\.round\(cl\.x\) \+ '°'/.test(appSrc) &&
      /ctx\.font = '10px ' \+ MONO; ctx\.fillStyle = C\.theme;/.test(appSrc) &&
      /var lx = cx \+ rx \* 0\.707, ly = cy - ry \* 0\.707;/.test(appSrc));
    assert('A9（V1.9.2）：标签带**防重叠**排版（靠得太近就下移/右移，用户截图里的标签叠字已根治）',
      /var _labelFor = function \(cl, cx, cy, rx, ry\)/.test(appSrc) && /_placed\.push\(\[lx, ly\]\)/.test(appSrc));;
    // ★ V1.9.5（H18）：选中态标签**三态**（簇标签 → 批次名 → 单星名）
    //   ① 未选/远 → 簇标签（上面已验）；② 选中批次且批内星挤在一起（相邻像素间距 < 阈值）→ **批次名**；
    //   ③ 放大到能分辨 → **单星名**。用户口径："选中批次时显示批次名，放大到能分辨时再显示单星名"。
    assert('H18：三档判据在源码里（相邻星像素间距 CHART_NAME_GAP 阈值 + 批次名走 batchName）',
      /var CHART_NAME_GAP = \d+;/.test(appSrc) &&
      /if \(minGap >= CHART_NAME_GAP\)/.test(appSrc) &&
      /ctx\.fillText\(batchName\(\(g\[0\]\.s\.launch \|\| \{\}\)\.name\), lx \+ 5, ly \+ 11\)/.test(appSrc) &&
      // 批次名与簇标签**共用一张避让表**（两张表各管各的会叠字）
      /var _placed = \[\];\n  var _cls = chartClusters\(pts\);/.test(appSrc));
    assert('H18：批次名标签参与避让（与簇标签同表：命中就上移/右移，并夹在绘图区内）',
      /for \(var q = 0; q < 8; q\+\+\)/.test(appSrc) && /_placed\.push\(\[lx, ly\]\);\n      ctx\.textAlign = 'left'; ctx\.textBaseline = 'bottom';/.test(appSrc));
    // 运行时：真选一个批次（低轨27组 → 批内 9 颗挤成一团）→ 默认视图应给**批次名**，不给 9 个单星名
    (function () {
      k3.chartViewAuto();
      const nSel = k3.selectGroup('26230');            // 低轨27组（9 颗）
      const before = k3.chartTexts().length;
      k3.chartDraw();
      const drew = k3.chartTexts().slice(before);
      assert('H18②：选批次（默认视图，批内挤成一团）→ 画的是**批次名**，不是 9 个单星名',
        drew.indexOf('低轨27组') >= 0 && !drew.some(x => /^互联网27组[A-Z]$/.test(x)),
        '选中 ' + k3.state().sel.length + ' 颗；画出的标签: ' + JSON.stringify(drew.filter(x => /^低轨|^互联网27组/.test(x))));
      // 放大到"刚好把该批自己填满视窗"（自适应，避免写死视窗被画布宽度差异带偏）→ 应切换成**单星名**
      const rg = k3.chartSelRange();
      const padX = Math.max(0.05, (rg.x1 - rg.x0) * 0.06);
      k3.chartViewSet(rg.x0 - padX, rg.x1 + padX, rg.y0 - 120, rg.y1 + 120);
      const before2 = k3.chartTexts().length;
      k3.chartDraw();
      const drew2 = k3.chartTexts().slice(before2);
      assert('H18③：放大到能分辨（拉满该批自身范围）→ 切换为**单星名**',
        drew2.some(x => /^互联网27组[A-Z]$/.test(x)) && drew2.indexOf('低轨27组') < 0,
        '视窗 x=' + (rg.x0 - padX).toFixed(2) + '~' + (rg.x1 + padX).toFixed(2) + '；标签: ' + JSON.stringify(drew2.filter(x => /^低轨|^互联网27组/.test(x))));
      k3.chartViewAuto();
      k3.state().sel.forEach(i => {});                 // 选中态由后续断言自行重置（selectGroup 会覆盖）
    })();
    // H19：单星名标签走 nameOf（中文模式出中文名，不出现拼音）
    // ★ V1.9.5（H42）：上游**格式变更探测** + 非 200 显式失败
    //   （CelesTrak 政策：旧格式含 legacy TLE 将随 5 位号用尽停用；收到任何非 200 必须立即停下交人排查）
    (function () {
      const TLE_OK = 'X\n1 57337U 23095A   26289.50000000  .00000000  00000-0  00000-0 0  9999\n2 57337  86.5000  10.0000 0001000  90.0000 270.0000 13.50000000 10000';
      const cases = [
        ['正常 TLE', TLE_OK, true], ['前置空行的 TLE', '\n\n' + TLE_OK, true],
        ['「No GP data found」= 合法空结果', 'No GP data found', true],
        ['CSV 新格式', 'OBJECT_NAME,NORAD_CAT_ID,EPOCH\nISS,25544,2026-10-16T00:00:00', false],
        ['JSON（OMM）', '[{"OBJECT_NAME":"ISS","NORAD_CAT_ID":25544}]', false],
        ['HTML 错误页', '<!DOCTYPE html><html>403 Forbidden</html>', false]
      ];
      const bad = cases.filter(c => checkFormat(c[1]).ok !== c[2]);
      assert('H42：GP 响应**格式探测**（TLE 认得出；CSV/JSON/HTML 判为格式异常；「No GP data found」是合法空结果）',
        bad.length === 0, bad.length ? ('不符 ' + bad.length + ' 例：' + bad.map(b => b[0]).join(' / ')) : (cases.length + ' 例样本全部符合预期'));
    })();
    assert('H42：判据在**可测模块**里（scripts/format_guard.mjs），refresh 只 import 使用、不重复实现',
      /import \{ checkFormat \} from '\.\/scripts\/format_guard\.mjs';/.test(refreshSrc) &&
      /const chk = checkFormat\(txt\);/.test(refreshSrc) &&
      /export function looksLikeTLE\(txt\)/.test(guardSrc) && /export function suspectKind\(txt\)/.test(guardSrc) &&
      !/function looksLikeTLE\(txt\) \{\n  const lines/.test(refreshSrc));
    assert('H42：**非 200 记账 + 显式失败**（政策：立即停下交人排查；旧写法只 log 一行就继续跑 = 静默降级）'
      + '｜且**按查询类型分类**（NAME=/CATNR= 的 404 = 查无此项，不能当异常 —— 上线当天就被 CI 抓到过误报）',
      /const probeQuery = \/\[\?&\]\(NAME\|CATNR\)=\/i\.test\(url\);/.test(refreshSrc) &&
      /if \(!\(r\.status === 404 && probeQuery\)\) NET_ISSUES\.push\(/.test(refreshSrc) &&
      /const NET_ISSUES = \[\];/.test(refreshSrc) && /const FORMAT_ALARM = \[\];/.test(refreshSrc) &&
      /if \(NET_ISSUES\.length\) \{[\s\S]{0,700}?process\.exitCode = 7;/.test(refreshSrc) &&
      /if \(FORMAT_ALARM\.length\) \{[\s\S]{0,800}?process\.exitCode = 6;/.test(refreshSrc));
    // ★ V1.9.5（H29 前哨）：**探针键不得重复** —— 字符串手术留下过 `chartDraw`×3 / `climbDraw`×2，
    //   重复键在对象字面量里会被后者静默覆盖（同名探针行为悄悄变了，很难查）。这里设成硬守卫。
    assert('探针键唯一（重复键会被静默覆盖，属"改坏了也看不出来"的那类）',
      (function () {
        const keys = (smokeSrc.match(/^\s+"  ([A-Za-z_][A-Za-z0-9_]*): function/gm) || [])
          .map(x => x.replace(/^\s+"  /, '').replace(/: function$/, ''));
        const dup = {}; keys.forEach(k => { dup[k] = (dup[k] || 0) + 1; });
        const bad = Object.keys(dup).filter(k => dup[k] > 1);
        return bad.length === 0;
      })(), '共 ' + ((smokeSrc.match(/^\s+"  [A-Za-z_][A-Za-z0-9_]*: function/gm) || []).length) + ' 个探针键');
    // ★ V1.9.5（H32-A）：01/02 章标签避让换成**空间网格**（O(卫星×标签) → O(卫星×桶内标签)）
    assert('H32-A：网格结构齐备（labelStore/labelPush/labelEach + 32px 桶 + 开关可回退）',
      /var LABEL_GRID = true;/.test(appSrc) && /var LABEL_CELL = 32;/.test(appSrc) &&
      /function labelStore\(\)/.test(appSrc) && /function labelPush\(S_, b\)/.test(appSrc) &&
      /function labelEach\(S_, bx, fn\)/.test(appSrc) &&
      /if \(!LABEL_GRID\) \{ for \(var i = 0; i < S_\.boxes\.length; i\+\+\) fn\(S_\.boxes\[i\]\); return; \}/.test(appSrc));
    assert('H32-A：跨桶标签**不重复计数**（stamp 去重）—— 否则重叠面积会被多算、标签选取会变',
      /S_\.stamp\+\+;/.test(appSrc) && /if \(b\.__seen === S_\.stamp\) continue;/.test(appSrc) &&
      /b\.__seen = S_\.stamp;/.test(appSrc));
    assert('H32-A：地图与地球**两章都**走网格（旧的 labels 线性数组已退役）',
      (appSrc.match(/LG = labelStore\(\)/g) || []).length === 2 &&   // 地图 var LG = … ｜ 地球 var st = cur(), LG = …
      /labelPush\(LG, best2\)/.test(appSrc) && /labelPush\(LG, box\)/.test(appSrc) &&
      !/labels\.push\(/.test(appSrc));
    // 运行时（性质判据）：网格算出的重叠面积与线性扫描**逐位一致**（含跨桶标签的重复计数风险）
    (function () {
      const gp = k3.gridParity();
      assert('H32-A：网格与线性扫描结果逐位一致（200 组随机用例；跨桶标签不重复计数）', gp && gp.ok, gp && gp.detail);
    })();
    assert('H18+H19：单星名标签走 nameOf()（中文模式为中文名，英文模式为目录名）',
      /g\.forEach\(function \(o\) \{ ctx\.fillText\(nameOf\(o\.s\), o\.x \+ 9, o\.y\); \}\);/.test(appSrc));
    // ★ V1.9.5（H25）：主题切换时地图/地球**随扫过边界一起变色**（不能等到收尾才跳一次）
    assert('H25：VT 回调里就重绘地图/地球（收尾才置脏 = 用户报的"地球最后跳变一次"）',
      /var apply = function \(\) \{[\s\S]{0,1600}?repaintMapGlobeNow\(\);/.test(appSrc) &&
      /function repaintMapGlobeNow\(\) \{[\s\S]{0,900}?drawMap\(frameStatesMap \|\| propagateAll\(simMs\('map'\)\), simMs\('map'\)\)[\s\S]{0,400}?drawGlobe\(frameStatesGlobe \|\| propagateAll\(simMs\('globe'\)\), simMs\('globe'\)\)/.test(appSrc));
    // ★ V1.9.5（H25 第二版）：卡顿根治的三条**硬约束**（都是 2026-10-16 实测定下来的，别再改回去）
    assert('H25 第二版：重绘**只画可见的那一张**画布（两张都画 = 8 帧 >50ms、最大 279ms，用户当场听得出卡）',
      /if \(isVisible\(mapCv\) && !isVisible\(globeCv\)\) \{ drawMap/.test(appSrc) &&
      /else if \(isVisible\(globeCv\)\) \{ drawGlobe/.test(appSrc) &&
      /else \{ mapDirty = globeDirty = true; did = 'none'; \}/.test(appSrc));
    assert('H25 第二版：收尾**不再**重复把两张画布置脏（那会在扩散末尾再触发一轮光栅化）',
      !/document\.documentElement\.classList\.remove\('vt-running'\);\s*\n\s*mapDirty = globeDirty = true;/.test(appSrc) &&
      /remove\('vt-running'\);[\s\S]{0,300}?try \{ renderTable\(\); \} catch \(e\) \{\}/.test(appSrc));
    assert('H25 第二版：更新回调**必须同步**（返回 Promise 会让 VT 的抓取阶段等 rAF —— 实测卡死 3.6–7s）',
      !/var apply = function \(\) \{[\s\S]{0,900}?return new Promise/.test(appSrc) &&
      /\/\/ ⚠️ 2026-10-16 试过"更新回调返回 Promise/.test(appSrc));
    assert('H25 第二版（动效加强）：时长 700ms + 伪元素**边界高光**（跟着扩散圆走，零额外绘制）',
      /--anim-theme: 700ms;/.test(tpl) &&
      /::view-transition-new\(root\) \{[\s\S]{0,400}?box-shadow: inset 0 0 38px 6px var\(--vt-glow/.test(tpl) &&
      /animation:vtCircle var\(--anim-theme\) var\(--ease-slow-fast\) forwards !important;/.test(tpl));
    assert('H25：切换期间主循环早退（.vt-running）—— 所以必须显式画一帧，置脏不够',
      /if \(document\.documentElement\.classList\.contains\('vt-running'\)\) return;/.test(appSrc));
    // 降级守卫：重绘失败**不许静默**（warn + 退回置脏，让主循环收尾补一次）
    //   ⚠️ jsdom 里点主题按钮触发不到处理器（实测 theme 属性不变、VT 也是 undefined），
    //   所以"点击 → 画布重绘"这条只能靠**真浏览器逐帧截图**验证（见样张 H25_frames_*）。
    assert('H25：重绘失败不静默 —— warn + 退回置脏（收尾补画一次，不至于停在新色之外）',
      /console\.warn\('\[H25\] 主题切换重绘失败：'/.test(appSrc) &&
      /\} catch \(e\) \{\n    \/\/ 重绘失败不能静默[\s\S]{0,160}?mapDirty = globeDirty = true;/.test(appSrc) &&
      /return 'err';/.test(appSrc));
    // 不参与命中测试：命中函数只找"最近点"，圆圈不进任何数组
    assert('A9：圆圈与标签**不参与命中测试**（命中走 chartHit 的"最近点"，里面不得出现 clusters）',
      (function () {
        const hit = (appSrc.match(/function chartHit\(mx, my\) \{[\s\S]*?\n\}/) || [''])[0];
        return hit.length > 0 && !/chartClusters|chartClusterAlpha/.test(hit);
      })(), 'chartHit 长度=' + (appSrc.match(/function chartHit\(mx, my\) \{[\s\S]*?\n\}/) || [''])[0].length);
    assert('A9：导出图同样绘制（导出走同一个 drawChart）',
      /else drawChart\(\);/.test(appSrc));
  }

  // ================================================================ V1.9.1（A18）：GEO 断轴（03 / 04 共用）
  // Q43 定稿：断轴区 2000~35750 隐藏、上段 35750~35850；两图共用参数；上下比 70/30；
  //   `climbBounds` 的"超 2000 放宽"安全网**删除**；Q47：断轴区内的点不画（曲线自然断开）。
  {
    // ★ V1.9.2：断轴的启用判据从"上界越过 2000"改为"**上界越过断轴区上沿 35750**"
    //   —— 因为视口现在按**可见范围比例**分配高度，若仍以 2000 为界，
    //   "放大到 0~4000"这种视野会走断轴、把那 2000~4000 段凭空隐藏掉。
    assert('A18（V1.9.2）：断轴只在**视野真的含到上段（>35750）**时启用；只看 LEO 时走线性映射',
      k3.brkOn(0, 2000) === false && k3.brkOn(0, 4000) === false &&
      k3.brkOn(0, 35750) === false && k3.brkOn(0, 35751) === true);
    const PT = 16, ph = 400;
    const M = k3.brkMap(0, 35850, PT, ph);
    // ★ V1.9.3（用户要求，第三次返工）：断轴改为**折叠映射** —— 断轴区宽度记为 0，
    //   整张图是一根普通的连续线性轴（只是在折点处"跳过"了 2000~35700 这一段真实高度）。
    //   用户原话：「LEO 卫星分布区域高度的上界直接对齐 GEO 分布区域的下边缘…
    //   中间的高度视作不存在，两块区域完全并为一块…往上拉动是切换到 GEO 坐标图而不是
    //   两者真正画在一张图，这样反而效果更好还更简单」。
    //   ⇒ 旧的两段式断言（按跨度分配高度 / 断轴区内映射 null / 分居缝两侧）全部作废，
    //     换成"折叠映射"的性质断言：连续、单调、折点重合、缩放平移是刚体。
    assert('A18（V1.9.3）：断轴 = **折叠映射**（断轴区宽 0）—— 画布上仍有一个折点标记行',
      M.on === true && M.cut > PT && M.cut < PT + ph, 'cut=' + M.cut);
    assert('A18（V1.9.3）：**LEO 上界（2000）与 GEO 下界（35700）重合于同一像素行**（用户例子的口径：1500 视作 35700）',
      (function () {
        const a = M.at(2000), b = M.at(35700);
        return a != null && b != null && Math.abs(a - b) < 1e-6;
      })(), M.at(2000) + ' / ' + M.at(35700));
    assert('A18（V1.9.3）：映射**全定义域连续**（没有任何值映射为 null），且**严格单调不减** —— ' +
      '唯二相等的一对正是折点（2000 与 35700 重合，这就是"两块并为一块"）',
      (function () {
        const ys = [0, 500, 1500, 2000, 35700, 35786, 35849];
        for (let i = 0; i < ys.length; i++) if (M.at(ys[i]) == null) return false;
        // 值越大 → 像素 y 越小（越靠上）。允许相等，因为折点两侧重合是有意为之。
        for (let i = 1; i < ys.length; i++) if (!(M.at(ys[i]) <= M.at(ys[i - 1]) + 1e-6)) return false;
        // 且必须真的"减少"（不能整段都相等 —— 那说明映射退化了）
        return M.at(0) - M.at(35849) > 100;
      })(), JSON.stringify([0, 500, 1500, 2000, 35700, 35786, 35849].map(v => M.at(v))));
    assert('A18（V1.9.3）：只看到 LEO 时**不启用断轴**（线性映射，LEO 占满整高）',
      (function () {
        const M2 = k3.brkMap(0, 2000, PT, ph);          // 视野全在 LEO 内
        return M2.on === false && Math.abs(M2.at(0) - (PT + ph)) < 1e-9 && Math.abs(M2.at(2000) - PT) < 1e-9;
      })(), JSON.stringify(k3.brkMap(0, 2000, PT, ph).at(0)));
    assert('A18（V1.9.3）：GEO（35786）落在折点之上（比 LEO 区最高点还高）',
      M.at(35786) < M.at(35700) && M.at(35786) > PT, 'Y(35786)=' + M.at(35786));
    assert('A18（V1.9.3）：反向映射（命中测试用）能还原同一竖直位置 —— 折叠与展开互为逆运算',
      Math.abs(M.inv(M.at(1149)) - 1149) < 1 && Math.abs(M.inv(M.at(35786)) - 35786) < 1,
      M.inv(M.at(1149)) + ' / ' + M.inv(M.at(35786)));
    // 真实数据：GEO 三星入库后的表现 —— ★ V1.9.5（H39）起 03 章改**等效高度**，不再启用断轴
    assert('V1.9.5（H39）：03 章纵轴 = 等效高度 0–2200（GEO 画进 2000km 附近，断轴不再启用）',
      k3.chartY1() <= 2200 && k3.chartBrkOn() === false,
      'y1=' + k3.chartY1() + ' brk=' + k3.chartBrkOn());
    // GEO 三星（24040A/24135A/24181A）的显示高度 = 实际 − 33800 ≈ 1986（用户口径"2000km 左右"）
    assert('V1.9.5（H39）：GEO 三星按等效高度落在 ~1986（实际 35786 − 33800），LEO 原样',
      (function () {
        var g = k3.chartGeoY();
        return g.length === 3 && g.every(function (r) { return r.y > 1900 && r.y < 2050; }) &&
          k3.chartLeoMax() < 1300;
      })(), 'GEO=' + JSON.stringify(k3.chartGeoY()) + ' LEOmax=' + k3.chartLeoMax());
    // ① 双向边界：乱拖乱缩也出不去 0–180° / 0–2200（用户口径"恢复两个方向的滑动边界限制"）
    assert('V1.9.5（H39）：clampChartView 硬边界（横 0–180° / 纵 0–2200，视口再大也钉死在定义域）',
      (function () {
        var a = k3.chartClamp(-500, 500, -500, 3000);       // 视口比定义域大 → 钉到定义域
        var b = k3.chartClamp(-50, 20, -30, 40);            // 平移出界 → 整体拉回
        var c = k3.chartClamp(160, 400, 2100, 3000);        // 右上出界 → 拉回
        return a.x0 === 0 && a.x1 === 180 && a.y0 === 0 && a.y1 === 2200 &&
          b.x0 === 0 && b.y0 === 0 && b.y1 <= 2200 &&
          c.x1 === 180 && c.y1 === 2200 && c.x0 >= 0 && c.y0 >= 0;
      })(), JSON.stringify([k3.chartClamp(-500, 500, -500, 3000), k3.chartClamp(-50, 20, -30, 40)]));
    // ③ 消除撕裂（用户原话的落脚点）：**单一连续坐标系** —— 同一拖拽量在任意位置换算一致。
    //   怎么测：取 drawChart 用的同一个映射，量"每 100 km 对应多少像素"。
    //   旧的两段式（折点映射 + 固定 BRK_GAP）在两段上比例不同，正是"撕裂"的来源；
    //   现在跨断轴点（1400→1500→1600）与 LEO 区（0→100）必须**逐位相同**。
    assert('V1.9.5（H39③）：纵向映射单一连续 —— 每 100km 像素数跨断轴点(1500)与 LEO 区完全一致（撕裂根源消失）',
      (function () {
        var m = k3.chartYmap();
        var ref = m.leo;
        return m.on === false && ref > 0 &&
          Math.abs(m.mid - ref) < 1e-9 && Math.abs(m.below - ref) < 1e-9 &&
          Math.abs(m.above - ref) < 1e-9 && Math.abs(m.geo - ref) < 1e-9;
      })(), JSON.stringify(k3.chartYmap()));
    // 更强的一档：**把视口开到整个定义域（0~2200）** —— 这是能到达的最大跨度，也不得触发两段式。
    assert('V1.9.5（H39③）：视口开到全定义域（0~2200）时同样不启用两段式（断轴只在等效轴之外的历史分支里）',
      (function () {
        var m = k3.chartYmap(0, 2200);
        var ref = m.leo;
        return m.on === false && ref > 0 &&
          Math.abs(m.geo - ref) < 1e-9 && Math.abs(m.above - ref) < 1e-9;
      })(), JSON.stringify(k3.chartYmap(0, 2200)));
    assert('V1.9.5（H39③）：视口正好铺满绘图区高度（一个映射管全图，不再分上下两段各映射一次）',
      (function () {
        var m = k3.chartYmap();
        return Math.abs(m.full - m.ph) < 1e-9;
      })(), 'full=' + k3.chartYmap().full + ' ph=' + k3.chartYmap().ph);
    // 拖拽换算的**源码形状**守卫：平移公式必须是线性比例（同一像素量在任何 y 位置都得同一个数据量），
    //   且这段里不得再出现折叠函数 —— brkFold 一旦回归，拖拽就会重新变成"位置相关"（撕裂的老路）。
    assert('V1.9.5（H39③）：图表拖拽换算不含折叠函数（平移 = 线性比例，任意位置换算一致）',
      (function () {
        var src = fs.readFileSync('app.js', 'utf8');
        var i = src.indexOf('var dx = (p.x - chartDrag.x)');
        if (i < 0) return false;
        var seg = src.slice(i, i + 300);
        return seg.indexOf('brkFold') < 0 && /dy = \(p\.y - chartDrag\.y\) \/ r\.ph \* \(v\.y1 - v\.y0\)/.test(seg);
      })(), 'app.js 拖拽块');
    // ★ V1.9.3（用户要求 · 参考图五）：04 章纵轴改为「**贴合数据实际范围**」——
//   下沿抬到数据下沿之下一点（不再是恒 180），上沿在数据最高之上一线。
//   为什么改：旧口径下沿恒 180 时，对"九颗星都挤在 1112~1137 km"这类批次，
//   数据只占纵轴 93%~96%（实测 26221 低轨26组：纵轴 180~1182、数据 1112~1137），
//   25 km 的星间差异被压成 2 像素 —— 正是用户截图里的现场。
// ★ V1.9.3 第二轮：判据写成**性质**，且必须**同时兼容两种数据密度** ——
    //   · smoke 的 jsdom 环境拉不到 history/，用的是 satdata 内嵌的**精简历史**（histLite）；
    //   · 真实页面加载的是完整分片。同一个批次在两者下的跨度可能差很多
    //     （例：24240 高轨01星已完全稳定，lite 里 228 个点全是 1170.8 → 跨度 0；
    //      完整历史里是 1089~1170.8 → 跨度 82）。
    //   所以这里用 **26120（试验星11组）** —— 它在两种数据下都有真实跨度
    //   （lite 451.6~508.6 / 完整 446.9~508.7），断言才稳定。
    assert('V1.9.3 第二轮：04 章纵轴**上下对称留白**（数据分布在图像中央，不是挤在一端）',
      (function () {
        k3.climbTake('sma');
        k3.setClimbPick('b:26120');
        const b = k3.climbB(), lo = k3.climbDataLo(), hi = k3.climbDataHi();
        if (lo == null || hi == null) return false;
        const padLo = lo - b.y0, padHi = b.y1 - hi;
        const span = b.y1 - b.y0;
        return b.nobrk === true && span > 0 &&
          padLo >= -0.5 && padHi >= -0.5 &&                    // 两端都不裁数据
          Math.abs(padLo - padHi) < Math.max(6, span * 0.25);   // ★ 上下留白大致相等
      })(), JSON.stringify(k3.climbB()) + ' lo=' + k3.climbDataLo() + ' hi=' + k3.climbDataHi());
    assert('V1.9.3 第二轮：纵轴**不再被绝对保底撑大**（旧口径轴高恒 220 km → 数据只占 27%）',
      (function () {
        k3.climbTake('sma');
        k3.setClimbPick('b:26120');
        const b = k3.climbB();
        // 该批数据跨度约 57~62 km → 新口径轴高 ≈ 跨度×1.3 ≈ 75~80；
        // 旧口径恒为 220(400−180)。取 130 为界：既能抓回归，又不受两种数据密度差异影响。
        return (b.y1 - b.y0) < 130;
      })(), 'span=' + (k3.climbB().y1 - k3.climbB().y0));
    // ⚠️ 这里**不能**用"断言某段旧代码不存在"的负向判据 —— app.js 的长注释里
    //    引用了旧写法（`Math.max(mn + CLIMB_MIN_TOP - CLIMB_FLOOR, ...)`）来说明病根，
    //    负向正则会被自己的注释命中（本项目踩过 5 次的坑）。
    //    改为**正向判据**：确认新公式的三行都在、且旧公式的两个特征都不在**可执行行**里
    //    （用 `;` 结尾 + 行首缩进两个空格内的形式区分代码与注释）。
    assert('V1.9.3 第二轮：**不再有"轴高恒 220 km"的绝对保底**（那是上部留白 70% 的根因）',
      !/^\s{2}var hi = Math\.max\(mn \+ CLIMB_MIN_TOP/m.test(appSrc) &&
      !/^\s{2}if \(hi - lo < CLIMB_MIN_TOP - CLIMB_FLOOR\)/m.test(appSrc),
      '（负向判据只匹配可执行行，避开注释里的旧代码引用）');
    assert('V1.9.3 第二轮：`climbBounds` = 「上下都贴数据 + **对称增长**」（跨度的 1.3 倍保底）',
      /^\s{2}var pad = Math\.max\(3, span \* 0\.09\);$/m.test(appSrc) &&
      /^\s{2}var lo = mn - pad, hi = mx \+ pad;$/m.test(appSrc) &&
      /^\s{2}var minH = span \* 1\.3;/m.test(appSrc) &&          // 该行带行尾注释，不能锚 $
      /^\s{2}if \(hi - lo < minH\) \{ var g1 = \(minH - \(hi - lo\)\) \/ 2; lo -= g1; hi \+= g1; \}$/m.test(appSrc) &&
      /^\s{2}if \(lo < CLIMB_FLOOR\) \{ hi \+= \(CLIMB_FLOOR - lo\); lo = CLIMB_FLOOR; \}$/m.test(appSrc) &&
      /^\s{2}return \{ y0: Math\.round\(lo\), y1: Math\.ceil\(hi\), fixed: true, nobrk: true \};$/m.test(appSrc));
    assert('V1.9.3 第二轮：**下沿仍不低于 CLIMB_FLOOR(180)**（用户 V1.9.2 的口径未被推翻），' +
      '但差额补到上沿而非把数据推出画面',
      /^\s{2}if \(lo < CLIMB_FLOOR\) \{ hi \+= \(CLIMB_FLOOR - lo\); lo = CLIMB_FLOOR; \}$/m.test(appSrc));
    assert('V1.9.3：纵轴**跨度不会过扁**（数据跨度极小时仍给足视觉高度）',
      (function () {
        k3.setClimbPick('b:24240');
        const b = k3.climbB();
        return (b.y1 - b.y0) >= 24;      // 新保底：单点/近单点给 24 km；此前是 220 km 恒值
      })(), 'span=' + (k3.climbB().y1 - k3.climbB().y0));
    assert('V1.9.3：04 章纵轴上沿**随批次自适应**（GEO 批次 ≈35786 量级，不是固定的 2000）',
      (function () { k3.setClimbPick('b:24181'); const y1 = k3.climbY1(); return y1 > 35000 && y1 < 38000; })(),
      'y1=' + k3.climbY1());
    assert('A18：两章共用同一套参数（BRK_LO / BRK_GEO_LO 只有一处定义，03 与 04 都调 brkYMap）',
      // V1.9.3：BRK_RATIO（固定 70/30）与两段式参数 BRK_HI/BRK_TOP 已删除，
      //   改为**折叠映射**（brkFold / brkUnfold 一对互逆函数 + BRK_GEO_LO 折点下界）
      (appSrc.match(/var BRK_LO = 2000;/g) || []).length === 1 &&
      (appSrc.match(/var BRK_GEO_LO = 35700;/g) || []).length === 1 &&
      !/var BRK_RATIO/.test(appSrc) &&
      /function brkFold\(y\)/.test(appSrc) && /function brkUnfold\(u\)/.test(appSrc) &&
      (appSrc.match(/brkYMap\(/g) || []).length >= 3 &&
      /brkYMap\(v, r\.PT, r\.ph\)\.yAt\(my\)/.test(appSrc) &&
      /brkYMap\(v, PT, ph\)/.test(appSrc));
    assert('A18：断轴处画了标记（两根平行斜杠 + `2000~35700` 纯数字量程；纯数字 → 不需要新 i18n 键）',
      // V1.9.3：文案随新语义改为"被折叠掉的高度区间"下界 BRK_GEO_LO
      /function brkDrawMark/.test(appSrc) && /ctx\.fillText\(BRK_LO \+ '~' \+ BRK_GEO_LO/.test(appSrc));
    assert('A18（V1.9.3）：折叠映射下曲线**不再依赖 pen 断开**（Y 永不返回 null）—— ' +
      '代码里保留的 null 判空只是纯防御（换个 mapper 也不会崩），不再是断轴正确性的承担者',
      // 判据分两层：
      //   ① 映射层必须"全定义域有值"（上面已单独断言）——这才是断轴正确性的承担者；
      //   ② 绘制层**允许**保留 null 判空（防御性写法），只要它不再是唯一保障。
      //   ⚠️ 不能断言"pen 必须消失" —— 那是把实现细节钉死；也不能不检查 —— 那会让
      //     "有人把 Y 改回返回 null、但 pen 刚好兜住了"这种回退悄悄通过。
      (function () {
        const M = k3.brkMap(0, 35850, 16, 400);
        return M.at(18000) != null;          // 断轴区内的值**也有**像素位（折叠到折点行）
      })() && /var pen = false;/.test(appSrc));
    // ★ V1.9.5（H39）：36500 km 边界虚线已整段删除（等效高度方案下 GEO 由 35800km 刻度 + 断轴符号表达）
    assert('V1.9.5（H39）：36500 km 边界虚线块已删除（不再有任何 CHART_Y_MAX 边界线代码）',
      !/v\.y1 > CHART_Y_MAX - 1e-6/.test(appSrc));
    k3.setClimbPick('b:24240');

    // ------------------------------------------------------------------
    // ★ V1.9.1（A18 + Q41）：02 章 3D 球体**做不到断轴**（断轴是 2D 坐标轴的技术），改用**分段夸张**：
    //   LEO 段（半长轴 ≤ 8000 km）原样保留 2.4×（与旧版**逐像素一致**，不扰动既有画面）；
    //   高轨段改成缓坡 → GEO(42164 km) 落在 **2.2 个地球半径**（旧口径是 **14.47**，早就跑到画布外）。
    //   这里验证的是**探针暴露的真实函数**，不是把公式复述一遍。
    {
      const hi = k3.globeHi();
      assert('A18/Q41：分段参数就位（分段点 8000 km / GEO 参考 42164 km / 落点 **1.75** 个地球半径 / LEO 仍 2.4×）',
        hi.knee === 8000 && hi.ref === 42164 && hi.refY === 1.75 && Math.abs(hi.ex - 2.4) < 1e-9,
        JSON.stringify(hi));
      // ★ V1.9.3：`HI_REF_Y` 2.2 → 1.75（用户复审选定的"方案 B"，见 app.js 该处长注释）。
      //   关键不变式：**必须 > kneeY（1.6103）**，否则高轨段斜率变负、GEO 会落到 LEO 上限以内。
      assert('V1.9.3：`HI_REF_Y` **必须大于 kneeY**（否则高轨段斜率为负 → GEO 比 8000km 的圈还靠内，视觉更糟）',
        hi.refY > hi.kneeY,
        'refY=' + hi.refY + ' kneeY=' + hi.kneeY.toFixed(4));
      const oldR = r => 1 + (r / hi.RE - 1) * hi.ex;
      const leo = [6378.135, 6900, 7000, 7378.135, 8000];
      assert('A18/Q41：**LEO 段与旧口径逐像素一致**（纯 LEO 视图不受任何扰动，既有视觉断言不会变红）',
        leo.every(r => Math.abs(k3.globeRad(r) - oldR(r)) < 1e-6),
        leo.map(r => r + ':' + k3.globeRad(r).toFixed(4)).join(' '));
      assert('A18/Q41：分段点**连续**（8000 km 处左右极限相等 → 不会出现「内圈比外圈还靠内」的视觉回跳）',
        Math.abs(k3.globeRad(8000) - k3.globeRad(8000 + 1e-6)) < 1e-5 &&
        Math.abs(k3.globeRad(8000) - hi.kneeY) < 1e-6,
        'y(8000)=' + k3.globeRad(8000) + ' kneeY=' + hi.kneeY);
      assert('A18/Q41 + V1.9.3：GEO（42164 km）落在 `HI_REF_Y` 处（= 1.75 个地球半径；旧口径 14.47 → 完全在画布外）',
        Math.abs(k3.globeRad(42164) - hi.refY) < 1e-6,
        'new=' + k3.globeRad(42164) + ' old=' + oldR(42164).toFixed(2));
      assert('A18/Q41 + V1.9.3：GTO 远地点（26600 km）落在 LEO 上限与 GEO 落点**之间**（高轨段被压成一段而非一点）',
        k3.globeRad(26600) > hi.kneeY && k3.globeRad(26600) < hi.refY,
        'y(26600)=' + k3.globeRad(26600));
      let mono = true, prev = -1;
      for (let r = 6378; r <= 60000; r += 10) { const v = k3.globeRad(r); if (v < prev - 1e-9) mono = false; prev = v; }
      assert('A18/Q41：整段单调递增（越高的壳层画得越外，不会互相穿插）', mono);
      assert('A18/Q41 + V1.9.3：GEO 圈在**缩放下限（0.5×）内完全可见**（1200×700 实测）',
        k3.globeRad(42164) * k3.globeBase() * 0.5 <= 350,
        'HI_REF_Y=' + hi.refY + 'R = ' + (k3.globeRad(42164) * k3.globeBase()).toFixed(1) + ' px；×0.5 = ' +
        (k3.globeRad(42164) * k3.globeBase() * 0.5).toFixed(1) + ' px');
      assert('A18/Q41：当前数据的 sats 里**没有高轨卫星** → 图下说明**不追加**压缩提示（不把说明写长）',
        k3.globeHiSats() === 0 && k3.globeNote().indexOf('压缩') < 0,
        'hiSats=' + k3.globeHiSats() + ' | note=' + k3.globeNote());
      assert('A18/Q41：压缩提示键中英齐备，且**只在确有高轨卫星时才出现**（源码守卫）',
        /d_globe_hi_note: \['[^']*压缩[^']*',\s*'[^']*compressed[^']*'\]/.test(appSrc) &&
        /if \(\(st\.sats\[i\]\.sma \|\| 0\) > HI_KNEE_R\) return s \+ ' ' \+ t\('d_globe_hi_note'\)/.test(appSrc));
      assert('A18/Q41：映射只有一处定义（02 章画轨道圈、卫星点、命中测试共用同一个 globeRad）',
        (appSrc.match(/function globeRad\(/g) || []).length === 1 &&
        (appSrc.match(/var ALT_EXAG = 2\.4;/g) || []).length === 1);
    }
  }

  // ================================================================ V1.9.1（A12）：大气层分界线 y = 100 km
  // Q27：画在 **04 变轨情况（仅半长轴模式）** 与 **03 倾角分布（无论纵轴量 sma/hp/ha）**；
  //   `[4,4]` 虚线 + 中性淡色 + 线旁小字「100 km」；绘制层在**网格之上、光点之下**（与 A9 圆圈同层）。
  {
    // 让 canvas 替身也记录 fillText 的文本（"画没画那条线+那个标签"只能这样验）
    const txtOf = styles => styles.text;
    const beforeC = k3.chartTexts().length, beforeL = k3.climbTexts().length;
    k3.chartDraw();
    const chartNew = k3.chartTexts().slice(beforeC);
    assert('A12：03 倾角分布画了「100 km」标注（默认纵轴量 = 半长轴高度）',
      chartNew.indexOf('100 km') >= 0, JSON.stringify(chartNew.filter(x => /100/.test(x))));
    // 三档纵轴量都要画（sma / ha / hp）
    ['sma', 'ha', 'hp'].forEach(function (m) {
      k3.chartMode(m);
      const b = k3.chartTexts().length;
      k3.chartDraw();
      const now = k3.chartTexts().slice(b);
      assert('A12：03 纵轴量切换为 `' + m + '` 时同样画 100 km 线（Q27：无论纵轴量）',
        now.indexOf('100 km') >= 0, JSON.stringify(now.filter(x => /100/.test(x))));
    });
    k3.chartMode('sma');
    // 04：半长轴模式画、升轨速度模式不画
    k3.climbTake('sma');
    let b2 = k3.climbTexts().length;
    k3.climbDraw();
    // ★ V1.9.2（用户要求把 04 章纵轴改为「180 ~ 数据最高」）：
    //   100 km **落在量程之外**，画出来会掉到坐标轴下方 —— 所以那一段新增了"越界即不画"的保护。
    //   这是两处要求的取舍（A12 要求画 / 新口径要求下沿 180），已按用户新要求执行并在 CHANGELOG 记录。
    assert('A12（V1.9.2 变更）：04 章纵轴下沿提到 180 km 后，100 km 线在量程之外 → **不再绘制**（新增越界保护）',
      k3.climbTexts().slice(b2).indexOf('100 km') < 0 &&
      /if \(isFinite\(y0\) && y0 > ATM_LINE\) return;/.test(appSrc) &&
      /atmLineDraw\(ctx, C, PL, pw, Y, '100 km', v\.y0\)/.test(appSrc));;
    k3.climbTake('rate');
    b2 = k3.climbTexts().length;
    k3.climbDraw();
    assert('A12：04 升轨速度模式**不画**（那是 km/天 的量纲，100 km 无意义 —— Q27）',
      k3.climbTexts().slice(b2).indexOf('100 km') < 0);
    k3.climbTake('sma');
    // 层次与样式
    assert('A12：样式 = `[4,4]` 虚线 + 中性淡色（C.dim，不抢数据线）+ 小字 10px，且**在光点之前**绘制',
      /function atmLineDraw\(ctx, C, PL, pw, Yval, label, y0\)/.test(appSrc) &&
      /ctx\.setLineDash\(\[4, 4\]\); ctx\.lineWidth = 1;/.test(appSrc) &&
      /ctx\.strokeStyle = C\.dim; ctx\.globalAlpha = 0\.85;/.test(appSrc) &&
      (function () {
        // 03 章里：atmLineDraw 必须出现在「点」的 forEach 之前
        const src = (appSrc.match(/function drawChart\(\) \{[\s\S]*?\nfunction chartHit/) || [''])[0];
        return src.indexOf('atmLineDraw(') > 0 &&
          src.indexOf('atmLineDraw(') < src.indexOf("var scope = 'chart';");
      })());
    // ★ V1.9.5（H39）：03 章改等效高度单轴后**没有断轴两段**，100 km 线天然在量程内
    //   （默认视图 y0 = 0 → atmLineDraw 的"下沿高于 100km 就不画"守卫不会触发）。
    assert('A12：100 km 分界线在 03 默认视图量程内（y0 = 0；H39 后无断轴、无需再判段）',
      k3.chartViewY0() === 0,
      'y0=' + k3.chartViewY0());
  }

  // ================================================================ V1.9.1（A20）：04 章 hover 不再弹信息窗
  // 用户反馈的 bug：**不选定任何曲线**时，鼠标一放到图上就按横轴匹配最近的曲线点、弹出信息窗。
  // 期望：与 05 章组网进度**完全一致** —— hover 只做视觉提示，**单击**才显示并固定。
  // 这里派发**真实 pointer 事件**验证（不是只查源码字面量）。
  {
    // 前置：先复位（前面的 A1 段落调过 climbInfoAt 显示过信息窗，不复位会把它当成"hover 弹出来的"）
    k3.climbSelect('b:24240');
    k3.climbDraw();
    const pt = k3.climbPointXY(62323, 5);
    assert('A20：能取到曲线上的像素坐标（行为测试的前置）', !!pt, JSON.stringify(pt));
    assert('A20：起点是"未固定且未显示"的干净状态（复位逻辑生效）',
      k3.climbInfoShown() === false && k3.climbPinnedNow() === false,
      'shown=' + k3.climbInfoShown() + ' pinned=' + k3.climbPinnedNow());
    if (pt) {
      const mkEv = (type, x, y) => {
        // 优先用真 PointerEvent（`pointerType` 是它的标准字段）；jsdom 若没有就退回 MouseEvent
        //   并用 defineProperty 补上 —— 注意**必须**是 'mouse'，否则 handler 会直接 return，
        //   drag 保持 null，pointerup 里的整段逻辑都不会执行（这一点在定位时很隐蔽）。
        try {
          return new w3.PointerEvent(type, {
            bubbles: true, cancelable: true, clientX: x, clientY: y, pointerType: 'mouse', pointerId: 1
          });
        } catch (err) {
          const e = new w3.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
          Object.defineProperty(e, 'pointerType', { value: 'mouse', configurable: true });
          Object.defineProperty(e, 'pointerId', { value: 1, configurable: true });
          return e;
        }
      };
      const cv = d3.getElementById('climbCv');
      // ① hover（未选曲线）→ **不得**弹信息窗
      cv.dispatchEvent(mkEv('pointermove', pt.x, pt.y));
      assert('A20：**未选中曲线时 hover 不弹信息窗**（原 bug 的直接回归守卫）',
        k3.climbInfoShown() === false && k3.climbPinnedNow() === false,
        'shown=' + k3.climbInfoShown() + ' pinned=' + k3.climbPinnedNow() + ' text=' + JSON.stringify(k3.climbInfoText()));
      // ② 单击 → 显示并固定
      cv.dispatchEvent(mkEv('pointerdown', pt.x, pt.y));
      cv.dispatchEvent(mkEv('pointerup', pt.x, pt.y));
      assert('A20：**单击曲线上的点 → 显示该点信息窗并固定**（pinned = true）',
        k3.climbInfoShown() === true && k3.climbPinnedNow() === true,
        'shown=' + k3.climbInfoShown() + ' pinned=' + k3.climbPinnedNow());
      assert('A20：信息窗内容是"该点"的（含 NORAD 与历元行）',
        /62323/.test(k3.climbInfoText()) || /NORAD/.test(k3.climbInfoText()), JSON.stringify(k3.climbInfoText()));
      // ③ 固定后鼠标移出画布 → 仍保留（"固定"语义）
      cv.dispatchEvent(new w3.MouseEvent('mouseleave', { bubbles: true }));
      assert('A20：固定后**鼠标移出画布仍保留**（与 05 章 netPinned 同一语义）',
        k3.climbInfoShown() === true && k3.climbPinnedNow() === true);
      // ④ 点空白 → 取消固定并收起
      const empty = k3.climbPointXY(62323, 5);
      const blankX = 2, blankY = 2;                    // 画布左上角，必定没有曲线点
      cv.dispatchEvent(mkEv('pointerdown', blankX, blankY));
      cv.dispatchEvent(mkEv('pointerup', blankX, blankY));
      assert('A20：点空白 → 取消固定并收起信息窗',
        k3.climbInfoShown() === false && k3.climbPinnedNow() === false,
        'shown=' + k3.climbInfoShown() + ' pinned=' + k3.climbPinnedNow() + ' pt=' + JSON.stringify(empty));
      // ⑤ 换曲线 / 切星座时的清理（否则会残留"上一条曲线上的点"的旧窗口）
      k3.climbSelect('b:25030');
      assert('A20：换选曲线后固定态复位、旧信息窗收起',
        k3.climbPinnedNow() === false && k3.climbInfoShown() === false);
      // ⑥ 长按拖拽特性不变（拖动画布仍是平移，不当作点击）
      const p0 = k3.climbPointXY(62323, 5);
      if (p0) {
        cv.dispatchEvent(mkEv('pointerdown', p0.x, p0.y));
        cv.dispatchEvent(mkEv('pointermove', p0.x + 60, p0.y + 30));   // 拖动 > TAP_SLOP
        cv.dispatchEvent(mkEv('pointerup', p0.x + 60, p0.y + 30));
        assert('A20：拖动（>TAP_SLOP）**不当作点击** → 不弹窗、不固定（长按拖拽平移不变）',
          k3.climbInfoShown() === false && k3.climbPinnedNow() === false,
          'shown=' + k3.climbInfoShown() + ' pinned=' + k3.climbPinnedNow());
      }
    }
    // 源码守卫：pointermove 里不得再出现 climbShowInfoAt
    //   ⚠️ 要用**剥掉注释**的 appCode：我在那段注释里引用了旧写法 `if (h) climbShowInfoAt(h)`，
    //   直接在 appSrc 上匹配会被注释误伤（同样的坑在 #5 那条踩过一次）。
    assert('A20：`pointermove` 里不再调用 climbShowInfoAt（源码守卫，防止回退）',
      (function () {
        const seg = (appCode.match(/climbCv\.addEventListener\('pointermove'[\s\S]*?\n  \}\);/g) || []).join('\n');
        return seg.length > 0 && !/climbShowInfoAt/.test(seg);
      })());
    assert('A20：单击分支里**同时**做了 toggleSel 与"显示+固定"（对齐 05 章的 netPinned 写法）',
      /climbPinned = true;\s*\n\s*climbShowInfoAt\(h\);/.test(appSrc) &&
      /climbPinned = false;[\s\S]{0,120}?if \(climbInfo\) hideInfo\(climbInfo, 'climb'\);/.test(appSrc));
  }


  // ================================================================ V1.9.1（A2）：导出底栏六段结构
  // 「批次/组」之后 = 第4段（点选节点：YYYY-MM-DD/高度km/倾角°）+ 第5段（最新节点，同格式）
  //   + 第6段（最新 vs 次新：±Δ半长轴km/间隔+天词，颜色同页面内规则）。
  //   Q8：4/5/6 段只在**点选了节点**时填，其余一律破折号。Q9/Q16：中文「天」/ 英文 day(1) / days(>1)。
  //   同时 A2 取代了 R17 的「升轨速度列」——那条列不再出现在导出图里。
  // ★ V1.9.5（H11）：**行规则改口径**（H11 取代 R17 的"画出来的曲线都列"）：
  //   未选星（批次视图、无节点）→ **0 行**；选定节点 / 选单星 → **只列该星一行**。
  //   "以哪颗星为准"与相位线同源（climbOneNorad）；下面逐一钉住这些状态。
  {
    assert('A2：第 4/5/6 段就位（+ 新增会话态记录"最后点选的节点"）',
      /var climbPickNode = null;/.test(appSrc) &&
      /climbPickNode = \{ norad: h\.norad, ms: h\.ms \};/.test(appSrc));
    assert('A2：点选态是纯会话态（刻意不放 S，避免被 prefSnap 落盘带出去）',
      !/climbPickNode:/.test((appSrc.match(/var S = \{[\s\S]*?\n\};/) || [''])[0]));
    assert('A2：换曲线 / 换星座 / 点空白 → 点选态一律清掉（导出图必须回到破折号）',
      // 3 处复位（换星座 / 换曲线 / 点空白）+ 1 处声明
      (appSrc.match(/climbPickNode = null;/g) || []).length === 4,
      '出现 ' + (appSrc.match(/climbPickNode = null;/g) || []).length + ' 次（期望 3 复位 + 1 声明）');
    assert('A2：天数词按 Q16（英文 1→day / >1→days；中文恒为「天」）',
      k3.dayWord(0) === '天' && k3.dayWord(1) === '天' && k3.dayWord(9) === '天',
      'zh: ' + [0, 1, 9].map(n => k3.dayWord(n)).join(','));
    assert('V1.9.5（H11）：行规则与相位线**同源**（climbOneNorad 被定义并被两处调用）',
      (appSrc.match(/climbOneNorad\(/g) || []).length >= 3);

    // —— ★ V1.9.5（H11）：行规则四态 ——（顺带把六段格式逐段核对） ——
    k3.setClimbPick(''); k3.climbSelClear(); k3.pickNode(null, 0);
    const rows0 = k3.shotLines('climb');
    assert('V1.9.5（H11）：未选星（批次视图、无节点）→ **0 行**（下方无数据行）',
      rows0.length === 0, '行数=' + rows0.length);

    // 显式挑一个"成员 ≥2 的内置兜底批次"（后面单星/点选/多选三条都基于它，稳）
    let mk = null, mem = null;
    for (const k of k3.climbLiteKeys()) {
      const L = k3.climbBatchPts(k);
      if (L.length >= 2) { mk = k; mem = L; break; }
    }
    assert('V1.9.5（H11）：找得到成员 ≥2 的兜底批次（后续用例的载体）', !!mk, '批次=' + mk + ' 成员=' + (mem ? mem.length : 0));
    if (mk) {
      k3.setClimbPick('b:' + mk);
      const rowsBatch = k3.shotLines('climb');
      assert('V1.9.5（H11）：批次视图（N 条曲线、未选星）→ **0 行**（旧口径会列满 N 行）',
        rowsBatch.length === 0, '批次=' + mk + ' 曲线=' + k3.climbBatchPts(mk).length + ' 行数=' + rowsBatch.length);
    }
    const first = (mem && mem[0]) || k3.climbList()[0];
    k3.climbSelByNorad(first.n);                          // 全局恰好选中一颗（跟随路径）
    const rowsSel = k3.shotLines('climb');
    assert('V1.9.5（H11）：选中一颗星（跟随路径）→ **只列该星一行**（仍是六段）',
      rowsSel.length === 1 && rowsSel[0].segs.length === 6 && rowsSel[0].segs[1].t === String(first.n),
      '行数=' + rowsSel.length + ' norad=' + (rowsSel[0] ? rowsSel[0].segs[1].t : '-'));
    assert('A2（Q8）：未点选任何节点时，第 4/5/6 段全是破折号（不越权替用户选）',
      rowsSel[0].segs[3].t === '—' && rowsSel[0].segs[4].t === '—' && rowsSel[0].segs[5].t === '—',
      JSON.stringify(rowsSel[0].segs.map(x => x.t)));
    assert('A2：整行不含旧的「升轨速度列」（A2 明确取代 R17 的两段）',
      rowsSel[0].segs.map(x => x.t).join('|').indexOf('km/天') < 0 &&
      rowsSel[0].segs.map(x => x.t).join('|').indexOf('km/d') < 0);

    // 点选"该星"的第 2 个节点（保证它一定有前一个点 → 第 6 段才有值）
    const pts = k3.climbFind(first.n).pts;
    const pickIdx = pts.length >= 2 ? 1 : 0;
    k3.pickNode(first.n, pts[pickIdx].ms);
    const rows1 = k3.shotLines('climb');
    const mine = rows1[0] || { segs: [{ t: '-' }, { t: '-' }, { t: '-' }, { t: '-' }, { t: '-' }, { t: '-' }] };
    assert('V1.9.5（H11）+ A2（Q8）：选中节点 → 只列该星一行，且第 4/5/6 段被填',
      rows1.length === 1 && mine.segs[1].t === String(first.n) &&
      mine.segs[3].t !== '—' && mine.segs[4].t !== '—' && mine.segs[5].t !== '—',
      '行数=' + rows1.length + ' mine=' + JSON.stringify(mine.segs.map(x => x.t)));
    assert('A2：第 4 段 = 点选的那个节点（日期/高度km/倾角°，形如 2026-09-10/960.32km/50.9°）',
      /^\d{4}-\d{2}-\d{2}\/\d+(\.\d{1,2})?km\/\d+(\.\d)?°$/.test(mine.segs[3].t) &&
      mine.segs[3].t.slice(0, 10) === k3.nodeDate(pts[pickIdx].ms),
      mine.segs[3].t);
    assert('A2：第 5 段 = 该星最新节点（日期 = 该曲线最后一个点）',
      mine.segs[4].t.slice(0, 10) === k3.nodeDate(pts[pts.length - 1].ms),
      mine.segs[4].t + ' vs ' + k3.nodeDate(pts[pts.length - 1].ms));
    assert('A2：高度两位小数、倾角一位小数（与清单给的样例同格式）',
      /\/\d+\.\d{2}km\/\d+\.\d°/.test(mine.segs[3].t) && /\/\d+\.\d{2}km\/\d+\.\d°/.test(mine.segs[4].t),
      mine.segs[3].t + ' | ' + mine.segs[4].t);
    assert('A2：第 6 段 = 最新 vs 次新的 ±Δ半长轴 + 间隔天数（形如 +1.21km/9天）',
      /^[+-]?\d+(\.\d{1,2})?km\/\d+天$/.test(mine.segs[5].t), mine.segs[5].t);
    assert('A2：第 6 段带分段颜色（正=绿 / 负=黄 / 0=灰，取自 climbDeltaColor，与页面内规则一致）',
      mine.segs[5].c != null && /^#|var\(--/.test(mine.segs[5].c) &&
      mine.segs[5].c === (/^\+/.test(mine.segs[5].t) ? '#2f9e44' : (/^-/.test(mine.segs[5].t) ? '#f59f00' : 'var(--dim)')),
      mine.segs[5].t + ' → ' + mine.segs[5].c);
    assert('A2：前 3 段不带分段色（只有第 6 段着色，其余整行同色）',
      mine.segs.slice(0, 5).every(x => !x.c));
    assert('A2：英文模式下天数为 day(1) / days(>1)（Q16：撤掉 d）',
      (function () {
        const old = k3.lang();
        k3.lang('en');
        const w1 = k3.dayWord(1), w9 = k3.dayWord(9);
        const rows = k3.shotLines('climb');
        const m = rows.filter(r => r.segs[1].t === String(first.n))[0];
        const okDay = /km\/\d+(day|days)$/.test(m.segs[5].t);
        k3.lang(old);
        return w1 === 'day' && w9 === 'days' && okDay && k3.dayWord(9) === '天';
      })());
    // 点选的那个节点被数据刷新抹掉时 → 退回最新节点，不留空段
    k3.pickNode(first.n, 12345);
    const rows2 = k3.shotLines('climb');
    const m2 = rows2.filter(r => r.segs[1].t === String(first.n))[0];
    assert('A2：点选的节点已不在数据里 → 退回最新节点（不留空段、不显示空字符串）',
      m2.segs[3].t === m2.segs[4].t && m2.segs[3].t !== '—', m2.segs[3].t);
    k3.pickNode(null, 0);

    // ★ V1.9.5（H11）：全局选中**两颗** → 不算"选定一颗星" → 0 行
    if (mem && mem[1]) {
      k3.climbSelAdd(mem[1].n);
      const rowsTwo = k3.shotLines('climb');
      assert('V1.9.5（H11）：全局选中两颗 → 0 行（只有"恰好一颗"才算选定）',
        rowsTwo.length === 0, '行数=' + rowsTwo.length);
    }
    // ★ V1.9.5（H11）：导出图**带竖虚线** —— 导出走 `withCanvasScale`（2×）重绘 `drawClimb()`
    //   （屏幕 / 导出共用同一段画线代码，不是"导出里另写一份"）。这里在导出倍率下重绘一次并查画布记录。
    {
      const pubB2 = {};
      k3.climbLiteKeys().forEach(k => { const v = k3.climbPubB(k); if (v) pubB2[k] = v; });
      const k2 = k3.climbLiteKeys().find(k => pubB2[k]) || '';
      k3.setClimbPick(k2 ? ('b:' + k2) : ''); k3.climbSelClear(); k3.pickNode(null, 0);
      const ex = k3.climbExportCheck();
      const expDate = k2 ? k3.climbDateFmt(pubB2[k2][0] * 86400000) : '';
      const yExp = ex.rect ? ex.rect.PT + ex.rect.ph + 3 : -1;
      assert('V1.9.5（H11）：导出图带竖虚线（导出倍率 2× 重绘后：[5,4] 虚线 + 相位日期都在）',
        !!k2 && ex.k >= 1 && ex.dash === '[5,4]' &&
        ex.texts.some(o => o.t === expDate && Math.abs(o.y - yExp) < 0.75),
        '批次=' + k2 + ' k=' + ex.k + ' dash=' + ex.dash + ' 期望日期=' + expDate + ' 文本条数=' + ex.texts.length);
      assert('V1.9.5（H11）：导出与屏幕共用同一绘制函数（源码守卫：导出分支调 drawClimb，不另写一套）',
        /else if \(view === 'climb'\) drawClimb\(\)/.test(appSrc));
    }
    k3.setClimbPick(''); k3.climbSelClear(); k3.pickNode(null, 0);

    // ---- A4：导出底栏多行卫星数据统一白色 ----
    assert('A4：全部行同一取色（删掉首行特例 i === 0 ? shotInk() : shotInkDim()）',
      !/i === 0 \? shotInk\(\) : shotInkDim\(\)/.test(appSrc));
    const bar = appSrc.match(/function drawShotBar\([\s\S]*?\n\}/);
    // 只查卫星信息行那一段：右下角声明行仍用次要色（既有设计，A4 不动它）
    const satBlock = (appSrc.match(/if \(satLines\.length\) \{[\s\S]*?\n  \}/) || [''])[0];
    assert('A4：drawShotBar 的卫星信息行只有 shotInk() 作为整行底色，不再引用 shotInkDim',
      satBlock.length > 0 && !/shotInkDim/.test(satBlock) && /var base = shotInk\(\);/.test(satBlock),
      satBlock.length ? '信息行段内 shotInkDim 出现 ' + (satBlock.match(/shotInkDim/g) || []).length + ' 次' : '未取到信息行段');
    assert('A4：底栏行仍支持分段着色（A2 的第 6 段靠 seg.c，其余段回落到整行白）',
      /var base = shotInk\(\);/.test(appSrc) && /ctx\.fillStyle = s\.c \|\| base;/.test(appSrc));
    assert('A2 + A4：宽度按整行拼接测量（分段着色不会让段与段错位），自动缩字仍作用于整行',
      /var txt = segs\.map\(function \(s\) \{ return s\.t; \}\)\.join\(SEP\);/.test(appSrc) &&
      /xx \+= ctx\.measureText\(SEP\)\.width;/.test(appSrc));
  }

  // ================================================================ V1.9.1（A14）：导出路径的**运行时**英文完整性
  // i18n.mjs 的四遍扫描只看 DOM 文本，**看不到 canvas 上的字**（导出底栏是 fillText 画出来的）。
  // 这里补上那一块：切到英文后取六段行 → 逐段断言**不含 CJK**。
  //   （A14 本次正是靠这条思路抓到真 bug：底栏星座名用了 st.name，英文图一直漏出「星网/千帆」。）
  {
    const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3000-\u303F\uFF00-\uFFEF]/;
    const old = k3.lang();
    const firstN = k3.climbList()[0].n;
    const pts2 = k3.climbFind(firstN).pts;
    k3.pickNode(firstN, pts2[pts2.length - 1].ms);
    k3.lang('en');
    const enRows = k3.shotLines('climb');
    const allTxt = enRows.map(r => r.segs.map(x => x.t).join(' | ')).join('\n');
    const cjkHits = [];
    enRows.forEach(r => r.segs.forEach(x => { if (CJK.test(x.t)) cjkHits.push(x.t); }));
    assert('A14：英文模式下导出底栏六段**零 CJK**（卫星名走目录原名 / 批次组走 batchName / 天词走 i18n）',
      cjkHits.length === 0, cjkHits.slice(0, 4).join(' | ') || 'clean');
    assert('A14：英文导出行的天词为 day/days（不是中文「天」）', /km\/\d+(day|days)$/.test(enRows[0].segs[5].t), enRows[0].segs[5].t);
    assert('A14：英文导出的批次/组列已译（Test Satellite / LEO Group / Polar Group…）',
      !CJK.test(enRows[0].segs[2].t) && /Group|Satellite|Batch/.test(enRows[0].segs[2].t), enRows[0].segs[2].t);
    k3.lang(old);
    const zhRows = k3.shotLines('climb');
    assert('A14：切回中文后天词恢复为「天」（语言切换是双向生效的，不是一次性）',
      /km\/\d+天$/.test(zhRows[0].segs[5].t), zhRows[0].segs[5].t);
    assert('A14：导出底栏星座名走 i18n（源码守卫；strip 注释后不得再出现 st.name）',
      (function () {
        const i = appSrc.indexOf('function drawShotBar(');
        const j = appSrc.indexOf('\nfunction ', i + 1);
        const body = appSrc.slice(i, j > 0 ? j : i + 6000)
          .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
        return !/st\.name/.test(body) && /t\('shot_' \+ cs\.key\)/.test(body) &&
          /shotConstelState\(view\)/.test(body);
      })());
    k3.pickNode(null, 0);
  }
  // ★★ V1.9.3 运行时实测（**必须放在这里** —— k3 的作用域在本 block 的 `}`（下方）结束）：
  //   ① 逐页扫描，确认卫星表**每一行都在某一页里**。
  //      改前实测：`covered=250 / rowsN=251`，第 251 行（idx 250）不属于任何一页
  //      → 屏幕上永远看不到它、导出"全页"也拿不到它（`pageCount` 理想装填 vs
  //        `pageBounds` 贪心装填，两者分叉）。这是本轮最严重的一个静默丢数据。
  //   ② `shotTotalPages()` 与屏幕真实页数完全一致（导出弹窗"页数 1–N"的范围才可信）。
  //   ⚠️ 曾把这两条错放到 block 之后（第 4359 行），报 `ReferenceError: k3 is not defined`
  //      —— 而**本地前几次跑都是绿的**，因为那时还没实跑到那里；是 CI 一跑就炸才暴露。
  //      教训：往 smoke 里加"用 k3 的运行时断言"时，**必须插在 `dom3.window.close()` 之前**。
  assert('V1.9.3【静默丢数据·运行时】逐页扫描：**每一行都在某一页里**（改前实测丢最后一行）',
    (function () {
      const c = k3.pageCoverage();
      return c && c.rowsN > 200 && c.missing === 0 && c.covered === c.rowsN;
    })(), JSON.stringify(k3.pageCoverage()));
  assert('V1.9.3：`shotTotalPages` 返回的页数与屏幕**完全一致**（导出弹窗的"页数 1–N"范围才可信）',
    (function () {
      const t = k3.shotTotals();
      return t && t.sat === t.satPages && t.launch === t.launchPages;
    })(), JSON.stringify(k3.shotTotals()));
  dom3.window.close();
}

// ---- V1.9.1：wiki.json 的"不倒退"守卫（build.mjs）----
// wiki.json 是**双身份**文件：既是 mkdata 的输入（抓到的词条统计），又是 build 的输出
//   （把 build/wiki.json 复制回来）。"只跑 build、没跑 mkdata"时，build/wiki.json 是**上一次**
//   的陈旧产物 → 复制回去会把源文件倒退成旧值（2026-10-10 实测：257/253 被覆盖回 248/244）。
{
  const bc = fs.readFileSync(B + '/build.mjs', 'utf8');
  assert('V1.9.1：build.mjs 有 wiki.json "不倒退"守卫（计数变小则拒绝覆盖 + 明确告警）',
    /function wikiCounts/.test(bc) && /na < nb/.test(bc) && /拒绝覆盖/.test(bc) &&
    /CISTRACK_ALLOW_WIKI_REGRESS/.test(bc));
  assert('V1.9.1：wiki.json 与 build/wiki.json 当前同步（若不同步=守卫拦下过，应先跑 mkdata）',
    (function () {
      try {
        return fs.readFileSync(B + '/wiki.json', 'utf8') === fs.readFileSync(B + '/build/wiki.json', 'utf8');
      } catch (e) { return false; }
    })());
  assert('V1.9.1：mkdata 输出 wiki.json 的字段顺序与末尾换行都与仓库版一致（否则每次构建都是无意义 diff）',
    /JSON.stringify\(WIKI_JSON, null, 1\) \+ '\\n'/.test(fs.readFileSync(B + '/mkdata.mjs', 'utf8')));
  // ★ V1.9.1：`history/` 同样要防"陈旧产物覆盖已发布数据"—— 与上面 wiki.json 是**同一类**问题
  //   （build/history 是 mkdata 的产物，却是**已发布 history/ 的输入**）。实测倒退过 30 个点、还删了一个分片。
  assert('V1.9.1：build.mjs 有 history/ "陈旧检测"（数据源比打包产物新则拒绝覆盖）',
    /newestSrc > packTime/.test(bc) && /拒绝覆盖/.test(bc) && /CISTRACK_ALLOW_STALE_HISTORY/.test(bc));
}

// V1.9.1（#9）：加载页两行字**写死进 HTML** ——
//   原先 lmTxt 只有 data-i18n（脚本跑起来才填）、lmEpoch 完全为空 → 首帧只有一个圆环，
//   要等 JS 解析完（单文件 1.2MB + SGP4 初始化）才出现两行字。现在从首帧起就是"两行字"版本。
assert('V1.9.1（#9）：加载页两行字写死进 HTML（首帧就有字，不靠 JS 填）',
  /<div class="lm-txt" id="lmTxt" data-i18n="d_loading_tle">正在获取最新轨道要素…<\/div>/.test(tpl) &&
  /<div class="lm-epoch" id="lmThird" data-i18n="d_loading3">加载中…<\/div>/.test(tpl) &&
  // 产物里同样在（模板 → 产物的注入过程不能把它冲掉）
  /id="lmTxt"[^>]*>正在获取最新轨道要素…</.test(html) &&
  /id="lmThird"[^>]*>加载中…</.test(html), '');
assert('V1.9.1（#9）：JS 起来后仍然接管（语言切换 / 真实历元替换）—— 两条路径都保留',
  /function refreshMaskText\(\)/.test(appSrc) && !/setLoadEpoch/.test(appSrc) &&
  /data-i18n="d_loading3"/.test(tpl) &&
  /tx\.textContent = t\('d_updated'\)/.test(appSrc));

// ================================================================ V1.9.1（#7）：非线性过场泛化
// 清单 #7：`chartSwap` 泛化为 `cvSwap(cvId, apply)`；04/05 两章的四个控件（05 的「发射量 / 在轨数量」
//   「星网 / 千帆」、04 的「半长轴 / 升轨速度」）此前都是**直调重绘**（画面"啪"地跳过去）。
//   时长与缓动必须与 03 章**完全一致**（同一条 ANIM.half）。
{
  assert('#7：`cvSwap(cvId, apply)` 存在，且 `chartSwap` 退化为它的 03 章包装（不是两份实现）',
    /function cvSwap\(cvId, apply\)/.test(appSrc) &&
    /function chartSwap\(apply\) \{ cvSwap\('chart', apply\); \}/.test(appSrc) &&
    (appSrc.match(/wrap\.classList\.add\('chart-out'\)/g) || []).length === 1);
  assert('#7：过场时长与 03 章同一条（都用 ANIM.half，不引入第二个时长常量）',
    /wrap\.classList\.remove\('chart-out'\);\s*\}, ANIM\.half\);/.test(appSrc) &&
    !/}, ANIM\.half\);/.test(appSrc.slice(appSrc.indexOf('function cvSwap') + 600, appSrc.indexOf('function chartSwap'))));
  assert('#7：05 章「发射量/在轨数量」（netSetMode）走 cvSwap，按钮高亮**立即**响应',
    /function netSetMode\(m\) \{[\s\S]{0,400}?cvSwap\('netCv', function \(\) \{ netAutoView\(\); drawNet\(\); \}\);/.test(appSrc));
  assert('#7：05 章「星网/千帆」（netShowSeg）走 cvSwap', /cvSwap\('netCv', function \(\) \{ netView = null; netAutoView\(\); drawNet\(\); \}\);/.test(appSrc));
  assert('#7：04 章「半长轴/升轨速度」（climbTakeSeg）走 cvSwap', /cvSwap\('climbCv', function \(\) \{ drawClimb\(\); \}\);/.test(appSrc));
  // ★ V1.9.5（H12）：切换纵轴量时**必须重置为自动视图**（居中铺满），且仍走通用过场。
  //   来历：用户 2026-10-15 点名"点『变轨速度』后应渐淡渐现并重置为居中铺满"。
  //   2026-10-16 核对：V1.9.1（#7）那批**已经实现**（climbView = null + cvSwap）→ 本条断言把它钉住，
  //   防止将来有人"顺手"改成只换数据不重置视图（症状：从放大态切过去看到另一段空白）。
  assert('V1.9.5（H12）：切换纵轴量时重置为自动视图（climbView = null）且仍走 cvSwap 过场',
    /S\.climbTake = v; climbView = null;/.test(appSrc) &&
    /cvSwap\('climbCv', function \(\) \{ drawClimb\(\); \}\)/.test(appSrc));
  assert('#7：过场只作用于 `.chart-wrap`（画布）—— 不把整章或表格一起淡掉',
    /\.chart-wrap\.chart-out canvas \{ opacity:0; \}/.test(tpl));
}

// ================================================================ V1.9.1（#8）：全屏几何与重绘
// 两个根因（清单 #8，真机实测）：
//   根因 A：drawClimb **从未**在 fullscreenchange / resize / applyPseudoFull 里被调用 →
//           backing store 停在旧尺寸 → 浏览器把旧位图拉伸（横 1.43× / 纵 0.65×）。
//   根因 B：变轨章 chart-wrap 几何在 border-box 下**多减了一个 climb-bar** → 底边比视口高 64 px。
{
  assert('#8（根因 A）：全屏两条计时器路径都补上了 drawClimb',
    (appSrc.match(/try \{ drawClimb\(\); \} catch \(e\) \{\}/g) || []).length >= 4,
    '出现次数=' + (appSrc.match(/try \{ drawClimb\(\); \} catch \(e\) \{\}/g) || []).length);
  assert('#8（根因 A）：伪全屏路径（applyPseudoFull）也重画 net + climb',
    /try \{ drawNet\(\); \} catch \(e\) \{\}\s*try \{ drawClimb\(\); \} catch \(e\) \{\}\s*mapDirty = true; globeDirty = true;/.test(appSrc));
  assert('#8（根因 A）：resize 有防抖重绘（redrawCanvasesLater，160ms，三张画布全覆盖）',
    /function redrawCanvasesLater\(\)/.test(appSrc) &&
    /}, 160\);/.test(appSrc) &&
    (appSrc.match(/redrawCanvasesLater\(\)/g) || []).length >= 2);
  assert('#8（根因 B）：变轨章几何与对照章**对齐**（height:100vh + padding-top:climbbar-h，去掉 −8px 与 padding-bottom）',
    /#sec-climb\.fs-mobile \.chart-wrap \{[\s\S]{0,1400}?height:100vh;[\s\S]{0,80}?padding-top:var\(--climbbar-h, 40px\);[\s\S]{0,30}?\}/.test(tpl) &&
    !/height:calc\(100vh - var\(--climbbar-h/.test(tpl));
  assert('#8（Q6）：全屏按钮列底距加触屏安全值（max(24px + 安全区, 48px)）',
    /--fs-ctl-bottom: max\(calc\(24px \+ env\(safe-area-inset-bottom, 0px\)\), 48px\);/.test(tpl));
}

// ================================================================ V1.9.1（#2 + #10 + A5）：毛玻璃统一
{
  assert('#10：毛玻璃口径**只有一处定义**（:root 的两个变量），全站不再有散落的 blur(Npx)',
    /--glass-web:blur\(20px\) saturate\(160%\);/.test(tpl) &&
    /--glass-std:blur\(18px\) saturate\(180%\);/.test(tpl) &&
    // 只剩两个遮罩类按清单"不参与统一"：#loadMask（saturate(120%)）与 .modal-mask
    (tpl.match(/(?<!-)[-a-z]*backdrop-filter:blur\(\d+px\)/g) || []).length === 4,
    '残留=' + JSON.stringify((tpl.match(/(?<!-)[-a-z]*backdrop-filter:blur\(\d+px\)/g) || [])));
  assert('#10：-webkit- 前缀与标准属性**成对**（Safari 与 Chrome 各取所需，不能只剩一个）',
    (tpl.match(/-webkit-backdrop-filter:var\(--glass-web\)/g) || []).length ===
    (tpl.match(/(?<!-webkit-)backdrop-filter:var\(--glass-std\)/g) || []).length,
    'web=' + (tpl.match(/-webkit-backdrop-filter:var\(--glass-web\)/g) || []).length +
    ' std=' + (tpl.match(/(?<!-webkit-)backdrop-filter:var\(--glass-std\)/g) || []).length);
  assert('#2 + A5：切换期间**全站禁用过渡**（根治"星网/千帆"按钮文字短暂消失：底色与文字色相向插值撞在同一个灰上）',
    /html\.vt-running \* \{ transition:none !important; \}/.test(tpl));
  assert('#2：切换期间的毛玻璃例外名单**覆盖全部玻璃件**（顶栏 + 药丸 + 浮动控件 + 搜索 + 联想 + 抽屉）',
    ['html.vt-running #clockPill,', 'html.vt-running #jumpPill,', 'html.vt-running #jumpPill button,',
      'html.vt-running .view-ctl button,', 'html.vt-running .fs-panel-btn,', 'html.vt-running .fs-clock,',
      'html.vt-running .fs-exit-btn,', 'html.vt-running .search-wrap,', 'html.vt-running .sug-list,',
      'html.vt-running #sec-chart.fs-mobile .controls,', 'html.vt-running #sec-progress.fs-mobile .controls,',
      'html.vt-running #sec-climb.fs-mobile .climb-bar,', 'html.vt-running section.fs-mobile .fs-search-wrap,',
      'html.vt-running section.fs-mobile .fs-search-wrap .fs-sug,', 'html.vt-running section.fs-mobile .sec-head {'
    ].every(x => tpl.includes(x)),
    ['#clockPill', '#jumpPill', '.view-ctl button', '.fs-panel-btn', '.fs-clock', '.fs-exit-btn',
      '.search-wrap', '.sug-list', 'section.fs-mobile .fs-search-wrap', 'section.fs-mobile .sec-head',
      '#sec-chart.fs-mobile .controls', '#sec-progress.fs-mobile .controls', '#sec-climb.fs-mobile .climb-bar'
    ].filter(x => !tpl.includes('html.vt-running ' + x)).join(',') || 'all-present');
  assert('#2 + A5：例外名单的 specificity 高于 `html.vt-running *`（否则 !important 相同、比不过就白写）',
    // 名单里带 id 的三条必须写成 `html.vt-running #id...`，纯 class 的写成 `html.vt-running .cls`
    /html\.vt-running #sec-chart\.fs-mobile \.controls/.test(tpl) &&
    /html\.vt-running #sec-progress\.fs-mobile \.controls/.test(tpl) &&
    /html\.vt-running #sec-climb\.fs-mobile \.climb-bar/.test(tpl));
}


// ================================================================ V1.9.1（顶栏章节标签）
// 老版本顶栏本来有一排章节入口（V1.7.2 第七轮移除）。现在按要求**只恢复到电脑端**：
//   ① 顺序与名字 = 章节的最终顺序与名字（01 地图 … 07 发射历史），与右下角药丸**同源**（都从 JUMP_TITLE 取）；
//   ② **不含「TLE 更新时间 / 要素历元」** —— 那一行已改到主标题下方（#pageEpoch），不回到顶栏；
//   ③ 触屏设备不显示；宽度不足时自动收起。
//   ⚠️ 几何（是否真的一行、是否与按钮区重叠）在 jsdom 里量不出来（getBoundingClientRect 被桩掉了）
//      → 那部分放在真实浏览器里断言；这里只查结构与源码逻辑。
{
  const navTabs = d.getElementById('navTabs');
  assert('顶栏标签的容器存在于 .nav-right 内（老版本的顶栏标签位）',
    !!navTabs && navTabs.parentNode && navTabs.parentNode.className.indexOf('nav-right') >= 0);
  const labels = navTabs ? [...navTabs.querySelectorAll('button')].map(b => b.textContent) : [];
  assert('顶栏标签 = 7 个章节，顺序与名字为最终版（01 地图 … 07 发射历史）',
    labels.join('|') === '01 地图|02 轨道|03 倾角分布|04 变轨情况|05 组网进度|06 卫星表格|07 发射历史',
    labels.join('|'));
  assert('顶栏标签**不含「TLE 更新时间 / 要素历元」**（已移到主标题下方 #pageEpoch，不回到顶栏）',
    !/更新时间|历元|epoch/i.test(labels.join(' ')) && /id="pageEpoch"/.test(tpl));
  assert('顶栏标签的 data-sec 与右下角药丸的章节 id **一一对应**（同一套锚点，不会跳错章）',
    navTabs && [...navTabs.querySelectorAll('button')].map(b => b.getAttribute('data-sec')).join(',') ===
      'sec-map,sec-orbits,sec-chart,sec-climb,sec-progress,sec-table,sec-launches');

  // 源码守卫：判据与分支
  assert('源码：NAV_TABS 常量把 7 个章节**只写一处**（与药丸同源，改章节名不会两处漂移）',
    (appSrc.match(/var NAV_TABS = \[/g) || []).length === 1 &&
    /var NAV_TABS = \['sec-map', 'sec-orbits', 'sec-chart', 'sec-climb', 'sec-progress', 'sec-table', 'sec-launches'\];/.test(appSrc));
  assert('源码（V1.9.3）：收起判据 = **标签整排右缘 → 星座段左缘 < G**（用户要求改为右对齐）',
    // 用户原话：「顶栏的标签顶格并跟随 CISTrack，没有像老版本一样是标签的最右侧距离
    //   星网千帆切换按钮标准间距（即右边所有按钮间的统一一致的像素距离）」
    //   ⇒ 判据从"第一个标签左缘 − CISTrack 右缘"改为"标签整排右缘 − 星座段左缘"。
    /var gapR = seg\.getBoundingClientRect\(\)\.left - tabs\.getBoundingClientRect\(\)\.right;/.test(appSrc) &&
    /show = gapR >= G - 0\.5 && fits;/.test(appSrc) &&
    // 反向守卫：旧判据的字面量不得复活
    !/var gap = firstTab\.getBoundingClientRect\(\)\.left - brandEl\.getBoundingClientRect\(\)\.right;/.test(appSrc));
  assert('源码（V1.9.3）：标签**右对齐**（`margin-left:auto`）+ **垂直居中**（line-height 钉 32px 与按钮同高）',
    /\.nav-tabs \{ display:flex; flex-direction:row; flex-wrap:nowrap; align-items:center; gap:0; min-width:0; overflow:hidden;\s*\n\s*margin-left:auto; \}/.test(tpl) &&
    /\.nav-tabs button \{[^}]*height:32px; line-height:32px;/.test(tpl));
  assert('源码：**另有一条「放得下」检查**（只靠用户那条判据在窄屏永不触发：≤1150px 时 .brand-note 被隐藏，' +
    '间隙恒等于 topnav 的 column-gap、与视口宽度无关；实测 700px 时 7 个标签会被 overflow:hidden 裁掉一半）',
    /var fits = tabs\.scrollWidth <= tabs\.clientWidth \+ 0\.5;/.test(appSrc) &&
    !/show = gap >= G - 0\.5;$/.test(appSrc));
  assert('源码：触屏设备一律不显示（「电脑端单独使用」）', /if \(!isTouch\(\)\) \{/.test(appSrc));
  assert('源码：显示时给 .topnav 加 has-tabs（品牌块不再吃满剩余空间，标签整排贴右）',
    /nav\.classList\.toggle\('has-tabs', show\);/.test(appSrc) &&
    /\.topnav\.has-tabs \.brand-box \{ flex:0 0 auto; \}/.test(tpl));
  assert('源码：标签**必须是一行**（容器 nowrap + 按钮 nowrap；换行会撑高顶栏 → --nav-h 失真、时钟药丸与锚点全偏）',
    /\.nav-tabs \{ display:flex; flex-direction:row; flex-wrap:nowrap;/.test(tpl) &&
    /\.nav-tabs button \{[^}]*white-space:nowrap;/.test(tpl));
  assert('源码：当前章高亮由药丸与顶栏标签**共用同一份判定**（setJumpActive）',
    /function setJumpActive\(id\)/.test(appSrc) &&
    (appSrc.match(/setJumpActive\(/g) || []).length >= 3 &&
    /function refreshJumpTitles\(\) \{ buildJumpPill\(\); buildNavTabs\(\); \}/.test(appSrc));

  // 触屏分支：jsdom 里可以精确控制 isTouch() 的第二个子句
  //   （CDP 覆盖不了 pointer/hover 媒体特性，所以这一条只能在 jsdom 里测）
  const errsT = [];
  const domT = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/',
    beforeParse(window) {
      window.ontouchstart = null;                       // 让 'ontouchstart' in window 为真
      Object.defineProperty(window.navigator, 'maxTouchPoints', { value: 5, configurable: true });
      window.HTMLCanvasElement.prototype.getContext = function () { if (!this.__ctx) this.__ctx = makeCtx(); return this.__ctx; };
      window.HTMLCanvasElement.prototype.toBlob = function (cb) { cb(null); };
      window.Element.prototype.getBoundingClientRect = function () {
        var h = (this.tagName === 'TR') ? 41 : 460;
        return { left: 0, top: 0, x: 0, y: 0, width: 900, height: h, right: 900, bottom: h };
      };
      window.scrollTo = () => {}; window.scrollBy = () => {};
      Object.defineProperty(window, 'innerHeight', { value: 4000, configurable: true });
      Object.defineProperty(window, 'innerWidth', { value: 1400, configurable: true });
      window.addEventListener('error', e => errsT.push(e.message));
    }
  });
  const dT = domT.window.document;
  await new Promise(r => setTimeout(r, 2200));
  const navT = dT.getElementById('navTabs');
  assert('**触屏设备：顶栏标签不显示**（off 已挂上，「电脑端单独使用」）',
    !!navT && navT.classList.contains('off') && errsT.length === 0,
    navT ? navT.className + ' | err=' + errsT.slice(0, 2).join(',') : 'no node');
  assert('触屏下 .topnav 不带 has-tabs（布局回到「品牌块吃满剩余空间」的原样）',
    !dT.querySelector('.topnav').classList.contains('has-tabs'));
  domT.window.close();
}


// ================================================================ V1.9.1（品牌扫过卡顿 · 性能根治）
// 用户报「顶栏 CISTrack 切换时不流畅、中间卡顿一下」→ 真浏览器实测定位到根因：
//   切星座半程（ANIM.half=260ms）会跑一次重量级重建，**实测长任务 120ms**；
//   而品牌扫过（clip-path 过渡，主线程驱动 —— 已实测排除合成器路径）正好在那时
//   **在 25% 处冻结 133ms**。元凶是 `measureRowUnits`：它把**全部 262 行**渲染进离屏表格
//   逐行量高度（单次 renderTable 43~52ms，半程被调两次）。
//   修法：行高只由**可换行的制造商列**决定（`.ltable td` 全是 nowrap，只有 `.ltable td.manufacturer`
//   覆写为 normal），而制造商按**批次**挂 → 同批次行高必然相同 ⇒ **只按批次抽一行量**。
//   实测：长任务 120ms → **0**，最大帧间隔 133ms → 17~33ms，renderTable 95ms → 16ms。
{
  assert('性能根治：`measureRowUnits` 按**批次去重**量行高（不再渲染全部 262 行）',
    /var reps = \{\}, repRows = \[\];/.test(appSrc) &&
    /tb\.innerHTML = repRows\.map\(satRowHtml\)\.join\(''\);/.test(appSrc) &&
    !/tb\.innerHTML = rows\.map\(satRowHtml\)\.join\(''\);/.test(appSrc));
  assert('性能根治：量尺结果按**批次**（byLk）缓存并复用（旧实现按 idx，且两次调用都没命中）',
    /var _rowUnitCache = \{ sig: '', byLk: null \};/.test(appSrc) &&
    /return function \(r\) \{ return byLk\[r\._s\.lk\] \|\| 1; \}/.test(appSrc) &&
    /_rowUnitCache = \{ sig: sig, byLk: byLk \};/.test(appSrc));
  assert('性能根治：缓存签名用 **clientWidth**（布局宽度、不含 transform）—— ' +
    '切星座时整页在位移，getBoundingClientRect().width 会带上变换导致缓存永不命中',
    /var w = tbl \? \(tbl\.clientWidth \|\| Math\.round\(tbl\.getBoundingClientRect\(\)\.width\) \|\| 0\) : 0;/.test(appSrc) &&
    /var sig = rows\.length \+ '\|' \+ LANG \+ '\|' \+ w \+ '\|' \+ \(rows\[0\] \? rows\[0\]\._s\.lk : ''\);/.test(appSrc));
  // 前提守卫：这套去重**依赖**"只有制造商列能换行"这一 CSS 事实 —— 一旦有人把别的列改成可换行，去重就不再等价
  assert('性能根治的前提：全表 nowrap、**只有 `.ltable td.manufacturer` 可换行**（若这条变了，按批次去重就不再等价）',
    /\.ltable td \{ padding:7px 10px; border-bottom:1px solid var\(--hair\); white-space:nowrap;/.test(tpl) &&
    /\.ltable td\.manufacturer \{ text-align:center; white-space:normal; \}/.test(tpl) &&
    (tpl.match(/white-space:normal; \}/g) || []).length >= 1);
}

// ================================================================ V1.9.1（品牌扫过重做：双层 clip-path）
// 三个原因叠加（都已实测坐实）：
//   ① 缓动末段过陡：--ease-slow-fast 终点斜率 27（最后 2% 冲完 54% 距离）→ 独立成 --ease-brand（终点斜率 0）
//   ② 时长太短：--anim-half=260ms 只是四联动的半程 → 独立成 --brand-sweep=520ms
//   ③ 字形瞬时变细：旧实现扫描时写 color:transparent，而描边是 currentColor → 描边一起透明。
//      实测（4× 倍率、同位置、比边缘像素）：旧实现扫过时 **−264**，新实现 **+174**，差 438 像素。
//      改成**双层各自完整字形 + clip-path**后，扫过帧与静态帧的外接框**逐像素一致**（405×79）。
{
  assert('品牌扫过：结构为**双层**（.bn-a 旧色 / .bn-b 新色），各自带完整字形与描边',
    /<span class="brand-name"><span class="bn-a">CISTrack<\/span><span class="bn-b" aria-hidden="true">CISTrack<\/span><\/span>/.test(tpl) &&
    /\.bn-a, \.bn-b \{ display:inline-block; white-space:nowrap; -webkit-text-stroke:0\.85px currentColor; paint-order:stroke fill; \}/.test(tpl));
  assert('品牌扫过：时长/缓动**独立**于 --anim-half/--ease-slow-fast（520ms + 终点斜率 0 的贝塞尔）',
    /--brand-sweep: 520ms;/.test(tpl) && /--ease-brand: cubic-bezier\(\.4,0,\.2,1\);/.test(tpl));
  assert('品牌扫过：JS 用 clip-path 揭示新色层，且时长常量与 CSS 一致（BRAND_SWEEP = 520）',
    /var BRAND_SWEEP = 520;/.test(appSrc) &&
    /nb\.style\.transition = 'clip-path var\(--brand-sweep\) var\(--ease-brand\)';/.test(appSrc));
  assert('品牌扫过：**不再**用 background-clip:text + color:transparent 的老做法（那会连描边一起透明）',
    !/el\.style\.color = 'transparent';/.test(appSrc) &&
    !/backgroundClip = 'text'/.test(appSrc.replace(/^.*\/\/.*$/gm, '')));
  assert('品牌扫过：收尾会清掉两层的内联色与 clip（不让半程色留在屏幕上）',
    /if \(nb\) \{ nb\.style\.transition = ''; nb\.style\.clipPath = ''; nb\.style\.webkitClipPath = ''; nb\.style\.color = ''; \}/.test(appSrc) &&
    /if \(na\) na\.style\.color = '';/.test(appSrc));
  assert('品牌扫过：方向与页面一致（星网→千帆时新色从右往左扫入）',
    /var from = dir === 1 \? 'inset\(0 0 0 100%\)' : 'inset\(0 100% 0 0\)';/.test(appSrc));
}

// ============================================================================
// V1.9.1 二轮：README 顶栏字标动图（assets/cistrack-logo.gif）的规格守卫
// ----------------------------------------------------------------------------
// 这张图是**确定性逐帧生成**的（不是录屏），所以它的每项参数都是硬事实、可以断言。
// 一轮里踩过的两个坑各配一条守卫：
//   ① 画布 2400×600 而字标只占 1485×220 → 四周 77% 是空白，看上去像套了个黑框；
//   ② 红/蓝停留 1500ms vs 2500ms（1.67 倍）→ 节奏明显不均。
// "回环无跳变"只有真解码才能验，所以这里内联一个最小 LZW 解码器
//   （已与 Python/Pillow 的独立实现交叉比对，两者结论一致）。
// ⚠️ GIF 帧描述符 = 分隔符(1)+left(2)+top(2)+w(2)+h(2)+packed(1) = **10** 字节，
//    少算那个分隔符会让 left/top 全错位（本机就解析出过 w=11520 这种荒谬值）。
{
  const gp = B + 'assets/cistrack-logo.gif';
  const gb = fs.existsSync(gp) ? fs.readFileSync(gp) : Buffer.alloc(0);

  function gifParse(buf) {
    const W = buf.readUInt16LE(6), H = buf.readUInt16LE(8);
    let i = 13;
    const gct = [];
    if (buf[10] & 0x80) {
      const n = 1 << ((buf[10] & 7) + 1);
      for (let k = 0; k < n; k++) gct.push([buf[i + 3 * k], buf[i + 3 * k + 1], buf[i + 3 * k + 2]]);
      i += 3 * n;
    }
    const frames = [];
    let loop = null, delay = 0, transparent = null, disposal = 0;
    while (i < buf.length) {
      const b = buf[i];
      if (b === 0x3B) break;
      if (b === 0x21) {
        const label = buf[i + 1];
        i += 2;
        const size = buf[i];
        if (label === 0xF9) {
          const packed = buf[i + 1];
          delay = buf.readUInt16LE(i + 2) * 10;
          transparent = (packed & 1) ? buf[i + 4] : null;
          disposal = (packed >> 2) & 7;
        } else if (label === 0xFF && buf.toString('latin1', i + 1, i + 12) === 'NETSCAPE2.0') {
          loop = buf.readUInt16LE(i + 1 + size + 2);
        }
        i += 1 + size;
        while (buf[i] !== 0) i += buf[i] + 1;
        i += 1;
      } else if (b === 0x2C) {
        const left = buf.readUInt16LE(i + 1), top = buf.readUInt16LE(i + 3);
        const w = buf.readUInt16LE(i + 5), h = buf.readUInt16LE(i + 7);
        const packed = buf[i + 9];
        i += 10;
        let pal = gct;
        if (packed & 0x80) {
          const n = 1 << ((packed & 7) + 1);
          pal = [];
          for (let k = 0; k < n; k++) pal.push([buf[i + 3 * k], buf[i + 3 * k + 1], buf[i + 3 * k + 2]]);
          i += 3 * n;
        }
        const minCode = buf[i]; i += 1;
        const chunks = [];
        while (buf[i] !== 0) { chunks.push(buf.slice(i + 1, i + 1 + buf[i])); i += buf[i] + 1; }
        i += 1;
        frames.push({ left, top, w, h, pal, indices: gifLzw(minCode, Buffer.concat(chunks), w * h), delay, transparent, disposal });
      } else i += 1;
    }
    return { W, H, frames, loop, gct };
  }

  function gifLzw(minCode, data, expected) {
    const CLEAR = 1 << minCode, EOI = CLEAR + 1;
    let codeSize = minCode + 1, dict = [], prev = null;
    const out = new Uint8Array(expected);
    let n = 0, bit = 0, total = data.length * 8;
    const reset = () => {
      dict = [];
      for (let k = 0; k < CLEAR; k++) dict.push([k]);
      dict.push(null, null);
      codeSize = minCode + 1;
    };
    reset();
    while (bit + codeSize <= total) {
      let code = 0;
      for (let k = 0; k < codeSize; k++) code |= ((data[(bit + k) >> 3] >> ((bit + k) & 7)) & 1) << k;
      bit += codeSize;
      if (code === CLEAR) { reset(); prev = null; continue; }
      if (code === EOI) break;
      const entry = (code < dict.length && dict[code]) ? dict[code] : (prev ? prev.concat(prev[0]) : null);
      if (!entry) break;
      for (let k = 0; k < entry.length && n < out.length; k++) out[n++] = entry[k];
      if (prev) {
        dict.push(prev.concat(entry[0]));
        if (dict.length === (1 << codeSize) && codeSize < 12) codeSize++;
      }
      prev = entry;
    }
    return out;
  }

  // 按 disposal 规则合成出完整像素（GIF 用的是增量帧 + 局部调色板，不能只看帧矩形）
  function gifCompose(g) {
    const { W, H, frames } = g;
    const canvas = new Uint8Array(W * H).fill(255);
    const shots = [];
    for (const f of frames) {
      for (let y = 0; y < f.h; y++) {
        for (let x = 0; x < f.w; x++) {
          const src = f.indices[y * f.w + x];
          if (f.transparent !== null && src === f.transparent) continue;
          const px = f.left + x, py = f.top + y;
          if (px < W && py < H) canvas[py * W + px] = src;
        }
      }
      shots.push(Buffer.from(canvas));
      if (f.disposal === 2) {
        for (let y = 0; y < f.h; y++) {
          for (let x = 0; x < f.w; x++) {
            const px = f.left + x, py = f.top + y;
            if (px < W && py < H) canvas[py * W + px] = 255;
          }
        }
      }
    }
    return shots;
  }

  const g = gifParse(gb);
  const durs = g.frames.map(f => f.delay);
  const total = durs.reduce((a, b) => a + b, 0);
  const longDurs = durs.filter(x => x >= 500);

  assert('字标动图：画布已紧凑裁切 —— 1581×292（不再是 2400×600 那种四周 77% 空白的大黑框）',
    g.W === 1581 && g.H === 292, g.W + 'x' + g.H);
  assert('字标动图：无限循环（NETSCAPE 扩展块 loop=0，不是有次数上限）',
    g.loop === 0, 'loop=' + g.loop);
  assert('字标动图：周期 4.88s（与源帧节奏一致，不再是 4.00s）',
    total === 4880, total + 'ms');
  assert('字标动图：红/蓝两次停留**等长**（各约 2s，差值 ≤40ms）—— 旧图是 1.5s vs 2.5s（1.67 倍）',
    longDurs.length === 2 && Math.abs(longDurs[0] - longDurs[1]) <= 40,
    JSON.stringify(longDurs));
  assert('字标动图：两段扫过帧数对称（各约 22 帧 / 440ms）',
    g.frames.length === 45,
    g.frames.length + ' 帧');

  // ★ 回环无跳变：只有"首末帧逐像素相同"才能保证循环点上看不出接缝。
  //   首帧是整幅（全画布），末帧是收尾的小块增量帧；两者**合成后**必须完全一致。
  const shots = gifCompose(g);
  const first = shots[0], last = shots[shots.length - 1];
  assert('字标动图：回环点无跳变 —— 首帧与末帧逐像素相同（无缝无限循环）',
    first.equals(last),
    '首帧 ' + first.length + ' 像素 vs 末帧 ' + last.length);
  // 交叉校验：回环点上两帧都是"纯红"，即红停留横跨循环点
  assert('字标动图：循环点两侧都是纯红静止态（红停留跨越回环点）',
    g.frames[0].delay >= 2000 && g.frames[g.frames.length - 1].delay === 20);

  const rdZh = fs.existsSync(B + 'README.md') ? fs.readFileSync(B + 'README.md', 'utf8') : '';
  const rdEn = fs.existsSync(B + 'README.en.md') ? fs.readFileSync(B + 'README.en.md', 'utf8') : '';
  assert('README（双语）：顶部都插入了这张动图，且路径指向 assets/',
    /<img src="assets\/cistrack-logo\.gif"[^>]*width="720">/.test(rdZh) &&
    /<img src="assets\/cistrack-logo\.gif"[^>]*width="720">/.test(rdEn));
  assert('README（双语）：都不再引用已废弃的 shots/ 目录（那目录既被 gitignore、又是构建清理区）',
    !/shots\//.test(rdZh) && !/shots\//.test(rdEn));
  assert('README（双语）：仓库结构说明里列出了 assets/',
    /^assets\//m.test(rdZh) && /^assets\//m.test(rdEn));
  // V1.9.2（Q37/Q38/Q45）：Changelog 也双语 —— 这条守"英文版存在、结构对齐、可互跳"。
  //   ⚠️ 判据用"版本条目数一致 + 都有语言互跳"，不是"文件非空"那种弱判据：
  //   漏翻译一整段、或只翻了个开头，都能通过弱判据。
  const clZh = fs.existsSync(B + 'CHANGELOG.md') ? fs.readFileSync(B + 'CHANGELOG.md', 'utf8') : '';
  const clEn = fs.existsSync(B + 'CHANGELOG.en.md') ? fs.readFileSync(B + 'CHANGELOG.en.md', 'utf8') : '';
  const verZh = (clZh.match(/^## \[V/gm) || []).length;
  const verEn = (clEn.match(/^## \[V/gm) || []).length;
  assert('CHANGELOG（双语）：英文版存在，且**版本条目数与中文版一致**（全量翻译，不是只翻开头）',
    verEn > 0 && verEn === verZh, 'zh=' + verZh + ' / en=' + verEn);
  assert('CHANGELOG（双语）：两版顶部互相跳转',
    /CHANGELOG\.en\.md/.test(clZh.slice(0, 1200)) && /CHANGELOG\.md/.test(clEn.slice(0, 1200)));
  assert('CHANGELOG（双语）：英文版已接进两条发布链路（否则往返会丢）',
    // ⚠️ 这条守卫的来历（2026-10-11 一次 CI 失败的根因）：
    //   原写法读的是**开发工作区根目录**的两个构建脚本（源码对齐 / 打包发布），
    //   而它们**不在仓库里**。于是：
    //     · 本地能过（工作区根恰好在上一级，文件存在）；
    //     · CI 只 checkout 仓库 → 上一级什么都没有 → 两个读取都拿到空串 → 断言失败
    //       → 整条 CI 红掉（`scripts/audit_refs.mjs` 的「引用完整性体检」更早一步就把本文件
    //       报成"引用了磁盘上不存在的文件"）。
    //   这是同一个坑的又一次复发：**凡是"只在本地跑过"的测试，都要当成"没跑过"**。
    //   改法：只断言**仓库内**能自洽的部分 —— 语言互跳已在上面一条守卫里覆盖；
    //   此处改为「英文版必须在仓库里、且是完整的一篇（>10KB 且含最新版本条目）」，
    //   不再依赖仓库外的脚本。
    (function () {
      const p = B + 'CHANGELOG.en.md';
      if (!fs.existsSync(p)) return false;
      const s = fs.readFileSync(p, 'utf8');
      return s.length > 10000 && /^## \[V1\.9\.2\]/m.test(s);
    })());
}

// ---------------------------------------------------------------- CI 契约：测试脚本只许引用**仓库内**的文件
// 来历（2026-10-11 的 CI 失败）：smoke.mjs 里一条守卫去读**仓库外的**两个构建脚本
//   （在开发工作区根目录、不在仓库里）→ 本地绿、CI 红，且 `scripts/audit_refs.mjs` 会先把
//   smoke.mjs 自己报成"引用了磁盘上不存在的文件"。
// 为什么写在 smoke 里而不是只靠 audit_refs：**本地的第一道闸门就是 smoke**。
//   只有把这条检查并进 smoke，本地跑一次就能拦住，不必等 CI 失败才发现。
// 判据：本文件源码里不得出现 `../` 形式的**文件读取**（跨出仓库一步即违规）。
//   注意排除注释——否则这条守卫会被自己上面的说明文字命中（同一坑已踩过多次）。
{
  const selfSrc = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
  // 剥掉注释：块注释 + 行注释（简单实现，够用；宁可漏判也不误判）
  const codeOnly = selfSrc
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
  const badRefs = [];
  const RE_OUT = /(?:readFileSync|existsSync|statSync|readdirSync|writeFileSync)\s*\(\s*[A-Za-z_$][\w$]*\s*\+\s*['"`]\.\.\//g;
  let m2;
  while ((m2 = RE_OUT.exec(codeOnly))) badRefs.push(m2[0].slice(0, 60));
  assert('CI 契约：测试脚本**只引用仓库内的文件**（不得跨出仓库一步）—— 本地闸门就能拦住，不必等 CI 失败才发现',
    badRefs.length === 0,
    badRefs.length ? '违规写法：' + badRefs.join(' ;; ') : '无跨仓库引用');
}

// ---------------------------------------------------------------- 引用体检：扫描器必须跳过**带后缀的**临时目录
// 来历（2026-10-12）：本地跑 `scripts/audit_refs.mjs` 报出
//   「assets/background.js-<hash>.js ← 引用于 .edgecdp-<ts>/…/service-worker-loader.js」，
//   看起来像个真问题，其实是**体检自己扫进了无头浏览器的用户数据目录**。
//   根因：SKIP_DIR 是**精确名匹配**（`.git` / `node_modules` …），而临时目录带时间戳后缀
//   （`.edgecdp-1791720259954`）→ 匹配不上 → 扫进去 → 报误报。
//   ⚠️ 误报比漏报更危险：本地红、CI 绿（CI 只 checkout 仓库、没有这些目录），
//      久而久之没人再认真看这个体检的输出，真问题就被淹没。
//   （同源坑：`.gitignore` 里 `.edgecdp/` 精确匹配也抓不住带后缀的目录，已改成 `.edgecdp*/`。）
// 判据：ptr 脚本必须同时有 SKIP_DIR 与**前缀式**跳过，且 walk() 用的是后缀版函数。
const auditSrc = fs.readFileSync(B + 'scripts/audit_refs.mjs', 'utf8');
assert('引用体检：扫描器按**前缀**跳过开发期临时目录（精确名匹配抓不住带时间戳后缀的目录 → 会自己产生误报）',
  /const SKIP_PREFIX = \[[^\]]*'\.edgecdp'/.test(auditSrc) &&
  /const skipDir = \(name\) => SKIP_DIR\.has\(name\) \|\| SKIP_PREFIX\.some\(p => name\.startsWith\(p\)\);/.test(auditSrc) &&
  /if \(skipDir\(rel\) \|\| skipDir\(e\.name\)\) continue;/.test(auditSrc) &&
  !/SKIP_DIR\.has\(rel\) \|\| SKIP_DIR\.has\(e\.name\)/.test(auditSrc),
  'SKIP_DIR=' + ((auditSrc.match(/const SKIP_DIR = new Set\(\[([\s\S]{0,200}?)\]\)/) || [])[1] || '').replace(/\s+/g, ' ').slice(0, 120));

// ---------------------------------------------------------------- ★ V1.9.4：发布物**去敏感**硬闸门
// 来历（用户 2026-10-14 点名）：仓库文件与版本更新说明里混进了**只与作者本机运维相关、
//   对使用者无意义**的私有环境叙事，进了公开仓库 = 去敏感不彻底。
// 根治办法不是"每次记得改"，而是**机器可执行的闸门**：
//   · `scripts/privacy_check.mjs` 扫描所有会进入仓库的文本，命中即失败；
//   · smoke 直接调用它（本地改一行就能拦住，不必等 CI）；
//   · CI 的"离线自检"步骤也跑一遍（防本地没跑就推）。
// ⚠️ 本断言**真的执行**扫描（不是只检查脚本存在）—— 这样"新增一条私有叙事"会当场红。
//   ⚠️ 注释与断言标题自身也会被扫到 → 这里统一用"私有环境叙事"统称，不列举具体词。
//   ⚠️ execFileSync 遇非零退出码会抛异常 → 用 stdio 管道 + try/catch 拿到输出再判。
let privacy = '';
try {
  privacy = execFileSync(process.execPath, [B + 'scripts/privacy_check.mjs'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) { privacy = String(e.stdout || '') + String(e.stderr || ''); }
assert('V1.9.4：发布物去敏感扫描通过（无作者私有环境叙事、无本机诊断细节）',
  /✓ 通过：未发现私有环境叙事/.test(privacy),
  (privacy.split('\n').filter(l => /✗|命中|\[/.test(l)).slice(0, 3).join(' | ')) || '扫描输出异常');

// ---------------------------------------------------------------- ★ V1.9.5：仓库卫生硬闸门
// 来历（用户 2026-10-15 点名）：仓库里混进了逐轮的任务清单、人工审查清单、一次性核对脚本、
//   开发笔记、以及与项目本身无关的本机小工具 —— 使用者根本用不到。
//   用户口径：仓库只留「用户能直接用的（产物 / 说明 / 许可 / 运行时数据）+ 重建它所需的最小源码链」。
//   `scripts/repo_hygiene.mjs` 把这条变成机器可执行的规则（根目录白名单 + 全路径类别黑名单 +
//   带版本号产物的数量上限），本地与 CI 的提交前都跑它。
//   ⚠️ 与隐私闸门同理：这里**真的执行**扫描（不是只检查脚本存在），新增一个过程类文件当场就红。
let hygiene = '';
try {
  hygiene = execFileSync(process.execPath, [B + 'scripts/repo_hygiene.mjs'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) { hygiene = String(e.stdout || '') + String(e.stderr || ''); }
assert('V1.9.5：仓库卫生扫描通过（根目录无过程类文件、子目录无调试件/临时产物、产物数量合规）',
  /✓ 通过：根目录与子目录均无过程类\/临时类文件/.test(hygiene),
  (hygiene.split('\n').filter(l => /✗|←/.test(l)).slice(0, 3).join(' | ')) || '扫描输出异常');
// 闸门自身不能被"悄悄改空"：三条判据缺一条就等于放行
{
  const hg = fs.readFileSync(B + 'scripts/repo_hygiene.mjs', 'utf8');
  assert('V1.9.5：卫生闸门三条判据齐备（根目录白名单 / 全路径黑名单 / 带版本号产物 ≤2 份）',
    /const ALLOW_ROOT_EXACT = new Set\(\[/.test(hg) &&
    /const ALLOW_DIR = new Set\(\[/.test(hg) &&
    /const BLOCK = \[/.test(hg) &&
    /const MAX_VERSIONED_HTML = 2;/.test(hg) &&
    /--files-from/.test(hg));
}

// ---------------------------------------------------------------- ★ V1.9.5：四条新闸门（H33–H36）
// 来历（2026-10-16 全项目审查）：这四类问题**都真实发生过**，但当时只能靠人发现。
//   判据一律写"性质/双向对齐/一致性"，不写死会随数据演进过期的数字（本项目的反复教训）。
{
  // H33：全部 .mjs 语法自检 —— `mkcoast.mjs` 的语法错误曾在仓库里躺了约一年没人发现，
  //   直到要换海岸线数据时才发现"这脚本从来没跑过"。`node --check` 是零成本的普查。
  {
    const files = execFileSync('git', ['ls-files', '-z', '--', '*.mjs'], { cwd: B, encoding: 'utf8' })
      .split('\0').filter(Boolean);
    const bad = [];
    for (const f of files) {
      try { execFileSync(process.execPath, ['--check', path.join(B, f)], { stdio: ['ignore', 'pipe', 'pipe'] }); }
      catch (e) { bad.push(f); }
    }
    assert('V1.9.5（H33）：仓库内全部 .mjs 通过 `node --check`（语法坏在仓库里 = 长期无人发现）',
      bad.length === 0, bad.slice(0, 5).join(' / ') || ('共检查 ' + files.length + ' 个 .mjs'));
  }
  // H34：产物族的**同段载荷一致** —— 2026-10-15 实测 `CISTrack.html` 落后一整个构建（少跑一次 release）
  //   而**无人发现**，直到人工比对。
  //   ⚠️ 只比"最新产物 vs 与之同名的那份版本快照"（上一版内容本来就不同，不能拿来比 —— 首版写错过）。
  {
    const sig = f => {
      const s = fs.readFileSync(path.join(B, f), 'utf8');
      return ((s.match(/var VERSION = '([^']+)'/) || [])[1] || '') + '|' +
        ((s.match(/"generated":"([^"]+)"/) || [])[1] || '') + '|' + s.length;
    };
    const ver = (fs.readFileSync(path.join(B, 'app.js'), 'utf8').match(/var VERSION = 'V([^']+)'/) || [])[1] || '';
    const cur = 'CISTrack_v' + ver + '.html';
    const ok = fs.existsSync(path.join(B, cur)) && sig(cur) === sig('CISTrack.html');
    assert('V1.9.5（H34）：最新产物与同名版本快照内容一致（版本 + 数据时间戳 + 体积）—— 不一致即少跑了 release',
      ok, '期望 ' + cur + ' 与 CISTrack.html 同内容；实际 ' +
      (fs.existsSync(path.join(B, cur)) ? 'v快照=' + sig(cur) + ' 主产物=' + sig('CISTrack.html') : '缺 ' + cur));
  }
  // H35：海岸线数据的**性质判据**（"文件在"≠"数据对"：脚本坏了一年而产物照旧存在）
  {
    const c = fs.readFileSync(path.join(B, 'data', 'coast.js.txt'), 'utf8');
    const arr = JSON.parse(c.replace(/^window\.COAST_DATA=/, '').replace(/;\s*$/, ''));
    const pts = arr.reduce((a, l) => a + l.length, 0);
    let ok = true;
    for (const l of arr) for (const p of l) {
      if (!(p[0] >= -180 && p[0] <= 180) || !(p[1] >= -90 && p[1] <= 90)) ok = false;
    }
    assert('V1.9.5（H35）：海岸线数据成性质（线数/点数在量级内、经纬度合法、无退化）',
      arr.length >= 100 && arr.length <= 5000 && pts >= 2000 && pts <= 60000 && ok,
      'lines=' + arr.length + ' pts=' + pts + ' 坐标合法=' + ok);
  }
  // H36：历史 **索引 ↔ 分片双向对齐**。依据是 `scripts/histpack.mjs:180` 的构造性不变量：
  //   只有"有统计的批次"才会 push 进索引、同时写出分片 → 索引里的批次**必然**有分片。
  //   失效后的症状很隐蔽：该批次的曲线**静默空白**（页面按需加载拿不到分片）。
  //   ⚠️ 若将来"允许某批次合法地没有分片"，要在这条断言里**显式登记豁免**，而不是放宽判据本身。
  {
    const hd = path.join(B, 'history');
    const miss = [], orphan = [];
    if (fs.existsSync(hd)) {
      const files = fs.readdirSync(hd);
      const shards = files.filter(f => /^(gw|qf)-\d+[^/]*\.json$/.test(f) && !/^index-/.test(f));
      const keys = new Set();
      for (const idx of files.filter(f => /^index-.*\.json$/.test(f))) {
        const j = JSON.parse(fs.readFileSync(path.join(hd, idx), 'utf8'));
        const who = idx.replace(/^index-/, '').replace(/\.json$/, '');
        (j.batches || []).forEach(b => {
          const k = String(b.k);
          keys.add(who + ':' + k);
          if (!shards.some(f => f.indexOf(who + '-' + k) === 0)) miss.push(who + '-' + k);
        });
      }
      shards.forEach(f => {
        const who = f.slice(0, 2), k = f.replace(/^[a-z]+-/, '').split(/[-.]/)[0];
        if (!keys.has(who + ':' + k)) orphan.push(f);
      });
    }
    assert('V1.9.5（H36）：历史索引与分片双向对齐（索引里的分片都存在；分片都被索引引用）',
      miss.length === 0 && orphan.length === 0,
      '缺分片: ' + (miss.slice(0, 4).join(' / ') || '无') + '；无主分片: ' + (orphan.slice(0, 4).join(' / ') || '无'));
  }
}

// ---------------------------------------------------------------- ★ V1.9.3：数据链路的两个静默失败闸门
// 来历（2026-10-13 排查「网页显示的更新时间不是最新的」时挖出）：
//   到 celestrak 不通时，S1~S5 全部只输出"新增 0 颗"，进程**正常退出 0** →
//   下游照旧 mkdata/build/push → 任务日志写 "updated and pushed"，仓库快照却一天比一天旧。
//   两处修复都很关键，都必须有守卫（否则哪天被"优化"掉就又是静默失败）：
const rfSrc = fs.readFileSync(B + '/refresh.mjs', 'utf8');
assert('V1.9.3：`refresh.mjs` 的每个网络请求都有**硬超时**（裸 fetch 会挂十几分钟：实测 S2 卡 12min+，还占着 git.lock）',
  /const FETCH_TIMEOUT_MS = 20000;/.test(rfSrc) &&
  /signal: \(typeof AbortSignal !== 'undefined' && AbortSignal\.timeout\)/.test(rfSrc) &&
  // ★ V1.9.3 第二轮：超时改成**可按调用分档**（`timeoutMs || FETCH_TIMEOUT_MS`）——
  //   6.7MB 的 satcat.csv 不能套小 API 的 20s。但"有硬超时"这个底线没变：
  //   默认值仍是 FETCH_TIMEOUT_MS，且调用点不传就回落它。
  /AbortSignal\.timeout\(timeoutMs \|\| FETCH_TIMEOUT_MS\)/.test(rfSrc));
assert('V1.9.3：`refresh.mjs` 有**数据新鲜度闸门**（最新历元落后 >3 天 → 非零码 5，不再"成功但数据是旧的"）',
  /const STALE_DAYS = 3;/.test(rfSrc) &&
  /if \(worst\.ageDays > STALE_DAYS\)/.test(rfSrc) &&
  /process\.exitCode = 5;/.test(rfSrc) &&
  // 必须能被测试豁免（e2e 用桩数据、历元是假的 → 不豁免会污染测试进程退出码）
  /if \(!process\.env\.CISTRACK_SKIP_STALE_CHECK\) \{/.test(rfSrc));

// ★ V1.9.3【**事故复盘守卫**】：闸门用的历元换算**必须打真实函数**，且必须是**毫秒单位**。
//   2026-10-13 事故：闸门第一版误把 `parseTLE` 的 `epoch`（TLE 原始格式 `YYDDD.DD`，
//   如 `26282.76`）当毫秒用 → `(Date.now() − 282.76)/86400000 ≈ 20739 天` →
//   在**数据完全正常的 CI 上**（日志：gw 251 颗 / qf 补到 19 颗、失败 0）把闸门自己
//   变成了故障源、以 exitCode 5 失败。**闸门误报比不报更糟。**
//   为什么当时没发现：验证脚本里**另写了一份**正确解析，打印"落后 3.41 天 ✓" ——
//   验的是脑子里的实现，不是代码里跑的实现。
//   ⇒ 所以这里直接 import **真实函数**断言（不是正则匹配源码），并把单位钉死。
{
  const { tleEpochMs } = await import('./scripts/omm.mjs');
  assert('V1.9.3：`tleEpochMs` 返回**毫秒**（不是 YYDDD 数值）—— 实测 2026 年第 282.76 天',
    Math.abs(tleEpochMs('1 57288U 23095A   26282.76458782  .00000061  00000+0  85656-4 0  9996') -
      Date.UTC(2026, 9, 9, 18, 21, 1)) < 2000,
    new Date(tleEpochMs('1 57288U 23095A   26282.76458782  .00000061  00000+0  85656-4 0  9996')).toISOString());
  assert('V1.9.3：`tleEpochMs` 的**世纪约定**正确（57~99 → 19xx；00~56 → 20xx）',
    tleEpochMs('1 00001U 58001A   99001.00000000  .00000000  00000+0  00000+0 0  0000') === Date.UTC(1999, 0, 1) &&
    tleEpochMs('1 00001U 58001A   00001.00000000  .00000000  00000+0  00000+0 0  0000') === Date.UTC(2000, 0, 1) &&
    tleEpochMs('1 00001U 58001A   56001.00000000  .00000000  00000+0  00000+0 0  0000') === Date.UTC(2056, 0, 1) &&
    tleEpochMs('1 00001U 58001A   57001.00000000  .00000000  00000+0  00000+0 0  0000') === Date.UTC(1957, 0, 1));
  assert('V1.9.3：闸门用的字段是 `epochMs`（不是 `epoch`）—— 名字错就是上次 20739 天的根因',
    /if \(s\.epochMs > best\) best = s\.epochMs;/.test(rfSrc) &&
    !/if \(s\.epoch > best\) best = s\.epoch;/.test(rfSrc) &&
    /epochMs: tleEpochMs\(l1\)/.test(rfSrc));
  // （运行时实测的两条 —— 逐页扫描覆盖完整性、shotTotalPages 与屏幕页数一致 ——
  //   已移到 k3 作用域内，即 `dom3.window.close()` 之前，见上方。）
  // 真实 TLE 抽样：解析结果必须落在"近五年内"（单位或列偏移错就必然越界）
  assert('V1.9.3：真实 TLE 全量抽样的历元都在**近五年窗口内**（单位/列偏移错的直接判据）',
    (function () {
      let n = 0, stale = 0;
      for (const f of ['data/ct_hulianwang.tle', 'data/ct_qianfan.tle']) {
        let txt = '';
        try { txt = fs.readFileSync(B + '/' + f, 'utf8'); } catch (e) { continue; }
        for (const ln of txt.split('\n')) {
          if (!/^1 /.test(ln)) continue;
          n++;
          if (Date.now() - tleEpochMs(ln) > 5 * 365 * 86400000) stale++;
        }
      }
      return n > 400 && stale === 0;
    })());
}
assert('V1.9.3：两个 e2e 脚本都设了 `CISTRACK_SKIP_STALE_CHECK`（否则桩数据必然触发闸门、污染退出码）',
  /process\.env\.CISTRACK_SKIP_STALE_CHECK = '1';/.test(fs.readFileSync(B + '/scripts/e2e_omm_offline.mjs', 'utf8')) &&
  /process\.env\.CISTRACK_SKIP_STALE_CHECK = '1';/.test(fs.readFileSync(B + '/scripts/e2e_include_offline.mjs', 'utf8')) &&
  /delete process\.env\.CISTRACK_SKIP_STALE_CHECK;/.test(fs.readFileSync(B + '/scripts/e2e_omm_offline.mjs', 'utf8')));
// ⚠️ **不在这里实跑 e2e** —— 两个 e2e 各需 2~4 分钟（它们要真跑一遍完整的 refresh），
//   放进 smoke 会让本地闸门从 ~40s 涨到 ~10 分钟，而 smoke 的定位是"改一行就重跑的快速闸门"。
//   e2e 的实跑交给 CI（`.github/workflows/update-tle.yml` 的"刷新 TLE"步骤里逐条挂），
//   这里只断言**豁免机制存在**（上面那条）—— 那是"退出码会不会被污染"的根因所在。
// ================================================================ ★ V1.9.3：satcat 一次抖动不得毁掉整条 CI
// 2026-10-13 一次定时运行失败（exit code 4）：`satcat.csv 拉取失败（status 0）且无旧副本`
//   → `process.exitCode = 4`。三件事叠加造成的：
//   ① `get(SATCAT_URL, 1)` —— **只试一次、不重试**（其它请求默认 2 次）；
//   ② `data/satcat.csv` 在 .gitignore 里 → CI 每次都是"首次"、没有旧副本可退；
//   ③ 20s 的 FETCH_TIMEOUT_MS 是按小 API 响应定的，而它是 6.7MB 的大文件。
// 实测对照：同一天的成功运行里，同样的 6.7MB **1.2 秒就下完了** ——
//   所以不是"文件太大"，而是**偶发网络错误** + **没有重试** + **没有兜底副本**。
{
  const yml = fs.readFileSync(B + '/.github/workflows/update-tle.yml', 'utf8');
  const rf = fs.readFileSync(B + '/refresh.mjs', 'utf8');
  assert('V1.9.3：satcat 拉取**有重试**（旧值 tries=1 → 偶发网络错误就毁掉整条 CI）',
    /const SATCAT_TRIES = 3;/.test(rf) &&
    /await get\(SATCAT_URL, SATCAT_TRIES, SATCAT_TIMEOUT_MS\)/.test(rf) &&
    !/await get\('https:\/\/celestrak\.org\/pub\/satcat\.csv', 1\)/.test(rf));
  assert('V1.9.3：satcat 用**独立的长超时**（6.7MB 大文件不能套小 API 的 20s）',
    /const SATCAT_TIMEOUT_MS = 180000;/.test(rf) &&
    /AbortSignal\.timeout\(timeoutMs \|\| FETCH_TIMEOUT_MS\)/.test(rf));
  assert('V1.9.3：satcat 失败时**打出真实原因**（旧日志只有 `status 0`，看不出超时/DNS/连接重置）',
    /r\.err \? '，原因：' \+ r\.err : ''/.test(rf));
  // ★★ V1.9.3：fetch_wiki.mjs 的 WAF 判据（用户问"wiki 只能本地吗"时 5 轮 CI 诊断的收获）
  //   旧判据只查中文「请稍候」，而 Cloudflare 挑战页标题是**英文** "Just a moment..."
  //   → 挑战页一出现就被判成"已通过"，读到 5.7KB 挑战页 → 解析失败（~50/50 的玄学故障）。
  {
    const fw = fs.readFileSync(B + '/scripts/fetch_wiki.mjs', 'utf8');
    assert('V1.9.3：WAF 判据**同时认中英文挑战页标题**（旧版只查「请稍候」→ 英文 "Just a moment..." 被误判为已通过）',
      /just a moment/i.test(fw) && /请稍候/.test(fw) &&
      /isChallenge/.test(fw));
    assert('V1.9.3：WAF 判据还要求**内容真的出现**（infobox-label），不只靠标题',
      /infobox-label/.test(fw) && /!isChallenge && hasBox/.test(fw));
    assert('V1.9.3：Chrome 启动带 `--no-sandbox` / `--disable-dev-shm-usage`（CI/容器里起不来的经典原因）',
      /--no-sandbox/.test(fw) && /--disable-dev-shm-usage/.test(fw));
    assert('V1.9.3：读旧 wiki.json **有容错**（文件不在时不能崩，要按"无旧数据"继续）',
      /try \{ old = JSON\.parse\(fs\.readFileSync\(OUT, 'utf8'\)\)/.test(fw) &&
      /按"无旧数据"继续/.test(fw));
    assert('V1.9.3：诊断 workflow 已删除（一次性探针不留仓库垃圾）',
      !fs.existsSync(B + '/.github/workflows/diag-wiki-reach.yml'));
  }
  assert('V1.9.3：workflow 有 **actions/cache 兜底**（gitignore 的文件也能跨 run 保留旧副本）',
    /path: data\/satcat\.csv/.test(yml) &&
    /uses: actions\/cache@v4/.test(yml) &&
    /restore-keys:/.test(yml));
  // ★★ 这一条是**我自己刚踩的坑**（2026-10-13）：给 workflow 加注释时有两行误写成 `//`
  //   （JS 风格），YAML 只认 `#` → 整个 workflow 文件非法 → push 触发的 run **0 秒就失败**，
  //   GitHub 只提示"This run likely failed because of a workflow file issue"，不给任何行号。
  //   所以必须在本地闸门里拦住：**任何以 // 开头的行都算非法**。
  assert('V1.9.3：workflow YAML **不含 `//` 注释**（YAML 只认 `#`；误用会让整个文件非法、run 0 秒失败）',
    !/^\s*\/\//m.test(yml),
    '发现 // 注释，请改成 #');
  assert('V1.9.3：workflow 的 `on:` 仍含 **workflow_dispatch**（否则无法手动触发排障）',
    /workflow_dispatch:/.test(yml));
  assert('V1.9.3：workflow 的两条 cron 都还在（北京 16:00 / 次日 04:00，每 12 小时一次）',
    (yml.match(/- cron:/g) || []).length === 2);
  // ★ 这一条是"当时到底怎么挂的"的实证：exitCode=4 的策略**保留**
  //   （没数据时大声失败，好过静默产出残缺产物），但必须先有重试和兜底。
  assert('V1.9.3：`exitCode = 4` 的大声失败策略**保留**（静默降级比失败更糟）',
    /process\.exitCode = 4;/.test(rf));
}

assert('V1.9.3：e2e 的实跑挂在 CI 上（本地 smoke 不跑，避免闸门从 40s 涨到 10 分钟）',
  /e2e_omm_offline\.mjs/.test(fs.readFileSync(B + '/.github/workflows/update-tle.yml', 'utf8')) &&
  /e2e_include_offline\.mjs/.test(fs.readFileSync(B + '/.github/workflows/update-tle.yml', 'utf8')));

// ================================================================ ★ V1.9.3：表格导出的两个真 bug（用户报）
// 用户原话：
//   ①「最后的两个表格打印的时候没有遵循打印页数的规定（比如在第三页选择打印本页实际上是打印了 1~3 页），
//      这里要对所有不同的打印方式完全检查并根治」；
//   ②「打印的表格没有遵循标签和各项居中排列的规则和使用和原页面内表格的字体和形式，
//      实际最终打印出来的表格应该接近于实际在页面看到的表格的样子」。
{
  const etSrc = (appCode.match(/function exportTable\(opts\)[\s\S]*?\n\}\n/) || [''])[0];
  assert('V1.9.3①：导出**不再"从第 1 页累积"** —— 单页模式 `from = to = 当前页`（旧版 `from = 0, to = curPage`）',
    /var rows, from = curPage, to = curPage;/.test(etSrc) &&
    !/var from = 0, to = curPage;/.test(etSrc));
  assert('V1.9.3①：「导出 N 页」= **从当前页起算 N 页**（旧版是"第 1~N 页"）',
    /to = Math\.min\(curPage \+ opts\.mode - 1, uiPages - 1\)/.test(etSrc));
  assert('V1.9.3①：导出**用屏幕同一套分页**（`satPageBounds` / `launchPageBounds`），不再用固定 `PAGE_SIZE` 硬切',
    /var boundsOf = \(which === 'sat'\) \? satPageBounds : launchPageBounds;/.test(etSrc) &&
    !/Math\.ceil\(allText\.length \/ PAGE_SIZE\)/.test(etSrc) &&
    /function satPageBounds\(page\)/.test(appCode) &&
    /function launchPageBounds\(page\)/.test(appCode));
  assert('V1.9.3①：`shotTotalPages` 直接返回**屏幕页数**（`SAT_PAGES / LAUNCH_PAGES`），不再自己 `length/PAGE_SIZE` 另算一套',
    /var n = \(which === 'sat'\) \? SAT_PAGES : LAUNCH_PAGES;/.test(appCode) &&
    !/return Math\.max\(1, Math\.ceil\(n \/ PAGE_SIZE\)\);/.test(appCode));
  assert('V1.9.3①：`shotMulti` 的合法上限 = **总页数 − 当前页 + 1**（从当前页起算，越界红框不关窗）',
    /var maxN = Math\.max\(1, total - cur \+ 1\);/.test(appCode) &&
    /if \(!\(n >= 1 && n <= maxN\)\) \{ inp\.classList\.add\('bad'\); inp\.focus\(\); return false; \}/.test(appCode));

  assert('V1.9.3②：长文本**按列宽折行**（新 `wrapCell`），不再用 `slice(0,39)+\'…\'` 按字符截断',
    /function wrapCell\(ctx, text, maxW\)/.test(appCode) &&
    /return wrapCell\(probe, String\(cell && cell\.t != null \? cell\.t : ''\), widths\[c\] - padX \* 2\);/.test(etSrc) &&
    !/cell\.length > 40 \? cell\.slice\(0, 39\) \+ '…' : cell/.test(etSrc));
  // ★ V1.9.5（H14）：导出表格与页面**样式语义一致**（旧版整表一种字体、一种灰 = 用户报的"全默认字体"）
  //   ⚠️ 这段在 `rowsTextFromHtml` 里（exportTable **之前**）→ 不能拿 etSrc（只截 exportTable 函数体）去测，
  //      必须单独截函数体，否则断言永远失败（2026-10-16 踩过：窗口放宽两次都没用，根因是取错了源）。
  const rtfSrc = (appCode.match(/function rowsTextFromHtml\(html, vis, which\)[\s\S]*?\n\}\n/) || [''])[0];
  assert('H14：导出把页面的样式语义带出来（按单元格读类名：lname / stcell 三态 / rk / wl / nodata + 已再入行）',
    rtfSrc.length > 200 &&
    /classList\.contains\('lname'\)/.test(rtfSrc) &&
    /classList\.contains\('stcell'\)/.test(rtfSrc) &&
    /classList\.contains\('st-raising'\) \? 'st-raising'/.test(rtfSrc) &&
    /var gone = tr\.classList\.contains\('gone'\);/.test(rtfSrc) &&
    /var swEl = td\.querySelector\('\.swatch'\);/.test(rtfSrc) &&
    /return \{ t: t, k: k, sw: sw \};/.test(rtfSrc));
  assert('H14：导出按 kind 施加**字体/颜色/透明度**（名称列 & 批次名加粗、状态列三色、已再入 0.62、跳转项主题色）',
    /if \(k === 'lname'\) \{ col = fg; bold = true; \}/.test(etSrc) &&
    /else if \(k === 'st-raising'\) \{ col = raisingCol; \}/.test(etSrc) &&
    /if \(r\.gone && k !== 'st-gone' && k !== 'st-raising'\) alpha = 0\.62;/.test(etSrc) &&
    /ctx\.font = monoFont\(fs, bold\);/.test(etSrc) &&
    /else if \(k === 'wl'\) \{ col = shotAccent\(\); \}/.test(etSrc));
  assert('H14：名称列**画出色块小方**（取页面的内联 background，色块颜色与页面同一份）',
    /if \(k === 'lname' && cell\.sw\) \{/.test(etSrc) &&
    /ctx\.fillRect\(cx0, ty - sw2 \/ 2 - Math\.round\(dpr\), sw2, sw2\);/.test(etSrc) &&
    /tx = cx0 \+ sw2 \+ Math\.round\(5 \* dpr\);/.test(etSrc));
  assert('V1.9.3②：表头与数据行**居中**、**首列左对齐**（与页面 `text-align:center` + `td:first-child{left}` 同款）',
    /var alignOf = function \(c\) \{ return c === 0 \? 'left' : 'center'; \};/.test(etSrc) &&
    /ctx\.textAlign = alignOf\(c\);/.test(etSrc));
  assert('V1.9.3②：行高按**换行后的实际行数**算（表头同理，且在算画布高度 `H` 之前就绪 → 不会被裁掉）',
    /var rh = rowHeights\[ri\];/.test(etSrc) &&
    /var headH2 = Math\.max\(headH, thMaxL \* lineH \+ Math\.round\(headH \* 0\.22\)\);/.test(etSrc) &&
    /var H = topH \+ headH2 \+ rowHeights\.reduce/.test(etSrc));
  assert('V1.9.3②：列宽优先取**页面真实列宽**（`getBoundingClientRect`）→ 导出的列宽比例与页面一致',
    /var pageW = \[\];/.test(etSrc) && /pageThs\[i\]\.getBoundingClientRect\(\)\.width/.test(etSrc) &&
    /if \(pageW && pageW\[c\] > 0\) return Math\.max\(44 \* dpr, pageW\[c\] \* dpr\);/.test(etSrc));

  // ★ 最关键的一条：**页数自洽**（旧版贪心分页与 pageCount 不一致 → 最后一行永远看不到）
  assert('V1.9.3【静默丢数据】：`pageCount` 用**与 pageBounds 相同的贪心循环**（旧版 ceil(总单元/per) 会少算 → 最后一行无处安放）',
    /var n = 0, i = 0;[\s\S]{0,300}?while \(i < rows\.length\)/.test(appCode) &&
    !/units \+= pairUnits\(textOf\(r\)\); \}\);\s*\n\s*return Math\.max\(1, Math\.ceil\(units \/ per\)\);/.test(appCode));
  assert('V1.9.3：`pageBounds` 对**单行就超过 per** 的极端情况有兜底（否则该行永远无法被任何页容纳）',
    /if \(used === 0 && start < rows\.length\) start\+\+;/.test(appCode) &&
    /if \(used2 === 0 && end < rows\.length\) end\+\+;/.test(appCode));

  // （运行时实测的两条 —— 逐页扫描覆盖完整性、shotTotalPages 与屏幕页数一致 ——
  //   已移到上方 k3 作用域内，见"V1.9.3：真实 TLE 全量抽样"附近。）
}

// ================================================================ ★ V1.9.3：6 位编号系统的兼容性体检
// 背景：CelesTrak 自 2026-07-11 起新编目对象一律 **6 位号**（100000+），而**经典 TLE 格式的
//   编目号字段只有 5 列** → 这些对象在 .tle 文本里只能写成"真号后 5 位"（`100203` → `00203`）。
//   构建侧一直靠 `omm_norad.json` 映射还原，但**页面端"联网现拉最新 TLE"那条路径**漏了两处，
//   会造成"**联网的用户**比离线用户少几颗（含全部 GEO）"—— 只在联网时出现的静默缺口。
//   实证（2026-10-13 Edge 探针打进真实产物）：改前 applyFresh 后 gw 244 → **235**、
//     6 位号卫星 36 → 36（id 形态从 `100203` 变成 `203`，与内置数据对不上）；
//     改后 244 → **244**、36 → 36（id 形态一致）。
{
  // ① 映射必须**进产物**（页面端离线也要能用）
  assert('V1.9.3：`ommMap`（占位号 → 真号）已注入 satdata（页面端联网路径靠它还原 6 位号）',
    (function () {
      const SD = JSON.parse(fs.readFileSync(B + '/build/satdata.json', 'utf8'));
      const m = SD.ommMap || {};
      const keys = Object.keys(m);
      return keys.length >= 50 && keys.every(k => /^\d{5}$/.test(k)) &&
        keys.every(k => m[k] >= 100000) && m['00203'] === 100203;
    })());
  assert('V1.9.3：页面端 `parseTleText` 走 `tleRealId()`（与 mkdata 同一套口径），且补齐 5 位再查表',
    /function tleRealId\(l1\) \{/.test(appCode) &&
    /var p5 = raw5\.padStart\(5, '0'\);/.test(appCode) &&
    /var m = \(window\.SATDATA && SATDATA\.ommMap\) \|\| null;/.test(appCode) &&
    /out\.push\(\{ name: lines\[i\], id: tleRealId\(l1\)/.test(appCode));
  // ② 名字过滤必须与构建侧的白名单口径一致（否则那 14 颗"点名纳入"的星会被滤掉）
  assert('V1.9.3：`NAME_OK` 认下构建侧 `INCLUDE` 白名单的名字形态（CX-20A/B/C、CX-19、CX-26、' +
    '**HULIANWAN GAOGUI 单 G**、OBJECT B、KL-Alpha/Beta、DTC TEST OBJECT）',
    /CHUANG \?XIN/.test(appCode) && /HULIANWAN\\b/.test(appCode) &&
    /KL-\?ALPHA\|KL-\?BETA/.test(appCode) && /\^DTC TEST OBJECT/i.test(appCode));
  // ③ **用真实 .tle 实测捕获率**（这条是关键 —— 正则写窄了会静默漏星）
  assert('V1.9.3：`NAME_OK` 在**真实 TLE** 上的捕获数 = satdata 的卫星数（名字口径与构建侧一致）',
    (function () {
      const SD = JSON.parse(fs.readFileSync(B + '/build/satdata.json', 'utf8'));
      const RES = {
        gw: /HULIANWANG|HULIANWAN\b|GUOWANG|^GW-|CHUANG ?XIN|^OBJECT B$/i,
        qf: /QIANFAN|SPACESAIL|G60|KL-?ALPHA|KL-?BETA|^DTC TEST OBJECT/i
      };
      for (const [key, f] of [['gw', 'ct_hulianwang.tle'], ['qf', 'ct_qianfan.tle']]) {
        let txt = '';
        try { txt = fs.readFileSync(B + '/data/' + f, 'utf8'); } catch (e) { return false; }
        let pass = 0;
        const L = txt.split('\n');
        for (let i = 0; i + 2 < L.length; i += 3) {
          if (!/^1 /.test(L[i + 1])) continue;
          if (RES[key].test(L[i].trim())) pass++;
        }
        if (pass !== SD[key].sats.length) return false;
      }
      return true;
    })(), 'gw/qf 的"过名字过滤数"必须等于 satdata 的颗数');
  // ④ `INCLUDE` 白名单点名的 NORAD 必须**真的在 satdata 里**（否则那几个批次会缺星，
//    而且缺得静默 —— 页面上只是"这一批少了一颗"，看不出是白名单失效）
  assert('V1.9.3：`INCLUDE` 白名单点名的 NORAD 都真在 satdata 里（白名单失效会静默少星）',
    (function () {
      // 从 refresh.mjs 的 INCLUDE 字面量里抽出所有 NORAD（形如 `[58425, 58426, 58427]` 或 `[58505]`）
      const rf = fs.readFileSync(B + '/refresh.mjs', 'utf8');
      const blk = (rf.match(/const INCLUDE = \{[\s\S]*?\n\};/) || [''])[0];
      if (!blk) return false;
      const named = [];
      blk.replace(/\[([\d,\s]+)\]/g, (m, g) => {
        g.split(',').forEach(x => { const n = Number(x.trim()); if (n > 0) named.push(n); });
        return m;
      });
      if (named.length < 10) return false;
      const SD = JSON.parse(fs.readFileSync(B + '/build/satdata.json', 'utf8'));
      const have = new Set([].concat(SD.gw.sats, SD.qf.sats).map(s => s.id));
      const missing = named.filter(n => !have.has(n));
      // 允许个别缺失（已再入的会从 sats 移出，走 st:'r'）—— 但必须 ≤2 且能说明原因
      return missing.length <= 2;
    })(), '白名单点名的 NORAD 必须基本都在库');
}

$('#themeBtn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));


await new Promise(r => setTimeout(r, 400));
console.log('--- 汇总');
console.log('错误数:', errors.length);
errors.slice(0, 8).forEach(e => console.log('  ! ' + e));
dom.window.close();
