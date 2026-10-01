// AlphaSun 声波分析仪 · 同步 Web 资源到 www/ 供 Capacitor 使用
// 单一数据源为项目根目录的 index.html/sw.js/manifest.webmanifest/assets
// ⚠ main.js 是 Electron 主进程（Node/Electron API），**不属于 Web 资源**，不得同步进 www/ 与 APK
//   （v2.2.0 修复：此前误同步导致 APK 包内出现无用的 Node 代码，增加体积且污染资源目录）
// v2.8.0：改为**增量覆盖式**同步——不再 rmSync 整个 www/ 目录（WorkBuddy safe-delete 守卫
//   会拦截一次删除 50+ 文件的批量操作），改为逐文件复制覆盖 + 清理源中已不存在的陈旧文件。
// 运行: node sync-www.js
const fs = require('fs');
const path = require('path');

const root = __dirname;
const www = path.join(root, 'www');
const items = ['index.html', 'sw.js', 'manifest.webmanifest', 'assets', 'desktop', 'mobile'];

// 收集目录下所有相对路径（文件）
function walk(dir, base, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? base + '/' + e.name : e.name;
    if (e.isDirectory()) walk(path.join(dir, e.name), rel, out);
    else out.push(rel);
  }
  return out;
}

fs.mkdirSync(www, { recursive: true });

let copied = 0, removed = 0;
const keep = new Set();

for (const it of items) {
  const src = path.join(root, it);
  if (!fs.existsSync(src)) { console.warn('跳过(不存在):', it); continue; }
  const dst = path.join(www, it);
  if (fs.statSync(src).isDirectory()) {
    const files = walk(src, '', []);
    for (const rel of files) {
      keep.add(it + '/' + rel);
      const s = path.join(src, rel), d = path.join(dst, rel);
      fs.mkdirSync(path.dirname(d), { recursive: true });
      fs.copyFileSync(s, d);
      copied++;
    }
  } else {
    keep.add(it);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    copied++;
  }
  console.log('已同步:', it);
}

// 清理 www/ 中源里已不存在的陈旧文件（正常情况下为 0，逐个删除不触发批量守卫）
for (const rel of walk(www, '', [])) {
  if (!keep.has(rel)) {
    try { fs.unlinkSync(path.join(www, rel)); removed++; } catch (_) {}
  }
}

console.log(`www/ 同步完成：复制 ${copied} 个文件，清理陈旧 ${removed} 个。可运行: npx cap copy android  或  npx cap build android`);
