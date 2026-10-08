// カタチ入力の共有コア。Web版・アプリ版はこのファイルだけを見る。
// 依存なし(React も Node も要らない)。
//
//   core/
//   ├── index.ts      ← ここ。公開API
//   ├── engine.ts     検索エンジン(構造マッチ・部品包含・一覧)
//   ├── handwriting.ts 手書き検索の照合(パターンは handwriting-data.json)
//   ├── ids/          IDS(漢字の空間構造記述)まわり
//   │   ├── operators.ts   かたちコード ⇄ IDC、配置図の矩形データ
//   │   ├── normalize.ts   同じ形で符号位置が違う部品を寄せる
//   │   └── parse.ts       IDS文字列 → 構文木
//   └── data/         データ定義
//       ├── blocks.ts      Unicode の CJK ブロック表(ビルドと実行時で共有)
//       ├── kana.ts        読み入力の12キーフリック表
//       ├── keyboard.ts   システムキーボードの見た目の設定(縦幅)
//       ├── palettes.ts    キーボードに並べる部品
//       └── types.ts       辞書(kanji-data.json)の型
export {
  Engine,
  SORT_MODES,
  DEFAULT_SORT,
  STROKE_MAX,
  type SortMode,
} from "./engine.ts";

export {
  OPERATORS,
  PRIMARY_CODES,
  OPERATOR_ICON,
  isIDC,
  readableIds,
  type IconRect,
} from "./ids/operators.ts";

export { norm } from "./ids/normalize.ts";
export { WILD, type Node } from "./ids/parse.ts";

export {
  BLOCKS,
  COMPAT_BLOCKS,
  ALL_BLOCKS,
  isIdeograph,
  blockOf,
  codePointLabel,
  type Block,
} from "./data/blocks.ts";

export {
  AGE_RANGES,
  AGE_VERSIONS,
  AGE_STEP,
  ageKey,
  ageOf,
  type AgeVersion,
} from "./data/age.ts";

export { RADICAL_PALETTE, DIFFICULT_COMPONENTS, CURVE_KANJI } from "./data/palettes.ts";

export {
  KEY_HEIGHTS,
  DEFAULT_KEY_HEIGHT,
  type KeyHeight,
} from "./data/keyboard.ts";

export {
  GODAN_ROWS,
  GODAN_BACKSPACE,
  godanFlick,
  type GodanKey,
} from "./data/godan.ts";

export {
  romajiToKana,
  romajiDisplay,
  type RomajiResult,
} from "./data/romaji.ts";

export {
  KANA_LAYOUTS,
  DEFAULT_KANA_LAYOUT,
  type KanaLayout,
  KANA_BACKSPACE,
  KANA_DAKUTEN,
  KANA_ROWS,
  kanaCycle,
  kanaFlick,
  type KanaKey,
} from "./data/kana.ts";

export {
  HandwritingIndex,
  resampleStroke,
  type HandwritingData,
  type HwMatch,
  type HwPoint,
} from "./handwriting.ts";

export {
  AUTO_DARK,
  AUTO_LIGHT,
  THEMES,
  themeByKey,
  type ThemeColors,
  type ThemeDef,
} from "./data/themes.ts";

export { radicalChar, refReadingLabel } from "./data/types.ts";

export type {
  CharMeta,
  ListPage,
  ListQuery,
  RawData,
  Result,
} from "./data/types.ts";
