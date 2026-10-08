import { getItem, setItem } from "../modules/katachi-shared";
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
 * 「キーボードにも効く」設定。
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
