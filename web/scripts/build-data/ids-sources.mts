// 3つのIDS表のパーサ。どれも「字 -> IDS文字列」の Map を返す。
// 表ごとに書式も未符号化部品の表し方も違うので、ここで吸収して形を揃える。
// ("" = その字はこれ以上分解できない、という意味。キー自体は存在する)
import { existsSync, readFileSync } from "node:fs";
import { SRC } from "./paths.mts";

/** キーボードから打てない未符号化部品。engine 側もこれをプレースホルダとして扱う */
export const PLACEHOLDER = "？";

// ---- BabelStone IDS.TXT ----
// 行形式: U+XXXX <TAB> 字 <TAB> ^IDS$(字源タグ) [<TAB> ^IDS$(字源タグ) ...]
//   字源タグ G=中国 H=香港 T=台湾 J=日本 K=韓国 P=北朝鮮 V=越南 …
//   〾    = 字形が微妙に違うことを示す印(検索には不要なので落とす)
//   {n}   = 未符号化部品。ヘッダの対応表で IDS 断片に置換する
//   ？    = 表現できない部品
export function loadBabelStone(): Map<string, string> {
  const lines = readFileSync(SRC.babelstone, "utf8").replace(/^﻿/, "").split(/\r?\n/);

  // ヘッダにある未符号化部品の対応表 "#\t{12}\t...\t⿰亻等"
  const unencoded = new Map<string, string>();
  for (const line of lines) {
    const m = line.match(/^#\t\{(\d+)\}\t.*?\t(.*)$/);
    if (m) unencoded.set(m[1], m[2].trim() || PLACEHOLDER);
  }
  const expand = (s: string, depth = 0): string => {
    if (!s.includes("{")) return s;
    if (depth > 6) return s.replace(/\{\d+\}/g, PLACEHOLDER); // 相互参照の暴走止め
    return expand(
      s.replace(/\{(\d+)\}/g, (_, n) => unencoded.get(n) ?? PLACEHOLDER),
      depth + 1,
    );
  };

  const out = new Map<string, string>();
  for (const line of lines) {
    if (!line || line.startsWith("#")) continue;
    const f = line.split("\t");
    if (f.length < 3) continue;
    const ch = f[1];
    const cands: { ids: string; src: string }[] = [];
    for (const s of f.slice(2)) {
      const m = s.match(/^\^(.*)\$(?:\(([^)]*)\))?$/);
      if (m) cands.push({ ids: m[1], src: m[2] || "" });
    }
    if (!cands.length) continue;
    // 日本字体 → ？を含まないもの → 先頭、の順に採用
    const jp = cands.filter((c) => c.src.includes("J"));
    const pool = jp.length ? jp : cands;
    const pick = pool.find((c) => !c.ids.includes(PLACEHOLDER)) ?? pool[0];
    const ids = expand(pick.ids).replace(/〾/g, "");
    out.set(ch, ids && ids !== ch ? ids : "");
  }
  return out;
}

// ---- CJKVI IDS ----
// 行形式: U+XXXX <TAB> 字 <TAB> IDS[タグ] (<TAB> IDS[タグ] ...)
// 日本字体 [J..] を優先、なければタグ無し、なければ先頭
export function loadCjkvi(): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of readFileSync(SRC.cjkvi, "utf8").split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const f = line.split("\t");
    if (f.length < 3) continue;
    const ch = f[1];
    const entries = f
      .slice(2)
      .map((s) => {
        const m = s.match(/^(.*?)(?:\[([A-Z]+)\])?$/)!;
        return { ids: m[1], tags: m[2] || "" };
      })
      .filter((e) => e.ids);
    if (!entries.length) continue;
    const pick =
      entries.find((e) => e.tags.includes("J")) ||
      entries.find((e) => !e.tags) ||
      entries[0];
    if (pick.ids && pick.ids !== ch) out.set(ch, pick.ids);
  }
  return out;
}

// ---- CHISE IDS(全ブロック) ----
// 書式は CJKVI と同じ TSV。コメント行は ";;" 始まり。
// 3列目以降に "@apparent=…"(見かけの構造)が入ることがある。
// CHISE 独自の実体参照は
//   &U-i001+6208; / &A-U-i002+9FB9; … 符号化字の字形バリアント → 基底字(戈・鿹)に解決
//   &CDP-8968; など                  … 未符号化部品 → ？
const resolveChise = (s: string): string =>
  s
    .replace(/&(?:A-)?U-i\d+\+([0-9A-F]{4,6});/g, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&[^;]+;/g, PLACEHOLDER)
    .replace(/[\uE000-\uF8FF]/g, PLACEHOLDER); // CHISE の外字フォント用私用領域

/**
 * CHISE は上流がブロックごと18ファイルだが、data-src では1ファイルに連結してある
 * (`data-src/fetch.mjs` が連結する)。連結ヘッダの ";;" 行は読み飛ばす。
 */
export function loadChise(): Map<string, string> {
  const map = new Map<string, string>();
  if (!existsSync(SRC.chise)) {
    console.warn(`!! ${SRC.chise} が無いので CHISE をスキップ(拡張Jの分解が丸ごと落ちます)`);
    return map;
  }
  for (const line of readFileSync(SRC.chise, "utf8").split("\n")) {
    if (!line || line.startsWith(";;")) continue;
    const f = line.split("\t");
    if (f.length < 3) continue;
    const ch = f[1];
    const primary = resolveChise(f[2]);
    // 主分解が字そのもの(=分解なし)のときだけ見かけの構造で代用する
    const apparent = f.slice(3).find((s) => s.startsWith("@apparent="));
    const ids =
      primary !== ch ? primary : apparent ? resolveChise(apparent.slice(10)) : "";
    if (ids && ids !== ch) map.set(ch, ids);
  }
  return map;
}
