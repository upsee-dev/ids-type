import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * 使った字の履歴と、お気に入り。
 *
 * 読めない字を調べる道具なので、「さっき出した字」をもう一度出したい場面が多い。
 * 毎回かたちと部品を組み直させないよう、確定した字を新しい順に覚えておく。
 * お気に入りは履歴と別に持つ（履歴を消してもお気に入りは残る）。
 *
 * 端末内にしか保存しない（このアプリはネットワークを使わない）。
 */

const HISTORY_KEY = "katachi.history";
const FAVORITES_KEY = "katachi.favorites";

/** 履歴の上限。これ以上は古いものから落とす */
export const HISTORY_LIMIT = 60;

async function load(key: string): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return [];
    const v = JSON.parse(raw);
    // 壊れた値を読んでも落ちないようにする（1字ぶんの文字列だけ通す）
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

async function save(key: string, list: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(list));
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
