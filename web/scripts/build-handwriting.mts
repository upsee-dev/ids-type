// 手書き検索のパターン辞書: data-src/kanjivg/kanjivg.xml.gz -> handwriting-data.json
//
//   npm run build:handwriting
//
// KanjiVG(CC BY-SA 3.0)の筆順つき字形から、字ごとの「ストローク特徴」を取り出して
// 圧縮する。SVGパスのままだと13MBあり端末で構文解析もできないので、
// 1画を等間隔8点に間引き、字全体の外接枠で正規化して0〜63に量子化、
// 1点=2文字(64進)の文字列に畳む(1画=16文字)。復号と照合は core/handwriting.ts。
//
// KanjiVG の日本語字形を基礎に、AnimCJK の実際の筆画資料で未収録字を補う。
// 筆画資料のない文字は、検索辞書にあっても手書きの候補にはできない。
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { DATA_SRC, ensureOutDirs, OUT_DIRS, ROOT } from "./build-data/paths.mts";
import { isIdeograph } from "../../core/data/blocks.ts";
import { HandwritingIndex, resampleStroke } from "../../core/handwriting.ts";
import { strokesOf } from "./build-data/kanjivg.mts";

/** 1画を何点に間引くか。core/handwriting.ts の照合と合わせること */
const POINTS_PER_STROKE = 8;

/** 0〜63 の値1つを1文字にする(JSONにそのまま置ける64字) */
const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

// SVGパスの解析は build-data/kanjivg.mts に切り出してある(精度評価と共用)


// ---- 本体 ----

const xml = gunzipSync(
  readFileSync(join(DATA_SRC, "kanjivg", "kanjivg.xml.gz")),
).toString("utf8");

/** 手書き対象の字か。漢字ブロック + 部首(⼀⺅…) + 々〆〇 */
function isTarget(cp: number): boolean {
  const ch = String.fromCodePoint(cp);
  if (isIdeograph(ch)) return true;
  if (cp >= 0x2e80 && cp <= 0x2fdf) return true; // 部首・部首補助
  return cp >= 0x3005 && cp <= 0x3007; // 々〆〇
}

const chars: Record<string, string> = {};
let skipped = 0;
let degenerate = 0;
const strokeHist = new Map<number, number>();

for (const m of xml.matchAll(
  /<kanji id="kvg:kanji_([0-9a-f]{4,6})">([\s\S]*?)<\/kanji>/g,
)) {
  const cp = parseInt(m[1], 16);
  if (!isTarget(cp)) {
    skipped++;
    continue;
  }
  const strokes = strokesOf(m[2], POINTS_PER_STROKE);
  if (!strokes.length) continue;

  // 字全体の外接枠で正規化(等倍・中央寄せ)。書き手のはみ出し方に
  // 依存しないよう、照合側(core/handwriting.ts)も同じ正規化をする
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of strokes) {
    for (const [px, py] of s) {
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
  }
  const scale = Math.max(maxX - minX, maxY - minY);
  if (!(scale > 0)) {
    degenerate++;
    continue;
  }
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;

  let enc = "";
  for (const s of strokes) {
    for (const [px, py] of s) {
      const qx = Math.round((0.5 + (px - midX) / scale) * 63);
      const qy = Math.round((0.5 + (py - midY) / scale) * 63);
      enc += ALPHABET[Math.min(63, Math.max(0, qx))];
      enc += ALPHABET[Math.min(63, Math.max(0, qy))];
    }
  }
  chars[String.fromCodePoint(cp)] = enc;
  strokeHist.set(strokes.length, (strokeHist.get(strokes.length) ?? 0) + 1);
}

// KanjiVG に無い字だけを実際の筆画資料から補う。日本語の字形を優先し、
// 繁体字・簡体字の順に補完する。元の日本語パターンは上書きしない。
let added = 0;
for (const language of ["Ja", "ZhHant", "ZhHans"]) {
  const input = gunzipSync(readFileSync(join(DATA_SRC, "animcjk", `medians${language}.jsonl.gz`))).toString("utf8");
  for (const line of input.trim().split("\n")) {
    const row = JSON.parse(line) as { character: string; medians: [number, number][][] };
    const ch = row.character;
    if ([...ch].length !== 1 || !isTarget(ch.codePointAt(0)!) || chars[ch] || !row.medians.length) continue;
    if (row.medians.some(s => !s.length || s.some(p => p.length !== 2 || !p.every(Number.isFinite)))) {
      throw new Error(`不正な筆画データ: ${language} ${ch}`);
    }
    // graphics 形式は y 軸が上向き。画面座標に戻し、既存辞書と同じ正規化をする。
    const strokes = row.medians.map(s => resampleStroke(s.map(([x, y]) => [x, 900 - y]), POINTS_PER_STROKE));
    const points = strokes.flat();
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const scale = Math.max(maxX - minX, maxY - minY);
    if (!(scale > 0)) continue;
    const midX = (minX + maxX) / 2, midY = (minY + maxY) / 2;
    chars[ch] = points.map(([x, y]) =>
      ALPHABET[Math.min(63, Math.max(0, Math.round((0.5 + (x - midX) / scale) * 63)))] +
      ALPHABET[Math.min(63, Math.max(0, Math.round((0.5 + (y - midY) / scale) * 63)))],
    ).join("");
    added++;
    strokeHist.set(strokes.length, (strokeHist.get(strokes.length) ?? 0) + 1);
  }
}
console.log(`AnimCJK から ${added} 字を追加（Arphic Public License）`);

