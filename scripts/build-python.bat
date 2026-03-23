@echo off
REM Build the Python training script into a standalone binary using PyInstaller.
REM Run this once on Windows before packaging the app.
REM
REM Output: src\python\train.exe
REM
REM Requirements: pip install pyinstaller ultralytics

cd /d "%~dp0\.."

echo Installing dependencies...
pip install --quiet pyinstaller ultralytics

echo Building standalone binary...
pyinstaller src\python\train.py ^
  --onefile ^
  --name train ^
  --distpath src\python ^
  --workpath build\pyinstaller\work ^
  --specpath build\pyinstaller ^
  --noconfirm

echo Done: src\python\train.exe
