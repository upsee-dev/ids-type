import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DEFAULT_SORT, Engine, type Result, type SortMode } from "../../core/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(join(here, "..", "..", "core", "kanji-data.json"), "utf8"));
const e = new Engine(raw);
console.log("engine chars:", e.size);

let fail = 0;
const check = (q: string, expectTop: string[], within = 8, sort: SortMode = "common") => {
  const t0 = Date.now();
  const { results, mode, total } = e.search(q, 200, sort);
  const top = results.slice(0, within).map(r => r.ch);
  const ok = expectTop.every(x => top.includes(x));
  if (!ok) fail++;
  console.log(`${ok ? "OK " : "NG "} [${mode}/${sort}] "${q}" -> ${top.join(" ")}  (${total}件, ${Date.now() - t0}ms)  期待:${expectTop.join(",")}`);
};

/**
 * ページを分けて取っても、続けて取ったのと同じ並びで**全件**たどれること。
 * (候補は1ページぶんずつ描くので、ここがずれると見落とす字が出る)
 */
const checkPages = (q: string, per = 50, sort: SortMode = DEFAULT_SORT) => {
  const whole = e.search(q, per * 3, sort).results.map(r => r.ch);
  const paged = [0, 1, 2].flatMap(p => e.search(q, per, sort, p * per).results.map(r => r.ch));
  const { total } = e.search(q, 1, sort);
  const last = e.search(q, per, sort, Math.max(0, total - 1)); // 最後の1件も取れる
  const ok = whole.join("") === paged.join("") && last.results.length === Math.min(1, total);
  if (!ok) fail++;
  console.log(`${ok ? "OK " : "NG "} [pages] "${q}" 全${total}件 / ${per}件ずつ ${Math.ceil(total / per)}ページ`);
};

/**
 * 「かたちが近い順」は、打った部品のほかに余分な部品が少ない字を先に出す。
 * どの字が何番目に来るかはデータ次第なので、余分の数が減っていかないこと
 * (単調に増えること)＝並びの性質のほうを確かめる。
 */
const checkNear = (q: string, parts: string[]) => {
  const asked = parts.reduce((n, p) => n + e.leafCount(p), 0);
  const { results } = e.search(q, 30, "near");
  const extras = results.map(r => Math.max(0, e.leafCount(r.ch) - asked));
  const ok = extras.every((x, i) => i === 0 || extras[i - 1] <= x);
  if (!ok) fail++;
  console.log(`${ok ? "OK " : "NG "} [near] "${q}" -> ${results.slice(0, 10).map(r => r.ch).join(" ")}  余分:${extras.slice(0, 10).join(",")}`);
};

/**
 * 既定の「符号位置順」の性質。
 *   1. 打ったものと完全一致する字が**先頭**
 *   2. そのあとは 完全一致 → 日本の漢字 → 拡張漢字 の段で、段の中は符号位置順
 * (段を分けるのは、拡張A(U+3400〜)が統合漢字(U+4E00〜)より前だから。
 *  分けないと木を打っただけで 林 の前に見たこともない字が数百字並ぶ)
 */
const rank = (r: Result) => (r.exact ? 0 : 2) + (r.meta.ext ? 1 : 0);
const checkUnicode = (q: string, expectFirst: string) => {
  const { results, total } = e.search(q, 500, "unicode");
  const first = results[0]?.ch ?? "";
  const sorted = results.every((r, i) => {
    if (i === 0) return true;
    const prev = results[i - 1];
    if (rank(prev) !== rank(r)) return rank(prev) < rank(r);
    return prev.ch.codePointAt(0)! < r.ch.codePointAt(0)!;
  });
  const ok = first === expectFirst && sorted;
  if (!ok) fail++;
  console.log(
    `${ok ? "OK " : "NG "} [unicode] "${q}" -> ${results.slice(0, 10).map(r => r.ch).join(" ")}` +
      `  (${total}件, 先頭:${first}${sorted ? "" : " / 符号位置順が崩れている"})  期待:${expectFirst}`,
  );
};

checkUnicode("LR日月", "明"); // 組んだかたちそのままの字が先頭
checkUnicode("日月", "明");
checkUnicode("木", "木"); // 部品そのものの字も「完全一致」＝先頭
checkUnicode("宀女", "安");
checkUnicode("OC囗玉", "国");
check("木", ["木"], 1, "unicode");
check("LR木木", ["林"], 1, "unicode");
check("木木", ["林"], 1, "unicode"); // 操作子なしでも「木2つでできた字」は完全一致
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
check("LR日月", ["明"], 1, "near"); // 近い順でも、余分ゼロで最短の 明 が先頭
checkNear("LR日月", ["日", "月"]);
checkNear("OC囗玉", ["囗", "玉"]);
checkNear("日月", ["日", "月"]);
checkPages("日月");
checkPages("LR木?");
checkPages("宀女");
checkPages("日月", 50, "common");
checkPages("宀女", 50, "near");
console.log("decompose 課:", e.decompose("課"));
console.log("decompose 樹:", e.decompose("樹"));
console.log(fail ? `FAILED: ${fail}` : "ALL PASS");
process.exit(fail ? 1 : 0);
