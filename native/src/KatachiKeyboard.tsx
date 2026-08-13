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
  kanaCycle,
  OPERATORS,
  PRIMARY_CODES,
  RADICAL_PALETTE,
  type Engine,
} from "./engine";
import { OperatorIcon } from "./OperatorIcon";
import { FlickKanaPad } from "./FlickKanaPad";
import { HandwritingPad } from "./HandwritingPad";
import { fontFor, type Theme } from "./theme";
import { haptic } from "./feedback";

/**
 * 部品パレットの種類。**かたち(操作子)はタブに含めない**。
 * 「かたち→部品→部品」と続けて打つので、別タブにあると1字ごとに往復させられる。
 * かたちは常時表示の行に出し、タブは部品の出し分けだけに使う。
 */
type Tab = "common" | "radical" | "search" | "draw";

const TABS: { id: Tab; label: string }[] = [
  { id: "common", label: "よく使う部品" },
  { id: "radical", label: "部首・偏旁" },
  { id: "search", label: "読み" },
  { id: "draw", label: "手書き" },
];

const PART_COLS = 8;
const GAP = 4;
const SIDE_PADDING = 12;

export function KatachiKeyboard({
  engine,
  theme,
  onInsert,
  onCommit,
  maxHeight,
  collapsed,
  onExpand,
}: {
  engine: Engine | null;
  theme: Theme;
  onInsert: (s: string) => void;
  /** 字を出力欄へ入れる(手書き候補のタップ・読み候補の長押し) */
  onCommit: (ch: string) => void;
  maxHeight: number;
  /** 端末のキーボードで直接打っているあいだは畳んで場所を空ける */
  collapsed?: boolean;
  onExpand?: () => void;
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

  /**
   * かたち(操作子)の行。**端末のキーボードを出しているあいだも出しておく**。
   * 文字は端末のキーボードで、かたちはここをタップで──と同時に打てないと、
   * 〈左右〉を足すたびにキーボードを引っ込める往復が要る。
   */
  const opRow = (
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
  );

  // 直接入力中は端末のキーボードが下半分を占めるので、部品パレットは畳む。
  // かたちの行だけは残して、文字入力とかたちのショートカットを両立させる
  if (collapsed) {
    return (
      <View style={{ backgroundColor: theme.bg, borderTopWidth: 1, borderTopColor: theme.border }}>
        <View style={[styles.collapsedRow, { paddingHorizontal: SIDE_PADDING }]}>
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 11, color: theme.sub }}>
            文字は端末のキーボード、かたちは下の行から
          </Text>
          <Pressable
            onPress={onExpand}
            style={[styles.returnBtn, { backgroundColor: theme.accent }]}
          >
            <Text style={{ fontSize: 12, fontWeight: "600", color: theme.onAccent }}>
              パレットに戻る
            </Text>
          </Pressable>
        </View>
        {opRow}
      </View>
    );
  }

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
      </View>

      {/* ── かたち(常時表示) ──
          タブの外に出しておく。「かたち→部品→部品」と続けて打つのに
          タブ往復が要らなくなる */}
      {opRow}

      {/* 読みと手書きの面はスクロールに入れない。フリックの下向き・手書きの
          縦画がスクロールに取られると入力にならないので、高さを固定して収める */}
      {tab === "search" || tab === "draw" ? (
        <View
          style={{
            height: maxHeight,
            backgroundColor: theme.card,
            padding: SIDE_PADDING,
            paddingTop: GAP,
          }}
        >
          {tab === "search" ? (
            <SearchTab
              engine={engine}
              theme={theme}
              onInsert={onInsert}
              onCommit={onCommit}
            />
          ) : (
            <HandwritingPad
              engine={engine}
              theme={theme}
              onInsert={onInsert}
              onCommit={onCommit}
            />
          )}
        </View>
      ) : (
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
        </ScrollView>
      )}
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
 * 読みから字をさがす面。かなは**内蔵の12キーフリック**で打つ。
 *
 * 以前は端末のキーボードで打つ TextInput だったが、それだと
 * (1) 端末に日本語キーボードが無いと読みが打てない、
 * (2) OSキーボードが画面の下半分を奪って候補が見えなくなる、
 * (3) かたちコードの欄とフォーカスを取り合う——ので、システムキーボード
 * (FlickKanaView)と同じフリック面をアプリにも内蔵した。
 *
 * 引けた字は**タップでかたちコードに部品として足す**／**長押しで出力へ**
 * (システムキーボードの「タップで部品・長押しで送る欄」と同じ並び)。
 */
