// カタチ入力エンジン: IDS(空間関係)コード + 部品 → 漢字候補
// zi.tools (https://zi.tools/?secondary=ids) の入力方式を日本語向けに実装

// ---- 操作子コード <-> IDC (Ideographic Description Characters) ----
// zi.tools の2文字コード体系に準拠
export const OPERATORS: { code: string; idc: string; arity: number; label: string }[] = [
  { code: "LR", idc: "⿰", arity: 2, label: "左右" },
  { code: "LL", idc: "⿲", arity: 3, label: "左中右" },
  { code: "UD", idc: "⿱", arity: 2, label: "上下" },
  { code: "UU", idc: "⿳", arity: 3, label: "上中下" },
  { code: "RD", idc: "⿸", arity: 2, label: "左上かこみ" },
  { code: "RU", idc: "⿺", arity: 2, label: "左下かこみ" },
  { code: "LD", idc: "⿹", arity: 2, label: "右上かこみ" },
  { code: "LU", idc: "⿽", arity: 2, label: "右下かこみ" },
  { code: "OD", idc: "⿵", arity: 2, label: "上かこみ" },
  { code: "OR", idc: "⿷", arity: 2, label: "左かこみ" },
  { code: "OU", idc: "⿶", arity: 2, label: "下かこみ" },
  { code: "OL", idc: "⿼", arity: 2, label: "右かこみ" },
  { code: "OC", idc: "⿴", arity: 2, label: "全かこみ" },
  { code: "XX", idc: "⿻", arity: 2, label: "重なり" },
  { code: "MI", idc: "⿾", arity: 1, label: "鏡映" },
  { code: "RO", idc: "⿿", arity: 1, label: "回転" },
  { code: "SU", idc: "㇯", arity: 2, label: "除去" },
];

const CODE2IDC = new Map(OPERATORS.map(o => [o.code, o.idc]));
const IDC_ARITY = new Map(OPERATORS.map(o => [o.idc, o.arity]));

// よく使う操作子(スマホの1画面目に出す)。残りは「その他」に格納
export const PRIMARY_CODES = ["LR", "UD", "OC", "RD", "RU", "LD", "OD", "OU", "LL", "UU", "OR", "XX"];

// 操作子アイコンの図形定義(0..1座標)。Web=div, RN=View で同じ絵を描くための共有仕様。
// role 1/2/3 = 第1/第2/第3要素。複数の矩形で1つの要素(かこみのL字など)を表す。
export interface IconRect { x: number; y: number; w: number; h: number; role: 1 | 2 | 3 }

export const OPERATOR_ICON: Record<string, { rects?: IconRect[]; symbol?: string }> = {
  LR: { rects: [r(0, 0, 0.46, 1, 1), r(0.54, 0, 0.46, 1, 2)] },
  LL: { rects: [r(0, 0, 0.29, 1, 1), r(0.355, 0, 0.29, 1, 2), r(0.71, 0, 0.29, 1, 3)] },
  UD: { rects: [r(0, 0, 1, 0.46, 1), r(0, 0.54, 1, 0.46, 2)] },
  UU: { rects: [r(0, 0, 1, 0.29, 1), r(0, 0.355, 1, 0.29, 2), r(0, 0.71, 1, 0.29, 3)] },
  RD: { rects: [r(0, 0, 1, 0.28, 1), r(0, 0, 0.28, 1, 1), r(0.38, 0.38, 0.62, 0.62, 2)] },
  RU: { rects: [r(0, 0, 0.28, 1, 1), r(0, 0.72, 1, 0.28, 1), r(0.38, 0, 0.62, 0.62, 2)] },
  LD: { rects: [r(0, 0, 1, 0.28, 1), r(0.72, 0, 0.28, 1, 1), r(0, 0.38, 0.62, 0.62, 2)] },
  LU: { rects: [r(0.72, 0, 0.28, 1, 1), r(0, 0.72, 1, 0.28, 1), r(0, 0, 0.62, 0.62, 2)] },
  OD: { rects: [r(0, 0, 1, 0.26, 1), r(0, 0, 0.26, 1, 1), r(0.74, 0, 0.26, 1, 1), r(0.34, 0.36, 0.32, 0.64, 2)] },
  OR: { rects: [r(0, 0, 0.26, 1, 1), r(0, 0, 1, 0.26, 1), r(0, 0.74, 1, 0.26, 1), r(0.36, 0.34, 0.64, 0.32, 2)] },
  OU: { rects: [r(0, 0.74, 1, 0.26, 1), r(0, 0, 0.26, 1, 1), r(0.74, 0, 0.26, 1, 1), r(0.34, 0, 0.32, 0.64, 2)] },
  OL: { rects: [r(0.74, 0, 0.26, 1, 1), r(0, 0, 1, 0.26, 1), r(0, 0.74, 1, 0.26, 1), r(0, 0.34, 0.64, 0.32, 2)] },
  OC: {
    rects: [
      r(0, 0, 1, 0.24, 1), r(0, 0.76, 1, 0.24, 1), r(0, 0, 0.24, 1, 1), r(0.76, 0, 0.24, 1, 1),
      r(0.34, 0.34, 0.32, 0.32, 2),
    ],
  },
  XX: { rects: [r(0, 0.06, 0.7, 0.7, 1), r(0.3, 0.24, 0.7, 0.7, 2)] },
  MI: { symbol: "⇄" },
  RO: { symbol: "↻" },
  SU: { symbol: "−" },
};

