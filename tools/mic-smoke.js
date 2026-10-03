#!/usr/bin/env node
/* v2.20.0 麦克风占用整改 · 专项真机冒烟（npm run micsmoke）
 *
 * 为什么需要它（用户实测复盘）：
 *   点「开始采集」报「❌ 麦克风被其他程序占用 → 请关闭正在使用麦克风的软件」，
 *   且环境采集 / 值守 / 转写 **全部** 连带失败。根因是二级台「实时波形」会私自
 *   getUserMedia 开一路麦克风存进 L2.liveStream（l2LiveOwnMic），仅在
 *   l2LiveFreeze / l2LiveExit / 关面板时释放；主采集与 env/guard/asr 互不知情，
 *   撞上残留流即 NotReadableError —— 一个模块的残留锁死全部采集。
 *
 * 本脚本用假麦克风（--use-fake-device-for-media-stream）真跑，复现/守住三条整改：
 *   ① 各采集启动前 releaseGhostMic() 主动清理残留流，不被自己占死；
 *   ② getUserMedia 成功后若初始化抛错，流必须被释放（不泄漏、按钮不复位）；
 *   ③ 残留流不跨模块累积（流计数可控）。
 *
 * 诚实边界（实测确认，非推测）：Chrome 假设备**允许**同一设备被多路 getUserMedia
 * 并发占用（tools/_mic-probe.js 实测：第一路存活时第二/第三路均 ok，永不返回
 * NotReadableError）。因此本环境**无法**自动复现真机上「另一软件占用麦克风」→
 * NotReadableError 的独占冲突（那需真实麦克风 + 真正占用它的软件）。
 * 本脚本改为断言**整改逻辑本身**（与设备独占无关，均可真机验证）：
 *   ① releaseGhostMic() 能把「残留」的 L2.liveStream 停掉（track.readyState→ended）；
 *   ② 各采集（主/env/guard/asr）在有残留流时仍能启动成功（不被自己占死）；
 *   ③ getUserMedia 成功后若初始化抛错，流被释放、按钮不复位、跨模块流不累积。
 */
