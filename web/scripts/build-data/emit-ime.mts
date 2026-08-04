// ネイティブIME(Android/iOS)向けの辞書を書き出す。
//
// キーボードは「呼び出されたら即出る」ことが要るので、2.4MB の JSON を
// 起動のたびに構文解析する構成にはできない(Android で1〜2秒かかる)。
// タブ区切りの素朴なテキストにしておくと、行を split するだけで読めて
// 中間オブジェクトも作らずに済む。
//
//   dict-ja.tsv    KANJIDIC2 収録字   char \t ids \t grade \t freq \t on \t kun
//   dict-ext.tsv   それ以外の漢字      char \t ids
//   dict-parts.tsv 漢字でない部品      char \t ids
//
// 分けてあるのは、IME 側が「日本語の字だけ先に読んで検索可能にし、
// 拡張漢字は後から読む」という段階読み込みをできるようにするため。
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RawData } from "../../../core/data/types.ts";
import {
  DIFFICULT_COMPONENTS,
  RADICAL_PALETTE,
} from "../../../core/data/palettes.ts";
import { AUTO_DARK, AUTO_LIGHT, THEMES } from "../../../core/data/themes.ts";
import { OPERATOR_ICON } from "../../../core/ids/operators.ts";

/**
 * 部品パレットを Kotlin のソースとして書き出す。
 * 541件を手で写すと必ずずれるので、core/data/palettes.ts を単一の出所にして生成する。
 */
export function emitPalettesKotlin(outPath: string): string {
  const groups = DIFFICULT_COMPONENTS.map(
    (g) => `        Group("${g.strokes}", "${g.parts}"),`,
  ).join("\n");
  const src = `package com.upsee.katachi.ime

// 自動生成: core/data/palettes.ts から web の build:data が書き出す。直接編集しないこと。
object Palettes {
    /** かなキーボードでは打てない偏旁・筆画(日本語向けに絞ったもの) */
    val RADICAL = "${RADICAL_PALETTE.join("")}"

    /** zi.tools「難輸入部件」。画数ごと、各画数内は第1画の筆形(橫→豎→撇→點→折)順 */
    data class Group(val strokes: String, val parts: String)

    val DIFFICULT = listOf(
${groups}
    )
}
`;
  mkdirSync(join(outPath, ".."), { recursive: true });
  writeFileSync(outPath, src);
  return `Palettes.kt (部首${RADICAL_PALETTE.length}件 + 難輸入部件${DIFFICULT_COMPONENTS.reduce((n, g) => n + [...g.parts].length, 0)}件)`;
}

/** 同じものを iOS(Swift)へ。Kotlin 版と同様、手写しでずれないよう生成する */
export function emitPalettesSwift(outPath: string): string {
  const groups = DIFFICULT_COMPONENTS.map(
    (g) => `        Group(strokes: "${g.strokes}", parts: "${g.parts}"),`,
  ).join("\n");
  const src = `import Foundation

// 自動生成: core/data/palettes.ts から web の build:data が書き出す。直接編集しないこと。
enum Palettes {
    /// かなキーボードでは打てない偏旁・筆画(日本語向けに絞ったもの)
    static let radical = "${RADICAL_PALETTE.join("")}"

    /// zi.tools「難輸入部件」。画数ごと、各画数内は第1画の筆形(橫→豎→撇→點→折)順
    struct Group {
        let strokes: String
        let parts: String
    }

    static let difficult: [Group] = [
${groups}
    ]
}
`;
  mkdirSync(join(outPath, ".."), { recursive: true });
  writeFileSync(outPath, src);
  return "Palettes.swift";
}

/**
 * 着せ替え(カラーテーマ)を Kotlin へ。出所は core/data/themes.ts の1か所。
 * 「おまかせ」(auto)の解決もここで生成して、各実装が同じ規則になるようにする。
 */
export function emitThemesKotlin(outPath: string): string {
  const rows = THEMES.map(
    (t) =>
      `        Palette("${t.key}", "${t.label}", ${t.colors.dark}, ` +
      `"${t.colors.bg}", "${t.colors.card}", "${t.colors.key}", "${t.colors.border}", ` +
      `"${t.colors.text}", "${t.colors.sub}", "${t.colors.faint}", ` +
      `"${t.colors.accent}", "${t.colors.accentBg}", "${t.colors.onAccent}"),`,
  ).join("\n");
  const src = `package com.upsee.katachi.ime

// 自動生成: core/data/themes.ts から web の build:data が書き出す。直接編集しないこと。
object Themes {
    data class Palette(
        val key: String,
        val label: String,
        val dark: Boolean,
        val bg: String,
        val card: String,
        val keyFill: String,
        val border: String,
        val text: String,
        val sub: String,
        val faint: String,
        val accent: String,
        val accentBg: String,
        val onAccent: String,
    )

    val ALL = listOf(
${rows}
    )

    /** key からテーマを引く。"auto"・不明な key は端末のダーク設定に追従する */
    fun resolve(key: String?, systemDark: Boolean): Palette {
        val fallback = if (systemDark) "${AUTO_DARK}" else "${AUTO_LIGHT}"
        return ALL.firstOrNull { it.key == key } ?: ALL.first { it.key == fallback }
    }
}
`;
  mkdirSync(join(outPath, ".."), { recursive: true });
  writeFileSync(outPath, src);
  return `Themes.kt (${THEMES.length}テーマ)`;
}

