/* recycle.mjs —— 回收站盘点与小工具（V1.9.1）
 * ---------------------------------------------------------------------------
 * 为什么需要它（本机实测的结论，很重要）：
 *   在这台机器上**任何脚本删除都会进回收站**，删了也不释放空间：
 *     · Node 的 `fs.rmSync`            → 进回收站
 *     · PowerShell 的 `Remove-Item`     → 进回收站
 *     · .NET 的 `[System.IO.Directory]::Delete` → 进回收站
 *       （三者实测行为**完全一致**，说明拦截在系统层，不是 Node shim）
 *     · `Add-Type` / P/Invoke / COM     → 被安全策略禁用（拿不到"真删"的底层 API）
 *   唯一能真正释放空间的是 **Windows 原生的 `Clear-RecycleBin -DriveLetter X`**，
 *   但它是**整盘粒度**的 —— 会连带清掉用户自己的回收站内容，
 *   所以本脚本**绝不自动调用它**，只负责"看清并告诉你"。
 *
 * 用法：
 *   node scripts/recycle.mjs             盘点各盘回收站（按来源归类；不改任何东西）
 *   node scripts/recycle.mjs D --detail  看 D 盘逐项明细（体积降序）
 *
 * 清理建议（看清之后再决定）：
 *   清空某盘回收站：在 PowerShell 里执行  Clear-RecycleBin -DriveLetter D -Force
 *   —— 注意它会清掉**该盘回收站里的全部内容**（包括你自己的文件）。
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const driveArg = args.find(a => /^[A-Za-z]$/.test(a));
const DETAIL = args.includes('--detail');

/** 我们产生的临时目录的特征（用于把"我们的"和"用户的"分开） */
const OURS = [/[\\/]cistrack-/i, /workbuddyproject[\\/]_tmp/i];
const isOurs = (p) => OURS.some(re => re.test(p));

function readI(buf) {
  if (buf.length < 28) return null;
  const size = Number(buf.readBigUInt64LE(8));
  const ft = Number(buf.readBigUInt64LE(16));
  const len = buf.readUInt32LE(24);
  if (len <= 0 || 28 + len * 2 > buf.length) return null;
  return {
    size: size,
    when: new Date(ft / 10000 - 11644473600000).toISOString().slice(0, 19).replace('T', ' '),
    path: buf.toString('utf16le', 28, 28 + len * 2).replace(/\0+$/, '')
  };
}

/** 扫描一个盘的回收站：返回 { items, orphans }（orphans = 没有 $I 元数据的 $R 残留） */
function scan(drive) {
  const rb = drive.toUpperCase() + ':\\$Recycle.Bin';
  const items = [], orphans = [];
  if (!fs.existsSync(rb)) return { items, orphans, exists: false };
  let sids = [];
  try { sids = fs.readdirSync(rb); } catch (e) { return { items, orphans, exists: true, err: e.code }; }
  for (const sid of sids) {
    const sp = path.join(rb, sid);
    let names = [];
    try { if (!fs.statSync(sp).isDirectory()) continue; names = fs.readdirSync(sp); } catch (e) { continue; }
    const set = new Set(names);
    for (const nm of names) {
      const full = path.join(sp, nm);
      if (nm.startsWith('$I')) {
        let rec = null;
        try { rec = readI(fs.readFileSync(full)); } catch (e) {}
        if (rec) items.push({ ...rec, r: path.join(sp, '$R' + nm.slice(2)) });
      } else if (nm.startsWith('$R') && !set.has('$I' + nm.slice(2))) {
        // 孤儿 $R：元数据已被清掉 → 原路径不可知，只能整体清空才能回收
        let sz = 0;
        try {
          const st = fs.statSync(full);
          if (st.isDirectory()) {
            (function w(q) { for (const e of fs.readdirSync(q, { withFileTypes: true })) {
              const f = path.join(q, e.name); let s2; try { s2 = fs.lstatSync(f); } catch (x) { return; }
              if (e.isDirectory()) w(f); else sz += s2.size; } })(full);
          } else { sz = st.size; }
        } catch (e) {}
        orphans.push({ size: sz, r: full });
      }
    }
  }
  return { items, orphans, exists: true };
}

const drives = driveArg ? [driveArg.toUpperCase()] : ['C', 'D', 'E', 'F'];
let grand = 0;
console.log('回收站盘点（本机的删除一律进回收站；这里只统计，不改任何文件）\n');
for (const d of drives) {
  const { items, orphans, exists, err } = scan(d);
  if (!exists) continue;
  const byDir = new Map();
  let oursN = 0, oursB = 0, otherN = 0, otherB = 0;
  for (const it of items) {
    if (isOurs(it.path)) { oursN++; oursB += it.size; continue; }
    otherN++; otherB += it.size;                       // ← 必须累加，否则汇总行恒为 0
    let dir = '(未知)';
    try { dir = path.dirname(it.path); } catch (e) {}
    const cur = byDir.get(dir) || { n: 0, b: 0 };
    cur.n++; cur.b += it.size; byDir.set(dir, cur);
  }
  const orphanB = orphans.reduce((a, x) => a + x.size, 0);
  const total = items.reduce((a, x) => a + x.size, 0) + orphanB;
  grand += total;
  if (err) { console.log(`${d}: 回收站不可读（${err}）`); continue; }
  console.log(`=== ${d}: 共 ${items.length + orphans.length} 项 / ${(total / 1048576).toFixed(2)} MB ===`);
  console.log(`  ├ 我们的（cistrack-* / _tmp）：${oursN} 项 / ${(oursB / 1048576).toFixed(2)} MB`);
  if (orphanB > 0) console.log(`  ├ 孤儿残留（元数据已丢，无法识别原路径）：${orphans.length} 项 / ${(orphanB / 1048576).toFixed(2)} MB`);
  console.log(`  └ 其它（你自己的文件）：${otherN} 项 / ${(otherB / 1048576).toFixed(2)} MB`);
  const top = [...byDir.entries()].sort((a, b) => b[1].b - a[1].b).slice(0, DETAIL ? 30 : 5);
  top.forEach(([dir, v]) => console.log(`      ${(v.b / 1048576).toFixed(2).padStart(9)} MB  ${String(v.n).padStart(5)} 项  ${dir}`));
  if (byDir.size > top.length) console.log(`      … 另有 ${byDir.size - top.length} 个目录`);
}
console.log(`\n合计 ${(grand / 1048576).toFixed(2)} MB`);
console.log('\n清理（看清上面的清单后再决定）：');
console.log('  PowerShell:  Clear-RecycleBin -DriveLetter <C|D> -Force');
console.log('  ⚠️ 这是整盘粒度，会清掉该盘回收站里的全部内容（含你自己的文件）。');
