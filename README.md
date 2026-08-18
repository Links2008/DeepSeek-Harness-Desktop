<p align="center">
  <img src="deepseek_whale_hermes_rounded.png" width="128" alt="DeepSeek Harness Desktop">
</p>

<h1 align="center">DeepSeek Harness Desktop</h1>

<p align="center">
  把 DeepSeek Harness 变成真正适合 Windows 的桌面应用：一键安装、原生通知、顺滑窗口控制与自动更新。
</p>

<p align="center">
  <a href="https://github.com/Links2008/DeepSeek-Harness-Desktop/releases/latest"><img src="https://img.shields.io/github/v/release/Links2008/DeepSeek-Harness-Desktop?display_name=tag&style=flat-square" alt="Latest release"></a>
  <a href="https://github.com/Links2008/DeepSeek-Harness-Desktop/releases"><img src="https://img.shields.io/github/downloads/Links2008/DeepSeek-Harness-Desktop/total?style=flat-square" alt="Downloads"></a>
  <img src="https://img.shields.io/badge/Windows-10%20%7C%2011-0078D4?logo=windows&style=flat-square" alt="Windows 10 and 11">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-31c854?style=flat-square" alt="MIT License"></a>
</p>

<p align="center">
  <a href="https://github.com/Links2008/DeepSeek-Harness-Desktop/releases/latest"><strong>下载最新版</strong></a>
  · <a href="#v3-更新与优势">v3 更新</a>
  · <a href="#项目来源与分支谱系">上游来源</a>
  · <a href="#自动更新">自动更新</a>
  · <a href="https://github.com/Links2008/DeepSeek-Harness-Desktop/issues">问题反馈</a>
</p>

> [!IMPORTANT]
> 如果你觉得本项目对你有帮助，请点 ⭐ Star 支持一下，对项目曝光很重要。

## 产品预览

<p align="center">
  <img src="docs/images/desktop-home.png" width="100%" alt="DeepSeek Harness Desktop 主界面">
</p>

<table>
  <tr>
    <td width="50%"><img src="docs/images/agent-presets.png" alt="Agent 预设"></td>
    <td width="50%"><img src="docs/images/compact-sidebar.png" alt="紧凑侧栏"></td>
  </tr>
  <tr>
    <td align="center">Agent 预设与模式切换</td>
    <td align="center">紧凑侧栏与沉浸工作区</td>
  </tr>
</table>

## v3 更新与优势

v3 是一次以「插件生态可用性」为核心的壳层大修：插件商店升为顶级入口、插件装卸链路修复、界面抖动根除、冷启动治理，并预装 better-sidebar 侧栏增强。升级位置与改动如下：

| 更新位置 | v3 改动 | 实际优势 |
| --- | --- | --- |
| 桌面壳 `main.js`（插件商店入口） | 侧边栏 SSH 按钮正下方新增「插件商店」条目，点击直达插件市场页；低频轮询补插（2.5s），不用 MutationObserver | 商店从设置深层提为顶级入口，且与第三方侧栏插件互不冲突、不再崩溃 |
| 桌面壳 `main.js`（收起侧栏适配） | 侧栏收起时商店条目切换为纯图标居中显示 | 与原生图标列对齐，无文字溢出 |
| 桌面壳 `main.js`（更新通知） | autoUpdater 检查/下载/安装事件接入 Windows 系统通知，点击通知聚焦主窗口 | 点更新按钮后不再无反馈，下载完成与可安装状态一目了然 |
| 桌面壳 `main.js`（弹跳根除） | 删除壳层对 `--dsh-sidebar-width` 的逐帧写入与默认值（与 better-sidebar 撞名的死代码）；窗口控件位置加 152–184px 滞回带 + 250ms 消抖 | 界面不再左右弹跳，侧栏动画期间控件稳定 |
| 桌面壳 `main.js`（设置抽屉） | 设置对话框各卡片默认收起，点卡片头部展开 | 设置页不再满屏长列表 |
| Web profile（商店切换） | 插件市场由 `dsh-plugin-marketplace` 切换为 `dshmarket@1.11.1`，关闭其自重启（`allowRestart: false`） | 浏览/搜索/一键安装社区插件，重启职责统一归壳层 |
| Web profile（插件更新修复） | `pnpm-workspace.yaml` 设 `minimumReleaseAge: 0`，解除 24h 发布冷静期对新版插件的拦截 | 插件检查更新可正常装上新版本 |
| Web profile（冷启动治理） | 禁用启动即崩溃循环的灵枢 `dsh-memory` 插件；该循环每次启动阻塞插件加载 0.5–2s | 冷启动明显提速，后端日志不再刷崩溃栈 |
| Web profile（默认关闭项） | 宠物、任务看板、皮肤中心默认关闭（loader 补丁层，可随时恢复）；移除 Vision Router | 界面聚焦对话，无关组件不抢启动时间 |
| Web profile（文件栏唯一化） | 禁用 dsh-web-ui 自带的 aionui 文件列，保留 better-sidebar 的 Explorer 文件树 | 只保留一个文件侧栏，不再两套重叠 |
| Mica 修复脚本 `apply-mica-fix.ps1` | 修复云母模式统计栏缓存命中数的显示偏移 | 统计数据与实际命中一致 |

完整变更见 [`v3 Release 说明`](release-notes-v3.md)。

