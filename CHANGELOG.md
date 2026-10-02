# AlphaSun 声波分析仪 · 版本演进（CHANGELOG）

> 每轮迭代必须追加。版本五点同步（index APP_VER / appVer span / package.json / sw.js / gradle versionName）
> 由 `node tools/bump-version.js x.y.z` 统一完成（幂等 + 回读校验）。



## v2.16.0（2026-10-03）—— 环境音频采集：实时波形 / 地点+时间命名 / 多维度环境评估报告

### ① 采集时实时波形

- 面板新增波形画布（滚动显示最近约 19 秒）+ 实时电平 dBFS + 计时 mm:ss。
- 与转写面板共用同款滚动缓冲实现，但为独立实例，互不干扰。

### ② 原始录音以「地点 + 时间」标注

- 新增「采集地点」输入框，内容记忆到 `localStorage`，下次打开自动带入。
- 文件名规范：`环境采集_<地点>_<YYYYMMDD-HHmm>[_段N].wav`（地点名做非法字符过滤），
  便于环境降噪前后对比与环境评估归档。
- 新增「保存原始录音」按钮可随时导出；桌面端经主进程写入下载目录并回显路径，浏览器端走下载。

### ③ 多维度环境评估报告（新增，核心）

报告共六段，可面板内查看或导出 txt：

1. **声级统计**：Leq（等效连续声级，能量平均）/ L10 / L50 / L90 / Lmax / Lmin / L10-L90 起伏度。
2. **频段能量构成**：七频段（20-60 / 60-250 / 250-500 / 500-2k / 2-4k / 4-8k / 8-16k Hz）占比 + 主导频段。
3. **对人的舒适度评级**：A 非常安静 → E 吵闹 五级，刻度参照 **GB 3096-2008《声环境质量标准》昼间限值**；
   每级给出「适宜开展」与「不宜开展」的活动建议。
4. **声源构成推断（多维度）**：风 / 气流、水声（雨·流水·喷泉）、设备低频嗡鸣（风机·空调·电机）、
   人声活动、交通车辆 等，各自给出置信度与判据（频段占比 + 起伏度）；含「天气相关」专项结论。
5. **治理与降噪建议**：按主导频段给方向——低频为主推隔声减振、高频为主推吸声密封、
   起伏大提示先定位间歇声源、声级偏高提示听力防护；并按推断出的声源给针对性建议（风噪防风/HPF、
   水声注意掩盖效应、设备嗡鸣查 50Hz 工频及谐波）。
6. **重要声明**：明确标注未校准，不可作合规判定。

### 实现要点

- 采集时在 AudioWorklet 采 PCM 的同时**额外接一路 AnalyserNode**（fftSize 2048，不接 destination），
  每 200ms 采一次频谱 → A 计权声级序列 + 频段能量累积。
- **A 计权独立实现 `envAW()`**，不复用主分析的 `wTabA/wTabC` 缓存——两者 fftSize / 采样率不同，
  共用缓存会互相覆盖，导致主界面 dB(A) 出错。
- 新增 `npm run envtest`（`tools/env-report-selftest.js`，32 项）：**从 index.html 抽取真实函数**执行，
  测统计声级单调性、频段占比合计 100%、五级舒适度边界、四类声源触发条件、报告六段结构、A 计权对标 IEC 61672-1。
  抽取执行而非复制实现，避免测试版与产品版漂移。

### 修复：`#toolsMenu` 被误删（自查拦截）

- 本轮注入脚本用「环境面板①注释 → 声波警戒②注释」做整段替换，而 `#toolsMenu` 块恰好夹在两锚点之间
  （位于环境面板注释之后、envMask 之前），被一并替换掉。
- 由 `validate.js` 的「JS 引用的 #toolsMenu 在 HTML 中不存在」拦截（门禁第 3 组弹窗断言也会失败）。
  已按远端 v2.15.0 原块恢复，并校验其在 `.app` 之外、三个 toolmask 之前，四个菜单项齐全。
- 教训已写入技能：**整段替换前必须 dry-run 打印范围内的顶层元素**，不能只看锚点对不对。

### 版本号

- 五点统一升级到 **v2.16.0**，`versionCode 29 → 30`；由 `node tools/bump-version.js 2.16.0` 幂等完成并回读校验。

