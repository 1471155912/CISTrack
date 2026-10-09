/* tmproot.mjs —— 统一的「临时根目录」解析（V1.9.1 / 1.4-C 新增）
 * ---------------------------------------------------------------------------
 * 为什么必须收口成一处：
 *   临时目录原本由 6 个脚本各自解析（visual / mkmaker / fetch_wiki / fetch_launch_results
 *   / e2e_omm_offline / e2e_include_offline），写法还不一致 —— 其中两个 e2e 脚本直接用
 *   `os.tmpdir()`，**完全无视 CISTRACK_TMP**，于是永远落在系统盘。
 *   后果（实测）：本机 `TEMP` 指向 C 盘，而 C 盘长期只剩 2 GB 左右；每次跑视觉回归会生成
 *   一整套 Edge profile（成千上万个小文件）。脚本收尾会 rmSync 清理，但**本机的 safe-delete
 *   守卫会把删除改成"移入回收站"** —— 文件还在、空间不释放。日积月累把 C 盘回收站堆到
 *   **87,887 个文件 / 2.4 GB**，成了 C 盘告急的主因。
 *
 * 解析顺序（越靠前越优先）：
 *   ① `CISTRACK_TMP` —— 显式指定。CI 里设为 `runner.temp`，必须最优先，否则 CI 行为会变。
 *   ② **非系统盘**（D/E/F/G 上第一个可写目录）—— 本机默认走这档。
 *      不写死盘符：先用 `D:\workbuddyproject\_tmp`（用户自己的目录树，必然可写），
 *      再退 `D:\_tmp`（根目录可能因权限不可建）。
 *      ★ 为什么"非系统盘优先"而不是直接跟随 TEMP：临时目录一旦落在系统盘，
 *        在没有回收站清理习惯的机器上就是**单向堆积**（删不掉、又不断新增）。
 *   ③ `TEMP` / `TMP` / `os.tmpdir()` —— 最后的兜底。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let cached = null;

/** 返回一个**确认可写**的临时根目录（已创建）。结果会缓存，重复调用零开销。 */
export function tmpRoot() {
  if (cached) return cached;
  const cands = [];
  if (process.env.CISTRACK_TMP) cands.push(process.env.CISTRACK_TMP);
  const sys = String(process.env.SystemDrive || 'C:').toUpperCase();
  for (const d of ['D', 'E', 'F', 'G']) {
    if ((d + ':').toUpperCase() === sys) continue;
    cands.push(d + ':\\workbuddyproject\\_tmp', d + ':\\_tmp');
  }
  cands.push(process.env.TEMP, process.env.TMP, os.tmpdir());
  for (const c of cands) {
    if (!c) continue;
    try {
      fs.mkdirSync(c, { recursive: true });
      fs.accessSync(c, fs.constants.W_OK);
      cached = c;
      return c;
    } catch (e) { /* 换下一个候选 */ }
  }
  cached = os.tmpdir();
  return cached;
}

/** 在临时根下建一个带前缀的唯一目录（等价于 mkdtempSync(tmpRoot()/prefix)） */
export function mkTmpDir(prefix) {
  return fs.mkdtempSync(path.join(tmpRoot(), prefix));
}

/** 删除临时目录；删不掉也不抛（Windows 上刚退出的浏览器偶尔还占着句柄）
 *  ⚠️ 本机的删除**一律被系统送进回收站**（实测：Node 的 fs.rmSync、PowerShell 的 Remove-Item、
 *     .NET 的 [System.IO.Directory]::Delete **三者行为完全一致**，都进回收站；
 *     Add-Type / P/Invoke 与 COM 被安全策略禁用，所以拿不到"真删"的 API）。
 *     → 结论：**在这台机器上，脚本无法彻底删除任何东西；唯一能真正释放空间的是
 *       Windows 原生的 `Clear-RecycleBin -DriveLetter X`，而它是**整盘粒度**的
 *       （会连带清掉用户自己的回收站内容，所以绝不能自动调用）。
 *     → 因此这里的策略不是"删得干净"，而是**尽量少产生需要删的东西**：
 *       大体积的复用型目录（浏览器 profile）改为**固定路径、不删除**，见 visual.mjs。
 */
export function rmTmpDir(p) {
  if (!p) return false;
  try { fs.rmSync(p, { recursive: true, force: true }); return true; } catch (e) { return false; }
}

/** 临时根巡检：把"残留在临时根下、上次没能清掉"的目录报出来（返回它们的名字）。
 *  为什么需要：本机删除都进回收站，所以**正常情况下临时根应该是空的**；
 *  如果这里还有东西，说明上次收尾失败（多半是浏览器进程还占着句柄），
 *  这类残留会随时间累积，必须在日志里显式提示而不是静默留下。 */
export function tmpResidue() {
  const root = tmpRoot();
  try {
    return fs.readdirSync(root).filter(n => n.startsWith('cistrack-'));
  } catch (e) { return []; }
}
