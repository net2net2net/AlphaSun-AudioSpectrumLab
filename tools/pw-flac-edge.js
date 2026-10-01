#!/usr/bin/env node
/* 用 Edge/Chromium 自带 FLAC 解码器校验自研编码器产物。
   要点：① 走本地 HTTP 而非 file:// —— Edge 下 file 源是 opaque，Audio 加载一律 error，
           会误判成「FLAC 不合法」（2026-10-02 踩坑）；
         ② 只读 metadata，不接 WebAudio，规避 Electron decodeAudioData native crash 路径。
   运行：NODE_PATH=... env -u ELECTRON_RUN_AS_NODE FILE=<abs.flac> node tools/pw-flac-edge.js */
const { chromium } = require('playwright-core');
const fs = require('fs'), http = require('http'), path = require('path');
const SRC = process.env.FILE;
const PORT = 8937;
(async () => {
  if (!SRC || !fs.existsSync(SRC)) { console.log('文件不存在:', SRC); process.exit(1); }
  const data = fs.readFileSync(SRC);
  const b0 = data.slice(0, 4).toString('latin1');
  console.log('文件:', SRC);
  console.log('大小', (data.length / 1024).toFixed(1) + 'KB  magic:', JSON.stringify(b0));
  if (b0 !== 'fLaC') { console.log('❌ magic 不是 fLaC'); process.exit(1); }

  const srv = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'audio/flac', 'Accept-Ranges': 'none' });
    res.end(data);
  });
  await new Promise(r => srv.listen(PORT, '127.0.0.1', r));

  const b = await chromium.launch({ channel: 'msedge', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage();
  const r = await p.evaluate(async (u) => {
    const a = new Audio(); a.preload = 'auto'; a.src = u;
    const st = await new Promise(res => {
      a.onloadedmetadata = () => res('meta'); a.onerror = () => res('error:' + (a.error && a.error.code));
      setTimeout(() => res('timeout'), 12000);
    });
    return { st: st, dur: a.duration };
  }, 'http://127.0.0.1:' + PORT + '/x.flac');
  console.log('解码结果:', JSON.stringify(r));
  console.log(r.st === 'meta' && r.dur > 0
    ? '✅ FLAC 合法并可被标准解码器识别（时长 ' + r.dur.toFixed(2) + 's）'
    : '❌ FLAC 无法被标准解码器识别');
  await b.close(); srv.close();
  process.exit(r.st === 'meta' && r.dur > 0 ? 0 : 1);
})().catch(e => { console.log('失败:', (e.message || e).split('\n')[0]); process.exit(1); });
