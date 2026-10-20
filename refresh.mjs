/* 刷新两个星座的 TLE + SATCAT
 * V1.3.7：改成「多源 + 按 COSPAR / 编号反查」。
 *   旧版只按 CelesTrak 的 GROUP=hulianwang / qianfan 分组抓，这两个分组漏掉了
 *   早期试验星（23095 / 23212 等）与部分刚入轨的批次。现在五个来源依次合并：
 *     S1 GROUP=          星座分组（主源）
 *     S2 NAME=           CelesTrak 的 NAME 是前缀模糊匹配，能捞回 S1 漏掉的星
 *     S3 CATNR=          用 satcat 按 COSPAR 前缀反查出编号后逐颗补（**只处理 ≤5 位编目号**：
 *                        6 位号的编目字段装不下，TLE 格式一律空 → 交给 S5）
 *     S4 tle.ivanstanojevic.me   上面都拿不到时的备源（同样只管 ≤5 位）
 *     S5 CATNR= + FORMAT=json（OMM）  **兜底通路**：凡 S1–S4 仍未取到的对象都在这里试。
 *                        6 位及以上编目号（CelesTrak 自 2026-07-11 起的新规则）只能走这条，
 *                        取回后用 scripts/omm.mjs 转成"TLE 形状"（编目号填占位 = 真号后 5 位），
 *                        真号记进 data/omm_norad.json 由 mkdata.mjs 写回前端 id。
 *   同一颗卫星多源都有时，取历元（epoch）最新的那份。
 *
 * ★ V1.9.5（H42）：**取数格式已从 legacy TLE 迁移到 OMM JSON**（政策要求，见维护文档 §17.3）。
 *   S1/S2/S3 的 `FORMAT=` 由 `GP_FORMAT` 控制（默认 `json`；`GP_FORMAT=tle` 可回退对照）。
 *   注意：改的只是**取数格式**——数据在 merged 里**仍然是两行 TLE 形状**（OMM 经 scripts/omm.mjs 转换），
 *   所以 mkdata / 页面 / 历史库一行都不用改。
 *
 * 用法：node refresh.mjs [--force-cat]      --force-cat 强制重下 6.7MB 的 satcat.csv
 *      node refresh.mjs --selftest-omm     离线自检 S5 的 OMM 解析/占位/映射链路（不联网）
 *      GP_FORMAT=tle node refresh.mjs      回退到旧格式抓取（对照/应急）
 */
import { checkFormat } from './scripts/format_guard.mjs';   // ★ V1.9.5（H42）：格式变更探测（纯函数，smoke 也 import 它）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.dirname(fileURLToPath(import.meta.url));   // 脚本所在目录（发布包内任意位置可用）

const D = path.join(ROOT, 'data');
// V1.8.0（需求14 方案A）：把「写坏后天天静默失败」挡在入口 —— 任何顶层错误必须非零退出并落日志，
//   计划任务才能看见（旧版 17 行有重复 import + 多余引号，语法错 → 任务天天失败无人知）。
process.on('unhandledRejection', function (e) { console.error('[refresh] unhandledRejection', e); process.exit(1); });
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' };
// ★ V1.9.3：satcat 的 URL / 重试 / 超时集中在一处，改策略不用翻遍文件。
//   它驱动三处功能：已再入标记、台账扣减、搜索补池（都是**补充**功能，不影响主轨道数据）。
const SATCAT_URL = 'https://celestrak.org/pub/satcat.csv';
const SATCAT_TRIES = 3;          // 旧值 1（不重试）→ 偶发网络错误就毁掉整条 CI
const SATCAT_TIMEOUT_MS = 180000; // 6.7MB 大文件，不能套小 API 的 20s
const forceCat = process.argv.includes('--force-cat');

// V1.9.0：6 位编目号对象的 OMM 通路（见下方 S5）—— 占位号 → 真号的映射，落 data/omm_norad.json
import { tleFromOmm, fromCelesTrakOmm, PH, tleChecksum, tleHealth, cosparField, tleEpochMs } from './scripts/omm.mjs';
// V1.9.0（R17）：自建历史库 —— 复用 import_history.mjs 里已修过量级 bug 的 altFromOmm，
//   以及 histstore.mjs 的幂等分片写入（(NORAD,历元) 去重，只追加不覆盖）。
import { altFromOmm } from './scripts/import_history.mjs';
import { mergeInto, pruneRecords, readShard, writeShard } from './scripts/histstore.mjs';
const HIST_DIR = path.join(D, 'history');
const OMM_IDS_PATH = path.join(D, 'omm_norad.json');
let OMM_IDS = {};
try { OMM_IDS = JSON.parse(fs.readFileSync(OMM_IDS_PATH, 'utf8')); } catch (e) { OMM_IDS = {}; }

const GROUPS = { gw: 'hulianwang', qf: 'qianfan' };
// 名称前缀（CelesTrak NAME= 是前缀模糊匹配；目录里的写法并不统一，所以两边都列全）
// ★ V1.9.1（1.4）：`HULIANWANG` → `HULIANWAN`（去掉末尾的 G）。
//   为什么：目录里 GEO 那三颗写作 **`HULIANWAN GAOGUI-01/02/03`**（单 G！），
//   与我们原先写死的 `HULIANWANG`（双 G）差一个字母 → **整批漏掉**，且是静默的。
//   `HULIANWAN` 是 `HULIANWANG` 的前缀，两种写法都能命中；
//   实测 satcat 里含 `HULIANWAN` 的对象共 238 个、**全部是 PAY**，放宽零误伤。
const NAMES = {
  gw: ['HULIANWAN', 'GUOWANG', 'GW-'],
  qf: ['QIANFAN', 'SPACESAIL', 'G60']
};
const MATCH = { gw: /HULIANWAN|GUOWANG|^GW-/i, qf: /QIANFAN|SPACESAIL|G60/i };

// ---------------------------------------------------------------- ★ V1.9.5（H42）：抓取格式 = OMM JSON
// 政策要求（见维护文档 §17.3）：**legacy TLE 文本随 5 位目录号用尽停用**，官方要求迁移到 CSV/JSON。
// 迁移范围 = 本文件的四处 gp.php 查询（S1 GROUP / S2 NAME / S3 CATNR）。
//   · 默认 `json`（OMM）—— 与 S5 早就走通的那条通路**同一套解析**（scripts/omm.mjs）。
//   · 回退/对照：`GP_FORMAT=tle node refresh.mjs`（无需改代码即可切回旧格式）。
// ⚠️ 注意 `FORMAT=json` 时**仍然**用 `tleFromOmm()` 转成"TLE 形状"文本再进 merged ——
//   因为下游（mkdata / 页面 / 历史库）全部按两行 TLE 的样子读；改的只是**取数格式**，不是数据形态。
const GP_FORMAT = process.env.GP_FORMAT === 'tle' ? 'tle' : 'json';
const GP_EXPECT = GP_FORMAT === 'tle' ? 'tle' : 'omm';

