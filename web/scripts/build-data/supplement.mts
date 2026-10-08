// 上流の表がまだ持っていない字を手で補う。**ここは一時的な置き場**で、
// 上流が追いついたら消す(消しても結果が変わらないよう、上流を必ず優先する)。
//
// Unicode の追加は毎年あるが、IDS表(BabelStone・CHISE・CJKVI)と Unihan が
// 追いつくのは数か月〜1年あとになる。追加された字は
// **字としては存在するのに分解も画数も無い**ので、収録はされても
// 構造検索にも画数の絞り込みにも出てこない。1〜2字なら手で足すほうが早い。
//
// | 字 | 符号位置 | 追加 | 上流の状況 |
// | -- | -------- | ---- | ---------- |
// | 𫠞 | U+2B81E  | Unicode 18.0 (2026) | BabelStone 16.0 / CHISE 17.0 に無い(Unihan は 18.0 で入った) |
//
// U+2B81E は 18.0 で増えた**唯一の統合漢字**(DerivedAge: "2B81E ; 18.0")で、
// 拡張Dの末尾に1字だけ足された(ブロックの枠は 2B740..2B81F まであり、
// 6.0 以来2つ空いていたうちの1つが埋まった)。分解は ⿰日欠。
// 画数8は Unihan 18.0 の kTotalStrokes の値(ほかに kRSUnicode 72.4=部首72(日)+4画・
// kMorohashi 13825・kIRG_GSource GCESI-00550)。data-src の Unihan.zip を 18.0.0 に
// 上げたので画数は Unihan から取れるようになった(Unihan 側が優先される)。
// ここの画数は Unihan を 17.0 に戻したときの控えとして残してある。
export interface Supplement {
  /** 分解(IDS)。3つの表と同じ書式 */
  ids: string;
  /** 総画数。Unihan の kTotalStrokes と同じ意味の値 */
  strokes: number;
}

export const SUPPLEMENT = new Map<string, Supplement>([
  ["\u{2B81E}", { ids: "⿰日欠", strokes: 8 }],
]);

/** merge が使う「字 -> 分解」。上流に無いときだけ拾われる */
export function supplementIds(): Map<string, string> {
  return new Map([...SUPPLEMENT].map(([ch, v]) => [ch, v.ids]));
}

/** Unihan に行が無い字の画数。Unihan 側にあればそちらが優先 */
export function supplementStrokes(): Map<string, number> {
  return new Map([...SUPPLEMENT].map(([ch, v]) => [ch, v.strokes]));
}
