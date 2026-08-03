// 辞書(kanji-data.json)と検索結果の型。
export interface CharMeta {
  ids: string;
  grade: number;
  freq: number;
  on: string;
  kun: string;
  /** 画数。0=データなし */
  strokes: number;
  /** 康熙部首番号(1〜214)。0=データなし。字は radicalChar() で引ける */
  rad: number;
  /** 意味(KANJIDIC2の英語グロス)。""=データなし */
  meaning: string;
  /** KANJIDIC2 に無い字(拡張A〜J ほか)。読み・学年を持たず、候補の並びでは最後に回す */
  ext: boolean;
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
  /** KANJIDIC2 収録字。[IDS, 学年, 頻度順位, 音, 訓, 画数, 部首番号, 意味(英)] */
  chars: Record<
    string,
    [string, number, number, string, string, number, number, string]
  >;
  /** それ以外の CJK 統合漢字・互換漢字。IDS のみ("" = 分解データなし) */
  ext: Record<string, string>;
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
