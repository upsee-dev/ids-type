// 『和製漢字の辞典2014』(大原望) から読みを取り出す。
//
// **国字(和製漢字)は Unihan にも KANJIDIC2 にも読みが無いことが多い**。
// 峠・榊 のような有名どころは KANJIDIC2 に入っているが、拡張漢字側の国字は
// どの表にも読みが無い。そもそも国字は中国の字音を持たないので、部品から
// 音を推すこともできない(仦 を「小」から推しても「わらわ」は出ない)。
// この辞典は国字・和製異体字だけを集めて読みを与えているので、そこを埋められる。
//
// 上流は部ごとに172ページに分かれた HTML。data-src では1ソース1ファイルに
// 揃える決まりなので、fetch.mjs が連結して waseikanji.html に保存している
// (CHISE を1本にしているのと同じ。<!-- ==== ファイル名 ==== --> が境目)。
//
// 1件はこの形:
//   <p id='0004'><span class='wk_head_font'>丒</span>W+4 (…U+4E12)　…
//     <div class='indent'>[読み] ジン、チュウ、うす、うし<br />[解説] …
// 見出しが画像(2014年当時に未符号化の字)の行は符号位置が無い。末尾の漢字林への
// リンクが字を指していて画数も合うものだけ、その字として採る(9字)。
import { existsSync, readFileSync } from "node:fs";
import { SRC } from "./paths.mts";

/**
 * 読みだけを取り出したもの。字 -> 読み(音はカタカナ・訓はひらがな)。
 *
 * 採らないもの:
 *   「炻器」二字で、「せっき」 … 熟字訓。その字1字の読みではない
 *   解説参照・音義未詳       … 読みが書かれていない
 */
export function loadWasei(
  /**
   * 字 -> 総画数(Unihan kTotalStrokes)。見出しが画像の項目(2014年当時に未符号化)を
   * 字に結びつけるときの照合に使う
   */
  strokes: Map<string, number> = new Map(),
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!existsSync(SRC.wasei)) {
    console.warn(`!! ${SRC.wasei} が無いので和製漢字の辞典をスキップ`);
    return out;
  }
  const html = readFileSync(SRC.wasei, "utf8");
  for (const m of html.matchAll(/<p id='\d+'>(.*?)<\/p>/gs)) {
    const body = m[1];
    const head = body.split("[読み]")[0].replace(/<[^>]+>/g, "");
    // 符号位置。見出しのかっこ内にある(未符号化だった字には無い)
    let ch = "";
    const cp = head.match(/U\+([0-9A-Fa-f]{4,6})/);
    if (cp) {
      ch = String.fromCodePoint(parseInt(cp[1], 16));
    } else {
      // 見出しが画像の項目。末尾の漢字林へのリンクが字を指していれば、その後に
      // 符号化された字の可能性がある(符号位置のある項目では、末尾のリンクは
      // 1,757件すべて見出しの字そのもの)。ただし同じ字の別の形(榊 の異体)を
      // 指すこともあるので、**総画数が合うものだけ**採る
      const link = body.match(/Kanjirin[0-9a-z]*\.html#([0-9A-F]+)'>\{漢字林:[^}]*\}<\/a><br \/><\/div>\s*$/);
      const total = head.match(/総画(\d+)画/);
      if (!link || !total) continue;
      const c = String.fromCodePoint(parseInt(link[1], 16));
      if (strokes.get(c) !== Number(total[1])) continue;
      ch = c;
    }
    const reads: string[] = [];
    const read = body.match(/\[読み\]\s*(.*?)(?:<br\s*\/?>|$)/s);
    if (read) {
      const txt = read[1]
        .replace(/<[^>]+>/g, "")
        .replace(/&[a-z]+;/g, " ")
        .replace(/[（(][^)）]*[)）]/g, "") // 「(〜の意)」のような補足は落とす
        .replace(/　/g, " ")
        .trim();
      // かなだけの並びを読みとして採る(「〜二字で」「解説参照」などは落ちる)
      for (const s of txt.split(/[、,，・]/)) {
        const r = s.trim();
        if (/^[ぁ-ゖァ-ヺー.\-]+$/.test(r)) reads.push(r);
      }
    }
    // 見出しに「「はなをかむ」は、国訓」とだけ書いて、[読み] が「解説参照」の項目がある(挗)
    for (const k of head.matchAll(/「([ぁ-ゖ]+)」は、国訓/g)) reads.push(k[1]);
    if (!reads.length) continue;
    const prev = out.get(ch) ?? [];
    for (const r of reads) if (!prev.includes(r)) prev.push(r);
    out.set(ch, prev);
  }
  return out;
}
