#!/usr/bin/env node
/**
 * env-report-selftest.js — 环境评估报告算法自检
 *
 * 关键设计：**不复制一份实现**，而是从 index.html 里**抽取真实函数源码**执行。
 * 这样测的就是线上跑的那份代码，不会出现「测试版与产品版漂移」。
 *
 * 断言：
 *   1. 统计声级：L90 ≤ L50 ≤ L10，Leq 为能量平均（必 ≥ 算术平均）
 *   2. 频段占比合计 100%
 *   3. 舒适度分级边界（GB 3096-2008 刻度）
 *   4. 声源推断：风 / 水 / 设备 / 人声 的触发条件
 *   5. 报告文本包含六段结构与合规声明
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

/** 从源码中按函数名抽取完整函数定义（大括号配对） */
function extractFn(src, name) {
  const head = src.indexOf('\nfunction ' + name + '(');
  if (head < 0) throw new Error('未找到函数: ' + name);
  let i = src.indexOf('{', head);
  let depth = 0, j = i;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  return src.slice(head + 1, j);
}

const NAMES = ['envAW', 'envStats', 'envComfort', 'envSources', 'envAdvice', 'envReportText', 'envPlaceVal', 'envSafeName', 'envStamp'];
const consts = `
const ENV_ST={dbA:[],band:new Float64Array(7),n:0,t0:Date.now()-60000,sr:48000,samples:0};
const ENV_BANDS=[[20,60],[60,250],[250,500],[500,2000],[2000,4000],[4000,8000],[8000,16000]];
const ENV_BAND_NM=['次低频 20-60Hz','低频 60-250Hz','中低频 250-500Hz','中频 500Hz-2kHz','中高频 2-4kHz','高频 4-8kHz','甚高频 8-16kHz'];
let __MOCK={envCalib:{value:'0'},envPlace:{value:'北海某机房'}};
const $=id=>__MOCK[id]||{value:'0'};
const toast=()=>{};
`;
const src = consts + NAMES.map(n => extractFn(html, n)).join('\n\n') + '\n;module.exports={ENV_ST,$,setMock:(k,v)=>{__MOCK[k]=v;},envAW,envStats,envComfort,envSources,envAdvice,envReportText,envPlaceVal,envSafeName,envStamp};';

const M = { exports: {} };
new Function('module', src)(M);
const A = M.exports;

