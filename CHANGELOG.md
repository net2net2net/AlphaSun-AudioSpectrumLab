# AlphaSun 声波分析仪 · 版本演进（CHANGELOG）

> 每轮迭代必须追加。版本五点同步（index APP_VER / appVer span / package.json / sw.js / gradle versionName）
> 由 `node tools/bump-version.js x.y.z` 统一完成（幂等 + 回读校验）。



## v2.23.2（2026-10-03）—— 麦克风占用根因整改 IV：start() 失败不释放流 + 诊断误报「未持有」

### 复盘：v2.23.1 修完后用户仍报同样症状

用户反馈：更新后仍报「❌ 麦克风被占用 → **已确认本应用未持有麦克风**，通常是其它软件…」。
这条信息**极其关键**：说明 `getUserMedia` 失败时，JS 层所有句柄的自查结果都是「未持有」。
于是问题必然在**更底层**——被 v2.23.1 遗漏的一类句柄状态。

### ✅ 真凶 A：`start()` 失败路径完全不释放已占用的设备

第 3400-3404 行的 catch 块（v2.0.0 起一直存在）只做「显示错误 + 复位按钮」，
**没有任何清理动作**。若 `openMic()` 已成功拿到流、而后续初始化
（Analyser / AudioWorklet / buildBinMap / setupArray / resize…）任一步抛错：

- `stream`（**活的麦克风流**）与 `audioCtx` 仍留在内存里、**继续占着设备**；
- `running` 为 false、模块「看起来已停止」→ 诊断把它当「无残留」；
- 此前每次点「开始采集」→ 新 `getUserMedia` 撞上这枚**孤儿流（orphan）** → `NotReadableError`。

这是「所有采集全错 + 诊断说未持有」的完整解释。

### 整改（index.html）

1. **新增 `releaseMainAcq()`**：统一释放主流（`track.stop()`）+ `audioCtx.close()` + 置 null + 停识别会话，幂等。
   - `start()` 的 catch **调用它**（v2.23.2 关键修复）→ 启动失败不再留孤儿流。
   - `stop()` 改为复用它，避免两处释放逻辑漂移。
2. **`ctx.close()` 的 Promise 被记录并 await**：`close()` 是异步的，不等它就重新 `getUserMedia` 仍会撞上
   尚未释放的音频会话。自愈重试中先 `await mainCtxCloseP` 再等 260ms，重试成功率显著提高。
3. **诊断修正（v2.23.1 的误报根源）**：`micDiagReport` 把 `active`（模块状态）与 `live`（轨道是否 live）
   **分开输出**，并新增 `orphan` 标记（live 但未激活 = 残留占麦）。错误提示改为按 `live` 判定占用，
   孤儿流会被指名报出（「主采集（残留未释放）」），不再误报「本应用未持有」。
4. **错误提示补充 Windows 层可能性**：当 JS 侧确实无残留时，提示也覆盖
   「Windows 音频设备被独占 / 驱动异常」，并给出重启音频设备等可操作建议。

### 防回归

- `tools/mic-smoke.js` 新增「**停止后无残留 live 轨道（无孤儿流）**」断言（10 → **11 项**），
  用 `window.__micDiag()` 读轨道 `readyState` 判定。

### 门禁（全绿，零回归）

`check` 五阶段 · `qa` **44/44** · `guardsmoke** **25/25** · `audiosmoke** **39/39** · `micsmoke` **11/11** · `respgate` **34/34**。

### 诚实的边界与用户自查
- 本机开发环境无真实可用麦克风输入设备，**真机「设备被独占」无法在本环境自动复现**；
  已把 `micDiagReport` 做成产品内置能力，错误提示会**指名道姓**报出是哪个句柄占用。
- 若更新后仍报「已确认本应用未持有」，则**极可能是 Windows 侧音频设备被独占或驱动异常**：
  请尝试①关闭所有会议/录屏/语音软件；②设备管理器里禁用再启用麦克风；③重启电脑；
  ④在「设置→隐私和安全性→麦克风」确认本应用未被禁用。

### 交付（MD5）

- Windows 便携版（**单文件**）`AlphaSun-AudioLab-2.23.2-portable.exe`（68.0 MB）：`c6f437aee1e625b3ba40e17ebfa07bd1`
- Linux x64 `AlphaSun-AudioLab-2.23.2-linux-x64.tar.gz`（99.0 MB）：`8842f20d16d30891a5b0847e8b0f4070`
- Android 自签 release `AlphaSun-AudioLab-2.23.2.apk`（6.0 MB，versionCode 40）：`a2e8f53e204d1fe09d33104fc2ec3545`
- 旧版本产物已清理：`dist/` 仅保留当前版三件（v2.23.1 已删，均已发布到 Release 且可再生）。
- 三处源码 MD5 一致（根 / `www/` / Android assets）。

## v2.23.1（2026-10-03）—— 麦克风占用根因整改 III：关闭工具面板未停止采集（第三轮复盘·真凶）

### 复盘：前两轮为什么都没修好

| 轮次 | 我定位的「根因」 | 为什么不是真凶 |
|---|---|---|
| v2.20.0 | 二级台 `L2.liveStream` 幽灵流 | 真实存在，但只是**其中一种**残留，不是主因 |
| v2.23.0 | `SpeechRecognition` 会话（recog）泄漏 | 真实存在，也修了，但**用户仍报同样症状** |
| **v2.23.1** | **关闭工具面板不停止采集** | ✅ **真凶** |

用户明确反馈「**我检查麦克风没有被占用**」——这条信息至关重要，它排除了外部软件，
把范围锁定在本应用内部。但我前两轮都在「逐个排查句柄」，**没有去查「用户是怎么用的」**。

### 真凶：关闭工具面板只隐藏 UI，采集仍在后台运行

第 4543-4545 行（v2.13.x 起一直存在）：

```js
['envClose','alertClose','asrClose'].forEach(c=>{…只 classList.remove('on')…});
['envMask','alertMask','asrMask'].forEach(id=>{…点遮罩空白，只 classList.remove('on')…});
addEventListener('keydown',…Esc，只 classList.remove('on')…);
```

