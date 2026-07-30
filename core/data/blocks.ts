// Unicode の CJK 漢字ブロック表。zi.tools の「字符集」と同じ区切り。
//
// **辞書ビルド(web/scripts/build-data)と実行時(Engine)の両方がこの1つを見る。**
// 以前この表を build-data 側にも書いていて、片方だけ古い範囲のまま残った結果、
// 拡張C/Eの末尾18字が黙って辞書から落ちていた。単一の出所にしてある理由。
//
// hi は「割り当て済みの最後のコードポイント」。ブロック末尾ではないことがある
// (例: 拡張F は 2CEB0..2EBEF のブロックだが、割り当ては 2EBE0 まで)。
// 出典: UCD の Blocks.txt × DerivedAge.txt。
// 拡張C/E の末尾は Unicode 17.0 で伸びた(DerivedAge: "2B73A..2B73F ; 17.0" /
// "2CEA2..2CEAD ; 17.0")。python の unicodedata は 16.0 なのでこの18字を
// 知らないが、それは未割り当てという意味ではない(拡張Jの全字も同様に知らない)。
export interface Block {
  key: string;
  label: string;
  lo: number;
  hi: number;
}

/** CJK統合漢字。割り当て済み範囲が連続しているので、収録漏れの検証に使える */
export const BLOCKS: Block[] = [
  { key: "uro", label: "基本(URO)", lo: 0x4e00, hi: 0x9fff },
  { key: "a", label: "拡張A", lo: 0x3400, hi: 0x4dbf },
  { key: "b", label: "拡張B", lo: 0x20000, hi: 0x2a6df },
  { key: "c", label: "拡張C", lo: 0x2a700, hi: 0x2b73f },
  { key: "d", label: "拡張D", lo: 0x2b740, hi: 0x2b81d },
  { key: "e", label: "拡張E", lo: 0x2b820, hi: 0x2cead },
  { key: "f", label: "拡張F", lo: 0x2ceb0, hi: 0x2ebe0 },
  { key: "i", label: "拡張I", lo: 0x2ebf0, hi: 0x2ee5d },
  { key: "g", label: "拡張G", lo: 0x30000, hi: 0x3134a },
  { key: "h", label: "拡張H", lo: 0x31350, hi: 0x323af },
  { key: "j", label: "拡張J", lo: 0x323b0, hi: 0x33479 },
];

/** 互換漢字。統合漢字ではなく、ブロック内に未割り当てが混ざるので収録数の検証はしない */
export const COMPAT_BLOCKS: Block[] = [
  { key: "compat", label: "互換漢字", lo: 0xf900, hi: 0xfaff },
  { key: "compat2", label: "互換補助", lo: 0x2f800, hi: 0x2fa1f },
];

/** 収録対象すべて。一覧のタブや blockOf はこちらを使う */
export const ALL_BLOCKS: Block[] = [...BLOCKS, ...COMPAT_BLOCKS];

export function blockOf(ch: string): Block | undefined {
  const cp = ch.codePointAt(0)!;
  return ALL_BLOCKS.find((b) => cp >= b.lo && cp <= b.hi);
}

/** 漢字が収録対象のブロックに入っているか(部品にしか出ない筆画・部首を弾く) */
export function isIdeograph(ch: string): boolean {
  return blockOf(ch) !== undefined;
}

export function codePointLabel(ch: string): string {
  return `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;
}
