// 3つのIDS表のパーサ。どれも「字 -> IDS文字列」の Map を返す。
// 表ごとに書式も未符号化部品の表し方も違うので、ここで吸収して形を揃える。
// ("" = その字はこれ以上分解できない、という意味。キー自体は存在する)
import { existsSync, readFileSync } from "node:fs";
import { SRC } from "./paths.mts";

/** キーボードから打てない未符号化部品。engine 側もこれをプレースホルダとして扱う */
export const PLACEHOLDER = "？";

/**
 * 私用領域の字。BabelStone の未符号化部品を BabelStone Han PUA フォントの
 * 符号位置で表したもの。打てないのは ？ と同じだが、同梱フォント(KatachiPUA)で
 * **実際の形を描ける**ので、表示に出す分解としては ？ や ①②③ より上に置く
 */
export const isPua = (c: string) => c >= "\uE000" && c <= "\uF8FF";

// ---- BabelStone IDS.TXT ----
// 行形式: U+XXXX <TAB> 字 <TAB> ^IDS$(字源タグ) [<TAB> ^IDS$(字源タグ) ...]
//   字源タグ G=中国 H=香港 T=台湾 J=日本 K=韓国 P=北朝鮮 V=越南 …
//   〾    = 字形が微妙に違うことを示す印(検索には不要なので落とす)
//   {n}   = 未符号化部品。ヘッダの対応表で IDS 断片に置換する。
//           断片が無い(＝？)部品は、ヘッダにある私用領域の字(即の左 {18} → U+F2B4)にする
//   ？    = 表現できない部品
let bsLines: string[] | undefined;
const babelStoneLines = () =>
  (bsLines ??= readFileSync(SRC.babelstone, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/));

/**
 * ヘッダにある未符号化部品の対応表 "#\t{18}\tleft of 即 (F2B4 )\t？" を読み、
 * {n} を置き換える関数を返す。断片が組める部品は断片(部品検索に効く)、
 * 組めない部品は私用領域の字(形を描ける)にする
 */
let bsExpand: ((s: string) => string) | undefined;
function babelStoneExpand(): (s: string) => string {
  if (bsExpand) return bsExpand;
  const unencoded = new Map<string, string>();
  for (const line of babelStoneLines()) {
    const m = line.match(/^#\t\{(\d+)\}\t.*?(?:\(([0-9A-F]{4,5})\b.*?)?\t(.*)$/);
    if (!m) continue;
    const frag = m[3].trim();
    const pua = m[2] ? String.fromCodePoint(parseInt(m[2], 16)) : "";
    unencoded.set(m[1], frag && frag !== PLACEHOLDER ? frag : pua || PLACEHOLDER);
  }
  const expand = (s: string, depth = 0): string => {
    if (!s.includes("{")) return s;
    if (depth > 6) return s.replace(/\{\d+\}/g, PLACEHOLDER); // 相互参照の暴走止め
    return expand(
      s.replace(/\{(\d+)\}/g, (_, n) => unencoded.get(n) ?? PLACEHOLDER),
      depth + 1,
    );
  };
  return (bsExpand = (s) => expand(s));
}

/** 字ごとの BabelStone の分解(未展開・〾は落とす)と字源タグ */
function babelStoneRaw(): Map<string, { ids: string; src: string }[]> {
  const out = new Map<string, { ids: string; src: string }[]>();
  for (const line of babelStoneLines()) {
    if (!line || line.startsWith("#")) continue;
    const f = line.split("\t");
    if (f.length < 3) continue;
    const cands: { ids: string; src: string }[] = [];
    for (const s of f.slice(2)) {
      const m = s.match(/^\^(.*)\$(?:\(([^)]*)\))?$/);
      if (m) cands.push({ ids: m[1].replace(/〾/g, ""), src: m[2] || "" });
    }
    if (cands.length) out.set(f[1], cands);
  }
  return out;
}

/**
 * BabelStone の分解。穴の少ないものを選んだ結果、地域の優先順だけで選んだときの分解
 * (日本字体 → 未符号化部品を含まないもの → 先頭)と違うものになった字は、
 * そちらを `displaced` に控える。部品検索で引ける部品を減らさないため
 * (𩡧 は穴の無い P の ⿻𫠉灬 を選ぶが、G の ⿹{51}卌 の 卌 でも引けるようにする)
 */