**三条关闭路径（✕ 按钮 / 点击遮罩空白 / Esc 键）全部只移除 CSS 类，不停止任何采集。**

典型用户路径：
1. 打开「语音转写」面板 → 点「▶ 开始转写」→ `recog` / `ASR_CAP` 持续占用麦克风
2. 觉得不需要了，点 **✕ 关闭面板** → 面板消失，但**采集仍在后台跑**
3. 点「▶ 开始采集」→ `NotReadableError`「麦克风被占用」
4. 环境采集、值守同理 → **全部报错**
5. 用户去查系统「谁在用麦克风」→ 外部一个都没有（因为占用者就是本应用进程内部）

这与用户描述**完全吻合**：所有采集连带失败 + 外部查不到占用。

### 整改（index.html）

1. **新增 `closeToolPanel(maskId)`**：关闭面板时**先停采集再隐藏**（幂等，未启动无副作用）——
   `asrMask`→`asrStop()`；`envMask`→`envStopAll()`；`alertMask`→`alStopAll()`。
   三条关闭路径（✕ / 点遮罩 / Esc）全部改走它，一处修复覆盖全部入口。
2. **自愈重试**：`start()` 的 `openMic()` 外包一层 try/catch —— 若遇 `NotReadable/TrackStart/AbortError`，
   自动 **全量清理**（`releaseGhostMic` + `recogStopSession` + `l2Release`）→ 等待 220ms
   （让底层音频会话真正释放）→ **重试一次**。仍失败才抛原错误。
   这是兜底：即使还有我们未穷举到的句柄残留，也能自愈，保证「实时采集/转写」不至于直接撞死。
3. **内置句柄诊断 `window.__micDiag()`**：在闭包内定义并显式挂 window（因 index.html 逻辑在主
   `<script>` 闭包内，`page.evaluate` 读不到内部变量），返回每个句柄的
   `{name, tracks, ctxState, active}`。配套 `tools/mic-diag.js`（**真机**运行，不加假设备参数）
   可枚举全部句柄并实测「此刻能否再开麦」。
4. **错误提示自诊断**：`NotReadableError` 文案不再泛泛说「关闭其它软件」，而是先跑 `micDiagReport()`：
   - 本应用有活句柄 → 「本应用内部仍占用：XX、YY」（指名道姓）
   - 有识别会话 → 提示先停止语音转写
   - 都没有 → 才判定「已确认本应用未持有，通常是其它软件」

### 防回归

- `tools/mic-smoke.js` 新增 **[4.1] 关闭转写面板必须停止采集**断言
  （点 ✕ 后断言「开始转写」恢复可点、「停止」变灰 = `asrStop` 已执行）；**9 → 10 项**。

### 门禁（全绿，零回归）

