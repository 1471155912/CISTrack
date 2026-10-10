/* fetch_history.mjs —— V1.9.0 历史 TLE 正式批量拉取（Space-Track gp_history）
 * ---------------------------------------------------------------------------
 * 04 章「变轨情况」（V1.9.1 A15 前的「升轨情况」）的历史数据库首次灌库 / 补数工具。日常维护**不需要**跑它
 * （refresh.mjs 每次刷新都会把当天要素追加进源库）；只有「新批次补历史」或
 * 「源库损坏重建」时才用。
 *
 * 通路（实测稳定，2026-10）：
 *   1. POST /ajaxauth/login（凭据：环境变量 SPACETRACK_USER / SPACETRACK_PASS，
 *      或环境变量 SPACETRACK_CREDS 指定的 JSON / 仓库同级 _secrets/spacetrack.json
 *      —— 仓库之外，勿提交）
 *   2. GET /basicspacedata/query/class/gp_history/NORAD_CAT_ID/<ids>/EPOCH/<起>--<止>
 *      /orderby/EPOCH%20asc/format/tle
 *      ⚠️ 实测：**nullsort=ignore 会让整个查询 400**，不要加；子查询段必须排在 /format/ 之前。
 *   3. 卫星清单来自 data/ct_hulianwang.tle / ct_qianfan.tle（l1 的 NORAD + COSPAR 前 5 位批次 key）。
 *
 * 解析：3LE → 伪 OMM {EPOCH, MEAN_MOTION, ECCENTRICITY, INCLINATION} → densify（≤2 条/天）
 *       → 换算成**半长轴**（alt + 6378.135，与 refresh.mjs / 页面契约一致）→ mergeInto 写
 *       data/history/<批次>.json（幂等，重复运行只补缺）。
 * 缓存：原始 TLE 文本落 data/history_cache/<chunk>-<year>.txt（空文件 = 已知无数据的窗口），
 *       断点续跑不重联网；源库损坏时清空 data/history 后重跑即可**纯离线**重建。
 * 限流：请求间 sleep 3s（<30 req/min）；连续失败 3 次自动停（保护配额）。
 * 用法：node scripts/fetch_history.mjs            # 默认 = **离线重建**：用 data/history_cache 的
 *                                                 #   报文池重算全部历史（0 请求、不需要凭据、
 *                                                 #   按 NORAD 匹配，不依赖分块下标）
 *      node scripts/fetch_history.mjs --net        # 在线增量：按分块窗口取数（需要凭据）
 *      node scripts/fetch_history.mjs --missing    # ★ V1.9.1：**只补缺历史的卫星**（需要凭据）
 *                                                 #   任务清单 1.5 就用它；见下面 --missing 的说明
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeInto, readShard, writeShard, pruneRecords } from './histstore.mjs';
import { densify, loadCreds } from './import_history.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA = path.join(ROOT, 'data');
const HIST = path.join(DATA, 'history');
const CACHE = path.join(ROOT, 'data', 'history_cache');
const DAY = 86400000;
const BASE = 'https://www.space-track.org';
const CHUNK = 10;          // 每次请求的卫星数
const SLEEP = 3000;        // 请求间隔（<30 req/min）
const NOW = new Date();
const CUR_YEAR = NOW.getUTCFullYear();

fs.mkdirSync(CACHE, { recursive: true });
const LOGF = path.join(ROOT, 'logs', 'fetch_hist.log');
const log = (s) => { fs.appendFileSync(LOGF, s + '\n'); console.log(s); };
fs.writeFileSync(LOGF, '');

// ---------- 登录 ----------
let cookie = '';
async function login() {
  const SEC = loadCreds();
  if (!SEC) {
    console.error('未找到 Space-Track 凭据：请设 SPACETRACK_USER / SPACETRACK_PASS，'
      + '或用 SPACETRACK_CREDS 指向 JSON 文件（见文件头）。');
    process.exit(2);
  }
  // ★ V1.9.1 修复（**静默失效**，2026-10-10 实测）：原来这里读的是 `SEC.username / SEC.password`，
  //   而 `loadCreds()` 返回的字段是 **`user` / `pass`** → 两个都是 `undefined`，于是 POST 的
  //   body 变成 `identity=undefined&password=undefined`。
  //   Space-Track 对未登录的 `/ajaxauth/login` 也回 **200 且给一个匿名 cookie**，
  //   而旧代码只检查"cookie 是否非空"就打印 `登录 OK` → 后续查询全部 **HTTP 401**，
  //   报错信息却只说"某个窗口失败"，完全指不到登录这一步。
  //   现在：① 字段名两种写法都认；② 登录后**必须做一次最小查询验证**（见下面 verify）。
  const secUser = SEC.user || SEC.username;
  const secPass = SEC.pass || SEC.password;
  if (!secUser || !secPass) {
    throw new Error('凭据对象缺少用户名或密码（loadCreds 返回了不完整的对象）');
  }
  let lastErr = null;
  for (let att = 0; att < 3; att++) {
    try {
      const r = await fetch(BASE + '/ajaxauth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' },
        body: new URLSearchParams({ identity: secUser, password: secPass }).toString(),
        redirect: 'manual',
      });
      const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
      cookie = sc.map(c => c.split(';')[0]).join('; ');
      // ★ 登录后**不要**再 GET 重定向目标：实测那一步可能反而扰动会话（下次查询 401）。
      //   POST 拿到的 Cookie 直接用于查询即可（已实测 200）。
      if (cookie) {
        // ★ 关键：**必须真查一次**才算登录成功。
        //   为什么不能只看 cookie：未登录时 /ajaxauth/login 一样返回 200 + 匿名 cookie
        //   （实测），于是"有 cookie"是个**假阳性**。这里用 ISS（NORAD 25544）做探针 ——
        //   它永远在编、一定查得到，返回空/非 200 就说明会话没建立起来。
        const vr = await fetch(BASE + '/basicspacedata/query/class/satcat/NORAD_CAT_ID/25544/format/json',
          { headers: { Cookie: cookie, 'User-Agent': 'Mozilla/5.0' } });
        const vt = vr.status === 200 ? await vr.text() : '';
        if (vt.indexOf('25544') >= 0) { log('登录 OK（已用 satcat 25544 验证），cookie_len=' + cookie.length); return; }
        lastErr = new Error('登录**未通过验证**：探针查询返回 status=' + vr.status +
          '、长度 ' + vt.length + ' —— 多半是账号/密码不对，或账号被限流');
        cookie = '';
        log('  ! ' + lastErr.message);
        break;                                    // 凭据问题重试无意义，直接失败
      }
      lastErr = new Error('登录未获得 Cookie（status=' + r.status + '）');
    } catch (e) { lastErr = e; }
    await new Promise(r => setTimeout(r, 5000 * (att + 1)));
  }
  throw lastErr;
}

// ---------- 卫星清单（norad + 批次 lk） ----------
// ⚠️ V1.9.1：6 位编目号（100000+）对象在 .tle 里存的是**占位号**（真号后 5 位，如 00203），
//   直接用 `l1.slice(2,7)` 会得到 203 —— 那是**另一颗卫星的编号**。喂给 Space-Track 会查到
//   毫不相干的对象，写进历史库就是"张冠李戴"的坏数据（而且极难发现）。
//   这里与 refresh.mjs 用同一个 sidecar 映射（data/omm_norad.json）还原真号。
const OMM_IDS = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, 'omm_norad.json'), 'utf8')); } catch (e) { return {}; }
})();
// ★ V1.9.1 修复（**第二处静默失效**，2026-10-10 实测）：Space-Track 的 `gp_history` 对
//   6 位编目号返回的是 **Alpha-5 格式** —— NORAD 字段写成 `A0211` 而不是 `00211`。
//   旧代码 `realNorad = (raw5) => OMM_IDS[raw5] || Number(raw5)` 对 `A0211` 只会得到 `NaN`，
//   于是匹配 `sats.find(s => s.norad === r.norad)` 必然落空 → 记录被 `continue` **静默丢弃**。
//   实测后果：chunk 里全是 6 位号卫星时，"解析 0 条"，而缓存文件里明明躺着 92 KB 的 TLE。
//   Alpha-5 规则：字母（**不含 I、O**，避免与 1/0 混）+ 4 位数字 → 字母映射成两位前缀。
//     A=10 → `A0211` = 10 + "0211" = **100211**（与 mkdata 侧 omm_norad.json 的 100211 对得上）。
const ALPHA5 = 'ABCDEFGHJKLMNPQRSTUVWXYZ';           // 去掉 I、O 的 24 个字母
function alpha5Decode(raw) {
  const t = String(raw).trim().toUpperCase();
  if (/^\d{5}$/.test(t)) return Number(t);
  const m = /^([A-HJ-NP-Z])(\d{4})$/.exec(t);
  if (!m) return NaN;
  const i = ALPHA5.indexOf(m[1]);
  return i < 0 ? NaN : Number(String(10 + i) + m[2]);
}
const realNorad = (raw) => {
  const t = String(raw).trim();
  if (OMM_IDS[t]) return OMM_IDS[t];                   // 库里 .tle 用的 5 位占位串（如 00211）
  const n = alpha5Decode(t);
  if (!isFinite(n)) return NaN;
  return OMM_IDS[String(n).slice(-5)] || n;            // 100211 → 00211 → 100211
};
function loadSats() {
  const sats = [];
  for (const f of ['ct_hulianwang.tle', 'ct_qianfan.tle']) {
    const lines = fs.readFileSync(path.join(DATA, f), 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
    for (let i = 0; i + 2 < lines.length; i += 3) {
      const l1 = lines[i + 1];
      if (!/^1 /.test(l1)) continue;
      const lk = l1.slice(9, 14).trim();
      if (!/^\d{5}$/.test(lk)) continue;
      sats.push({ norad: realNorad(l1.slice(2, 7)), lk });
    }
  }
  const uniq = [...new Map(sats.map(s => [s.norad, s])).values()].sort((a, b) => a.norad - b.norad);
  return uniq;
}

// ---------- 3LE → 伪 OMM ----------
function tle2omm(l1, l2) {
  // `l1.slice(2, 7)` 对 Alpha-5 是 "A0211"、对传统格式是 "00211" —— realNorad 两种都认
  const norad = realNorad(l1.slice(2, 7));
  const yy = Number(l1.slice(18, 20));
  const year = yy < 57 ? 2000 + yy : 1900 + yy;
  const doy = parseFloat(l1.slice(20, 32));
  if (!isFinite(doy) || doy < 1) return null;
  const ms = Date.UTC(year, 0, 1) + (doy - 1) * DAY;
  const mm = parseFloat(l2.slice(52, 63));
  if (!isFinite(mm) || mm <= 0) return null;
  // ⚠️ 偏心率必须从 **l2** 读（第 27–33 列）。
  //   旧代码写的是 `l1.slice(26, 33)` —— 读到的是**历元小数的数字**：例如 l1 历元串
  //   `25001.87960528` 的 slice(26,33) = `"960528"` → e = 0.960528（真值约 1e-4）。
  //   0.96 的偏心率代入布劳威尔 J2 项，高度会从 ~500 km 被算成 ~3597 km（最大记录到 8 万 km），
  //   这正是"升轨曲线莫名其妙尖峰"的**唯一真身**（缓存原文反证：同一批原始 l2 的
  //   最大平均运动 13.4156，无一异常 → 上游数据是干净的）。
  const ec = parseFloat('0.' + l2.slice(26, 33).trim()) || 0;
  const inc = parseFloat(l2.slice(8, 16).trim());
  return { norad, ms, omm: { EPOCH: new Date(ms).toISOString(), MEAN_MOTION: mm, ECCENTRICITY: ec, INCLINATION: inc } };
}
function parse3le(text) {
  const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
  const out = [];
  // ⚠️ 上界必须是 `i + 1`（本循环读 lines[i] 与 lines[i+1] 两行）。
  //   旧写法 `i + 2 < lines.length` 会在**每个缓存文件的最后一对**上退出 → 每块少一颗星，
  //   静默、且随文件数放大（78 个缓存 → 累计丢失可观）。
  for (let i = 0; i + 1 < lines.length; i++) {
    // ★ V1.9.1：行首要认 **Alpha-5 的字母**（`1 A0211U …`）。
    //   旧写法 `/^1 \d/` 只认数字 → 6 位编目号卫星的整行被跳过，表现为"解析 0 条"
    //   （而缓存里其实有数据）。
    if (/^1 [0-9A-Z]/.test(lines[i]) && /^2 [0-9A-Z]/.test(lines[i + 1])) {
      const r = tle2omm(lines[i], lines[i + 1]);
      if (r) out.push(r);
      i++; // 消费掉已处理的 l2 行
    }
  }
  return out;
}

// ---------- 拉取一个 (chunk, year) 窗口 ----------
async function fetchWindow(sats, year) {
  const ids = sats.map(s => s.norad).join(',');
  const f0 = String(year) + '-01-01', f1 = String(year + 1) + '-01-01';
  const url = BASE + '/basicspacedata/query/class/gp_history/NORAD_CAT_ID/' + ids +
    '/EPOCH/' + f0 + '--' + f1 + '/orderby/EPOCH%20asc/format/tle';
  // ⚠️ 实测：nullsort=ignore 会让整个查询 400（gp_history 不认），不要加回来。
  const r = await fetch(url, { headers: { Cookie: cookie, 'User-Agent': 'Mozilla/5.0' } });
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  if (sc.length) cookie = sc.map(c => c.split(';')[0]).join('; ');   // 会话续期
  const t = await r.text();
  if (r.status === 204) return '';               // 204 = 查询成功但该窗口无数据（不是错误）
  if (r.status !== 200) throw new Error('HTTP ' + r.status + ' ' + t.slice(0, 120).replace(/\s+/g, ' '));
  return t;
}

// ---------- 主流程 ----------
// ⚠️ `MISSING_ONLY` 必须定义在这里（**在 `const satList = …` 之前**）：
//   它参与筛选卫星清单，若放到下面"运行模式"那一段（与 NET / PRUNE 并列、读起来更整齐），
//   就会踩 `Cannot access 'MISSING_ONLY' before initialization` —— 本轮已经踩过一次。
// ★ V1.9.1（任务清单 1.5）：`--missing` —— **只补"库里还没有任何历史"的卫星**。
//   为什么需要它（实测数据）：库里已覆盖 506 颗、只缺 55 颗（全是新入编的 6 位编目号批次）。
//   而 `--net` 的老行为是**遍历全部 50 个分块 × 每块的整个年份跨度**（最早块 2019→2026 = 8 个窗口），
//   合计 200~400 次请求、按 3 s 间隔要跑十几分钟，且**绝大多数请求拉的是早就入库的卫星**
//   —— Space-Track 是有配额的，"为了 55 颗新星把明天的额度也用光"是不可接受的。
//   本选项把卫星清单先过滤成"缺历史的那些"，并且**只查它们自己的年份窗口**
//   （批次号前两位就是年份：26176 → 2026 → 从 2026 查起），请求数因此降到十几次。
//
//   ⚠️ 判据的演进（**别退回"库里有没有该 NORAD"**）：
//     第一版判据是"库里完全没有这颗星"，实测只命中 0 颗 —— 因为 refresh.mjs 每天都会把
//     当天要素追加进源库，所以**每颗在编卫星都至少有 1 个点**，"有没有"永远为真。
//     实测证据（2026-10-10）：19077 的 KL-Alpha 在轨 **2519 天**、库里只有 **1 个点、跨度 0 天**；
//     GEO 三颗（24040/24135/24181，在轨 730~954 天）各 2 个点；26176 批 9 颗在轨 67 天、2 个点。
//     这类"孤点"在页面上就是一条**画不出来的曲线**（一个点连不成线）—— 那才是要补的。
//     所以判据改成：**历史跨度 < 该批次可能的最长在轨期的一半**。
//       可能的最长在轨期用**批次号前两位的年份**估算（不依赖任何外部数据）：
//         estMax(lk) = 现在 − (20XX-01-01)   （20XX = lk 前两位；再对 365 天上限取小）
//       例：19077 → 上界 2832 天 → 阈值 365/2 ≈ 182 天 → 实测跨度 0 天 → **判定要补** ✓
//           24185（2024 年、18 颗、跨度 695 天）→ 阈值约 506 天 → 695 > 506 → **不动它** ✓
//     实测该判据命中 33 颗（跨 13 个批次），与本轮人工核查的结论一致。
//   缓存前缀也换成 `miss-`：避免与存量 `--net` 缓存（键是"当时的分块下标 + 年份"）互相污染。
const MISSING_ONLY = process.argv.includes('--missing');

const satListAll = loadSats();
// `--missing`：先按 NORAD 汇总"库内现有历史的跨度"，再只保留**跨度明显不足**的那些
const histSpan = new Map();   // norad → { first, last, n }
for (const k of fs.readdirSync(HIST)) {
  if (!k.endsWith('.json')) continue;
  for (const r of readShard(HIST, k.replace('.json', ''))) {
    const norad = Array.isArray(r) ? r[0] : r.norad;
    const ms = Array.isArray(r) ? r[1] : r.ms;
    const cur2 = histSpan.get(norad) || { first: Infinity, last: 0, n: 0 };
    cur2.n++; if (ms < cur2.first) cur2.first = ms; if (ms > cur2.last) cur2.last = ms;
    histSpan.set(norad, cur2);
  }
}
const NOW_MS = NOW.getTime();
// 批次的**真实发射时刻**（口径与页面一致：`build/satdata.json` 的 launches，北京时间）。
//   ⚠️ 为什么不能只用"批次号前两位的年份"：那一年的**1 月 1 日**远比真实发射日早，
//   于是"可能在轨期"被高估 → 阈值虚高 → **误判一大批正常卫星**。实测：只用年份上界时
//   命中 177 颗，换成真实发射时间后是 33 颗（与本轮人工逐颗核查的结论一致）。
//   177 颗要多发十几倍的请求、把额度浪费在本来就有完整历史的卫星上。
const LAUNCH_MS = (() => {
  const out = {};
  try {
    const sd = JSON.parse(fs.readFileSync(path.join(ROOT, 'build', 'satdata.json'), 'utf8'));
    for (const k of ['gw', 'qf']) {
      const L = (sd[k] && sd[k].launches) || {};
      for (const lk of Object.keys(L)) {
        const ms = Date.parse(L[lk][1] + ':00+08:00');
        if (isFinite(ms)) out[lk] = ms;
      }
    }
  } catch (e) { /* 没有构建产物时退回下面的年份上界 */ }
  return out;
})();
// 该批次"可能的最长在轨期"：优先用真实发射时间；缺台账才退回"发布年份的 1 月 1 日"（保守）
const estMaxOrbitDays = (lk) => {
  const lm = LAUNCH_MS[lk];
  if (isFinite(lm)) return Math.max(0, (NOW_MS - lm) / DAY);
  return Math.max(0, (NOW_MS - Date.UTC(2000 + Number(String(lk).slice(0, 2)), 0, 1)) / DAY);
};
// "历史过薄"：有足够的可能跨度，却只攒下不到一半的历史
const isThin = (sat) => {
  const h = histSpan.get(sat.norad);
  const cap = Math.min(estMaxOrbitDays(sat.lk), 365);      // 老批次封顶 365 天
  if (cap <= 30) return false;                             // 太年轻，数据本来就该少
  if (!h) return true;                                     // 一个点都没有（理论上少见）
  return (h.last - h.first) / DAY < cap * 0.5;
};
const satList = MISSING_ONLY ? satListAll.filter(isThin) : satListAll;
log('在编卫星 ' + satListAll.length + ' 颗，分块大小 ' + CHUNK +
  (MISSING_ONLY ? '；--missing：判据 = 历史跨度 < 可能在轨期的一半 → 命中 ' + satList.length + ' 颗（批次 ' +
    [...new Set(satList.map(s2 => s2.lk))].join(', ') + '）' : ''));
