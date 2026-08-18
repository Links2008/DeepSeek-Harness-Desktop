# DeepSeek Harness v3.1.2

## 修复

- **更新源 404 (Bug #1)**：app-update.yml 中配置的 release tag 路径与实际 GitHub Release 不一致，导致 latest.yml 404，30+ 次检查失败。现在 initializeUpdater 显式 setFeedURL 兜底为正确的仓库 `Links2008/DeepSeek-Harness-Desktop`。

- **providers 迁移 (Bug #2)**：3.0.0 升级后 settings.yaml 的 `llm-pi-ai.providers` 被重置为空对象 `{}`，但 `.credentials.yaml` 仍保留 `DEEPSEEK_API_KEY`。新增 `reconcileProviders()` 函数，启动时检测该不一致，从凭据自动恢复 deepseek-official provider 占位配置（含备份）。

- **补丁锚点漂移 (Bug #3)**：`patchConversation` 依赖固定字符串锚点，3.0.0 上游修改写法后失配（日志：Aion image drop routing: upstream anchor changed）。改用正则匹配 hasFiles 函数声明，容忍空白/引号/可选链写法差异，单锚点漂移只跳过不抛错。

- **后端崩溃重试 (Bug #4)**：原逻辑仅允许 1 次 respawn，且无退避间隔，后端运行中崩溃完全不重试。改为最多 3 次重试 + 指数退避（1s/4s/16s），运行中崩溃也重试并重置 backendReady 状态。

- **孤儿锁 (Bug #5)**：`healOrphanedSettingsLock()` 原只在 app.ready 时调用一次，后端运行中崩溃留下的锁无法清理。现在每次 startBackend spawn 前都调用。

- **启动期重载循环 (Bug #6)**：后端就绪后的 pnpm 自检修改 package.json 可能触发重载。queueReload 加入 5s 静默窗口（与 backendReadyAt 闸门双保险）。

- **侧栏退出键失灵 (Bug #13)**：ERR_ABORTED 重载循环吞掉点击事件，侧栏"退出"按钮无响应。新增 `bindQuitButton()` 显式拦截 click + `stopImmediatePropagation`；注册 Ctrl+Q 全局快捷键作为退出兜底。

## 升级说明

- v3.1.x 用户：侧栏底部"检查更新"→ 自动下载 → 重启即完成升级（或直接运行 `DeepSeekHarness-Setup-3.1.2.exe` 覆盖安装）。
- 升级后首次启动会自动从凭据恢复 deepseek-official provider（如 settings.yaml 中 providers 为空）。
- 如退出按钮仍失灵，可按 Ctrl+Q 退出应用。


## Build verification

- Trigger: user-requested bugfix release
- Harness: 0.1.0-rc.7 at `99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`
- 修复覆盖：8 个 bug（#1 #2 #3 #4 #5 #6 #13 + patchConversation 锚点）
