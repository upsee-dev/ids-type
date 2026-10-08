// Godan の配列。ローマ字をフリックで打つ面。
//
// 左列に母音 A I U E O、中央に K S T N(かさたな行)、右に H M Y R W(はまやらわ行)
// を縦に並べる3列5段。両手で持つと「右手で子音・左手で母音」になる。
// 出典: Google 日本語入力ヘルプ「Godan キーボード」
// https://support.google.com/ime/japanese/answer/2700298
//
// **フリックはこのアプリの用途に合わせてある**。本家は上フリックに C F J L Q V X、
// 下フリックに数字(電話配列)を置くが、ここは**読みを打つためだけの面**なので
// 数字も記号も要らない。代わりに、読みを打つのに要る濁音・半濁音・拗音の
// 綴りを左右上に置く(H右→b・H左→p は本家と同じ考え方)。
//
// 打った文字は core/data/romaji.ts が かな に直す。フリック入力(KANA_ROWS)と
// 同じ読み欄に入るので、入力方法を切り替えても打ちかけ以外は引き継げる。
import { KANA_BACKSPACE } from "./kana.ts";

/**
 * Godan の1キー。chars は [中央, 左, 上, 右, 下] でフリック表と同じ並び。
 * 中身はローマ字なので、確定は romajiToKana に任せる。
 */
export interface GodanKey {
  label: string;
  chars: string[];
}

const key = (
  center: string,
  left = "",
  up = "",
  right = "",
  down = "",
): GodanKey => ({ label: center.toUpperCase(), chars: [center, left, up, right, down] });

/**
 * 3列5段。列は [母音, かさたな, はまやらわ]。
 * 濁音は右フリック(k→g, s→z, t→d, h→b)、半濁音は左フリック(h→p)、
 * 拗音・別綴りは上フリック(s→sh, t→ch, h→f)に置いている。
 */
export const GODAN_ROWS: GodanKey[][] = [
  [key("a"), key("k", "", "c", "g"), key("h", "p", "f", "b")],
  [key("i"), key("s", "sh", "j", "z"), key("m")],
  [key("u"), key("t", "ts", "ch", "d"), key("y")],
  [key("e"), key("n"), key("r")],
  [key("o"), { label: "小゛゜", chars: [] }, key("w")],
];

/** ⌫ は面の外(フリック入力と同じ見た目に揃えるため、UI 側が足す) */
export const GODAN_BACKSPACE = KANA_BACKSPACE;

/** フリックの向き。0=中央 1=左 2=上 3=右 4=下。割り当てが無ければ中央 */
export function godanFlick(k: GodanKey, dir: number): string {
  const c = dir < k.chars.length ? k.chars[dir] : "";
  return c || k.chars[0];
}
