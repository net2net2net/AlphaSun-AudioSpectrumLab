// AlphaSun 声波分析仪 · Electron 预加载桥（contextIsolation 安全暴露系统信息）
// 仅暴露只读的 CPU/内存采样；浏览器/移动端没有 window.asSys，UI 自动降级显示 —
const { contextBridge } = require('electron');
const os = require('os');
let prev = os.cpus();
contextBridge.exposeInMainWorld('asSys', {
  sample() {
    try {
      const cur = os.cpus();
      let idle = 0, total = 0;
      for (let i = 0; i < cur.length && i < prev.length; i++) {
        const a = cur[i].times, b = prev[i].times;
        idle += a.idle - b.idle;
        total += (a.user - b.user) + (a.nice - b.nice) + (a.sys - b.sys) + (a.idle - b.idle) + (a.irq - b.irq);
      }
      prev = cur;
      const cpuPct = total > 0 ? Math.max(0, Math.min(100, Math.round((1 - idle / total) * 100))) : null;
      const memPct = Math.max(0, Math.min(100, Math.round((1 - os.freemem() / os.totalmem()) * 100)));
      return { cpuPct, memPct };
    } catch (e) { return { cpuPct: null, memPct: null }; }
  }
});