### 交付（MD5）

- `AlphaSun-AudioLab-2.16.0-portable.exe`（68.0MB（71,300,155 字节））`d22750c5deaf4c6422687ada54ac7a53`
- `AlphaSun-AudioLab-2.16.0-linux-x64.tar.gz`（98.9MB（103,736,756 字节））`bee0868fb057601c96a5c7fa577ab5e7`
- `AlphaSun-AudioLab-2.16.0.apk`：**本环境无签名密钥，未重编**，仍需用户本机签名重编。

### 校验

- 自动化门禁 **33/33 全绿**（新增第 8 组环境面板 6 项断言）。
- `npm run envtest` **32/32 全绿**（报告算法，抽取真源码执行）。
- `npm run check` 五阶段全绿（含 validate、内联脚本语法、算法自检、三处源码一致）。
- 三处源码 MD5 一致：`310b101c62c321a08d6d35a1c2d41765`。

### 已知限制

- **声级未经校准**：读数是相对满量程的数字电平 + 用户可选的校准偏置，可用于同一设备的相对比较与趋势跟踪，
  **不可作为合规判定或法定测量依据**；需 GB 3096 合规结论请用经检定的积分声级计按标准方法测量。
- **声源推断是启发式规则**（频段占比 + 起伏度），非机器学习分类，仅供现场排查参考。
- 采集为长时场景时，分段保存可按段切分文件；整段不分段的长时间采集仍受内存限制。
- APK 始终缺位（无签名密钥）。

## v2.15.0（2026-10-03）—— 会议语音转写：三语 / 云端+本地双模式 / 实时波形 / 原始录音保存

### ① 三语支持（普通话 / 粤语 / 英语）

- 面板新增语言选择：中文（普通话）`zh` / 中文（粤语）`yue` / English `en`，统一由 `asrLangCode()` 分发到各引擎。
- 云端：映射为 DashScope `language_hints`（`zh` / `yue` / `en`，三值均取自官方 API 文档取值范围）。
- 在线回退：Web Speech 映射为 `zh-CN` / `yue-Hant-HK` / `en-US`。
- 本地：Vosk 按语言加载对应模型目录（`model-zh` / `model-en`）。
- **粤语无官方 Vosk 模型**：已核实 `alphacephei.com/vosk/models` 只有 `cn` / `cn-kaldi-multicn` / `small-cn`，
  没有粤语模型 → 本地模式不支持粤语，选中粤语+本地时明确提示「粤语暂无离线模型，请用云端模式」，不静默失败。

### ② 云端模式（阿里云百炼 DashScope，联网）

- 模型 `qwen-audio-3.0-asr-flash-filetrans`（非实时文件转写），链路：获取上传凭证 → OSS 上传 → 提交异步任务 → 轮询 → 取逐句结果。
- **API Key 只留在主进程**：`main.js` 内 `dashTranscribe()` 承担全部调用，`preload.js` 经 `contextBridge` 暴露 `window.asrCloud`，
  渲染层**只传 WAV 的 base64**，不接触 Key（浏览器直连会被 CORS 拦且泄露 Key，故必须由主进程代理）。
- 面板新增「⚙ 云端设置」：填入的 Key 写入本机 `userData/asr-config.json`（不入库、不写进源码仓库）；
  也支持环境变量 `DASHSCOPE_API_KEY`（优先级更高）。
- **该模型是非实时转写，做不到流式逐字** → 采用「分段录制 + 分段提交」实现准实时：
  段长可选 20 / 30 / 60 秒，达到段长自动提交该段，停止时补交尾段。
- 云端返回逐句时间戳 → 导出 `srt` 时使用**真实时间轴**（此前是整段一条的退化写法）。

### ③ 本地模式（Vosk，离线）

- 保留原有离线通道，改为按语言加载模型；启动失败自动回退在线并如实标注引擎。
- 与云端共用同一套采集器，不再各开一路麦克风。

### ④ 实时波形与原始录音保存

- 转写面板新增**实时波形**（canvas，滚动显示最近约 19 秒）+ 实时电平 dB + 计时 mm:ss。
- **保存原始录音**：新增「保存原始录音」按钮随时导出 wav；并可勾选「停止时保存原始录音」自动保存。
  桌面端经主进程写入系统下载目录并回显路径，浏览器端走下载导出。
