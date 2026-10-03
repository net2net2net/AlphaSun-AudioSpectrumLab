#!/usr/bin/env node
/* v2.17.0 录音链路 · 真机冒烟（npm run guardsmoke）
 * 覆盖两条录音主链路：① 声波警戒值守台  ② 语音转写
 * （两者曾共用 ScriptProcessorNode，在本机 Electron 28 下都会让渲染进程崩溃，故一起守住）
 *
 * 为什么需要它：qa-gate 第 9 组只能证明"值守台的 DOM 长齐了"，证明不了
 * "值守流程真跑得起来"——本底评估、状态机、环形仪表刷新、退出复原，全在运行期。
 * 本脚本用 Chrome 的假麦克风（--use-fake-device-for-media-stream）让 getUserMedia 成功，
 * 真正跑一遍「开始值守 → 本底评估 → 正常(蓝) → 停止」，断言每一步的实际结果。
 *
 * 注意：假设备输出的是平稳信号，不会越阈，故本脚本只覆盖 eval→normal 主链路与退出复原；
 *       事件/抓拍/推送需真声源与凭据，无法在本环境自动验证（已在 CHANGELOG 已知限制中写明）。
 *
 * 运行：npm run guardsmoke
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
  page.on('pageerror', e => errs.push(e.message));
  page.on('crash', () => errs.push('*** RENDERER CRASHED ***'));
  const cerr = [];
  page.on('console', m => { if (m.type() === 'error') cerr.push(m.text()); });
  const cerr404 = [];
  page.on('response', r => { if (r.status() === 404) cerr404.push(r.url()); });
  page.on('dialog', async d => { try { await d.accept(); } catch (_) { } });   // 自动确认（日志清空等 confirm，接受以真正测到清空）

  await page.waitForTimeout(1500);

  console.log('\n[1] 打开值守面板');
  await page.click('#toolsBtn');
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('#toolsMenu button[data-tool]'))
      .find(x => x.dataset.tool === '声波警戒值守');
    if (b) b.click();
  });
  await page.waitForTimeout(300);
  chk('值守面板已打开', await page.evaluate(() => {
    const m = document.getElementById('alertMask');
    return !!m && m.classList.contains('on');
  }));

  console.log('\n[2] 缩短本底评估并关闭全屏/摄像头（自动化可控）');
  await page.evaluate(() => {
    const e = document.getElementById('alertEval'); if (e) e.value = '2';
    const f = document.getElementById('alertFull'); if (f) f.checked = false;
    const c = document.getElementById('alertCam'); if (c) c.checked = false;
  });
  chk('参数已设为 评估2秒 / 不全屏 / 不启用摄像头', await page.evaluate(() =>
    document.getElementById('alertEval').value === '2' &&
    !document.getElementById('alertFull').checked && !document.getElementById('alertCam').checked));

  console.log('\n[3] 开始值守');
  await page.click('#alertStart');
  await page.waitForTimeout(1200);
  const afterStart = await page.evaluate(() => ({
    shown: document.getElementById('guardScreen').style.display !== 'none',
    stat: (document.getElementById('alertStat') || {}).textContent,
    state: (document.getElementById('gState') || {}).textContent,
    now: (document.getElementById('alertNow') || {}).textContent,
  }));
  chk('值守台已弹出', afterStart.shown, 'display 非 none=' + afterStart.shown);
  chk('面板状态变为「值守中」', afterStart.stat === '值守中', 'stat=' + afterStart.stat);
  chk('顶部进入本底评估阶段', /评估/.test(afterStart.state || ''), 'state=' + afterStart.state);

  console.log('\n[4] 等待本底评估完成（2 秒 + 余量）');
  await page.waitForTimeout(3500);
  const ev = await page.evaluate(() => {
    const g = id => document.getElementById(id);
    const cv = id => { const c = g(id); const r = c ? c.getBoundingClientRect() : null; return { w: r ? r.width : 0, h: r ? r.height : 0 }; };
    return {
      state: (g('gState') || {}).textContent,
      cls: (g('gState') || {}).className,
      lbl: (g('gDbLbl') || {}).textContent,
      floor: (g('gFloor') || {}).textContent,
      db: (g('gDb') || {}).textContent,
      lampNormal: g('gLampNormal') ? g('gLampNormal').classList.contains('on') : false,
      lampWarn: g('gLampWarn') ? g('gLampWarn').classList.contains('on') : false,
      lampAlarm: g('gLampAlarm') ? g('gLampAlarm').classList.contains('on') : false,
      wave: cv('gWave'), ring: cv('gRing'), level: cv('gLevel'),
      time1: (g('gTime') || {}).textContent,
    };
  });
  chk('状态已由「评估中」进入判定态（正常/预警/告警之一）',
    ['正常', '预警', '告警'].indexOf(ev.state) >= 0, 'state=' + ev.state + ' class=' + ev.cls);
  chk('阈值条已算出本底/预警/告警', /本底/.test(ev.lbl || '') && /预警/.test(ev.lbl || ''), 'lbl=' + ev.lbl);
  chk('本底与当前声级已出数值', ev.floor !== '—' && /\d/.test(ev.db || ''), 'floor=' + ev.floor + ' db=' + ev.db);
  // 不变量：亮着的灯必须与当前状态一致（假设备信号在变，不能死断言某一盏灯）
  chk('警戒灯与当前状态一致（不变量）',
    (ev.state === '正常' && ev.lampNormal && !ev.lampWarn && !ev.lampAlarm) ||
    (ev.state === '预警' && ev.lampWarn && !ev.lampAlarm) ||
    (ev.state === '告警' && ev.lampAlarm),
    'state=' + ev.state + ' normal=' + ev.lampNormal + ' warn=' + ev.lampWarn + ' alarm=' + ev.lampAlarm);
  chk('波形与环形画布在值守中已有尺寸', ev.wave.w > 0 && ev.ring.w > 0,
    'wave=' + JSON.stringify(ev.wave) + ' ring=' + JSON.stringify(ev.ring));
  chk('左上电平表画布已渲染（v2.19.0 缩小不遮挡）', ev.level.w > 0 && ev.level.h > 0, 'gLevel=' + JSON.stringify(ev.level));

  console.log('\n[4.5] 暂停 / 恢复（v2.24.0：保持麦克风，暂停判定与录音）');
  const durBefore = await page.evaluate(() => (document.getElementById('gDur') || {}).textContent);
  await page.click('#gPause');
  await page.waitForTimeout(1200);
  const paused = await page.evaluate(() => ({
    btn: (document.getElementById('gPause') || {}).textContent,
    state: (document.getElementById('gState') || {}).textContent,
    cls: (document.getElementById('gState') || {}).className || '',
    db: (document.getElementById('gDb') || {}).textContent,
  }));
  chk('点击暂停后状态显示「已暂停」且按钮变「继续」',
    /已暂停/.test(paused.state || '') && /继续/.test(paused.btn || ''),
    'state=' + paused.state + ' btn=' + paused.btn);
  chk('暂停态有独立样式标记（paused）', /paused/.test(paused.cls || ''), 'class=' + paused.cls);
  // 暂停时计时应冻结
  const durDuring = await page.evaluate(() => (document.getElementById('gDur') || {}).textContent);
  await page.waitForTimeout(1600);
  const durAfter = await page.evaluate(() => (document.getElementById('gDur') || {}).textContent);
  chk('暂停期间计时冻结（麦克风仍保持开启）', durDuring === durAfter,
    durBefore + ' → ' + durDuring + ' → ' + durAfter);
  await page.click('#gPause');
  await page.waitForTimeout(1200);
  const resumed = await page.evaluate(() => ({
    btn: (document.getElementById('gPause') || {}).textContent,
    state: (document.getElementById('gState') || {}).textContent,
  }));
  chk('再次点击恢复值守（按钮回到「暂停」且状态不再是已暂停）',
    /暂停/.test(resumed.btn || '') && !/已暂停/.test(resumed.state || ''),
    'state=' + resumed.state + ' btn=' + resumed.btn);

  console.log('\n[5] 顶部时钟在走');
  await page.waitForTimeout(1500);
  const time2 = await page.evaluate(() => (document.getElementById('gTime') || {}).textContent);
  chk('时钟持续刷新', !!time2 && time2 !== ev.time1, ev.time1 + ' → ' + time2);

  console.log('\n[5.5] 值守中持续观察（假设备周期性发声，事件在回落持续设定秒数后才归档）');
  await page.waitForTimeout(9000);
  const mid = await page.evaluate(() => {
    const L = document.getElementById('alertLog');
    return { log: L ? Array.from(L.children).map(c => c.textContent).slice(-6) : [] };
  });
  chk('值守日志已记录越限/事件（证明状态机在真跑）', mid.log.length > 0,
    mid.log.length + ' 条，最新：' + (mid.log[mid.log.length - 1] || '').slice(0, 80));

  console.log('\n[6] 退出值守并复原（值守台覆盖全屏，只能走值守台上的退出/Esc）');
  await page.click('#gExit');
  await page.waitForTimeout(1500);
  const afterStop = await page.evaluate(() => ({
    hidden: document.getElementById('guardScreen').style.display === 'none',
    stat: (document.getElementById('alertStat') || {}).textContent,
    now: (document.getElementById('alertNow') || {}).textContent,
  }));
  chk('值守台已隐藏', afterStop.hidden, 'hidden=' + afterStop.hidden);
  chk('状态复位为待命', afterStop.stat === '待命', 'stat=' + afterStop.stat);
  chk('读数复位', /--/.test(afterStop.now || ''), 'now=' + afterStop.now);

  console.log('\n[6.5] 第二段值守：手动极低阈值 → 确定性造出事件（不依赖假设备的发声时机）');
  await page.evaluate(() => {
    const a = document.getElementById('alertAuto'); if (a) a.checked = false;   // 关自动本底 → 走手动阈值
    const t = document.getElementById('alertThr'); if (t) t.value = '-120';      // 环境本底约 -100 dB，必然越阈
    const h = document.getElementById('alertHold'); if (h) h.value = '1';        // 回落 1 秒即归档
  });
  await page.click('#alertStart');
  await page.waitForTimeout(4000);
  const during = await page.evaluate(() => ({
    state: (document.getElementById('gState') || {}).textContent,
    shown: document.getElementById('guardScreen').style.display !== 'none',
    ringShadow: getComputedStyle(document.getElementById('gRing')).boxShadow,
  }));
  chk('手动阈值下立即进入告警态', during.shown && during.state === '告警', 'state=' + during.state);
  chk('告警时经典环谱整环变红（boxShadow 已着色）', during.shown && during.state === '告警' && !!during.ringShadow && during.ringShadow !== 'none',
    'ringShadow=' + (during.ringShadow || '').slice(0, 60));
  await page.click('#gExit');
  await page.waitForTimeout(1500);

  console.log('\n[6.6] 值守日志清空（v2.19.0 新增：日志支持清理）');
  const logBefore = await page.evaluate(() => { const L = document.getElementById('alertLog'); return L ? L.children.length : -1; });
  await page.click('#alertClrLog').catch(() => { });
  await page.waitForTimeout(500);
  const logAfter = await page.evaluate(() => { const L = document.getElementById('alertLog'); return L ? L.children.length : -1; });
  chk('值守日志清空按钮生效（条目归零、未崩溃）', logAfter === 0, 'before=' + logBefore + ' after=' + logAfter);

  const evs = await page.evaluate(() => {
    const box = document.getElementById('gEvList');
    const rows = box ? Array.from(box.querySelectorAll('.gEv')) : [];
    return {
      num: parseInt((document.getElementById('gEvNum') || {}).textContent || '0', 10),
      rows: rows.length,
      withAudio: rows.filter(r => !!r.querySelector('audio')).length,
      withBtn: rows.filter(r => Array.from(r.querySelectorAll('button')).some(b => /导出/.test(b.textContent))).length,
      sample: rows.length ? rows[0].textContent.slice(0, 140) : '',
    };
  });
  chk('事件已归档并列入底部列表', evs.num > 0 && evs.rows > 0,
    '事件数=' + evs.num + ' 列表行=' + evs.rows);
  chk('每条事件都带录音回放与导出入口',
    evs.rows > 0 && evs.withAudio === evs.rows && evs.withBtn === evs.rows,
    '含 audio=' + evs.withAudio + '/' + evs.rows + ' 含导出=' + evs.withBtn + '/' + evs.rows);
  if (evs.sample) console.log('     事件样例：' + evs.sample);

  console.log('\n[6.7] 媒体预览灯箱（v2.19.0 新增：拍照/录像回放支持旋转）');
  const media = await page.evaluate(() => ['gMedia', 'gMediaImg', 'gMediaVid', 'gMediaX', 'gRotL', 'gRot0', 'gRotR']
    .filter(id => !!document.getElementById(id)).length);
  chk('媒体预览灯箱 DOM 齐备（容器/图片/视频/关闭/左转/复位/右转）', media === 7, 'found=' + media + '/7');

  console.log('\n[7] 会议转写录音链路（同属 ScriptProcessor 事故面，防回归）');
  await page.click('#alertClose');           // 先关掉值守面板，否则它会挡住后续点击
  await page.waitForTimeout(300);
  await page.click('#toolsBtn');
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('#toolsMenu button[data-tool]')).find(x => x.dataset.tool === '语音转写');
    if (b) b.click();
  });
  await page.waitForTimeout(300);
  await page.click('#asrStart');
  await page.waitForTimeout(4000);
  const asr = await page.evaluate(() => ({
    timer: (document.getElementById('asrTimer') || {}).textContent,
    stopEnabled: !document.getElementById('asrStop').disabled,
  }));
  // 核心断言：活到 4 秒后页面还在（若 ScriptProcessor 崩溃，这里 evaluate 会抛 Target crashed）
  chk('开始转写后录音链路存活（计时在走、未崩溃）', !!asr.timer && asr.stopEnabled,
    'timer=' + asr.timer + ' stopEnabled=' + asr.stopEnabled);
  await page.click('#asrStop');
  await page.waitForTimeout(600);

  console.log('\n[8] 全程零错误');
  chk('无 pageerror / 崩溃', errs.length === 0, errs.join(' | ').slice(0, 300));
  // 过滤可选离线资源 404（VOSK 42MB 模型未随包发布，属预期，非 JS 崩溃）——与 audio-tools-smoke 一致
  const cerrJs = cerr.filter(t => !/Failed to load resource|ERR_FILE_NOT_FOUND|net::ERR/.test(t));
  if (cerr.length !== cerrJs.length)
    console.log('  · 另有 ' + (cerr.length - cerrJs.length) + ' 条可选资源 404（VOSK 离线模型未捆绑等）：' + (cerr404.slice(0, 3).join(' , ') || '（见上方）'));
  chk('无 console.error（JS 类）', cerrJs.length === 0, cerrJs.join(' | ').slice(0, 300));

  await app.close();
  const pass = results.filter(r => r.ok).length, fail = results.length - pass;
  console.log('\n========================================');
  console.log('值守台冒烟：' + pass + ' 通过 / ' + fail + ' 失败 / 共 ' + results.length);
  if (fail) results.filter(r => !r.ok).forEach(r => console.log('  ✗ ' + r.name));
  console.log('========================================');
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('\n✗ 冒烟执行异常：', (e && e.message) || e);
  try { process.exit(3); } catch (_) { }
});
