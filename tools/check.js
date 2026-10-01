#!/usr/bin/env node
/* AlphaSun 一键自检（迭代进化的护栏）—— 每次改动后跑它，确保「不比上次差」。
   依次执行：
     1. validate.js         构建期 DOM/E 映射/五点版本/陈旧版本守卫
     2. 内联脚本语法编译     vm.Script 编译全部内联 <script>（Windows 不能用 py_compile devnull 那套）
     3. algo-selftest.js    从源码真身验算 A/C 计权(IEC 61672-1) 与 BPM 估计算法
     4. 三处源码一致性      根目录 index.html == www/index.html == android public/index.html（md5）
     5. 资源完整性          assets/lame.min.js 存在且被 sw.js 缓存清单收录
   退出码 0 = 全通过；非 0 = 任一项失败（CI/发布前必须全绿）。
   运行：node tools/check.js */
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '..');
let fail = 0;
const step = (n, t) => console.log(`\n[${n}] ${t}`);
const ok = m => console.log('  ✓ ' + m);
const bad = m => { console.log('  ✗ ' + m); fail++; };

function run(file) {
  try {
    const out = execFileSync(process.execPath, [path.join(root, file)], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    process.stdout.write(out.split(/\r?\n/).map(l => '  ' + l).join('\n') + '\n');
    return true;
  } catch (e) {
    const out = ((e.stdout || '') + (e.stderr || '')).split(/\r?\n/).filter(Boolean).slice(-12);
    process.stdout.write(out.map(l => '  ' + l).join('\n') + '\n');
    return false;
  }
}

step(1, '构建期守卫 validate.js');
if (!run('validate.js')) bad('validate 未通过');

step(2, '内联脚本语法编译');
{
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  let m, n = 0, badc = 0;
  while ((m = re.exec(html)) !== null) {
    if (/\bsrc\s*=/.test(m[1])) continue;
    n++;
    try { new vm.Script(m[2], { filename: 'inline#' + n }); }
    catch (e) { badc++; bad(`内联脚本 #${n} 语法错误：${e.message}`); }
  }
  if (!badc) ok(`${n} 段内联脚本全部可编译`);
}

step(3, '算法自检（A/C 计权 + BPM，取自源码真身）');
if (!run('tools/algo-selftest.js')) bad('算法自检未通过');

step(4, '三处源码一致性（防止 www/android 版本漂移）');
{
  const md5 = p => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');
  const triple = [
    ['根目录 index.html', path.join(root, 'index.html')],
    ['www/index.html', path.join(root, 'www/index.html')],
    ['android public/index.html', path.join(root, 'android/app/src/main/assets/public/index.html')]
  ];
  const hashes = triple.map(([n, p]) => {
    if (!fs.existsSync(p)) { bad(`${n} 不存在（先跑 node sync-www.js`); return null; }
    const h = md5(p); console.log(`  ${h}  ${n}`); return h;
  });
  if (hashes.every(Boolean)) {
    if (new Set(hashes).size === 1) ok('三处源码 md5 一致');
    else bad('三处源码不一致 → 跑 node sync-www.js && node tools/cap-copy.js');
  }
}

step(5, '离线资源完整性');
{
  const lame = path.join(root, 'assets/lame.min.js');
  if (fs.existsSync(lame)) ok(`lamejs 就位（${(fs.statSync(lame).size / 1024).toFixed(0)}KB，MP3 编码离线可用）`);
  else bad('assets/lame.min.js 缺失 → MP3 导出不可用');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  if (/lame\.min\.js/.test(sw)) ok('sw.js 缓存清单已收录 lame.min.js');
  else bad('sw.js 未缓存 lame.min.js → 离线 PWA 下 MP3 导出会失效');
}

console.log(fail ? `\n✋ 自检 ${fail} 项未通过，禁止发布。` : '\n★ 自检全部通过，可以构建发布。');
process.exit(fail ? 1 : 0);