`check` 五阶段 · `qa` **44/44** · `guardsmoke` **25/25** · `audiosmoke** **39/39** · `micsmoke` **10/10** · `respgate` **34/34**。

### 交付（MD5）

- Windows 便携版（**单文件**）`AlphaSun-AudioLab-2.23.1-portable.exe`（68.0 MB）：`652d2ac93d8a8adc2a632b3cd0e84bfb`
- Linux x64 `AlphaSun-AudioLab-2.23.1-linux-x64.tar.gz`（99.0 MB）：`73ea472a3e04bdf313a5bab134ba92b8`
- Android 自签 release `AlphaSun-AudioLab-2.23.1.apk`（6.0 MB，versionCode 39）：`e420dae602b170ff1c5ee1b9ec8792ad`
- 旧版本产物已清理：`dist/` 仅保留当前版三件（v2.23.0 已删，均已发布到 Release 且可再生）。
- 三处源码 MD5 一致（根 / `www/` / Android assets）。

### 方法论教训（三轮复盘最重要的一条）

**光穷举「资源句柄」不够，还要查「用户是怎么用的」。**
前两轮我都在静态审计「谁持有麦克风、释放路径对不对」——那是对的，但**只覆盖了「代码怎么写」，
没覆盖「UI 流程怎么走」**。真凶藏在「关闭面板」这个最普通的交互里。

→ 排查「某功能导致全局异常」类问题时，除了**静态审计资源句柄**，还必须**逐条走查 UI 流程**：
每个入口、每个「关闭/取消/切换」路径是否都正确收尾。用户反馈里「什么时候触发」「之前做过什么」
是定位真凶的关键线索（本次「外部没占用」这句话直接排除了整个外部方向）。

## v2.23.0（2026-10-03）—— 麦克风占用根因整改 II：SpeechRecognition 会话泄漏（第二轮复盘）

### 复盘：为什么 v2.20.0 的修复没有解决问��

v2.20.0 用户报告「点开始采集 → ❌ 麦克风被其他程序占用，且各采集全错」，我定位到
「二级台 L2.liveStream 幽灵流」并做了 `releaseGhostMic()` 整改。**但用户报告问题复发。**

复盘后确认：**上轮我并没有确证根因就宣称修复，这是我的失误。** 本轮通过静态审计 + 探针实测，
找到了**另一个被完全遗漏的麦克风占用源**。

### 真凶：SpeechRecognition 会话（recog）—— 独立于 MediaStream 的占麦源

探针实测（本机 Electron 内 `SpeechRecognition 可用 = true`）：主采集 `start()` 内部会
`setupASR()` 新建一个 Web Speech 识别会话并 `recog.start()`，**它会独占麦克风**。
而 v2.20.0 的 `releaseGhostMic()` 只管理 `MediaStream`（各种 `stream.getTracks().stop()`），
**完全不涉及 `recog`** —— 这是上轮整改的致命遗漏。

三个叠加缺陷：

1. **会话泄漏**：`setupASR()` 每次调用都 `new SR()` 新建会话，但主采集 `stop()` 只
   `recog.stop()` **从不置 `recog=null`** → 反复开关采集会堆积多个「已启动未释放」的识别会话。
2. **释放竞态**：`speechRecognition.stop()` 是**异步**的，底层释放麦克风有延迟；
   `stop()` 后立刻 `getUserMedia` 会撞上尚未释放的会话 → `NotReadableError`。
3. **模块踩踏**：`recog` 被主采集与语音转写**共用**，`asrBeginWeb()` 覆写它的 `onend` 为
   「`asrOn` 时重启」，与主采集的 `onend`（`running` 时重启）互相覆盖。

### 整改（index.html 6 处）

- **新增 `recogStopSession()`**：真正终止识别会话 —— `abort()`（比 `stop()` 更硬、立即释放）
  + `stop()` + 摘除全部事件回调 + **置 `recog=null`**。作为所有释放路径的统一出口。
- `setupASR()` 改为**先 `recogStopSession()` 终止旧会话再新建**，杜绝堆积。
- 主采集 `stop()` 改用 `recogStopSession()`。
- `releaseGhostMic()` 纳入 `recog` 释放（切换任何采集时顺带清掉识别会话）。
- `asrStop()` / `asrAutoTick()` 的引擎切换统一走 `recogStopSession()`（全项目 `recog.stop()` 裸调用归零）。

### 错误提示改进（帮用户下次自查）

`NotReadableError` 文案从「请关闭正在使用麦克风的软件」改为**明确区分内外**：
「本应用已自动清理内部残留（v2.23.0）。若仍报错，通常是其它软件正在使用麦克风：请关闭
微信/钉钉/Teams/会议/录屏等，或退出本应用后重启电脑再试」。

### 防回归

- `tools/mic-smoke.js` 新增 **[3.5] 反复 6 轮采集开关**断言：反复开关后不堆积会话、回到停止态、零 pageerror。
  （假设备不独占、无法复现真机 NotReadableError，但可守住「反复 new 会话不置 null」这类逻辑泄漏。）

### 门禁（全绿，零回归）

`check` 五阶段 · `qa` **44/44** · `guardsmoke` **25/25** · `audiosmoke` **39/39** · `micsmoke` **9/9** · `respgate` **34/34**。

### 交付（MD5）

- Windows 便携版（**单文件**）`AlphaSun-AudioLab-2.23.0-portable.exe`（68.0 MB）：`b2311c575d26c1298273d35e520e8536`
- Linux x64 `AlphaSun-AudioLab-2.23.0-linux-x64.tar.gz`（99.0 MB）：`d2ad93b0bf8ce69078e3bbd634c07e1b`
- Android 自签 release `AlphaSun-AudioLab-2.23.0.apk`（6.0 MB，versionCode 38）：`6b4f464a70aadf4a89057c6b3a041824`
- 旧版本产物已清理：`dist/` 仅保留当前版三件（v2.22.0 已删，均已发布到 Release 且可再生）。
- 三处源码 MD5 一致（根 / `www/` / Android assets）。

### 方法论教训（最重要）

**上一轮我在没有确证根因的情况下就宣称「已根治」，这是错的。** 排查「设备被占用」类问题时，
不能只找一个占用源就收工 —— 必须**穷举所有持有该资源的句柄**（本例中 MediaStream 有 7 处，
但还有独立于它的 SpeechRecognition 会话），并对每个来源逐一验证释放。
假设备不独占、无法自动复现真机冲突（已在 v2.20.0 诚实标注），但**静态审计 + 探针实测
能定位到逻辑泄漏点**，二者结合才靠谱。

## v2.22.0（2026-10-03）—— 页脚版本号根治 + DSP 链路条可读性 + 旧文档/过程文档清理

### 修复 ①：页脚版本号落后 9 个版本（v2.0.0 事故复发，根治）

- **现象**：界面底部页脚显示 `Audio Spectrum Lab v2.12.0`，而实际版本已是 v2.21.0 —— **落后 9 个版本**。
- **真因**：页脚是**硬编码静态文本**，而 `validate.js` 的「五点版本一致性」只校验
  `APP_VER` 常量 / `appVer` span / `package.json` / `sw.js` / `gradle`，**页脚不在校验范围**。
  这正是 validate 注释里写明的「v2.0.0 事故教训：页脚静态文本漏改逃过五点校验」的**复发**。
- **修复（根治）**：页脚改为 `<span id="footVer">` 占位，脚本加载时用 `APP_VER` 动态填充
  （与 `appVer` 共用同一段填充逻辑）→ 今��� `bump-version.js` 改版本时页脚**自动跟随，永不再漏**。

### 修复 ②：左侧 DSP 链路条竖排标签被挤成两行重叠

- **现象**：主界面左侧「声波采集 / 信号预处理 / 特征提取 / 分离前后 / 频谱模态」竖排标签
  因 `white-space:nowrap` 文字溢出容器，被挤压成两行且互相重叠，可读性差。
- **修复**：`.pipeline` 容器加 `width:max-content;max-width:76px` 按最长标签自适应；
  `.pl-node{max-width:100%}`；`.pl-tx` 改 `letter-spacing:.2px` + `overflow:hidden;text-overflow:ellipsis`
  优雅截断而非硬溢出。截图验证：标签恢复单行清晰、激活项青色高亮、链路点亮正常。

### 旧文档 / 过程文档清理（用户明确要求）

- **`过程文档.md` 重写**（此前停在 v2.13.0，且构建章节仍是**已废弃命令**
  `env -u ELECTRON_RUN_AS_NODE npx electron-builder`，会误导后续迭代）：
  - 目录结构更新到 v2.22.0 现状（含派生目录勿手改的约束）；
  - 能力演进脉络补齐 **v2.14 → v2.22** 全部关键决策（三模块成型、AudioWorklet 根治崩溃、
    `window.prompt` 崩溃、云端优先路线、跨模块麦克风解锁、截图驱动美观改造）；
  - 技术判断新增「测试脚本自身也会骗人」「CSS 两个高频陷阱」「跨模块状态必须统一解锁」三条；
  - 构建章节标注**现行命令**（`build-dist.js`）并把历史命令降级为决策依据；
  - 质量保障表补全 6 个门禁；诚实边界补云端转写需 Key/Vosk 未捆绑/假设备局限。
- **`docs/prd-voice-incremental.md` 加归档标注**（历史 PRD，非待办）：
  说明其「纯离线 WASM STT」路线**大部分未采用**，实际落地为「云端 DashScope 为主 + 本地 Vosk 为辅 +
  浏览器 Web Speech 兜底」的 auto 路线，并列表对照「本文设想 vs 实际落地」，保留全文供追溯。
- README 文档索引同步标注该 PRD 为归档件。

### 门禁（全绿，零回归）

`check` 五阶段 · `qa` **44/44** · `guardsmoke` **25/25** · `audiosmoke` **39/39** · `micsmoke` **8/8** · `respgate` **34/34**。

### 交付（MD5）

- Windows 便携版（**单文件**）`AlphaSun-AudioLab-2.22.0-portable.exe`（68.0 MB）：`d9fe36ada5bb230dee08dc347087d7c1`
- Linux x64 `AlphaSun-AudioLab-2.22.0-linux-x64.tar.gz`（98.9 MB）：`d4c3f45173528e19d08a07901d9d104a`
- Android 自签 release `AlphaSun-AudioLab-2.22.0.apk`（6.0 MB，versionCode 37）：`b1e6f52f6cc04c078896bcf9e0708973`
- 旧版本产物已清理：`dist/` 仅保留当前版三件（v2.21.0 已删，均已发布到 Release 且可再生）。
- 三处源码 MD5 一致（根 / `www/` / Android assets）。

## v2.21.0（2026-10-03）—— 界面真实截图审查 + 修复三处 CSS 污染缺陷（大窗口首次真正生效）

### 缘起：建立「视觉证据」基础设施

以往美化改动靠**凭想象改 CSS**，无法判断改完是变好还是变丑。本轮新增
`tools/ui-shot.js`（`npm run uishot`）：用假麦克风**真机渲染**，把主界面（默认/采集）、
语音转写大窗口、环境采集、值守台全屏、手机竖屏、手机横屏共 **8 张截图**输出到
`.workbuddy/shots/`，**用真实渲染结果驱动美观改造**（本次三个缺陷全部由此发现）。

### 修复 ①：`.hint` 通用类名被空态浮层规则污染（影响全项目）

- **现象**：语音转写窗口内多行说明文字**互相重叠**、底部说明浮到波形框上方；
  环境采集/值守面板同类问题。
- **真因**（DOM 几何实测定位，非猜测）：第 459 行有一条为主画布空态设计的规则
  `.hint{position:absolute;inset:0;display:flex;…}`，而 `.hint` 是**全项目通用类名**，
  被三个工具面板的所有静态说明文字继承 → 每个说明文字都被绝对定位铺满整个容器、互相重叠。
  诊断证据：`element.matches()` 显示这些说明的 `position:absolute; top:0; height:691px`。
- **修复**：把该规则收窄为 **`#hint`**（唯一真正的空态浮层容器），通用 `.hint` 回归静态文本。
  **一次性修复全部三个面板**，并让状态文字（`asrStat`「待命」、`asrKeyStat`、`envStat`）归位。

