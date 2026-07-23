// ../core（Next.js版と共有する検索エンジン＋辞書）を native/src/core/ へ複製する。
//
// Metro はプロジェクト外のファイルを解決できず、Expo CLI が watchFolders を
// 上書きするため（SDK 57 で確認）、npm workspaces を使わない構成では
// 「ビルド前にコピーする」のが最も確実。src/core/ は生成物なので .gitignore 済み。
// metro.config.js の読み込み時にも実行されるので、gradle 経由のバンドルでも最新になる。
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const coreDir = join(here, "..", "..", "core");
const destDir = join(here, "..", "src", "core");

const HEADER = "// 自動生成: ../../core/engine.ts のコピー。編集は core/engine.ts 側で行うこと。\n";

export function syncCore() {
  mkdirSync(destDir, { recursive: true });
  writeFileSync(
    join(destDir, "engine.ts"),
    HEADER + readFileSync(join(coreDir, "engine.ts"), "utf8"),
  );
  copyFileSync(join(coreDir, "kanji-data.json"), join(destDir, "kanji-data.json"));
}

syncCore();
