#!/usr/bin/env bash
# ينسخ ملفات الويب إلى مجلد assets في مشروع الأندرويد
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/ys-games-apk/app/src/main/assets/www"
mkdir -p "$DEST" "$DEST/games/vendor" "$DEST/games/images" "$DEST/js" "$DEST/apk-shell"

copy() { mkdir -p "$(dirname "$DEST/$1")"; cp "$ROOT/$1" "$DEST/$1"; }

copy index.html
copy games.json
copy version.json
copy js/ys-platform.js
copy games/car-game.html
copy games/chess.html
copy games/millionaire.html
copy games/millionaire-questions.json
copy games/resturant.html
copy games/vendor/three.min.js
copy games/images/chess.svg
copy games/images/millionaire.png
copy games/images/resturant.webp
copy games/images/car-game.webp
copy games/images/car-game-thumb.png
cp "$ROOT/apk-shell/offline.html" "$DEST/apk-shell/offline.html"
cp "$ROOT/apk-shell/loading.html" "$DEST/apk-shell/loading.html"
mkdir -p "$ROOT/ys-games-apk/app/src/main/assets/www/apk-shell"
cp "$ROOT/apk-shell/offline.html" "$ROOT/ys-games-apk/app/src/main/assets/www/apk-shell/offline.html"
cp "$ROOT/apk-shell/loading.html" "$ROOT/ys-games-apk/app/src/main/assets/www/apk-shell/loading.html"

echo "✅ تم النسخ إلى $DEST"
