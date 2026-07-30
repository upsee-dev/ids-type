"use client";

import { blockOf, codePointLabel, readableIds, type CharMeta } from "@/lib/engine";
import { GRADE_LABEL } from "@/lib/labels";

/**
 * 選んだ字の内訳。符号位置・ブロック・読み・分解を出す。
 * 入力画面(コンパクト)と一覧画面(コピーボタンつき)で共有している。
 */
export function CharDetail({
  ch,
  meta,
  decomposition,
  onCopy,
  onClose,
  copied,
}: {
  ch: string;
  meta: CharMeta;
  /** Engine#decompose の結果。1行目は自身の分解、2行目以降は部品の分解 */
  decomposition: string[];
  onCopy?: () => void;
  onClose?: () => void;
  copied?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="kanji shrink-0 text-5xl leading-none">{ch}</div>

      <div className="min-w-0 flex-1 text-xs">
        <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-stone-500">
          <span>{codePointLabel(ch)}</span>
          <span>{blockOf(ch)?.label ?? "—"}</span>
          {GRADE_LABEL[meta.grade] && <span>{GRADE_LABEL[meta.grade]}</span>}
          {meta.freq > 0 && <span>頻度 {meta.freq}位</span>}
        </p>

        {(meta.on || meta.kun) && (
          <p className="mt-0.5 flex flex-wrap gap-x-3">
            {meta.on && <span>音: {meta.on}</span>}
            {meta.kun && <span>訓: {meta.kun}</span>}
          </p>
        )}

        <p className="kanji mt-0.5 break-all text-stone-500 dark:text-stone-400">
          {meta.ids ? readableIds(meta.ids) : "分解データなし"}
        </p>

        {decomposition.length > 1 && (
          <p className="kanji mt-0.5 break-all text-[10px] text-stone-400">
            {decomposition.slice(1).join("　")}
          </p>
        )}
      </div>

      {(onCopy || onClose) && (
        <div className="flex shrink-0 flex-col gap-1">
          {onCopy && (
            <button
              onClick={onCopy}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white active:bg-indigo-700"
            >
              {copied ? "コピー済" : "コピー"}
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs text-stone-600 dark:border-stone-700 dark:text-stone-300"
            >
              閉じる
            </button>
          )}
        </div>
      )}
    </div>
  );
}
