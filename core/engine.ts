// カタチ入力の検索エンジン。
// 入力(かたちコード＋部品) → 候補漢字。辞書の持ち方と検索アルゴリズムだけを置く。
// 操作子の定義・字形の正規化・IDSの構文解析は core/ids/、
// ブロック表と部品パレットは core/data/ に分けてある。
import { CODE2IDC, isIDC, readableIds } from "./ids/operators.ts";
import { norm, PLACEHOLDER, SOFT } from "./ids/normalize.ts";
import { parseNodes, toTokens, WILD, type Node } from "./ids/parse.ts";
import { ALL_BLOCKS, blockOf, type Block } from "./data/blocks.ts";
import type {
  CharMeta,
  ListPage,
  ListQuery,
  RawData,
  Result,
} from "./data/types.ts";

export class Engine {
  private chars = new Map<string, CharMeta>();
  private decompMap = new Map<string, string>(); // 全分解(候補字+部品)
  private treeCache = new Map<string, Node | null>();
  private closureCache = new Map<string, Set<string>>();

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

  search(input: string, limit = 200): { results: Result[]; mode: string } {
    const compiled = Engine.compile(input);
    if (!compiled) return { results: [], mode: "empty" };
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
      results.sort((a, b) => this.score(a) - this.score(b));
      return { results: results.slice(0, limit), mode: "structure" };
    }

    // 部品包含検索(操作子なし)
    const tokens = nodes.filter(
      (n) => typeof n === "string" && n !== WILD,
    ) as string[];
    if (!tokens.length) return { results: [], mode: "empty" };
    for (const [ch, meta] of this.chars) {
      if (tokens.length === 1 && ch === tokens[0]) continue; // 自分自身は除外
      const cl = this.closure(ch);
      if (tokens.every((t) => cl.has(t)))
        results.push({ ch, exact: false, meta });
    }
    results.sort((a, b) => this.score(a) - this.score(b));
    return { results: results.slice(0, limit), mode: "parts" };
  }

  private score(r: Result): number {
    let s = r.exact ? 0 : 500000;
    const g = r.meta.grade;
    s +=
      (g >= 1 && g <= 6 ? g : g === 8 ? 7 : g === 9 || g === 10 ? 8 : 10) *
      30000;
    s += r.meta.freq ? r.meta.freq * 10 : 27000;
    // 日本語入力なので、KANJIDIC2 に無い字(拡張A〜J ほか9万字)は必ず日本の漢字の後ろへ。
    // 素点の最大(500000+300000+27000)より大きい下駄を履かせて確実に分離する
    if (r.meta.ext) s += 2000000;
    return s;
  }

  meta(ch: string): CharMeta | undefined {
    return this.chars.get(ch);
  }

  // 辞書内で「何字の構成要素になっているか」の多い順に部品を返す。
  // スマホのオンスクリーン部品パレット用(OSキーボードで打てない部品もここから入る)。
  // 数えるのは KANJIDIC2 収録字だけ。拡張漢字9万字まで数えると簡体字の部品が
  // 上位を占めてしまい、日本語入力のパレットとして使いものにならなくなる。
  commonParts(limit = 150): string[] {
    if (!this.commonPartsCache) {
      const count = new Map<string, number>();
      for (const [ch, meta] of this.chars) {
        if (!meta.ids || meta.ext) continue;
        for (const t of toTokens(meta.ids)) {
          if (isIDC(t) || t === ch || PLACEHOLDER.test(t)) continue;
          count.set(t, (count.get(t) ?? 0) + 1);
        }
      }
      this.commonPartsCache = [...count]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([ch]) => ch);
    }
    return this.commonPartsCache.slice(0, limit);
  }

  private commonPartsCache: string[] | null = null;

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
