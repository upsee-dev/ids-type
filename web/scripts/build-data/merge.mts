// 3つのIDS表を優先順位つきで1つに畳む。
//
//   1. BabelStone を土台にする(全97,680字・字源タグつき)
//   2. 穴(＝拡張Jの全字＋他の表が分解を持たない字)を CHISE で埋める
//   3. KANJIDIC2 収録字だけ CJKVI の日本字体で上書きする(従来の検索結果を変えない)
//   4. どの表にも無い字(部首補助 ⺼⺻…・互換漢字 U+F900〜)を CJKVI で拾う
//
// CHISE と CJKVI は GPLv2 なので、mode="babelstone" では両方使わない。
// 字そのものは残るが拡張J 4,298字の分解が落ちる(構造検索に出なくなる)。
import { loadBabelStone, loadChise, loadCjkvi } from "./ids-sources.mts";
import { COMPAT_BLOCKS } from "../../../core/data/blocks.ts";

export type IdsMode = "mixed" | "babelstone";

export interface MergeResult {
  /** 字 -> IDS("" = 分解なし) */
  ids: Map<string, string>;
  log: string[];
}

export function mergeIds(
  kanjidic: Map<string, unknown>,
  mode: IdsMode = "mixed",
): MergeResult {
  const log: string[] = [];

  const bs = loadBabelStone();
  log.push(
    `BabelStone IDS: ${bs.size} (分解あり ${[...bs.values()].filter(Boolean).length})`,
  );

  const ids = new Map(bs);

  if (mode !== "babelstone") {
    const chise = loadChise();
    log.push(`CHISE IDS: ${chise.size}`);
    let viaChise = 0;
    for (const [ch, v] of chise) {
      if (ids.has(ch)) continue;
      ids.set(ch, v);
      viaChise++;
    }
    log.push(`CHISE で補完: ${viaChise} (拡張Jの全字＋他の表に分解が無い字)`);

    const cj = loadCjkvi();
    log.push(`CJKVI IDS: ${cj.size}`);
    for (const ch of kanjidic.keys()) {
      const v = cj.get(ch);
      if (v) ids.set(ch, v);
    }
    let viaCjkvi = 0;
    for (const [ch, v] of cj) {
      if (ids.has(ch)) continue;
      ids.set(ch, v);
      viaCjkvi++;
    }
    log.push(`CJKVI で補完(部首補助・互換漢字など): ${viaCjkvi}`);
  }

  // 互換漢字は BabelStone にほぼ無い。統合漢字と正規等価なので NFC で解決した先の
  // IDS をそのまま借りる。zi.tools も互換漢字を独立した字として引けるので全部入れる
  let viaNFC = 0;
  for (const { lo, hi } of COMPAT_BLOCKS) {
    for (let cp = lo; cp <= hi; cp++) {
      const ch = String.fromCodePoint(cp);
      if (ids.has(ch)) continue;
      const canonical = ch.normalize("NFC");
      if (canonical === ch) continue; // 未割り当て or 統合漢字扱いの字
      const v = ids.get(canonical);
      if (v !== undefined) {
        ids.set(ch, v);
        viaNFC++;
      }
    }
  }
  log.push(`統合後: ${ids.size} (互換漢字をNFC経由で補完: ${viaNFC})`);

  return { ids, log };
}
