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
    let r = engine.search(q, limit: 200)
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

print(fail == 0 ? "ALL PASS" : "FAILED: \(fail)")
exit(fail == 0 ? 0 : 1)
