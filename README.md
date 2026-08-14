# DeepSeek Harness Desktop

面向 Windows 的 DeepSeek Harness 桌面壳与安装器。它把原本依赖源码目录、系统 Node.js 和 pnpm 的 Web 运行方式，整理成带独立运行时、桌面快捷方式和完整窗口控制的一体化桌面应用。

![DeepSeek Harness Desktop 图标](deepseek_whale_hermes_rounded.png)

## 为什么做这个项目

DeepSeek Harness 本身提供了强大的 Agent、工具调用、工作流和 Web 交互能力，但直接在 Windows 上使用时仍有几个明显门槛：

- 用户需要准备 Node.js、pnpm、源码仓库和依赖环境。
- 启动命令依赖固定工作目录，不适合普通用户直接使用。
- Web 页面缺少桌面软件常见的最小化、最大化、还原和退出体验。
- 快捷方式、任务栏和安装程序缺少统一的应用图标。
- 普通单击安装器不能选择安装盘；高压缩运行时的安装过程也很慢。

这个桌面版解决了这些痛点：

- 内置 Node.js 与完整 DeepSeek Harness 运行时，不依赖用户电脑的开发环境。
- 提供 Windows 桌面快捷方式和开始菜单入口。
- 提供无边框圆角窗口，以及自绘的最小化、最大化/还原和关闭按钮。
- 使用统一的圆角鲸鱼图标。
- 使用向导式 NSIS 安装器，可选择安装目录和磁盘。
- 使用 ZIP 安装载荷，在保持约 257 MB 安装包体积的同时加快解压。
- 保留用户自己的 `~/.dsh` 配置和会话，不把任何凭据打进安装包。

## 功能

- Windows 10/11 x64 桌面应用
- 内置独立 Node.js 运行时
- 自动启动和关闭 DeepSeek Harness Web 后端
- 28 px 自绘窗口控制按钮
- 最大化与还原边界保存
- 30 px 常规窗口圆角
- 自动创建桌面与开始菜单快捷方式
- 可选择安装路径/磁盘
- 完整卸载入口

## 下载

请在仓库的 **Releases** 页面下载：

`DeepSeekHarness-Setup-1.0.0.exe`

安装器未使用商业代码签名证书，Windows SmartScreen 可能显示未知发布者提示。源码和构建配置均在本仓库中，可自行审计和构建。

## 项目结构

```text
.
├─ main.js                         Electron 主进程与窗口控制
├─ preload.js                      安全的窗口控制 IPC 桥
├─ electron-builder.yml            NSIS、图标和运行时打包配置
├─ package.json                    项目与构建命令
├─ scripts/
│  └─ create-runtime-manifest.mjs  从官方 tarball 生成独立运行时清单
├─ tests/
│  └─ installer_runtime.test.js    安装器配置回归测试
└─ deepseek_whale_hermes_rounded.* 应用图标
```

构建时还需要以下本地目录，它们已被 `.gitignore` 排除：

```text
bundle/
├─ node/node.exe
└─ dsh-runtime/
   ├─ package.json
   └─ node_modules/
```

## 从源码构建

### 1. 准备桌面端依赖

```powershell
npm ci
```

### 2. 打包官方 DeepSeek Harness 发布族

在 DeepSeek Harness 源码仓库中完成官方构建，然后分别打包 `vendor` 与 `dsh` release families：

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

不要使用 `--omit=optional`。`koffi` 的 Windows 预编译二进制属于 optional dependency，省略后会回退到本机 CMake 编译。

### 4. 放入 Node.js

```powershell
New-Item -ItemType Directory -Path bundle\node -Force
Copy-Item (Get-Command node.exe).Source bundle\node\node.exe
```

### 5. 测试并构建安装器

```powershell
npm test
npm run build:installer
```

安装器输出到 `installer-dist/`。

## 已验证行为

- 安装器可选择安装目录和磁盘。
- 完整运行时包含 37,850 个文件。
- 内置 CLI 报告版本 `0.1.0-rc.5`。
- 安装后 Web 根页面返回 HTTP 200。
- 后端进程来自安装目录内的 `resources/node/node.exe`。
- 正常关闭窗口后，主进程、后端进程和 3080 端口均退出。
- 最小化、最大化、还原和关闭已在 Windows 实机验证。

## 安全与隐私

本项目不会把以下内容加入源码仓库或安装包：

- `.credentials.yaml`
- API Key、Token 或 Cookie
- `~/.dsh` 用户状态
- 会话、存储和登录状态
- 本机日志与构建缓存

应用在运行时继续使用当前 Windows 用户自己的 `~/.dsh`，因此重装桌面壳不会主动清除用户配置。

## 已知说明

- 首次启动需要生成 Web profile，部分电脑可能需要约 30–70 秒。
- 已安装旧版时，NSIS 会按更新处理并沿用原安装目录。要重新选择磁盘，请先卸载旧版，再运行新安装器。
- 当前安装器未进行商业代码签名。

## 上游项目

DeepSeek Harness 的核心后端与 Web 功能来自 DeepSeek Harness 项目。本仓库只维护 Windows 桌面壳、运行时封装、安装配置和相关验收。
