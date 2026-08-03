import { useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import {
  DIFFICULT_COMPONENTS,
  OPERATORS,
  PRIMARY_CODES,
  RADICAL_PALETTE,
  type Engine,
} from "./engine";
import { OperatorIcon } from "./OperatorIcon";
import { fontFor, type Theme } from "./theme";
import { haptic } from "./feedback";

type Tab = "shape" | "common" | "radical";

const TABS: { id: Tab; label: string }[] = [
  { id: "shape", label: "かたち" },
  { id: "common", label: "よく使う部品" },
  { id: "radical", label: "部首・偏旁" },
];

const SHAPE_COLS = 6;
const PART_COLS = 8;
const GAP = 4;
const SIDE_PADDING = 12;

export function KatachiKeyboard({
  engine,
  theme,
  onInsert,
  osKeyboard,
  onToggleOsKeyboard,
  maxHeight,
}: {
  engine: Engine | null;
  theme: Theme;
  onInsert: (s: string) => void;
  osKeyboard: boolean;
  onToggleOsKeyboard: () => void;
  maxHeight: number;
}) {
  const [tab, setTab] = useState<Tab>("shape");
  const [showAllOps, setShowAllOps] = useState(false);
  const { width } = useWindowDimensions();

  const ops = useMemo(() => {
    const primary = PRIMARY_CODES.map(c => OPERATORS.find(o => o.code === c)!).filter(Boolean);
    return showAllOps
      ? [...primary, ...OPERATORS.filter(o => !PRIMARY_CODES.includes(o.code))]
      : primary;
  }, [showAllOps]);

  const common = useMemo(() => engine?.commonParts(180) ?? [], [engine]);

  const inner = width - SIDE_PADDING * 2;
  const shapeW = (inner - GAP * (SHAPE_COLS - 1)) / SHAPE_COLS;
  const partW = (inner - GAP * (PART_COLS - 1)) / PART_COLS;

  // 端末のキーボード使用中はパレットを畳む。畳まないと端末のキーボードと
  // 二重に場所を取り、候補がほとんど見えなくなる
  if (osKeyboard) {
    return (
      <View style={{ backgroundColor: theme.bg, borderTopWidth: 1, borderTopColor: theme.border }}>
        <View style={[styles.collapsedRow, { paddingHorizontal: SIDE_PADDING }]}>
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 11, color: theme.sub }}>
            端末のキーボードで部品を直接入力できます
          </Text>
          <Pressable
            onPressIn={() => haptic("toggle")}
            onPress={onToggleOsKeyboard}
            style={[styles.returnBtn, { backgroundColor: theme.accent }]}
          >
            <Text style={{ fontSize: 12, fontWeight: "600", color: theme.onAccent }}>
              カタチキーボードに戻る
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={{ backgroundColor: theme.bg, borderTopWidth: 1, borderTopColor: theme.border }}>
      <View style={[styles.tabRow, { paddingHorizontal: SIDE_PADDING }]}>
        {TABS.map(t => (
          <Pressable
            key={t.id}
            onPressIn={() => haptic("toggle")}
            onPress={() => setTab(t.id)}
            style={[
              styles.tab,
              { backgroundColor: tab === t.id ? theme.card : "transparent" },
            ]}
          >
            <Text
              style={{
                fontSize: 12,
                fontWeight: "600",
                color: tab === t.id ? theme.accent : theme.sub,
              }}
            >
              {t.label}
            </Text>
          </Pressable>
        ))}
        <Pressable
          onPressIn={() => haptic("toggle")}
          onPress={onToggleOsKeyboard}
          style={[
            styles.imeToggle,
            {
              backgroundColor: osKeyboard ? theme.accent : "transparent",
              borderColor: osKeyboard ? theme.accent : theme.border,
            },
          ]}
        >
          <Text
            style={{
              fontSize: 12,
              fontWeight: "600",
              color: osKeyboard ? theme.onAccent : theme.sub,
            }}
          >
            あ
          </Text>
        </Pressable>
      </View>

      <ScrollView
        style={{ maxHeight, backgroundColor: theme.card }}
        contentContainerStyle={{ padding: SIDE_PADDING, gap: GAP }}
        keyboardShouldPersistTaps="always"
      >
        {tab === "shape" && (
          <View style={styles.grid}>
            {ops.map(op => (
              <Pressable
                key={op.code}
                // 触覚は指が触れた瞬間に返す(離してからだと一拍遅れて感じる)
                onPressIn={() => haptic("key")}
                onPress={() => onInsert(op.code)}
                style={({ pressed }) => [
                  styles.key,
                  {
                    width: shapeW,
                    height: 54,
                    backgroundColor: pressed ? theme.accentBg : theme.key,
                    borderColor: theme.border,
                  },
                ]}
              >
                <OperatorIcon code={op.code} color={theme.text} />
                <Text style={{ fontSize: 9, color: theme.sub, marginTop: 3 }}>{op.label}</Text>
              </Pressable>
            ))}
            <Pressable
              onPressIn={() => haptic("toggle")}
              onPress={() => setShowAllOps(s => !s)}
              style={[
                styles.key,
                {
                  width: shapeW,
                  height: 54,
                  backgroundColor: "transparent",
                  borderColor: theme.border,
                  borderStyle: "dashed",
                },
              ]}
            >
              <Text style={{ fontSize: 11, color: theme.sub }}>
                {showAllOps ? "少なく" : "その他"}
              </Text>
            </Pressable>
          </View>
        )}

        {tab === "common" && (
          <PartGrid
            parts={common}
            width={partW}
            theme={theme}
            onInsert={onInsert}
            empty="辞書を読み込み中…"
          />
        )}

        {tab === "radical" && (
          <RadicalTab width={partW} theme={theme} onInsert={onInsert} />
        )}
      </ScrollView>
    </View>
  );
}

