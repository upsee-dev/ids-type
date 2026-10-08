import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  AGE_STEP,
  ageKey,
  ageOf,
  DEFAULT_SORT,
  Engine,
  STROKE_MAX,
  type Result,
  type SortMode,
} from "../../core/index.ts";

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
/**
 * 読み。10万字ぜんぶが読みを持つようになったので(build-data/readings.mts)、
 *   1. 並びが **段(常用・人名用 → KANJIDIC2の残り → 拡張漢字) → 段内はUnicodeの
 *      追加版順** になっていること
 *   2. KANJIDIC2 に無い字も読みで引けること
 * を見る。段が無いと URO だけで20,992字あるせいで つち→凷、ぎょう→丩 が先頭に
 * 来て常用漢字が埋もれる(符号位置と「よく使う字か」は無関係なので)。
 */
const readingTier = (m: { grade: number; ext: boolean }) =>
  m.grade ? 0 : m.ext ? 2 : 1;
const checkReading = (q: string, expect: string, note: string) => {
  const { items, total } = e.list({ query: q, limit: 12 });
  const all = e.list({ query: q, limit: Number.MAX_SAFE_INTEGER }).items;
  const key = (i: (typeof all)[number]) =>
    readingTier(i.meta) * AGE_STEP + ageKey(i.ch);
  const sorted = all.every((x, i) => i === 0 || key(all[i - 1]) <= key(x));
  const ok = sorted && all.some(i => i.ch === expect);
  if (!ok) fail++;
  console.log(
    `${ok ? "OK " : "NG "} [reading] "${q}" -> ${items.map(i => i.ch).join(" ")}` +
      `  (${total}件・${note})  ${expect}(${ageOf(expect)})を含む:${all.some(i => i.ch === expect)}` +
      (sorted ? "" : " / 段と版順が崩れている"),
  );
};
checkReading("つち", "土", "常用漢字が先・段内は版順");
checkReading("あきら", "朗", "人名読みでも引ける");
checkReading("いずくんぞ", "烏", "資料にしか無い読みでも引ける");
checkReading("ぎょう", "行", "拡張漢字は後ろの段");

/**
 * 画数での絞り込み。画数は Unihan の kTotalStrokes で**10万字ぜんぶ**にあるので、
 * KANJIDIC2 に無い拡張漢字も絞れる。読みと重ねて使う(「こう」で674字→数十字)。
 */
const checkStrokes = (q: string, n: number) => {
  const all = e.list({ query: q, limit: 1 }).total;
  const { items, total } = e.list({ query: q, strokes: n, limit: 200 });
  const bad = items.filter(i => i.meta.strokes !== n);
  const ok = total > 0 && total < all && bad.length === 0;
  if (!ok) fail++;
  console.log(
    `${ok ? "OK " : "NG "} [strokes] "${q}" ${n}画 -> ${total}件 / 絞る前 ${all}件` +
      `  ${items.slice(0, 10).map(i => i.ch).join(" ")}` +
      (bad.length ? `  画数違い:${bad.map(b => b.ch).join("")}` : ""),
  );
};
checkStrokes("こう", 6);
checkStrokes("つち", 11);

/**
 * 画数だけで引く(読みを打たずに画数のチップだけ選んだとき)。
 *   1. その画数の字が**漏れなく**出る(STROKE_MAX は「それ以上」)
 *   2. 並びは読みで引いたときと同じ「段 → 追加された版の順」
 * 画数を選ばないとき(query も strokes も無し)は今までどおり符号位置順の全件。
 * 先頭12字は Swift のテスト(native/ime/test/main.swift)が同じものを期待している
 */
