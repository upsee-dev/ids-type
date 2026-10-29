import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { IRG_WORKING_SETS, irgEntryUrl, type IrgEntry } from "../src/irgWorkingSets.ts";
import { buildIrgEntries, unihanSourceIndex } from "./lib/irg.mts";

test("字源表記の揺れを揃え、資料のPUAをUnicode文字として扱わない", () => {
  const index = unihanSourceIndex([
    "U+20000\tkIRG_GSource\tGHZR-10014.07",
    "U+20001\tkIRG_JSource\tSAT-00077",
    "U+20002\tkIRG_VSource\tVN-F1634",
    "U+20003\tkIRG_USource\tUTC-00001",
    "U+20004\tkIRG_USource\tUTC-00001", // 複数字源の衝突も勝手に1字へ潰さない
  ].join("\n"));
  const page = (sn: string, ref: string) => JSON.stringify({
    sn, title: `${sn} | ⿰日月 | WS2024`,
    sources: { [ref]: { Codepoint: "E000", "Font glyph": "\ue000" } },
  });
  const rows = buildIrgEntries([
    page("00005", "unknown"), page("00002", "USAT00077"),
    page("00001", "GHZR10014.07"), page("00003", "V-F1634"),
    page("00004", "UTC-00001"),
  ].join("\n"), index);
  assert.deepEqual(rows.map(row => row.sn), ["00001", "00002", "00003", "00004", "00005"]);
  assert.deepEqual(rows.map(row => row.chars), [["𠀀"], ["𠀁"], ["𠀂"], ["𠀃", "𠀄"], []]);
  assert.equal(rows[4].ids, "⿰日月");
});

test("再取得した提案は後勝ちで採り、共通欄と字源別のIDSを保持する", () => {
  const rows = buildIrgEntries([
    JSON.stringify({ sn: "00001", title: "", sources: { "*": { IDS: "旧" } } }),
    JSON.stringify({ sn: "00001", title: "", sources: {
      "*": { IDS: "⿰木木" }, A: { IDS: "⿱木木" }, B: { IDS: "⿰木木" },
    } }),
  ].join("\n"), new Map());
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ids, "⿰木木 / ⿱木木");
  assert.deepEqual(rows[0].refs, ["A", "B"]);
  assert.equal(irgEntryUrl("ws2024", rows[0].sn), "https://hc.jsecs.org/irg/ws2024/app/?id=00001");
});

for (const ws of IRG_WORKING_SETS) {
  test(`${ws}: 全提案が同梱され、番号順で重複・PUA混入がない`, () => {
    const source = readFileSync(new URL(`../../data-src/irg/${ws}.jsonl`, import.meta.url), "utf8");
    const ids = [...new Set(source.trim().split("\n").map(line => JSON.parse(line).sn))].sort();
    const rows = JSON.parse(readFileSync(new URL(`../assets/irg/${ws}.json`, import.meta.url), "utf8")) as IrgEntry[];
    assert.deepEqual(rows.map(row => row.sn), ids);
    assert.ok(rows.length > 1000);
    for (const row of rows) {
      assert.ok(row.ids.length > 0, `${ws}/${row.sn}: IDSがない`);
      assert.equal(row.chars.length, new Set(row.chars).size);
      for (const ch of row.chars) {
        assert.equal([...ch].length, 1);
        const cp = ch.codePointAt(0)!;
        assert.ok(!((cp >= 0xe000 && cp <= 0xf8ff) || (cp >= 0xf0000 && cp <= 0x10ffff)), `${ws}/${row.sn}: PUA`);
      }
    }
  });
}
