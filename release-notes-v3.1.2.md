# DeepSeek Harness v3.1.2

## Bug 修复

- **更新源 404 (Bug #1)**：app-update.yml 中配置的 release tag 路径与实际 GitHub Release 不一致，导致 latest.yml 404。现在 initializeUpdater 显式 setFeedURL 兜底为正确的仓库 `Links2008/DeepSeek-Harness-Desktop`。

- **providers 迁移 (Bug #2)**：3.0.0 升级后 settings.yaml 的 `llm-pi-ai.providers` 被重置为空对象。新增 `reconcileProviders()` 函数，从凭据恢复 deepseek-official provider 占位配置（含备份）。

- **补丁锚点漂移 (Bug #3)**：`patchConversation` 改用正则匹配 hasFiles 函数声明，容忍空白/引号/可选链写法差异。

- **后端崩溃重试 (Bug #4)**：respawnCount 最多 3 次重试 + 指数退避（1s/4s/16s），运行中崩溃也重试并重置 backendReady 状态。

- **孤儿锁 (Bug #5)**：`healOrphanedSettingsLock()` 每次 startBackend spawn 前都调用。

- **启动期重载循环 (Bug #6)**：queueReload 加入 5s 静默窗口（与 backendReadyAt 闸门双保险）。

- **侧栏退出键失灵 (Bug #13)**：新增 `bindQuitButton()` 拦截 click + `stopImmediatePropagation`；注册 Ctrl+Q 全局快捷键兜底。

- **更新时无法关闭 (Bug #15，深度修复)**：根因三层——①非静默安装器弹"无法关闭 DeepSeekHarness"对话框且重试无效；②更新杀后端后 respawn 逻辑 1 秒内重启 node.exe，重新锁住安装目录文件；③后端派生的 esbuild/ripgrep/conpty 子进程残留，持续锁文件并占用端口 3080。修复：`isQuitting` 标志阻断 respawn → `killBackendTree()` 杀整棵进程树（taskkill /T + 按安装目录路径过滤兜底）→ `quitAndInstall(true, true)` 静默安装（无对话框）→ 4 秒看门狗兜底强退。before-quit / window-all-closed / closed 三条退出路径统一加固。

## 升级说明

- v3.1.x 用户：侧栏底部"检查更新"→ 自动下载 → 重启即完成升级（或直接运行 `DeepSeekHarness-Setup-3.1.2.exe` 覆盖安装）。
- 升级后首次启动会自动从凭据恢复 deepseek-official provider（如 settings.yaml 中 providers 为空）。
- 如退出按钮仍失灵，可按 Ctrl+Q 退出应用。

## Build verification

- Trigger: user-requested bugfix release (replace v3.1.2)
- Harness: 0.1.0-rc.7 at `99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`
- 修复覆盖：9 个 bug（#1 #2 #3 #4 #5 #6 #13 #15 + patchConversation 锚点）
