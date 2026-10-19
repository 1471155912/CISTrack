/* check_gh_status.mjs —— ★ V1.9.9 补入（2026-10-20）：**发布链路的平台状态探针**
 * ---------------------------------------------------------------------------
 * 为什么要有它（2026-10-19 的真实教训）：
 *   v1.9.9 推上去以后，Pages 一直不更新。我以为是自己的问题，于是反复查构建、反复整份下载线上
 *   HTML（1.7 MB，单个 curl 还超时），看起来就像"卡死/死循环"。最后查 githubstatus 才发现是
 *   **GitHub 平台事件**：`Degraded availability for GitHub Actions, GitHub Pages and Webhooks`
 *   （impact=critical），Pages 组件 = `degraded_performance`，构建 `Page build failed`（duration 0）。
 *
 *   教训不是"再等久一点"，而是：**先分清"平台坏了"还是"我坏了"**。
 *   所以有了这个探针：一条命令看清本项目依赖的三个服务（Pages / Actions / API Requests）现在是否可用，
 *   并给出**明确动作**（可以验线上 / 别等 / 立刻停手）。
 *
 * 设计约束（都是被上面那次事故逼出来的）：
 *   ① **绝不轮询**：每次运行只发 1 次状态请求（`--verify` 再加 1 次页面请求），没有 while/重试循环；
 *   ② **每个请求都有硬超时**：状态 8s、页面 10s；超时就下结论"未知"，而不是继续等；
 *   ③ **退出码能直接用来做闸门**：脚本可以被人跑，也可以被别的脚本调用；
 *   ④ **不改任何文件、不发任何请求体**：纯只读探测。
 *
 * 用法：
 *   node scripts/check_gh_status.mjs               # 看平台状态（人类可读）
 *   node scripts/check_gh_status.mjs --json        # 机器可读（给脚本/自动化用）
 *   node scripts/check_gh_status.mjs --quiet       # 只打一行结论
 *   node scripts/check_gh_status.mjs --verify      # 平台正常时，顺带核对**线上版本号**（一次，不重试）
 *   node scripts/check_gh_status.mjs --verify --url <页面地址>
 *
 * 退出码：
 *   0  OK        三个依赖服务全部 operational（--verify 时还要求线上版本一致）
 *   2  版本不一致  平台正常，但线上还是旧版本（构建排队/失败 → 去查 Pages 构建记录）
 *   7  DEGRADED  有服务降级（能跑但慢/偶发失败）——**此时"线上没更新"不该算本项目的 bug**
 *   8  OUTAGE    有依赖服务 major/partial outage —— 停止部署与等待，恢复后再做
 *   9  UNKNOWN   连不上状态接口（本机网络/代理问题）—— 不要据此下结论，更不要循环重试
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const STATUS_URL = 'https://www.githubstatus.com/api/v2/summary.json';
const INCIDENT_URL = 'https://www.githubstatus.com/api/v2/incidents/unresolved.json';
const DEFAULT_PAGE = 'https://1471155912.github.io/CISTrack/CISTrack.html';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const argOf = (f, d) => { const i = argv.indexOf(f); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const JSON_OUT = has('--json');
const QUIET = has('--quiet');
const VERIFY = has('--verify');
const PAGE_URL = argOf('--url', DEFAULT_PAGE);

// 本项目真正依赖的服务（改这里就等于改判据）
//   Pages   = 站点托管（线上页面能不能更新）
//   Actions = 每 12 小时的自动更新工作流
//   API     = gh CLI 发 Release / 查构建记录
const REQUIRED = [
  { key: 'Pages', label: '站点托管（线上页面）' },
  { key: 'Actions', label: '定时更新工作流' },
  { key: 'API Requests', label: 'gh CLI / Release 接口' },
];
// 只作参考、不参与判定
const CONTEXT = ['Webhooks', 'Git Operations', 'Pull Requests'];

const RANK = { operational: 0, under_maintenance: 1, degraded_performance: 2, partial_outage: 3, major_outage: 4 };
const ZH = {
  operational: '正常',
  under_maintenance: '维护中',
  degraded_performance: '降级（慢/偶发失败）',
  partial_outage: '部分中断',
  major_outage: '大面积中断',
};
const rank = (s) => (RANK[s] === undefined ? 1 : RANK[s]);   // 未知状态按"维护中"看待，不当作正常

function bj(iso) {
  const t = Date.parse(iso || '');
  if (!isFinite(t)) return '?';
  const d = new Date(t + 8 * 3600 * 1000);
  return d.toISOString().slice(0, 16).replace('T', ' ') + '（北京时间）';
}

/** 单次 GET（带硬超时）→ JSON；失败返回 null（**不重试**，这是刻意设计） */
async function getJson(url, timeoutMs) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { 'Cache-Control': 'no-cache' } });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  } finally {
    clearTimeout(to);
  }
}