const everything = e.list({ limit: Number.MAX_SAFE_INTEGER }).items;
const checkStrokesOnly = (n: number, expectHead: string) => {
  const want = (s: number) => (n >= STROKE_MAX ? s >= STROKE_MAX : s === n);
  const { items, total } = e.list({ strokes: n, limit: Number.MAX_SAFE_INTEGER });
  const key = (i: (typeof items)[number]) => readingTier(i.meta) * AGE_STEP + ageKey(i.ch);
  const sorted = items.every((x, i) => i === 0 || key(items[i - 1]) < key(x));
  const counted = everything.filter(i => want(i.meta.strokes)).length;
  const bad = items.filter(i => !want(i.meta.strokes));
  const head = items.slice(0, 12).map(i => i.ch).join(" ");
  const ok = sorted && total === counted && !bad.length && head === expectHead;
  if (!ok) fail++;
  console.log(
    `${ok ? "OK " : "NG "} [strokes-only] ${n}画 -> ${head}  (${total}件 / 数え直し ${counted}件)` +
      (sorted ? "" : " / 段と版順が崩れている") +
      (head === expectHead ? "" : `  期待:${expectHead}`),
  );
};
checkStrokesOnly(1, "一 乙 丨 丶 丿 乀 乁 乚 亅 乛 𠃉 𠃊");
checkStrokesOnly(5, "且 世 丘 丙 主 丼 乎 仔 仕 他 付 仙");
checkStrokesOnly(STROKE_MAX, "厵 灩 癴 籲 韊 驫 鱺 鱻 鸝 鸞 麤 龖");
{
  // 画数も query も無いときは従来どおり(符号位置順の全件)
  const cps = everything.slice(0, 50).map(i => i.ch.codePointAt(0)!);
  const ok = everything.length === e.size && cps.every((c, i) => i === 0 || cps[i - 1] < c);
  if (!ok) fail++;
  console.log(`${ok ? "OK " : "NG "} [strokes-only] 画数なし・query なし -> 符号位置順の全${everything.length}件`);
}

/**
 * 符号位置で引く。
 *   search … 候補欄。「U+4E00」「u+4e00」「4E00」(全角でも)で**その1字**が完全一致で出る。
 *            打ちかけ(U+4E0)は符号位置として 0件(部品検索に回さない)
 *   list   … 一覧・キーボードの16進面。打った番号の字＋**その16進で始まる字**を符号位置順
 */
const checkCodeSearch = (q: string, want: string) => {
  const { results, mode, total } = e.search(q, 10);
  const ok =
    mode === "code" &&
    total === (want ? 1 : 0) &&
    (results[0]?.ch ?? "") === want &&
    (!want || results[0].exact);
  if (!ok) fail++;
  console.log(
    `${ok ? "OK " : "NG "} [code] search "${q}" -> ${results.map(r => r.ch).join("") || "なし"}` +
      `  (${mode}/${total}件)  期待:${want || "なし"}`,
  );
};
checkCodeSearch("U+4E00", "一");
checkCodeSearch("u+4e00", "一");
checkCodeSearch("4E00", "一");
checkCodeSearch("Ｕ＋４Ｅ００", "一");
checkCodeSearch("U+3134A", String.fromCodePoint(0x3134a));
checkCodeSearch("U+4E0", "");
const checkCodeList = (q: string, lo: number, hi: number, count: number) => {
  const { items, total, mode } = e.list({ query: q, limit: Number.MAX_SAFE_INTEGER });
  const cps = items.map(i => i.ch.codePointAt(0)!);
  const ok =
    mode === "code" &&
    total === count &&
    cps.every((c, i) => c >= lo && c <= hi && (i === 0 || cps[i - 1] < c));
  if (!ok) fail++;
  console.log(
    `${ok ? "OK " : "NG "} [code] list "${q}" -> ${items.slice(0, 16).map(i => i.ch).join("")}` +
      `  (${total}件・U+${lo.toString(16).toUpperCase()}〜U+${hi.toString(16).toUpperCase()} を符号位置順)`,
  );
};
checkCodeList("U+4E00", 0x4e00, 0x4e00, 1); // 4E00x(5桁)は未割り当てなので1字だけ
checkCodeList("U+4E0", 0x4e00, 0x4e0f, 16);
checkCodeList("2B81", 0x2b810, 0x2b81f, 15); // 2B81F は未割り当て。𫠞(2B81E)まで
checkCodeList("U+2B81", 0x2b810, 0x2b81f, 15);

/**
 * 別の分解でも引けること。表によって字の切り方が違うので(丟 = ⿱王厶 / ⿱一去)、
 * **どちらの組み合わせで打っても**同じ字が出ないと「その人には引けない字」になる。
 * 部品だけで打ったときと、かたち(操作子)つきで打ったときの両方を見る。
 */
