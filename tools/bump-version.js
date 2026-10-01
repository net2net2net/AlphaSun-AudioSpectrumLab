#!/usr/bin/env node
/* 版本号统一升级（幂等 + 改完回读校验）：index.html APP_VER / appVer span / package.json /
   sw.js CACHE / android build.gradle versionName+versionCode 五点同步。
   教训（2026-09-30）：「复制了」≠「内容一致」，改完必须回读复核再报成功。
   运行：node tools/bump-version.js 2.13.0   （不带参数则打印当前五点版本） */
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
const V = process.argv[2];

const F = {
  html: path.join(root, 'index.html'),
  pkg: path.join(root, 'package.json'),
  sw: path.join(root, 'sw.js'),
  gradle: path.join(root, 'android/app/build.gradle')
};
const read = p => fs.readFileSync(p, 'utf8');
const cur = () => ({
  html: (read(F.html).match(/APP_VER='([\d.]+)'/) || [])[1],
  span: (read(F.html).match(/id="appVer">v([\d.]+)</) || [])[1],
  pkg: JSON.parse(read(F.pkg)).version,
  sw: (read(F.sw).match(/alphasun-audio-v([\d.]+)/) || [])[1],
  gradle: (read(F.gradle).match(/versionName "([\d.]+)"/) || [])[1],
  code: (read(F.gradle).match(/versionCode (\d+)/) || [])[1]
});

if (!V) { console.log('当前五点版本：', JSON.stringify(cur())); process.exit(0); }
if (!/^\d+\.\d+\.\d+$/.test(V)) { console.error('版本号格式应为 x.y.z'); process.exit(1); }

let s = read(F.html);
const before = s;
s = s.replace(/APP_VER='[\d.]+'/, "APP_VER='" + V + "'");
s = s.replace(/APP_BUILD='\d+'/, "APP_BUILD='" + new Date().toISOString().slice(0, 10).replace(/-/g, '') + "'");
s = s.replace(/id="appVer">v[\d.]+</, 'id="appVer">v' + V + '<');
if (s === before) console.warn('⚠ index.html 未发生变化，请检查 APP_VER 写法');
fs.writeFileSync(F.html, s);

const p = JSON.parse(read(F.pkg)); p.version = V;
fs.writeFileSync(F.pkg, JSON.stringify(p, null, 2) + '\n');

let w = read(F.sw);
w = w.replace(/alphasun-audio-v[\d.]+/, 'alphasun-audio-v' + V);
fs.writeFileSync(F.sw, w);

let g = read(F.gradle);
g = g.replace(/versionName "[\d.]+"/, 'versionName "' + V + '"');
const code = +(g.match(/versionCode (\d+)/) || [])[1];
const want = +V.split('.')[0];
// versionCode 单调递增：取「当前 code+1」与「≥主版本号」中的较大者
g = g.replace(/versionCode \d+/, 'versionCode ' + Math.max(code + 1, want));
fs.writeFileSync(F.gradle, g);

// —— 回读复核 ——
const after = cur();
const vals = [after.html, after.span, after.pkg, after.sw, after.gradle];
const allSame = vals.every(v => v === V);
console.log('升级后回读：', JSON.stringify(after));
if (!allSame) { console.error('✋ 五点版本不一致，升级失败'); process.exit(1); }
console.log('★ 已统一升级到 v' + V + '（versionCode ' + after.code + '）');
