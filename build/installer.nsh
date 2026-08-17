# v2.2.1：覆盖安装/卸载前强制关闭运行中的桌面壳与其内置 node 后端。
# 旧版（v2.2.0 及以前）静默卸载器无法自行结束占用进程：内置 node 后端
# （含父进程已死的孤儿进程）会锁住安装目录下 resources 里的运行时文件，
# 导致旧卸载器返回退出码 2，安装器重试 5 次后弹出"无法关闭"。
# - customInit：新安装器在调用旧版卸载器之前先结束进程树，修复从旧版升级。
# - customUnInit / customCheckAppRunning：本版本及以后的卸载器在检查
#   "应用是否在运行" 时直接结束进程，而不是弹窗等待用户手动关闭。
# node 进程只按"可执行文件路径位于安装目录内"匹配，避免误杀用户其它 node 进程。

!macro dshKillRunningProcesses
  ReadRegStr $R9 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  StrCmp $R9 "" 0 +2
  ReadRegStr $R9 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  StrCmp $R9 "" 0 +2
  StrCpy $R9 $INSTDIR
  nsExec::ExecToLog 'taskkill /F /IM "${APP_EXECUTABLE_FILENAME}" /T'
  nsExec::ExecToLog "powershell -NoProfile -ExecutionPolicy Bypass -Command $\"Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { $$_.Path -like '$R9\*' } | Stop-Process -Force -ErrorAction SilentlyContinue$\""
  Sleep 800
!macroend

!macro customInit
  !insertmacro dshKillRunningProcesses
!macroend

!macro customUnInit
  !insertmacro dshKillRunningProcesses
!macroend

!macro customCheckAppRunning
  !insertmacro dshKillRunningProcesses
!macroend
