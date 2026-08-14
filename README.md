<p align="center">
  <img src="deepseek_whale_hermes_rounded.png" width="132" alt="DeepSeek Harness Desktop 图标">
</p>

<h1 align="center">DeepSeek Harness Desktop</h1>

<p align="center">
  让 DeepSeek Harness 在 Windows 上像普通桌面应用一样安装、启动和退出。
</p>

<p align="center">
  <a href="https://github.com/Links2008/Deepseek-Harness-/releases/latest"><img src="https://img.shields.io/github/v/release/Links2008/Deepseek-Harness-?display_name=tag&style=flat-square" alt="Latest release"></a>
  <a href="https://github.com/Links2008/Deepseek-Harness-/releases"><img src="https://img.shields.io/github/downloads/Links2008/Deepseek-Harness-/total?style=flat-square" alt="Downloads"></a>
  <img src="https://img.shields.io/badge/Windows-10%20%7C%2011-0078D4?logo=windows&style=flat-square" alt="Windows 10 and 11">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="MIT License"></a>
</p>

<p align="center">
  <a href="https://github.com/Links2008/Deepseek-Harness-/releases/download/v1.1.0/DeepSeekHarness-Setup-1.1.0.exe"><strong>下载 Windows 安装器</strong></a>
  · <a href="#为什么需要桌面版">为什么做</a>
  · <a href="#从源码构建">从源码构建</a>
  · <a href="https://github.com/Links2008/Deepseek-Harness-/issues">问题反馈</a>
</p>

