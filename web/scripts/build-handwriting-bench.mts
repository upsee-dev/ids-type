// 手書き照合の精度を測るための問題集を作る（held-out の実データ）。
//
//   node --experimental-strip-types scripts/build-handwriting-bench.mts <kanjivg-all.zip>
//
// なぜ要るか: それまでの精度テストは**参照パターン自身を乱数で崩して引き直す**
// 自己照合だった。これは「実装が壊れていないか」は見られるが、
// 「知らない手で書かれた字を当てられるか」は測れない（同じ元データを
// 少し揺らしただけなので、当たって当たり前）。
//
// KanjiVG の配布物には、本体(kanjivg.xml)に入っていない**異体字ファイル**が
// 4,088枚ある。楷書体(Kaisho)は同じ字を手書きの筆づかいで引き直したもので、
// 画の形も長さも本体とは別物。筆順違い(VtLst=縦を最後に、HzFst=横を先に など)も
// 揃っている。**辞書には1字も入っていない**ので、そのまま held-out の
// 評価セットになる。
//
// 出力 scripts/testdata/handwriting-variants.tsv は hw.tsv と同じ量子化形式
// (1点=2文字の64進)。生の座標を持たせると数MBになるうえ、実装ごとの読み取り
// 誤差で問題そのものが変わってしまう。
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./build-data/paths.mts";
import { strokesOf } from "./build-data/kanjivg.mts";
import { isIdeograph } from "../../core/data/blocks.ts";

/** 問題は解像度に依存しないよう細かめに持つ。照合側が自分の点数へ引き直す */
const POINTS_PER_STROKE = 16;
const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const zip = process.argv[2];
if (!zip) {
  console.error(
    "使い方: build-handwriting-bench.mts <kanjivg-all.zip>\n" +
      "  https://github.com/KanjiVG/kanjivg/releases から -all.zip を落として渡す",
  );
  process.exit(1);
}

// zip を読む口が Node の標準に無いので unzip に任せる。
// この問題集は生成物を置いておく側なので、作り直すときだけ要る
const work = mkdtempSync(join(tmpdir(), "kvg-"));
try {
  execFileSync("unzip", ["-o", "-q", zip, "kanji/*-*.svg", "-d", work]);
  const dir = join(work, "kanji");
  const files = readdirSync(dir).filter((f) => f.endsWith(".svg"));

  const lines: string[] = [];
  const kinds = new Map<string, number>();
  let skipped = 0;
  for (const f of files.sort()) {
    // 04e00-Kaisho.svg -> 符号位置 04e00 / 種類 Kaisho
    const m = /^([0-9a-f]{4,6})-(.+)\.svg$/.exec(f);
    if (!m) continue;
    const cp = parseInt(m[1], 16);
    const ch = String.fromCodePoint(cp);
    // パターン辞書に入れているのと同じ範囲だけ(漢字・部首・々〆〇)
    const inRange =
      isIdeograph(ch) ||
      (cp >= 0x2e80 && cp <= 0x2fdf) ||
      (cp >= 0x3005 && cp <= 0x3007);
    if (!inRange) {
      skipped++;
      continue;
    }
    const strokes = strokesOf(readFileSync(join(dir, f), "utf8"), POINTS_PER_STROKE);
    if (!strokes.length) continue;

    // 参照と同じ正規化(全画の外接枠で等倍・中央寄せ)をしてから量子化する
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of strokes) {
      for (const [x, y] of s) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    const scale = Math.max(maxX - minX, maxY - minY);
    if (!(scale > 0)) continue;
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    let enc = "";
    for (const s of strokes) {
      for (const [x, y] of s) {
        const qx = Math.round((0.5 + (x - midX) / scale) * 63);
        const qy = Math.round((0.5 + (y - midY) / scale) * 63);
        enc += ALPHABET[Math.min(63, Math.max(0, qx))];
        enc += ALPHABET[Math.min(63, Math.max(0, qy))];
      }
    }
    const kind = m[2];
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    lines.push(`${ch}\t${kind}\t${enc}`);
  }

  const out = join(ROOT, "web", "scripts", "testdata");
  mkdirSync(out, { recursive: true });
  writeFileSync(
    join(out, "handwriting-variants.tsv"),
    `${POINTS_PER_STROKE}\n${lines.join("\n")}\n`,
  );
  const top = [...kinds].sort((a, b) => b[1] - a[1]).slice(0, 8);
  console.log(
    `異体字 ${lines.length} 枚 (漢字以外をスキップ ${skipped})\n` +
      `  内訳: ${top.map(([k, n]) => `${k} ${n}`).join(" / ")} ほか ${kinds.size} 種`,
  );
  console.log(`-> ${join(out, "handwriting-variants.tsv")}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
