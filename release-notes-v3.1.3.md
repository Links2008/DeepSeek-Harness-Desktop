# DeepSeek Harness v3.1.3

## 新增修复（对应社区 Issues）

### 任务看板恢复显示（#6）

桌面版侧边栏缺「任务看板」条目、浏览器版正常的问题已修复。根因：v2.2 时按当时用户要求在 desktop shell 注入了 CSS 强制隐藏（`[data-dsh-taskboard-*] { display: none !important }`），后端看板数据与 `GET /api/task-board/state` 一直正常。本版移除该隐藏规则，任务看板条目与视图恢复显示，无需任何手动配置。

### 故障插件自动隔离（#5）

Git 依赖插件未执行 build 就安装（如 `graph-memory@1.6.0-beta.1`：package.json 声明 `./dist/dsh.js` 但仓库只有 `dsh.ts`/`src`，无 `dist/`）时，DSH 加载报 `ERR_MODULE_NOT_FOUND` → 整个 plugin tree boot 失败 → backend 退出 → Desktop 无法连线。本版在 desktop shell 层兜底：

- backend 启动即崩（非零退出且未就绪）时解析 stderr 尾部（64KB ring buffer）
- 按 `failed to import loader entry <name> (<pkg>/dsh)` 定位坏插件（兜底解析 `ERR_MODULE_NOT_FOUND` 的 node_modules 路径，兼容 scoped 包）
- 自动从 web profile 的 `package.json`（`dependencies` + `dsh.profile.bundles`）移除该插件，原文件备份为 `package.json.bak-quarantine-<时间戳>`
- 随后按既有 respawn 逻辑自动重启 backend，系统通知告知被隔离的插件名与备份位置
- 防循环保护：单次会话最多隔离 2 个插件

单插件损坏不再拖垮整个 backend 与桌面端；插件作者发布带 dist 的版本后可重新安装。

## 沿用 v3.1.2 的修复

- 更新源 latest.yml 404 / providers 凭据恢复 / 补丁锚点正则匹配
- 后端崩溃 3 次指数退避 respawn / 孤儿 settings 锁自愈 / 启动期重载静默窗口
- 更新安装深度修复：`isQuitting` 阻断 respawn + `killBackendTree()` 进程树清理 + 静默安装 + 4s 看门狗强退

## 升级说明

- v3.1.x 用户：侧栏底部「检查更新」→ 自动下载 → 重启即完成升级（或直接运行 `DeepSeekHarness-Setup-3.1.3.exe` 覆盖安装）。
- 升级后侧边栏应立即出现「任务看板」条目（数据保持原有状态）。
