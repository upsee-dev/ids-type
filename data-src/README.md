# data-src — 辞書の元データ

`core/kanji-data.json` を作るための入力。ここのファイルは**加工しない**（上流のまま置く）。
加工はすべて `web/scripts/build-data.mts` 側でやる。

```
data-src/
├── sources.json        # 出典・URL・版・ライセンス（fetch.mjs が読む）
├── fetch.mjs           # 上の定義どおりに取り直す
├── ids/                # 分解データ（IDS）。1ソース1ファイル
│   ├── babelstone.txt      土台。Unicode 16.0 の全97,680字
│   ├── chise.txt           穴埋め。拡張Jの唯一の供給源
│   └── cjkvi.txt           KANJIDIC2収録字の日本字体
└── kanjidic2/
    ├── kanjidic2.xml.gz    読み・学年・頻度
    └── kanjidic2.xml       展開済み（15MB・.gitignore 済み）
```

## 取り直す

```bash
node data-src/fetch.mjs           # 無いものだけ
node data-src/fetch.mjs --force   # 全部
cd web && npm run build:data      # 辞書を作り直す
```

## 3つのIDS表を重ねている理由

1字につき1つの分解を選ぶ。優先順位は `web/scripts/build-data/merge.mts` にある。

| | 役割 | なぜ必要か |
|---|---|---|
| **BabelStone** | 土台 | 全97,680字を1ファイルで持ち、字源タグ(G/H/T/**J**/K/P/V)で日本字体を選べる |
| **CHISE** | 穴埋め | BabelStone は Unicode 16.0 準拠で**拡張J 4,298字を1字も持たない**。加えて拡張C/Eの末尾18字など、他の表に分解が無い20字も埋まる |
| **CJKVI** | KANJIDIC2収録字 | 従来の検索結果を変えないため、日本の漢字だけこの表の `[J]` を最優先する |

BabelStone は帰属不要・CHISE と CJKVI は GPLv2。GPLを避けたい配布形態では
`IDS_SOURCE=babelstone` でビルドすると BabelStone だけになる
（そのぶん拡張Jの分解が落ち、4,298字が構造検索に出なくなる）。

### なぜ CHISE だけ連結して置いているのか

CHISE の上流はブロックごとに18ファイルに分かれている。ここでは**「1ソース1ファイル」に
揃えたい**ので、`fetch.mjs` が全部つないで `chise.txt` 1本にして保存している
（各ファイル先頭の `;;` ヘッダも残るので由来は追える）。ブロック別に分けたままだと
BabelStone/CJKVI が1ファイルなのと不揃いになり、「なぜ拡張G〜Jだけ在るのか」が
分からなくなる。

ライセンスの詳細は `sources.json` と、リポジトリ直下 `README.md` の「データ出典・ライセンス」を参照。
