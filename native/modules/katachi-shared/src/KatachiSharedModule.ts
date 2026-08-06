import { NativeModule, requireNativeModule } from "expo";

declare class KatachiSharedModule extends NativeModule<{}> {
  /** 無ければ null。読み書きは数十バイトなので同期でよい */
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export default requireNativeModule<KatachiSharedModule>("KatachiShared");
