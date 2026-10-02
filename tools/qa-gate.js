#!/usr/bin/env node
/* v2.14.2 自动化回归门禁（npm run qa）
 * 为什么需要它：本项目 index.html 是 4500+ 行单文件，且历史验证（validate/check）全是
 * **静态**检查——不加载页面、不执行 DOM。此前两次线上缺陷（加载期 TypeError：
 * 工具块顶层绑定早于面板 DOM 解析；音频工具集弹窗被 .app 层叠上下文遮挡）都是
 * 静态检查放行、运行时才暴露的类型。本门禁把「真实加载 + 真实点击 + 几何命中断言」
 * 变成可重复执行的自动化关卡。
 *
 * 断言项：
 *   1) 诊断模块已注入 window.__diag，报告可生成
 *   2) 加载期零 pageerror（渲染进程崩溃亦计入）
 *   3) 加载期零 console.error
 *   4) 关键指标 DOM 齐备
 *   5) 音频工具集弹窗：可打开 / 完整在视口内 / 中心点未被遮挡 / 中心≈视口中心
 *   6) 三个工具面板可依次打开并关闭
 *   7) 诊断导出入口存在且可调用
 *
 * 运行：npm run qa
 * 说明：playwright-core 不在项目 node_modules，自动回退到托管 Node 工作区查找；
 *      启动前删除 ELECTRON_RUN_AS_NODE（否则 electron.exe 会退化成纯 Node 静默退出）。*/
const path = require('path');
const os = require('os');
const ROOT = path.resolve(__dirname, '..');

// ── 解析 playwright-core（本地优先，回退托管工作区）──
let pw = null;
try { pw = require('playwright-core'); } catch (_) { /* 回退 */ }
if (!pw) {
  const cands = [
    path.join(os.homedir(), '.workbuddy', 'binaries', 'node', 'workspace', 'node_modules', 'playwright-core'),
    'C:/Users/net2n/.workbuddy/binaries/node/workspace/node_modules/playwright-core'
  ];
  for (const c of cands) { try { pw = require(c); break; } catch (_) { } }
}
if (!pw || !pw._electron) {
  console.error('✗ 找不到可用的 playwright-core（需要 _electron）。');
  console.error('  尝试过：项目 node_modules、' + path.join(os.homedir(), '.workbuddy', 'binaries', 'node', 'workspace', 'node_modules'));
  process.exit(2);
}
const { _electron } = pw;

const results = [];
function chk(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? '  — ' + detail : ''));
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

