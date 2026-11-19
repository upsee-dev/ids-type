import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JapaneseLexicon, japaneseReading, JAPANESE_CATEGORIES, DEFAULT_JAPANESE_ORDER, normalizeJapaneseOrder, moveCategory, normalizeForeignReadings, searchLanguages } from "../../core/japanese.ts";
import { KUN_READING_FLAG, matchesLongKun, longKunRank } from "../../core/reading-priority.ts";
import { taiwaneseToKana } from "../../scripts/taiwanese-kana.mts";
import { radicalsByStrokes, radicalCharacters, residualStrokes, type RadicalIndex } from "../../core/radical-index.ts";
import { KANA_ROWS, kanaFlick } from "../../core/data/kana.ts";
const assets = fileURLToPath(new URL("../ime/assets/", import.meta.url));
const index = JSON.parse(readFileSync(new URL("../../core/radical-index.json", import.meta.url),"utf8")) as RadicalIndex;
const engine = new JapaneseLexicon(key => { try { return readFileSync(`${assets}/japanese-${key}.tsv`,"utf8"); } catch { return ""; } });
const first = (id: string) => normalizeJapaneseOrder([id]);
/** The katakana spelling of the input always leads; ranking assertions look at the dictionary rows after it. */
const words = (results: ReturnType<typeof engine.search>) => results.length && results[0].consumed === results[0].reading.length && /^[ァ-ヶー]+$/.test(results[0].text) ? results.slice(1) : results;