/** 同じものを iOS(Swift)へ */
export function emitThemesSwift(outPath: string): string {
  const hex = (s: string) => `0x${s.slice(1)}`;
  const rows = THEMES.map(
    (t) =>
      `        Palette(key: "${t.key}", label: "${t.label}", dark: ${t.colors.dark}, ` +
      `bg: ${hex(t.colors.bg)}, card: ${hex(t.colors.card)}, keyFill: ${hex(t.colors.key)}, ` +
      `border: ${hex(t.colors.border)}, text: ${hex(t.colors.text)}, sub: ${hex(t.colors.sub)}, ` +
      `faint: ${hex(t.colors.faint)}, accent: ${hex(t.colors.accent)}, ` +
      `accentBg: ${hex(t.colors.accentBg)}, onAccent: ${hex(t.colors.onAccent)}),`,
  ).join("\n");
  const src = `import Foundation

// 自動生成: core/data/themes.ts から web の build:data が書き出す。直接編集しないこと。
enum Themes {
    struct Palette {
        let key: String
        let label: String
        let dark: Bool
        let bg: UInt32
        let card: UInt32
        let keyFill: UInt32
        let border: UInt32
        let text: UInt32
        let sub: UInt32
        let faint: UInt32
        let accent: UInt32
        let accentBg: UInt32
        let onAccent: UInt32
    }

    static let all: [Palette] = [
${rows}
    ]

    static let autoLight = "${AUTO_LIGHT}"
    static let autoDark = "${AUTO_DARK}"

    /// key からテーマを引く。"auto"・不明な key は nil(呼び出し側でおまかせ扱い)
    static func palette(_ key: String?) -> Palette? {
        all.first { $0.key == key }
    }
}
`;
  mkdirSync(join(outPath, ".."), { recursive: true });
  writeFileSync(outPath, src);
  return "Themes.swift";
}

/**
 * 操作子の配置図を Kotlin / Swift へ。
 *
 * IDC文字(⿰⿱⿴…)は端末のフォントで豆腐になるので、システムキーボードでも
 * アプリと同じように**矩形で図を描く**。図形の定義は core/ids/operators.ts の
 * 1か所で、ここから各言語のテーブルを書き出す。
 * 矩形は 0〜1 に正規化した [x, y, w, h, 役割(1〜3)]。
 */
function iconRows(fmt: (code: string, body: string) => string): string {
  return Object.entries(OPERATOR_ICON)
    .map(([code, spec]) => {
      if (spec.symbol) return fmt(code, JSON.stringify(spec.symbol));
      const rects = (spec.rects ?? [])
        .map((r) => `${r.x}f, ${r.y}f, ${r.w}f, ${r.h}f, ${r.role}f`)
        .join(",  ");
      return fmt(code, rects);
    })
    .join("\n");
}

export function emitOperatorIconsKotlin(outPath: string): string {
  const rows = iconRows((code, body) =>
    body.startsWith('"')
      ? `        "${code}" to Icon(symbol = ${body}),`
      : `        "${code}" to Icon(rects = floatArrayOf(${body})),`,
  );
  const src = `package com.upsee.katachi.ime

// 自動生成: core/ids/operators.ts から web の build:data が書き出す。直接編集しないこと。
object OperatorIcons {
    /** rects は [x, y, w, h, 役割] の並び。0〜1 に正規化してある */
    data class Icon(val rects: FloatArray? = null, val symbol: String? = null)

    val ALL: Map<String, Icon> = mapOf(
${rows}
    )
}
`;
  mkdirSync(join(outPath, ".."), { recursive: true });
  writeFileSync(outPath, src);
  return `OperatorIcons.kt (${Object.keys(OPERATOR_ICON).length}種)`;
}

export function emitOperatorIconsSwift(outPath: string): string {
  const rows = iconRows((code, body) =>
    body.startsWith('"')
      ? `        "${code}": Icon(symbol: ${body}),`
      : `        "${code}": Icon(rects: [${body.replace(/f/g, "")}]),`,
  );
  const src = `import Foundation

// 自動生成: core/ids/operators.ts から web の build:data が書き出す。直接編集しないこと。
enum OperatorIcons {
    /// rects は [x, y, w, h, 役割] の並び。0〜1 に正規化してある
    struct Icon {
        var rects: [CGFloat]? = nil
        var symbol: String? = nil
    }

    static let all: [String: Icon] = [
${rows}
    ]
}
`;
  mkdirSync(join(outPath, ".."), { recursive: true });
  writeFileSync(outPath, src);
  return "OperatorIcons.swift";
}

export function emitImeDict(data: RawData, outDir: string): string[] {
  mkdirSync(outDir, { recursive: true });

  const ja: string[] = [];
  for (const [ch, [ids, grade, freq, on, kun]] of Object.entries(data.chars)) {
    ja.push(`${ch}\t${ids}\t${grade}\t${freq}\t${on}\t${kun}`);
  }

  const ext: string[] = [];
  for (const [ch, ids] of Object.entries(data.ext)) ext.push(`${ch}\t${ids}`);

  const parts: string[] = [];
  for (const [ch, ids] of Object.entries(data.parts)) parts.push(`${ch}\t${ids}`);

  const files: [string, string[]][] = [
    ["dict-ja.tsv", ja],
    ["dict-ext.tsv", ext],
    ["dict-parts.tsv", parts],
  ];
  const written: string[] = [];
  for (const [name, lines] of files) {
    const path = join(outDir, name);
    writeFileSync(path, lines.join("\n") + "\n");
    written.push(`${name} (${lines.length} 行)`);
  }
  return written;
}
