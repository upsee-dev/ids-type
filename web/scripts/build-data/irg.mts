// IRG ワーキングセットの読みを字に結びつける。
//
// 元は web/scripts/fetch-irg.mts が審査ツール(hc.jsecs.org/irg/<ws>/app/)から
// 集めた data-src/irg/<ws>.jsonl。提案した国・地域が、その字の読みを
// 自分の言語で書き添えている：
//
//   WS2017  G「Optional Information」 "(Reading: aep)" / "(Reading: qi2)"
//           V「Reading」             "(Reading: sách)"
//   WS2021  T・G「l) Optional info」  "yǐn" / "au"
//           V「Reading」             "chuỗi"
//   WS2024  各源の「Pronunciation」   "kuì, hǎo" / "익" / "năm nôm" / "caeux"
//   WS2015  読みの欄が無い(英語の備考に他の字の拼音が出てくるだけなので採らない)
//
// 何語かは源の記号で決まる。K源=韓国語、V源=ベトナム語、G源のうち
// 古壮字の字典から出たもの(GZ・GZA・GPGLG・GLGYJ)=壮語、それ以外(T源・G源)=中国語。
//
// 符号位置は Unihan の kIRG_*Source で引く。まだ符号化されていない字
// (保留・統合・取り下げ・審査中)は Unihan に記号が無いので、ここで落ちる。
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_SRC } from "./paths.mts";
import { splitReadings, transcribe, type ForeignLang } from "./transcribe.mts";

/**
 * IRG の源の記号を突き合わせ用に揃える。ワーキングセットと Unihan で
 * 書き方が少し違う(WS2015 の GHZR10014.07 ⇔ Unihan の GHZR-10014.07、
 * WS2017 の USAT00077 ⇔ SAT-00077、WS2017 の V-F1634 ⇔ VN-F1634)ので、
 * ハイフンを落として USAT を SAT に、V-F を VN-F にする
 */
export function normalizeIrgRef(ref: string): string {
  return ref.trim().toUpperCase().replace(/^USAT/, "SAT").replace(/[-\s]/g, "").replace(/^VF/, "VNF");
}

export const WORKSETS = ["ws2015", "ws2017", "ws2021", "ws2024"] as const;

export type IrgReading = {
  lang: ForeignLang;
  /** 資料にあるままの読み("yǐn") */
  reading: string;
  /** カタカナに書き写したもの("イン") */
  kana: string;
  /** 源の記号("T11-2123")とワーキングセット */
  ref: string;
  ws: string;
};

type Page = { sn: string; sources: Record<string, Record<string, string>> };

/** G源のうち壮語の読みが書かれている字典(古壮字字典 GZ・GZA、広西の地方の古壮字 GPGLG・GLGYJ) */
const ZHUANG_SOURCES = /^G(Z|ZA|PGLG|LGYJ)-/;

export function irgLang(ref: string): ForeignLang {
  if (/^K/.test(ref)) return "ko";
  if (/^V/.test(ref)) return "vi";
  if (ZHUANG_SOURCES.test(ref)) return "za";
  return "zh";
}

/** 読みが書かれる欄。Optional info は T源・G源のときだけ読み(ほかの源では自由記述) */
function readingFields(ref: string, row: Record<string, string>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(row)) {
    const key = k.trim().toLowerCase();
    if (key === "pronunciation" || key === "reading") out.push(v);
    else if (/^(l\)\s*)?optional info(rmation)?$/.test(key) && /^[TG]/.test(ref)) out.push(v);
  }
  return out;
}

/** "(Reading: aep)" の囲みを外す */
function unwrap(v: string): string {
  return v.replace(/^\(\s*reading\s*:\s*/i, "").replace(/\)\s*$/, "").trim();
}

/**
 * 読みに付いた言語の印。WS2024 の UK・UTC 源は、1つの欄に複数の言語を
 * 「sī (Mand.)」「roengz (Zhuang)」「かみ (J)」「gan2 (C)」の形で並べている。
 * 印があればそちらを信じる(源の記号からは決めない)
 */
const LANG_TAGS: [RegExp, ForeignLang][] = [
  [/^(m|mand\.?|mandarin)$/i, "zh"],
  [/^zhuang$/i, "za"],
  [/^(k|kor\.?|korean)$/i, "ko"],
  [/^(v|viet\.?|vietnamese)$/i, "vi"],
];

/**
 * 1つの欄の値を、言語つきの読みに切り分ける。
 * 日本語(J)・広東語(C / Cant.)・方言の IPA など、書き写さない印の付いた読みは落とす
 * (日本語の印つきは WS2024 の UTC 源に25件あるが、どれもまだ符号化されていない)
 */
function readingsIn(ref: string, value: string, inc: (k: string) => void): { lang: ForeignLang; reading: string }[] {
  const out: { lang: ForeignLang; reading: string }[] = [];
  for (const part of value.split(/[,;，；、]/)) {
    const m = part.match(/^(.*?)\s*[（(]\s*([^)）]+?)\s*[)）]\s*$/);
    let lang: ForeignLang = irgLang(ref);
    let text = part;
    if (m) {
      const tag = LANG_TAGS.find(([re]) => re.test(m[2]));
      if (!tag) {
        inc(`言語の印で外した読み(${m[2].slice(0, 12)})`);
        continue;
      }
      lang = tag[1];
      text = m[1];
    }
    for (const reading of splitReadings(text)) out.push({ lang, reading });
  }
  return out;
}

export function loadIrgReadings(irgSources: Map<string, string>): {
  byChar: Map<string, IrgReading[]>;
  counts: Record<string, number>;
} {
  const byChar = new Map<string, IrgReading[]>();
  const counts: Record<string, number> = {};
  const inc = (k: string, n = 1) => (counts[k] = (counts[k] ?? 0) + n);

  for (const ws of WORKSETS) {
    const file = join(DATA_SRC, "irg", `${ws}.jsonl`);
    if (!existsSync(file)) {
      console.warn(`!! ${file} が無い(web で npm run fetch:irg を回して取る)`);
      continue;
    }
    // 取り直しで同じ番号が2回書かれていることがあるので、番号ごとに後勝ちで畳む
    const pages = new Map<string, Page>();
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line) continue;
      try {
        const p = JSON.parse(line) as Page;
        pages.set(p.sn, p);
      } catch {
        // 取得の途中で切れた行
      }
    }
    inc(`${ws} ページ`, pages.size);
    for (const page of pages.values()) {
      for (const [ref, row] of Object.entries(page.sources)) {
        if (ref === "*") continue;
        const values = readingFields(ref, row).map(unwrap).filter(Boolean);
        if (!values.length) continue;
        inc(`${ws} 読みのある源`);
        const ch = irgSources.get(normalizeIrgRef(ref));
        if (!ch) {
          inc(`${ws} 符号化されていない源`);
          continue;
        }
        const list = byChar.get(ch) ?? [];
        for (const value of values) {
          for (const { lang, reading } of readingsIn(ref, value, inc)) {
            const kana = transcribe(lang, reading);
            if (!kana) {
              inc(`書き写せなかった読み(${lang})`);
              continue;
            }
            if (list.some((r) => r.lang === lang && r.reading.toLowerCase() === reading.toLowerCase())) continue;
            list.push({ lang, reading, kana, ref, ws });
            inc(`${ws} 読み(${lang})`);
          }
        }
        if (list.length) byChar.set(ch, list);
      }
    }
  }
  counts["読みの付いた字"] = byChar.size;
  return { byChar, counts };
}