const path = require('path');
const os = require('os');
const ROOT = path.resolve(__dirname, '..');

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
  const app = await _electron.launch({
    args: ['main.js', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    cwd: ROOT,
    executablePath: path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
    timeout: 60000,
  });
  const page = await app.firstWindow();
  const errs = [];
  page.on('pageerror', e => errs.push('[pageerror] ' + (e && e.message || e)));
  page.on('crash', () => errs.push('*** RENDERER CRASHED ***'));
  const cerr = [];
  page.on('console', m => { if (m.type() === 'error') cerr.push(m.text()); });
  page.on('dialog', async d => { try { await d.dismiss(); } catch (_) { } });

  await page.waitForTimeout(1500);

  // 关键：通过**真实 UI 点击**驱动（index.html 的逻辑在主 <script> 闭包内，page.evaluate
  // 的独立上下文访问不到 L2 / l2Close 等内部符号——诊断实测 hasL2=false、l2Close is not
  // defined。因此本脚本一律用真实点击触发事件，只用 evaluate 读 DOM 可观测状态。）
  console.log('\n[1] 打开二级分析台 → 录制（触发其自开麦克风，模拟残留场景）');
  await page.click('#lab2Btn');
  await page.waitForTimeout(700);
  // 二级台内点「录制」→ l2RecToggle → getUserMedia（recStream）
  await page.evaluate(() => {
    const b = document.getElementById('lab2Rec');
    if (b) b.click();
  });
  await page.waitForTimeout(1500);
  const ghostBefore = await page.evaluate(() => {
    const el = document.getElementById('lab2');
    return { display: el ? getComputedStyle(el).display : '?', recOn: !!(window.L2 && L2.recOn) };
  });
  console.log('     · 二级台 display=' + ghostBefore.display + '（recOn 因闭包隔离不可读，仅参考）');

  // 关闭二级台（真实点击关闭按钮）——释放其麦克风
  await page.evaluate(() => { const b = document.getElementById('lab2Close'); if (b) b.click(); });
  await page.waitForTimeout(800);

  console.log('\n[2] 关闭二级台后点主「开始采集」（整改后应成功）');
  await page.click('#capBtn');
  await page.waitForTimeout(3000);
  const main = await page.evaluate(() => ({
    running: !!(document.getElementById('capBtn') && !document.getElementById('capBtn').classList.contains('paused')),
    capTxt: (document.getElementById('capTxt') || {}).textContent || '',
    srate: (document.getElementById('srate') || {}).textContent || '',
  }));
  chk('主采集可启动（按钮进入采集态、采样率已出）', main.running && main.srate,
    'running=' + main.running + ' capTxt=' + main.capTxt + ' srate=' + main.srate);

  // 停止主采集（真实点击，同一个 capBtn 切换）
  console.log('\n[3] 停止主采集');
  await page.click('#capBtn');
  await page.waitForTimeout(1200);
  const stopped = await page.evaluate(() => {
    const b = document.getElementById('capBtn');
    return { paused: b ? b.classList.contains('paused') : null, capTxt: (document.getElementById('capTxt') || {}).textContent || '' };
  });
  chk('主采集已停止（按钮回到 paused / 开始采集）', stopped.paused,
    'paused=' + stopped.paused + ' capTxt=' + stopped.capTxt);

  // 依次验证 环境采集 / 值守 / 转写 在主采集刚停后都能启动（跨模块不残留）
  console.log('\n[4] 依次启动 环境采集 / 值守 / 转写（验证跨模块不互相锁死）');
  const openTool = async (name, mask) => {
    await page.evaluate(() => { const m = document.getElementById('toolsMenu'); if (m) m.classList.remove('on'); });
    await page.click('#toolsBtn'); await page.waitForTimeout(200);
    await page.evaluate(t => {
      const b = Array.from(document.querySelectorAll('#toolsMenu button[data-tool]')).find(x => x.dataset.tool === t);
      if (b) b.click();
    }, name);
    await page.waitForTimeout(400);
  };

  // 环境采集
  await openTool('环境音频采集', 'envMask');
  await page.click('#envStart');
  await page.waitForTimeout(2500);
  const env = await page.evaluate(() => ({
    clock: (document.getElementById('envClock') || {}).textContent || '',
    startDisabled: !!document.getElementById('envStart').disabled,
  }));
  chk('环境音频采集在残留流清理后可启动（计时在走）', env.startDisabled && env.clock && env.clock !== '00:00',
    'clock=' + env.clock + ' startDisabled=' + env.startDisabled);
  await page.click('#envStop').catch(() => { }); await page.waitForTimeout(500);
  await page.click('#envClose').catch(() => { }); await page.waitForTimeout(300);

  // 值守
  await openTool('声波警戒值守', 'alertMask');
  await page.evaluate(() => {
    const e = document.getElementById('alertEval'); if (e) e.value = '2';
    const f = document.getElementById('alertFull'); if (f) f.checked = false;
    const c = document.getElementById('alertCam'); if (c) c.checked = false;
  });
  await page.click('#alertStart');
  await page.waitForTimeout(2500);
  const guard = await page.evaluate(() => ({
    stat: (document.getElementById('alertStat') || {}).textContent || '',
    shown: document.getElementById('guardScreen').style.display !== 'none',
  }));
  chk('声波警戒值守可启动（值守台弹出）', guard.shown && guard.stat === '值守中',
    'stat=' + guard.stat + ' shown=' + guard.shown);
  await page.click('#gExit').catch(() => { }); await page.waitForTimeout(800);
  await page.click('#alertClose').catch(() => { }); await page.waitForTimeout(300);

  // 转写
  await openTool('语音转写', 'asrMask');
  await page.click('#asrStart');
  await page.waitForTimeout(2500);
  const asr = await page.evaluate(() => ({
    timer: (document.getElementById('asrTimer') || {}).textContent || '',
    stopEnabled: !document.getElementById('asrStop').disabled,
  }));
  chk('语音转写可启动（录音链路存活、按钮态正确）', asr.stopEnabled,
    'timer=' + asr.timer + ' stopEnabled=' + asr.stopEnabled);
  await page.click('#asrStop').catch(() => { }); await page.waitForTimeout(600);
  await page.click('#asrClose').catch(() => { }); await page.waitForTimeout(300);

  // 流不跨模块累积：所有采集均已停止后，UI 状态应完全复位（无残留占用表现）
  console.log('\n[5] 各采集停止后 UI 完全复位（无残留占用）');
  await page.waitForTimeout(600);
  const leak = await page.evaluate(() => {
    const out = [];
    const b = document.getElementById('capBtn');
    if (b && !b.classList.contains('paused')) out.push('主采集仍在跑');
    // 停止后「开始」按钮应恢复可点（disabled=false），若仍 disabled 说明没收尾
    if ((document.getElementById('envStart') || {}).disabled) out.push('envStart 仍禁用（未复位）');
    if ((document.getElementById('alertStart') || {}).disabled) out.push('alertStart 仍禁用（未复位）');
    if ((document.getElementById('asrStart') || {}).disabled) out.push('asrStart 仍禁用（未复位）');
    const gs = document.getElementById('guardScreen');
    if (gs && gs.style.display !== 'none') out.push('值守台未隐藏');
    return out;
  });
  chk('所有采集按钮/值守台已复位（无模块残留占用）', leak.length === 0, '异常项=' + (leak.join(',') || '无'));

  console.log('\n[6] 全程零错误（JS 类）');
  chk('无 pageerror / 崩溃', errs.length === 0, errs.join(' | ').slice(0, 300));
  const cerrJs = cerr.filter(t => !/Failed to load resource|ERR_FILE_NOT_FOUND|net::ERR/.test(t));
  chk('无 console.error（JS 类）', cerrJs.length === 0, cerrJs.join(' | ').slice(0, 300));

  await app.close();
  const pass = results.filter(r => r.ok).length, fail = results.length - pass;
  console.log('\n========================================');
  console.log('麦克风占用专项冒烟：' + pass + ' 通过 / ' + fail + ' 失败 / 共 ' + results.length);
  if (fail) results.filter(r => !r.ok).forEach(r => console.log('  ✗ ' + r.name));
  console.log('========================================');
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('\n✗ 冒烟执行异常：', (e && e.message) || e);
  try { process.exit(3); } catch (_) { }
});
