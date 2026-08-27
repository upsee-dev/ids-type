// カタチ入力の検索エンジン。
// 入力(かたちコード＋部品) → 候補漢字。辞書の持ち方と検索アルゴリズムだけを置く。
// 操作子の定義・字形の正規化・IDSの構文解析は core/ids/、
// ブロック表と部品パレットは core/data/ に分けてある。
import { CODE2IDC, isIDC, readableIds } from "./ids/operators.ts";
import { norm, SOFT } from "./ids/normalize.ts";
import { parseNodes, toTokens, WILD, type Node } from "./ids/parse.ts";
import { ALL_BLOCKS, blockOf, type Block } from "./data/blocks.ts";
import type {
  CharMeta,
  ListPage,
  ListQuery,
  RawData,
  Result,
} from "./data/types.ts";

/**
 * 候補の並び順。設定で選べる。
 *
 * **どの並びでも、打ったものと完全一致する字は必ず先頭**(Engine#score /
 * Engine#codeKey)。「〈左右〉日月」と組んだのに 明 が候補の奥にある、
 * のような並びにはならない。違うのは**そのあとの並べ方**だけ。
 *
 * unicode … 既定。あとは**符号位置(Unicode)の順**にただ並べる。打ち直しても
 *           同じ字が同じ場所に出るので、「さっき見かけた字」を探し直しやすい
 * common  … 学年 → 使用頻度の順。ふだんの文章で使う字を先に出したいとき
 * near    … 打ったかたちに近い順。**打った部品のほかに余分な部品が少ない字**を
 *           先に出す。珍しい1字を狙って出すときはこれがいちばん速い
 *
 * 「近い」の物差しは Engine#leafCount(再帰的に展開したときの部品の数)。
 * 学年や頻度と違って**拡張漢字9万字にもある**情報なので、10万字ぜんぶを
 * 同じ土俵で並べられる。
 */
export const SORT_MODES = [
  {
    key: "unicode",
    label: "符号位置順",
    note: "打った形そのままの字を先頭に、あとは符号位置の順。並びが動かない",
  },
  {
    key: "common",
    label: "よく使う順",
    note: "学年・使用頻度の高い字から。ふだんの文章で使う字を出すとき",
  },
  {
    key: "near",
    label: "かたちが近い順",
    note: "打った形に余分の少ない字から。珍しい字を狙って出すとき",
  },
] as const;

export type SortMode = (typeof SORT_MODES)[number]["key"];

export const DEFAULT_SORT: SortMode = "unicode";

/**
 * 完全一致の下駄。**打ったものそのままの字はどの並びでも必ず先頭**に来るよう、
 * 残り(学年300,000＋頻度27,000＋拡張2,000,000)を全部足したより大きく取る。
 * ここが小さいと、ぴったりの字が拡張漢字だったときに拡張の下駄で沈む。
 */
const EXACT_STEP = 3000000;

/** 拡張漢字(KANJIDIC2 に無い字)の下駄。日本語入力なので日本の漢字の後ろへ */
const EXT_STEP = 2000000;

/**
 * 「符号位置順」の段(完全一致→日本の漢字→拡張漢字)1つぶんの重み。
 * 符号位置の最大 0x10FFFF(1,114,111)より大きくして、段が混ざらないようにする。
 */
const CP_STEP = 2000000;

/** 「近い順」で余分な部品1つぶんの重み。素点の最大(5,327,000)より大きくする */
const NEAR_STEP = 10000000;

/** 余分の数え上げの頭打ち。Kotlin/Swift 側の Int32 を溢れさせないため */
const NEAR_MAX = 99;

export class Engine {
  private chars = new Map<string, CharMeta>();
  private decompMap = new Map<string, string>(); // 全分解(候補字+部品)
  private treeCache = new Map<string, Node | null>();
  private closureCache = new Map<string, Set<string>>();
  private leafCountCache = new Map<string, number>();

  /**
   * 直前の検索の**全件**。ページ送りのために覚えておく。
   *
   * 候補はページに分けて全部見せるが、1ページめくるたびに10万字を走査し直すと
   * 数十〜数百ms かかって「めくる」感じにならない。入力と並び順が同じあいだは、
   * 切り出す位置を変えるだけで返す。持つのは1件だけ(直前の検索)。
   */
  private lastKey = "";
  private lastAll: Result[] = [];
  private lastMode = "empty";

