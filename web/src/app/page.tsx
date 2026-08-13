"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { type Result } from "@/lib/engine";
import { useEngine } from "@/lib/useEngine";
import { DICT_ERROR, DICT_LOADING, SAMPLES } from "@/lib/labels";
import { KatachiKeyboard } from "@/components/KatachiKeyboard";
import { OperatorIcon } from "@/components/OperatorIcon";
import { KanjiGrid } from "@/components/KanjiGrid";
import { CharDetail } from "@/components/CharDetail";

/** タップでフォーカスを奪わない＝ソフトキーボードを閉じさせない */
const keepFocus = (e: React.PointerEvent) => e.preventDefault();

export default function Home() {
  const { engine, loadError } = useEngine();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [mode, setMode] = useState("empty");
  const [output, setOutput] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [composing, setComposing] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const pendingCaret = useRef<number | null>(null);

  // 確定文字が欄からあふれたら、打ったばかりの字(末尾)が見える位置へ送る
  useEffect(() => {
    const el = outputRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [output]);

  // 端末のキーボードが出ているあいだは画面全体を visualViewport の高さに縮める。
  // iOS Safari は interactive-widget 未対応で、何もしないとキーボードが画面に
  // 覆い被さって下段が隠れる。出るのは「読みでさがす」の欄に触れたときだけだが、
  // どの欄から出ても効くよう常に見張っておく。
  const [viewH, setViewH] = useState<number | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      // キーボードに隠れている分。ブラウザUIの誤差程度なら何もしない
      const covered = window.innerHeight - vv.height - vv.offsetTop;
      setViewH(covered > 50 ? vv.height : null);
      // Safari が入力欄を見せようとページごと押し上げるのを戻す
      window.scrollTo(0, 0);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
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
    setCharCopied(false);
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

  // 選択中の1字だけをコピーする(出力欄とは別。詳細パネルのボタンから使う)
  const [charCopied, setCharCopied] = useState(false);
  const copyChar = async () => {
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(selected);
      setCharCopied(true);
      setTimeout(() => setCharCopied(false), 1200);
    } catch {
      setCharCopied(false);
    }
  };

  const selMeta = selected && engine ? engine.meta(selected) : undefined;
  const selDecomp = useMemo(
    () => (selected && engine ? engine.decompose(selected) : []),
    [selected, engine],
  );

  return (
    <div
      className="flex h-dvh flex-col overflow-hidden"
      style={viewH ? { height: viewH } : undefined}
    >
      {/* ── 上段: タイトル + 出力(確定テキスト) ── */}
      <header className="shrink-0 border-b border-stone-200 bg-white/90 backdrop-blur dark:border-stone-800 dark:bg-stone-900/90">
        <div className="mx-auto w-full max-w-3xl px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2">
          {/* 横向きなど画面が低いときはタイトルを畳んで候補の高さを確保する */}
          <div className="flex items-baseline justify-between gap-2 [@media(max-height:560px)]:hidden">
            <h1 className="truncate text-base font-bold tracking-wide sm:text-lg">
              漢字カタチ入力
              <span className="ml-1.5 text-[10px] font-normal text-stone-400">
                読めない漢字を、見たまま打てる
              </span>
            </h1>
            <div className="flex shrink-0 items-center gap-1.5">
              <Link
                href="/chars"
                className="rounded-full border border-stone-300 px-2 py-0.5 text-[11px] text-stone-500 dark:border-stone-700 dark:text-stone-400"
              >
                収録一覧
              </Link>
              <button
                onPointerDown={keepFocus}
                onClick={() => setShowHelp((h) => !h)}
                className="rounded-full border border-stone-300 px-2 py-0.5 text-[11px] text-stone-500 dark:border-stone-700 dark:text-stone-400"
              >
                使い方
              </button>
            </div>
          </div>

          <div className="mt-1.5 flex items-center gap-1.5">
            {/* 打つ欄ではなく結果の面。下の入力欄と同じ「枠のある欄」に見えると
                打ちに行ってしまうので、枠を持たせず左の帯と見出しで見せる */}
            <div className="flex min-w-0 flex-1 items-center gap-2 rounded-r-lg border-l-4 border-indigo-500 bg-indigo-50 py-2 pr-3 pl-2 dark:bg-indigo-500/10">
              <span className="shrink-0 text-[10px] font-bold tracking-widest text-indigo-600 dark:text-indigo-300">
                出力
              </span>
              <div
                ref={outputRef}
                className="kanji min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-xl leading-7"
              >
                {output || (
                  <span className="text-xs text-stone-500 dark:text-stone-400">
                    選んだ字がここにたまります（コピーして使えます）
                  </span>
                )}
              </div>
            </div>
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
              辞書データを読み込み中… (10万字・gzip 約0.9MB)
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

          <KanjiGrid
            items={results}
            onPick={pick}
            onPointerDown={keepFocus}
          />

          <footer className="mt-6 text-[10px] leading-relaxed text-stone-400 dark:text-stone-500">
            入力方式は zi.tools の IDS 部品入力を参考にしています。収録字は
            zi.tools と同じ Unicode の全CJK漢字 102,980字 (統合漢字 URO・拡張A〜J
            + 互換漢字)。分解データ: BabelStone IDS (Andrew West, 著作権主張なし)
            / CHISE IDS Database / CJKVI IDS Database (GPLv2) / 漢字情報:
            KANJIDIC2 (EDRDG, CC BY-SA 4.0) / 字形表示: Plangothic (SIL OFL
            1.1) / 手書き認識の筆順パターン: KanjiVG (Ulrich Apel, CC BY-SA
            3.0)。本アプリはプロトタイプです。
          </footer>
        </div>
      </main>

      {/* ── 下段: 選んだ字の詳細 + 入力欄 + カタチキーボード ── */}
      <div className="shrink-0">
        {/* 候補一覧の下(スクロールの奥)に置くと選んでも見えないので、常に見える位置に出す */}
        {selected && selMeta && (
          <section
            onPointerDown={keepFocus}
            className="border-t border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900"
          >
            <div className="mx-auto w-full max-w-3xl px-3 py-2">
              <CharDetail
                ch={selected}
                meta={selMeta}
                decomposition={selDecomp}
                onCopy={copyChar}
                onClose={() => setSelected(null)}
                copied={charCopied}
              />
            </div>
          </section>
        )}

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
              // かたちコードの欄には端末のIMEを触らせない。変換が始まると
              // 欄ごと持っていかれ、先に選んだ〈左右〉などが消えるため。
              // 読みから部品を引くのはキーボード内の「読みでさがす」で行う
              inputMode="none"
              enterKeyHint="search"
              // 検索キーでOSキーボードを閉じて候補を全部見られるようにする
              onKeyDown={(e) => {
                if (e.key === "Enter" && !composing) e.currentTarget.blur();
              }}
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

        <KatachiKeyboard engine={engine} onInsert={insert} onPick={pick} />
      </div>
    </div>
  );
}