### 修复 ②：语音转写「大窗口」选择器写错 class，从未生效（v2.19.0 回归）

- **真因**：v2.19.0 的大窗口 CSS 写作 `.asrMask .toolcard{…}`，但实际 DOM 是
  `<div class="toolmask" id="asrMask">` —— **class 是 `toolmask`，`asrMask` 只是 id**。
  故 `.asrMask .xxx` 从来没匹配上，`height:min(92vh,880px)` 形同虚设，窗口其实是被内容撑开。
  诊断证据：`body.matches('.asrMask .toolbody')` 返回 **false**，而 `closest('#asrMask')` 为 true。
- **修复**：选择器全部改用 **`#asrMask`**（id 可靠），大窗口**首次真正生效**。

### 修复 ③：双层滚动 + flex 挤压导致布局溢出

- `.toolcard` 基础样式已有 `max-height:90vh;overflow:auto`，此前又给 `.toolbody` 加
  `overflow-y:auto` → **双滚动条**；且 `.asrout{flex:1}` 在错误选择器下未生效，
  底部说明被 `flex:1` 挤出容器。
- **修复**：滚动只保留一层（`.toolcard` 滚），`.toolbody` 用 `flex:1 1 auto;min-height:0`
  填满剩余空间；`asrout{min-height:140px}`、`asrwavebox`/`.toolrow`/`>.hint` 均 `flex:none`。

### 交付（MD5）

- Windows 便携版（**单文件**）`AlphaSun-AudioLab-2.21.0-portable.exe`（68.0 MB）：`1a060126e3ee2195ea0e7fe198084eb4`
- Linux x64 `AlphaSun-AudioLab-2.21.0-linux-x64.tar.gz`（98.9 MB）：`888ba6883e1865e7a5432663525d1ae6`
- Android 自签 release `AlphaSun-AudioLab-2.21.0.apk`（6.0 MB，versionCode 36）：`de8e0b1f38578492a325f03172dae3ff`
- 旧版本产物已清理：`dist/` 仅保留当前版三件（v2.19.0 / v2.20.0 共 5 个文件已删，均已发布到 Release 且可再生）。
- `npm run sync` 三处源码 MD5 一致（根 / `www/` / Android assets）。

### 已知限制（诚实标注）

- **macOS 包**（zip/dmg）：electron-builder 硬性要求 **macOS 主机**，Windows 上无法交叉构建。
- **iOS / iPadOS IPA**：需 macOS + Xcode + Apple Developer 账号签名，本环境不可为；
  但 `ios/` 工程与全部代码已就绪同步，按 `docs/iOS-macOS-构建指南.md` 在 Mac 上即可出包。
- 横竖屏与触摸适配已内置（17 个响应式断点 + `viewport-fit=cover` 安全区 + 触摸目标 ≥44px），
  已在手机竖屏/横屏视口下由 `respgate` 34 项验证；但**真机触控手感**仍建议在 iOS/Android 真机上过一遍。

### 防回归

- 全部门禁零回归：`check` 五阶段全绿 · `qa` **44/44** · `guardsmoke` **25/25** ·
  `audiosmoke` **39/39** · `micsmoke` **8/8** · `respgate` **34/34**。
- 清理排错过程临时脚本（`_diag-asr`/`_diag-css`/`_diag-hint`），保留 `ui-shot.js` 作为长期工具。

### 文档同步（本轮另一重点）

四份文档此前严重滞后于代码（README/架构说明停在 v2.13.0、iOS-macOS 指南停在 2.0.0），
本轮全部对齐到 v2.21.0 现状：
- `README.md`：补音频工具集三大模块能力表、11 项门禁脚本清单、构建坑（Synology 盘 rcedit）、
  五种交付形态与真机限制。