let pass = 0, fail = 0;
function chk(name, ok, extra) {
  if (ok) { pass++; console.log('  ✓ ' + name + (extra ? '  — ' + extra : '')); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  — ' + extra : '')); }
}

function feed(dbList, bandArr) {
  A.ENV_ST.dbA = dbList.slice();
  A.ENV_ST.band = new Float64Array(bandArr);
  A.ENV_ST.n = dbList.length;
}

console.log('\n[环境评估报告算法自检]  —— 函数源码直接取自 index.html\n');

console.log('[1] 统计声级 Leq / L10 / L50 / L90');
feed([40, 50, 60, 70, 80], [1, 1, 1, 1, 1, 1, 1]);
let st = A.envStats();
const arith = (40 + 50 + 60 + 70 + 80) / 5;
chk('L90 ≤ L50 ≤ L10', st.l90 <= st.l50 && st.l50 <= st.l10,
  'L90=' + st.l90.toFixed(1) + ' L50=' + st.l50.toFixed(1) + ' L10=' + st.l10.toFixed(1));
chk('Leq 为能量平均（≥ 算术平均）', st.leq >= arith,
  'Leq=' + st.leq.toFixed(2) + ' 算术=' + arith.toFixed(2));
chk('Lmax / Lmin 正确', st.lmax === 80 && st.lmin === 40, 'Lmax=' + st.lmax + ' Lmin=' + st.lmin);
chk('起伏度 = L10 - L90', Math.abs(st.fluct - (st.l10 - st.l90)) < 1e-9, 'fluct=' + st.fluct.toFixed(1));

console.log('\n[2] 频段占比');
feed([50, 50, 50], [10, 20, 30, 15, 10, 10, 5]);
st = A.envStats();
const sum = st.pct.reduce((a, b) => a + b, 0);
chk('七频段占比合计 = 100%', Math.abs(sum - 100) < 1e-6, sum.toFixed(4) + '%');
chk('最大占比段为第 3 段（30/100）', Math.abs(st.pct[2] - 30) < 1e-6, st.pct[2].toFixed(2) + '%');

console.log('\n[3] 舒适度分级边界（GB 3096-2008 刻度）');
const cases = [[44, 'A'], [54, 'B'], [64, 'C'], [74, 'D'], [80, 'E']];
for (const [v, lvl] of cases) {
  chk('Leq=' + v + ' → ' + lvl + ' 级', A.envComfort(v).lv.indexOf(lvl) === 0, A.envComfort(v).lv);
}
chk('每级都给出「不宜」建议', cases.every(c => (A.envComfort(c[0]).unfit || '').length > 0));

console.log('\n[4] 声源推断触发条件');
// 低频主导 + 起伏大 → 风
feed([40, 70], [30, 30, 10, 10, 8, 6, 6]);
st = A.envStats();
let s1 = A.envSources(st);
chk('低频主导 + 大起伏 → 风/气流', s1.some(x => x.nm.indexOf('风') >= 0),
  s1.map(x => x.nm + '(' + x.conf + ')').join(' | '));
// 高频主导 + 起伏小 → 水
feed([50, 51], [2, 3, 5, 10, 15, 30, 35]);
st = A.envStats();
let s2 = A.envSources(st);
chk('高频主导 + 小起伏 → 水声', s2.some(x => x.nm.indexOf('水') >= 0),
  s2.map(x => x.nm + '(' + x.conf + ')').join(' | '));
// 低频主导 + 起伏小 → 设备
feed([50, 51], [25, 25, 10, 10, 10, 10, 10]);
st = A.envStats();
let s3 = A.envSources(st);
chk('低频主导 + 小起伏 → 设备嗡鸣', s3.some(x => x.nm.indexOf('设备') >= 0),
  s3.map(x => x.nm + '(' + x.conf + ')').join(' | '));
// 中频主导 + 起伏 → 人声
feed([45, 65], [3, 5, 30, 30, 12, 10, 10]);
st = A.envStats();
let s4 = A.envSources(st);
chk('中频主导 + 起伏 → 人声活动', s4.some(x => x.nm.indexOf('人声') >= 0),
  s4.map(x => x.nm + '(' + x.conf + ')').join(' | '));
chk('推断结果按置信度降序', s1.every((x, i) => i === 0 || s1[i - 1].conf >= x.conf));

console.log('\n[5] 报告文本完整性');
feed([42, 48, 55, 61, 58], [20, 25, 15, 15, 10, 8, 7]);
const rep = A.envReportText();
chk('报告可生成', !!rep && rep.length > 500, (rep || '').length + ' 字符');
for (const sec of ['一、声级统计', '二、频段能量构成', '三、对人的舒适度评级', '四、声源构成推断', '五、治理与降噪建议', '六、重要声明']) {
  chk('含章节「' + sec + '」', rep.indexOf(sec) >= 0);
}
chk('含地点标注', rep.indexOf('北海某机房') >= 0);
chk('含未校准声明（不可作合规依据）', /未经声级计校准|不可作为合规判定/.test(rep));
chk('含 GB 3096 标准引用', rep.indexOf('GB 3096-2008') >= 0);
chk('降噪建议段至少 1 条', /五、治理与降噪建议[\s\S]*\n\s+1\./.test(rep));
// 专项：低频主导场景必须给出隔声/减振建议（阈值 40% 的边界场景也要命中）
feed([50, 52, 51], [22, 20, 12, 12, 12, 11, 11]);
const repLow = A.envReportText();
chk('低频主导场景给出「隔声/减振」建议', /减振|隔声/.test(repLow),
  /减振|隔声/.test(repLow) ? '已命中' : (repLow.match(/五、治理[\s\S]*/) || [''])[0].slice(0, 120));

console.log('\n[6] A 计权曲线（IEC 61672-1）');
chk('1kHz 处约 0 dB', Math.abs(A.envAW(1000) - 0) < 0.2, A.envAW(1000).toFixed(3) + ' dB');
chk('100Hz 处约 -19 dB', Math.abs(A.envAW(100) + 19.1) < 1.0, A.envAW(100).toFixed(2) + ' dB');
chk('低频衰减（20Hz < 100Hz）', A.envAW(20) < A.envAW(100), A.envAW(20).toFixed(1) + ' < ' + A.envAW(100).toFixed(1));

console.log('\n========================================');
console.log('环境报告算法自检：' + pass + ' 通过 / ' + fail + ' 失败 / 共 ' + (pass + fail));
console.log('========================================\n');
process.exit(fail ? 1 : 0);
