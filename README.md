# AlphaSun 声波分析仪（AlphaSun-AudioSpectrumLab）

> 本地麦克风驱动的实时音频频谱可视化 + 多维度专业参数分析 + 二级分析台（声谱图 / 离线 DSP / 多格式导出）+ 内置离线判别模型 + 历史缓存与报告。
> 全部计算在浏览器/WebView 本地完成（Web Audio API），**不上传任何音频**，无外部 CDN 依赖。
> **作者：阳光 net2net2net（VX：net2net）**
>
> **当前版本 v2.13.0 · 单一真源 = 根目录 `index.html`（约 4200 行）**

## 一、它能做什么

### 主界面（实时采集分析）
- **4 种可视化**：经典环谱（72 条径向彩虹频谱柱 + 中央环形波形 + 旋转刻度环 + 节拍粒子）/ 频谱柱 / 示波器 / 极坐标。中央环点击暂停-继续；工具栏 ◀/▶ 切换；`灵敏度` 滑杆调 GainNode 增益（0.3×–6×）。
- **专业参数（多维度）**
  - 时域/电平：dBFS、RMS、Peak、Crest、ZCR、动态范围 DR、SNR(估)、噪声分级。
  - **计权声级 dB(A)/dB(C)**（v2.13.0，IEC 61672-1 计权网络）：A 计权模拟人耳低频不敏感，C 计权近线性。`dB(C)−dB(A)` 差值大 ⇒ 能量集中在低频（空调/引擎/风机嗡鸣）。
  - **统计声级 Leq · L10/L50/L90**（v2.13.0，环境噪声评价同族指标，120s 滚动窗口）：Leq 等效连续声级；L10 峰值背景、L50 中位、L90 本底；L10−L90 差值衡量起伏程度。
  - 频谱：质心、扩散、平坦度(谐性)、滚降(85%)、通量、优势频率、六段能量分布。
  - 音高/节奏：F0(自相关 + 抛物线亚样本插值)、谐性、浊音、**BPM**。
- **智能分类**：离线透明加权 + softmax，输出 人声/音乐/其他声音/噪音 四类置信度；人声子分析（性别、人数、基频起伏）；「其他声音」细化到鸟鸣/禽畜/工具/交通等启发式猜测。
- **声源定位**：GCC-PHAT 广义互相关 + 双曲线交汇；单声道设备自动启用**虚拟 3 麦三角阵仿真**（v2.12.0 起随「开始采集」自动开启），点俯视图可移动虚拟声源。
- **前景/背景分离**：谱减法 + 平稳性判别，实时区分稳态背景与前景事件。
- **舒适度警报灯**：平静/正常/不适/高危四级（RMS + 冲击性 + 持续时间门）。
- **事件日志**（毫秒级时间戳）+ IndexedDB 环形缓存 + 自包含 HTML 报告 / CSV 导出。

### 二级分析台（录制后的离线深度分析）
- **录制**：AudioWorklet 直采 PCM → WAV（产物与导入 WAV 同构，规避 MediaRecorder webm 的 `duration=Infinity` 问题）。
- **Spek 风格声谱图**：时频热图 + F0 轨迹 + 节拍分析 + 声学事件检测（点击热图可跳转播放）。
- **三项离线 DSP**：背景分离 / 软件降噪 / 人声提取。
- **多格式导出**：WAV / MP3（lamejs 离线）/ AAC（WebCodecs + ADTS）/ **FLAC（自研纯 JS 编码器）** / 原始直存。
- **波形竖立推进指示**：取代独立进度条，支持鼠标与触摸拖拉定位。

## 二、目录结构

```
AlphaSun-AudioSpectrumLab/
├─ index.html            # 核心应用（单文件）——【唯一真源，功能改进只改这里】
├─ main.js               # Electron 主进程（自动授权麦克风）
├─ preload.js            # Electron 预加载
├─ package.json          # Electron / electron-builder 配置
├─ capacitor.config.json # Capacitor 配置（webDir=www）
├─ sync-www.js           # 根目录 Web 资源 → www/（勿手改 www/）
├─ validate.js           # 构建期守卫：DOM id / E 映射 / 五点版本 / 陈旧版本
├─ cleanup-dist.js       # dist 终版清理（APK 入位 + 旧产物退场）
├─ manifest.webmanifest / sw.js   # PWA 清单与离线缓存
├─ assets/               # icon.svg/png/ico + lame.min.js（离线 MP3 编码）
├─ desktop/boot.js  mobile/bridge.js   # 平台层（validate 会校验其存在）
├─ tools/                # 回归与自检脚本（见「五、质量保障」）
├─ www/                  # Capacitor webDir（由 sync-www.js 生成）
├─ android/ ios/         # Capacitor 原生工程
├─ docs/                 # 架构说明 / 构建指南 / 需求文档
├─ CHANGELOG.md          # 版本演进（每次迭代必须追加）
├─ 过程文档.md            # 开发/构建过程细节
└─ dist/                 # 发布产物
```

