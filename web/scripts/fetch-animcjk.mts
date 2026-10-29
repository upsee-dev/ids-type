// source.json に固定した原本から、文字と筆画中心線だけを再取得する。
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { DATA_SRC } from "./build-data/paths.mts";

const dir = join(DATA_SRC, "animcjk");
const manifest = JSON.parse(readFileSync(join(dir, "source.json"), "utf8")) as {
  commit: string;
  files: { source: string; sourceSha256: string; output: string; records: number }[];
};
for (const file of manifest.files) {
  const url = `https://raw.githubusercontent.com/parsimonhi/animCJK/${manifest.commit}/${file.source}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  const raw = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(raw).digest("hex") !== file.sourceSha256) {
    throw new Error(`原本のSHA-256が違います: ${file.source}`);
  }
  const rows = raw.toString("utf8").trim().split("\n").map(line => {
    const { character, medians } = JSON.parse(line);
    return JSON.stringify({ character, medians });
  });
  if (rows.length !== file.records) throw new Error(`字数が違います: ${file.source}`);
  writeFileSync(join(dir, file.output), gzipSync(`${rows.join("\n")}\n`, { level: 9 }));
  console.log(`${file.output}: ${rows.length} records`);
}