(async () => {
  delete process.env.ELECTRON_RUN_AS_NODE;   // 关键：否则 Electron 退化为纯 Node
  const app = await _electron.launch({
    args: ['main.js', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    cwd: ROOT,
    executablePath: path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
    timeout: 60000
  });
  const page = await app.firstWindow();
  const pageErrs = [];
  page.on('pageerror', e => pageErrs.push(e.message));
  page.on('crash', () => pageErrs.push('*** RENDERER CRASHED ***'));
  await page.waitForTimeout(2000);

  console.log('\n[1] 诊断模块与加载期健康度');
  const diag = await page.evaluate(() => (window.__diag
    ? { s: window.__diag.summary(), reportLen: (window.__diag.report() || '').length, hasExport: typeof window.__diag.export === 'function' }
    : null));
  chk('诊断模块已注入 (window.__diag)', !!diag);
  chk('加载期零 pageerror / 渲染崩溃', pageErrs.length === 0, pageErrs.join(' | ').slice(0, 300));
  if (diag) {
    chk('加载期零 console.error', diag.s.errors === 0, 'errors=' + diag.s.errors + ' warns=' + diag.s.warns);
    chk('诊断报告可生成', diag.reportLen > 200, 'len=' + diag.reportLen);
    chk('诊断导出入口可调用', diag.hasExport);
  } else {
    chk('加载期零 console.error', false, '无诊断模块，无法判定');
    chk('诊断报告可生成', false);
    chk('诊断导出入口可调用', false);
  }

  console.log('\n[2] 关键 DOM 齐备');
  const ids = ['cv', 'capBtn', 'lab2Btn', 'toolsBtn', 'toolsMenu', 'dbaV', 'leqV', 'bpmV', 'cmfV', 'envMask', 'alertMask', 'asrMask'];
  const miss = await page.evaluate(l => l.filter(i => !document.getElementById(i)), ids);
  chk('关键指标 / 面板 DOM 存在', miss.length === 0, miss.length ? 'missing=' + JSON.stringify(miss) : ids.length + ' 项齐全');

  console.log('\n[3] 音频工具集弹窗（不遮挡 / 居中）');
  await page.click('#toolsBtn');
  await page.waitForSelector('#toolsMenu.on', { timeout: 5000 }).catch(() => { });
  await page.waitForTimeout(350);
  const geo = await page.evaluate(() => {
    const m = document.getElementById('toolsMenu');
    if (!m || !m.classList.contains('on')) return null;
    const r = m.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const top = document.elementFromPoint(cx, cy);
    return {
      open: true, w: r.width, h: r.height, cx, cy, vw: innerWidth, vh: innerHeight,
      left: r.left, top: r.top, right: r.right, bottom: r.bottom,
      inView: r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1,
      topIsMenu: !!top && (top === m || m.contains(top)),
      topTag: top ? (top.tagName + (top.id ? '#' + top.id : '') + '.' + (top.className || '')) : 'null'
    };
  });
  chk('点击后弹窗已打开', !!geo);
  if (geo) {
    chk('弹窗完整位于视口内（未被裁切）', geo.inView,
      'rect=' + [geo.left, geo.top, geo.right, geo.bottom].map(Math.round).join(',') + ' viewport=' + geo.vw + 'x' + geo.vh);
    chk('弹窗中心点未被其它元素遮挡', geo.topIsMenu, '中心(' + Math.round(geo.cx) + ',' + Math.round(geo.cy) + ') 顶层元素=' + geo.topTag);
    chk('弹窗中心≈视口中心', near(geo.cx, geo.vw / 2, 3) && near(geo.cy, geo.vh / 2, 3),
      'menu中心=(' + Math.round(geo.cx) + ',' + Math.round(geo.cy) + ') 视口中心=(' + Math.round(geo.vw / 2) + ',' + Math.round(geo.vh / 2) + ')');
  }
  const diagBtn = await page.evaluate(() => document.querySelectorAll('#toolsMenu button[data-diag]').length);
  chk('菜单内含「导出运行日志」入口', diagBtn === 1, 'count=' + diagBtn);

  console.log('\n[4] 三个工具面板可依次打开/关闭');
  const tools = [
    { name: '会议语音转写', item: '会议语音转写', mask: 'asrMask' },
    { name: '环境音频采集', item: '环境音频采集', mask: 'envMask' },
    { name: '声波警戒值守', item: '声波警戒值守', mask: 'alertMask' }
  ];
  for (const t of tools) {
    await page.evaluate(() => { const m = document.getElementById('toolsMenu'); if (m) m.classList.remove('on'); });
    await page.click('#toolsBtn');
    await page.waitForTimeout(200);
    const opened = await page.evaluate(a => {
      const b = Array.from(document.querySelectorAll('#toolsMenu button[data-tool]')).find(x => x.dataset.tool === a.item);
      if (!b) return false; b.click(); return true;
    }, t);
    await page.waitForTimeout(450);
    const st = await page.evaluate(id => {
      const el = document.getElementById(id);
      if (!el) return { exists: false, on: false, visible: false };
      const r = el.getBoundingClientRect();
      return { exists: true, on: el.classList.contains('on'), visible: r.width > 0 && r.height > 0 };
    }, t.mask);
    chk(t.name + ' 面板可打开', opened && st.exists && st.on && st.visible,
      '存在=' + st.exists + ' on=' + st.on + ' 可见=' + st.visible);
    await page.evaluate(id => { const el = document.getElementById(id); if (el) el.classList.remove('on'); }, t.mask);
  }

  console.log('\n[5] 会议语音转写：引擎标注诚实性');
  await page.evaluate(() => { const m = document.getElementById('toolsMenu'); if (m) m.classList.remove('on'); });
  await page.click('#toolsBtn');
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('#toolsMenu button[data-tool]')).find(x => x.dataset.tool === '会议语音转写');
    if (b) b.click();
  });
  await page.waitForTimeout(1800);   // 等引擎探测：HEAD model.tar.gz（+ 可能注入 5.8MB 运行时）
  const eng = await page.evaluate(() => {
    const e = document.getElementById('asrEng');
    return { text: e ? e.textContent.trim() : '(无此元素)', voskGlobal: typeof window.Vosk !== 'undefined' };
  });
  const settled = /Vosk 离线|Web Speech（在线）|不支持/.test(eng.text);
  chk('ASR 引擎完成探测并如实标注（未卡在「检测中」）', settled, 'badge="' + eng.text + '"');
  // 本仓库不随包发布 42MB 离线模型 → 引擎必须显示在线，绝不能谎报「Vosk 离线」
  chk('未放置离线模型时不谎报 Vosk 离线引擎', !eng.text.includes('Vosk 离线'),
    'badge="' + eng.text + '"，Vosk运行时已加载=' + eng.voskGlobal);
  await page.evaluate(() => { const el = document.getElementById('asrMask'); if (el) el.classList.remove('on'); });

  console.log('\n[6] 面板运行期错误复查（打开三面板后）');
  const diag2 = await page.evaluate(() => window.__diag ? window.__diag.summary() : null);
  chk('交互后仍零 pageerror', pageErrs.length === 0, pageErrs.join(' | ').slice(0, 300));
  chk('交互后零 console.error', diag2 && diag2.errors === 0, diag2 ? ('errors=' + diag2.errors + ' warns=' + diag2.warns) : '');

  await app.close();

  const pass = results.filter(r => r.ok).length, fail = results.length - pass;
  console.log('\n========================================');
  console.log('门禁结果：' + pass + ' 通过 / ' + fail + ' 失败 / 共 ' + results.length);
  if (fail) { results.filter(r => !r.ok).forEach(r => console.log('  ✗ ' + r.name)); }
  console.log('========================================');
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('\n✗ 门禁执行异常：', (e && e.message) || e);
  try { process.exit(3); } catch (_) { }
});
