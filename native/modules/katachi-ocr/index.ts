import KatachiOcr from "./src/KatachiOcrModule";

/**
 * 撮った写真から字を読み取る（端末の中だけで完結・通信なし）。
 *
 * 読めない字を「見たまま打つ」道具なので、目の前の紙に出てきた字を
 * カメラで取り込めれば、部品を組む手間そのものが要らなくなる。
 *
 *   iOS     … Vision。日本語を優先し、対応する中国語・英語も候補に使う。
 *   Android … ML Kit の日本語・中国語モデル。**APKに同梱**する版を使う
 *             （未同梱版は初回に Google Play 経由で落としに行く＝通信が発生し、
 *               「通信を一切しない」というこのアプリの約束を破ってしまう）
 *
 * 第一候補を先に、追加候補を後に連結して返す。Unicode順にはしない。
 * focus=true はプレビュー中央の正方形だけを読む。previewAspect は枠の幅/高さ。
 * 漢字への絞り込み・重複排除は呼ぶ側で行う。
 */
export const recognizeText = (uri: string, focus = true, previewAspect = 1): Promise<string> =>
  KatachiOcr.recognizeText(uri, focus, previewAspect);

/**
 * 読み終わった写真を捨てる。
 *
 * 撮った写真は端末の一時領域(キャッシュ)に**ファイルとして残る**。このアプリは
 * 「写真はどこにも残りません」と断って権限をもらっているので、読み取りが済んだら
 * 撮った側から消す（撮る → 読む → 使い捨て）。
 *
 * 消せなくても投げない。読み取りはもう済んでいて、呼ぶ側にできることが無いため。
 */
export const discardPhoto = (uri: string): Promise<void> =>
  KatachiOcr.discardPhoto(uri);
