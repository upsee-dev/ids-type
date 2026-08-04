import { useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
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
import { StatusBar } from "expo-status-bar";
import * as Clipboard from "expo-clipboard";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  codePointLabel,
  Engine,
  radicalChar,
  rawData,
  THEMES,
  type Result,
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
  useEffect(() => {
    loadHistory().then(setHistory).catch(() => {});
    loadFavorites().then(setFavorites).catch(() => {});
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
  const [mode, setMode] = useState("empty");
  const [output, setOutput] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const inputRef = useRef<TextInput>(null);
  const outputScroll = useRef<ScrollView>(null);
  const caret = useRef({ start: 0, end: 0 });
  const [forceSel, setForceSel] = useState<{ start: number; end: number } | null>(null);

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

  useEffect(() => {
    if (!engine) return;
    const id = setTimeout(() => {
      const found = engine.search(query);
      setResults(found.results);
      setMode(found.mode);
      const nowEmpty =
        !!query && found.mode !== "empty" && found.results.length === 0;
      if (nowEmpty && !wasEmpty.current) haptic("warn");
      wasEmpty.current = nowEmpty;
    }, 120);
    return () => clearTimeout(id);
  }, [engine, query]);

  // selection を1レンダーだけ固定してキャレットを移し、あとは端末に任せる
  useEffect(() => {
    if (forceSel) setForceSel(null);
  }, [forceSel]);

  const applyEdit = (next: string, caretPos: number) => {
    caret.current = { start: caretPos, end: caretPos };
    setForceSel({ start: caretPos, end: caretPos });
    setQuery(next);
  };

  const insert = (s: string) => {
    const { start, end } = caret.current;
    const safeStart = Math.min(start, query.length);
    const safeEnd = Math.min(end, query.length);
    applyEdit(query.slice(0, safeStart) + s + query.slice(safeEnd), safeStart + s.length);
  };

  const backspace = () => {
    const { start, end } = caret.current;
    const safeStart = Math.min(start, query.length);
    const safeEnd = Math.min(end, query.length);
    if (safeStart !== safeEnd) {
      applyEdit(query.slice(0, safeStart) + query.slice(safeEnd), safeStart);
    } else if (safeStart > 0) {
      // サロゲートペア(𠮟 など)を1文字として消す
      const dropped = [...query.slice(0, safeStart)].pop() ?? "";
      applyEdit(
        query.slice(0, safeStart - dropped.length) + query.slice(safeStart),
        safeStart - dropped.length,
      );
    }
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

  const keyboardMaxHeight = Math.min(height * 0.34, 280);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={["top", "bottom"]}>
      <StatusBar style={t.dark ? "light" : "dark"} />

      {/* 「あ」で端末のキーボードに切り替えたとき、下段の入力欄が
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
            style={[s.themeBtn, { borderColor: shelf === "history" ? t.accent : t.border }]}
          >
            <Text style={{ fontSize: 13 }}>🕘</Text>
          </Pressable>
          <Pressable
            onPressIn={() => haptic("toggle")}
            onPress={() => setShelf(v => (v === "favorites" ? "none" : "favorites"))}
            hitSlop={8}
            accessibilityLabel="お気に入り"
            style={[s.themeBtn, { borderColor: shelf === "favorites" ? t.accent : t.border }]}
          >
            <Text style={{ fontSize: 13 }}>★</Text>
          </Pressable>
          <Pressable
            onPressIn={() => haptic("toggle")}
            onPress={() => setShowSettings(true)}
            hitSlop={8}
            accessibilityLabel="設定"
            style={[s.themeBtn, { borderColor: t.border }]}
          >
            <Text style={{ fontSize: 13 }}>⚙</Text>
          </Pressable>
        </View>

        <View style={s.row}>
          {/* 確定テキストは読むだけなので Text で組む。TextInput と違って
              1字ずつフォントを選べる＝拡張漢字が ☒ にならない */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            ref={outputScroll}
            onContentSizeChange={() => outputScroll.current?.scrollToEnd({ animated: false })}
            style={[s.field, { borderColor: t.border, backgroundColor: t.bg }]}
            contentContainerStyle={s.outputInner}
          >
            {output ? (
              <Kanji text={output} size={18} color={t.text} />
            ) : (
              <Text style={{ fontSize: 18, color: t.faint }}>
                ここに確定した文字が入ります
              </Text>
            )}
          </ScrollView>
          <Pressable
            onPressIn={() => haptic("delete")}
            onPress={() => setOutput(o => [...o].slice(0, -1).join(""))}
            style={[s.smallBtn, { borderColor: t.border }]}
          >
            <Text style={{ color: t.sub, fontSize: 16 }}>⌫</Text>
          </Pressable>
          <Pressable onPress={copy} style={[s.primaryBtn, { backgroundColor: t.accent }]}>
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
              ? `構造マッチ: ${results.length}件(枠付き=完全一致)`
              : mode === "parts"
                ? `部品を含む字: ${results.length}件`
                : "かたちか部品を入力してください"}
          </Text>
        )}

        <FlatList
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
              {/* 読みがいちばん知りたい情報なので先頭に大きく */}
              {selMeta.on || selMeta.kun ? (
                <Text style={{ color: t.text, fontSize: 14, fontWeight: "600" }}>
                  {[
                    selMeta.on && `音 ${selMeta.on}`,
                    selMeta.kun && `訓 ${selMeta.kun}`,
                  ]
                    .filter(Boolean)
                    .join("　")}
                </Text>
              ) : (
                <Text style={{ color: t.sub, fontSize: 11 }}>
                  読みデータなし(KANJIDIC2 未収録の拡張漢字)
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
                <Text
                  style={{
                    fontSize: 20,
                    color: favorites.includes(selected) ? t.accent : t.faint,
                  }}
                >
                  {favorites.includes(selected) ? "★" : "☆"}
                </Text>
              </Pressable>
              <Pressable
                onPress={copySelected}
                style={{ borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: t.accent }}
              >
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
                <Text style={{ color: t.faint, fontSize: 14 }}>✕</Text>
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
          onSelectionChange={e => {
            caret.current = e.nativeEvent.selection;
          }}
          selection={forceSel ?? undefined}
          // かたちコードの欄には端末のIMEを一切触らせない。触らせると変換が
          // 始まった瞬間に欄ごと持っていかれ、先に選んだ〈左右〉などが消える。
          // 読みから部品を引きたいときはキーボード内の「読みでさがす」を使う
          showSoftInputOnFocus={false}
          autoCorrect={false}
          autoCapitalize="characters"
          placeholder="例: LR日月"
          placeholderTextColor={t.faint}
          style={[
            s.field,
            { fontFamily: INPUT_FONT, color: t.text, borderColor: t.accent, backgroundColor: t.bg },
          ]}
        />
        <Pressable
          onPressIn={() => haptic("key")}
          onPress={() => insert("?")}
          style={[s.smallBtn, { borderColor: t.border }]}
        >
          <Text style={{ color: t.sub, fontSize: 16 }}>?</Text>
        </Pressable>
        <Pressable
          onPressIn={() => haptic("delete")}
          onPress={backspace}
          style={[s.smallBtn, { borderColor: t.border }]}
        >
          <Text style={{ color: t.sub, fontSize: 16 }}>⌫</Text>
        </Pressable>
        <Pressable
          onPressIn={() => haptic("delete")}
          onPress={() => applyEdit("", 0)}
          style={[s.smallBtn, { borderColor: t.border }]}
        >
          <Text style={{ color: t.sub, fontSize: 16 }}>✕</Text>
        </Pressable>
      </View>

      {/* キーボードは常に出しておく。フォーカスに連動して隠すと、候補を
          タップした拍子などに消えてしまい「キーボードが出ない」ことになる。
          カーソルは起動時に自動で入力欄へ置くので、すぐ打ち始められる */}
      <KatachiKeyboard
        engine={engine}
        theme={t}
        onInsert={insert}
        maxHeight={keyboardMaxHeight}
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
        historyCount={history.length}
        favoriteCount={favorites.length}
        onClearHistory={clearHistory}
        isPro={isPro}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header: { paddingHorizontal: 12, paddingBottom: 8, paddingTop: 4, borderBottomWidth: 1 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  themeBtn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
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
  primaryBtn: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 11 },
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
