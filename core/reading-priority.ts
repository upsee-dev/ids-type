/** High attribute bit; category bits 0–14 remain stable for saved preferences. */
export const KUN_READING_FLAG = 1 << 24;

export function normalizedReading(value: string): string {
  return value.normalize("NFC").replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/** Prefix matches count only for kun of this length or longer, typed with at least four kana. */
export const LONG_KUN_PREFIX_MIN = 5;

/**
 * 0 = a whole kun reading (okurigana included) equals the 4+ kana query,
 * 1 = a kun reading of 5+ kana starts with it, 2 = neither. Never substrings or stems.
 */
export function longKunRank(query: string, kun: string, reference = "", allowReference = false): number {
  const q = normalizedReading(query);
  if (!/^[ぁ-ゖー]{4,}$/.test(q)) return 2;
  let best = 2;
  const scan = (readings: string) => {
    for (const token of readings.split(/\s+/)) {
      if (!/^[ぁ-ゖー.\-]+$/.test(token)) continue;
      const r = token.replace(/[.\-]/g, "").normalize("NFC");
      if (r === q) best = 0;
      else if (best > 1 && r.length >= LONG_KUN_PREFIX_MIN && r.startsWith(q)) best = 1;
    }
  };
  scan(kun);
  if (allowReference) scan(reference);
  return best;
}

/** Compare whole readings, including okurigana, rather than substrings or stems. */
export function matchesLongKun(query: string, kun: string, reference = "", allowReference = false): boolean {
  return longKunRank(query, kun, reference, allowReference) === 0;
}

/**
 * Kun/jukujikun rows of the flick lexicon: 0 = exact 4+ kana match, 1 = a 5+ kana
 * reading starting with the 4+ kana query (predictive), 2 = not preferred.
 */
export function preferredKunRank(query: string, kind: number, mask: number, language: string, readingLength: number): number {
  if (query.length < 4 || language || !(mask & (KUN_READING_FLAG | (1 << 6)))) return 2;
  if (kind === 0) return 0;
  return kind === 1 && readingLength >= LONG_KUN_PREFIX_MIN ? 1 : 2;
}
