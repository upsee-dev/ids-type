import AsyncStorage from "@react-native-async-storage/async-storage";
import { getItem, setItem } from "../modules/katachi-shared";

/**
 * 使った字の履歴と、お気に入り。
 *
 * 読めない字を調べる道具なので、「さっき出した字」をもう一度出したい場面が多い。
 * 毎回かたちと部品を組み直させないよう、確定した字を新しい順に覚えておく。
 * お気に入りは履歴と別に持つ（履歴を消してもお気に入りは残る）。
 *
 * 保存先は**アプリとキーボードで共有する領域**（modules/katachi-shared）。
 * アプリで調べた字をキーボードで打つのがこのアプリの筋道なので、
 * アプリ専用の AsyncStorage に置くとキーボードから見えず橋が架からない。
 *
 * 端末内にしか保存しない（このアプリはネットワークを使わない）。
 */

const HISTORY_KEY = "katachi.history";
const FAVORITES_KEY = "katachi.favorites";

/** 履歴の上限。これ以上は古いものから落とす */
export const HISTORY_LIMIT = 60;

/** 壊れた値を読んでも落ちないようにする（1字ぶんの文字列だけ通す） */
function parse(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null;
  } catch {
    return null;
  }
}

/**
 * 1.0.6 までの履歴は AsyncStorage にある。共有領域が空のときだけ引き取る
 * （移した後も元は消さない。古いビルドに戻したときに履歴が消えると困る）。
 */
async function load(key: string): Promise<string[]> {
  try {
    const shared = parse(getItem(key));
    if (shared) return shared;

    const old = parse(await AsyncStorage.getItem(key));
    if (old && old.length > 0) {
      setItem(key, JSON.stringify(old));
      return old;
    }
    return [];
  } catch {
    return [];
  }
}

function save(key: string, list: string[]): void {
  try {
    setItem(key, JSON.stringify(list));
  } catch {
    /* 保存できなくても入力は続けられるので握りつぶす */
  }
}

export const loadHistory = () => load(HISTORY_KEY);
export const loadFavorites = () => load(FAVORITES_KEY);

/** 使った字を履歴の先頭へ。すでにあれば先頭に繰り上げる（重複させない） */
export function pushHistory(list: string[], ch: string): string[] {
  return [ch, ...list.filter(c => c !== ch)].slice(0, HISTORY_LIMIT);
}

export const saveHistory = (list: string[]) => save(HISTORY_KEY, list);

/** お気に入りの入り切り */
export function toggleFavorite(list: string[], ch: string): string[] {
  return list.includes(ch) ? list.filter(c => c !== ch) : [ch, ...list];
}

export const saveFavorites = (list: string[]) => save(FAVORITES_KEY, list);
