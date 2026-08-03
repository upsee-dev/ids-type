// キーボードの着せ替え(カラーテーマ)。
//
// ここが唯一の定義で、Kotlin(Android IME)と Swift(iOSキーボード拡張)には
// web の `npm run build:data` が Themes.kt / Themes.swift を書き出す
// (Palettes と同じ方式。手で写すと必ずずれるため)。
// RN アプリは sync-core 経由でこのファイルを直接読む。
//
// 「おまかせ」(端末のライト/ダーク設定に追従)は UI 側の概念で、ここには置かない。
// 追従先は AUTO_LIGHT / AUTO_DARK のテーマ。

export interface ThemeColors {
  /** ダーク系か(ステータスバーの文字色などに使う) */
  dark: boolean;
  bg: string;
  card: string;
  key: string;
  border: string;
  text: string;
  sub: string;
  faint: string;
  accent: string;
  accentBg: string;
  onAccent: string;
}

export interface ThemeDef {
  key: string;
  label: string;
  colors: ThemeColors;
}

/** 「おまかせ」が追従するテーマ */
export const AUTO_LIGHT = "standard";
export const AUTO_DARK = "dark";

export const THEMES: ThemeDef[] = [
  {
    key: "standard",
    label: "スタンダード",
    colors: {
      dark: false,
      bg: "#FAFAF9",
      card: "#FFFFFF",
      key: "#FAFAF9",
      border: "#E7E5E4",
      text: "#1C1917",
      sub: "#78716C",
      faint: "#A8A29E",
      accent: "#4F46E5",
      accentBg: "#EEF2FF",
      onAccent: "#FFFFFF",
    },
  },
  {
    key: "sakura",
    label: "サクラ",
    colors: {
      dark: false,
      bg: "#FDF2F8",
      card: "#FFFFFF",
      key: "#FDF2F8",
      border: "#FBCFE8",
      text: "#4A1D31",
      sub: "#A34D6E",
      faint: "#CE9CB0",
      accent: "#DB2777",
      accentBg: "#FCE7F3",
      onAccent: "#FFFFFF",
    },
  },
  {
    key: "soda",
    label: "ソーダ",
    colors: {
      dark: false,
      bg: "#ECFEFF",
      card: "#FFFFFF",
      key: "#ECFEFF",
      border: "#A5F3FC",
      text: "#164E63",
      sub: "#45788A",
      faint: "#85AEBB",
      accent: "#0E7490",
      accentBg: "#CFFAFE",
      onAccent: "#FFFFFF",
    },
  },
  {
    key: "himawari",
    label: "ヒマワリ",
    colors: {
      dark: false,
      bg: "#FFFBEB",
      card: "#FFFFFF",
      key: "#FFFBEB",
      border: "#FDE68A",
      text: "#451A03",
      sub: "#93702B",
      faint: "#C0A566",
      accent: "#B45309",
      accentBg: "#FEF3C7",
      onAccent: "#FFFFFF",
    },
  },
  {
    key: "matcha",
    label: "マッチャ",
    colors: {
      dark: false,
      bg: "#F0FDF4",
      card: "#FFFFFF",
      key: "#F0FDF4",
      border: "#BBF7D0",
      text: "#14532D",
      sub: "#4D7C5F",
      faint: "#8FBA9E",
      accent: "#15803D",
      accentBg: "#DCFCE7",
      onAccent: "#FFFFFF",
    },
  },
  {
    key: "dark",
    label: "ダーク",
    colors: {
      dark: true,
      bg: "#0C0A09",
      card: "#1C1917",
      key: "#0C0A09",
      border: "#292524",
      text: "#E7E5E4",
      sub: "#A8A29E",
      faint: "#78716C",
      accent: "#818CF8",
      accentBg: "#1E1B4B",
      onAccent: "#FFFFFF",
    },
  },
  {
    key: "yozora",
    label: "ヨゾラ",
    colors: {
      dark: true,
      bg: "#0F172A",
      card: "#1E293B",
      key: "#0F172A",
      border: "#334155",
      text: "#E2E8F0",
      sub: "#94A3B8",
      faint: "#64748B",
      accent: "#A78BFA",
      accentBg: "#312E81",
      onAccent: "#1E1B4B",
    },
  },
];

/** key からテーマを引く。無い(将来消したテーマ等)ときは AUTO_LIGHT に落とす */
export function themeByKey(key: string): ThemeDef {
  return (
    THEMES.find((t) => t.key === key) ??
    THEMES.find((t) => t.key === AUTO_LIGHT)!
  );
}
