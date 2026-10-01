// 鸟鸣提示 P0 修复自测：抽取 index.html 中真实的生产函数，喂入 6 个合成信号的真实特征，
// 验证「疑似鸟鸣」提示对 5 个负样本不再泄漏、对合成鸟鸣仍命中。
const fs = require('fs');
const h = fs.readFileSync('index.html', 'utf8');
const script = h.match(/<script>([\s\S]*?)<\/script>/)[1];

// ---- 从生产脚本中按大括号配对抽取纯函数 / 常量（保证与生产代码一致）----
function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('未找到 ' + name);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('括号不匹配 ' + name);
}
function extractArrayConst(src, name) {
  const start = src.indexOf('const ' + name + '=');
  let i = src.indexOf('[', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '[') depth++;
    else if (src[i] === ']') { depth--; if (depth === 0) return src.slice(start, i + 2); }
  }
  throw new Error('括号不匹配 ' + name);
}

const code = [
  extractFn(script, 'clamp01'),
  extractFn(script, 'step'),
  extractFn(script, 'inBand'),
  extractFn(script, 'between'),
  extractFn(script, 'norm'),
  extractFn(script, 'shapeSim'),
  extractFn(script, 'inferOtherSource'),
  extractFn(script, 'classify'),
  extractArrayConst(script, 'OTHER_PROTO'),
].join('\n');

const mod = new Function(code + '\nreturn {clamp01,step,inBand,between,norm,shapeSim,inferOtherSource,classify,OTHER_PROTO};');
const P = mod();

// ---------- 轻量 FFT 特征管线（复刻 runAnalysis 的关键计算）----------
const SR = 48000, N = 2048;
const binHz = SR / N;
const DEFS = [[30,150],[150,400],[400,1000],[1000,2500],[2500,6000],[6000,16000]];

