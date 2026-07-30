// ../../core（Next.js版と共有する検索エンジン＋辞書）を native/src/core/ へ複製する。
//
// Metro はプロジェクト外のファイルを解決できず、Expo CLI が watchFolders を
// 上書きするため（SDK 57 で確認）、npm workspaces を使わない構成では
// 「ビルド前にコピーする」のが最も確実。src/core/ は生成物なので .gitignore 済み。
// metro.config.js の読み込み時にも実行されるので、gradle 経由のバンドルでも最新になる。
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const coreDir = join(here, "..", "..", "core");
const destDir = join(here, "..", "src", "core");

const HEADER = "// 自動生成: ../../core/ のコピー。編集は core/ 側で行うこと。\n";

/** core/ 配下の .ts に「触るな」ヘッダを足しつつ再帰コピーする */
function copyTree(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src)) {
    if (name.startsWith(".")) continue; // .DS_Store など
    const from = join(src, name);
    const to = join(dest, name);
    if (statSync(from).isDirectory()) {
      copyTree(from, to);
    } else if (name.endsWith(".ts")) {
      writeFileSync(to, HEADER + readFileSync(from, "utf8"));
    } else {
      cpSync(from, to);
    }
  }
}

export function syncCore() {
  // 消えたファイルが残らないよう作り直す
  rmSync(destDir, { recursive: true, force: true });
  copyTree(coreDir, destDir);
}

syncCore();

if (process.argv[1] && relative(process.cwd(), process.argv[1]).endsWith("sync-core.mjs")) {
  const count = (function walk(d) {
    return readdirSync(d).reduce(
      (n, f) => n + (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : 1),
      0,
    );
  })(destDir);
  console.log(`synced core/ -> native/src/core/ (${count} files)`);
}
