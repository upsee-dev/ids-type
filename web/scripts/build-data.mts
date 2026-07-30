// 辞書ビルド: data-src/ の元データ -> core/kanji-data.json + web/public/data/
//
//   npm run build:data                      # 既定(3表を重ねる)
//   IDS_SOURCE=babelstone npm run build:data # BabelStone だけ(GPLを避けたいとき)
//
// 収録範囲は zi.tools と同じ「Unicode の CJK 漢字ぜんぶ」。
// 各工程は scripts/build-data/ に分けてある。
//   kanjidic2  … 読み・学年・頻度(＝「日本の漢字」の定義)
//   ids-sources… 3つのIDS表のパーサ
//   merge      … 優先順位つきで1つに畳む
//   split      … chars / ext / parts に振り分ける
//   verify     … ブロックごとの収録漏れを検証(欠けたらビルドを止める)
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { ensureOutDirs, OUT_DIRS, ROOT } from "./build-data/paths.mts";
import { loadKanjidic2 } from "./build-data/kanjidic2.mts";
import { mergeIds, type IdsMode } from "./build-data/merge.mts";
import { splitDictionary } from "./build-data/split.mts";
import { verifyCoverage } from "./build-data/verify.mts";
import {
  emitImeDict,
  emitPalettesKotlin,
  emitPalettesSwift,
} from "./build-data/emit-ime.mts";

const mode = (process.env.IDS_SOURCE as IdsMode) || "mixed";
ensureOutDirs();

const kanjidic = loadKanjidic2();
console.log(`KANJIDIC2: ${kanjidic.size} 字`);

const { ids, log: mergeLog } = mergeIds(kanjidic, mode);
for (const line of mergeLog) console.log(line);

const data = splitDictionary(kanjidic, ids);
console.log(`
chars(KANJIDIC2):   ${Object.keys(data.chars).length}
ext(その他の漢字):  ${Object.keys(data.ext).length} (うち分解なし ${data.extNoIds})
parts(漢字以外):    ${Object.keys(data.parts).length}
分解を持たない葉:   ${data.leaves.size}  ${[...data.leaves].slice(0, 40).join("")}
`);

const { log: verifyLog } = verifyCoverage(data, mode);
for (const line of verifyLog) console.log(line);

// ネイティブIME(Android/iOS)はキーボードの起動が速くないと使いものにならないので、
// JSON とは別にタブ区切りの辞書も出す(構文解析を挟まずに読める)
const imeDir = join(ROOT, "native", "ime", "assets");
for (const line of emitImeDict(data, imeDir)) console.log(`  IME辞書: ${line}`);
console.log(
  "  IME辞書: " +
    emitPalettesKotlin(
      join(ROOT, "native/ime/android/java/com/upsee/katachi/ime/Palettes.kt"),
    ),
);
console.log(
  "  IME辞書: " + emitPalettesSwift(join(ROOT, "native/targets/keyboard/Palettes.swift")),
);

const json = JSON.stringify({ chars: data.chars, ext: data.ext, parts: data.parts });
for (const d of OUT_DIRS) writeFileSync(join(d, "kanji-data.json"), json);

// json.length は UTF-16 のコード単位数。漢字は UTF-8 で 3〜4 バイトなので
// 実ファイルはこの倍近くになる。UI に出す数字がずれないよう実バイト数で測る
const mb = (n: number) => (n / 1024 / 1024).toFixed(2);
const total = Object.keys(data.chars).length + Object.keys(data.ext).length;
console.log(
  `\nwrote kanji-data.json: ${mb(Buffer.byteLength(json, "utf8"))} MB ` +
    `(gzip ${mb(gzipSync(json, { level: 9 }).length)} MB ← 実際の転送量) ` +
    `(検索候補 ${total} 字)\n  -> ${OUT_DIRS.join("\n  -> ")}`,
);
