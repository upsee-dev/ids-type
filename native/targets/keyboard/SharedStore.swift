import Foundation

/// 履歴とお気に入り。**アプリと同じ入れ物**を読み書きする。
///
/// アプリで調べた字をキーボードで打つ、というのがこのアプリの筋道なので、
/// 2つが別々の履歴を持っていると意味がない。iOS のキーボード拡張は本体アプリと
/// 別サンドボックスなので、両方から見える場所は App Group だけ。
/// アプリ側は modules/katachi-shared が同じグループの UserDefaults を読み書きする。
///
/// 値の形もアプリと揃える必要がある（アプリは JSON の文字列配列で書く）。
/// entitlements は app.json と targets/keyboard/expo-target.config.js の両方に
/// 入れてある。片方だけだと署名は通るのに中身がいつまでも空になる。
///
/// **iOS の但し書き**: キーボード拡張が App Group の入れ物を触れるのは
/// 「フルアクセスを許可」(Info.plist の RequestsOpenAccess)が true で、かつ
/// 使う人が設定でそれを許したときだけ。1.0.7 からこの共有のためだけに
/// フルアクセスをお願いしているが、許さない人もいるので
/// **共有できないときは拡張自身の入れ物に落として動き続ける**。
/// その場合キーボードの履歴はキーボードの中だけのものになる
/// (アプリの履歴とは別々になるが、機能そのものは失われない)。
struct SharedStore {

    private static let appGroup = "group.com.upsee.idskanjitype"
    private static let historyKey = "katachi.history"
    private static let favoritesKey = "katachi.favorites"
    private static let probeKey = "katachi.sharedProbe"

    /// 履歴の上限。アプリ側(HISTORY_LIMIT)と同じ
    private static let limit = 60

    /// 共有の入れ物が本当に使えるかは書いて読み直すまで分からない。
    /// 判定は1度だけでよいので型の側に持つ
    private static let defaults: UserDefaults = {
        if let shared = UserDefaults(suiteName: appGroup) {
            shared.set(true, forKey: probeKey)
            if shared.synchronize(), shared.bool(forKey: probeKey) { return shared }
        }
        return .standard
    }()

    private var defaults: UserDefaults { Self.defaults }

    private func read(_ key: String) -> [String] {
        guard let raw = defaults.string(forKey: key),
              let data = raw.data(using: .utf8),
              let list = try? JSONSerialization.jsonObject(with: data) as? [Any]
        else { return [] }
        // 壊れた値を読んでも落ちないようにする(文字列だけ通す)
        return list.compactMap { $0 as? String }
    }

    private func write(_ key: String, _ list: [String]) {
        guard let data = try? JSONSerialization.data(withJSONObject: list),
              let raw = String(data: data, encoding: .utf8)
        else { return }
        defaults.set(raw, forKey: key)
    }

    var history: [String] { read(Self.historyKey) }
    var favorites: [String] { read(Self.favoritesKey) }

    /// 使った字を履歴の先頭へ。すでにあれば先頭に繰り上げる(重複させない)
    func remember(_ ch: String) {
        var list = read(Self.historyKey)
        list.removeAll { $0 == ch }
        list.insert(ch, at: 0)
        write(Self.historyKey, Array(list.prefix(Self.limit)))
    }

    /// お気に入りの入り切り。入れたときだけ true
    @discardableResult
    func toggleFavorite(_ ch: String) -> Bool {
        var list = read(Self.favoritesKey)
        let added: Bool
        if list.contains(ch) {
            list.removeAll { $0 == ch }
            added = false
        } else {
            list.insert(ch, at: 0)
            added = true
        }
        write(Self.favoritesKey, list)
        return added
    }
}
