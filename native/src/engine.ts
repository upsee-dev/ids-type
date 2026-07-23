// 検索エンジンと辞書の実体は リポジトリ直下の core/（Next.js版と共有）。
// src/core/ は scripts/sync-core.mjs が複製した生成物（.gitignore 済み）。
// 巨大JSONを import すると tsc が型推論で固まるので require + キャストで扱う。
import type { RawData } from "./core/engine";

export * from "./core/engine";

export const rawData = require("./core/kanji-data.json") as RawData;
