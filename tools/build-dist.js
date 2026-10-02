#!/usr/bin/env node
/**
 * build-dist.js — 统一的打包封装（win / linux / mac），产物一律回落到项目 dist/
 *
 * 为什么需要它（实证，非猜测）：
 *   项目位于群晖同步盘 D:\SynologyDrive\...，Synology Drive 客户端（cloud-drive-daemon
 *   + VSS 服务）运行时，electron-builder 调用的 rcedit 在写 EXE 资源（图标/版本信息）
 *   做 EndUpdateResource 提交时会失败：
 *     rcedit-x64.exe ... Fatal error: Unable to commit changes
 *   因此「构建中间产物必须落在非同步盘」——这一点无法绕开。
 *
 * 但「中间产物放哪」和「最终产物放哪」是两件事。此前把两者都丢在 C:\Users\net2n\
 * 下（alphasun-dist / asb-build / asb-v2140 / v2141 / v2142），既不搬回来也不清理，
 * 主目录因此堆积约 2.8GB。正确做法：
 *   中间产物 → os.tmpdir()（系统临时区，用完即删）
 *   最终产物 → 复制回项目 dist/（已在 .gitignore，不入库）
 *
 * 用法：
 *   node tools/build-dist.js win|linux|mac   （可组合：win linux）
 *   node tools/build-dist.js all             （当前平台全部 target）
 * 选项：
 *   --keep        保留临时构建目录（调试用，默认删除）
 * 环境变量：
 *   ALPHASUN_BUILD_DIR  覆盖临时构建目录
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'dist');

const args = process.argv.slice(2);
const keep = args.includes('--keep');
const targets = args.filter(a => !a.startsWith('--'));

if (targets.length === 0) {
  console.error('用法: node tools/build-dist.js win|linux|mac|all [--keep]');
  process.exit(1);
}

// 关键：WorkBuddy 会在 bash/PowerShell 通道注入该变量，electron 会退化为纯 Node 静默退出。
// 在脚本内主动清除，调用方无需再记 env -u ELECTRON_RUN_AS_NODE。
delete process.env.ELECTRON_RUN_AS_NODE;

const ARTIFACT_EXT = {
  win: ['.exe', '.7z'],
  linux: ['.tar.gz', '.AppImage', '.deb'],
  mac: ['.zip', '.dmg'],
};

function isArtifact(f, plat) {
  const low = f.toLowerCase();
  return (ARTIFACT_EXT[plat] || []).some(ext => low.endsWith(ext));
}

let failed = 0;
const copied = [];

for (const plat of targets) {
  const tmpOut = process.env.ALPHASUN_BUILD_DIR
    ? path.join(process.env.ALPHASUN_BUILD_DIR, plat)
    : path.join(os.tmpdir(), 'alphasun-build', plat);

  fs.rmSync(tmpOut, { recursive: true, force: true });
  fs.mkdirSync(tmpOut, { recursive: true });
  console.log('[build-dist] 平台=%s 临时输出(非同步盘): %s', plat, tmpOut);

  const cli = ['-y', 'electron-builder', '--' + plat,
               '--config.directories.output=' + tmpOut];
  const r = spawnSync('npx', cli, { cwd: root, stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    console.error('[build-dist] %s 构建失败（exit=%s）', plat, r.status);
    failed++;
    continue;
  }

  fs.mkdirSync(distDir, { recursive: true });
  const arts = fs.readdirSync(tmpOut).filter(f => {
    const st = fs.statSync(path.join(tmpOut, f));
    return st.isFile() && isArtifact(f, plat);
  });

  if (arts.length === 0) {
    console.error('[build-dist] %s 未找到产物文件，打包异常', plat);
    failed++;
    continue;
  }

  for (const f of arts) {
    const src = path.join(tmpOut, f);
    const dst = path.join(distDir, f);
    fs.copyFileSync(src, dst);
    const mb = (fs.statSync(dst).size / 1024 / 1024).toFixed(1);
    console.log('[build-dist] 已回落 %s (%s MB) -> dist/', f, mb);
    copied.push(dst);
  }

  if (!keep) {
    fs.rmSync(tmpOut, { recursive: true, force: true });
    // 平台子目录删掉后，父目录若已空则一并删除，避免留下空壳
    const parent = path.dirname(tmpOut);
    try {
      if (fs.existsSync(parent) && fs.readdirSync(parent).length === 0) {
        fs.rmSync(parent, { recursive: true, force: true });
      }
    } catch (_) { /* 父目录非空或无权限，忽略 */ }
    console.log('[build-dist] 临时目录已清理: %s', tmpOut);
  }
}

console.log('\n[build-dist] 完成。产物位于 dist/（项目内）：');
for (const p of copied) console.log('  ' + path.relative(root, p));
console.log('提示：dist/ 已在 .gitignore；若不愿让同步盘上传大产物，请在 Synology Drive 中排除 dist/。');
process.exit(failed ? 1 : 0);
