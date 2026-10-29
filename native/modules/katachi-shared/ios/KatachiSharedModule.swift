import ExpoModulesCore

/**
 アプリとキーボード拡張で共有する保存領域(iOS)。

 キーボード拡張は本体アプリとは別のサンドボックスで動くので、アプリが
 AsyncStorage に書いた履歴は拡張から一切見えない。両方から見える場所は
 App Group だけなので、そこの UserDefaults を読み書きする。

 グループIDは拡張側(KeyboardViewController.swift の SharedStore)と同じ文字列。
 app.json の ios.entitlements と targets/keyboard/expo-target.config.js の
 両方に同じグループを書いてある(片方だけだと署名は通るのに中身が空になる)。
 */
public class KatachiSharedModule: Module {

  private static let appGroup = "group.com.upsee.idskanjitype"

  private var store: UserDefaults? { UserDefaults(suiteName: Self.appGroup) }

  public func definition() -> ModuleDefinition {
    Name("KatachiShared")

    AsyncFunction("getJapaneseShard") { (key: String) throws -> String in
      guard key.range(of: "^[0-9a-f]{4,6}$", options: .regularExpression) != nil else {
        throw NSError(domain: "KatachiShared", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid dictionary shard"])
      }
      // The embedded keyboard owns the same dictionary; avoid a second 63 MB copy.
      guard let url = Bundle.main.builtInPlugInsURL?
        .appendingPathComponent("japanese.appex")
        .appendingPathComponent("japanese-\(key).tsv"),
        FileManager.default.fileExists(atPath: url.path) else { return "" }
      return try String(contentsOf: url, encoding: .utf8)
    }

    Function("getItem") { (key: String) -> String? in
      self.store?.string(forKey: key)
    }

    Function("setItem") { (key: String, value: String) in
      self.store?.set(value, forKey: key)
    }
  }
}
