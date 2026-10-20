/* scripts/cdp.mjs —— ★ V1.9.9.630：**卫星百科抓取的唯一通路实现**
 * ---------------------------------------------------------------------------
 * 为什么必须有这个文件（这轮"治本"的核心）：
 *   本仓库有四个脚本要过卫星百科的 Cloudflare WAF：
 *     · `fetch_wiki.mjs`          → 词条统计（wiki.json）
 *     · `fetch_wiki_tables.mjs`   → 词条表单源（data/wiki_tables.json）
 *     · `fetch_wiki_cards.mjs`    → 单星卡片（data/wiki_cards.json）
 *     · `fetch_launch_results.mjs`→ 发射记录（wiki_launches.json）
 *   它们原来**各写一份**「找浏览器 / 起 CDP / 判挑战页过没过」。四份实现强弱不一，
 *   于是留下了一个**反复复发**的 bug 家族 —— 同一处判据在 A 文件修好，B/C/D 照旧错：
 *
 *   ① 挑战页判据（**最致命，静默丢数据**）
 *        `fetch_wiki.mjs` 在 V1.9.3（2026-10-14）修过：Cloudflare 挑战页的标题是
 *        **英文** `Just a moment...`，不含"请稍候"；只认中文的判据会把挑战页判成
 *        "已通过 WAF"，然后去解析那 5.7KB 的挑战页 → 0 行 → **当成"上游没数据"**。
 *        但这次修复**没有传导**：`fetch_launch_results.mjs:192` 至今仍是
 *        `if (title && !/请稍候/.test(title))` → 抓发射记录时同样会把挑战页当成功，
 *        结果是某一年"页面行 0，保留 0" —— 日志看着像"那一年真没有发射"。
 *   ② 依赖（**开源使用者 clone 后必崩**）
 *        `fetch_wiki_tables.mjs` / `fetch_wiki_cards.mjs` 用 `require('ws')`，而 `ws` 是
 *        devDependency、`node_modules` 不入库 → `ERR_MODULE_NOT_FOUND`。
 *        `fetch_wiki.mjs` 早已改用 Node ≥22 自带的 WebSocket，另两个没跟上。
 *   ③ 浏览器路径
 *        `fetch_wiki_cards.mjs` 写死 `C:\Program Files (x86)\...\msedge.exe` → 换台机器就废。
 *
 *   ⇒ 本模块把这四件事收成**一份**：`findBrowser()` / `openCdp()` / `CHALLENGE_RE` /
 *     `waitContent()`。四个脚本改为调用它，**判据只存在一处**，修一次全都对。
 *
 * 设计约束（重要，别破坏）：
 *   · **零 npm 依赖** —— 只用 Node 内置（`WebSocket` 需 Node ≥ 22；`fetch` 需 ≥ 18）。
 *     内置 WebSocket 是 WHATWG 风格（`addEventListener` / `onopen`），**没有** `ws` 的
 *     `.on()` / `.once()`；本模块只暴露 WHATWG 那套，调用方不得再用 `.on()`。
 *   · **不改变各脚本原有的等待/重试节奏**。每个调用点自己传 `waitMs` / `tries`，
 *     因为它们的取舍本来就不同（`api.php` 不值得等 180s，页面需要）。
 *   · 浏览器 profile 支持**复用常驻目录**（参数 `profileDir`）—— 本机实测：全新 profile 的
 *     首次 Cloudflare 挑战耗时 2s ~ >136s 剧烈波动，而预热过（已存 `cf_clearance`）的首屏
 *     1.6~2.0s。所以 `fetch_wiki_tables` 与 `fetch_wiki_cards` 共用同一个 profile 是**故意**的。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

/** 本模块统一使用的 UA（与各脚本原值逐字一致，改它等于改站点看到的东西，别顺手改）。 */
export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * ★★ 挑战页判据 —— **全仓库唯一权威**。
 *   必须同时覆盖中英文与几种常见变体：实测见过 `请稍候…`（中文站）、`Just a moment...`、
 *   `Attention Required! | Cloudflare`（拦截而非挑战）、`Checking your browser before accessing`。
 *   ⚠️ 判据只回答"**这是不是挑战页**"，绝不回答"内容到了没" ——
 *     后者必须由调用方用 `contentProbe` 另行确认（见 `waitContent`）。
 *     只判标题的写法在 V1.9.3 之前的 `fetch_wiki.mjs` 里翻过车：标题正常但正文是挑战壳。
 */
