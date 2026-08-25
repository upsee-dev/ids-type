import KatachiOcr from "./src/KatachiOcrModule";

/**
 * 撮った写真から字を読み取る（端末の中だけで完結・通信なし）。
 *
 * 読めない字を「見たまま打つ」道具なので、目の前の紙に出てきた字を
 * カメラで取り込めれば、部品を組む手間そのものが要らなくなる。
 *
 *   iOS     … Vision (VNRecognizeTextRequest・ja-JP)。OSに入っているので同梱物ゼロ
 *   Android … ML Kit の日本語モデル。**APKに同梱**する版を使う
 *             （未同梱版は初回に Google Play 経由で落としに行く＝通信が発生し、
 *               「通信を一切しない」というこのアプリの約束を破ってしまう）
 *
 * 返すのは読み取れた文字列そのまま。どの字を候補に出すかは呼ぶ側で決める。
 */
export const recognizeText = (uri: string): Promise<string> =>
  KatachiOcr.recognizeText(uri);
