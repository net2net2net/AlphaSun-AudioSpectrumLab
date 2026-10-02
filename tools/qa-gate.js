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
  await page.waitForTimeout(1800);   // 等引擎探测：云端 Key 状态 / HEAD 离线模型（+ 可能注入 5.8MB 运行时）
  const eng = await page.evaluate(() => {
    const e = document.getElementById('asrEng');
    const lang = document.getElementById('asrLang');
    const mode = document.getElementById('asrMode');
    const cv = document.getElementById('asrWave');
    const r = cv ? cv.getBoundingClientRect() : null;
    return {
      text: e ? e.textContent.trim() : '(无此元素)',
      voskGlobal: typeof window.Vosk !== 'undefined',
      cloudBridge: typeof window.asrCloud !== 'undefined',
      langOpts: lang ? Array.from(lang.options).map(o => o.value) : [],
      modeOpts: mode ? Array.from(mode.options).map(o => o.value) : [],
      waveOk: !!(cv && r && r.width > 0 && r.height > 0),
      hasSaveWav: !!document.getElementById('asrSaveWav'),
      hasKeyBtn: !!document.getElementById('asrKeyBtn'),
      hasSeg: !!document.getElementById('asrSeg'),
    };
  });
  const settled = !eng.text.includes('检测中') && /云端|本地|Web Speech|不支持/.test(eng.text);
  chk('ASR 引擎完成探测并如实标注（未卡在「检测中」）', settled, 'badge="' + eng.text + '"');
  // 诚实性：未配置 Key 时不得显示成「阿里云 DashScope」可用态
  chk('未配置云端 Key 时不谎报云端可用', !(eng.text.includes('DashScope') && !eng.text.includes('未配置')),
    'badge="' + eng.text + '"，云端桥=' + eng.cloudBridge);
  // 本仓库不随包发布 42MB 离线模型 → 引擎绝不能谎报「Vosk 离线」
  chk('未放置离线模型时不谎报 Vosk 离线引擎', !eng.text.includes('Vosk 离线'),
    'badge="' + eng.text + '"，Vosk运行时已加载=' + eng.voskGlobal);
  // v2.15.0 新增：三语 / 双模式 / 波形 / 原始录音保存 / 云端设置
  chk('语言下拉含三语（zh/yue/en）', ['zh', 'yue', 'en'].every(v => eng.langOpts.includes(v)), eng.langOpts.join(','));
  chk('模式下拉含云端与本地', eng.modeOpts.includes('cloud') && eng.modeOpts.includes('local'), eng.modeOpts.join(','));
  chk('转写波形画布已渲染出尺寸', eng.waveOk, 'canvas 有尺寸=' + eng.waveOk);
  chk('原始录音保存入口存在', eng.hasSaveWav, 'asrSaveWav=' + eng.hasSaveWav);
  chk('云端设置入口存在', eng.hasKeyBtn, 'asrKeyBtn=' + eng.hasKeyBtn);
  chk('分段转写段长选择存在', eng.hasSeg, 'asrSeg=' + eng.hasSeg);
  await page.evaluate(() => { const el = document.getElementById('asrMask'); if (el) el.classList.remove('on'); });

  console.log('\n[6] 面板运行期错误复查（打开三面板后）');
  const diag2 = await page.evaluate(() => window.__diag ? window.__diag.summary() : null);
  chk('交互后仍零 pageerror', pageErrs.length === 0, pageErrs.join(' | ').slice(0, 300));
  chk('交互后零 console.error', diag2 && diag2.errors === 0, diag2 ? ('errors=' + diag2.errors + ' warns=' + diag2.warns) : '');

  console.log('\n[7] 云端转写通道（主进程 IPC 往返 + 缺 Key 必须明确报错）');
  const cloud = await page.evaluate(async () => {
    if (!window.asrCloud) return { skip: true };
    // 构造 0.5 秒静音 16bit/16kHz 单声道 WAV，仅用于打通 IPC 往返
    const n = 8000, ab = new ArrayBuffer(44 + n * 2), dv = new DataView(ab);
    const wr = (o, t) => { for (let i = 0; i < t.length; i++) dv.setUint8(o + i, t.charCodeAt(i)); };
    wr(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); wr(8, 'WAVE'); wr(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, 16000, true); dv.setUint32(28, 32000, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
    wr(36, 'data'); dv.setUint32(40, n * 2, true);
    const u = new Uint8Array(ab); let s = '';
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    const st = await window.asrCloud.keyStatus();
    const r = await window.asrCloud.transcribe({ wavBase64: btoa(s), lang: 'zh' });
    return { skip: false, status: st, result: r };
  });
  if (cloud.skip) {
    chk('非桌面端正确缺失云端桥（前端降级路径）', true, 'window.asrCloud 不存在 → 降级到 Web Speech');
  } else {
    chk('云端 Key 状态查询走通 IPC', !!(cloud.status && typeof cloud.status.hasKey === 'boolean'),
      JSON.stringify(cloud.status));
    // 红线：缺 API Key 必须明确报错，绝不静默返回空结果
    chk('未配置 Key 时云端转写明确报错（不静默返回空）',
      !!(cloud.result && cloud.result.ok === false && cloud.result.error === 'NO_KEY'),
      JSON.stringify(cloud.result).slice(0, 180));
  }

  console.log('\n[8] 环境音频采集面板（v2.16.0：波形 / 地点命名 / 评估报告）');
  await page.evaluate(() => { const m = document.getElementById('toolsMenu'); if (m) m.classList.remove('on'); });
  await page.click('#toolsBtn');
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('#toolsMenu button[data-tool]')).find(x => x.dataset.tool === '环境音频采集');
    if (b) b.click();
  });
  await page.waitForTimeout(400);
  const env = await page.evaluate(() => {
    const cv = document.getElementById('envWave');
    const r = cv ? cv.getBoundingClientRect() : null;
    return {
      hasPlace: !!document.getElementById('envPlace'),
      hasCalib: !!document.getElementById('envCalib'),
      waveOk: !!(cv && r && r.width > 0 && r.height > 0),
      hasSave: !!document.getElementById('envSaveBtn'),
      hasReport: !!document.getElementById('envReportBtn'),
      hasExpRep: !!document.getElementById('envExpRep'),
      hasAutoRep: !!document.getElementById('envAutoRep'),
      hasLog: !!document.getElementById('envLog'),
    };
  });
  chk('地点输入框存在（用于文件命名）', env.hasPlace, 'envPlace=' + env.hasPlace);
  chk('校准偏置输入存在（未校准声明配套）', env.hasCalib, 'envCalib=' + env.hasCalib);
  chk('采集波形画布已渲染出尺寸', env.waveOk, 'canvas 有尺寸=' + env.waveOk);
  chk('保存原始录音入口存在', env.hasSave, 'envSaveBtn=' + env.hasSave);
  chk('生成/导出评估报告入口存在', env.hasReport && env.hasExpRep,
    'reportBtn=' + env.hasReport + ' expRep=' + env.hasExpRep);
  chk('停止后自动出报告开关存在', env.hasAutoRep, 'envAutoRep=' + env.hasAutoRep);
  await page.evaluate(() => { const el = document.getElementById('envMask'); if (el) el.classList.remove('on'); });

  console.log('\n[9] 声波警戒值守台（v2.17.0：全屏值守 / 波形+环形 / 三色警戒灯 / 事件记录 / 摄像头 / 推送）');
  await page.evaluate(() => { const m = document.getElementById('toolsMenu'); if (m) m.classList.remove('on'); });
  await page.click('#toolsBtn');
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('#toolsMenu button[data-tool]')).find(x => x.dataset.tool === '声波警戒值守');
    if (b) b.click();
  });
  await page.waitForTimeout(400);
  const gd = await page.evaluate(() => {
    const gs = document.getElementById('guardScreen');
    const app = document.getElementById('appRoot');
    const cvSize = id => { const c = document.getElementById(id); const r = c ? c.getBoundingClientRect() : null; return !!(c && r && r.width > 0 && r.height > 0); };
    return {
      hasScreen: !!gs,
      hidden: !!gs && getComputedStyle(gs).display === 'none',
      // 红线：必须 body 直属。放进 .app 会被其 z-index/zoom 层叠上下文困住 → 全屏浮层被主画布遮挡
      bodyChild: !!gs && gs.parentElement === document.body,
      notInApp: !!gs && !!app && !app.contains(gs),
      lamps: ['gLampAlarm', 'gLampWarn', 'gLampNormal'].filter(id => !!document.getElementById(id)).length,
      // 值守台默认 display:none，隐藏元素 rect 恒为 0 → 必须先临时显示再量尺寸
      waveOk: (gs.style.display = 'flex', cvSize('gWave')),
      ringOk: cvSize('gRing'),
      topOk: ['gTime', 'gDate', 'gDb', 'gState', 'gDur', 'gExit'].filter(id => !!document.getElementById(id)).length,
      evOk: !!document.getElementById('gEvList') && !!document.getElementById('gEvExpAll') && !!document.getElementById('gEvClear'),
      camOk: ['alertCam', 'alertCamShot', 'alertCamRec', 'alertCamDev'].filter(id => !!document.getElementById(id)).length,
      hasFull: !!document.getElementById('alertFull'),
      hasNotify: !!document.getElementById('alertNotifyBtn') && !!document.getElementById('alertNotifyCfg'),
      hasAuto: !!document.getElementById('alertAuto') && !!document.getElementById('alertEval'),
      // v2.17.0 起判定改为「本底 + 余量」，不再有方向选择（旧 alertDir 已移除）
      noDir: !document.getElementById('alertDir'),
    };
  });
  chk('全屏值守台存在且默认隐藏', gd.hasScreen && gd.hidden, 'hasScreen=' + gd.hasScreen + ' hidden=' + gd.hidden);
  chk('值守台为 body 直属（避开 .app 层叠上下文）', gd.bodyChild && gd.notInApp,
    'bodyChild=' + gd.bodyChild + ' notInApp=' + gd.notInApp);
  chk('三色警戒灯齐备（红告警/黄预警/蓝正常）', gd.lamps === 3, 'lamps=' + gd.lamps);
  chk('值守波形与环形仪表已渲染出尺寸', gd.waveOk && gd.ringOk, 'wave=' + gd.waveOk + ' ring=' + gd.ringOk);
  await page.evaluate(() => { const gs = document.getElementById('guardScreen'); if (gs) gs.style.display = 'none'; });
  chk('顶部时间/日期/声级/状态/时长/退出齐备', gd.topOk === 6, 'top=' + gd.topOk);
  chk('底部事件区含列表与导出/清空', gd.evOk, 'evOk=' + gd.evOk);
  chk('摄像头告警记录控件齐备', gd.camOk === 4, 'cam=' + gd.camOk);
  chk('本底自动评估与全屏开关存在', gd.hasAuto && gd.hasFull, 'auto=' + gd.hasAuto + ' full=' + gd.hasFull);
  chk('告警推送入口存在（企业微信/钉钉/飞书等）', gd.hasNotify, 'notify=' + gd.hasNotify);
  chk('已移除失效的「方向」选择器（改为本底+余量判定）', gd.noDir, 'noDir=' + gd.noDir);
  // 交互：点「告警推送设置」应展开配置区（DOM 行为，不依赖麦克风）
  const ntToggle = await page.evaluate(() => {
    const btn = document.getElementById('alertNotifyBtn'), box = document.getElementById('alertNotifyCfg');
    if (!btn || !box) return null;
    const before = getComputedStyle(box).display;
    btn.click();
    const after = getComputedStyle(box).display;
    return { before: before, after: after, hasWecom: !!document.getElementById('ntWecom'), hasPhone: !!document.getElementById('ntPhone') };
  });
  chk('推送设置可展开且含通道与手机号配置',
    !!ntToggle && ntToggle.before === 'none' && ntToggle.after !== 'none' && ntToggle.hasWecom && ntToggle.hasPhone,
    JSON.stringify(ntToggle));
  await page.evaluate(() => { const el = document.getElementById('alertMask'); if (el) el.classList.remove('on'); });

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
