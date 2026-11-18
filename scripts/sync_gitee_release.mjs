#!/usr/bin/env node
/**
 * 把 GitHub 的一次发行同步到 Gitee（标题 / 正文 / 附件）。
 *
 * 触发方式：`.github/workflows/sync-gitee-release.yml`（release published + 手动 dispatch）。
 *
 * 设计要点（都是踩过的坑）：
 *   1. **令牌只从环境变量取**（GITEE_TOKEN），不落盘、不打印、不写进日志。
 *   2. **幂等**：Gitee 已有同一 tag 的发行 → 只更新标题/正文；同名附件已存在 → 跳过上传。
 *      这样 workflow 重跑、或本地补跑，都不会产生重复附件。
 *   3. **每个请求都带超时**（60s）：Space-Track 那次 fetch 挂住 16 分钟的教训 —— 没有超时
 *      的请求会让整条任务静默卡死。
 *   4. **失败必须非 0 退出**：镜像断了要红，不能"跑完了但什么都没同步"。
 *
 * 用法：
 *   node scripts/sync_gitee_release.mjs \
 *     --tag v2.0.0.632 --name-file .release/name.txt --body-file .release/body.md \
 *     --assets-dir .release/assets [--prerelease true|false]
 */
import fs from 'node:fs';
import path from 'node:path';

const OWNER = process.env.GITEE_OWNER || 'Jackoraniverse';
const REPO = process.env.GITEE_REPO || 'CISTrack';
const TOKEN = process.env.GITEE_TOKEN || '';
const API = 'https://gitee.com/api/v5';
const TIMEOUT = 60000;

function arg(name, dflt = '') {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return dflt;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : dflt;
}
const TAG = arg('tag');
const NAME_FILE = arg('name-file');
const BODY_FILE = arg('body-file');
const ASSETS_DIR = arg('assets-dir');
const PRE = /^(1|true|yes)$/i.test(arg('prerelease', 'false'));

if (!TAG) {
  console.error('✗ 缺少 --tag');
  process.exit(2);
}
if (!TOKEN) {
  console.error('✗ 缺少环境变量 GITEE_TOKEN');
  process.exit(2);
}

const readIf = (p) => (p && fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');
const NAME = (readIf(NAME_FILE).trim() || TAG).slice(0, 200);
const BODY = readIf(BODY_FILE);

async function req(method, p, { form, retries = 3 } = {}) {
  const url = API + p;
  for (let att = 1; att <= retries; att++) {
    try {
      const init = { method, headers: { 'User-Agent': 'CISTrack-release-sync' }, signal: AbortSignal.timeout(TIMEOUT) };
      if (form) {
        init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
        init.body = new URLSearchParams(form).toString();
      }
      const r = await fetch(url, init);
      const text = await r.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 300) }; }
      if (r.status === 404) return { status: 404, data };
      if (r.status >= 200 && r.status < 300) return { status: r.status, data };
      if (att === retries) return { status: r.status, data };
      console.log(`  · ${method} ${p} → ${r.status}，第 ${att} 次重试…`);
    } catch (e) {
      if (att === retries) throw e;
      console.log(`  · ${method} ${p} 异常：${e && e.message}，第 ${att} 次重试…`);
    }
    await new Promise((r) => setTimeout(r, 2000 * att));
  }
}

async function upload(releaseId, file) {
  const fn = path.basename(file);
  for (let att = 1; att <= 3; att++) {
    try {
      const fd = new FormData();
      fd.set('access_token', TOKEN);
      fd.set('file', new Blob([fs.readFileSync(file)]), fn);
      const r = await fetch(`${API}/repos/${OWNER}/${REPO}/releases/${releaseId}/attach_files`, {
        method: 'POST', body: fd, headers: { 'User-Agent': 'CISTrack-release-sync' },
        signal: AbortSignal.timeout(300000),
      });
      if (r.status >= 200 && r.status < 300) return { ok: true, status: r.status };
      const t = await r.text();
      if (att === 3) return { ok: false, status: r.status, msg: t.slice(0, 200) };
      console.log(`  · 上传 ${fn} → ${r.status}，重试…`);
    } catch (e) {
      if (att === 3) return { ok: false, status: 0, msg: String(e && e.message) };
      console.log(`  · 上传 ${fn} 异常：${e && e.message}，重试…`);
    }
    await new Promise((r) => setTimeout(r, 2500 * att));
  }
}