/** 只读线上页面的**前若干字节**，找 `var VERSION = 'Vx.y.z'`（一次请求，带 Range 与硬超时） */
async function readLiveVersion(url, maxBytes, timeoutMs) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: { Range: 'bytes=0-' + (maxBytes - 1), 'Cache-Control': 'no-cache' },
    });
    if (!res.ok) return { ok: false, why: 'HTTP ' + res.status };
    const reader = res.body.getReader();
    const parts = [];
    let got = 0, text = '';
    while (got < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(Buffer.from(value));
      got += value.length;
      text = Buffer.concat(parts).toString('utf8');
      if (/var VERSION\s*=/.test(text)) break;     // 找到就停，不把整份 1.7 MB 拉完
    }
    try { await reader.cancel(); } catch (e) { /* 已经读完 */ }
    const m = /var VERSION\s*=\s*'([^']+)'/.exec(text);
    if (!m) return { ok: false, why: '前 ' + Math.round(maxBytes / 1024) + ' KB 里没找到 VERSION（线上文件异常）', bytes: got };
    return { ok: true, version: m[1], bytes: got };
  } catch (e) {
    return { ok: false, why: (e && e.name === 'AbortError') ? ('超时 ' + timeoutMs + 'ms') : ('请求失败：' + (e && e.message)) };
  } finally {
    clearTimeout(to);
  }
}

function localVersion() {
  try {
    const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
    const m = /var VERSION\s*=\s*'([^']+)'/.exec(src);
    return m ? m[1] : '';
  } catch (e) { return ''; }
}

function verdictOf(rows) {
  let worst = 0;
  rows.forEach((r) => { worst = Math.max(worst, rank(r.status)); });
  if (worst >= 3) return { code: 8, verdict: 'OUTAGE' };
  if (worst >= 2) return { code: 7, verdict: 'DEGRADED' };
  return { code: 0, verdict: 'OK' };
}

