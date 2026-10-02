// AlphaSun 声波分析仪 · Electron 主进程（v2.0.0 桌面稳定性架构）
// 职责：窗口管理 / 麦克风权限授权 / 系统信息桥加载 / 崩溃捕获与日志 / 单实例锁 / 云端语音转写代理
// ⚠ 时序红线：session 模块只能在 app ready 后访问；process.on 兜底必须在模块顶层注册（任何更早的崩溃都要能落日志）
const { app, BrowserWindow, session, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

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

/* ==========================================================================
   云端语音转写（阿里云 DashScope 非实时文件转写）
   --------------------------------------------------------------------------
   为什么必须由主进程代理：
     1) 浏览器直连 dashscope.aliyuncs.com 会被 CORS 拦截；
     2) API Key 若放在渲染进程，打包后可被任意提取，等于泄露；
     3) multipart 上传 OSS 需要 Node 侧的 FormData/Blob。
   渲染进程只传 WAV 二进制（base64），不接触 Key。
   模型 qwen-audio-3.0-asr-flash-filetrans 支持 language_hints: zh / yue / en。
   ⚠ 该模型是「非实时文件转写」：提交任务→轮询→取结果，做不到流式逐字。
      因此前端采取「分段录制 + 分段提交」的准实时策略。
   ========================================================================== */
const DASH_BASE = 'https://dashscope.aliyuncs.com';
const DASH_MODEL = 'qwen-audio-3.0-asr-flash-filetrans';
// 前端语言码 → DashScope language_hints
const DASH_LANG = { zh: 'zh', yue: 'yue', en: 'en' };
const DASH_POLL_MAX = 150;   // 最多轮询 150 次 × 2s = 5 分钟
const DASH_POLL_MS = 2000;

function dashCfgPath() {
  return path.join(app.getPath('userData'), 'asr-config.json');
}

/** 读取 API Key：环境变量 DASHSCOPE_API_KEY 优先，其次 userData/asr-config.json */
function dashKey() {
  const env = process.env.DASHSCOPE_API_KEY;
  if (env && String(env).trim()) return String(env).trim();
  try {
    const p = dashCfgPath();
    if (fs.existsSync(p)) {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (j && j.dashscopeApiKey && String(j.dashscopeApiKey).trim()) return String(j.dashscopeApiKey).trim();
    }
  } catch (_) {}
  return '';
}

function dashSaveKey(k) {
  const p = dashCfgPath();
  let j = {};
  try { if (fs.existsSync(p)) j = JSON.parse(fs.readFileSync(p, 'utf8')) || {}; } catch (_) { j = {}; }
  j.dashscopeApiKey = String(k || '').trim();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(j, null, 2), 'utf8');
  return true;
}

/** 步骤1：拿上传凭证 → 步骤2：POST 到 OSS，返回 oss:// key */
async function dashUpload(apiKey, filePath, model) {
  const r = await fetch(DASH_BASE + '/api/v1/uploads?action=getPolicy&model=' + encodeURIComponent(model), {
    headers: { Authorization: 'Bearer ' + apiKey },
  });
  if (!r.ok) throw new Error('获取上传凭证失败 HTTP ' + r.status + ': ' + (await r.text()).slice(0, 200));
  const policy = (await r.json()).data;
  const name = path.basename(filePath);
  const key = policy.upload_dir + '/' + name;
  const fd = new FormData();
  fd.append('OSSAccessKeyId', policy.oss_access_key_id);
  fd.append('policy', policy.policy);
  fd.append('signature', policy.signature);
  fd.append('key', key);
  fd.append('x-oss-object-acl', policy['x-oss-object-acl'] || 'private');
  fd.append('x-oss-forbid-overwrite', policy['x-oss-forbid-overwrite'] || 'true');
  fd.append('file', new Blob([fs.readFileSync(filePath)]), name);
  const up = await fetch(policy.upload_host, { method: 'POST', body: fd });
  if (up.status !== 200 && up.status !== 204) {
    throw new Error('音频上传失败 HTTP ' + up.status + ': ' + (await up.text()).slice(0, 200));
  }
  return 'oss://' + key;
}

