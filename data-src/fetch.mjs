// 元データを sources.json のとおりに取り直す。
//
//   node data-src/fetch.mjs            # 未取得のものだけ
//   node data-src/fetch.mjs --force    # 全部取り直す
//
// 取得後は web で `npm run build:data` を回して辞書を作り直すこと。
// 上流が更新されると収録字数が変わるので、ビルドの検証ログ(ブロックごとの収録数)を必ず見る。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const { sources } = JSON.parse(readFileSync(join(here, "sources.json"), "utf8"));
const force = process.argv.includes("--force");
const NL = Buffer.from("\n"); // 連結時の区切り(上流の最終行に改行が無いことがある)

let fetched = 0;
let skipped = 0;
for (const s of sources) {
  const dest = join(here, s.file);
  if (!force && existsSync(dest)) {
    console.log(`skip  ${s.file}  (すでにある)`);
    skipped++;
    continue;
  }
  // urls(配列) のソースは上流が複数ファイルに分かれているもの。
  // ソース単位で1ファイルにしたいので連結して保存する
  const urls = s.urls ?? [s.url];
  process.stdout.write(
    `get   ${s.file}  <- ${urls.length > 1 ? `${urls.length} files` : urls[0]} ... `,
  );
  const parts = [];
  let failed = false;
  for (const url of urls) {
    const res = await fetch(url, { headers: { "User-Agent": "katachi-ime/1.0" } });
    if (!res.ok) {
      console.log(`失敗 ${res.status} (${url})`);
      process.exitCode = 1;
      failed = true;
      break;
    }
    parts.push(Buffer.from(await res.arrayBuffer()));
  }
  if (failed) continue;
  const buf = parts.length > 1 ? Buffer.concat(parts.flatMap((b) => [b, NL])) : parts[0];
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, buf);
  console.log(`${(buf.length / 1024).toFixed(0)} KB`);
  fetched++;
}
console.log(`\n取得 ${fetched} 件 / スキップ ${skipped} 件`);
if (skipped && !force) console.log("取り直すときは --force");
