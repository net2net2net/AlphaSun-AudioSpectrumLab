#!/usr/bin/env node
/* 定位：Electron 里 decodeAudioData 对不同来源/格式的行为
   ① 纯 JS 合成的 WAV(48k 单声道 2s)  ② 录制产物的 WAV(可选) */
const {_electron}=require('playwright-core');
const path=require('path');
const ROOT=path.resolve(__dirname,'..');
(async()=>{
  const app=await _electron.launch({args:['main.js'],cwd:ROOT,
    executablePath:path.join(ROOT,'node_modules','electron','dist','electron.exe'),timeout:60000});
  const page=await app.firstWindow();
  page.on('crash',()=>console.log('*** CRASH ***'));
  page.on('pageerror',e=>console.log('PAGEERROR:',e.message));
  await page.waitForTimeout(1200);
  const step=async(name,fn)=>{try{const r=await page.evaluate(fn);console.log('✔',name,JSON.stringify(r));}
    catch(e){console.log('✘',name,'->',String(e.message||e).split('\n')[0]);}};

  await step('WAV decode（AudioContext 新建）',async()=>{
    const sr=48000,n=sr*2,ab=new ArrayBuffer(44+n*2),v=new DataView(ab);
    const ws=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));};
    ws(0,'RIFF');v.setUint32(4,36+n*2,true);ws(8,'WAVE');ws(12,'fmt ');
    v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);
    v.setUint32(24,sr,true);v.setUint32(28,sr*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);
    ws(36,'data');v.setUint32(40,n*2,true);
    for(let i=0;i<n;i++)v.setInt16(44+i*2,Math.round(Math.sin(2*Math.PI*440*i/sr)*8000),true);
    const ac=new AudioContext();
    const buf=await ac.decodeAudioData(ab.slice(0));
    const r={dur:+buf.duration.toFixed(3),sr:buf.sampleRate,ch:buf.numberOfChannels,n:buf.length};
    ac.close();return r;});

  await step('WAV decode（48k→第二次，检查是否偶发）',async()=>{
    const sr=48000,n=sr*1,ab=new ArrayBuffer(44+n*2),v=new DataView(ab);
    const ws=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));};
    ws(0,'RIFF');v.setUint32(4,36+n*2,true);ws(8,'WAVE');ws(12,'fmt ');
    v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);
    v.setUint32(24,sr,true);v.setUint32(28,sr*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);
    ws(36,'data');v.setUint32(40,n*2,true);
    const ac=new AudioContext();
    const buf=await ac.decodeAudioData(ab.slice(0));
    const r={dur:+buf.duration.toFixed(3),sr:buf.sampleRate};
    ac.close();return r;});

  await step('检查 AudioContext 数量/状态',async()=>{
    return {AC:typeof AudioContext,offline:typeof OfflineAudioContext};});

  try{await page.evaluate(()=>1);console.log('页面存活');}catch(e){console.log('页面已崩溃');}
  await app.close().catch(()=>{});
})().catch(e=>{console.error('脚本失败:',(e.message||e).split('\n')[0]);process.exit(1);});
