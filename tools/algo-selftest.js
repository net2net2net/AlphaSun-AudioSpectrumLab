#!/usr/bin/env node
/* AlphaSun 算法自检（纯 Node，不依赖浏览器）—— 从 index.html **源码真身**抽取算法函数并验算，
   避免手抄副本与实现漂移（抄一份来测 = 测的不是线上代码）。
   覆盖：① A/C 计权曲线是否贴合 IEC 61672-1 标称值；② 计权能量域合成；③ 节拍估计 BPM。
   运行：node tools/algo-selftest.js   （退出码 0 = 全通过） */
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// —— 从起始标记做「花括号配平」截取（比正则/缩进判断可靠：函数结束行常写成 `  }}` 而非顶格 `}`） ——
function grab(sig) {
  const s = html.indexOf(sig);
  if (s < 0) return null;
  let depth = 0;
  for (let i = s; i < html.length; i++) {
    const c = html[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return html.slice(s, i + 1); }
  }
  return null;
}
let fail = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fail++; };

// ---------- 1. A/C 计权曲线 ----------
const srcW = grab('function l2WeightTab');
if (!srcW) { console.log('✗ 未抽到 l2WeightTab'); process.exit(1); }
let wTabA, wTabC, wTabKey = '';
eval(srcW);
// IEC 61672-1 标称计权值（dB）：A / C
const REF = { 31.5: [-39.4, -3.0], 63: [-26.2, -0.8], 100: [-19.1, -0.3], 250: [-8.6, 0.0], 500: [-3.2, 0.0], 1000: [0.0, 0.0], 2000: [1.2, -0.2], 4000: [1.0, -0.8], 8000: [-1.1, -3.0], 16000: [-6.6, -8.5] };
// 低频点用细表（8192 bin → 2.93Hz/格）验：1024bin 下 23.4Hz/格，31.5Hz 只能落在 bin1(23.4Hz)，
// 那是**取样量化误差**不是公式错误——自检不能把方法学局限误报成实现缺陷。
console.log('A/C 计权曲线 vs IEC 61672-1 标称值（1024bin 表 · 高频段）：');
const SR = 48000, NB = 1024, BIN = SR / 2 / NB;
l2WeightTab(NB, BIN);
for (const f in REF) {
  if (+f < 250) continue;
  const i = Math.round(+f / BIN), [ra, rc] = REF[f];
  const A = 10 * Math.log10(wTabA[i]), C = 10 * Math.log10(wTabC[i]);
  ok(Math.abs(A - ra) < 0.6 && Math.abs(C - rc) < 0.6,
    `${String(f).padStart(6)}Hz  A=${A.toFixed(1)}(标${ra})  C=${C.toFixed(1)}(标${rc})`);
}
console.log('A/C 计权曲线 vs IEC 61672-1 标称值（8192bin 细表 · 低频段）：');
const NF = 8192, BINF = SR / 2 / NF;
l2WeightTab(NF, BINF);
for (const f in REF) {
  if (+f >= 250) continue;
  const i = Math.round(+f / BINF), [ra, rc] = REF[f];
  const A = 10 * Math.log10(wTabA[i]), C = 10 * Math.log10(wTabC[i]);
  ok(Math.abs(A - ra) < 0.8 && Math.abs(C - rc) < 0.8,
    `${String(f).padStart(6)}Hz  A=${A.toFixed(1)}(标${ra})  C=${C.toFixed(1)}(标${rc})   [实际取样 ${(i * BINF).toFixed(1)}Hz]`);
}
l2WeightTab(NB, BIN);   // 还原成业务用表，供下面的合成测试使用
// 计权合成：纯 100Hz 单音 → C 应比 A 高约 19dB；纯 1kHz → 两者应接近
function tone(f) { const a = new Float64Array(NB).fill(-200); const i = Math.round(f / BIN); if (i < NB) a[i] = 0; return a; }
function wc(arr) {
  let sa = 0, sc = 0, su = 0;
  for (let i = 0; i < NB; i++) { const e = Math.pow(10, arr[i] / 10); sa += e * wTabA[i]; sc += e * wTabC[i]; su += e; }
  return [10 * Math.log10(sa / su), 10 * Math.log10(sc / su)];
}
const [a100, c100] = wc(tone(100)), [a1k, c1k] = wc(tone(1000));
console.log('计权能量域合成：');
ok(Math.abs((c100 - a100) - 19.1) < 1.0, `纯 100Hz：C-A=${(c100 - a100).toFixed(1)}dB（期望≈19dB，低频被 A 计权压低）`);
ok(Math.abs(c1k - a1k) < 0.3, `纯 1kHz：C-A=${(c1k - a1k).toFixed(1)}dB（期望≈0dB，1kHz 为计权基准点）`);

// ---------- 2. 节拍估计 ----------
const srcB = grab('function estimateBPM');
if (!srcB) { console.log('✗ 未抽到 estimateBPM'); process.exit(1); }
eval(srcB);
console.log('节拍估计（60fps 包络，5s 窗口）：');
function synth(bpm, fps, sec) {
  const n = fps * sec, dt = 1000 / fps, e = [], period = 60000 / bpm;
  for (let i = 0; i < n; i++) { const ph = ((i * dt) % period) / period; e.push(Math.exp(-ph * 6) + 0.012 * Math.random()); }
  return { e, dt };
}
for (const bpm of [60, 75, 90, 100, 120, 140, 150, 180]) {
  const s = synth(bpm, 60, 5), got = estimateBPM(s.e, s.dt);
  ok(Math.abs(got - bpm) <= 6, `真实 ${String(bpm).padStart(3)}BPM → 估计 ${String(got).padStart(3)}BPM`);
}
const NONBEAT = [
  ['平稳噪声', Array.from({ length: 400 }, () => 0.3 + 0.02 * Math.random())],
  ['语音式连续起伏', Array.from({ length: 400 }, (v, i) => 0.05 + 0.25 * Math.abs(Math.sin(i * 0.37)) * (0.3 + 0.7 * Math.random()))],
  ['缓慢正弦起伏', Array.from({ length: 400 }, (v, i) => 0.1 + 0.2 * Math.abs(Math.sin(i * 0.06)) + 0.005 * Math.random())],
  ['白噪式抖动', Array.from({ length: 400 }, () => 0.2 + 0.15 * Math.random())]
];
console.log('非节拍信号（应拒绝 → 0）：');
for (const [nm, arr] of NONBEAT) { const g = estimateBPM(arr, 1000 / 60); ok(g === 0, `${nm} → ${g}BPM`); }

console.log(fail ? `\n✋ 算法自检 ${fail} 项未通过` : '\n★ 算法自检全部通过');
process.exit(fail ? 1 : 0);
