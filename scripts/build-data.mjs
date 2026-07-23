// IDS(cjkvi-ids) + KANJIDIC2 -> public/data/kanji-data.json
// 候補集合 = KANJIDIC2 収録字(JIS X 0208/0212/0213, 約13k字)
// parts = 候補字から再帰的に到達できる全部品の分解マップ
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const dataSrc = join(here, "..", "..", "data-src");
// Web は fetch で読むので public/ 配下、Expo アプリは require するので core/ 配下に置く
const outDirs = [join(here, "..", "public", "data"), join(here, "..", "..", "core")];
for (const d of outDirs) mkdirSync(d, { recursive: true });

// ---- KANJIDIC2 ----
const xml = readFileSync(join(dataSrc, "kanjidic2.xml"), "utf8");
const kd = new Map(); // char -> {grade, freq, on[], kun[]}
for (const block of xml.split("</character>")) {
  const lit = block.match(/<literal>(.+?)<\/literal>/);
  if (!lit) continue;
  const grade = block.match(/<grade>(\d+)<\/grade>/);
  const freq = block.match(/<freq>(\d+)<\/freq>/);
  const on = [...block.matchAll(/<reading r_type="ja_on">(.+?)<\/reading>/g)].map(m => m[1]);
  const kun = [...block.matchAll(/<reading r_type="ja_kun">(.+?)<\/reading>/g)].map(m => m[1]);
  kd.set(lit[1], {
    grade: grade ? +grade[1] : 0,
    freq: freq ? +freq[1] : 0,
    on: on.slice(0, 4),
    kun: kun.slice(0, 4),
  });
}
console.log("KANJIDIC2 chars:", kd.size);

// ---- ids.txt ----
// 行形式: U+XXXX <TAB> 字 <TAB> IDS[タグ] (<TAB> IDS[タグ] ...)
// 日本字体 [J..] を優先、なければタグ無し、なければ先頭
const idsMap = new Map(); // char -> ids string
for (const line of readFileSync(join(dataSrc, "ids.txt"), "utf8").split("\n")) {
  if (!line || line.startsWith("#")) continue;
  const f = line.split("\t");
  if (f.length < 3) continue;
  const ch = f[1];
  const entries = f.slice(2).map(s => {
    const m = s.match(/^(.*?)(?:\[([A-Z]+)\])?$/);
    return { ids: m[1], tags: m[2] || "" };
  }).filter(e => e.ids);
  if (!entries.length) continue;
  const pick =
    entries.find(e => e.tags.includes("J")) ||
    entries.find(e => !e.tags) ||
    entries[0];
  if (pick.ids && pick.ids !== ch) idsMap.set(ch, pick.ids);
}
console.log("IDS entries (decomposable):", idsMap.size);

// ---- トークン化(IDC/丸数字プレースホルダ/一般文字) ----
const tokenize = s => [...s]; // コードポイント単位で十分(実体参照なし)
const isIDC = c => (c >= "⿰" && c <= "⿿") || c === "㇯";

// 候補字から到達可能な部品を再帰収集
const parts = new Map();
const visit = ch => {
  if (parts.has(ch)) return;
  const ids = idsMap.get(ch);
  if (!ids) return;
  parts.set(ch, ids);
  for (const t of tokenize(ids)) {
    if (!isIDC(t) && t !== ch) visit(t);
  }
};
for (const ch of kd.keys()) visit(ch);
console.log("parts map size:", parts.size);

// ---- 出力 ----
const chars = {};
for (const [ch, m] of kd) {
  chars[ch] = [
    idsMap.get(ch) || "",
    m.grade,
    m.freq,
    m.on.join(" "),
    m.kun.join(" "),
  ];
}
const partsOut = {};
for (const [ch, ids] of parts) if (!(ch in chars)) partsOut[ch] = ids;

const out = { chars, parts: partsOut };
const json = JSON.stringify(out);
for (const d of outDirs) writeFileSync(join(d, "kanji-data.json"), json);
console.log("wrote kanji-data.json:", (json.length / 1024 / 1024).toFixed(2), "MB", "->", outDirs.join(", "));
