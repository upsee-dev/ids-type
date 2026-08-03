"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ALL_BLOCKS, type CharMeta } from "@/lib/engine";
import { useEngine } from "@/lib/useEngine";
import {
  DICT_ERROR,
  DICT_LOADING,
  LIST_EXAMPLES,
  MODE_LABEL,
} from "@/lib/labels";
import { KanjiGrid } from "@/components/KanjiGrid";
import { CharDetail } from "@/components/CharDetail";

const PAGE = 300;

export default function CharsPage() {
  const { engine, loadError } = useEngine();
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [block, setBlock] = useState<string>("");
  const [jaOnly, setJaOnly] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [selected, setSelected] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [copied, setCopied] = useState(false);

  const sentinel = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  // 絞り込みを URL に持たせる(?q=氵&block=j)。リンクで共有・ブックマークできる。
  // useSearchParams は静的プリレンダで Suspense を要求するので window から直接読む
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const q = p.get("q");
    const b = p.get("block");
    if (q) setInput(q);
    if (b && ALL_BLOCKS.some((x) => x.key === b)) setBlock(b);
    if (p.get("ja") === "1") setJaOnly(true);
  }, []);

  useEffect(() => {
    const p = new URLSearchParams();
    if (query) p.set("q", query);
    if (block) p.set("block", block);
    if (jaOnly) p.set("ja", "1");
    const qs = p.toString();
    window.history.replaceState(
      null,
      "",
      qs ? `?${qs}` : window.location.pathname,
    );
  }, [query, block, jaOnly]);

  // IME変換中は未確定文字で絞り込まない(入力画面と同じ挙動)
  useEffect(() => {
    if (composing) return;
    const t = setTimeout(() => setQuery(input), 150);
    return () => clearTimeout(t);
  }, [input, composing]);

  // 絞り込み条件が変わったら先頭に戻す
  useEffect(() => {
    setShown(PAGE);
    scroller.current?.scrollTo({ top: 0 });
  }, [query, block, jaOnly]);

  // 絞り込みは条件が変わったときだけ。スクロールで伸ばすのは slice だけにする
  const page = useMemo(() => {
    if (!engine) return null;
    return engine.list({
      query,
      block: block || undefined,
      jaOnly,
      limit: Number.MAX_SAFE_INTEGER,
    });
  }, [engine, query, block, jaOnly]);

  const items = useMemo(
    () => page?.items.slice(0, shown) ?? [],
    [page, shown],
  );

  // 無限スクロール
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !page) return;
    const io = new IntersectionObserver(
      (es) => {
        if (es[0].isIntersecting) {
          setShown((n) => (n < page.total ? n + PAGE : n));
        }
      },
      { root: scroller.current, rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [page]);

  const counts = useMemo(() => engine?.blockCounts() ?? [], [engine]);
  const selMeta: CharMeta | undefined = selected
    ? engine?.meta(selected)
    : undefined;
  const selDecomp = useMemo(
    () => (engine && selected ? engine.decompose(selected, 5) : []),
    [engine, selected],
  );

  const copy = async (ch: string) => {
    try {
      await navigator.clipboard.writeText(ch);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* クリップボードが使えない環境では何もしない */
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* ── 上段: 見出しと絞り込み ── */}
      <header className="shrink-0 border-b border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
        <div className="mx-auto w-full max-w-3xl px-3 py-2">
          <div className="flex items-baseline justify-between gap-2">
            <h1 className="truncate text-sm font-semibold">
              収録漢字一覧
              {engine && (
                <span className="ml-2 text-[11px] font-normal text-stone-500">
                  全 {engine.size.toLocaleString()} 字
                </span>
              )}
            </h1>
            <Link
              href="/"
              className="shrink-0 rounded-full border border-stone-300 px-2 py-0.5 text-[11px] text-stone-500 dark:border-stone-700 dark:text-stone-400"
            >
              入力にもどる
            </Link>
          </div>

          <div className="relative mt-1.5">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onCompositionStart={() => setComposing(true)}
              onCompositionEnd={(e) => {
                setComposing(false);
                setInput(e.currentTarget.value);
              }}
              enterKeyHint="search"
              // 検索キーでOSキーボードを閉じて一覧を見られるようにする
              onKeyDown={(e) => {
                if (e.key === "Enter" && !composing) e.currentTarget.blur();
              }}
              placeholder="絞り込み: かたち(LR木木) / 部品(氵) / 読み(あお) / U+3134A"
              className="kanji w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 pr-9 text-base dark:border-stone-700 dark:bg-stone-950"
            />
            {input && (
              <button
                onClick={() => setInput("")}
                aria-label="絞り込みを消す"
                className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-full px-2 py-1 text-sm text-stone-400 active:text-stone-600"
              >
                ✕
              </button>
            )}
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {LIST_EXAMPLES.map((x) => (
              <button
                key={x.q}
                onClick={() => setInput(x.q)}
                className="kanji rounded-full border border-stone-300 px-2 py-0.5 text-[11px] text-stone-600 dark:border-stone-700 dark:text-stone-300"
              >
                {x.q}
                <span className="ml-1 text-stone-400">{x.hint}</span>
              </button>
            ))}
            <label className="ml-auto flex items-center gap-1 text-[11px] text-stone-600 dark:text-stone-300">
              <input
                type="checkbox"
                checked={jaOnly}
                onChange={(e) => setJaOnly(e.target.checked)}
              />
              日本の漢字のみ
            </label>
          </div>

          {/* ブロック絞り込み */}
          <div className="mt-1.5 flex gap-1 overflow-x-auto pb-0.5">
            <Chip
              active={block === ""}
              onClick={() => setBlock("")}
              label="すべて"
              count={engine?.size}
            />
            {counts.map(({ block: b, count }) => (
              <Chip
                key={b.key}
                active={block === b.key}
                onClick={() => setBlock(b.key)}
                label={b.label}
                count={count}
              />
            ))}
          </div>
        </div>
      </header>

      {/* ── 中段: 一覧(スクロール領域) ── */}
      <main
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <div className="mx-auto w-full max-w-3xl px-3 py-2">
          {!engine && !loadError && (
            <p className="py-10 text-center text-sm text-stone-500">
              {DICT_LOADING}
            </p>
          )}
          {loadError && (
            <p className="py-10 text-center text-sm text-red-500">
              {DICT_ERROR}
            </p>
          )}

          {page && (
            <p className="mb-1.5 text-[11px] text-stone-500 dark:text-stone-400">
              {MODE_LABEL[page.mode] ?? page.mode} — {page.total.toLocaleString()} 字
              {block && `(${ALL_BLOCKS.find((b) => b.key === block)?.label})`}
              {page.total > items.length &&
                ` / ${items.length.toLocaleString()} 字を表示中`}
            </p>
          )}

          {page && page.total === 0 && (
            <p className="py-6 text-center text-sm text-stone-500">
              該当なし。条件をゆるめてみてください。
            </p>
          )}

          <KanjiGrid
            items={items}
            selected={selected}
            onPick={setSelected}
          />

          <div ref={sentinel} className="h-4" />

          {page && page.total > items.length && (
            <button
              onClick={() => setShown((n) => n + PAGE)}
              className="mx-auto mt-2 block rounded-lg border border-stone-300 px-4 py-2 text-xs text-stone-600 dark:border-stone-700 dark:text-stone-300"
            >
              さらに表示
            </button>
          )}

          <footer className="mt-6 text-[10px] leading-relaxed text-stone-400 dark:text-stone-500">
            実線枠＝KANJIDIC2 収録(読み・学年つき)、破線枠＝それ以外の CJK
            統合漢字。端末にフォントが無い字は Plangothic (SIL OFL 1.1)
            の分割フォントを読み込んで表示します。それでも □
            になる字はフォント未収録です(表示だけの問題で、コピーすれば正しく貼り付けられます)。
          </footer>
        </div>
      </main>

      {/* ── 下段: 選択した字の詳細 ── */}
      {selected && selMeta && (
        <section className="shrink-0 border-t border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
          <div className="mx-auto w-full max-w-3xl px-3 py-2">
            <CharDetail
              ch={selected}
              meta={selMeta}
              decomposition={selDecomp}
              onCopy={() => copy(selected)}
              onClose={() => setSelected(null)}
              copied={copied}
            />
          </div>
        </section>
      )}
    </div>
  );
}

function Chip({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] whitespace-nowrap ${
        active
          ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-600 dark:bg-stone-950 dark:text-indigo-300"
          : "border-stone-300 text-stone-600 dark:border-stone-700 dark:text-stone-300"
      }`}
    >
      {label}
      {count !== undefined && (
        <span className="ml-1 text-stone-400">{count.toLocaleString()}</span>
      )}
    </button>
  );
}
