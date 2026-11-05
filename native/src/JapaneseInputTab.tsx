import { useEffect, useRef, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { JapaneseLexicon, japaneseReading, categoryLabel, foreignReadingLabel, searchLanguages, PINYIN_LANGUAGE, type JapaneseCandidate } from "./core/japanese";
import { getJapaneseShard } from "../modules/katachi-shared";
import { loadJapaneseOrder, loadForeignReadings } from "./prefs";
import { FlickKanaPad, RomajiPad } from "./FlickKanaPad";
import { kanaCycle } from "./engine";
import { fontFor, type Theme } from "./theme";

/** 拼音は QWERTY だけ。打った英字がそのまま読み(ü は v) */
const PINYIN_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];

export function JapaneseInputTab({ theme: t, onCommit }: { theme: Theme; onCommit: (text: string) => void }) {
  const [reading, setReading] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [reset, setReset] = useState(0);
  const [mode, setMode] = useState<"kana" | "pinyin">("kana");
  const [results, setResults] = useState<{ query: string; configuration: string; items: JapaneseCandidate[] }>({ query: "", configuration: "", items: [] });
  const cached = useRef<{ key: string; engine: JapaneseLexicon } | null>(null);
  const [error, setError] = useState("");
  const order = loadJapaneseOrder();
  const languages = loadForeignReadings();
  // 中国語は「拼音」でだけ打つ。設定でオフにされたら かな に戻す
  const pinyinEnabled = languages.includes(PINYIN_LANGUAGE);
  const pinyin = mode === "pinyin" && pinyinEnabled;
  const configuration = order.join(",") + "|" + searchLanguages(languages, pinyin).join(",");
  useEffect(() => {
    let active = true;
    setError("");
    if (!reading) { setResults({ query: "", configuration, items: [] }); return; }
    const timer = setTimeout(async () => {
      try {
        const key = japaneseReading(reading).codePointAt(0)!.toString(16).padStart(4, "0");
        let entry = cached.current;
        if (entry?.key !== key) {
          const source = await getJapaneseShard(key);
          if (!active) return;
          entry = { key, engine: new JapaneseLexicon(() => source) };
          cached.current = entry;
        }
        if (active) setResults({ query: reading, configuration, items: entry.engine.search(reading, loadJapaneseOrder(), searchLanguages(loadForeignReadings(), pinyin)) });
      } catch {
        if (active) { setResults({ query: reading, configuration, items: [] }); setError("辞書を読み込めませんでした。アプリを更新して再試行してください。"); }
      }
    }, 0);
    return () => { active = false; clearTimeout(timer); };
  }, [reading, configuration]);
  const pick = (c: JapaneseCandidate) => {
    onCommit(c.text); setReading(s => s.slice(c.consumed)); setPreview(null); setReset(v => v + 1);
  };
  /** かなの読みを拼音で引かない(その逆も)。切り替えるときは打ちかけをそのまま確定する */
  const switchMode = (next: "kana" | "pinyin") => {
    if (next === (pinyin ? "pinyin" : "kana")) return;
    if (reading) { onCommit(reading); setReading(""); }
    setPreview(null); setReset(v => v + 1); setMode(next);
  };
  return <View style={{ flex: 1, gap: 4 }}>
    {pinyinEnabled && <View style={{ flexDirection: "row", gap: 4 }}>
      {(["kana", "pinyin"] as const).map(m => <Pressable key={m} accessibilityRole="button" accessibilityState={{ selected: (m === "pinyin") === pinyin }} onPress={() => switchMode(m)}
        style={{ flex: 1, paddingVertical: 6, alignItems: "center", backgroundColor: (m === "pinyin") === pinyin ? t.accentBg : t.key }}>
        <Text style={{ color: t.text, fontSize: 12 }}>{m === "pinyin" ? "拼音" : "かな"}</Text>
      </Pressable>)}
    </View>}
    <Text style={{ color: t.text, minHeight: 24 }}>{reading || (pinyin ? "拼音（QWERTY）" : "日本語拡張フリック")}<Text style={{ color: t.sub }}>{preview}</Text></Text>
    <FlatList horizontal data={results.query === reading && results.configuration === configuration ? results.items : []}
      keyExtractor={c => `${c.consumed}/${c.text}`} keyboardShouldPersistTaps="always"
      style={{ height: 66, flexGrow: 0 }} initialNumToRender={8} windowSize={3}
      ListEmptyComponent={<Text style={{ color: t.sub, padding: 8 }}>{error || (reading ? "候補を検索中…" : pinyin ? "拼音を入力。声調は付けず、ü は v で打ちます。" : "読みを入力。分類順は設定で変更できます。")}</Text>}
      renderItem={({ item }) => <Pressable accessibilityRole="button" onPress={() => pick(item)} style={{ padding: 8, marginRight: 4, backgroundColor: t.key, borderRadius: 6 }}>
        <Text style={{ color: t.text, fontSize: 18 }}>{[...item.text].map((ch,i) => <Text key={i} style={{ fontFamily: fontFor(ch) }}>{ch}</Text>)}</Text>
        <Text style={{ color: t.sub, fontSize: 10 }}>{item.kind === 2 ? `先頭${item.consumed}字 · ` : ""}{item.language ? `${foreignReadingLabel(item.language)} · ${item.original}` : categoryLabel(item.mask, order)}</Text>
      </Pressable>} />
    <View style={{ flex: 1 }}>{pinyin
      ? <RomajiPad theme={t} rows={PINYIN_ROWS} onLetter={c => setReading(s => s + c)} onBackspace={() => setReading(s => s.slice(0,-1))} />
      : <FlickKanaPad key={reset} theme={t} onAppend={ch => setReading(s => s + ch)} onReplaceLast={ch => setReading(s => s.slice(0,-1) + ch)} onCycleLast={() => setReading(s => s ? s.slice(0,-1) + (kanaCycle(s.slice(-1)) ?? s.slice(-1)) : s)} onBackspace={() => setReading(s => s.slice(0,-1))} onPreview={setPreview} />}</View>
    <View style={{ flexDirection: "row", gap: 4 }}>
      {[pinyin ? "，" : "、", "。", "空白", pinyin ? "確定" : "かな確定", "改行"].map(label => <Pressable key={label} accessibilityRole="button" onPress={() => {
        if (reading) { onCommit(reading); setReading(""); }
        if (label !== "かな確定" && label !== "確定") onCommit(label === "空白" ? " " : label === "改行" ? "\n" : label);
        setReset(v => v+1);
      }} style={{ flex: 1, paddingVertical: 8, alignItems: "center", backgroundColor: t.key }}><Text style={{ color: t.text, fontSize: 12 }}>{label}</Text></Pressable>)}
    </View>
  </View>;
}
