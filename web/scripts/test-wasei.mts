import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Engine } from "../../core/index.ts";
import { loadWasei, parseWasei, type WaseiReadingNote } from "./build-data/wasei.mts";
import { SRC } from "./build-data/paths.mts";
import { loadUnihan } from "./build-data/readings.mts";

const html = `<p id='2488'>釻(U+91FB)<div>[解説] 『字鏡集』に「トル　マロカス」とある。</div></p>`;
const note: WaseiReadingNote = { entry: "2488", ch: "釻", readings: ["マロカス"], evidence: "『字鏡集』に「トル　マロカス」とある。" };

test("読み欄のない項目でも、確認済みの引用から読みを補える", () => {
  assert.deepEqual(parseWasei(html, new Map(), [note]).get("釻"), ["マロカス"]);
  assert.equal(parseWasei(html).has("釻"), false); // 解説を無条件に読みへ変換しない
});

test("別項目・別字・原文にない読みを混ぜるとビルドを止める", () => {
  for (const change of [{ entry: "0001" }, { ch: "丸" }, { evidence: "出典なし" }, { readings: ["カス"] }]) {
    assert.throws(() => parseWasei(html, new Map(), [{ ...note, ...change }]));
  }
});

test("熟字訓と著者が否定した音は、読み欄から単字の読みに取り込まない", () => {
  const source = `<p id='1259'>炻(U+70BB)<div>[読み] 「炻器」二字で、「せっき」<br />[解説] 参考</div></p>
    <p id='0618'>彁(U+5F41)<div>[読み] 音義未詳（「カ・セイ」という音には、何の根拠もない）<br /></div></p>`;
  assert.equal(parseWasei(source).size, 0);
});

test("見出しが画像の場合、解説で言及した別字の符号位置を見出しと取り違えない", () => {
  const source = `<p id='0001'><img src='font/0001.svg'>W+1<br /><div>[解説] 別字 U+91FB に「マロカス」とある。</div></p>`;
  assert.throws(() => parseWasei(source, new Map(), [{ ...note, entry: "0001" }]));
});

const strokes = loadUnihan().strokes;
const wasei = loadWasei(strokes);
const notes = JSON.parse(readFileSync(SRC.waseiNotes, "utf8")) as WaseiReadingNote[];
const raw = JSON.parse(readFileSync(new URL("../../core/kanji-data.json", import.meta.url), "utf8"));
const engine = new Engine(raw);

test("実資料の確認済みの読みが、生成した辞書でひらがな・カタカナ両方から引ける", () => {
  for (const { ch, readings } of notes) {
    for (const reading of readings) {
      assert.ok(wasei.get(ch)?.includes(reading), `${ch}/${reading}: 取り込み漏れ`);
      const hira = reading.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
      for (const query of [reading, hira]) {
        assert.ok(engine.list({ query, limit: Number.MAX_SAFE_INTEGER }).items.some(item => item.ch === ch), `${ch}/${query}: 検索漏れ`);
      }
    }
  }
});

test("和製漢字の取り込み済みの全読みが、正式・人名・参考のいずれかに保持される", () => {
  const key = (s: string) => s.replace(/[.\-]/g, "").replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
  for (const [ch, readings] of wasei) {
    const meta = engine.meta(ch);
    assert.ok(meta, `${ch}: 辞書に未収録`);
    const all = key([meta.on, meta.kun, meta.nanori, meta.ref].join(" "));
    for (const reading of readings) assert.ok(all.includes(key(reading)), `${ch}/${reading}: 生成辞書から消失`);
  }
});

test("システムIMEの同梱辞書にも補完した読みが出力される", () => {
  const files = ["dict-ja.tsv", "dict-ext.tsv"].map(file => readFileSync(new URL(`../../native/ime/assets/${file}`, import.meta.url), "utf8"));
  const rows = new Map(files.flatMap(file => file.trim().split("\n")).map(line => {
    const fields = line.split("\t");
    return [fields[0], fields];
  }));
  for (const { ch, readings } of notes) {
    const fields = rows.get(ch);
    assert.ok(fields, `${ch}: IME辞書に未収録`);
    const ref = fields.length >= 10 ? fields[7] : fields[2];
    for (const reading of readings) assert.ok(ref.split(" ").includes(reading), `${ch}/${reading}: IME辞書から消失`);
  }
});