- `docs/架构说明.md`：新增 2.0 跨模块麦克风协调、2.7 语音转写架构、2.8 值守台判定模型；
  崩溃防线补 `ScriptProcessorNode` 与 AudioWorklet 类型两条；数据结构表补 5 个模块状态。
- `docs/测试与回归.md`：补四个真机冒烟门禁与铁律、两条新踩坑（闭包内符号 evaluate 不可达、
  假设备复现不了设备独占）、更新发布流程为 gh API GET-first 方案。
- `docs/iOS-macOS-构建指南.md`：版本号表更新、补充 iOS 横竖屏/刘海屏/44px 触摸适配说明与易漏点。

## v2.20.0（2026-10-03）—— 麦克风占用全链路排错与整改（各采集连带失败修复）

### 用户报告与复盘

> 「点击**开始采集**，出现错误『❌ 麦克风被其他程序占用 → 请关闭正在使用麦克风的软件（或重启电脑）后重试』；
> 其他音频采集也都出错，看看是不是关联性都出问题。」

「一个模块出错、其它采集全部连带失败」是典型的**跨模块麦克风流残留**特征：应用内多路 `getUserMedia`
（主采集 / 环境采集 / 值守 / 转写 / 二级台实时波形）互不知情，任一路异常残留就会占住设备，
其余模块再 `getUserMedia` 全部撞上它 → `NotReadableError`（对外显示为「麦克风被其他程序占用」）。

### 排错定位（三个真实缺陷，互相叠加）

1. **跨模块残留流（主因）**：各采集启动前**互不清理**他方流。主采集 `start()`、环境 `envStartCapture`、
   值守 `alBegin`、转写 `asrCapStart` 都直接 `getUserMedia`，若先前某模块（如二级台 `l2LiveOwnMic`
   自开的 `L2.liveStream`、或值守/转写中途失败的 `alStream`/`ASR_CAP.stream`）未释放，
   后续所有采集都会被锁死。
2. **异常路径流泄漏**：`envStartCapture`/`alBegin`/`asrCapStart` 均为「先 `getUserMedia` 成功拿到流，
   再做 `addModule`/`new AudioWorkletNode` 等可能抛错的初始化」。抛错时流已开但函数中断；
   `asrBegin` 的 catch 更是**只 `toast` 不释放、按钮不复位** → 麦克风被永久占用、界面卡在采集态。
3. **`l2LiveOwnMic` 竞态**：`micAsk` 标志在 `.then` 链末才复位，慢设备下多帧可并发开多路麦克风，
   反而自己把设备占死。

### 整改内容（index.html，10 处）

- **新增跨模块解锁函数 `releaseGhostMic(keep)`**：启动任一采集前，释放「所有其它模块处于非活跃态
  却仍残留」的麦克风流 + 二级台自开流；`keep` 参数标记发起者（`main`/`env`/`guard`/`asr`），
  正在使用的设备不被夺走。**根治「一个模块失败 → 锁死其它全部采集」**。
- **四处采集启动前接入**：`start()`→`releaseGhostMic('main')`、`envStartCapture`→`'env'`、
  `alBegin`→`'guard'`、`asrCapStart`→`'asr'`。
- **异常路径兜底**：`envStartCapture`/`asrCapStart` 的 `getUserMedia` 成功后用 `try/catch` 包裹初始化，
  失败即释放流并 `throw`；`asrBegin` 失败补 `asrCapStop()` + 「开始/停止」按钮复位。
- **修 `l2LiveOwnMic` 竞态**：`micAsk` 同步置位、结束统一复位，杜绝并发开多路流。
- 副带修复：把 `start()` 之前 `status` 元素查询的脆弱写法收敛（不改变行为）。

### 防回归：麦克风占用专项真机冒烟（新增）

- `tools/mic-smoke.js`（`npm run micsmoke`）**8 / 8 全绿**：以**真实 UI 点击**驱动
  （主采集开/停 → 环境采集/值守/转写依次启停 → 断言各按钮与值守台完全复位 → 全程零 pageerror），
  守住「整条采集链路不被自己占死、无跨模块流残留」。
- 新增 `package.json` 脚本 `micsmoke`；**清理**排错过程临时脚本 `_mic-probe.js` / `_mic-diag.js`（不入库）。

### 诚实边界（重要，勿误读门禁强度）

- 本环境 Chrome **假设备允许同一麦克风被多路 `getUserMedia` 并发占用**（`micsmoke` 编写期实测：
  第一路存活时第二/三路均 `ok`，永不返回 `NotReadableError`）。
  因此**真机上「被其它真实软件占用」→ `NotReadableError` 的独占冲突无法在本自动化环境复现**
  （需真实麦克风 + 真正占用它的软件）。`micsmoke` 断言的是**整改逻辑本身**
  （残留流被清、跨模块不互锁、启动成功、按钮复位、流不泄漏），这些在真机同样成立。
- 若用户在真机仍遇「麦克风被占用」，请先确认**是否真有其它软件**（如微信会议/Teams/钉钉/录屏）
  开着麦克风 —— 本应用已确保「自己不会占死自己」；若是外部软件占用，属操作系统层面，需关闭外部软件。

### 门禁（全绿，零回归）

- `npm run micsmoke` **8 / 8**（新增）· `npm run check` 五阶段全绿（validate+语法+算法+三处源码 MD5+资源）。
- 回归：`npm run qa` **44 / 44** · `npm run guardsmoke` **25 / 25** · `npm run audiosmoke` **39 / 39**（均与 v2.19.0 一致）。
- 版本 v2.20.0 / versionCode 35。

## v2.19.0（2026-10-03）—— 语音转写改名 + 大窗口自动升降级 + 声波警戒值守台重构

### ① 语音转写改名（全量）

- 「会议语音转写」统一改名为「**语音转写**」：工具菜单项、面板按钮、模块标题、说明文案、诊断文本、弹出层 `title`、以及 `openTool` 分支全部同步改名（共 8 处）。
- 门禁脚本（`qa-gate` / `audio-tools-smoke` / `guard-smoke`）同步改名，避免运行期找不到 `data-tool='语音转写'`。

