# カタチ入力（仮称）

読めない漢字を、見たまま打てる。IDS（漢字の空間構造記述）コード＋部品で漢字を検索・入力する日本語キーボードプロジェクト。入力方式は [zi.tools](https://zi.tools/?secondary=ids) のIDS部品入力を日本語市場向けに再設計したもの。

```
LR日月 → 明     UD宀子 → 字     OC囗玉 → 国     RU辶刀 → 辺
```

## 構成

```
katachi-ime/
├── core/                       # 依存なしの共有コア（Web版・アプリ版で同じものを使う）
│   ├── index.ts                #   公開API。web/native はこれだけ見る
│   ├── engine.ts               #   検索エンジン(構造マッチ・部品包含・一覧)
│   ├── ids/                    #   IDS(漢字の空間構造記述)まわり
│   │   ├── operators.ts        #     かたちコード ⇄ IDC、配置図の矩形データ
│   │   ├── normalize.ts        #     同じ形で符号位置が違う部品を寄せる
│   │   └── parse.ts            #     IDS文字列 → 構文木
│   ├── data/
│   │   ├── blocks.ts           #     Unicodeブロック表（★ビルドと実行時で共有）
│   │   ├── palettes.ts         #     キーボードに並べる部品
│   │   └── types.ts            #     辞書の型
│   └── kanji-data.json         #   生成済み辞書(102,998字・2.4MB / gzip 0.8MB)
├── data-src/                   # 元データ（加工しない。README/sources.json に出典）
│   ├── ids/                    #   BabelStone / CHISE拡張G〜J / CJKVI
│   ├── kanjidic2/
│   └── fetch.mjs               #   sources.json のとおりに取り直す
├── web/                        # Webプロトタイプ (Next.js + React + Tailwind)
│   ├── src/app/page.tsx        #   入力画面
│   ├── src/app/chars/page.tsx  #   収録漢字一覧（?q= と ?block= で共有できる）
│   ├── src/components/         #   KatachiKeyboard / OperatorIcon / KanjiGrid / CharDetail
│   ├── src/lib/                #   engine 再エクスポート・useEngine・表示文言
│   └── scripts/
│       ├── build-data.mts      #   辞書ビルド（工程は build-data/ に分割）
│       └── test-engine.mts     #   エンジンテスト
├── native/                     # Expoネイティブアプリ (iOS / Android)
│   ├── App.tsx                 #   コンテナーアプリの画面（設定・お試し入力）
│   ├── src/                    #   KatachiKeyboard / OperatorIcon / theme
│   ├── ime/                    #   ★システムキーボード本体（OSに入力方式として登録される）
│   │   ├── android/java/...    #     Kotlin: IMEサービス・キーボードUI・エンジン移植
│   │   ├── android/res/xml/    #     method.xml（入力方式の宣言）
│   │   └── assets/*.tsv        #     IME用辞書（build:data が生成）
│   ├── plugins/
│   │   └── withKatachiIme.js   #   ime/ を prebuild後の android/ へ注入する config plugin
│   └── scripts/
│       ├── sync-core.mjs       #   ../core を src/core/ へ複製（Metro制約の回避）
│       └── build-android.sh    #   ローカルAPKビルド
├── scripts/build-icons.py      # ロゴ1枚から配布用アイコン一式を書き出す
├── assets-archive/logo/        # 採用ロゴのマスター
└── docs/
    ├── katachi-strategy.pdf    # 事業戦略ドキュメント(A4・6ページ)
    ├── strategy.html           # ↑のソース(編集後Chromeで再PDF化)
    └── technical-roadmap.md    # システムIME化の技術方針(iOS/Android/PC)
```

エンジンと辞書は `core/` の1か所だけにある。Web版は相対パスで直接読み
（`web/next.config.ts` の `turbopack.root` をリポジトリ直下に設定）、
アプリ版はビルド時に `native/src/core/` へ複製して読む
（Metro がプロジェクト外を解決できないため）。

`core/` 内の相対 import には `.ts` を付けている。Turbopack・Metro・Node の
型ストリッピング（`--experimental-strip-types`）のどれでも同じコードが動くようにするため。
辞書ビルドが `core/data/blocks.ts` を直接 import できるのはこの形のおかげで、
**ブロック表がビルドと実行時で二重管理にならない**（以前これがずれて、拡張C/Eの
末尾18字が黙って辞書から落ちていた）。

## 収録範囲（[zi.tools](https://zi.tools/?secondary=character_set) と同じ全CJK漢字）

**Unicode 17.0 が定義するCJK漢字 102,998字（統合漢字 101,984 + 互換漢字 1,014）を、過不足なく全部**収録している。UCD の `UnicodeData.txt` と突き合わせて収録もれ0字・余分0字を確認済み。

| ブロック | 字数 | | ブロック | 字数 |
|---|---:|---|---|---:|
| 基本(URO) | 20,992 | | 拡張F | 7,473 |
| 拡張A | 6,592 | | 拡張G | 4,939 |
| 拡張B | 42,720 | | 拡張H | 4,192 |
| 拡張C | 4,160 | | 拡張I | 622 |
| 拡張D | 222 | | 拡張J | 4,298 |
| 拡張E | 5,774 | | 互換漢字・互換補助 | 1,014 |

- **99.88%（102,871字）に分解データが付いている**。残る127字は、そもそも分解できない基本字（`一` `口` `女` `人` `乙` など）と、どの表にも分解が無い字（拡張Jの6字ほか）。候補としては収録されているが構造検索には出ない
- 収録漏れが出ないよう、`build:data` は毎回ブロックごとの収録数を検証し、1字でも欠けるとビルドを失敗させる（範囲表は `core/data/blocks.ts` の1か所）
- 収録字は `/chars`（Web版の「収録一覧」）でブロック別に閲覧できる。読み（`あお`）や符号位置（`U+3134A`）でも引ける

### 日本語入力としての扱い

10万字をそのまま並べると日本語入力として使えなくなるため、候補は2階層に分けている。

- **KANJIDIC2 収録の 13,108字**（JIS X 0208/0212/0213）… 読み・学年・頻度つき。常に先に出る
- **それ以外の 89,890字**（拡張A〜Jほか）… 常に後ろ。UIでは破線の枠で区別する

「よく使う部品」パレット（`Engine#commonParts`）も KANJIDIC2 収録字だけを数えている。10万字全部で数えると簡体字の部品が上位を占めてしまうため。

なお拡張B以降の字は**端末に対応フォントが無いと □ で表示される**（データとしては入っており、コピーすれば正しく貼り付けられる）。
ただし**部品パレットの541件だけはサブセットフォントを同梱して □ を解消済み**（下記「アイコン・配布素材」参照）。

## システムキーボード（IME）

**Android は「設定 > 言語と入力 > 画面キーボード」に「カタチ入力」として登録され、
どのアプリのテキスト欄でも使える**（Simeji などと同じ仕組み）。エミュレータで
Settings の検索欄に `左右→日→月` と打って `明` が入力されるところまで確認済み。

```bash
cd native && npm run build:android      # -> build/katachi-ime-1.0.0.apk
adb install -r build/katachi-ime-1.0.0.apk
adb shell ime enable com.upsee.idskanjitype/com.upsee.katachi.ime.KatachiImeService
adb shell ime set    com.upsee.idskanjitype/com.upsee.katachi.ime.KatachiImeService
```

### 構成上のポイント

- **キーボード本体は Kotlin**。`InputMethodService` は React Native を載せられないので、
  エンジン(`core/`)を Kotlin へ移植している（`native/ime/android/java/.../Engine.kt`）。
  TypeScript 版と候補の並びまで一致させてある
- **`android/` は prebuild の生成物**（.gitignore 済み）なので、ネイティブのソースは
  `native/ime/` に置き、`plugins/withKatachiIme.js` が毎回コピー＋Manifest へ service 追記する。
  こうしないと `expo prebuild --clean` のたびに消える
- **辞書は tsv**。2.4MB の JSON を起動のたびに構文解析するとキーボードが出るまで1〜2秒かかるため。
  日本語の13,108字を先に読んで即検索可能にし、拡張漢字89,890字は後から読み足す2段構え
- **部品パレットのフォントも同梱**。`assets/KatachiParts.ttf` を `Typeface.createFromAsset`
  で読む（RN 側の expo-font とは別経路になるため）

### iOS

Keyboard Extension（Swift）も入っている。`targets/keyboard/` が拡張ターゲットの実体で、
`@bacons/apple-targets` が prebuild 時に Xcode ターゲットとして追加する。

```bash
cd native && npx expo prebuild -p ios --clean
cd ios && xcodebuild -workspace app.xcworkspace -scheme app \
  -configuration Release -sdk iphonesimulator CODE_SIGNING_ALLOWED=NO build
```

- **メモリ対策**: 拡張の上限は約60MB。10万字を Swift の String で持つと危ないので、
  読み込んだ UTF-8 を1本の `Data` のまま抱え、各字・各IDSは**バイト範囲(Int32)だけ**を覚える。
  String を作るのは画面に出す数十件だけ。辞書の読み込みは日本語13,108字が6ms、全10万字で29ms
- **フルアクセス不要**（`RequestsOpenAccess = false`）。ネットワークを使わない設計
- エンジンは `swiftc` でコマンドラインからも検証できる（`native/ime/test/main.swift`）。
  Web/Android と同じ問いに同じ候補・同じ順で答えることを確認済み

#### TestFlight へ出す

配布署名済みの IPA まではコマンドラインで作れる。

```bash
cd native && npx expo prebuild -p ios --clean
cd ios && xcodebuild -workspace app.xcworkspace -scheme app -configuration Release \
  -destination 'generic/platform=iOS' -archivePath /tmp/katachi.xcarchive \
  -allowProvisioningUpdates \
  -authenticationKeyPath ~/.appstoreconnect/private_keys/AuthKey_<KEYID>.p8 \
  -authenticationKeyID <KEYID> -authenticationKeyIssuerID <ISSUER> \
  DEVELOPMENT_TEAM=W8P3V5NG4R archive
xcodebuild -exportArchive -archivePath /tmp/katachi.xcarchive \
  -exportOptionsPlist ExportOptions.plist -exportPath /tmp/katachi-export \
  -allowProvisioningUpdates -authenticationKey...   # method: app-store-connect
xcrun altool --upload-app -f /tmp/katachi-export/app.ipa -t ios \
  --apiKey <KEYID> --apiIssuer <ISSUER>
```

**ただしアプリレコードだけは App Store Connect の Web UI で作る必要がある。**
App Store Connect API は `apps` の作成を許可していない
（`The resource 'apps' does not allow 'CREATE'`。許可されるのは GET と UPDATE だけ）。
レコードが無いと `altool` は
`Cannot determine the Apple ID from Bundle ID` で止まる。

Bundle ID（`com.upsee.idskanjitype` と `.keyboard`）は API から登録済み。

#### Swift 特有の落とし穴

**Swift の `String` は正規等価で比較・ハッシュする**。互換漢字 U+F902（車）と統合漢字
U+8ECA（車）が同じキーとして扱われるため、素直に辞書索引を作ると後から読む拡張漢字が
日本語の字を上書きし、`車` の分解 `⿻亘丨` が消えて `輸`・`輔`・`轍` が候補から落ちる。
索引は先勝ちにして回避している。JS/Kotlin は UTF-16 単位の比較なのでこの問題は起きない。
逆にこの性質を利用して、候補一覧では見た目が同じ互換漢字を1つにまとめている。

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
# 元データを取り直す（sources.json のとおりに）
node data-src/fetch.mjs

# 辞書の再生成。core/ と web/public/data/ の両方に書き出す
cd web && npm run build:data

# エンジンテスト・型チェック
npm run test:engine
npm run typecheck

# アイコン一式の再生成(ロゴを差し替えたとき)
pip install pillow && python3 scripts/build-icons.py

# 部品パレット用サブセットフォントの再生成(部品を足したとき)
pip install fonttools brotli && python3 scripts/build-font-subset.py

# 戦略PDFの再生成
cd ../docs && "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --no-pdf-header-footer --print-to-pdf=katachi-strategy.pdf strategy.html
```

## アイコン・配布素材

ロゴ（生成りの地に、インディゴとスカイで組んだ字形。中の余白に「漢」が浮かぶ）
1枚から、`scripts/build-icons.py` が配布用アイコンを全部書き出す。マスターは
`assets-archive/logo/`。ブランド色は インディゴ `#4437D1` / スカイ `#34B5FC` / 生成り `#FBFBF9`。

| 出力先 | ファイル | 用途 |
|---|---|---|
| `web/src/app/` | `favicon.ico`（16/32/48） | ブラウザのタブ |
| | `icon.png` 512 / `apple-icon.png` 180 | ブックマーク・ホーム画面 |
| | `opengraph-image.png` 1200×630 | SNS カード |
| | `manifest.webmanifest` | PWA（`standalone`・`theme_color`） |
| `web/public/` | `icon-192/512.png`, `icon-maskable-512.png` | マニフェストから参照 |
| `native/assets/` | `icon.png` 1024（不透過） | iOS アプリアイコン |
| | `android-icon-{foreground,background,monochrome}.png` 1024 | Android アダプティブ／Android 13+ テーマ |
| | `splash-icon.png`, `favicon.png` | スプラッシュ・Expo Web |

用途ごとにキャンバスに対するロゴの比率を変えている（小さいアイコンほど大きく、
マスクで外周が削られるものほど小さく）。iOS は透過を持てないので生成り地に焼き込み、
Android の前景・モノクロだけ背景を抜いている。ロゴ中央の「漢」の窓は外周と細い隙間で
つながっているため、そのまま背景を抜くと窓まで穴になる。クロージングで隙間だけ塞いでから
抜いているので、ダークなスプラッシュ地でも窓の中の「漢」が沈まない。

### 部品パレット用サブセットフォント

「難輸入部件」541件は拡張B〜Hの字が多く、**macOS でも117件が □ になる**（Androidはもっと多い）。
「見て選ぶ」ための画面なので □ が並ぶと機能しない。[Plangothic](https://github.com/Fitzgerald-Porthmouth-Koenigsegg/Plangothic_Project)（SIL OFL 1.1・拡張A〜I収録）から
**パレットの字だけ**を切り出して同梱している。全部入れると32MBだが、この用途なら
`web/public/fonts/KatachiParts.woff2` が **29KB**、`native/assets/fonts/KatachiParts.ttf` が 67KB で済む。
サブセットに無い字は端末のフォントへ自動でフォールバックする。**541件すべてが □ にならないことを実ブラウザで確認済み**。

一覧画面（10万字）の □ はこの方法では解決しない（全字ぶんのフォントは数十MB必要）。

## データ出典・ライセンス

分解データは3つの表を優先順位つきで重ねている（`web/scripts/build-data/merge.mts`）。出典の一覧は `data-src/sources.json`。

| 出典 | 使いどころ | ライセンス |
|---|---|---|
| [BabelStone IDS](https://www.babelstone.co.uk/CJK/IDS.TXT)（Andrew West） | 土台。Unicode 16.0 の全97,680字。字源タグ(G/H/T/**J**/K/P/V)を持つので日本字体を選べる | 作者が著作権を主張せず、用途・帰属の制限なしと明記 |
| [CHISE IDS Database](https://gitlab.chise.org/CHISE/ids) | 穴埋め。BabelStone は Unicode 16.0 準拠で 17.0 の**拡張Jを1字も持たない**。加えて拡張C/Eの末尾18字など他の表に分解が無い20字も埋まる | GPLv2 |
| [CJKVI IDS Database](https://github.com/cjkvi/cjkvi-ids) | KANJIDIC2 収録字の日本字体。従来の検索結果を変えないため優先している | GPLv2 |

- 漢字情報（読み・学年・頻度）: [KANJIDIC2](https://www.edrdg.org/wiki/index.php/KANJIDIC_Project)（EDRDG、CC BY-SA 4.0）
- 互換漢字（U+F900〜/U+2F800〜）の分解は、正規等価な統合漢字の IDS を NFC 経由で借りている（元データ側に無いため）

`IDS_SOURCE=babelstone npm run build:data` で GPLv2 の2つを外し、BabelStone だけでビルドできる。字数は 102,998 のままだが、拡張J 4,298字の分解データが丸ごと落ちて構造検索に出てこなくなる（BabelStone が Unicode 16.0 準拠のため）。製品化時のライセンス方針は docs/technical-roadmap.md 参照。
