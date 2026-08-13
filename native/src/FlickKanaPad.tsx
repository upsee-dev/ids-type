import { useRef, useState } from "react";
import { StyleSheet, Text, View, type GestureResponderEvent } from "react-native";
import { KANA_BACKSPACE, KANA_ROWS, kanaFlick, type KanaKey } from "./engine";
import type { Theme } from "./theme";
import { haptic } from "./feedback";

/**
 * 読みを打つための12キーフリック面。システムキーボード
 * (FlickKanaView.kt / FlickKanaView.swift)と同じ挙動をアプリ側に内蔵する。
 *
 * アプリのかたちコード欄は端末のIMEに触らせない方針なので、読みも端末の
 * キーボードに頼らず自前で打てるようにする(端末に日本語キーボードが
 * 無くても・英数キーボードのままでも読みで引ける)。
 *
 * 指を置いてから離すまでの向きで段を決める(中央=あ、左=い、上=う、右=え、下=お)。
 * 途中経過は onPreview で読みの欄に色を変えて出す。ポップアップは出さない:
 * 端末や向きによって位置がずれるうえ、目線も動く。
 * フリックしない人向けに、同じキーの叩き直しで あ→い→う→え→お と送る
 * トグル入力も受ける(標準のかなキーボードと同じ)。
 */

/** これ以上動いたらフリックとみなす。小さすぎると普通のタップが滑る */
const FLICK_THRESHOLD = 18;

/** 同じキーの叩き直しをトグルとして扱う間合い(ミリ秒) */
const TOGGLE_WINDOW = 900;

/** 0=中央 1=左 2=上 3=右 4=下 */
function direction(dx: number, dy: number): number {
  if (Math.abs(dx) < FLICK_THRESHOLD && Math.abs(dy) < FLICK_THRESHOLD) return 0;
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 1 : 3;
  return dy < 0 ? 2 : 4;
}

export function FlickKanaPad({
  theme,
  onAppend,
  onReplaceLast,
  onCycleLast,
  onBackspace,
  onPreview,
}: {
  theme: Theme;
  /** 1字打った */
  onAppend: (ch: string) => void;
  /** 同じキーの叩き直し。末尾1字を置き換える */
  onReplaceLast: (ch: string) => void;
  /** 「小゛゜」。末尾1字を濁点・小文字へ送る */
  onCycleLast: () => void;
  onBackspace: () => void;
  /** 指を置いているあいだの仮の字。離す/取り消しで null */
  onPreview: (ch: string | null) => void;
}) {
  // 直前に叩いたキー(ラベルで見分ける)と、そのとき何番目の字を出したか
  const lastLabel = useRef<string | null>(null);
  const lastStep = useRef(0);
  const lastTapAt = useRef(0);

  const commit = (key: KanaKey, dir: number) => {
    const now = Date.now();
    if (
      dir === 0 &&
      key.label === lastLabel.current &&
      now - lastTapAt.current < TOGGLE_WINDOW
    ) {
      // 叩き直し。割り当てのある向きだけを あ→い→う→え→お の順に巡る
      const steps = key.chars
        .map((c, i) => (c ? i : -1))
        .filter((i) => i >= 0);
      const at = steps.indexOf(lastStep.current);
      const next = steps[(at + 1) % steps.length];
      lastStep.current = next;
      lastTapAt.current = now;
      onReplaceLast(key.chars[next]);
      return;
    }
    const ch = kanaFlick(key, dir);
    lastLabel.current = key.label;
    // フリックで入れた字は、その向きから続けて巡らせる
    lastStep.current = Math.max(0, key.chars.indexOf(ch));
    lastTapAt.current = now;
    onAppend(ch);
  };

  /** ⌫や濁点のあとは、続けて叩いても前の字を置き換えない */
  const resetToggle = () => {
    lastLabel.current = null;
    lastTapAt.current = 0;
  };

  return (
    <View style={styles.pad}>
      {KANA_ROWS.map((row, ri) => (
        <View key={ri} style={styles.row}>
          {row.map((key) => (
            <KanaKeyView
              key={key.label}
              k={key}
              theme={theme}
              onPreview={onPreview}
              onRelease={(dir) => {
                if (key.chars.length === 0) {
                  if (key.label === KANA_BACKSPACE) {
                    onBackspace();
                  } else {
                    onCycleLast();
                  }
                  resetToggle();
                  return;
                }
                commit(key, dir);
              }}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

/** 1キーぶん。フリックの向きを見たいので Pressable ではなく responder を直に受ける */
function KanaKeyView({
  k,
  theme,
  onPreview,
  onRelease,
}: {
  k: KanaKey;
  theme: Theme;
  onPreview: (ch: string | null) => void;
  onRelease: (dir: number) => void;
}) {
  const [pressed, setPressed] = useState(false);
  const down = useRef({ x: 0, y: 0 });

  const dirOf = (e: GestureResponderEvent) =>
    direction(
      e.nativeEvent.locationX - down.current.x,
      e.nativeEvent.locationY - down.current.y,
    );

  const isChar = k.chars.length > 0;

  return (
    <View
      style={[
        styles.key,
        {
          backgroundColor: pressed ? theme.accentBg : theme.key,
          borderColor: theme.border,
        },
      ]}
      onStartShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => {
        down.current = {
          x: e.nativeEvent.locationX,
          y: e.nativeEvent.locationY,
        };
        setPressed(true);
        haptic("key"); // 触覚は指が触れた瞬間に返す
        if (isChar) onPreview(k.chars[0]);
      }}
      onResponderMove={(e) => {
        if (isChar) onPreview(kanaFlick(k, dirOf(e)));
      }}
      onResponderRelease={(e) => {
        setPressed(false);
        onPreview(null);
        onRelease(isChar ? dirOf(e) : 0);
      }}
      onResponderTerminate={() => {
        setPressed(false);
        onPreview(null);
      }}
    >
      <Text
        style={{
          fontSize: isChar ? 18 : 12,
          fontWeight: "500",
          color: isChar ? theme.text : theme.sub,
        }}
      >
        {k.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { flex: 1, gap: 4 },
  row: { flex: 1, flexDirection: "row", gap: 4 },
  key: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    borderWidth: 1,
  },
});
