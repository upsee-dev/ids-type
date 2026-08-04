import type { Metadata } from "next";
import { StorePage, Section } from "@/components/StorePage";

export const metadata: Metadata = {
  title: "アカウント削除 — 漢字カタチ入力",
  description:
    "漢字カタチ入力にはアカウント機能がありません。削除すべきデータは存在せず、アプリを削除すれば端末上のデータも残りません。",
};

export default function AccountDeletion() {
  return (
    <StorePage title="アカウントとデータの削除" updated="2026-08-01">
      <Section title="漢字カタチ入力にアカウントはありません">
        <p>
          ログイン機能がないため、<b>作成されるアカウントがありません</b>。
          サーバー上にお客様のデータを保持していないため、削除を依頼していただく先もありません。
        </p>
      </Section>

      <Section title="端末に残るもの">
        <p>
          アプリが端末に持つのは、同梱の漢字辞書とアプリ本体だけです。入力した文字や
          変換履歴は保存していません。アプリをアンインストールすれば、これらも端末から消えます。
        </p>
        <ul>
          <li>
            <b>iOS</b>: ホーム画面でアイコンを長押し →「Appを削除」。あわせて
            設定 → 一般 → キーボード → キーボード から「漢字カタチ入力」を削除できます
          </li>
          <li>
            <b>Android</b>: 設定 → アプリ →「漢字カタチ入力」→ アンインストール。あわせて
            設定 → 言語と入力 → 画面キーボード から無効にできます
          </li>
        </ul>
      </Section>

      <Section title="それでも削除を依頼したい場合">
        <p>
          念のための窓口として<a href="/support">サポートページ</a>を用意しています。
          ご連絡いただければ、保持しているデータが無いことをご説明します。
        </p>
      </Section>
    </StorePage>
  );
}
