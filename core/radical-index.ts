/** Kangxi radical number ranges by radical stroke count (1…17). */
export const RADICAL_ENDS = [6, 23, 54, 94, 117, 146, 166, 175, 186, 194, 200, 204, 208, 210, 211, 213, 214];
export function radicalsByStrokes(strokes: number): number[] {
  if (!Number.isInteger(strokes) || strokes < 1 || strokes > RADICAL_ENDS.length) return [];
  const start = strokes === 1 ? 1 : RADICAL_ENDS[strokes - 2] + 1;
  return Array.from({ length: RADICAL_ENDS[strokes - 1] - start + 1 }, (_, i) => start + i);
}
export function radicalLabel(n: number): string {
  return n >= 1 && n <= 214 ? String.fromCodePoint(0x2f00 + n - 1).normalize("NFKC") + "部" : "";
}
export type RadicalIndex = Record<string, string>;
export function residualStrokes(index: RadicalIndex, radical: number): number[] {
  return Object.keys(index).filter(k => k.startsWith(`${radical}.`)).map(k => +k.split(".")[1]).sort((a,b) => a-b);
}
export function radicalCharacters(index: RadicalIndex, radical: number, residual: number): string[] {
  return [...(index[`${radical}.${residual}`] ?? "")];
}
