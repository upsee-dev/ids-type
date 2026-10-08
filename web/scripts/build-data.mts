// 辞書ビルド: data-src/ の元データ -> core/kanji-data.json + web/public/data/
//
//   npm run build:data                      # 既定(3表を重ねる)
//   IDS_SOURCE=babelstone npm run build:data # BabelStone だけ(GPLを避けたいとき)
//
// 収録範囲は zi.tools と同じ「Unicode の CJK 漢字ぜんぶ」。
// 各工程は scripts/build-data/ に分けてある。
//   kanjidic2  … 読み・学年・頻度(＝「日本の漢字」の定義)
//   readings   … KANJIDIC2 に無い字の読みを埋める(Unihan・和製漢字の辞典・IRG ほか。推定はしない)
//   ids-sources… 3つのIDS表のパーサ
//   merge      … 優先順位つきで1つに畳む
//   supplement … 上流の表がまだ持っていない新しい字を補う(今は U+2B81E だけ)
//   split      … chars / ext / parts に振り分ける
//   verify     … ブロックごとの収録漏れを検証(欠けたらビルドを止める)
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { ensureOutDirs, OUT_DIRS, ROOT, SRC } from "./build-data/paths.mts";
import { loadKanjidic2 } from "./build-data/kanjidic2.mts";
import { loadManual, loadUnihan, makeRefReadings } from "./build-data/readings.mts";
import { loadWasei } from "./build-data/wasei.mts";
import { loadJk, loadZiOnyomi } from "./build-data/extra-readings.mts";
import { loadIrgReadings } from "./build-data/irg.mts";
import { mergeIds, type IdsMode } from "./build-data/merge.mts";
import { splitDictionary } from "./build-data/split.mts";
import { supplementStrokes } from "./build-data/supplement.mts";
import { verifyCoverage } from "./build-data/verify.mts";
import {
  emitImeDict,
  emitPalettesKotlin,
  emitPalettesSwift,
  emitThemesKotlin,
  emitThemesSwift,
  emitOperatorIconsKotlin,
  emitOperatorIconsSwift,
  emitAgeKotlin,
  emitAgeSwift,
  emitRomajiKotlin,
  emitRomajiSwift,
} from "./build-data/emit-ime.mts";

const mode = (process.env.IDS_SOURCE as IdsMode) || "mixed";
ensureOutDirs();

const kanjidic = loadKanjidic2();
console.log(`KANJIDIC2: ${kanjidic.size} 字`);

const { ids, alt, log: mergeLog } = mergeIds(kanjidic, mode);
for (const line of mergeLog) console.log(line);

// 読みの補完。KANJIDIC2 が読みを持つのは13,108字だけなので、
// 残り9万字は資料にある読みで埋める(正式かどうかは分けて持つ。推定はしない)
const unihan = loadUnihan();
console.log(
  `Unihan: 日本語読み ${unihan.japanese.size} 字 / IRGの源の記号 ${unihan.irgSources.size} 件 / 画数 ${unihan.strokes.size} 字`,
);
// 国字の読み。Unihan も KANJIDIC2 も持たない字が多い(wasei.mts)。
// 見出しが画像の項目を字に結びつけるのに画数を使う
const wasei = loadWasei(unihan.strokes);
console.log(`和製漢字の辞典: ${wasei.size} 字 (読み ${[...wasei.values()].reduce((n, v) => n + v.length, 0)} 件)`);
// JK(IRG国字コレクション)の読み。国字は他の表に読みが無いことが多い
const jk = loadJk();
console.log(`JK(国字コレクション): ${jk.size} 字`);

// zi.tools の音読み。Unihan と大きく重なるが、1,230字ぶん Unihan に無い読みを持つ
const ziOnyomi = loadZiOnyomi();
console.log(
  `zi.tools の音読み: ${ziOnyomi.size} 字 (${[...ziOnyomi.values()].reduce((n, v) => n + v.length, 0)} 件)`,
);

// 手で足した読み(data-src/readings/manual.tsv)
const manual = loadManual(SRC.manual);
console.log(`手で足した読み: ${manual.size} 字`);

// IRG ワーキングセットで提案国が書き添えた読み(拼音・壮語・韓国語・ベトナム語)。
// 日本語の読みが1つも無い字にだけ、カタカナに書き写して入れる
const irg = loadIrgReadings(unihan.irgSources);
console.log(`IRG ワーキングセットの読み: ${irg.byChar.size} 字`);
for (const [k, v] of Object.entries(irg.counts)) console.log(`  ${k}: ${v}`);

const refOf = makeRefReadings(kanjidic, unihan, wasei, jk, ziOnyomi, manual, irg.byChar);

// 画数は Unihan(kTotalStrokes)から。Unihan がまだ知らない新しい字だけ
// supplement.mts の値で埋める(上流が追いつけば Unihan 側が使われる)
const extraStrokes = supplementStrokes();
const data = splitDictionary(
  kanjidic,
  ids,
  refOf,
  ch => unihan.strokes.get(ch) ?? extraStrokes.get(ch) ?? 0,
  ch => alt.get(ch) ?? [],
);
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
  const n = {
    on: 0, nanori: 0, plusRef: 0,
    u: 0, w: 0, j: 0, z: 0, m: 0, e: 0, i: 0, none: 0,
  };
  const count = (ref: string, kind: string) => {
    if (!ref) return void n.none++;
    n[kind[0] as "u" | "w" | "j" | "z" | "m" | "e" | "i"]++;
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
  const noStrokes =
    Object.values(data.chars).filter(v => !v[5]).length +
    Object.values(data.ext).filter(v => !v[3]).length;

  const total = Object.keys(data.chars).length + Object.keys(data.ext).length;
  const pct = (x: number) => `${((x / total) * 100).toFixed(1)}%`;
  console.log(`
読み  正式(KANJIDIC2の音訓):     ${n.on}  ${pct(n.on)}
        ＋人名読み(nanori)つき:  ${n.nanori} 字
        ＋参考の読みも足した字:  ${n.plusRef} 字
      参考(Unihan の日本語読み): ${n.u}  ${pct(n.u)}
      参考(和製漢字の辞典):      ${n.w}  ${pct(n.w)}
      参考(JK 国字コレクション): ${n.j}  ${pct(n.j)}
      参考(zi.tools の音読み):   ${n.z}  ${pct(n.z)}
      参考(手で足した読み):      ${n.m}  ${pct(n.m)}
      参考(互換漢字の元の字):    ${n.e}  ${pct(n.e)}
      外国語音(IRG の書き写し):  ${n.i}  ${pct(n.i)}
      読みなし:                  ${n.none}  ${pct(n.none)}

画数(Unihan kTotalStrokes)が無い字: ${noStrokes}`);
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
console.log(
  "  版の表: " +
    emitAgeKotlin(join(ROOT, "native/ime/android/java/com/upsee/katachi/ime/Age.kt")),
);
console.log(
  "  版の表: " + emitAgeSwift(join(ROOT, "native/targets/keyboard/Age.swift")),
);
console.log(
  "  読みの面: " +
    emitRomajiKotlin(join(ROOT, "native/ime/android/java/com/upsee/katachi/ime/Romaji.kt")),
);
console.log(
  "  読みの面: " + emitRomajiSwift(join(ROOT, "native/targets/keyboard/Romaji.swift")),
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