function fftReIm(re, im) { // 原地迭代 radix-2 FFT
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j) { [re[i],re[j]]=[re[j],re[i]]; [im[i],im[j]]=[im[j],im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2*Math.PI/len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len/2; k++) {
        const a = i+k, b = i+k+len/2;
        const tr = re[b]*cr - im[b]*ci, ti = re[b]*ci + im[b]*cr;
        re[b]=re[a]-tr; im[b]=im[a]-ti; re[a]+=tr; im[a]+=ti;
        const ncr = cr*wr - ci*wi; ci = cr*wi + ci*wr; cr = ncr;
      }
    }
  }
}
function magSpec(x) {
  const re = x.slice(), im = new Array(N).fill(0);
  // Hann 窗
  for (let i = 0; i < N; i++) re[i] *= 0.5 - 0.5*Math.cos(2*Math.PI*i/(N-1));
  fftReIm(re, im);
  const m = new Array(N/2);
  for (let i = 0; i < N/2; i++) m[i] = Math.hypot(re[i], im[i]);
  return m;
}
function bandMean(m, lo, hi) {
  const a = Math.max(0, Math.round(lo/binHz)), b = Math.min(N/2, Math.round(hi/binHz));
  let s = 0, c = 0; for (let i = a; i < b; i++) { s += m[i]; c++; } return c ? s/c : 0;
}
function bandPowerDensity(m, lo, hi) {
  const a = Math.max(0, Math.round(lo/binHz)), b = Math.min(N/2, Math.round(hi/binHz));
  let s = 0; for (let i = a; i < b; i++) s += m[i]*m[i];
  const bw = (hi-lo); return bw>0 ? s/bw : 0;
}
function buildFeatures(x0, x1) {
  const m0 = magSpec(x0), m1 = magSpec(x1);
  const be = DEFS.map(([lo,hi]) => bandMean(m0, lo, hi));
  const beLin = DEFS.map(([lo,hi]) => bandPowerDensity(m0, lo, hi));
  // flat：幅度谱的几何均值/算术均值
  let logS = 0, linS = 0, cnt = 0;
  for (let i = 1; i < N/2; i++) { const v = m0[i] > 1e-9 ? m0[i] : 1e-9; logS += Math.log(v); linS += v; cnt++; }
  const flat = linS>0 ? Math.exp(logS/cnt)/(linS/cnt) : 0;
  // centroid
  let sc = 0, sm = 0;
  for (let i = 1; i < N/2; i++) { const f = i*binHz; sc += f*m0[i]; sm += m0[i]; }
  const centroid = sm>0 ? sc/sm : 0;
  // flux (帧间正向差)
  let flux = 0; for (let i = 1; i < N/2; i++) { const d = m1[i]-m0[i]; if (d>0) flux += d; }
  // 峰值频率
  let pk = 1, pkv = -1; for (let i = 1; i < N/2; i++) if (m0[i] > pkv) { pkv = m0[i]; pk = i; }
  const pkF = pk*binHz;
  // tilt / hf / lf
  const beLinSum = beLin.reduce((a,b)=>a+b,0) || 1;
  const tilt = Math.max(-1, Math.min(1, ((beLin[4]+beLin[5])-(beLin[0]+beLin[1]))/beLinSum));
  const lf = beLin[0]+beLin[1], hf = beLin[4]+beLin[5];
  const beSum = be.reduce((a,b)=>a+b,0) || 1;
  const hfN = P.clamp01(((be[4]+be[5])/beSum)/0.5);
  // zcr / crest
  let zc = 0; for (let i = 1; i < N; i++) if ((x0[i-1]<0)!==(x0[i]<0)) zc++;
  zc /= N;
  let peak = 0, pow = 0; for (let i = 0; i < N; i++) { const v = Math.abs(x0[i]); if (v>peak) peak=v; pow += x0[i]*x0[i]; }
  const rms = Math.sqrt(pow/N) || 1e-9; const crest = peak/rms;
  const crestN = P.clamp01((crest-1.8)/4);
  // fluxN：稳态信号≈0、调制信号大
  const fluxN = P.clamp01(flux/ (sm*0.5 + 1e-6));
  // 自相关基频
  const pitch = detectPitch(x0);
  const isVoice = pitch>80 && pitch<400;
  const harmN = flat<0.6 ? 1-flat : 0.1;
  const eventN = P.clamp01(Math.min(1, flux/12000)*0.6 + crestN*0.4);
  const beMax = Math.max(...be), beMean = beSum/6;
  const bandPeakN = beMean>0 ? P.clamp01((beMax-beMean)/beMax) : 0;
  // spread / roll
  let sc2 = 0; for (let i = 1; i < N/2; i++) { const f=i*binHz-centroid; sc2 += f*f*m0[i]*m0[i]; }
  const spread = sm>0 ? Math.sqrt(sc2/sm) : 0;
  let acc = 0, tot = sm*0.85, roll = 0; for (let i = 1; i < N/2; i++) { acc += m0[i]; if (acc>=tot){roll=i*binHz;break;} }
  const zcrN = P.clamp01(zc*8);
  const spreadN = P.clamp01(spread/4000);
  const rollN = P.clamp01(roll/8000);
  const f0N = pitch>0 ? P.clamp01((pitch-80)/520) : 0;
  const domVoice = (pkF>250&&pkF<3200) ? (pitch>0?1:0.45) : 0.1;
  const music = Math.min(1, ((0>0&&pitch<0?1:0)+(pitch>0&&!isVoice?0.5:0)) + harmN*0.4);

  const F = { be:be.slice(), centroid:centroid, flat:Math.min(1,flat), rms:rms, crest:crest, pkF:pkF, db:0,
    f0:pitch, f0N:f0N, harmN:harmN, zcrN:zcrN, spreadN:spreadN, fluxN:fluxN, crestN:crestN,
    eventN:eventN, bandPeakN:bandPeakN, hfN:hfN, tilt:tilt, lfShare:(beLin[0]+beLin[1])/beLinSum,
    lf:lf, hf:hf, beLin:beLin, bpm:0 };
  const f = { flat:F.flat, centroidN:Math.min(1,centroid/8000), domVoice:domVoice, zcrN:zcrN, music:music,
    harmN:harmN, spreadN:spreadN, rollN:rollN, eventN:eventN, bandPeakN:bandPeakN, hfN:hfN };
  return {F, f};
}
function detectPitch(x) {
  const minLag = Math.floor(SR/400), maxLag = Math.floor(SR/70);
  let bestLag = -1, best = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0; for (let i = 0; i < N-lag; i++) s += x[i]*x[i+lag];
    s /= (N-lag);
    const norm = s; // 粗略
    if (norm > best) { best = norm; bestLag = lag; }
  }
  // 与零滞后相关比较
  let z = 0; for (let i = 0; i < N; i++) z += x[i]*x[i]; z /= N;
  if (best > 0.3*z && bestLag>0) return SR/bestLag;
  return -1;
}

