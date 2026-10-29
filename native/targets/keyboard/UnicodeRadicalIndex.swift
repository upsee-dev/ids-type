import Foundation

struct UnicodeRadicalIndex {
    static let ends = [6,23,54,94,117,146,166,175,186,194,200,204,208,210,211,213,214]
    private let groups: [String: String]
    init(tsv: String) {
        var out: [String: String] = [:]
        for line in tsv.split(separator: "\n") {
            let fields = line.split(separator: "\t", maxSplits: 1)
            if fields.count == 2 { out[String(fields[0])] = String(fields[1]) }
        }
        groups = out
    }
    init() {
        let url = Bundle.main.url(forResource: "radical-index", withExtension: "tsv")
        self.init(tsv: url.flatMap { try? String(contentsOf: $0, encoding: .utf8) } ?? "")
    }
    static func radicals(_ strokes: Int) -> [Int] {
        guard strokes >= 1 && strokes <= ends.count else { return [] }
        let start = strokes == 1 ? 1 : ends[strokes-2]+1
        return Array(start...ends[strokes-1])
    }
    static func label(_ radical: Int) -> String {
        guard radical >= 1 && radical <= 214 else { return "" }
        return String(Unicode.Scalar(0x2f00+radical-1)!).precomposedStringWithCompatibilityMapping + "部"
    }
    func residuals(_ radical: Int) -> [Int] {
        groups.keys.filter { $0.hasPrefix("\(radical).") }.compactMap { Int($0.split(separator: ".")[1]) }.sorted()
    }
    func characters(_ radical: Int, _ residual: Int) -> [String] {
        // Scalars keep compatibility ideographs and supplementary-plane characters distinct.
        (groups["\(radical).\(residual)"] ?? "").unicodeScalars.map(String.init)
    }
}