/** 完整转写流程：上传 → 提交异步任务 → 轮询 → 取逐句结果 */
async function dashTranscribe({ wavBase64, lang, model }) {
  const apiKey = dashKey();
  if (!apiKey) {
    // 红线：缺 Key 必须明确报错，绝不静默返回空结果
    return { ok: false, error: 'NO_KEY', message: '未配置 DashScope API Key。请在转写面板「云端设置」中填入，或设置环境变量 DASHSCOPE_API_KEY。' };
  }
  const useModel = model || DASH_MODEL;
  const hint = DASH_LANG[lang] || 'zh';
  const tmp = path.join(os.tmpdir(), 'alphasun-asr-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.wav');
  try {
    fs.writeFileSync(tmp, Buffer.from(wavBase64, 'base64'));
    const fileUrl = await dashUpload(apiKey, tmp, useModel);

    const parameters = { language_hints: [hint] };
    const sub = await fetch(DASH_BASE + '/api/v1/services/audio/asr/transcription', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        'X-DashScope-Async': 'enable',
        'X-DashScope-OssResourceResolve': 'enable',
      },
      body: JSON.stringify({ model: useModel, input: { file_urls: [fileUrl] }, parameters }),
    });
    if (!sub.ok) throw new Error('提交转写任务失败 HTTP ' + sub.status + ': ' + (await sub.text()).slice(0, 300));
    // ⚠ Response body 只能消费一次：必须先取到对象再取字段，不能反复 await .json()
    const subJson = await sub.json();
    const tid = ((subJson && subJson.output) || {}).task_id;
    if (!tid) throw new Error('提交成功但未返回 task_id：' + JSON.stringify(subJson).slice(0, 200));

    let js = null;
    for (let i = 0; i < DASH_POLL_MAX; i++) {
      await new Promise(r => setTimeout(r, DASH_POLL_MS));
      const q = await fetch(DASH_BASE + '/api/v1/tasks/' + tid, { headers: { Authorization: 'Bearer ' + apiKey } });
      js = await q.json();
      const st = (js.output || {}).task_status;
      if (st === 'SUCCEEDED') break;
      if (st === 'FAILED' || st === 'UNKNOWN' || st === 'CANCELED') {
        throw new Error('转写任务失败(' + st + '): ' + JSON.stringify(js).slice(0, 300));
      }
    }

    const sentences = [];
    for (const item of ((js.output || {}).results || [])) {
      const out = item.output || item;
      let turl = out.transcription_url;
      if (!turl && out.results && out.results[0]) turl = out.results[0].transcription_url;
      let data = out;
      if (turl) {
        const g = await fetch(turl);
        data = await g.json();
      }
      for (const t of (data.transcripts || [])) {
        for (const s of (t.sentences || [])) {
          sentences.push({
            text: s.text || '',
            speaker_id: s.speaker_id || '',
            begin_time: s.begin_time || 0,
            end_time: s.end_time || 0,
          });
        }
        if (!(t.sentences || []).length && t.text) {
          sentences.push({ text: t.text, speaker_id: '', begin_time: 0, end_time: 0 });
        }
      }
    }
    const text = sentences.map(s => (s.speaker_id ? '[说话人' + s.speaker_id + '] ' : '') + s.text).join('\n');
    return { ok: true, text, sentences, model: useModel, lang: hint };
  } catch (e) {
    // 故障不重试同一任务（避免重复计费）；由上层决定是否重录重提
    crashLog('asr-cloud', (e && e.message) || String(e));
    return { ok: false, error: 'CALL_FAILED', message: (e && e.message) || String(e) };
  } finally {
    try { fs.unlinkSync(tmp); } catch (_) {}
  }
}

// ---- IPC：云端转写 / Key 状态 / Key 设置 ----
ipcMain.handle('asr:cloud', async (_e, args) => {
  return await dashTranscribe(args || {});
});
ipcMain.handle('asr:keyStatus', async () => {
  const k = dashKey();
  return { hasKey: !!k, source: process.env.DASHSCOPE_API_KEY ? 'env' : (k ? 'file' : 'none') };
});
ipcMain.handle('asr:setKey', async (_e, k) => {
  try { dashSaveKey(k); return { ok: true }; }
  catch (e) { return { ok: false, message: (e && e.message) || String(e) }; }
});
ipcMain.handle('asr:saveWav', async (_e, { name, wavBase64 }) => {
  // 保存原始录音到用户下载目录（桌面端才有意义）
  try {
    const dir = app.getPath('downloads');
    const p = path.join(dir, name || ('alphasun_rec_' + Date.now() + '.wav'));
    fs.writeFileSync(p, Buffer.from(wavBase64, 'base64'));
    return { ok: true, path: p };
  } catch (e) {
    return { ok: false, message: (e && e.message) || String(e) };
  }
});

/* ==========================================================================
   声波警戒值守：全屏 / 事件媒体保存 / 告警通知推送
   ========================================================================== */
const crypto = require('crypto');

/** 进入/退出全屏（值守台全屏模式）。浏览器版无此 IPC，前端降级用 requestFullscreen。 */
ipcMain.handle('win:fullscreen', async (_e, on) => {
  try {
    if (!win) return { ok: false, message: '窗口未创建' };
    win.setFullScreen(!!on);
    return { ok: true, fullScreen: win.isFullScreen() };
  } catch (e) {
    return { ok: false, message: (e && e.message) || String(e) };
  }
});

