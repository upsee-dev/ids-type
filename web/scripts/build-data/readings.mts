// 読みの補完。KANJIDIC2 に無い字にも読みを与える。
//
// このアプリは「読めない字を打つ」道具なので、読みは**引くための手がかり**として
// いちばん効く。ところが KANJIDIC2 が読みを持つのは 13,108字だけで、残りの
// 89,890字は読みが1つも無かった(＝読みでは一生引けない字だった)。
//
// そこで4段階に分けて埋める。**正式かどうかは必ず区別して持つ**
// (辞書に無い読みを、辞書にある読みと同じ顔で出さない)。
//
//   正式  … KANJIDIC2 の音訓。CharMeta.on / CharMeta.kun
//   人名  … KANJIDIC2 の nanori。人名でしか使わない読み。正式な音訓ではない
//   参考  … Unihan の kJapanese(かな書きの日本語読み)。51,583字ぶんあり、
//           **正式な読みがある字にも足せる**(呉音・古訓・慣用の読み。
//           悪→コ/ああ/いずくんぞ、握→オク/オウ のような、辞書の音訓に
//           入っていないが実際に使われてきた読み。14,301件ぶん)
//   推定  … 正式にも参考にも読みが無い字。**異体字**の読みを借りるか、
//           **声符(部品)**から音を推す。当たるのはだいたい6割(下記)
//
// 「推定」の当たり方は KANJIDIC2 の字で検算できる(実際の音と突き合わせる):
//   部首1つ＋声符1つ の形 … 66.0% (6,801/10,308)
//   それ以外の形         … 全体で 59.6% (7,041/11,811)
// 6割なので**当てにはできないが、当たれば近道になる**。UI では「推定」と断って
// 出し、読みで引いたときも正式→人名→参考→推定の順に並べる。
import type { KanjiInfo } from "./kanjidic2.mts";
import { SRC } from "./paths.mts";
import { readZipEntry } from "./unzip.mts";

/** 参考・推定の読みの出所。"" は参考の読みが無い */
export type RefKind = "" | "u" | "v" | "p";

export interface RefReading {
  /** 読み(かな)。空なら埋められなかった */
  ref: string[];
  /** u=資料(Unihan) / v=異体字から / p=部品(声符)から推定 */
  kind: RefKind;
  /** v・p のとき、読みを借りた元の字。UI で「〜から」と出すために持つ */
  from: string;
}

const EMPTY: RefReading = { ref: [], kind: "", from: "" };

/** 候補一覧に出す用途なので、1字につき4つで足りる(音訓と同じ扱い) */
const MAX_READINGS = 4;

const isIDC = (c: string) => (c >= "⿰" && c <= "⿿") || c === "㇯";
const isKatakana = (s: string) =>
  [...s].every((c) => (c >= "ァ" && c <= "ヺ") || c === "ー");

/**
 * 偏旁の形 → 独立字。部首と部品を突き合わせるために使う
 * (阿 の部品「阝」と部首「阜」を同じものとして扱う)。
 * core/ids/normalize.ts の NORM+SOFT と同じ考え方だが、こちらは
 * **部首番号との照合**が目的なので逆向き(独立字→偏旁形)の表も要る。
 */
const TO_BASE = new Map(
  Object.entries({
    "⺼": "月", "⺾": "艹", "⻌": "辶", "⻍": "辶", "⻏": "阝", "⻖": "阝",
    靑: "青", 飠: "食", "𩙿": "食", 訁: "言", 釒: "金", 糹: "糸",
    "⺬": "礻", "⺭": "礻", "⺿": "艹", "⻂": "衤", "⺡": "氵", "⺘": "扌",
    "⺖": "忄", "⺨": "犭", "⺣": "灬", "⻊": "足", "𤴔": "疋", "⺝": "月",
    "⺗": "㣺", "⺕": "彐", "⺊": "卜", "⺆": "冂", "⺻": "聿", "⺶": "羊",
    "⺸": "羊", "⺵": "网", "⺲": "罒", "⺳": "罒", "⺪": "疋", "⺤": "爫",
    "⺥": "爫", "⺫": "目", "⺁": "厂", "⺇": "几", "𠘨": "几", "𤣩": "王",
  }),
);

