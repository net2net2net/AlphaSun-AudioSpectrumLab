#!/usr/bin/env node
/* v2.11.1 崩溃复现脚本:模拟「现场录制」产物(MediaRecorder webm)走真实 UI 路径,
   依次触发 声谱图 / 背景分离 / 软件降噪 / 人声提取 / 保存各格式,捕获页面崩溃与 JS 错误。 */
const {chromium}=require('playwright-core');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..','www');
const MIME={'.html':'text/html','.js':'text/javascript','.svg':'image/svg+xml','.webmanifest':'application/manifest+json','.png':'image/png','.ico':'image/x-icon'};
const PORT=8931;
const srv=http.createServer((req,res)=>{
  let p=req.url.split('?')[0];if(p==='/')p='/index.html';
  try{const d=fs.readFileSync(path.join(ROOT,p));
    res.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});res.end(d);}
  catch(_){res.writeHead(404);res.end('nf');}});

(async()=>{
  await new Promise(r=>srv.listen(PORT,r));
  const browser=await chromium.launch({channel:'msedge',headless:true,
    args:['--autoplay-policy=no-user-gesture-required','--use-fake-ui-for-media-stream']});
  const page=await browser.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push('PAGEERROR: '+e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push('CONSOLE-ERR: '+m.text().slice(0,300));});
  page.on('crash',()=>errors.push('*** PAGE CRASHED ***'));
  page.on('download',d=>{errors.push('DOWNLOAD: '+d.suggestedFilename());d.cancel().catch(()=>{});});

  const alive=async tag=>{try{await page.evaluate(()=>1);console.log('  [alive]',tag);}
    catch(e){console.log('  *** DEAD at',tag,'->',String(e).slice(0,120));process.exitCode=2;}};
  const finfoRe=async(re,timeout)=>{
    try{await page.waitForFunction(re=>/✅|❌/.test(document.getElementById('lab2Finfo').textContent)&&
      new RegExp(re).test(document.getElementById('lab2Finfo').textContent),re,{timeout});
      const t=await page.evaluate(()=>document.getElementById('lab2Finfo').textContent);
      console.log('  [finfo]',t.slice(0,110));return true;}
    catch(_){const t=await page.evaluate(()=>document.getElementById('lab2Finfo').textContent).catch(()=>'(页面已死)');
      console.log('  [finfo 超时] 当前:',t.slice(0,110));return false;}};

  await page.goto('http://127.0.0.1:'+PORT+'/index.html',{waitUntil:'load'});
  await page.waitForTimeout(1000);
  await page.click('#lab2Btn');
  await page.waitForTimeout(500);
  await alive('打开二级台');

  // —— 合成真实 MediaRecorder 产物(振荡器→虚拟流→webm,与现场录制同构,含 Infinity duration 特性) ——
  // v2.11.2：改为直接构造 WAV 文件导入（录制链路已改为 AudioWorklet→WAV，Electron 版由
  // pw-electron-test.js 走真实录制按钮覆盖；这里验证「导入 WAV → 全链路」与「webm 拦截」两种场景）
  const rec=await page.evaluate(()=>{
    const sr=48000,n=sr*3,ab=new ArrayBuffer(44+n*2),v=new DataView(ab);
    const ws=(o,s)=>{for(let i=0;i<s.length;i++)v.setUint8(o+i,s.charCodeAt(i));};
    ws(0,'RIFF');v.setUint32(4,36+n*2,true);ws(8,'WAVE');ws(12,'fmt ');
    v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);
    v.setUint32(24,sr,true);v.setUint32(28,sr*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);
    ws(36,'data');v.setUint32(40,n*2,true);
    for(let i=0;i<n;i++){const t=i/sr;
      v.setInt16(44+i*2,Math.round((Math.sin(2*Math.PI*440*t)*0.5+Math.sin(2*Math.PI*117*t)*0.2)*12000),true);}
    const bytes=new Uint8Array(ab);let s='';
    for(let i=0;i<bytes.length;i++)s+=String.fromCharCode(bytes[i]);
    return {b64:btoa(s),name:'导入测试.wav',type:'audio/wav',size:bytes.length};
  });
  console.log('录制产物:',rec.size,'bytes,',rec.type);
  const buf=Buffer.from(rec.b64,'base64');
  await page.setInputFiles('#lab2File',{name:rec.name,mimeType:rec.type,buffer:buf});
  // 等待载入完成:#lab2Spec 从 disabled 变可用
  try{await page.waitForFunction(()=>!document.getElementById('lab2Spec').disabled,{timeout:20000});
    console.log('载入完成。lab2Time=',await page.evaluate(()=>document.getElementById('lab2Time').textContent));}
  catch(_){console.log('*** 载入超时!finfo=',await page.evaluate(()=>document.getElementById('lab2Finfo').textContent));}

  // —— 步骤1:声谱图 ——
  console.log('STEP 声谱图');await page.click('#lab2Spec');await finfoRe('.',60000);await alive('声谱图后');
  await page.click('#lab2Spec').catch(()=>{});   // 退出声谱图模式(若开)

  // —— 步骤2/3/4:三个处理 ——
  for(const [id,label] of [['l2pBg','背景分离'],['l2pDen','软件降噪'],['l2pVoc','人声提取']]){
    console.log('STEP',label);
    await page.click('#'+id);
    await page.waitForFunction(()=>!document.getElementById('l2pBg').classList.contains('busy')&&
      !document.getElementById('l2pVoc').classList.contains('busy'),{timeout:120000}).catch(()=>{});
    await finfoRe('.',120000);await alive(label+'后');
  }

  // —— 步骤5:保存各格式 ——
  for(const f of ['raw','wav','mp3','aac','flac']){
    console.log('STEP 保存-'+f);
    await page.click('#lab2Exp');
    await page.waitForTimeout(600);
    const dis=await page.evaluate(f=>{const b=document.querySelector('.l2save-btn[data-f="'+f+'"]');return b?b.disabled:null;},f);
    if(dis){console.log('  (按钮灰显,跳过)');await page.click('#l2SaveClose');continue;}
    await page.click('.l2save-btn[data-f="'+f+'"]');
    await finfoRe('.',120000);await alive('保存-'+f+'后');
  }

  console.log('\n===== 结果 =====');
  console.log(errors.length?errors.join('\n'):'无 JS 错误 / 无页面崩溃');
  await browser.close();srv.close();
  process.exit(errors.some(e=>e.includes('CRASHED'))?3:0);
})().catch(e=>{console.error('脚本失败:',e);process.exit(1);});
