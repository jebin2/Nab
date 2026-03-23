!include "MUI2.nsh"

Name "YOLOStudio"
OutFile "YOLOStudio-Windows.exe"
InstallDir "$LOCALAPPDATA\YOLOStudio"
RequestExecutionLevel user
ShowInstDetails show

!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Install"
  SetOutPath "$INSTDIR"
  File /r "setup_extracted\*"

  ; Run electrobun setup
  nsExec::ExecToLog '"$INSTDIR\YOLOStudio-Setup.exe"'

  CreateShortcut "$DESKTOP\YOLOStudio.lnk" \
    "$LOCALAPPDATA\yolostudio.app\stable\app\bin\launcher.exe"
  CreateShortcut "$SMPROGRAMS\YOLOStudio.lnk" \
    "$LOCALAPPDATA\yolostudio.app\stable\app\bin\launcher.exe"
SectionEnd
