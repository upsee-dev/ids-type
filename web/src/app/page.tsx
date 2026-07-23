"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Engine, type Result } from "@/lib/engine";
import { KatachiKeyboard } from "@/components/KatachiKeyboard";
import { OperatorIcon } from "@/components/OperatorIcon";

const SAMPLES = [
  { q: "LR日月", hint: "明" },
  { q: "UD宀子", hint: "字" },
  { q: "OC囗玉", hint: "国" },
  { q: "RU辶刀", hint: "辺" },
  { q: "LR氵?", hint: "海…" },
  { q: "日月", hint: "部品検索" },
];

const GRADE_LABEL: Record<number, string> = {
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

/** タップでフォーカスを奪わない＝ソフトキーボードを閉じさせない */
const keepFocus = (e: React.PointerEvent) => e.preventDefault();

export default function Home() {
  const [engine, setEngine] = useState<Engine | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [mode, setMode] = useState("empty");
  const [output, setOutput] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // 既定は自前のカタチキーボード。「あ」で端末のキーボードに切り替える
  const [osKeyboard, setOsKeyboard] = useState(false);
  const [composing, setComposing] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const pendingCaret = useRef<number | null>(null);

  useEffect(() => {
    fetch("/data/kanji-data.json")
      .then((r) => r.json())
      .then((raw) => setEngine(new Engine(raw)))
      .catch(() => setLoadError(true));
  }, []);

  // IME変換中(composing)は未確定文字で検索しない
  useEffect(() => {
    if (!engine || composing) return;
    const t = setTimeout(() => {
      const found = engine.search(query);
      setResults(found.results);
      setMode(found.mode);
    }, 120);
    return () => clearTimeout(t);
  }, [engine, query, composing]);

  // ボタン挿入後にキャレット位置を復元(常に末尾に飛ばさない)
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (el && pendingCaret.current !== null) {
      const pos = Math.min(pendingCaret.current, el.value.length);
      el.setSelectionRange(pos, pos);
      pendingCaret.current = null;
    }
  }, [query]);

  const insert = useCallback(
    (s: string) => {
      const el = inputRef.current;
      const start = el?.selectionStart ?? query.length;
      const end = el?.selectionEnd ?? query.length;
      pendingCaret.current = start + s.length;
      setQuery((q) => q.slice(0, start) + s + q.slice(end));
      el?.focus({ preventScroll: true });
    },
    [query],
  );

  const backspace = useCallback(() => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? query.length;
    const end = el?.selectionEnd ?? query.length;
    if (start !== end) {
      pendingCaret.current = start;
      setQuery((q) => q.slice(0, start) + q.slice(end));
    } else if (start > 0) {
      // サロゲートペア(𠮟 など)を1文字として消す
      const dropped = [...query.slice(0, start)].pop() ?? "";
      pendingCaret.current = start - dropped.length;
      setQuery((q) => q.slice(0, start - dropped.length) + q.slice(start));
    }
    el?.focus({ preventScroll: true });
  }, [query]);

  const clearQuery = () => {
    pendingCaret.current = 0;
    setQuery("");
    inputRef.current?.focus({ preventScroll: true });
  };

  const pick = (ch: string) => {
    setOutput((o) => o + ch);
    setSelected(ch);
  };

  const copy = async () => {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  const selMeta = selected && engine ? engine.meta(selected) : undefined;
  const selDecomp = useMemo(
    () => (selected && engine ? engine.decompose(selected) : []),
    [selected, engine],
  );

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      {/* ── 上段: タイトル + 出力(確定テキスト) ── */}
      <header className="shrink-0 border-b border-stone-200 bg-white/90 backdrop-blur dark:border-stone-800 dark:bg-stone-900/90">
        <div className="mx-auto w-full max-w-3xl px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2">
          {/* 横向きなど画面が低いときはタイトルを畳んで候補の高さを確保する */}
          <div className="flex items-baseline justify-between gap-2 [@media(max-height:560px)]:hidden">
            <h1 className="truncate text-base font-bold tracking-wide sm:text-lg">
              カタチ入力
              <span className="ml-1.5 text-[10px] font-normal text-stone-400">
                読めない漢字を、見たまま打てる
              </span>
            </h1>
            <button
              onPointerDown={keepFocus}
              onClick={() => setShowHelp((h) => !h)}
              className="shrink-0 rounded-full border border-stone-300 px-2 py-0.5 text-[11px] text-stone-500 dark:border-stone-700 dark:text-stone-400"
            >
              使い方
            </button>
          </div>

          <div className="mt-1.5 flex items-center gap-1.5">
            <input
              value={output}
              readOnly
              placeholder="ここに確定した文字が入ります"
              className="kanji min-w-0 flex-1 rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 text-lg dark:border-stone-700 dark:bg-stone-950"
            />
            <button
              onPointerDown={keepFocus}
              onClick={() => setOutput((o) => [...o].slice(0, -1).join(""))}
              aria-label="出力を1文字削除"
              className="shrink-0 rounded-lg border border-stone-300 px-2.5 py-2 text-sm text-stone-600 active:bg-stone-100 dark:border-stone-700 dark:text-stone-300"
            >
              ⌫
            </button>
            <button
              onPointerDown={keepFocus}
              onClick={copy}
              className="shrink-0 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white active:bg-indigo-700"
            >
              {copied ? "コピー済" : "コピー"}
            </button>
          </div>
        </div>
      </header>

      {/* ── 中段: 候補(スクロール領域) ── */}
      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full max-w-3xl px-3 py-2">
          {showHelp && (
            <div className="mb-3 rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-xs leading-relaxed text-stone-700 dark:border-indigo-900 dark:bg-stone-900 dark:text-stone-300">
              <p>
                下のキーボードで「かたち(位置関係)」→「部品」の順に押すだけ。例:{" "}
                <b>左右</b> を押して <b className="kanji">日</b>{" "}
                <b className="kanji">月</b> を押すと <b className="kanji">明</b>{" "}
                が出ます。
              </p>
              <p className="mt-1">
                部品が見つからないときは「あ」で端末のキーボードに切り替えて直接入力できます。
                <b>?</b> は「なんでもいい部品」です。
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {SAMPLES.map((s) => (
                  <button
                    key={s.q}
                    onPointerDown={keepFocus}
                    onClick={() => {
                      setQuery(s.q);
                      setShowHelp(false);
                    }}
                    className="rounded-full border border-stone-300 bg-white px-2.5 py-1 text-[11px] text-stone-600 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-300"
                  >
                    {s.q} <span className="text-stone-400">({s.hint})</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {!engine && !loadError && (
            <p className="py-10 text-center text-sm text-stone-500">
              辞書データを読み込み中… (約0.8MB)
            </p>
          )}
          {loadError && (
            <p className="py-10 text-center text-sm text-red-500">
              辞書データの読み込みに失敗しました。再読み込みしてください。
            </p>
          )}

          {engine && !query && (
            <div className="py-8 text-center text-sm text-stone-500 dark:text-stone-400">
              <p>
                下のキーボードで、漢字の「かたち」と「部品」を選んでください。
              </p>
              <div className="mt-3 flex items-center justify-center gap-2 text-stone-400">
                <span className="flex items-center gap-1 rounded-lg border border-stone-300 px-2 py-1 dark:border-stone-700">
                  <OperatorIcon code="LR" size={16} /> 左右
                </span>
                <span>+</span>
                <span className="kanji rounded-lg border border-stone-300 px-2 py-1 dark:border-stone-700">
                  日
                </span>
                <span className="kanji rounded-lg border border-stone-300 px-2 py-1 dark:border-stone-700">
                  月
                </span>
                <span>=</span>
                <span className="kanji text-2xl text-stone-600 dark:text-stone-300">
                  明
                </span>
              </div>
            </div>
          )}

          {engine && query && (
            <p className="mb-1.5 text-[11px] text-stone-500 dark:text-stone-400">
              {mode === "structure" &&
                `構造マッチ: ${results.length}件(枠付き=完全一致)`}
              {mode === "parts" && `部品を含む字: ${results.length}件`}
              {mode === "empty" && "かたちか部品を入力してください"}
            </p>
          )}

          {engine && query && mode !== "empty" && results.length === 0 && (
            <p className="py-6 text-center text-sm text-stone-500">
              該当なし。部品を減らすか <b>?</b>
              (なんでも)に置き換えてみてください。
            </p>
          )}

          <div className="grid grid-cols-6 gap-1 sm:grid-cols-10">
            {results.map((r) => (
              <button
                key={r.ch}
                onPointerDown={keepFocus}
                onClick={() => pick(r.ch)}
                title={`${r.meta.on} ${r.meta.kun}`.trim()}
                className={`kanji flex min-h-[48px] items-center justify-center rounded-lg border text-2xl leading-none active:bg-indigo-100 dark:active:bg-stone-700 ${
                  r.exact
                    ? "border-indigo-400 bg-indigo-50/60 dark:border-indigo-600 dark:bg-stone-900"
                    : "border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900"
                }`}
              >
                {r.ch}
              </button>
            ))}
          </div>

          {selected && selMeta && (
            <section className="mt-3 flex gap-3 rounded-xl border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-900">
              <div className="kanji shrink-0 text-5xl leading-none">
                {selected}
              </div>
              <div className="min-w-0 text-xs">
                <p className="flex flex-wrap gap-x-3 gap-y-0.5">
                  {selMeta.on && <span>音: {selMeta.on}</span>}
                  {selMeta.kun && <span>訓: {selMeta.kun}</span>}
                  {GRADE_LABEL[selMeta.grade] && (
                    <span className="text-stone-500">
                      {GRADE_LABEL[selMeta.grade]}
                    </span>
                  )}
                </p>
                {selDecomp.length > 0 && (
                  <p className="kanji mt-1 break-all text-stone-500 dark:text-stone-400">
                    {selDecomp.join("　")}
                  </p>
                )}
              </div>
            </section>
          )}

          <footer className="mt-6 text-[10px] leading-relaxed text-stone-400 dark:text-stone-500">
            入力方式は zi.tools の IDS 部品入力を参考にしています。分解データ:
            CJKVI IDS Database (CHISE IDS Database 由来, GPLv2) / 漢字情報:
            KANJIDIC2 (EDRDG, CC BY-SA 4.0)。本アプリはプロトタイプです。
          </footer>
        </div>
      </main>

      {/* ── 下段: 入力欄 + カタチキーボード ── */}
      <div className="shrink-0">
        <div className="border-t border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
          <div className="mx-auto flex w-full max-w-3xl items-center gap-1.5 px-3 py-2">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onCompositionStart={() => setComposing(true)}
              onCompositionEnd={(e) => {
                setComposing(false);
                setQuery(e.currentTarget.value);
              }}
              // 自前キーボード使用時は端末のキーボードを出さない(画面が隠れるため)
              inputMode={osKeyboard ? "text" : "none"}
              enterKeyHint="search"
              placeholder="例: LR日月"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              className="kanji min-w-0 flex-1 rounded-lg border border-stone-300 bg-stone-50 px-3 py-2.5 text-lg outline-none focus:border-indigo-500 dark:border-stone-700 dark:bg-stone-950"
            />
            <button
              onPointerDown={keepFocus}
              onClick={() => insert("?")}
              title="なんでもいい部品"
              className="shrink-0 rounded-lg border border-stone-300 px-3 py-2.5 text-sm text-stone-600 active:bg-stone-100 dark:border-stone-700 dark:text-stone-300"
            >
              ?
            </button>
            <button
              onPointerDown={keepFocus}
              onClick={backspace}
              aria-label="1文字削除"
              className="shrink-0 rounded-lg border border-stone-300 px-3 py-2.5 text-sm text-stone-600 active:bg-stone-100 dark:border-stone-700 dark:text-stone-300"
            >
              ⌫
            </button>
            <button
              onPointerDown={keepFocus}
              onClick={clearQuery}
              aria-label="すべて消す"
              className="shrink-0 rounded-lg border border-stone-300 px-3 py-2.5 text-sm text-stone-600 active:bg-stone-100 dark:border-stone-700 dark:text-stone-300"
            >
              ✕
            </button>
          </div>
        </div>

        <KatachiKeyboard
          engine={engine}
          onInsert={insert}
          osKeyboard={osKeyboard}
          onToggleOsKeyboard={() => {
            setOsKeyboard((v) => !v);
            // inputMode の反映後にフォーカスし直さないと端末のキーボードが出ない
            setTimeout(
              () => inputRef.current?.focus({ preventScroll: true }),
              0,
            );
          }}
        />
      </div>
    </div>
  );
}
