/** High attribute bit; category bits 0–14 remain stable for saved preferences. */
export const KUN_READING_FLAG = 1 << 24;

export function normalizedReading(value: string): string {
  return value.normalize("NFC").replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/** Compare whole readings, including okurigana, rather than substrings or stems. */
export function matchesLongKun(query: string, kun: string, reference = "", allowReference = false): boolean {
  const q = normalizedReading(query);
  if (!/^[ぁ-ゖー]{4,}$/.test(q)) return false;
  const has = (readings: string) => readings.split(/\s+/).some(token =>
    /^[ぁ-ゖー.\-]+$/.test(token) && token.replace(/[.\-]/g, "").normalize("NFC") === q);
  return has(kun) || (allowReference && has(reference));
}

export function preferredExactKun(query: string, kind: number, mask: number, language: string): boolean {
  return query.length >= 4 && kind === 0 && !language && !!(mask & (KUN_READING_FLAG | (1 << 6)));
}