### ② 语音转写：大窗口 + 云/本地自动升降级（核心）

- **大窗口**：转写弹窗改为 1080×880 大面板（`.asrMask .toolcard{max-width:min(1080px,96vw);height:min(92vh,880px)}`），波形区 `flex:1` 占满、转写文本可滚动，长时间实时转写不再拥挤。
- **自动模式（默认）**：`asrMode` 新增 `auto`（默认 selected）。
  - `asrBestEngine()` 按优先级探测最优引擎：**云端 DashScope（keyStatus）→ 本地 Vosk（离线模型/探测）→ 浏览器 Web Speech → 不支持**；
  - `asrAutoTick()` 每 12 秒在转写进行中平滑切换：云端不可用自动降级本地/Web Speech，云端恢复自动升级回云端；
  - 引擎徽标前缀「自动 · 」如实标注当前链路（实测默认态：`自动 · 引擎：Web Speech（浏览器在线）`）。
- **实时转写保证**：录音链路沿用 v2.17.x 的 AudioWorklet 直采（`index.html` 内已无 `ScriptProcessorNode`），`qa-gate` / `audio-tools-smoke` 均实测「开始转写 4 秒后计时在走、页面未崩溃」。

### ③ 声波警戒值守台重构

- **日志清理 + 导出**：`alertClrLog`（清空值守日志，confirm 二次确认）+ `alertExpLog`（导出）齐备，`guard-smoke` 已实测清空生效（条目归零、未崩溃）。
- **左上电平表缩小**：新增 `gLevel` 画布（210×62，`pointer-events:none`，左上角），`alDrawLevel()` 分段色带 + 预警/告警标记 + 文字读数，**不遮挡主波形**。
- **顶部中央经典环谱缩小**：`gRing` 改为 150×150 居顶中央显示，**不遮挡主波形**；`alDrawRing()` 按 `GUARD.state` 整环 + `boxShadow` 着色——**正常蓝 / 预警黄 / 告警红**，`guard-smoke` 实测告警态 `ringShadow=rgba(255,77,99,…)`。
- **左上时钟美化**：`.gClock` 渐变边框/背景/阴影，`.gT` 渐变文字（`background-clip:text`）+ `tabular-nums`，时间走时更精致。
- **媒体回放旋转**：摄像头拍照 `jpg` / 录像 `webm` 改走 `guardMediaOpen` 灯箱（替代 `window.open`），支持 **左转 90° / 复位 / 右转 90°**（`guardMediaRot` 累积旋转角），`gMedia` 遮罩 `z-index:50` 不挡交互。

### 防回归（门禁全面过关）

- `npm run qa` **44 / 44**：改名生效、大窗口居中不遮挡、auto 模式默认、`asrMode` 含 auto/cloud/local、Web Speech 兜底诚实标注。
- `npm run guardsmoke` **25 / 25**（21 → 25）：新增 gLevel 画布尺寸、环谱告警整环变红、日志清空、媒体灯箱 DOM 齐备 7/7。
- `npm run audiosmoke` **39 / 39**（37 → 39）：新增「默认模式为 auto」「auto 模式引擎探测完成」。
- `npm run respgate` **34 / 34**：大窗口触控目标、值守台多视口无溢出。
- `npm run check` 五阶段全绿（validate + 语法 + 算法自检 + 三处源码 MD5 一致 + 资源完整）。

### 交付（MD5）

- Windows 便携版（单文件）`AlphaSun-AudioLab-2.19.0-portable.exe`（68 MB）：`f5f568796b01db99f97482d1e2250c0a`
- Linux x64 `AlphaSun-AudioLab-2.19.0-linux-x64.tar.gz`（99 MB）：`46c8a9acfafd1453eae1ffeb6f608625`
- Android 自签 release `AlphaSun-AudioLab-2.19.0.apk`（6.0 MB，versionCode 34）：`951477c0725c0b5ca63d47096bf4950b`
- `npm run sync` 三处源码 MD5 一致（根 / `www/` / Android assets）；`check.js` 五阶段全绿。
- 门禁：`npm run qa` **44 / 44**；`npm run guardsmoke` **25 / 25**；`npm run audiosmoke` **39 / 39**；`npm run respgate` **34 / 34**。

### 已知限制（诚实标注，非缺陷）

- **macOS 版**：electron-builder「Build for macOS is supported only on macOS」——Windows 主机无法出 mac 包。
- **iOS / iPad IPA**：需 macOS + Xcode + Apple Developer 账号签名，本环境完全不可为。
- **auto 模式回退链**：无云端 Key 且本机未放 Vosk 离线模型时，自动降级为浏览器 Web Speech（需联网）；本地模式引擎探测对 Vosk 模型 404 并优雅回退，属预期。
- 可选离线模型（Vosk 中/英文）未捆绑进测试环境，相关 404 已在门禁中过滤（非 JS 崩溃）。

## v2.18.0（2026-10-03）—— 音频工具集全按钮崩溃排查 + 触摸/响应式盲区补全 + 全平台打包

### 核心修复：会议转写「云端设置」按钮崩溃（unhandled rejection）

上一轮修好了「开始转写即崩」，但用户反馈另有一些按钮点击后软件崩溃。本轮用**假麦克风真机**把
「音频工具集」三大工具的全部按钮逐个点了一遍（新增 `tools/audio-tools-smoke.js`），
定位到根因：`asrKeyBtn`（云端设置）处理器调用了 **`window.prompt()`**——

> Electron 渲染进程**不支持 `window.prompt`**，点击即抛 `prompt() is and will not be supported`，
> 变成 **unhandled rejection**，表现为点了按钮后软件无响应/闪退，控制台却看不到明确崩溃点。

改为**面板内联密码输入框**（与其它设置项同款），桌面端与网页端通用，彻底消除该崩溃。
（已核实 index.html 内仅此一处 `prompt()`，其余 `alert`/`confirm` Electron 原生支持，不受影响。）

### 防回归：音频工具集全按钮冒烟（新增）