function SearchTab({
  engine,
  theme,
  onInsert,
  onCommit,
}: {
  engine: Engine | null;
  theme: Theme;
  onInsert: (s: string) => void;
  onCommit: (ch: string) => void;
}) {
  const [reading, setReading] = useState("");
  // 指を置いているあいだの仮の字。読みの欄に色を変えて出す(ポップアップは出さない)
  const [preview, setPreview] = useState<string | null>(null);

  const hits = useMemo(() => {
    const q = reading.trim();
    if (!engine || !q) return [];
    // 読み・部品・符号位置のどれでも引ける（Engine#list がまとめて面倒を見る）
    return engine.list({ query: q, jaOnly: true, limit: 60 }).items.map(i => i.ch);
  }, [engine, reading]);

  const dropLast = (s: string) => [...s].slice(0, -1).join("");

  return (
    <View style={{ flex: 1, gap: GAP }}>
      {/* ── 読みの欄(内蔵。端末のIMEは使わない) ── */}
      <View style={styles.readingRow}>
        <View
          style={[
            styles.readingBox,
            { borderColor: theme.border, backgroundColor: theme.bg },
          ]}
        >
          {reading || preview ? (
            <Text numberOfLines={1} style={{ fontSize: 16, color: theme.text }}>
              {reading}
              {preview != null && (
                <Text style={{ color: theme.accent }}>{preview}</Text>
              )}
            </Text>
          ) : (
            <Text numberOfLines={1} style={{ fontSize: 12, color: theme.faint }}>
              読みをフリックで（例: つち・かい）
            </Text>
          )}
        </View>
        <Pressable
          onPressIn={() => haptic("delete")}
          onPress={() => setReading("")}
          style={[styles.readingClear, { borderColor: theme.border }]}
        >
          <Text style={{ fontSize: 12, color: theme.sub }}>消</Text>
        </Pressable>
      </View>

      {/* ── 引けた字(1行)。タップ=部品として足す / 長押し=出力へ ── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ flexDirection: "row", gap: GAP }}
      >
        {hits.length ? (
          hits.map(p => (
            <Pressable
              key={p}
              onPressIn={() => haptic("key")}
              onPress={() => onInsert(p)}
              onLongPress={() => {
                haptic("success");
                onCommit(p);
              }}
              style={({ pressed }) => [
                styles.hitKey,
                {
                  backgroundColor: pressed ? theme.accentBg : theme.key,
                  borderColor: theme.border,
                },
              ]}
            >
              <Text style={{ fontFamily: fontFor(p), fontSize: 22, color: theme.text }}>
                {p}
              </Text>
            </Pressable>
          ))
        ) : (
          <Text style={{ fontSize: 11, color: theme.faint, alignSelf: "center" }}>
            {reading.trim()
              ? "該当なし"
              : "引けた字は タップで部品に・長押しで出力へ。かたちの選択は残ります"}
          </Text>
        )}
      </ScrollView>

      {/* ── 12キーフリック面 ── */}
      <FlickKanaPad
        theme={theme}
        onAppend={ch => setReading(r => r + ch)}
        onReplaceLast={ch => setReading(r => dropLast(r) + ch)}
        onCycleLast={() =>
          setReading(r => {
            const last = [...r].pop();
            if (!last) return r;
            const next = kanaCycle(last);
            return next ? dropLast(r) + next : r;
          })
        }
        onBackspace={() => setReading(dropLast)}
        onPreview={setPreview}
      />
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
  chipRow: { flexDirection: "row", gap: 4, paddingBottom: 6 },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: GAP },
  readingRow: { flexDirection: "row", alignItems: "center", gap: GAP },
  readingBox: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minHeight: 34,
    justifyContent: "center",
  },
  readingClear: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  hitKey: {
    minWidth: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 4,
  },
  collapsedRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 },
  returnBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
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
