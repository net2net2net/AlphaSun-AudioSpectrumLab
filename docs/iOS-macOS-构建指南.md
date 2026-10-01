# AlphaSun 声波分析仪 · iOS / macOS 版本构建指南

> 重要说明：Apple 平台（iOS IPA / macOS APP）受苹果工具链限制，**只能在 macOS 电脑上构建**（需要 Xcode）。
> Windows 电脑无法交叉编译出 IPA，也无法打包 macOS 的 dmg/zip（electron-builder 硬性限制）。
> 本项目的 iOS 与 macOS 工程已全部生成并同步最新代码，拿到任意一台 Mac 后按下面步骤 10 分钟即可出包。

## 前置条件（Mac 上一次性准备）

1. App Store 安装 **Xcode**（14 以上）。
2. Xcode → Settings → Accounts 登录 Apple ID（免费账号即可真机调试自己的设备；分发给别人需要付费开发者账号 99 美元/年）。
3. 项目目录拷贝到 Mac（U 盘 / 网盘 / git 均可），确认目录里 `ios/` 与 `android/` 已存在（本项目已包含）。
4. Mac 上安装 Node.js LTS，然后在项目根目录执行：

```bash
npm install          # 安装依赖（Capacitor 等）
npm run sync         # 同步最新 web 代码到 iOS/Android 工程
```

## 构建 iOS 版（IPA，iPhone / iPad 通用）

```bash
cd ios/App
pod install                        # 首次需要（Mac 自带 ruby 即可）
open App.xcworkspace               # 注意：必须打开 .xcworkspace，不是 .xcodeproj
```

在 Xcode 中：

1. 左侧选中 **App** 项目 → Signing & Capabilities：
   - Team 选择你的 Apple ID（Personal Team 也可）；
   - Bundle Identifier 改成唯一值，例如 `com.alphasun.audiolab.你的名字`；
   - 勾选 **Automatically manage signing**。
2. 顶部设备选择你的 iPhone/iPad（或任一 iOS Simulator）。
3. 连接真机：iPhone 上弹窗选择"信任"，并在 设置→隐私与安全性→开发者模式 打开开发者模式（iOS 16+ 需要）。
4. **真机直装**：选中设备 → ▶ Run，装好即可使用。
5. **导出 IPA 文件**：Product → Archive → 结束后在 Organizer 里 **Distribute App → Ad Hoc / Development** → 导出得到 `App.ipa`。

> 信息说明：应用所需权限描述（麦克风）已在工程 Info.plist 配好：`NSMicrophoneUsageDescription`。
> 本应用完全本地计算、不上传任何音频数据。

## 构建 macOS 版（APP / DMG）

方式一（最简单，直接得到可运行的 App）：

```bash
cd ios/App && open App.xcworkspace   # 同一工程也可选 My Mac 目标
# Xcode 顶部目标选 "My Mac" → Product → Archive → 导出 Copy Mac Application
```

方式二（electron 版，打 zip/dmg）：

```bash
npm install
npx electron-builder --mac          # 在 Mac 上执行，得到 dmg + zip
```

> 建议用方式二，与 Windows/Linux 版同源（Electron 28），界面与功能完全一致。
> 未付费签名时，首次打开需右键 → 打开（绕过 Gatekeeper 提示）。

## 版本号对照（务必与主工程一致）

| 平台 | 文件 | 当前版本号位置 |
|------|------|----------------|
| 全部界面显示 | index.html | `APP_VER`（v2.0.0） |
| Windows / Linux / macOS（Electron） | package.json | `version`（2.0.0） |
| Android | android/app/build.gradle | `versionName "2.0.0"` / `versionCode 8` |
| iOS | ios/App/App/Info.plist | `CFBundleShortVersionString`（如仍是 1.0 请改为 2.0.0） |

iOS 版本号也可以直接在 Xcode 里改：App → General → Identity → Version 填 `2.0.0`，Build 填 `7`。

## Android 构建（Windows 本机已完成）

```bash
cd android
gradlew.bat assembleDebug           # 产出 app/build/outputs/apk/debug/app-debug.apk
```

- 产物即免安装直装包（debug 签名，可直接发给任何 Android 手机/平板安装）。
- 分发建议：把 app-debug.apk 重命名为 `AlphaSun-AudioLab-2.0.0.apk`。
- 若要上架或正式签名，需要生成 release keystore：`keytool -genkey -v -keystore alphasun.keystore -alias alphasun -keyalg RSA -keysize 2048 -validity 10000`，再在 build.gradle 配置 signingConfig。

## 各平台现状速览

| 平台 | 形态 | 构建位置 | 状态 |
|------|------|----------|------|
| Windows | 单 EXE 免安装（portable） | Windows 本机 | ✅ 已产出 |
| Android | APK 免安装直装 | Windows 本机 | ✅ 本机构建 |
| Linux | AppImage 免安装 + tar.gz | Windows 本机 | ✅ 本机构建 |
| iOS | IPA | **必须 Mac + Xcode** | 📋 本指南步骤即可 |
| macOS | zip / dmg | **必须 Mac** | 📋 本指南步骤即可 |
| 浏览器 / PWA | index.html | 任意设备 | ✅ 随源码提供 |
