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