(async () => {
  console.log(`同步 ${TAG} → gitee.com/${OWNER}/${REPO}`);

  // ① 找到或创建发行
  const got = await req('GET', `/repos/${OWNER}/${REPO}/releases/tags/${encodeURIComponent(TAG)}?access_token=${TOKEN}`);
  let rid;
  if (got.status === 200 && got.data && got.data.id) {
    rid = got.data.id;
    const up = await req('PATCH', `/repos/${OWNER}/${REPO}/releases/${rid}`, {
      form: { access_token: TOKEN, tag_name: TAG, name: NAME, body: BODY, prerelease: PRE ? 'true' : 'false' },
    });
    if (!/^2/.test(String(up.status))) {
      console.error(`✗ 更新发行失败：${up.status} ${JSON.stringify(up.data).slice(0, 200)}`);
      process.exit(1);
    }
    console.log(`  · 发行已存在（id=${rid}），标题/正文已更新`);
  } else if (got.status === 404 || got.status === 200) {
    // ⚠️ 实测：Gitee 对「该 tag 还没有发行」不返回 404，而是 **200 + 正文 `null`**
    //   （2026-11-18 自测第一版就栽在这里：判成"查询失败"直接退出）。
    //   所以"取不到 id"一律按"不存在"处理，走创建分支。
    const cr = await req('POST', `/repos/${OWNER}/${REPO}/releases`, {
      form: {
        access_token: TOKEN, tag_name: TAG, name: NAME, body: BODY,
        target_commitish: 'main', prerelease: PRE ? 'true' : 'false',
      },
    });
    if (!/^2/.test(String(cr.status)) || !cr.data || !cr.data.id) {
      console.error(`✗ 创建发行失败：${cr.status} ${JSON.stringify(cr.data).slice(0, 250)}`);
      process.exit(1);
    }
    rid = cr.data.id;
    console.log(`  · 新建发行（id=${rid}）`);
  } else {
    console.error(`✗ 查询发行失败：${got.status} ${JSON.stringify(got.data).slice(0, 200)}`);
    process.exit(1);
  }

  // ② 上传附件（同名跳过 → 幂等）
  const cur = await req('GET', `/repos/${OWNER}/${REPO}/releases/${rid}?access_token=${TOKEN}`);
  const have = new Set(((cur.data && cur.data.assets) || []).map((a) => a.name));
  const files = ASSETS_DIR && fs.existsSync(ASSETS_DIR)
    ? fs.readdirSync(ASSETS_DIR).filter((f) => fs.statSync(path.join(ASSETS_DIR, f)).isFile())
    : [];
  if (!files.length) console.log('  · 没有附件需要上传');
  let up = 0, skip = 0, bad = [];
  for (const f of files) {
    if (have.has(f)) { skip++; continue; }
    const r = await upload(rid, path.join(ASSETS_DIR, f));
    if (r.ok) { up++; console.log(`  · 已上传 ${f}`); }
    else { bad.push(`${f}(${r.status} ${r.msg || ''})`); console.log(`  ✗ 上传失败 ${f}：${r.status}`); }
  }

  // ③ 复核：附件数必须齐
  const fin = await req('GET', `/repos/${OWNER}/${REPO}/releases/${rid}?access_token=${TOKEN}`);
  const names = ((fin.data && fin.data.assets) || []).map((a) => a.name);
  const missing = files.filter((f) => !names.includes(f));
  console.log(`  附件：上传 ${up} / 跳过 ${skip} / 现有 ${names.length} 个`);
  if (missing.length || bad.length) {
    console.error(`✗ 附件未齐：缺少 ${missing.join(',') || '无'}｜失败 ${bad.join(',') || '无'}`);
    process.exit(1);
  }
  console.log(`OK：Gitee 发行 ${TAG} 已与 GitHub 一致（标题/正文/附件）`);
})().catch((e) => {
  console.error('✗ 未捕获错误：', e && e.stack ? e.stack.split('\n')[0] : e);
  process.exit(1);
});