(async () => {
  const summary = await getJson(STATUS_URL, 8000);
  if (!summary || !Array.isArray(summary.components)) {
    // 连状态页都拿不到 —— 这本身就是"本机网络/代理"的信号，不能当成平台故障，也不能当成一切正常
    const out = { verdict: 'UNKNOWN', code: 9, reason: '连不上 githubstatus.com（本机网络/代理？）', checkedAt: new Date().toISOString() };
    if (JSON_OUT) console.log(JSON.stringify(out, null, 2));
    else console.log('平台状态：未知 —— 连不上 www.githubstatus.com（8s 超时）。\n' +
      '  这通常是本机网络/代理问题，**不要据此下结论，也不要循环重试**。');
    process.exitCode = 9;
    return;
  }

  const byName = {};
  summary.components.forEach((c) => { if (c && c.name) byName[c.name] = c.status; });
  const rows = REQUIRED.map((r) => ({ name: r.key, label: r.label, status: byName[r.key] || 'unknown' }));
  const ctx = CONTEXT.filter((n) => byName[n]).map((n) => ({ name: n, status: byName[n] }));
  const v = verdictOf(rows);

  // 事件（只挑与本项目依赖相关的；拿不到就留空，不阻塞判定）
  const inc = await getJson(INCIDENT_URL, 8000);
  const incidents = ((inc && inc.incidents) || []).map((i) => {
    const u = (i.incident_updates || [])[0] || {};
    return { name: i.name, impact: i.impact, status: i.status, at: u.created_at || i.created_at, body: (u.body || '').replace(/<[^>]+>/g, ' ').trim() };
  });

  // 线上版本核对（**只在平台正常时做**：降级时去验线上，只会把平台延迟误判成自己的 bug）
  let live = null;
  if (VERIFY) {
    if (v.code !== 0) {
      live = { skipped: true, why: '平台状态 ' + v.verdict + '，跳过线上校验（避免把平台延迟误判成版本没更新）' };
    } else {
      live = await readLiveVersion(PAGE_URL, 400 * 1024, 10000);
      if (live.ok) {
        const local = localVersion();
        live.local = local;
        live.same = !!local && local.replace(/^v/i, '') === live.version.replace(/^v/i, '');
        if (!live.same) v.code = 2;                        // 平台正常但线上旧 → 构建排队/失败
      } else {
        v.code = 2;
      }
    }
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({
      verdict: v.verdict, code: v.code, checkedAt: new Date().toISOString(),
      updatedAt: summary.page && summary.page.updated_at,
      required: rows, context: ctx, incidents, live,
    }, null, 2));
    process.exitCode = v.code;
    return;
  }

  if (!QUIET) {
    console.log('GitHub 平台状态 · ' + bj(summary.page && summary.page.updated_at) + ' · www.githubstatus.com');
    console.log('');
    rows.forEach((r) => {
      console.log('  ' + r.name.padEnd(14) + (ZH[r.status] || r.status).padEnd(20) + '  ← ' + r.label);
    });
    if (ctx.length) {
      console.log('');
      console.log('  参考：' + ctx.map((c) => c.name + '=' + (ZH[c.status] || c.status)).join('｜'));
    }
    if (incidents.length) {
      console.log('');
      incidents.slice(0, 3).forEach((i) => {
        console.log('  ⚠ 事件：' + i.name);
        console.log('     ' + i.impact + '｜' + i.status + '｜' + bj(i.at));
      });
    }
    console.log('');
  }

  if (v.code === 0) {
    console.log('判定：OK —— 三个依赖服务正常' + (VERIFY ? '' : '（想核对线上版本可加 --verify）'));
  } else if (v.code === 7) {
    console.log('判定：DEGRADED（降级）—— **别等**。此刻"线上没更新 / 构建失败"大概率是平台侧，不是本项目的代码问题。');
    console.log('      建议：稍后再验（恢复后排队的那次构建会自己跑完），不要把降级写成轮询等待。');
  } else if (v.code === 8) {
    console.log('判定：OUTAGE（中断）—— **立刻停手**：不要部署、不要反复触发构建、不要循环重试。');
    console.log('      建议：等 githubstatus 恢复（或用户告知）后再做一次即可。');
  }
  if (live) {
    if (live.skipped) console.log('线上版本：未校验 —— ' + live.why);
    else if (!live.ok) console.log('线上版本：读取失败（' + live.why + '）—— 平台正常但页面拿不到，去查 Pages 构建记录');
    else if (live.same) console.log('线上版本：' + live.version + ' ✅ 与本地一致');
    else console.log('线上版本：' + live.version + ' ✗ 本地是 ' + (live.local || '?') + ' —— 平台正常但线上仍是旧版（构建排队/失败）');
  }
  if (!QUIET) console.log('');
  if (!QUIET) console.log('退出码：' + v.code);
  process.exitCode = v.code;
})();
