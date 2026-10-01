#!/usr/bin/env node
/* 最小复现：定位 Electron 中「录制产物 → 解码」链路的崩溃点。
   分阶段：①录制 webm → ②decodeAudioData → ③手写 FFT/离屏 canvas，逐段观察是否崩溃。 */
const {_electron}=require('playwright-core');
const path=require('path');
const ROOT=path.resolve(__dirname,'..');
(async()=>{
  const app=await _electron.launch({args:['main.js'],cwd:ROOT,
    executablePath:path.join(ROOT,'node_modules','electron','dist','electron.exe'),timeout:60000});
  const page=await app.firstWindow();
  page.on('crash',()=>console.log('*** CRASH 事件触发 ***'));
  page.on('pageerror',e=>console.log('PAGEERROR:',e.message));
  await page.waitForTimeout(1200);

  const step=async(name,fn)=>{try{const r=await page.evaluate(fn);console.log('✔',name,JSON.stringify(r));}
    catch(e){console.log('✘',name,'->',String(e.message||e).split('\n')[0]);}};

  await step('① 录制 3s webm',async()=>{
    const ac=new AudioContext();
    const osc=ac.createOscillator();osc.frequency.value=440;
    const g=ac.createGain();g.gain.value=0.2;
    const dst=ac.createMediaStreamDestination();osc.connect(g);g.connect(dst);
    const mime=['audio/webm;codecs=opus','audio/webm'].find(m=>MediaRecorder.isTypeSupported(m))||'';
    const mr=new MediaRecorder(dst.stream,mime?{mimeType:mime}:undefined);
    const chunks=[];mr.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data);};
    const blob=await new Promise(res=>{mr.onstop=()=>res(new Blob(chunks,{type:mr.mimeType||'audio/webm'}));
      osc.start();mr.start(250);setTimeout(()=>{mr.stop();osc.stop();},3000);});
    window.__b=blob;ac.close();
    return {size:blob.size,type:blob.type};});

  await step('② Audio 元素取时长(webm 通常 Infinity)',async()=>{
    const a=new Audio();a.preload='metadata';a.src=URL.createObjectURL(window.__b);
    await new Promise(r=>{a.onloadedmetadata=r;a.onerror=r;setTimeout(r,5000);});
    return {duration:String(a.duration),isInf:!isFinite(a.duration)};});

  await step('③ decodeAudioData(webm)',async()=>{
    const ab=await window.__b.arrayBuffer();
    const ac=new AudioContext();
    const buf=await ac.decodeAudioData(ab);
    const r={dur:buf.duration,sr:buf.sampleRate,ch:buf.numberOfChannels,n:buf.length};
    ac.close();window.__buf=buf;return r;});

  await step('④ 读取声道数据求和',async()=>{
    const ch=window.__buf.getChannelData(0);let s=0;
    for(let i=0;i<ch.length;i+=97)s+=ch[i];
    return {sum:+s.toFixed(4)};});

  await step('⑤ 2048 点 FFT 循环 200 次',async()=>{
    const N=2048,re=new Float32Array(N),im=new Float32Array(N);
    for(let t=0;t<200;t++){for(let i=0;i<N;i++){re[i]=Math.sin(i*0.01+t);im[i]=0;}
      const half=N/2;for(let i=1,j=N-1;i<N;i++,j--){/* 占位不真正 FFT，仅测分配与循环 */}}
    return {ok:true};});

  await step('⑥ 离屏 canvas 1600x256 putImageData',async()=>{
    const c=document.createElement('canvas');c.width=1600;c.height=256;
    const cx=c.getContext('2d');const img=cx.createImageData(1600,256);
    for(let i=0;i<img.data.length;i+=4){img.data[i]=i&255;img.data[i+1]=128;img.data[i+2]=200;img.data[i+3]=255;}
    cx.putImageData(img,0,0);
    return {ok:true};});

  try{await page.evaluate(()=>1);console.log('页面存活');}catch(e){console.log('页面已崩溃');}
  await app.close().catch(()=>{});
})().catch(e=>{console.error('脚本失败:',e.message.split('\n')[0]);process.exit(1);});
