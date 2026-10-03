#!/usr/bin/env node
/* 真机麦克风句柄诊断（tools/mic-diag.js）—— v2.23.1
 *
 * 用途：用户真机「确认外部无占用」却仍报 NotReadableError → 必是本应用内部句柄。
 * 本脚本调用**产品内置的 window.__micDiag()**（在 index.html 闭包内定义，能读到所有
 * 内部句柄），枚举每个句柄的 tracks/ctxState/active，并实测「此刻能否再开一路麦克风」。
 *
 * ⚠ 必须用**真实麦克风**跑（不传 --use-fake-device），假设备不独占、无法复现。
 * 用法：node tools/mic-diag.js
 */
const path = require('path'); const os = require('os');
const ROOT = path.resolve(__dirname, '..');
let pw = null;
try { pw = require('playwright-core'); } catch (_) { }
if (!pw) { for (const c of [path.join(os.homedir(), '.workbuddy', 'binaries', 'node', 'workspace', 'node_modules', 'playwright-core'), 'C:/Users/net2n/.workbuddy/binaries/node/workspace/node_modules/playwright-core']) { try { pw = require(c); break; } catch (_) { } } }
if (!pw || !pw._electron) { console.error('✗ 找不到 playwright-core'); process.exit(2); }
const { _electron } = pw;

(async () => {
  delete process.env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    args: ['main.js', '--use-fake-ui-for-media-stream'],   // 真实麦克风，不用 fake-device
    cwd: ROOT, executablePath: path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), timeout: 60000,
  });
  const page = await app.firstWindow();
  await page.waitForTimeout(2000);

  const diag = () => page.evaluate(() => {
    if (typeof window.__micDiag !== 'function') return { err: 'window.__micDiag 未注入（index.html 未同步？）' };
    return { list: window.__micDiag() };
  });
  const tryOpen = () => page.evaluate(async () => {
    try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); const t = s.getTracks(); const r = { ok: true, ready: t[0] && t[0].readyState }; t.forEach(x => x.stop()); return r; }
    catch (e) { return { ok: false, err: e && e.name }; }
  });
  const show = (tag) => page.evaluate(() => {
    const d = typeof window.__micDiag === 'function' ? window.__micDiag() : null;
    return d;
  });

  console.log('========== 麦克风句柄诊断（真机） ==========');
  console.log('\n[0] 刚启动（未采集）');
  console.log(JSON.stringify(await show(), null, 1));
  console.log('实测开麦:', JSON.stringify(await tryOpen()));

  console.log('\n[1] 开始采集 → 停 → 立刻再开始（用户复现路径）');
  await page.click('#capBtn'); await page.waitForTimeout(2500);
  console.log('  采集中:', JSON.stringify(await show(), null, 1));
  await page.click('#capBtn'); await page.waitForTimeout(150);
  console.log('  停后瞬间:', JSON.stringify(await show(), null, 1));
  await page.click('#capBtn'); await page.waitForTimeout(2500);
  console.log('  再采集:', JSON.stringify(await show(), null, 1));
  console.log('  实测开麦:', JSON.stringify(await tryOpen()));

  await page.click('#capBtn').catch(() => { }); await page.waitForTimeout(500);
  await app.close();
})().catch(e => { console.error('ERR', e && e.message); process.exit(3); });
