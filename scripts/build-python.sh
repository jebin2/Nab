#!/usr/bin/env bash
# Build the Python training script into a standalone binary using PyInstaller.
# Run this once per platform before packaging the app.
#
# Output: src/python/train  (Linux/macOS)
#
# Requirements: pip install pyinstaller ultralytics

set -euo pipefail
cd "$(dirname "$0")/.."

echo "Installing dependencies..."
pip install --quiet pyinstaller ultralytics

echo "Building standalone binary..."
pyinstaller src/python/train.py \
  --onefile \
  --name train \
  --distpath src/python \
  --workpath build/pyinstaller/work \
  --specpath build/pyinstaller \
  --noconfirm

echo "Done → src/python/train"
