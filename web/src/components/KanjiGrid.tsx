"use client";

import { codePointLabel, refReadingLabel, type CharMeta } from "@/lib/engine";

export interface KanjiCell {
  ch: string;
  meta: CharMeta;
  /** 構造検索の完全一致。枠を強調する */
  exact?: boolean;
}

/**
 * 漢字を並べるグリッド。入力画面の候補と一覧画面の両方がこれを使う。
 *
 * ext(KANJIDIC2 外の拡張漢字)は破線にしている。端末にフォントが無くて □ に
 * なったとき、「読み込み失敗」ではなく「そういう字」だと分かるようにするため。
 */
export function KanjiGrid({
  items,
  selected,
  onPick,
  onPointerDown,
}: {
  items: KanjiCell[];
  selected?: string | null;
  onPick: (ch: string) => void;
  /** 入力画面ではソフトキーボードを閉じさせないために preventDefault を渡す */
  onPointerDown?: (e: React.PointerEvent) => void;
}) {
  /**
   * ホバーで出す1行。**読みの出所も添える**。
   * 正式(音訓)があればそれだけ、無ければ人名・参考・推定を見出しつきで出す
   * (辞書にある読みと、こちらで推した読みを混ぜないため)
   */
  const hoverText = (ch: string, meta: CharMeta): string => {
    const head = codePointLabel(ch);
    const official = `${meta.on} ${meta.kun}`.trim();
    if (official) return `${head} ${official}`;
    if (meta.nanori) return `${head} 人名 ${meta.nanori}`;
    if (meta.ref) return `${head} ${refReadingLabel(meta.refKind)} ${meta.ref}`;
    return `${head} 読みデータなし`;
  };

  return (
    <div className="grid grid-cols-6 gap-1 sm:grid-cols-10">
      {items.map(({ ch, meta, exact }) => (
        <button
          key={ch}
          onPointerDown={onPointerDown}
          onClick={() => onPick(ch)}
          title={hoverText(ch, meta)}
          className={`kanji flex min-h-12 items-center justify-center rounded-lg border text-2xl leading-none active:bg-indigo-100 dark:active:bg-stone-700 ${
            meta.ext ? "border-dashed text-stone-500 dark:text-stone-400 " : ""
          }${
            exact || selected === ch
              ? "border-indigo-400 bg-indigo-50/60 dark:border-indigo-600 dark:bg-stone-900"
              : "border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900"
          }`}
        >
          {ch}
        </button>
      ))}
    </div>
  );
}
