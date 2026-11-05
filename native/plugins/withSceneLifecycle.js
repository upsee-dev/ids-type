// Expo config plugin: iOS アプリを UIScene のライフサイクルへ移す。
//
// iOS 27 SDK でビルドしたアプリは、UIScene を採用していないと起動した瞬間に UIKit が止める
// （_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption で EXC_BREAKPOINT）。
// 1.0.12（iOS 27.1 SDK でビルド）が iOS 27 の端末で開かずに落ちたのはこれ。
//
// Expo SDK 57 のテンプレートは AppDelegate の中で窓を作るので、prebuild のたびに
//   - Info.plist に UIApplicationSceneManifest を足し
//   - 窓づくりと React Native の起動を SceneDelegate へ移す
// ios/ は生成物なので、ここで毎回やり直す。テンプレートが変わって差し替え箇所が
// 見つからないときは、黙って落ちるアプリを作らないようにビルドを止める。
const { withAppDelegate, withInfoPlist } = require("expo/config-plugins");

const WINDOW_START =
  /#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n\s*factory\.startReactNative\(\n\s*withModuleName: "main",\n\s*in: window,\n\s*launchOptions: launchOptions\)\n#endif\n/;
const FACTORY_PROPERTY = "  var reactNativeFactory: RCTReactNativeFactory?\n";

const SCENE_DELEGATE = `
// iOS 27 SDK からは UIScene のライフサイクルが必須（採用しないと起動直後に止められる）。
// 窓を作って React Native を起動し、URL とライフサイクルは AppDelegate（＝Expo の購読者）へ回す
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  private var appDelegate: AppDelegate? { UIApplication.shared.delegate as? AppDelegate }

  func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
    guard let windowScene = scene as? UIWindowScene, let appDelegate, let factory = appDelegate.reactNativeFactory else { return }
    let window = UIWindow(windowScene: windowScene)
    self.window = window
    appDelegate.window = window
    // 起動のきっかけの URL（キーボードの「カメラ」の ids-kanji-type://camera など）を
    // Linking.getInitialURL へ渡す。UIScene では launchOptions に入ってこない
    var launchOptions = appDelegate.pendingLaunchOptions ?? [:]
    if let url = connectionOptions.urlContexts.first?.url { launchOptions[.url] = url }
    factory.startReactNative(withModuleName: "main", in: window, launchOptions: launchOptions)
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    for context in URLContexts { _ = appDelegate?.application(UIApplication.shared, open: context.url) }
  }

  // UIScene では UIKit が AppDelegate の applicationDidBecomeActive などを呼ばない
  func sceneDidBecomeActive(_ scene: UIScene) { appDelegate?.applicationDidBecomeActive(UIApplication.shared) }
  func sceneWillResignActive(_ scene: UIScene) { appDelegate?.applicationWillResignActive(UIApplication.shared) }
  func sceneWillEnterForeground(_ scene: UIScene) { appDelegate?.applicationWillEnterForeground(UIApplication.shared) }
  func sceneDidEnterBackground(_ scene: UIScene) { appDelegate?.applicationDidEnterBackground(UIApplication.shared) }
}
`;

const withSceneLifecycle = (config) => {
  config = withInfoPlist(config, (cfg) => {
    cfg.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: "Default Configuration",
            UISceneDelegateClassName: "$(PRODUCT_MODULE_NAME).SceneDelegate",
          },
        ],
      },
    };
    return cfg;
  });
  return withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== "swift") throw new Error("withSceneLifecycle: Swift の AppDelegate を前提にしています");
    let src = cfg.modResults.contents;
    if (src.includes("class SceneDelegate")) return cfg;
    if (!WINDOW_START.test(src) || !src.includes(FACTORY_PROPERTY)) {
      throw new Error("withSceneLifecycle: AppDelegate.swift の窓づくりが見つかりません。Expo のテンプレートが変わったので、このプラグインを直してください");
    }
    src = src
      .replace(FACTORY_PROPERTY, FACTORY_PROPERTY + "  var pendingLaunchOptions: [UIApplication.LaunchOptionsKey: Any]?\n")
      .replace(WINDOW_START, "    // 窓と React Native の起動は SceneDelegate が受け持つ\n    pendingLaunchOptions = launchOptions\n");
    cfg.modResults.contents = src + SCENE_DELEGATE;
    return cfg;
  });
};

module.exports = withSceneLifecycle;
