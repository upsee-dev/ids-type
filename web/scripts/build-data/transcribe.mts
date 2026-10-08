// 外国語の読みを、**聞こえたとおりに**カタカナへ書き写す。
//
// IRG ワーキングセットの審査資料には、提案した国・地域がその字の読みを
// 自分の言語で書き添えている(拼音・ハングル・ベトナム語・壮語)。日本語の
// 読みではないので、日本語の音読みに「寄せる」ことはしない ── それは推定になる。
// ここでやるのは表記の置き換えだけ:
//
//   中国語   yǐn → イン ・ zhào → ジャオ ・ qiāo → チャオ
//   韓国語   익 → イク ・ 명 → ミョン ・ 최 → チェ
//   ベトナム語 chuỗi → チュオイ ・ sách → サック ・ năm → ナム
//   壮語     caeux → シャウ ・ aep → アプ ・ cim → シム
//
// どの言語もカナの書き方は1つに決まっていないので、ここでは新聞・放送で
// よく見る書き方に寄せた(中国語の e はオ段、韓国語の ㅓ はオ、ベトナム語の
// v はバ行、など)。声調は落とす。**必ず原語と一緒に持って回り**、アプリでは
// 「中国語音 yǐn」のように原語を添えて出す(日本語の読みと同じ顔で出さない)。

/** 行ごとのカナ。[ア段, イ段, ウ段, エ段, オ段] */
type Row = [string, string, string, string, string];

const V = "aiueo";

/** 小さい字を付けて拗音・合拗音を作る */
const SMALL_Y: Record<string, string> = { a: "ャ", u: "ュ", o: "ョ", e: "ェ", i: "ィ" };
const SMALL_W: Record<string, string> = { a: "ァ", i: "ィ", e: "ェ", o: "ォ", u: "" };

/** 行の拗音(キャ・キュ・キョ)。イ段が「シ・チ・ジ」なら小さいャで足りる */
function yoon(row: Row, v: string): string {
  if (row[0] === "ア") return { a: "ヤ", i: "イ", u: "ユ", e: "イェ", o: "ヨ" }[v] ?? "";
  return row[1] + (SMALL_Y[v] ?? "");
}

/** 行の合拗音(クァ・クォ)。ア行は「ワ・ウィ・ウェ・ウォ」 */
function goyoon(row: Row, v: string): string {
  if (row[0] === "ア") return { a: "ワ", i: "ウィ", u: "ウ", e: "ウェ", o: "ウォ" }[v] ?? "";
  if (v === "u") return row[2];
  return row[2] + (SMALL_W[v] ?? "");
}