/**
 * 部首・偏旁タブ。既定は日本語向けに絞った RADICAL_PALETTE、
 * 画数チップを選ぶと zi.tools の「難輸入部件」全541件をその画数ぶんだけ出す。
 * 541件を一度に並べると探せないので、zi.tools と同じく画数で区切っている。
 */
function RadicalTab({
  width,
  theme,
  onInsert,
}: {
  width: number;
  theme: Theme;
  onInsert: (s: string) => void;
}) {
  const [group, setGroup] = useState<string>("common");
  const parts = useMemo(() => {
    if (group === "common") return RADICAL_PALETTE;
    return [...(DIFFICULT_COMPONENTS.find(g => g.strokes === group)?.parts ?? "")];
  }, [group]);

  const chips = [
    { key: "common", label: "よく使う" },
    ...DIFFICULT_COMPONENTS.map(g => ({ key: g.strokes, label: `${g.strokes}画` })),
  ];

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        {chips.map(c => (
          <Pressable
            key={c.key}
            onPressIn={() => haptic("toggle")}
            onPress={() => setGroup(c.key)}
            style={[
              styles.chip,
              {
                borderColor: group === c.key ? theme.accent : theme.border,
                backgroundColor: group === c.key ? theme.accentBg : "transparent",
              },
            ]}
          >
            <Text
              style={{
                fontSize: 11,
                color: group === c.key ? theme.accent : theme.sub,
              }}
            >
              {c.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      <PartGrid parts={parts} width={width} theme={theme} onInsert={onInsert} />
    </View>
  );
}

function PartGrid({
  parts,
  width,
  theme,
  onInsert,
  empty,
}: {
  parts: string[];
  width: number;
  theme: Theme;
  onInsert: (s: string) => void;
  empty?: string;
}) {
  if (!parts.length) {
    return (
      <Text style={{ textAlign: "center", color: theme.faint, paddingVertical: 24 }}>
        {empty ?? "—"}
      </Text>
    );
  }
  return (
    <View style={styles.grid}>
      {parts.map(p => (
        <Pressable
          key={p}
          onPressIn={() => haptic("key")}
          onPress={() => onInsert(p)}
          style={({ pressed }) => [
            styles.key,
            {
              width,
              height: 46,
              backgroundColor: pressed ? theme.accentBg : theme.key,
              borderColor: theme.border,
            },
          ]}
        >
          <Text style={{ fontFamily: fontFor(p), fontSize: 22, color: theme.text }}>{p}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  tabRow: { flexDirection: "row", alignItems: "center", gap: 4, paddingTop: 6 },
  collapsedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
  },
  returnBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  tab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 7,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
  },
  imeToggle: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    marginLeft: 4,
  },
  chipRow: { flexDirection: "row", gap: 4, paddingBottom: 6 },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: GAP },
  key: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    borderWidth: 1,
  },
});
