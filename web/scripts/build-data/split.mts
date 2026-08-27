// 統合した IDS と KANJIDIC2 を、辞書ファイルの3つの入れ物に振り分ける。
//
//   chars … KANJIDIC2 収録字。読み・学年・頻度つき。候補の先頭に出る
//   ext   … それ以外の CJK 漢字。IDSのみ。候補の後ろに回る
//   parts … 漢字でない部品(部首補助・筆画)。候補には出さないが分解には使う
import { BLOCKS, isIdeograph } from "../../../core/data/blocks.ts";
import type { RawData } from "../../../core/data/types.ts";
import type { KanjiInfo } from "./kanjidic2.mts";
import type { RefReading } from "./readings.mts";

export interface SplitResult extends RawData {
  /** 収録はしたが分解データが無い字の数 */
  extNoIds: number;
  /** 分解を持たない葉(筆画など)。数が急に増えたら正規化表の見直し時 */
  leaves: Set<string>;
}

const isIDC = (c: string) => (c >= "⿰" && c <= "⿿") || c === "㇯";

export function splitDictionary(
  kanjidic: Map<string, KanjiInfo>,
  idsMap: Map<string, string>,
  /** 参考・推定の読み。正式な読みが無い字だけ埋まる(readings.mts) */
  refOf: (ch: string) => RefReading,
): SplitResult {
  /** 参考の読みと出所を、辞書に入れる2つの文字列にする */
  const refPair = (ch: string): [string, string] => {
    const r = refOf(ch);
    if (!r.ref.length) return ["", ""];
    return [r.ref.join(" "), r.from ? `${r.kind}:${r.from}` : r.kind];
  };

  const chars: RawData["chars"] = {};
  for (const [ch, m] of kanjidic) {
    const [ref, refKind] = refPair(ch);
    chars[ch] = [
      idsMap.get(ch) || "",
      m.grade,
      m.freq,
      m.on.join(" "),
      m.kun.join(" "),
      m.strokes,
      m.rad,
      m.meaning.join(", "),
      m.nanori.join(" "),
      ref,
      refKind,
    ];
  }

  const ext: RawData["ext"] = {};
  const parts: RawData["parts"] = {};
  for (const [ch, ids] of idsMap) {
    if (ch in chars) continue;
    if (isIdeograph(ch)) ext[ch] = [ids, ...refPair(ch)];
    else parts[ch] = ids;
  }

  // zi.tools と同じく「ブロックの割り当て済み全字」を収録する。
  // どの IDS 表にも無い字(拡張C/Eの末尾追加分など)は IDS 空で候補にだけ残す
  // ＝構造検索には出ないが、一覧・部品検索の対象からは漏れない。
  // BLOCKS の各範囲は全域が割り当て済み(穴なし)であることを UCD で確認済み
  let extNoIds = 0;
  for (const { lo, hi } of BLOCKS) {
    for (let cp = lo; cp <= hi; cp++) {
      const ch = String.fromCodePoint(cp);
      if (ch in chars || ch in ext) continue;
      ext[ch] = ["", ...refPair(ch)];
      extNoIds++;
    }
  }

  // 分解の中に出てくるが、それ自体は分解を持たない字(筆画など)
  const leaves = new Set<string>();
  const allIds = [
    ...Object.values(chars).map((v) => v[0]),
    ...Object.values(ext).map((v) => v[0]),
    ...Object.values(parts),
  ];
  for (const ids of allIds) {
    for (const t of ids) {
      if (!isIDC(t) && t !== "？" && !(t in chars) && !(t in ext) && !(t in parts)) {
        leaves.add(t);
      }
    }
  }

  return { chars, ext, parts, extNoIds, leaves };
}
