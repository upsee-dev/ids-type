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
- `native/` … Expoアプリ（コンテナーアプリ）＋**Android のシステムキーボード本体**
  - `native/ime/android/` … Kotlin の `InputMethodService`。エンジンも Kotlin へ移植済み（Ids/Dict/Engine/KeyboardView）
  - `native/plugins/withKatachiIme.js` … `android/` が prebuild の生成物なので、毎回ここから注入する
  - **エミュレータで動作確認済み**: Settings の検索欄に `左右→日→月` → `明` を確定できる
  - iOS の Keyboard Extension は未着手

アプリ内キーボード（かたち／よく使う部品／部首）はWeb版・アプリ版で同じ設計にしてあるので、そのままキーボード拡張のUI設計に流用できる。

## Phase 1: スマホIME

### iOS — **ビルド可能な状態まで完了**
- **キーボード本体**: Swift + Keyboard Extension（`native/targets/keyboard/`）。`@bacons/apple-targets` でターゲット追加
- **メモリ**: 上限約60MB。辞書は UTF-8 の `Data` 1本＋バイト範囲(Int32)の配列で持ち、String 化は表示分だけ。辞書そのものは拡張に同梱（App Group には置かない）
- **フルアクセス**: 1.0.7 から `RequestsOpenAccess = true`。用途は履歴・お気に入りをアプリと共有すること1点のみで、通信は引き続き一切しない。許可されないときは拡張自身の UserDefaults に落ちる（機能は失われない）。審査で用途を聞かれたら「App Group 経由の履歴共有のみ」と答える
- 残: 実機での動作確認、App Store Connect のアプリレコード作成、提出

### Android — **完了**
- **キーボード本体**: Kotlin + InputMethodService。UIは素の View（Compose を足すと APK が膨らむため）
- config plugin (`withKatachiIme.js`) が prebuild 後に Kotlin・リソース・辞書を注入し、`AndroidManifest.xml` に service を追加する
- 辞書は tsv 直読み。日本語13,108字を先に読み、拡張漢字は後追いで読む（キーボードの初動を待たせない）
- 残: 長押しでの連続削除、候補の横スクロール位置保持、ダークテーマ対応

## Phase 2: PC（質問への回答）

**結論: いきなりネイティブIMEを書かず、まずRimeスキーマで出す。**

1. **Rimeスキーマ（推奨・最短）**
   [Rime](https://rime.im/)はオープンソースのIMEプラットフォームで、macOS（Squirrel）・Windows（Weasel）・Linux（ibus/fcitx-rime)に対応。入力方式はYAMLスキーマ＋辞書テーブルで定義でき、ネイティブコード不要。
   - `build-data.mts` を拡張し「IDSコード列 → 漢字」の辞書テーブル（例: `lr日月 → 明`）を生成すればよい
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
| BabelStone IDS（分解データの土台・97,680字） | 作者(Andrew West)が著作権を主張せず、personal/commercial とも許諾・帰属不要と明記 | **そのまま商用可**。分解データの主軸をここへ移した |
| CHISE IDS（拡張G〜J） | GPLv2 | 拡張Jのみ依存（Unicode 17.0 追加分で BabelStone 未対応のため）。BabelStone の 17.0 対応待ち、それまでは `IDS_SOURCE=babelstone` で外せる |
| CJKVI IDS（KANJIDIC2収録字の日本字体） | GPLv2 | 既存の検索結果を変えないために優先しているだけで、外しても BabelStone の J字源タグで代替できる（`IDS_SOURCE=babelstone`）。差分は約2,270字 |
| KANJIDIC2（読み・学年・頻度） | CC BY-SA 4.0（EDRDG） | 出典表示を継続。商用可 |

製品版で GPLv2 を完全に外す場合は `IDS_SOURCE=babelstone` でビルドし、拡張Jの分解のみ別途用意する（IRGの提出資料由来のIDSを自前で起こすか、BabelStoneの更新を待つ）。

## 既知の制約（プロトタイプ）

- Unicode 15.1で追加されたIDC（⿼⿽⿾⿿㇯ = OL/LU/MI/RO/SU）は分解データ側にほぼ出現せず、フォントによっては字形が出ない（ボタンは仕様準拠のため設置済み）
- 未符号化部品はデータ上プレースホルダ（cjkvi由来は①②③…、BabelStone/CHISE由来は？）で表現され、検索キーには使えない
- 候補は上位200件で打ち切り
- 拡張B以降の約8万字は端末に対応フォントが無いと □ で表示される。システムIME化のときは、候補ビューだけでも全字入りフォント（BabelStone Han や Noto Serif CJK の拡張版）を同梱するか、候補を字形SVGで描くかの判断が要る
