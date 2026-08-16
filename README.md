# DeepSeek Harness Desktop

Windows 桌面版 [DeepSeek Harness](https://github.com/deepseek-ai) 客户端 —— 基于 Electron 的桌面壳，提供无边框圆角窗口、内置皮肤中心、插件市场与一键自更新能力。

## v2.0 升级点（相对 v1.1.2）

### 新功能

- **皮肤中心**：在 设置 > 插件配置 > 皮肤 中一键切换 9 款皮肤（blue-fantasy / dragon-heir / miku / minecraft / qq98 / ths / trading / whale-song / xp），全部皮肤包内置安装，无需命令行操作
- **侧边栏默认收纳**：启动时侧边栏默认向右收起为左侧窄条，点击即可重新展开，为内容区腾出更大空间
- **任务完成系统通知**：窗口最小化或失焦时任务完成会发送 Windows 系统通知，点击通知回到窗口查看结果

### 修复

- **插件市场自更新失败**（三层根因，全部修复）：
  - Windows 下 Node ≥ 20.12 安全策略禁止 `execFile` 直接执行 `.cmd` 文件导致 `spawn EINVAL` —— 改经 `cmd.exe` 调用 dsh CLI
  - `pnpm-workspace.yaml` 中 `allowBuilds` 为 pnpm 生成的占位模板导致 `ERR_PNPM_IGNORED_BUILDS`，cloudflared / cpu-features / ssh2 / sharp 原生模块构建被拒 —— 显式允许构建
  - 自更新后版本校验因 `require` JSON 缓存误报 "verification failed" —— 改为直读 `package.json`
- **皮肤切换 EPERM 权限错误**：全部皮肤包以真实目录安装进 profile `node_modules`，切换时不再依赖符号链接（绕开 Windows 符号链接权限限制）

### 优化

- **冷启动提速**：移除加载页，主窗口立即以应用原色显示，后端在后台就绪后 Web UI 无缝接替
- **更新自检不阻塞启动**：electron-updater 检查移出冷启动路径，延迟 5 分钟静默后台执行，每 6 小时复查
- **宠物功能默认关闭**：可在 设置 > 插件配置 > 宠物 卡片中重新启用
- **窗口视觉**：12px 四角圆角（最大化时自动归零）、自定义窗口控制按钮（最小化 / 最大化 / 关闭）、拖拽区域与双击最大化

## 安装与升级

从 [Releases](../../releases) 下载 `DeepSeek-Harness-Desktop-v2.0-win-x64.zip`（完整安装包，338 MB），解压到任意目录后运行 `DeepSeekHarness.exe` 即可，无需安装器、无需预装 Node.js。

已有 v1.x 的用户：

1. 完全退出 DeepSeek Harness（托盘图标右键退出）
2. 用解压出的 `DeepSeekHarness` 目录整体覆盖旧安装目录
   （默认安装目录：`C:\Users\<你>\AppData\Local\Programs\DeepSeekHarness`）
3. 重新启动软件

包内已内置全部修改：新版 `app.asar`（壳）与补丁后的 `dsh-runtime`（侧边栏默认收纳），无需额外步骤。

## 系统要求

- Windows 10 / 11（x64）
- 无需预装 Node.js —— 运行时已内置

## 目录结构

```
resources/
├── app.asar          # Electron 主进程壳（本仓库维护）
├── dsh-runtime/      # DSH Web 运行时（node_modules）
└── node/             # 内置 Node.js 运行时
```

## 许可证

MIT
