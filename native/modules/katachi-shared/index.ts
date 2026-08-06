import KatachiShared from "./src/KatachiSharedModule";

/**
 * アプリとキーボードで共有する保存領域。
 *
 * 履歴とお気に入りは「アプリで調べた字をキーボードで打つ」ための橋なので、
 * 2つの入れ物に分かれていると意味がない。AsyncStorage はアプリ専用の
 * サンドボックスに書くため、キーボードからは読めない。そこで
 *
 *   iOS     … App Group (group.com.upsee.idskanjitype) の UserDefaults
 *   Android … アプリと同じプロセス空間の SharedPreferences("katachi")
 *
 * という「キーボード拡張からも見える場所」をこのモジュールが受け持つ。
 * Android のキーボードは同じアプリの Service なので、IME(Kotlin) が使っている
 * SharedPreferences そのものを指している。
 */
export const getItem = (key: string): string | null => KatachiShared.getItem(key);

export const setItem = (key: string, value: string): void =>
  KatachiShared.setItem(key, value);
