// GitHub Actions 专用：抓卫星百科词条 → 解析顶部统计 → 更新 wiki.json
// 运行环境：ubuntu-latest + playwright（chromium）。抓不到时以非零码退出，Actions 会标红。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'wiki.json');
const PAGES = [
  ['gw', 'https://sat.huijiwiki.com/wiki/%E6%98%9F%E7%BD%91', '星网'],
  ['qf', 'https://sat.huijiwiki.com/wiki/%E5%8D%83%E5%B8%86%E6%98%9F%E5%BA%A7', '千帆星座'],
];

// infobox 里 label 后面的 data 单元格
function cellAfter(html, label) {
  const i = html.indexOf(label);
  if (i < 0) return '';
  const j = html.indexOf('infobox-data', i);
  if (j < 0) return '';
  const k = html.indexOf('>', j) + 1;
  const e = html.indexOf('</td>', k);
  return e > k ? html.slice(k, e).trim() : '';
}
// 「试验星32+高轨业务星3+低轨业务星213」→ 英文（机械词替换，未识别的保持中文）
function toEn(zh) {
  return zh
    .replace(/试验星(\d+)/g, 'test $1').replace(/高轨业务星(\d+)/g, 'GEO service $1')
    .replace(/低轨业务星(\d+)/g, 'LEO service $1').replace(/组网星(\d+)/g, 'network $1')
    .replace(/\+/g, ' + ').replace(/，/g, ', ');
}
function parseStats(html) {
  const launchedRaw = cellAfter(html, '发射卫星数量');
  const inOrbitRaw = cellAfter(html, '在轨卫星数量');
  const launches = cellAfter(html, '发射成功次数/发射总次数');
  if (!launchedRaw || !inOrbitRaw || !/\d+\/\d+/.test(launches)) return null;
  function split(raw) {
    const m = raw.match(/^(\d+)\s*[（(]([^)）]*)[)）]/);
    return { n: m ? +m[1] : parseInt(raw, 10) || 0, zh: m ? m[2].trim() : raw };
  }
  const L = split(launchedRaw), I = split(inOrbitRaw);
  return {
    launched: { n: L.n, zh: L.zh, en: toEn(L.zh) },
    inOrbit: { n: I.n, zh: I.zh, en: toEn(I.zh) },
    launches: launches.match(/\d+\/\d+/)[0]
  };
}

const stats = {};
for (const [key, url, article] of PAGES) {
  let browser;
  try { browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'] }); }
  catch (e) { browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'] }); }
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
  });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // 过 WAF 验证：轮询标题直到不再是「请稍候…」（本机实测 20–35s，Actions 上给足 90s）
  let ok = false;
  for (let i = 0; i < 45; i++) {
    await page.waitForTimeout(2000);
    const title = await page.title().catch(() => '');
    if (title && !/请稍候/.test(title)) { ok = true; break; }
  }
  if (!ok) { await browser.close(); throw new Error(key + ' 词条未通过验证'); }
  await page.waitForTimeout(1500);
  const html = await page.evaluate(() => document.body.innerHTML);
  const st = parseStats(html);
  if (!st) {
    const hasBox = html.includes('infobox-label');
    const dbg = hasBox
      ? html.slice(html.indexOf('infobox-label') - 60, html.indexOf('infobox-label') + 500).replace(/\s+/g, ' ')
      : '(页面里没有 infobox-label；html 长度 ' + html.length + '；标题 ' + (await page.title().catch(() => '?')) + ')';
    await browser.close();
    throw new Error(key + ' 解析失败。调试: ' + dbg);
  }
  stats[key] = Object.assign({ asOf: new Date().toISOString().slice(0, 10), article }, st);
  console.log(key, '→', JSON.stringify(stats[key]));
  await browser.close();
}

// 与现有 wiki.json 对比：数字或说明有变才写（避免无意义提交）
const old = JSON.parse(fs.readFileSync(OUT, 'utf8'));
const same = ['gw', 'qf'].every(k =>
  old[k] && old[k].launched.n === stats[k].launched.n &&
  old[k].inOrbit.n === stats[k].inOrbit.n && old[k].launches === stats[k].launches);
if (same) { console.log('统计无变化，跳过更新'); process.exit(0); }

stats._readme = old._readme;
stats.asOf = new Date().toISOString().slice(0, 10);
fs.writeFileSync(OUT, JSON.stringify(stats, null, 1) + '\n', 'utf8');
console.log('wiki.json 已更新');
