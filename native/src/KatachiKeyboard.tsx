import { useEffect, useMemo, useState } from "react";
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
  STROKE_MAX,
  type Engine,
} from "./engine";
import { OperatorIcon } from "./OperatorIcon";
import { CameraPad } from "./CameraPad";
import { FlickKanaPad } from "./FlickKanaPad";
import { HandwritingPad } from "./HandwritingPad";
import { fontFor, type Theme } from "./theme";
import { haptic } from "./feedback";

/**
 * 部品パレットの種類。**かたち(操作子)はタブに含めない**。
 * 「かたち→部品→部品」と続けて打つので、別タブにあると1字ごとに往復させられる。
 * かたちは常時表示の行に出し、タブは部品の出し分けだけに使う。
 */
type Tab = "radical" | "search" | "draw" | "camera";

/** 4つとも同じ幅にする(styles.tab の flex:1)。並びとしては対等な引き方なので */
const TABS: { id: Tab; label: string }[] = [
  { id: "radical", label: "部首" },
  { id: "search", label: "読み" },
  { id: "draw", label: "手書き" },
  { id: "camera", label: "カメラ" },
];

const PART_COLS = 8;
const GAP = 4;
const SIDE_PADDING = 12;

/**
 * 読みの欄と引けた字の行の高さ。**中身で伸び縮みさせない**。
 * ここが1pxでも変わると、残りをもらうフリック面(や手書きの枠)が
 * 打っている最中に縮んで、狙ったキーの隣に入る
 */
const READING_ROW = 36;
const HIT_ROW = 44;

/** 引けた字の1ページぶん。候補欄と同じ数にそろえてある */
const READING_PAGE = 60;

/** 画数チップ。0=指定なし、STROKE_MAX は「それ以上」 */
const STROKE_CHIPS = [0, ...Array.from({ length: STROKE_MAX }, (_, i) => i + 1)];

export function KatachiKeyboard({
  engine,
  theme,
  favorites,
  onInsert,
  onCommit,
  maxHeight,
  cameraRequest,
  collapsed,
  onExpand,
}: {
  engine: Engine | null;
  theme: Theme;
  /** ★に入れてきた字。部首タブの先頭「お気に入り」に並べる */
  favorites: string[];
  onInsert: (s: string) => void;
  /** 字を出力欄へ入れる(手書き候補のタップ・読み候補の長押し) */
  onCommit: (ch: string) => void;
  maxHeight: number;
  /** 増えるたびにカメラの面を開く(システムキーボードの「カメラ」から来たとき) */
  cameraRequest: number;
  /** 端末のキーボードで直接打っているあいだは畳んで場所を空ける */
  collapsed?: boolean;
  onExpand?: () => void;
}) {
  const [tab, setTab] = useState<Tab>("radical");
  // システムキーボードの「カメラ」から飛んできたら、その面を開いて待つ
  useEffect(() => {
    if (cameraRequest) setTab("camera");
  }, [cameraRequest]);
  const [showAllOps, setShowAllOps] = useState(false);
  const { width, height: screenH } = useWindowDimensions();

  /**
   * 面の高さ。**カメラだけは打鍵の面より大きく取る**。
   * フリックや手書きと違って指を置いて動かす場所ではなく、写した字が
   * 大きいほど読み取りが当たるので、枠の小ささがそのまま失敗になる。
   */
  const padHeight =
    tab === "camera" ? Math.min(maxHeight * 1.7, screenH * 0.5) : maxHeight;

  const ops = useMemo(() => {
    const primary = PRIMARY_CODES.map(c => OPERATORS.find(o => o.code === c)!).filter(Boolean);
    return showAllOps
      ? [...primary, ...OPERATORS.filter(o => !PRIMARY_CODES.includes(o.code))]
      : primary;
  }, [showAllOps]);


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

      {/* 読み・手書き・カメラの面はスクロールに入れない。フリックの下向き・手書きの
          縦画・カメラのプレビューがスクロールに取られると入力にならないので、
          高さを固定して収める */}
      {tab !== "radical" ? (
        <View
          style={{
            height: padHeight,
            backgroundColor: theme.card,
            padding: SIDE_PADDING,
            paddingTop: GAP,
          }}
        >
          {tab === "search" && (
            <SearchTab
              engine={engine}
              theme={theme}
              onInsert={onInsert}
              onCommit={onCommit}
            />
          )}
          {tab === "draw" && (
            <HandwritingPad
              engine={engine}
              theme={theme}
              onInsert={onInsert}
              onCommit={onCommit}
            />
          )}
          {tab === "camera" && (
            <CameraPad theme={theme} onInsert={onInsert} onCommit={onCommit} />
          )}
        </View>
      ) : (
        <ScrollView
          style={{ maxHeight, backgroundColor: theme.card }}
          contentContainerStyle={{ padding: SIDE_PADDING, gap: GAP }}
          keyboardShouldPersistTaps="always"
        >
          {tab === "radical" && (
            <RadicalTab
              width={partW}
              theme={theme}
              favorites={favorites}
              onInsert={onInsert}
            />
          )}
        </ScrollView>
      )}
    </View>
  );
}