  constructor(raw: RawData) {
    for (const [
      ch,
      [ids, grade, freq, on, kun, strokes, rad, meaning],
    ] of Object.entries(raw.chars)) {
      this.chars.set(ch, {
        ids,
        grade,
        freq,
        on,
        kun,
        // 旧形式の辞書(5要素)でも動くように既定値を入れる
        strokes: strokes ?? 0,
        rad: rad ?? 0,
        meaning: meaning ?? "",
        ext: false,
      });
      if (ids) this.decompMap.set(ch, ids);
    }
    // ext も検索候補。chars のあとに入れるので、同点のときは KANJIDIC2 側が先に並ぶ
    for (const [ch, ids] of Object.entries(raw.ext ?? {})) {
      if (this.chars.has(ch)) continue;
      this.chars.set(ch, {
        ids,
        grade: 0,
        freq: 0,
        on: "",
        kun: "",
        strokes: 0,
        rad: 0,
        meaning: "",
        ext: true,
      });
      if (ids) this.decompMap.set(ch, ids);
    }
    for (const [ch, ids] of Object.entries(raw.parts))
      this.decompMap.set(ch, ids);
  }

  tree(ch: string): Node | null {
    if (this.treeCache.has(ch)) return this.treeCache.get(ch)!;
    const ids = this.decompMap.get(ch);
    const t = ids ? (parseNodes(toTokens(ids))[0] ?? null) : null;
    this.treeCache.set(ch, t);
    return t;
  }

  // 字の再帰部品閉包(自身+全部品、正規化+弱い同一視も追加)
  closure(ch: string): Set<string> {
    const c = norm(ch);
    const hit = this.closureCache.get(c);
    if (hit) return hit;
    const set = new Set<string>();
    this.closureCache.set(c, set); // 循環ガード(先に登録)
    const add = (x: string) => {
      const n = norm(x);
      if (!set.has(n)) {
        set.add(n);
        for (const s of this.subClosure(n)) set.add(s);
      }
      const soft = SOFT.get(n);
      if (soft) set.add(soft);
    };
    add(c);
    return set;
  }

  private subClosure(ch: string): Set<string> {
    const ids = this.decompMap.get(ch);
    const out = new Set<string>();
    if (!ids) return out;
    for (const t of toTokens(ids)) {
      if (isIDC(t)) continue;
      const n = norm(t);
      if (n === ch) continue;
      for (const s of this.closure(n)) out.add(s);
    }
    return out;
  }

  private closureOfNode(n: Node): Set<string> {
    if (typeof n === "string") return n === WILD ? new Set() : this.closure(n);
    const out = new Set<string>();
    for (const k of n.kids) for (const s of this.closureOfNode(k)) out.add(s);
    return out;
  }

  // 構造マッチ: 2=完全一致, 1=包含マッチ, 0=不一致
  private match(q: Node, c: Node, depth = 0): number {
    if (depth > 12) return 0;
    if (typeof q === "string") {
      if (q === WILD) return 2;
      if (typeof c === "string") {
        if (q === c) return 2;
        const soft = SOFT.get(q) === c || SOFT.get(c) === q;
        if (soft) return 1;
        return this.closure(c).has(q) ? 1 : 0;
      }
      return this.closureOfNode(c).has(q) ? 1 : 0;
    }
    if (typeof c === "string") {
      const sub = this.tree(c); // 葉を展開して再帰(例: 果 → ⿱田木)
      if (!sub || typeof sub === "string") return 0;
      const m = this.match(q, sub, depth + 1);
      return m ? 1 : 0;
    }
    if (q.op !== c.op || q.kids.length !== c.kids.length) return 0;
    let best = 2;
    for (let i = 0; i < q.kids.length; i++) {
      const m = this.match(q.kids[i], c.kids[i], depth + 1);
      if (!m) return 0;
      best = Math.min(best, m);
    }
    return best;
  }

