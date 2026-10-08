import Foundation

// Swift 版エンジンの検証。Web(TypeScript)・Android(Kotlin) と同じ問いを投げて
// 同じ候補が同じ順で返ることを確かめる。UIKit を使わないのでコマンドラインで走る。
let dir = URL(fileURLWithPath: CommandLine.arguments[1])
let dict = Dict()
let t0 = Date()
dict.loadJapanese(ja: dir.appendingPathComponent("dict-ja.tsv"),
                  parts: dir.appendingPathComponent("dict-parts.tsv"))
let t1 = Date()
dict.loadExtensions(ext: dir.appendingPathComponent("dict-ext.tsv"))
let t2 = Date()
print("日本語 \(dict.jaCount) 字 (\(Int(t1.timeIntervalSince(t0)*1000))ms) / 全 \(dict.count) 字 (\(Int(t2.timeIntervalSince(t1)*1000))ms)")

let engine = Engine(dict: dict)
var fail = 0
func check(_ q: String, _ expect: [String], within: Int = 8) {
    let s = Date()
    // TypeScript 版の check と同じく「よく使う順」で見る(? を混ぜた問いは
    // 数千件当たるので、既定の符号位置順だと狙いの字が上位20件には入らない)
    let r = engine.search(q, limit: 200, sort: .common)
    let top = r.hits.prefix(within).map(\.ch)
    let ok = expect.allSatisfy { top.contains($0) }
    if !ok { fail += 1 }
    print("\(ok ? "OK " : "NG ") \"\(q)\" -> \(top.joined(separator: " "))  (\(r.hits.count)件, \(Int(Date().timeIntervalSince(s)*1000))ms)")
}
check("LR日月", ["明"]); check("UD宀子", ["字"]); check("OC囗玉", ["国"])
check("RU辶刀", ["辺"]); check("LR言果", ["課"]); check("UD艹果", ["菓"])
check("日月", ["明"]); check("LR木?", ["村"], within: 20); check("LR氵?", ["海"], within: 30)
check("LR彳圭", ["街"], within: 10); check("宀女", ["安"], within: 10)
check("LR扌旦", ["担"], within: 5); check("lr日月", ["明"])

// ── 候補の並び(既定＝符号位置順) ──
// 1. 打ったものと**完全一致する字が先頭**
// 2. そのあとは 完全一致 → 日本の漢字 → 拡張漢字 の段で、段の中は符号位置順
// TypeScript 版(web/scripts/test-engine.mts の checkUnicode)と同じ問いを投げている。
// 上位10字も出すので、3実装の並びを目でも見比べられる
func checkOrder(_ q: String, _ expectFirst: String) {
    let r = engine.search(q, limit: 500)
    func rank(_ h: Engine.Hit) -> Int { (h.exact ? 0 : 2) + (dict.isExt(h.index) ? 1 : 0) }
    var sorted = true
    for i in r.hits.indices where i > 0 {
        let a = r.hits[i - 1], b = r.hits[i]
        let cpA = a.ch.unicodeScalars.first?.value ?? 0
        let cpB = b.ch.unicodeScalars.first?.value ?? 0
        if rank(a) != rank(b) ? rank(a) > rank(b) : cpA >= cpB { sorted = false; break }
    }
    let first = r.hits.first?.ch ?? ""
    let ok = first == expectFirst && sorted
    if !ok { fail += 1 }
    let top = r.hits.prefix(10).map(\.ch).joined(separator: " ")
    print("\(ok ? "OK " : "NG ") [unicode] \"\(q)\" -> \(top)  (\(r.total)件, 先頭:\(first)\(sorted ? "" : " / 符号位置順が崩れている"))")
}
checkOrder("LR日月", "明"); checkOrder("日月", "明"); checkOrder("木", "木")
checkOrder("宀女", "安"); checkOrder("OC囗玉", "国"); checkOrder("木木", "林")

