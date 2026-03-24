!include "MUI2.nsh"

Name "Reticle"
OutFile "Reticle-Windows.exe"
InstallDir "$LOCALAPPDATA\Reticle"
RequestExecutionLevel user
ShowInstDetails show

!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Install"
  SetOutPath "$INSTDIR"
  File /r "setup_extracted\*"

  ; Run electrobun setup
  nsExec::ExecToLog '"$INSTDIR\Reticle-Setup.exe"'

  CreateShortcut "$DESKTOP\Reticle.lnk" \
    "$LOCALAPPDATA\reticle.app\stable\app\bin\launcher.exe"
  CreateShortcut "$SMPROGRAMS\Reticle.lnk" \
    "$LOCALAPPDATA\reticle.app\stable\app\bin\launcher.exe"
SectionEnd
