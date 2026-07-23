# カタチ入力 技術ロードマップ

Webプロトタイプから、スマホ／PCの「システムキーボード（IME）」へ育てるための技術方針。

## 大前提: システムキーボードはWebやExpoだけでは作れない

SimejiやGoogle日本語入力のように「OSの入力方式として登録される」には、各OSのキーボード拡張機構へのネイティブ実装が必須。

| プラットフォーム | 必須の仕組み | 言語 |
|---|---|---|
| iOS | Custom Keyboard Extension（NSExtension） | Swift |
| Android | InputMethodService | Kotlin |
| macOS | IMKit（Input Method Kit） | Swift / Obj-C |
| Windows | TSF（Text Services Framework） | C++ / Rust |

Expo/RNやElectron/Tauriが担えるのは「コンテナーアプリ」（設定画面・チュートリアル・辞書管理）まで。キーボード本体はネイティブで書く。

## アーキテクチャ方針: コアとガワの分離

```
[検索エンジン + 辞書データ(0.4MB)]  ← 純ロジック・依存なし(現在TypeScript約300行)
        │
        ├─ Web (Next.js)            ← 完成
        ├─ iOS Keyboard Extension   ← Swiftへ移植
        ├─ Android IMS              ← Kotlinへ移植
        └─ PC IME (Rime / IMKit / TSF)
```

エンジンは「IDS構文木のマッチング＋閉包計算」だけで小さいため、当面は各言語へ素直に移植するのが最速・最軽量（キーボード拡張のメモリ制約にも有利）。プラットフォームが増えたらRustで単一実装にし、uniffi（iOS/Android）・wasm（Web）・windows-rs（Windows）で共有する。

## 現状（2026-07-23）

- `core/` … エンジン＋辞書＋キーボード定義。Web版・アプリ版が同じものを参照する
- `web/` … Next.jsのWebプロトタイプ
- `native/` … Expoアプリ（=下記の「コンテナーアプリ」の器）。**単体アプリとして漢字を検索・コピーできる状態**。キーボード拡張はまだ入っていない

アプリ内キーボード（かたち／よく使う部品／部首）はWeb版・アプリ版で同じ設計にしてあるので、そのままキーボード拡張のUI設計に流用できる。

## Phase 1: スマホIME

### iOS
- **キーボード本体**: Swift + Keyboard Extension。メモリ上限が厳しい（目安60〜80MB）ため、拡張内にRNを入れない。エンジンをSwift移植し、辞書JSONはApp Groupで共有。
- **コンテナーアプリ**: Expo/RN でOK。`npx expo prebuild` + config plugin（または `@bacons/apple-targets`）でExtensionターゲットを追加する。
- **審査対策**: ネットワーク不要の設計にして「フルアクセス」を要求しない（プライバシー面の審査・訴求で有利）。

### Android
- **キーボード本体**: Kotlin + InputMethodService（UIはJetpack Compose可）。
- Expoを使う場合はprebuild後にconfig pluginで `AndroidManifest.xml` にserviceを追加。コンテナーはRNのままでよい。

## Phase 2: PC（質問への回答）

**結論: いきなりネイティブIMEを書かず、まずRimeスキーマで出す。**

1. **Rimeスキーマ（推奨・最短）**
   [Rime](https://rime.im/)はオープンソースのIMEプラットフォームで、macOS（Squirrel）・Windows（Weasel）・Linux（ibus/fcitx-rime)に対応。入力方式はYAMLスキーマ＋辞書テーブルで定義でき、ネイティブコード不要。
   - `build-data.mjs` を拡張し「IDSコード列 → 漢字」の辞書テーブル（例: `lr日月 → 明`）を生成すればよい
   - 数日で全PC対応が得られる。制約はユーザーがRimeをインストールする必要があること（専門職アーリーアダプター向けには許容範囲）
2. **macOS ネイティブ**: IMKit + Swift。Rime版で検証済みのUXを移植
3. **Windows ネイティブ**: TSF。C++が伝統だが、新規ならRust + windows-rs も現実的。TSFは難所が多いので最後
4. **やってはいけないこと**: Electron/TauriでIMEを作ろうとすること（OSの入力方式には登録できない）。デスクトップの設定アプリ・辞書ツールにだけ使う

## Phase 3: エンジン強化

- 曖昧部品マッチ（似形部品の同一視拡充）・複数IDS解釈の並列マッチ
- BabelStone IDSの導入検討（カバレッジ・許諾条件の確認）
- 手書き1部品だけ描いて残りは構造コード、のハイブリッド入力
- オンデバイスLLMによる文脈リランキング（調査レポートの「候補生成と選択エンジンの疎結合」原則を維持）

## データライセンス（製品化前に要対応）

| データ | ライセンス | 対応 |
|---|---|---|
| CJKVI IDS（分解データ） | GPLv2 | プロトタイプ限定。製品版は (a) CHISE/BabelStoneの条件整理 か (b) 常用・人名用中心に自前でIDSデータを再構築（1〜2万字規模なら現実的） |
| KANJIDIC2（読み・学年・頻度） | CC BY-SA 4.0（EDRDG） | 出典表示を継続。商用可 |

## 既知の制約（プロトタイプ）

- Unicode 15.1で追加されたIDC（⿼⿽⿾⿿㇯ = OL/LU/MI/RO/SU）は分解データ側にほぼ出現せず、フォントによっては字形が出ない（ボタンは仕様準拠のため設置済み）
- 未符号化部品（CDP外字）はデータ上①②③…のプレースホルダで表現され、検索キーには使えない
- 候補は上位200件で打ち切り。異体字・旧字体の網羅はBabelStone導入時に拡充予定