// ---------------------------------------------------------------- 按批次的显式纳入通道（V1.9.1 / 1.4）
// 为什么需要它：有一批**确认属于本星座**的卫星，在 satcat 里的名字**完全不含星座关键字**，
//   所以无论名字正则怎么写都捞不到（这不是"正则写得不全"，是**根本没有可用的关键字**）：
//     · CX-19 / CX-20A~C / CX-26 → `CHUANGXIN 19` / `CHUANGXIN 20A` / `CHUANG XIN 26`（星网试验星，叫"创新"）
//     · KL-Alpha / KL-Beta      → `KL-ALPHA A` / `KL-BETA A`（千帆试验星）
//     · 千帆DTC-01              → `DTC TEST OBJECT A`
//     · 2024-226B               → `OBJECT B`（发射已两年多，satcat 里**至今仍是 OBJECT B**）
//   这类只能按「批次的 COSPAR 前缀」点名纳入。
// 结构：who → { 批次key(=COSPAR 前 5 位): [要纳入的 NORAD …] }
//   ★ 一律用**精确 NORAD 列表**，不用"整批全收"。
//     为什么（离线测试抓出来的）：同一批的 COSPAR 前缀下面**还挂着 R/B 与 DEB**——
//     例：`2024-040` 有 `2024-040A`(GEO 业务星, 59069) 与 `2024-040B`(R/B, 59070)。
//     若按"整批全收"，R/B 会被一起收进来（它过不了名字正则、但过了白名单），
//     最后在页面里变成一颗"没有任何台账来由"的卫星。测试实测：gw 命中数从 10 变 13，
//     多出的 3 个正是 24040B / 24135B / 24181B 三个 R/B。
//     （`null` 的"全收"写法仍保留支持，但当前名册**一处都没用**。）
// ⚠️ 这份名单以卫星百科词条表格为唯一依据，逐条核对见 `V1.9.1_1.3_词条名单核对表.md`。
const INCLUDE = {
  gw: {
    '23181': [58425, 58426, 58427],  // 星网倾斜轨道试验星02组 A/B/C（CX-20A/B/C）
    '23190': [58505],                // 卫星互联网技术试验卫星03（CX-19）
    '24226': [62186],                // CX 试验星（CZ-12 Y1）→ **只 2024-226B**；226A 是搭车星
    '26158': [69972],                // CX-26
    '24040': [59069],                // 高轨业务星01（GEO）—— 不要 24040B（R/B, 59070）
    '24135': [60327],                // 高轨业务星02（GEO）—— 不要 24135B（R/B, 60328）
    '24181': [61503]                 // 高轨业务星03（GEO）—— 不要 24181B（R/B, 61504）
  },
  qf: {
    '19077': [44785, 44786],         // KL-Alpha A/B
    '21070': [49059, 49060],         // KL-Beta A/B
    '26128': [69472]                 // 千帆DTC-01 → **只 2026-128A**；128B 是中国移动02星
  }
};
// ★★ V1.9.9（用户 2026-10-19 明确要求）★★
//   **动态点名**：词条卡片里出现过的 NORAD，一律视为该星座成员。
//
//   要解决的问题：上面那份 INCLUDE 是**写死的名册**。将来新发一颗试验星（比如又一颗 CX-xx、
//   一颗 KL-Gamma、一颗 GEO 业务星），它的目录名往往没有"卫星互联网 / 千帆"关键字 ——
//   按名字 regex 收不进来，按 INCLUDE 也不在里面（没人手工加），于是**永远进不了本项目**，
//   要等下次有人发现并改代码。这不可接受。
//
//   新口径的数据链（全自动，不需要改代码）：
//     卫星百科 星网/千帆词条表格 → 每个批次的 nameLinks（含区间展开）
//       → `scripts/fetch_wiki_cards.mjs` 打开每个单星词条、读 infobox 里的 NORAD
//       → `data/wiki_cards.json`
//       → **本函数**：只要这颗星有单独词条，就自动纳入。
//   ⚠️ 卡片文件缺失/为空时自动退回纯 INCLUDE（不影响老行为）。
// ⚠️⚠️ 动态点名必须带一张**黑名单**：有单独词条 ≠ 属于本星座。
//   已知案例（用户 2026-10-18 已裁决）：`2024-226A`（「卫星互联网技术试验卫星(CZ 12 Y1)」，NORAD 62185）
//   是同一发里的**搭车星**，不是组网/试验星 —— 我们只要 226B。但它有独立词条，
//   所以"有词条就纳入"会把它误收进来。凡此类都要在这里登记，并写明理由。
const CARD_EXCLUDE = new Set([
  62185   // 2024-226A 卫星互联网技术试验卫星(CZ 12 Y1) —— 搭车星，非本星座成员（只要 226B/62186）
]);
const CARD_INCLUDE = (() => {
  const out = { gw: new Set(), qf: new Set() };
  let n = 0, skipped = 0;
  try {
    const cards = (JSON.parse(fs.readFileSync(path.join(D, 'wiki_cards.json'), 'utf8')).cards) || {};
    const tables = JSON.parse(fs.readFileSync(path.join(D, 'wiki_tables.json'), 'utf8'));
    const has = (k, p) => !!(tables[k] && tables[k][p]);
    const clean = (t) => String(t || '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    // 星座归属**优先按卡片的 COSPAR 前 8 位**（"2025-209B" → "2025-209"）查表。
    //   为什么不按标题：区间展开出来的标题（…08组B星）在表格里根本没有对应行，
    //   按标题查会整批漏掉 —— 而 COSPAR 是卫星自己的身份，最可靠。
    //   标题只作兜底（个别卡片 infobox 没给国际编号时）。
    const whoByTitle = new Map();
    for (const k of ['gw', 'qf']) {
      const T = tables[k] || {};
      Object.keys(T).forEach((key) => {
        if (key[0] === '_') return;
        ((T[key] && T[key].nameLinks) || []).forEach((ln) => {
          const t = clean(ln && (ln.t || ln.n)); if (t && !whoByTitle.has(t)) whoByTitle.set(t, k);
        });
      });
    }
    Object.keys(cards).forEach((t) => {
      const c = cards[t] || {};
      const norad = Number(c.norad) || 0;
      if (norad < 1) return;                      // 卡片没解析出 NORAD → 这张卡帮不上忙
      if (CARD_EXCLUDE.has(norad)) { skipped++; return; }   // 见 CARD_EXCLUDE（搭车星）
      const cp = String(c.cospar || '').trim();
      const pre = /^\d{4}-\d{3}/.test(cp) ? cp.slice(0, 8) : '';
      let k = '';
      if (pre && has('gw', pre)) k = 'gw';
      else if (pre && has('qf', pre)) k = 'qf';
      else k = whoByTitle.get(clean(t)) || whoByTitle.get(clean(c.zh)) || '';
      if (!k || !out[k]) return;
      out[k].add(norad); n++;
    });
  } catch (e) { /* 没有卡片/表格就退回纯 INCLUDE */ }
  if (n || skipped) console.log('词条卡片点名：gw ' + out.gw.size + ' / qf ' + out.qf.size + ' 颗（有单星词条即自动纳入，含 INCLUDE 之外的新星）' +
    (skipped ? '；黑名单排除 ' + skipped + ' 颗' : ''));
  return out;
})();
// 排障/自测入口：`node refresh.mjs --card-include` 只打印这份动态名单就退出。
//   为什么要它：这条链路的输入是**两个数据文件**（wiki_tables + wiki_cards），
//   出问题时必须能一眼看出"到底点到了哪些号"，而不是去跑一遍全流程再猜。
if (process.argv.includes('--card-include')) {
  console.log('gw(' + CARD_INCLUDE.gw.size + '): ' + [...CARD_INCLUDE.gw].sort((a, b) => a - b).join(','));
  console.log('qf(' + CARD_INCLUDE.qf.size + '): ' + [...CARD_INCLUDE.qf].sort((a, b) => a - b).join(','));
  process.exit(0);
}

/** 该 NORAD 是否在"词条卡片点名"名单里（6 位号要先经 sidecar 还原真号） */
function includedByCard(key, norad) {
  const set = CARD_INCLUDE[key];
  if (!set || !set.size) return false;
  const real = Number(OMM_IDS[String(norad).padStart(5, '0')] || norad);
  return set.has(real) || set.has(Number(norad));
}

// 判某对象是否由白名单点名纳入。
//   ⚠️ `norad` 可能是**占位号**（6 位真号对象在 .tle/merged 里用真号后 5 位当键），
//   所以先经 sidecar（data/omm_norad.json）还原真号再比，否则 GEO 之类将来真变 6 位号时又会漏。
function includedByBatch(key, lk, norad) {
  const m = INCLUDE[key];
  if (!m || !Object.prototype.hasOwnProperty.call(m, lk)) return false;
  const list = m[lk];
  if (list == null) return true;
  const raw5 = String(norad).padStart(5, '0');
  const real = Number(OMM_IDS[raw5] || norad);
  return list.indexOf(real) >= 0;
}
// 从 COSPAR 文本提取批次 key，**两种写法都要认**：
//   · 归一化形态 `"26158A"`（经典 TLE 的 6 列，parseTLE / cosparField 的产物）
//   · 原始形态   `"2026-158A"`（OMM 的 OBJECT_ID，9 字符）
//   为什么必须兼容：1.4 实测发现 S5 曾把原始 9 字符直接存进 merged，而下游一律 `slice(0,5)`
//   → 得到 `"2026-"` → 白名单匹配失败（"取到了却在最后一步被丢掉"）。存的那头已修为归一化，
//   这里再兜一层，避免将来又有人在别处塞原始格式。
function lkOfCospar(cp) {
  const s = String(cp || '').trim();
  const m = s.match(/^(\d{4})-(\d{1,3})/);
  if (m) return m[1].slice(2) + m[2].padStart(3, '0');
  return s.slice(0, 5);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
/**
 * ★ V1.9.3：给每个请求加**硬超时** —— 旧实现用裸 `fetch()`，**没有任何超时**。
 *   实测：网络不通时一次 refresh 能卡在 S2 超过 12 分钟，
 *   而 S1/S2/S3/S4/S5 各有 2~4 次尝试 × 多个名字查询 → 最坏情况能挂到任务被强杀，
 *   既拿不到数据、又把 git.lock 一直占着（另一个本地任务要等它）。
 *   超时时间取 20s：正常响应在 1s 内完成，20s 足够宽容；
 *   连不上时立即失败 → 重试 800ms 后走下一次，整体从"十几分钟"降到"几十秒"。
 *   ⚠️ 用 AbortSignal.timeout（Node 18+ 原生支持），不引入依赖。
 */
const FETCH_TIMEOUT_MS = 20000;
/**
 * @param {string} url
 * @param {number} [tries]   重试次数（默认 2）
 * @param {number} [timeoutMs] 单次超时（默认 FETCH_TIMEOUT_MS）
 *   ★ V1.9.3：timeoutMs 变成可传参数 —— **大文件必须用自己的超时**。
 *     20s 是按"小 API 响应"定的，而 satcat.csv 有 6.7MB；虽然实测正常时 1.2s 就能下完，
 *     但网络差的 day 会远超 20s，用同一个常量就是把大文件往死里掐。
 */
async function get(url, tries, timeoutMs) {
  for (let i = 0; i < (tries || 2); i++) {
    try {
      const r = await fetch(url, {
        headers: UA,
        signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout)
          ? AbortSignal.timeout(timeoutMs || FETCH_TIMEOUT_MS) : undefined
      });
      // ★ V1.9.5（H42）：非 200 **记账、不重试、最后统一失败**。但**要按查询类型分类**——
      //   ⚠️ 第一版判据过宽（"任何非 200 都报警"）在**上线当天的 CI 上就误报**：
      //     2026-10-16 15:44 UTC 实测 6 次 404 全是 `NAME=GUOWANG / GW- / SPACESAIL / G60` 与
      //     `CATNR=100975/100976` —— 这些都是**我们主动成批探测的名字/编号**，"查无此项"的 404 是正常回执；
      //     同一次运行的"数据新鲜度：落后 0.37 天 ✓"证明数据完全正常。误报会让 CI 永远红、数据永不提交。
      //   现在的口径：
      //     · `NAME=` / `CATNR=` 的 404 = **查无此项**（合法空结果）→ 只记 info、不进账本；
      //     · `GROUP=`（分组名写死）/ `pub/satcat.csv`（固定 URL）的 404 = **真异常**（上游改版/分组消失）→ 进账本；
      //     · 5xx / 其他非 200 → 进账本（上游过载或被防火墙拦）。
      //   覆盖面没丢：若 gp.php 整个被换掉，GROUP= 那条必然先 404 ✓。
      //
      // ★★ 2026-10-20（故障 C 修复，用户裁决"方案一"）：**5xx 也要按同样的两类分开**。
      //   事故：run 39437803662（c596dab）在"刷新 TLE"步骤 exit 7 —— 日志原文
      //     `gw S5 OMM → 待补 45 颗，补到 43 颗，失败 2`（100794 / 100974 各 HTTP 500）
      //     而同一份日志里"数据新鲜度：最新历元落后 0.27 天 ✓"、"253 颗 / 仍缺轨道要素 0 颗"
      //     → **数据完全健康，却因为 2/45 的偶发 500 判整条任务失败**。
      //   后果与上面那次 404 误报**完全同构**：数据正常但 CI 永远红、仓库永不更新、
      //   也让人错以为链路坏了（真正该排查的信号被噪声淹没）。
      //   为什么给 5xx 也开口子：`CATNR=` / `NAME=` 是**点名探测/补拉**，本来就是"逐颗重试"的
      //   批量请求（S5 一轮几十个），上游偶发 500 是**该端点的正常噪声**；单颗失败只影响
      //   "这一颗的历元能否刷新到最新"，不影响其余几十颗，且 miss 统计会如实报出真缺口。
      //   而 `GROUP=` / `satcat.csv` 是**固定端点、每轮只请求一两次** —— 它们若 5xx，
      //   说明上游整体不可用或把我们拦了，那才是必须立刻交人排查的真异常。
      //   ⇒ 分级后仍保留"响亮失败"的覆盖面：整体故障必然打在 GROUP= 或 satcat 上。
      //   ⚠️ 降级不等于忽略：5xx 一律记进 SOFT_ISSUES 并写进 report.netSoft，
      //     日志里逐条打印，CI 摘要可见 —— 做到"不拦构建，但绝不静默"。
      if (!r.ok) {
        // ★★ 2026-10-20（故障 E）：**"点名补拉"不止 gp.php 一种写法** —— 上一次判据漏掉了 S4 备源。
        //   事故（run 39448830311 / 39447864423，两次都是绿的，但日志里躺着一条 ❌）：
        //     `❌ CelesTrak 返回非 200（80 次）`，逐条看全是
        //     `404 ← https://tle.ivanstanojevic.me/api/tle/65046`（S4 备源，按 NORAD 逐颗查）。
        //   为什么它当时没让 run 变红：`probeQuery` 只认 `?NAME=` / `?CATNR=` 这种**查询串**写法，
        //   而备源把编号放在**路径**里（`/api/tle/<norad>`）→ 判成"固定端点"→ 进 NET_ISSUES(exit 7)。
        //   于是形成一个极危险的组合：**refresh 判了硬失败，却被 e2e 的退出码覆盖吞掉**（见故障 D），
        //   结果"日志说 7、run 却绿"—— 闸门既没生效也没人发现。
        //   性质认定：S4 与 S5/S3 完全同构 —— **一轮几十个逐颗请求**，上游对"这颗没有/已再入"
        //   回 404 属正常回执，偶发 5xx 属该端点噪声；单颗失败只影响"这一颗的历元是否刷新到最新"，
        //   真缺口由「仍缺轨道要素」统计兜住。
        //   ⇒ 与点位探测**完全同一套两级口径**（不要因为"顺手"就给它另立规矩）：
        //     · 404 → **查无此项，合法空结果**，不入任何账本（S2 的 NAME=GW- 404 同理，一直如此）；
        //     · 5xx/301 等 → 软告警 SOFT_ISSUES（不拦构建）；
        //     · 固定端点（GROUP= / satcat.csv）→ 任何非 200 一律硬失败 NET_ISSUES。
        //   ⚠️ 覆盖面没丢：真正该硬失败的仍是**每轮只请求一两次的固定端点**。
        //   ⚠️ S4 通路"整体失效"这件事仍然可见 —— 它有自己的统计行
        //     `S4 备源 → 待补 N 颗，补到 0 颗`，不靠这 80 条 404 来暴露。
        const probeQuery = /[?&](NAME|CATNR)=/i.test(url.trim());
        // 备源按 NORAD 逐颗查：主机 + 路径形态一起认（只用主机名太宽，只用路径又怕别的站撞名）
        const isBackupProbe = /^https?:\/\/tle\.ivanstanojevic\.me\/api\/tle\/\d+\/?$/i.test(url.trim());
        const isProbe = probeQuery || isBackupProbe;
        const is5xx = r.status >= 500 && r.status < 600;
        if (isProbe && r.status === 404) {
          // 查无此项：合法空结果，不入账（与 V1.9.5 起的既有口径一致）
          SOFT_404_N++;
        } else if (isProbe) {
          // 点名探测/补拉的 5xx 等：降级为软告警（不拦构建）
          SOFT_ISSUES.push({ url: url, status: r.status, kind: isBackupProbe ? 'S4 备源' : '点名探测' });
        } else if (!(r.status === 404 && probeQuery)) {
          NET_ISSUES.push({ url: url, status: r.status });
        }
        return { ok: false, status: r.status, text: '' };
      }
      return { ok: true, status: r.status, text: (await r.text()).replace(/\r/g, '') };
    } catch (e) { if (i === (tries || 2) - 1) return { ok: false, status: 0, text: '', err: e.message }; await sleep(800); }
  }
  return { ok: false, status: 0, text: '' };
}
// ============================================================ ★ V1.9.5（H42）：两个"上游变了"的账本
// 依据（§17.3，CelesTrak 使用政策的原文要点）：
//   ① 旧格式（含 legacy TLE 文本）将在 5 位目录号**用尽时**停用，官方要求迁移到 CSV/JSON；
//   ② "收到任何非 200 响应必须立即停止并交人排查"（反复无视会被拉黑名单）。
// 本条实现的是**探测 + 显式失败**（迁移本身列后续批次）：
//   · 200 但内容不再是"卫星名 / l1 / l2"三行结构（CSV/JSON/HTML 页）→ FORMAT_ALARM；
//   · 任何非 200 → NET_ISSUES（在 get() 里记账，不重试）。
// 为什么必须响亮失败：`parseTLE` 对陌生文本只会返回 0 条，而 0 条在下游与"上游没更新"无法区分
//   → 任务会"成功"、数据静默停更。这正是 2026-10 那次"最新星网批次无制造商"的同一类病。
const NET_ISSUES = [];
// ★ 2026-10-20（故障 C）：**软告警账本** —— 点名探测（CATNR=/NAME=）偶发 5xx 记这里。
//   与 NET_ISSUES 的区别：NET_ISSUES 一票否决（exit 7），SOFT_ISSUES **只告警不拦构建**。
//   为什么必须分成两个账本而不是"不入账"：不入账就变成静默（用户排障时看不到"上游刚才抖过"）；
//   入 NET_ISSUES 又会让 CI 永远红。⇒ 第三个账本，逐条打印 + 写进 report.netSoft。
const SOFT_ISSUES = [];
// ★ 2026-10-20（故障 E）：**"查无此项"的计数** —— 点名探测/补拉的 404 是合法空回执，
//   既不拦构建也不该当告警刷屏。但完全不统计就变成"看不见"：若某轮它突然从 80 涨到 800，
//   说明我们在一批批查**上游根本没有的对象**（例如目录里的编号错位），那是该被看见的信号。
//   ⇒ 只记一个数，在汇总里打一行（不进 report.netSoft，不逐条打印）。
let SOFT_404_N = 0;
const FORMAT_ALARM = [];
/** 包一层 parseTLE：200 但内容不像 TLE → 记一笔格式告警（返回 0 条，不抛）
 *  判据在 `scripts/format_guard.mjs`（纯函数 → smoke 可直接 import 测，含 8 例样本自测） */
function parseTLEGuarded(txt, into, srcTag) {
  const chk = checkFormat(txt, 'tle');
  if (!chk.ok) {
    if (FORMAT_ALARM.length < 6) FORMAT_ALARM.push({ src: srcTag, kind: chk.kind, sample: String(txt).slice(0, 100).replace(/\n/g, '⏎') });
    return 0;
  }
  return parseTLE(txt, into);
}

/**
 * ★ V1.9.5（H42）：OMM JSON（CelesTrak `FORMAT=json`）→ 与 parseTLE **完全同构**的 merged 条目。
 *   与 S5 用的是同一套转换（`fromCelesTrakOmm` + `tleFromOmm`，见 scripts/omm.mjs），
 *   只是这里要处理**一整个数组**（GROUP 查询会返回几十~几百条）。
 *   条目字段与 parseTLE 对齐：{ name, l1, l2, epoch(=YYDDD.DD), epochMs, cospar }。
 * ⚠️ 编目号 **>5 位**的对象在 TLE 里只能用占位号（真号后 5 位），映射记进 sidecar `omm_norad.json`
 *   —— 与 S5 同一条铁律（≤5 位号**不得**记自映射，否则统计失真）。
 */
function parseOMM(txt, into) {
  let arr;
  try { arr = JSON.parse(txt); } catch (e) { return 0; }
  const list = Array.isArray(arr) ? arr : (arr && Array.isArray(arr.data) ? arr.data : [arr]);
  let n = 0;
  for (const om of list) {
    if (!om || typeof om !== 'object' || om.MEAN_MOTION === undefined || om.NORAD_CAT_ID === undefined) continue;
    const norad = Number(om.NORAD_CAT_ID);
    if (!norad) continue;
    const ph = PH(norad);
    const t = fromCelesTrakOmm(om);
    const [l1, l2] = tleFromOmm(t, ph);
    const ep = t.EPOCH_Y2 * 1000 + t.EPOCH_DOY;            // 与 parseTLE 的 `epoch` 同一口径（YYDDD.DD）
    const key = Number(ph);
    const old = into.get(key);
    if (old && old.epoch >= ep) continue;                  // 同一颗保留历元最新的一份
    into.set(key, {
      name: om.OBJECT_NAME || ('NORAD ' + norad), l1: l1, l2: l2,
      epoch: ep, epochMs: tleEpochMs(l1), cospar: cosparField(om.OBJECT_ID || '').trim()
    });
    if (String(norad).length > 5) OMM_IDS[ph] = norad;      // 只有"真号 >5 位"才需要占位号映射
    n++;
  }
  return n;
}

/**
 * ★ V1.9.5（H42）：按**本次抓取格式**分派解析 —— 迁移期两种格式都必须认得，
 * 且"收到了另一种格式"要**记账告警**（那说明上游灰度/回退，属于必须知道的状态变化）。
 */
function parseGPGuarded(txt, into, srcTag) {
  const chk = checkFormat(txt, GP_EXPECT);
  if (!chk.ok) {
    if (FORMAT_ALARM.length < 6) FORMAT_ALARM.push({ src: srcTag, kind: chk.kind, sample: String(txt).slice(0, 100).replace(/\n/g, '⏎') });
    return 0;
  }
  return GP_EXPECT === 'tle' ? parseTLE(txt, into) : parseOMM(txt, into);
}
// TLE 文本 → Map(norad -> {name,l1,l2,epoch})
function parseTLE(txt, into) {
  const lines = txt.split('\n').map(l => l.trim()).filter(Boolean);
  let n = 0;
  for (let i = 0; i + 2 < lines.length; i += 3) {
    const l1 = lines[i + 1], l2 = lines[i + 2];
    if (!/^1 /.test(l1) || !/^2 /.test(l2)) continue;
    const id = parseInt(l1.slice(2, 7), 10); if (!id) continue;
    const ep = parseFloat(l1.slice(18, 32)) || 0;
    const old = into.get(id);
    if (old && old.epoch >= ep) continue;                  // 同一颗保留历元最新的一份
    into.set(id, { name: lines[i].trim(), l1, l2, epoch: ep, epochMs: tleEpochMs(l1), cospar: l1.slice(9, 17).trim() });
    n++;
  }
  return n;
}
// ★ V1.9.3：TLE 历元 → 毫秒的函数 `tleEpochMs` 已 import 自 `scripts/omm.mjs`
//   （放那边是因为**可被 smoke 直接 import 测试**；本文件里的 `parseTLE` 只把它结果存成
//    `epochMs` 字段，不重复实现）。
//   ⚠️ 血泪教训（2026-10-13）：`parseTLE` 存的那个 `epoch` 是 **TLE 原始数值**（`YYDDD.DD`，
//   如 `26282.76`），**不是毫秒**！我第一版新鲜度闸门直接拿它当毫秒 →
//   算出"落后 20739 天" → 在**数据完全正常的 CI 上**把闸门自己变成了故障源（exitCode 5）。
//   教训：用别人的变量前必须先核实**单位与类型**，不能只看名字。详见 omm.mjs 的注释。
function writeTLE(file, map, oldPath) {
  const lines = [];
  [...map.values()].sort((a, b) => a.cospar.localeCompare(b.cospar) || a.epoch - b.epoch)
    .forEach(s => { lines.push(s.name.padEnd(24), s.l1, s.l2); });
  const txt = lines.join('\n') + '\n';
  if (!/^1 [0-9]/m.test(txt)) { console.log('  !! 内容异常，保留旧文件 ' + file); return false; }
  if (oldPath && fs.existsSync(oldPath)) fs.writeFileSync(oldPath + '.bak', fs.readFileSync(oldPath), 'utf8');
  fs.writeFileSync(path.join(D, file), txt, 'utf8');
  console.log('  saved', file, txt.length, 'bytes,', map.size, 'sats');
  return true;
}
function readTLE(file) {
  if (!fs.existsSync(path.join(D, file))) return new Map();
  const m = new Map(); parseTLE(fs.readFileSync(path.join(D, file), 'utf8'), m); return m;
}

// ---------------------------------------------------------------- 离线自检（不联网）
// V1.9.1：S5 的 OMM 链路曾经"补到 0 颗"却看不出原因（静默 catch + 环境不可达），
//   而且原始 bug 直接导致 55 颗卫星在页面里整批消失。自检逻辑放在 **scripts/omm_check.mjs**
//   （纯函数、零副作用）—— 这里只做命令行的打印与退出码，测试（smoke.mjs）则直接 import 它。
if (process.argv.includes('--selftest-omm')) {
  const { ommSelfTest } = await import('./scripts/omm_check.mjs');
  const r = ommSelfTest();
  r.forEach(x => console.log((x.ok ? 'PASS ' : 'FAIL ') + x.name + (x.info !== undefined ? '  → ' + x.info : '')));
  const nf = r.filter(x => !x.ok).length;
  console.log('\n自检结论：' + (nf ? '失败 ' + nf + ' 项' : '全部通过'));
  process.exit(nf ? 1 : 0);
}

// ---- SATCAT：每周拉一次就够了（6.7MB，约 70s）----
console.log('取数格式 GP_FORMAT=' + GP_FORMAT + '（期望 ' + GP_EXPECT + '）' +
  (GP_FORMAT === 'tle' ? '  ⚠️ 已回退到 legacy TLE —— 仅用于对照/应急' : ''));
const catPath = path.join(D, 'satcat.csv');
const age = fs.existsSync(catPath) ? (Date.now() - fs.statSync(catPath).mtimeMs) / 86400000 : 999;
if (forceCat || age > 7) {
  console.log('satcat.csv 拉取中（' + (age > 900 ? '首次' : '已 ' + age.toFixed(1) + ' 天') + '）…');
  // ★★ V1.9.3：让"单个补充数据源的一次网络抖动"不再有资格毁掉整条日常链路。
  //   旧写法：`await get(SATCAT_URL, 1)` —— **只试一次、不重试**，且沿用 20s 的小文件超时。
  //   而 data/satcat.csv 被 .gitignore → 每个 runner 都是全新的、没有旧副本可退。
  //   于是一次偶发网络错误就足以让整个 CI 失败。**修法（三管齐下，缺一不可）**：
  //     ① **3 次重试**（默认只 1 次）—— 偶发抖动自己会好；
  //     ② **180s 独立超时**（6.7MB 大文件不套小文件的 20s）；
  //     ③ workflow 里加 actions/cache —— 跨 run 保留旧副本，见 update-tle.yml。
  //   另外把**真实错误原因**打出来：旧日志只有 `status 0`，看不出是超时、DNS 还是连接重置，
  //   下次再挂还得从头查一遍。
  const r = await get(SATCAT_URL, SATCAT_TRIES, SATCAT_TIMEOUT_MS);
  if (r.ok && r.text.split('\n').length > 1000 && /OBJECT_NAME,OBJECT_ID/.test(r.text.split('\n')[0])) {
    fs.writeFileSync(catPath, r.text, 'utf8');
    console.log('  satcat.csv saved', r.text.length, 'bytes');
  } else if (!fs.existsSync(catPath)) {
    // V1.9.1：拉不到 **且没有旧副本** → 三处功能（已再入标记 / 台账扣减 / 搜索补池）会静默失效，
    //   产物看起来却完全正常。所以这里主动失败（非零退出，CI 的 `set -e` 会截断后续步骤）。
    console.error('  ✗ satcat.csv 拉取失败（status ' + r.status + (r.err ? '，原因：' + r.err : '') +
      '，已重试 3 次）且本机无旧副本 ——' +
      '已再入标记/台账扣减/搜索补池将静默失效，故主动失败而非产出残缺产物。');
    process.exitCode = 4;
  } else console.log('  !! satcat 异常（status ' + r.status + (r.err ? '，原因：' + r.err : '') +
    '，已重试 3 次），沿用旧文件（' + age.toFixed(1) + ' 天）');
} else console.log('satcat.csv 仅 ' + age.toFixed(1) + ' 天，跳过（--force-cat 可强制）');

// 从目录里按名称反查两个星座的所有对象，按 COSPAR 前缀归批
const catByPrefix = { gw: {}, qf: {} };
if (fs.existsSync(catPath)) {
  const rows = fs.readFileSync(catPath, 'utf8').split('\n');
  const head = rows[0].split(',');
  const ix = n => head.indexOf(n);
  const iId = ix('OBJECT_ID'), iNo = ix('NORAD_CAT_ID'), iTy = ix('OBJECT_TYPE'), iNm = ix('OBJECT_NAME');
  const iLd = ix('LAUNCH_DATE'), iDec = ix('DECAY_DATE'), iPer = ix('PERIOD'), iInc = ix('INCLINATION');
  const iApo = ix('APOGEE'), iPeg = ix('PERIGEE'), iSite = ix('LAUNCH_SITE');
  const cat = { gw: [], qf: [] };
  // ★ V1.9.1（1.4）：这里就是"名字正则"的**第一处**拦截点（决定"要不要去查"）。
  //   注意它原本把两道判据**串在一起**的写法 `if (!MATCH[k].test(nm)) continue;` 之后才解析 COSPAR ——
  //   而白名单判据需要 COSPAR 前缀，所以必须先解析出 pre 再判。
  //   同时还把"只有名字命中才 push"的结构松开了：**两条通道各自独立**，
  //   名字命中 **或** 批次白名单命中，都算本星座对象。
  let incHit = { gw: 0, qf: 0 };
  rows.slice(1).forEach(line => {
    if (!line) return;
    const c = line.split(',');
    const nm = (c[iNm] || '').trim(), id = (c[iId] || '').trim(); if (!nm || !id) return;
    const m = id.match(/^(\d{4})-(\d{3})/); if (!m) return;
    const pre = m[1].slice(2) + String(+m[2]).padStart(3, '0');
    const norad = +c[iNo];
    for (const k of ['gw', 'qf']) {
      const byName = MATCH[k].test(nm);
      const byBatch = !byName && (includedByBatch(k, pre, norad) || includedByCard(k, norad));
      if (!byName && !byBatch) continue;
      if (byBatch) incHit[k]++;
      const o = { norad: norad, name: nm, cospar: id, type: (c[iTy] || '').trim(), pre: pre,
        launch: (c[iLd] || '').trim(), decay: (c[iDec] || '').trim(), site: (c[iSite] || '').trim(),
        per: +c[iPer], inc: +c[iInc], apo: +c[iApo], peg: +c[iPeg] };
      (catByPrefix[k][pre] = catByPrefix[k][pre] || []).push(o);
      cat[k].push(o);
    }
  });
  fs.writeFileSync(path.join(D, 'cat_objs.json'), JSON.stringify(cat), 'utf8');
  console.log('目录命中：gw', cat.gw.length, '个对象 /', Object.keys(catByPrefix.gw).length, '批；qf',
    cat.qf.length, '个对象 /', Object.keys(catByPrefix.qf).length, '批');
  // 白名单通道的战绩（名字不含关键字的那一类）—— 打出来才看得见它到底生效没有
  console.log('  ├ 其中"按批次点名纳入"（名字不含星座关键字）：gw', incHit.gw, '个 / qf', incHit.qf, '个');
  if (!incHit.gw && !incHit.qf) console.log('  ⚠️ 白名单一个都没命中 —— 请检查 INCLUDE 的批次前缀是否与 satcat 的 COSPAR 一致');
}

// ---- 逐星座合并四个来源 ----
const report = {};
for (const key of ['gw', 'qf']) {
  const file = key === 'gw' ? 'ct_hulianwang.tle' : 'ct_qianfan.tle';
  const old = readTLE(file);
  const merged = new Map(old);
  // V1.9.1：入口体检 —— 剔除上一轮遗留的**坏行**（数值列含 NaN）。
  //   不做这一步的话它们会永久滞留（原因见 tleHealth 上方的长注释）。
  let droppedBad = 0;
  for (const [k, s] of [...merged]) {
    if (!tleHealth(s.l2 || '')) { merged.delete(k); droppedBad++; }
  }
  const prevN = old.size;                                  // 上一轮 .tle 里的条数（未体检）
  if (droppedBad) {
    console.log(key, '⚠️ 上轮遗留 ' + droppedBad + ' 条坏行（L2 数值列含 NaN）→ 已剔除，本轮将由 S5 重新取');
  }
  const before = merged.size;                              // 体检后的起点（S2 日志的算术用它）
  report[key] = { prevN: prevN, before: before, droppedBad: droppedBad };
  const from = { group: 0, name: 0, catnr: 0, alt: 0 };

  // S1 分组（V1.9.5·H42：格式走 GP_FORMAT，默认 OMM JSON）
  let r = await get(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${GROUPS[key]}&FORMAT=${GP_FORMAT}`);
  if (r.ok) from.group = parseGPGuarded(r.text, merged, 'S1 GROUP'); else console.log('  S1 GROUP 失败', r.status);
  console.log(key, 'S1 GROUP  →', from.group, '份');

  // S2 名称模糊
  const szBeforeS2 = merged.size;                          // 只量 S2 这一段的前后差，量的是"净增"
  for (const nm of NAMES[key]) {
    r = await get(`https://celestrak.org/NORAD/elements/gp.php?NAME=${encodeURIComponent(nm)}&FORMAT=${GP_FORMAT}`);
    if (r.ok) from.name += parseGPGuarded(r.text, merged, 'S2 NAME=' + nm); else console.log('  S2 NAME=' + nm, r.status);
  }
  // ★★ 2026-10-20（故障 F）：这行**曾经打印过负数**（实测 `S2 NAME → 新增 -226 颗`）。
  //   旧公式 = `merged.size - before - from.group`，把两件不同性质的事混在一个减法里：
  //     · `merged.size - before` 是**净增颗数**（去重后的集合大小变化）；
  //     · `from.group` 是 S1 **写入+更新**的条数（`parseOMM/parseTLE` 的返回值）。
  //   S1 的绝大多数动作是"更新已有星的历元"，集合大小**一点没变**，
  //   但返回值照样计入 → 相减必为负。CI 上真实出现：`S1 226 份 / S2 新增 -226 颗`（S2 其实 404、新增 0）。
  //   为什么必须修：负数会让人误读成"数据在减少"，而这一行恰恰是用来观察采集效果的；
  //   口径一错，排障时就会顺着假信号往下查（我本轮就差点这么干）。
  //   修法：S2 只报**它自己的**净增 —— 用 S2 段前后 `merged.size` 的差（`parseGPGuarded`
  //   的返回值是"写入+更新"条数，仍不等于净增，所以两处都不能直接当"新增"用）。
  //   同时保留 `from.name`（写入+更新条数）在报告里，两个口径都可见、不再互相污染。
  const szAfterS2 = merged.size;
  console.log(key, 'S2 NAME   → 新增', szAfterS2 - szBeforeS2, '颗（累计', merged.size,
    '；本轮写入/更新', from.name, '份）');

  // S3 目录里查得到编号、但上面没拿到的（跳过已再入的）
  //   ⚠️ 编目号 **超过 5 位**的对象**不在这里处理** —— 经典 TLE 的编目号字段只有 5 列，
  //     对 6 位号调 FORMAT=tle 一律返回「No GP data found」（实测 100203）。它们统一走下面的 S5：
  //     用 FORMAT=json（OMM）取，再转成"TLE 形状"（编目号用占位）并把真号记进 sidecar。
  //   ★ 旧注释写的是「临时号：目录里没有轨道要素」——**这个前提是错的**（实测有完整 GP），
  //     误导过一次全库级排查，见 V1.9.1 任务清单第十轮核查。
  const todo = [];
  Object.keys(catByPrefix[key] || {}).forEach(p => {
    (catByPrefix[key][p] || []).forEach(o => {
      // ★ V1.9.1（1.4-D）：**不再因 `decay` 跳过**。
      //   用户要求：已再入卫星的**历史 TLE** 也要录入数据库，并在卫星列表 / 变轨情况等处呈现。
      //   已再入对象在 satcat 里 `DECAY_DATE` 非空，但它仍有可用的 GP 数据（至少是再入前最后一份），
      //   老代码把这一整类挡在门外 → 曲线里永远看不到"它飞到了哪里然后就没了"。
      //   代价可控：第一轮取到后 `merged` 里就有它了，后续轮次不会再请求
      //   （S5 只对 >5 位编目号强制重取，5 位号的一旦入账就跳过）。
      if (o.type !== 'PAY') return;
      if (String(o.norad).length > 5) return;               // >5 位 → 走 S5 的 OMM 通路
      if (merged.has(o.norad)) return;
      todo.push(o);
    });
  });
  // ★ V1.9.1（1.4）：白名单批次的对象**排到最前面**，保证不被下面的 `slice(0,60)` 挤掉。
  //   为什么需要：todo 会包含 catByPrefix 里所有没拿到的对象；正常运行时它很小（S1/S2 已覆盖
  //   绝大多数），但在"首次补齐/起点为空"这类场景下 todo 可能上百 —— 而白名单那 14 颗
  //   恰恰是**唯一只有这条路能救**的，一旦被 cap 截掉就永远补不上（离线测试实测：CX-26 与
  //   DTC-01 正是这样丢的）。
  todo.sort((a, b) => {
    const ia = (includedByBatch(key, a.pre, a.norad) || includedByCard(key, a.norad)) ? 0 : 1;
    const ib = (includedByBatch(key, b.pre, b.norad) || includedByCard(key, b.norad)) ? 0 : 1;
    return ia - ib;
  });
  for (const o of todo.slice(0, 60)) {
    r = await get(`https://celestrak.org/NORAD/elements/gp.php?CATNR=${o.norad}&FORMAT=${GP_FORMAT}`);
    // ★ V1.9.1（1.4）修的真 bug：这里原本是 `/^1 /.test(r.text)` —— **没有 `m` 标志**。
    //   CelesTrak 的 FORMAT=tle 返回是「卫星名行 + 1 行 + 2 行」三行，文本**以名字开头**，
    //   而无 `m` 标志时 `^` 只匹配**字符串开头** → 判断**恒为 false** → parseTLE 从不执行
    //   → **这条通路从来没有成功过一次**（"补到 0 颗"却看不出原因，因为 todo 常为 0 而不打印）。
    //   它和 1.8 是同一类：判据写错 → 静默失效 → 测试又恰好没覆盖。
    //   症状一直没暴露，是因为 S1（GROUP=hulianwang）/S2（NAME=HULIANWAN）覆盖了绝大多数卫星，
    //   而**名字不含关键字的那些**（CX / KL / DTC / OBJECT B）恰好只有这条通路能救。
    // ★ V1.9.5（H42）：判据不再写死 TLE 形状 —— 改成**按本次格式**判定（parseGPGuarded 内部就带
    //   `checkFormat`，收到的既不是期望格式也不是合法空结果时会记 FORMAT_ALARM）。
    //   旧写法若保留，切到 FORMAT=json 后会**恒为 false** —— 与上面那次的病一模一样。
    if (r.ok) from.catnr += parseGPGuarded(r.text, merged, 'S3 CATNR=' + o.norad);
    await sleep(120);
  }
  // V1.9.1（1.4-D）：把"其中已再入几颗"打出来 —— 这类对象的采集效果必须看得见，
  //   否则"放行了但一颗没取到"和"根本没放行"在日志上长得一模一样。
  if (todo.length) console.log(key, 'S3 CATNR  → 目录待补', todo.length, '颗（含已再入',
    todo.filter(o => o.decay).length, '颗），补到', from.catnr, '颗');

  // S4 备源：tle.ivanstanojevic.me（按 NORAD）
  // ★ V1.9.3（**如实说明，避免把"正常"误读成"故障"**）：这条通路在近几轮 CI 上一直
  //   打印「待补 N 颗，补到 **0** 颗」—— 看着像坏了，其实是**设计使然**，两个原因叠加：
  //     ① 上面 `if (String(o.norad).length > 5) return;` 把 **6 位号**对象全部让给 S5
  //        （这是 2026-07-11 起新编目的主力，现约 62 颗）；
  //     ② 剩下的 5 位号对象之所以还在"待补"名单里，是因为 S1/S2 只能覆盖约 180~250 颗
  //        （`GROUP=hulianwang` 只返回 181 份），其余靠 S3（CATNR 反查）补齐 ——
  //        而 S4 是在 S3 **之后**跑的，此时仍未入库的多是"上游本身就没有"的对象。
  //   实测（CI run 38351198029）：S3 待补 208 → 补到 60；S4 待补 148 → 补到 0；
  //     S5 待补 193 → **补到 193、失败 0**（主力通路完全兜住）。
  //   ⇒ 所以 S4 的价值是**最后一层兜底**（万一 S5 的 OMM 通路整体不可用），
  //     正常情况下"补到 0"不代表数据缺失 —— 看 S5 的计数才是判据。
  const still = [];
  Object.keys(catByPrefix[key] || {}).forEach(p => {
    (catByPrefix[key][p] || []).forEach(o => {
      if (o.type !== 'PAY') return;                           // 已再入的同样采集（见 S3 处说明）
      if (String(o.norad).length > 5) return;               // >5 位 → 走 S5
      if (merged.has(o.norad)) return;
      still.push(o);
    });
  });
  for (const o of still.slice(0, 40)) {
    r = await get(`https://tle.ivanstanojevic.me/api/tle/${o.norad}`);
    if (r.ok) {
      try {
        const j = JSON.parse(r.text);
        if (j && j.line1 && j.line2) {
          // ★ V1.9.1（1.4-D）：备源结果的**三道校验**（旧版一道都没有，于是"补到"可以是假的）：
          //   ① **norad 必须一致** —— 备源按 NORAD 查，理论上返回的就是这颗；
          //      但不校验的话，一旦它返回缓存/邻近对象的数据，我们就会**张冠李戴**地
          //      把别星的轨道写进这颗名下（而且历元看着还挺新，极难发现）。
          //   ② **名字用目录里的 `o.name`**（权威、且已被 MATCH 认可）—— 备源的 `j.name`
          //      可能是占位名或旧名，用它会被下游的星座过滤丢掉。
          //      实测（CI run 37960887451）：已再入的 63428「S4 号称补到 1 颗」，
          //      但最终仍缺 —— 正是因为下落的名字过不了星座过滤。
          //   ③ **计数以"真的进了 merged"为准** —— 旧版只要 line1/line2 存在就 +1，
          //      于是"补到 N 颗"与"库里真有 N 颗"可以互相矛盾（假阳性计数）。
          // ★ V1.9.3（**兼容性体检抓到的真缺口**）：备源返回的 line1 里编目号只有 **5 列**，
          //   而 6 位对象（100000+，CelesTrak 2026-07-11 起新编目一律 6 位）在 TLE 里
          //   只能写成**真号后 5 位**（`100203` → `00203`）。
          //   旧写法直接 `parseInt(line1.slice(2,7))` 拿它跟 `o.norad`（**真号** 100203）比
          //   → `203 !== 100203` **恒不相等** → 这些星在 S4 永远"补到 0 颗"。
          //   实测证据（CI run 38349678820）：`gw S4 备源 → 待补 148 颗，补到 0 颗`。
          //   修法：先经 sidecar（`OMM_IDS`：占位号 → 真号）还原，再比 —— 与
          //   历史存档段（本文件 `const norad = OMM_IDS[raw5] || …`）**同一套口径**。
          const gotRaw5 = String(j.line1).slice(2, 7).padStart(5, '0');
          const got = Number(OMM_IDS[gotRaw5] || parseInt(gotRaw5, 10));
          if (got === o.norad) {
            const szBefore = merged.size;
            parseTLE((o.name || j.name) + '\n' + j.line1 + '\n' + j.line2 + '\n', merged);
            if (merged.size > szBefore) from.alt++;
            else { from.altSkip = (from.altSkip || 0) + 1; }        // 解析成功但没入账（同名同历元被跳过）
          } else {
            from.altBad = (from.altBad || 0) + 1;
            if (!from.altBadMsg) from.altBadMsg = [];
            if (from.altBadMsg.length < 3) from.altBadMsg.push(o.norad + ' ← 备源给了 norad=' + got);
          }
        }
      } catch (e) { /* 不是 JSON：忽略 */ }
    }
    await sleep(120);
  }
  if (still.length) {
    console.log(key, 'S4 备源   → 待补', still.length, '颗，补到', from.alt, '颗' +
      (from.altBad ? '｜⚠️ norad 不匹配 ' + from.altBad + ' 颗（' + (from.altBadMsg || []).join('；') + '）' : '') +
      (from.altSkip ? '｜未入账 ' + from.altSkip + ' 颗' : ''));
  }

  // ---- S5 OMM：**兜底通路**（任何 S1–S4 没拿到的对象都在这里试） ----
  //   为什么需要它：CelesTrak 自 2026-07-11 起**新对象一律 6 位编目号**（100000+），
  //   而**经典 TLE 的编目号字段只有 5 列** → 这些对象调 FORMAT=tle 一律「No GP data found」，
  //   S1（GROUP）/S2（NAME）/S3（CATNR+tle）/S4（备源）**全都拿不到**。
  //   ★ V1.9.1 起的口径（这就是"不会再出现无法识别新编号"的保证）：
  //     · 判据**不再是"≥100000"这个魔数**，而是「**编目号位数 > 5**」——
  //       将来若出现 7 位号，同一段代码自动适用；
  //     · 而且这里**不再限定 5 位/6 位**：凡是 catByPrefix 认定属于本星座、
  //       而前面四条通路没取到的对象，**一律用 OMM 再试一次**（顺带兜住 S3/S4 的偶发失败）。
  //   做法：FORMAT=json（OMM）→ scripts/omm.mjs 转成"TLE 形状"文本（**编目号填占位 =
  //   真号后 5 位**）→ 真号记进 data/omm_norad.json，由 mkdata.mjs 写回前端 id（前端零改动）。
  //   （转换器自带往返自检：node scripts/omm.mjs --selftest。）
  const ommTodo = [];
  Object.keys(catByPrefix[key] || {}).forEach(p => {
    (catByPrefix[key][p] || []).forEach(o => {
      if (o.type !== 'PAY') return;                           // 已再入的同样采集（见 S3 处说明）
      // ★ 判据分两类（V1.9.1 定稿）：
      //   · 编目号 **>5 位**：S1–S4 那条 TLE 通路**永远**拿不到（编目字段装不下）→
      //     OMM 是唯一来源，因此**每轮都必须重取**。旧版写的是「占位号在 merged 里就跳过」，
      //     后果有两个：① 落盘的坏行（NaN）永远修不好；② 历元永远停在第一次取到的那份，
      //     TLE 不再更新（页面轨道慢慢跑偏）。两个后果都属于"看起来正常"的静默故障。
      //   · 编目号 ≤5 位：正常应被 S1/S2 覆盖，走到这里说明前四条通路都失败了 →
      //     用 OMM 兜底补一次即可，已在 merged 里就不必重取。
      if (merged.has(Number(PH(o.norad))) && String(o.norad).length <= 5) return;
      ommTodo.push(o);
    });
  });
  // ★ 静默 catch 是"补到 0 颗"却看不出原因的元凶（V1.9.0 起一直没发现）→ 现在累计错误并打印。
  let ommErr = 0; const ommErrMsg = [];
  const OMM_CAP = 400;                                   // 上限（正常规模 ~55；留足余量并防失控）
  for (const o of ommTodo.slice(0, OMM_CAP)) {
    // ★ 2026-10-20（故障 C 配套，用户要求"信息要全"）：S5 的点名补拉**加一次尝试**。
    //   实测依据（run 39437803662）：45 个补拉里 2 个撞 500（100794/100974），
    //   而默认只试 2 次、间隔 800ms —— 上游瞬时 5xx 往往几百毫秒就恢复，
    //   多给一次机会能实打实把这 2 颗的历元刷到最新（而不是沿用上一轮）。
    //   只对**这一处**加，不全局调高：S5 是唯一"逐颗批量"的通道（一轮几十个），
    //   失败代价是"该颗历元陈旧"；而 GROUP= 是单次固定请求，加次数意义不大。
    r = await get(`https://celestrak.org/NORAD/elements/gp.php?CATNR=${o.norad}&FORMAT=json`, 3);
    if (!r.ok) {
      ommErr++;
      if (ommErrMsg.length < 3) ommErrMsg.push(o.norad + ': HTTP ' + r.status + (r.err ? ' ' + r.err : ''));
    } else {
      try {
        const arr = JSON.parse(r.text);
        const om = Array.isArray(arr) ? arr[0] : arr;
        if (om && om.MEAN_MOTION) {
          const ph = PH(o.norad);
          const t = fromCelesTrakOmm(om);
          const [l1s, l2s] = tleFromOmm(t, ph);
          // 直接按占位号塞进 merged（名称沿用目录里的写法，便于下面的 MATCH 过滤）
          // ★ V1.9.1（1.4）修的 bug：`cospar` 必须用 **cosparField 归一化后的 6 列形式**。
          //   旧写法存的是 OMM 的原始 `OBJECT_ID`（**9 字符** `"2026-158A"`），
          //   而下游（最终过滤、批次归属）一律按 `slice(0,5)` 取批次 key →
          //   对 "2026-158A" 得到 `"2026-"` → **白名单批次匹配必然失败**，
          //   于是"S5 明明取到了、却在最后一步被丢掉"（离线测试实测：CX-26 与 DTC-01 就这么丢的）。
          //   归一化后与 parseTLE 的 `l1.slice(9,17).trim()` 完全同构，merged 里只有一种格式。
          merged.set(Number(ph), { name: o.name, l1: l1s, l2: l2s,
            epoch: t.EPOCH_Y2 * 1000 + t.EPOCH_DOY, cospar: cosparField(om.OBJECT_ID || o.cospar).trim() });
          // ★ V1.9.1（1.4）：只在"**占位号 ≠ 真号**"时才记映射。
          //   映射表（data/omm_norad.json）的**语义就是"占位号 → 真号"**，供前端把
          //   写进 TLE 的占位号还原成真号。而 S5 既是 6 位号的唯一通路、又是全量的兜底通路，
          //   对 ≤5 位号的对象 ph === 真号（无占位），记进去就是 `44785 → 44785` 这种**自映射**：
          //   语义上无意义、还会让"映射条数"这类统计失真（端到端断言正是这样抓到的）。
          //   判据直接用「真号位数 > 5」（= 需要占位号的那种），比比较字符串更直白。
          if (String(o.norad).length > 5) OMM_IDS[ph] = o.norad;
          from.omm = (from.omm || 0) + 1;
        } else { ommErr++; if (ommErrMsg.length < 3) ommErrMsg.push(o.norad + ': 响应无 MEAN_MOTION（' + r.text.slice(0, 60).replace(/\s+/g, ' ') + '）'); }
      } catch (e) {
        ommErr++;
        if (ommErrMsg.length < 3) ommErrMsg.push(o.norad + ': JSON 解析失败 — ' + (e && e.message));
      }
    }
    await sleep(120);
  }
  if (ommTodo.length) {
    console.log(key, 'S5 OMM    → 待补', ommTodo.length, '颗（处理', Math.min(ommTodo.length, OMM_CAP), '），补到', from.omm || 0, '颗，失败', ommErr);
    ommErrMsg.forEach(m => console.log('             · ' + m));
    // ★ 全失败时**必须显式告警**（旧版静默 → 数据静默缺失，是最难查的一类问题）
    if ((from.omm || 0) === 0 && ommErr > 0) console.log('             ⚠️ 全部失败：疑似网络/上游不可达 —— 请检查到 celestrak.org 的连通性');
    if (ommTodo.length > OMM_CAP) console.log('             ⚠️ 超过处理上限 ' + OMM_CAP + '，本次有 ' + (ommTodo.length - OMM_CAP) + ' 颗未处理');
  }

  // 只保留属于本星座的（名字对得上 **或** 批次白名单点名）
  //   · 名字正则这条防的是 `S2 NAME=GW-` 这类前缀误伤（把别的星座的星捞进来）；
  //   · 批次白名单这条防的是**反向漏掉**（CX / KL / DTC / OBJECT B 这些名字毫无关键字的）。
  //   ★ V1.9.1（1.4）：这是"名字正则"的**第二处**拦截点（决定"留不留"）。
  //     两处必须同步改 —— 只改一处会出现"查到了但被丢掉"或"没查但留下了"的诡异现象。
  const out = new Map();
  let outByName = 0, outByBatch = 0;
  [...merged.entries()].forEach(([norad, s]) => {
    const byName = MATCH[key].test(s.name);
    const byBatch = !byName && (includedByBatch(key, lkOfCospar(s.cospar), norad) || includedByCard(key, norad));
    if (!byName && !byBatch) return;
    if (byBatch) outByBatch++; else outByName++;
    out.set(parseInt(s.l1.slice(2, 7), 10), s);
  });
  if (outByBatch) console.log('  ├ 最终保留里"按批次点名纳入"的：' + outByBatch + ' 颗（名字不含星座关键字）');
  Object.assign(report[key], { after: out.size, added: out.size - before, from: from });
  writeTLE(file, out, path.join(D, file));

  // ★ V1.9.1 出口体检：写盘后**立刻复查**，任何一行数值列仍是 NaN 都必须当场喊出来。
  //   理由：这类坏行是"静默污染"（长度正确、正则放过、页面算不出轨道），
  //   出口断言是最后一道网 —— 宁可 CI 红，也不要让坏数据进仓库。
  const badOut = [...out.values()].filter(s => !tleHealth(s.l2 || ''))
    .map(s => s.l1.slice(2, 7) + '/' + (s.cospar || ''));
  if (badOut.length) {
    console.log('  ❌ 出口体检：' + badOut.length + ' 颗卫星的 L2 数值列非法（' + badOut.slice(0, 5).join(', ') +
      (badOut.length > 5 ? ' …' : '') + '）—— 这批数据不可用，请检查上游');
  } else {
    console.log(key, '出口体检 → ' + out.size + ' 颗全部通过（L2 数值列均为有限数）');
  }
  report[key].badOut = badOut.length;

  // 仍然拿不到轨道要素的
  //   ⚠️ 查询键必须兼容**占位号**：6 位对象在 out / merged 里是以占位号（真号后 5 位）为键的，
  //   直接用真号 `out.has(o.norad)` 会恒为 false → 报告"仍缺 36 颗"（而文件里其实已经有），
  //   并把错误的 missing_*.json 写盘（下游会把它们当"无轨道要素"处理）。见 V1.9.1 第十轮核查。
  const miss = [];
  Object.keys(catByPrefix[key] || {}).forEach(p => {
    (catByPrefix[key][p] || []).forEach(o => {
      if (o.type !== 'PAY') return;                           // 已再入的同样采集（见 S3 处说明）
      if (out.has(o.norad) || out.has(Number(PH(o.norad)))) return;
      miss.push({ norad: o.norad, cospar: o.cospar, name: o.name, launch: o.launch, pre: o.pre });
    });
  });
  report[key].missing = miss.length;
  fs.writeFileSync(path.join(D, `missing_${key}.json`), JSON.stringify(miss, null, 1), 'utf8');
  console.log(key, '最终', out.size, '颗（上轮文件', prevN, '颗', (droppedBad ? '，其中坏行 ' + droppedBad : '') +
    '）｜仍缺轨道要素', miss.length, '颗');

  // ---------------------------------------------------------------- V1.9.0（R17）：自建历史库
  // 每次刷新都把「这一刻每颗星的半长轴」存档一条，历史库就一天天自己长起来 ——
  //   这样 04 章「变轨情况」（V1.9.1 A15 前的「升轨情况」）不依赖任何外部历史源（Space-Track 的 GP 历史有严格限流，
  //   且命令行一律 401；免登录源又只给最新一条，实测 tle.ivanstanojevic.me 的历史端点 404）。
  // 口径与页面端完全一致：布劳威尔半长轴（altFromOmm 已剥掉 J2 长期项，量级错误修过一次，
  //   **不要在这里另写一份换算**）。
  // 分片按**批次 key** = COSPAR 后 5 位（如 23095），与 data/history/<key>.json 同名。
  // 幂等：mergeInto 按 (NORAD, 历元) 去重，同一天跑两次不会重复存储（用户 Q40 明确要求）。
  try {
    const byLk = new Map();
    for (const s of out.values()) {
      const mm = Number((s.l2 || '').slice(52, 63));           // TLE 第 2 行 53–63 列 = 平均运动
      const e = parseFloat('0.' + (s.l2 || '').slice(26, 33)); // 第 2 行 27–33 列 = 偏心率
      const inc = parseFloat((s.l2 || '').slice(8, 16));       // 第 2 行 9–16 列 = 倾角
      const yy = parseInt((s.l1 || '').slice(18, 20), 10);
      // ⚠️ 历元日必须取**整个 21–32 列**（含小数）：只取前 3 位（旧写法 slice(20,23)）会得到
      //   整数天，同日内多次刷新会算出**同一个 ms** → 被 mergeInto 判为重复而**存不进去**。
      const ddd = parseFloat((s.l1 || '').slice(20, 32));
      if (!(mm > 0) || !isFinite(yy) || !isFinite(ddd)) continue;
      const fullYear = yy < 57 ? 2000 + yy : 1900 + yy;
      const ms = Date.UTC(fullYear, 0, 0) + ddd * 86400000;
      const alt = altFromOmm({ MEAN_MOTION: mm, ECCENTRICITY: e, INCLINATION: inc });
      if (alt == null || !isFinite(ms)) continue;
      // COSPAR：第 1 行 10–17 列（如 "23095A "）；批次 key 只取**前 5 位数字**。
      //   ⚠️ 旧写法 slice(9,15) 会把第 6 位的分片字母（A）也带进来 → 正则 ^\d{5}$ 恒不匹配
      //   → 所有卫星都被 continue 掉，历史库一个字节都存不进去。
      const cospar = (s.l1 || '').slice(9, 14);
      const lk = /^\d{5}$/.test(cospar) ? cospar : null;
      if (!lk) continue;
      // ⚠️ 编目号必须换成**真号**：6 位对象在 .tle 里是**占位号**（真号后 5 位），
      //   若直接把占位号写进历史库，页面端 `climbSatIdx()` 拿真号（mkdata 已还原）去匹配就永远找不到 →
      //   曲线空白的**静默**故障。OMM_IDS 是本轮 S5 刚落盘的「占位号 → 真号」映射。
      const raw5 = (s.l1 || '').slice(2, 7);
      const norad = OMM_IDS[raw5] || parseInt(raw5, 10);
      if (!norad) continue;
      if (!byLk.has(lk)) byLk.set(lk, []);
      // ★ V1.9.1 常量统一：回加的地球半径必须与**页面端 CLIMB_RE 一致**（见 scripts/fetch_history.mjs
      //   同一处的长注释）。两个写库方（refresh 与 fetch_history）用不同常量，会让同一天的
      //   "半长轴"出现 2 m 级的分叉 —— 虽小，但属"存量与增量口径不一致"的隐患。
      byLk.get(lk).push([norad, ms, Math.round((alt + 6378.137) * 100) / 100]);   // 存**半长轴**（= 高度 + 地球半径）
    }
    let st = { shards: 0, added: 0, pruned: 0 };
    for (const [lk, recs] of byLk) {
      const r2 = mergeInto(HIST_DIR, [{ key: lk, records: recs }]);
      st.shards++; st.added += r2.added;
      // ★ 存档后**立刻做容量治理**：data/history 是要进 git 仓库的，
      //   不治理的话分片会逐年线性膨胀（436 颗 × 1 点/天 ≈ 4 MB/年 → 仓库越来越大）。
      //   pruneRecords 是分层降采样，只降低老数据的密度，**最近的数据一个点都不会少**。
      const cur = readShard(HIST_DIR, lk);
      if (cur.length) {
        const pr = pruneRecords(cur, Date.now());
        if (pr.recs.length !== cur.length) {
          writeShard(HIST_DIR, lk, pr.recs);
          st.pruned += (pr.stats.before - pr.stats.after);
        }
      }
    }
    console.log(key, '历史存档 → ' + st.shards + ' 个批次、新增 ' + st.added + ' 条' +
      (st.pruned ? '、治理裁掉 ' + st.pruned + ' 条' : '') + '（' + byLk.size + ' 批候选）');
    report[key].hist = st;
  } catch (e) {
    // 存档失败**绝不能**影响 TLE 刷新本身（计划任务的主职责是刷新数据）
    console.log(key, '历史存档跳过：', e && e.message);
    report[key].hist = { err: String(e && e.message || e) };
  }
}
fs.writeFileSync(path.join(D, 'refresh_report.json'), JSON.stringify(report, null, 1), 'utf8');
// V1.9.0：把「占位号 → 真号」的映射落盘，供 mkdata.mjs 把真号写回前端 id（前端代码零改动）
fs.writeFileSync(OMM_IDS_PATH, JSON.stringify(OMM_IDS, null, 1), 'utf8');
console.log('\n报告已写入 data/refresh_report.json（OMM 映射 ' + Object.keys(OMM_IDS).length + ' 条 → data/omm_norad.json）');

// ---------------------------------------------------------------- 全局出口闸门（V1.9.1）
// 若产出的 .tle 里仍存在**数值列非法**的行（L2 含 NaN 之类），以非零码退出。
//   为什么必须让进程失败（而不是只打印一句）：
//     · 调用链是 `refresh.mjs && mkdata.mjs && build.mjs` —— 非零码会让后面两步**不执行**，
//       页面不会用坏数据重建；
//     · CI（update-tle.yml）里非零码 → 作业失败 → **"有变化才提交"那一步不执行** →
//       坏数据根本进不了仓库；
//     · 计划任务里非零码 → 任务列表显示失败 → 人看得见（旧版是"任务成功但数据缺失"）。
//   这是"宁可红、不要静默"的落地。
{
  const badTotal = Object.keys(report).reduce((a, k) => a + (report[k].badOut || 0), 0);
  if (badTotal) {
    console.error('❌ 出口闸门：共 ' + badTotal + ' 行卫星数据的数值列非法（L2 含 NaN）—— 这些卫星算不出轨道。');
    console.error('   可能原因：上游字段名变更 / 上游数据本身异常 / 网络不可达导致本轮回落到旧坏行。');
    console.error('   已按"不可用"处理，refresh 以非零码（3）结束，以免坏数据被下游打包或提交。');
    // ⚠️ 用 exitCode 而不是 process.exit()：端到端测试是**同进程 import** 本脚本的，
    //   process.exit() 会把测试进程当场杀掉、断言输出全丢（且无法被 try/catch 拦住）。
    //   exitCode 一样能让 `&&` 调用链与 CI 作业失败，且不影响同进程调用方。
    process.exitCode = 3;
  }
}

// ---------------------------------------------------------------- ★ V1.9.3：数据新鲜度守卫
// 来历：排查"网页显示的更新时间不是最新的"时发现的**静默失败**。
//   网络不通时，S1/S2/S3/S4/S5 **全部失败**，但每一步都只是
//   "新增 0 颗" —— 进程**正常退出 0**，下游照旧 mkdata/build/push。
//   结果是：任务日志写着 `updated and pushed`，仓库里的快照却**一天比一天旧**，
//   而页面上显示的「TLE 更新时间」停在旧历元 —— 现象与"任务成功"矛盾。
//   ⇒ 这是典型的**静默失败**：不报错、看起来正常、产出却是错的。
// 判据：取两个 .tle 里**最新的那份历元**，若距"现在"超过 `STALE_DAYS` 天，就明确报警。
//   为什么用"最新历元"而不是"本轮是否抓到新数据"：
//     上游本来就可能几天不更新某颗星，用"有没有新增"会误报；
//     而"最新历元很旧"只可能有两个原因 —— 网络不通（本轮拿旧文件顶替）或上游真的停了。
//     两种情况都值得让任务**失败可见**（而不是继续把旧快照当成新数据推送）。
// 阈值 3 天：TLE 通常每天多次更新；3 天没动基本可以确定是链路问题。
// ⚠️ 只设 exitCode 不 throw —— 与上面的坏行闸门同一套（同进程 import 的测试不能被杀掉）。
// ⚠️ **端到端测试必须豁免**：`scripts/e2e_*_offline.mjs` 会拿**桩数据**（合成 TLE，历元是假的）
//   同进程 import 本脚本 → 残缺的历元必然触发这条闸门 → exitCode 会污染测试进程的退出码
//   （实测：e2e 打印了 "落后 20739.2 天" 却仍 exit 0，因为测试脚本自己在末尾把码覆盖了 ——
//    但那属于"碰巧没事"，不能依赖）。所以显式认一个环境变量关掉它。
// ★ V1.9.5（H42）：两个"上游变了"的账本 → 显式非零退出（各自独立码，便于 CI/任务日志一眼区分）
if (FORMAT_ALARM.length) {
  console.error('❌ GP 返回的**不是本次期望的格式**（' + FORMAT_ALARM.length + ' 处）—— 疑似上游格式变更/回退：');
  console.error('   本次期望格式 = ' + GP_EXPECT + '（GP_FORMAT=' + GP_FORMAT + '；回退旧格式：`GP_FORMAT=tle node refresh.mjs`）');
  FORMAT_ALARM.forEach(a => console.error('   · ' + a.src + ' → ' + a.kind + '｜' + a.sample));
  console.error('   处置：1) 人工确认 https://celestrak.org/NORAD/documentation/gp-data-formats.php 的当前口径；');
  console.error('         2) 若上游回退到 TLE → 用 `GP_FORMAT=tle` 跑一轮并在此登记；若切到别的格式 → 同步改 scripts/format_guard.mjs 与 scripts/omm.mjs。');
  console.error('   已以非零码（6）结束 —— 不允许"0 条数据但任务成功"。');
  process.exitCode = 6;
}
// ★ 2026-10-20（故障 C）：**软告警** —— 点名探测（CATNR=/NAME=）偶发 5xx，**只告警不拦构建**。
//   为什么放在 NET_ISSUES 之前打印：让读者先看到"严重到什么程度"，再看"被降级的有哪些"。
//   ⚠️ 这一档**绝不静默**：逐条打印 + 写进 report.netSoft + 在日志里给出明确解读，
//     只是不再一票否决。若上游真的整体挂了，GROUP=/satcat 会在下面的 NET_ISSUES 里硬失败。
if (SOFT_ISSUES.length) {
  const nS4 = SOFT_ISSUES.filter(x => x.kind === 'S4 备源').length;
  console.warn('⚠️ CelesTrak 对**点名探测/补拉**返回非 200（' + SOFT_ISSUES.length + ' 次）—— 已降级为告警，不拦构建：');
  SOFT_ISSUES.slice(0, 8).forEach(it => console.warn('   · ' + it.status + ' ← ' + it.url));
  if (SOFT_ISSUES.length > 8) console.warn('   …（其余 ' + (SOFT_ISSUES.length - 8) + ' 条同类，略）');
  console.warn('   解读：这些是逐颗补拉（S3/S5）或名字探测（S2）的批量请求，上游偶发 5xx 属该端点噪声。' +
    (nS4 ? '（其中 S4 备源 ' + nS4 + ' 条）' : ''));
  console.warn('   影响：仅"该颗星的历元可能停在上一轮"，不影响其余卫星；真缺口由「仍缺轨道要素」统计兜住。');
  console.warn('   若这条告警**每轮都出现且数量很大**（例如 >10 条），说明上游在限流/降级，需人工介入。');
} else if (SOFT_404_N) {
  // 全是 404（查无此项）时打一行摘要就够 —— 既不拦构建，也不刷屏。
  console.log('通告：点名探测/补拉有 ' + SOFT_404_N + ' 次 404（查无此项，属正常空回执；含 S4 备源逐颗查）—— 不入告警账本。');
}
report.netSoft = { count: SOFT_ISSUES.length, items: SOFT_ISSUES.slice(0, 40), notFound: SOFT_404_N };
if (NET_ISSUES.length) {
  console.error('❌ CelesTrak 返回**非 200**（' + NET_ISSUES.length + ' 次）—— 按使用政策必须立即停下交人排查：');
  NET_ISSUES.slice(0, 8).forEach(it => console.error('   · ' + it.status + ' ← ' + it.url));
  console.error('   解读：301/404 = 用了旧 URL（上游改版）；50x = 上游过载/被防火墙拦（反复无视会被拉黑）。');
  console.error('   注意：本档只收**固定端点**（GROUP= / satcat.csv）与 404/301 类真异常；');
  console.error('        点名探测（CATNR=/NAME=、S4 备源 /api/tle/<norad>）的 5xx 已降级为上面的告警，');
  console.error('        其 404 视为"查无此项"不入账（2026-10-20 起）。');
  console.error('   已以非零码（7）结束。排查：`curl -sSI "<上面的 URL>"`。');
  if (process.exitCode !== 6) process.exitCode = 7;
}
const STALE_DAYS = 3;
if (!process.env.CISTRACK_SKIP_STALE_CHECK) {
  const staleInfo = [];
  for (const f of ['ct_hulianwang.tle', 'ct_qianfan.tle']) {
    // ⚠️ **必须用 `epochMs`（毫秒），不能用 `epoch`（TLE 原始 YYDDD.DD 格式）** ——
    //   第一版就是错用了 `epoch`，于是 (Date.now() − 282.76) ≈ 20739 天，
    //   在数据完全正常的 CI 上把闸门自己变成了故障源（详见 tleEpochMs 上方注释）。
    let best = 0;
    try {
      for (const s of readTLE(f).values()) {
        if (s.epochMs > best) best = s.epochMs;
      }
    } catch (e) { best = 0; }
    staleInfo.push({ file: f, ageDays: best ? (Date.now() - best) / 86400000 : Infinity });
  }
  const worst = staleInfo.reduce((a, b) => (a.ageDays >= b.ageDays ? a : b));
  report.stale = { days: +worst.ageDays.toFixed(2), file: worst.file, limit: STALE_DAYS };
  if (worst.ageDays > STALE_DAYS) {
    console.error('❌ 数据新鲜度闸门：最新 TLE 历元已落后 ' + worst.ageDays.toFixed(1) + ' 天（>' + STALE_DAYS + ' 天，' +
      worst.file + '）—— 本轮刷新**没有拿到新数据**。');
    console.error('   大概率原因：到 celestrak.org 的网络层不通（代理异常或连接超时）。');
    console.error('   影响：仓库里的离线兜底快照会停在旧日期，页面上的「TLE 更新时间」不前进。');
    console.error('   已以非零码（5）结束，让任务/CI 显式可见（而不是"成功但数据是旧的"）。');
    console.error('   排查：`curl -sSI https://celestrak.org/NORAD/elements/gp.php?GROUP=hulianwang` 看连通性。');
    // ⚠️ 用 5 而不是 4 —— 4 已被上面的「satcat 缺失」占用，两者含义不同，码要分开
    //   （便于任务日志/CI 一眼区分"目录没了"和"数据馊了"）。
    process.exitCode = 5;
  } else {
    console.log('数据新鲜度：最新历元落后 ' + worst.ageDays.toFixed(2) + ' 天（阈值 ' + STALE_DAYS + ' 天）✓');
  }
}
