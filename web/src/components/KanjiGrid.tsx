"use client";

import { codePointLabel, type CharMeta } from "@/lib/engine";

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
  return (
    <div className="grid grid-cols-6 gap-1 sm:grid-cols-10">
      {items.map(({ ch, meta, exact }) => (
        <button
          key={ch}
          onPointerDown={onPointerDown}
          onClick={() => onPick(ch)}
          title={
            meta.ext
              ? `${codePointLabel(ch)} 拡張漢字(端末にフォントが無いと□で表示されます)`
              : `${codePointLabel(ch)} ${meta.on} ${meta.kun}`.trim()
          }
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