根目录还有少量**历史遗留资产**（保留不动）：`test_mic.js`（早期 Playwright 麦克风冒烟）、
`selftest_bird.js`（鸟类声模板自检）、`e2e-proof*.png` / `mic_test_shot.png`（实测截图）、
`icon_render.html`（图标渲染页）、`.stale-quarantine/`（隔离的陈旧文件）。

## 三、五种交付形态（单一真源派生）

> **关键原则：只维护根目录 `index.html` 一份源码，所有打包形态都从它派生。**

| 形态 | 状态 | 命令 |
|---|---|---|
| HTML / PWA | ✅ | 浏览器打开 `index.html`（https/localhost/file:// 安全上下文） |
| Electron EXE（Windows） | ✅ 已产出 | `npm run dist:win`（portable 免安装） |
| Electron（Linux） | ✅ 已产出 | `env -u ELECTRON_RUN_AS_NODE npx electron-builder --linux tar.gz` |
| Capacitor APK（Android） | ✅ 已产出 | `node sync-www.js` → `./gradlew assembleRelease` |
| Electron（macOS）/ iOS IPA | ⚙️ 配置就绪 | 需 Mac + Xcode：`npm run dist:mac` / Xcode Archive |

改完功能后的标准同步流程：
```bash
node tools/check.js        # 一键自检（务必全绿）
node sync-www.js && node tools/cap-copy.js
# 再按需重建各平台包
```

## 四、诚实边界

- 判别模型是**离线启发式**（模板匹配 + 透明加权），非训练模型；同类声源重叠时必然混淆，结果供 human-in-the-loop 参考。
- **dB(A)/dB(C)/Leq 是相对满量程的数字电平**，未经麦克风灵敏度校准，**不是**合规声压级测量（无校准不能报法定噪声值），仅用于计权后的相对比较。
- dBFS 为相对电平，非物理声压级；SNR 是以 −60 dBFS 为噪声基底的估计。
- 语音转写依赖浏览器内置识别（Chrome + 网络）。
- 假麦克风只能证明「链路通 / 无报错 / 实时刷新」，不能证明对真人语音的识别准确度。
- Windows EXE 未签名，个别杀软可能误报。
- Linux（AppImage/deb 需 fpm 或符号链接）与 macOS/iOS（需 Mac+Xcode）只能产出到本机能力允许的范围；当前 dist 为 portable EXE、Linux tar.gz、Android APK 三件。

## 五、质量保障（迭代进化的护栏）

```bash
node tools/check.js     # 一键自检：validate + 语法 + 算法自检 + 三处源码一致 + 资源完整
```

| 脚本 | 作用 |
|---|---|
| `validate.js` | 构建期守卫：JS 引用 210 个 DOM id 全部存在、E 映射覆盖、五点版本一致、无陈旧版本残留 |
| `tools/algo-selftest.js` | 从 **index.html 源码真身**抽取算法验算：A/C 计权贴合 IEC 61672-1 标称值、BPM 命中率与非节拍拒绝 |
| `tools/check.js` | 串联全部检查（发布前必跑） |
| `tools/pw-electron-test.js` | 真实 Electron + 虚拟麦克风全链路回归（录制→声谱图→三处理→五格式保存） |
| `tools/pw-metrics-check.js` | 新增指标实跑验证：确认真的出数，而不是「不崩溃却恒显示 —」 |
| `tools/pw-flac-edge.js` | 用 Chromium 自带解码器校验自研 FLAC 产物（走 HTTP，不用 file://） |
| `tools/bump-version.js` | 版本号五点统一升级（幂等 + 回读校验） |

## 六、文档索引

- `README.md`（本文）—— 能力总览、目录、构建、边界、质量保障
- `过程文档.md` —— 开发/构建过程细节与平台差异
- `docs/架构说明.md` —— 代码结构、关键算法、数据结构与崩溃防线
- `docs/测试与回归.md` —— 各测试脚本用途、运行方式与踩坑
- `docs/iOS-macOS-构建指南.md` —— Mac 端构建步骤
- `CHANGELOG.md` —— 版本演进记录（每轮迭代追加）
