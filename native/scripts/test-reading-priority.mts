import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { Engine } from '../../core/engine.ts';
import type { RawData } from '../../core/data/types.ts';
const raw = JSON.parse(readFileSync(new URL('../../core/kanji-data.json',import.meta.url),'utf8')) as RawData;
const fixture = structuredClone(raw);
fixture.ext = {};
fixture.chars = {};
// char, grade, on, kun, nanori, ref, source, strokes
for (const [ch,grade,on,kun,nanori,ref,source,strokes] of [
  ['土',1,'','いきおいあ','いきおい','','',30],
  ['勢',0,'','いきおい','','','',34],
  ['一',1,'イキオイ','','','','',30],
  ['二',1,'','','いきおい','','',30],
  ['三',1,'','','','いきおい','i:zh:test',30],
  ['四',1,'','','','いきおい','w',31],
  ['五',1,'','','','いきおいあ','u',30],
] as const) fixture.chars[ch] = ['',grade,0,on,kun,strokes,0,'',nanori,ref,source,''];
const engine = new Engine(fixture);
test('exact long kun wins over grade, foreign/name/on readings and 30+ stroke sorting, before paging',()=>{
  for (const q of ['いきおい','イキオイ']) {
    const all = engine.list({query:q,limit:100}).items.map(i=>i.ch);
    assert.deepEqual(all.slice(0,2),['四','勢']);
    const paged = all.map((_,offset)=>engine.list({query:q,offset,limit:1}).items[0].ch);
    assert.deepEqual(paged,all);
    assert.deepEqual(engine.list({query:q,strokes:30,limit:100}).items.slice(0,2).map(i=>i.ch),['四','勢']);
  }
});
test('three kana and incomplete long kun keep the established ordering',()=>{
  assert.equal(engine.list({query:'いきお',limit:1}).items[0].ch,'一');
  const formal = new Engine(raw);
  assert.ok(['志','誌'].includes(formal.list({query:'こころざす',limit:1}).items[0].ch));
  assert.equal(formal.list({query:'うけたまわる',limit:1}).items[0].ch,'承');
});
