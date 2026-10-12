# DeepSeek Harness Desktop v4.4.1

本版本已通过 [Windows 完整功能验收](https://github.com/Links2008/DeepSeek-Harness-Desktop/actions/runs/38187317909)，覆盖 22 项桌面测试、安装、启动、原生模块、端口释放和卸载。

- 内置 Harness 更新至官方发布的 `dsh-v0.2.1-alpha.2`（精确提交见 `upstream-lock.json`），跟进独立字体与字号设置、工作目录工具，以及上游 Windows PowerShell 大量输出后的收尾修复。
- 修复插件商店 `dshmarket@1.57.0` 与预发布宿主的依赖解析冲突：商店复用内置的 `cordis`、`schemastery` 和 `dsh-settings`，保留严格的 npm 依赖检查。
- 适配新增的共享 OpenTelemetry 服务，分别预打包其依赖及嵌套副本。alpha.2 的 Windows 验收中预热缓存为 766 个文件，保留原有 800 文件上限、服务接口和遥测配置。
- 适配上游主题状态的新实现：严格确认主题、字号和字体写入均受上游的等待保护后，不再重复注入旧排序补丁；保留网络写入异常的收尾处理，避免未处理的 Promise 拒绝。新增快速切换、交错写入、保存被拒绝或断线后的恢复，以及保护逻辑缺失的回归测试。
- 保留依赖对齐、模块导出与包实例的回归测试。安装包配套提供 blockmap 和 `latest.yml`；安装器沿用已有 `.dsh` 数据，不重置用户 profile。

## 升级提醒

内置 Harness 仍为预发布版本。使用自定义插件或 profile 时，请先核对[官方 0.2.1-alpha.2 更新说明](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-alpha.2)：

- 本次上游移除了工具展示 `both` 混合模式，仅保留 `native` 和 `ptc`；自定义 Python PTC 组合需提供 `sandbox` 与 `sandboxPolicy` 服务。
- 自定义子代理 SDK runtime 需支持 `session/wait`；Agent Team 改为直接投递目标 Inbox，相关旧配置与结果字段需要迁移；升级前应确认排队消息已送达，升级后旧待投递消息不会自动发送，确需补发时请先核对目标历史，避免重复。
- `agent-instructions` 不再接受逐行 `dshHome` 配置，改用进程 `DSH_HOME`；共享指令目录可通过 `DSH_AGENTS_HOME` 指定。
- 此前上游已移除 runtime invariant 插件和各包的 `./invariant` 导出，依赖这些诊断入口的扩展需要调整。
- 输入区旧 `stats` 扩展拆分为 `activity` 和 `usage`，覆盖旧整行的插件需要更新注册 ID；子路径插件的显示文本与图标须从对应子路径导出。
- [上游 0.2.0-rc.2](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.0-rc.2) 更新了第三方模型目录，部分旧模型 ID 已移除，保存过的模型选择可能需要重新选择。

建议升级前备份重要配置和自定义插件。本独立桌面壳继续监听本机 `127.0.0.1:3080`。
