// Metro を起動するたびに、共有コア（../core）を src/core/ へ同期する。
// expo start / expo export / gradle のバンドル工程すべてがここを通るので、
// どの経路でビルドしても Web 版と同じエンジン・辞書が入る。
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

execFileSync(process.execPath, [path.join(__dirname, "scripts", "sync-core.mjs")], {
  stdio: "inherit",
});

module.exports = getDefaultConfig(__dirname);
