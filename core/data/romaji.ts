// ローマ字 → かな。ローマ字入力と Godan の両方がこれを使う。
//
// 読みを打つ面はアプリの中に持っている(端末のIMEへ往復させると、変換が
// 始まった瞬間に欄ごと持っていかれる)。フリックだけだとローマ字に慣れた人が
// 打てないので、同じ読み欄へローマ字からも入れられるようにする。
//
// **打ちかけを残す**のが要点。"k" の時点ではまだ かな にできないので、
// 未確定の部分を buffer として返し、次の字が来たら合わせて変換する。
// 画面はこれを「か|k」のように出す(未確定はグレー)。

/** 変換結果。kana は確定したぶん、rest は打ちかけ(次のキーを待つ) */
export interface RomajiResult {
  kana: string;
  rest: string;
}

/** ローマ字 -> かな。Kotlin/Swift へは build:data がこの表を書き出す */
export const ROMAJI_TABLE: Record<string, string> = {
  a:"あ", i:"い", u:"う", e:"え", o:"お",
  ka:"か", ki:"き", ku:"く", ke:"け", ko:"こ",
  ga:"が", gi:"ぎ", gu:"ぐ", ge:"げ", go:"ご",
  sa:"さ", si:"し", shi:"し", su:"す", se:"せ", so:"そ",
  za:"ざ", zi:"じ", ji:"じ", zu:"ず", ze:"ぜ", zo:"ぞ",
  ta:"た", ti:"ち", chi:"ち", tu:"つ", tsu:"つ", te:"て", to:"と",
  da:"だ", di:"ぢ", du:"づ", de:"で", do:"ど",
  na:"な", ni:"に", nu:"ぬ", ne:"ね", no:"の",
  ha:"は", hi:"ひ", hu:"ふ", fu:"ふ", he:"へ", ho:"ほ",
  ba:"ば", bi:"び", bu:"ぶ", be:"べ", bo:"ぼ",
  pa:"ぱ", pi:"ぴ", pu:"ぷ", pe:"ぺ", po:"ぽ",
  ma:"ま", mi:"み", mu:"む", me:"め", mo:"も",
  ya:"や", yu:"ゆ", yo:"よ", ye:"いぇ",
  ra:"ら", ri:"り", ru:"る", re:"れ", ro:"ろ",
  wa:"わ", wi:"うぃ", we:"うぇ", wo:"を",
  nn:"ん", "n'":"ん",
  kya:"きゃ", kyu:"きゅ", kyo:"きょ", kye:"きぇ",
  gya:"ぎゃ", gyu:"ぎゅ", gyo:"ぎょ",
  sha:"しゃ", shu:"しゅ", sho:"しょ", she:"しぇ",
  sya:"しゃ", syu:"しゅ", syo:"しょ",
  ja:"じゃ", ju:"じゅ", jo:"じょ", je:"じぇ",
  jya:"じゃ", jyu:"じゅ", jyo:"じょ", zya:"じゃ", zyu:"じゅ", zyo:"じょ",
  cha:"ちゃ", chu:"ちゅ", cho:"ちょ", che:"ちぇ",
  tya:"ちゃ", tyu:"ちゅ", tyo:"ちょ",
  nya:"にゃ", nyu:"にゅ", nyo:"にょ",
  hya:"ひゃ", hyu:"ひゅ", hyo:"ひょ",
  bya:"びゃ", byu:"びゅ", byo:"びょ",
  pya:"ぴゃ", pyu:"ぴゅ", pyo:"ぴょ",
  mya:"みゃ", myu:"みゅ", myo:"みょ",
  rya:"りゃ", ryu:"りゅ", ryo:"りょ",
  fa:"ふぁ", fi:"ふぃ", fe:"ふぇ", fo:"ふぉ",
  va:"ゔぁ", vi:"ゔぃ", vu:"ゔ", ve:"ゔぇ", vo:"ゔぉ",
  tsa:"つぁ", tsi:"つぃ", tse:"つぇ", tso:"つぉ",
  dya:"ぢゃ", dyu:"ぢゅ", dyo:"ぢょ",
  xa:"ぁ", xi:"ぃ", xu:"ぅ", xe:"ぇ", xo:"ぉ",
  la:"ぁ", li:"ぃ", lu:"ぅ", le:"ぇ", lo:"ぉ",
  xtu:"っ", ltu:"っ", xya:"ゃ", xyu:"ゅ", xyo:"ょ",
  "-":"ー",
};

/** そのローマ字で始まる表の項目があるか(打ちかけを捨てないため) */
function isPrefix(s: string): boolean {
  for (const k in ROMAJI_TABLE) if (k.startsWith(s)) return true;
  return false;
}

const VOWELS = "aiueo";

/**
 * ローマ字の並びをかなに直す。打ちかけは rest に残る。
 *
 *   "kanji"  -> かんじ           "ky"   -> ""(rest="ky")
 *   "kitte"  -> きって           "sinn" -> しん
 *   "n"      -> ""(rest="n")     "nk"   -> ん(rest="k")
 */
export function romajiToKana(input: string): RomajiResult {
  let kana = "";
  let buf = input.toLowerCase();
  let rest = "";
  while (buf) {
    // 促音: 同じ子音が2つ続いたら「っ」
    if (
      buf.length >= 2 &&
      buf[0] === buf[1] &&
      !VOWELS.includes(buf[0]) &&
      buf[0] !== "n"
    ) {
      kana += "っ";
      buf = buf.slice(1);
      continue;
    }
    // 表から最長一致で取る
    let hit = "";
    for (let n = Math.min(3, buf.length); n >= 1; n--) {
      const k = buf.slice(0, n);
      if (ROMAJI_TABLE[k]) {
        hit = k;
        break;
      }
    }
    if (hit) {
      // "n" は次が母音や y なら「な行」になりうるので、続きがある間は待つ
      if (hit === "n" && buf.length === 1) {
        rest = buf;
        break;
      }
      kana += ROMAJI_TABLE[hit];
      buf = buf.slice(hit.length);
      continue;
    }
    // 「ん」の1文字確定(nk → ん + k)
    if (buf[0] === "n" && buf.length >= 2 && !"aiueoy'".includes(buf[1])) {
      kana += "ん";
      buf = buf.slice(1);
      continue;
    }
    // まだ表に無いが、続けば当たるかもしれない打ちかけ
    if (isPrefix(buf)) {
      rest = buf;
      break;
    }
    // どうやっても かな にならない1字は捨てる
    buf = buf.slice(1);
  }
  return { kana, rest };
}

/** 打ちかけも含めて画面に出す形(未確定はそのまま後ろに付く) */
export function romajiDisplay(input: string): string {
  const { kana, rest } = romajiToKana(input);
  return kana + rest;
}
