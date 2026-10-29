/** キーボードのメニュー。入力画面と起動時の設定で同じ選択肢を使う。 */
export const KEYBOARD_MENUS = [
  { id: "radical", label: "部分" },
  { id: "search", label: "読み" },
  { id: "draw", label: "手書き" },
  { id: "camera", label: "カメラ" },
] as const;

export type KeyboardMenu = (typeof KEYBOARD_MENUS)[number]["id"];

export const DEFAULT_KEYBOARD_MENU: KeyboardMenu = "radical";
