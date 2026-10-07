; 安装升级后刷新已有入口，避免仅重命名旧快捷方式而保留旧程序与图标来源。
; 安装器 APP_ID 保持 Nanpad 以兼容原安装；Shell 使用知屿身份隔离旧任务栏缓存。
!macro customInstall
  !ifndef DO_NOT_CREATE_START_MENU_SHORTCUT
    ${if} ${FileExists} "$newStartMenuLink"
      CreateShortCut "$newStartMenuLink" "$appExe" "" "$INSTDIR\resources\zhiyu.ico" 0 "" "" "${APP_DESCRIPTION}"
      WinShell::SetLnkAUMI "$newStartMenuLink" "dev.songwo.zhiyu"
    ${endIf}
  !endif
  !ifndef DO_NOT_CREATE_DESKTOP_SHORTCUT
    ${ifNot} ${isNoDesktopShortcut}
    ${andIf} ${FileExists} "$newDesktopLink"
      CreateShortCut "$newDesktopLink" "$appExe" "" "$INSTDIR\resources\zhiyu.ico" 0 "" "" "${APP_DESCRIPTION}"
      WinShell::SetLnkAUMI "$newDesktopLink" "dev.songwo.zhiyu"
    ${endIf}
  !endif
  ; 通知资源管理器更新图标，不清空全局缓存，也不重启资源管理器。
  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend
