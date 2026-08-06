import type { Metadata } from "next";
import { StorePage, Section } from "@/components/StorePage";

export const metadata: Metadata = {
  title: "漢字カタチ入力について",
  description:
    "読めない漢字を、見たまま打てる。Unicodeの全CJK漢字102,998字を、形から引ける日本語キーボード。",
};

export default function About() {
  return (
    <StorePage title="漢字カタチ入力について">
      <Section title="読めない漢字を、見たまま打てる">
        <p>
          読みが分からない漢字は、普通のかなキーボードでは打てません。漢字カタチ入力は
          「どんな形か」だけで漢字を引けるキーボードです。
        </p>
        <p className="kanji text-base">
          左右＋日＋月 → 明　／　上下＋宀＋子 → 字　／　全かこみ＋囗＋玉 → 国
        </p>
      </Section>

      <Section title="Unicodeの全CJK漢字 102,998字">
        <p>
          基本（URO）から拡張A〜J、互換漢字まで、Unicodeが定義するCJK漢字を
          <b>全ブロック100%</b>収録しています。人名・地名・古典・学術で出てくる
          珍しい字も、形さえ分かれば引けます。
        </p>
        <p>
          そのうち99.88%に分解データが付いています。日本語入力として使いやすいよう、
          常用漢字などKANJIDIC2収録の13,108字が常に先に出ます。
        </p>
      </Section>

      <Section title="端末の外に出しません">
        <p>
          検索はすべて端末内で完結します。通信機能を実装していないので、入力内容が
          外に出ることはありません。iOSのキーボードは「フルアクセス」をお願いしますが、
          これはアプリで調べた字の履歴をキーボードからも見えるようにするためだけのもので、
          許可しても通信は一切行いません。
        </p>
      </Section>

      <Section title="こんな方に">
        <ul>
          <li>戸籍・登記・医療など、正確な字を扱う実務の方</li>
          <li>古典・漢籍・碑文を読む研究者、学生の方</li>
          <li>珍しい姓・地名を正しく入力したい方</li>
          <li>手書き検索でうまく出てこず困っている方</li>
        </ul>
      </Section>

      <Section title="データ出典">
        <p>
          分解データ: BabelStone IDS / CHISE IDS Database / CJKVI IDS Database。
          漢字情報: KANJIDIC2（EDRDG、CC BY-SA 4.0）。
          部品パレットのフォント: Plangothic（SIL OFL 1.1）。
        </p>
      </Section>
    </StorePage>
  );
}
