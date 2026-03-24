#!/bin/sh
set -e

APP_ID="reticle.app"
APP_DIR="$HOME/.local/share/$APP_ID"
LAUNCHER="$APP_DIR/stable/app/bin/launcher"
BIN_LINK="$HOME/.local/bin/reticle"
DESKTOP="$HOME/.local/share/applications/reticle.desktop"
UNINSTALL="$HOME/.local/bin/reticle-uninstall"

# Handle uninstall — triggered either by --uninstall flag or if invoked as reticle-uninstall
if [ "$1" = "--uninstall" ] || [ "$(basename "$0")" = "reticle-uninstall" ]; then
  echo "Uninstalling Reticle..."
  rm -rf "$APP_DIR"
  rm -f "$BIN_LINK"
  rm -f "$DESKTOP"
  rm -f "$UNINSTALL"
  update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
  echo "Reticle uninstalled."
  exit 0
fi

INSTALLER_TMP=$(mktemp /tmp/reticle-installer-XXXXXX)
tail -n +__LINES__ "$0" | base64 -d > "$INSTALLER_TMP"
chmod +x "$INSTALLER_TMP"
echo "Running Reticle installer..."
"$INSTALLER_TMP"
rm -f "$INSTALLER_TMP"

mkdir -p "$HOME/.local/bin"
ln -sf "$LAUNCHER" "$BIN_LINK"
echo "Created command: reticle"

ICON_SRC="$APP_DIR/stable/app/Resources/app/icon.png"
ICON_DEST="$HOME/.local/share/icons/hicolor/256x256/apps/reticle.png"

mkdir -p "$HOME/.local/share/icons/hicolor/256x256/apps"
cp "$ICON_SRC" "$ICON_DEST" 2>/dev/null || true
update-icon-caches "$HOME/.local/share/icons" 2>/dev/null || true

ICON_VALUE="$ICON_DEST"
if [ ! -f "$ICON_DEST" ] && [ -f "$ICON_SRC" ]; then
  ICON_VALUE="$ICON_SRC"
fi

mkdir -p "$HOME/.local/share/applications"
printf '[Desktop Entry]\nName=Reticle\nExec=%s\nIcon=%s\nType=Application\nCategories=Graphics;Science;\n' "$LAUNCHER" "$ICON_VALUE" > "$DESKTOP"
update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
echo "Created app menu entry"

cp "$0" "$UNINSTALL"
chmod +x "$UNINSTALL"
echo "Created command: reticle-uninstall"

echo ""
echo "Done! Run 'reticle' or find 'Reticle' in your app menu."
echo "To uninstall: reticle-uninstall"
exit 0
