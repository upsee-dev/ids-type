/** 中央に戻る途中の指ぶれは許し、しきい値を越えた最新の方向には追従する。 */
export function trackFlick(dx: number, dy: number, previous: number): number {
  if (dx * dx + dy * dy < 18 * 18) return previous;
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 1 : 3;
  return dy < 0 ? 2 : 4;
}

/** 長押しやフリックは、直前の文字を書き換える連打トグルと区別する。 */
export const isToggleTap = (direction: number, heldMs: number) =>
  direction === 0 && heldMs < 500;
