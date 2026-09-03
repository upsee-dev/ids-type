import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { discardPhoto, recognizeText } from "../modules/katachi-ocr";
import { isIdeograph } from "./engine";
import { fontFor, type Theme } from "./theme";
import { haptic } from "./feedback";

/**
 * カメラで字を読み取る面。
 *
 * 読めない字を「見たまま打てる」道具なので、**紙や画面に出てきた字そのもの**を
 * 取り込めるなら、部品に分けて組む手間はそもそも要らない。かたちで組む・読みで引く・
 * 書いて引くのどれもできない場面（知らない字が目の前の紙にある）の最短経路がこれ。
 *
 * 読み取りは端末の中だけで完結する（iOS=Vision / Android=同梱したML Kit）。
 * 写真もどこにも保存しない：撮る → 読む → 使い捨て、で外へは一切出さない。
 *
 * 読み取れた字は**漢字だけ**に絞って並べる。かなや英数字はこのアプリで打つ必要が
 * ないうえ、混ざると狙いの漢字を探すのが遅くなる。
 */
export function CameraPad({
  theme,
  onInsert,
  onCommit,
}: {
  theme: Theme;
  /** 字を部品としてかたちコードに足す（長押し） */
  onInsert: (s: string) => void;
  /** 字をそのまま出力へ入れる（タップ） */
  onCommit: (ch: string) => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [hits, setHits] = useState<string[]>([]);
  const [note, setNote] = useState("枠に字を入れて丸いボタンを押してください");
  const cam = useRef<CameraView>(null);

  const shoot = async () => {
    if (busy) return;
    haptic("commit");
    setBusy(true);
    setNote("読み取り中…");
    // 撮った写真は端末の一時領域にファイルとして残る。読めても読めなくても
    // 最後に必ず捨てる(「写真はどこにも残りません」と断って権限をもらっているので、
    // 使い終わったものを置いていかない)
    let photo: string | null = null;
    try {
      // skipProcessing は使わない。センサーの向きのまま返ってきて、
      // 横倒しの写真を読ませることになる(端末によっては全滅する)
      const shot = await cam.current?.takePictureAsync({ quality: 0.9 });
      if (!shot?.uri) throw new Error("no photo");
      photo = shot.uri;
      const text = await recognizeText(shot.uri);
      // 読めた順のまま、漢字だけを重複なく拾う
      const seen = new Set<string>();
      const chars = [...text].filter(
        (c) => isIdeograph(c) && !seen.has(c) && (seen.add(c), true),
      );
      setHits(chars);
      setNote(
        chars.length
          ? "タップで出力へ・長押しでその字を部品に"
          : "字を読み取れませんでした。近づけて、明るいところで撮ってみてください",
      );
      if (!chars.length) haptic("warn");
    } catch {
      setHits([]);
      setNote("読み取れませんでした。もう一度撮ってみてください");
      haptic("warn");
    } finally {
      if (photo) await discardPhoto(photo).catch(() => {});
      setBusy(false);
    }
  };

  if (!permission?.granted) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12 }}>
        <Text style={{ fontSize: 13, color: theme.sub, textAlign: "center" }}>
          紙や画面に出てきた字を、カメラで読み取って探せます。
        </Text>
        <Text style={{ fontSize: 11, color: theme.faint, textAlign: "center" }}>
          読み取りは端末の中だけで行い、写真は読んだそばから消します。
        </Text>
        <Pressable
          onPress={() => {
            haptic("toggle");
            requestPermission();
          }}
          style={{
            borderWidth: 1,
            borderColor: theme.accent,
            borderRadius: 8,
            paddingHorizontal: 16,
            paddingVertical: 10,
          }}
        >
          <Text style={{ fontSize: 13, color: theme.accent }}>カメラを使う</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, gap: 6 }}>
      <Text style={{ fontSize: 11, color: theme.faint }} numberOfLines={1}>
        {note}
      </Text>

      {/* 読み取れた字。手書きタブと同じ作法（タップ＝出力／長押し＝部品）。
          撮った字はそのまま欲しい場面がほとんどなので、主動作をタップに置く。
          **撮る前は行ごと出さない**。ここは指を置いて動かす面ではないので、
          空の行に46ptを取られるより、そのぶんカメラの枠を大きくする */}
      {hits.length > 0 && (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        style={{ height: 46, flexGrow: 0 }}
        contentContainerStyle={{ gap: 4, alignItems: "center" }}
      >
        {hits.map((ch) => (
          <Pressable
            key={ch}
            onPressIn={() => haptic("commit")}
            onPress={() => onCommit(ch)}
            onLongPress={() => onInsert(ch)}
            style={{
              minWidth: 44,
              height: 42,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: 8,
              backgroundColor: theme.card,
            }}
          >
            <Text style={{ fontFamily: fontFor(ch), fontSize: 24, color: theme.text }}>
              {ch}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      )}

      {/* カメラの枠は**面いっぱい**に取る。小さい枠だと字を大きく写せず、
          読み取りそのものが当たらなくなる（写った字が小さいほど当たらない）。
          シャッターは横に並べず枠の上に重ねる＝そのぶん枠が横にも広がる */}
      <View
        style={{
          flex: 1,
          overflow: "hidden",
          borderRadius: 10,
          borderWidth: 1,
          borderColor: theme.border,
        }}
      >
        <CameraView ref={cam} style={{ flex: 1 }} facing="back" animateShutter={false} />
        <Pressable
          onPress={shoot}
          disabled={busy}
          accessibilityLabel="撮って読み取る"
          style={{
            position: "absolute",
            alignSelf: "center",
            bottom: 10,
            width: 58,
            height: 58,
            borderRadius: 29,
            borderWidth: 3,
            borderColor: "#FFFFFF",
            alignItems: "center",
            justifyContent: "center",
            // 明るい紙の上でも輪が見えるよう、下に薄い影を敷く
            backgroundColor: "rgba(0,0,0,0.25)",
          }}
        >
          {busy ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: "#FFFFFF",
              }}
            />
          )}
        </Pressable>
      </View>
    </View>
  );
}
