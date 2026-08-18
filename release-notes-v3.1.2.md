# DeepSeek Harness v3.1.2

## Bug 修复

- **更新源 404 (Bug #1)**：app-update.yml 中配置的 release tag 路径与实际 GitHub Release 不一致，导致 latest.yml 404。现在 initializeUpdater 显式 setFeedURL 兜底为正确的仓库 `Links2008/DeepSeek-Harness-Desktop`。

- **providers 迁移 (Bug #2)**：3.0.0 升级后 settings.yaml 的 `llm-pi-ai.providers` 被重置为空对象。新增 `reconcileProviders()` 函数，从凭据恢复 deepseek-official provider 占位配置（含备份）。

- **补丁锚点漂移 (Bug #3)**：`patchConversation` 改用正则匹配 hasFiles 函数声明，容忍空白/引号/可选链写法差异。

- **后端崩溃重试 (Bug #4)**：respawnCount 最多 3 次重试 + 指数退避（1s/4s/16s），运行中崩溃也重试并重置 backendReady 状态。

- **孤儿锁 (Bug #5)**：`healOrphanedSettingsLock()` 每次 startBackend spawn 前都调用。

- **启动期重载循环 (Bug #6)**：queueReload 加入 5s 静默窗口（与 backendReadyAt 闸门双保险）。

- **侧栏退出键失灵 (Bug #13)**：新增 `bindQuitButton()` 拦截 click + `stopImmediatePropagation`；注册 Ctrl+Q 全局快捷键兜底。

- **更新时无法关闭 (Bug #15)**：quitAndInstall 前用 `taskkill /F /T` 同步杀死整个后端进程树，避免子进程持有端口 3080 导致 NSIS 覆盖失败 + 新版本端口冲突。window-all-closed 与 mainWindow.on("closed") 同步加固。

## UI 调整

- **侧栏收起文字3秒延迟 (Bug #14)**：ensureStoreEntry 加入 ResizeObserver 直接监听 sidebarColumn 宽度变化，收起时"插件市场"文字即时变图标（不再等 2.5s 轮询）。

- **隐藏技能中心侧边栏**：通过 CSS + JS 注入隐藏"技能中心"入口与面板，不再显示。

- **移除"良神模式"预设选项**：标准模式/激进模式中的"良神模式"选项已隐藏（匹配 良神/量神/两神 文本 + data-preset-id）。

- **丝滑启动动画**：loading.html 加入品牌动画（渐入 + 呼吸 + 波纹 + drop-shadow），缓解冷启动黑屏焦虑。

## 性能优化

- **启动黑屏时间优化**：dom-ready 后的三个注入脚本（injectWindowChrome / injectDesktopTweaks / injectTaskCompletionBridge）改为 Promise.all 并行执行，减少黑屏时间。

- **包体优化**：electron-builder 压缩级别从 normal 提升到 maximum；排除运行时中 README / CHANGELOG / LICENSE / 文档 / 测试 / 覆盖率 / 日志 / CI 配置 等 17 类无用文件，预计减少 5-15% 体积。

## 升级说明

- v3.1.x 用户：侧栏底部"检查更新"→ 自动下载 → 重启即完成升级（或直接运行 `DeepSeekHarness-Setup-3.1.2.exe` 覆盖安装）。
- 升级后首次启动会自动从凭据恢复 deepseek-official provider（如 settings.yaml 中 providers 为空）。
- 如退出按钮仍失灵，可按 Ctrl+Q 退出应用。
- 侧栏收起时"插件市场"文字将即时变图标（不再停顿3秒）。
- 启动时将看到丝滑的品牌动画（渐入 + 波纹效果）。

## Build verification

- Trigger: user-requested bugfix release (replace v3.1.2)
- Harness: 0.1.0-rc.7 at `99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`
- 修复覆盖：10 个 bug（#1 #2 #3 #4 #5 #6 #13 #14 #15 + patchConversation 锚点）