// ── 読みで引く ──
// 並びは **段(常用・人名用 → KANJIDIC2の残り → 拡張漢字) → 段の中は Unicode に
// 追加された版の順**(同じ版の中は符号位置順)。Web と1字でも違うと
// 「アプリでは出るのにキーボードでは出ない」が起きるので、
// TypeScript 版(test-engine.mts)が返す先頭12字をそのまま突き合わせる。
func checkReading(_ q: String, _ expectHead: String, _ note: String) {
    let r = engine.byReading(q, limit: 12)
    let got = r.items.joined(separator: " ")
    let ok = got == expectHead
    if !ok { fail += 1 }
    print(
        "\(ok ? "OK " : "NG ") [reading] \"\(q)\" -> \(got)"
            + "  (全\(r.total)件・\(note))"
            + (ok ? "" : "\n     TypeScript 版: \(expectHead)"),
    )
}
checkReading("つち", "土 地 培 塊 壌 己 戊 杵 椎 槌 凷 圡", "常用漢字が先・段内は版順")
checkReading("あきら", "亨 亮 侃 光 公 卯 叡 史 哲 啓 央 察", "人名読みでも引ける")
// 寧 のあとの3字は互換漢字(U+F95F・U+F9AA・U+2F86F)。統合漢字と同じ字なのでその読みで出る。
// 以前は 乌 が異体字 烏 の読みを借りて出ていたが、推定はやめた
checkReading("いずくんぞ", "安 寧 悪 烏 曷 渠 焉 寧 寧 寧 𭴚", "資料にしか無い読みでも引ける")
checkReading("ぎょう", "仰 倖 凝 刑 効 喬 営 型 堯 尭 幸 形", "拡張漢字は後ろの段")

// 読みの持ち方。正式・人名・参考が混ざらずに入っていること
func checkReadingFields(_ ch: String, _ want: (String, String, String)) {
    guard let i = dict.index(of: ch) else { print("NG  [reading] \(ch) が辞書に無い"); fail += 1; return }
    let got = (dict.readings(at: i), dict.nanori(at: i), dict.ref(at: i))
    let ok = got.0 == want.0 && got.1 == want.1 && got.2 == want.2
    if !ok { fail += 1 }
    print("\(ok ? "OK " : "NG ") [reading] \(ch) 音訓[\(got.0)] 人名[\(got.1)] 参考[\(got.2)]")
}
// 参考の読みは件数で切らない(以前は4件で切っていて、にくむ・ウ が読みで引けなかった)
checkReadingFields("悪", ("アク オ\tわる.い わる- あ.し にく.い", "", "コ ああ いずくに いずくにかいずくんぞ にくむ ウ"))
checkReadingFields("亜", ("ア\tつ.ぐ", "や つぎ つぐ", "アク オウ"))
// 推定はしない(以前は 专 が異体字 專 から、丆 が声符 丿 から読みを借りていた)
checkReadingFields("专", ("", "", ""))
checkReadingFields("丆", ("", "", ""))

// ── 画数だけで引く・符号位置で引く ──
// 読みを打たずに画数のチップだけ選んだとき(byStrokes。並びは読みと同じ段→版順)と、
// 16進の面で符号位置を打ったとき(byCode。打った16進で始まる字を符号位置順)。
// TypeScript 版(test-engine.mts の checkStrokesOnly / checkCodeList)と
// 同じ字が同じ順・同じ件数で出ること
func checkPage(_ tag: String, _ r: (items: [String], total: Int), _ expectHead: String, _ expectTotal: Int) {
    let got = r.items.joined(separator: " ")
    let ok = got == expectHead && r.total == expectTotal
    if !ok { fail += 1 }
    print(
        "\(ok ? "OK " : "NG ") [\(tag)] -> \(got)  (全\(r.total)件)"
            + (ok ? "" : "\n     TypeScript 版: \(expectHead)  (全\(expectTotal)件)"),
    )
}
// 画数の件数は辞書を作り直すと動くので、固定せずに数え直したものと突き合わせる
func strokeCount(_ n: Int) -> Int {
    (0..<dict.count).filter {
        n >= Engine.strokeMax ? dict.strokes(at: $0) >= n : dict.strokes(at: $0) == n
    }.count
}
checkPage("strokes-only 1画", engine.byStrokes(1, limit: 12), "一 乙 丨 丶 丿 乀 乁 乚 亅 乛 𠃉 𠃊", strokeCount(1))
checkPage("strokes-only 5画", engine.byStrokes(5, limit: 12), "且 世 丘 丙 主 丼 乎 仔 仕 他 付 仙", strokeCount(5))
checkPage(
    "strokes-only 30画+", engine.byStrokes(Engine.strokeMax, limit: 12),
    "厵 灩 癴 籲 韊 驫 鱺 鱻 鸝 鸞 麤 龖", strokeCount(Engine.strokeMax),
)
checkPage("code 4E00", engine.byCode("4E00"), "一", 1)
checkPage("code 4E0", engine.byCode("4E0", limit: 4), "一 丁 丂 七", 16)
checkPage("code 2B81", engine.byCode("2B81", limit: 3), "𫠐 𫠑 𫠒", 15)

