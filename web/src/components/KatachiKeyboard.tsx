"use client";

import { useMemo, useState } from "react";
import {
  DIFFICULT_COMPONENTS,
  OPERATORS,
  PRIMARY_CODES,
  RADICAL_PALETTE,
  type Engine,
} from "@/lib/engine";
import { OperatorIcon } from "./OperatorIcon";

type Tab = "shape" | "common" | "radical";

const TABS: { id: Tab; label: string }[] = [
  { id: "shape", label: "かたち" },
  { id: "common", label: "よく使う部品" },
  { id: "radical", label: "部首・偏旁" },
];

/** タップでフォーカスを奪わない＝ソフトキーボードを閉じさせないためのハンドラ */
const keepFocus = (e: React.PointerEvent) => e.preventDefault();

export function KatachiKeyboard({
  engine,
  onInsert,
  osKeyboard,
  onToggleOsKeyboard,
}: {
  engine: Engine | null;
  onInsert: (s: string) => void;
  osKeyboard: boolean;
  onToggleOsKeyboard: () => void;
}) {
  const [tab, setTab] = useState<Tab>("shape");
  const [showAllOps, setShowAllOps] = useState(false);

  const ops = useMemo(() => {
    const primary = PRIMARY_CODES.map(c => OPERATORS.find(o => o.code === c)!).filter(Boolean);
    return showAllOps ? [...primary, ...OPERATORS.filter(o => !PRIMARY_CODES.includes(o.code))] : primary;
  }, [showAllOps]);

  const common = useMemo(() => engine?.commonParts(180) ?? [], [engine]);

  return (
    <div className="border-t border-stone-200 bg-stone-100/95 backdrop-blur dark:border-stone-800 dark:bg-stone-900/95">
      <div className="mx-auto w-full max-w-3xl px-2 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {/* タブ */}
        <div className="flex items-center gap-1">
          {TABS.map(t => (
            <button
              key={t.id}
              onPointerDown={keepFocus}
              onClick={() => setTab(t.id)}
              className={`flex-1 rounded-t-lg px-2 py-1.5 text-xs font-medium ${
                tab === t.id
                  ? "bg-white text-indigo-600 shadow-sm dark:bg-stone-800 dark:text-indigo-300"
                  : "text-stone-500 hover:bg-white/60 dark:text-stone-400 dark:hover:bg-stone-800/60"
              }`}
            >
              {t.label}
            </button>
          ))}
          <button
            onPointerDown={keepFocus}
            onClick={onToggleOsKeyboard}
            title="端末のキーボードで部品を入力する"
            className={`ml-1 shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium ${
              osKeyboard
                ? "bg-indigo-600 text-white"
                : "border border-stone-300 text-stone-600 dark:border-stone-700 dark:text-stone-300"
            }`}
          >
            あ
          </button>
        </div>

        <div className="rounded-b-lg rounded-tr-lg bg-white p-1.5 shadow-sm dark:bg-stone-800">
          {tab === "shape" && (
            <div className="max-h-[min(42vh,300px)] overflow-y-auto">
              <div className="grid grid-cols-6 gap-1 sm:grid-cols-9">
                {ops.map(op => (
                  <button
                    key={op.code}
                    onPointerDown={keepFocus}
                    onClick={() => onInsert(op.code)}
                    className="flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-lg border border-stone-200 bg-stone-50 text-stone-700 active:bg-indigo-100 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:active:bg-stone-700"
                  >
                    <OperatorIcon code={op.code} />
                    <span className="text-[10px] leading-none text-stone-500 dark:text-stone-400">
                      {op.label}
                    </span>
                  </button>
                ))}
                <button
                  onPointerDown={keepFocus}
                  onClick={() => setShowAllOps(s => !s)}
                  className="flex min-h-[52px] items-center justify-center rounded-lg border border-dashed border-stone-300 text-[11px] text-stone-500 active:bg-stone-100 dark:border-stone-600 dark:text-stone-400"
                >
                  {showAllOps ? "少なく" : "その他"}
                </button>
              </div>
            </div>
          )}

          {tab === "common" && (
            <PartGrid parts={common} onInsert={onInsert} empty="辞書を読み込み中…" />
          )}

          {tab === "radical" && <RadicalTab onInsert={onInsert} />}
        </div>
      </div>
    </div>
  );
}

/**
 * 部首・偏旁タブ。既定は日本語向けに絞った RADICAL_PALETTE、
 * 画数チップを選ぶと zi.tools の「難輸入部件」全541件をその画数ぶんだけ出す。
 * 541件を一度に並べると探せないので、zi.tools と同じく画数で区切っている。
 */
function RadicalTab({ onInsert }: { onInsert: (s: string) => void }) {
  const [group, setGroup] = useState<string>("common");
  const parts = useMemo(() => {
    if (group === "common") return RADICAL_PALETTE;
    return [...(DIFFICULT_COMPONENTS.find((g) => g.strokes === group)?.parts ?? "")];
  }, [group]);

  return (
    <div>
      <div className="mb-1 flex gap-1 overflow-x-auto pb-0.5">
        <StrokeChip
          active={group === "common"}
          onClick={() => setGroup("common")}
          label="よく使う"
        />
        {DIFFICULT_COMPONENTS.map((g) => (
          <StrokeChip
            key={g.strokes}
            active={group === g.strokes}
            onClick={() => setGroup(g.strokes)}
            label={`${g.strokes}画`}
          />
        ))}
      </div>
      <PartGrid parts={parts} onInsert={onInsert} />
    </div>
  );
}

function StrokeChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onPointerDown={keepFocus}
      onClick={onClick}
      className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] whitespace-nowrap ${
        active
          ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-600 dark:bg-stone-900 dark:text-indigo-300"
          : "border-stone-300 text-stone-500 dark:border-stone-600 dark:text-stone-400"
      }`}
    >
      {label}
    </button>
  );
}

function PartGrid({
  parts,
  onInsert,
  empty,
}: {
  parts: string[];
  onInsert: (s: string) => void;
  empty?: string;
}) {
  if (!parts.length) {
    return <p className="py-8 text-center text-xs text-stone-400">{empty ?? "—"}</p>;
  }
  return (
    <div className="max-h-[min(42vh,300px)] overflow-y-auto overscroll-contain">
      <div className="grid grid-cols-8 gap-1 sm:grid-cols-12">
        {parts.map(p => (
          <button
            key={p}
            onPointerDown={keepFocus}
            onClick={() => onInsert(p)}
            className="kanji flex min-h-[44px] items-center justify-center rounded-lg border border-stone-200 bg-stone-50 text-xl leading-none active:bg-indigo-100 dark:border-stone-700 dark:bg-stone-900 dark:active:bg-stone-700"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}