- 采集器 `ASR_CAP` 统一累积 PCM，供波形 / WAV / Vosk 共用；未勾选「保留完整录音」时，
  每段提交成功后丢弃已提交部分，**避免长时录制内存无界增长**。

### 版本号

- 五点统一升级到 **v2.15.0**，`versionCode 28 → 29`；由 `node tools/bump-version.js 2.15.0` 幂等完成并回读校验。

### 交付（MD5）

- `AlphaSun-AudioLab-2.15.0-portable.exe`（68.0MB（71,294,820 字节））`2db8da0bfa77a7f4e3f8891e92ad25c7`
- `AlphaSun-AudioLab-2.15.0-linux-x64.tar.gz`（98.9MB（103,730,731 字节））`0be4655281544060934e2de76bde3fd1`
- `AlphaSun-AudioLab-2.15.0.apk`：**本环境无签名密钥，未重编**，仍需用户本机签名重编。

### 校验

- 自动化门禁 `tools/qa-gate.js` **27/27 全绿**（较 v2.14.2 的 18 项新增 9 项）。
- 新增断言覆盖：语言下拉含三语、模式下拉含云端/本地、波形画布渲染出尺寸、原始录音保存入口、云端设置入口、
  段长选择存在，以及第 7 组**云端通道 IPC 往返**（实测：Key 状态查询走通；未配置 Key 时返回
  `{ok:false, error:'NO_KEY'}` 而**非静默返回空**——这条是专家规范里的硬红线）。
- 引擎标注诚实性：无 Key 时 badge 显示「引擎：云端 · 未配置 API Key」，绝不谎报云端可用。
- `npm run sync` 三处源码 MD5 一致：`c08893262ea6616d87472e7ddeab7f1e`；`check.js` 五阶段全绿；内联主脚本 `node --check` 通过。
- 构建链路首次完整跑通 `win + linux`，产物全部回落到项目 `dist/`，临时目录（系统 TEMP）自动清理。

### 已知限制（务必阅读）

- **云端真实转写尚未真机验证**：本机未配置 `DASHSCOPE_API_KEY`，只验证到「请求正确抵达主进程、无 Key 时明确报错」。
  首次使用请在面板「云端设置」填入 Key 后自测；未放 Key 前云端模式不可用。
- **云端是分段转写，不是逐字流式**：出字有段长级别的延迟（20/30/60 秒），需要实时字幕场景请用本地模式或 Web Speech。
- **粤语只有云端可用**：本地 Vosk 无粤语模型。
- 门禁依赖 Electron 桌面运行时 + playwright-core，无 GUI / 无 Electron 的 CI 跑不了。
- APK 始终缺位（无签名密钥）。

## v2.14.2（2026-10-02）—— 工程化迭代：自动化回归门禁 / 诊断日志 / 离线转写引擎层 / 遗留清理

四项均来自一次**实证审计**（而非泛泛建议）：发现 `tools/` 下 10 个 `pw-*.js` 调试脚本未接入 npm scripts、
仓库没有 `npm test`、devDependencies 无测试框架 ⇒ 既往修复缺少自动回归保护
（v2.13.0 缺陷与 v2.14.0/2.14.1 遮挡问题都是发布后才由用户发现）。本轮逐项补齐。

### ① 自动化回归门禁（`tools/qa-gate.js`，新增）

- **运行环境**：playwright-core + Electron `_electron.launch`，`--use-fake-device-for-media-stream` 提供假麦克风；
  playwright-core 装在项目外的托管工作区（未污染项目依赖），故脚本内置**回退查找**：
  项目 `node_modules` → `~/.workbuddy/binaries/node/workspace/node_modules`；并必须 `delete process.env.ELECTRON_RUN_AS_NODE`
  （否则 WorkBuddy 注入该变量后 Electron 会退化为纯 Node 静默退出）。
- **6 组 18 项断言**：① 诊断模块注入 / 加载期零 pageerror / 零 console.error / 报告可生成 / 导出可调用；
  ② 12 项关键 DOM 齐备；③ 工具集弹窗可打开、完整在视口内、中心点未被遮挡、中心≈视口中心（容差 3px）、含导出入口；
  ④ 三个工具面板依次开合；⑤ ASR 引擎标注**诚实性**；⑥ 交互后复查零错误。
