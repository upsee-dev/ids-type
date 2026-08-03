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

/** 拡張漢字用フォント(scripts/build-font-app.py が生成)。iOS拡張だけ自前の複製が要る */
const EXT_FONTS = ["KatachiExt1.ttf", "KatachiExt2.ttf"];

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

      // 拡張漢字用フォント(KatachiExt1/2)は app.json の expo-font プラグインが
      // assets/fonts/ へ置くので、ここでコピーする必要はない。IME(Kotlin)は
      // RN と同じその1部を Typeface.createFromAsset で読む＝APK が二重に太らない。
      // 生成されているかだけ確かめる(無いとキーボードが ☒ だらけになる)
      for (const name of EXT_FONTS) {
        if (!fs.existsSync(path.join(root, "assets", "fonts", name))) {
          console.warn(
            `!! ${name} が無いのでキーボードの拡張漢字が ☒ になります。` +
              "python3 scripts/build-font-app.py を実行してください",
          );
        }
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
      // iOS の App Extension は自分のバンドルしか読めないので、Android と違って
      // 拡張漢字フォントの複製が要る(その分アプリの容量が増えるが、これが無いと
      // システムキーボードの候補が ☒ になる)。Info.plist の UIAppFonts に
      // 載せてあるので、拡張の中で UIFont(name:) として引ける
      const fonts = path.join(root, "assets", "fonts");
      for (const name of EXT_FONTS) {
        const src = path.join(fonts, name);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(target, name));
        } else {
          console.warn(
            `!! ${name} が無いのでキーボードの拡張漢字が ☒ になります。` +
              "python3 scripts/build-font-app.py を実行してください",
          );
        }
      }
      return cfg;
    },
  ]);

module.exports = (config) =>
  withImeAssetsIos(withImeService(withImeSources(config)));
