# IDS漢字入力

読めない漢字を、見たまま打てる。IDS（漢字の空間構造記述）コード＋部品で漢字を検索・入力する日本語キーボードプロジェクト。入力方式は [zi.tools](https://zi.tools/?secondary=ids) のIDS部品入力を日本語市場向けに再設計したもの。
企画立案：西岡佑都
アプリ制作＆企画伴走：春木俊明
2026.07

```
LR日月 → 明     UD宀子 → 字     OC囗玉 → 国     RU辶刀 → 辺
```

Web版・Expoアプリ・システムキーボード（Android IME / iOSキーボード拡張）の3つがあり、
検索エンジンと辞書は `core/` の1か所を共有している。

## 構成

```
├── core/                  # 依存なしの共有コア（Web版・アプリ版で同じものを使う）
│   ├── index.ts           #   公開API。web/native はこれだけ見る
│   ├── engine.ts          #   検索エンジン(構造マッチ・部品包含・一覧)
│   ├── ids/               #   かたちコード⇄IDC・字形の正規化・IDS構文解析
│   ├── data/              #   ブロック表・部品パレット・着せ替え・辞書の型
│   └── kanji-data.json    #   生成済み辞書(102,998字・2.7MB / gzip 0.9MB)
├── data-src/              # 元データ（加工しない。出典は sources.json）
├── web/                   # Webプロトタイプ (Next.js + React + Tailwind)
│   ├── src/app/           #   入力画面・収録漢字一覧(?q= と ?block= で共有できる)
│   └── scripts/           #   辞書ビルド・エンジンテスト
├── native/                # Expoネイティブアプリ (iOS / Android)
│   ├── App.tsx            #   コンテナーアプリの画面（設定・お試し入力）
│   ├── ime/               #   ★Androidシステムキーボード本体（Kotlin）
│   ├── targets/keyboard/  #   ★iOSキーボード拡張（Swift）
│   └── plugins/           #   prebuild後の android/ へ ime/ を注入する config plugin
├── scripts/               # フォント・アイコンの生成、ストア提出
└── docs/                  # 事業戦略・技術ロードマップ
```

エンジンと辞書は `core/` の1か所だけにある。Web版は相対パスで直接読み
（`web/next.config.ts` の `turbopack.root` をリポジトリ直下に設定）、
アプリ版はビルド時に `native/src/core/` へ複製して読む
（Metro がプロジェクト外を解決できないため）。

`core/` 内の相対 import には `.ts` を付けている。Turbopack・Metro・Node の
型ストリッピングのどれでも同じコードが動くようにするため。辞書ビルドが
`core/data/blocks.ts` を直接 import できるのはこの形のおかげで、
**ブロック表がビルドと実行時で二重管理にならない**（以前これがずれて、拡張C/Eの
末尾18字が黙って辞書から落ちていた）。

同じ理由で、**Kotlin と Swift のテーブルは手で書かず生成する**。
部品パレットと着せ替えは `core/` の定義から `build:data` が
`Palettes.{kt,swift}` `Themes.{kt,swift}` を、フォントの範囲表は
`build-font-app.py` が実際の収録字から `ExtFonts.{kt,swift}` を書き出す。

## 収録範囲（[zi.tools](https://zi.tools/?secondary=character_set) と同じ全CJK漢字）

**Unicode 17.0 が定義するCJK漢字 102,998字（統合漢字 101,984 + 互換漢字 1,014）を、過不足なく全部**収録している。UCD の `UnicodeData.txt` と突き合わせて収録もれ0字・余分0字を確認済み。

| ブロック  |   字数 |     | ブロック           |  字数 |
| --------- | -----: | --- | ------------------ | ----: |
| 基本(URO) | 20,992 |     | 拡張F              | 7,473 |
| 拡張A     |  6,592 |     | 拡張G              | 4,939 |
| 拡張B     | 42,720 |     | 拡張H              | 4,192 |
| 拡張C     |  4,160 |     | 拡張I              |   622 |
| 拡張D     |    222 |     | 拡張J              | 4,298 |
| 拡張E     |  5,774 |     | 互換漢字・互換補助 | 1,014 |

- **99.88%（102,871字）に分解データが付いている**。残る127字は、そもそも分解できない基本字（`一` `口` `女` `人` `乙` など）と、どの表にも分解が無い字（拡張Jの6字ほか）。候補としては収録されているが構造検索には出ない
- 収録漏れが出ないよう、`build:data` は毎回ブロックごとの収録数を検証し、1字でも欠けるとビルドを失敗させる（範囲表は `core/data/blocks.ts` の1か所）

### 日本語入力としての扱い

10万字をそのまま並べると日本語入力として使えなくなるため、候補は2階層に分けている。

- **KANJIDIC2 収録の 13,108字**（JIS X 0208/0212/0213）… 読み・学年・頻度・画数・部首つき。常に先に出る
- **それ以外の 89,890字**（拡張A〜Jほか）… 常に後ろ。UIでは破線の枠で区別する

「よく使う部品」パレット（`Engine#commonParts`）も KANJIDIC2 収録字だけを数えている。10万字全部で数えると簡体字の部品が上位を占めてしまうため。

## 字形の表示（フォント）

端末の標準フォントは拡張B以降を持っていないため、何もしないと候補も部品パレットも
☒ で埋まり「見て選ぶ」という方式そのものが成立しない。
[Plangothic](https://github.com/Fitzgerald-Porthmouth-Koenigsegg/Plangothic_Project)（SIL OFL 1.1）から
**端末が持っていない範囲だけ**を切り出して配っている（URO・拡張A・互換漢字は
Hiragino も Noto も持っているので入れない）。

|             | 方式                                                       | 量                                         |
| ----------- | ---------------------------------------------------------- | ------------------------------------------ |
| Web         | 符号位置1024ごとに124枚へ分割し `unicode-range` で出し分け | 計11.7MB（画面に出た字を含む枚だけ落ちる） |
| アプリ・IME | TTFを同梱し、1字ごとに `fontFamily` を選ぶ                 | 21.7MB（75,292字）                         |

Web は画面に出た字を含むスライスしか取りに行かないので初期ロードは変わらない。
React Native と Android/iOS のネイティブビューには `unicode-range` が無く
`fontFamily` を1つしか指定できないので、同梱のほうは
**符号位置→どちらのフォントか**の範囲表を引いて1字ずつ切り替える。
7.5万字は TrueType の65,535グリフ上限に収まらないため2つに分けてある。

Android は expo-font の静的バンドルで `assets/fonts/` に置かれるので、
**RNアプリとシステムIMEが同じ1部を共有**する（iOSの拡張は自分のバンドルしか
読めないため複製が要る）。生成は `scripts/build-font-app.py` と
`scripts/build-font-slices.py`。元フォント32MBは `.gitignore` 済みで、
切り出したほうをリポジトリに置いている（EAS Build も Vercel も Python を回さないため）。

## システムキーボード（IME）

**Android は「設定 > 言語と入力 > 画面キーボード」に登録され、どのアプリの
テキスト欄でも使える**（Simeji などと同じ仕組み）。iOS も「設定 > 一般 >
キーボード」に追加される Keyboard Extension として入っている。

### 構成上のポイント

- **キーボード本体は Kotlin / Swift**。`InputMethodService` にも App Extension にも
  React Native は載せられないので、エンジン（`core/`）を両方へ移植している。
  TypeScript 版と候補の並びまで一致させてある
- **`android/` と `ios/` は prebuild の生成物**（.gitignore 済み）。ネイティブのソースは
  `native/ime/` と `native/targets/keyboard/` に置き、config plugin が毎回コピーする。
  こうしないと `expo prebuild --clean` のたびに消える
- **辞書は tsv**。2.7MB の JSON を起動のたびに構文解析するとキーボードが出るまで
  1〜2秒かかるため。日本語13,108字を先に読んで即検索可能にし、拡張漢字89,890字は
  後から読み足す2段構え
- **iOSのメモリ対策**: 拡張の上限は約60MB。10万字を Swift の String で持つと危ないので、
  読み込んだ UTF-8 を1本の `Data` のまま抱え、各字・各IDSは**バイト範囲(Int32)だけ**を
  覚える。String を作るのは画面に出す数十件だけ（読み込みは全10万字で29ms）
- **フルアクセス不要**（`RequestsOpenAccess = false`）。ネットワークを使わない設計。
  代償として iOS の拡張では触覚を出せない（フルアクセスが要るため）ので、キー音のみ

### Swift 特有の落とし穴

**Swift の `String` は正規等価で比較・ハッシュする**。互換漢字 U+F902（車）と統合漢字
U+8ECA（車）が同じキーとして扱われるため、素直に辞書索引を作ると後から読む拡張漢字が
日本語の字を上書きし、`車` の分解 `⿻亘丨` が消えて `輸`・`輔`・`轍` が候補から落ちる。
索引は先勝ちにして回避している。JS/Kotlin は UTF-16 単位の比較なのでこの問題は起きない。
逆にこの性質を利用して、候補一覧では見た目が同じ互換漢字を1つにまとめている。

## 入力の考え方（スマホでもOSキーボードなしで打てる）

漢字の部品（辶・阝・氵…）はスマホのかなキーボードでは打てないため、**アプリ側にキーボードを持つ**構成にしている。

- **かたち**タブ … 位置関係17種。「左右」「上下」「全かこみ」など。IDC文字（⿰⿱⿴…）は端末のフォントによって豆腐(□)になるので、**文字ではなく矩形の配置図を描画**している
- **よく使う部品**タブ … 辞書内で構成要素として登場する回数が多い順に180件。木・氵・艹・口・金… と並ぶ
- **部首・偏旁**タブ … かなキーボードでは変換できない偏旁・筆画
- **あ**ボタン … 端末のIMEに切り替え（任意の部品を読みから直接入力したいとき）

自前キーボード使用中は OSキーボードを出さない（Webは `inputMode="none"`、アプリは
`showSoftInputOnFocus={false}`）。逆に「あ」で端末のキーボードに切り替えたときは、
入力欄が隠れないよう画面を縮め（Webは `interactive-widget` と visualViewport 追従、
アプリは `KeyboardAvoidingView`）、自前パレットは畳んで候補の面積を確保する。

### 打鍵の触覚

気持ちよさは「指が触れた瞬間に返ること」と「動作ごとに手触りが違うこと」で決まるので、
触覚は押し下げ（`onPressIn` / `ACTION_DOWN` / `.touchDown`）で返し、
キー・確定・削除・連射・切替・成功・該当なしで種類を変えている。
連打で重なる触覚は間引き、⌫長押しの連射は軽い刻みにして音も間引く
（毎回フル強度で返すと手のひらが震えるだけの不快な連続振動になる）。
Android は汎用の Vibrator ではなくキーボード用の触覚定数を使う（端末の設定を
尊重し、VIBRATE 権限も要らない）。強さはアプリの🎨パネルで オフ／ふつう／強め。

### 着せ替え

7種＋おまかせ（端末のライト/ダーク設定に追従）。定義は `core/data/themes.ts` の1か所で、
Kotlin・Swift へは `build:data` が生成する。アプリは🎨パネル、システムIMEは🎨キーで
切り替え、選択はそれぞれの端末側（AsyncStorage / SharedPreferences / UserDefaults）に残る。

## 開発

```bash
cd web    && npm install && npm run dev     # http://localhost:3000
cd native && npm install && npm start       # Expo Go・開発ビルド

npm run typecheck                           # web / native それぞれにある
cd web && npm run test:engine               # エンジンテスト
cd web && npm run build:data                # 辞書と各言語の生成物を作り直す
```

`build:data` は `core/kanji-data.json` と `web/public/data/` に加えて、
IME用のtsv辞書と Kotlin/Swift のテーブル（パレット・着せ替え）を書き出す。

生成物を作り直すスクリプト（元データや定義を変えたときだけ）:

| スクリプト                     | 何を作るか                 | 要るもの                      |
| ------------------------------ | -------------------------- | ----------------------------- |
| `data-src/fetch.mjs`           | 元データの取り直し         | —                             |
| `scripts/build-font-app.py`    | アプリ同梱フォント＋範囲表 | fonttools・元フォント         |
| `scripts/build-font-slices.py` | Web用の分割フォント        | fonttools・brotli・元フォント |
| `scripts/build-icons.py`       | アイコン一式               | pillow                        |

Android のローカルビルドは `cd native && npm run build:android`（動作確認用のAPK）。
JDK 17 は `/opt/homebrew/opt/openjdk@17`、Android SDK は `~/Library/Android/sdk`。

## リリース

ストア提出はこのマシンだけで完結する（EAS のクラウドビルドは使わない）。
バージョンは `native/app.json` の `version` / `buildNumber` / `versionCode` を上げる。
`runtimeVersion` は appVersion 連動なので、`version` を上げると OTA の系列が変わる
（＝旧ビルドには以後の `eas update` が届かない）。

- **JSだけの変更は OTA で配れる**（`eas update --channel production`）。ネイティブの
  変更（フォント同梱・触覚・IMEのKotlin/Swift・config plugin）は新しいビルドが要る。
  ただし**OTAを受け取れるのは、配信チャンネルを焼き込んだビルドだけ**。
  EAS Build ならチャンネルは自動で入るが、ローカルビルドでは
  `updates.requestHeaders` の `expo-channel-name` を自分で指定しないと入らず、
  アプリの更新リクエストは `expo-channel-name` 不足でサーバーに 400 で弾かれる
  （**1.0.0〜1.0.2 のビルドがこの状態**で、OTAは一切届かない。1.0.2 より後の
  ビルドから有効になる）
- **Android**: `gradlew bundleRelease` で AAB を作り、`scripts/submit-play.py` で
  internal トラックへ。`withReleaseSigning` プラグインが `store/AuthKey/` の
  アップロード鍵で署名する（鍵が無いとデバッグ署名のままになり Play に弾かれる）。
  提出は edit を作る→上げる→トラックに割り当て→commit の順で、commit するまで
  Play 側に反映されないので途中で失敗しても中途半端にならない
- **iOS**: `xcodebuild archive` → `-exportArchive`（`native/ExportOptions.plist`）→
  `xcrun altool --upload-app`。プロファイルは持っていないので
  `-allowProvisioningUpdates` と ASC の APIキーで自動生成させる。
  上げる前に `--validate-app` を通すと、弾かれる原因を先に潰せる

**アプリレコードだけは App Store Connect の Web UI で作る必要がある**
（API は `apps` の CREATE を許可していない。レコードが無いと `altool` は
`Cannot determine the Apple ID from Bundle ID` で止まる）。
審査への提出と、Play の製品版への昇格も各コンソールでの操作になる。

鍵類は `store/AuthKey/`（.gitignore 済み）。**アップロード鍵を失うと同じアプリを
更新できなくなるので、必ず別途バックアップすること。**

## アイコン

ロゴ（生成りの地に、インディゴとスカイで組んだ字形。中の余白に「漢」が浮かぶ）1枚から、
`scripts/build-icons.py` が配布用アイコンを全部書き出す。マスターは `assets-archive/logo/`。
ブランド色は インディゴ `#4437D1` / スカイ `#34B5FC` / 生成り `#FBFBF9`。

用途ごとにキャンバスに対するロゴの比率を変えている（小さいアイコンほど大きく、
マスクで外周が削られるものほど小さく）。iOS は透過を持てないので生成り地に焼き込み、
Android の前景・モノクロだけ背景を抜いている。ロゴ中央の「漢」の窓は外周と細い隙間で
つながっているため、そのまま背景を抜くと窓まで穴になる。クロージングで隙間だけ塞いでから
抜いているので、ダークなスプラッシュ地でも窓の中の「漢」が沈まない。

## データ出典・ライセンス

分解データは3つの表を優先順位つきで重ねている（`web/scripts/build-data/merge.mts`）。出典の一覧は `data-src/sources.json`。

| 出典                                                                      | 使いどころ                                                                                                                           | ライセンス                                         |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| [BabelStone IDS](https://www.babelstone.co.uk/CJK/IDS.TXT)（Andrew West） | 土台。Unicode 16.0 の全97,680字。字源タグ(G/H/T/**J**/K/P/V)を持つので日本字体を選べる                                               | 作者が著作権を主張せず、用途・帰属の制限なしと明記 |
| [CHISE IDS Database](https://gitlab.chise.org/CHISE/ids)                  | 穴埋め。BabelStone は Unicode 16.0 準拠で 17.0 の**拡張Jを1字も持たない**。加えて拡張C/Eの末尾18字など他の表に分解が無い20字も埋まる | GPLv2                                              |
| [CJKVI IDS Database](https://github.com/cjkvi/cjkvi-ids)                  | KANJIDIC2 収録字の日本字体。従来の検索結果を変えないため優先している                                                                 | GPLv2                                              |

- 漢字情報（読み・学年・頻度・画数・部首・意味）: [KANJIDIC2](https://www.edrdg.org/wiki/index.php/KANJIDIC_Project)（EDRDG、CC BY-SA 4.0）
- 字形表示: [Plangothic](https://github.com/Fitzgerald-Porthmouth-Koenigsegg/Plangothic_Project)（SIL OFL 1.1）
- 互換漢字（U+F900〜/U+2F800〜）の分解は、正規等価な統合漢字の IDS を NFC 経由で借りている（元データ側に無いため）

`IDS_SOURCE=babelstone npm run build:data` で GPLv2 の2つを外し、BabelStone だけでビルドできる。字数は 102,998 のままだが、拡張J 4,298字の分解データが丸ごと落ちて構造検索に出てこなくなる（BabelStone が Unicode 16.0 準拠のため）。製品化時のライセンス方針は `docs/technical-roadmap.md` 参照。
