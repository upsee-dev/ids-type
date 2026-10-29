import { normalizedReading, preferredExactKun } from "./reading-priority.ts";

/** Stable category IDs and bit positions shared by the generated dictionary and native IMEs. */
export const JAPANESE_CATEGORIES = [
  { id: "common", label: "日本語でよく使われる語" },
  { id: "name", label: "人名・人名用字" },
  { id: "place", label: "地名・地名用字" },
  { id: "kokuji", label: "国字" },
  { id: "symbol", label: "記号" },
  { id: "ketsuren", label: "欠画連綿詞" },
  { id: "jukujikun", label: "熟字訓・義訓" },
  { id: "kanji", label: "その他の漢字" },
  { id: "plant", label: "植物" },
  { id: "mineral", label: "鉱物" },
  { id: "animal", label: "動物" },
  { id: "bird", label: "鳥類" },
  { id: "insect", label: "虫類" },
  { id: "fish", label: "魚類" },
  { id: "algae", label: "藻類" },
] as const;
export type JapaneseCategory = typeof JAPANESE_CATEGORIES[number]["id"];
export const JAPANESE_ORDER_KEY = "katachi.japaneseOrder.v1";
export const FOREIGN_READING_KEY = "katachi.foreignReadings.v1";
export const FOREIGN_READING_LANGUAGES = [
  { id: "ko", label: "韓国語", shortLabel: "韓国語" },
  { id: "zh", label: "中国語（普通話）", shortLabel: "中国語" },
  { id: "vi", label: "越南（ベトナム語）", shortLabel: "越南語" },
  { id: "tw", label: "台湾語（閩南語）", shortLabel: "台湾語" },
] as const;
export type ForeignReadingLanguage = typeof FOREIGN_READING_LANGUAGES[number]["id"];
/** Opt in only. Absent, malformed and unknown values must never enable a language. */
export function normalizeForeignReadings(value: unknown): ForeignReadingLanguage[] {
  return FOREIGN_READING_LANGUAGES.filter(l => Array.isArray(value) && value.includes(l.id)).map(l => l.id);
}
export function foreignReadingLabel(language: string): string {
  return FOREIGN_READING_LANGUAGES.find(l => l.id === language)?.shortLabel ?? "";
}
export const DEFAULT_JAPANESE_ORDER: JapaneseCategory[] = JAPANESE_CATEGORIES.map(c => c.id);

/** Old/corrupt preferences cannot hide a category or repeat it. Newly added IDs go last. */
export function normalizeJapaneseOrder(value: unknown): JapaneseCategory[] {
  const allowed = new Set<string>(DEFAULT_JAPANESE_ORDER);
  return [...new Set([...(Array.isArray(value) ? value.filter(v => typeof v === "string" && allowed.has(v)) : []), ...DEFAULT_JAPANESE_ORDER])] as JapaneseCategory[];
}
export function moveCategory(order: readonly JapaneseCategory[], id: JapaneseCategory, step: -1 | 1): JapaneseCategory[] {
  const next = normalizeJapaneseOrder(order);
  const at = next.indexOf(id), to = at + step;
  if (at >= 0 && to >= 0 && to < next.length) [next[at], next[to]] = [next[to], next[at]];
  return next;
}
export function japaneseReading(text: string): string {
  return normalizedReading(text);
}
export type JapaneseCandidate = { reading: string; text: string; mask: number; cost: number; consumed: number; kind: number; language: string; original: string };
export function categoryLabel(mask: number, order: readonly JapaneseCategory[]): string {
  for (const id of order) {
    const index = JAPANESE_CATEGORIES.findIndex(c => c.id === id);
    if (mask & (1 << index)) return JAPANESE_CATEGORIES[index].label;
  }
  return "かな";
}

/** One shard at a time. No frequency/character-count cutoff; pagination belongs to the view. */
export class JapaneseLexicon {
  private shard = "";
  private rows: string[] = [];
  private readShard: (key: string) => string;
  constructor(readShard: (key: string) => string) { this.readShard = readShard; }

  search(input: string, priority: readonly JapaneseCategory[], languages: readonly ForeignReadingLanguage[] = []): JapaneseCandidate[] {
    const q = japaneseReading(input);
    if (!q) return [];
    const key = q.codePointAt(0)!.toString(16).padStart(4, "0");
    if (key !== this.shard) {
      this.rows = this.readShard(key).split("\n").filter(Boolean);
      this.shard = key;
    }
    const order = normalizeJapaneseOrder(priority);
    const rank = (mask: number) => {
      const index = order.findIndex(id => mask & (1 << DEFAULT_JAPANESE_ORDER.indexOf(id)));
      return index < 0 ? order.length : index;
    };
    const lower = (s: string) => {
      let lo = 0, hi = this.rows.length;
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (this.rows[mid].split("\t", 1)[0] < s) lo = mid + 1; else hi = mid; }
      return lo;
    };
    const out: JapaneseCandidate[] = [];
    const add = (line: string, kind: number, consumed: number) => {
      const [reading, text, mask, cost, language = "", original = ""] = line.split("\t");
      if (language && !languages.includes(language as ForeignReadingLanguage)) return;
      out.push({ reading, text, mask: +mask, cost: +cost, kind, consumed, language, original });
    };
    for (let i = lower(q); i < this.rows.length; i++) {
      const r = this.rows[i].split("\t", 1)[0];
      if (!r.startsWith(q)) break;
      add(this.rows[i], r === q ? 0 : 1, q.length);
    }
    // Long input can be converted a word at a time; selecting a prefix preserves the rest.
    for (let n = q.length - 1; n > 0; n--) {
      const prefix = q.slice(0, n);
      for (let i = lower(prefix); i < this.rows.length && this.rows[i].split("\t", 1)[0] === prefix; i++) add(this.rows[i], 2, n);
    }
    out.sort((a, b) => Number(preferredExactKun(q,b.kind,b.mask,b.language)) - Number(preferredExactKun(q,a.kind,a.mask,a.language)) || a.kind - b.kind || (a.kind === 2 ? b.consumed - a.consumed : 0) || Number(!!a.language) - Number(!!b.language) || rank(a.mask) - rank(b.mask) || a.cost - b.cost || a.reading.length - b.reading.length);
    out.push({ reading: q, text: q, mask: 0, cost: 0, consumed: q.length, kind: 3, language: "", original: "" });
    out.push({ reading: q, text: q.replace(/[ぁ-ゖ]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60)), mask: 0, cost: 0, consumed: q.length, kind: 3, language: "", original: "" });
    const seen = new Set<string>();
    return out.filter(c => { const id = `${c.consumed}\t${c.text}`; if (seen.has(id)) return false; seen.add(id); return true; });
  }
}
