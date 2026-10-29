/** Tâi-lô pronunciation -> a kana search key, not a Japanese on-reading.
 * Tone and nasal-vowel contrasts are approximate; retain the original alongside every row.
 * Unknown syllables are rejected instead of guessed from the Han characters.
 */
export function taiwaneseToKana(raw: string): string {
  const initials: [string, string[]][] = [
    ["tsh", ["ツァ","チ","ツ","ツェ","ツォ"]], ["ts", ["ツァ","チ","ツ","ツェ","ツォ"]],
    ["ph", ["パ","ピ","プ","ペ","ポ"]], ["th", ["タ","ティ","トゥ","テ","ト"]],
    ["kh", ["カ","キ","ク","ケ","コ"]], ["ng", ["ガ","ギ","グ","ゲ","ゴ"]],
    ["p", ["パ","ピ","プ","ペ","ポ"]], ["b", ["バ","ビ","ブ","ベ","ボ"]],
    ["m", ["マ","ミ","ム","メ","モ"]], ["t", ["タ","ティ","トゥ","テ","ト"]],
    ["n", ["ナ","ニ","ヌ","ネ","ノ"]], ["l", ["ラ","リ","ル","レ","ロ"]],
    ["k", ["カ","キ","ク","ケ","コ"]], ["g", ["ガ","ギ","グ","ゲ","ゴ"]],
    ["h", ["ハ","ヒ","フ","ヘ","ホ"]], ["s", ["サ","シ","ス","セ","ソ"]],
    ["j", ["ジャ","ジ","ジュ","ジェ","ジョ"]],
  ];
  const plain = raw.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[1-9]/g, "");
  const parts = plain.split(/[-\s]+/).filter(Boolean);
  if (!parts.length) return "";
  const result: string[] = [];
  for (let s of parts) {
    if (s === "m") { result.push("ム"); continue; }
    if (s === "ng") { result.push("ン"); continue; }
    if (!/^[a-z]+$/.test(s)) return "";
    let row = ["ア","イ","ウ","エ","オ"];
    for (const [initial, values] of initials) if (s.startsWith(initial)) { row = values; s = s.slice(initial.length); break; }
    let tail = "";
    const final = s.match(/(ng|nn[h]?|[mnptkh])$/)?.[0];
    if (final) {
      s = s.slice(0, -final.length);
      tail = ({ng:"ン",nn:"ン",nnh:"ン",m:"ム",n:"ン",p:"プ",t:"ツ",k:"ク",h:""} as Record<string,string>)[final];
    }
    s = s.replace(/oo/g,"o").replace(/oa/g,"ua").replace(/oe/g,"ue");
    if (!/^[aiueo]+$/.test(s)) return "";
    const vowels = "aiueo", kana = "アイウエオ";
    result.push(row[vowels.indexOf(s[0])] + [...s.slice(1)].map(v => kana[vowels.indexOf(v)]).join("") + tail);
  }
  return result.join("");
}
