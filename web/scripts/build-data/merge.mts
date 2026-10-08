// 3つのIDS表を優先順位つきで畳む。**1字につき「主の分解」1つ＋「別の分解」**を持つ。
//
//   1. BabelStone を土台にする(全97,680字・字源タグつき)
//   2. 穴(＝拡張Jの全字＋他の表が分解を持たない字)を CHISE で埋める
//   3. KANJIDIC2 収録字だけ CJKVI の日本字体で上書きする(従来の検索結果を変えない)
//   4. どの表にも無い字(部首補助 ⺼⺻…・互換漢字 U+F900〜)を CJKVI で拾う
//   5. どの表にもまだ無い新しい字(Unicode 18.0 の U+2B81E)を supplement で足す
//
// **別の分解も捨てずに持つ**。同じ字でも表によって切り方が違う
// (丟 = ⿱一去 / ⿱王厶、亦 = ⿱亠④ / ⿱亠⿻⿰丿亅八)。どちらで思い浮かべるかは
// 人によるので、片方しか持たないと「その組み合わせでは引けない字」ができる。
// 部品の集合が主と違うものだけを控える(切り方だけ違うものは検索結果が同じなので要らない)。
//
// **穴あきの分解(①②③…・？)は主に選ばない**。①②③… は CJKVI が Unicode に無い
// 部品に振った仮の番号で、同じ ⑤ でも 即(左)・其(上)・段(左) で形が違う。
// そのまま入れると 不=⿱一③ のように**打てない部品**が入って部品検索から漏れる。
// どの表にも穴の無い分解が無いときは、BabelStone の私用領域の部品(即=⿰U+F2B4卩)を
// 使う分解を選ぶ。打てないのは同じだが、同梱フォント(KatachiPUA)で**形を描ける**。
//
// CHISE と CJKVI は GPLv2 なので、mode="babelstone" では両方使わない。
// 字そのものは残るが拡張J 4,298字の分解が落ちる(構造検索に出なくなる)。
import { isPua, loadBabelStone, loadChise, loadCjkvi } from "./ids-sources.mts";
import { supplementIds } from "./supplement.mts";
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

/** 形の分からない穴。①②③…(CJKVI が Unicode に無い部品に振った字ごとの仮番号)と ？(不明) */
const isHole = (c: string) =>
  c === "？" || c === "?" || (c >= "\u2460" && c <= "\u24ff");

/**
 * 打てる分解か。穴(①②③…・？)や私用領域の部品が混じったものは
 * **その部品を誰も打てない**ので主には選ばない。
 */
function usable(ids: string | undefined): ids is string {
  if (!ids) return false;
  return ![...ids].some((c) => isHole(c) || isPua(c));
}

/**
 * 形を見せられる分解か。私用領域の部品(BabelStone の未符号化部品)は打てないが、
 * 同梱フォントで描けるので、①②③…・？ が残る分解よりは主に向く
 */
function drawable(ids: string | undefined): ids is string {
  if (!ids) return false;
  return ![...ids].some(isHole);
}

/**
 * 打てる部品の集合(正規化して重複を落としたもの)。別の分解を残すかの判定に使う。
 * 穴と私用領域の部品は打てないので数えない(⿰⑤卩 と ⿰U+F2B4卩 は引ける字が同じ)
 */
function leafKey(ids: string): string {
  const leaves = [...ids].filter((c) => !isIDC(c) && !isHole(c) && !isPua(c));
  return [...new Set(leaves.map((c) => norm(c)))]
    .sort()
    .join("");
}

