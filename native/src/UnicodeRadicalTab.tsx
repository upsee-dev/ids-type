import { useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { radicalCharacters, radicalLabel, radicalsByStrokes, residualStrokes, type RadicalIndex } from "./core/radical-index";
import { fontFor, type Theme } from "./theme";

export function UnicodeRadicalTab({ theme: t, onCommit, onInsert }: {
  theme: Theme; onCommit: (ch: string) => void; onInsert?: (ch: string) => void;
}) {
  const [index] = useState<RadicalIndex>(() => require("./core/radical-index.json"));
  const [strokes, setStrokes] = useState<number | null>(null);
  const [radical, setRadical] = useState<number | null>(null);
  const [rest, setRest] = useState<number | null>(null);
  const chars = radical !== null && rest !== null;
  const values = strokes === null ? Array.from({ length: 17 }, (_, i) => i + 1)
    : radical === null ? radicalsByStrokes(strokes)
    : rest === null ? residualStrokes(index, radical) : [];
  const entries = chars ? radicalCharacters(index, radical!, rest!) : values.map(String);
  const back = () => { if (rest !== null) setRest(null); else if (radical !== null) setRadical(null); else setStrokes(null); };
  const title = strokes === null ? "部首の画数を選ぶ" : radical === null ? `${strokes}画の部首を選ぶ` : rest === null ? `${radicalLabel(radical)}：残りの画数を選ぶ` : `${radicalLabel(radical)} ＋ ${rest}画 · ${entries.length}字`;
  return <View style={{ flex: 1, gap: 6 }}>
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      {strokes !== null && <Pressable accessibilityRole="button" accessibilityLabel="一つ前の選択へ戻る" onPress={back} style={{ padding: 10 }}><Text style={{ color: t.accent }}>‹ 戻る</Text></Pressable>}
      <Text style={{ flex: 1, color: t.text, fontWeight: "600" }}>{title}</Text>
      <Pressable accessibilityRole="button" onPress={() => { setStrokes(null); setRadical(null); setRest(null); }} style={{ padding: 10 }}><Text style={{ color: t.accent }}>最初へ</Text></Pressable>
    </View>
    <Text style={{ color: t.sub, fontSize: 11 }}>Unicode部首索引 · 残りの画数＝部首を除いた画数</Text>
    <FlatList
      key={`${strokes}/${radical}/${rest}`}
      data={entries} numColumns={chars ? 5 : 4} keyExtractor={s => s}
      keyboardShouldPersistTaps="always" initialNumToRender={35} windowSize={5}
      ListEmptyComponent={<Text style={{ color: t.sub, padding: 12 }}>この条件の文字はありません。</Text>}
      renderItem={({ item }) => {
        const label = chars ? item : strokes !== null && radical === null ? radicalLabel(+item) : `${item}画`;
        return <Pressable accessibilityRole="button" accessibilityLabel={chars ? `${item} U+${item.codePointAt(0)!.toString(16).toUpperCase()}を入力` : label}
          onPress={() => { if (chars) onCommit(item); else if (strokes === null) setStrokes(+item); else if (radical === null) setRadical(+item); else setRest(+item); }}
          onLongPress={chars && onInsert ? () => onInsert(item) : undefined}
          style={{ flex: 1, minHeight: 56, margin: 3, borderRadius: 6, backgroundColor: t.key, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: t.text, fontSize: chars ? 26 : 17, fontFamily: chars ? fontFor(item) : undefined }}>{label}</Text>
          {chars && <Text style={{ color: t.sub, fontSize: 9 }}>U+{item.codePointAt(0)!.toString(16).toUpperCase()}</Text>}
        </Pressable>;
      }}
    />
  </View>;
}
