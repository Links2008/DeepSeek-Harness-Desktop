# DeepSeek Harness v3.1.3

## 新增

- **丝滑启动动画**：loading.html 加入品牌动画（渐入 + 呼吸 + 波纹），缓解冷启动黑屏焦虑。

## 修复

- **侧栏收起文字3秒延迟 (Bug #14)**：ensureStoreEntry 加入 ResizeObserver 直接监听 sidebarColumn 宽度变化，收起时"插件市场"文字即时变图标（不再等 2.5s 轮询）。

- **启动黑屏时间优化**：dom-ready 后的三个注入脚本（injectWindowChrome / injectDesktopTweaks / injectTaskCompletionBridge）改为 Promise.all 并行执行，减少黑屏时间。

## UI 调整

- **隐藏技能中心侧边栏**：通过 CSS + JS 注入隐藏"技能中心"入口与面板，不再显示。

- **移除"良神模式"预设选项**：标准模式/激进模式中的"良神模式"选项已隐藏（匹配 良神/量神/两神 文本 + data-preset-id）。

## 包体优化

- **compression: maximum**：electron-builder 压缩级别从 normal 提升到 maximum。
- **排除运行时中不必要的文件**：README / CHANGELOG / LICENSE / 文档 / 测试 / 覆盖率 / 日志 / CI 配置 等，预计减少 5-15% 体积。

## 升级说明

- v3.1.x 用户：侧栏"检查更新"→ 自动下载 → 重启即完成升级。
- 升级后侧栏收起时"插件市场"文字将即时变图标（不再停顿3秒）。
- 启动时将看到丝滑的品牌动画（渐入 + 波纹效果）。

## Build verification

- Trigger: user-requested UI polish + performance optimization
- Harness: 0.1.0-rc.7 at `99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`
