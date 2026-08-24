# DeepSeek Harness Desktop v3.2.1

本版将内置 Harness 从 `0.1.0-rc.7` 升级到官方 `0.1.1-rc.2`，并完成 Windows 冷启动与启动转场修复。

## 主要更新

- 支持 DeepSeek 多模态视觉模型、Files API 图片上传复用，以及按模型要求自动缩放和转换图片。
- `@` 菜单可引用文件和会话，`/goal`、`/plan` 等命令支持图文输入。
- Codex 与 Claude Code 子代理改为可按需安装的 Profile Bundle；Windows PTY 支持持久 PowerShell 会话。
- 修复大历史会话分页、流式生成取消、部分 OpenAI 兼容网关、图片载荷和 Bubblewrap 沙箱绕过等问题。
- 改进 Markdown 表格、模型选择器、工作流面板、子代理会话导航和多行问答体验。

## Windows 桌面修复

- 增加可移植 Node 编译缓存、构建期核心缓存种子和 Profile 指纹预打包，避免每次启动重复扫描、解析和编译完整插件树。
- 只有在 Harness 服务、插件树缓存落盘和端口都就绪后才揭示主界面，无需手动刷新。
- 加入 180ms 启动完成拍、280ms 淡出转场和 1600ms 主进程兜底；避免黑帧、硬切和覆盖层卡死。
- 正式安装态暖启动实测 UI ready 约 3.3–3.5 秒；样本量不足，不将该结果表述为 P95。
- 覆盖安装保留现有 `.dsh` 会话、凭据、设置、插件和 Profile 状态。

完整上游变更：[0.1.0-rc.7...0.1.1-rc.2](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.0-rc.7...dsh-v0.1.1-rc.2)