test("priority preferences recover unknown/duplicate/missing IDs without hiding a category", () => {
  assert.deepEqual(normalizeJapaneseOrder(["place","invalid","place",4]),["place",...DEFAULT_JAPANESE_ORDER.filter(v=>v!=="place")]);
  assert.deepEqual(normalizeJapaneseOrder(null),DEFAULT_JAPANESE_ORDER);
  const order = moveCategory(DEFAULT_JAPANESE_ORDER,"name",-1);
  assert.equal(order[0],"name"); assert.equal(DEFAULT_JAPANESE_ORDER[0],"common");
  assert.deepEqual(moveCategory(order,"name",-1),order);
  const oldIDs=['common','name','place','kokuji','symbol','ketsuren','jukujikun','kanji'];
  assert.deepEqual(DEFAULT_JAPANESE_ORDER.slice(0,8),oldIDs);
  assert.deepEqual(normalizeJapaneseOrder(['name',...oldIDs]),['name',...oldIDs.filter(v=>v!=='name'),'plant','mineral','animal','bird','insect','fish','algae']);
});
test("all seven nature categories convert dictionary readings and obey priority", () => {
  for (const [q,text,id] of [['あやめ','菖蒲','plant'],['せきえい','石英','mineral'],['あざらし','海豹','animal'],['つばめ','燕','bird'],['とんぼ','蜻蛉','insect'],['さば','鯖','fish'],['こんぶ','昆布','algae'],['のり','海苔','algae']]) {
    const bit=1<<DEFAULT_JAPANESE_ORDER.indexOf(id as typeof DEFAULT_JAPANESE_ORDER[number]);
    const results=engine.search(q,first(id));
    assert.ok(results.some(c=>c.text===text && c.kind===0 && (c.mask&bit)),`${id}: ${q} → ${text}`);
    assert.ok(words(results)[0].mask&bit,`${id}: moving the category first changes ranking`);
  }
  const bit=(id: string)=>1<<DEFAULT_JAPANESE_ORDER.indexOf(id as typeof DEFAULT_JAPANESE_ORDER[number]);
  const kingfisher=engine.search('かわせみ',first('bird')).find(c=>c.text==='翡翠' && c.kind===0)!;
  assert.ok(kingfisher.mask&bit('bird')); assert.equal(kingfisher.mask&bit('mineral'),0);
  const whale=engine.search('くじら',first('animal')).find(c=>c.text==='鯨' && c.kind===0)!;
  assert.ok(whale.mask&bit('animal')); assert.equal(whale.mask&bit('fish'),0);
  const kelp=engine.search('こんぶ',first('algae')).find(c=>c.text==='昆布' && c.kind===0)!;
  assert.ok(kelp.mask&bit('algae')); assert.equal(kelp.mask&bit('plant'),0);
  const dandelion=engine.search('たんぽぽ',first('plant')).filter(c=>c.kind===0 && (c.mask&bit('plant')));
  assert.ok(dandelion.some(c=>c.text==='蒲公英'));
  assert.ok(dandelion.some(c=>c.text==='タンポポ'), 'kana-only reading must retain its own kana spelling');
  assert.ok(engine.search('さくら',first('plant')).every(c=>c.text!=='偽客' || !(c.mask&bit('plant'))));
});
test("foreign readings are opt-in per language, including after disabling on the same query", () => {
  for (const bad of [null,undefined,true,{},"ko",[true,42,"invalid"]]) assert.deepEqual(normalizeForeignReadings(bad),[]);
  assert.deepEqual(normalizeForeignReadings(["tw","ko","ko","unknown"]),["ko","tw"]);
  for (const [q,language] of [["みょん","ko"],["xue","zh"],["ぐおい","vi"],["りほ","tw"]] as const) {
    const baseline = engine.search(q,DEFAULT_JAPANESE_ORDER);
    assert.ok(baseline.every(c=>!c.language));
    const enabled = engine.search(q,DEFAULT_JAPANESE_ORDER,[language]);
    assert.ok(enabled.some(c=>c.language===language && c.kind===0 && c.original),`${language}: ${q}`);
    assert.ok(enabled.every(c=>!c.language || c.language===language));
    assert.deepEqual(engine.search(q,DEFAULT_JAPANESE_ORDER,[]),baseline);
  }
  assert.equal(taiwaneseToKana("guá"),"グア");
  assert.equal(taiwaneseToKana("Tâi-gí"),"タイギ");
  assert.equal(taiwaneseToKana("lâng"),"ラン");
  assert.equal(taiwaneseToKana("unsupported!"),"");
});
test("Chinese is pinyin on QWERTY only: never from kana, ranked by frequency, ü typed as v", () => {
  const all = normalizeForeignReadings(["ko","zh","vi","tw"]);
  assert.deepEqual(searchLanguages(all,true),["zh"]);
  assert.deepEqual(searchLanguages(all,false),["ko","vi","tw"]);
  assert.deepEqual(searchLanguages([],true),[]);
  // The flick pad's language list cannot reach Chinese, and no kana shard holds a Chinese row.
  for (const q of ["しゅえ","に","ちゅん"]) assert.ok(engine.search(q,DEFAULT_JAPANESE_ORDER,["zh"]).every(c=>c.language!=="zh"),q);
  for (const [q,text,original] of [["ni","你","nǐ"],["xue","学","xué"],["zhong","中","zhōng"],["hang","行","háng"],["nv","女","nǚ"],["men","们","men"]]) {
    const top = engine.search(q,DEFAULT_JAPANESE_ORDER,["zh"])[0];
    assert.deepEqual([top.text,top.original,top.language,top.kind],[text,original,"zh",0],q);
  }
  assert.ok(engine.search("lv",DEFAULT_JAPANESE_ORDER,["zh"]).slice(0,8).some(c=>c.text==="绿"));
  assert.ok(engine.search("men",DEFAULT_JAPANESE_ORDER,["zh"]).slice(0,2).some(c=>c.text==="們"),"traditional follows simplified");
  const sentence = engine.search("nihao",DEFAULT_JAPANESE_ORDER,["zh"]);
  assert.deepEqual([sentence[0].text,sentence[0].consumed,sentence[0].kind],["你",2,2]);
  assert.equal(engine.search("hao",DEFAULT_JAPANESE_ORDER,["zh"])[0].text,"好");
  assert.ok(engine.search("ni",DEFAULT_JAPANESE_ORDER,[]).every(c=>!c.language),"pinyin stays opt-in");
});
test("flick や-key sends parentheses left/right; tapping cycles や（ゆ）よ", () => {
  const ya = KANA_ROWS.flat().find(k=>k.label==="や")!;
  assert.deepEqual([0,1,2,3,4].map(d=>kanaFlick(ya,d)),["や","（","ゆ","）","よ"]);
  for (const [file,pattern] of [["../targets/keyboard/Kana.swift",/key\("や", "（", "ゆ", "）", "よ"\)/],["../ime/android/java/com/upsee/katachi/ime/Kana.kt",/row\("や", "（", "ゆ", "）", "よ"\)/]] as const) {
    assert.match(readFileSync(new URL(file,import.meta.url),"utf8"),pattern,file);
  }
});
test("rare names, places, kokuji, jukujikun and ketsuren remain searchable", () => {
  for (const [q,text,id] of [["たかなし","小鳥遊","name"],["わたぬき","四月一日","name"],["なかんだかり","仲村渠","place"],["つつじ","躑躅","jukujikun"],["ぴんぽん","乒乓","ketsuren"],["とうげ","峠","kokuji"],["ほし","★","symbol"]]) {
    const results = engine.search(q,first(id));
    assert.ok(results.some(c=>c.text===text && c.kind===0),`${q} → ${text}`);
    assert.ok(words(results)[0].mask & (1 << DEFAULT_JAPANESE_ORDER.indexOf(id as typeof DEFAULT_JAPANESE_ORDER[number])),`${id} must be first`);
  }
});
test("manual readings require multiple publications; pinpon works with all foreign languages off", () => {
  const supplements=JSON.parse(readFileSync(new URL("../../data-src/japanese/supplement.json",import.meta.url),"utf8"));
  for (const item of supplements) {
    const accepted=item.status==='accepted';
    if (accepted) assert.ok(new Set(item.sources.map((s: {id:string})=>s.id)).size>=2);
    for (const reading of item.readings) {
      const found=engine.search(reading,first(item.category),[]).some(c=>c.text===item.text && c.kind===0 && !c.language);
      assert.equal(found,accepted,`${reading} → ${item.text}`);
    }
  }
  const primary=supplements.find((item: {text:string;primary?:boolean})=>item.text==='乒乓' && item.primary);
  assert.deepEqual(primary.readings,['ぴんぽん']);
  assert.ok(engine.search('ピンポン',first('ketsuren'),[]).some(c=>c.text==='乒乓' && c.kind===0 && !c.language));
});
test("katakana, pagination, composition consumption and missing readings", () => {
  assert.deepEqual(engine.search("タカナシ",first("name")),engine.search("たかなし",first("name")));
  const results = engine.search("し",DEFAULT_JAPANESE_ORDER);
  assert.ok(results.length>10000,"no low-frequency top-N cutoff");
  assert.equal(new Set(results.map(c=>`${c.consumed}/${c.text}`)).size,results.length);
  const sentence = engine.search("たかなしさん",first("name"));
  const part = sentence.find(c=>c.text==="小鳥遊" && c.consumed===4);
  assert.ok(part); assert.equal("たかなしさん".slice(part.consumed),"さん");
  assert.deepEqual(engine.search("",DEFAULT_JAPANESE_ORDER),[]);
  const missing = engine.search("ゔゔゔゔ",DEFAULT_JAPANESE_ORDER);
  assert.equal(missing[0].text,"ヴヴヴヴ"); assert.equal(missing.at(-1)?.text,"ゔゔゔゔ");
});
test("Unicode index follows every radical, exact residuals and secondary memberships", () => {
  assert.deepEqual(Array.from({length:17},(_,n)=>radicalsByStrokes(n+1)).flat(),Array.from({length:214},(_,n)=>n+1));
  assert.ok(radicalsByStrokes(1).includes(5));
  assert.ok(radicalCharacters(index,5,1).includes("\u{3261e}"));
  assert.ok(radicalCharacters(index,31,1).includes("\u{3261e}"));
  assert.ok(!radicalCharacters(index,5,0).includes("\u{3261e}"));
  const negative = Object.keys(index).find(k=>k.includes(".-")); assert.ok(negative);
  const [rad,rest] = negative.split(".").map(Number); assert.ok(residualStrokes(index,rad).includes(rest));
  assert.deepEqual(radicalsByStrokes(0),[]); assert.deepEqual(radicalCharacters(index,0,1),[]);
});
test("first-grade scope vocabulary includes rare compounds, variants and full kun characters", () => {
  for (const [q,text] of [["かんか","轗軻"],["かんてんじう","旱天慈雨"],["きんかいちじつ","槿花一日"],["きんかいっちょう","槿花一朝"],["ぼうこひょうか","暴虎馮河"],["ちみもうりょう","魑魅魍魎"],["がいしゅういっしょく","鎧袖一触"],["けいがい","謦咳"],["そご","齟齬"],["こくご","国語"],["こらえる","怺"],["むしる","毟"]]) {
    assert.ok(engine.search(q,DEFAULT_JAPANESE_ORDER).some(c=>c.text===text && c.kind===0 && !c.language),`${q} → ${text}`);
  }
});

