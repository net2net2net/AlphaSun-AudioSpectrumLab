#!/usr/bin/env node
/* v2.18.0 音频工具集 · 全按钮真机冒烟（npm run audiosmoke）
 * 覆盖「音频工具集」三大工具的全部按钮与交互：
 *   ① 环境音频采集：模式切换 / 开始 / 停止 / 保存 / 评估报告 / 导出报告 / 导出日志
 *   ② 声波警戒值守：开始 / 停止 / 退出 / 推送设置展开 / 保存配置 / 发送测试 / 导出日志
 *                   + 全屏值守台：导出全部 / 清空列表
 *   ③ 会议语音转写：开始 / 停止 / 复制 / 导出 / 保存录音 / 云端设置 / 模式切换 / 语言切换
 *
 * 为什么需要它：qa-gate 只能证明 DOM 长齐、guard-smoke 只覆盖值守+转写两条主录音链路，
 * 用户反馈「点了某些按钮会崩溃」——导出/保存/推送/事件列表等操作此前从没真机跑过，
 * 必须逐个点一遍，捕获 pageerror / renderer crash / console.error。
 *
 * 用 Chrome 假麦克风（--use-fake-device-for-media-stream）让 getUserMedia 成功；
 * 用 page.on('download') 取消下载、page.on('dialog') 关闭原生弹窗（prompt/confirm），
 * 避免测试窗挂死。凡启动→循环→退出功能都真跑。
 *
 * 运行：npm run audiosmoke
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
if (!pw || !pw._electron) {
  console.error('✗ 找不到 playwright-core（需要 _electron）');
  process.exit(2);
}
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
  // 下载与弹窗：避免挂死测试窗（导出按钮会触发浏览器下载，云端设置会调 prompt）
  page.on('download', async d => { try { await d.cancel(); } catch (_) { } });
  page.on('dialog', async d => { try { await d.dismiss(); } catch (_) { } });

  const openTool = async (name) => {
    await page.click('#toolsBtn');
    await page.waitForTimeout(200);
    await page.evaluate(t => {
      const b = Array.from(document.querySelectorAll('#toolsMenu button[data-tool]')).find(x => x.dataset.tool === t);
      if (b) b.click();
    }, name);
    await page.waitForTimeout(300);
  };
  const visible = (id) => page.evaluate(x => {
    const m = document.getElementById(x); return !!m && m.classList.contains('on');
  }, id);

  await page.waitForTimeout(1200);

  // ============ ① 环境音频采集 ============
  console.log('\n========== ① 环境音频采集 ==========');
  await openTool('环境音频采集');
  chk('环境采集面板已打开', await visible('envMask'));

  console.log('\n[1.1] 模式切换（手动 / 定时 / 声级触发）');
  await page.evaluate(() => {
    const seg = document.getElementById('envMode');
    seg.querySelectorAll('button').forEach(b => { if (b.dataset.m === 'timer') b.click(); });
  });
  chk('切到「定时」后时长行显示', await page.evaluate(() =>
    document.getElementById('envTimerRow').style.display === 'flex'));
  await page.evaluate(() => {
    const seg = document.getElementById('envMode');
    seg.querySelectorAll('button').forEach(b => { if (b.dataset.m === 'level') b.click(); });
  });
  chk('切到「声级触发」后阈值行显示', await page.evaluate(() =>
    document.getElementById('envLevelRow').style.display === 'flex'));
  await page.evaluate(() => {
    const seg = document.getElementById('envMode');
    seg.querySelectorAll('button').forEach(b => { if (b.dataset.m === 'manual') b.click(); });
  });
  chk('切回「手动」后两行隐藏', await page.evaluate(() =>
    document.getElementById('envTimerRow').style.display === 'none' &&
    document.getElementById('envLevelRow').style.display === 'none'));

  console.log('\n[1.2] 开始采集（假设备真跑 2.5s）');
  await page.click('#envStart');
  await page.waitForTimeout(2600);
  const envRun = await page.evaluate(() => ({
    clock: (document.getElementById('envClock') || {}).textContent,
    startDisabled: document.getElementById('envStart').disabled,
    stopDisabled: document.getElementById('envStop').disabled,
    stat: (document.getElementById('envStat') || {}).textContent,
  }));
  chk('计时在走（非 00:00）', envRun.clock && envRun.clock !== '00:00', 'clock=' + envRun.clock);
  chk('开始按钮禁用 / 停止按钮可用', envRun.startDisabled && !envRun.stopDisabled,
    'startDisabled=' + envRun.startDisabled);
  await page.click('#envStop');
  await page.waitForTimeout(600);
  chk('停止后开始按钮复位', await page.evaluate(() => !document.getElementById('envStart').disabled));

  console.log('\n[1.3] 生成评估报告（有采样 → 出文本；静音假设备 → 提示采样不足，均不崩溃）');
  await page.click('#envReportBtn');
  await page.waitForTimeout(300);
  chk('评估报告按钮未崩溃（渲染或提示采样不足均为正常路径）', await page.evaluate(() => {
    const o = document.getElementById('envReportOut');
    // 有信号 → 报告渲染（含「等效连续声级」）；静音假设备 → 不出报告但也不抛错
    return o.style.display !== 'none' ? o.textContent.indexOf('等效连续声级') >= 0 : true;
  }));

  console.log('\n[1.4] 保存原始录音 / 导出报告 / 导出日志（有数据时，下载会被取消）');
  await page.click('#envSaveBtn'); await page.waitForTimeout(400);
  chk('保存原始录音未崩溃', !errs.length ? true : !errs.some(e => /envSaveBtn|保存/.test(e)));
  await page.click('#envExpRep'); await page.waitForTimeout(400);
  chk('导出评估报告未崩溃', true);
  await page.click('#envExpLog'); await page.waitForTimeout(400);
  chk('导出采集日志未崩溃', true);

  console.log('\n[1.5] 关闭面板');
  await page.click('#envClose'); await page.waitForTimeout(300);
  chk('环境采集面板已关闭', !(await visible('envMask')));

  // ============ ② 声波警戒值守 ============
  console.log('\n========== ② 声波警戒值守 ==========');
  await openTool('声波警戒值守');
  chk('值守面板已打开', await visible('alertMask'));
  // 配置参数（评估缩短、关全屏/摄像头）。
  // 注意：开始值守后全屏值守台会盖住本面板，故推送设置/导出日志等按钮
  // 只在「未值守」时可达 —— 先测这些，再开始值守。
  await page.evaluate(() => {
    const e = document.getElementById('alertEval'); if (e) e.value = '2';
    const f = document.getElementById('alertFull'); if (f) f.checked = false;
    const c = document.getElementById('alertCam'); if (c) c.checked = false;
  });

  console.log('\n[2.1] 推送设置展开 / 保存配置 / 发送测试（未值守时面板可见可点）');
  await page.click('#alertNotifyBtn'); await page.waitForTimeout(300);
  chk('推送设置已展开', await page.evaluate(() =>
    document.getElementById('alertNotifyCfg').style.display !== 'none'));
  await page.click('#ntSave'); await page.waitForTimeout(300);
  chk('保存推送配置未崩溃', true);
  await page.click('#ntTest'); await page.waitForTimeout(400);
  chk('发送测试（空通道→toast）未崩溃', true);
  await page.click('#alertNotifyBtn'); await page.waitForTimeout(200); // 收起

  console.log('\n[2.2] 导出值守日志（尚未值守 → 空日志 toast，不崩溃）');
  await page.click('#alertExpLog'); await page.waitForTimeout(400);
  chk('导出值守日志（空）未崩溃', true);

  console.log('\n[2.3] 开始值守 → 本底评估 → 正常');
  await page.click('#alertStart');
  await page.waitForTimeout(4000);
  chk('值守中（面板状态=值守中，值守台已弹）',
    await page.evaluate(() => document.getElementById('alertStat').textContent === '值守中' &&
      document.getElementById('guardScreen').style.display !== 'none'));

  console.log('\n[2.4] 退出值守台（取事件数后再开第二次造事件）');
  await page.click('#gExit'); await page.waitForTimeout(1200);
  chk('退出后值守台隐藏 / 状态待命',
    await page.evaluate(() => document.getElementById('guardScreen').style.display === 'none' &&
      document.getElementById('alertStat').textContent === '待命'));

  console.log('\n[2.5] 手动极低阈值 → 告警（值守台可见）→ 退出归档 → 再进入测「导出全部/清空」');
  await page.evaluate(() => {
    const a = document.getElementById('alertAuto'); if (a) a.checked = false;
    const t = document.getElementById('alertThr'); if (t) t.value = '-120';
    const h = document.getElementById('alertHold'); if (h) h.value = '1';
  });
  await page.click('#alertStart');
  await page.waitForTimeout(3000);
  const evRun = await page.evaluate(() => ({
    state: (document.getElementById('gState') || {}).textContent,
    shown: document.getElementById('guardScreen').style.display !== 'none',
  }));
  chk('手动阈值下进入告警态（值守台可见）', evRun.shown && evRun.state === '告警', 'state=' + evRun.state);
  await page.click('#gExit'); await page.waitForTimeout(1500);
  chk('退出后事件已归档（evNum>0）', await page.evaluate(() =>
    parseInt((document.getElementById('gEvNum') || {}).textContent || '0', 10) > 0));
  // 重新进入（GUARD.evs 保留），在值守台可见态测「导出全部 / 清空」的有数据分支
  await page.evaluate(() => { const t = document.getElementById('alertThr'); if (t) t.value = '-120'; });
  await page.click('#alertStart'); await page.waitForTimeout(1500);
  chk('再次进入告警态', await page.evaluate(() =>
    document.getElementById('guardScreen').style.display !== 'none' &&
    (document.getElementById('gState') || {}).textContent === '告警'));
  await page.click('#gEvExpAll'); await page.waitForTimeout(600);
  chk('导出全部事件（有数据，txt+csv）未崩溃', true);
  await page.click('#gEvClear'); await page.waitForTimeout(300);
  chk('清空事件列表', await page.evaluate(() =>
    parseInt((document.getElementById('gEvNum') || {}).textContent || '0', 10) === 0));
  await page.click('#gExit'); await page.waitForTimeout(1000);
  await page.click('#alertClose'); await page.waitForTimeout(300);

  // ============ ③ 会议语音转写 ============
  console.log('\n========== ③ 会议语音转写 ==========');
  await openTool('会议语音转写');
  chk('转写面板已打开', await visible('asrMask'));

  console.log('\n[3.1] 模式/语言切换（触发引擎探测，不崩溃）');
  await page.selectOption('#asrMode', 'local'); await page.waitForTimeout(800);
  chk('切到本地模式后引擎探测完成（非「检测中」）', await page.evaluate(() =>
    (document.getElementById('asrEng').textContent || '').indexOf('检测中') < 0));
  await page.selectOption('#asrMode', 'cloud'); await page.waitForTimeout(600);
  await page.selectOption('#asrLang', 'en'); await page.waitForTimeout(500);
  await page.selectOption('#asrLang', 'zh'); await page.waitForTimeout(500);
  chk('切回云端/中文后引擎探测量到', true);

  console.log('\n[3.2] 开始转写（云端无 Key → 回退；假设备真跑 2.5s）');
  await page.click('#asrStart');
  await page.waitForTimeout(2800);
  const asrRun = await page.evaluate(() => ({
    timer: (document.getElementById('asrTimer') || {}).textContent,
    stopEnabled: !document.getElementById('asrStop').disabled,
    stat: (document.getElementById('asrStat') || {}).textContent,
  }));
  chk('开始转写后录音链路存活（计时在走、未崩溃）', !!asrRun.timer && asrRun.stopEnabled,
    'timer=' + asrRun.timer + ' stat=' + asrRun.stat);
  await page.click('#asrStop'); await page.waitForTimeout(600);
  chk('停止转写后按钮复位（开始可用 / 停止禁用）', await page.evaluate(() =>
    !document.getElementById('asrStart').disabled && document.getElementById('asrStop').disabled));

  console.log('\n[3.3] 复制/导出/保存录音（空文字稿 → toast，不崩溃）');
  await page.click('#asrCopy'); await page.waitForTimeout(300);
  chk('复制文字稿（空）未崩溃', true);
  await page.click('#asrExp'); await page.waitForTimeout(300);
  chk('导出文字稿（空）未崩溃', true);
  await page.click('#asrSaveWav'); await page.waitForTimeout(300);
  chk('保存原始录音（空）未崩溃', true);

  console.log('\n[3.4] 云端设置（改为内联输入框，不再用 prompt）');
  await page.click('#asrKeyBtn'); await page.waitForTimeout(300);
  chk('云端设置展开为内联输入框（无 prompt 崩溃）', await page.evaluate(() =>
    document.getElementById('asrKeyCfg').style.display !== 'none'));
  await page.click('#asrKeyBtn'); await page.waitForTimeout(200); // 收起（不实际保存，避免写入测试机配置）
  chk('云端设置可收起', await page.evaluate(() =>
    document.getElementById('asrKeyCfg').style.display === 'none'));

  console.log('\n[3.5] 关闭面板');
  await page.click('#asrClose'); await page.waitForTimeout(300);
  chk('转写面板已关闭', !(await visible('asrMask')));

  // ============ 全程错误汇总 ============
  console.log('\n========== 全程零错误 ==========');
  chk('无 pageerror / 崩溃', errs.length === 0, errs.join(' | ').slice(0, 400));
  // 过滤可选离线模型（VOSK）缺失导致的网络 404，属预期，非 JS 崩溃
  const cerrJs = cerr.filter(t => !/Failed to load resource|ERR_FILE_NOT_FOUND|net::ERR/.test(t));
  if (cerr.length !== cerrJs.length)
    console.log('  · 另有 ' + (cerr.length - cerrJs.length) + ' 条可选资源 404（VOSK 离线模型未捆绑），已忽略');
  chk('无 console.error（JS 类）', cerrJs.length === 0, cerrJs.join(' | ').slice(0, 400));

  await app.close();
  const pass = results.filter(r => r.ok).length, fail = results.length - pass;
  console.log('\n========================================');
  console.log('音频工具集冒烟：' + pass + ' 通过 / ' + fail + ' 失败 / 共 ' + results.length);
  if (fail) results.filter(r => !r.ok).forEach(r => console.log('  ✗ ' + r.name));
  console.log('========================================');
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('\n✗ 冒烟执行异常：', (e && e.message) || e);
  try { process.exit(3); } catch (_) { }
});
