import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.dirname(fileURLToPath(import.meta.url));   // 脚本所在目录（发布包内任意位置可用）
const B = ROOT;
const R = B + '/data';

let html = fs.readFileSync(`${B}/template.html`, 'utf8');
const sgp4 = fs.readFileSync(`${R}/satellite.min.js`, 'utf8');
const coast = fs.readFileSync(`${R}/coast.js.txt`, 'utf8');
const data = fs.readFileSync(`${B}/build/satdata.json`, 'utf8');
const app = fs.readFileSync(`${B}/app.js`, 'utf8');

for (const [name, code] of [['sgp4', sgp4], ['coast', coast], ['data', data], ['app', app]]) {
  if (code.includes('</script')) { console.error('!! ' + name + ' 含有 </script，需转义'); }
}

html = html
  .replace('<!--INJECT_SGP4-->', '<script>/* satellite-js v5.0.0 · MIT · https://github.com/shashwatak/satellite-js */\n' + sgp4 + '\n</script>')
  .replace('<!--INJECT_COAST-->', '<script>' + coast + '</script>')
  .replace('<!--INJECT_DATA-->', '<script>window.SATDATA=' + data + ';</script>')
  .replace('<!--INJECT_APP-->', '<script>\n' + app + '\n</script>');

const out = `${B}/国网与千帆在轨追踪.html`;
fs.writeFileSync(out, html, 'utf8');
console.log('written', out, fs.statSync(out).size, 'bytes');
console.log('placeholders left:', (html.match(/<!--INJECT/g) || []).length);

// V1.4.0：把 wiki.json 复制到 HTML 同级目录 —— 只要这两个文件一起发布，
// 页面打开就会自动读 wiki.json 覆盖顶部词条计数（只改 JSON 里的数字、不必重建 HTML）。
const wj = `${B}/build/wiki.json`;
if (fs.existsSync(wj)) {
  fs.copyFileSync(wj, `${B}/wiki.json`);
  console.log('copied wiki.json →', fs.statSync(`${B}/wiki.json`).size, 'bytes');
}
