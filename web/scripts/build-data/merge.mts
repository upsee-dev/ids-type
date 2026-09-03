// 3つのIDS表を優先順位つきで畳む。**1字につき「主の分解」1つ＋「別の分解」**を持つ。
//
//   1. BabelStone を土台にする(全97,680字・字源タグつき)
//   2. 穴(＝拡張Jの全字＋他の表が分解を持たない字)を CHISE で埋める
//   3. KANJIDIC2 収録字だけ CJKVI の日本字体で上書きする(従来の検索結果を変えない)
//   4. どの表にも無い字(部首補助 ⺼⺻…・互換漢字 U+F900〜)を CJKVI で拾う
//
// **別の分解も捨てずに持つ**。同じ字でも表によって切り方が違う
// (丟 = ⿱一去 / ⿱王厶、亦 = ⿱亠④ / ⿱亠⿻⿰丿亅八)。どちらで思い浮かべるかは
// 人によるので、片方しか持たないと「その組み合わせでは引けない字」ができる。
// 部品の集合が主と違うものだけを控える(切り方だけ違うものは検索結果が同じなので要らない)。
//
// **穴あきの分解(①②③…・？)は主に選ばない**。CJKVI には「前の行の部品」を数字で
// 指す行があり、そのまま入れると 不=⿱一③ のように**打てない部品**が入って
// 部品検索から漏れる。優先順位の1番めが穴あきだった965字のうち451字は
// 別の表の分解で置き換えられ、残る514字はどの表にも穴の無い分解が無い
// (そもそも分解できない基本字が大半)。
//
// CHISE と CJKVI は GPLv2 なので、mode="babelstone" では両方使わない。
// 字そのものは残るが拡張J 4,298字の分解が落ちる(構造検索に出なくなる)。
import { loadBabelStone, loadChise, loadCjkvi } from "./ids-sources.mts";
import { COMPAT_BLOCKS } from "../../../core/data/blocks.ts";
import { norm } from "../../../core/ids/normalize.ts";

export type IdsMode = "mixed" | "babelstone";

export interface MergeResult {
  /** 字 -> 主の分解("" = 分解なし) */
  ids: Map<string, string>;
  /** 字 -> 別の分解(主と部品の集合が違うものだけ。多くても2つ) */
  alt: Map<string, string[]>;
  log: string[];
}

/** 1字につき控える別の分解の数。増やしても引ける字はほぼ増えず、辞書だけ太る */
const MAX_ALT = 2;

const isIDC = (c: string) => (c >= "⿰" && c <= "⿿") || c === "㇯";

/**
 * 打てる分解か。①②③…(CJKVI の「前の行の部品」参照)と ？(不明) が混じったものは
 * **その部品を誰も打てない**ので主には選ばない。
 */
function usable(ids: string | undefined): ids is string {
  if (!ids) return false;
  return ![...ids].some(
    (c) => c === "？" || c === "?" || (c >= "\u2460" && c <= "\u24ff"),
  );
}

/** 部品の集合(正規化して重複を落としたもの)。別の分解を残すかの判定に使う */
function leafKey(ids: string): string {
  return [...new Set([...ids].filter((c) => !isIDC(c)).map((c) => norm(c)))]
    .sort()
    .join("");
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

  const chise = mode === "babelstone" ? new Map<string, string>() : loadChise();
  const cj = mode === "babelstone" ? new Map<string, string>() : loadCjkvi();
  if (mode !== "babelstone") {
    log.push(`CHISE IDS: ${chise.size}`);
    log.push(`CJKVI IDS: ${cj.size}`);
  }

  const ids = new Map<string, string>();
  const alt = new Map<string, string[]>();
  const stat = { rescued: 0, stillHoley: 0, withAlt: 0, altTotal: 0 };

  for (const ch of new Set([...bs.keys(), ...chise.keys(), ...cj.keys()])) {
    // 優先順位。KANJIDIC2 収録字は日本字体(CJKVI)を先に見る
    const order = kanjidic.has(ch)
      ? [cj.get(ch), bs.get(ch), chise.get(ch)]
      : [bs.get(ch), chise.get(ch), cj.get(ch)];
    const primary = order.find(usable) ?? order.find((v) => v) ?? "";
    ids.set(ch, primary);
    if (!usable(primary)) {
      if (primary) stat.stillHoley++;
    } else if (!usable(order[0]) && order[0]) {
      stat.rescued++; // 穴あきだった主を、別の表の分解で置き換えた字
    }

    if (!primary) continue;
    const keys = new Set([leafKey(primary)]);
    const others: string[] = [];
    for (const v of order) {
      if (!usable(v) || v === primary || others.length >= MAX_ALT) continue;
      const k = leafKey(v);
      if (keys.has(k)) continue; // 部品が同じなら引ける字は変わらない
      keys.add(k);
      others.push(v);
    }
    if (others.length) {
      alt.set(ch, others);
      stat.withAlt++;
      stat.altTotal += others.length;
    }
  }

  log.push(
    `穴あきの分解(①②③・？)を別の表で置き換え: ${stat.rescued} 字 / 置き換えられず残った: ${stat.stillHoley} 字`,
  );
  log.push(
    `別の分解を控えた字: ${stat.withAlt} (${stat.altTotal} 件)。どの組み合わせで打っても引けるようにするため`,
  );

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
        const a = alt.get(canonical);
        if (a) alt.set(ch, a);
        viaNFC++;
      }
    }
  }
  log.push(`統合後: ${ids.size} (互換漢字をNFC経由で補完: ${viaNFC})`);

  return { ids, alt, log };
}