## 核心能力

- Windows 10/11 x64 一键安装，内置独立 Node.js 与 Harness 运行时。
- 红、黄、绿三色窗口控件具备克制的按压反馈，并使用原生最大化/还原。
- 每次任务真正完成时发送 Windows 系统通知，点击可返回结果。
- 单实例启动、无启动动画的即时窗口、系统直角无边框窗口和完整的后端进程清理。
- 保留用户已有的 `~/.dsh` 配置、凭据与会话，不打包任何本机隐私数据。
- 通过 GitHub Releases 自动检查、下载并在退出应用后安装新版本。

## 一分钟开始

1. 前往 [Latest Release](https://github.com/Links2008/DeepSeek-Harness-Desktop/releases/latest)。
2. 下载 `DeepSeekHarness-Setup-<版本>.exe`。
3. 运行安装向导并选择安装目录。
4. 从桌面快捷方式或开始菜单启动 **DeepSeek Harness**。

> [!NOTE]
> 安装包暂未使用商业代码签名证书，Windows SmartScreen 可能显示“未知发布者”。可在 Release 说明中核对 SHA-256，并审计本仓库的构建工作流。

## 项目来源与分支谱系

本仓库在 GitHub 元数据中是独立仓库，不伪装成官方 Fork；代码来源与构建谱系公开记录如下：

```text
deepseek-ai/deepseek-harness
└─ 官方分支：master
   └─ 当前锁定：47f943859bef60e4160492346772ded9b24f765a
      └─ Harness：0.1.0-rc.5
         └─ Windows 桌面发行：Links2008/DeepSeek-Harness-Desktop（main）
```

| 项目 | 当前值 |
| --- | --- |
| 官方上游 | [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) |
| 跟随分支 | `master` |
| 锁定提交 | [`47f9438`](https://github.com/deepseek-ai/deepseek-harness/commit/47f943859bef60e4160492346772ded9b24f765a) |
| 上游版本 | `0.1.0-rc.5` |
| 桌面仓库分支 | `main` |
| 状态文件 | [`upstream-lock.json`](upstream-lock.json) |

GitHub Actions 每天检查官方 `master`。只有上游变化、桌面壳变化、人工强制构建或失败发布修复时才打包；未变化时直接停止。

## 自动更新

桌面端不再后台定时检查。用户点击侧栏的下载图标后检查 GitHub Releases；发现新版会下载完整 Setup EXE，完成后同一按钮进入“重启更新”。

发布链路依次验证测试、安装包完整性、`latest.yml` SHA-512、`app-update.yml` 更新源、隔离安装、AppID、HTTP 200、运行时版本、端口清理与卸载。任何关键步骤失败都会停止发布。

自动检查、构建和发布仅使用 GitHub Actions、Node.js、electron-builder、7-Zip、NSIS 与 GitHub CLI，**不会调用 GPT、Codex 或 OpenAI API，也不会消耗 GPT/Codex 额度**。

## 从源码构建

```powershell
npm ci
npm test
npm run build:installer
```

构建完整安装器还需要 `bundle/node/node.exe` 与由官方 Harness release families 生成的 `bundle/dsh-runtime`。详细过程可直接查看 [自动构建工作流](.github/workflows/upstream-sync.yml)。

## 贡献者与致谢

| 贡献者 | 主要贡献 |
| --- | --- |
| [Links2008](https://github.com/Links2008) | Windows 桌面壳、安装器、通知、窗口交互、自动更新、发布链路与 Windows 实机验收 |
| [DeepSeek-AI Team](https://github.com/deepseek-ai) | DeepSeek Harness 核心、Agent 能力、插件架构与 Web 运行时 |
| [官方上游贡献者](https://github.com/deepseek-ai/deepseek-harness/graphs/contributors) | Harness 的持续开发、评审、修复与生态建设 |

根据 GitHub Contributors 当前统计（2026-08-15），主要上游贡献者包括 [tianyicui](https://github.com/tianyicui)、[LegGasai](https://github.com/LegGasai)、[imccyu](https://github.com/imccyu)、[Chinesezjc](https://github.com/Chinesezjc)、[turtle1999](https://github.com/turtle1999)、[hypatiamay](https://github.com/hypatiamay)、[CreatixChu](https://github.com/CreatixChu)、[kermanx](https://github.com/kermanx)、[ZiyaZhang](https://github.com/ZiyaZhang) 与 [Kingwl](https://github.com/Kingwl)。完整且持续更新的名单以官方 Contributors 页面为准。

感谢 Electron、Node.js、NSIS 及 DeepSeek Harness 依赖生态中的所有开源贡献者。

## 安全与隐私

仓库与安装包不会包含 API Key、Token、Cookie、`.credentials.yaml`、`~/.dsh`、用户会话或本机日志。请不要在 Issue 中粘贴任何凭据。

## 参与贡献

欢迎通过 [Issues](https://github.com/Links2008/DeepSeek-Harness-Desktop/issues) 反馈 Windows 安装、通知、窗口控制、更新或打包问题。提交代码前请先运行 `npm test`。

## 许可证

本仓库的桌面壳、构建脚本和配置遵循 [MIT License](LICENSE)。打包使用的 DeepSeek Harness 及其他第三方依赖继续遵循各自许可证。
