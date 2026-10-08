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
  /** Unihan(読み・異体字・部首番号)。展開すると25MBあるので zip のまま読む */
  unihanZip: join(DATA_SRC, "unihan", "Unihan.zip"),
  /** 和製漢字の辞典2014(HTML版)。172ページを1本に連結したもの */
  wasei: join(DATA_SRC, "readings", "waseikanji.html"),
  /** JK(IRG国字コレクション)782字の読み。zi.tools の字典面から取った */
  jk: join(DATA_SRC, "readings", "jk.tsv"),
  /** zi.tools の日本語音読み(50,144字)。呉音・漢音・唐音の区別つき */
  ziOnyomi: join(DATA_SRC, "readings", "zi-onyomi.tsv"),
  /** 手で足した読み。どの資料にも無いが、足してほしいと言われた読み */
  manual: join(DATA_SRC, "readings", "manual.tsv"),
};
