# 手書きの追加筆画

AnimCJK (Copyright 2016–2026 FM&SH) の `graphicsJa.txt`、`graphicsZhHant.txt`、
`graphicsZhHans.txt` から、文字と筆画中心線 (medians) だけを抽出したスナップショット。
輪郭を削除して gzip 圧縮したもの。出典の固定コミットと原本SHA-256は `source.json`。
日本語→繁体字→簡体字の順で、KanjiVG にない文字だけを補う。
中国語の字形・筆順が含まれるため、日本語の既存パターンは上書きしない。

配布条件は Arphic Public License。`COPYING.txt` に元プロジェクトの著作権表示、
`ARPHIC-PUBLIC-LICENSE.txt` にライセンス全文を添付する。
本アプリの変更は中心線の抽出・座標の反転・正規化・量子化。

再取得: `cd web && node --experimental-strip-types scripts/fetch-animcjk.mts`
生成: `cd web && npm run build:handwriting`