function r(x: number, y: number, w: number, h: number, role: 1 | 2 | 3): IconRect {
  return { x, y, w, h, role };
}

// キーボードで打ちにくい部品(偏旁・冠・脚など単体では変換しにくいもの)
export const RADICAL_PALETTE = [
  "亻", "彳", "氵", "冫", "扌", "忄", "犭", "阝", "艹", "宀", "冖", "亠",
  "广", "疒", "辶", "廴", "勹", "匚", "凵", "冂", "卩", "厶", "又", "夂",
  "攵", "殳", "灬", "罒", "爫", "⺌", "衤", "礻", "癶", "疋", "隹", "頁",
  "臼", "屮", "幺", "廾", "弋", "彡", "彑", "巛", "尢", "无", "刂", "钅",
  "糹", "訁", "飠", "⺼", "斤", "皿", "缶", "耒", "聿", "虍", "豸", "赤",
  // 単独の筆画(IMEでは出せない)
  "丬", "丿", "乚", "亅", "乛", "丨", "㇉", "⺮", "几", "𠃌", "𠃍", "𠄌", "𠄎",
];

export function isIDC(c: string): boolean {
  return IDC_ARITY.has(c);
}

const IDC2LABEL = new Map(OPERATORS.map(o => [o.idc, o.label]));

/**
 * 分解の表示用。IDC文字(⿰⿱⿴…)はAndroid標準フォントなどでは豆腐(□)になるため、
 * 〈左右〉のような日本語ラベルに置き換える。
 */
export function readableIds(ids: string): string {
  return [...ids].map(c => (IDC2LABEL.has(c) ? `〈${IDC2LABEL.get(c)}〉` : c)).join("");
}

// ---- 字形バリアント正規化(強い同一視: 符号位置違いの同形部品) ----
const NORM = new Map(Object.entries({
  "⺼": "月", "⺾": "艹", "⻌": "辶", "⻍": "辶", "⻏": "阝", "⻖": "阝",
  "靑": "青", "飠": "食", "𩙿": "食", "訁": "言", "釒": "金", "糹": "糸",
  "⺬": "礻", "⺭": "礻", "⺿": "艹", "⻂": "衤", "⺡": "氵", "⺘": "扌",
  "⺖": "忄", "⺨": "犭", "⺣": "灬", "⻊": "足", "𤴔": "疋",
}));

// ---- 弱い同一視(独立字とその偏旁形): 閉包に正字も追加して両方でヒットさせる ----
const SOFT = new Map(Object.entries({
  "氵": "水", "扌": "手", "忄": "心", "犭": "犬", "灬": "火", "氺": "水",
  "礻": "示", "衤": "衣", "⺩": "玉", "王": "玉", "罒": "网", "⺌": "小",
  "亻": "人", "刂": "刀", "阝": "阜", "㣺": "心", "月": "肉",
}));