> [!NOTE]
> 这是围绕 [DeepSeek AI](https://github.com/deepseek-ai) 官方开源项目 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 制作的社区 Windows 桌面封装。DeepSeek AI 负责上游 Harness；本仓库负责 Windows 桌面壳、独立运行时、安装器和相关验收。

## 一分钟开始

1. 下载 [`DeepSeekHarness-Setup-1.1.0.exe`](https://github.com/Links2008/Deepseek-Harness-/releases/download/v1.1.0/DeepSeekHarness-Setup-1.1.0.exe)。
2. 运行安装向导，选择安装目录和磁盘。
3. 从桌面快捷方式或开始菜单启动 **DeepSeek Harness**。

安装包已经包含 Node.js 和 DeepSeek Harness 运行时，普通用户不需要预装 Node.js、pnpm，也不需要克隆上游源码。

## 为什么需要桌面版

| 原始使用门槛 | 桌面版的解决方式 |
| --- | --- |
| 需要准备 Node.js、pnpm、源码和依赖 | 安装器内置独立 Node.js 与完整运行时 |
| 启动依赖命令行和固定工作目录 | 提供桌面与开始菜单快捷方式 |
| Web 页面缺少桌面窗口控制 | 左上角独立原生三色控件，不受设置页模糊影响 |
| 任务结束后需要反复切回窗口查看 | 后台或最小化时发送 Windows 完成通知，点击即可回到结果 |
| 图标、任务栏和快捷方式不统一 | 使用统一的圆角鲸鱼图标 |
| 安装路径固定或安装过程缓慢 | 向导式 NSIS 安装器，可选磁盘并使用 ZIP 载荷 |
| 担心配置或会话被打进安装包 | 不打包用户的 `~/.dsh`、凭据、Cookie 或会话 |

## 核心功能

- Windows 10/11 x64 桌面应用。
- 内置独立 Node.js 与 DeepSeek Harness 运行时。
- 自动启动 Web 后端，关闭窗口时同步清理后端进程与端口。
- 无边框圆角窗口，支持最小化、最大化、还原和退出。
- 首个可见帧前完成圆角处理，设置页切换不再出现方角闪烁。
- 10px 红黄绿窗口控件使用独立原生覆盖层，带 120ms 可见按压反馈。
- 最大化/还原时保存正确的窗口边界，并使用 160ms 缓动过渡。
- 后台任务由“运行中 → 完成/空闲”的真实状态边沿触发 Windows 通知，等待审批或回答不会误报。
- 单实例启动：重复点击快捷方式会恢复并聚焦现有窗口，不会重复启动后端。
- 冷启动先显示本地启动页，自动更新检查不再被后端初始化阻塞。
- 后台检查 GitHub Releases，下载完成后在退出应用时自动安装更新。
- GitHub Actions 每天检查 DeepSeek Harness 上游，构建通过安装、HTTP 200 和进程清理验收后才发布。
- 自动创建桌面快捷方式、开始菜单入口和卸载项。
- 安装时可选择目录和磁盘。
- 保留当前 Windows 用户已有的 `~/.dsh` 配置与会话。

## 下载与校验

| 项目 | 内容 |
| --- | --- |
| 当前版本 | `v1.1.0` |
| 安装器 | [`DeepSeekHarness-Setup-1.1.0.exe`](https://github.com/Links2008/Deepseek-Harness-/releases/download/v1.1.0/DeepSeekHarness-Setup-1.1.0.exe) |
| 文件大小 | `342,939,120` 字节（约 `327.05 MiB`） |
| SHA-256 | `C24B63A01036F910FFA7BDA7A84B0D666B4E4DAF5962FC6DDAA1E1BB46912E40` |
| 系统要求 | Windows 10/11 x64 |

安装器暂未使用商业代码签名证书，Windows SmartScreen 可能显示“未知发布者”。你可以对照上面的 SHA-256，并审计本仓库中的桌面壳与构建配置。

## 已验证行为

- 安装器可选择安装目录和磁盘。
- 安装载荷包含 21,016 个文件；7-Zip 完整性测试结果为 `Everything is Ok`。
- `v1.0.1` 修复安装载荷的 ZIP/7z 格式错配，避免“Failed to decompress files”。
- `v1.1.0` 修复首次显示与设置页切换的圆角闪烁，三色控件在设置模糊层上保持清晰。
- `v1.1.0` 加入三色控件点击反馈、最大化/还原缓动、单实例保护、冷启动页和后台任务完成通知。
- 自动更新元数据 `latest.yml` 和安装目录内的 `app-update.yml` 已生成并验证。
- 内置 DeepSeek Harness CLI 版本为 `0.1.0-rc.5`。
- 安装后 Web 根页面返回 HTTP 200。
- 后端进程使用安装目录内的 `resources/node/node.exe`。
- 正常关闭后，桌面主进程、后端进程和 3080 端口均退出。
- 最小化、最大化、还原和关闭已在 Windows 实机验证。

## 从源码构建

### 1. 安装桌面端依赖

```powershell
npm ci
```

### 2. 打包官方 DeepSeek Harness 发布族

在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 源码仓库完成官方构建，然后打包 `vendor` 与 `dsh` release families：

```powershell
pnpm run release:pack --family vendor --out D:\dsh-desktop\work\packed-vendor
pnpm run release:pack --family dsh --out D:\dsh-desktop\work\packed-dsh
```

### 3. 生成独立运行时

```powershell
node scripts\create-runtime-manifest.mjs `
  bundle\dsh-runtime `
  work\packed-vendor `
  work\packed-dsh

Set-Location bundle\dsh-runtime
npm install --no-audit --no-fund --package-lock=false --include=optional
Set-Location ..\..
```

不要使用 `--omit=optional`：`koffi` 的 Windows 预编译二进制属于 optional dependency，省略后可能回退到本机 CMake 编译。

### 4. 放入 Node.js 并构建

```powershell
New-Item -ItemType Directory -Path bundle\node -Force
Copy-Item (Get-Command node.exe).Source bundle\node\node.exe

npm test
npm run build:installer
```

安装器输出到 `installer-dist/`。

## 项目结构

```text
.
├─ main.js                         Electron 主进程与窗口控制
├─ preload.js                      安全的窗口控制 IPC 桥
├─ window-controls.html            独立原生三色窗口控件
├─ electron-builder.yml            NSIS、图标和运行时打包配置
├─ package.json                    项目元数据与构建命令
├─ upstream-lock.json               当前跟随的 DeepSeek Harness 提交
├─ .github/workflows/
│  └─ upstream-sync.yml             上游检测、构建、验收和发布
├─ scripts/
│  └─ create-runtime-manifest.mjs  生成独立运行时清单
├─ tests/
│  ├─ installer_runtime.test.js    安装器配置回归测试
│  └─ window_chrome_update.test.js 窗口与自动更新回归测试
└─ deepseek_whale_hermes_rounded.* 应用图标
```

构建所需的 `bundle/`、`node_modules/`、安装产物、日志和工作目录均由 `.gitignore` 排除。

## 安全与隐私

本项目不会把以下内容提交到仓库或写入公开安装包：

- `.credentials.yaml`
- API Key、Token 或 Cookie
- `~/.dsh` 用户状态
- 会话、登录状态与本机日志
- `node_modules`、运行时缓存和构建缓存

桌面应用运行时继续使用当前 Windows 用户自己的 `~/.dsh`。卸载或重装桌面壳不会主动删除这些配置。

## 已知说明

- DeepSeek Harness 上游目前处于 Developer Preview，可能出现不兼容更新。
- 电脑已安装 Harness 时不会被覆盖：3080 上已有 Harness 会被复用；未运行时桌面版使用自己的内置运行时。用户自行启动的 Harness 也不会在关闭桌面窗口时被结束。
- 首次启动需要生成 Web profile，部分电脑可能需要约 30–70 秒。
- `v1.0.1` 本身没有更新客户端，需要手动安装一次 `v1.1.0`；之后的桌面版本可自动更新。
- 已安装旧版时，NSIS 会按更新处理并沿用原安装目录；如需更换磁盘，请先卸载旧版。
- 当前安装器没有商业代码签名，SmartScreen 提示不代表文件校验失败。

## 参与贡献

欢迎通过 [Issues](https://github.com/Links2008/Deepseek-Harness-/issues) 报告 Windows 安装、窗口控制、进程退出或打包问题。提交修复时，请保持改动聚焦，并先运行：

```powershell
npm test
```

## 贡献者与致谢

| 贡献者 | 贡献 |
| --- | --- |
| [DeepSeek AI](https://github.com/deepseek-ai) | 开发并开源 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)，提供核心 Agent Harness、插件架构与 Web 运行能力 |
| [Links2008](https://github.com/Links2008) | Windows 桌面壳、独立运行时封装、安装器、图标适配与 Windows 实机验收 |

感谢 Electron、Node.js、NSIS 及 DeepSeek Harness 依赖生态中的所有开源贡献者。

## 开源协议

本仓库中的桌面壳代码、构建脚本和配置文件遵循 [MIT License](LICENSE)。打包使用的 DeepSeek Harness 同样采用 MIT License；其他第三方依赖继续遵循各自的许可证。
