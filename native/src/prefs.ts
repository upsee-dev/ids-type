import { getItem, setItem } from "../modules/katachi-shared";
import { JAPANESE_ORDER_KEY, FOREIGN_READING_KEY, normalizeForeignReadings, normalizeJapaneseOrder, type JapaneseCategory, type ForeignReadingLanguage } from "./core/japanese";
import {
  DEFAULT_KEYBOARD_MENU,
  KEYBOARD_MENUS,
  type KeyboardMenu,
} from "./keyboardMenus";
import {
  DEFAULT_KANA_LAYOUT,
  DEFAULT_KEY_HEIGHT,
  DEFAULT_SORT,
  KANA_LAYOUTS,
  KEY_HEIGHTS,
  SORT_MODES,
  type KanaLayout,
  type KeyHeight,
  type SortMode,
} from "./engine";

/**
 * アプリの設定。入力方法・並び順・縦幅はシステムキーボードとも共有する。
 * 起動時のメニューはアプリだけで使う。
 *
 * 置き場は**アプリとキーボードで共有する領域**（modules/katachi-shared）。
 * 着せ替えや触覚と違って、候補の並び順もキーボードの縦幅も入力そのものの
 * 設定なので、アプリで選んだらシステムキーボードでも効かないと意味がない。
 * AsyncStorage はアプリ専用のサンドボックスなのでキーボードから読めない。
 *
 * Android IME 側は Store、iOS の拡張は SharedStore が同じキーを読む。
 * キーボードには設定画面が無く、読むだけ。
 */
const ORDER_KEY = "katachi.order";
const HEIGHT_KEY = "katachi.height";
const KANA_KEY = "katachi.kana";
const STARTUP_MENU_KEY = "katachi.startupMenu";

export function loadJapaneseOrder(): JapaneseCategory[] {
  try { return normalizeJapaneseOrder(JSON.parse(getItem(JAPANESE_ORDER_KEY) ?? "null")); }
  catch { return normalizeJapaneseOrder(null); }
}
export function saveJapaneseOrder(order: readonly JapaneseCategory[]): void {
  write(JAPANESE_ORDER_KEY, JSON.stringify(normalizeJapaneseOrder(order)));
}
export function loadForeignReadings(): ForeignReadingLanguage[] {
  try { return normalizeForeignReadings(JSON.parse(getItem(FOREIGN_READING_KEY) ?? "null")); }
  catch { return []; }
}
export function saveForeignReadings(languages: readonly ForeignReadingLanguage[]): void {
  write(FOREIGN_READING_KEY, JSON.stringify(normalizeForeignReadings(languages)));
}

/** 知らない値（古い・壊れた設定）は既定に落とす */
function read<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = getItem(key);
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: string): void {
  try {
    setItem(key, value);
  } catch {
    /* 保存できなくても、その場の見た目は変わっているので握りつぶす */
  }
}

const SORT_KEYS = SORT_MODES.map(m => m.key);
const HEIGHT_KEYS = KEY_HEIGHTS.map(h => h.key);
const KANA_KEYS = KANA_LAYOUTS.map(k => k.id);
const MENU_KEYS = KEYBOARD_MENUS.map(m => m.id);

/** アプリの次回起動時に開くメニュー。操作中のメニューは保存しない。 */
export const loadStartupMenu = (): KeyboardMenu =>
  read(STARTUP_MENU_KEY, MENU_KEYS, DEFAULT_KEYBOARD_MENU);
export const saveStartupMenu = (menu: KeyboardMenu): void =>
  write(STARTUP_MENU_KEY, menu);

/** 候補の並び順 */
export const loadSortMode = (): SortMode => read(ORDER_KEY, SORT_KEYS, DEFAULT_SORT);
export const saveSortMode = (mode: SortMode): void => write(ORDER_KEY, mode);

/** システムキーボードの縦幅。アプリの中のキーボードには効かない */
export const loadKeyHeight = (): KeyHeight =>
  read(HEIGHT_KEY, HEIGHT_KEYS, DEFAULT_KEY_HEIGHT);
export const saveKeyHeight = (h: KeyHeight): void => write(HEIGHT_KEY, h);

/**
 * 読みを打つ入力方法(フリック / ローマ字 / Godan)。
 * かたちコード欄と同じく読みも端末のIMEに触らせないので、打ち方は自前で選ぶ。
 * システムキーボードでも同じ面が出ないと打ち方が変わってしまうため、共有領域に置く
 */
export const loadKanaLayout = (): KanaLayout =>
  read(KANA_KEY, KANA_KEYS, DEFAULT_KANA_LAYOUT);
export const saveKanaLayout = (l: KanaLayout): void => write(KANA_KEY, l);
