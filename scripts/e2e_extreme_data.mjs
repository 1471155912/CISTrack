// 审计④：页面层「极限卫星数据」鲁棒性测试
//   既有 e2e_adversarial 测的是**管道层**（脏 TLE 进不来）；这里测**渲染层**：
//   把怪异/残缺的卫星数据直接塞进 SATDATA，看页面会不会崩、会不会显示错乱。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const B = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(path.join(B, 'package.json'));
const { JSDOM, VirtualConsole } = require('jsdom');

const html = fs.readFileSync(path.join(B, 'CISTrack.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, d) => { c ? (pass++, console.log('  ✓ ' + n + (d ? '  [' + d + ']' : ''))) : (fail++, console.log('  ✗ ' + n + (d ? '  [' + d + ']' : ''))); };

// 基础合法星（页面 build() 需要的最小字段集）
const baseSat = (over) => Object.assign({
  id: 990001, c: '2030-901A', d: '', wu: '', wn: '测试星', en: 'TEST SAT',
  orb: 0, wk: 500, od: '', la: 500
}, over || {});

async function runCase(name, mutate, expect) {
  const errs = [];
  // ⚠️ jsdom **不实现 canvas**：每次加载都会抛 `HTMLCanvasElement.prototype.getContext` +
  //   `setTransform of null`。这是**测试环境限制**（真浏览器里 canvas 正常），
  //   若不滤掉，10 个场景会全部假红 —— 与"探针本身也要被质疑"是同一类坑。
  //   只滤这三类噪声，其它错误照常计入（不能一刀切当通过）。
  const NOISE = /HTMLCanvasElement|getContext|setTransform|canvas npm package|Not implemented/i;
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => { const m = String(e && e.message || e); if (!NOISE.test(m)) errs.push(m.slice(0, 120)); });
  vc.on('error', (...a) => { const m = String(a[0]); if (!NOISE.test(m)) errs.push(m.slice(0, 120)); });
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, url: 'https://x/' });
  await new Promise(r => setTimeout(r, 4500));
  const w = dom.window, d = w.document;

  // 注入
  let injected = true;
  try { mutate(w.SATDATA); } catch (e) { injected = false; errs.push('inject: ' + e.message); }

  // 触发重建：切星座再切回（页面唯一对外可达的重建路径）
  try {
    const seg = d.querySelector('#constelSeg button[data-c="qf"]');
    const seg2 = d.querySelector('#constelSeg button[data-c="gw"]');
    if (seg) { seg.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); await new Promise(r => setTimeout(r, 700)); }
    if (seg2) { seg2.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); await new Promise(r => setTimeout(r, 700)); }
  } catch (e) { errs.push('switch: ' + e.message); }

  const rows = d.querySelectorAll('#satTable tbody tr').length;
  const alive = !!d.querySelector('#satTable') && rows > 0;
  const noCrash = errs.length === 0;

  const good = injected && (expect === 'alive' ? (alive && noCrash) : noCrash);
  ok(name, good, `行数=${rows} 错误=${errs.length ? errs.slice(0, 2).join(' | ') : '无'}`);
  try { w.close(); } catch (e) {}
  return { rows, errs, alive };
}

console.log('=== 极限卫星数据注入（每个场景独立加载，避免相互污染）===');

await runCase('① 负数高度（wk=-100）：不崩、仍有行', m => {
  m.gw.sats.push(baseSat({ id: 990001, c: '2030-901A', wk: -100, la: -100 }));
}, 'alive');

await runCase('② 超长名称（200 字符）：不崩、仍有行', m => {
  m.gw.sats.push(baseSat({ id: 990002, c: '2030-902A', wn: '超长名称'.repeat(50) }));
}, 'alive');

await runCase('③ 缺失 wk（undefined）：不崩', m => {
  m.gw.sats.push(baseSat({ id: 990003, c: '2030-903A', wk: undefined }));
}, 'alive');

await runCase('④ wk 为 NaN：不崩', m => {
  m.gw.sats.push(baseSat({ id: 990004, c: '2030-904A', wk: NaN }));
}, 'alive');

await runCase('⑤ 非法 COSPAR（BAD-01）：不崩', m => {
  m.gw.sats.push(baseSat({ id: 990005, c: 'BAD-01' }));
}, 'alive');

await runCase('⑥ 极端倾角（180°）：不崩', m => {
  m.gw.layers.push({ alt: 500, inc: 180, n: 1, sd: 0 });
}, 'alive');

await runCase('⑦ 空批次（launches={}）：不崩', m => {
  m.gw.launches = {};
}, 'alive');

await runCase('⑧ 重复 NORAD（两颗同 id）：不崩', m => {
  m.gw.sats.push(baseSat({ id: 990006, c: '2030-906A' }));
  m.gw.sats.push(baseSat({ id: 990006, c: '2030-906B', wn: '重复星' }));
}, 'alive');

await runCase('⑨ 整批 launches 含 null 值：不崩', m => {
  m.gw.launches['99999'] = null;
}, 'alive');

await runCase('⑩ layers 为空数组：不崩', m => {
  m.gw.layers = [];
}, 'alive');

// ★★ V2.0.0.630（深入探测）：**非有限数值**是"永久循环"的真实入口 ★★
//   背景：`wrapLon()` 旧实现是 `while (lon > 180) lon -= 360`，遇到 ±Infinity 会**永远减不完**。
//   那些经度不只来自地图点击，也来自 SGP4 传播结果 —— 极端 TLE（偏心率接近 1 等）可能算出
//   Infinity。所以这里直接注入非有限值，验证页面既不崩、也不卡死。
await runCase('⑪ wk 为 Infinity：不崩', m => {
  m.gw.sats.push(baseSat({ id: 990007, c: '2030-907A', wk: Infinity }));
}, 'alive');

await runCase('⑫ orb 为非法值（7）：不崩', m => {
  m.gw.sats.push(baseSat({ id: 990008, c: '2030-908A', orb: 7 }));
}, 'alive');

await runCase('⑬ launches 的日期为 NaN 字符串：不崩', m => {
  m.gw.launches['99998'] = ['坏日期批次', 'not-a-date', 'CZ-5', '文昌', 50, 'ok'];
}, 'alive');

console.log(`\nPASS: ${pass}  FAIL: ${fail}`);
process.exit(fail ? 1 : 0);
