# DeepSeek Harness Desktop v3.2.2

本版修复 v3.2.1 安装包体积异常，并保留 Harness `0.1.1-rc.2`、冷启动优化与启动完成转场。

## 修复内容

- runtime 组装从“安装官方 release family 的全部 236 个 tarball”改为“只安装从 `@deepseek-ai/dsh` 可达的运行时依赖闭包”。
- 不再把 Codex CLI 和 Claude Code 的大型原生二进制预装进默认 web/headless Profile；两者仍按 DeepSeek 官方设计作为 Profile Bundle 按需安装。
- 将启动预打包使用的 `esbuild` 改为桌面构建的明确开发依赖，不再隐式借用 runtime 中偶然存在的包，也不会进入最终 runtime。
- 补齐未来 Release notes 兜底：没有版本说明文件时读取 DeepSeek 官方 Release 正文；官方说明也不存在则拒绝发布空 tag。
- 修复真实安装验收脚本在非 GitHub Actions 环境缺少 `RUNNER_TEMP` 时无法运行的问题。

## 验证结果

- 本地正式候选安装器从 456,560,745 字节降至 223,722,242 字节，减少 51.0%。
- 解包 runtime 为 15,482 个文件，不含 Codex/Claude 按需原生载荷；Harness 版本仍为 `0.1.1-rc.2`。
- 完整测试、SHA-512、7-Zip、隔离安装、HTTP 200、AppID、运行时版本、端口释放和卸载验收通过。
- D 盘正式覆盖安装后，现有 `.dsh` 状态文件数量和最新写入时间不变；首轮启动完成转场、Aqua、会话内容与编辑器可见，无黑帧、无需刷新。

v3.2.1 完整功能更新请见：[DeepSeek Harness Desktop v3.2.1](https://github.com/Links2008/DeepSeek-Harness-Desktop/releases/tag/v3.2.1)