const json = JSON.stringify({ v: 1, n: POINTS_PER_STROKE, chars });
const license = "AnimCJK — Copyright 2016–2026 FM&SH\nhttps://github.com/parsimonhi/animCJK\n\n"
  + "変更: 筆画中心線の抽出・座標の反転・正規化・量子化。\n\n"
  + readFileSync(join(DATA_SRC, "animcjk", "ARPHIC-PUBLIC-LICENSE.txt"), "utf8");
writeFileSync(join(ROOT, "core", "data", "handwriting-license.ts"),
  `// 自動生成: build-handwriting.mts。元の権利表示を含めてアプリへ同梱する。\nexport const HANDWRITING_LICENSE = ${JSON.stringify(license)};\n`);
writeFileSync(join(ROOT, "web", "public", "data", "handwriting-license.txt"), license);
ensureOutDirs();
const names: string[] = [];
for (const d of OUT_DIRS) {
  // Web は fetch で読むので public/data/、アプリは require するので core/
  const name = d.endsWith("core") ? "handwriting-data.json" : "handwriting.json";
  writeFileSync(join(d, name), json);
  names.push(join(d, name));
}

// システムキーボード(Android/iOS)向け。辞書と同じ理由で JSON にはしない
// (キーボードは呼ばれた瞬間に出ないと使えないので、構文解析を挟まずに読めるもの)。
// 行を1回 split するだけで読める tsv にしておく。
// 拡張子が .tsv なら config plugin (withKatachiIme.js) が両OSへ複製する
const imeDir = join(ROOT, "native", "ime", "assets");
const imeLines = Object.entries(chars).map(([ch, enc]) => `${ch}\t${enc}`);
writeFileSync(join(imeDir, "hw.tsv"), `${POINTS_PER_STROKE}\n${imeLines.join("\n")}\n`);
names.push(join(imeDir, "hw.tsv"));

// Kotlin/Swift への移植が TypeScript と同じ候補を同じ順で返すかを見るための問題集。
// 「崩して描いた画」と、この実装が返した上位を並べて置く。ime/test/ の各言語の
// テストがこれを読んで突き合わせる(数値の扱いがずれると即座に落ちる)
writeFileSync(
  join(ROOT, "native", "ime", "test", "handwriting-cases.tsv"),
  buildParityCases(chars),
);
names.push(join(ROOT, "native", "ime", "test", "handwriting-cases.tsv"));

/**
 * 移植の突き合わせ用の問題集を作る。
 *
 * 1行 = `期待する上位5字 \t 画1 \t 画2 …`、画は `x,y x,y …`(整数)。
 * 座標を整数にしてあるのは、問題そのものが言語ごとの読み取り誤差で変わらない
 * ようにするため。期待値はこの TypeScript 実装が返したものなので、
 * Kotlin/Swift 側は「同じ問いに同じ答えを返すか」だけを見ればよい。
 */
function buildParityCases(chars: Record<string, string>): string {
  const index = new HandwritingIndex({ v: 1, n: POINTS_PER_STROKE, chars });
  // 種つき乱数(mulberry32)。作り直すたびに問題が変わると突き合わせにならない
  const rng = (seed: number) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const alpha = new Map([...ALPHABET].map((c, i) => [c, i]));
  const all = Object.keys(chars);
  const lines: string[] = [];
  // 画数のばらつく字を等間隔に拾う(1画の字から30画の字まで通る)
  for (let i = 0; i < all.length; i += 97) {
    const ch = all[i];
    const enc = chars[ch];
    const per = POINTS_PER_STROKE * 2;
    const rand = rng(ch.codePointAt(0)!);
    // 参照の点を「手ぶれ・伸縮」で崩し、0〜1000 の整数で書き出す
    const sx = 0.85 + rand() * 0.4;
    const sy = 0.85 + rand() * 0.4;
    const strokes: string[] = [];
    for (let s = 0; s < enc.length / per; s++) {
      const pts: string[] = [];
      for (let k = 0; k < POINTS_PER_STROKE; k++) {
        const x = (alpha.get(enc[s * per + k * 2]) ?? 0) / 63;
        const y = (alpha.get(enc[s * per + k * 2 + 1]) ?? 0) / 63;
        pts.push(
          `${Math.round((x * sx + (rand() - 0.5) * 0.09) * 1000)},` +
            `${Math.round((y * sy + (rand() - 0.5) * 0.09) * 1000)}`,
        );
      }
      strokes.push(pts.join(" "));
    }
    const drawn = strokes.map(
      (s) =>
        s.split(" ").map((p) => p.split(",").map(Number) as [number, number]),
    );
    const top = index.match(drawn, 5).map((h) => h.ch).join("");
    lines.push([top, ...strokes].join("\t"));
  }
  return `${lines.length}\n${lines.join("\n")}\n`;
}

const mb = (b: number) => (b / 1024 / 1024).toFixed(2);
const total = Object.keys(chars).length;
const hist = [...strokeHist].sort((a, b) => a[0] - b[0]);
console.log(
  `手書きパターン: ${total} 字 (漢字以外をスキップ ${skipped} / 退化 ${degenerate})`,
);
console.log(
  `画数の分布: ${hist[0][0]}〜${hist[hist.length - 1][0]}画 ` +
    `(最多 ${hist.reduce((a, b) => (b[1] > a[1] ? b : a))[0]}画)`,
);
console.log(
  `wrote handwriting-data.json: ${mb(Buffer.byteLength(json, "utf8"))} MB ` +
    `(gzip ${mb(gzipSync(json, { level: 9 }).length)} MB)` +
    `\n  -> ${names.join("\n  -> ")}`,
);