/** 部首の字 → よく使う偏旁の形。声符を選ぶとき「部首のほう」を外すために引く */
const RADICAL_FORM = new Map(
  Object.entries({
    艸: "艹", 肉: "月", 水: "氵", 手: "扌", 心: "忄", 犬: "犭", 火: "灬",
    示: "礻", 衣: "衤", 玉: "王", 网: "罒", 人: "亻", 刀: "刂", 阜: "阝",
    邑: "阝", 辵: "辶", 言: "訁", 食: "飠", 糸: "糹", 金: "釒", 足: "⻊",
  }),
);

const base = (c: string) => TO_BASE.get(c) ?? c;

export interface UnihanData {
  /** 字 → kJapanese(かな書きの日本語読み) */
  japanese: Map<string, string[]>;
  /** 字 → 異体字(意味・字体の異なり字。読みを借りる先) */
  variants: Map<string, string[]>;
  /** 字 → 康熙部首番号(1〜214)。声符を選ぶときに「部首でないほう」を取るのに使う */
  radical: Map<string, number>;
  /**
   * 字 → 総画数(kTotalStrokes)。**CJK漢字102,998字ぜんぶにある**ので、
   * KANJIDIC2 の 13,108字しか持たない画数と違い、10万字を同じ土俵で絞り込める。
   * 読みで引いた候補を画数で絞るのはこの値(KANJIDIC2 側があればそちらを優先)。
   */
  strokes: Map<string, number>;
}

/**
 * Unihan(zip)から読み・異体字・部首番号を読む。
 * 展開すると25MBあるので zip のまま置き、必要な3ファイルだけ取り出す。
 */
export function loadUnihan(): UnihanData {
  const japanese = new Map<string, string[]>();
  const variants = new Map<string, string[]>();
  const radical = new Map<string, number>();
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
  eachLine("Unihan_Variants.txt", (ch, _field, value) => {
    // "U+8A8C<kMatthews" のように出所つきで並ぶ。字だけ取る
    const list = variants.get(ch) ?? [];
    for (const tok of value.split(" ")) {
      const code = tok.split("<")[0];
      if (code.startsWith("U+")) list.push(String.fromCodePoint(parseInt(code.slice(2), 16)));
    }
    variants.set(ch, list);
  });
  eachLine("Unihan_IRGSources.txt", (ch, field, value) => {
    if (field === "kTotalStrokes") {
      // 字源によって画数が割れることがある("13 14" のように並ぶ)。
      // 先頭が J/中国系の代表値なのでそれを取る
      const n = parseInt(value.split(" ")[0], 10);
      if (n > 0) strokes.set(ch, n);
      return;
    }
    // "9.7" = 部首9・部首以外7画。'つきは簡体字の部首を表す
    if (field !== "kRSUnicode") return;
    const n = parseInt(value.split(" ")[0].replace("'", ""), 10);
    if (n >= 1 && n <= 214) radical.set(ch, n);
  });

  return { japanese, variants, radical, strokes };
}

/**
 * 読みの補完表を作る。`ref(ch)` で1字ぶんの参考・推定の読みが引ける。
 *
 * 正式な読み(KANJIDIC2の音訓)がある字は空を返す。埋めるのは
 * **読みが1つも無い字**だけで、正式な読みを上書きすることはない。
 */
