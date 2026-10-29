# IRG一覧・読み表示改善のOTA配信

- 公開日時: 2026-10-29 13:51 JST
- コードコミット: `f6da4c4fb14ae2cbb28993e0d37870f045f5097b`
- Gitブランチ: `feat/system-ime-and-full-cjk-coverage`（originへプッシュ済み）
- EASプロジェクト: `@upsee/ids-kanji-type` / `f16a9cca-5309-499e-8324-c46580f7942e`
- チャンネル・ブランチ・環境: `production`
- runtimeVersion: `1.0.11` / iOS・Android
- 更新グループ: `771a582f-23bb-46e1-a611-9bce754295a5`
- [EAS配信記録](https://expo.dev/accounts/upsee/projects/ids-kanji-type/updates/771a582f-23bb-46e1-a611-9bce754295a5)

## 配信した内容

- アプリ専用のIRG一覧。WS2015/2017/2021/2024、計20,212提案。字源照合でUnicode対応を確認した文字の出力、IDSの入力、審査資料へのリンク。
- 和製漢字の辞典の解説で確認した9字15読みを追加。項目・文字・引用をビルド時に照合する。
- 読みがない字の「読み：不詳」表示。既知の人名読みがある字に不詳を併記しない。
- アプリの読みの2行制限を撤廃。詳細本文をスクロールし、字を選び直すと先頭に戻す。

## 検証

- 今回の変更だけを適用したクリーンなチェックアウトで、WebとNativeの型チェックに成功。
- `native`: `npm run test:irg` 6件成功。
- `web`: `npm run test:wasei` 7件成功、`npm run test:engine` ALL PASS。
- iOS・AndroidのExpo exportが成功。同じ出力をEAS Updateへアップロード。
- production / runtime 1.0.11から返るマニフェストが、両OSとも今回の更新IDでHTTP 200。
- 配信バンドルはHTTP 200、SHA-256がマニフェストとローカルのexportファイルの両方に一致。

| OS | 更新ID | バンドルサイズ | SHA-256 |
| --- | --- | ---: | --- |
| android | `01a185ff-ee8a-7167-a957-1e99655a387d` | 12,257,758 bytes | `f46713379b048d1aa2b6f26add9d786825bc6c42f7dd51c21594242a0f457fcb` |
| ios | `01a185ff-ee8a-77fe-aa20-458628dacb81` | 12,252,518 bytes | `f717310eadd9a20d596b923a9c5507e421d065f1b80056e859d3d69036e459b8` |

## 適用範囲と残る確認

- 対象はproductionチャンネルを持つruntime 1.0.11のアプリ。異なるruntimeのアプリへは配信されない。
- 実機上でOTAの適用・表示・操作は未確認。ダウンロード済み更新は通常、次回起動時に適用される。
- ネイティブコード・依存関係・同梱フォントは既存HEAD `a4058ea` と同一。今回のOTAは新しいネイティブAPIに依存しない。
- IME用TSVの更新はコミットに含むが、既存のAndroid IME・iOSキーボード拡張に焼き込まれた辞書はOTAでは置き換わらず、新規ネイティブビルドが必要。
- 作業前からの手書き・カメラ・入力編集・起動メニュー等の未コミット変更は今回の配信には含めず、元の作業ツリーに保持。
- Webの本番デプロイ、mainへのマージ、ストア向け新規ビルド・提出は実行していない。
