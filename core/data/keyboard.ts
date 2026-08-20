// システムキーボード(Android IME / iOSキーボード拡張)の見た目の設定。
//
// 選ぶのはアプリの設定画面で、置き場はアプリとキーボードで共有する領域
// (Android は SharedPreferences("katachi")、iOS は App Group の UserDefaults)。
// キーボード側には設定画面が無いので、アプリで選んだものを読むだけにしてある。

/**
 * 打鍵の面の縦幅。
 *
 * どれだけ広げるか(倍率)は端末の作りに寄るので、Kotlin / Swift の
 * キーボード側に置いてある(Android は dp、iOS は pt で寸法が別)。
 * ここが持つのは**キーと呼び名**だけ＝アプリの設定画面が要るぶんだけ。
 */
export const KEY_HEIGHTS = [
  { key: "small", label: "小", note: "いまの高さ。画面をいちばん広く使えます" },
  { key: "medium", label: "中", note: "キーを少し大きく。打ち間違いが減ります" },
  { key: "large", label: "大", note: "キーをいちばん大きく。指が太くても押せます" },
] as const;

export type KeyHeight = (typeof KEY_HEIGHTS)[number]["key"];

export const DEFAULT_KEY_HEIGHT: KeyHeight = "small";
