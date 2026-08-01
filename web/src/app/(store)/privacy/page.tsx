import type { Metadata } from "next";
import { StorePage, Section } from "@/components/StorePage";

export const metadata: Metadata = {
  title: "プライバシーポリシー — カタチ入力",
  description:
    "カタチ入力のプライバシーポリシー。入力内容・利用状況を含め、一切の情報を収集も送信もしません。",
};

export default function Privacy() {
  return (
    <StorePage title="プライバシーポリシー" updated="2026-08-01">
      <Section title="ひとことで言うと">
        <p>
          <b>カタチ入力は、何も集めず、どこにも送りません。</b>
          通信機能そのものを実装していないため、たとえ送ろうとしても送れません。
        </p>
      </Section>

      <Section title="収集する情報">
        <p>ありません。次のいずれも取得・保存・送信しません。</p>
        <ul>
          <li>キーボードで入力した文字、変換履歴、入力先のアプリ名</li>
          <li>氏名・メールアドレス・電話番号などの個人情報</li>
          <li>端末ID、広告ID、位置情報、連絡先、写真</li>
          <li>クラッシュログ、利用状況・アクセス解析</li>
        </ul>
      </Section>

      <Section title="キーボードの「フルアクセス」について">
        <p>
          iOS 版のキーボードは<b>フルアクセスを要求しません</b>
          （<code>RequestsOpenAccess = false</code>）。この設定では、キーボードは
          ネットワークにも共有データにもアクセスできません。Android 版も同様に、
          インターネット権限を要求していません。
        </p>
        <p>
          漢字の検索はすべて端末内で完結します。辞書データはアプリに同梱されており、
          検索のたびに外部へ問い合わせることはありません。
        </p>
      </Section>

      <Section title="第三者への提供・広告">
        <p>
          第三者に提供する情報がありません。広告SDK・解析SDKのたぐいも組み込んでいません。
        </p>
      </Section>

      <Section title="お子様の利用について">
        <p>
          情報を収集しないため、年齢にかかわらず安全にお使いいただけます。
        </p>
      </Section>

      <Section title="本ポリシーの変更">
        <p>
          変更する場合はこのページを更新し、更新日を書き換えます。収集方針を変える場合は、
          アプリの更新時に改めてお知らせします。
        </p>
      </Section>

      <Section title="お問い合わせ">
        <p>
          <a href="/support">サポートページ</a>からご連絡ください。
        </p>
      </Section>
    </StorePage>
  );
}
