import { useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
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
import { Engine, rawData, type Result } from "./src/engine";
import { KatachiKeyboard } from "./src/KatachiKeyboard";
import { OperatorIcon } from "./src/OperatorIcon";
import { KANJI_FONT, useTheme } from "./src/theme";

const GRADE_LABEL: Record<number, string> = {
  1: "小1", 2: "小2", 3: "小3", 4: "小4", 5: "小5", 6: "小6",
  8: "常用", 9: "人名用", 10: "人名用",
};

const CAND_COLS = 6;

export default function App() {
  return (
    <SafeAreaProvider>
      <Screen />
    </SafeAreaProvider>
  );
}

function Screen() {
  const t = useTheme();
  const { height } = useWindowDimensions();

  const [engine, setEngine] = useState<Engine | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [mode, setMode] = useState("empty");
  const [output, setOutput] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // 既定は自前のカタチキーボード。「あ」で端末のキーボードに切り替える
  const [osKeyboard, setOsKeyboard] = useState(false);

  const inputRef = useRef<TextInput>(null);
  const caret = useRef({ start: 0, end: 0 });
  const [forceSel, setForceSel] = useState<{ start: number; end: number } | null>(null);

  // 辞書(約13,000字)の構築は最初の描画を待ってから行う
  useEffect(() => {
    const id = setTimeout(() => setEngine(new Engine(rawData)), 0);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    if (!engine) return;
    const id = setTimeout(() => {
      const found = engine.search(query);
      setResults(found.results);
      setMode(found.mode);
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
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  const selMeta = selected && engine ? engine.meta(selected) : undefined;
  const selDecomp = useMemo(
    () => (selected && engine ? engine.decompose(selected) : []),
    [selected, engine],
  );

  const keyboardMaxHeight = Math.min(height * 0.34, 280);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={["top", "bottom"]}>
      <StatusBar style={t.dark ? "light" : "dark"} />

      {/* ── 上段: タイトル + 出力(確定テキスト) ── */}
      <View style={[s.header, { backgroundColor: t.card, borderBottomColor: t.border }]}>
        <View style={s.titleRow}>
          <Text style={[s.title, { color: t.text }]}>カタチ入力</Text>
          <Text style={[s.subtitle, { color: t.faint }]}>読めない漢字を、見たまま打てる</Text>
        </View>
        <View style={s.row}>
          <TextInput
            value={output}
            editable={false}
            placeholder="ここに確定した文字が入ります"
            placeholderTextColor={t.faint}
            style={[
              s.field,
              { fontFamily: KANJI_FONT, color: t.text, borderColor: t.border, backgroundColor: t.bg },
            ]}
          />
          <Pressable
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
              onPress={() => {
                setOutput(o => o + item.ch);
                setSelected(item.ch);
              }}
              style={({ pressed }) => [
                s.candidate,
                {
                  backgroundColor: pressed ? t.accentBg : t.card,
                  borderColor: item.exact ? t.accent : t.border,
                },
              ]}
            >
              <Text style={{ fontFamily: KANJI_FONT, fontSize: 26, color: t.text }}>
                {item.ch}
              </Text>
            </Pressable>
          )}
        />

        {selected && selMeta && (
          <ScrollView
            horizontal={false}
            style={{ maxHeight: 96 }}
            contentContainerStyle={[
              s.detail,
              { backgroundColor: t.card, borderColor: t.border },
            ]}
          >
            <Text style={{ fontFamily: KANJI_FONT, fontSize: 44, color: t.text }}>
              {selected}
            </Text>
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.text, fontSize: 12 }}>
                {[
                  selMeta.on && `音: ${selMeta.on}`,
                  selMeta.kun && `訓: ${selMeta.kun}`,
                  GRADE_LABEL[selMeta.grade],
                ]
                  .filter(Boolean)
                  .join("　")}
              </Text>
              {selDecomp.length > 0 && (
                <Text style={{ color: t.sub, fontSize: 12, fontFamily: KANJI_FONT }}>
                  {selDecomp.join("　")}
                </Text>
              )}
            </View>
          </ScrollView>
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
          // 自前キーボード使用時は端末のキーボードを出さない(画面が隠れるため)
          showSoftInputOnFocus={osKeyboard}
          autoCorrect={false}
          autoCapitalize="characters"
          placeholder="例: LR日月"
          placeholderTextColor={t.faint}
          style={[
            s.field,
            { fontFamily: KANJI_FONT, color: t.text, borderColor: t.accent, backgroundColor: t.bg },
          ]}
        />
        <Pressable onPress={() => insert("?")} style={[s.smallBtn, { borderColor: t.border }]}>
          <Text style={{ color: t.sub, fontSize: 16 }}>?</Text>
        </Pressable>
        <Pressable onPress={backspace} style={[s.smallBtn, { borderColor: t.border }]}>
          <Text style={{ color: t.sub, fontSize: 16 }}>⌫</Text>
        </Pressable>
        <Pressable
          onPress={() => applyEdit("", 0)}
          style={[s.smallBtn, { borderColor: t.border }]}
        >
          <Text style={{ color: t.sub, fontSize: 16 }}>✕</Text>
        </Pressable>
      </View>

      <KatachiKeyboard
        engine={engine}
        theme={t}
        onInsert={insert}
        osKeyboard={osKeyboard}
        onToggleOsKeyboard={() => {
          setOsKeyboard(v => !v);
          inputRef.current?.blur();
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
        maxHeight={keyboardMaxHeight}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  header: { paddingHorizontal: 12, paddingBottom: 8, paddingTop: 4, borderBottomWidth: 1 },
  titleRow: { flexDirection: "row", alignItems: "baseline", gap: 6, marginBottom: 6 },
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
