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
  CURVE_KANJI,
  DIFFICULT_COMPONENTS,
  kanaCycle,
  OPERATORS,
  PRIMARY_CODES,
  STROKE_MAX,
  type Engine,
  type KanaLayout,
} from "./engine";
import { loadKanaLayout } from "./prefs";
import { OperatorIcon } from "./OperatorIcon";
import { CameraPad } from "./CameraPad";
import { KanaPad } from "./FlickKanaPad";
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
  { id: "radical", label: "部分" },
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
  /** ★に入れてきた字。部分タブの先頭「お気に入り」に並べる */
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
  const { width, height: screenH } = useWindowDimensions();

  /**
   * 面の高さ。**カメラだけは打鍵の面より大きく取る**。
   * フリックや手書きと違って指を置いて動かす場所ではなく、写した字が
   * 大きいほど読み取りが当たるので、枠の小ささがそのまま失敗になる。
   */
  const padHeight =
    tab === "camera" ? Math.min(maxHeight * 1.7, screenH * 0.5) : maxHeight;

  // かたちは**最初から全部**並べる(よく使う順が先頭・残りは横スクロール)。
  // 「その他」で畳むと、使いたいかたちが畳まれた側にあるたびに1手増える
  const ops = useMemo(() => {
    const primary = PRIMARY_CODES.map(c => OPERATORS.find(o => o.code === c)!).filter(Boolean);
    return [...primary, ...OPERATORS.filter(o => !PRIMARY_CODES.includes(o.code))];
  }, []);


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
 * 部分タブ。先頭は**お気に入り**——これまで★に入れてきた字をそのまま並べ、
 * 画数チップを選ぶと zi.tools の「難輸入部件」全541件をその画数ぶんだけ出す。
 * 541件を一度に並べると探せないので、zi.tools と同じく画数で区切っている。
 * 「曲線を含む」は丸・渦・かなのような漢字らしくない丸みを持つ字の一覧(CURVE_KANJI)。
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
    if (group === "curve") return [...CURVE_KANJI];
    return [...(DIFFICULT_COMPONENTS.find(g => g.strokes === group)?.parts ?? "")];
  }, [group, favorites]);

  const chips = [
    { key: "favorites", label: "お気に入り" },
    { key: "curve", label: "曲線を含む" },
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
 * 読みを打たずに**画数だけ選んでも引ける**(読みの分からない字でも画数は数えられる)。
 *
 * 「U+」を押すとかなの面が16進の面に替わり、**符号位置で引ける**(U+4E00 → 一。
 * 打ちかけの 2B81 なら U+2B810〜U+2B81F)。コード表や文献で番号だけ分かっている字用。
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
  /**
   * 読みを打つ入力方法。設定(共有領域)で選ぶので、システムキーボードでも同じ面が出る。
   * 開いている間は変えられないので、最初に1回だけ読む
   */
  const [kanaLayout] = useState<KanaLayout>(loadKanaLayout);
  /** ローマ字・Godan の打ちかけ(k・ky など)。かなに直せたぶんだけ reading に入る */
  const [romajiPending, setRomajiPending] = useState("");
  /** 画数の絞り込み。0=指定なし。STROKE_MAX は「それ以上」 */
  const [strokes, setStrokes] = useState(0);
  const [page, setPage] = useState(0);
  /**
   * 符号位置(U+XXXX)で引く面を出しているか。出しているあいだはかなの面の代わりに
   * 16進のキー(0〜F)が並ぶ。打った16進は hex に持ち、読みとは混ぜない
   * (ローマ字の打ちかけの仕組みに A〜F を通すと、かなに化ける)
   */
  const [codeMode, setCodeMode] = useState(false);
  const [hex, setHex] = useState("");

  const found = useMemo(() => {
    const none = { items: [] as string[], total: 0 };
    if (!engine) return none;
    const q = codeMode ? (hex ? `U+${hex}` : "") : reading.trim();
    // 読みが空でも**画数だけ選んでいれば、その画数の字を全部出す**(並びは読みと同じ
    // 段→版順)。読めない字でも画数は数えられるので、それだけで探し始められる。
    // 16進の面では何か打つまで出さない(画数だけの一覧は読みの面の役目)
    if (!q && (codeMode || !strokes)) return none;
    // 読み・符号位置のどれでも引ける（Engine#list がまとめて面倒を見る）。
    // 符号位置は U+ を付けて渡すと、打ちかけ(2B81)が前方一致になる(U+2B810〜U+2B81F)。
    // **日本の字に絞らない**。拡張漢字にも資料の読み(参考)や外国語の読みがあり
    // (正式→人名→参考→外国語の順に並ぶ)、絞ると拡張漢字が読みで引けなくなる。
    // よく使う字が先に出る並びはエンジン側で保証されている
    const r = engine.list({
      query: q,
      strokes,
      offset: page * READING_PAGE,
      limit: READING_PAGE,
    });
    return { items: r.items.map(i => i.ch), total: r.total };
  }, [engine, reading, strokes, page, codeMode, hex]);

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
          {codeMode ? (
            hex ? (
              <Text numberOfLines={1} style={{ fontSize: 16, color: theme.text }}>
                <Text style={{ color: theme.sub }}>U+</Text>
                {hex}
              </Text>
            ) : (
              <Text numberOfLines={1} style={{ fontSize: 12, color: theme.faint }}>
                符号位置を16進で（例: 4E00）
              </Text>
            )
          ) : reading || preview || romajiPending ? (
            <Text numberOfLines={1} style={{ fontSize: 16, color: theme.text }}>
              {reading}
              {/* ローマ字の打ちかけ(k・ky)。まだ かな にできていないので薄く出す */}
              {!!romajiPending && (
                <Text style={{ color: theme.sub }}>{romajiPending}</Text>
              )}
              {preview != null && (
                <Text style={{ color: theme.accent }}>{preview}</Text>
              )}
            </Text>
          ) : (
            <Text numberOfLines={1} style={{ fontSize: 12, color: theme.faint }}>
              {kanaLayout === "flick"
                ? "読みをフリックで（例: つち・かい）"
                : "読みをローマ字で（例: tuchi・kai）"}
            </Text>
          )}
        </View>
        {/* 符号位置(U+XXXX)で引く面との切り替え。かなの面と16進の面は場所を
            取り合うので入れ替える(面の高さは同じ＝キーの位置は動かない)。
            切り替えるたびに読みも16進も空にする(混ざると何で引いたか分からない) */}
        <Pressable
          onPressIn={() => haptic("toggle")}
          onPress={() => {
            resetPage();
            setCodeMode(m => !m);
            setHex("");
            setReading("");
            setRomajiPending("");
            setPreview(null);
          }}
          style={[
            styles.readingClear,
            {
              borderColor: codeMode ? theme.accent : theme.border,
              backgroundColor: codeMode ? theme.accent : "transparent",
            },
          ]}
        >
          <Text style={{ fontSize: 12, color: codeMode ? theme.onAccent : theme.sub }}>U+</Text>
        </Pressable>
        <Pressable
          onPressIn={() => haptic("delete")}
          onPress={() => {
            resetPage();
            if (codeMode) setHex("");
            else setReading("");
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
            {(codeMode ? hex : reading.trim() || strokes > 0)
              ? strokes > 0
                ? "該当なし（画数の絞り込みを外すと出るかもしれません）"
                : "該当なし"
              : codeMode
                ? "打った16進で始まる字が出ます（2B81 → U+2B810〜）"
                : "読みを打つか、画数だけ選んでも出ます。タップで部品に・長押しで出力へ"}
          </Text>
        )}
      </ScrollView>

      {/* ── 読みを打つ面(フリック / ローマ字 / Godan)、または16進の面 ── */}
      {codeMode ? (
        <HexPad
          theme={theme}
          onDigit={d => {
            resetPage();
            // 符号位置は最大6桁(U+10FFFF)。それより先は打っても足さない
            setHex(h => (h.length < 6 ? h + d : h));
          }}
          onBackspace={() => {
            resetPage();
            setHex(h => h.slice(0, -1));
          }}
        />
      ) : (
        <KanaPad
          layout={kanaLayout}
          pending={romajiPending}
          onPending={setRomajiPending}
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
      )}
    </View>
  );
}

