// 読みの補完。KANJIDIC2 に無い字にも読みを与える。
//
// このアプリは「読めない字を打つ」道具なので、読みは**引くための手がかり**として
// いちばん効く。ところが KANJIDIC2 が読みを持つのは 13,108字だけで、残りの
// 89,890字は読みが1つも無かった(＝読みでは一生引けない字だった)。
//
// そこで段に分けて埋める。**正式かどうかは必ず区別して持つ**
// (辞書に無い読みを、辞書にある読みと同じ顔で出さない)。
//
//   正式   … KANJIDIC2 の音訓。CharMeta.on / CharMeta.kun
//   人名   … KANJIDIC2 の nanori。人名でしか使わない読み。正式な音訓ではない
//   参考   … 資料にある日本語の読み。Unihan の kJapanese・和製漢字の辞典・
//            JK(国字コレクション)・zi.tools の音読み・手で足した読み。
//            **正式な読みがある字にも足せる**(呉音・古訓・慣用の読み。
//            悪→コ/ああ/いずくんぞ、握→オク/オウ のような、辞書の音訓に
//            入っていないが実際に使われてきた読み)
//            互換漢字(U+F900〜)は統合漢字と**同じ字**(Unicode の正規等価)なので、
//            統合漢字の読みをそのまま使う。これも参考の段
//   外国語 … 日本語の読みが1つも無い字にだけ、IRG ワーキングセットで提案国が
//            書き添えた読み(中国語の拼音・壮語・韓国語・ベトナム語)を
//            カタカナに書き写して入れる(irg.mts・transcribe.mts)。
//            UI では「中国語音 yǐn」のように原語を添えて出す
//
// **推定はしない**(2026-09-29 にやめた)。以前は読みの無い字に、異体字の読みを
// 借りたり、声符(部品)・韓国語音・台湾の閩南語音から音読みを推したりしていたが
// (当たるのは6割ほど)、当たらない読みが混ざるので外した。
import { existsSync, readFileSync } from "node:fs";
import type { KanjiInfo } from "./kanjidic2.mts";
import { normalizeIrgRef, type IrgReading } from "./irg.mts";
import { SRC } from "./paths.mts";
import { readZipEntry } from "./unzip.mts";

/** 参考の読みの出所。"" は参考の読みが無い */
export type RefKind = "" | "u" | "w" | "j" | "z" | "m" | "e" | "i";

export interface RefReading {
  /** 読み(かな)。空なら埋められなかった */
  ref: string[];
  /**
   * u=資料(Unihan) / w=和製漢字の辞典 / j=JK(国字コレクション) / z=zi.tools の音読み /
   * m=手で足した読み / e=互換漢字の元の字(同じ字) / i=IRG の外国語の読みの書き写し
   */
  kind: RefKind;
  /**
   * e のとき、読みを借りた統合漢字。i のとき「言語:原語の読み」("zh:kuì/hǎo")。
   * UI で「参考(同じ字 塚)」「中国語音 kuì・hǎo」と出すために持つ
   */
  from: string;
}

const EMPTY: RefReading = { ref: [], kind: "", from: "" };

export interface UnihanData {
  /** 字 → kJapanese(かな書きの日本語読み) */
  japanese: Map<string, string[]>;
  /**
   * IRG の源の記号(normalizeIrgRef で揃えたもの) → 字(kIRG_GSource ほか)。
   * IRG ワーキングセットの読みを符号位置に結びつけるのに使う(irg.mts)
   */
  irgSources: Map<string, string>;
  /**
   * 字 → 総画数(kTotalStrokes)。**CJK漢字102,998字ぜんぶにある**ので、
   * KANJIDIC2 の 13,108字しか持たない画数と違い、10万字を同じ土俵で絞り込める。
   * 読みで引いた候補を画数で絞るのはこの値(KANJIDIC2 側があればそちらを優先)。
   * Unihan が知らない字の画数は supplement.mts から足す。
   */
  strokes: Map<string, number>;
}

/**
 * Unihan(zip)から読み・画数・IRG の源の記号を読む。
 * 展開すると25MBあるので zip のまま置き、必要な2ファイルだけ取り出す。
 */
export function loadUnihan(): UnihanData {
  const japanese = new Map<string, string[]>();
  const irgSources = new Map<string, string>();
  const strokes = new Map<string, number>();

  const eachLine = (name: string, fn: (ch: string, field: string, value: string) => void) => {
    for (const line of readZipEntry(SRC.unihanZip, name).toString("utf8").split("\n")) {
      if (!line || line[0] === "#") continue;
      const [cp, field, value] = line.replace(/\r$/, "").split("\t");
      if (!value) continue;
      fn(String.fromCodePoint(parseInt(cp.slice(2), 16)), field, value);
    }
  };

  eachLine("Unihan_Readings.txt", (ch, field, value) => {
    if (field === "kJapanese") japanese.set(ch, value.split(" "));
  });
  eachLine("Unihan_IRGSources.txt", (ch, field, value) => {
    if (field === "kTotalStrokes") {
      // 字源によって画数が割れることがある("13 14" のように並ぶ)。
      // 先頭が J/中国系の代表値なのでそれを取る
      const n = parseInt(value.split(" ")[0], 10);
      if (n > 0) strokes.set(ch, n);
      return;
    }
    if (field.startsWith("kIRG_"))
      for (const ref of value.split(" ")) if (ref) irgSources.set(normalizeIrgRef(ref), ch);
  });

  return { japanese, irgSources, strokes };
}

