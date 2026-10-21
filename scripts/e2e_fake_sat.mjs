// scripts/e2e_fake_sat.mjs —— §10 后半：**假卫星端到端**
// 目的：证明"扫入一颗常规/不常规的新卫星"时，整条链路（内嵌数据 → 差分解包 → SGP4 → 三态字段
//   → 表格 → 搜索 → 状态列文案）都能正常吞下它，而不是在某一层静默丢掉或崩掉。
//
// 做法（不碰仓库里的产物，全程在系统临时目录）：
//   ① 读 CISTrack.html，取出内嵌的 window.SATDATA JSON；
//   ② 从星网里挑一颗真实卫星，按**同一套差分算法**解出它的 l1/l2，克隆成一颗假星
//      （新 NORAD 999999、新名字、三态字段手填为"在轨 @1150km"）；
//   ③ 把假星塞进 gw.sats，重写成一份临时 HTML；
//   ④ 用 jsdom 打开，断言：表格能找到它、搜索能搜到它、状态列按三态文案渲染。
//
// 为什么值得单独一个脚本而不是塞进 smoke：它需要**改产物再跑**（多一次 jsdom 启动 + 一次
//   大 JSON 解析），放进 CI 每次都要多付这几秒；而它守的是"新增一条数据会不会被吃掉"这类
//   低频风险，手工/发版前跑一次即可。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require('jsdom');
const B = fileURLToPath(new URL('..', import.meta.url));
const html = fs.readFileSync(path.join(B, 'CISTrack.html'), 'utf8');

const B64C = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function unpack(s, tpls) {
  const tpl = tpls && tpls[s.c.slice(0, 5)];
  if (!tpl || s.l1) return s;
  const bits = new Array(162); let k = 0;
  for (let i = 0; i < tpl.m.length; i++) {
    const v = B64C.indexOf(tpl.m.charAt(i));
    for (let j = 5; j >= 0; j--) { if (k < 162) bits[k++] = (v >> j) & 1; }
  }
  let rec = '', fi = 0, di = 0;
  for (let p = 0; p < 162; p++) rec += bits[p] ? tpl.f.charAt(fi++) : s.d.charAt(di++);
  return { name: rec.slice(0, 24).trim(), id: s.id, c: s.c, l1: rec.slice(24, 93), l2: rec.slice(93, 162) };
}

// ① 取内嵌 JSON
const tag = 'window.SATDATA=';
const i0 = html.indexOf(tag);
if (i0 < 0) { console.error('找不到 window.SATDATA'); process.exit(1); }
let i1 = i0 + tag.length;
// 内嵌 JSON 后面还跟着别的语句（不是直接 </script>）→ 用**花括号配对**扫出对象结束位置，
//   扫描时跳过字符串与转义（JSON 里的 `{` `}` 都出现在字符串里，不跳会提前收尾）。
{
  let dep = 0, inStr = false, esc = false;
  for (; i1 < html.length; i1++) {
    const ch = html[i1];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') dep++;
    else if (ch === '}') { dep--; if (dep === 0) { i1++; break; } }
  }
}
const raw = html.slice(i0 + tag.length, i1);
const DATA = JSON.parse(raw);
const doc = unpack(DATA.gw.sats[0], DATA.gw.tleTpl);
if (!doc.l1 || !doc.l2) { console.error('取样卫星解不出 TLE'); process.exit(1); }

// ② 造一颗假星：常规轨道要素 + 不常规的三态（在轨 1150km）
const FAKE_ID = 999999, FAKE_NAME = 'ZZZ TEST SAT';
const fake = {
  id: FAKE_ID, c: '99999A', name: FAKE_NAME,
  l1: doc.l1.slice(0, 2) + String(FAKE_ID).padStart(5, '0').slice(-5) + doc.l1.slice(7),
  l2: doc.l2,
  orb: 0, wk: 1150, od: '2026-10-01'
};
DATA.gw.sats.push(fake);
const html2 = html.slice(0, i0 + tag.length) + JSON.stringify(DATA) + html.slice(i1);

// ③ 临时文件 + jsdom
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cistrack-fake-'));
const file = path.join(dir, 'CISTrack.html');
fs.writeFileSync(file, html2, 'utf8');
const vc = new VirtualConsole();
const errs = [];
vc.on('jsdomError', e => errs.push(String(e && e.message)));
const dom = new JSDOM(html2, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc,
  beforeParse(w) {
    w.HTMLCanvasElement.prototype.getContext = function () {
      if (!this.__c) this.__c = new Proxy({}, { get: (t, k) => k === 'measureText' ? () => ({ width: 24 }) : (() => { }), set: () => true });
      return this.__c;
    };
    w.HTMLCanvasElement.prototype.toBlob = cb => cb(null);
    w.Element.prototype.getBoundingClientRect = function () {
      const h = this.tagName === 'TR' ? 41 : 460;
      return { left: 0, top: 0, x: 0, y: 0, width: 900, height: h, right: 900, bottom: h };
    };
    w.scrollTo = () => { }; w.scrollBy = () => { };
    Object.defineProperty(w, 'innerHeight', { value: 4000, configurable: true });
    Object.defineProperty(w, 'innerWidth', { value: 1400, configurable: true });
  }
});
await new Promise(r => setTimeout(r, 2600));
const d = dom.window.document;
let fail = 0;
const ok = (name, cond, extra) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? '  → ' + extra : ''));
  if (!cond) fail++;
};

ok('假星进了内嵌数据（window.SATDATA.gw.sats）',
  dom.window.SATDATA.gw.sats.some(s => s.id === FAKE_ID));
ok('假星的 TLE 能过 SGP4（页面没有因它崩）', errs.filter(e => /jsdomError/.test(e)).length === 0,
  errs.slice(0, 2).join(' | '));

// 搜索：名字与 NORAD 两条路
const ti = d.getElementById('tableSearch');
const search = q => {
  ti.value = q;
  ti.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  return d.querySelector('#tbody tr[data-idx]');
};
const rowName = search('ZZZ TEST');
ok('按名字能搜到假星', !!rowName && /ZZZ/.test(rowName.textContent), rowName && rowName.textContent.slice(0, 60));
const rowId = search(String(FAKE_ID));
ok('按 NORAD 能搜到假星', !!rowId && /ZZZ/.test(rowId.textContent));
// ★ V1.9.8：NORAD 右侧新增了 COSPAR 列 → 「在轨状态」从索引 2 挪到 3
const cell = rowId && rowId.querySelectorAll('td')[3];
// ★ V1.9.9（N5/Q5=A）：分隔符全状态统一半角逗号 —— 在轨 / 变轨中 / 已再入同一口径
// ★★ V2.0.0（2026-10-22）：**三态 → 四态**。Q26 把笼统的「在轨」拆成
//   「在轨·正常」与「在轨·可能异常」两种，所以这里的期望文案必须跟着改。
//   旧断言写的是 `^在轨（…）$`，在四态下**必然挂** —— 这不是产品缺陷，是断言过期。
//   判据改成"正常态"的精确文案：假星被手填为 orb=0（在轨）+ 有 od（到位日期）+ 无 abn，
//   所以应落在「在轨·正常」，且仍带逗号分隔的日期与高度。
ok('状态列按四态文案渲染（在轨·正常 ~2026-10-01, 1150km）',
  !!cell && /^在轨·正常（~2026-10-01, 1150km）$/.test(cell.textContent.trim()),
  cell && JSON.stringify(cell.textContent.trim()));

// 收尾
try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
console.log(fail ? ('✗ ' + fail + ' 项失败') : '✓ 全部通过');
process.exit(fail ? 1 : 0);
