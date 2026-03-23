#!/bin/sh
set -e

APP_ID="yolostudio.app"
APP_DIR="$HOME/.local/share/$APP_ID"
LAUNCHER="$APP_DIR/stable/app/bin/launcher"
BIN_LINK="$HOME/.local/bin/yolostudio"
DESKTOP="$HOME/.local/share/applications/yolostudio.desktop"
UNINSTALL="$HOME/.local/bin/yolostudio-uninstall"

# Handle uninstall — triggered either by --uninstall flag or if invoked as yolostudio-uninstall
if [ "$1" = "--uninstall" ] || [ "$(basename "$0")" = "yolostudio-uninstall" ]; then
  echo "Uninstalling YOLOStudio..."
  rm -rf "$APP_DIR"
  rm -f "$BIN_LINK"
  rm -f "$DESKTOP"
  rm -f "$UNINSTALL"
  update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
  echo "YOLOStudio uninstalled."
  exit 0
fi

INSTALLER_TMP=$(mktemp /tmp/yolostudio-installer-XXXXXX)
tail -n +__LINES__ "$0" | base64 -d > "$INSTALLER_TMP"
chmod +x "$INSTALLER_TMP"
echo "Running YOLOStudio installer..."
"$INSTALLER_TMP"
rm -f "$INSTALLER_TMP"

mkdir -p "$HOME/.local/bin"
ln -sf "$LAUNCHER" "$BIN_LINK"
echo "Created command: yolostudio"

ICON_SRC="$APP_DIR/stable/app/Resources/app/icon.png"
ICON_DEST="$HOME/.local/share/icons/hicolor/256x256/apps/yolostudio.png"

mkdir -p "$HOME/.local/share/icons/hicolor/256x256/apps"
cp "$ICON_SRC" "$ICON_DEST" 2>/dev/null || true
update-icon-caches "$HOME/.local/share/icons" 2>/dev/null || true

ICON_VALUE="$ICON_DEST"
if [ ! -f "$ICON_DEST" ] && [ -f "$ICON_SRC" ]; then
  ICON_VALUE="$ICON_SRC"
fi

mkdir -p "$HOME/.local/share/applications"
printf '[Desktop Entry]\nName=YOLOStudio\nExec=%s\nIcon=%s\nType=Application\nCategories=Graphics;Science;\n' "$LAUNCHER" "$ICON_VALUE" > "$DESKTOP"
update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
echo "Created app menu entry"

cp "$0" "$UNINSTALL"
chmod +x "$UNINSTALL"
echo "Created command: yolostudio-uninstall"

echo ""
echo "Done! Run 'yolostudio' or find 'YOLOStudio' in your app menu."
echo "To uninstall: yolostudio-uninstall"
exit 0