- `tools/audio-tools-smoke.js`（`npm run audiosmoke`）**37 / 37 全绿**，
  覆盖「环境音频采集 / 声波警戒值守 / 会议语音转写」的全部按钮与交互：
  - 模式切换（手动/定时/声级触发）、开始/停止、保存原始录音、生成/导出评估报告、导出采集日志；
  - 推送设置展开/保存配置/发送测试（空通道）、导出值守日志、事件列表「导出全部/清空」；
  - 转写开始/停止、复制/导出文字稿、保存录音、云端设置（内联输入）、模式/语言切换触发引擎探测。
- 用 Chrome 假麦克风真跑录音链路，捕获 `pageerror` / `renderer crash` / `console.error`；
  下载与 `prompt` 弹窗由 harness 接管，避免测试窗挂死。

### 响应式/触摸盲区补全

- `tools/responsive-gate.js`（`npm run respgate`）由 **31 → 34 项**：
  新增**主界面 / 工具菜单按钮触摸目标 ≥44px** 断言（此前只量了值守台 `gExit`，
  漏量主界面与工具面板按钮）。4 视口（桌面/手机竖/手机横/平板竖）+ 触摸模拟下全部达标。
- v2.18.0 触摸层（CSS `@media(hover:none) and (pointer:coarse)`）：按钮/下拉框/输入框 `min-height:44px`、
  复选框 20px 且由外层 `label.sw` 提供 44px 点击区；值守台横竖屏/刘海屏（`env(safe-area-inset-*)`）适配。

### 交付（MD5）

- Windows 便携版（单文件）`AlphaSun-AudioLab-2.18.0-portable.exe`（68 MB）：`9ccff37670272cbd0c9f27004fe5540a`
- Linux x64 `AlphaSun-AudioLab-2.18.0-linux-x64.tar.gz`（99 MB）：`c7e94e8e5805d37d82b11bf139cec2ee`
- Android 自签 release `AlphaSun-AudioLab-2.18.0.apk`（6.0 MB，versionCode 33）：`052bf48718de90ba388ea52a6bc95e79`
- `npm run sync` 三处源码 MD5 一致（根 / `www/` / Android assets）；`check.js` 五阶段全绿。
- 门禁：`npm run qa` **44 / 44**；`npm run guardsmoke` **21 / 21**；
  `npm run audiosmoke` **37 / 37**；`npm run respgate` **34 / 34**。

### 已知限制（诚实标注，非缺陷）

- **macOS 版**：electron-builder「Build for macOS is supported only on macOS」——Windows 主机无法出 mac 包。
- **iOS / iPad IPA**：需 macOS + Xcode + Apple Developer 账号签名，本环境完全不可为。
- 可选离线模型（Vosk 中/英文）未捆绑进测试环境，本地模式引擎探测会 404 并优雅回退，属预期。

## v2.17.1（2026-10-03）—— 修复「会议语音转写」一按开始就崩溃（录音链路全面改用 AudioWorklet）

### 问题

v2.17.0 修值守台崩溃时，只换了值守那一处录音支路。事后排查发现**会议语音转写用的是同一个
`ScriptProcessorNode`**，因此自 **v2.15.0 起就带着同样的崩溃缺陷**：点「开始转写」后
**渲染进程立刻崩溃**（`[CRASH] renderer crashed`），计时器停住、界面卡死。

用假麦克风真机复现确认：点击后 1 秒内必崩。这也是为什么此前只有 DOM 级门禁（44/44 全绿）
却完全没发现——**DOM 齐了 ≠ 流程能跑**。

### 修复

- `asrCapStart()` 的采集支路改为 **AudioWorklet 直采 PCM**（复用项目统一的 `as-rec`，
  与环境采集、警戒值守同款）；经零增益节点汇入 destination，只让节点被拉取、不回放。
- 本地 Vosk 分支原直接把 `ev.inputBuffer`（AudioBuffer）喂给 `acceptWaveform`；
  改用 AudioWorklet 后拿到的是 `Float32Array`，故按需现场 `createBuffer + copyToChannel` 还原成 AudioBuffer
  （仅在 Vosk 实际启用时才构造，不增加常态开销）。
- 至此 `index.html` 中**已无任何 `ScriptProcessorNode`**（全局检索计数为 0）。

### 防回归

- 冒烟脚本 `tools/guard-smoke.js`（`npm run guardsmoke`）由 19 项扩到 **21 项**，
  新增「会议转写录音链路存活」断言（开始转写 4 秒后计时在走、页面未崩溃），
  并把事件归档断言改成**两段式**：
  ① 自动本底模式测状态机；② 手动极低阈值（−120 dB）**确定性造出事件**，
  不再依赖假设备的发声时机（此前偶发 0 事件导致误报）。

### 交付（MD5）

- Windows 便携版 `AlphaSun-AudioLab-2.17.1-portable.exe`（68 MB）：`5cf69fbfcbf17a31384c2ef08f9ccd00`
- Linux x64 `AlphaSun-AudioLab-2.17.1-linux-x64.tar.gz`（99 MB）：`b2daece734cc96becd34f4bcba14bf1a`
- `npm run sync` 三处源码 MD5 一致（根 / `www/` / Android assets）；`check.js` 五阶段全绿。
- 门禁：`npm run qa` **44 / 44**；`npm run guardsmoke` **21 / 21**；`npm run envtest` **32 / 32**。
- `index.html` 全局检索 `ScriptProcessorNode` 计数为 **0**（两条录音链路均已改用 AudioWorklet）。

## v2.17.0（2026-10-03）—— 声波警戒值守台：全屏值守 / 波形+环形仪表 / 三色警戒灯 / 事件记录 / 摄像头联动 / 告警推送

### ① 全屏值守台（新增，核心）

- 点「▶ 开始值守」后进入**全屏值守界面**（桌面端走主进程 `win:fullscreen`，浏览器端退化为元素全屏），
  顶部为**实时时钟 + 日期 + 星期**、当前 dB、本底/预警/告警阈值条、值守时长、状态徽标、退出按钮（Esc 亦可退出）。
- 中部左侧为**滚动实时音频波形**，右侧为**经典环形声级仪表**：-60~0 dB 映射 240° 弧、刻度环、
  预警/告警阈值标记、当前值发光弧 + 指针 + 中心读数（dB 与本底）。
