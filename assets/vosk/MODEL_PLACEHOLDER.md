# 离线语音模型放置说明（Vosk）

当前状态：**本仓库不包含离线模型**，会议语音转写默认走 **Web Speech（在线）**。
界面上的「引擎」标签会**如实显示当前实际使用的引擎**，不会谎报离线。

## 为什么没有随包发布模型

| 项 | 值 |
|---|---|
| 中文小模型 `vosk-model-small-cn-0.22` | 约 42 MB（压缩包） |
| 对二进制体积影响 | 便携版 66 MB → 约 110 MB+ |
| 打包格式要求 | 必须是 **`model.tar.gz`**（gzipped tar），不是官方 `.zip` |
| 额外人工步骤 | `model/conf/model.conf` **官方模型不提供，需自行编写**（解码 beam / 静音音素） |

体积与兼容性代价较大，因此默认不内置；需要时按下面步骤自行放置。

## 放置步骤

1. 下载模型（官方源，本环境已验证可直连）：
   `https://alphacephei.com/vosk/models/vosk-model-small-cn-0.22.zip`（约 42 MB）

2. 解压后**重打包为 `model.tar.gz`**，目录结构需为（注意是 `model/` 下的内容，不是含 `model/` 外层）：
   ```
   model/am/final.mdl
   model/conf/mfcc.conf
   model/conf/model.conf        ← 必须自建，见下
   model/graph/HCLG.fst（或 Gr.fst + HCLr.fst）
   model/graph/phones.txt
   model/graph/words.txt
   ```
   Linux/macOS：
   ```bash
   tar -czf model.tar.gz -C vosk-model-small-cn-0.22 model
   ```
   Windows（PowerShell）：
   ```powershell
   tar -czf model.tar.gz -C vosk-model-small-cn-0.22 model
   ```

3. 编写 `model/conf/model.conf`（官方模型不含此文件）。可从同系列其它模型的
   `conf/model.conf` 复制，或按 Vosk 示例自建，典型内容：
   ```
   --min-active=200
   --max-active=7000
   --beam=13.0
   --lattice-beam=6.0
   --silence-phone=1
   ```

4. 放到本目录：
   ```
   assets/vosk/model.tar.gz
   ```

5. 重新运行软件（无需改代码）。打开「音频工具集 → 会议语音转写」，
   引擎标签应显示 **「引擎：Vosk 离线（本地模型）」**；仍显示在线则说明模型未被识别，
   可用「导出运行日志」查看诊断记录。

## 运行时说明

`assets/vosk/vosk.js`（约 5.8 MB，`vosk-browser@0.0.8`）**已随包发布**，
但采用**惰性加载**：仅当检测到 `model.tar.gz` 存在时才会注入并加载，
因此在未放置模型时不会产生任何体积/内存开销。

## 已知限制（未验证项）

- **离线中文识别的准确率尚未验证**：缺少中文语音样本做端到端评测，
  音质、方言、专业词汇（电力/网络安全术语）场景需你实测评估后再决定是否默认启用。
- 离线引擎任一环节失败会**自动回退在线引擎**并在界面提示，不会让转写功能卡死。
