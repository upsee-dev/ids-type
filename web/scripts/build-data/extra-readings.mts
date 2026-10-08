// 上流の辞書が持たない字の読みを、外から足す表。
//
// **JK(国字コレクション)** … IRG に日本が出した国字の一覧(Unihan の
//   kIRG_JSource が JK-xxxxx の782字)。zi.tools の字典面に、
//   「「トモ」的合字」「このころ。近来」のような**日本語の読みを含む説明**が付く。
//   国字なので他のどの表にも読みが無いことが多い。
//
// **zi.tools の音読み** … Unihan の kJapanese と大きく重なるが、Unihan に無い
//   読みを1,230字ぶん持つ。
//
// 以前はここに「台湾の閩南語音」と「異体字グループの読み」もあったが、どちらも
// 日本語の読みを**推定**するためのものだったので、推定をやめたときに外した
// (data-src/readings/taiwan-min.tsv・zi-variant.tsv は取り直しに時間がかかるので残してある)。
import { existsSync, readFileSync } from "node:fs";
import { SRC } from "./paths.mts";

/** 字 -> 読み。どちらの表も「字 <TAB> 読み(空白区切り)」の素朴なTSV */
function loadTsv(path: string, what: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!existsSync(path)) {
    console.warn(`!! ${path} が無いので${what}をスキップ`);
    return out;
  }
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const [ch, rest] = line.split("\t");
    if (!ch || !rest) continue;
    const list = rest.trim().split(/\s+/).filter(Boolean);
    if (list.length) out.set(ch, list);
  }
  return out;
}

/** JK(国字コレクション)の読み。資料にある実在の読みなので推定より先に使う */
export const loadJk = (): Map<string, string[]> =>
  loadTsv(SRC.jk, "JK(国字コレクション)の読み");

/**
 * zi.tools の日本語音読み(50,144字・89,491件)。**Unihan の kJapanese と大きく重なる**が、
 * 1,230字ぶん Unihan に無い読みを持つ。行は「読み:時期」で、時期は
 * G=呉音 K=漢音 T=唐音(Unihan には無い区別。いまは読みだけ使っている)。
 */
export function loadZiOnyomi(): Map<string, string[]> {
  const raw = loadTsv(SRC.ziOnyomi, "zi.tools の音読み");
  const out = new Map<string, string[]>();
  for (const [ch, list] of raw) {
    out.set(ch, list.map((x) => x.split(":")[0]).filter(Boolean));
  }
  return out;
}