/** 声調・補助記号を落として小文字にする(ベトナム語の字母の区別は残さない版) */
function plain(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * 1つの値に読みが複数並んでいることがある("kuì, hǎo" / "vâm vầm")。
 * かっこの中は注記なので落とす("nâu [JY: thau5]" の [ ] は別の方言の音、"nah[st: cid]" も同じ)
 */
export function splitReadings(value: string): string[] {
  return value
    .replace(/[（(][^)）]*[)）]/g, " ")
    .replace(/[\[［][^\]］]*[\]］]/g, " ")
    .split(/[,，、;；/／\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ── 中国語(拼音) ────────────────────────────────────────────────

const PY_ROWS: Record<string, Row> = {
  "": ["ア", "イ", "ウ", "エ", "オ"],
  b: ["バ", "ビ", "ブ", "ベ", "ボ"],
  p: ["パ", "ピ", "プ", "ペ", "ポ"],
  m: ["マ", "ミ", "ム", "メ", "モ"],
  f: ["ファ", "フィ", "フ", "フェ", "フォ"],
  d: ["ダ", "ディ", "ドゥ", "デ", "ド"],
  t: ["タ", "ティ", "トゥ", "テ", "ト"],
  n: ["ナ", "ニ", "ヌ", "ネ", "ノ"],
  l: ["ラ", "リ", "ル", "レ", "ロ"],
  g: ["ガ", "ギ", "グ", "ゲ", "ゴ"],
  k: ["カ", "キ", "ク", "ケ", "コ"],
  h: ["ハ", "ヒ", "フ", "ヘ", "ホ"],
  j: ["ジャ", "ジ", "ジュ", "ジェ", "ジョ"],
  q: ["チャ", "チ", "チュ", "チェ", "チョ"],
  x: ["シャ", "シ", "シュ", "シェ", "ショ"],
  zh: ["ジャ", "ジ", "ジュ", "ジェ", "ジョ"],
  ch: ["チャ", "チ", "チュ", "チェ", "チョ"],
  sh: ["シャ", "シ", "シュ", "シェ", "ショ"],
  r: ["ラ", "リ", "ル", "レ", "ロ"],
  // zi・ci・si の i は舌先の母音。ズ・ツ・ス と書くのが通り相場
  z: ["ザ", "ズ", "ズ", "ゼ", "ゾ"],
  c: ["ツァ", "ツ", "ツ", "ツェ", "ツォ"],
  s: ["サ", "ス", "ス", "セ", "ソ"],
};
const PY_INITIALS = ["zh", "ch", "sh", "b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h", "j", "q", "x", "r", "z", "c", "s"];

/** 韻母 → [介音(""/"i"/"u"/"ü"), 主母音(aiueo), 末尾のカナ] */
const PY_FINALS: Record<string, [string, string, string]> = {
  a: ["", "a", ""], o: ["", "o", ""], e: ["", "o", ""], "ê": ["", "e", ""], i: ["", "i", ""], u: ["", "u", ""], "ü": ["ü", "u", ""],
  ai: ["", "a", "イ"], ei: ["", "e", "イ"], ao: ["", "a", "オ"], ou: ["", "o", "ウ"],
  an: ["", "a", "ン"], en: ["", "e", "ン"], ang: ["", "a", "ン"], eng: ["", "o", "ン"], ong: ["", "o", "ン"], er: ["", "a", "ル"],
  ia: ["i", "a", ""], ie: ["i", "e", ""], iao: ["i", "a", "オ"], iou: ["i", "o", ""],
  ian: ["i", "e", "ン"], in: ["", "i", "ン"], iang: ["i", "a", "ン"], ing: ["", "i", "ン"], iong: ["i", "o", "ン"],
  ua: ["u", "a", ""], uo: ["u", "o", ""], uai: ["u", "a", "イ"], ui: ["u", "i", ""], uei: ["u", "e", "イ"],
  uan: ["u", "a", "ン"], un: ["", "u", "ン"], uen: ["u", "e", "ン"], uang: ["u", "a", "ン"], ueng: ["u", "o", "ン"],
  "üe": ["ü", "e", ""], "üan": ["ü", "e", "ン"], "ün": ["ü", "u", "ン"],
};

/** 拼音1音節 → カタカナ。声調(記号・数字)は落とす。読めなければ "" */
export function pinyinToKana(raw: string): string {
  let s = raw.normalize("NFD").toLowerCase();
  // ü は u + 分音記号(U+0308)。ほかの声調記号と一緒に落とす前に拾う
  s = s.replace(/ü/g, "ü").replace(/[̀-ͯ]/g, "").replace(/[1-5]$/, "").replace(/v/g, "ü");
  if (!/^[a-zü]+$/.test(s)) return "";
  // 儿化(-r)は落とす(huar → hua)。er そのものは残す
  if (s.length > 2 && s.endsWith("r") && !s.endsWith("er")) s = s.slice(0, -1);

  let ini = "";
  for (const c of PY_INITIALS) if (s.startsWith(c)) { ini = c; break; }
  let fin = s.slice(ini.length);

  // y・w は介音の書き換え(yi=i, ya=ia, yu=ü, wu=u, wa=ua …)
  if (!ini && fin.startsWith("y")) {
    fin = fin.slice(1);
    fin = fin.startsWith("u") ? "ü" + fin.slice(1) : fin.startsWith("i") ? fin : "i" + fin;
  } else if (!ini && fin.startsWith("w")) {
    fin = fin.slice(1);
    fin = fin.startsWith("u") ? fin : "u" + fin;
  }
  // j・q・x のあとの u は ü(ju=jü, xuan=xüan)
  if ((ini === "j" || ini === "q" || ini === "x") && fin.startsWith("u")) fin = "ü" + fin.slice(1);
  if (fin === "iu") fin = "iou";

  const f = PY_FINALS[fin];
  if (!f) return "";
  const [medial, vowel, tail] = f;
  const row = PY_ROWS[ini] ?? PY_ROWS[""];
  let head: string;
  if (fin === "iou") {
    // 九 jiu → ジウ・刘 liu → リウ・有 you → ヨウ
    head = ini ? row[1] + "ウ" : "ヨウ";
  } else if (medial === "i") {
    // ie・ian はイ段＋エ(别 bie → ビエ・天 tian → ティエン・烟 yan → イエン)。
    // ia・iao・iang・iong は拗音(家 jia → ジャ・小 xiao → シャオ・兄 xiong → ション)
    if (vowel === "e") head = (ini ? row[1] : "イ") + "エ";
    else if (ini === "d" || ini === "t") head = row[1] + "アイウエオ"[V.indexOf(vowel)];
    else head = yoon(row, vowel);
  } else if (medial === "ü") {
    // 局 ju → ジュ・学 xue → シュエ・元 yuan → ユエン・绿 lü → リュ
    head = yoon(row, "u") + (vowel === "e" ? "エ" : "");
  } else if (medial === "u") {
    // 瓜 gua → グア・国 guo → グオ・贵 gui → グイ・王 wang → ワン・为 wei → ウェイ
    head = ini ? row[2] + "アイウエオ"[V.indexOf(vowel)] : goyoon(row, vowel);
  } else {
    head = row[V.indexOf(vowel)];
  }
  return head + tail;
}

// ── 韓国語(ハングル) ────────────────────────────────────────────

/** 初声19 → 行。ㄱ・ㄷ・ㅂ・ㅈ は語頭の清音で書く(김 キム・박 パク・정 チョン) */
const KO_INITIAL: Row[] = (
  [
    "カキクケコ", "カキクケコ", "ナニヌネノ", "タティトゥテト", "タティトゥテト", "ラリルレロ", "マミムメモ",
    "パピプペポ", "パピプペポ", "サシスセソ", "サシスセソ", "アイウエオ", "チャチチュチェチョ", "チャチチュチェチョ",
    "チャチチュチェチョ", "カキクケコ", "タティトゥテト", "パピプペポ", "ハヒフヘホ",
  ] as const
).map(splitRow);

/** 中声21 → [介音(""/"y"/"w"), 母音] */
const KO_VOWEL: [string, string][] = [
  ["", "a"], ["", "e"], ["y", "a"], ["y", "e"], ["", "o"], ["", "e"], ["y", "o"], ["y", "e"],
  ["", "o"], ["w", "a"], ["w", "e"], ["w", "e"], ["y", "o"], ["", "u"], ["w", "o"], ["w", "e"],
  ["w", "i"], ["y", "u"], ["", "u"], ["w", "i"], ["", "i"],
];

/** 終声28 → カナ(국 クク・한 ハン・일 イル・십 シプ・강 カン) */
const KO_FINAL = ["", "ク", "ク", "ク", "ン", "ン", "ン", "ッ", "ル", "ク", "ム", "ル", "ル", "ル", "プ", "ル", "ム", "プ", "プ", "ッ", "ッ", "ン", "ッ", "ッ", "ク", "ッ", "プ", "ッ"];

/** "カキクケコ" / "チャチチュチェチョ" を5つに切る */
function splitRow(s: string): Row {
  const out: string[] = [];
  const cs = [...s];
  for (let i = 0; i < cs.length; i++) {
    if (i + 1 < cs.length && "ャュョァィゥェォ".includes(cs[i + 1])) {
      out.push(cs[i] + cs[i + 1]);
      i++;
    } else if (cs[i] === "ト" && cs[i + 1] === "ゥ") {
      out.push("トゥ");
      i++;
    } else out.push(cs[i]);
  }
  return out as Row;
}

/** ハングル(1字でも語でも) → カタカナ。ハングル以外が混じれば "" */
export function hangulToKana(raw: string): string {
  let out = "";
  for (const ch of raw.trim()) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0xac00 || cp > 0xd7a3) return "";
    const n = cp - 0xac00;
    const row = KO_INITIAL[Math.floor(n / 588)];
    const vi = Math.floor(n / 28) % 21;
    // ㅢ は語頭(의)だけ ウィ、子音のあと(희)は イ段
    const [glide, v] = vi === 19 && row[0] !== "ア" ? ["", "i"] : KO_VOWEL[vi];
    const palatal = row[0] === "チャ";
    let syl: string;
    if (glide === "y") syl = palatal ? row[V.indexOf(v)] : yoon(row, v);
    else if (glide === "w") syl = palatal && v === "e" ? "チェ" : goyoon(row, v);
    else syl = row[V.indexOf(v)];
    out += syl + KO_FINAL[n % 28];
  }
  return out;
}

