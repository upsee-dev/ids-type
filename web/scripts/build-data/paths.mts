// 入出力の場所を1か所にまとめる。
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** リポジトリ直下 */
export const ROOT = join(here, "..", "..", "..");
export const DATA_SRC = join(ROOT, "data-src");

/** Web は fetch で読むので public/ 配下、Expo アプリは require するので core/ 配下 */
export const OUT_DIRS = [join(ROOT, "web", "public", "data"), join(ROOT, "core")];

export function ensureOutDirs(): void {
  for (const d of OUT_DIRS) mkdirSync(d, { recursive: true });
}

export const SRC = {
  kanjidic2Xml: join(DATA_SRC, "kanjidic2", "kanjidic2.xml"),
  kanjidic2Gz: join(DATA_SRC, "kanjidic2", "kanjidic2.xml.gz"),
  babelstone: join(DATA_SRC, "ids", "babelstone.txt"),
  cjkvi: join(DATA_SRC, "ids", "cjkvi.txt"),
  chise: join(DATA_SRC, "ids", "chise.txt"),
};
