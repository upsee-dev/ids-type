// 手書き照合のテスト。
//
//   npm run test:handwriting
//
// 生成済みパターン(core/handwriting-data.json)の各字について、参照ストロークに
// 「下手な書き手」を模した崩しを加えて照合に戻し、正しい字が上位に出るかを見る。
//   - 揺れ:   各点をランダムにずらす(手ぶれ)
//   - 伸縮:   全体を縦横別々に伸ばす(字形のくずれ)
//   - 逆順:   一部の画を逆向きに書く
//   - 順序:   隣り合う画を入れ替える(書き順違い)
// 乱数は種つき(再現可能)。全字は重いので等間隔サンプル+定番の字で見る。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./build-data/paths.mts";
import {
  HandwritingIndex,
  type HandwritingData,
} from "../../core/handwriting.ts";

const data: HandwritingData = JSON.parse(
  readFileSync(join(ROOT, "core", "handwriting-data.json"), "utf8"),
);
const index = new HandwritingIndex(data);
console.log(`パターン: ${index.size} 字`);

// 種つき乱数(mulberry32)。実行のたびに結果が変わるとテストにならない
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const CODE = new Map([...ALPHABET].map((c, i) => [c, i]));

/** 参照パターンを点列に戻す */
function decode(enc: string, n: number): number[][][] {
  const per = n * 2;
  const strokes: number[][][] = [];
  for (let s = 0; s < enc.length / per; s++) {
    const pts: number[][] = [];
    for (let k = 0; k < n; k++) {
      pts.push([
        (CODE.get(enc[s * per + k * 2]) ?? 0) / 63,
        (CODE.get(enc[s * per + k * 2 + 1]) ?? 0) / 63,
      ]);
    }
    strokes.push(pts);
  }
  return strokes;
}

/** 「下手な書き手」を模した崩しを加える */
function distort(
  strokes: number[][][],
  rand: () => number,
): [number, number][][] {
  const jitter = 0.045; // 手ぶれ(正規化空間の4.5%)
  const sx = 0.85 + rand() * 0.4; // 縦横別々の伸縮 0.85〜1.25
  const sy = 0.85 + rand() * 0.4;
  return strokes.map((s, i) => {
    let pts = s.map(
      ([x, y]) =>
        [
          x * sx + (rand() - 0.5) * jitter * 2,
          y * sy + (rand() - 0.5) * jitter * 2,
        ] as [number, number],
    );
    if (rand() < 0.15) pts = [...pts].reverse(); // 15%の画は逆向きに書く
    // 30%の確率で隣の画と順序を入れ替える(呼び出し側で行うと複雑なのでここで:
    // i が偶数のとき次の画と交換するかを決め、交換フラグを立てる)
    return pts;
  });
}

/** 隣り合う画の入れ替え(書き順違い) */
function swapSome(
  strokes: [number, number][][],
  rand: () => number,
): [number, number][][] {
  const out = [...strokes];
  for (let i = 0; i + 1 < out.length; i += 2) {
    if (rand() < 0.3) [out[i], out[i + 1]] = [out[i + 1], out[i]];
  }
  return out;
}

// 等間隔サンプル + 定番の字(よく引かれるであろう字形のバリエーション)
const all = Object.keys(data.chars);
const sample = new Set<string>();
for (let i = 0; i < all.length; i += 23) sample.add(all[i]);
for (const ch of "明日本語水火山川一二三口国字辺永癶鬱薔") {
  if (data.chars[ch]) sample.add(ch);
}

let top1 = 0;
let top5 = 0;
let total = 0;
let worst: { ch: string; rank: number }[] = [];
const t0 = performance.now();
for (const ch of sample) {
  const strokes = decode(data.chars[ch], data.n);
  const rand = rng(ch.codePointAt(0)!);
  const drawn = swapSome(distort(strokes, rand), rand);
  const hits = index.match(drawn, 20);
  const rank = hits.findIndex((h) => h.ch === ch);
  total++;
  if (rank === 0) top1++;
  if (rank >= 0 && rank < 5) top5++;
  else worst.push({ ch, rank });
}
const ms = performance.now() - t0;

console.log(
  `崩し入り自己照合: ${total} 字  top1 ${((top1 / total) * 100).toFixed(1)}%  ` +
    `top5 ${((top5 / total) * 100).toFixed(1)}%  (${(ms / total).toFixed(1)} ms/字)`,
);
worst = worst.slice(0, 12);
if (worst.length) {
  console.log(
    "top5落ち: " +
      worst.map((w) => `${w.ch}(${w.rank < 0 ? "圏外" : w.rank + 1}位)`).join(" "),
  );
}

// 続け書き(隣り合う画をつなげて1画で書く)への耐性。
// 口を2画で書く・辶を続けて引くなど、速く書く人ほど画数が減る
let mergedTop5 = 0;
let mergedTotal = 0;
for (const ch of sample) {
  const strokes = decode(data.chars[ch], data.n);
  if (strokes.length < 4) continue;
  const rand = rng(ch.codePointAt(0)! ^ 0x5eed);
  const merged: [number, number][][] = [];
  for (let i = 0; i < strokes.length; i++) {
    const cur = strokes[i].map(([x, y]) => [x, y] as [number, number]);
    if (i + 1 < strokes.length && rand() < 0.3) {
      // 次の画とつなげて1画にする(間は照合側の間引きが直線で橋渡しする)
      cur.push(...strokes[i + 1].map(([x, y]) => [x, y] as [number, number]));
      i++;
    }
    merged.push(cur);
  }
  if (merged.length === strokes.length) continue; // 1画もつながらなかった
  const hits = index.match(merged, 5);
  mergedTotal++;
  if (hits.some((h) => h.ch === ch)) mergedTop5++;
}
const mergedRate = mergedTop5 / mergedTotal;
console.log(
  `続け書き(画のつながり)耐性: ${mergedTotal} 字  top5 ${(mergedRate * 100).toFixed(1)}%`,
);

// しきい値: ここを下回ったら照合かパターン生成のどこかが壊れている。
// **実力を測るものではない**(自分のパターンを少し揺らして引き直しているだけ)。
// 実力は bench:handwriting（KanjiVG の異体字を使った held-out）で測ること
if (top1 / total < 0.95 || top5 / total < 0.98 || mergedRate < 0.9) {
  console.error("\n精度がしきい値(top1 95% / top5 98% / 続け書きtop5 90%)を下回った");
  process.exit(1);
}
console.log("OK");
