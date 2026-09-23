# DeepSeek Harness Desktop v4.4.0

- 内置 Harness 更新至官方发布的 `dsh-v0.1.7-alpha.2`（精确提交见 `upstream-lock.json`），包含会话滚动、插件安装和后台任务等官方修复。
- 跟进上游 0.1.7 预设结构，保留桌面版 Standard 预设的 Computer Use；移除已由上游实现或不再生效的旧补丁。
- 新安装内置的 dshmarket 更新至 `1.57.0`；已有 profile 不会由安装器强制改写。
- 延续 v4.3 的侧栏、底部面板与包体优化；提供完整安装包、blockmap 和 `latest.yml`。

上游升级说明：Session 日志迁移到 V4；官方 DeepSeek 适配器移除 Chat Completions/protocol 选项。已有自定义配置应按[官方 0.1.7 发布说明](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.7-alpha.1)检查。安装器不会删除用户的 `.dsh` 数据。
