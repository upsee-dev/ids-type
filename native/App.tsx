import { useEffect, useMemo, useRef, useState } from "react";
import {
  Linking,
  AppState,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
// 絵文字(🕘★⚙…)は端末ごとに絵柄も大きさも変わり、白黒のUIの中で1つだけ
// 色付きの絵が浮く。アイコンは字形のそろったフォントから引く。
// 静的読み込み(/static)なので app.json の config plugin で native に焼き込む
import { Ionicons } from "@react-native-vector-icons/ionicons/static";
// キーボードの絵は Ionicons に無い(keypad は電話のダイヤル面)。
// 「押すと端末のキーボードが出る」ボタンだけ Material の keyboard を使う
import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons/static";
import { StatusBar } from "expo-status-bar";
import * as Clipboard from "expo-clipboard";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  codePointLabel,
  Engine,
  radicalChar,
  rawData,
  refReadingLabel,
  THEMES,
  KEY_HEIGHTS,
  type KeyHeight,
  type Result,
  type SortMode,
} from "./src/engine";
import { KatachiKeyboard } from "./src/KatachiKeyboard";
import { OperatorIcon } from "./src/OperatorIcon";
import { AUTO_THEME, fontFor, INPUT_FONT, KANJI_FONT, useTheme } from "./src/theme";
import {
  haptic,
  HAPTIC_LEVELS,
  setHapticLevel,
  type HapticLevel,
} from "./src/feedback";
import { Settings } from "./src/Settings";
import {
  loadKeyHeight,
  loadSortMode,
  saveKeyHeight,
  saveSortMode,
} from "./src/prefs";
import { loadPro } from "./src/purchases";
import {
  loadFavorites,
  loadHistory,
  pushHistory,
  saveFavorites,
  saveHistory,
  toggleFavorite,
} from "./src/history";

const GRADE_LABEL: Record<number, string> = {
  1: "小1", 2: "小2", 3: "小3", 4: "小4", 5: "小5", 6: "小6",
  8: "常用", 9: "人名用", 10: "人名用",
};

const CAND_COLS = 6;

/**
 * 候補1ページの件数。部品1つで引くと数千件出るので、全部を一度に描くと
 * 指が止まる。ページに分けて**全件たどれる**ようにしてある。
 */
const CAND_PAGE = 200;

export default function App() {
  // 拡張B〜Jの字を描くフォントは app.json の expo-font プラグインで
  // 静的にバンドルしている(起動時の読み込み待ちが無く、Android では
  // システムIME からも同じ1部を読める)。ここでの読み込みは要らない。
  return (
    <SafeAreaProvider>
      <Screen />
    </SafeAreaProvider>
  );
}

/**
 * 漢字を並べて描く。端末の標準フォントに無い字(拡張B〜J)は同梱フォントに
 * 回す必要があり、React Native には unicode-range が無いので1字ずつ分ける。
 */
function Kanji({
  text,
  size,
  color,
  lines,
}: {
  text: string;
  size: number;
  color: string;
  /** 指定すると行数を抑える（解説をスクロールさせないため） */
  lines?: number;
}) {
  return (
    <Text numberOfLines={lines} style={{ fontSize: size, color }}>
      {[...text].map((ch, i) => (
        <Text key={i} style={{ fontFamily: fontFor(ch) }}>
          {ch}
        </Text>
      ))}
    </Text>
  );
}

const THEME_STORAGE_KEY = "katachi.theme";
const HAPTIC_STORAGE_KEY = "katachi.haptic";

