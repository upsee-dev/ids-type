import Foundation

/// かな入力の表。
///
/// このキーボードは自分が入力方式なので、読みを打ちたくても他のかなキーボードへ
/// 移ることができない（移った時点で組み立て中のかたちコードを持って行けない）。
/// そこで読み入力の面をキーボードの中に持つ。並びは日本のスマホで標準の
/// 12キーフリック（あ行〜わ行＋濁点＋⌫）。
///
/// Android 側(ime/android/.../Kana.kt)と同じ表を手で二重に持っている。
/// かたちの配置図や着せ替えのように core/ から生成していないのは、これが
/// 辞書でもデータでもなく「かなキーボードの並び」だけの表で、Web版には
/// 存在しない（Web版は端末のキーボードで読みを打てる）ため。
enum Kana {

    /// フリック1キーぶん。chars は [中央, 左, 上, 右, 下] の順で、
    /// 空文字は「その向きには割り当てなし（中央のまま）」を表す。
    struct Key {
        let label: String
        let chars: [String]
    }

    /// 濁点キー・⌫キーの目印（label で見分ける）
    static let dakuten = "小゛゜"
    static let backspace = "⌫"

    static let rows: [[Key]] = [
        [key("あ", "い", "う", "え", "お"), key("か", "き", "く", "け", "こ"), key("さ", "し", "す", "せ", "そ")],
        [key("た", "ち", "つ", "て", "と"), key("な", "に", "ぬ", "ね", "の"), key("は", "ひ", "ふ", "へ", "ほ")],
        [key("ま", "み", "む", "め", "も"), key("や", "", "ゆ", "", "よ"), key("ら", "り", "る", "れ", "ろ")],
        [
            Key(label: dakuten, chars: []),
            key("わ", "を", "ん", "ー", "〜"),
            Key(label: backspace, chars: []),
        ],
    ]

    private static func key(
        _ center: String, _ left: String, _ up: String, _ right: String, _ down: String,
    ) -> Key {
        Key(label: center, chars: [center, left, up, right, down])
    }

    /// 「小゛゜」キーで1字を送る輪。押すたび 濁点 → 半濁点 → 小文字 → 元 と巡る
    private static let rings = [
        "あぁ", "いぃ", "うぅゔ", "えぇ", "おぉ",
        "かが", "きぎ", "くぐ", "けげ", "こご",
        "さざ", "しじ", "すず", "せぜ", "そぞ",
        "ただ", "ちぢ", "つっづ", "てで", "とど",
        "はばぱ", "ひびぴ", "ふぶぷ", "へべぺ", "ほぼぽ",
        "やゃ", "ゆゅ", "よょ", "わゎ",
    ]

    /// 末尾1字を輪の次へ送る。輪に無い字（ん・ー など）は nil
    static func cycle(_ ch: Character) -> String? {
        for ring in rings {
            let chars = Array(ring)
            if let i = chars.firstIndex(of: ch) {
                return String(chars[(i + 1) % chars.count])
            }
        }
        return nil
    }

    /// 読みの突き合わせ用。カタカナをひらがなに寄せる
    /// (KANJIDIC2 の音読みはカタカナ・訓読みはひらがなで入っているため)。
    /// core/engine.ts の toHiragana と同じ規則。
    static func toHiragana(_ s: String) -> String {
        var out = String()
        out.reserveCapacity(s.count)
        for u in s.unicodeScalars {
            if u.value >= 0x30A1, u.value <= 0x30F6, let h = Unicode.Scalar(u.value - 0x60) {
                out.unicodeScalars.append(h)
            } else {
                out.unicodeScalars.append(u)
            }
        }
        return out
    }
}
