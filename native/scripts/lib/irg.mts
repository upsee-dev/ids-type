import type { IrgEntry } from "../../src/irgWorkingSets.ts";

interface IrgPage {
  sn: string;
  title: string;
  sources: Record<string, Record<string, string>>;
}

// web/scripts/build-data/irg.mts と同じ字源表記の正規化。
export function normalizeIrgRef(ref: string): string {
  return ref.trim().toUpperCase().replace(/^USAT/, "SAT").replace(/[-\s]/g, "").replace(/^VF/, "VNF");
}

export function unihanSourceIndex(text: string): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const line of text.split("\n")) {
    if (!line.startsWith("U+")) continue;
    const [code, field, value] = line.split("\t");
    if (!/^kIRG_.*Source$/.test(field)) continue;
    const ch = String.fromCodePoint(parseInt(code.slice(2), 16));
    for (const ref of value.split(/\s+/).filter(Boolean)) {
      const key = normalizeIrgRef(ref);
      const chars = index.get(key) ?? new Set<string>();
      chars.add(ch);
      index.set(key, chars);
    }
  }
  return index;
}

export function buildIrgEntries(jsonl: string, index: Map<string, Set<string>>): IrgEntry[] {
  // 取得を再開した際の重複は、既存の読みデータ生成と同じく後勝ちで畳む。
  const pages = new Map<string, IrgPage>();
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    const page = JSON.parse(line) as IrgPage;
    if (!/^\d{5}$/.test(page.sn)) throw new Error(`不正なIRG提案番号: ${page.sn}`);
    pages.set(page.sn, page);
  }
  return [...pages.values()].sort((a, b) => a.sn.localeCompare(b.sn)).map(page => {
    const refs = Object.keys(page.sources).filter(ref => ref !== "*");
    const chars = new Set<string>();
    for (const ref of refs) {
      for (const ch of index.get(normalizeIrgRef(ref)) ?? []) chars.add(ch);
    }
    const ids = [...new Set([
      page.sources["*"]?.IDS,
      ...Object.values(page.sources).map(row => row.IDS),
    ].filter((value): value is string => !!value?.trim()).map(value => value.trim()))];
    return {
      sn: page.sn,
      ids: ids.join(" / ") || page.title.split("|")[1]?.trim() || "",
      chars: [...chars].sort((a, b) => a.codePointAt(0)! - b.codePointAt(0)!),
      refs,
    };
  });
}
