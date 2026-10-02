# AlphaSun 声波分析仪 · 版本演进（CHANGELOG）

> 每轮迭代必须追加。版本五点同步（index APP_VER / appVer span / package.json / sw.js / gradle versionName）
> 由 `node tools/bump-version.js x.y.z` 统一完成（幂等 + 回读校验）。

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
- `AlphaSun-AudioLab-2.13.0.apk`（3.4MB，versionCode 25 / versionName 2.13.0 经 aapt2 校验）`209722d3059a52c34cd9828429b64659`（本环境无签名密钥未重编，仍为含菜单热修、不含音频工具集的版本；待用户本机重编以含音频工具集 UI）
- `AlphaSun-AudioLab-2.13.0-portable.exe`（66.6MB，已重编去菜单 + 含音频工具集，版本资源 2.13.0）`cb5d884a8534d64e8b5b0c74ba9c4231`
- `AlphaSun-AudioLab-2.13.0-linux-x64.tar.gz`（94.5MB）`917d27a4118edfdeb121b6bc6381c4fb`（已含音频工具集 UI）

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
