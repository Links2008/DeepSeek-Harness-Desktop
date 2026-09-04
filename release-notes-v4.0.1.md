# DeepSeek Harness Desktop v4.0.1

> **重大架构升级后的首个稳定版本：轻量窗口壳 + 常驻用户级 daemon，修复上游 token 地址适配和长期失败的发布验收。**

## v4 重大升级

- Electron 前台只负责窗口、导航、更新和通知；独立 daemon 负责 Harness 后端、插件恢复和会话生命周期。
- 普通关窗隐藏并保留已渲染页面，不中断后台任务；再次打开直接恢复，`Ctrl+Q` 才完全退出桌面壳。
- Windows 登录静默预热；跨进程启动锁、版本/PID/端口握手、随机 token named-pipe 和退避恢复避免重复后端。
- 后端和 compile cache 共用 Electron Node，不再额外携带约 92.8 MB 的独立 `node.exe`。
- 仅保留中英文 Chromium 语言包，并裁剪 PDB、ARM64 预构建、测试夹具、类型源码和示例文档。
- 仍为完整离线安装包，保留原生终端、图片处理、插件和已有 `.dsh` 数据。
- DSH Market 入口位于“新会话”下方；侧栏保留检查更新按钮。
- 修复浅色设置界面和 Aqua 兼容模式，兼顾“减少动态效果”与必要的菜单、对话框动效。

## v4.0.1 稳定性修复

- 适配 DeepSeek Harness `0.1.2-rc.1` 新增的 `dsh web: http://127.0.0.1:3080/?token=...` 公告地址。
- daemon 将经过本机 host/port 校验的 service URL 写入状态，健康检查和主窗口导航不再访问会被拒绝的裸端口。
- 健康检查现在只在同一本机 origin 内跟随认证 `303`，并回送服务签发的 cookie；修复“HTTP 已可用但桌面永远不导航”的真实根因。
- 安装态验收与启动性能脚本读取相同 daemon state，消除 CI 已启动成功却等待 150 秒后误报失败的问题。
- provider 子进程正式通过源码路径加入 Node `--use-system-ca`，升级后不再依赖易丢失的 `app.asar` 字节补丁。

## 轻量化与速度

- Chromium 仅保留 `en-US`、`zh-CN`、`zh-TW`，runtime 排除非运行期文件。
- NSIS 使用 7z + blockmap 差分更新；v4.0.1 为 **125,255,184 字节（119.45 MiB）**，较 v3 减少 **94.95 MiB / 44.29%**。
- 三次隔离解包态实测中位数：冷启动 HTTP `3224 ms`、冷启动首屏 `4628 ms`、关窗后重开 `141 ms`、强制结束前台壳后 daemon 复用 `457 ms`。
- 首次安装后 Windows 文件扫描仍可能增加首启时间；普通关窗重开不会再次支付该成本。

## 发布链路修复

- GitHub Actions 明确改为只读构建与安装验收，不再使用含糊的“build-test-release”名称，也不会以 bot 身份提交或发布。
- 提交和人工验收锁定 `upstream-lock.json` 的精确 runtime commit；只有定时兼容性监控跟踪上游 `master`，避免 CI 与正式制品验证不同版本。
- 新增本机人工发布命令：验证 GitHub 登录身份必须为 `Links2008`，并拒绝 bot、脏工作树、未推送提交、冲突标签和已有 Release。
- 创建标签前必须存在当前 HEAD 的成功 Actions 记录，杜绝在远端验收失败或尚未完成时抢先发布。
- 发布前强制校验 EXE、blockmap、`latest.yml`、字节数和 SHA-512；正式 Release 同时上传三项自动更新制品。
- 发布后再次核对作者、标签、Latest 状态和资源清单，避免“构建完成但 Release 没有创建”的假成功。

## 升级与数据安全

- 从 v3/v4 可直接运行 `DeepSeekHarness-Setup-4.0.1.exe` 覆盖安装，或在应用内点击更新按钮。
- 保留用户 profile、会话、凭据、Aqua、DSH-IM 和插件配置，不删除 `.dsh` 或 AppData。
- 新安装包仍清理 v3 旧独立 Node 后端，防止覆盖安装时锁住目录。

## 发布验证门槛

- 全量测试、PowerShell 语法、token 后端集成、Harness CLI、`node-pty`/`sharp`/`koffi` 原生模块均须通过。
- 安装包须通过 7-Zip、`latest.yml` SHA-512、隔离安装、认证 HTTP 200、AppID、daemon 复用、端口释放和静默卸载验收。
- 最终 Release 由 `Links2008` 人工身份发布，不由 GitHub Actions bot 发布。
- 安装包 SHA-256：`07642690684739BA23DD0D698828F0868A4723ED213B1C9E02B21E45E472B353`。