export function makeRefReadings(
  kanjidic: Map<string, KanjiInfo>,
  idsMap: Map<string, string>,
  unihan: UnihanData,
) {
  /** 康熙部首番号 → その部首の字(統合漢字)。⼀(U+2F00)→一 の対応 */
  const radicalChar = (n: number): string => {
    const kangxi = String.fromCodePoint(0x2f00 + n - 1);
    // 康熙部首は統合漢字への互換分解を持つ。normalize("NFKD") で1字に戻る
    return kangxi.normalize("NFKD");
  };

  /**
   * 正規等価の字。互換漢字(U+F900〜・U+2F800〜)は統合漢字と**同じ字**なので、
   * 読みはそのまま借りてよい(類 U+F9D0 は 類 U+985E と同じ字)。
   * 互換漢字の正規分解は1字への置き換えなので、NFC で元の字に戻る。
   */
  const canonical = (ch: string): string => {
    const nfc = ch.normalize("NFC");
    return nfc !== ch && [...nfc].length === 1 ? nfc : "";
  };

  /** その字の音訓(正式)。無ければ資料(Unihan)の読み */
  const readingsOf = (ch: string): string[] => {
    const info = kanjidic.get(ch);
    if (info && (info.on.length || info.kun.length)) return [...info.on, ...info.kun];
    return unihan.japanese.get(ch) ?? [];
  };

  /**
   * その字の**音**(カタカナ)。声符から推すときに使う。
   * 自分に読みが無ければ、正規等価の字 → 異体字 の順に借りる
   * (簡体字の部品「丝」は絲、「讠」は言 …のように、部品のほうが未収録なことが多い)
   */
  const onOf = (ch: string): string[] => {
    const own = readingsOf(ch).filter(isKatakana);
    if (own.length) return own;
    const nfc = canonical(ch);
    if (nfc) {
      const via = readingsOf(nfc).filter(isKatakana);
      if (via.length) return via;
    }
    for (const v of unihan.variants.get(ch) ?? []) {
      if (v === ch) continue;
      const via = readingsOf(v).filter(isKatakana);
      if (via.length) return via;
    }
    return [];
  };

  /** その字に読みが1つでもあるか(正式・資料どちらでも) */
  const hasReading = (ch: string): boolean => readingsOf(ch).length > 0;

  /** 分解の1段目に出てくる部品(IDCと未符号化の目印は除く) */
  const directParts = (ch: string): string[] => {
    const ids = idsMap.get(ch) ?? "";
    const out: string[] = [];
    for (const t of ids) {
      if (isIDC(t) || t === "？" || t === ch) continue;
      out.push(base(t));
    }
    return out;
  };

  /**
   * 声符(部品)から音を推す。形声字は「部首＝意味・もう片方＝音」でできているので、
   * **部首でないほうの部品**の音をその字の音とみなす。
   * 声符は右か下に来ることが多いので、候補が複数なら末尾を採る。
   */
  const fromParts = (ch: string): { ref: string[]; from: string } => {
    const parts = directParts(ch);
    if (parts.length < 2) return { ref: [], from: "" };
    const n = unihan.radical.get(ch) ?? 0;
    const rad = n ? base(radicalChar(n)) : "";
    const radForm = RADICAL_FORM.get(rad) ?? rad;
    const cands = parts.filter((p) => p !== rad && p !== radForm && onOf(p).length);
    if (!cands.length) return { ref: [], from: "" };
    const from = cands[cands.length - 1];
    return { ref: onOf(from).slice(0, 2), from };
  };

  const cache = new Map<string, RefReading>();

  /** 送り仮名・接辞の目印を落として、かなを揃える(重複を見るため) */
  const key = (s: string) =>
    s.replace(/[.\-]/g, "").replace(/[ァ-ヶ]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0x60),
    );

  return function ref(ch: string): RefReading {
    const hit = cache.get(ch);
    if (hit) return hit;

    let out = EMPTY;
    const info = kanjidic.get(ch);
    if (info && (info.on.length || info.kun.length)) {
      // 正式な読みがある字。**上書きはしない**が、資料(Unihan)にしか無い読み
      // (呉音・古訓・慣用)は参考として足す。人名(nanori)と重なるぶんは落とす
      const known = new Set(
        [...info.on, ...info.kun, ...info.nanori].map(key),
      );
      const add = (unihan.japanese.get(ch) ?? []).filter((r) => !known.has(key(r)));
      if (add.length) out = { ref: add.slice(0, MAX_READINGS), kind: "u", from: "" };
    } else {
      const jp = unihan.japanese.get(ch) ?? [];
      const nfc = canonical(ch);
      // 互換漢字は統合漢字と同じ字。異体字を探すより先にこちらを見る
      const twin = nfc && hasReading(nfc)
        ? nfc
        : (unihan.variants.get(ch) ?? []).find((v) => v !== ch && hasReading(v));
      if (jp.length) {
        out = { ref: jp.slice(0, MAX_READINGS), kind: "u", from: "" };
      } else if (twin) {
        out = { ref: readingsOf(twin).slice(0, MAX_READINGS), kind: "v", from: twin };
      } else {
        const p = fromParts(ch);
        if (p.ref.length) out = { ref: p.ref, kind: "p", from: p.from };
      }
    }
    cache.set(ch, out);
    return out;
  };
}
