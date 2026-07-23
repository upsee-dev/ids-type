import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // 検索エンジン本体を ../core（Expoアプリと共有）から読むため、
    // Turbopackのルートをリポジトリ直下に上げる
    root: path.join(__dirname, ".."),
  },
};

export default nextConfig;
