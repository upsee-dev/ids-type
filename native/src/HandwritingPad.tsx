import { useEffect, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from "react-native";
import Svg, { Line, Path, Rect } from "react-native-svg";
import {
  HandwritingIndex,
  type Engine,
  type HandwritingData,
  type HwMatch,
} from "./engine";
import { fontFor, type Theme } from "./theme";
import { haptic } from "./feedback";

/**
 * 手書き検索の面。読めない字を枠に書くと、似ている字が上の候補行に出る。
 *
 * 認識は通信なし・端末内だけで行う(core/handwriting.ts)。パターンは
 * KanjiVG 由来の約6,400字(常用・人名用・JIS第1〜2水準を覆う)で、
 * 描き終わった画までで毎回照合し直すので、途中でも形が近い字は出る。
 *
 * 候補は**タップで出力へ**(読みが分かる=詳細も出る)、**長押しで
 * かたちコードの部品**として使う。かたち検索の途中で部品を1つ
 * 手書きで足す、という使い方ができる。
 */

// パターン辞書(1.3MB)は手書きタブを開くまで読まない。
// 一度組んだら持ち続ける(タブを離れても作り直さない)
let sharedIndex: HandwritingIndex | null = null;
function getIndex(): HandwritingIndex {
  if (!sharedIndex) {
    sharedIndex = new HandwritingIndex(
      require("./core/handwriting-data.json") as HandwritingData,
    );
  }
  return sharedIndex;
}

type Stroke = [number, number][];

/** 点列をSVGパスへ。点が細かいので折れ線で十分滑らか */
function toPath(s: Stroke): string {
  if (!s.length) return "";
  const head = `M${s[0][0].toFixed(1)} ${s[0][1].toFixed(1)}`;
  // 動かさず打った「丶」は長さ0のパスになり描かれないので、点として見えるようにする
  if (s.length === 1) return `${head}l0.1 0.1`;
  return (
    head +
    s
      .slice(1)
      .map(([x, y]) => `L${x.toFixed(1)} ${y.toFixed(1)}`)
      .join("")
  );
}

export function HandwritingPad({
  engine,
  theme,
  onInsert,
  onCommit,
}: {
  engine: Engine | null;
  theme: Theme;
  /** 長押し: かたちコードに部品として足す */
  onInsert: (s: string) => void;
  /** タップ: 出力へ(主動作。書いた字そのものが欲しい場面が多い) */
  onCommit: (ch: string) => void;
}) {
  const [index, setIndex] = useState<HandwritingIndex | null>(sharedIndex);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [current, setCurrent] = useState<Stroke>([]);
  const [matches, setMatches] = useState<HwMatch[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // パターン辞書の構築は最初の描画(タブ切り替えのアニメーション)を待ってから
  useEffect(() => {
    if (index) return;
    const id = setTimeout(() => setIndex(getIndex()), 30);
    return () => clearTimeout(id);
  }, [index]);

  // 画を描き終えるたびに照合し直す
  useEffect(() => {
    if (!index || !strokes.length) {
      setMatches([]);
      return;
    }
    const hits = index.match(strokes, 30);
    // 日本語で使わない字(KANJIDIC2外)は、形が同じでも日本の字の後ろへ
    if (engine) {
      hits.sort(
        (a, b) =>
          a.score +
          (engine.meta(a.ch)?.ext !== false ? 0.02 : 0) -
          (b.score + (engine.meta(b.ch)?.ext !== false ? 0.02 : 0)),
      );
    }
    setMatches(hits.slice(0, 24));
  }, [index, strokes, engine]);

  const point = (e: GestureResponderEvent): [number, number] => [
    e.nativeEvent.locationX,
    e.nativeEvent.locationY,
  ];

  // 描いている最中の点は ref にためる(setState の updater から別の setState を
  // 呼ぶと開発モードの二重実行で画が二重登録されるため)
  const curRef = useRef<Stroke>([]);

  const endStroke = () => {
    const cur = curRef.current;
    curRef.current = [];
    setCurrent([]);
    // 動かさず点だけ打った「丶」も1画として拾う
    if (cur.length > 0) setStrokes((s) => [...s, cur]);
  };

  const clearAll = () => {
    setStrokes([]);
    setCurrent([]);
  };

  const onLayout = (e: LayoutChangeEvent) =>
    setSize({
      w: e.nativeEvent.layout.width,
      h: e.nativeEvent.layout.height,
    });

  // 目安の枠(正方形)。はみ出しても認識には響かない(外接枠で正規化するため)
  const guide = Math.min(size.w, size.h) - 12;
  const gx = (size.w - guide) / 2;
  const gy = (size.h - guide) / 2;

  return (
    <View style={{ flex: 1, gap: 4 }}>
      {/* ── 候補行 ──
          高さは**候補の有無にかかわらず CAND_ROW で固定**。1画目で候補が出た
          拍子にこの行が伸びると、下の書く枠がそのぶん縮む。枠が縮むと2画目から
          座標の取り方が変わり(認識は枠に対する外接枠で正規化する)、書いている
          途中で字が歪む */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        style={styles.candRowBox}
        contentContainerStyle={styles.candRow}
      >
        {matches.length > 0 ? (
          matches.map((m) => (
            <Pressable
              key={m.ch}
              onPressIn={() => haptic("commit")}
              onPress={() => onCommit(m.ch)}
              onLongPress={() => {
                haptic("success");
                onInsert(m.ch);
              }}
              style={({ pressed }) => [
                styles.candKey,
                {
                  backgroundColor: pressed ? theme.accentBg : theme.key,
                  borderColor: theme.border,
                },
              ]}
            >
              <Text
                style={{ fontFamily: fontFor(m.ch), fontSize: 24, color: theme.text }}
              >
                {m.ch}
              </Text>
            </Pressable>
          ))
        ) : (
          <Text style={{ fontSize: 11, color: theme.faint }}>
            {index
              ? strokes.length
                ? "似ている字が見つかりません。全部消してもう一度どうぞ"
                : "枠に字を書くと候補が出ます。タップで出力へ・長押しで部品に"
              : "手書きの辞書を準備中…"}
          </Text>
        )}
      </ScrollView>

      {/* ── 書く枠 + 道具 ── */}
      <View style={{ flex: 1, flexDirection: "row", gap: 4 }}>
        <View
          style={[
            styles.canvas,
            { backgroundColor: theme.bg, borderColor: theme.border },
          ]}
          onLayout={onLayout}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderTerminationRequest={() => false}
          onResponderGrant={(e) => {
            haptic("key");
            curRef.current = [point(e)];
            setCurrent(curRef.current);
          }}
          onResponderMove={(e) => {
            const p = point(e);
            const last = curRef.current[curRef.current.length - 1];
            // 手ぶれ以下の点は間引く(描画も認識も点が多すぎると重い)
            if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 2) return;
            curRef.current = [...curRef.current, p];
            setCurrent(curRef.current);
          }}
          onResponderRelease={endStroke}
          onResponderTerminate={endStroke}
        >
          {size.w > 0 && (
            <Svg width={size.w} height={size.h}>
              {/* 目安の枠と十字。手書きIMEの流儀に合わせた点線 */}
              <Rect
                x={gx}
                y={gy}
                width={guide}
                height={guide}
                fill="none"
                stroke={theme.border}
                strokeWidth={1}
                strokeDasharray="4 4"
              />
              <Line
                x1={gx}
                y1={gy + guide / 2}
                x2={gx + guide}
                y2={gy + guide / 2}
                stroke={theme.border}
                strokeWidth={1}
                strokeDasharray="2 5"
              />
              <Line
                x1={gx + guide / 2}
                y1={gy}
                x2={gx + guide / 2}
                y2={gy + guide}
                stroke={theme.border}
                strokeWidth={1}
                strokeDasharray="2 5"
              />
              {strokes.map((s, i) => (
                <Path
                  key={i}
                  d={toPath(s)}
                  fill="none"
                  stroke={theme.text}
                  strokeWidth={4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
              {current.length > 0 && (
                <Path
                  d={toPath(current)}
                  fill="none"
                  stroke={theme.accent}
                  strokeWidth={4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
            </Svg>
          )}
        </View>

        <View style={{ justifyContent: "flex-start", gap: 4 }}>
          <Text
            style={{
              textAlign: "center",
              fontSize: 11,
              color: theme.sub,
              paddingVertical: 2,
            }}
          >
            {strokes.length ? `${strokes.length}画` : "手書き"}
          </Text>
          <Pressable
            onPressIn={() => haptic("delete")}
            onPress={() => setStrokes((s) => s.slice(0, -1))}
            style={[styles.toolBtn, { borderColor: theme.border, backgroundColor: theme.key }]}
          >
            <Text style={{ fontSize: 12, color: theme.text }}>1画消す</Text>
          </Pressable>
          <Pressable
            onPressIn={() => haptic("delete")}
            onPress={clearAll}
            style={[styles.toolBtn, { borderColor: theme.border, backgroundColor: theme.key }]}
          >
            <Text style={{ fontSize: 12, color: theme.text }}>全部消す</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/** 候補行の高さ。候補が無いとき(案内文)も同じだけ空けておく */
const CAND_ROW = 50;

const styles = StyleSheet.create({
  candRowBox: { flexGrow: 0, height: CAND_ROW },
  candRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 2,
  },
  candKey: {
    minWidth: 46,
    height: CAND_ROW - 4,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 4,
  },
  canvas: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    overflow: "hidden",
  },
  toolBtn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
});
