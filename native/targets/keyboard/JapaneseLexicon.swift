import Foundation

/// Packed UTF-8 + Int32 line offsets, one leading-kana shard at a time.
/// Keep candidate offsets (not a million Swift Strings) in memory.
final class JapaneseLexicon {
    static let ids = ["common", "name", "place", "kokuji", "symbol", "ketsuren", "jukujikun", "kanji", "plant", "mineral", "animal", "bird", "insect", "fish", "algae"]
    static let labels = ["日本語でよく使われる語", "人名・人名用字", "地名・地名用字", "国字", "記号", "欠画連綿詞", "熟字訓・義訓", "その他の漢字", "植物", "鉱物", "動物", "鳥類", "虫類", "魚類", "藻類"]
    static let shortLabels = ["一般語", "人名", "地名", "国字", "記号", "欠画連綿詞", "熟字訓・義訓", "漢字", "植物", "鉱物", "動物", "鳥類", "虫類", "魚類", "藻類"]
    static func shortLabel(_ mask: Int, _ order: [String]) -> String {
        for id in order {
            if let n = ids.firstIndex(of: id), mask & (1 << n) != 0 { return shortLabels[n] }
        }
        return "かな"
    }
    static let languageIDs = ["ko", "zh", "vi", "tw"]
    static let languageLabels = ["韓国語", "中国語（普通話）", "越南（ベトナム語）", "台湾語（閩南語）"]
    static let languageShortLabels = ["韓国語", "中国語", "越南語", "台湾語"]
    static let languageKey = "katachi.foreignReadings.v1"
    static func languages(_ values: [String]) -> [String] { languageIDs.filter { values.contains($0) } }
    static func languageLabel(_ id: String) -> String { languageIDs.firstIndex(of:id).map { languageShortLabels[$0] } ?? "" }
    static let orderKey = "katachi.japaneseOrder.v1"
    static func order(_ values: [String]) -> [String] {
        var out: [String] = []
        for value in values + ids where ids.contains(value) && !out.contains(value) { out.append(value) }
        return out
    }
    static func label(_ mask: Int, _ order: [String]) -> String {
        for id in order {
            if let n = ids.firstIndex(of: id), mask & (1 << n) != 0 { return labels[n] }
        }
        return "かな"
    }
    struct Candidate { let reading: String; let text: String; let mask: Int; let consumed: Int; let kind: Int; let language: String; let original: String }
    private struct Hit { let row: Int; let kind: Int; let consumed: Int; let rank: Int; let cost: Int; let length: Int; let foreign: Int; let preferredKun: Bool }
    private var blob = Data()
    private var offsets: [Int32] = []
    private var shard = ""
    private var hits: [Hit] = []
    private var query = ""
    private var lastOrder: [String] = []
    private var lastLanguages: [String] = []
    private var fallbacks: [String] = []
    private let load: (String) -> Data
    init(load: @escaping (String) -> Data = { key in
        guard let url = Bundle.main.url(forResource: "japanese-" + key, withExtension: "tsv") else { return Data() }
        return (try? Data(contentsOf: url, options: .mappedIfSafe)) ?? Data()
    }) { self.load = load }
    private func fields(_ row: Int) -> [String] {
        String(decoding: blob[Int(offsets[row])..<Int(offsets[row+1])-1], as: UTF8.self).components(separatedBy: "\t")
    }
    private func reading(_ row: Int) -> String {
        let start = Int(offsets[row]); var end = start
        while end < blob.count && blob[end] != 9 && blob[end] != 10 { end += 1 }
        return String(decoding: blob[start..<end], as: UTF8.self)
    }
    private func lower(_ text: String) -> Int {
        var lo = 0, hi = max(0, offsets.count - 1)
        while lo < hi { let mid = (lo+hi)/2; if reading(mid) < text { lo = mid+1 } else { hi = mid } }
        return lo
    }
    var count: Int { query.isEmpty ? 0 : hits.count + fallbacks.count }
    /// Call search/page on a serial queue. UI receives only its small page of immutable values.
    func search(_ input: String, order values: [String], languages enabled: [String] = []) {
        let normalized = Kana.toHiragana(input.precomposedStringWithCanonicalMapping)
        let priority = Self.order(values)
        let allowed = Self.languages(enabled)
        if normalized == query && priority == lastOrder && allowed == lastLanguages { return }
        lastLanguages = allowed
        query = normalized; lastOrder = priority; fallbacks = []
        hits.removeAll(keepingCapacity: true)
        guard let first = query.unicodeScalars.first else { return }
        let key = String(format: "%04x", first.value)
        if key != shard {
            blob = load(key); offsets = [0]
            for (i, byte) in blob.enumerated() where byte == 10 { offsets.append(Int32(i+1)) }
            shard = key
        }
        func append(_ row: Int, kind: Int, consumed: Int) {
            let f = fields(row)
            guard (f.count == 4 || f.count == 6), let mask = Int(f[2]), let cost = Int(f[3]) else { return }
            let language = f.count == 6 ? f[4] : ""
            if !language.isEmpty && !allowed.contains(language) { return }
            let rank = priority.firstIndex { id in mask & (1 << Self.ids.firstIndex(of: id)!) != 0 } ?? priority.count
            hits.append(Hit(row: row, kind: kind, consumed: consumed, rank: rank, cost: cost, length: f[0].count, foreign: language.isEmpty ? 0 : 1, preferredKun: query.count >= 4 && kind == 0 && language.isEmpty && mask & ((1 << 24) | (1 << 6)) != 0))
        }
        let rowCount = max(0, offsets.count-1), length = query.count
        var i = lower(query)
        while i < rowCount {
            let r = reading(i)
            if !r.hasPrefix(query) { break }
            append(i, kind: r == query ? 0 : 1, consumed: length); i += 1
        }
        if length > 1 {
            for n in stride(from: length-1, through: 1, by: -1) {
                let prefix = String(query.prefix(n)); i = lower(prefix)
                while i < rowCount && reading(i) == prefix { append(i, kind: 2, consumed: n); i += 1 }
            }
        }
        hits.sort { a,b in
            if a.preferredKun != b.preferredKun { return a.preferredKun }
            if a.kind != b.kind { return a.kind < b.kind }
            if a.kind == 2 && a.consumed != b.consumed { return a.consumed > b.consumed }
            if a.foreign != b.foreign { return a.foreign < b.foreign }
            if a.rank != b.rank { return a.rank < b.rank }
            if a.cost != b.cost { return a.cost < b.cost }
            if a.length != b.length { return a.length < b.length }
            return a.row < b.row
        }
        // Predictive forms can share a surface. Preserve distinct partial-consumption choices.
        var seen = Set<Data>()
        hits = hits.filter { hit in
            let f = fields(hit.row)
            return seen.insert(Data("\(hit.consumed)\t\(f[1])".utf8)).inserted
        }
        let katakana = String(String.UnicodeScalarView(query.unicodeScalars.map { scalar in
            scalar.value >= 0x3041 && scalar.value <= 0x3096 ? Unicode.Scalar(scalar.value+0x60)! : scalar
        }))
        fallbacks = [query,katakana].filter { seen.insert(Data("\(query.count)\t\($0)".utf8)).inserted }
    }
    func page(offset: Int, limit: Int = 12) -> [Candidate] {
        guard !query.isEmpty, offset >= 0, limit > 0, offset < count else { return [] }
        return (offset..<min(count, offset+limit)).map { n in
            if n >= hits.count {
                let text = fallbacks[n-hits.count]
                return Candidate(reading: query, text: text, mask: 0, consumed: query.count, kind: 3, language: "", original: "")
            }
            let hit = hits[n], f = fields(hit.row)
            return Candidate(reading: f[0], text: f[1], mask: Int(f[2]) ?? 0, consumed: hit.consumed, kind: hit.kind, language: f.count == 6 ? f[4] : "", original: f.count == 6 ? f[5] : "")
        }
    }
}
