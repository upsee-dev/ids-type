// CJK漢字が「Unicodeのどの版で追加されたか」の表。読みで引いたときの並び順に使う。
//
// 符号位置順に並べると、拡張A(U+3400〜)が基本漢字(U+4E00〜)より前に来てしまい、
// 「つち」で土より先に見たこともない字が並ぶ。**追加された版の順**にすると
// 基本(1.1)→拡張A(3.0)→拡張B(3.1)→…の順になり、常用漢字から先に出る。
//
// 出典: UCD の DerivedAge.txt(18.0)。core/data/blocks.ts の収録範囲と重なる部分だけを
// 版ごとに畳んである(34範囲)。範囲は符号位置順に並んでいるので二分探索できる。
export const AGE_VERSIONS = [
  "1.1",
  "3.0",
  "3.1",
  "3.2",
  "4.1",
  "5.1",
  "5.2",
  "6.0",
  "6.1",
  "8.0",
  "10.0",
  "11.0",
  "13.0",
  "14.0",
  "15.0",
  "15.1",
  "17.0",
  "18.0"
] as const;

export type AgeVersion = (typeof AGE_VERSIONS)[number];

/** [先頭cp, 末尾cp, 追加された版] を符号位置順に並べたもの */
export const AGE_RANGES: readonly (readonly [number, number, AgeVersion])[] = [
  [0x3400, 0x4db5, "3.0"],
  [0x4db6, 0x4dbf, "13.0"],
  [0x4e00, 0x9fa5, "1.1"],
  [0x9fa6, 0x9fbb, "4.1"],
  [0x9fbc, 0x9fc3, "5.1"],
  [0x9fc4, 0x9fcb, "5.2"],
  [0x9fcc, 0x9fcc, "6.1"],
  [0x9fcd, 0x9fd5, "8.0"],
  [0x9fd6, 0x9fea, "10.0"],
  [0x9feb, 0x9fef, "11.0"],
  [0x9ff0, 0x9ffc, "13.0"],
  [0x9ffd, 0x9fff, "14.0"],
  [0xf900, 0xfa2d, "1.1"],
  [0xfa2e, 0xfa2f, "6.1"],
  [0xfa30, 0xfa6a, "3.2"],
  [0xfa6b, 0xfa6d, "5.2"],
  [0xfa70, 0xfad9, "4.1"],
  [0x20000, 0x2a6d6, "3.1"],
  [0x2a6d7, 0x2a6dd, "13.0"],
  [0x2a6de, 0x2a6df, "14.0"],
  [0x2a700, 0x2b734, "5.2"],
  [0x2b735, 0x2b738, "14.0"],
  [0x2b739, 0x2b739, "15.0"],
  [0x2b73a, 0x2b73f, "17.0"],
  [0x2b740, 0x2b81d, "6.0"],
  [0x2b81e, 0x2b81e, "18.0"],
  [0x2b820, 0x2cea1, "8.0"],
  [0x2cea2, 0x2cead, "17.0"],
  [0x2ceb0, 0x2ebe0, "10.0"],
  [0x2ebf0, 0x2ee5d, "15.1"],
  [0x2f800, 0x2fa1d, "3.1"],
  [0x30000, 0x3134a, "13.0"],
  [0x31350, 0x323af, "15.0"],
  [0x323b0, 0x33479, "17.0"],
];

/** 版 -> 古い順の番号(1.1 が 0)。並べ替えの第1キー */
const RANK = new Map<string, number>(AGE_VERSIONS.map((v, i) => [v, i]));

/**
 * 並べ替え用の数値。**追加された版の順 → 同じ版の中は符号位置順**。
 * 版の番号を上位ビットに置いて1つの数にまとめる(符号位置は最大21ビット)。
 * 表に無い字(部品・筆画など)は最後に回す。
 */
export function ageKey(ch: string): number {
  const cp = ch.codePointAt(0)!;
  let lo = 0;
  let hi = AGE_RANGES.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = AGE_RANGES[mid];
    if (cp < r[0]) hi = mid - 1;
    else if (cp > r[1]) lo = mid + 1;
    else return RANK.get(r[2])! * 0x200000 + cp;
  }
  return AGE_VERSIONS.length * 0x200000 + cp;
}

/**
 * ageKey の取りうる値の上限。段(常用・その他・拡張)を作るとき、
 * 段の番号にこれを掛けて足すと段が崩れない。
 */
export const AGE_STEP = (AGE_VERSIONS.length + 1) * 0x200000;

/** その字が追加された Unicode の版("" = 表に無い) */
export function ageOf(ch: string): string {
  const cp = ch.codePointAt(0)!;
  const r = AGE_RANGES.find((x) => cp >= x[0] && cp <= x[1]);
  return r ? r[2] : "";
}