// ── ベトナム語(クオック・グー) ──────────────────────────────────

/** 頭子音 → 行(北部の発音。d・gi・r はザ行、s・x はサ行、v はバ行) */
const VI_ROWS: [string, Row][] = (
  [
    ["ngh", "ガギグゲゴ"], ["ng", "ガギグゲゴ"], ["nh", "ニャニニュニェニョ"], ["ch", "チャチチュチェチョ"],
    ["tr", "チャチチュチェチョ"], ["th", "タティトゥテト"], ["kh", "カキクケコ"], ["ph", "ファフィフフェフォ"],
    ["gh", "ガギグゲゴ"], ["gi", "ザジズゼゾ"], ["qu", "クァクィククェクォ"], ["b", "バビブベボ"], ["c", "カキクケコ"],
    ["k", "カキクケコ"], ["d", "ザジズゼゾ"], ["đ", "ダディドゥデド"], ["g", "ガギグゲゴ"], ["h", "ハヒフヘホ"],
    ["l", "ラリルレロ"], ["m", "マミムメモ"], ["n", "ナニヌネノ"], ["r", "ザジズゼゾ"], ["s", "サシスセソ"],
    ["t", "タティトゥテト"], ["v", "バビブベボ"], ["x", "サシスセソ"],
    // ベトナム語には無いが、V源に混ざるタイー語・ヌン語の字(pác・pích)の頭子音
    ["p", "パピプペポ"],
  ] as const
).map(([k, r]) => [k, splitRow(r)] as [string, Row]);

