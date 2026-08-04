import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * 有料版（広告なし）の権利まわり。
 *
 * ここは**課金SDKを持たない土台**。実際の購入処理を足すときに触るのはこの
 * ファイルだけで済むよう、アプリ側からは「広告を出すか」だけを見せている。
 *
 * 課金SDK(expo-in-app-purchases / RevenueCat など)と広告SDK
 * (react-native-google-mobile-ads)は**ネイティブモジュール**なので、
 * 入れるときは必ずビルドし直しになる（OTAでは入らない）。
 * 詳しくは README「広告と有料版」。
 *
 * 現時点では ADS_ENABLED が false なので、広告枠は一切描画されない。
 * SDKを入れて実際に配信を始めるときに true にする。
 */

/** 広告配信そのものの入り切り。SDKを入れるまでは false */
export const ADS_ENABLED = false;

const PRO_KEY = "katachi.pro";

/** 有料版を持っているか。購入を復元できるまでの間は端末に覚えておく */
export async function loadPro(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(PRO_KEY)) === "1";
  } catch {
    return false;
  }
}

export async function savePro(pro: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(PRO_KEY, pro ? "1" : "0");
  } catch {
    /* 保存できなくても使用は続けられる */
  }
}

/**
 * いま広告を出してよいか。
 * 有料版を持っている人には出さない。配信自体を止めているあいだも出さない。
 */
export function shouldShowAds(isPro: boolean): boolean {
  return ADS_ENABLED && !isPro;
}
