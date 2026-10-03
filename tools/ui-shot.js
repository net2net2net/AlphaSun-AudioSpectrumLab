#!/usr/bin/env node
/* 界面视觉审查（npm run uishot）—— 真实渲染截图，为「美观改造」提供视觉证据。
 *
 * 为什么需要它：以往美化改动靠「凭想象改 CSS」，无法判断改完是变好还是变丑。
 * 本脚本用假麦克风真机渲染，逐屏截图到 .workbuddy/shots/，可直接肉眼比对。
 *
 * 覆盖：主界面（默认态 + 采集态）/ 语音转写大窗口 / 环境采集 / 值守台（全屏）
 *       / 手机竖屏 / 手机横屏 六个关键界面。
 *
 * 运行：npm run uishot
 */
const path = require('path');
const os = require('os');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '.workbuddy', 'shots');

let pw = null;
try { pw = require('playwright-core'); } catch (_) { }
if (!pw) {
  for (const c of [
    path.join(os.homedir(), '.workbuddy', 'binaries', 'node', 'workspace', 'node_modules', 'playwright-core'),
    'C:/Users/net2n/.workbuddy/binaries/node/workspace/node_modules/playwright-core',
  ]) { try { pw = require(c); break; } catch (_) { } }
}
if (!pw || !pw._electron) { console.error('✗ 找不到 playwright-core（需要 _electron）'); process.exit(2); }
const { _electron } = pw;

const results = [];
function chk(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? '  — ' + detail : ''));
}

(async () => {
  delete process.env.ELECTRON_RUN_AS_NODE;
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) { try { fs.unlinkSync(path.join(OUT, f)); } catch (_) { } }

  const app = await _electron.launch({
    args: ['main.js', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    cwd: ROOT,
    executablePath: path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
    timeout: 60000,
  });
  const page = await app.firstWindow();
  await page.waitForTimeout(1800);

  const shot = async (name) => {
    const p = path.join(OUT, name + '.png');
    await page.screenshot({ path: p });
    const kb = (fs.statSync(p).size / 1024).toFixed(0);
    console.log('  📷 ' + name + '.png (' + kb + ' KB)');
    return p;
  };
  const openTool = async (tool) => {
    await page.evaluate(() => { const m = document.getElementById('toolsMenu'); if (m) m.classList.remove('on'); });
    await page.click('#toolsBtn'); await page.waitForTimeout(250);
    await page.evaluate(t => {
      const b = Array.from(document.querySelectorAll('#toolsMenu button[data-tool]')).find(x => x.dataset.tool === t);
      if (b) b.click();
    }, tool);
    await page.waitForTimeout(700);
  };
  const closeMask = async (id) => {
    await page.evaluate(m => { const el = document.getElementById(m); if (el) el.classList.remove('on'); }, id);
    await page.waitForTimeout(300);
  };

  console.log('\n[1] 桌面主界面');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(400);
  await shot('01-主界面-默认态');

  console.log('\n[2] 采集态（有数据时的实况）');
  await page.click('#capBtn');
  await page.waitForTimeout(3000);
  await shot('02-主界面-采集中');
  await page.click('#capBtn');
  await page.waitForTimeout(800);

  console.log('\n[3] 语音转写大窗口（v2.19.0）');
  await openTool('语音转写');
  await shot('03-语音转写-大窗口');
  await closeMask('asrMask');

  console.log('\n[4] 环境音频采集');
  await openTool('环境音频采集');
  await shot('04-环境音频采集');
  await closeMask('envMask');

  console.log('\n[5] 声波警戒值守台（全屏，含电平表/环谱/时钟）');
  await openTool('声波警戒值守');
  await page.evaluate(() => {
    const e = document.getElementById('alertEval'); if (e) e.value = '2';
    const c = document.getElementById('alertCam'); if (c) c.checked = false;
  });
  await page.click('#alertStart');
  await page.waitForTimeout(4500);   // 等本底评估完成，环谱与电平表才有内容
  await shot('05-值守台-全屏');
  await page.click('#gExit');
  await page.waitForTimeout(1200);
  await closeMask('alertMask');

  console.log('\n[6] 手机竖屏 390×844（触摸）');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(700);
  await shot('06-手机竖屏-主界面');
  await openTool('语音转写');
  await shot('07-手机竖屏-语音转写');
  await closeMask('asrMask');

  console.log('\n[7] 手机横屏 844×390（矮屏）');
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(700);
  await shot('08-手机横屏-主界面');

  // 汇总
  const files = fs.readdirSync(OUT).filter(f => f.endsWith('.png'));
  chk('六个关键界面均已截图', files.length >= 8, files.length + ' 张 → .workbuddy/shots/');

  await app.close();
  const pass = results.filter(r => r.ok).length, fail = results.length - pass;
  console.log('\n========================================');
  console.log('界面视觉审查：' + pass + ' 通过 / ' + fail + ' 失败 / 共 ' + results.length);
  console.log('截图目录：' + OUT);
  console.log('========================================');
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('\n✗ 视觉审查异常：', (e && e.message) || e);
  try { process.exit(3); } catch (_) { }
});
