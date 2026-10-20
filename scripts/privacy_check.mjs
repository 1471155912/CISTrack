/* privacy_check.mjs —— 发布物**去敏感**硬闸门（V1.9.4 起强制）
 * ---------------------------------------------------------------------------
 * 背景（2026-10-14 用户点名）：仓库文件与 Release 说明里混进了**只与作者本机运维
 *   相关、对使用者无意义**的叙事 ——「GitHub 还在发报错邮件」「已知与本机环境相关的事项」
 *   「家用 IP 可过 WAF」「代理 502 / CONNECT tunnel」「本机到 celestrak 不通」「本机
 *   Windows 计划任务」等。这些是开发者私有环境的诊断，不该进入公开仓库/发布说明。
 *
 * 本脚本把这条要求变成**机器可执行**的规则，杜绝复发：
 *   扫描所有**会进入 GitHub 仓库**的文本，命中即列出文件:行并失败。
 *   - 归档 CHANGELOG 里的历史条目**不豁免**（用户明确要求连 1.9.3 的发布说明一起改）。
 *   - 纯本地文件（PROCESS.md、*.bat、junk/、archive/、build/、data/）不扫（本就不发布）。
 *
 * 用法：node scripts/privacy_check.mjs [--files-from <list>]   默认用 git ls-files
 *   命中 → 退出码 1。CI 的"离线自检"步骤与本地 smoke 都会调用它。
 *
 * ⚠️ 维护：新增敏感叙事类别时往 BAD[] 加一条；**只有**确属"作者私有环境叙事"才加，
 *   不要把面向使用者的正常词（如"代理兜底""网络不可达访客"）误加进来。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// —— 判定为"作者私有环境叙事"的关键词（大小写不敏感）——
// ⚠️ 口径（2026-10-14 定）：只拦**与使用者无关、纯作者本机运维/诊断**的叙事。
//   脚本文件名（update_tle.bat 等）作为"某版本做过什么"的历史描述**不算**私有叙事，不拦。
//   "网络不通"这类**通用技术词**也不拦（refresh.mjs 的日志提示、e2e 的容错说明都属正常工程
//   表述）；拦的是"本机到 X 不通（附代理 502 / 家用 IP 等本机诊断细节）"这种**带私有环境指纹**的句子。
const BAD = [
  ['报错邮件叙事', /报错邮件|邮件通知|收件箱|GitHub\s*发来|还在发.*邮件|老版本时期.*没发生过/],
  ['家用/住宅 IP', /家用\s*IP|住宅\s*IP|home\s*ip|residential\s*ip/i],
  ['本机诊断细节', /本机到\s*celestrak|本机.*网络.*不通|本机没有旧副本|本机实测.*网络|检查本机.*连通|本机环境相关的事项/],
  ['代理错误码叙事', /代理\s*502|CONNECT\s*tunnel|直连超时/],
  ['CI 邮件/红灯叙事', /CI\s*(两次)?红灯|GitHub\s*Actions.*(报错|邮件)|排查.*报错/],
  ['Windows 计划任务负责', /Windows\s*计划任务.*负责|计划任务.*可过\s*WAF|仍由本机.*负责/],
  // ★ V1.9.9.630：上面几条都是"按具体叙事逐句列举"，于是**换个说法就漏**。
  //   本轮实测漏掉的一处：`build.mjs` 里写着「本机 spawn 同一个 node.exe 会稳定报 EBUSY」
  //   —— 这是纯作者环境的故障现象（在别人机器上大概率不复现），对使用者毫无意义，
  //   但既不含"报错邮件"也不含"本机到 celestrak"，整条断言放过了它。
  //   所以补一条**形态判据**：`本机/我的电脑` 紧邻**具体故障或具体环境细节**才算命中。
  //   ⚠️ 不能只匹配"本机"二字 —— 面向使用者的正当文案里大量使用
  //   （"全程在本机完成，不上传任何数据"、"与本机秒针对齐"），那些必须继续放行。
  ['本机环境故障细节', /本机\s*(?:spawn|跑|实测|上会|上稳定|环境|目录|路径|盘|缓存|时区差异)[^。；\n]{0,24}(?:EBUSY|EPERM|EACCES|ENOENT|报错|崩溃|卡住|失败|不通|占用)/],
  ['本机环境故障细节', /(?:EBUSY|EPERM|EACCES)[^。；\n]{0,24}本机/],
];

// 不扫描的路径（不进入公开仓库，或属正常使用者文案）
function skip(rel) {
  return /(^|\/)(node_modules|archive|junk|shots|build|history|_secrets|\.secrets)\//.test(rel)
    || /\.min\.js$/.test(rel) || /\.(png|jpg|jpeg|gif|ico|zip|gz)$/i.test(rel)
    || rel === 'PROCESS.md'                       // 纯本地过程日志，不发布
    || rel === 'scripts/privacy_check.mjs';       // 本脚本自身（关键词表就在里面）
}

const argi = process.argv.indexOf('--files-from');
let files;
if (argi > 0) {
  files = fs.readFileSync(process.argv[argi + 1], 'utf8').split('\0').filter(Boolean);
} else {
  files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0').filter(Boolean);
}

const hits = [];
let scanned = 0;
for (const rel of files) {
  if (skip(rel)) continue;
  let text;
  try { text = fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch (e) { continue; }
  if (text.includes('\0')) continue;             // 二进制跳过
  scanned++;
  text.split(/\r?\n/).forEach((line, i) => {
    for (const [tag, re] of BAD) {
      if (re.test(line)) hits.push({ rel, ln: i + 1, tag, s: line.trim().slice(0, 120) });
    }
  });
}

console.log(`去敏感扫描：${scanned} 个发布文件，命中 ${hits.length} 处`);
if (hits.length) {
  console.error('\n✗ 以下文件含"作者私有环境叙事"，不应出现在公开仓库/发布说明：\n');
  hits.slice(0, 40).forEach(h => console.error(`  ${h.rel}:${h.ln}  [${h.tag}]  ${h.s}`));
  if (hits.length > 40) console.error(`  … 另有 ${hits.length - 40} 处`);
  console.error('\n结论：脱敏不彻底 —— 这些是与使用者无关的本机运维细节，必须改写为中性表述或删除。');
  process.exit(1);
}
console.log('✓ 通过：未发现私有环境叙事');