if (MISSING_ONLY && !satList.length) { log('没有需要补历史的卫星，无需联网。'); process.exit(0); }
const chunks = [];
for (let i = 0; i < satList.length; i += CHUNK) chunks.push(satList.slice(i, i + CHUNK));

// ---------- 登录（**只有真要联网时才需要**）----------
// ---------- 运行模式：离线重建（默认） / 在线增量（--net）----------
// ★ V1.9.1：默认改为**离线重建** —— 把 data/history_cache/*.txt 全体当作"原始报文池"，
//   逐个解析后**按 NORAD** 归到当前在编卫星。
//   为什么不能再按"分块下标"（`<块号>-<年>.txt`）走：
//     缓存的键是**当时**的分块下标，而分块来自「按 NORAD 排序后的卫星清单」。卫星清单一旦
//     变化（本次 436 → 491 颗），**全部下标错位** —— 同一个 `05-2025.txt` 现在对应的是
//     另一批卫星，按当前分块去匹配会把绝大多数记录**静默丢弃**（数据看起来"变少了"，但无报错）。
//     实测：按旧写法跑，49 块里最后 6 块没有缓存 → 又在缺凭据上 exit(2)，重建完全跑不起来。
//   按 NORAD 匹配则不依赖任何下标：缓存退化成纯粹的"报文池"，增删多少卫星都不影响已有数据。
const NET = process.argv.includes('--net');
// `--prune`：对 data/history 全量做一次容量治理（分层降采样）。
//   为什么需要独立入口：离线重建是**从原始报文池重算**，产出的是"未治理"的完整点集
//   （本次 283,556 行 / 8.2 MB）；而 data/history 是要进 git 仓库的，平时由 refresh.mjs
//   在每次合并后顺手 prune 掉。清库重建绕开了那一步 → 必须补一次，否则仓库凭空变大 4 倍。
//   **用的是同一个 pruneRecords**（与 refresh.mjs 逐字相同），所以口径不会分叉。
const PRUNE = process.argv.includes('--prune');
if (PRUNE) {
  const shards = fs.readdirSync(HIST).filter(f => f.endsWith('.json'));
  let before = 0, after = 0, touched = 0;
  for (const k of shards) {
    const lk = k.replace('.json', '');
    const cur = readShard(HIST, lk);
    if (!cur.length) continue;
    const pr = pruneRecords(cur, Date.now());
    before += (pr.stats && pr.stats.before) || cur.length;
    after += pr.recs.length;
    if (pr.recs.length !== cur.length) { writeShard(HIST, lk, pr.recs); touched++; }
  }
  log('容量治理：' + shards.length + ' 分片 / ' + before + ' → ' + after + ' 行（改写 ' + touched + ' 片）');
  process.exit(0);
}
const acc = new Map();         // lk -> Map(norad -> omm[])，按块合并前累积
function accBatch(lk, norad, omm) {
  if (!acc.has(lk)) acc.set(lk, new Map());
  const m = acc.get(lk);
  if (!m.has(norad)) m.set(norad, []);
  m.get(norad).push(omm);
}
function flushAcc() {
  const batches = [];
  acc.forEach((sats, lk) => {
    const records = [];
    sats.forEach((ommList, norad) => records.push(...densify(ommList, norad, 2)
      // densify 存的是**离地高度**（altFromOmm − RE）；源库/页面契约统一为**半长轴 sma**。
      // ★ V1.9.1 常量统一：这里回加的地球半径必须与**页面端**的 CLIMB_RE 完全一致，
      //   否则「存进去再取出来」会差 2 m（页面算离地高度用的是 sma − CLIMB_RE）。
      //   页面 `app.js: CLIMB_RE = 6378.137`（赤道半径，与第三章表格 hp/ha 同口径）
      //   → 这里回加 6378.137，页面减 6378.137，**恰好抵消**，取回的正是原始高度。
      //   （旧代码回加 6378.135，与页面差 0.002 km —— 虽小，但属"两侧常量不一致"的隐患。）
      .map(([n, ms, a]) => [n, ms, Math.round((a + 6378.137) * 100) / 100])));
    if (records.length) batches.push({ key: lk, records });
  });
  acc.clear();
  return batches.length ? mergeInto(HIST, batches) : { shards: 0, added: 0, dup: 0 };
}

