import assert from "node:assert/strict";
import test from "node:test";
import { backspaceSelection, replaceSelection } from "../src/textEditing.ts";
import { isToggleTap, trackFlick } from "../src/flickGesture.ts";

test("削除はカーソル直前・選択範囲に作用し、先頭では何も消さない", () => {
  assert.deepEqual(backspaceSelection("⿰日月", { start: 2, end: 2 }), {
    text: "⿰月", selection: { start: 1, end: 1 },
  });
  assert.equal(backspaceSelection("⿰日月", { start: 1, end: 3 }).text, "⿰");
  assert.equal(backspaceSelection("⿰日月", { start: 0, end: 0 }).text, "⿰日月");
});

test("拡張漢字・異体字セレクターを分断しない", () => {
  assert.deepEqual(backspaceSelection("日𠮷月", { start: 3, end: 3 }), {
    text: "日月", selection: { start: 1, end: 1 },
  });
  const variant = "葛\u{E0100}";
  assert.equal(backspaceSelection(`日${variant}月`, { start: 1 + variant.length, end: 1 + variant.length }).text, "日月");
});

test("パレットからもカーソル位置に挿入し、選択範囲を置換する", () => {
  assert.deepEqual(replaceSelection("日月", { start: 0, end: 0 }, "⿰"), {
    text: "⿰日月", selection: { start: 1, end: 1 },
  });
  assert.equal(replaceSelection("⿰日月", { start: 1, end: 2 }, "木").text, "⿰木月");
});

test("長押し中でも最新方向に変更でき、離す際の戻りで中央へ化けない", () => {
  let direction = trackFlick(-60, 0, 0);
  assert.equal(direction, 1);
  direction = trackFlick(0, -25, direction);
  assert.equal(direction, 2); // より短い距離でも上へ変更できる
  assert.equal(trackFlick(0, 0, direction), 2);
  assert.equal(trackFlick(0, 0, 0), 0); // 次のタッチには持ち越さない
  assert.equal(trackFlick(25, 0, direction), 3);
});

test("短い中央タップだけが連打トグルになり、長押しとフリックは文字を追加する", () => {
  assert.equal(isToggleTap(0, 120), true);
  assert.equal(isToggleTap(0, 900), false);
  assert.equal(isToggleTap(2, 120), false);
});
