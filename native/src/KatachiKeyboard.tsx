import { useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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

/**
 * 部品パレットの種類。**かたち(操作子)はタブに含めない**。
 * 「かたち→部品→部品」と続けて打つので、別タブにあると1字ごとに往復させられる。
 * かたちは常時表示の行に出し、タブは部品の出し分けだけに使う。
 */
type Tab = "common" | "radical" | "search";

const TABS: { id: Tab; label: string }[] = [
  { id: "common", label: "よく使う部品" },
  { id: "radical", label: "部首・偏旁" },
  { id: "search", label: "読みでさがす" },
];

const PART_COLS = 8;
const GAP = 4;
const SIDE_PADDING = 12;

export function KatachiKeyboard({
  engine,
  theme,
  onInsert,
  maxHeight,
}: {
  engine: Engine | null;
  theme: Theme;
  onInsert: (s: string) => void;
  maxHeight: number;
}) {
  const [tab, setTab] = useState<Tab>("common");
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
  const partW = (inner - GAP * (PART_COLS - 1)) / PART_COLS;

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
          onPress={() => setTab("search")}
          accessibilityLabel="読みから部品をさがす"
          style={[
            styles.imeToggle,
            {
              backgroundColor: tab === "search" ? theme.accent : "transparent",
              borderColor: tab === "search" ? theme.accent : theme.border,
            },
          ]}
        >
          <Text
            style={{
              fontSize: 12,
              fontWeight: "600",
              color: tab === "search" ? theme.onAccent : theme.sub,
            }}
          >
            あ
          </Text>
        </Pressable>
      </View>

      {/* ── かたち(常時表示) ──
          タブの外に出しておく。「かたち→部品→部品」と続けて打つのに
          タブ往復が要らなくなる */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        contentContainerStyle={[styles.opRow, { paddingHorizontal: SIDE_PADDING }]}
        style={{ backgroundColor: theme.card }}
      >
        {ops.map(op => (
          <Pressable
            key={op.code}
            // 触覚は指が触れた瞬間に返す(離してからだと一拍遅れて感じる)
            onPressIn={() => haptic("key")}
            onPress={() => onInsert(op.code)}
            style={({ pressed }) => [
              styles.opKey,
              {
                backgroundColor: pressed ? theme.accentBg : theme.key,
                borderColor: theme.border,
              },
            ]}
          >
            <OperatorIcon code={op.code} color={theme.text} size={18} />
            <Text style={{ fontSize: 9, color: theme.sub, marginTop: 2 }}>{op.label}</Text>
          </Pressable>
        ))}
        <Pressable
          onPressIn={() => haptic("toggle")}
          onPress={() => setShowAllOps(s => !s)}
          style={[
            styles.opKey,
            { backgroundColor: "transparent", borderColor: theme.border, borderStyle: "dashed" },
          ]}
        >
          <Text style={{ fontSize: 11, color: theme.sub }}>
            {showAllOps ? "少なく" : "その他"}
          </Text>
        </Pressable>
      </ScrollView>

      <ScrollView
        style={{ maxHeight, backgroundColor: theme.card }}
        contentContainerStyle={{ padding: SIDE_PADDING, gap: GAP }}
        keyboardShouldPersistTaps="always"
      >
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

        {tab === "search" && (
          <SearchTab
            engine={engine}
            width={partW}
            theme={theme}
            onInsert={onInsert}
          />
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

/**
 * 読みから部品をさがすタブ。
 *
 * 「あ」で端末のキーボードに切り替えて**かたちコードの欄に直接**打たせると、
 * 日本語IMEが変換を始めた瞬間に欄ごと持っていかれ、先に選んだ〈左右〉などが
 * 消える（RN の制御された TextInput と IME の変換は相性が悪い）。
 * そこで探す用の欄をキーボードの中に別に持ち、**かたちコードの欄には
 * 触らせない**。見つけた字はタップでかたちコードに足される。
 */
function SearchTab({
  engine,
  width,
  theme,
  onInsert,
}: {
  engine: Engine | null;
  width: number;
  theme: Theme;
  onInsert: (s: string) => void;
}) {
  const [reading, setReading] = useState("");
  const hits = useMemo(() => {
    const q = reading.trim();
    if (!engine || !q) return [];
    // 読み・部品・符号位置のどれでも引ける（Engine#list がまとめて面倒を見る）
    return engine.list({ query: q, jaOnly: true, limit: 60 }).items.map(i => i.ch);
  }, [engine, reading]);

  return (
    <View style={{ gap: GAP }}>
      <TextInput
        value={reading}
        onChangeText={setReading}
        placeholder="部品の読み（例: つち・かい）"
        placeholderTextColor={theme.faint}
        autoCorrect={false}
        style={{
          borderWidth: 1,
          borderRadius: 8,
          paddingHorizontal: 10,
          paddingVertical: 8,
          fontSize: 15,
          color: theme.text,
          borderColor: theme.border,
          backgroundColor: theme.bg,
        }}
      />
      {!reading.trim() ? (
        <Text style={{ color: theme.faint, fontSize: 11, paddingVertical: 8 }}>
          パレットに無い部品は、ここで読みから引いて足せます。
          かたちの選択はそのまま残ります。
        </Text>
      ) : (
        <PartGrid parts={hits} width={width} theme={theme} onInsert={onInsert} empty="該当なし" />
      )}
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
  opRow: { flexDirection: "row", gap: GAP, paddingVertical: 6 },
  opKey: {
    minWidth: 52,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 6,
  },
  key: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    borderWidth: 1,
  },
});
