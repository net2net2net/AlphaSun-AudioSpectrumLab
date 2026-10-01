#!/usr/bin/env node
/* 验证：保存的 FLAC 是否被标准解码器认可 —— 触发真实保存流程拿到下载文件，
   再用 Chromium 自带 FLAC 解码器（Audio 元素 + MediaElementSource + Analyser）检查
   时长与是否真的解出声音（全程不使用 decodeAudioData，避开 Electron 崩溃路径）。 */
const {_electron}=require('playwright-core');
const path=require('path'),fs=require('fs');
const ROOT=path.resolve(__dirname,'..');
const FMT=process.env.FMT||'flac';
(async()=>{
  const app=await _electron.launch({args:['main.js','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'],
    cwd:ROOT,executablePath:path.join(ROOT,'node_modules','electron','dist','electron.exe'),timeout:60000});
  const page=await app.firstWindow();
  page.on('crash',()=>console.log('*** CRASH ***'));
  await page.waitForTimeout(1500);
  let saved=null;
  page.on('download',async d=>{saved=d;console.log('[download]',d.suggestedFilename());});

  await page.click('#lab2Btn');await page.waitForTimeout(400);
  console.log('录制 5s…');
  await page.click('#lab2Rec');await page.waitForTimeout(5000);await page.click('#lab2Rec');
  await page.waitForTimeout(2500);
  console.log('  载入:',(await page.evaluate(()=>document.getElementById('lab2Finfo').textContent)).slice(0,60));

  // 拦截 <a download> 的 click，拿到产物 blob URL（Electron 不触发 playwright 的 download 事件）
  await page.evaluate(()=>{window.__cap=null;
    const oc=HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click=function(){if(this.download&&this.href)window.__cap=this.href;else oc.call(this);};});
  await page.click('#lab2Exp');await page.waitForTimeout(600);
  const dis=await page.evaluate(f=>document.querySelector('.l2save-btn[data-f="'+f+'"]').disabled,FMT);
  console.log('格式',FMT,'按钮灰显:',dis);
  if(dis){await app.close();process.exit(3);}
  await page.click('.l2save-btn[data-f="'+FMT+'"]');
  await page.waitForFunction(()=>!!window.__cap,{timeout:120000}).catch(()=>{});
  console.log('  [finfo]',(await page.evaluate(()=>document.getElementById('lab2Finfo').textContent)).slice(0,110));
  const cap=await page.evaluate(()=>window.__cap);
  if(!cap){console.log('未拿到产物');await app.close();process.exit(3);}
  const b64=await page.evaluate(async(u)=>{const ab=await (await fetch(u)).arrayBuffer();
    const by=new Uint8Array(ab);let s='';for(let i=0;i<by.length;i++)s+=String.fromCharCode(by[i]);return btoa(s);},cap);
  const p=path.join(require('os').tmpdir(),'alphasun-verify.'+FMT);
  fs.writeFileSync(p,Buffer.from(b64,'base64'));
  const size=fs.statSync(p).size;
  console.log('产物写入:',p,'大小',(size/1024).toFixed(1)+'KB');

  // —— 用 Chromium 自带解码器验证 ——
  const r=await page.evaluate(async(fileUrl)=>{
    const a=new Audio();a.src=fileUrl;a.preload='auto';
    await new Promise((res,rej)=>{a.onloadedmetadata=res;a.onerror=()=>rej(new Error('加载失败'));setTimeout(res,8000);});
    const dur=a.duration;
    let energy=0;
    try{
      const ac=new AudioContext();const src=ac.createMediaElementSource(a);
      const an=ac.createAnalyser();an.fftSize=2048;src.connect(an);an.connect(ac.destination);
      await a.play().catch(()=>{});a.currentTime=0.2;
      await new Promise(r=>setTimeout(r,1500));
      const td=new Float32Array(an.fftSize);an.getFloatTimeDomainData(td);
      for(let i=0;i<td.length;i++)energy+=Math.abs(td[i]);
      a.pause();ac.close();
    }catch(e){return {dur,err:String(e.message||e).slice(0,80)};}
    return {dur,energy:+energy.toFixed(3)};},'file:///'+p.replace(/\\/g,'/'));
  console.log('解码验证:',JSON.stringify(r));
  const ok=isFinite(r.dur)&&r.dur>0&&(r.energy>0.5);
  console.log(ok?'✅ 合法可播（时长+能量均正常）':'❌ 解码异常');
  await app.close().catch(()=>{});
  process.exit(ok?0:3);
})().catch(e=>{console.error('脚本失败:',(e.message||e).split('\n')[0]);process.exit(1);});