export const CHALLENGE_RE = /请稍候|just a moment|checking your browser|verify(ing)? you are|cf-challenge|attention required|enable javascript and cookies|ddos protection/i;

/** 标题是否"像挑战页"（null/空串也算没过 —— 页面还没加载出来）。 */
export function isChallengeTitle(title) {
  return !title || CHALLENGE_RE.test(String(title));
}

/**
 * 找一个可用的 Chromium 系浏览器。**候选顺序固定**，环境变量优先于内置路径。
 * @returns {string|null} 可执行文件绝对路径；一个都没有 → null（调用方必须给出清晰报错）
 */
export function findBrowser() {
  const cands = [
    process.env.CISTRACK_EDGE,
    process.env.EDGE_PATH,
    process.env.CHROME_PATH,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/microsoft-edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ].filter(Boolean);
  for (const c of cands) {
    try { if (fs.existsSync(c)) return c; } catch (e) { /* 没权限/不存在都跳过 */ }
  }
  // ★★ V1.9.9.630（治本）：**再去 Playwright / Puppeteer 的浏览器缓存里找**。
  //   为什么必须有这一步（这是本轮抓出来的真实缺陷，不是假想）：
  //     `update-wiki.yml` 用 `npm i playwright && npx playwright install chromium` 准备浏览器，
  //     而它装到的是 `~/.cache/ms-playwright/chromium-XXXX/chrome-linux/chrome` ——
  //     **不在**上面任何一条固定路径里，也**不在** PATH 里。
  //     于是 `findBrowser()` 返回 null → 抛「找不到 Edge/Chrome —— 请装一个」，
  //     而 CI **明明装好了**。这种"装了却报没装"的报错会把人带偏（去查安装，实际是查找逻辑缺一步）。
  //   取舍：只认**目录结构明确**的缓存布局，不递归全盘搜（否则在用户机器上会扫成大几十秒）。
  const cacheRoots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    process.env.PUPPETEER_CACHE_DIR,
    path.join(os.homedir(), '.cache', 'ms-playwright'),          // Linux / CI
    path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'), // macOS
    path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright'),  // Windows
    path.join(os.homedir(), '.cache', 'puppeteer'),                // Puppeteer 旧布局
  ].filter(Boolean);
  // 各平台在 chromium 包内的相对位置（新版 packaged 版本号目录 + 旧版扁平结构都覆盖）
  const inner = process.platform === 'win32'
    ? ['chrome-win/chrome.exe', 'chrome-win64/chrome.exe']
    : process.platform === 'darwin'
      ? ['chrome-mac/Chromium.app/Contents/MacOS/Chromium',
         'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium']
      : ['chrome-linux/chrome', 'chrome-linux64/chrome'];
  for (const root of cacheRoots) {
    let dirs = [];
    try {
      dirs = fs.readdirSync(root).filter((d) => /^chromium/i.test(d)).sort().reverse(); // 新版本号优先
    } catch (e) { continue; }   // 目录不存在 = 这台机器没装，正常跳过
    for (const d of dirs) {
      for (const rel of inner) {
        const p = path.join(root, d, rel);
        try { if (fs.existsSync(p)) return p; } catch (e) {}
      }
    }
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 最小 CDP 客户端（WHATWG WebSocket 版，仅 Node 内置即可用）。
 * @param {string} wsUrl
 * @returns {{send:Function, ev:Function, close:Function, ready:Promise}}
 *   · `send(method, params)` → Promise<result>，CDP 报错会 reject；
 *   · `ev(expr, awaitPromise?)` → Promise<any>，页面内求值，取 `returnByValue`；
 *     页面内抛异常 → reject（**不要**把异常当成 undefined 吞掉，那会变成静默失败）。
 */
export function openCdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pend = new Map();
  const ready = new Promise((res, rej) => {
    ws.addEventListener('open', () => res(), { once: true });
    ws.addEventListener('error', (e) => rej(new Error('WS 连接失败：' + ((e && e.message) || '未知'))), { once: true });
  });
  ws.addEventListener('message', (m) => {
    // ⚠️ 内置 WebSocket 的 message 事件是 MessageEvent，数据在 `.data`（可能是 string 或 Blob）；
    //   本模块只处理 string（CDP 一律回文本 JSON）。
    const raw = typeof m.data === 'string' ? m.data : '';
    if (!raw) return;
    let d; try { d = JSON.parse(raw); } catch (e) { return; }
    if (d.id && pend.has(d.id)) { const f = pend.get(d.id); pend.delete(d.id); f(d); }
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id;
    pend.set(i, (d) => (d.error
      ? rej(new Error(method + ': ' + (d.error.message || JSON.stringify(d.error))))
      : res(d.result || {})));
    try { ws.send(JSON.stringify({ id: i, method, params })); }
    catch (e) { pend.delete(i); rej(e); }
  });
  const ev = async (expr, awaitPromise) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: !!awaitPromise });
    if (r.exceptionDetails) {
      const d = (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || '';
      throw new Error('页面内报错: ' + (d || JSON.stringify(r.exceptionDetails).slice(0, 200)));
    }
    return r.result ? r.result.value : undefined;
  };
  return { send, ev, ready, close: () => { try { ws.close(); } catch (e) {} } };
}

