// カタチ入力の共有コア。Web版・アプリ版はこのファイルだけを見る。
// 依存なし(React も Node も要らない)。
//
//   core/
//   ├── index.ts      ← ここ。公開API
//   ├── engine.ts     検索エンジン(構造マッチ・部品包含・一覧)
//   ├── ids/          IDS(漢字の空間構造記述)まわり
//   │   ├── operators.ts   かたちコード ⇄ IDC、配置図の矩形データ
//   │   ├── normalize.ts   同じ形で符号位置が違う部品を寄せる
//   │   └── parse.ts       IDS文字列 → 構文木
//   └── data/         データ定義
//       ├── blocks.ts      Unicode の CJK ブロック表(ビルドと実行時で共有)
//       ├── palettes.ts    キーボードに並べる部品
//       └── types.ts       辞書(kanji-data.json)の型
export { Engine } from "./engine.ts";

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

export { RADICAL_PALETTE, DIFFICULT_COMPONENTS } from "./data/palettes.ts";

export type {
  CharMeta,
  ListPage,
  ListQuery,
  RawData,
  Result,
} from "./data/types.ts";