test("shared native shards match declared coverage; no malformed or unsorted rows", () => {
  let total = 0;
  const singleCharacters = new Set<string>();
  for (const file of readdirSync(assets).filter(f=>/^japanese-[0-9a-f]+\.tsv$/.test(f))) {
    const tsv = readFileSync(`${assets}/${file}`,"utf8");
    const key = file.slice(9,-4);
    let previous = "";
    for (const line of tsv.trimEnd().split("\n")) {
      const fields = line.split("\t");
      const [reading,text,mask,cost,language,original] = fields;
      assert.ok(fields.length===4 || fields.length===6);
      if (fields.length===4 && Array.from(text).length===1) singleCharacters.add(text);
      if (fields.length===6) { assert.ok(["ko","zh","vi","tw"].includes(language)); assert.ok(original); }
      assert.equal(reading.codePointAt(0)!.toString(16).padStart(4,"0"),key);
      assert.match(reading,language==="zh" ? /^[a-z]+$/ : /^[ぁ-ゖー]+$/); assert.ok(text); assert.ok((+mask & ((1<<JAPANESE_CATEGORIES.length)-1))>0 && (+mask & ~(((1<<JAPANESE_CATEGORIES.length)-1) | KUN_READING_FLAG))===0); assert.ok(+cost>=0);
      assert.ok(previous<=reading); previous=reading; total++;
    }
  }
  const coverage=JSON.parse(readFileSync(new URL("../../data-src/japanese/coverage.json",import.meta.url),"utf8"));
  assert.equal(total,coverage.entries+coverage.foreignEntries);
  // Independently enumerate JIS X 0208 level 1/2: all 6,355 must have Japanese
  // single-character conversion candidates even with every foreign language off.
  const decoder = new TextDecoder("euc-jp",{fatal:true});
  const levelCounts=[0,0];
  for (let ku=16;ku<=84;ku++) for (let ten=1;ten<=94;ten++) {
    let ch: string;
    try { ch=decoder.decode(Uint8Array.of(ku+160,ten+160)); } catch { continue; }
    assert.ok(singleCharacters.has(ch),`missing JIS ${ku}-${ten}: ${ch}`);
    levelCounts[ku<=47?0:1]++;
  }
  assert.deepEqual(levelCounts,[2965,3390]);
  const audit=JSON.parse(readFileSync(new URL("../../data-src/japanese/kanken-coverage.json",import.meta.url),"utf8"));
  assert.equal(audit.jmdictLexicalPairs,coverage.jmdictLexicalPairs);
  assert.ok(audit.jmdictNewPairs>0);
  const raw=JSON.parse(readFileSync(new URL("../../core/kanji-data.json",import.meta.url),"utf8"));
  const joyo=Object.entries(raw.chars as Record<string,unknown[]>).filter(([,v])=>Number(v[1])>=1 && Number(v[1])<=8).map(([ch])=>ch);
  assert.equal(joyo.length,2136);
  for (const ch of joyo) assert.ok(singleCharacters.has(ch),`missing joyo: ${ch}`);
  assert.deepEqual(audit.joyo,{expected:2136,characterSearch:2136,flickReading:2136,missing:[]});

  for (const level of Object.values(audit.jisX0208) as {expected:number;flickReading:number;characterSearch:number;missing:string[]}[]) {
    assert.equal(level.flickReading,level.expected); assert.equal(level.characterSearch,level.expected); assert.deepEqual(level.missing,[]);
  }

});

