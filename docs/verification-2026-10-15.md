# 入力・認識の検証（2026-10-15）

## 実行結果

- Web / Expo の型チェック、既存検索テスト、入力編集・フリックの回帰テスト: 合格。
- 手書きの追加範囲: 6,447 → 10,851字。元の日本語パターンは保持し、AnimCJK 由来の4,404字を補完。
- 拡張漢字 `𠮷・𱍸・𫠤・𬶀・𰀢` を元の筆画中心線から照合する回帰テスト: 合格。
- KanjiVG 異体字4,959例による既存ベンチマーク: 合格。崩し重ねの上位1件96.2%、上位5件99.2%。
  追加前は96.9%、99.4%。候補を増やしたため既存字での混同は残る。実利用者の正答率を示す数値ではない。
- TypeScript / Swift / Kotlin の手書き照合: 112問で候補と順序が一致。
- Android Kotlin / OCR モジュールのコンパイル: 合格。検証用APKの生成: 合格。
- Swift / Kotlin の中央枠計算: 縦長・横長・正方形で正方形・中心位置・画像範囲内を確認。

## Android エミュレーターでの操作

既存アプリを残し、別ID `com.upsee.idskanjitype.verification` で検証した。

- `AB|CD` の削除キー → `A|CD`、続けて左右の操作子を挿入 → `A⿰|CD`。
- 設定の閉じるボタンはステータスバー下に配置され、タップで入力画面に戻った。
- か行のキーで左へ大きく動かしてから上へ短く動かす → `く`。
- 続けて長押し → `くか`、次のタップ → `くかか`。消去後は連打状態もリセット。
- 日本語・中国語の同梱OCRを既知の文字画像へ適用。
  全体: `月\n明 日\n月\n明\n日`、中央枠: `明\n明!`。
  画面側は漢字だけを重複排除するため、全体は月・明・日、中央枠は明になる。

## 未確認・制限

- 実写・実際の書き手での改善率と、iOS実機での画面操作は未確認。
- 手書き用の筆画資料がない字は引けない。全102,999字を手書き/OCRで認識できるわけではない。
- iOSはSwiftの構文と切り出し計算を検証。アプリ全体のiOSビルド・実機OCRは未検証。
- OCRのネイティブ引数とAndroidの同梱モデルを変更したため、アプリの再ビルドが必要。

## 回帰チェック

```sh
cd native
npm run test:input
npm run typecheck
cd ../web
npm run typecheck
npm run test:engine
npm run test:handwriting
npm run test:handwriting:coverage
npm run bench:handwriting
```

各言語の移植テストはREADMEの手順、中央枠の単体テストは
`native/ime/test/ocr-geometry.swift` と `native/ime/test/OcrGeometryTest.kt` を参照。
