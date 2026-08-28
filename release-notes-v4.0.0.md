# DeepSeek Harness Desktop v4.0.0

> **重大升级：轻量化运行时、冷启动链路和桌面兼容层同步升级。**

## 安装包轻量化

- 后端改用 `DeepSeekHarness.exe` 的 Electron Node 模式，不再额外携带约 92.8 MB 的独立 `node.exe`。
- compile cache 也由 Electron Node 生成，避免构建 Node 与运行 Node 版本不一致导致缓存失效。
- Chromium 仅保留 `en-US`、`zh-CN`、`zh-TW`。
- runtime 排除 PDB、ARM64 预构建、测试夹具、TypeScript 类型源码及示例文档。
- 仍是完整离线安装包，不把 runtime 改为首启下载。
- 最终 NSIS 为 **166,768,057 字节（159.04 MiB）**，较 v3 基线减少 **58,048,522 字节（55.36 MiB / 25.82%）**。

## 启动与界面

- 3080 端口开放后提前加载主界面，插件树和 compile cache settle 后再完成启动转场。
- profile 依赖按指纹预打包；依赖未改变时直接复用。
- 非关键桌面注入延后到主界面可交互后执行。
- 启动页跟随 Windows 深浅色偏好，并完整支持“减少动态效果”。
- 修复 Aqua 设置入口兼容，保留兼容模式所需菜单、对话框和窗口控件动效。

## 插件与升级兼容

- 保留用户现有 `.dsh` profile、会话、凭据、Aqua 与 DSH-IM 配置。
- 新安装包仍能清理 v3 的旧独立 Node 后端，避免覆盖安装时锁住目录。
- 自动更新分支会恢复缺失的桌面/开始菜单快捷方式，并维持 `com.deepseek.dsh` AppID。
- 故障插件缺失构建产物时可隔离单个插件，避免整个 Harness 无法启动。

## 发布验证

- Electron Node 必须通过 Harness CLI 版本检查。
- `node-pty`、`sharp`、`koffi` 必须在正式安装目录中成功加载。
- 安装包必须通过 7-Zip、`latest.yml` SHA-512、隔离安装、HTTP 200、AppID、端口释放和静默卸载验收。
- GitHub Actions 仅做只读构建与安装验收，不以 bot 身份提交或发布；最终 Release 由 `Links2008` 人工核对安装包字节数与 SHA-256 后发布。
- 本地正式制品 SHA-256：`51B2AEC4EFB587AF4BC0D3871D897153548A658D2FA4DB96F02D1AD5BDCEA305`。

## 升级方式

从 v3 可直接运行 `DeepSeekHarness-Setup-4.0.0.exe` 覆盖安装，或在应用内点击更新按钮。升级不会删除用户数据。
