import { Platform } from "react-native";
import * as Haptics from "expo-haptics";

/**
 * 打鍵の触覚。
 *
 * 気持ちよさは「速さ」と「打ち分け」で決まる:
 *
 *  1. 指を**離した**ときではなく**触れた瞬間**に返す。onPress(離した時)だと
 *     一拍遅れて、自分の指と手応えがずれる。呼ぶ側は onPressIn を使うこと。
 *  2. 動作ごとに手触りを変える。全部同じだと「ブブブ」と鳴っているだけで、
 *     入ったのか消えたのか手で分からない。下の EVENTS がその語彙。
 *  3. 速く打っても詰まらせない。前の触覚と近すぎるものは捨てる(MIN_GAP_MS)。
 *     捨てないと連打時に振動が重なって、ただのノイズになる。
 *
 * Android は汎用の Vibrator ではなくキーボード用の触覚定数を使う
 * (端末の「タッチ操作時のバイブ」設定を尊重し、VIBRATE 権限も要らない)。
 * iOS は UIImpactFeedbackGenerator の質感に対応づける。
 */

export type HapticLevel = "off" | "normal" | "strong";

export const HAPTIC_LEVELS: { key: HapticLevel; label: string }[] = [
  { key: "off", label: "オフ" },
  { key: "normal", label: "ふつう" },
  { key: "strong", label: "強め" },
];

/** 打ち分けの語彙 */
export type HapticEvent =
  /** 部品・かたちのキー */
  | "key"
  /** 候補を確定した(いちばん「入った」感が要る) */
  | "commit"
  /** 1文字消した */
  | "delete"
  /** ⌫長押しの連射。連続で出るのでいちばん軽く */
  | "repeat"
  /** タブ・着せ替えなどの切り替え */
  | "toggle"
  /** コピーできた */
  | "success"
  /** 該当なしになった */
  | "warn";

/**
 * 触覚を詰まらせない最小間隔。ヒトが「別々の刺激」と感じるのは
 * だいたい 20〜30ms 以上あいてから。それより短いものは重ねずに捨てる。
 */
const MIN_GAP_MS = 24;

/** 間引かない(打鍵の結果として必ず返したい)イベント */
const ALWAYS: ReadonlySet<HapticEvent> = new Set(["commit", "success", "warn"]);

let level: HapticLevel = "normal";
let lastAt = 0;

/** 設定の反映。App が起動時と変更時に呼ぶ */
export function setHapticLevel(next: HapticLevel): void {
  level = next;
}

export function getHapticLevel(): HapticLevel {
  return level;
}

const IOS_IMPACT: Record<
  HapticEvent,
  { normal: Haptics.ImpactFeedbackStyle; strong: Haptics.ImpactFeedbackStyle }
> = {
  // Rigid は立ち上がりが速く、キーの「カチッ」に近い
  key: {
    normal: Haptics.ImpactFeedbackStyle.Light,
    strong: Haptics.ImpactFeedbackStyle.Rigid,
  },
  commit: {
    normal: Haptics.ImpactFeedbackStyle.Medium,
    strong: Haptics.ImpactFeedbackStyle.Heavy,
  },
  // 消す動作は Soft にして、入れる動作(Rigid系)と手触りで区別する
  delete: {
    normal: Haptics.ImpactFeedbackStyle.Soft,
    strong: Haptics.ImpactFeedbackStyle.Medium,
  },
  repeat: {
    normal: Haptics.ImpactFeedbackStyle.Light,
    strong: Haptics.ImpactFeedbackStyle.Soft,
  },
  toggle: {
    normal: Haptics.ImpactFeedbackStyle.Light,
    strong: Haptics.ImpactFeedbackStyle.Medium,
  },
  success: {
    normal: Haptics.ImpactFeedbackStyle.Medium,
    strong: Haptics.ImpactFeedbackStyle.Heavy,
  },
  warn: {
    normal: Haptics.ImpactFeedbackStyle.Soft,
    strong: Haptics.ImpactFeedbackStyle.Medium,
  },
};

const ANDROID_HAPTIC: Record<HapticEvent, Haptics.AndroidHaptics> = {
  key: Haptics.AndroidHaptics.Keyboard_Press,
  commit: Haptics.AndroidHaptics.Confirm,
  delete: Haptics.AndroidHaptics.Keyboard_Release,
  // Segment_Tick は「連続で出しても不快にならない強さ」と定義されている
  repeat: Haptics.AndroidHaptics.Segment_Tick,
  toggle: Haptics.AndroidHaptics.Toggle_On,
  success: Haptics.AndroidHaptics.Confirm,
  warn: Haptics.AndroidHaptics.Reject,
};

/**
 * 触覚を返す。失敗しても入力そのものは続けたいので投げっぱなしにする
 * (触覚を持たない端末・設定で切っている端末では何も起きない)。
 */
export function haptic(event: HapticEvent): void {
  if (level === "off") return;

  const now = Date.now();
  if (!ALWAYS.has(event) && now - lastAt < MIN_GAP_MS) return;
  lastAt = now;

  if (Platform.OS === "android") {
    Haptics.performAndroidHapticsAsync(ANDROID_HAPTIC[event]).catch(() => {});
    return;
  }
  if (event === "success") {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
      () => {},
    );
    return;
  }
  if (event === "warn") {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
      () => {},
    );
    return;
  }
  Haptics.impactAsync(IOS_IMPACT[event][level]).catch(() => {});
}
