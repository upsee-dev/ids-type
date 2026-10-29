/** Only source-attested readings; opt-in kana keys always retain language + original. */
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
for (const line of readZipEntry(src + manifest.unihan.file, "Unihan_Readings.txt").toString("utf8").split("\n")) {
  const [cp,field,value] = line.split("\t");
  if (!value || !["kMandarin","kHangul","kVietnamese"].includes(field)) continue;
  const language = field === "kMandarin" ? "zh" : field === "kHangul" ? "ko" : "vi";
  const originals = field === "kMandarin" ? value.split(" ").slice(0,1) : value.split(" ");
  for (const entry of originals) {
    const original = field === "kHangul" ? entry.split(":")[0] : entry;
    add(transcribe(language,original),String.fromCodePoint(parseInt(cp.slice(2),16)),language,original);
  }
}
// Python's standard CSV parser respects quoted commas/newlines and the UTF-8 BOM.
const records = JSON.parse(execFileSync("python3", ["-c", "import csv,json,sys; print(json.dumps(list(csv.DictReader(open(sys.argv[1],encoding='utf-8-sig'))),ensure_ascii=False))", src + "itaigi.csv"], {maxBuffer:32*1024*1024}).toString()) as Record<string,string>[];
for (const row of records) add(taiwaneseToKana(row.KipUnicode),row.HanLoTaibunKip,"tw",row.KipUnicode);
writeFileSync(src + "foreign.tsv", [...rows].sort().join("\n") + "\n");
writeFileSync(src + "foreign-coverage.json", JSON.stringify({entries:rows.size,languages:counts},null,2)+"\n");
console.log("Foreign kana readings:",counts);
