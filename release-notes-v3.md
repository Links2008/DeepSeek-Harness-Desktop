# DeepSeek Harness Desktop v3

v3 聚焦插件生态可用性与界面稳定：插件商店升为顶级入口、插件装卸链路修复、界面抖动根除、冷启动治理。基于 v2.2.1 桌面壳迭代（壳层补丁 r3–r6）与 Web profile 整改。

## 桌面壳（app.asar）

### 插件商店顶级入口
- 侧边栏 SSH 按钮正下方新增「插件商店」条目，点击直达插件市场页，无需再进设置找入口。
- 收起侧栏时条目切换为纯图标居中显示，与原生图标列对齐。
- 注入方式为 2.5s 低频轮询补插（不使用 MutationObserver），与 better-sidebar 等第三方侧栏插件共存不冲突、不崩溃。

### 界面弹跳根除
- 删除壳层对 CSS 变量 `--dsh-sidebar-width` 的逐帧写入与 `:root` 默认值——该变量与 better-sidebar 撞名（壳层写左栏宽度 / 插件读作右栏推挤），是界面来回弹跳的根因。
- 三色窗口控件位置跟随加 152–184px 滞回带 + 250ms 消抖确认，侧栏宽度抖动不再触发控件跳变。

### 更新系统通知
- autoUpdater 的检查、下载进度、下载完成、可安装状态均发送 Windows 系统通知；点击通知聚焦主窗口。
- 解决「点更新按钮没有任何提示」的问题。

### 设置抽屉默认收起
- 设置对话框各卡片默认收起，点击卡片头部展开/收起；控制项（开关、输入框）点击不受影响。

## Web profile（~/.dsh/profiles/web）

### 商店切换与插件更新修复
- 插件市场由 `dsh-plugin-marketplace` 切换为 `dshmarket@1.11.1`（浏览/搜索/一键安装社区插件）。
- 关闭商店自重启（`allowRestart: false`），重启行为统一交还桌面壳。
- `pnpm-workspace.yaml` 设 `minimumReleaseAge: 0`：解除 pnpm 24h 发布冷静期对新版本插件的拦截，插件「检查更新」可正常安装新版本。

### 冷启动治理
- 禁用灵枢 `@furongjun1999/dsh-memory`：其默认 python 经 PATH 解析到无 `aeis` 包的环境，每次启动崩溃循环并阻塞插件加载 0.5–2s。普通 `memory` 插件不受影响。
- 移除 Vision Router。

### 默认关闭项（loader 补丁层，均可随时恢复）
- 宠物（`pet`）、任务看板（`ui-task-board`）、皮肤中心（`ui-skin-center`）默认关闭。
- 禁用 dsh-web-ui 自带的 aionui 文件列（`web-ui-dsh-aionui-panel`），文件浏览保留 better-sidebar 的 Explorer 文件树——侧边文件栏唯一化。

## 其他修复
- 云母（Mica）模式统计栏缓存命中数显示偏移修复（`apply-mica-fix.ps1`）。

## 升级说明
- 已安装 v2.x 的用户：下载 Release 中的完整压缩包覆盖安装目录，或仅覆盖 `resources\app.asar`（Web profile 的改动在首次启动时自动生效）。
- 安装包暂无商业代码签名，SmartScreen 可能提示「未知发布者」：更多信息 → 仍要运行；Release 说明中可核对 SHA-256。

## 资产校验（SHA-256）

| 资产 | SHA-256 |
| --- | --- |
| `app.asar` | `37f52937b3eff4996d409f8d59727ccdbfd4235edb8d89f2d1ed660450a447e6` |
| `DeepSeekHarness-v3-win-x64.zip` | `47138ad09ea487ff94222d184b5f58b83e1ad1f446a09679305406f2326829bf` |

## 已知限制
- 话题侧栏总结需在设置中配置 DeepSeek API Key 后可用。
- 浏览器下载安装包可能触发信誉警告（未签名 + 低下载量所致），属误报。
