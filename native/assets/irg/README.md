# アプリ専用 IRG ワーキングセット一覧

`data-src/irg/ws2015.jsonl`・`ws2017.jsonl`・`ws2021.jsonl`・`ws2024.jsonl` の
取得済み審査資料を、提案番号・IDS・字源記号に絞った同梱スナップショット。
審査状況のリアルタイム更新ではない。提案ごとの最新資料は一覧の ↗ から開く。

出典: [IRG審査ツール](https://hc.jsecs.org/irg/ws2024/app/)（Henry Chan 氏）。
Unicode文字との対応は `data-src/unihan/Unihan.zip` の `Unihan_IRGSources.txt`
（Unicode 18.0.0、[Unicode License v3](https://www.unicode.org/license.txt)）の字源記号を突き合わせる。
提案資料内の私用領域の符号位置、関連字、統合先の推測は文字対応に使わない。
「Unicode対応なし」は同梱Unihanに一致する字源がない意味で、未符号化・保留・取り下げ等の審査結果を断定しない。

再生成: `cd native && npm run build:irg`。検証: `npm run test:irg`。
JSONはMetroに同梱するため追跡し、元データ更新時に再生成する。
Web・Android IME・iOSキーボード拡張にはこの一覧を追加しない。
