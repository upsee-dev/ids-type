import { Platform, useColorScheme } from "react-native";

export interface Theme {
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

const light: Theme = {
  dark: false,
  bg: "#fafaf9",
  card: "#ffffff",
  key: "#fafaf9",
  border: "#e7e5e4",
  text: "#1c1917",
  sub: "#78716c",
  faint: "#a8a29e",
  accent: "#4f46e5",
  accentBg: "#eef2ff",
  onAccent: "#ffffff",
};

const dark: Theme = {
  dark: true,
  bg: "#0c0a09",
  card: "#1c1917",
  key: "#0c0a09",
  border: "#292524",
  text: "#e7e5e4",
  sub: "#a8a29e",
  faint: "#78716c",
  accent: "#818cf8",
  accentBg: "#1e1b4b",
  onAccent: "#ffffff",
};

export function useTheme(): Theme {
  return useColorScheme() === "dark" ? dark : light;
}

/** 漢字は明朝系で出す(部品の形が見分けやすい) */
export const KANJI_FONT = Platform.select({
  ios: "Hiragino Mincho ProN",
  android: "serif",
  default: "serif",
});

/**
 * 部品パレット専用のフォント。assets/fonts/KatachiParts.ttf を App.tsx で読み込む。
 * 「難輸入部件」は拡張B〜Hの字が多く端末の標準フォントに無いので、そのままだと
 * □ が並んで「見て選ぶ」画面が成立しない。サブセットに無い字は OS が
 * 標準フォントへフォールバックするので、パレットだけこの指定にしておけばよい。
 * 作り直し: scripts/build-font-subset.py
 */
export const PARTS_FONT = "KatachiParts";
