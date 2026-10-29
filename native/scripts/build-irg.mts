// ローカルのIRG資料とUnihanからアプリ専用の一覧を生成する。ネットワーク取得はしない。
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { IRG_WORKING_SETS } from "../src/irgWorkingSets.ts";
import { buildIrgEntries, unihanSourceIndex } from "./lib/irg.mts";

const sourceDir = new URL("../../data-src/", import.meta.url);
const destDir = new URL("../assets/irg/", import.meta.url);
const unihan = execFileSync("unzip", ["-p", fileURLToPath(new URL("unihan/Unihan.zip", sourceDir)), "Unihan_IRGSources.txt"], {
  encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
});
const index = unihanSourceIndex(unihan);
mkdirSync(destDir, { recursive: true });
for (const ws of IRG_WORKING_SETS) {
  const entries = buildIrgEntries(readFileSync(new URL(`irg/${ws}.jsonl`, sourceDir), "utf8"), index);
  writeFileSync(new URL(`${ws}.json`, destDir), JSON.stringify(entries) + "\n");
  console.log(`${ws}: ${entries.length}提案 / Unicode対応 ${entries.filter(entry => entry.chars.length).length}提案`);
}
