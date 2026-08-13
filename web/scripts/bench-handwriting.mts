// 手書き照合の精度を測る（held-out の実データ）。
//
//   npm run bench:handwriting
//
// 問題は KanjiVG の**異体字**4,959枚（scripts/testdata/handwriting-variants.tsv、
// 作り直しは build-handwriting-bench.mts）。楷書体(Kaisho)は同じ字を手書きの
// 筆づかいで引き直したもので、画の形も長さも辞書に入っている本体とは別物。
// 筆順違い(VtLst=縦を最後に、HzFst=横を先に…)も揃っている。
// **辞書には1字も入っていない**ので、「知らない手が書いた字を当てられるか」を
// そのまま測れる。
//
// test:handwriting（自己照合）は実装が壊れていないかを見るもので、これは
// 実力を見るもの。改善するときはこちらの数字を動かすこと。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./build-data/paths.mts";
import {
  HandwritingIndex,
  type HandwritingData,
  type HwPoint,
} from "../../core/handwriting.ts";

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const CODE = new Map([...ALPHABET].map((c, i) => [c, i]));

const data: HandwritingData = JSON.parse(
  readFileSync(join(ROOT, "core", "handwriting-data.json"), "utf8"),
);
const index = new HandwritingIndex(data);

const lines = readFileSync(
  join(ROOT, "web", "scripts", "testdata", "handwriting-variants.tsv"),
  "utf8",
).split("\n");
const n = parseInt(lines[0], 10);
const per = n * 2;

/** 量子化された画の並びを点列へ戻す */
function decode(enc: string): HwPoint[][] {
  const strokes: HwPoint[][] = [];
  for (let s = 0; s < enc.length / per; s++) {
    const pts: HwPoint[] = [];
    for (let k = 0; k < n; k++) {
      pts.push([
        CODE.get(enc[s * per + k * 2]) ?? 0,
        CODE.get(enc[s * per + k * 2 + 1]) ?? 0,
      ]);
    }
    strokes.push(pts);
  }
  return strokes;
}

/** 種つき乱数(mulberry32)。走らせるたびに問題が変わると比べられない */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 「急いで乱雑に書いた」を模して崩す。異体字（すでに held-out）の上に重ねるので、
 * **知らない字形 × 乱雑な筆づかい**という、実際の入力にいちばん近い条件になる。
 *
 * 手を抜いて書くと実際に何が起きるかを一つずつ入れてある:
 *   - 字全体が斜めになる・縦横の比が変わる
 *   - 画の置き場所が少しずつずれる
 *   - 払いの終わりが届かない／行き過ぎる
 *   - 曲げるべきところが直線に近づく(速く書くほど)
 *   - 続けて書いて画がつながる／隣り合う画の順が入れ替わる
 */
function sloppy(strokes: HwPoint[][], rand: () => number): HwPoint[][] {
  const sx = 0.82 + rand() * 0.36;
  const sy = 0.82 + rand() * 0.36;
  const shear = (rand() - 0.5) * 0.16;
  const rot = (rand() - 0.5) * 0.1;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const jitter = 0.025 * 63;

  let out: HwPoint[][] = strokes.map((s) => {
    const dx = (rand() - 0.5) * 0.07 * 63; // 画ごとの置きずれ
    const dy = (rand() - 0.5) * 0.07 * 63;
    // 払いの端は届かない/行き過ぎる。曲げは速く書くほど直線に近づく
    const trimA = rand() * 0.12;
    const trimB = 1 - rand() * 0.12;
    const flat = rand() * 0.25;
    const a = s[0];
    const b = s[s.length - 1];
    return s.map((_, i) => {
      // 端の伸び縮み: 元の点列を [trimA, trimB] の範囲へ引き直す
      const u = trimA + ((trimB - trimA) * i) / (s.length - 1);
      const at = u * (s.length - 1);
      const lo = Math.max(0, Math.min(s.length - 2, Math.floor(at)));
      const t = at - lo;
      let x = s[lo][0] + (s[lo + 1][0] - s[lo][0]) * t;
      let y = s[lo][1] + (s[lo + 1][1] - s[lo][1]) * t;
      // 曲げを弦の側へ寄せる(速く書くと丸みが消える)
      const ct = i / (s.length - 1);
      x += (a[0] + (b[0] - a[0]) * ct - x) * flat;
      y += (a[1] + (b[1] - a[1]) * ct - y) * flat;
      // 字全体の傾き・縦横比、画ごとのずれ、指先の震え
      const rx = x * sx + y * shear;
      const ry = y * sy;
      return [
        rx * cos - ry * sin + dx + (rand() - 0.5) * jitter,
        rx * sin + ry * cos + dy + (rand() - 0.5) * jitter,
      ] as HwPoint;
    });
  });

  // 続け書き(隣り合う画をつなげて1本にする)
  const merged: HwPoint[][] = [];
  for (let i = 0; i < out.length; i++) {
    if (i + 1 < out.length && rand() < 0.15) {
      merged.push([...out[i], ...out[i + 1]]);
      i++;
    } else {
      merged.push(out[i]);
    }
  }
  out = merged;
  // 筆順の入れ替え(隣どうし)
  for (let i = 0; i + 1 < out.length; i += 2) {
    if (rand() < 0.2) [out[i], out[i + 1]] = [out[i + 1], out[i]];
  }
  return out;
}

