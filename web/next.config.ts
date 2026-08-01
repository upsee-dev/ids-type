import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ストア提出用の静的ページを EAS Hosting へ上げるため、静的書き出しにする。
  // サーバー側の処理は使っておらず（辞書はブラウザが fetch する）、これで問題ない。
  output: "export",
  images: { unoptimized: true },
  turbopack: {
    // 検索エンジン本体を ../core（Expoアプリと共有）から読むため、
    // Turbopackのルートをリポジトリ直下に上げる
    root: path.join(__dirname, ".."),
  },
};

export default nextConfig;