- **针对遮挡缺陷的专项防线**：遮挡断言用 `document.elementFromPoint(视口中心)` 判定命中元素是否属于菜单内部，
  并校验菜单矩形中心 ≈ 视口中心。这是 v2.14.0 / v2.14.1 两次遮挡回归的直接拦截点。
- **接入**：新增 `npm run qa`；`npm run check:all` = `check`（静态自检）+ `qa`（运行时门禁）。

**实测 18/18 全绿**，且做了**反向验证（mutation testing）**：故意把 `#toolsMenu` 塞回 `.capwrap`、CSS 改回 `absolute` 后，
门禁立刻失败为 14/18，报 `弹窗中心点未被其它元素遮挡 — 顶层元素=DIV#bandBars.bands tall` 与
`menu中心=(992,222) 视口中心=(634,349)`；随后按 MD5 校验还原源码 —— 证明门禁**真的能拦截该缺陷**，不是装饰品。

### ② 一键导出运行日志（诊断模块）

- 500 条环形缓冲，避免长时值守内存无界增长；包装 `console.error/warn`，并捕获
  `addEventListener('error', …, true)` 与 `unhandledrejection`。
- 报告内容：版本 / 平台 / UA / 硬件并发 / AudioContext / AudioWorklet / SpeechRecognition / localStorage / L2 上限 /
  全部日志条目 / 关键 DOM 文本（引擎标注、采样率、CMF、CPU、内存、麦克风、BPM、dB(A)、Leq、状态栏）。
- 工具集菜单新增「🩺 导出运行日志」，导出为 `alphasun_diag_<时间戳>.txt`；同时暴露 `window.__diag` 供门禁读取。
- 门禁实测：加载期 `errors=0 warns=0`，报告长度 >200 字符。

### ③ 离线转写引擎层（Vosk，可插拔）

- **依赖选型**：`vosk-browser@0.0.8`。过程中 `vosk-browser-wasm` 在 npmmirror 与 npmjs 均 404、
  `alphacep/vosk-api@v0.3.50` 0 个发布资产、`alphacephei.com/vosk/web/*` 三个 WASM 直链均 404，只有 `vosk-browser` 可达
  （`dist/vosk.js` 5.8MB emscripten 单文件）。
- `tools/sync-vosk.js` 把运行时同步到 `assets/vosk/`（**幂等 + md5 回读校验**，内容一致才跳过），已并入 `npm run sync`；
  同步产物 `assets/vosk/vosk.js` 与 `README.md` 已加入 `.gitignore`（派生文件，禁止入库）。
- **引擎层改造**：`asrDetect()` 先探测本地模型（`HEAD assets/vosk/model.tar.gz`）→ 存在则 vosk，否则回落 Web Speech / 不支持；
  运行时**惰性加载** vosk.js（无模型时零开销）；Vosk 初始化失败自动回退在线并 toast 如实提示。
- **诚实性设计（重要）**：模型约 42MB，**不随包发布** —— 未放置模型时 UI 绝不谎报「Vosk 离线」。
  门禁专项实测：badge = `引擎：Web Speech（在线）`、`Vosk运行时已加载=false`。放置方法见 `assets/vosk/MODEL_PLACEHOLDER.md`
  （须是 `model.tar.gz` 而非官方 zip，且 `model/conf/model.conf` 官方不提供、需自建，文档给了示例）。

### ④ 遗留清理与小优化

- 抽取单一真源 `L2_LIMITS={sec:600,mb:40}`，替换散落三处的 `if(peek>600)` 硬编码，统一走 `l2GuardDur(peek, action)`
  （三处文案分别为「不做处理」/「不做转码；可改用原始格式直存」/「不计算声谱图」），并双向同步注释。
- 保留并可配置项：`localStorage['alphasun.l2.maxSec']` 作为内存充裕时的逃生阀。
- 更新已过时的「待开发项占位」注释（v2.14.0 起三个工具均已实现）。

### 版本号

- 五点统一升级到 **v2.14.2**，`versionCode 27 → 28`；由 `node tools/bump-version.js 2.14.2` 幂等完成并回读校验。

### 交付（MD5）

