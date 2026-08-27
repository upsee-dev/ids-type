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
   * 正式な読みが**1つも無い字**の、参考・推定の読み。on/kun がある字では常に空。
   * 出所は refKind で分かる
   */
  ref: string;
  /**
   * ref の出所。""=なし / "u"=資料(Unihan kJapanese) /
   * "v:X"=異体字 X から借りた / "p:X"=部品(声符)X からの推定。
   * 推定が当たるのは6割ほどなので、UI では必ず「推定」と断って出すこと
   */
  refKind: string;
  /** KANJIDIC2 に無い字(拡張A〜J ほか)。読み・学年を持たず、候補の並びでは最後に回す */
  ext: boolean;
}

/**
 * 参考・推定の読みの見出し。**4実装ともこの1か所の言い方に揃える**
 * (辞書にある読みと、こちらで推した読みを、UI で必ず区別するため)。
 *
 *   "u"    → 参考          … 資料(Unihan)にある読み。KANJIDIC2 の音訓ではない
 *   "v:專" → 推定(異体字 專) … 同じ字の別の書き方から借りた
 *   "p:青" → 推定(声符 青)   … 部品から推した。当たるのは6割ほど
 */
export function refReadingLabel(refKind: string): string {
  const from = refKind.length > 2 ? refKind.slice(2) : "";
  switch (refKind[0]) {
    case "u":
      return "参考";
    case "v":
      return from ? `推定(異体字 ${from})` : "推定(異体字)";
    case "p":
      return from ? `推定(声符 ${from})` : "推定(声符)";
    default:
      return "";
  }
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
   * [IDS, 学年, 頻度順位, 音, 訓, 画数, 部首番号, 意味(英), 人名読み, 参考の読み, 参考の出所]
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
    ]
  >;
  /**
   * それ以外の CJK 統合漢字・互換漢字。[IDS, 参考の読み, 参考の出所]。
   * IDS の "" は分解データなし、読みの "" は補完できなかった字
   */
  ext: Record<string, [string, string, string]>;
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
  offset?: number;
  limit?: number;
}

export interface ListPage {
  total: number;
  /** all | code | reading | structure | parts | empty */
  mode: string;
  items: { ch: string; meta: CharMeta }[];
}