/**
 * 起一个无头 Chromium 并连上它的**页面级** CDP 目标。
 * @param {object} opt
 * @param {string}  [opt.profileDir]  user-data-dir。传固定路径 → 跨次复用（保住 cf_clearance）；
 *                                    不传 → 每次 mkdtemp 新建（用完由 `cleanup()` 删）。
 * @param {number}  [opt.port]        固定调试端口；不传 → 0（由浏览器自选，读 DevToolsActivePort）。
 * @param {string}  [opt.tmpRoot]     mkdtemp 的父目录（本机应优先非系统盘，见 tmproot.mjs）。
 * @param {number}  [opt.bootMs]      等调试端口的总时长，默认 30000（CI 冷启动实测要 5~15s）。
 * @returns {Promise<{c:object, child:object, cleanup:Function}>}
 */
export async function openBrowser(opt = {}) {
  const exe = findBrowser();
  if (!exe) {
    // 报错里把**查过的位置**列出来 —— 否则"我明明装了却报没装"这种情况无从下手。
    //   CI 上最常见的就是「playwright 装好了，但装在我们没查的目录」。
    throw new Error('找不到 Edge/Chrome —— 已查：常见安装路径 + PATH 无关的固定位置'
      + ' + Playwright/Puppeteer 缓存（~/.cache/ms-playwright、~/AppData/Local/ms-playwright 等）。'
      + '处置：① 装一个 Chromium 系浏览器；② 或用环境变量 CISTRACK_EDGE / EDGE_PATH / CHROME_PATH '
      + '指定可执行文件绝对路径（CI 里推荐 `npx playwright install chromium` 后用 '
      + '`CISTRACK_EDGE=$(node -e "console.log(require(\'playwright\').chromium.executablePath())")` 传入）。');
  }
  const tmpRoot = opt.tmpRoot || process.env.TMP || process.env.TEMP || '/tmp';
  let udd = opt.profileDir || null;
  let tempProfile = false;
  if (!udd) {
    // mkdtemp 前缀用进程 pid 区分并发实例；失败（父目录不存在等）退到系统临时目录再试一次
    try { udd = fs.mkdtempSync((tmpRoot.replace(/[\\/]+$/, '')) + '/cistrack-cdp-'); }
    catch (e) { udd = fs.mkdtempSync('/tmp/cistrack-cdp-'); }
    tempProfile = true;
  } else {
    // ★★ 必须**绝对化** profileDir。踩过（2026-10-21）：调用方传相对名 'edge-profile-xxx' 时，
    //   这里 `fs.mkdirSync(recursive)` 按 **Node 的 cwd** 建目录，而 Edge 收到
    //   `--user-data-dir=<相对名>` 后按**它自己的基准**解析 —— 两边不一致 →
    //   `DevToolsActivePort` 永远不出现 → 白等 bootMs 后报"无 stderr 输出"，
    //   而错误信息里完全看不出是路径问题（我因此误判了两轮）。
    //   ⇒ 统一 path.resolve()，让"相对"与"绝对"调用方行为一致。
    udd = path.resolve(udd);
    try { fs.mkdirSync(udd, { recursive: true }); } catch (e) {}
  }
  const portFile = udd.replace(/[\\/]+$/, '') + '/DevToolsActivePort';
  const useFixedPort = typeof opt.port === 'number' && opt.port > 0;

  const args = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--mute-audio',
    // 容器/CI：sandbox 用不了（无 CAP_SYS_ADMIN）→ Chrome 静默退出；/dev/shm 只有 64MB → 会崩。
    // 这两条在 Windows 上无害（Chrome 接受但不改变行为），所以本机不受影响。
    '--no-sandbox', '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled',
    '--user-data-dir=' + udd,
    '--remote-debugging-port=' + (useFixedPort ? String(opt.port) : '0'),
    '--window-size=1600,1200',
    '--user-agent=' + (opt.ua || UA),
    'about:blank',
  ];
  // stderr 不 ignore：浏览器起不来时把它的抱怨带出来，否则只有一句"端口没起来"什么都看不出
  const child = spawn(exe, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  try { child.stderr.on('data', (b) => { stderr += String(b).replace(/\r/g, ''); }); } catch (e) {}

  const cleanup = () => {
    try { child.kill(); } catch (e) {}
    // ★ 必须**杀掉整棵进程树**：Windows 上 msedge 会拉起若干子进程，
    //   只 kill 父进程会留下孤儿占着 profile 锁 → 下一轮"端口起不来"。
    try { if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) {}
    if (tempProfile) {
      // 延迟删：给浏览器一点时间释放句柄。删不掉也不致命（临时目录），但必须**吞掉异常**，
      // 否则 cleanup 会在 finally 里抛错，把真正的失败原因盖掉。
      setTimeout(() => { try { fs.rmSync(udd, { recursive: true, force: true }); } catch (e) {} }, 400);
    }
  };

  try {
    // 拿端口：固定端口 → 直接轮询 /json/list；端口 0 → 读 DevToolsActivePort 第一行
    const bootMs = opt.bootMs || 30000;
    const deadline = Date.now() + bootMs;
    let port = useFixedPort ? opt.port : 0;
    if (!port) {
      while (Date.now() < deadline) {
        await sleep(100);
        try {
          const t = String(fs.readFileSync(portFile, 'utf8')).split(/\r?\n/)[0];
          port = parseInt(t, 10) || 0;
        } catch (e) { /* 还没写出来 */ }
        if (port) break;
      }
    } else {
      // 固定端口也已经要等浏览器真正监听，交给下面的 /json/list 轮询
    }
    if (!port) {
      throw new Error('浏览器没能在 ' + Math.round(bootMs / 1000) + 's 内启动调试端口' +
        (stderr ? '；浏览器 stderr: ' + stderr.slice(0, 500) : '（无 stderr 输出）'));
    }
    // ⚠️ 要操作页面必须连 /json/list 里的 **page** 目标；
    //    /json/version 给的是浏览器级 WS，只支持 Browser.* 域（会报 "Page.enable wasn't found"）。
    let page = null;
    while (Date.now() < deadline) {
      try {
        const j = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
        page = j.find((t) => t.type === 'page' && t.webSocketDebuggerUrl) || null;
      } catch (e) { /* 端口刚开还没就绪 */ }
      if (page) break;
      await sleep(100);
    }
    if (!page) throw new Error('拿不到页面调试目标（端口 ' + port + '）');
    const c = openCdp(page.webSocketDebuggerUrl);
    await c.ready;
    await c.send('Page.enable');
    await c.send('Runtime.enable');
    return { c, child, cleanup, exe, port };
  } catch (e) {
    cleanup();
    throw e;
  }
}

