#!/usr/bin/env node
/**
 * build-win.js — 健壮的 Windows 打包封装
 *
 * 问题：本项目工作区位于 Synology Drive 同步盘（D:\SynologyDrive\...）时，
 * electron-builder 调用的 rcedit 在写入 EXE 资源（图标/版本信息）做"commit"
 * 这一步会失败（Unable to commit changes），因为同步盘的文件提交/重命名受限。
 *
 * 解决：把打包输出目录指向本机本地临时盘（os.tmpdir()，位于 C: 本地盘），
 * rcedit 即可正常提交；打包完成后再把生成的 portable EXE 复制回项目 dist/。
 * 这样 `npm run dist:win` 在同步盘、网络盘、普通本地盘上都能稳定产出带图标的 EXE。
 *
 * ⚠️ 已废弃（2026-10-03）：本脚本只覆盖 win、且临时目录名固定易冲突。
 * 统一改用 `tools/build-dist.js`（支持 win/linux/mac，临时目录走 os.tmpdir() 且用完即删，
 * 产物同样回落到项目 dist/）。`package.json` 的 dist:* 已全部指向 build-dist.js，
 * 保留本文件仅供追溯，不要再调用。
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const root = path.resolve(__dirname, '..');
const tmpOut = path.join(os.tmpdir(), 'alphasun-dist-win');

fs.rmSync(tmpOut, { recursive: true, force: true });
fs.mkdirSync(tmpOut, { recursive: true });

console.log('[build-win] 输出目录(本地盘):', tmpOut);
execSync(
  `npx electron-builder --win --config.directories.output="${tmpOut}"`,
  { cwd: root, stdio: 'inherit' }
);

const files = fs.readdirSync(tmpOut).filter(f => f.toLowerCase().endsWith('.exe'));
if (files.length === 0) {
  console.error('[build-win] 未找到生成的 EXE，打包可能失败');
  process.exit(1);
}
const distDir = path.join(root, 'dist');
fs.mkdirSync(distDir, { recursive: true });
for (const f of files) {
  fs.copyFileSync(path.join(tmpOut, f), path.join(distDir, f));
  console.log('[build-win] 已复制', f, '-> dist/');
}
console.log('[build-win] 完成。最终 EXE 位于 dist/');