let reqN = 0, failStreak = 0, totalParsed = 0;
const t0 = Date.now();

if (!NET) {
  // ---------------- 离线重建：报文池 → 按 NORAD 归批（0 请求、不需要凭据）----------------
  const pool = fs.readdirSync(CACHE).filter(f => /\.txt$/.test(f)).sort();
  log('离线重建：报文池 ' + pool.length + ' 个窗口 / 在编卫星 ' + satList.length + ' 颗');
  const lkOf = new Map(satList.map(s => [s.norad, s.lk]));
  const seen = new Set();
  for (const cf of pool) {
    const text = fs.readFileSync(path.join(CACHE, cf), 'utf8');
    if (!text.trim()) continue;
    const recs = parse3le(text);
    totalParsed += recs.length;
    let used = 0;
    for (const r of recs) {
      const lk = lkOf.get(r.norad); if (!lk) continue;
      accBatch(lk, r.norad, r.omm); seen.add(r.norad); used++;
    }
    log('  [' + cf + '] 解析 ' + recs.length + ' 条 / 命中在编卫星 ' + used + ' 条');
  }
  const stat = flushAcc();
  log('  → 合并：分片 ' + stat.shards + ' / 新增 ' + stat.added + ' / 重复 ' + stat.dup);
  const miss = satList.filter(s => !seen.has(s.norad));
  log('  覆盖率：' + (satList.length - miss.length) + '/' + satList.length + ' 颗有历史；缺 ' + miss.length +
    ' 颗（新入编 / 报文池未覆盖 → 由「补历史」步骤单独取，见任务清单 1.5）');
  if (miss.length) log('    缺历史的批次：' + [...new Set(miss.map(s => s.lk))].join(', '));
} else {
  // ---------------- 在线增量：按分块窗口取数（需要凭据）----------------
  await login();
  outer:
  for (let ci = 0; ci < chunks.length; ci++) {
    const sats = chunks[ci];
    const minY = Math.min(...sats.map(s => Number(s.lk.slice(0, 2)))) + 2000;
    for (let y = minY; y <= CUR_YEAR; y++) {
      // --missing 用独立前缀：存量缓存是旧分块下标的语义，两者不能混用
      const ck = (MISSING_ONLY ? 'miss-' : '') + String(ci).padStart(2, '0') + '-' + y;
      const cf = path.join(CACHE, ck + '.txt');
      let text = null;
      if (fs.existsSync(cf)) {                       // 缓存存在即用（含空文件 = 已知无数据的窗口）
        text = fs.readFileSync(cf, 'utf8');
      } else {
        for (let att = 0; att < 3; att++) {
          try {
            text = await fetchWindow(sats, y); reqN++;
            if (/^\s*\{\s*"error"/.test(text)) { text = null; throw new Error('限流: ' + text); }
            fs.writeFileSync(cf, text);              // 204/空窗口也落盘，重跑时不再请求
            failStreak = 0;
            break;
          } catch (e) {
            failStreak++;
            log('  [' + ck + '] 第' + (att + 1) + '次失败：' + (e && e.message));
            text = null;
            await new Promise(r => setTimeout(r, Math.min(30000, 5000 * (att + 1))));
            if (failStreak >= 3) { log('连续失败 3 次，停止（保护配额）。已缓存 ' + ci + ' 块。'); break outer; }
          }
        }
        await new Promise(r => setTimeout(r, SLEEP));
      }
      if (!text) continue;
      // ⚠️ 这里的 `sats.find` 只在本块内匹配 —— 正是上面警告的"下标型"脆弱点，
      //    故只用于在线增量（sats 与当次请求的 id 列表天然一致）。
      const recs = parse3le(text);
      totalParsed += recs.length;
      for (const r of recs) {
        const sat = sats.find(s => s.norad === r.norad);
        if (!sat) continue;
        accBatch(sat.lk, r.norad, r.omm);
      }
      log('[' + ck + '] ' + reqN + ' 请求 / 解析 ' + recs.length + ' 条 / 累计 ' + totalParsed);
    }
    // 每块跑完就合并落盘一次（中途断了也不丢）
    const stat = flushAcc();
    log('  → 合并：分片 ' + stat.shards + ' / 新增 ' + stat.added + ' / 重复 ' + stat.dup);
  }
}

// 汇总
const keys = fs.readdirSync(HIST).filter(f => f.endsWith('.json'));
let total = 0;
keys.forEach(k => { total += readShard(HIST, k.replace('.json', '')).length; });
log('完成：' + reqN + ' 次请求 / 解析 ' + totalParsed + ' 条 / 库内合计 ' + total + ' 行 / ' + keys.length + ' 分片 / 耗时 ' + Math.round((Date.now() - t0) / 1000) + 's');
