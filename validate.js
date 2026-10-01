// AlphaSun 声波分析仪 · 构建期 DOM 引用校验守卫（v2.0.0 稳定性架构）
// 背景：v1.3.0 新增「声音状态」行时，E 映射漏注册 voiceStateV，运行时 TypeError
// 被误报成「无法访问麦克风」，连带分析循环中断、全部参数卡空白的连锁故障。
// 本守卫把这类问题拦截在构建阶段：任何 JS 引用的 DOM id 在 HTML 中不存在 → 退出码 1，构建失败。
// 运行：node validate.js  （已接入 npm run sync 前置）
const fs = require('fs');
const path = require('path');
const root = __dirname;
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

let failed = false;
const die = msg => { console.error('  ✗ ' + msg); failed = true; };
const ok = msg => console.log('  ✓ ' + msg);

// ---- 1. 提取 HTML 中所有 id 属性 ----
const idAttrs = new Set();
for (const m of html.matchAll(/\sid\s*=\s*"([^"]+)"/g)) m[1].split(/\s+/).forEach(x => idAttrs.add(x));
for (const m of html.matchAll(/\sid\s*=\s*'([^']+)'/g)) m[1].split(/\s+/).forEach(x => idAttrs.add(x));

// ---- 2. 提取内联 script（只看开标签是否带 src）----
const scripts = [];
const re = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
let m2;
while ((m2 = re.exec(html)) !== null) if (!/\bsrc\s*=/.test(m2[1])) scripts.push(m2[2]);
const js = scripts.join('\n');
if (!js.length) die('未提取到内联 script，校验逻辑失效');

// ---- 3. JS 引用的 id 必须存在于 HTML ----
const refs = new Set();
for (const m of js.matchAll(/\$\('([^']+)'\)/g)) refs.add(m[1]);
for (const m of js.matchAll(/getElementById\('([^']+)'\)/g)) refs.add(m[1]);
const missing = [...refs].filter(r => !idAttrs.has(r));
if (missing.length) missing.forEach(id => die(`JS 引用的 #${id} 在 HTML 中不存在（运行时将抛 null TypeError）`));
else ok(`JS 引用的 ${refs.size} 个 DOM id 全部存在`);

// ---- 4. E 映射：定义 key 覆盖全部 E.xxx 使用；指向的 id 必须存在 ----
const eBlock = js.match(/const E=\{[\s\S]*?\n\};/);
if (!eBlock) die('未找到 E 映射定义');
else {
  const eKeys = new Set(); const eToId = {};
  for (const m of eBlock[0].matchAll(/(\w+):\$\('([^']+)'\)/g)) { eKeys.add(m[1]); eToId[m[1]] = m[2]; }
  const eUses = new Set();
  for (const m of js.matchAll(/\bE\.(\w+)/g)) eUses.add(m[1]);
  const eMissing = [...eUses].filter(k => !eKeys.has(k));
  if (eMissing.length) eMissing.forEach(k => die(`代码使用了 E.${k} 但 E 映射未定义（v1.x voiceStateV 事故同类问题！运行时 TypeError）`));
  else ok(`E 映射 ${eKeys.size} 个 key 覆盖全部 ${eUses.size} 处使用`);
  const badId = Object.entries(eToId).filter(([, id]) => !idAttrs.has(id));
  if (badId.length) badId.forEach(([k, id]) => die(`E.${k} -> #${id} 不存在`));
}

// ---- 5. 平台层文件存在性（index.html 底部 script 引用）----
for (const f of ['desktop/boot.js', 'mobile/bridge.js']) {
  if (!fs.existsSync(path.join(root, f))) die(`平台层文件缺失：${f}（index.html 已引用）`);
  else ok(`平台层就位：${f}`);
}

// ---- 6. 版本号五点一致性（index 常量 / appVer span / package.json / sw.js / gradle）----
const verIdx = (js.match(/APP_VER='([\d.]+)'/) || [])[1];
const verSpan = (html.match(/id="appVer">v([\d.]+)</) || [])[1];
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const verSw = (fs.readFileSync(path.join(root, 'sw.js'), 'utf8').match(/alphasun-audio-v([\d.]+)/) || [])[1];
const gradle = fs.readFileSync(path.join(root, 'android/app/build.gradle'), 'utf8');
const verGradle = (gradle.match(/versionName "([\d.]+)"/) || [])[1];
const vers = { 'index APP_VER': verIdx, 'appVer span': verSpan, 'package.json': pkg.version, 'sw.js CACHE': verSw, 'gradle versionName': verGradle };
const uniq = [...new Set(Object.values(vers))];
if (uniq.length !== 1) { die('版本号不一致：' + JSON.stringify(vers)); }
else ok('版本号五点一致：v' + uniq[0]);
const codeGradle = (gradle.match(/versionCode (\d+)/) || [])[1];
const verMajor = (uniq[0].split('.')[0] || '0');
if (codeGradle && +codeGradle < +verMajor) die(`gradle versionCode(${codeGradle}) 小于主版本号(${verMajor})`);

// ---- 7. 陈旧版本号残留扫描（v2.0.0 事故教训：页脚静态文本漏改逃过五点校验）----
// 提取 index.html 中所有形如 x.y.z 的版本串，除当前 APP_VER 外一律视为残留
const stale = new Set();
for (const m of html.matchAll(/[vV]?\b(\d+\.\d+\.\d+)\b/g)) if (m[1] !== verIdx) stale.add(m[1]);
// gradle/android 侧同样扫一遍
for (const m of gradle.matchAll(/(\d+\.\d+\.\d+)/g)) if (m[1] !== verIdx) stale.add(m[1]);
if (stale.size) die('发现陈旧版本号残留: ' + [...stale].join(', ') + '（当前版本 ' + verIdx + '）');
else ok('无陈旧版本号残留（全文件仅 ' + verIdx + '）');

console.log(failed ? '\n✋ validate 校验未通过，构建终止。' : '\n★ validate 全部通过。');
process.exit(failed ? 1 : 0);
