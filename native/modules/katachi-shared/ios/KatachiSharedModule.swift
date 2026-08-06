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

    Function("getItem") { (key: String) -> String? in
      self.store?.string(forKey: key)
    }

    Function("setItem") { (key: String, value: String) in
      self.store?.set(value, forKey: key)
    }
  }
}