// ---------- 6 个合成信号 ----------
function gen(name) {
  const x0 = new Array(N), x1 = new Array(N);
  const t = i => i/SR;
  if (name === 'white') {
    for (let i=0;i<N;i++){ x0[i]=Math.random()*2-1; x1[i]=Math.random()*2-1; }
  } else if (name === 'brown') {
    let y=0; for (let i=0;i<N;i++){ const w=Math.random()*2-1; y=(y+w)*0.98; x0[i]=y; }
    let y2=0; for (let i=0;i<N;i++){ const w=Math.random()*2-1; y2=(y2+w)*0.98; x1[i]=y2; }
    const mx=Math.max(...x0.map(Math.abs)); for (let i=0;i<N;i++){x0[i]/=mx;x1[i]/=mx;}
  } else if (name === 'rumble') {
    for (let i=0;i<N;i++){ x0[i]=0.6*Math.sin(2*Math.PI*60*t(i))+0.3*Math.sin(2*Math.PI*120*t(i)); }
    for (let i=0;i<N;i++){ x1[i]=0.6*Math.sin(2*Math.PI*60*t(i)+0.1)+0.3*Math.sin(2*Math.PI*120*t(i)+0.1); }
  } else if (name === 'sawtooth') {
    for (let i=0;i<N;i++){ let s=0; for(let k=1;k<=20;k++) s+=Math.sin(2*Math.PI*200*k*t(i))/k; x0[i]=s; }
    for (let i=0;i<N;i++){ let s=0; for(let k=1;k<=20;k++) s+=Math.sin(2*Math.PI*200*k*t(i)+0.05)/k; x1[i]=s; }
    const mx=Math.max(...x0.map(Math.abs)); for (let i=0;i<N;i++){x0[i]/=mx;x1[i]/=mx;}
  } else if (name === 'vowel') {
    for (let i=0;i<N;i++){ x0[i]=Math.sin(2*Math.PI*150*t(i))+0.6*Math.sin(2*Math.PI*300*t(i))+0.4*Math.sin(2*Math.PI*450*t(i))+0.25*Math.sin(2*Math.PI*600*t(i)); }
    for (let i=0;i<N;i++){ x1[i]=Math.sin(2*Math.PI*150*t(i)+0.05)+0.6*Math.sin(2*Math.PI*300*t(i)+0.05)+0.4*Math.sin(2*Math.PI*450*t(i)+0.05)+0.25*Math.sin(2*Math.PI*600*t(i)+0.05); }
  } else if (name === 'bird') {
    // 3Hz 调幅的 2–5kHz 扫频啁啾（非谐波、高通量）
    for (let i=0;i<N;i++){ const env=0.5+0.5*Math.sin(2*Math.PI*3*t(i)); const f0=2000+1500*Math.sin(2*Math.PI*3*t(i)); x0[i]=env*Math.sin(2*Math.PI*f0*t(i)); }
    for (let i=0;i<N;i++){ const env=0.5+0.5*Math.sin(2*Math.PI*3*t(i)+0.1); const f0=2000+1500*Math.sin(2*Math.PI*3*t(i)+0.1); x1[i]=env*Math.sin(2*Math.PI*f0*t(i)); }
    const mx=Math.max(...x0.map(Math.abs)); for (let i=0;i<N;i++){x0[i]/=mx;x1[i]/=mx;}
  }
  return {x0, x1};
}

console.log('信号           birdMax  unstructured  isBirdTop  提示结果            c.other  c.noise');
for (const name of ['white','brown','rumble','sawtooth','vowel','bird']) {
  const {x0,x1} = gen(name);
  const {F,f} = buildFeatures(x0, x1);
  const os = P.inferOtherSource(F);
  let birdMax = 0; for (const p of os.all) if (p.g.indexOf('动物·鸟类')===0 && p.s>birdMax) birdMax=p.s;
  const unstructured = (F.flat>0.5 && Math.abs(F.tilt)<0.15);
  const isBirdTop = os.best && os.best.g.indexOf('动物·鸟类')===0;
  const hint = (birdMax>=0.30 && !isBirdTop && !unstructured) ? '疑似鸟鸣' : (isBirdTop?'已并入最佳猜测':'—');
  const c = P.classify(f);
  console.log(
    name.padEnd(13),
    (birdMax*100).toFixed(1).padStart(6)+'%',
    String(unstructured).padStart(12),
    String(isBirdTop).padStart(10),
    '  '+hint.padEnd(16),
    c.other.toFixed(3).padStart(6), c.noise.toFixed(3).padStart(7),
    '  hf/(hf+lf)=' + (F.hf/(F.hf+F.lf)).toFixed(3) + ' fluxN=' + F.fluxN.toFixed(2)
  );
}
