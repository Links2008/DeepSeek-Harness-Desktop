# DeepSeek Harness v3.2

## 修复与体验优化

### 启动黑屏修复 + 全新启动动画
桌面壳启动时窗口 `show:true` 后直接等待后端，期间为纯深色空窗（黑屏）。本版在 `createWindow()` 接入 `loadFile("loading.html")`，后端就绪前显示鲸鱼启动动画，就绪后再 `loadURL` 切入主界面。

### 去掉 Web UI 二次加载画面
Web UI 自带的 "HARNESS / Loading plugins" 启动画面与桌面壳 loading 页重复，已在内联样式层隐藏（`[class*="_boot_"]`）。

### 移除「技能中心」侧边栏条目
隐藏侧边栏「技能中心」入口（`[data-dsh-skill-explorer-entry]`）。

### 删除「退出 DeepSeek Harness」悬浮按钮
退出按键失灵，移除悬浮退出入口（`[data-dsh-shutdown-float]`），退出交由窗口关闭与系统菜单承担。

### 插件商店图标切换延迟修复
侧栏收起/展开时「插件商店」文字→图标切换由 2.5s 定时轮询改为 `ResizeObserver` 实时响应，收起后不再残留文字。

### 侧栏 chrome 观察器性能优化
侧栏 frame/target 扫描改为缓存（失效才重扫），MutationObserver 加 200ms 防抖，避免全文档高频遍历拖慢 UI。

### 浅色模式窗口背景适配
`backgroundColor` 随 `nativeTheme` 切换（深色 `#121214` / 浅色 `#f9fafb`），浅色模式下不再露出深色方角。

## 升级说明
- v3.1.x / v3.1.3 用户：侧栏底部「检查更新」→ 自动下载 → 重启即完成升级（或直接运行 `DeepSeekHarness-Setup-3.2.exe` 覆盖安装）。