/**
 * 読みの補完表を作る。`ref(ch)` で1字ぶんの参考の読みが引ける。
 *
 * 正式な読み(KANJIDIC2の音訓)は上書きしない。資料にしか無い日本語の読みを
 * 参考として足すだけ。外国語の読み(IRG)は日本語の読みが1つも無い字にだけ入る。
 * **1字あたりの件数は切らない**(以前は4件で切っていて、和製漢字の辞典や
 * kJapanese の5件め以降が読みで引けなかった)。
 */
export function makeRefReadings(
  kanjidic: Map<string, KanjiInfo>,
  unihan: UnihanData,
  /**
   * 『和製漢字の辞典2014』の読み(build-data/wasei.mts)。国字は中国の字音を
   * 持たないので、Unihan にも KANJIDIC2 にも読みが無いことが多い
   */
  wasei: Map<string, string[]> = new Map(),
  /**
   * JK(IRG国字コレクション)の読み。国字なので他の表に読みが無いことが多い
   */
  jk: Map<string, string[]> = new Map(),
  /**
   * zi.tools の日本語音読み。Unihan と大きく重なるが1,230字ぶん多い
   */
  ziOnyomi: Map<string, string[]> = new Map(),
  /** 手で足した読み(data-src/readings/manual.tsv) */
  manual: Map<string, string[]> = new Map(),
  /** IRG ワーキングセットの読み(irg.mts)。日本語の読みが1つも無い字にだけ使う */
  irg: Map<string, IrgReading[]> = new Map(),
) {
  /**
   * 正規等価の字。互換漢字(U+F900〜・U+2F800〜)は統合漢字と**同じ字**なので、
   * 読みはそのまま借りてよい(類 U+F9D0 は 類 U+985E と同じ字)。
   * 互換漢字の正規分解は1字への置き換えなので、NFC で元の字に戻る。
   */
  const canonical = (ch: string): string => {
    const nfc = ch.normalize("NFC");
    return nfc !== ch && [...nfc].length === 1 ? nfc : "";
  };

  /** 送り仮名・接辞の目印を落として、かなを揃える(重複を見るため) */
  const key = (s: string) =>
    s.replace(/[.\-]/g, "").replace(/[ァ-ヶ]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0x60),
    );

  /**
   * 資料にある日本語の参考の読みを、出所の順(Unihan → 和製漢字の辞典 → JK →
   * zi.tools → 手で足した読み)に重ねる。known に入っている読み(正式・人名)は落とす。
   * 出所は「どれが実際に足したか」で決める(先に見たほうを名乗る)
   */
  const japaneseRefs = (ch: string, known: Set<string>): RefReading => {
    const seen = new Set(known);
    const out: string[] = [];
    let kind: RefKind = "";
    const layers: [RefKind, string[]][] = [
      ["u", unihan.japanese.get(ch) ?? []],
      ["w", wasei.get(ch) ?? []],
      ["j", jk.get(ch) ?? []],
      ["z", ziOnyomi.get(ch) ?? []],
      ["m", manual.get(ch) ?? []],
    ];
    for (const [k, list] of layers) {
      for (const r of list) {
        if (seen.has(key(r))) continue;
        seen.add(key(r));
        out.push(r);
        if (!kind) kind = k;
      }
    }
    return out.length ? { ref: out, kind, from: "" } : EMPTY;
  };

  const cache = new Map<string, RefReading>();

  return function ref(ch: string): RefReading {
    const hit = cache.get(ch);
    if (hit) return hit;

    let out = EMPTY;
    const info = kanjidic.get(ch);
    if (info && (info.on.length || info.kun.length)) {
      // 正式な読みがある字。**上書きはしない**が、資料にしか無い読み
      // (呉音・古訓・慣用)は参考として足す。人名(nanori)と重なるぶんは落とす
      out = japaneseRefs(ch, new Set([...info.on, ...info.kun, ...info.nanori].map(key)));
    } else {
      out = japaneseRefs(ch, new Set((info?.nanori ?? []).map(key)));
      if (!out.ref.length) {
        // 互換漢字は統合漢字と同じ字。統合漢字の読み(正式＋参考)をそのまま使う
        const nfc = canonical(ch);
        if (nfc) {
          const twin = kanjidic.get(nfc);
          const own = twin ? [...twin.on, ...twin.kun] : [];
          const refs = japaneseRefs(nfc, new Set(own.map(key))).ref;
          if (own.length || refs.length) out = { ref: [...own, ...refs], kind: "e", from: nfc };
        }
      }
      if (!out.ref.length && irg.has(ch)) {
        // 日本語の読みが1つも無い字だけ、IRG の外国語の読みの書き写しを入れる。
        // 1字に複数の言語が付いていたら、1つの言語にそろえる(出所の表示が1つなので)。
        // 先に来るのは中国語 → 韓国語 → ベトナム語 → 壮語
        const list = irg.get(ch)!;
        const lang = (["zh", "ko", "vi", "za"] as const).find((l) => list.some((r) => r.lang === l))!;
        const mine = list.filter((r) => r.lang === lang);
        const kana = [...new Set(mine.map((r) => r.kana))];
        out = { ref: kana, kind: "i", from: `${lang}:${mine.map((r) => r.reading).join("/")}` };
      }
    }
    cache.set(ch, out);
    return out;
  };
}

/** 手で足した読み。字<TAB>読み(空白区切り)<TAB>メモ。# から始まる行は注記 */
export function loadManual(path: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const [ch, rest] = line.split("\t");
    if (!ch || !rest) continue;
    const prev = out.get(ch.trim()) ?? [];
    for (const r of rest.trim().split(/\s+/)) if (r && !prev.includes(r)) prev.push(r);
    out.set(ch.trim(), prev);
  }
  return out;
}
