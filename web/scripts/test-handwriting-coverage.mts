// 追加した拡張漢字を、元の筆画中心線から実際に引けることを確認する。
// 収録・照合の回帰テストであり、実際の書き手に対する精度評価ではない。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { HandwritingIndex, type HandwritingData } from "../../core/handwriting.ts";
import { DATA_SRC, ROOT } from "./build-data/paths.mts";

const data: HandwritingData = JSON.parse(readFileSync(join(ROOT, "core", "handwriting-data.json"), "utf8"));
const index = new HandwritingIndex(data);
assert.ok(index.size >= 10000);
const expected = new Set(["𠮷", "𱍸", "𬶀", "𫠤", "𰀢"]);
const checked = new Set<string>();
for (const language of ["Ja", "ZhHant", "ZhHans"]) {
  const input = gunzipSync(readFileSync(join(DATA_SRC, "animcjk", `medians${language}.jsonl.gz`))).toString("utf8");
  for (const line of input.trim().split("\n")) {
    const { character: ch, medians } = JSON.parse(line) as { character: string; medians: [number, number][][] };
    if (!expected.has(ch) || checked.has(ch)) continue;
    for (const slant of [0, 0.06]) {
      const drawn = medians.map(s => s.map(([x, y]) => [x + slant * y, (900 - y) * 0.95] as const));
      const hits = index.match(drawn, 10);
      assert.ok(hits.some(h => h.ch === ch), `${ch} が上位10件に無い: ${hits.map(h => h.ch).join("")}`);
    }
    checked.add(ch);
  }
}
assert.equal(checked.size, expected.size);
console.log(`PASS: ${index.size} patterns; supplementary characters ${[...checked].join(" ")} survive stroke matching`);
