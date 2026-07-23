# カタチ入力（仮称）

読めない漢字を、見たまま打てる。IDS（漢字の空間構造記述）コード＋部品で漢字を検索・入力する日本語キーボードプロジェクト。入力方式は [zi.tools](https://zi.tools/?secondary=ids) のIDS部品入力を日本語市場向けに再設計したもの。

```
LR日月 → 明     UD宀子 → 字     OC囗玉 → 国     RU辶刀 → 辺
```

## 構成

```
katachi-ime/
├── core/                     # 依存なしの共有コア（Web版・アプリ版で同じものを使う）
│   ├── engine.ts             # 検索エンジン(IDS構造マッチ・部品包含・正規化)＋キーボード定義
│   └── kanji-data.json       # 生成済み辞書(13,108字・約0.8MB)
├── web/                      # Webプロトタイプ (Next.js + React + Tailwind)
│   ├── src/app/page.tsx      # 画面(出力欄・候補・入力欄)
│   ├── src/components/KatachiKeyboard.tsx  # オンスクリーンキーボード
│   ├── src/components/OperatorIcon.tsx     # 操作子の配置図(IDC文字を使わず矩形で描画)
│   ├── src/lib/engine.ts     # core/engine.ts の再エクスポート
│   └── scripts/build-data.mjs    # 辞書ビルド(ids.txt + kanjidic2 → JSON)
├── native/                   # Expoネイティブアプリ (iOS / Android)
│   ├── App.tsx               # 画面（Web版と同じ構成をReact Nativeで）
│   ├── src/KatachiKeyboard.tsx / src/OperatorIcon.tsx
│   ├── scripts/sync-core.mjs     # ../core を src/core/ へ複製（Metro制約の回避）
│   └── scripts/build-android.sh  # ローカルAPKビルド
├── data-src/                 # 元データ(CJKVI ids.txt / KANJIDIC2)
└── docs/
    ├── katachi-strategy.pdf  # 事業戦略ドキュメント(A4・6ページ)
    ├── strategy.html         # ↑のソース(編集後Chromeで再PDF化)
    └── technical-roadmap.md  # システムIME化の技術方針(iOS/Android/PC)
```

エンジンと辞書は `core/` の1か所だけにある。Web版は相対パスで直接読み（`web/next.config.ts` の `turbopack.root` をリポジトリ直下に設定）、アプリ版はビルド時に `native/src/core/` へ複製して読む。

## 入力の考え方（スマホでもOSキーボードなしで打てる）

漢字の部品（辶・阝・氵…）はスマホのかなキーボードでは打てないため、**アプリ側にキーボードを持つ**構成にしている。

- **かたち**タブ … 位置関係17種。「左右」「上下」「全かこみ」など。IDC文字（⿰⿱⿴…）は端末のフォントによって豆腐(□)になるので、**文字ではなく矩形の配置図を描画**している
- **よく使う部品**タブ … 辞書内で構成要素として登場する回数が多い順に180件（`Engine#commonParts`）。木・氵・艹・口・金… と並ぶ
- **部首・偏旁**タブ … かなキーボードでは変換できない偏旁・筆画
- **あ**ボタン … 端末のIMEに切り替え（任意の部品を読みから直接入力したいとき）

自前キーボード使用中は入力欄の `inputMode="none"`（Webの場合。アプリは `showSoftInputOnFocus={false}`）でOSキーボードを出さず、画面が隠れないようにしている。

## Webプロトタイプの起動

```bash
cd web
npm install
npm run dev       # http://localhost:3000
```

ワイルドカード `?`、部品のみ検索（例: `日月`）にも対応。PCではキーボードから `LR日月` のように直接打てる。

## ネイティブアプリ（Expo）

```bash
cd native
npm install
npm start              # Expo Go・開発ビルドで確認
npm run typecheck
```

### ローカルビルド（Android APK・EAS不使用）

```bash
cd native
npm run build:android
# -> native/build/katachi-ime-1.0.0.apk
```

必要な環境（このマシンでは設定済み）:

- JDK 17 … `/opt/homebrew/opt/openjdk@17`（`/usr/libexec/java_home` には未登録なので `JAVA_HOME` を直接指定している）
- Android SDK … `~/Library/Android/sdk`

生成されるAPKはデバッグ用キーストア署名。端末にインストールして試す用途はこれでよい。ストア提出時は本番キーストアでの署名が別途必要。

### iOS

```bash
cd native
npx expo prebuild -p ios --clean
npx expo run:ios          # シミュレータ
```

実機・ストア提出には Apple Developer の署名が必要。

## 開発コマンド

```bash
# 辞書の再生成(data-srcが必要)。core/ と web/public/data/ の両方に書き出す
cd web && node scripts/build-data.mjs

# エンジンテスト
node --experimental-strip-types scripts/test-engine.mts

# 戦略PDFの再生成
cd ../docs && "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --no-pdf-header-footer --print-to-pdf=katachi-strategy.pdf strategy.html
```

## データ出典・ライセンス

- 分解データ: [CJKVI IDS Database](https://github.com/cjkvi/cjkvi-ids)（CHISE IDS Database由来、GPLv2）— プロトタイプ用途。製品化時の扱いは docs/technical-roadmap.md 参照
- 漢字情報（読み・学年・頻度）: [KANJIDIC2](https://www.edrdg.org/wiki/index.php/KANJIDIC_Project)（EDRDG、CC BY-SA 4.0）