export function norm(c: string): string {
  return NORM.get(c) ?? c;
}

// 未符号化部品(CDP外字)のプレースホルダ ①②③… は検索キーにできない
const PLACEHOLDER = /[①-⓿]/;

// ---- IDS 構文木 ----
export type Node = string | { op: string; kids: Node[] }; // string "＊" = ワイルドカード
export const WILD = "＊";

function toTokens(s: string): string[] {
  return [...s];
}

function parseNodes(tokens: string[]): Node[] {
  let i = 0;
  const readNode = (): Node => {
    if (i >= tokens.length) return WILD;
    const t = tokens[i++];
    if (isIDC(t)) {
      const n = IDC_ARITY.get(t)!;
      const kids: Node[] = [];
      for (let k = 0; k < n; k++) kids.push(readNode());
      return canon({ op: t, kids });
    }
    return norm(t);
  };
  const nodes: Node[] = [];
  while (i < tokens.length) nodes.push(readNode());
  return nodes;
}

// ⿲abc → ⿰a⿰bc / ⿳abc → ⿱a⿱bc に正規化(構造の揺れを吸収)
function canon(n: { op: string; kids: Node[] }): Node {
  if (n.op === "⿲") return { op: "⿰", kids: [n.kids[0], { op: "⿰", kids: [n.kids[1], n.kids[2]] }] };
  if (n.op === "⿳") return { op: "⿱", kids: [n.kids[0], { op: "⿱", kids: [n.kids[1], n.kids[2]] }] };
  return n;
}

export interface CharMeta {
  ids: string;
  grade: number;
  freq: number;
  on: string;
  kun: string;
}

export interface Result {
  ch: string;
  exact: boolean;
  meta: CharMeta;
}

export interface RawData {
  chars: Record<string, [string, number, number, string, string]>;
  parts: Record<string, string>;
}

export class Engine {
  private chars = new Map<string, CharMeta>();
  private decompMap = new Map<string, string>(); // 全分解(候補字+部品)
  private treeCache = new Map<string, Node | null>();
  private closureCache = new Map<string, Set<string>>();

  constructor(raw: RawData) {
    for (const [ch, [ids, grade, freq, on, kun]] of Object.entries(raw.chars)) {
      this.chars.set(ch, { ids, grade, freq, on, kun });
      if (ids) this.decompMap.set(ch, ids);
    }
    for (const [ch, ids] of Object.entries(raw.parts)) this.decompMap.set(ch, ids);
  }

  tree(ch: string): Node | null {
    if (this.treeCache.has(ch)) return this.treeCache.get(ch)!;
    const ids = this.decompMap.get(ch);
    const t = ids ? parseNodes(toTokens(ids))[0] ?? null : null;
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
      if (c === "?" || c === "？" || c === "_" || c === "＿" || c === "＊" || c === "*") {
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
    const tokens = nodes.filter(n => typeof n === "string" && n !== WILD) as string[];
    if (!tokens.length) return { results: [], mode: "empty" };
    for (const [ch, meta] of this.chars) {
      if (tokens.length === 1 && ch === tokens[0]) continue; // 自分自身は除外
      const cl = this.closure(ch);
      if (tokens.every(t => cl.has(t))) results.push({ ch, exact: false, meta });
    }
    results.sort((a, b) => this.score(a) - this.score(b));
    return { results: results.slice(0, limit), mode: "parts" };
  }

  private score(r: Result): number {
    let s = r.exact ? 0 : 500000;
    const g = r.meta.grade;
    s += (g >= 1 && g <= 6 ? g : g === 8 ? 7 : g === 9 || g === 10 ? 8 : 10) * 30000;
    s += r.meta.freq ? r.meta.freq * 10 : 27000;
    return s;
  }

  meta(ch: string): CharMeta | undefined {
    return this.chars.get(ch);
  }

  // 辞書内で「何字の構成要素になっているか」の多い順に部品を返す。
  // スマホのオンスクリーン部品パレット用(OSキーボードで打てない部品もここから入る)。
  commonParts(limit = 150): string[] {
    if (!this.commonPartsCache) {
      const count = new Map<string, number>();
      for (const [ch, meta] of this.chars) {
        if (!meta.ids) continue;
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
}
