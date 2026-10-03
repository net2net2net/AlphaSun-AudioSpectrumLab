// AlphaSun 声波分析仪 · Electron 预加载桥（contextIsolation 安全暴露系统信息 + 云端转写）
// 仅暴露只读的 CPU/内存采样；浏览器/移动端没有 window.asSys，UI 自动降级显示 —
// 同理，window.asrCloud 仅在桌面端存在；纯浏览器打开 index.html 时云端大模型转写不可用，
// 前端必须据此降级并如实标注，不得假装可用。
const { contextBridge, ipcRenderer } = require('electron');
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

// 声波警戒值守桥：全屏切换、事件媒体落盘、告警通知推送（凭据只在主进程/本机配置里）
contextBridge.exposeInMainWorld('guard', {
  available: true,
  fullscreen: (on) => ipcRenderer.invoke('win:fullscreen', on),
  saveMedia: (args) => ipcRenderer.invoke('guard:saveMedia', args),
  listMedia: () => ipcRenderer.invoke('guard:listMedia'),
  notify: (args) => ipcRenderer.invoke('guard:notify', args),
});

// 云端转写桥：渲染进程只传 WAV(base64) 与语言，API Key 始终留在主进程。
contextBridge.exposeInMainWorld('asrCloud', {
  available: true,
  /** @param {{wavBase64:string, lang:'zh'|'yue'|'en'}} args */
  transcribe: (args) => ipcRenderer.invoke('asr:cloud', args),
  keyStatus: () => ipcRenderer.invoke('asr:keyStatus'),
  /** v2.24.0：云端连通性探测（不提交音频、不计费），用于 auto 模式可靠降级/升级 */
  ping: () => ipcRenderer.invoke('asr:ping'),
  setKey: (k) => ipcRenderer.invoke('asr:setKey', k),
  saveWav: (args) => ipcRenderer.invoke('asr:saveWav', args),
});
