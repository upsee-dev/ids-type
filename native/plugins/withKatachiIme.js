// Expo config plugin: システムキーボード(IME)を prebuild 後の android/ に組み込む。
//
// android/ は `expo prebuild` の生成物で .gitignore 済み。そこへ直接書くと
// prebuild のたびに消えるので、ネイティブのソースは native/ime/ に置いておき、
// このプラグインが毎回コピー＋AndroidManifest への service 追記をやる。
//
//   native/ime/android/java/...     -> android/app/src/main/java/...
//   native/ime/android/res/...      -> android/app/src/main/res/...
//   native/ime/assets/*.tsv         -> android/app/src/main/assets/...
//
// 辞書 tsv は web の `npm run build:data` が書き出す。
const {
  withDangerousMod,
  withAndroidManifest,
  AndroidConfig,
} = require("expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

const SERVICE = "com.upsee.katachi.ime.KatachiImeService";

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    if (name.startsWith(".")) continue;
    const src = path.join(from, name);
    const dst = path.join(to, name);
    if (fs.statSync(src).isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

/** Kotlin・リソース・辞書を android/ へ流し込む */
const withImeSources = (config) =>
  withDangerousMod(config, [
    "android",
    (cfg) => {
      const root = cfg.modRequest.projectRoot;
      const android = cfg.modRequest.platformProjectRoot;
      const main = path.join(android, "app", "src", "main");
      const ime = path.join(root, "ime");

      copyDir(path.join(ime, "android", "java"), path.join(main, "java"));
      copyDir(path.join(ime, "android", "res"), path.join(main, "res"));

      const dictDir = path.join(ime, "assets");
      if (!fs.existsSync(dictDir)) {
        throw new Error(
          "IME用の辞書がありません。先に web で `npm run build:data` を実行してください:\n  " + dictDir,
        );
      }
      const assets = path.join(main, "assets");
      fs.mkdirSync(assets, { recursive: true });
      for (const f of fs.readdirSync(dictDir)) {
        if (f.endsWith(".tsv")) fs.copyFileSync(path.join(dictDir, f), path.join(assets, f));
      }

      // 部品パレット用サブセットフォント。RN 側は expo-font で読むが、
      // キーボード拡張は Kotlin なので assets から Typeface で読む必要がある
      const font = path.join(root, "assets", "fonts", "KatachiParts.ttf");
      if (fs.existsSync(font)) {
        fs.copyFileSync(font, path.join(assets, "KatachiParts.ttf"));
      } else {
        console.warn("!! KatachiParts.ttf が無いので IME の部品が □ になります: " + font);
      }
      return cfg;
    },
  ]);

/** AndroidManifest に <service> を足す。BIND_INPUT_METHOD が無いと OS が認識しない */
const withImeService = (config) =>
  withAndroidManifest(config, (cfg) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    app.service = (app.service ?? []).filter(
      (s) => s.$?.["android:name"] !== SERVICE,
    );
    app.service.push({
      $: {
        "android:name": SERVICE,
        "android:label": "@string/katachi_ime_label",
        "android:permission": "android.permission.BIND_INPUT_METHOD",
        "android:exported": "true",
      },
      "intent-filter": [
        { action: [{ $: { "android:name": "android.view.InputMethod" } }] },
      ],
      "meta-data": [
        {
          $: {
            "android:name": "android.view.im",
            "android:resource": "@xml/method",
          },
        },
      ],
    });
    return cfg;
  });

/**
 * iOS: 辞書とフォントを targets/keyboard/ へ置く。
 * @bacons/apple-targets が targets/<name>/ の中身を拡張ターゲットに取り込むので、
 * Swift ソースはそこに直接置き、生成物(辞書・フォント)だけここで複製する。
 * ios/ 自体は prebuild の生成物なので触らない。
 */
const withImeAssetsIos = (config) =>
  withDangerousMod(config, [
    "ios",
    (cfg) => {
      const root = cfg.modRequest.projectRoot;
      const target = path.join(root, "targets", "keyboard");
      const dictDir = path.join(root, "ime", "assets");
      if (!fs.existsSync(dictDir)) {
        throw new Error(
          "IME用の辞書がありません。先に web で `npm run build:data` を実行してください:\n  " + dictDir,
        );
      }
      fs.mkdirSync(target, { recursive: true });
      for (const f of fs.readdirSync(dictDir)) {
        if (f.endsWith(".tsv")) fs.copyFileSync(path.join(dictDir, f), path.join(target, f));
      }
      const font = path.join(root, "assets", "fonts", "KatachiParts.ttf");
      if (fs.existsSync(font)) fs.copyFileSync(font, path.join(target, "KatachiParts.ttf"));
      return cfg;
    },
  ]);

module.exports = (config) =>
  withImeAssetsIos(withImeService(withImeSources(config)));
