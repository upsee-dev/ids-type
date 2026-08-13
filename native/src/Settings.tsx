import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { THEMES } from "./engine";
import { AUTO_THEME, type Theme } from "./theme";
import { haptic, HAPTIC_LEVELS, type HapticLevel } from "./feedback";
import { ADS_ENABLED } from "./purchases";

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
  historyCount: number;
  favoriteCount: number;
  onClearHistory: () => void;
  isPro: boolean;
}) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <View style={[s.head, { borderBottomColor: t.border, backgroundColor: t.card }]}>
          <Text style={{ fontSize: 16, fontWeight: "700", color: t.text, flex: 1 }}>
            設定
          </Text>
          <Pressable onPress={onClose} hitSlop={8}>
            <Text style={{ fontSize: 14, color: t.accent }}>閉じる</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, gap: 22 }}>
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
              端末の外へ出ることはありません。
            </Note>
            <Note theme={t}>
              分解データ: BabelStone IDS ／ CHISE IDS ／ CJKVI IDS、
              漢字情報: KANJIDIC2 (CC BY-SA 4.0)、字形: Plangothic (SIL OFL 1.1)、
              手書き認識の筆順パターン: KanjiVG (Ulrich Apel、CC BY-SA 3.0)
            </Note>
          </Section>
        </ScrollView>
      </View>
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
