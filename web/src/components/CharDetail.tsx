"use client";

import {
  blockOf,
  codePointLabel,
  radicalChar,
  readableIds,
  refReadingLabel,
  type CharMeta,
} from "@/lib/engine";
import { GRADE_LABEL } from "@/lib/labels";

/**
 * 選んだ字の内訳。読み(音訓)がいちばん知りたい情報なので先頭に大きく出し、
 * 画数・部首・学年・頻度 → 意味 → 符号位置 → 分解 の順に薄くしていく。
 * 入力画面(コンパクト)と一覧画面(コピーボタンつき)で共有している。
 *
 * 読みは**正式かどうかで見た目を変える**。KANJIDIC2 の音訓だけを大きい字で出し、
 * 人名読み・参考・推定は小さく、断り書きつきで下に置く
 * (辞書に載っている読みと、こちらで推した読みを同じ顔で出さないため)。
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
  const rad = radicalChar(meta.rad);

  return (
    <div className="flex items-start gap-3">
      <div className="kanji shrink-0 text-5xl leading-none">{ch}</div>

      <div className="min-w-0 flex-1">
        {/* ── 読み(最重要) ── */}
        {meta.on || meta.kun ? (
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5">
            {meta.on && (
              <p className="text-base leading-snug font-semibold">
                <span className="mr-1.5 text-[10px] font-normal text-stone-400">
                  音
                </span>
                {meta.on}
              </p>
            )}
            {meta.kun && (
              <p className="text-base leading-snug font-semibold">
                <span className="mr-1.5 text-[10px] font-normal text-stone-400">
                  訓
                </span>
                {meta.kun}
              </p>
            )}
          </div>
        ) : !meta.ref ? (
          <p className="text-xs text-stone-500 dark:text-stone-400">
            読みデータなし
          </p>
        ) : null}

        {/* ── 正式ではない読み ──
            人名読み(KANJIDIC2 の nanori)と、KANJIDIC2 に無い字の参考・推定。
            見出しで出所が分かるようにしてある(推定は当たるのが6割ほど) */}
        {(meta.nanori || meta.ref) && (
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs">
            {meta.nanori && (
              <p className="text-stone-600 dark:text-stone-300">
                <span
                  className="mr-1.5 text-[10px] text-stone-400"
                  title="人名でだけ使う読み。正式な音訓ではない"
                >
                  人名
                </span>
                {meta.nanori}
              </p>
            )}
            {meta.ref && (
              <p className="text-stone-600 dark:text-stone-300">
                <span
                  className="mr-1.5 text-[10px] text-stone-400"
                  title={
                    meta.refKind[0] === "u"
                      ? "資料(Unihan)にある読み。KANJIDIC2 の音訓ではない"
                      : "こちらで推した読み。当たるのは6割ほどなので当てにしないこと"
                  }
                >
                  {refReadingLabel(meta.refKind)}
                </span>
                {meta.ref}
              </p>
            )}
          </div>
        )}

        {/* ── 字の基本情報 ── */}
        <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-stone-600 dark:text-stone-300">
          {meta.strokes > 0 && <span>{meta.strokes}画</span>}
          {rad && (
            <span>
              部首 <span className="kanji">{rad}</span>
            </span>
          )}
          {GRADE_LABEL[meta.grade] && <span>{GRADE_LABEL[meta.grade]}</span>}
          {meta.freq > 0 && <span>頻度 {meta.freq}位</span>}
        </p>

        {meta.meaning && (
          <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">
            意味(英): {meta.meaning}
          </p>
        )}

        <p className="mt-0.5 text-[10px] text-stone-400 dark:text-stone-500">
          {codePointLabel(ch)}・{blockOf(ch)?.label ?? "—"}
        </p>

        {/* ── 分解 ── */}
        <p className="kanji mt-0.5 text-[11px] break-all text-stone-500 dark:text-stone-400">
          {meta.ids ? readableIds(meta.ids) : "分解データなし"}
        </p>
        {decomposition.length > 1 && (
          <p className="kanji mt-0.5 text-[10px] break-all text-stone-400 dark:text-stone-500">
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
