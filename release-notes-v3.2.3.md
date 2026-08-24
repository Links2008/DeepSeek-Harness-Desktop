# DeepSeek Harness Desktop v3.2.3

本版修复自动更新完成后桌面或开始菜单快捷方式可能消失的问题。

## 修复内容

- 修复 electron-builder NSIS 自动更新分支依赖旧安装注册表保留快捷方式、但在 `isUpdated` 模式下又可能跳过重建的缺口。
- 在安装文件和注册表落盘后检查正确命名的桌面与开始菜单入口；仅当入口缺失时补建，不重复创建已有快捷方式。
- 重建快捷方式时同步写入 `com.deepseek.dsh` AppID，保持启动入口、通知和 Windows 应用身份一致。

## 验证结果

- 将桌面与开始菜单的 `DeepSeek Harness.lnk` 移出后执行静默覆盖安装，两个入口均被自动恢复。
- 恢复后的快捷方式正确指向 D 盘正式安装目录，工作目录与应用路径一致。
- 完整测试与 NSIS 构建通过；正式安装后启动完成转场、Aqua、原工作区、会话树和既有会话内容可见，无需刷新。
- 正常关闭后 DeepSeek Harness 进程退出，端口 3080 释放。

v3.2.2 的运行时裁剪、冷启动优化与完整说明请见：[DeepSeek Harness Desktop v3.2.2](https://github.com/Links2008/DeepSeek-Harness-Desktop/releases/tag/v3.2.2)