const checkAlt = (q: string, want: string) => {
  const { results, total } = e.search(q, 20);
  const ok = results.some(r => r.ch === want);
  if (!ok) fail++;
  console.log(
    `${ok ? "OK " : "NG "} [alt] "${q}" -> ${results.slice(0, 8).map(r => r.ch).join(" ")}` +
      `  (${total}件)  期待:${want}`,
  );
};
checkAlt("王厶", "丟"); // CJKVI の分解
checkAlt("一去", "丟"); // BabelStone の分解
checkAlt("UD王厶", "丟");
checkAlt("UD一去", "丟");

/**
 * いちばん新しい字。Unicode 18.0 で拡張Dの末尾に増えた 𫠞(U+2B81E) は、
 * 上流のIDS表(BabelStone 16.0 / CHISE 17.0)に無く、分解を
 * build-data/supplement.mts で足している(画数は Unihan 18.0 に入った)。
 * データを取り直したときにここが落ちると、収録はされているのに構造検索にも
 * 画数の絞り込みにも出てこない字に戻る(一覧には並ぶので気づきにくい)。
 * 読みはどの資料にも無い(以前は声符 欠 から「けつ」と推していたが、推定はやめた)。
 */
{
  const ch = String.fromCodePoint(0x2b81e);
  const m = e.meta(ch);
  const byShape = e.search("LR日欠", 50).results.some(r => r.ch === ch);
  const byStrokes = e
    .list({ strokes: 8, limit: Number.MAX_SAFE_INTEGER })
    .items.some(i => i.ch === ch);
  const ok = m?.ids === "⿰日欠" && m?.strokes === 8 && byShape && byStrokes;
  if (!ok) fail++;
  console.log(
    `${ok ? "OK " : "NG "} [new] ${ch} U+2B81E ${m?.ids || "分解なし"} ${m?.strokes ?? 0}画` +
      `  LR日欠で引ける:${byShape} / 8画で引ける:${byStrokes}`,
  );
}

/** 読みの持ち方。正式・人名・参考が混ざらずに入っていること */
const checkMeta = (ch: string, want: Record<string, string>) => {
  const m = e.meta(ch)!;
  const got = Object.fromEntries(
    Object.keys(want).map(k => [k, (m as unknown as Record<string, string>)[k]]),
  );
  const ok = Object.entries(want).every(([k, v]) => got[k] === v);
  if (!ok) fail++;
  console.log(`${ok ? "OK " : "NG "} [reading] ${ch} ${JSON.stringify(got)}`);
};
// 正式な読みはそのまま、資料にしか無い読み(呉音・古訓)は参考として別に持つ
checkMeta("悪", { on: "アク オ", refKind: "u" });
// 人名でだけ使う読み
checkMeta("亜", { on: "ア", nanori: "や つぎ つぐ" });
// 推定はしない。以前は異体字から借りていた 专 や、声符から推していた 丆 は読みなし
checkMeta("专", { on: "", ref: "", refKind: "" });
checkMeta("丆", { on: "", ref: "", refKind: "" });
// 互換漢字は統合漢字と同じ字なので、その読み(正式＋参考)を使う
checkMeta("車", { ref: "シャ くるま キョ コ", refKind: "e:車" });
// 和製漢字の辞典。[読み] が「解説参照」で、見出しに「「はなをかむ」は、国訓」とある字
checkMeta("挗", { ref: "ケツ はなをかむ", refKind: "u" });
// 手で足した読み(data-src/readings/manual.tsv)
checkMeta(String.fromCodePoint(0x33379), { ref: "いっさき", refKind: "m" });

// 読みを持つ字の割合(落ちたら補完の作り方を疑う)。
// 推定をやめたので半分ほど(以前は推定込みで97.9%)。資料にある読みだけの数字
{
  const all = e.list({ limit: 0 }).total;
  let none = 0;
  for (const { ch } of e.list({ limit: Number.MAX_SAFE_INTEGER }).items) {
    const m = e.meta(ch)!;
    if (!m.on && !m.kun && !m.nanori && !m.ref) none++;
  }
  const covered = ((all - none) / all) * 100;
  const ok = covered > 51;
  if (!ok) fail++;
  console.log(
    `${ok ? "OK " : "NG "} [reading] 読みのある字 ${covered.toFixed(1)}% (${all - none}/${all})`,
  );
}

console.log("decompose 課:", e.decompose("課"));
console.log("decompose 樹:", e.decompose("樹"));
console.log(fail ? `FAILED: ${fail}` : "ALL PASS");
process.exit(fail ? 1 : 0);
