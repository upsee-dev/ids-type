// 辞書ビルド: data-src/ の元データ -> core/kanji-data.json + web/public/data/
//
//   npm run build:data                      # 既定(3表を重ねる)
//   IDS_SOURCE=babelstone npm run build:data # BabelStone だけ(GPLを避けたいとき)
//
// 収録範囲は zi.tools と同じ「Unicode の CJK 漢字ぜんぶ」。
// 各工程は scripts/build-data/ に分けてある。
//   kanjidic2  … 読み・学年・頻度(＝「日本の漢字」の定義)
//   readings   … KANJIDIC2 に無い字の読みを埋める(Unihan・異体字・声符)
//   ids-sources… 3つのIDS表のパーサ
//   merge      … 優先順位つきで1つに畳む
//   split      … chars / ext / parts に振り分ける
//   verify     … ブロックごとの収録漏れを検証(欠けたらビルドを止める)
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { ensureOutDirs, OUT_DIRS, ROOT } from "./build-data/paths.mts";
import { loadKanjidic2 } from "./build-data/kanjidic2.mts";
import { loadUnihan, makeRefReadings } from "./build-data/readings.mts";
import { mergeIds, type IdsMode } from "./build-data/merge.mts";
import { splitDictionary } from "./build-data/split.mts";
import { verifyCoverage } from "./build-data/verify.mts";
import {
  emitImeDict,
  emitPalettesKotlin,
  emitPalettesSwift,
  emitThemesKotlin,
  emitThemesSwift,
  emitOperatorIconsKotlin,
  emitOperatorIconsSwift,
} from "./build-data/emit-ime.mts";

const mode = (process.env.IDS_SOURCE as IdsMode) || "mixed";
ensureOutDirs();

const kanjidic = loadKanjidic2();
console.log(`KANJIDIC2: ${kanjidic.size} 字`);

const { ids, log: mergeLog } = mergeIds(kanjidic, mode);
for (const line of mergeLog) console.log(line);

// 読みの補完。KANJIDIC2 が読みを持つのは13,108字だけなので、
// 残り9万字は Unihan・異体字・声符から埋める(正式かどうかは分けて持つ)
const unihan = loadUnihan();
console.log(
  `Unihan: 日本語読み ${unihan.japanese.size} 字 / 異体字 ${unihan.variants.size} 字 / 部首番号 ${unihan.radical.size} 字`,
);
const refOf = makeRefReadings(kanjidic, ids, unihan);

const data = splitDictionary(kanjidic, ids, refOf);
console.log(`
chars(KANJIDIC2):   ${Object.keys(data.chars).length}
ext(その他の漢字):  ${Object.keys(data.ext).length} (うち分解なし ${data.extNoIds})
parts(漢字以外):    ${Object.keys(data.parts).length}
分解を持たない葉:   ${data.leaves.size}  ${[...data.leaves].slice(0, 40).join("")}
`);

const { log: verifyLog } = verifyCoverage(data, mode);
for (const line of verifyLog) console.log(line);

// 読みの網羅。「読みで引けない字」がどれだけ残ったかはこの数字で追う
{
  const n = { on: 0, nanori: 0, plusRef: 0, u: 0, v: 0, p: 0, none: 0 };
  const count = (ref: string, kind: string) => {
    if (!ref) return void n.none++;
    n[kind[0] as "u" | "v" | "p"]++;
  };
  for (const v of Object.values(data.chars)) {
    const [, , , on, kun, , , , nanori, ref, kind] = v;
    if (on || kun) {
      n.on++;
      if (ref) n.plusRef++; // 正式な読みに加えて、資料にしか無い読みも足した字
    } else {
      count(ref, kind);
    }
    if (nanori) n.nanori++;
  }
  for (const [, ref, kind] of Object.values(data.ext)) count(ref, kind);

  const total = Object.keys(data.chars).length + Object.keys(data.ext).length;
  const pct = (x: number) => `${((x / total) * 100).toFixed(1)}%`;
  console.log(`
読み  正式(KANJIDIC2の音訓):     ${n.on}  ${pct(n.on)}
        ＋人名読み(nanori)つき:  ${n.nanori} 字
        ＋参考の読みも足した字:  ${n.plusRef} 字
      参考(Unihan の日本語読み): ${n.u}  ${pct(n.u)}
      推定(異体字から):          ${n.v}  ${pct(n.v)}
      推定(声符から):            ${n.p}  ${pct(n.p)}
      読みなし:                  ${n.none}  ${pct(n.none)}`);
}

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
console.log(
  "  着せ替え: " +
    emitThemesKotlin(
      join(ROOT, "native/ime/android/java/com/upsee/katachi/ime/Themes.kt"),
    ),
);
console.log(
  "  着せ替え: " + emitThemesSwift(join(ROOT, "native/targets/keyboard/Themes.swift")),
);
console.log(
  "  配置図: " +
    emitOperatorIconsKotlin(
      join(ROOT, "native/ime/android/java/com/upsee/katachi/ime/OperatorIcons.kt"),
    ),
);
console.log(
  "  配置図: " +
    emitOperatorIconsSwift(join(ROOT, "native/targets/keyboard/OperatorIcons.swift")),
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
