#!/bin/sh
# Adds the Linux build (npm run build-linux) to your app launcher.
set -e
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$SRC_DIR/dist/Prism-linux-x64"
[ -x "$APP_DIR/Prism" ] || { echo "Build first: npm run build-linux"; exit 1; }

mkdir -p "$HOME/.local/share/applications" "$HOME/.local/share/icons/hicolor/512x512/apps"
cp "$SRC_DIR/www/icon.png" "$HOME/.local/share/icons/hicolor/512x512/apps/spootify.png"
cat > "$HOME/.local/share/applications/spootify.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Prism
Comment=Prism Music Player
Exec="$APP_DIR/Prism" %U
Icon=spootify
Terminal=false
Categories=AudioVideo;Audio;Player;
StartupWMClass=spootify
EOF
echo "Installed. Prism should now show up in your launcher."