/** 末子音 → カナ(sách サック・Việt ヴィエット・Minh ミン) */
const VI_FINALS: [string, string][] = [
  ["ng", "ン"], ["nh", "ン"], ["ch", "ック"], ["c", "ック"], ["m", "ム"], ["n", "ン"], ["p", "ップ"], ["t", "ット"],
];

/** ベトナム語の字母 → 母音(aiueo)。ă・â は ア、ơ・ô は オ、ư は ウ */
const VI_VOWEL: Record<string, string> = {
  a: "a", "ă": "a", "â": "a", e: "e", "ê": "e", i: "i", y: "i", o: "o", "ô": "o", "ơ": "o", u: "u", "ư": "u",
};

/** ベトナム語1音節 → カタカナ */
export function vietnameseToKana(raw: string): string {
  // 声調の記号(̀ ́ ̃ ̉ ̣)だけ落とし、ă・â・ê・ô・ơ・ư・đ の区別は残す
  const s = raw
    .normalize("NFD")
    .replace(/[̣̀́̃̉]/g, "")
    .normalize("NFC")
    .toLowerCase();
  if (!/^[a-zăâêôơưđ]+$/.test(s)) return "";
  let rest = s;
  let row: Row = PY_ROWS[""];
  for (const [k, r] of VI_ROWS) {
    if (rest.startsWith(k)) {
      // gi は後ろに母音が無いとき(gì)だけ g + i
      if (k === "gi" && !/[aăâeêoôơuưy]/.test(rest.slice(2))) {
        row = splitRow("ザジズゼゾ");
        rest = rest.slice(1);
      } else {
        row = r;
        rest = rest.slice(k.length);
      }
      break;
    }
  }
  let tail = "";
  for (const [k, kana] of VI_FINALS) {
    if (rest.endsWith(k) && rest.length > k.length) {
      tail = kana;
      rest = rest.slice(0, -k.length);
      break;
    }
  }
  const vowels = [...rest].map((c) => VI_VOWEL[c]);
  if (!vowels.length || vowels.some((v) => !v)) return "";
  // 1つめの母音を行と組み、残りはア行のまま並べる(chuỗi → チュ・オ・イ)
  let out = row[V.indexOf(vowels[0])];
  for (const v of vowels.slice(1)) out += "アイウエオ"[V.indexOf(v)];
  return out + tail;
}