export function loadBabelStone(): {
  ids: Map<string, string>;
  displaced: Map<string, string>;
} {
  const expand = babelStoneExpand();
  const out = new Map<string, string>();
  const displaced = new Map<string, string>();
  for (const [ch, cands] of babelStoneRaw()) {
    // 日本字体の中で穴の少ないもの(穴なし → 私用領域の部品だけ＝形は描ける → ？あり)。
    // 日本字体が ？ を含むしかない字(丑 J = ^？$)だけは、？ の無い他地域の分解
    // (丑 G = ⿻{42}丨)に譲る。形の分からない ？ を出すよりそのほうが伝わる
    const rank = (s: string) =>
      s.includes(PLACEHOLDER) ? 2 : [...s].some(isPua) ? 1 : 0;
    const best = (pool: string[]) =>
      pool.reduce((a, b) => (rank(b) < rank(a) ? b : a));
    const all = cands.map((c) => expand(c.ids));
    const jp = cands.flatMap((c, i) => (c.src.includes("J") ? [all[i]] : []));
    let ids = best(jp.length ? jp : all);
    if (rank(ids) === 2 && rank(best(all)) < 2) ids = best(all);
    // 丸ごと ？(𬼁 = ^？$)は「これ以上分けられない字」。字そのものと同じ扱いにする
    out.set(ch, ids && ids !== ch && ids !== PLACEHOLDER ? ids : "");

    const pool = jp.length ? cands.filter((c) => c.src.includes("J")) : cands;
    const byRegion = expand((pool.find((c) => !c.ids.includes(PLACEHOLDER)) ?? pool[0]).ids);
    if (byRegion !== ids && byRegion !== PLACEHOLDER) displaced.set(ch, byRegion);
  }
  return { ids: out, displaced };
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
//   &CDP-8B7C; など                  … 未符号化部品 → BabelStone の同じ部品(chiseEntityMap)。
//                                       対応が取れないものは ？
const resolveVariants = (s: string): string =>
  s.replace(/&(?:A-)?U-i\d+\+([0-9A-F]{4,6});/g, (_, hex) =>
    String.fromCodePoint(parseInt(hex, 16)),
  );

/** IDS を記号単位に割る。実体参照 &…; と {n} は1つに数える */
const tokens = (s: string) => s.match(/&[^;]+;|\{\d+\}|./gsu) ?? [];

/**
 * CHISE の外字(&CDP-8B7C; など)を、同じ部品を指す BabelStone の {n} に寄せる対応表。
 * 両方の表で**同じ字の分解が記号1つずつ揃って並ぶ**ものを集め、外字と {n} が
 * 同じ位置に来た回数を数えて多いほうを採る(即 = ⿰&CDP-8B7C;卩 / ⿰{18}卩 → {18})。
 * 寄せた先は BabelStone と同じく断片か私用領域の字になるので、飠 = ⿱亽&CDP-8B7C; も
 * 即の左と同じ形で描ける
 */
function chiseEntityMap(chiseLines: string[]): Map<string, string> {
  const bs = babelStoneRaw();
  const votes = new Map<string, Map<string, number>>();
  for (const line of chiseLines) {
    const f = line.split("\t");
    if (f.length < 3 || !f[2].includes("&")) continue;
    const cands = bs.get(f[1]);
    if (!cands) continue;
    const a = tokens(resolveVariants(f[2]));
    for (const c of cands) {
      const b = tokens(c.ids);
      if (a.length !== b.length) continue;
      const pairs: [string, string][] = [];
      let ok = true;
      for (let k = 0; k < a.length && ok; k++) {
        if (a[k] === b[k]) continue;
        if (a[k].startsWith("&") && b[k].startsWith("{")) pairs.push([a[k], b[k]]);
        else ok = false;
      }
      if (!ok) continue;
      for (const [e, n] of pairs) {
        const v = votes.get(e) ?? new Map<string, number>();
        v.set(n, (v.get(n) ?? 0) + 1);
        votes.set(e, v);
      }
      break; // 1字につき1票(地域違いの分解で二重に数えない)
    }
  }
  const expand = babelStoneExpand();
  const out = new Map<string, string>();
  for (const [e, v] of votes) {
    const [n] = [...v].sort((x, y) => y[1] - x[1])[0];
    const to = expand(n);
    if (to !== PLACEHOLDER) out.set(e, to);
  }
  return out;
}

// 私用領域の字は CHISE の外字フォント用なので先に ？ にしてから、外字を寄せる
// (寄せた先の私用領域の字は BabelStone Han PUA のもので、こちらは残す)
const resolveChise = (s: string, entities: Map<string, string>): string =>
  resolveVariants(s)
    .replace(/[\uE000-\uF8FF]/g, PLACEHOLDER)
    .replace(/&[^;]+;/g, (e) => entities.get(e) ?? PLACEHOLDER);

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
  const lines = readFileSync(SRC.chise, "utf8")
    .split("\n")
    .filter((line) => line && !line.startsWith(";;"));
  const entities = chiseEntityMap(lines);
  for (const line of lines) {
    const f = line.split("\t");
    if (f.length < 3) continue;
    const ch = f[1];
    const primary = resolveChise(f[2], entities);
    // 主分解が字そのもの(=分解なし)のときだけ見かけの構造で代用する
    const apparent = f.slice(3).find((s) => s.startsWith("@apparent="));
    const ids =
      primary !== ch
        ? primary
        : apparent
          ? resolveChise(apparent.slice(10), entities)
          : "";
    if (ids && ids !== ch) map.set(ch, ids);
  }
  return map;
}
