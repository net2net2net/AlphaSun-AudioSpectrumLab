#!/usr/bin/env node
/* v2.18.0 响应式 / 触摸适配门禁（npm run respgate）
 *
 * 为什么需要它：全平台打包（含手机横竖屏）后，布局溢出、被刘海吃掉、按钮点不准
 * 这类问题只在特定视口下才现形，桌面单一视口的门禁（qa-gate）完全覆盖不到。
 * 本门禁在 4 种典型视口 + 触摸模拟下，断言：
 *   · 无横向溢出（scrollWidth ≤ innerWidth）
 *   · 值守台各区块完整落在视口内（不超出、不被裁切）
 *   · 触摸设备下交互目标 ≥44px（Apple HIG / Material 一致要求）
 *   · 手机竖屏时三色灯横排（窄屏专用布局生效）、横屏矮屏时事件区收窄
 *
 * 运行：npm run respgate
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

/* 视口定义：宽 × 高 × 是否触摸 */
const VIEWPORTS = [
  { key: '桌面 1440×900', w: 1440, h: 900, touch: false },
  { key: '手机竖屏 390×844', w: 390, h: 844, touch: true },
  { key: '手机横屏 844×390', w: 844, h: 390, touch: true },
  { key: '平板竖屏 768×1024', w: 768, h: 1024, touch: true },
];

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
  await page.waitForTimeout(1500);

  // 触摸模拟：CDP Emulation.setEmulatedMedia（Playwright 的 emulateMedia 不支持 pointer/hover）
  const cdp = await page.context().newCDPSession(page).catch(() => null);

  for (const vp of VIEWPORTS) {
    console.log('\n──── ' + vp.key + (vp.touch ? '（触摸）' : '（鼠标）') + ' ────');
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.waitForTimeout(500);

    if (cdp) {
      try {
        await cdp.send('Emulation.setEmulatedMedia', {
          features: vp.touch
            ? [{ name: 'hover', value: 'none' }, { name: 'pointer', value: 'coarse' }]
            : [{ name: 'hover', value: 'hover' }, { name: 'pointer', value: 'fine' }],
        });
      } catch (_) { }
    }
    await page.waitForTimeout(300);

    // 主界面（不进值守台）
    const main = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      iw: window.innerWidth,
      bodySw: document.body.scrollWidth,
    }));
    chk('主界面无横向溢出', main.sw <= main.iw + 1,
      'scrollWidth=' + main.sw + ' innerWidth=' + main.iw);

    // 值守台：临时显示测量（不启动麦克风）
    const g = await page.evaluate(() => {
      const gs = document.getElementById('guardScreen');
      gs.style.display = 'flex';
      // 注意：gTop / gBottom 是 class 不是 id，gWave / gRing / gExit 才是 id
      const R = sel => {
        const e = sel[0] === '.' ? document.querySelector(sel) : document.getElementById(sel);
        const r = e ? e.getBoundingClientRect() : null;
        return r ? { x: +r.x.toFixed(0), y: +r.y.toFixed(0), w: +r.width.toFixed(0), h: +r.height.toFixed(0), b: +r.bottom.toFixed(0), r: +r.right.toFixed(0) } : null;
      };
      const side = document.querySelector('.gSide');
      const inner = gs.firstElementChild ? gs.getBoundingClientRect() : null;
      const out = {
        top: R('.gTop'), main: R('.gMain'), bottom: R('.gBottom'), exit: R('gExit'),
        ring: R('gRing'), wave: R('gWave'),
        sideDir: side ? getComputedStyle(side).flexDirection : null,
        vw: window.innerWidth, vh: window.innerHeight,
        guardH: +(gs.getBoundingClientRect().height).toFixed(0),
        scrollH: gs.scrollHeight,
      };
      gs.style.display = 'none';
      return out;
    });

    chk('值守台顶部完整在视口内', g.top && g.top.y >= 0 && g.top.r <= g.vw + 1,
      JSON.stringify(g.top));
    chk('值守台底部不超出视口高度', g.bottom && g.bottom.b <= g.vh + 1,
      'bottom=' + (g.bottom && g.bottom.b) + ' vh=' + g.vh);
    chk('值守台整体无纵向溢出（内容 ≤ 视口高）', g.guardH <= g.vh + 1,
      'guardH=' + g.guardH + ' vh=' + g.vh);
    chk('波形与环形仪表仍可见', g.wave && g.ring && g.wave.h > 0 && g.ring.w > 0,
      'wave=' + (g.wave && g.wave.h) + ' ring=' + (g.ring && g.ring.w));
    chk('退出按钮在视口内', g.exit && g.exit.x >= 0 && g.exit.r <= g.vw + 1 && g.exit.y >= 0,
      JSON.stringify(g.exit));

    if (vp.touch) {
      chk('触摸下退出按钮触控目标 ≥44px', g.exit && g.exit.h >= 44,
        'exit 高=' + (g.exit && g.exit.h) + 'px');
      // 补全盲区：此前只量值守台 gExit，没量主界面/工具菜单按钮。
      // 触摸媒体查询（hover:none & pointer:coarse）下 button{min-height:44px} 应已生效。
      const tt = await page.evaluate(() => {
        const g = id => document.getElementById(id);
        const grab = el => { const r = el.getBoundingClientRect(); return { h: +r.height.toFixed(0), w: +r.width.toFixed(0) }; };
        const out = [];
        const tb = g('toolsBtn'); if (tb) out.push(['toolsBtn', grab(tb)]);
        const m = g('toolsMenu');
        if (m) {
          const wasOn = m.classList.contains('on');
          if (!wasOn) m.classList.add('on');
          m.querySelectorAll('button[data-tool]').forEach(b => out.push(['menu:' + b.dataset.tool, grab(b)]));
          if (!wasOn) m.classList.remove('on');
        }
        return out;
      });
      const bad = tt.filter(([, v]) => v.h < 44 || v.w < 44);
      chk('触摸下主界面/工具菜单按钮触控目标 ≥44px', bad.length === 0,
        bad.length ? bad.map(([k, v]) => k + '=' + v.h + 'x' + v.w).join(', ') : '全部达标(' + tt.length + ')');
    }

    // 分视口的布局专项
    if (vp.key.indexOf('手机竖屏') === 0) {
      chk('手机竖屏：三色灯改为横排（窄屏布局生效）', g.sideDir === 'row', 'gSide flex-direction=' + g.sideDir);
    }
    if (vp.key.indexOf('手机横屏') === 0) {
      chk('手机横屏矮屏：事件区已收窄（≤34vh）', g.bottom && g.bottom.h <= Math.ceil(g.vh * 0.34) + 2,
        'bottom 高=' + (g.bottom && g.bottom.h) + ' 34vh=' + Math.ceil(g.vh * 0.34));
    }
    if (vp.key.indexOf('桌面') === 0) {
      chk('桌面：三色灯保持竖排', g.sideDir === 'column', 'gSide flex-direction=' + g.sideDir);
    }
  }

  if (cdp) { try { await cdp.send('Emulation.setEmulatedMedia', { features: [] }); } catch (_) { } }

  console.log('\n[末] 全程零错误');
  chk('无 pageerror / 崩溃', errs.length === 0, errs.join(' | ').slice(0, 300));

  await app.close();
  const pass = results.filter(r => r.ok).length, fail = results.length - pass;
  console.log('\n========================================');
  console.log('响应式门禁：' + pass + ' 通过 / ' + fail + ' 失败 / 共 ' + results.length);
  if (fail) results.filter(r => !r.ok).forEach(r => console.log('  ✗ ' + r.name));
  console.log('========================================');
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('\n✗ 响应式门禁执行异常：', (e && e.message) || e);
  try { process.exit(3); } catch (_) { }
});
