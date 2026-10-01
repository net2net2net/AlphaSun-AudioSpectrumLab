#!/usr/bin/env node
/* 用 Chromium 自带 FLAC 解码器校验已生成的 .flac 文件：
   只读元数据取 duration（不接 WebAudio、不调 decodeAudioData，规避 Electron 崩溃路径） */
const {_electron}=require('playwright-core');
const path=require('path'),os=require('os'),fs=require('fs');
const F=process.env.FILE||path.join(os.tmpdir(),'alphasun-verify.flac');
(async()=>{
  if(!fs.existsSync(F)){console.log('文件不存在:',F);process.exit(1);}
  const b=fs.readFileSync(F);
  console.log('文件:',F);
  console.log('大小',(b.length/1024).toFixed(1)+'KB  magic:',JSON.stringify(b.slice(0,4).toString('latin1')));
  const app=await _electron.launch({args:['main.js'],cwd:path.resolve(__dirname,'..'),
    executablePath:path.join(__dirname,'..','node_modules','electron','dist','electron.exe')});
  const page=await app.firstWindow();
  let crashed=false;page.on('crash',()=>{crashed=true;});
  await page.waitForTimeout(1200);
  const url='file:///'+F.split('\\').join('/');
  const r=await page.evaluate(async(u)=>{
    const a=new Audio();a.preload='metadata';a.src=u;
    const res=await new Promise(r=>{a.onloadedmetadata=()=>r('meta');a.onerror=()=>r('error');setTimeout(()=>r('timeout'),8000);});
    return {res,duration:a.duration};},url);
  console.log('Chromium 解码结果:',JSON.stringify(r),'| 崩溃:',crashed);
  const ok=r.res==='meta'&&isFinite(r.duration)&&r.duration>0&&!crashed;
  console.log(ok?'✅ FLAC 合法并可被标准解码器识别':'❌ FLAC 无法解码');
  await app.close().catch(()=>{});
  process.exit(ok?0:3);
})().catch(e=>{console.log('fail',(e.message||e).split('\n')[0]);process.exit(1);});
