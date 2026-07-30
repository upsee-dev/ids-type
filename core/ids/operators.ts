// 操作子(かたち)の定義。IDC(Ideographic Description Characters)との対応と、
// IDC文字を使わずに配置図を描くための矩形データ。
// zi.tools (https://zi.tools/?secondary=ids) の2文字コード体系に準拠。
export const OPERATORS: {
  code: string;
  idc: string;
  arity: number;
  label: string;
}[] = [
  { code: "LR", idc: "⿰", arity: 2, label: "左右" },
  { code: "LL", idc: "⿲", arity: 3, label: "左中右" },
  { code: "UD", idc: "⿱", arity: 2, label: "上下" },
  { code: "UU", idc: "⿳", arity: 3, label: "上中下" },
  { code: "RD", idc: "⿸", arity: 2, label: "左上かこみ" },
  { code: "RU", idc: "⿺", arity: 2, label: "左下かこみ" },
  { code: "LD", idc: "⿹", arity: 2, label: "右上かこみ" },
  { code: "LU", idc: "⿽", arity: 2, label: "右下かこみ" },
  { code: "OD", idc: "⿵", arity: 2, label: "上かこみ" },
  { code: "OR", idc: "⿷", arity: 2, label: "左かこみ" },
  { code: "OU", idc: "⿶", arity: 2, label: "下かこみ" },
  { code: "OL", idc: "⿼", arity: 2, label: "右かこみ" },
  { code: "OC", idc: "⿴", arity: 2, label: "全かこみ" },
  { code: "XX", idc: "⿻", arity: 2, label: "重なり" },
  { code: "MI", idc: "⿾", arity: 1, label: "鏡映" },
  { code: "RO", idc: "⿿", arity: 1, label: "回転" },
  { code: "SU", idc: "㇯", arity: 2, label: "除去" },
];

export const CODE2IDC = new Map(OPERATORS.map((o) => [o.code, o.idc]));
export const IDC_ARITY = new Map(OPERATORS.map((o) => [o.idc, o.arity]));

// よく使う操作子(スマホの1画面目に出す)。残りは「その他」に格納
export const PRIMARY_CODES = [
  "LR",
  "UD",
  "OC",
  "RD",
  "RU",
  "LD",
  "OD",
  "OU",
  "LL",
  "UU",
  "OR",
  "XX",
];

// 操作子アイコンの図形定義(0..1座標)。Web=div, RN=View で同じ絵を描くための共有仕様。
// role 1/2/3 = 第1/第2/第3要素。複数の矩形で1つの要素(かこみのL字など)を表す。
export interface IconRect {
  x: number;
  y: number;
  w: number;
  h: number;
  role: 1 | 2 | 3;
}

export const OPERATOR_ICON: Record<
  string,
  { rects?: IconRect[]; symbol?: string }
> = {
  LR: { rects: [r(0, 0, 0.46, 1, 1), r(0.54, 0, 0.46, 1, 2)] },
  LL: {
    rects: [
      r(0, 0, 0.29, 1, 1),
      r(0.355, 0, 0.29, 1, 2),
      r(0.71, 0, 0.29, 1, 3),
    ],
  },
  UD: { rects: [r(0, 0, 1, 0.46, 1), r(0, 0.54, 1, 0.46, 2)] },
  UU: {
    rects: [
      r(0, 0, 1, 0.29, 1),
      r(0, 0.355, 1, 0.29, 2),
      r(0, 0.71, 1, 0.29, 3),
    ],
  },
  RD: {
    rects: [
      r(0, 0, 1, 0.28, 1),
      r(0, 0, 0.28, 1, 1),
      r(0.38, 0.38, 0.62, 0.62, 2),
    ],
  },
  RU: {
    rects: [
      r(0, 0, 0.28, 1, 1),
      r(0, 0.72, 1, 0.28, 1),
      r(0.38, 0, 0.62, 0.62, 2),
    ],
  },
  LD: {
    rects: [
      r(0, 0, 1, 0.28, 1),
      r(0.72, 0, 0.28, 1, 1),
      r(0, 0.38, 0.62, 0.62, 2),
    ],
  },
  LU: {
    rects: [
      r(0.72, 0, 0.28, 1, 1),
      r(0, 0.72, 1, 0.28, 1),
      r(0, 0, 0.62, 0.62, 2),
    ],
  },
  OD: {
    rects: [
      r(0, 0, 1, 0.26, 1),
      r(0, 0, 0.26, 1, 1),
      r(0.74, 0, 0.26, 1, 1),
      r(0.34, 0.36, 0.32, 0.64, 2),
    ],
  },
  OR: {
    rects: [
      r(0, 0, 0.26, 1, 1),
      r(0, 0, 1, 0.26, 1),
      r(0, 0.74, 1, 0.26, 1),
      r(0.36, 0.34, 0.64, 0.32, 2),
    ],
  },
  OU: {
    rects: [
      r(0, 0.74, 1, 0.26, 1),
      r(0, 0, 0.26, 1, 1),
      r(0.74, 0, 0.26, 1, 1),
      r(0.34, 0, 0.32, 0.64, 2),
    ],
  },
  OL: {
    rects: [
      r(0.74, 0, 0.26, 1, 1),
      r(0, 0, 1, 0.26, 1),
      r(0, 0.74, 1, 0.26, 1),
      r(0, 0.34, 0.64, 0.32, 2),
    ],
  },
  OC: {
    rects: [
      r(0, 0, 1, 0.24, 1),
      r(0, 0.76, 1, 0.24, 1),
      r(0, 0, 0.24, 1, 1),
      r(0.76, 0, 0.24, 1, 1),
      r(0.34, 0.34, 0.32, 0.32, 2),
    ],
  },
  XX: { rects: [r(0, 0.06, 0.7, 0.7, 1), r(0.3, 0.24, 0.7, 0.7, 2)] },
  MI: { symbol: "⇄" },
  RO: { symbol: "↻" },
  SU: { symbol: "−" },
};

function r(
  x: number,
  y: number,
  w: number,
  h: number,
  role: 1 | 2 | 3,
): IconRect {
  return { x, y, w, h, role };
}

// キーボードで打ちにくい部品(偏旁・冠・脚など単体では変換しにくいもの)

export function isIDC(c: string): boolean {
  return IDC_ARITY.has(c);
}

const IDC2LABEL = new Map(OPERATORS.map((o) => [o.idc, o.label]));

/**
 * 分解の表示用。IDC文字(⿰⿱⿴…)はAndroid標準フォントなどでは豆腐(□)になるため、
 * 〈左右〉のような日本語ラベルに置き換える。
 */
export function readableIds(ids: string): string {
  return [...ids]
    .map((c) => (IDC2LABEL.has(c) ? `〈${IDC2LABEL.get(c)}〉` : c))
    .join("");
}
