// 辞書(kanji-data.json)と検索結果の型。
//
// 読みは**正式かどうかで持ち場所を分けてある**。on/kun は KANJIDIC2 の音訓
// (＝正式)だけ、それ以外の「使われてはいるが正式ではない読み」は nanori と
// ref に入る。UI もこの区別のまま出す(辞書にある読みと無い読みを同じ顔で
// 出さない)。作り方は web/scripts/build-data/readings.mts を参照。
export interface CharMeta {
  ids: string;
  grade: number;
  freq: number;
  /** 正式な音読み(KANJIDIC2)。""=データなし */
  on: string;
  /** 正式な訓読み(KANJIDIC2)。""=データなし */
  kun: string;
  /** 画数。0=データなし */
  strokes: number;
  /** 康熙部首番号(1〜214)。0=データなし。字は radicalChar() で引ける */
  rad: number;
  /** 意味(KANJIDIC2の英語グロス)。""=データなし */
  meaning: string;
  /**
   * 人名でだけ使う読み(KANJIDIC2 の nanori)。正式な音訓ではないが実際に使われる。
   * 名前の字はこれが無いと読みで引けないので持っている
   */
  nanori: string;
  /**
   * 参考の読み。資料にしか無い日本語の読み(正式な音訓がある字にも付く)と、
   * 日本語の読みが1つも無い字の外国語の読みの書き写し。出所は refKind で分かる
   */
  ref: string;
  /**
   * ref の出所。""=なし / "u"=資料(Unihan kJapanese) / "w"=和製漢字の辞典 /
   * "j"=JK / "z"=zi.tools の音読み / "m"=手で足した読み /
   * "e:X"=互換漢字の元の字 X(同じ字) / "i:zh:yǐn"=IRG の外国語の読みの書き写し。
   * 外国語の読みは日本語の読みではないので、UI では必ず言語名と原語を添えて出すこと
   */
  refKind: string;
  /** KANJIDIC2 に無い字(拡張A〜J ほか)。読み・学年を持たず、候補の並びでは最後に回す */
  ext: boolean;
}

/** IRG の外国語の読みの言語 → 名前(web/scripts/build-data/transcribe.mts と同じ) */
const FOREIGN_LANG: Record<string, string> = {
  zh: "中国語",
  za: "壮語",
  ko: "韓国語",
  vi: "ベトナム語",
};

/**
 * 参考の読みの見出し。**4実装ともこの1か所の言い方に揃える**
 * (辞書にある日本語の読みと、外国語の読みの書き写しを、UI で必ず区別するため)。
 *
 *   "u"         → 参考             … 資料(Unihan)にある読み。KANJIDIC2 の音訓ではない
 *   "w"         → 参考(和製漢字)     … 『和製漢字の辞典2014』にある読み。国字はここにしか無い
 *   "j"         → 参考(国字)         … JK(IRG国字コレクション)にある読み
 *   "z"         → 参考(音読み)       … zi.tools の音読み(呉音・漢音・唐音の区別つき)
 *   "m"         → 参考(追加)         … どの資料にも無く、手で足した読み
 *   "e:塚"      → 参考(同じ字 塚)    … 互換漢字。統合漢字 塚 と同じ字なのでその読み
 *   "i:zh:yǐn"  → 中国語音 yǐn       … IRG で提案国が書き添えた読みをカナに書き写したもの
 *
 * 推定(異体字・声符・韓国語音・台湾音から推した読み)は 2026-09-29 にやめた。
 */
export function refReadingLabel(refKind: string): string {
  const from = refKind.length > 2 ? refKind.slice(2) : "";
  switch (refKind[0]) {
    case "u":
      return "参考";
    case "w":
      return "参考(和製漢字)";
    case "j":
      return "参考(国字)";
    case "z":
      return "参考(音読み)";
    case "m":
      return "参考(追加)";
    case "e":
      return from ? `参考(同じ字 ${from})` : "参考(同じ字)";
    case "i": {
      const colon = from.indexOf(":");
      const lang = FOREIGN_LANG[colon > 0 ? from.slice(0, colon) : from] ?? "外国語";
      const orig = colon > 0 ? from.slice(colon + 1).split("/").join("・") : "";
      return orig ? `${lang}音 ${orig}` : `${lang}音`;
    }
    default:
      return "";
  }
}

/**
 * 参考の読みが**日本語の読み**か(外国語の読みの書き写しでないか)。
 * 読みで引いたときの段を分けるのに使う(日本語の読み → 外国語の読みの順)
 */
export function isJapaneseRef(refKind: string): boolean {
  return refKind !== "" && refKind[0] !== "i";
}

/** 康熙部首番号(1〜214) → 部首の字(Kangxi Radicals ブロック U+2F00〜) */
export function radicalChar(n: number): string {
  return n >= 1 && n <= 214 ? String.fromCodePoint(0x2f00 + n - 1) : "";
}

export interface Result {
  ch: string;
  exact: boolean;
  meta: CharMeta;
}

export interface RawData {
  /**
   * KANJIDIC2 収録字。
   * [IDS, 学年, 頻度順位, 音, 訓, 画数, 部首番号, 意味(英), 人名読み, 参考の読み,
   *  参考の出所, 別の分解]
   *
   * 別の分解は空白区切り(無ければ "")。同じ字でも表によって切り方が違うので、
   * **どの組み合わせで打っても引ける**ように控えてある(merge.mts)
   */
  chars: Record<
    string,
    [
      string,
      number,
      number,
      string,
      string,
      number,
      number,
      string,
      string,
      string,
      string,
      string,
    ]
  >;
  /**
   * それ以外の CJK 統合漢字・互換漢字。[IDS, 参考の読み, 参考の出所, 画数, 別の分解]。
   * IDS の "" は分解データなし、読みの "" は補完できなかった字。
   * 画数は Unihan の kTotalStrokes(全字にある)。0=データなし
   */
  ext: Record<string, [string, string, string, number, string]>;
  /** 漢字でない部品(部首補助・筆画など)。検索候補には出さないが分解には使う */
  parts: Record<string, string>;
}

export interface ListQuery {
  /** Block.key。未指定は全ブロック */
  block?: string;
  /** 構造・部品・読み・コードポイントでの絞り込み */
  query?: string;
  /** KANJIDIC2 収録字(読みのある日本の漢字)だけに絞る */
  jaOnly?: boolean;
  /**
   * 画数で絞り込む。0/未指定は絞らない。
   * 画数は10万字ぜんぶにあるので(Unihan kTotalStrokes)、読みと重ねて使える。
   * 30 を指定したときだけは「30画以上」の意味にする(それ以上は数が少なく、
   * 1画きざみのチップを増やしても選びにくいだけなので)
   */
  strokes?: number;
  offset?: number;
  limit?: number;
}

export interface ListPage {
  total: number;
  /** all | code | reading | structure | parts | empty */
  mode: string;
  items: { ch: string; meta: CharMeta }[];
}
