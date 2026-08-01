// Expo config plugin: リリースビルドをアップロード鍵で署名する。
//
// prebuild が作る android/app/build.gradle は release も debug 鍵で署名する設定になっている。
// そのまま Play に上げると「デバッグモードで署名されています」で弾かれるので、
// ここで署名設定を差し替える。android/ は生成物なので毎回やり直す必要がある。
//
// 鍵とパスワードは store/AuthKey/ に置き .gitignore 済み。
// 鍵を失うと同じアプリを更新できなくなるため、必ず別途バックアップすること。
const { withDangerousMod } = require("expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

const CRED_DIR = path.join("..", "store", "AuthKey");
const PROPS = "keystore.properties";

const withReleaseSigning = (config) =>
  withDangerousMod(config, [
    "android",
    (cfg) => {
      const root = cfg.modRequest.projectRoot;
      const android = cfg.modRequest.platformProjectRoot;
      const credDir = path.join(root, CRED_DIR);
      const propsPath = path.join(credDir, PROPS);

      if (!fs.existsSync(propsPath)) {
        console.warn(
          `!! ${propsPath} が無いのでリリース署名はデバッグ鍵のままです（Playには上げられません）`,
        );
        return cfg;
      }

      // 鍵は android/app/ から相対で参照させる。コピーではなく実体を指す
      const props = Object.fromEntries(
        fs
          .readFileSync(propsPath, "utf8")
          .split("\n")
          .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
          .map((l) => {
            const i = l.indexOf("=");
            return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
          }),
      );
      const keystoreAbs = path.join(credDir, props.storeFile);

      const gradlePath = path.join(android, "app", "build.gradle");
      let gradle = fs.readFileSync(gradlePath, "utf8");

      // 1) release 用の signingConfig を足す（debug の定義の直後に差し込む）
      if (!gradle.includes("signingConfigs.release")) {
        gradle = gradle.replace(
          /(signingConfigs\s*\{)/,
          `$1
        release {
            storeFile file('${keystoreAbs.replace(/\\/g, "/")}')
            storePassword '${props.storePassword}'
            keyAlias '${props.keyAlias}'
            keyPassword '${props.keyPassword}'
        }`,
        );
        // 2) release ビルドの署名を差し替える
        gradle = gradle.replace(
          /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/,
          "$1signingConfig signingConfigs.release",
        );
        fs.writeFileSync(gradlePath, gradle);
      }
      return cfg;
    },
  ]);

module.exports = withReleaseSigning;
