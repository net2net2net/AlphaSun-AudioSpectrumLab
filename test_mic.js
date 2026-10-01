const { chromium } = require('playwright');
const path = require('path');
const FILE = 'file://' + path.resolve(__dirname, 'index.html');

(async () => {
  const errors = [];
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.LOCALAPPDATA + '/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe',
    args: ['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']
  });
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('dialog', d => d.accept()); // 自动确认清理历史弹窗

  // 环境兜底：若 headless 无 mediaDevices，注入振荡器音频流（真实可分析）
  await page.addInitScript(() => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices = navigator.mediaDevices || {};
      navigator.mediaDevices.getUserMedia = async () => {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        const ctx = new Ctx();
        const osc = ctx.createOscillator(); osc.frequency.value = 440; osc.type = 'sine';
        const dst = ctx.createMediaStreamDestination(); osc.connect(dst); osc.start();
        window.__fakeCtx = ctx;
        return dst.stream;
      };
    }
  });

  await page.goto(FILE, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  await page.click('#capBtn');
  await page.waitForTimeout(1500);
  const s1 = await readVals(page);
  await page.waitForTimeout(3000); // 等待 ≥1 次 2s 缓存抽样
  const s2 = await readVals(page);

  // 触发导出报告（验证无报错）
  let repOk = true;
  try { await page.click('#repBtn'); await page.waitForTimeout(300); } catch (e) { repOk = false; errors.push('REPORT_BTN: ' + e.message); }

  const canvasLit = await page.evaluate(() => {
    const c = document.getElementById('cv'); const g = c.getContext('2d');
    const d = g.getImageData(0,0,c.width,c.height).data; let lit=0;
    for (let i=3;i<d.length;i+=4) if (d[i]>10) lit++; return lit;
  });
  await page.screenshot({ path: path.resolve(__dirname, 'mic_test_shot.png') });

  console.log('=== MIC / CACHE / REPORT TEST ===');
  console.log('errors:', errors.length ? errors : 'NONE');
  console.log('canvasLit:', canvasLit);
  console.log('snap1:', JSON.stringify(s1));
  console.log('snap2:', JSON.stringify(s2));
  console.log('REPORT_BTN_OK:', repOk);
  console.log('ANALYSIS_LIVE:', s1.db!==s2.db || s1.centroid!==s2.centroid || s1.verdict!==s2.verdict);
  console.log('CACHE_GREW:', Number(s2.histCount) > Number(s1.histCount), '('+s1.histCount+'->'+s2.histCount+')');

  // 清理历史测试
  await page.click('#clrBtn'); await page.waitForTimeout(400);
  const s3 = await readVals(page);
  console.log('AFTER_CLEAR histCount:', s3.histCount);

  await browser.close();
})().catch(e => { console.error('TEST_FAIL', e); process.exit(1); });

async function readVals(page){return await page.evaluate(()=>({
  db: document.getElementById('dbBig').textContent,
  centroid: document.getElementById('centroidV').textContent,
  verdict: document.getElementById('verdictTxt').textContent,
  histCount: document.getElementById('histCount').textContent,
  histSize: document.getElementById('histSize').textContent,
  cVoice: document.getElementById('cVoiceV').textContent,
  level: document.getElementById('levelFill').style.width,
  status: document.getElementById('status').textContent
}));}