test("four-kana exact kun precedes categories; short, partial, on and foreign do not", () => {
  assert.ok(matchesLongKun("ココロザス", "こころざ.す"));
  assert.ok(matchesLongKun("いきおい", "-いきおい"));
  assert.ok(!matchesLongKun("こころざ", "こころざ.す"));
  assert.ok(!matchesLongKun("はなす", "はな.す"));
  assert.ok(!matchesLongKun("いずくんぞ", "", "いずくにかいずくんぞ", true));
  assert.ok(!matchesLongKun("いずくんぞ", "", "イズクンゾ", true));
  assert.ok(!matchesLongKun("いずくんぞ", "", "いずくんぞ", false));
  const rows = [
    ["こころ", "短訓", KUN_READING_FLAG|128, 9000], ["こころ", "短名", 2, 1],
    ["こころざす", "人名", 2, 1], ["こころざす", "志す", KUN_READING_FLAG|128, 9000],
    ["こころざす", "熟字訓", 64, 10000], ["こころざす", "外国", KUN_READING_FLAG|128, 0, "ko", "original"],
    ["こころざすよ", "予測", KUN_READING_FLAG|2, 0],
  ].map(r=>r.join("\t")).sort().join("\n")+"\n";
  const lex = new JapaneseLexicon(()=>rows);
  const full = lex.search("こころざす",first("name"),["ko"]);
  assert.deepEqual(full.slice(0,4).map(c=>c.text),["ココロザス","熟字訓","志す","人名"]);
  assert.equal(words(lex.search("こころ",first("name")))[0].text,"短名");
  assert.equal(words(lex.search("こころざすよね",first("name")))[0].text,"予測");
  for (const [q,text] of [["こころざす","志す"],["うけたまわる","承る"],["いきおい","勢"]]) {
    const c = words(engine.search(q,first("name")))[0];
    assert.equal(c.text,text); assert.equal(c.kind,0); assert.ok(c.mask & KUN_READING_FLAG);
  }
});

