#!/usr/bin/env bash
# نسخ أصول الويب ثم بناء APK (release)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

"$ROOT/scripts/sync-apk-assets.sh"

APK_DIR="$ROOT/ys-games-apk"
if [ ! -f "$APK_DIR/gradlew" ]; then
  echo "❌ gradlew غير موجود — شغّل: cd ys-games-apk && gradle wrapper" >&2
  exit 1
fi

if [ ! -f "$APK_DIR/local.properties" ]; then
  if [ -n "${ANDROID_HOME:-}" ] && [ -d "$ANDROID_HOME" ]; then
    echo "sdk.dir=$ANDROID_HOME" > "$APK_DIR/local.properties"
  elif [ -d "$HOME/Android/Sdk" ]; then
    echo "sdk.dir=$HOME/Android/Sdk" > "$APK_DIR/local.properties"
  else
    echo "❌ أنشئ ys-games-apk/local.properties من local.properties.example" >&2
    exit 1
  fi
fi

# Android Gradle يحتاج JDK 17 (ليس JRE فقط)
for jhome in \
  "${JAVA_HOME:-}" \
  /usr/lib/jvm/java-17-openjdk-amd64 \
  /usr/lib/jvm/java-1.17.0-openjdk-amd64; do
  if [ -n "$jhome" ] && [ -x "$jhome/bin/javac" ]; then
    export JAVA_HOME="$jhome"
    break
  fi
done
if [ ! -x "${JAVA_HOME:-}/bin/javac" ]; then
  echo "❌ ثبّت OpenJDK 17 (مثلاً: sudo apt install openjdk-17-jdk)" >&2
  exit 1
fi

cd "$APK_DIR"
./gradlew assembleRelease

APK=$(ls -1 app/build/outputs/apk/release/*.apk 2>/dev/null | head -1)
echo "✅ APK جاهز: $APK"