- `AlphaSun-AudioLab-2.14.2-portable.exe`（68.0MB（71,288,810 字节））`6d2f27737038c566f0273d72aa3377c8`
- `AlphaSun-AudioLab-2.14.2-linux-x64.tar.gz`（98.9MB（103,726,276 字节））`4a942daf60fa3db9905e0eb153b93f72`
- `AlphaSun-AudioLab-2.14.2.apk`：**本环境无签名密钥，未重编**，仍需用户本机签名重编。

### 校验

- `tools/qa-gate.js` **18/18 全绿**（含上述反向验证）。
- `npm run sync` 三处源码 MD5 一致（根 / `www/` / Android assets）：`c96044db63c4dca4855d3c248d953a1b`；`check.js` 五阶段全绿。
- `node --check` 内联主脚本语法通过；三处注入脚本改造后均回读复核（避免「并行编辑同文件导致后写覆盖先写」）。

### 已知限制

- **Vosk 离线中文准确率尚未真机验证** —— 需用户自行放入 `model.tar.gz` 后实测；在此之前默认走在线 Web Speech。
- 门禁依赖 Electron 桌面运行时 + playwright-core，**在无 GUI / 无 Electron 的 CI 上跑不了**；若后续要上 CI 需改用 Chromium。
- APK 始终缺位（无签名密钥），移动端用户需本机 `npx cap build android` 后签名。

## v2.14.1（2026-10-02）—— 修复「音频工具集」弹出框被遮挡

### 根因（层叠上下文，非定位数值问题）
- v2.14.0 已把 `.toolsMenu` 改为 `position:fixed` 居中，但**仍被遮挡**。真正原因：主容器 `.app` 为 `position:relative; z-index:1; zoom:var(--zoom)` —— `z-index` 使其成为**层叠上下文**，`zoom` 又使内部 `position:fixed` 改为**相对 `.app` 定位**。因此菜单的 `z-index:86` 只在 `.app` 这个 z-index:1 的上下文内比较，逃不出主画布（`#cv`），无论调到多大都会被盖住。

### 修复
- 把 `#toolsMenu` **移出 `.app`**，改为 `<body>` 直属子元素（与三个 `.toolmask` 同级，`.app` 在第 923 行即闭合）。这样：`position:fixed` 相对**视口**居中、`z-index:86` 在**根层**参与比较 → 不再被主画布遮挡，真正居中于屏幕。
- 顺带去掉菜单内已过时的「规划中」角标与「· 规划中」标题（三个工具均已实现），并更新 `toolsBtn` 的 title 文案。
- CSS 沿用 v2.14.0 的居中方案（`position:fixed; left/top:50%; transform:translate(-50%,-50%)` + 专用动画 `tmPop2`），未再改动。

### 版本号
- 五点统一升级到 **v2.14.1**，`versionCode 26 → 27`；由 `node tools/bump-version.js 2.14.1` 幂等完成并回读校验。

### 交付（MD5）
- `AlphaSun-AudioLab-2.14.1-portable.exe`（66.6MB，版本资源 2.14.1）`e8d110756f6b4fd12cefcd7912fee49b`
- `AlphaSun-AudioLab-2.14.1-linux-x64.tar.gz`（94.5MB）`f5fa09152b5563dc3d894baa8f531228`
- `AlphaSun-AudioLab-2.14.1.apk`：**本环境无签名密钥未重编**，待用户本机签名重编。

### 校验
- `node --check` 抽取内联主脚本语法通过；`validate.js` 全绿（246 DOM id、E 映射 159 key、版本五点一致 v2.14.1、无陈旧版本号残留）。
- `npm run sync` 三处源码 MD5 一致（根 / `www/` / Android assets）；`check.js` 五阶段全绿。


## v2.14.0（2026-10-02）—— 音频工具集三工具落地为可用 + 两处缺陷修复

### 音频工具集：三个待建工具由「规划中」变为可用
- **环境音频采集**：独立 `getUserMedia` + AudioWorklet 采集 PCM、实时算 dB；支持手动 / 定时 / 声级触发（阈值+方向+持续 N 秒）三种模式；按段切分存 16bit WAV；可导出采集日志 txt。
- **声波警戒值守**：独立 `AnalyserNode` 实时算声压级，每 150ms 比对阈值；超限触发整页闪烁 + 880Hz 提示音（WebAudio square）+ 写警戒日志；可导出 txt。
- **会议语音转写**：`setupASR()` + Web Speech API（zh-CN，**在线引擎**，UI 已诚实标注）；实时中间结果 + 最终文本累积；支持复制与导出 txt / srt 双文件。离线引擎（Vosk WASM + 中文模型）体积大，本轮未做。

