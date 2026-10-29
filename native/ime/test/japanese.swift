import Foundation

@main struct JapaneseTests {
    static func main() throws {
        let root = CommandLine.arguments[1]
        let lexicon = JapaneseLexicon { key in (try? Data(contentsOf:URL(fileURLWithPath:root+"/japanese-"+key+".tsv"))) ?? Data() }
        let fixture = try String(contentsOfFile:CommandLine.arguments[2],encoding:.utf8)
        var checks = 0
        let begin = Date()
        for line in fixture.split(separator:"\n") {
            let f = line.components(separatedBy:"\t")
            if f[0] == "Q" {
                lexicon.search(f[1],order:[f[2]],languages:f[4].components(separatedBy:","))
                precondition(lexicon.count == Int(f[3])!, "count \(f[1]): \(lexicon.count) != \(f[3])")
            } else {
                let c = lexicon.page(offset:Int(f[1])!,limit:1)[0]
                precondition([c.reading,c.text,String(c.mask),String(c.consumed),String(c.kind),c.language,c.original] == Array(f.dropFirst(2)),"candidate \(f)")
            }
            checks += 1
        }
        precondition(JapaneseLexicon.order(["place","bad","place"]).count == JapaneseLexicon.ids.count)
        precondition(JapaneseLexicon.languages([]).isEmpty)
        precondition(JapaneseLexicon.languages(["unknown", "ko", "ko"]) == ["ko"])
        precondition(Kana.matchesLongKun("ココロザス", "こころざ.す"))
        precondition(!Kana.matchesLongKun("こころざ", "こころざ.す"))
        precondition(!Kana.matchesLongKun("いきお", "いきお"))
        precondition(!Kana.matchesLongKun("いずくんぞ", "", "いずくにかいずくんぞ", allowReference: true))
        precondition(!Kana.matchesLongKun("いずくんぞ", "", "イズクンゾ", allowReference: true))
        precondition(!Kana.matchesLongKun("いずくんぞ", "", "いずくんぞ"))
        let rows = ["いきお\t短名\t2\t1", "いきお\t短訓\t16777344\t9000", "いきおい\t名前\t2\t1", "いきおい\t勢\t16777344\t9000", "いきおい\t熟字訓\t64\t10000", "いきおい\t外国\t16777344\t0\tko\toriginal", "いきおいあ\t予測\t16777344\t0"].sorted().joined(separator: "\n") + "\n"
        let synthetic = JapaneseLexicon { _ in Data(rows.utf8) }
        synthetic.search("いきおい", order: ["name"], languages: ["ko"])
        precondition(synthetic.page(offset: 0, limit: 3).map(\.text) == ["熟字訓", "勢", "名前"])
        synthetic.search("いきお", order: ["name"])
        precondition(synthetic.page(offset: 0, limit: 1)[0].text == "短名")
        synthetic.search("いきおいあう", order: ["name"])
        precondition(synthetic.page(offset: 0, limit: 1)[0].text == "予測")
        let index = UnicodeRadicalIndex(tsv:try String(contentsOfFile:root+"/radical-index.tsv",encoding:.utf8))
        precondition(index.characters(5,1).contains("\u{3261e}")); precondition(index.characters(31,1).contains("\u{3261e}"))
        precondition((1...17).flatMap { UnicodeRadicalIndex.radicals($0) } == Array(1...214))
        print("Swift Japanese/radical parity: \(checks) checks PASS (\(Int(Date().timeIntervalSince(begin)*1000)) ms)")
    }
}