// ── 壮語(1982年方式のローマ字) ─────────────────────────────────

/** 頭子音 → 行。c は [ɕ] でシャ行、s は [θ] でサ行、r は [ɣ] だが字面どおりラ行 */
const ZA_ROWS: [string, Row][] = (
  [
    ["ngv", "グァグィググェグォ"], ["mb", "バビブベボ"], ["nd", "ダディドゥデド"], ["gv", "グァグィググェグォ"],
    ["ng", "ガギグゲゴ"], ["ny", "ニャニニュニェニョ"], ["gy", "キャキキュキェキョ"], ["by", "ピャピピュピェピョ"],
    ["my", "ミャミミュミェミョ"], ["b", "パピプペポ"], ["m", "マミムメモ"], ["f", "ファフィフフェフォ"],
    ["v", "ワウィウウェウォ"], ["d", "タティトゥテト"], ["n", "ナニヌネノ"], ["s", "サシスセソ"], ["l", "ラリルレロ"],
    ["g", "カキクケコ"], ["h", "ハヒフヘホ"], ["c", "シャシシュシェショ"], ["y", "ヤイユイェヨ"], ["r", "ラリルレロ"],
    ["k", "カキクケコ"], ["p", "パピプペポ"], ["t", "タティトゥテト"], ["z", "ツァツィツツェツォ"],
  ] as const
).map(([k, r]) => [k, splitRow(r)] as [string, Row]);

/** 壮語1音節 → カタカナ(caeux シャウ・aep アプ・cim シム) */
export function zhuangToKana(raw: string): string {
  let s = plain(raw);
  if (!/^[a-z]+$/.test(s)) return "";
  // 声調は音節末の字で書く(z j x q h)。母音か鼻音のあとに来たときだけ落とす
  if (s.length > 1 && /[zjxqh]$/.test(s) && /[aeiouwmng]$/.test(s.slice(0, -1))) s = s.slice(0, -1);
  let row: Row = PY_ROWS[""];
  for (const [k, r] of ZA_ROWS) {
    if (s.startsWith(k) && /[aeiouw]/.test(s[k.length] ?? "")) {
      row = r;
      s = s.slice(k.length);
      break;
    }
  }
  let tail = "";
  const fin = s.match(/(ng|m|n|p|b|t|d|k|g)$/);
  if (fin) {
    tail = { ng: "ン", m: "ム", n: "ン", p: "プ", b: "プ", t: "ツ", d: "ツ", k: "ク", g: "ク" }[fin[1]]!;
    s = s.slice(0, -fin[1].length);
  }
  // ae・oe・ie・ue・we の e は「短い母音」の印。音としては前の母音だけ
  s = s.replace(/([aoiuw])e/g, "$1").replace(/w/g, "u");
  const vowels = [...s].filter((c) => V.includes(c));
  if (!vowels.length || vowels.length !== s.length) return "";
  let out = row[V.indexOf(vowels[0])];
  for (const v of vowels.slice(1)) out += "アイウエオ"[V.indexOf(v)];
  return out + tail;
}

// ── まとめ ──────────────────────────────────────────────────────

export type ForeignLang = "zh" | "za" | "ko" | "vi";

export const FOREIGN_LANG_NAME: Record<ForeignLang, string> = {
  zh: "中国語",
  za: "壮語",
  ko: "韓国語",
  vi: "ベトナム語",
};

/** 言語を指定して1語をカタカナに。読めなければ "" */
export function transcribe(lang: ForeignLang, reading: string): string {
  switch (lang) {
    case "zh":
      return pinyinToKana(reading);
    case "ko":
      return hangulToKana(reading);
    case "vi":
      return vietnameseToKana(reading);
    case "za":
      return zhuangToKana(reading);
  }
}

// ── かなの揃え ──────────────────────────────────────────────────

/** カタカナ → ひらがな(索引の見出しを揃えるため) */
export function toHiragana(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}