// ── 手書き照合 ──
// web の build:handwriting が書き出した問題集を読み、TypeScript 実装が返したのと
// **同じ候補が同じ順で**返るかを見る。数値の扱いが1つでもずれれば落ちる
// (Kotlin 版も ime/test/main.kt が同じ問題集で確かめている)。
let hw = Handwriting()
let h0 = Date()
hw.load(url: dir.appendingPathComponent("hw.tsv"))
print("手書きパターン \(hw.size) 字 (\(Int(Date().timeIntervalSince(h0) * 1000))ms)")

let casesFile = URL(fileURLWithPath: CommandLine.arguments[2])
    .appendingPathComponent("handwriting-cases.tsv")
if let text = try? String(contentsOf: casesFile, encoding: .utf8) {
    let lines = text.split(separator: "\n", omittingEmptySubsequences: false)
    let count = Int(lines[0].trimmingCharacters(in: .whitespaces)) ?? 0
    var hwFail = 0
    let s = Date()
    for i in 1...count {
        let f = lines[i].split(separator: "\t")
        let expect = String(f[0])
        let strokes: [[Double]] = f.dropFirst().map { stroke in
            stroke.split(separator: " ").flatMap { p in
                p.split(separator: ",").compactMap { Double($0) }
            }
        }
        let got = hw.match(strokes, limit: 5).map(\.ch).joined()
        if got != expect {
            hwFail += 1
            print("NG  期待 \(expect)  実際 \(got)")
        }
    }
    let ms = Int(Date().timeIntervalSince(s) * 1000) / max(count, 1)
    if hwFail == 0 {
        print("手書き: ALL PASS (\(count) 問・TypeScript と同じ順序, \(ms)ms/問)")
    } else {
        print("手書き: FAILED \(hwFail) / \(count)")
        fail += hwFail
    }
} else {
    print("手書き: 問題集が読めない (\(casesFile.path))")
    fail += 1
}


// ── ローマ字 → かな ──
// 読みを打つ面は フリック / ローマ字 / Godan の3つあり、後ろの2つは同じ
// ローマ字表(core/data/romaji.ts から生成した Romaji.table)を使う。
// **表と手続きがずれると同じローマ字で違うかなが出る**ので、
// TypeScript 版(core/data/romaji.ts)と同じ答えになることを見る
func checkRomaji(_ input: String, _ expectKana: String, _ expectRest: String) {
    let r = Kana.romajiToKana(input)
    let ok = r.kana == expectKana && r.rest == expectRest
    if !ok { fail += 1 }
    print(
        "\(ok ? "OK " : "NG ") [romaji] \"\(input)\" -> \(r.kana)"
            + (r.rest.isEmpty ? "" : " +打ちかけ\(r.rest)")
            + (ok ? "" : "  期待:\(expectKana)/\(expectRest)"),
    )
}
checkRomaji("kanji", "かんじ", "")
checkRomaji("tuchi", "つち", "")
checkRomaji("tsuchi", "つち", "")
checkRomaji("akira", "あきら", "")
checkRomaji("gyou", "ぎょう", "")
checkRomaji("ky", "", "ky")
checkRomaji("kya", "きゃ", "")
checkRomaji("sinn", "しん", "")
checkRomaji("n", "", "n")
checkRomaji("nk", "ん", "k")
checkRomaji("kitte", "きって", "")
checkRomaji("jouyou", "じょうよう", "")

print(fail == 0 ? "ALL PASS" : "FAILED: \(fail)")
exit(fail == 0 ? 0 : 1)
