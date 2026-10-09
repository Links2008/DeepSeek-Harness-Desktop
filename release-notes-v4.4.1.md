# DeepSeek Harness Desktop v4.4.1

- 内置 Harness 更新至官方发布的 `dsh-v0.2.1-alpha.1`（精确提交见 `upstream-lock.json`），跟进插件管理、会话与任务交互等上游改进。
- 修复插件商店 `dshmarket@1.57.0` 与预发布宿主的依赖解析冲突：商店复用内置的 `cordis`、`schemastery` 和 `dsh-settings`，保留严格的 npm 依赖检查。
- 适配新增的共享 OpenTelemetry 服务，分别预打包其依赖及嵌套副本。Windows 验收中启动缓存由 1003 个文件降至 763 个，保留原有 800 文件上限、服务接口和遥测配置。
- 新增依赖对齐、模块导出与包实例的回归测试；提供完整安装包、blockmap 和 `latest.yml`。安装器沿用已有 `.dsh` 数据，不重置用户 profile。

## 升级提醒

内置 Harness 仍为预发布版本。使用自定义插件或 profile 时，请先核对[官方 0.2.1 更新说明](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-alpha.1)：

- 上游移除了 runtime invariant 插件和各包的 `./invariant` 导出，依赖这些诊断入口的扩展需要调整。
- 输入区旧 `stats` 扩展拆分为 `activity` 和 `usage`，覆盖旧整行的插件需要更新注册 ID；子路径插件的显示文本与图标须从对应子路径导出。
- [上游 0.2.0-rc.2](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.0-rc.2) 更新了第三方模型目录，部分旧模型 ID 已移除，保存过的模型选择可能需要重新选择。

建议升级前备份重要配置和自定义插件。本独立桌面壳继续监听本机 `127.0.0.1:3080`。
