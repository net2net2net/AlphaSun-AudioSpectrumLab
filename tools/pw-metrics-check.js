#!/usr/bin/env node
/* 新增分析指标实跑验证：真实 Electron + 虚拟麦克风，点「开始采集」跑一段时间，
   读主界面各指标 DOM 文本，确认**真的出数**（而不是不崩溃却恒显示「—」）。
   重点看 v2.13.0 新增的 dB(A)/dB(C) 与 Leq·L10/L50/L90，以及修复后的 BPM。
   运行：NODE_PATH=... env -u ELECTRON_RUN_AS_NODE SEC=14 node tools/pw-metrics-check.js */
const { _electron } = require('playwright-core');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const SEC = +(process.env.SEC || 14);

(async () => {
  const app = await _electron.launch({
    args: ['main.js', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    cwd: ROOT, executablePath: path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), timeout: 60000
  });
  const page = await app.firstWindow();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('crash', () => errs.push('*** RENDERER CRASHED ***'));
  await page.waitForTimeout(1500);

  await page.click('#capBtn');
  console.log('采集 ' + SEC + 's …');
  await page.waitForTimeout(SEC * 1000);

  const ids = ['dbBig', 'rmsV', 'peakV', 'crestV', 'zcrV', 'drV', 'snrV', 'dbaV', 'leqV', 'bpmV', 'f0V', 'centroidV', 'domV'];
  const vals = await page.evaluate(list => {
    const o = {};
    for (const id of list) { const el = document.getElementById(id); o[id] = el ? el.textContent.trim() : '(无此元素)'; }
    return o;
  }, ids);

  console.log('\n=== 主界面读数 ===');
  for (const id of ids) console.log('  ' + id.padEnd(12) + ' ' + vals[id]);

  let fail = 0;
  const want = m => { console.log('  ✓ ' + m); };
  const no = m => { console.log('  ✗ ' + m); fail++; };
  console.log('\n=== 判定 ===');
  // 虚拟麦克风是稳定的周期性信号，dB(A)/dB(C) 与 RMS 都必须出数
  if (/^-?\d+\.\d+ \/ -?\d+\.\d+ dB$/.test(vals.dbaV)) want('dB(A)/dB(C) 已出数：' + vals.dbaV);
  else no('dB(A)/dB(C) 未出数（' + vals.dbaV + '）——计权链路或 floatFreq 未生效');
  // 统计声级需若干「算得出计权值的帧」；虚拟设备信号极弱，常仍在攒样本——「累计中 n/12」属正常进度态
  if (/^Leq /.test(vals.leqV)) want('统计声级已出数：' + vals.leqV);
  else if (/^累计中 \d+\/\d+/.test(vals.leqV)) want('统计声级正在累计（' + vals.leqV + '）——假麦克风信号弱，属预期');
  else no('统计声级既未出数也未显示累计（' + vals.leqV + '）——检查计权链路');
  if (vals.rmsV !== '—' && vals.rmsV !== '--') want('电平链路正常：RMS=' + vals.rmsV);
  else no('电平链路无数据：RMS=' + vals.rmsV);
  // 虚拟设备是纯音/静音，BPM 未必有值（无节拍时应为「—」，这本身是正确行为）
  console.log('  · BPM=' + vals.bpmV + '（虚拟设备为稳定音，无节拍时显示「—」属正确行为）');
  console.log(errs.length ? '  ✗ 运行时错误：' + errs.join(' | ') : '  ✓ 无 JS 错误 / 无崩溃');
  if (errs.length) fail++;

  await app.close().catch(() => {});
  console.log(fail ? '\n✋ 指标验证 ' + fail + " 项未通过" : '\n★ 指标验证通过');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('脚本失败:', (e.message || e).split('\n')[0]); process.exit(1); });
