import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import {
  KEY_HEIGHTS,
  KANA_LAYOUTS,
  type KanaLayout,
  SORT_MODES,
  THEMES,
  HANDWRITING_LICENSE,
  type KeyHeight,
  type SortMode,
} from "./engine";
import { AUTO_THEME, type Theme } from "./theme";
import { haptic, HAPTIC_LEVELS, type HapticLevel } from "./feedback";
import { ADS_ENABLED } from "./purchases";
import { KEYBOARD_MENUS, type KeyboardMenu } from "./keyboardMenus";
import { JAPANESE_CATEGORIES, FOREIGN_READING_LANGUAGES, moveCategory, normalizeForeignReadings } from "./core/japanese";
import { loadJapaneseOrder, saveJapaneseOrder, loadForeignReadings, saveForeignReadings } from "./prefs";

/**
 * 設定画面。
 *
 * 着せ替え・触覚・履歴といった「入力の邪魔をしたくない設定」をここへ集める。
 * 入力画面のヘッダーに項目を並べていくと、打つための場所が削られていく一方
 * なので、増える設定はこの画面に足していく。
 */
export function Settings({
  visible,
  onClose,
  theme: t,
  themeKey,
  onPickTheme,
  hapticLevel,
  onPickHaptic,
  sortMode,
  onPickSort,
  keyHeight,
  onPickHeight,
  kanaLayout,
  onPickKanaLayout,
  startupMenu,
  onPickStartupMenu,
  historyCount,
  favoriteCount,
  onClearHistory,
  isPro,
}: {
  visible: boolean;
  onClose: () => void;
  theme: Theme;
  themeKey: string;
  onPickTheme: (key: string) => void;
  hapticLevel: HapticLevel;
  onPickHaptic: (level: HapticLevel) => void;
  sortMode: SortMode;
  onPickSort: (mode: SortMode) => void;
  keyHeight: KeyHeight;
  onPickHeight: (h: KeyHeight) => void;
  kanaLayout: KanaLayout;
  onPickKanaLayout: (l: KanaLayout) => void;
  startupMenu: KeyboardMenu;
  onPickStartupMenu: (menu: KeyboardMenu) => void;
  historyCount: number;
  favoriteCount: number;
  onClearHistory: () => void;
  isPro: boolean;
}) {
  const [showHandwritingLicense, setShowHandwritingLicense] = useState(false);
  const [japaneseOrder, setJapaneseOrder] = useState(loadJapaneseOrder);
  const [showJapaneseLicense, setShowJapaneseLicense] = useState(false);
  const [foreignReadings, setForeignReadings] = useState(loadForeignReadings);
  useEffect(() => { if (visible) { setJapaneseOrder(loadJapaneseOrder()); setForeignReadings(loadForeignReadings()); } }, [visible]);
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaProvider>
        <SafeAreaView edges={["top", "bottom", "left", "right"]} style={{ flex: 1, backgroundColor: t.bg }}>
          <View style={[s.head, { borderBottomColor: t.border, backgroundColor: t.card }]}>
            <Text style={{ fontSize: 16, fontWeight: "700", color: t.text, flex: 1 }}>
              設定
            </Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="設定を閉じる"
              style={{ minWidth: 64, minHeight: 48, alignItems: "center", justifyContent: "center" }}
            >
              <Text style={{ fontSize: 14, color: t.accent }}>閉じる</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16, gap: 22 }}>
            <Section title="日本語拡張フリック：外国語の読み" theme={t}>
              <Note theme={t}>初期設定はすべてオフです。オンにした言語の読みも、かなのフリックで入力できます。候補に言語名と元の読みを表示します。カナは発音の目安で、声調は省略します。</Note>
              {FOREIGN_READING_LANGUAGES.map(language => <View key={language.id} style={{ flexDirection: "row", alignItems: "center", minHeight: 48 }}>
                <Text style={{ flex: 1, color: t.text }}>{language.label}</Text>
                <Switch accessibilityLabel={`${language.label}の読みで入力`} value={foreignReadings.includes(language.id)} onValueChange={enabled => {
                  const next = normalizeForeignReadings(enabled ? [...foreignReadings, language.id] : foreignReadings.filter(id => id !== language.id));
                  setForeignReadings(next); saveForeignReadings(next);
                }} />
              </View>)}
            </Section>
            <Section title="日本語拡張フリック：候補の優先順位" theme={t}>
              <Note theme={t}>上の分類から優先します。同じ読みの候補は、分類順→辞書の頻度順。人名・地名は語全体も含みます。</Note>
              {japaneseOrder.map((id, index) => <View key={id} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={{ flex: 1, color: t.text }}>{index + 1}. {JAPANESE_CATEGORIES.find(c => c.id === id)!.label}</Text>
                {([-1, 1] as const).map(step => <Pressable key={step} accessibilityRole="button" accessibilityLabel={`${JAPANESE_CATEGORIES.find(c => c.id === id)!.label}を${step < 0 ? "上" : "下"}へ`} disabled={index + step < 0 || index + step >= japaneseOrder.length} onPress={() => {
                  const next = moveCategory(japaneseOrder, id, step); setJapaneseOrder(next); saveJapaneseOrder(next);
                }} style={{ padding: 12, opacity: index + step < 0 || index + step >= japaneseOrder.length ? 0.25 : 1 }}><Text style={{ color: t.accent }}>{step < 0 ? "↑" : "↓"}</Text></Pressable>)}
              </View>)}
              <Note theme={t}>動物は鳥類・虫類・魚類を除いた分類です。藻類は植物と分けています。</Note>
              <Note theme={t}>端末の設定から「日本語拡張フリック」を追加すると、他のアプリでも使えます。iOSで本アプリの設定を共有するにはフルアクセスを許可してください。許可しない場合もキーボード内で並べ替えできます。</Note>
              <Pressable accessibilityRole="button" onPress={() => setShowJapaneseLicense(v => !v)} style={{ paddingVertical: 12 }}><Text style={{ color: t.accent }}>日本語辞書・部首索引の出典とライセンス</Text></Pressable>
              {showJapaneseLicense && <Text selectable style={{ color: t.sub, fontSize: 11 }}>{require("../assets/japanese-license.json") as string}</Text>}
            </Section>
            <Section title="起動時のメニュー" theme={t}>
              <View style={s.wrap}>
                {KEYBOARD_MENUS.map(menu => (
                  <Chip
                    key={menu.id}
                    theme={t}
                    active={startupMenu === menu.id}
                    label={menu.label}
                    onPress={() => onPickStartupMenu(menu.id)}
                  />
                ))}
              </View>
              <Note theme={t}>
                次回のアプリ起動時に、選んだメニューを開きます。
              </Note>
            </Section>

            <Section title="着せ替え" theme={t}>
              <View style={s.wrap}>
                {[
                  { key: AUTO_THEME, label: "おまかせ", swatch: null as string | null },
                  ...THEMES.map(d => ({
                    key: d.key,
                    label: d.label,
                    swatch: d.colors.accent,
                  })),
                ].map(item => (
                  <Chip
                    key={item.key}
                    theme={t}
                    active={themeKey === item.key}
                    label={item.label}
                    swatch={item.swatch}
                    onPress={() => onPickTheme(item.key)}
                  />
                ))}
              </View>
              <Note theme={t}>
                「おまかせ」は端末のライト／ダーク設定に合わせて切り替わります。
              </Note>
            </Section>

            <Section title="候補の並び順" theme={t}>
              <View style={s.wrap}>
                {SORT_MODES.map(m => (
                  <Chip
                    key={m.key}
                    theme={t}
                    active={sortMode === m.key}
                    label={m.label}
                    onPress={() => onPickSort(m.key)}
                  />
                ))}
              </View>
              <Note theme={t}>
                {SORT_MODES.find(m => m.key === sortMode)?.note}
              </Note>
              <Note theme={t}>
                システムキーボードでも同じ順になります。
              </Note>
            </Section>

            <Section title="読みの入力方法" theme={t}>
              <View style={s.wrap}>
                {KANA_LAYOUTS.map(l => (
                  <Chip
                    key={l.id}
                    theme={t}
                    active={kanaLayout === l.id}
                    label={l.label}
                    onPress={() => onPickKanaLayout(l.id)}
                  />
                ))}
              </View>
              <Note theme={t}>
                {kanaLayout === "flick"
                  ? "日本のスマホで標準の12キーフリック。あ行のキーを左右上下に払って い・う・え・お を出します。"
                  : kanaLayout === "romaji"
                    ? "パソコンと同じローマ字入力。tuchi → つち のように、かなに直せたぶんから読み欄に入ります。"
                    : "Godan。左の列に母音（A I U E O）、中央と右に子音（K S T N / H M Y R W）。子音キーを右に払うと濁音（か→が）、左で半濁音（は→ぱ）です。"}
              </Note>
              <Note theme={t}>
                システムキーボードでも同じ面が出ます。
              </Note>
            </Section>

            <Section title="キーボードの縦幅" theme={t}>
              <View style={s.wrap}>
                {KEY_HEIGHTS.map(h => (
                  <Chip
                    key={h.key}
                    theme={t}
                    active={keyHeight === h.key}
                    label={h.label}
                    onPress={() => onPickHeight(h.key)}
                  />
                ))}
              </View>
              <Note theme={t}>
                {KEY_HEIGHTS.find(h => h.key === keyHeight)?.note}
              </Note>
              <Note theme={t}>
                このアプリのキーボードはすぐに、システムキーボード（他のアプリで使うほう）は
                次に開いたときに変わります。
              </Note>
            </Section>

            <Section title="打鍵の触覚" theme={t}>
              <View style={s.wrap}>
                {HAPTIC_LEVELS.map(h => (
                  <Chip
                    key={h.key}
                    theme={t}
                    active={hapticLevel === h.key}
                    label={h.label}
                    onPress={() => onPickHaptic(h.key)}
                  />
                ))}
              </View>
              <Note theme={t}>
                選ぶとその強さで一度返ります。端末側で触覚を切っているときは鳴りません。
              </Note>
            </Section>

            <Section title="履歴とお気に入り" theme={t}>
              <Text style={{ fontSize: 13, color: t.text }}>
                履歴 {historyCount} 字 ／ お気に入り {favoriteCount} 字
              </Text>
              <Pressable
                onPress={() => {
                  haptic("delete");
                  onClearHistory();
                }}
                style={[s.btn, { borderColor: t.border }]}
              >
                <Text style={{ fontSize: 13, color: t.accent }}>履歴をすべて消す</Text>
              </Pressable>
              <Note theme={t}>
                お気に入りは消えません。どちらも端末の中だけに保存しています。
              </Note>
            </Section>

            {ADS_ENABLED && (
              <Section title="広告" theme={t}>
                <Text style={{ fontSize: 13, color: t.text }}>
                  {isPro ? "有料版：広告は表示されません" : "無料版：広告が表示されます"}
                </Text>
              </Section>
            )}

            <Section title="このアプリについて" theme={t}>
              <Note theme={t}>
                漢字カタチ入力は、通信を一切しません。入力した内容も、選んだ字も、
                カメラで読み取った写真も、端末の外へ出ることはありません
                （写真は読み取ったらすぐ捨てていて、保存もしていません）。
              </Note>
              <Note theme={t}>
                分解データ: BabelStone IDS ／ CHISE IDS ／ CJKVI IDS、
                漢字情報: KANJIDIC2 (CC BY-SA 4.0)、字形: Plangothic (SIL OFL 1.1)、
                手書き認識の筆順パターン: KanjiVG (Ulrich Apel、CC BY-SA 3.0) ／
                AnimCJK (FM&amp;SH、Arphic Public License)
              </Note>
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: showHandwritingLicense }}
                onPress={() => setShowHandwritingLicense(v => !v)}
                style={{ minHeight: 44, justifyContent: "center" }}>
                <Text style={{ fontSize: 12, color: t.accent }}>手書きデータのライセンス</Text>
              </Pressable>
              {showHandwritingLicense && <Text selectable style={{ fontSize: 11, lineHeight: 16, color: t.sub }}>{HANDWRITING_LICENSE}</Text>}
            </Section>
          </ScrollView>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

function Section({
  title,
  theme: t,
  children,
}: {
  title: string;
  theme: Theme;
  children: React.ReactNode;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontSize: 12, fontWeight: "700", color: t.sub }}>{title}</Text>
      {children}
    </View>
  );
}

function Note({ theme: t, children }: { theme: Theme; children: React.ReactNode }) {
  return (
    <Text style={{ fontSize: 11, lineHeight: 16, color: t.faint }}>{children}</Text>
  );
}

function Chip({
  theme: t,
  active,
  label,
  swatch,
  onPress,
}: {
  theme: Theme;
  active: boolean;
  label: string;
  swatch?: string | null;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        s.chip,
        {
          borderColor: active ? t.accent : t.border,
          backgroundColor: active ? t.accentBg : "transparent",
        },
      ]}
    >
      {!!swatch && <View style={[s.swatch, { backgroundColor: swatch }]} />}
      <Text style={{ fontSize: 12, color: active ? t.accent : t.sub }}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  head: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  swatch: { width: 12, height: 12, borderRadius: 6 },
  btn: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
});