/**
 * 部首・偏旁タブ。先頭は**お気に入り**——これまで★に入れてきた字をそのまま並べ、
 * 画数チップを選ぶと zi.tools の「難輸入部件」全541件をその画数ぶんだけ出す。
 * 541件を一度に並べると探せないので、zi.tools と同じく画数で区切っている。
 *
 * 先頭が固定の部品表(RADICAL_PALETTE)ではなくお気に入りなのは、この道具で
 * 何度も出す字は人によって違うため。お気に入りに入れた字は**部品としても打てる**
 * （漢字はそれ自体がほかの字の部品になる）。
 */
function RadicalTab({
  width,
  theme,
  favorites,
  onInsert,
}: {
  width: number;
  theme: Theme;
  /** ★に入れてきた字（アプリとシステムキーボードで同じ1つを見る） */
  favorites: string[];
  onInsert: (s: string) => void;
}) {
  const [group, setGroup] = useState<string>("favorites");
  const parts = useMemo(() => {
    if (group === "favorites") return favorites;
    return [...(DIFFICULT_COMPONENTS.find(g => g.strokes === group)?.parts ?? "")];
  }, [group, favorites]);

  const chips = [
    { key: "favorites", label: "お気に入り" },
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
                fontSize: 12,
                color: group === c.key ? theme.accent : theme.sub,
              }}
            >
              {c.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      <PartGrid
        parts={parts}
        width={width}
        theme={theme}
        onInsert={onInsert}
        empty={
          group === "favorites"
            ? "まだありません。字を選んで★を押すと入ります。"
            : undefined
        }
      />
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
 *
 * **該当する字は打ち切らない**。「こう」で4,634字あるような読みでも、
 * 60字で切ると「これで全部」なのか分からないので、全件数を出して
 * ページで送れるようにしてある。加えて**画数で絞り込める**——画数は
 * Unicode(Unihan)の値で10万字ぜんぶにあるので、拡張漢字にも効く。
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
  /** 画数の絞り込み。0=指定なし。STROKE_MAX は「それ以上」 */
  const [strokes, setStrokes] = useState(0);
  const [page, setPage] = useState(0);

  const found = useMemo(() => {
    const q = reading.trim();
    if (!engine || !q) return { items: [] as string[], total: 0 };
    // 読み・部品・符号位置のどれでも引ける（Engine#list がまとめて面倒を見る）。
    // **日本の字に絞らない**。10万字ぜんぶが読みを持つようになったので
    // (正式→人名→参考→推定の順に並ぶ)、絞ると拡張漢字が読みで引けなくなる。
    // よく使う字が先に出る並びはエンジン側で保証されている
    const r = engine.list({
      query: q,
      strokes,
      offset: page * READING_PAGE,
      limit: READING_PAGE,
    });
    return { items: r.items.map(i => i.ch), total: r.total };
  }, [engine, reading, strokes, page]);

  const hits = found.items;
  const pages = Math.ceil(found.total / READING_PAGE);

  // 打ち直し・絞り込みの変更で1ページめに戻す(前のページ位置に残ると
  // 「打ったのに何も出ない」ように見える)
  const resetPage = () => setPage(0);

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
          onPress={() => {
            resetPage();
            setReading("");
          }}
          style={[styles.readingClear, { borderColor: theme.border }]}
        >
          <Text style={{ fontSize: 12, color: theme.sub }}>消</Text>
        </Pressable>
      </View>

      {/* ── 件数・ページ送り・画数の絞り込み(1行にまとめる) ──
          読みだけだと「こう」で4,634字出る。**全部出す**ために件数とページ送りを持ち、
          画数で絞れるようにする(画数は10万字ぜんぶにあるので拡張漢字にも効く)。
          行を増やすとそのぶんフリック面が縮むので、3つを同じ行に収めてある */}
      <View style={styles.filterRow}>
        <Text style={{ fontSize: 10, color: theme.sub, minWidth: 54 }} numberOfLines={1}>
          {found.total > 0 ? `全${found.total}字` : "画数で絞る"}
        </Text>
        {pages > 1 && (
          <>
            <Pressable
              onPressIn={() => haptic("toggle")}
              onPress={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              style={[styles.pagerBtn, { borderColor: theme.border }]}
            >
              <Text style={{ fontSize: 11, color: page === 0 ? theme.faint : theme.accent }}>
                ‹
              </Text>
            </Pressable>
            <Text style={{ fontSize: 10, color: theme.sub }}>
              {page + 1}/{pages}
            </Text>
            <Pressable
              onPressIn={() => haptic("toggle")}
              onPress={() => setPage(p => Math.min(pages - 1, p + 1))}
              disabled={page >= pages - 1}
              style={[styles.pagerBtn, { borderColor: theme.border }]}
            >
              <Text
                style={{
                  fontSize: 11,
                  color: page >= pages - 1 ? theme.faint : theme.accent,
                }}
              >
                ›
              </Text>
            </Pressable>
          </>
        )}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="always"
          style={{ flex: 1 }}
          contentContainerStyle={styles.strokeRow}
        >
          {STROKE_CHIPS.map(n => {
            const on = strokes === n;
            return (
              <Pressable
                key={n}
                onPressIn={() => haptic("toggle")}
                onPress={() => {
                  setStrokes(n);
                  resetPage();
                }}
                style={[
                  styles.strokeChip,
                  {
                    borderColor: on ? theme.accent : theme.border,
                    backgroundColor: on ? theme.accentBg : "transparent",
                  },
                ]}
              >
                <Text style={{ fontSize: 11, color: on ? theme.accent : theme.sub }}>
                  {n === 0
                    ? "全部"
                    : n >= STROKE_MAX
                      ? `${STROKE_MAX}画+`
                      : `${n}画`}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* ── 引けた字(1行)。タップ=部品として足す / 長押し=出力へ ──
          高さは**候補の有無にかかわらず HIT_ROW で固定**。候補が出た拍子に
          この行が伸びると、下のフリック面がそのぶん縮んで打っている最中に
          キーが動く(1字目で位置がずれて、2字目が隣のキーに入る) */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        style={styles.hitRow}
        contentContainerStyle={{
          flexDirection: "row",
          alignItems: "center",
          gap: GAP,
        }}
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
              ? strokes > 0
                ? "該当なし（画数の絞り込みを外すと出るかもしれません）"
                : "該当なし"
              : "引けた字は タップで部品に・長押しで出力へ。かたちの選択は残ります"}
          </Text>
        )}
      </ScrollView>

      {/* ── 12キーフリック面 ── */}
      <FlickKanaPad
        theme={theme}
        onAppend={ch => {
          resetPage();
          setReading(r => r + ch);
        }}
        onReplaceLast={ch => {
          resetPage();
          setReading(r => dropLast(r) + ch);
        }}
        onCycleLast={() => {
          resetPage();
          setReading(r => {
            const last = [...r].pop();
            if (!last) return r;
            const next = kanaCycle(last);
            return next ? dropLast(r) + next : r;
          });
        }}
        onBackspace={() => {
          resetPage();
          setReading(dropLast);
        }}
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
  chipRow: { flexDirection: "row", alignItems: "center", gap: 5, paddingBottom: 6 },
  strokeRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  strokeChip: {
    minWidth: 44,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  filterRow: { flexDirection: "row", alignItems: "center", gap: 4, height: 30 },
  pagerBtn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  // 指で狙える大きさを確保する。字に合わせて詰めると高さが20ptほどしかなくなり、
  // 隣の画数を押してしまう
  chip: {
    minWidth: 52,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: GAP },
  // 案内文(小さい字)と打った読み(大きい字)で高さが変わらないよう、
  // 行の高さを決めて中の箱は伸ばす(alignItems は stretch のまま)
  readingRow: { flexDirection: "row", height: READING_ROW, gap: GAP },
  readingBox: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    justifyContent: "center",
  },
  readingClear: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    justifyContent: "center",
  },
  // 候補が無いとき(案内文)も 44 のまま空けておく
  hitRow: { flexGrow: 0, height: HIT_ROW },
  hitKey: {
    minWidth: 44,
    height: HIT_ROW,
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
