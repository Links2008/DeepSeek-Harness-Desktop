# DeepSeek Harness Desktop 待发布更新

- 修复跟进上游 `dsh-v0.2.1-alpha.1` 时插件商店 `dshmarket@1.57.0` 的依赖解析冲突：让商店复用内置 Harness 的 `cordis`、`schemastery` 和 `dsh-settings`，包括宿主使用的预发布版本。
- 保留严格的 npm 依赖检查，不使用 `--force` 或 `--legacy-peer-deps` 绕过冲突；新增共享宿主依赖对齐的回归测试。

发布前请将以上条目并入实际版本对应的 `release-notes-v<版本>.md`，完成 Windows 构建、安装及运行时验收后删除本文件。这里不表示新版本已经发布，也不表示 Windows 兼容性验收已经通过；`upstream-lock.json` 和已发布的 v4.4 更新说明保持原状。