/** 保存事件媒体（音频 wav / 图像 jpg / 视频 webm）到 下载目录/AlphaSun警戒事件/<子目录> */
ipcMain.handle('guard:saveMedia', async (_e, { name, b64, subdir }) => {
  try {
    const base = path.join(app.getPath('downloads'), 'AlphaSun警戒事件');
    const dir = subdir ? path.join(base, String(subdir).replace(/[\\/:*?"<>|]+/g, '_')) : base;
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, String(name || ('media_' + Date.now())).replace(/[\\/:*?"<>|]+/g, '_'));
    fs.writeFileSync(p, Buffer.from(String(b64 || ''), 'base64'));
    return { ok: true, path: p };
  } catch (e) {
    crashLog('guard-saveMedia', (e && e.message) || String(e));
    return { ok: false, message: (e && e.message) || String(e) };
  }
});

/** 列出已保存的事件媒体目录（供界面回看） */
ipcMain.handle('guard:listMedia', async () => {
  try {
    const base = path.join(app.getPath('downloads'), 'AlphaSun警戒事件');
    if (!fs.existsSync(base)) return { ok: true, dir: base, items: [] };
    const items = fs.readdirSync(base, { withFileTypes: true }).map(d => ({
      name: d.name, isDir: d.isDirectory(),
      size: d.isDirectory() ? 0 : fs.statSync(path.join(base, d.name)).size,
    }));
    return { ok: true, dir: base, items };
  } catch (e) {
    return { ok: false, message: (e && e.message) || String(e) };
  }
});

/**
 * 告警通知推送。
 * 支持通道：wecom(企业微信群机器人) / dingtalk(钉钉) / feishu(飞书) / serverchan(Server酱→微信)
 *           / webhook(自定义 POST JSON) / sms_aliyun(阿里云短信)
 * ⚠ 各通道均需用户自备凭据，本环境无法真机验证；发送失败一律返回明确错误，不静默吞掉。
 */
async function notifyDispatch(ch, cfg, title, body) {
  if (ch === 'wecom' || ch === 'dingtalk' || ch === 'feishu' || ch === 'webhook') {
    const url = cfg.url;
    if (!url) return { ok: false, message: '未配置 Webhook 地址' };
    let payload;
    if (ch === 'wecom') payload = { msgtype: 'text', text: { content: title + '\n' + body } };
    else if (ch === 'feishu') payload = { msg_type: 'text', content: { text: title + '\n' + body } };
    else if (ch === 'dingtalk') payload = { msgtype: 'text', text: { content: title + '\n' + body } };
    else payload = { title: title, body: body, text: title + '\n' + body, level: cfg.level || 'alarm' };
    const r = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const txt = await r.text();
    return { ok: r.ok, status: r.status, resp: txt.slice(0, 300) };
  }
  if (ch === 'serverchan') {
    if (!cfg.key) return { ok: false, message: '未配置 Server酱 SendKey' };
    const u = 'https://sctapi.ftqq.com/' + encodeURIComponent(cfg.key) + '.send'
      + '?title=' + encodeURIComponent(title) + '&desp=' + encodeURIComponent(body);
    const r = await fetch(u);
    return { ok: r.ok, status: r.status, resp: (await r.text()).slice(0, 300) };
  }
  if (ch === 'sms_aliyun') {
    // 阿里云短信 OpenAPI（POP 签名：HMAC-SHA1 + SHA1 规范串）。未实测，需用户自备账号。
    const need = ['accessKeyId', 'accessKeySecret', 'signName', 'templateCode', 'phone'];
    const miss = need.filter(k => !cfg[k]);
    if (miss.length) return { ok: false, message: '短信配置缺失：' + miss.join(',') };
    const params = {
      AccessKeyId: cfg.accessKeyId, Action: 'SendSms', Format: 'JSON',
      PhoneNumbers: cfg.phone, RegionId: 'cn-hangzhou', SignName: cfg.signName,
      SignatureMethod: 'HMAC-SHA1', SignatureNonce: crypto.randomUUID(),
      SignatureVersion: '1.0', TemplateCode: cfg.templateCode,
      TemplateParam: JSON.stringify({ level: cfg.level || '告警', title: title.slice(0, 20), time: new Date().toLocaleString('zh-CN') }),
      Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), Version: '2017-05-25',
    };
    const sorted = Object.keys(params).sort();
    const canon = sorted.map(k => enc(k) + '=' + enc(params[k])).join('&');
    const strToSign = 'POST&%2F&' + enc(canon);
    const sign = crypto.createHmac('sha1', cfg.accessKeySecret + '&').update(strToSign).digest('base64');
    const bodyStr = sorted.map(k => enc(k) + '=' + enc(params[k])).join('&') + '&Signature=' + enc(sign);
    const r = await fetch('https://dysmsapi.aliyuncs.com/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: bodyStr,
    });
    return { ok: r.ok, status: r.status, resp: (await r.text()).slice(0, 400) };
  }
  return { ok: false, message: '未知通道：' + ch };
}
function enc(s) {
  return encodeURIComponent(String(s)).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

ipcMain.handle('guard:notify', async (_e, { channels, title, body }) => {
  const out = [];
  for (const c of (channels || [])) {
    if (!c || !c.type) continue;
    try {
      const r = await notifyDispatch(c.type, c, title, body);
      out.push({ type: c.type, ok: !!r.ok, message: r.message || ('HTTP ' + r.status), resp: r.resp });
    } catch (e) {
      out.push({ type: c.type, ok: false, message: (e && e.message) || String(e) });
    }
  }
  return { results: out };
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