export function mergeIds(
  kanjidic: Map<string, unknown>,
  mode: IdsMode = "mixed",
): MergeResult {
  const log: string[] = [];

  const { ids: bs, displaced: bsDisplaced } = loadBabelStone();
  log.push(
    `BabelStone IDS: ${bs.size} (分解あり ${[...bs.values()].filter(Boolean).length})`,
  );

  const chise = mode === "babelstone" ? new Map<string, string>() : loadChise();
  const cj = mode === "babelstone" ? new Map<string, string>() : loadCjkvi();
  if (mode !== "babelstone") {
    log.push(`CHISE IDS: ${chise.size}`);
    log.push(`CJKVI IDS: ${cj.size}`);
  }

  // 上流がまだ持っていない字(supplement.mts)。優先順位はいちばん下に置くので、
  // 上流の表が追いついたらこちらは自動的に使われなくなる
  const extra = supplementIds();

  const ids = new Map<string, string>();
  const alt = new Map<string, string[]>();
  const stat = { rescued: 0, drawn: 0, stillHoley: 0, withAlt: 0, altTotal: 0 };

  for (const ch of new Set([
    ...bs.keys(),
    ...chise.keys(),
    ...cj.keys(),
    ...extra.keys(),
  ])) {
    // 優先順位。KANJIDIC2 収録字は日本字体(CJKVI)を先に見る
    const order = kanjidic.has(ch)
      ? [cj.get(ch), bs.get(ch), chise.get(ch), extra.get(ch)]
      : [bs.get(ch), chise.get(ch), cj.get(ch), extra.get(ch)];
    // 形の分かる分解が無ければ穴あきのまま主にする。BabelStone が「これ以上分けない字」と
    // している字(幺 = ^幺$)でも分解なしにはしない。部品検索は主の分解をたどって
    // 中の部品を見るので、幺 = ⿰②丶 を消すと 幺 を含む字(胤 など)が 丶 で引けなくなる
    const primary =
      order.find(usable) ?? order.find(drawable) ?? order.find((v) => v) ?? "";
    ids.set(ch, primary);
    if (drawable(primary) && !usable(primary)) {
      stat.drawn++; // 打てない部品はあるが、形は同梱フォントで見せられる字
    } else if (!usable(primary)) {
      if (primary) stat.stillHoley++;
    } else if (!usable(order[0]) && order[0]) {
      stat.rescued++; // 穴あきだった主を、別の表の分解で置き換えた字
    }

    const keys = new Set([leafKey(primary)]);
    const others: string[] = [];
    const first = order.find((v) => v);
    for (const v of [...order, bsDisplaced.get(ch)]) {
      // 穴あきの分解も、主が穴あきのとき・優先順位で先頭の分解(別の表で置き換える前の主)・
      // BabelStone が穴の少ない分解を選ぶ前の分解のときは控える。元の表の切り方にしか無い
      // 部品で引けるようにするため(其 = ⿱⿱⑤一八 の 一、𩡧 = ⿹？卌 の 卌)
      const candidate =
        usable(v) ||
        (!!v && (!usable(primary) || v === first || v === bsDisplaced.get(ch)));
      if (!candidate || v === primary || others.length >= MAX_ALT) continue;
      const k = leafKey(v);
      if (!k || keys.has(k)) continue; // 部品が同じなら引ける字は変わらない
      keys.add(k);
      others.push(v);
    }
    if (others.length) {
      alt.set(ch, others);
      stat.withAlt++;
      stat.altTotal += others.length;
    }
  }

  const bySupplement = [...extra.keys()].filter(
    (ch) => !bs.get(ch) && !chise.get(ch) && !cj.get(ch),
  );
  if (bySupplement.length) {
    log.push(
      `上流にまだ無い字を supplement.mts で補完: ${bySupplement.length} 字 (${bySupplement.join("")})`,
    );
  }
  log.push(
    `穴あきの分解(①②③・？)を別の表で置き換え: ${stat.rescued} 字 / ` +
      `私用領域の部品で形を描ける分解にした: ${stat.drawn} 字 / ①②③・？ が残った: ${stat.stillHoley} 字`,
  );
  log.push(
    `別の分解を控えた字: ${stat.withAlt} (${stat.altTotal} 件)。どの組み合わせで打っても引けるようにするため`,
  );

  // 互換漢字は BabelStone にほぼ無い。統合漢字と正規等価なので NFC で解決した先の
  // IDS をそのまま借りる。zi.tools も互換漢字を独立した字として引けるので全部入れる。
  // 自前の分解が穴あき(既 U+FA42 = ⿰？旡)で、統合漢字のほうが穴が少ない
  // (既 = ⿰U+F2B4旡)ときも借りる。字形は同じ字なので形も合う
  const holeRank = (v: string) => (usable(v) ? 0 : drawable(v) ? 1 : 2);
  let viaNFC = 0;
  for (const { lo, hi } of COMPAT_BLOCKS) {
    for (let cp = lo; cp <= hi; cp++) {
      const ch = String.fromCodePoint(cp);
      const own = ids.get(ch);
      if (own && holeRank(own) === 0) continue;
      const canonical = ch.normalize("NFC");
      if (canonical === ch) continue; // 未割り当て or 統合漢字扱いの字
      const v = ids.get(canonical);
      if (!v && own !== undefined) continue;
      if (v !== undefined && (own === undefined || holeRank(v) < holeRank(own))) {
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