/**
 * 16進の面(0〜F と ⌫)。符号位置で引くときにかなの面と入れ替えて出す。
 * 段の数(4段)と面の高さはかなの面と同じにして、切り替えてもキーの位置が動かないようにする。
 * 並びは電話の数字キーと同じ 1 2 3 を上に置き、右の2列に A〜F を足した形。
 * システムキーボード(KeyboardView.kt / KeyboardViewController.swift)も同じ並び
 */
const HEX_ROWS = [
  ["1", "2", "3", "A", "B"],
  ["4", "5", "6", "C", "D"],
  ["7", "8", "9", "E", "F"],
];

function HexPad({
  theme,
  onDigit,
  onBackspace,
}: {
  theme: Theme;
  onDigit: (d: string) => void;
  onBackspace: () => void;
}) {
  const key = (label: string, flex: number, onPress: () => void, isDigit = true) => (
    <Pressable
      key={label}
      onPressIn={() => haptic(isDigit ? "key" : "delete")}
      onPress={onPress}
      style={({ pressed }) => [
        styles.hexKey,
        {
          flex,
          backgroundColor: pressed ? theme.accentBg : theme.key,
          borderColor: theme.border,
        },
      ]}
    >
      <Text
        style={{
          fontSize: isDigit ? 18 : 12,
          fontWeight: "500",
          color: isDigit ? theme.text : theme.sub,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
  return (
    <View style={styles.hexPad}>
      {HEX_ROWS.map((row, ri) => (
        <View key={ri} style={styles.hexRow}>
          {row.map(d => key(d, 1, () => onDigit(d)))}
        </View>
      ))}
      {/* 最後の段は 0 を3列ぶん・⌫ を2列ぶん(数字キーと同じく 0 は 7 8 9 の下) */}
      <View style={styles.hexRow}>
        {key("0", 3, () => onDigit("0"))}
        {key("⌫", 2, onBackspace, false)}
      </View>
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
  // 16進の面。かなの面(FlickKanaPad の pad/row/key)と同じ寸法にしてある
  hexPad: { flex: 1, gap: 4 },
  hexRow: { flex: 1, flexDirection: "row", gap: 4 },
  hexKey: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    borderWidth: 1,
  },
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
