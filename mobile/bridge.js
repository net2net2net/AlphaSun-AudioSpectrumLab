// AlphaSun 声波分析仪 · 移动版专属运行层（v2.0.0 稳定性架构）
// 仅在 Capacitor 环境激活（window.Capacitor 存在）；网页版/桌面版自动惰性跳过
// 职责：App 生命周期 ↔ 采集引擎联动——退后台自动挂起采集、回前台自动恢复，
// 防止 Android/iOS 后台回收导致的 AudioContext 僵死、幽灵采样与电量空耗。
(() => {
  if (!window.Capacitor) return; // 非 Capacitor 环境立即退出
  'use strict';

  let suspendedByLifecycle = false;

  const suspend = why => {
    try {
      if (typeof window.__asPause === 'function') { window.__asPause('mobile:' + why); suspendedByLifecycle = true; }
    } catch (e) { console.warn('[AlphaSun Mobile] 挂起失败', e); }
  };
  const resume = why => {
    try {
      if (!suspendedByLifecycle) return; // 用户手动暂停的，不自动恢复
      if (typeof window.__asResume === 'function') { window.__asResume('mobile:' + why); suspendedByLifecycle = false; }
    } catch (e) { console.warn('[AlphaSun Mobile] 恢复失败', e); }
  };

  // Capacitor WebView 的可见性变化（覆盖绝大多数前后台切换）
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) suspend('hidden'); else resume('visible');
  });
  // Cordova 兼容事件（部分 Capacitor 版本/ROM 会派发）
  document.addEventListener('pause', () => suspend('pause'), false);
  document.addEventListener('resume', () => resume('resume'), false);
  // Capacitor App 插件（若安装了 @capacitor/app 则走原生级事件，优先级最高）
  try {
    const App = window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (App && typeof App.addListener === 'function') {
      App.addListener('appStateChange', s => { if (s.isActive) resume('appState'); else suspend('appState'); });
    }
  } catch (_) { /* 无 App 插件时静默降级到 visibilitychange */ }

  console.log('[AlphaSun Mobile] 生命周期桥已挂载 ✓（后台自动挂起 / 前台自动恢复）');
})();
