# assets-archive

アプリに同梱しないデザイン素材の置き場。ビルド成果物ではないので、
`native/assets/` や `web/public/` とは分けてここに置いている。

## logo/

| ファイル | 用途 |
|---|---|
| `concept-c-kanji-input-v2.png` | 採用ロゴのマスター（元解像度） |
| `concept-c-kanji-input-v2-1024.png` | 同・1024×1024 書き出し。**`scripts/build-icons.py` の入力はこれ** |

配布用アイコン一式（favicon / iOS / Android アダプティブ / PWA / OGP）は
このマスターから生成する。ロゴを差し替えるときは

```bash
pip install pillow
python3 scripts/build-icons.py
```

を実行すれば `native/assets/`・`web/src/app/`・`web/public/` が一括で更新される。

## ブランド色

ロゴから採った3色。`web/src/app/globals.css` の配色やマニフェストの
`theme_color` もこれに合わせている。

| | HEX | 使いどころ |
|---|---|---|
| インディゴ | `#4437D1` | 主色（ロゴ左半分・アクセント） |
| スカイ | `#34B5FC` | 副色（ロゴ右の縦画） |
| 生成り | `#FBFBF9` | background |

## 不採用案について

検討時のモック（concept-a/b/d、旧 concept-c、コンタクトシート）は
採用案の確定後に削除した。必要になったら生成し直す。

## fonts/

部品パレット用サブセットフォントの元データ。

| ファイル | 用途 |
|---|---|
| `PlangothicP1-Regular.ttf` / `PlangothicP2-Regular.ttf` | Plangothic（SIL OFL 1.1）。拡張A〜Iを収録。**32MBあるので .gitignore 済み** |

「難輸入部件」541件は拡張B〜Hの字が多く、端末の標準フォントに入っていない
（macOS でも117件が □ になる）。パレットは「見て選ぶ」画面なので □ が並ぶと
機能しない。そこでこの2書体からパレットの字だけを切り出して同梱している。

```bash
# 元フォントを取得（初回のみ）
#   https://github.com/Fitzgerald-Porthmouth-Koenigsegg/Plangothic_Project/releases
#   PlangothicP1-Regular.ttf / PlangothicP2-Regular.ttf を assets-archive/fonts/ に置く
pip install fonttools brotli
python3 scripts/build-font-subset.py
# -> web/public/fonts/KatachiParts.woff2 (29KB)
# -> native/assets/fonts/KatachiParts.ttf (67KB)
```

再配布にあたり OFL がライセンス同梱を求めるので、`OFL.txt` を
サブセットと同じディレクトリに置いている。
