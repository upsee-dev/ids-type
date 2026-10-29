# 日本語拡張フリックの辞書

このディレクトリは再生成用の原資料です。アプリの入力内容を外部に送信しません。

- `mozc.tsv.gz`、`mozc-id.def`、`mozc-symbol.tsv`: Mozc の固定コミット
  `e5f1494923a0a624d01f19c50d57bbdfa03ea5ba` から抽出。
  https://github.com/google/mozc
  `MOZC-LICENSE.txt` と `MOZC-DICTIONARY-README.txt` に Google / NAIST / ICOT /
  沖縄辞書のライセンスを保存しています。Google日本語入力の辞書ではありません。
- `JMdict_e.gz`: EDRDG JMdict。漢字を含む語彙全体から、検索できるかなの読みと表記を取り込みます。
  `gikun`（熟字訓・義訓）と明記された読みだけに熟字訓分類を付け、
  `re_restr`・`re_nokanji`・`stagk`・`stagr`を尊重します。
  低頻度の二字熟語・四字熟語や表記揺れも頻度による足切りをせず含めます。
  Mozcにない一般の追加語は「その他の漢字」に分類し、一般語の既存コストは維持します。
  https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project
- `JMnedict.xml.gz`: EDRDG JMnedict。姓・名・人名・地名・駅名の分類を使用。
  https://www.edrdg.org/enamdict/enamdict_doc.html
- KANJIDIC2 の原本は `../kanjidic2/kanjidic2.xml.gz`。音訓と名乗りを件数制限せず
  取り込み、語義の `kokuji` を国字分類に使用します。学年9/10または名乗りは人名用字の
  検索分類に含めます。この分類は命名に関する法的判断を提供するものではありません。
- `supplement.json`: 文献名・掲載位置・URLを持つ手動補足。
  **独立した2文献以上で確認できた読みだけを採用**します。同じ文献の転載・別URLは
  1文献と数えます。「乒乓」は「ぴんぽん」を主な読みとして採用し、作家本人の
  インタビューと学術論文の表記対応を記録しています。中国語音から生成した読みではありません。
  「よろよろ」「よろめく」は別文献の直接確認が足りないため`pending`として保管し、
  変換辞書には収録しません。誤読と断定するものではありません。
- `nature-categories.json`: 植物・鉱物・動物・鳥類・虫類・魚類・藻類の検索分類。
  JMdictの`bot`・`min`・`zool`・`ornith`・`ent`分野タグと、語義の自然物名を使用します。
  `fish`タグは「釣り」のため、そのまま魚類には対応させません。
  分類の根拠となった項目番号・語義番号・元の語義は`nature-audit.jsonl`に記録。
  同じ読みでも「桜」と「偽客」のように語義の違う表記は区別します。
- 外国語の読みは `foreign-sources.json` に原資料・固定コミット・SHA-256を記録。
  韓国語はUnihan `kHangul`、中国語（普通話）は `kMandarin` の中国本土側の値、
  ベトナム語は `kVietnamese` を使用します。
- 台湾語（閩南語）はChhoeTaigi資料庫の **iTaigi華台對照典（CC0）だけ** を使用。
  `itaigi.csv`の`KipUnicode`と`HanLoTaibunKip`を組にし、漢字表記のない項目や
  転写できない音節を除きます。他の辞書の内容は取り込みません。
  https://github.com/ChhoeTaigi/ChhoeTaigiDatabase
  `ITAIGI-README.md`は取得時の出典・ライセンス説明です。

EDRDG資料の著作権は Jim Breen および Electronic Dictionary Research and Development
Group に帰属します。抽出・分類した派生辞書は CC BY-SA 4.0 で配布し、他の原資料の
通知も保持します。アプリの「設定 → 日本語辞書・部首索引の出典とライセンス」に掲載。

https://www.edrdg.org/edrdg/licence.html
https://creativecommons.org/licenses/by-sa/4.0/

## 再生成

```sh
python3 scripts/build-japanese.py
cd native && npm run test:japanese
```

`sources.json` のSHA-256を検証してから生成します。元データの更新時は上記の公式配布先
から取得し、取得日・版・SHA-256も更新してください。`coverage.json` は生成時の件数です。
同じ読み・表記をまとめ、分類はビット集合として併記します。頻度順位による足切りはありません。

