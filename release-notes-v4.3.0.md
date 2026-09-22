# DeepSeek Harness Desktop v4.3.0

## 桌面交互修复

- 侧栏收起与展开不再通过 16ms 定时器逐帧调整 `WebContentsView`，状态稳定后只提交一次原生控件位置，减少卡顿和延迟。
- 底部面板展开按钮及其 SVG 子节点明确退出原生拖拽区域，恢复点击交互。
- 会话标题栏改用稳定的 `conversation.session.header` slot 绑定拖拽区，改善 Windows 无边框窗口拖动。

## Market 与主题兼容

- 移除过时的宿主版本伪装，Market 按真实 Harness `0.1.6-alpha.2` 判断兼容性。
- 更新主题适配锚点并保留陈旧写入保护，恢复 DSH Market 主题切换。
- DSH Market 更新到 `1.52.0`，修复陈旧锁文件导致的升级回滚问题。

## 安装包

- 应用归档排除生产依赖 source map，同时保留 `yaml/dist/doc` 等实际运行时代码。
- 本地安装体积由 `799.69 MiB` 降至 `790.24 MiB`；文档预览所需 LibreOffice runtime 保持完整。
- 继续提供完整 EXE、blockmap 和 `latest.yml`，支持手动安装及自动更新。