test("the katakana spelling of the input is always the first candidate (not for pinyin)", () => {
  for (const q of ["すいそ","し","たかなしさん","チャルメラ","ゔゔゔゔ"]) {
    const top = engine.search(q,DEFAULT_JAPANESE_ORDER)[0];
    assert.deepEqual([top.text,top.consumed],[japaneseReading(q).replace(/[ぁ-ゖ]/g,c=>String.fromCharCode(c.charCodeAt(0)+0x60)),japaneseReading(q).length],q);
  }
  // A dictionary row with the same katakana spelling is not repeated.
  assert.equal(engine.search("ちゃるめら",DEFAULT_JAPANESE_ORDER).filter(c=>c.text==="チャルメラ" && c.consumed===5).length,1);
  assert.notEqual(engine.search("nihao",DEFAULT_JAPANESE_ORDER,["zh"])[0].kind,3);
  const dandelion = engine.search("たんぽぽ",first("plant"))[0];
  assert.equal(dandelion.text,"タンポポ"); assert.ok(dandelion.mask & (1<<DEFAULT_JAPANESE_ORDER.indexOf("plant")),"the dictionary row keeps its category");
});
test("5+ kana kun that start with a 4+ kana input lead the predictive candidates; exact matches stay ahead", () => {
  assert.equal(longKunRank("うけたま","うけたまわ.る"),1);
  assert.equal(longKunRank("うけたまわる","うけたまわ.る"),0);
  assert.equal(longKunRank("うけた","うけたまわ.る"),2,"three kana are not enough");
  assert.equal(longKunRank("こころ","こころ"),2);
  assert.equal(longKunRank("こころざ","こころざ.す"),1);
  assert.equal(longKunRank("いずくん","","いずくんぞ",false),2,"reference readings need permission");
  const rows = [
    ["かんがえ","考え",1,5000],["かんがえる","考える",KUN_READING_FLAG|128,9000],["かんがえかた","考え方",1,1],
    ["かんがえる","名前",2,1],
  ].map(r=>r.join("\t")).sort().join("\n")+"\n";
  const lex = new JapaneseLexicon(()=>rows);
  assert.deepEqual(lex.search("かんがえ",DEFAULT_JAPANESE_ORDER).map(c=>c.text).slice(0,4),["カンガエ","考え","考える","考え方"]);
  assert.deepEqual(lex.search("かんが",DEFAULT_JAPANESE_ORDER).map(c=>c.text).slice(0,2),["カンガ","考え方"],"three kana keep category/cost order");
  for (const [q,text] of [["うけたま","承る"],["いのちみ","殤し"],["よもすが","終夜"],["こころざ","志す"]]) {
    assert.ok(words(engine.search(q,DEFAULT_JAPANESE_ORDER)).slice(0,3).some(c=>c.text===text && c.kind===1),q);
  }
});
test("every word from the 難読語 list and every element (Taiwan and mainland forms) converts", () => {
  for (const line of readFileSync(new URL("../../data-src/japanese/nandoku.tsv",import.meta.url),"utf8").split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const [text,reading,category] = line.split("\t");
    const bit = 1<<DEFAULT_JAPANESE_ORDER.indexOf(category as typeof DEFAULT_JAPANESE_ORDER[number]);
    assert.ok(engine.search(reading,first(category)).some(c=>c.text===text && c.kind===0 && (c.mask&bit)),`${reading} → ${text}`);
  }
  let elements = 0;
  for (const line of readFileSync(new URL("../../data-src/japanese/elements.tsv",import.meta.url),"utf8").split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const [number,,,reading,taiwan,china] = line.split("\t");
    const results = engine.search(reading,DEFAULT_JAPANESE_ORDER);
    for (const ch of [taiwan,china]) assert.ok(results.some(c=>c.text===ch && c.kind===0),`${number} ${reading} → ${ch}`);
    elements++;
  }
  assert.equal(elements,118);
  const hydrogen = engine.search("すいそ",DEFAULT_JAPANESE_ORDER).map(c=>c.text);
  assert.ok(hydrogen.includes("氫") && hydrogen.includes("氢"));
  const silicon = engine.search("けいそ",DEFAULT_JAPANESE_ORDER).map(c=>c.text);
  assert.ok(silicon.includes("矽") && silicon.includes("硅"),"Taiwan 矽 and mainland 硅 differ");
});

