// dist 终版清理（v2.2.0 起版本无关化）：APK 入位 + 旧版本产物退场 + 临时文件/解包目录清理（幂等+重试）
// 版本从 package.json 动态读取，旧产物 = dist 内 AlphaSun*/*nsis* 中版本号 ≠ 当前版本的所有文件
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');   // 提前：APK 入位后的内容校验要在文件前段调用它
const sleep = ms => new Promise(r => setTimeout(r, ms));
const root = 'D:/SynologyDrive/Workspace/AlphaSun-AudioSpectrumLab';
const VER = require(path.join(root, 'package.json')).version;

(async () => {
  // 1. APK 入位（gradle 产物名按 app 版本探测，debug/release 均兼容）
  const outDir = path.join(root, 'android/app/build/outputs/apk');
  let apkSrc = null;
  // 教训（2026-10-02）：原实现「遍历到最后一个 .apk 就覆盖」→ release 构建完后仍扫 debug，
  // 拿上一次的 debug 旧包覆盖了当次 release 包，随后被内容校验判为旧产物删掉，导致 APK 全丢。
  // 现改为 **release 优先、命中即停**；debug 仅作兜底。
  outer:
  for (const kind of ['release', 'debug']) {
    const kd = path.join(outDir, kind);
    if (!fs.existsSync(kd)) continue;
    for (const f of fs.readdirSync(kd)) if (f.endsWith('.apk')) { apkSrc = path.join(kd, f); break outer; }
  }
  if (!apkSrc) { console.error('未找到 APK 产物'); process.exit(1); }
  const apkDst = path.join(root, 'dist/AlphaSun-AudioLab-' + VER + '.apk');
  fs.copyFileSync(apkSrc, apkDst);
  console.log('APK 入位: ' + VER + ' · ' + (fs.statSync(apkDst).size / 1048576).toFixed(1) + 'MB ← ' + path.basename(apkSrc));
  // 入位后立刻内容校验：版本对不上说明 gradle 没重新打包（或拿错产物），此时**中止且不动 dist**，
  // 避免「覆盖成旧包 → 被判旧产物删除 → 当前版本一个不剩」的连锁事故。
  {
    const av = apkVersion(apkDst);
    if (av === null) console.warn('⚠ aapt2 不可用，跳过 APK 内容版本校验（按文件名兜底）');
    else if (av !== VER) {
      console.error('✋ 中止：刚入位的 APK 内容版本为 v' + av + '，与当前 v' + VER + ' 不符。');
      console.error('   请确认 android/app/build.gradle 已升级并重跑 ./gradlew assembleRelease；dist 未做任何删除。');
      process.exit(1);
    } else console.log('APK 内容版本校验: v' + av + ' ✓');
  }

  // 2. 旧版本产物退场（文件名含当前版本号 = 保留；nsis.7z 永远是临时包必删；其余 AlphaSun* 产物 = 删）
  // 教训（2026-09-30）：不要用 [vV]+版本号 正则——产物名里版本号前是 '-'，匹配失败会把当前版本当旧版误删！
  // 教训（2026-09-30 补）：**文件名不可信**。曾出现「文件名写 2.2.1、内容实为 v2.1.0(versionCode 9)」的错标
  //   APK，仅按文件名包含匹配会把它当当前版本保留 → 用户装上的是旧版。故 APK 类产物必须**校验内容版本号**。
  const dist = path.join(root, 'dist');
  // 读取 APK 内 AndroidManifest 的 versionName/versionCode（走 aapt2，多路径探测）
  function apkVersion(p) {   // execFileSync 已提到文件顶部声明：本函数在 APK 入位校验处（更靠前）被调用
    const cands = [];
    const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
    if (sdk) for (const bt of ['34.0.0', '35.0.0', '33.0.0']) cands.push(path.join(sdk, 'build-tools', bt, 'aapt2.exe'));
    cands.push(path.join(process.env.USERPROFILE || '', 'Android/Sdk/build-tools/34.0.0/aapt2.exe'));
    for (const exe of cands) {
      try {
        const out = execFileSync(exe, ['dump', 'badging', p], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        const m = out.match(/versionName='([^']+)'/);
        if (m) return m[1];
      } catch (e) { /* 换下一个候选 */ }
    }
    return null; // 无法判定（aapt2 不可用）→ 交给调用方按文件名兜底
  }
  for (const f of fs.readdirSync(dist)) {
    const full = path.join(dist, f);
    if (/nsis\.7z$/.test(f)) { try { fs.unlinkSync(full); console.log('删除临时包:', f); } catch (e) {} continue; }
    let isCur = f.indexOf(VER) >= 0;
    // APK 必须内容校验：内容版本 ≠ 当前版本 → 判为旧产物（覆盖"文件名对但内容旧"的错标情形）
    if (isCur && /\.apk$/i.test(f)) {
      const av = apkVersion(full);
      if (av && av !== VER) { isCur = false; console.warn('⚠ 文件名标 ' + VER + ' 但内容实为 v' + av + ' → 判为旧产物:', f); }
    }
    if (isCur) continue;
    if (/^(AlphaSun|alphasun)/.test(f)) {
      try { fs.unlinkSync(full); console.log('删除旧产物:', f); } catch (e) { console.warn('跳过:', f, e.code); }
    }
  }
  // 固定临时/日志名单
  for (const f of ['builder-debug.yml', 'electron-run.log', 'dev-run.log', 'dev-run2.log', 'dev-run3.log', 'exe-run.log', 'electron.pid']) {
    try { fs.unlinkSync(path.join(root, 'dist', f)); console.log('删除:', f); } catch (e) { if (e.code !== 'ENOENT') console.warn('跳过:', f, e.code); }
    try { fs.unlinkSync(path.join(root, f)); } catch (e) {}
  }

  // 3. 解包目录递归清理（rmSync recursive：walk+rmdir 处理不了残留空子目录）
  for (const d of ['win-unpacked', 'linux-unpacked', '.icon-ico']) {
    const dp = path.join(dist, d);
    if (!fs.existsSync(dp)) { console.log('已不存在:', d); continue; }
    for (let a = 0; a < 5; a++) {
      try { fs.rmSync(dp, { recursive: true, force: true }); console.log('已删目录:', d); break; }
      catch (e) { await sleep(600); }
    }
    if (fs.existsSync(dp)) console.warn('⚠ 目录删除失败（重试耗尽）:', d);
  }

  console.log('\n=== dist 终态 ===');
  for (const f of fs.readdirSync(dist).sort()) {
    const st = fs.statSync(path.join(dist, f));
    console.log((st.size / 1048576).toFixed(1).padStart(7) + 'MB  ' + f);
  }
})();
