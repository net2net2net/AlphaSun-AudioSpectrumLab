// GCC-PHAT + 双曲线交汇定位算法正确性测试（从 index.html 抽取纯函数后验证）
// 场景：虚拟 3 麦三角阵（间距 d），声源位于已知 (x,y)，按几何声学合成各麦信号
//（含分数延迟 + 轻微噪声），经 gccPhat 求 TDOA → locateSource 网格交汇，应复原声源位置。
const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const js = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter(m => !/\bsrc\s*=/.test(m[1])).map(m => m[2]).join('\n');

function grab(name) {
  const i = js.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('未找到 ' + name);
  let d = 0, j = js.indexOf('{', i);
  for (let k = j; k < js.length; k++) {
    if (js[k] === '{') d++;
    else if (js[k] === '}') { d--; if (!d) { return js.slice(i, k + 1); } }
  }
}
const SND_C = 343;
const code = grab('fftRadix2') + '\n' + grab('gccPhat') + '\n' + grab('locateSource') + '\n' + grab('arrayPositions');
eval(code);

const SR = 48000, N = 2048, D = 2.0;   // 孔径 2m：测距曲项 d²/(2cr²) 才足够约束距离
const mics = arrayPositions(3, D);
console.log('阵列:', JSON.stringify(mics));
let pass = 0, total = 0;
// 物理容差：TDOA 噪声 ~5µs（亚样本插值），经孔径几何映射后距离误差 ~0.3m 量级
for (const [sx, sy] of [[1.6, 2.2], [-2.0, 3.0], [0.4, 1.0], [3.0, 1.5], [-1.2, 2.5]]) {
  total++;
  const r0 = Math.hypot(sx - mics[0].x, sy - mics[0].y);
  // 源信号：宽带线性扫频（300→3500Hz）+ 噪声 —— GCC-PHAT 白化对宽带信号最优，
  // 窄带纯音会使归一化互相关出现大量近似等高峰（周期性假峰），这是算法的已知边界。
  const src = new Float64Array(N);
  let ph = 0;
  for (let i = 0; i < N; i++) {
    const f = 300 + (3500 - 300) * i / N;
    ph += 2 * Math.PI * f / SR;
    src[i] = Math.sin(ph) * 0.8 + (Math.random() - 0.5) * 0.15;
  }
  // 合成各麦克风信号（分数延迟 + 噪声）
  const wins = mics.map(m => {
    const rm = Math.hypot(sx - m.x, sy - m.y);
    const dly = (rm - r0) / SND_C * SR;
    const a = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const s = i - dly, i0 = Math.floor(s), fr = s - i0;
      let v = 0;
      if (i0 >= 0 && i0 + 1 < N) v = src[i0] + (src[i0 + 1] - src[i0]) * fr;
      a[i] = v + (Math.random() - 0.5) * 0.01;
    }
    return a;
  });
  const tds = [];
  for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) {
    const g = gccPhat(wins[a], wins[b], N);
    // 与 index.html gccTick 相同的符号约定：IFFT(X·conj(Y)) 峰 L = −τ_ab·fs
    tds.push({ a, b, tau: -g.lag / SR });
  }
  const res = locateSource(tds, mics, SR);
  const err = Math.hypot(res.x - sx, res.y - sy);
  const trueDist = Math.hypot(sx, sy);
  const dErr = Math.abs(res.dist - trueDist);
  // 方位角误差（度）：bearing 由 TDOA 直接约束，应达 1° 级
  const azT = Math.atan2(sx, sy) * 180 / Math.PI;
  let azE = Math.abs(res.az - azT); if (azE > 180) azE = 360 - azE;
  const ok = err < 0.5 && dErr < 0.5 && azE < 3;
  if (ok) pass++;
  console.log(`源(${sx},${sy}) → 估(${res.x.toFixed(2)},${res.y.toFixed(2)}) 位置误差 ${err.toFixed(3)}m · 距离 ${res.dist.toFixed(2)}m(真${trueDist.toFixed(2)}) · 方位误差 ${azE.toFixed(2)}° · 质量 ${(res.conf * 100).toFixed(0)}% ${ok ? '✓' : '✗'}`);
  // TDOA 物理一致性：τ 与几何时差对照
  for (const t of tds) {
    const geo = (Math.hypot(sx - mics[t.b].x, sy - mics[t.b].y) - Math.hypot(sx - mics[t.a].x, sy - mics[t.a].y)) / SND_C;
    if (Math.abs(geo - t.tau) > 1 / SR) console.log(`  ⚠ TDOA 对(${t.a},${t.b}) 偏差 ${(Math.abs(geo - t.tau) * 1e6).toFixed(1)}µs`);
  }
}
console.log(`\n${pass}/${total} 通过`);
process.exit(pass === total ? 0 : 1);
