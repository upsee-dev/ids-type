import { Platform, useColorScheme } from "react-native";
import { EXT_FONT_RANGES } from "./extFontRanges";
import {
  AUTO_DARK,
  AUTO_LIGHT,
  themeByKey,
  type ThemeColors,
} from "./core/data/themes";

export type Theme = ThemeColors;

/** 「おまかせ」。端末のライト/ダーク設定に追従する */
export const AUTO_THEME = "auto";

/**
 * 着せ替え。テーマの定義は core/data/themes.ts の1か所
 * (Android IME・iOSキーボード拡張へは build:data が同じ表を生成する)。
 */
export function useTheme(themeKey: string): Theme {
  const systemDark = useColorScheme() === "dark";
  const key =
    themeKey === AUTO_THEME ? (systemDark ? AUTO_DARK : AUTO_LIGHT) : themeKey;
  return themeByKey(key).colors;
}

/** 漢字は明朝系で出す(部品の形が見分けやすい) */
export const KANJI_FONT = Platform.select({
  ios: "Hiragino Mincho ProN",
  android: "serif",
  default: "serif",
});

/**
 * 拡張B〜Jの字を描くための同梱フォント
 * (assets/fonts/KatachiExt1.ttf・KatachiExt2.ttf)。
 * 端末の標準フォントは拡張B以降を持っておらず、そのままだと候補が ☒ で埋まる。
 *
 * Web版は unicode-range で「端末フォント→無い字だけ Plangothic」と出し分けられるが、
 * React Native の fontFamily は1つしか指定できない。そこで**収録範囲を
 * 「端末が持っていない字」だけに絞った**フォントを同梱し、拡張漢字にだけ
 * これを当てる(それ以外は KANJI_FONT の明朝のまま)。7.5万字は TrueType の
 * 65,535グリフ上限に収まらないので2つに割ってある。
 * 作り直し: scripts/build-font-app.py
 */
export const EXT_FONTS = ["KatachiExt1", "KatachiExt2"] as const;

/**
 * 1字を描くのに使うフォント。同梱フォントに入っている字だけそちらへ回す。
 * 範囲表は符号位置順なので二分探索で引く(候補は最大200件・毎描画で通る)。
 */
export function fontFor(ch: string): string | undefined {
  const cp = ch.codePointAt(0) ?? 0;
  let lo = 0;
  let hi = EXT_FONT_RANGES.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [start, end, font] = EXT_FONT_RANGES[mid];
    if (cp < start) hi = mid - 1;
    else if (cp > end) lo = mid + 1;
    else return EXT_FONTS[font - 1];
  }
  return KANJI_FONT;
}

/**
 * 編集できるテキスト欄(入力中のかたちコード)に使うフォント。
 * TextInput は1字ずつフォントを変えられないので、部品パレットの字を
 * ほぼ網羅する KatachiExt1(第2面ぜんぶ+部首補助)を当てておく。
 * このフォントに無い字(常用漢字・かな)は OS が標準フォントで描く。
 */
export const INPUT_FONT = EXT_FONTS[0];
