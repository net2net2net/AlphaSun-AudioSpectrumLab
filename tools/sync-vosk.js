#!/usr/bin/env node
/* v2.14.2 Vosk 离线运行时同步（幂等 + md5 回读校验）
 * 为什么需要：`vosk.js`（5.8MB）来自 npm 依赖 `vosk-browser`，属于**构建期派生产物**，
 * 不进版本库（避免仓库膨胀 5.8MB 二进制）；由本脚本从 node_modules 复制到 assets/vosk/，
 * 供页面按需惰性加载。已存在且 md5 一致则跳过。
 * 运行：node tools/sync-vosk.js   （已并入 npm run sync）*/
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'node_modules', 'vosk-browser');
const DST = path.join(ROOT, 'assets', 'vosk');

// 需要从 node_modules 复制的文件（相对 SRC → DST 同名）
const FILES = ['dist/vosk.js', 'README.md'];

const md5 = f => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex');

if (!fs.existsSync(SRC)) {
  console.error('  ✗ 未找到 ' + SRC + ' —— 请先执行 npm install（依赖 vosk-browser）');
  process.exit(1);
}
fs.mkdirSync(DST, { recursive: true });

let copied = 0, skipped = 0;
for (const rel of FILES) {
  const src = path.join(SRC, rel);
  const out = path.join(DST, path.basename(rel));
  if (!fs.existsSync(src)) { console.log('  · 跳过（源不存在）：' + rel); continue; }
  if (fs.existsSync(out) && fs.statSync(out).size === fs.statSync(src).size && md5(out) === md5(src)) {
    skipped++; console.log('  · 已一致 ' + path.basename(rel) + '（' + (fs.statSync(out).size / 1048576).toFixed(1) + 'MB）');
    continue;
  }
  fs.copyFileSync(src, out);
  // 回读校验：「复制了」≠「内容一致」
  if (md5(out) !== md5(src)) { console.error('  ✗ 回读校验失败：' + rel); process.exit(1); }
  copied++; console.log('  ✓ 已复制 ' + path.basename(rel) + '（' + (fs.statSync(out).size / 1048576).toFixed(1) + 'MB，md5 回读一致）');
}

// 提示：模型需自行放置
const model = path.join(DST, 'model.tar.gz');
console.log('  · 离线模型：' + (fs.existsSync(model) ? '已就位（引擎将走 Vosk 离线）' : '未放置（引擎走 Web Speech 在线，详见 MODEL_PLACEHOLDER.md）'));
console.log('  [sync-vosk] 复制 ' + copied + ' / 跳过 ' + skipped);
