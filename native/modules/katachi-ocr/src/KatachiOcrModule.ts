import { NativeModule, requireNativeModule } from "expo";

declare class KatachiOcrModule extends NativeModule<{}> {
  /** 画像(file:// URI)から読み取れた文字列。読めなければ空文字 */
  recognizeText(uri: string): Promise<string>;
  /** 読み終わった写真を消す(消せなくても投げない) */
  discardPhoto(uri: string): Promise<void>;
}

export default requireNativeModule<KatachiOcrModule>("KatachiOcr");
