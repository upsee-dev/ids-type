import { useEffect, useState } from "react";
import { FlatList, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { IRG_WORKING_SETS, irgEntryUrl, type IrgEntry, type IrgWorkingSet } from "./irgWorkingSets";
import { fontFor, type Theme } from "./theme";
import { haptic } from "./feedback";

// Metroが各ファイルを解決できるよう静的なパスにし、開いたセットだけを読み込む。
function loadEntries(ws: IrgWorkingSet): IrgEntry[] {
  switch (ws) {
    case "ws2015": return require("../assets/irg/ws2015.json");
    case "ws2017": return require("../assets/irg/ws2017.json");
    case "ws2021": return require("../assets/irg/ws2021.json");
    case "ws2024": return require("../assets/irg/ws2024.json");
  }
}

function Glyphs({ text, color, size }: { text: string; color: string; size: number }) {
  return (
    <Text style={{ color, fontSize: size }}>
      {[...text].map((ch, i) => <Text key={i} style={{ fontFamily: fontFor(ch) }}>{ch}</Text>)}
    </Text>
  );
}

export function IrgWorkingSetTab({ theme: t, onInsert, onCommit }: {
  theme: Theme;
  onInsert: (text: string) => void;
  onCommit: (ch: string) => void;
}) {
  const [ws, setWs] = useState<IrgWorkingSet>("ws2024");
  const [loaded, setLoaded] = useState<{ ws: IrgWorkingSet; entries: IrgEntry[] } | null>(null);
  const [linkError, setLinkError] = useState(false);
  useEffect(() => {
    // タブの描画を先に返してからJSONを読む。切替中に前のセットの行は表示しない。
    const timer = setTimeout(() => setLoaded({ ws, entries: loadEntries(ws) }), 0);
    return () => clearTimeout(timer);
  }, [ws]);
  const entries = loaded?.ws === ws ? loaded.entries : null;
  const openSource = async (sn: string) => {
    setLinkError(false);
    try {
      await Linking.openURL(irgEntryUrl(ws, sn));
    } catch {
      setLinkError(true);
    }
  };

  return (
    <View style={{ flex: 1, gap: 4 }}>
      <View style={styles.sets}>
        {IRG_WORKING_SETS.map(set => (
          <Pressable
            key={set}
            accessibilityRole="tab"
            accessibilityState={{ selected: ws === set }}
            accessibilityLabel={`IRG ${set.toUpperCase()}`}
            onPress={() => { haptic("toggle"); setLinkError(false); setWs(set); }}
            style={[styles.set, { borderColor: ws === set ? t.accent : t.border, backgroundColor: ws === set ? t.accentBg : t.key }]}
          >
            <Text style={{ fontSize: 11, color: ws === set ? t.accent : t.sub }}>{set.toUpperCase()}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={{ fontSize: 10, color: t.sub }}>
        {entries ? `${entries.length.toLocaleString()}提案` : "読み込み中…"} · 文字をタップで出力／長押しで部品に
      </Text>
      <Text style={{ fontSize: 10, color: t.faint }}>
        同梱資料の一覧。IDSをタップで検索欄へ · ↗で審査資料
      </Text>
      {linkError && <Text accessibilityRole="alert" style={{ fontSize: 11, color: t.accent }}>審査資料を開けませんでした。通信環境を確認してください。</Text>}
      <FlatList
        key={ws}
        data={entries ?? []}
        keyExtractor={entry => entry.sn}
        keyboardShouldPersistTaps="always"
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={5}
        style={{ flex: 1 }}
        ListEmptyComponent={<Text style={{ padding: 12, color: t.sub }}>{entries ? "提案データがありません。" : "読み込み中…"}</Text>}
        renderItem={({ item }) => (
          <View style={[styles.entry, { borderBottomColor: t.border }]}>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={{ fontSize: 10, color: t.sub }}>{item.sn} · {item.refs.join(" / ") || "字源記号なし"}</Text>
              <View style={styles.chars}>
                {item.chars.map(ch => (
                  <Pressable
                    key={ch}
                    accessibilityRole="button"
                    accessibilityLabel={`${ch}を出力`}
                    accessibilityHint="長押しで検索の部品に追加"
                    onPress={() => { haptic("commit"); onCommit(ch); }}
                    onLongPress={() => { haptic("key"); onInsert(ch); }}
                    style={[styles.char, { backgroundColor: t.key, borderColor: t.border }]}
                  >
                    <Glyphs text={ch} size={26} color={t.text} />
                  </Pressable>
                ))}
                {item.chars.length === 0 && <Text style={{ fontSize: 11, color: t.faint }}>Unicode対応なし（同梱データ）</Text>}
              </View>
              {!!item.ids && <View style={{ gap: 2 }}>
                {item.ids.split(" / ").map((ids, i) => (
                  <Pressable
                    key={i}
                    accessibilityRole="button"
                    accessibilityLabel={`IDS ${ids}で検索`}
                    onPress={() => { haptic("key"); onInsert(ids); }}
                    style={{ minHeight: 44, justifyContent: "center", alignSelf: "flex-start" }}
                  >
                    <Glyphs text={ids} size={16} color={t.accent} />
                  </Pressable>
                ))}
              </View>}
            </View>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`${ws.toUpperCase()} 提案${item.sn}の審査資料を開く`}
              onPress={() => void openSource(item.sn)}
              style={styles.source}
            >
              <Text style={{ fontSize: 20, color: t.accent }}>↗</Text>
            </Pressable>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  sets: { flexDirection: "row", gap: 4 },
  set: { flex: 1, alignItems: "center", paddingVertical: 9, borderWidth: 1, borderRadius: 6 },
  entry: { flexDirection: "row", paddingVertical: 8, borderBottomWidth: 1, gap: 4 },
  chars: { flexDirection: "row", flexWrap: "wrap", gap: 4, alignItems: "center" },
  char: { minWidth: 44, minHeight: 44, borderWidth: 1, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  source: { width: 44, minHeight: 44, alignItems: "center", justifyContent: "center", alignSelf: "flex-start" },
});