interface Tally {
  n: number;
  top1: number;
  top5: number;
  top10: number;
  rankSum: number;
  miss: number;
}
const blank = (): Tally => ({ n: 0, top1: 0, top5: 0, top10: 0, rankSum: 0, miss: 0 });

const LIMIT = 20;
const pct = (a: number, b: number) => `${((a / b) * 100).toFixed(1)}%`;
const show = (label: string, t: Tally) =>
  console.log(
    `${label.padEnd(26)} ${String(t.n).padStart(5)}問  ` +
      `top1 ${pct(t.top1, t.n).padStart(6)}  top5 ${pct(t.top5, t.n).padStart(6)}  ` +
      `top10 ${pct(t.top10, t.n).padStart(6)}  圏外 ${pct(t.miss, t.n)}`,
  );

/** 1周ぶん測る。distort を渡すと崩してから引く */
function run(
  label: string,
  distort?: (s: HwPoint[][], rand: () => number) => HwPoint[][],
): { all: Tally; worst: { ch: string; kind: string; rank: number }[] } {
  const all = blank();
  // 楷書(手書きの筆づかい) と 別字形・別筆順 に分けて見る。効く手当てが違う
  const groups = new Map<string, Tally>();
  const worst: { ch: string; kind: string; rank: number; got: string; ks: number; ms: number }[] = [];
  const t0 = performance.now();
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].split("\t");
    if (f.length < 3) continue;
    const [ch, kind, enc] = f;
    if (!data.chars[ch]) continue; // 辞書に無い字は測れない
    let strokes = decode(enc);
    if (distort) strokes = distort(strokes, rng((ch.codePointAt(0)! * 31 + i) >>> 0));
    const hits = index.match(strokes, LIMIT);
    const rank = hits.findIndex((h) => h.ch === ch);

    const key = kind.includes("Kaisho") ? "楷書(手書きの筆づかい)" : "別字形・別筆順";
    const g = groups.get(key) ?? blank();
    if (!groups.has(key)) groups.set(key, g);
    for (const t of [all, g]) {
      t.n++;
      if (rank === 0) t.top1++;
      if (rank >= 0 && rank < 5) t.top5++;
      if (rank >= 0 && rank < 10) t.top10++;
      if (rank < 0) t.miss++;
      else t.rankSum += rank + 1;
    }
    if (rank < 0 || rank >= 5) worst.push({ ch, kind, rank, got: hits.slice(0, 3).map(h => h.ch).join(''), ks: strokes.length, ms: data.chars[ch].length / (n * 2) });
  }
  const ms = performance.now() - t0;
  console.log(`── ${label}  (${(ms / all.n).toFixed(1)} ms/問)`);
  for (const [k, t] of groups) show("   " + k, t);
  show("   全体", all);
  console.log("");
  return { all, worst };
}

console.log(`パターン ${index.size} 字 / 問題 ${lines.length - 2} 枚\n`);
const clean = run("そのまま（きれいに書かれた別字形）");
const rough = run("崩し重ね（知らない字形 × 乱雑な筆づかい）", sloppy);

if (process.argv.includes("--worst")) {
  for (const [label, r] of [["そのまま", clean], ["崩し重ね", rough]] as const) {
    console.log(
      `\n${label}で外した例: ` +
        r.worst
          .slice(0, 40)
          .map(
            (w) =>
              `${w.ch}[${w.ks}画→参照${w.ms}画] ` +
              `${w.rank < 0 ? "圏外" : w.rank + 1 + "位"} 出た候補=${w.got}`,
          )
          .join("\n  "),
    );
  }
}

// しきい値。加点の重みをいじって下回ったら、その変更は良くなっていない。
// 上位5件を厚めに見ているのは、キーボードは候補を並べて選ばせる道具で、
// 1位に出ることより「候補の中に居る」ことのほうが効くため
const FLOOR = [
  ["そのまま top1", clean.all.top1 / clean.all.n, 0.99],
  ["そのまま top5", clean.all.top5 / clean.all.n, 0.999],
  ["崩し重ね top1", rough.all.top1 / rough.all.n, 0.95],
  ["崩し重ね top5", rough.all.top5 / rough.all.n, 0.99],
] as const;
const under = FLOOR.filter(([, got, floor]) => got < floor);
if (under.length) {
  console.error(
    "\n精度が落ちた:\n" +
      under
        .map(([name, got, floor]) => `  ${name} ${pct(got, 1)} < ${pct(floor, 1)}`)
        .join("\n"),
  );
  process.exit(1);
}
console.log("OK（しきい値を満たしている）");
