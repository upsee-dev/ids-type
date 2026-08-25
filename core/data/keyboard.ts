// キーボードの見た目の設定(アプリの中のキーボードとシステムキーボードの両方)。
//
// 選ぶのはアプリの設定画面で、置き場はアプリとキーボードで共有する領域
// (Android は SharedPreferences("katachi")、iOS は App Group の UserDefaults)。
// キーボード側には設定画面が無いので、アプリで選んだものを読むだけにしてある。

/**
 * 打鍵の面の縦幅。アプリの中のキーボードとシステムキーボードの両方に効く。
 *
 * `scale` は**アプリの中のキーボード**が使う倍率。システムキーボード側
 * (Kotlin / Swift) は起点の寸法が別なので自前の倍率を持っている
 * (Android は dp で面だけ、iOS は pt で帯を含む全体)。呼び名とキーはここが唯一。
 */
export const KEY_HEIGHTS = [
  { key: "small", label: "小", scale: 1, note: "いまの高さ。画面をいちばん広く使えます" },
  { key: "medium", label: "中", scale: 1.22, note: "キーを少し大きく。打ち間違いが減ります" },
  { key: "large", label: "大", scale: 1.45, note: "キーをいちばん大きく。指が太くても押せます" },
] as const;

export type KeyHeight = (typeof KEY_HEIGHTS)[number]["key"];

export const DEFAULT_KEY_HEIGHT: KeyHeight = "small";