function Screen() {
  // 着せ替え。既定は「おまかせ」(端末のライト/ダーク設定に追従)
  const [themeKey, setThemeKey] = useState(AUTO_THEME);
  const [showSettings, setShowSettings] = useState(false);
  const [isPro, setIsPro] = useState(false);
  useEffect(() => {
    loadPro().then(setIsPro).catch(() => {});
  }, []);
  // 触覚の強さ。モジュール側は再描画に関係しないので値を渡すだけ
  const [hapticLevel, setLevel] = useState<HapticLevel>("normal");
  /**
   * 候補の並び順。共有領域に置いてあるので、同期で読めて起動時にちらつかない
   * (キーボードもこの値を読む＝アプリで選べばシステムキーボードも変わる)
   */
  const [sortMode, setSortMode] = useState<SortMode>(loadSortMode);
  /** システムキーボードの縦幅。アプリの中のキーボードには効かない */
  const [keyHeight, setKeyHeight] = useState<KeyHeight>(loadKeyHeight);
  useEffect(() => {
    AsyncStorage.multiGet([THEME_STORAGE_KEY, HAPTIC_STORAGE_KEY])
      .then(([[, theme], [, level]]) => {
        if (theme) setThemeKey(theme);
        if (level) {
          setLevel(level as HapticLevel);
          setHapticLevel(level as HapticLevel);
        }
      })
      .catch(() => {});
  }, []);
  const pickTheme = (key: string) => {
    haptic("toggle");
    setThemeKey(key);
    AsyncStorage.setItem(THEME_STORAGE_KEY, key).catch(() => {});
  };
  const pickSort = (next: SortMode) => {
    haptic("toggle");
    setSortMode(next);
    saveSortMode(next);
  };
  const pickHeight = (next: KeyHeight) => {
    haptic("toggle");
    setKeyHeight(next);
    saveKeyHeight(next);
  };
  const pickHaptic = (next: HapticLevel) => {
    setLevel(next);
    setHapticLevel(next); // 先に反映してから鳴らす＝選んだ強さを その場で試せる
    haptic("commit");
    AsyncStorage.setItem(HAPTIC_STORAGE_KEY, next).catch(() => {});
  };

  const t = useTheme(themeKey);
  const { height } = useWindowDimensions();

  // 使った字の履歴とお気に入り（端末内にだけ残る）
  const [history, setHistory] = useState<string[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [shelf, setShelf] = useState<"none" | "history" | "favorites">("none");
  // 履歴とお気に入りはキーボード側とも共有している。キーボードで打った字が
  // アプリに戻ったとき出ていないと「消えた」と見えるので、前面に戻るたび読み直す
  useEffect(() => {
    const reload = () => {
      loadHistory().then(setHistory).catch(() => {});
      loadFavorites().then(setFavorites).catch(() => {});
    };
    reload();
    const sub = AppState.addEventListener("change", s => {
      if (s === "active") reload();
    });
    return () => sub.remove();
  }, []);

  const remember = (ch: string) => {
    setHistory(h => {
      const next = pushHistory(h, ch);
      saveHistory(next);
      return next;
    });
  };

  const toggleFav = (ch: string) => {
    haptic("commit");
    setFavorites(f => {
      const next = toggleFavorite(f, ch);
      saveFavorites(next);
      return next;
    });
  };

  const clearHistory = () => {
    haptic("delete");
    setHistory([]);
    saveHistory([]);
  };

  const [engine, setEngine] = useState<Engine | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  /** 絞り込みの全件数と、いま何ページめを見ているか(0始まり) */
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [mode, setMode] = useState("empty");
  const [output, setOutput] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // かたちコードを直接打つモード。⌨ で入り切りする。
  // 端末のIMEをそのまま当てると変換が始まった瞬間に欄ごと持っていかれ、
  // 先に選んだ〈左右〉が消えるので、変換の起きない英数キーボードを出す
  const [directInput, setDirectInput] = useState(false);

  const inputRef = useRef<TextInput>(null);
  const outputScroll = useRef<ScrollView>(null);

  // 辞書(約13,000字)の構築は最初の描画を待ってから行う
  useEffect(() => {
    const id = setTimeout(() => setEngine(new Engine(rawData)), 0);
    return () => clearTimeout(id);
  }, []);

  // 起動直後から打てるように、入力欄にカーソルを置いてキーボードを出しておく
  useEffect(() => {
    const id = setTimeout(() => inputRef.current?.focus(), 250);
    return () => clearTimeout(id);
  }, []);

  // 「該当なし」に落ちた瞬間だけ1回警告を返す。候補が0のあいだ打つたびに
  // 鳴らすとうるさいので、0でなかった状態からの変わり目でだけ出す
  const wasEmpty = useRef(false);

  /**
   * システムキーボードの「カメラ」から飛んできたときは、開いた先でカメラの面を出す。
   * 入力方式はカメラの権限を自分で求められないので、キーボード側は
   * ids-kanji-type://camera を投げるだけ＝受け取るのはここ。
   */
  const [cameraRequest, setCameraRequest] = useState(0);
  useEffect(() => {
    const wanted = (url: string | null) => !!url && url.includes("camera");
    Linking.getInitialURL()
      .then(u => {
        if (wanted(u)) setCameraRequest(n => n + 1);
      })
      .catch(() => {});
    const sub = Linking.addEventListener("url", ({ url }) => {
      if (wanted(url)) setCameraRequest(n => n + 1);
    });
    return () => sub.remove();
  }, []);

  /** 候補のグリッド。ページをめくったら頭から見せる(前のページの位置に残さない) */
  const gridRef = useRef<FlatList<Result>>(null);

  // 打ち直したり並び順を変えたりしたら1ページめに戻す
  useEffect(() => {
    setPage(0);
  }, [query, sortMode]);

  useEffect(() => {
    if (!engine) return;
    const id = setTimeout(() => {
      const found = engine.search(query, CAND_PAGE, sortMode, page * CAND_PAGE);
      setResults(found.results);
      setTotal(found.total);
      setMode(found.mode);
      const nowEmpty = !!query && found.mode !== "empty" && found.total === 0;
      if (nowEmpty && !wasEmpty.current) haptic("warn");
      wasEmpty.current = nowEmpty;
    }, 120);
    return () => clearTimeout(id);
  }, [engine, query, sortMode, page]);

  const pageCount = Math.max(1, Math.ceil(total / CAND_PAGE));

  const turnPage = (d: number) => {
    haptic("toggle");
    setPage(p => Math.min(pageCount - 1, Math.max(0, p + d)));
    gridRef.current?.scrollToOffset({ offset: 0, animated: false });
  };

  /**
   * かたちコードの編集。
   *
   * 以前はキャレット位置を selection で毎回押し込んでいたが、これが日本語IMEの
   * 変換と衝突し、変換を始めた瞬間に欄の中身ごと消えていた（先に選んだ〈左右〉が
   * 飛ぶ原因）。selection は渡さず、パレットからの挿入は末尾に足すだけにする。
   * 左から順に組み立てる入力なので、これで困る場面はほぼない。
   */
  const insert = (s: string) => setQuery(q => q + s);

  const backspace = () => {
    // サロゲートペア(𠮟 など)を1文字として消す
    setQuery(q => {
      const dropped = [...q].pop() ?? "";
      return q.slice(0, q.length - dropped.length);
    });
  };

  const copy = async () => {
    if (!output) return;
    await Clipboard.setStringAsync(output);
    haptic("success"); // 画面を見ていなくてもコピーできたと分かる
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  // 選択中の1字だけをコピーする(出力欄とは別。詳細パネルのボタンから使う)
  const [charCopied, setCharCopied] = useState(false);
  const copySelected = async () => {
    if (!selected) return;
    await Clipboard.setStringAsync(selected);
    haptic("success");
    setCharCopied(true);
    setTimeout(() => setCharCopied(false), 1200);
  };

  const selMeta = selected && engine ? engine.meta(selected) : undefined;
  const selDecomp = useMemo(
    () => (selected && engine ? engine.decompose(selected, 3) : []),
    [selected, engine],
  );

  /**
   * アプリの中のキーボードの高さ。設定の小・中・大で伸ばす
   * (システムキーボードは IME 側が同じことをしている)。
   * 伸ばしても画面の半分は超えさせない＝候補が見えなくならないように
   */
  const heightScale = KEY_HEIGHTS.find(h => h.key === keyHeight)?.scale ?? 1;
  const keyboardMaxHeight = Math.min(height * 0.34 * heightScale, 280 * heightScale, height * 0.5);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={["top", "bottom"]}>
      <StatusBar style={t.dark ? "light" : "dark"} />

      {/* ⌨ で端末のキーボードに切り替えたとき、下段の入力欄が
          キーボードに隠れて打っている文字が見えなくならないよう持ち上げる。
          Android は OS の adjustResize が同じことをするので iOS だけ */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >

      {/* ── 上段: タイトル + 出力(確定テキスト) ── */}
      <View style={[s.header, { backgroundColor: t.card, borderBottomColor: t.border }]}>
        <View style={s.titleRow}>
          <Text style={[s.title, { color: t.text }]}>漢字カタチ入力</Text>
          <Text style={[s.subtitle, { color: t.faint, flex: 1 }]} numberOfLines={1}>
            読めない漢字を、見たまま打てる
          </Text>
          <Pressable
            onPressIn={() => haptic("toggle")}
            onPress={() => setShelf(v => (v === "history" ? "none" : "history"))}
            hitSlop={8}
            accessibilityLabel="履歴"
            style={[
              s.themeBtn,
              {
                borderColor: shelf === "history" ? t.accent : t.border,
                backgroundColor: shelf === "history" ? t.accentBg : "transparent",
              },
            ]}
          >
            <Ionicons
              name="time-outline"
              size={20}
              color={shelf === "history" ? t.accent : t.sub}
            />
          </Pressable>
          <Pressable
            onPressIn={() => haptic("toggle")}
            onPress={() => setShelf(v => (v === "favorites" ? "none" : "favorites"))}
            hitSlop={8}
            accessibilityLabel="お気に入り"
            style={[
              s.themeBtn,
              {
                borderColor: shelf === "favorites" ? t.accent : t.border,
                backgroundColor: shelf === "favorites" ? t.accentBg : "transparent",
              },
            ]}
          >
            <Ionicons
              name={shelf === "favorites" ? "star" : "star-outline"}
              size={20}
              color={shelf === "favorites" ? t.accent : t.sub}
            />
          </Pressable>
          <Pressable
            onPressIn={() => haptic("toggle")}
            onPress={() => setShowSettings(true)}
            hitSlop={8}
            accessibilityLabel="設定"
            style={[s.themeBtn, { borderColor: t.border }]}
          >
            <Ionicons name="settings-outline" size={20} color={t.sub} />
          </Pressable>
        </View>

        <View style={s.row}>
          {/* 確定テキストは読むだけなので Text で組む。TextInput と違って
              1字ずつフォントを選べる＝拡張漢字が ☒ にならない。
              下段の入力欄と同じ「枠のある欄」に見えると打ちに行ってしまうので、
              枠は持たせず、左の帯と「出力」の見出しが付いた面として見せる */}
          <View style={[s.output, { backgroundColor: t.accentBg, borderLeftColor: t.accent }]}>
            <Text style={[s.outputTag, { color: t.accent }]}>出力</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              ref={outputScroll}
              onContentSizeChange={() => outputScroll.current?.scrollToEnd({ animated: false })}
              style={{ flex: 1, minWidth: 0 }}
              contentContainerStyle={s.outputInner}
            >
              {output ? (
                <Kanji text={output} size={20} color={t.text} />
              ) : (
                <Text style={{ fontSize: 12, color: t.sub }}>
                  選んだ字がここにたまります（コピーして使えます）
                </Text>
              )}
            </ScrollView>
          </View>
          <Pressable
            onPressIn={() => haptic("delete")}
            onPress={() => setOutput(o => [...o].slice(0, -1).join(""))}
            accessibilityLabel="出力を1字消す"
            style={[s.smallBtn, { borderColor: t.border }]}
          >
            <Ionicons name="backspace-outline" size={20} color={t.sub} />
          </Pressable>
          <Pressable onPress={copy} style={[s.primaryBtn, { backgroundColor: t.accent }]}>
            <Ionicons
              name={copied ? "checkmark" : "copy-outline"}
              size={14}
              color={t.onAccent}
            />
            <Text style={{ color: t.onAccent, fontSize: 12, fontWeight: "600" }}>
              {copied ? "コピー済" : "コピー"}
            </Text>
          </Pressable>
        </View>
      </View>

      {/* ── 履歴 / お気に入り ── */}
      {shelf !== "none" && (
        <View style={[s.shelf, { backgroundColor: t.card, borderBottomColor: t.border }]}>
          <View style={s.shelfHead}>
            <Text style={{ fontSize: 11, color: t.sub, flex: 1 }}>
              {shelf === "history"
                ? `使った字の履歴（新しい順・最大60字）`
                : "お気に入り"}
            </Text>
            {shelf === "history" && history.length > 0 && (
              <Pressable onPress={clearHistory} hitSlop={6}>
                <Text style={{ fontSize: 11, color: t.accent }}>履歴を消す</Text>
              </Pressable>
            )}
          </View>
          {(shelf === "history" ? history : favorites).length === 0 ? (
            <Text style={{ fontSize: 11, color: t.faint, paddingVertical: 10 }}>
              {shelf === "history"
                ? "まだありません。候補を選ぶとここに残ります。"
                : "まだありません。字を選んで★を押すと入ります。"}
            </Text>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="always"
              contentContainerStyle={{ gap: 4, paddingVertical: 4 }}
            >
              {(shelf === "history" ? history : favorites).map(ch => (
                <Pressable
                  key={ch}
                  onPressIn={() => haptic("commit")}
                  onPress={() => {
                    setOutput(o => o + ch);
                    setSelected(ch);
                    setCharCopied(false);
                    remember(ch);
                  }}
                  style={[s.shelfKey, { borderColor: t.border, backgroundColor: t.key }]}
                >
                  <Text style={{ fontFamily: fontFor(ch), fontSize: 24, color: t.text }}>
                    {ch}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
      )}

      {/* ── 中段: 候補 ── */}
      <View style={{ flex: 1 }}>
        {!engine && (
          <Text style={[s.notice, { color: t.sub }]}>辞書データを読み込み中…</Text>
        )}

        {engine && !query && (
          <View style={s.emptyState}>
            <Text style={{ color: t.sub, textAlign: "center" }}>
              下のキーボードで、漢字の「かたち」と「部品」を選んでください。
            </Text>
            <View style={s.exampleRow}>
              <View style={[s.chip, { borderColor: t.border }]}>
                <OperatorIcon code="LR" size={16} color={t.text} />
                <Text style={{ color: t.sub, fontSize: 12 }}>左右</Text>
              </View>
              <Text style={{ color: t.faint }}>+</Text>
              <View style={[s.chip, { borderColor: t.border }]}>
                <Text style={{ fontFamily: KANJI_FONT, color: t.text }}>日</Text>
              </View>
              <View style={[s.chip, { borderColor: t.border }]}>
                <Text style={{ fontFamily: KANJI_FONT, color: t.text }}>月</Text>
              </View>
              <Text style={{ color: t.faint }}>=</Text>
              <Text style={{ fontFamily: KANJI_FONT, color: t.text, fontSize: 26 }}>明</Text>
            </View>
          </View>
        )}

        {engine && !!query && (
          <Text style={[s.status, { color: t.sub }]}>
            {mode === "structure"
              ? `構造マッチ: ${total.toLocaleString()}件(枠付き=完全一致)`
              : mode === "parts"
                ? `部品を含む字: ${total.toLocaleString()}件`
                : "かたちか部品を入力してください"}
            {total > CAND_PAGE &&
              `　${(page * CAND_PAGE + 1).toLocaleString()}〜${Math.min(
                total,
                (page + 1) * CAND_PAGE,
              ).toLocaleString()}件目`}
          </Text>
        )}

        <FlatList
          ref={gridRef}
          data={results}
          numColumns={CAND_COLS}
          keyExtractor={r => r.ch}
          keyboardShouldPersistTaps="always"
          // 候補を眺めたいときはスクロールで端末のキーボードを引っ込められる
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 8, gap: 4 }}
          columnWrapperStyle={{ gap: 4 }}
          ListEmptyComponent={
            engine && !!query && mode !== "empty" ? (
              <Text style={[s.notice, { color: t.sub }]}>
                該当なし。部品を減らすか ? (なんでも)に置き換えてみてください。
              </Text>
            ) : null
          }
          // ページ送り。候補は全件たどれるが、一度に描くのは1ページぶんだけ
          ListFooterComponent={
            pageCount > 1 ? (
              <View style={s.pager}>
                <PagerButton
                  theme={t}
                  label={`前の${CAND_PAGE}件`}
                  disabled={page === 0}
                  onPress={() => turnPage(-1)}
                />
                <Text style={{ fontSize: 12, color: t.sub }}>
                  {page + 1} / {pageCount}
                </Text>
                <PagerButton
                  theme={t}
                  label={`次の${CAND_PAGE}件`}
                  disabled={page >= pageCount - 1}
                  onPress={() => turnPage(1)}
                />
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <Pressable
              onPressIn={() => haptic("commit")}
              onPress={() => {
                setOutput(o => o + item.ch);
                setSelected(item.ch);
                setCharCopied(false);
                remember(item.ch);
              }}
              style={({ pressed }) => [
                s.candidate,
                {
                  backgroundColor: pressed ? t.accentBg : t.card,
                  borderColor: item.exact ? t.accent : t.border,
                  // ext(KANJIDIC2 外の拡張漢字)は破線。端末フォントに無くて□になっても
                  // 「読み込み失敗」ではなく「そういう字」だと分かるようにしている
                  borderStyle: item.meta.ext ? "dashed" : "solid",
                },
              ]}
            >
              <Text
                style={{
                  fontFamily: fontFor(item.ch),
                  fontSize: 26,
                  color: item.meta.ext ? t.sub : t.text,
                }}
              >
                {item.ch}
              </Text>
            </Pressable>
          )}
        />

        {selected && selMeta && (
          // 高さを固定するとスクロールが要る＝ひとめで読めないので、
          // 中身の量に合わせて伸ばす（行数は下で numberOfLines に抑えてある）
          <View style={[s.detail, { backgroundColor: t.card, borderColor: t.border }]}>
            <Text style={{ fontFamily: fontFor(selected), fontSize: 44, color: t.text }}>
              {selected}
            </Text>
            <View style={{ flex: 1, gap: 2 }}>
              {/* 読みがいちばん知りたい情報なので先頭に大きく。
                  ただし**正式(KANJIDIC2の音訓)だけ**を大きい字で出し、
                  人名・参考・推定は下に小さく、出所を添えて置く
                  (辞書にある読みと、こちらで推した読みを同じ顔で出さない) */}
              {selMeta.on || selMeta.kun ? (
                <Text style={{ color: t.text, fontSize: 14, fontWeight: "600" }}>
                  {[
                    selMeta.on && `音 ${selMeta.on}`,
                    selMeta.kun && `訓 ${selMeta.kun}`,
                  ]
                    .filter(Boolean)
                    .join("　")}
                </Text>
              ) : !selMeta.ref ? (
                <Text style={{ color: t.sub, fontSize: 11 }}>読みデータなし</Text>
              ) : null}
              {(!!selMeta.nanori || !!selMeta.ref) && (
                <Text numberOfLines={2} style={{ color: t.sub, fontSize: 11 }}>
                  {[
                    selMeta.nanori && `人名 ${selMeta.nanori}`,
                    selMeta.ref &&
                      `${refReadingLabel(selMeta.refKind)} ${selMeta.ref}`,
                  ]
                    .filter(Boolean)
                    .join("　")}
                </Text>
              )}
              <Text style={{ color: t.sub, fontSize: 11 }}>
                {[
                  selMeta.strokes > 0 && `${selMeta.strokes}画`,
                  !!radicalChar(selMeta.rad) && `部首 ${radicalChar(selMeta.rad)}`,
                  GRADE_LABEL[selMeta.grade],
                  selMeta.freq > 0 && `頻度 ${selMeta.freq}位`,
                  codePointLabel(selected),
                ]
                  .filter(Boolean)
                  .join("　")}
              </Text>
              {!!selMeta.meaning && (
                <Text numberOfLines={2} style={{ color: t.sub, fontSize: 11 }}>
                  意味(英): {selMeta.meaning}
                </Text>
              )}
              {selDecomp.length > 0 && (
                <Kanji text={selDecomp.join("　")} size={11} color={t.sub} lines={2} />
              )}
            </View>
            <View style={{ alignItems: "center", gap: 8 }}>
              <Pressable
                onPress={() => toggleFav(selected)}
                hitSlop={6}
                accessibilityLabel={
                  favorites.includes(selected) ? "お気に入りから外す" : "お気に入りに入れる"
                }
              >
                <Ionicons
                  name={favorites.includes(selected) ? "star" : "star-outline"}
                  size={22}
                  color={favorites.includes(selected) ? t.accent : t.faint}
                />
              </Pressable>
              <Pressable
                onPress={copySelected}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 4,
                  borderRadius: 8,
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  backgroundColor: t.accent,
                }}
              >
                <Ionicons
                  name={charCopied ? "checkmark" : "copy-outline"}
                  size={13}
                  color={t.onAccent}
                />
                <Text style={{ color: t.onAccent, fontSize: 11, fontWeight: "600" }}>
                  {charCopied ? "コピー済" : "コピー"}
                </Text>
              </Pressable>
              <Pressable
                onPressIn={() => haptic("toggle")}
                onPress={() => setSelected(null)}
                hitSlop={8}
                accessibilityLabel="詳細を閉じる"
              >
                <Ionicons name="close" size={18} color={t.faint} />
              </Pressable>
            </View>
          </View>
        )}
      </View>

      {/* ── 下段: 入力欄 + カタチキーボード ── */}
      <View style={[s.queryBar, { backgroundColor: t.card, borderTopColor: t.border }]}>
        <TextInput
          ref={inputRef}
          value={query}
          onChangeText={setQuery}
          // ⌨ を押したときだけ端末のキーボードを出す。出すのは変換の起きない
          // 英数キーボード(iOS: ascii-capable / Android: visible-password)。
          // かな入力のまま打たせると変換が始まった瞬間に欄ごと持っていかれ、
          // 先に選んだ〈左右〉が消える。部品は palette か「読みでさがす」から
          showSoftInputOnFocus={directInput}
          autoCorrect={false}
          autoCapitalize="none"
          placeholder="例: LR日月"
          placeholderTextColor={t.faint}
          style={[
            s.field,
            { fontFamily: INPUT_FONT, color: t.text, borderColor: t.accent, backgroundColor: t.bg },
          ]}
        />
        <Pressable
          onPressIn={() => haptic("toggle")}
          onPress={() => {
            const next = !directInput;
            setDirectInput(next);
            // showSoftInputOnFocus の反映後に当て直さないと出ない/引っ込まない
            inputRef.current?.blur();
            setTimeout(() => inputRef.current?.focus(), 0);
            if (!next) Keyboard.dismiss();
          }}
          accessibilityLabel={
            directInput ? "端末のキーボードを閉じる" : "端末のキーボードを出して直接打つ"
          }
          style={[
            // ここだけは「押せば端末のキーボードが出る」と分かってほしいので、
            // 他の小さなキー(? ⌫ ✕)より横に広く取り、常に色を敷いて浮かせる
            s.keyboardBtn,
            {
              borderColor: t.accent,
              backgroundColor: directInput ? t.accent : t.accentBg,
            },
          ]}
        >
          <MaterialDesignIcons
            name={directInput ? "keyboard-off-outline" : "keyboard-outline"}
            size={22}
            color={directInput ? t.onAccent : t.accent}
          />
          <Text
            style={{
              fontSize: 9,
              fontWeight: "600",
              marginTop: 1,
              color: directInput ? t.onAccent : t.accent,
            }}
          >
            {directInput ? "閉じる" : "キーボード"}
          </Text>
        </Pressable>
        {/* ? は「任意の1字」として欄にそのまま入る文字なので、アイコンに
            置き換えず打てる字のまま見せる */}
        <Pressable
          onPressIn={() => haptic("key")}
          onPress={() => insert("?")}
          accessibilityLabel="任意の1字(?)を入れる"
          style={[s.smallBtn, { borderColor: t.border }]}
        >
          <Text style={{ color: t.sub, fontSize: 16 }}>?</Text>
        </Pressable>
        <Pressable
          onPressIn={() => haptic("delete")}
          onPress={backspace}
          accessibilityLabel="1字消す"
          style={[s.smallBtn, { borderColor: t.border }]}
        >
          <Ionicons name="backspace-outline" size={20} color={t.sub} />
        </Pressable>
        <Pressable
          onPressIn={() => haptic("delete")}
          onPress={() => setQuery("")}
          accessibilityLabel="入力を全部消す"
          style={[s.smallBtn, { borderColor: t.border }]}
        >
          <Ionicons name="close" size={20} color={t.sub} />
        </Pressable>
      </View>

      {/* キーボードは常に出しておく。フォーカスに連動して隠すと、候補を
          タップした拍子などに消えてしまい「キーボードが出ない」ことになる。
          カーソルは起動時に自動で入力欄へ置くので、すぐ打ち始められる */}
      <KatachiKeyboard
        engine={engine}
        theme={t}
        favorites={favorites}
        onInsert={insert}
        // 手書き候補のタップ・読み候補の長押しは、候補一覧のタップと同じ扱いで
        // 出力へためる(履歴にも残す)。詳細も開くので、書いた字の読みがすぐ分かる
        onCommit={ch => {
          setOutput(o => o + ch);
          setSelected(ch);
          setCharCopied(false);
          remember(ch);
        }}
        maxHeight={keyboardMaxHeight}
        cameraRequest={cameraRequest}
        collapsed={directInput}
        onExpand={() => {
          setDirectInput(false);
          Keyboard.dismiss();
        }}
      />
      </KeyboardAvoidingView>

      <Settings
        visible={showSettings}
        onClose={() => setShowSettings(false)}
        theme={t}
        themeKey={themeKey}
        onPickTheme={pickTheme}
        hapticLevel={hapticLevel}
        onPickHaptic={pickHaptic}
        sortMode={sortMode}
        onPickSort={pickSort}
        keyHeight={keyHeight}
        onPickHeight={pickHeight}
        historyCount={history.length}
        favoriteCount={favorites.length}
        onClearHistory={clearHistory}
        isPro={isPro}
      />
    </SafeAreaView>
  );
}

/** ページ送りのボタン。端末のフォントに頼らないよう記号は使わず日本語で出す */
function PagerButton({
  theme: t,
  label,
  disabled,
  onPress,
}: {
  theme: ReturnType<typeof useTheme>;
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        s.pagerBtn,
        {
          borderColor: disabled ? t.border : t.accent,
          backgroundColor: pressed ? t.accentBg : "transparent",
          opacity: disabled ? 0.4 : 1,
        },
      ]}
    >
      <Text style={{ fontSize: 12, color: disabled ? t.faint : t.accent }}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  header: { paddingHorizontal: 12, paddingBottom: 8, paddingTop: 4, borderBottomWidth: 1 },
  pager: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingVertical: 12,
  },
  pagerBtn: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  // 履歴・お気に入り・設定。指で狙える大きさ(38pt角)を確保する
  themeBtn: {
    borderWidth: 1,
    borderRadius: 10,
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 16, fontWeight: "700" },
  subtitle: { fontSize: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  field: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === "ios" ? 10 : 6,
    fontSize: 18,
  },
  // 出力(結果)の面。入力欄(field)とは別物と一目で分かるよう、枠を持たせず
  // 左に帯を立てて塗りで見せる
  output: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderLeftWidth: 3,
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8,
    paddingLeft: 8,
    paddingRight: 10,
    paddingVertical: Platform.OS === "ios" ? 8 : 5,
  },
  outputTag: { fontSize: 10, fontWeight: "700", letterSpacing: 1 },
  outputInner: { alignItems: "center", minHeight: 26 },
  shelf: { paddingHorizontal: 12, paddingBottom: 6, borderBottomWidth: 1 },
  shelfHead: { flexDirection: "row", alignItems: "center", paddingTop: 6 },
  shelfKey: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 8,
  },
  smallBtn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minWidth: 44,
    alignItems: "center",
  },
  // 端末のキーボードを出すボタン。? ⌫ ✕ と同じ見た目だと埋もれるので、
  // 幅は1.5倍、色は常にアクセントを敷いて他と別物に見せる
  keyboardBtn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    minWidth: 66,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  notice: { textAlign: "center", paddingVertical: 24, fontSize: 13 },
  status: { fontSize: 11, paddingHorizontal: 12, paddingVertical: 6 },
  emptyState: { paddingHorizontal: 24, paddingVertical: 24, gap: 12 },
  exampleRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  candidate: {
    flex: 1,
    height: 50,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 8,
  },
  detail: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    marginHorizontal: 12,
    marginBottom: 8,
    padding: 10,
    borderWidth: 1,
    borderRadius: 12,
  },
  queryBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
  },
});
