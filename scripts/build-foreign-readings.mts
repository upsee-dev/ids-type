/** Only source-attested readings; opt-in keys always retain language + original. */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readZipEntry } from "../web/scripts/build-data/unzip.mts";
import { transcribe, toHiragana } from "../web/scripts/build-data/transcribe.mts";
import { taiwaneseToKana } from "./taiwanese-kana.mts";

const root = fileURLToPath(new URL("../", import.meta.url));
const src = root + "data-src/japanese/";
const manifest = JSON.parse(readFileSync(src + "foreign-sources.json", "utf8"));
for (const source of Object.values(manifest) as {file:string;sha256:string}[]) {
  if (createHash("sha256").update(readFileSync(src + source.file)).digest("hex") !== source.sha256) throw new Error(`Source changed: ${source.file}`);
}
const rows = new Set<string>();
const counts: Record<string,number> = {};
function add(kana: string, text: string, language: string, original: string) {
  original = original.normalize("NFC");
  const reading = toHiragana(kana.normalize("NFC"));
  if (!/^[ぁ-ゖー]+$/.test(reading) || !/^[\p{Script=Han}]+$/u.test(text) || /[\t\r\n]/.test(original)) return;
  const row = [reading,text,"128","9000",language,original].join("\t");
  if (!rows.has(row)) { rows.add(row); counts[language] = (counts[language] ?? 0) + 1; }
}
const unihan = (file: string) => readZipEntry(src + manifest.unihan.file, file).toString("utf8").split("\n").filter(line => line.startsWith("U+")).map(line => line.split("\t"));
const char = (cp: string) => String.fromCodePoint(parseInt(cp.slice(2),16));
for (const [cp,field,value] of unihan("Unihan_Readings.txt")) {
  if (!value || !["kHangul","kVietnamese"].includes(field)) continue;
  const language = field === "kHangul" ? "ko" : "vi";
  for (const entry of value.split(" ")) {
    const original = field === "kHangul" ? entry.split(":")[0] : entry;
    add(transcribe(language,original),char(cp),language,original);
  }
}
// Python's standard CSV parser respects quoted commas/newlines and the UTF-8 BOM.
const records = JSON.parse(execFileSync("python3", ["-c", "import csv,json,sys; print(json.dumps(list(csv.DictReader(open(sys.argv[1],encoding='utf-8-sig'))),ensure_ascii=False))", src + "itaigi.csv"], {maxBuffer:32*1024*1024}).toString()) as Record<string,string>[];
for (const row of records) add(taiwaneseToKana(row.KipUnicode),row.HanLoTaibunKip,"tw",row.KipUnicode);

// Chinese is typed as pinyin on QWERTY only, never as kana on the flick pad.
// Key = toneless lowercase pinyin, ü → v (the usual pinyin IME spelling).
// Order: kHanyuPinlu frequency of that reading, then kTGH (traditional forms
// follow their simplified form), then kUnihanCore2020, then the rest.
function pinyinKey(original: string): string {
  return original.normalize("NFD").toLowerCase().replace(/ü/g, "v").replace(/[̀-ͯ]/g, "");
}
const pinlu: [string, number][] = [], readings: [string, string][] = [];
const tgh = new Map<string, number>(), core = new Set<string>(), simplified = new Map<string, string[]>();
for (const [cp,field,value] of unihan("Unihan_Readings.txt")) {
  if (field === "kMandarin") for (const original of value.split(" ")) readings.push([char(cp), original]);
  if (field === "kXHC1983") for (const entry of value.split(" ")) readings.push([char(cp), entry.split(":")[1]]);
  if (field === "kHanyuPinlu") for (const entry of value.split(" ")) {
    const m = /^(.+)\((\d+)\)$/.exec(entry);
    if (!m) throw new Error(`kHanyuPinlu: ${entry}`);
    readings.push([char(cp), m[1]]); pinlu.push([char(cp) + "\t" + m[1].normalize("NFC"), +m[2]]);
  }
}
for (const [cp,field,value] of unihan("Unihan_OtherMappings.txt")) if (field === "kTGH") tgh.set(char(cp), +value.split(" ")[0].split(":")[1]);
for (const [cp,field] of unihan("Unihan_DictionaryLikeData.txt")) if (field === "kUnihanCore2020") core.add(char(cp));
for (const [cp,field,value] of unihan("Unihan_Variants.txt")) if (field === "kSimplifiedVariant") simplified.set(char(cp), value.split(" ").map(char));
const frequency = new Map(pinlu.sort((a,b) => b[1]-a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([id],rank) => [id, rank]));
if (frequency.size >= 10000) throw new Error("kHanyuPinlu ranks overflow the TGH cost band");
const best = new Map<string, [number, string, string, string]>();
for (const [text, raw] of readings) {
  const original = raw.normalize("NFC"), key = pinyinKey(original);
  if (!/^[a-z]+$/.test(key) || !/^\p{Script=Han}$/u.test(text)) continue;
  const standard = [text, ...(simplified.get(text) ?? [])].map(c => tgh.get(c)).find(n => n !== undefined);
  const cost = frequency.get(text + "\t" + original) ?? (standard !== undefined ? 10000 + standard : core.has(text) ? 20000 : 30000);
  const id = key + "\t" + text, seen = best.get(id);
  if (!seen || cost < seen[0]) best.set(id, [cost, key, text, original]);
}
for (const [cost, key, text, original] of best.values()) rows.add([key,text,"128",String(cost),"zh",original].join("\t"));
counts.zh = best.size;

writeFileSync(src + "foreign.tsv", [...rows].sort().join("\n") + "\n");
writeFileSync(src + "foreign-coverage.json", JSON.stringify({entries:rows.size,languages:counts},null,2)+"\n");
console.log("Foreign readings:",counts);
