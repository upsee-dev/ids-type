// かな入力(12キーフリック)の表。
//
// アプリは自前のかたちキーボードを持つので、読みを打つのに端末のIMEへ
// 往復させない(させると変換が始まった瞬間に欄ごと持っていかれる)。
// そこで読み入力の面をアプリの中に持つ。並びは日本のスマホで標準の
// 12キーフリック(あ行〜わ行＋濁点＋⌫)。
//
// システムキーボード(Android の Kana.kt / iOS の Kana.swift)と同じ表。
// あちらは手書きの二重管理のままだが、アプリ(React Native)と Web が
// 使う分はこの1か所にまとめる。

/**
 * フリック1キーぶん。chars は [中央, 左, 上, 右, 下] の順で、
 * 空文字は「その向きには割り当てなし(中央のまま)」を表す。
 * chars が空配列のキーは文字キーではない(濁点・⌫)。
 */
export interface KanaKey {
  label: string;
  chars: string[];
}

/** 濁点キー・⌫キーの目印(label で見分ける) */
export const KANA_DAKUTEN = "小゛゜";
export const KANA_BACKSPACE = "⌫";

const key = (
  center: string,
  left: string,
  up: string,
  right: string,
  down: string,
): KanaKey => ({ label: center, chars: [center, left, up, right, down] });

export const KANA_ROWS: KanaKey[][] = [
  [key("あ", "い", "う", "え", "お"), key("か", "き", "く", "け", "こ"), key("さ", "し", "す", "せ", "そ")],
  [key("た", "ち", "つ", "て", "と"), key("な", "に", "ぬ", "ね", "の"), key("は", "ひ", "ふ", "へ", "ほ")],
  [key("ま", "み", "む", "め", "も"), key("や", "", "ゆ", "", "よ"), key("ら", "り", "る", "れ", "ろ")],
  [
    { label: KANA_DAKUTEN, chars: [] },
    key("わ", "を", "ん", "ー", "〜"),
    { label: KANA_BACKSPACE, chars: [] },
  ],
];

/** フリックの向き。0=中央 1=左 2=上 3=右 4=下 */
export function kanaFlick(k: KanaKey, dir: number): string {
  const c = dir < k.chars.length ? k.chars[dir] : "";
  return c || k.chars[0];
}

/**
 * 「小゛゜」キーで1字を送る輪。標準のかなキーボードと同じで、
 * 押すたび 濁点 → 半濁点 → 小文字 → 元 と巡る。
 */
const RINGS = [
  "あぁ", "いぃ", "うぅゔ", "えぇ", "おぉ",
  "かが", "きぎ", "くぐ", "けげ", "こご",
  "さざ", "しじ", "すず", "せぜ", "そぞ",
  "ただ", "ちぢ", "つっづ", "てで", "とど",
  "はばぱ", "ひびぴ", "ふぶぷ", "へべぺ", "ほぼぽ",
  "やゃ", "ゆゅ", "よょ", "わゎ",
];

/** 末尾1字を輪の次へ送る。輪に無い字(ん・ー など)は null */
export function kanaCycle(ch: string): string | null {
  for (const ring of RINGS) {
    const chars = [...ring];
    const i = chars.indexOf(ch);
    if (i >= 0) return chars[(i + 1) % chars.length];
  }
  return null;
}