/**
 * 打开一个 URL 并**确认内容真的到了**（不只是标题正常）。
 *
 * 两道判据缺一不可（这是 V1.9.3 那次教训的固化）：
 *   ① 标题不像挑战页；
 *   ② `contentProbe` 求值为真 —— 传一个**页面内表达式字符串**，返回真值才算内容到位。
 *      例：`'document.body.innerHTML.indexOf("infobox-label")>=0'`。
 *      不传 → 退化为只判标题（并把这一点写进返回值，便于调用方在日志里区分可信度）。
 *
 * @param {object} c   `openCdp` / `openBrowser` 返回的客户端
 * @param {string} url
 * @param {object} [opt]
 * @param {number} [opt.tries=2]      挑战不过时的重试次数（每次都会重新 navigate）
 * @param {number} [opt.waitMs=90000] 单次最长等待
 * @param {number} [opt.pollMs=1500]  轮询间隔
 * @param {string} [opt.contentProbe] 页面内表达式，返回真值代表内容到位
 * @param {number} [opt.backoffMs]    重试前的退避（默认 0；cards 脚本传随机 30~60s）
 * @returns {Promise<{ok:boolean, title:string, probed:boolean}>}
 */
export async function waitContent(c, url, opt = {}) {
  const tries = opt.tries || 2;
  const waitMs = opt.waitMs || 90000;
  const pollMs = opt.pollMs || 1500;
  const probe = opt.contentProbe || '';
  const backoff = typeof opt.backoffMs === 'function' ? opt.backoffMs : () => (opt.backoffMs || 0);
  let title = '';
  for (let attempt = 0; attempt < tries; attempt++) {
    if (attempt) {
      const b = backoff(attempt);
      if (b > 0) await sleep(b);
    }
    try { await c.send('Page.navigate', { url }); } catch (e) { /* 坏了下一轮重试 */ }
    const t0 = Date.now();
    while (Date.now() - t0 < waitMs) {
      await sleep(pollMs);
      try { title = await c.ev('document.title'); } catch (e) { title = ''; }
      if (isChallengeTitle(title)) continue;
      if (!probe) return { ok: true, title: String(title), probed: false };
      let hit = false;
      try { hit = !!(await c.ev(probe)); } catch (e) { hit = false; }
      if (hit) {
        // 内容刚渲染出来时页面可能还在补 DOM，给一个很短的稳定窗口（与原 scripts 的 800ms 一致）
        if (opt.settleMs !== 0) await sleep(opt.settleMs || 800);
        return { ok: true, title: String(title), probed: true };
      }
    }
  }
  return { ok: false, title: String(title || ''), probed: !!probe };
}

/**
 * 一次性的"浏览器可用性自检" —— 供 CI / 计划任务在跑真正的抓取前先确认环境。
 * 不联网，只验证：找得到浏览器 + 能起来 + 能连 CDP + 能求值。
 * @returns {Promise<{ok:boolean, exe?:string, err?:string}>}
 */
export async function selfCheck(opt = {}) {
  let h = null;
  try {
    h = await openBrowser(opt);
    const v = await h.c.ev('1+1');
    if (v !== 2) throw new Error('CDP 求值异常（1+1 得到 ' + JSON.stringify(v) + '）');
    return { ok: true, exe: h.exe };
  } catch (e) {
    return { ok: false, err: String((e && e.message) || e) };
  } finally {
    if (h) h.cleanup();
  }
}