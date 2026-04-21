!include "MUI2.nsh"

!ifdef ICON_PATH
  !define MUI_ICON "${ICON_PATH}"
  !define MUI_UNICON "${ICON_PATH}"
!endif

Name "Nab"
OutFile "Nab-Windows.exe"
InstallDir "$LOCALAPPDATA\Nab"
RequestExecutionLevel user
ShowInstDetails show

!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Install"
  SetOutPath "$INSTDIR"
  File /r "setup_extracted\*"

  ; Run electrobun setup
  nsExec::ExecToLog '"$INSTDIR\Nab-Setup.exe"'

  CreateShortcut "$DESKTOP\Nab.lnk" \
    "$LOCALAPPDATA\nab.app\stable\app\bin\launcher.exe" \
    "" "$INSTDIR\installer-icon.ico" 0
  CreateShortcut "$SMPROGRAMS\Nab.lnk" \
    "$LOCALAPPDATA\nab.app\stable\app\bin\launcher.exe" \
    "" "$INSTDIR\installer-icon.ico" 0
SectionEnd
