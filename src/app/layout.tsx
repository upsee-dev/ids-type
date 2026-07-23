import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "カタチ入力 — 読めない漢字を、見たまま打てる",
  description:
    "IDS(空間関係)コードと部品の組み合わせで、読みが分からない漢字を入力できる日本語向けキーボードのWebプロトタイプ",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // ノッチ端末で画面下端まで使う(下段のキーボードを底に貼り付けるため)
  viewportFit: "cover",
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
