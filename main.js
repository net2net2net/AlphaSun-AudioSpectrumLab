// AlphaSun 声波分析仪 · Electron 主进程（v2.0.0 桌面稳定性架构）
// 职责：窗口管理 / 麦克风权限授权 / 系统信息桥加载 / 崩溃捕获与日志 / 单实例锁
// ⚠ 时序红线：session 模块只能在 app ready 后访问；process.on 兜底必须在模块顶层注册（任何更早的崩溃都要能落日志）
const { app, BrowserWindow, session, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// ---- 单实例锁：防止多开抢占麦克风设备 ----
if (!app.requestSingleInstanceLock()) app.quit();

// ---- 主进程异常兜底（顶层注册：覆盖 app ready 之前的早期崩溃）----
process.on('uncaughtException', err => crashLog('main-uncaughtException', (err && err.stack) || String(err)));
process.on('unhandledRejection', r => crashLog('main-unhandledRejection', (r && r.stack) || String(r)));

// ---- 崩溃/诊断日志：写入 userData/logs/desktop-crash.log，桌面排障关键链路 ----
function crashLog(kind, detail) {
  const line = '[' + new Date().toISOString() + '] ' + kind + ': ' + detail + '\n';
  console.error(line.trim());
  try {
    const d = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(d, { recursive: true });
    fs.appendFileSync(path.join(d, 'desktop-crash.log'), line);
  } catch (_) {}
}

let win = null;
function createWindow() {
  win = new BrowserWindow({
    width: 1366, height: 860, minWidth: 820, minHeight: 600,
    backgroundColor: '#04060d',
    title: 'AlphaSun 声波分析仪',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false, preload: path.join(__dirname, 'preload.js') }
    // sandbox:false：Electron 20+ 渲染进程默认沙箱化，沙箱内 preload 禁止 require Node 内置模块（如 os），
    // 导致 asSys 桥加载失败（module not found: os）→ 顶栏 CPU/内存永远无值。关沙箱保留 contextIsolation。
  });
  win.loadFile(path.join(__dirname, 'index.html'));

  // ---- 麦克风权限自动授权（app ready 后才可访问 session；file:// 在 Electron 中视为安全上下文）----
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    if (permission === 'media' || permission === 'microphone' || permission === 'audio') callback(true);
    else callback(false);
  });

  // 渲染进程崩溃 → 日志 + 可视恢复入口（不再无声消失）
  win.webContents.on('render-process-gone', (_e, details) => {
    crashLog('render-process-gone', JSON.stringify(details));
    dialog.showMessageBox(win, {
      type: 'error', title: '渲染进程异常退出',
      message: '分析界面进程异常退出（' + details.reason + '）',
      detail: '崩溃详情已写入日志文件。点击「重载界面」恢复。',
      buttons: ['重载界面', '退出']
    }).then(r => { if (r.response === 0 && win) win.webContents.reload(); else app.quit(); });
  });
  // 渲染层 console 错误转发到主进程日志
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 3) crashLog('renderer-console', (sourceId || '').split(/[\\/]/).pop() + ':' + line + ' ' + message);
  });
  win.webContents.on('unresponsive', () => crashLog('renderer-unresponsive', 'UI 线程无响应'));
  win.webContents.on('responsive', () => crashLog('renderer-responsive', 'UI 线程恢复'));
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    if (code !== -3) crashLog('did-fail-load', code + ' ' + desc + ' ' + url); // -3=ABORTED 正常忽略
  });
  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
