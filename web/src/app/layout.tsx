import type { Metadata, Viewport } from "next";
import "./globals.css";

const TITLE = "漢字カタチ入力 — 読めない漢字を、見たまま打てる";
const DESCRIPTION =
  "IDS(空間関係)コードと部品の組み合わせで、読みが分からない漢字を入力できる日本語向けキーボード。Unicode の CJK 統合漢字 102,998 字を収録。";

// OGP の画像URLは絶対パスでないとクローラが読めないので metadataBase が要る。
// 優先順に: 明示指定 → Vercel の本番ドメイン → ローカル。
// 実在しない仮ドメインを既定にすると、気づかないまま壊れたOGPを配ることになるので置かない。
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: "漢字カタチ入力",
  // favicon.ico / icon.png / apple-icon.png / opengraph-image.png は
  // app/ 直下のファイル規約で自動的に <head> に入る(手書きしない)
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "漢字カタチ入力",
    statusBarStyle: "default",
  },
  openGraph: {
    type: "website",
    locale: "ja_JP",
    siteName: "漢字カタチ入力",
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // ノッチ端末で画面下端まで使う(下段のキーボードを底に貼り付けるため)
  viewportFit: "cover",
  // OSキーボードが出たらレイアウトごと縮める(Android Chrome)。これが無いと
  // キーボードが画面に覆い被さり、下段の入力欄が隠れて打っている文字が見えない。
  // iOS Safari は未対応なので page.tsx 側で visualViewport を見て同じことをする
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FBFBF9" },
    { media: "(prefers-color-scheme: dark)", color: "#0C0A09" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="h-full overflow-hidden">{children}</body>
    </html>
  );
}