### 缺陷修复
- **① 主界面加载即报 `TypeError @ index.html:4270`**：工具块顶层绑定写在主 `<script>` 内，而三个工具面板 DOM（envMask/alertMask/asrMask）定义在脚本之后，脚本解析时 `$('envMode')` 为 null。修复：将工具块顶层绑定整体包进 `document.addEventListener('DOMContentLoaded', …)`，待面板 DOM 解析后再绑定（`toast` 保留在外层供 L2 使用）。
- **② 「音频工具集」弹出框被遮挡**：原 `position:absolute` 困在顶栏层叠上下文内、落在主画布之下。修复：改 `position:fixed` 居中（`translate(-50%,-50%)`）+ `z-index:86`，并新增专用居中动画 `tmPop2`（原 `tmPop` 被全屏遮罩 `.toolmask` 共用，不能改）。现弹出框居中显示、不被遮挡。

### 版本号
- 五点统一升级到 **v2.14.0**（index `APP_VER` / `appVer` span / `package.json` / `sw.js` CACHE / gradle `versionName`），`versionCode 25 → 26`；由 `node tools/bump-version.js 2.14.0` 幂等完成并回读校验。

### 交付（MD5）
- `AlphaSun-AudioLab-2.14.0-portable.exe`（66.6MB，版本资源 2.14.0）`e52bf4e29f43651c060f747857f11d6f`
- `AlphaSun-AudioLab-2.14.0-linux-x64.tar.gz`（94.5MB）`42ed09cfd8ae29e531f70d5fe2df1b6c`
- `AlphaSun-AudioLab-2.14.0.apk`：**本环境无签名密钥未重编**（仓库无 `.jks`/`.keystore`），待用户本机签名重编以含三工具 + 本轮两处修复。

### 校验
- `validate.js` 全绿（246 DOM id 全部存在、E 映射 159 key、版本号五点一致 v2.14.0、无陈旧版本号残留）。
- `npm run sync` 三处源码 MD5 一致（根 / `www/` / Android assets）；`check.js` 五阶段全绿（A/C 计权 + BPM 自检 / 三处一致 / 离线 lamejs）。


## v2.13.0（2026-10-02）—— 分析能力增强 + 文档体系重建

### 新增分析能力（专业声学指标）
- **频率计权声级 dB(A)/dB(C)**：IEC 61672-1 计权网络，能量域合成（非 dB 直加）。`dB(C)−dB(A)` 差值可判低频占比。
- **统计声级 Leq · L10 / L50 / L90**：120s 滚动窗口，环境噪声评价同族指标；至少 12 个有效帧出数，不足时显示「累计中 n/12」。

### 算法缺陷修复
- **BPM 事实上从未工作过**（确定性缺陷）：原实现用 200ms 包络却在 `lag=8..59` 搜索，换算后仅 5.08–37.5 BPM，
  恒不满足 `50<bpm<200` 的返回门限 ⇒ 永远返回 0。重写为：rAF 帧级包络（≈16ms）+ 归一化互相关 +
  倍频歧义消解（150BPM 曾判成 50BPM）+ 稀疏性门（拒绝语音音节率误报）+ dt 实测（兼容 60/90/120Hz）。
  自检：8 个 BPM 值全部命中，4 类非节拍信号全部拒绝为 0。
- **A 计权分子幂次错误**：写成 `f³`（应为 `f⁴`），1kHz 处整体偏低约 60dB —— 由新增的算法自检抓到。

### 工程与文档
- 新增 `tools/algo-selftest.js`：从 **index.html 源码真身**抽取算法验算（不抄副本），覆盖 A/C 计权标称值与 BPM。
- 新增 `tools/check.js`：一键自检（validate + 语法 + 算法自检 + 三处源码 md5 一致 + 离线资源完整）。
- 新增 `tools/bump-version.js`：版本号五点统一升级。
- 新增 `tools/pw-metrics-check.js`：新增指标实跑验证（确认「真的出数」而非「不崩溃却恒显示 —」）。
- 文档重建：README 重写、`docs/架构说明.md`、`docs/测试与回归.md` 新建，过程文档补 v2.7–v2.13 内容。

