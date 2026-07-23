import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Engine } from "../../core/engine.ts";

const here = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(join(here, "..", "..", "core", "kanji-data.json"), "utf8"));
const e = new Engine(raw);
console.log("engine chars:", e.size);

let fail = 0;
const check = (q: string, expectTop: string[], within = 8) => {
  const t0 = Date.now();
  const { results, mode } = e.search(q);
  const top = results.slice(0, within).map(r => r.ch);
  const ok = expectTop.every(x => top.includes(x));
  if (!ok) fail++;
  console.log(`${ok ? "OK " : "NG "} [${mode}] "${q}" -> ${top.join(" ")}  (${results.length}件, ${Date.now() - t0}ms)  期待:${expectTop.join(",")}`);
};

check("LR日月", ["明"]);
check("UD宀子", ["字"]);
check("OC囗玉", ["国"]);
check("RU辶刀", ["辺"]);
check("LR言果", ["課"]);
check("UD艹果", ["菓"]);
check("日月", ["明"]);
check("LR木?", ["村"], 20);
check("LR氵?", ["海"], 30);
check("LR彳圭", ["街"], 10); // ⿲彳圭亍 の正規化(⿰彳⿰圭亍)で前方一致
check("宀女", ["安"], 10);
check("LR扌旦", ["担"], 5);
check("lr日月", ["明"]); // 小文字コード
console.log("decompose 課:", e.decompose("課"));
console.log("decompose 樹:", e.decompose("樹"));
console.log(fail ? `FAILED: ${fail}` : "ALL PASS");
process.exit(fail ? 1 : 0);