出力は `native/ime/assets/japanese-*.tsv` です。アプリ本体も共有ネイティブモジュール経由で
同じTSVを非同期に読み込みます。iOSでは同梱した日本語キーボード拡張のリソースを参照し、
Androidではアプリのassetsを参照します。辞書全体をJavaScriptバンドルに含めません。
TSV列は `ひらがなの読み / 表記 / 分類と読み属性のビット集合 / 辞書コスト`。
分類はビット0〜14、訓読み属性は`1 << 24`です。属性ビットは設定の分類として表示しません。
KANJIDIC2の完全な訓読みで、送り仮名付き表記と単漢字の両方を選べます。
4文字以上の訓読み・熟字訓が完全一致した場合だけ分類順より優先し、途中一致や語幹には
同じ優先を流用しません。
外国語の行はさらに `言語ID / 原語の読み` の2列を持ちます。言語IDは
`ko / zh / vi / tw`。日本語の行とは統合せず、4言語すべて初期オフで、明示的に
有効にした言語だけ検索候補へ加えます。オフへ戻すと同じ読みの検索にも即時反映。
同じ表記が日本語の読みでも該当する場合は、日本語の候補として残ります。
カナ転写は検索用の発音の目安で、声調などは省略します。日本語の読みを推定する用途には使いません。
原語の読みも候補に表示します。`scripts/build-foreign-readings.mts`が`foreign.tsv`を生成し、
`scripts/build-japanese.py`が同じ先頭かなの分割ファイルへ収録します。
`coverage.json`の`entries`は日本語、`foreignEntries`は追加の外国語の件数です。
ビットの順は `core/japanese.ts` の `JAPANESE_CATEGORIES` に一致します。
Mozcの読み・表記・分類・単語コストを使用していますが、Mozcの文法・接続コストを
使う変換エンジンそのものを移植したわけではありません。

先頭のかなでファイルを分割し、ネイティブ拡張は現在の1ファイルだけを読みます。
全候補を順位付けした後にページ表示するため、表示ページの後ろに低頻度語が残ります。
熟字訓・義訓の分類は資料の明示タグと出典付き補足の範囲であり、全熟字訓の網羅を意味しません。
欠画連綿詞の手動補足は現在「乒乓／ぴんぽん」の1組を採用し、2組を確認待ちとして保持しています。
補足の採用数・保留数は`coverage.json`の`manualReadings` / `pendingManualReadings`に記録します。
この複数文献の確認規則は手動補足に適用します。Mozc・JMdictなどの原辞書からの取り込み規則は従来どおりです。

自然分野の分類でも、読みや表記を語義から創作しません。JMdictにある読み・表記を取り込み、
`re_restr`・`re_nokanji`・`stagk`・`stagr`による制限を尊重します。
カナだけで書く読みには、そのカナ表記を用意します。
分類は語義ベースの検索用で、分類学上の網羅的な生物種・鉱物目録ではありません。
分野タグに基づく関連用語も含みます。動物は鳥類・虫類・魚類以外、藻類は植物と別に扱います。
虫類は通称としての虫（昆虫・クモ・ムカデ・ミミズなど）を含みます。

部首索引は `../unihan/Unihan.zip` の **全 `kRSUnicode` 値**から作ります。
複数所属を保持し、部首の簡体字等の派生形は元の部首番号にまとめます。負の残り画数も
別条件として保持します。総画数から部首画数を引く推定はしません。
U+3261E は `31.1` と `5.1` の両方に出ます。

https://www.unicode.org/reports/tr38/

## 漢検一級までの語彙拡充と照合範囲

漢検の公式審査基準は一級を「約6000字、JIS第一・第二水準を目安」としています。
これを確認の基準にし、`kanken-coverage.json`に常用漢字2,136字とJIS X 0208の
第一水準2,965字・第二水準3,390字の収録状況を出力します。単漢字検索と、外国語を
有効にしない日本語フリックの単漢字候補の両方を照合します。二つの集合は重複します。

https://www.kanken.or.jp/kanken/grades/overview/

一級・準一級の公式の配当漢字表は書籍『漢検要覧 1／準1級対応』に案内されており、
この実装は級別配当を推定して付けるものではありません。熟語の公式全出題語を保証する
ものでもありません。語彙と読みの出典はJMdict / KANJIDIC2です。

https://faq-kanken.dga.jp/dantai-sprt/faq_detail.html?id=1010040&page=1

`jmdictLexicalPairs`は新たに取り込み対象にした漢字語彙のユニークな読み・表記数です。
`jmdictNewPairs`と`fullKunCharacterPairsAdded`は各処理段階の追加数なので、後段のJMnedict
等との重複があり、合計して最終辞書の増分にはできません。`fourKanjiSpellingPairs`は
漢字4文字の表記の組数であり、すべてを意味上の四字熟語と断定する数ではありません。
