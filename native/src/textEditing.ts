/** TextInput の選択位置は、コードポイント数ではなく UTF-16 の位置。 */
export interface TextSelection { start: number; end: number }

export function replaceSelection(text: string, selection: TextSelection, insert: string) {
  const start = Math.max(0, Math.min(selection.start, text.length));
  const end = Math.max(start, Math.min(selection.end, text.length));
  const position = start + insert.length;
  return {
    text: text.slice(0, start) + insert + text.slice(end),
    selection: { start: position, end: position },
  };
}

export function backspaceSelection(text: string, selection: TextSelection) {
  const end = Math.max(0, Math.min(selection.end, text.length));
  let start = Math.max(0, Math.min(selection.start, end));
  if (start === end && start > 0) {
    // 漢字＋異体字セレクターも1文字で消す。Intl.Segmenter のない端末でも
    // サロゲートペア・結合文字を分断しない。
    const clusters = [...text.slice(0, start).matchAll(/\P{M}\p{M}*|\p{M}+/gu)];
    start = clusters.at(-1)?.index ?? 0;
  }
  return replaceSelection(text, { start, end }, "");
}