- 中部右列为**三色警戒灯**：🔴 告警 / 🟡 预警 / 🔵 正常（当前状态灯点亮并呼吸），
  附本底、峰值、事件计数读数。
- 底部为**事件集中区**：列表 + 全部导出 + 清空。
- ⚠ 值守台与 `#toolsMenu` 同为 **body 直属**——`.app` 带 `z-index` + `zoom` 会形成层叠上下文，
  放进去会被主画布遮挡（v2.14.1 已踩过一次）。

### ② 先评估本底，再判警戒（判定模型升级）

- 开局先做**本底评估**（默认 5 秒，可设 2~60 秒）：取声级序列的 **L90** 作本底，避开偶发峰。
- 阈值 = 本底 + 余量（默认**预警 +8 dB / 告警 +15 dB**，均可调）；也可关闭自动评估改用**手动阈值**。
- 旧版的「方向（高于/低于）」选择器已移除——新逻辑只有"超过阈值"语义，留着是死控件。
- 状态机：`idle → eval → normal(蓝) / warn(黄) / alarm(红)`；声级回落至正常并持续设定秒数后结束事件，
  单事件最长时长可限（默认 120 秒）防长鸣不收。

### ③ 事件记录（起止时间 / 音频分析 / 录音回放 / 集中导出）

每个事件自动记录：

- **开始与结束时间**、时长、峰值/平均声级、**相对本底抬升量**、**超阈时间占比**；
- **事件音频**（WAV，界面内直接`<audio>`回放，桌面端自动落盘）；
- 分析结果可单条导出（分析 txt + wav），也可**全部导出**（txt 汇总 + **csv** 便于统计）；
- 所有事件集中显示在值守台底部，按时间倒序，颜色区分级别。

### ④ 告警联动摄像头（抓拍 + 录像）

- 达到**告警**级别时自动调用摄像头：默认/指定设备（`getUserMedia`），
  **抓拍 JPG** 与**录制 WebM**（时长可设，默认 15 秒），一并写入事件记录，缩略图与视频按钮可直接查看。
- 桌面端经主进程落盘到 `下载目录/AlphaSun警戒事件/<YYYYMMDD>/`，与事件音频同目录同命名规范。
- ⚠ 摄像头不可用时降级并记录诊断日志，不静默失败。

### ⑤ 告警推送

- 支持 **企业微信群机器人 / 钉钉机器人 / 飞书机器人 / Server酱（→微信）/ 自定义 Webhook / 阿里云短信**，
  告警时并发推送，逐通道回显成功失败；配置存本机 `localStorage`，可点「测试」验证连通性。
- 推送一律在 **Electron 主进程**发出（渲染进程直连会被 CORS 拦，且 Key 会泄露给网页）。

### 已知限制（务必阅读）

- **个人微信 / QQ 无官方消息发送接口**，无法直接推送到个人微信或 QQ；
  如需触达微信请走「企业微信群机器人」或「Server酱」中转。
- **短信需自备阿里云账号**（AccessKey / 已备案签名 / 模板），属付费服务。
- **推送与摄像头在本环境均未真机实测**（无机器人凭据、本轮未接摄像头实测）；
  首次使用请先用「告警推送设置 → 测试」验证。
- **网络摄像头（RTSP / ONVIF）浏览器取不到流**，本轮不支持；仅本地/USB 摄像头。手机端需待 APK 重签后验证。
- 声级为**相对满量程的数字电平**，未经声级计校准，**不可作合规判定或法定测量依据**。
- APK 需本机签名重编（本环境无签名密钥），故本轮仍只发布 Windows / Linux 产物。

### 质量门禁

- `node tools/check.js` 全绿；`npm run qa`（Electron 真机）**44 项全通过**（新增第 9 组值守台 11 项）；
  `npm run envtest` 32 项全通过。
- 反向验证：改 `gWave` id / 改默认可见 / 拆掉蓝色正常灯 → 门禁**均被拦截报错**，确认断言非装饰。

### 构建后实测修复（重要：首版产物已作废并替换）

首版 v2.17.0 产物构建完成后，又用**假麦克风真机跑了一遍值守全流程**（`npm run guardsmoke`），
暴露两个只在运行期才现形的缺陷，均已修复并**重新构建、替换了 Release 资产**：

1. **开始值守即渲染进程崩溃**。事件录音原用 `ScriptProcessorNode`（已废弃），
   在本机 Electron 28 下开始值守后**必崩**（`[CRASH] renderer crashed`，值守台再也起不来）。
   → 改为复用项目统一的 **AudioWorklet 直采 PCM**（`as-rec`，与环境采集/会议转写同款），崩溃消失。
2. **顶部「事件数」在退出后不刷新**。事件归档依赖下一帧 `requestAnimationFrame` 更新读数，
   而退出流程紧接着就 `cancelAnimationFrame` → 计数停在 0，与底部列表已列出的事件自相矛盾。
   → `alEvFinish()` 归档后**立即**调用一次 `alPaintTop()`，不再依赖下一帧。

> 若你已下载首版 v2.17.0（EXE MD5 `8e96c45ad244559b81e5782826f565f0`），**请重新下载**。

### 交付（MD5）

- Windows 便携版 `AlphaSun-AudioLab-2.17.0-portable.exe`（69 MB）：`49bf7812eaa4cc1c338a06f892217964`
- Linux x64 `AlphaSun-AudioLab-2.17.0-linux-x64.tar.gz`（99 MB）：`1dff36b82c7d447f9cee48828376b6d6`
- `npm run sync` 三处源码 MD5 一致（根 / `www/` / Android assets）：`dd949d8d1fd288d4c3efd37ef67c28bc`；`check.js` 五阶段全绿。
- 门禁：`npm run qa`（Electron 真机）**44 / 44 通过**；`npm run envtest` **32 / 32 通过**。
- 反向验证：改 `gWave` id / 值守台默认改为可见 / 拆掉蓝色正常灯 —— 三次变异**均被门禁拦截**，还原后 `index.html` 与变异前逐字节一致。
- 构建中间产物已全部落在系统 TEMP 并自动清理，最终产物回落到项目内 `dist/`；`C:\Users\net2n\` 无新增产物残留。

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