### 交付（MD5）
- `AlphaSun-AudioLab-2.13.0.apk`（3.4MB，versionCode 25 / versionName 2.13.0 经 aapt2 校验）`209722d3059a52c34cd9828429b64659`（本环境无签名密钥未重编，仍为含菜单热修、不含三工具可用实现的版本；待用户本机重编以含三工具）
- `AlphaSun-AudioLab-2.13.0-portable.exe`（66.6MB，版本资源 2.13.0）`4a9a666756745c4725aee68094943c03`（含三工具可用实现：环境音频采集 / 声波警戒值守 / 会议语音转写）
- `AlphaSun-AudioLab-2.13.0-linux-x64.tar.gz`（94.5MB）`f3157c7c9a528a179bc9218b7a92e0e8`（含三工具可用实现）

### 修订（2026-10-02 · 菜单热修）
- **移除 Electron 默认应用菜单栏（"File / Edit / View / Window / Help"）**：`main.js` 主进程 `app.whenReady` 后调用
  `Menu.setApplicationMenu(null)`。当前软件功能无需该菜单，移除后客户区直接顶到窗口标题，分析可视面积更大；
  Windows/Linux 完全隐藏菜单栏，macOS 受系统规范仅保留最小应用菜单。改动仅影响 Electron 桌面端，
  Android/iOS/PWA/HTML 本就无此菜单，故**不升版本号**（升版本会迫使未重编的 APK 出现版本漂移）。
  Win 便携版与 Linux 版已重编并覆盖 v2.13.0 Release 资产（MD5 见上，已更新为去菜单版本）。

### 修订（2026-10-02 · 音频工具集占位）
- 主界面「二级分析」旁新增 **音频工具集** 入口按钮（🧰）+ 弹出菜单，含三个规划中占位项：
  会议语音转写 / 环境音频采集 / 声波警戒值守。点击按钮切换菜单显隐；点击任一菜单项弹出中性 toast
  「（规划中）… —— 暂未开放，敬请期待」；点击页面空白或按 Esc 关闭菜单。
- 仅改 `index.html`（CSS + DOM + JS），未动版本号（保持 v2.13.0）：属规划中占位 UI，全平台经
  `npm run sync` 同步至 `www/` 与 Android assets，三处 MD5 一致、`check.js` 全绿；不触发二进制重编即可生效。

### 修订（2026-10-02 · 音频工具集三工具落地为可用）
- 三个规划中占位项全部实现为可用功能（沿用 `.toolmask` 覆盖层范式，未新增面板切换；复用既有录制管线 / 实时声压级 / Web Speech API，未升版本号，保持 v2.13.0）：
  - **环境音频采集**：独立 `getUserMedia` + AudioWorklet（`as-rec`）采集 PCM，实时算 dB 并写入日志；支持三种触发模式——手动 / 定时（时长+间隔）/ 声级触发（阈值+方向+持续 N 秒）；按段切分存 16bit WAV（复用 `l2WavF`+`l2Dl`），可一键导出采集日志 txt。
  - **声波警戒值守**：独立 `AnalyserNode` 取时域算实时声压级 dB，每 150ms 比对阈值；超限触发整页闪烁（`body.alarm`）+ 880Hz 提示音（`alBeep`，WebAudio square）+ 写警戒日志（含时间戳/峰值 dB）；阈值/持续/闪烁/提示音可配，可导出日志 txt。
  - **会议语音转写**：`setupASR()` + Web Speech API（zh-CN，在线引擎，已在 UI 诚实标注「引擎：Web Speech（在线）」）；实时中间结果 + 最终文本累积，支持复制与导出 txt / srt 双文件（srt 时间码由采集起算）。离线引擎（Vosk WASM + 中文模型）因模型体积大需后续接入，本轮未做。
- 校验：`validate.js` 全绿（246 DOM id 全在、E 映射 159 key、版本 v2.13.0 五点一致）；`npm run sync` 三处 MD5 一致、`check.js` 五阶段全绿（A/C 计权 + BPM 自检 / 三处一致 / 离线 lamejs）。Win 便携版与 Linux 版已重编并覆盖 v2.13.0 Release 资产（MD5 见上）。

