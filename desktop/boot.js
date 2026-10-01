// AlphaSun 声波分析仪 · 桌面版专属运行层（v2.0.0 稳定性架构）
// 仅在 Electron 环境激活；网页版/移动端自动惰性跳过（navigator.userAgent 无 Electron 标识）
// 职责：启动自检（关键 DOM 审计 / 能力审计 / 系统桥检查）+ 环境报告，把"运行时 TypeError"
// 这类问题在启动阶段就暴露为明确清单，而不是事后被误报成麦克风故障。
(() => {
  if (!/Electron/i.test(navigator.userAgent)) return; // 非 Electron 环境立即退出
  'use strict';

  const problems = [];

  // ---- 1. 关键 DOM 审计（采集/显示/分类/系统监视四链路的命脉元素）----
  const NEED = [
    'cv', 'capBtn', 'capTxt', 'status', 'sens', 'sensVal',          // 采集控制
    'levelFill', 'dbBig', 'verTxt', 'verDot', 'bpmBig',             // 主视图叠加
    'verdictTxt', 'vdot', 'cVoiceV', 'cMusicV', 'cOtherV', 'cNoiseV', // 智能分类
    'chipEngine', 'srate', 'vizName', 'vizPrev', 'vizNext', 'vizSub', // 引擎/视图
    'cpuV', 'memV', 'micV', 'micLamp', 'micSel',                    // 系统监视/输入
    'voiceStateV', 'voiceKindV', 'asrV', 'acts', 'histCount',       // 人声/日志/缓存
    'lab2Btn'                                                        // 二级分析入口
  ];
  for (const id of NEED) if (!document.getElementById(id)) problems.push('缺少关键元素 #' + id);

  // ---- 2. 能力审计----
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
    problems.push('getUserMedia 不可用（麦克风采集将失败）');
  if (!(window.AudioContext || window.webkitAudioContext))
    problems.push('AudioContext 不可用（音频分析将失败）');

  // ---- 3. 系统监视桥审计（CPU/内存真实值依赖 preload.js 暴露的 asSys）----
  const hasBridge = window.asSys && typeof window.asSys.sample === 'function';
  if (!hasBridge) problems.push('系统监视桥 asSys 未加载 → 顶栏 CPU/内存将显示「桥失效」（preload.js 缺失或加载失败）');

  // ---- 4. 自检报告：控制台详版 + 状态栏简版 ----
  const head = '%c[AlphaSun Desktop 自检]';
  if (problems.length) {
    console.groupCollapsed(head, 'color:#ff5d6e;font-weight:bold');
    console.log('发现 ' + problems.length + ' 项问题：');
    problems.forEach(p => console.log('  ✗ ' + p));
    console.groupEnd();
    const st = document.getElementById('status');
    if (st) { st.className = 'err'; st.textContent = '⚠️ 桌面自检未通过：' + problems[0] + (problems.length > 1 ? '（共 ' + problems.length + ' 项，详见控制台）' : ''); }
  } else {
    console.log(head + ' 全部通过 ✓', 'color:#3ce8a0;font-weight:bold');
    console.log('  · DOM 命脉元素 ' + NEED.length + '/' + NEED.length + ' 就位');
    console.log('  · 麦克风采集能力 ' + (navigator.mediaDevices ? '可用' : '不可用'));
    console.log('  · 系统监视桥 ' + (hasBridge ? '在线（CPU/内存将显示真实值）' : '离线'));
  }
})();
