"use client";

import { useEffect, useRef, useState } from "react";
import {
  HandwritingIndex,
  type Engine,
  type HwMatch,
} from "@/lib/engine";

/**
 * 手書き検索の面(Web版)。読めない字を枠に書くと、似ている字が候補に出る。
 * 認識は通信なし・ブラウザ内だけ(core/handwriting.ts)。
 * パターン(1.3MB / gzip 0.8MB)はこのタブを初めて開いたときに読む。
 *
 * 候補は**クリックで出力へ**、**長押しでかたちコードの部品**に
 * (アプリ版・システムキーボードと同じ並び)。
 */

let indexPromise: Promise<HandwritingIndex> | null = null;
function loadIndex(): Promise<HandwritingIndex> {
  indexPromise ??= fetch("/data/handwriting.json")
    .then((r) => r.json())
    .then((data) => new HandwritingIndex(data));
  return indexPromise;
}

type Stroke = [number, number][];

function toPath(s: Stroke): string {
  if (!s.length) return "";
  const head = `M${s[0][0].toFixed(1)} ${s[0][1].toFixed(1)}`;
  if (s.length === 1) return `${head}l0.1 0.1`; // 点だけの「丶」も見えるように
  return head + s.slice(1).map(([x, y]) => `L${x.toFixed(1)} ${y.toFixed(1)}`).join("");
}

/** クリックとは別に長押しを拾う(500ms)。離す前に発火したらクリックは殺す */
const LONG_PRESS_MS = 500;

export function HandwritingPad({
  engine,
  onInsert,
  onPick,
}: {
  engine: Engine | null;
  /** 長押し: かたちコードに部品として足す */
  onInsert: (s: string) => void;
  /** クリック: 出力へ(書いた字そのものが欲しい場面が多い) */
  onPick: (ch: string) => void;
}) {
  const [index, setIndex] = useState<HandwritingIndex | null>(null);
  const [failed, setFailed] = useState(false);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [current, setCurrent] = useState<Stroke>([]);
  const [matches, setMatches] = useState<HwMatch[]>([]);

  useEffect(() => {
    let alive = true;
    loadIndex()
      .then((ix) => alive && setIndex(ix))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!index || !strokes.length) {
      setMatches([]);
      return;
    }
    const hits = index.match(strokes, 30);
    // 日本語で使わない字(KANJIDIC2外)は、形が同じでも日本の字の後ろへ
    if (engine) {
      hits.sort(
        (a, b) =>
          a.score +
          (engine.meta(a.ch)?.ext !== false ? 0.02 : 0) -
          (b.score + (engine.meta(b.ch)?.ext !== false ? 0.02 : 0)),
      );
    }
    setMatches(hits.slice(0, 24));
  }, [index, strokes, engine]);

  const svgRef = useRef<SVGSVGElement>(null);
  const curRef = useRef<Stroke>([]);
  const drawing = useRef(false);

  const point = (e: React.PointerEvent): [number, number] => {
    const r = svgRef.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  const endStroke = () => {
    if (!drawing.current) return;
    drawing.current = false;
    const cur = curRef.current;
    curRef.current = [];
    setCurrent([]);
    if (cur.length > 0) setStrokes((s) => [...s, cur]);
  };

  // 候補の長押し
  const pressTimer = useRef<number | null>(null);
  const longFired = useRef(false);

  return (
    <div className="flex flex-col gap-1">
      {/* ── 候補行 ── */}
      {matches.length > 0 ? (
        <div className="flex gap-1 overflow-x-auto pb-0.5">
          {matches.map((m) => (
            <button
              key={m.ch}
              onPointerDown={(e) => {
                e.preventDefault(); // フォーカスを奪わない
                longFired.current = false;
                pressTimer.current = window.setTimeout(() => {
                  longFired.current = true;
                  onInsert(m.ch);
                }, LONG_PRESS_MS);
              }}
              onPointerUp={() => {
                if (pressTimer.current) clearTimeout(pressTimer.current);
              }}
              onPointerLeave={() => {
                if (pressTimer.current) clearTimeout(pressTimer.current);
              }}
              onClick={() => {
                if (!longFired.current) onPick(m.ch);
              }}
              className="kanji flex h-11 min-w-11 shrink-0 items-center justify-center rounded-lg border border-stone-200 bg-stone-50 px-1 text-2xl leading-none active:bg-indigo-100 dark:border-stone-700 dark:bg-stone-900 dark:active:bg-stone-700"
            >
              {m.ch}
            </button>
          ))}
        </div>
      ) : (
        <p className="py-2 text-[11px] text-stone-400">
          {failed
            ? "手書きの辞書を読み込めませんでした。再読み込みしてください。"
            : index
              ? strokes.length
                ? "似ている字が見つかりません。全部消してもう一度どうぞ"
                : "枠に字を書くと候補が出ます。クリックで出力へ・長押しで部品に"
              : "手書きの辞書を読み込み中… (gzip 約0.8MB・初回のみ)"}
        </p>
      )}

      {/* ── 書く枠 + 道具 ── */}
      <div className="flex gap-1.5">
        <svg
          ref={svgRef}
          className="h-56 min-w-0 flex-1 touch-none rounded-xl border border-stone-200 bg-stone-50 text-stone-800 select-none dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100"
          onPointerDown={(e) => {
            e.preventDefault();
            (e.target as Element).setPointerCapture?.(e.pointerId);
            drawing.current = true;
            curRef.current = [point(e)];
            setCurrent(curRef.current);
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return;
            const p = point(e);
            const last = curRef.current[curRef.current.length - 1];
            if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 2) return;
            curRef.current = [...curRef.current, p];
            setCurrent(curRef.current);
          }}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
        >
          {/* 目安の十字(枠自体が正方形とは限らないので中心線だけ) */}
          <line
            x1="50%" y1="4%" x2="50%" y2="96%"
            className="stroke-stone-200 dark:stroke-stone-800"
            strokeDasharray="2 5"
          />
          <line
            x1="4%" y1="50%" x2="96%" y2="50%"
            className="stroke-stone-200 dark:stroke-stone-800"
            strokeDasharray="2 5"
          />
          {strokes.map((s, i) => (
            <path
              key={i}
              d={toPath(s)}
              fill="none"
              stroke="currentColor"
              strokeWidth={4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {current.length > 0 && (
            <path
              d={toPath(current)}
              fill="none"
              className="stroke-indigo-500"
              strokeWidth={4}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </svg>

        <div className="flex w-20 shrink-0 flex-col gap-1">
          <p className="py-0.5 text-center text-[11px] text-stone-500 dark:text-stone-400">
            {strokes.length ? `${strokes.length}画` : "手書き"}
          </p>
          <button
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => setStrokes((s) => s.slice(0, -1))}
            className="rounded-lg border border-stone-200 bg-stone-50 py-2.5 text-xs text-stone-700 active:bg-stone-100 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
          >
            1画消す
          </button>
          <button
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => {
              setStrokes([]);
              setCurrent([]);
            }}
            className="rounded-lg border border-stone-200 bg-stone-50 py-2.5 text-xs text-stone-700 active:bg-stone-100 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
          >
            全部消す
          </button>
        </div>
      </div>
    </div>
  );
}