### 修订（2026-10-02 · 修复两处缺陷）
- **① 主界面加载即报 `TypeError @ index.html:4270`**：音频工具集三个可用工具的初始化绑定写在主 `<script>` 内、以顶层语句执行，而三个工具面板 DOM（envMask / alertMask / asrMask，含 envMode 等）定义在脚本之后；脚本解析时 `$('envMode')` 为 null → 抛错。修复：将工具块的顶层绑定整体包进 `document.addEventListener('DOMContentLoaded', …)`，待面板 DOM 解析完成后再绑定事件。`validate.js` 全绿（246 DOM id、版本五点一致）、`npm run sync` 三处 MD5 一致、check.js 五阶段全绿。
- **② 「音频工具集」弹出框（toolsMenu）被遮挡**：原为 `position:absolute`（相对 `.capwrap`，困在顶栏层叠上下文内，落在主画布之下）导致被遮挡。修复：改为 `position:fixed` 居中（`left/top:50%` + `translate(-50%,-50%)`）+ `z-index:86`（高于主画布、低于 toast 90），并新增专用居中动画 `tmPop2`（原 `tmPop` 被 `.toolmask` 共用、不能改），避免动画 transform 覆盖居中位移。现点击「音频工具集」弹出框居中显示、不被遮挡。
- 仅改 `index.html`（CSS + JS），未升版本号（保持 v2.13.0）；Win 便携版与 Linux 版已重编并覆盖 v2.13.0 Release 资产（MD5 见上）。

## v2.12.0（2026-10-02）
- **自研 FLAC 编码器**（`l2EncFlacJS`）：WebCodecs 在 Electron/Edge 均不支持 flac → 不删格式，改为自研
  （FIXED(order2) 预测 + Rice 残差；无收益降级 VERBATIM；CRC-8/CRC-16）。全平台可用，实测 328KB→21KB。
- **开始采集即开启阵列仿真**：单声道设备自动切虚拟 3 麦三角阵，真实多声道接入时自动接管。
- **多终端适配**：触摸目标 ≥44px、手机竖屏 ≤600px、横屏矮屏 ≤520px、平板竖屏 768–1366px、安全区 `env(safe-area-inset-*)`。
- 新增 `orientationchange` 重绘（部分 WebView 旋屏只发 orientationchange，且尺寸有 ~200ms 抖动）。
- 人性化：体积自适应单位（<1MB 显示 KB，不再「0.04MB」）。
- 修复 `cleanup-dist.js` 事故：遍历 release/debug 时「最后一个匹配覆盖」导致拿旧 debug 包覆盖当次 release 包，
  再被内容校验判为旧产物删除 → APK 全丢。改为 release 优先命中即停 + 入位即校验版本不符则中止。

## v2.11.2
- **根治 Electron 崩溃**：`decodeAudioData` 在 Electron 中必崩渲染进程（native crash，try/catch 拦不住）。
  改用纯 JS WAV 解析（`l2ParseWav` + `l2BufLike` + `l2DecodePCM`）绕开 native 解码器。
- 录制改为 AudioWorklet 直采 PCM → WAV，产物与导入 WAV 同构。
- webm 在载入/处理/声谱图/转码前一律拦截。

## v2.11.1
- 保存选格式崩溃修复；`l2DecodeSafe` 超时兜底；内存尽早释放。

## v2.11.0
- 二级分析台导出多格式：WAV / MP3（lamejs 离线）/ AAC（WebCodecs + ADTS）/ FLAC / 原始直存。

## v2.10.x
- Spek 风格高分辨率声谱图（时频热图 + F0 轨迹 + 节拍与声学事件）。
- 播放改用波形竖立推进指示（支持鼠标与触摸拖拉），移除独立进度条。

## v2.7.0
- 前景/背景分离（谱减法 + 平稳性判别）；GCC-PHAT 声源定位；实时概要总结与事件日志弹层。

## v2.0–v2.6
- 四种可视化、专业参数体系、离线分类模型、声纹、舒适度警报、采集质量评分、PWA 与五平台交付形态确立。
