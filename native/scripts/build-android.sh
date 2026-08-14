#!/usr/bin/env bash
# カタチ入力 Android ローカルビルド（EAS 不使用・このマシンだけで完結）
#
# 生成物: build/katachi-ime-<version>.apk （デバッグ用キーストアで署名済み。
#         端末に adb install / ファイル転送でそのまま入る。ストア提出には別途本番署名が必要）
set -euo pipefail

cd "$(dirname "$0")/.."

# このマシンでは temurin17 が /usr/libexec/java_home に登録されていないため直接指定する
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$JAVA_HOME/bin:$PATH"

echo "JAVA_HOME=$JAVA_HOME"
java -version
echo "ANDROID_HOME=$ANDROID_HOME"

# ../core を src/core/ へ同期（Metro からも呼ばれるが単体実行時のために明示）
node scripts/sync-core.mjs

# app.json から android/ を再生成（既存の android/ は作り直す）
npx expo prebuild -p android --clean --no-install

# prebuild は autolinking の結果を **package名を書き換える前** に吐くことがある。
# その場合 android/build/generated/autolinking/autolinking.json が
# テンプレートの com.app のまま残り、gradle がそれを使って
#   ReactNativeApplicationEntryPoint.java: パッケージcom.appは存在しません
# で :app:compileReleaseJavaWithJavac が落ちる。gradle に作り直させる
rm -rf android/build/generated/autolinking

pushd android >/dev/null
./gradlew assembleRelease --no-daemon
popd >/dev/null

VERSION=$(node -p "require('./app.json').expo.version")
mkdir -p build
cp android/app/build/outputs/apk/release/app-release.apk "build/katachi-ime-${VERSION}.apk"

echo
echo "できました: $(pwd)/build/katachi-ime-${VERSION}.apk"
ls -lh "build/katachi-ime-${VERSION}.apk"
