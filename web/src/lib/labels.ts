// 画面に出す文言。入力画面と一覧画面で同じものを使う。
export const GRADE_LABEL: Record<number, string> = {
  1: "小1",
  2: "小2",
  3: "小3",
  4: "小4",
  5: "小5",
  6: "小6",
  8: "常用",
  9: "人名用",
  10: "人名用",
};

/** Engine.search / Engine.list が返す mode の表示名 */
export const MODE_LABEL: Record<string, string> = {
  all: "全件",
  code: "コードポイント",
  reading: "読み",
  structure: "かたち(構造マッチ)",
  parts: "部品を含む字",
  empty: "—",
};

/** 入力画面の「使い方」に出す例 */
export const SAMPLES = [
  { q: "LR日月", hint: "明" },
  { q: "UD宀子", hint: "字" },
  { q: "OC囗玉", hint: "国" },
  { q: "RU辶刀", hint: "辺" },
  { q: "LR氵?", hint: "海…" },
  { q: "日月", hint: "部品検索" },
];

/** 一覧画面の絞り込み例 */
export const LIST_EXAMPLES = [
  { q: "LR木木", hint: "かたち" },
  { q: "氵", hint: "部品" },
  { q: "あお", hint: "読み" },
  { q: "U+3134A", hint: "符号位置" },
];

/** 辞書の実サイズ。build:data の出力(gzip)と合わせる */
export const DICT_LOADING = "辞書データを読み込み中… (10万字・gzip 約1.4MB)";
export const DICT_ERROR = "辞書データの読み込みに失敗しました。再読み込みしてください。";
