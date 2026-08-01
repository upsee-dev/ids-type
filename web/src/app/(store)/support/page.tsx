import type { Metadata } from "next";
import { StorePage, Section } from "@/components/StorePage";

export const metadata: Metadata = {
  title: "サポート — カタチ入力",
  description: "カタチ入力の使い方・よくある質問・お問い合わせ先。",
};

export default function Support() {
  return (
    <StorePage title="サポート" updated="2026-08-01">
      <Section title="使い方">
        <p>
          「かたち（位置関係）」を選び、続けて「部品」を選ぶと候補が出ます。
          たとえば <b>左右</b> → <b>日</b> → <b>月</b> で <b>明</b>。
          読みが分からない漢字を、形だけで引けます。
        </p>
        <ul>
          <li><b>かたち</b>タブ … 左右・上下・全かこみ など17種</li>
          <li><b>よく使う部品</b>タブ … 木・氵・艹・口・金 など出現頻度順</li>
          <li><b>部首・偏旁</b>タブ … かなキーボードでは打てない部品を画数別に</li>
          <li><b>あ</b>ボタン … 端末のキーボードに切り替え</li>
        </ul>
      </Section>

      <Section title="システムキーボードとして使う">
        <ul>
          <li>
            <b>iOS</b>: 設定 → 一般 → キーボード → キーボード → 新しいキーボードを追加
            →「カタチ入力」。フルアクセスは不要です
          </li>
          <li>
            <b>Android</b>: 設定 → 言語と入力 → 画面キーボード → キーボードを管理
            →「カタチ入力」をオン
          </li>
        </ul>
      </Section>

      <Section title="よくある質問">
        <p><b>候補が □ で表示されます</b></p>
        <p>
          拡張漢字（10万字のうち約9万字）は、端末に対応フォントが無いと □ になります。
          データとしては正しく入っているので、コピーして貼り付ければ正しい字が入ります。
        </p>
        <p><b>入力した内容はどこかに送られますか</b></p>
        <p>
          送られません。通信機能自体を実装していません。詳しくは
          <a href="/privacy">プライバシーポリシー</a>をご覧ください。
        </p>
        <p><b>探している漢字が出てきません</b></p>
        <p>
          部品を減らすか、分からない部分を <b>?</b>（なんでも）に置き換えてみてください。
          部品の形が辞書と少し違う場合もあるので、より単純な部品で試すのも有効です。
        </p>
      </Section>

      <Section title="お問い合わせ">
        <p>
          ご意見・不具合のご報告は <a href="mailto:upsee.haruki@gmail.com">upsee.haruki@gmail.com</a> までお願いします。
          返信までに数日いただくことがあります。
        </p>
      </Section>
    </StorePage>
  );
}