// The same fixture is consumed by the Swift and Kotlin executable tests below.
if (process.env.JAPANESE_PARITY_FIXTURE) {
  const lines: string[] = [];
  for (const [q,id,languages] of [["こころざす","name",""],["うけたまわる","name",""],["いきおい","name",""],["おもんぱかる","place",""],["こころざ","name",""],["こころざすよ","name",""],["うけたま","name",""],["いのちみ","common",""],["よもすが","common",""],["すいそ","common",""],["けいそ","common",""],["かんがえ","common",""],["ちゃるめら","common",""],["ココロザス","name",""],["たかなし","name",""],["わたぬき","name",""],["なかんだかり","place",""],["つつじ","jukujikun",""],["ぴんぽん","ketsuren",""],["よろよろ","ketsuren",""],["よろめく","ketsuren",""],["ほし","symbol",""],["し","common",""],["たかなしさん","name",""],["ゔゔゔゔ","common",""],["","common",""],
    ["かんか","kanji",""],["かんてんじう","kanji",""],["きんかいちじつ","kanji",""],["きんかいっちょう","kanji",""],["ぼうこひょうか","kanji",""],["ちみもうりょう","kanji",""],["がいしゅういっしょく","kanji",""],["けいがい","kanji",""],["そご","kanji",""],["こらえる","kanji",""],["むしる","kanji",""],
    ['あやめ','plant',''],['せきえい','mineral',''],['あざらし','animal',''],['つばめ','bird',''],['とんぼ','insect',''],['さば','fish',''],['こんぶ','algae',''],['かわせみ','bird',''],
    ...["ko","zh","vi","tw"].flatMap(language=>[["みょん","common",language],["しゅえ","common",language],["ぐおい","common",language],["りほ","common",language]]),
    ...["ni","nihao","xue","zhong","hang","lv","n","zzz"].flatMap(q=>[[q,"common","zh"],[q,"common",""]]),
    ["し","common","ko,zh,vi,tw"],["し","common",""]]) {
    const results = engine.search(q,first(id),normalizeForeignReadings(languages.split(",")));
    lines.push(["Q",q,id,String(results.length),languages].join("\t"));
    for (const offset of [...new Set([0,Math.max(0,results.length-8)])]) {
      results.slice(offset,offset+8).forEach((c,i)=>lines.push(["C",String(offset+i),c.reading,c.text,String(c.mask),String(c.consumed),String(c.kind),c.language,c.original].join("\t")));
    }
  }
  writeFileSync(process.env.JAPANESE_PARITY_FIXTURE,lines.join("\n")+"\n");
}