  // 入力文字列: 2文字コード(LR等)・IDC・部品(漢字)・? ワイルドカード混在
  static compile(input: string): string {
    let out = "";
    const cs = [...input];
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      if (/\s/.test(c)) continue;
      if (
        c === "?" ||
        c === "？" ||
        c === "_" ||
        c === "＿" ||
        c === "＊" ||
        c === "*"
      ) {
        out += WILD;
        continue;
      }
      if (/[A-Za-z]/.test(c)) {
        const pair = (c + (cs[i + 1] ?? "")).toUpperCase();
        const idc = CODE2IDC.get(pair);
        if (idc) {
          out += idc;
          i++;
        }
        continue; // コードでない英字は無視
      }
      out += c;
    }
    return out;
  }

  /**
   * 候補を1ページぶん返す。`total` は絞り込みの全件数で、UI はこれを見て
   * ページを分ける(offset を動かして次のページを取る)。
   */
  search(
    input: string,
    limit = 200,
    sort: SortMode = DEFAULT_SORT,
    offset = 0,
  ): { results: Result[]; mode: string; total: number } {
    const compiled = Engine.compile(input);
    if (!compiled) return { results: [], mode: "empty", total: 0 };
    const key = `${compiled}\u0000${sort}`;
    if (key !== this.lastKey) {
      const found = this.searchAll(compiled, sort);
      this.lastKey = key;
      this.lastAll = found.results;
      this.lastMode = found.mode;
    }
    const from = Math.max(0, offset);
    return {
      results: this.lastAll.slice(from, from + limit),
      mode: this.lastMode,
      total: this.lastAll.length,
    };
  }

  /** 絞り込みの本体。全件を並べ替えて返す(切り出しは search がやる) */
  private searchAll(
    compiled: string,
    sort: SortMode,
  ): { results: Result[]; mode: string } {
    const nodes = parseNodes(toTokens(compiled));
    if (!nodes.length) return { results: [], mode: "empty" };

    const results: Result[] = [];
    const first = nodes[0];

    if (typeof first !== "string") {
      // 構造検索
      for (const [ch, meta] of this.chars) {
        const t = this.tree(ch);
        if (!t || typeof t === "string") continue;
        const m = this.match(first, t);
        if (m) results.push({ ch, exact: m === 2, meta });
      }
      const asked = this.askedLeaves(first);
      results.sort(
        (a, b) => this.sortKey(a, sort, asked) - this.sortKey(b, sort, asked),
      );
      return { results, mode: "structure" };
    }

    // 部品包含検索(操作子なし)
    const tokens = nodes.filter(
      (n) => typeof n === "string" && n !== WILD,
    ) as string[];
    if (!tokens.length) return { results: [], mode: "empty" };
    // 打った部品そのものの字(「木」→ 木)も候補に入れる。**それが完全一致**なので、
    // 除いてしまうと「打ったものと同じ字を先頭に」が成り立たない
    const want = tokens.map(norm);
    for (const [ch, meta] of this.chars) {
      const cl = this.closure(ch);
      if (!tokens.every((t) => cl.has(t))) continue;
      results.push({ ch, exact: this.madeOfExactly(ch, want), meta });
    }
    const asked = tokens.reduce((n, t) => n + this.leafCount(t), 0);
    results.sort(
      (a, b) => this.sortKey(a, sort, asked) - this.sortKey(b, sort, asked),
    );
    return { results, mode: "parts" };
  }

  /**
   * 打った部品**だけ**でできている字か(並ぶ順番は問わない)。
   * 例: 「木」→ 木そのもの、「木木」→ 林(⿰木木)。呆(⿱口木)は口が余るので違う。
   *
   * 操作子なしで打ったときの「完全一致」の見分け方。当たった字は候補の先頭へ出す。
   */
  private madeOfExactly(ch: string, want: string[]): boolean {
    if (want.length === 1 && norm(ch) === want[0]) return true;
    const ids = this.decompMap.get(ch);
    if (!ids) return false;
    const parts = toTokens(ids)
      .filter((t) => !isIDC(t))
      .map(norm)
      .sort();
    if (parts.length !== want.length) return false;
    const sorted = [...want].sort();
    return parts.every((p, i) => p === sorted[i]);
  }

  /**
   * 並べ替えの鍵。「符号位置順」は符号位置そのまま、「よく使う順」は素点そのまま、
   * 「かたちが近い順」は**打った部品のほかに余分な部品がいくつあるか**を先に見て、
   * 同じ数のなかを素点で並べる(＝同じくらい近い字なら、よく使う字が先)。
   */
  private sortKey(r: Result, sort: SortMode, asked: number): number {
    if (sort === "unicode") return this.codeKey(r);
    const s = this.score(r);
    if (sort !== "near") return s;
    const extra = Math.min(NEAR_MAX, Math.max(0, this.leafCount(r.ch) - asked));
    return extra * NEAR_STEP + s;
  }

  /**
   * 「符号位置順」の鍵。**完全一致 → 日本の漢字 → 拡張漢字**の3段に分け、
   * 段の中を符号位置(Unicode)で並べる。
   *
   * 段を分けずに符号位置だけで並べると、拡張A(U+3400〜)が統合漢字(U+4E00〜)より
   * 前に来て、木を打つと 林 の前に見たこともない字が数百字並ぶ。日本語入力として
   * 使いものにならないので、「拡張漢字は日本の漢字の後ろ」は符号位置順でも守る。
   */
  private codeKey(r: Result): number {
    const rank = (r.exact ? 0 : 2) + (r.meta.ext ? 1 : 0);
    return rank * CP_STEP + r.ch.codePointAt(0)!;
  }

  /** 入力が求めている部品の数。? は数えない(埋まるぶんは「余分」として効く) */
  private askedLeaves(n: Node): number {
    if (typeof n === "string") return n === WILD ? 0 : this.leafCount(n);
    let k = 0;
    for (const c of n.kids) k += this.askedLeaves(c);
    return k;
  }

  /**
   * 再帰的に展開したときの部品(葉)の数＝字の複雑さ。「近い順」の物差し。
   * 分解を持たない字は1つ。循環しても止まるよう、先に1を入れてから数える。
   *
   * 学年や頻度と違って**拡張漢字9万字にもある**情報なので、10万字ぜんぶを
   * 同じ土俵で並べられる。並び順の検算に使えるよう公開している。
   */
  leafCount(ch: string, depth = 0): number {
    const c = norm(ch);
    const hit = this.leafCountCache.get(c);
    if (hit !== undefined) return hit;
    const ids = this.decompMap.get(c);
    if (!ids) {
      this.leafCountCache.set(c, 1);
      return 1;
    }
    if (depth > 12) return 1; // 深さ依存なので覚えない
    this.leafCountCache.set(c, 1); // 循環ガード(先に登録)
    let n = 0;
    for (const t of toTokens(ids)) {
      if (isIDC(t)) continue;
      const k = norm(t);
      n += k === c ? 1 : this.leafCount(k, depth + 1);
    }
    const v = n || 1;
    this.leafCountCache.set(c, v);
    return v;
  }

  private score(r: Result): number {
    // 完全一致(打ったものそのままの字)が最上位の鍵。拡張漢字の下駄より大きいので、
    // ぴったりの字が拡張漢字でも候補の先頭に出る
    let s = r.exact ? 0 : EXACT_STEP;
    const g = r.meta.grade;
    s +=
      (g >= 1 && g <= 6 ? g : g === 8 ? 7 : g === 9 || g === 10 ? 8 : 10) *
      30000;
    s += r.meta.freq ? r.meta.freq * 10 : 27000;
    // 日本語入力なので、KANJIDIC2 に無い字(拡張A〜J ほか9万字)は必ず日本の漢字の後ろへ。
    // 学年・頻度の最大(300,000+27,000)より大きい下駄を履かせて確実に分離する
    if (r.meta.ext) s += EXT_STEP;
    return s;
  }

  meta(ch: string): CharMeta | undefined {
    return this.chars.get(ch);
  }

  // 表示用: 1段ずつ分解を展開した文字列リスト(例: 課 → [⿰言果, 果=⿱田木])
  decompose(ch: string, maxLines = 6): string[] {
    const lines: string[] = [];
    const seen = new Set<string>([ch]);
    const queue = [ch];
    while (queue.length && lines.length < maxLines) {
      const c = queue.shift()!;
      const ids = this.decompMap.get(c);
      if (!ids || ids === c) continue;
      lines.push(`${c} = ${readableIds(ids)}`);
      for (const t of toTokens(ids)) {
        if (isIDC(t) || seen.has(t)) continue;
        seen.add(t);
        if (this.decompMap.has(t)) queue.push(t);
      }
    }
    return lines;
  }

  get size(): number {
    return this.chars.size;
  }

  // ---- 収録字の一覧・絞り込み ----

  /** 収録字をコードポイント順に並べた配列(一覧表示の土台。初回だけ作る) */
  private orderCache: string[] | null = null;
  private order(): string[] {
    if (!this.orderCache) {
      this.orderCache = [...this.chars.keys()].sort(
        (a, b) => a.codePointAt(0)! - b.codePointAt(0)!,
      );
    }
    return this.orderCache;
  }

  /** ブロックごとの収録字数(一覧のタブに出す) */
  blockCounts(): { block: Block; count: number }[] {
    if (!this.blockCountCache) {
      const n = new Map<string, number>();
      for (const ch of this.chars.keys()) {
        const b = blockOf(ch);
        if (b) n.set(b.key, (n.get(b.key) ?? 0) + 1);
      }
      this.blockCountCache = ALL_BLOCKS.map((block) => ({
        block,
        count: n.get(block.key) ?? 0,
      })).filter((x) => x.count > 0);
    }
    return this.blockCountCache;
  }
  private blockCountCache: { block: Block; count: number }[] | null = null;

  /**
   * 一覧の絞り込み。query は入力欄と同じ書き方(LR木木 / 木 / ?)に加えて、
   * かな(読み)と U+XXXX・16進(コードポイント)も受け付ける。
   */
  list(q: ListQuery = {}): ListPage {
    const { block, jaOnly = false, offset = 0, limit = 200 } = q;
    const query = (q.query ?? "").trim();

    let pool: string[];
    let mode = "all";
    if (query) {
      const kind = queryKind(query);
      mode = kind;
      if (kind === "code") {
        const cp = parseInt(query.replace(/^u\+/i, ""), 16);
        const ch = Number.isFinite(cp) ? safeFromCodePoint(cp) : "";
        pool = ch && this.chars.has(ch) ? [ch] : [];
      } else if (kind === "reading") {
        const kana = toHiragana(query);
        pool = this.order().filter((ch) => {
          const m = this.chars.get(ch)!;
          if (!m.on && !m.kun) return false;
          return toHiragana(`${m.on} ${m.kun}`.replace(/[.\-]/g, "")).includes(
            kana,
          );
        });
      } else {
        // 構造・部品検索は search() をそのまま使う(スコア順が保たれる)
        pool = this.search(query, Number.MAX_SAFE_INTEGER).results.map(
          (r) => r.ch,
        );
      }
    } else {
      pool = this.order();
    }

    const b = block ? ALL_BLOCKS.find((x) => x.key === block) : undefined;
    const filtered = pool.filter((ch) => {
      const m = this.chars.get(ch)!;
      if (jaOnly && m.ext) return false;
      if (b) {
        const cp = ch.codePointAt(0)!;
        if (cp < b.lo || cp > b.hi) return false;
      }
      return true;
    });

    return {
      total: filtered.length,
      mode,
      items: filtered
        .slice(offset, offset + limit)
        .map((ch) => ({ ch, meta: this.chars.get(ch)! })),
    };
  }
}

const KANA = /^[ぁ-ゖァ-ヺーｰ゙-゜\s]+$/;
const CODE = /^(?:u\+)?[0-9a-f]{4,6}$/i;

function queryKind(q: string): string {
  if (CODE.test(q)) return "code";
  if (KANA.test(q)) return "reading";
  return Engine.compile(q).length && [...Engine.compile(q)].some(isIDC)
    ? "structure"
    : "parts";
}

/** カタカナ→ひらがな。音(カタカナ)と訓(ひらがな)をまとめて引けるようにする */
function toHiragana(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0x60),
  );
}

function safeFromCodePoint(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
}
