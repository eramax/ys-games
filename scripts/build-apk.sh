#!/usr/bin/env bash
# نسخ أصول الويب ثم بناء APK release موقّع للتحميل
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

"$ROOT/scripts/sync-apk-assets.sh"

APK_DIR="$ROOT/ys-games-apk"
KEYSTORE_FILE="$APK_DIR/ys-games-release.jks"
KEYSTORE_PROPS="$APK_DIR/keystore.properties"
KEY_ALIAS="ysgames"

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

if ! command -v keytool >/dev/null 2>&1; then
  echo "❌ keytool غير موجود — ثبّت OpenJDK 17 JDK كاملاً" >&2
  exit 1
fi

ensure_release_keystore() {
  if [ -f "$KEYSTORE_FILE" ] && [ -f "$KEYSTORE_PROPS" ]; then
    return 0
  fi

  if [ -f "$KEYSTORE_FILE" ] && [ ! -f "$KEYSTORE_PROPS" ]; then
    echo "❌ يوجد $KEYSTORE_FILE لكن keystore.properties مفقود." >&2
    echo "   أعد إنشاء keystore.properties يدوياً أو احذف .jks وأعد التشغيل." >&2
    exit 1
  fi

  echo "🔐 إنشاء مفتاح التوقيع (مرة واحدة)..."

  STORE_PASS="$(openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | head -c 24)"

  keytool -genkeypair -v \
    -keystore "$KEYSTORE_FILE" \
    -storepass "$STORE_PASS" \
    -keypass "$STORE_PASS" \
    -alias "$KEY_ALIAS" \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=YS Games, OU=Mobile, O=YS Games, L=Cairo, ST=Cairo, C=EG"

  cat > "$KEYSTORE_PROPS" <<EOF
storeFile=ys-games-release.jks
storePassword=${STORE_PASS}
keyAlias=${KEY_ALIAS}
keyPassword=${STORE_PASS}
EOF

  chmod 600 "$KEYSTORE_PROPS" "$KEYSTORE_FILE" 2>/dev/null || true

  echo "✅ تم إنشاء مفتاح التوقيع:"
  echo "   $KEYSTORE_FILE"
  echo "   $KEYSTORE_PROPS"
  echo "⚠️  الملفان في .gitignore — احفظ نسخة احتياطية للتحديثات المستقبلية!"
}

ensure_release_keystore

cd "$APK_DIR"
./gradlew assembleRelease

SIGNED_RELEASE="$APK_DIR/app/build/outputs/apk/release/app-release.apk"
DOWNLOAD_APK="$ROOT/ys-games-app.apk"

if [ ! -f "$SIGNED_RELEASE" ]; then
  echo "❌ فشل إنشاء APK موقّع — تحقق من keystore.properties" >&2
  ls -la "$APK_DIR/app/build/outputs/apk/release/" 2>/dev/null || true
  exit 1
fi

cp "$SIGNED_RELEASE" "$DOWNLOAD_APK"
echo "✅ APK موقّع جاهز للتحميل: $DOWNLOAD_APK"
ls -lh "$DOWNLOAD_APK"
echo "📦 release (موقّع): $SIGNED_RELEASE"
