#!/usr/bin/env node
/* v2.11.2 回归：真实 Electron 环境 + 虚拟麦克风，点真实「录制」按钮走 AudioWorklet 链路，
   产出 WAV 后依次跑 声谱图 / 三处理 / 保存五格式；全程监听渲染进程崩溃与 JS 错误。
   运行：env -u ELECTRON_RUN_AS_NODE REC_SEC=8 node tools/pw-electron-test.js */
const {_electron}=require('playwright-core');
const path=require('path');
const ROOT=path.resolve(__dirname,'..');
const REC_SEC=+(process.env.REC_SEC||8);

(async()=>{
  const app=await _electron.launch({args:['main.js','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'],
    cwd:ROOT,executablePath:path.join(ROOT,'node_modules','electron','dist','electron.exe'),timeout:60000});
  const page=await app.firstWindow();
  const errors=[];
  page.on('pageerror',e=>errors.push('PAGEERROR: '+e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push('CONSOLE-ERR: '+m.text().slice(0,240));});
  page.on('crash',()=>errors.push('*** RENDERER CRASHED ***'));
  page.on('download',d=>{console.log('  [download]',d.suggestedFilename());d.cancel().catch(()=>{});});
  await page.waitForTimeout(1500);

  const alive=async tag=>{try{await page.evaluate(()=>1);console.log('  [alive]',tag);}
    catch(e){console.log('  *** DEAD at',tag);errors.push('DEAD@'+tag);}};
  const finfo=async(timeout)=>{try{
      await page.waitForFunction(()=>/✅|❌|已保存|失败|未录到|录音|录制完成/.test(document.getElementById('lab2Finfo').textContent),{timeout});
      console.log('  [finfo]',(await page.evaluate(()=>document.getElementById('lab2Finfo').textContent)).slice(0,130));}
    catch(_){const t=await page.evaluate(()=>document.getElementById('lab2Finfo').textContent).catch(()=>'页面已死');
      console.log('  [finfo 超时]',String(t).slice(0,130));}};

  await page.click('#lab2Btn');await page.waitForTimeout(400);await alive('打开二级台');

  console.log('STEP 真实录制 '+REC_SEC+'s（AudioWorklet→WAV）');
  await page.click('#lab2Rec');
  await page.waitForTimeout(REC_SEC*1000);
  await page.click('#lab2Rec');                 // 停止录制
  await finfo(30000);await alive('录制后');
  await page.waitForTimeout(800);
  console.log('  lab2Time=',await page.evaluate(()=>document.getElementById('lab2Time').textContent).catch(()=>'?'));

  if(!process.env.SKIP_SPEC){
    console.log('STEP 声谱图');await page.click('#lab2Spec');await finfo(120000);await alive('声谱图后');
    await page.click('#lab2Spec').catch(()=>{});}
  for(const [id,label] of [['l2pBg','背景分离'],['l2pDen','软件降噪'],['l2pVoc','人声提取']]){
    console.log('STEP',label);await page.click('#'+id);
    await page.waitForFunction(()=>!document.getElementById('l2pBg').classList.contains('busy')&&
      !document.getElementById('l2pVoc').classList.contains('busy'),{timeout:180000}).catch(()=>{});
    await finfo(180000);await alive(label+'后');
  }
  for(const f of ['raw','wav','mp3','aac','flac']){
    console.log('STEP 保存-'+f);await page.click('#lab2Exp');await page.waitForTimeout(500);
    const dis=await page.evaluate(f=>{const b=document.querySelector('.l2save-btn[data-f="'+f+'"]');return b?b.disabled:null;},f);
    if(dis){console.log('  (灰显,跳过)');await page.click('#l2SaveClose');continue;}
    await page.click('.l2save-btn[data-f="'+f+'"]');await finfo(180000);await alive('保存-'+f+'后');
  }
  console.log('\n===== 结果 =====');
  console.log(errors.length?errors.join('\n'):'无 JS 错误 / 无渲染进程崩溃');
  await app.close().catch(()=>{});
  process.exit(errors.some(e=>e.includes('CRASHED')||e.startsWith('DEAD@'))?3:0);
})().catch(e=>{console.error('脚本失败:',(e.message||e).split('\n')[0]);process.exit(1);});
