import { registerWebModule, NativeModule } from "expo";

/** expo start --web で読んだときの受け皿。共有相手のキーボードが居ないので localStorage */
class KatachiSharedModule extends NativeModule<{}> {
  getItem(key: string): string | null {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  setItem(key: string, value: string): void {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      /* 保存できなくても入力は続けられる */
    }
  }
}

export default registerWebModule(KatachiSharedModule, "KatachiSharedModule");
