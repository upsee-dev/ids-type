import Foundation

/// IDS(漢字の空間構造記述)まわり。core/ids/ の Swift 移植。
///
/// キーボード拡張はメモリ上限が約60MBと厳しいので、拡張の中で JS を動かさず
/// エンジンごとネイティブへ移している(docs/technical-roadmap.md 参照)。
/// TypeScript 側 core/ids/{operators,normalize,parse}.ts と挙動を一致させること。
enum Ids {

    struct Operator {
        let code: String
        let idc: Character
        let arity: Int
        let label: String
    }

    /// かたちコード ⇄ IDC。core/ids/operators.ts の OPERATORS と同じ並び
    static let operators: [Operator] = [
        .init(code: "LR", idc: "⿰", arity: 2, label: "左右"),
        .init(code: "LL", idc: "⿲", arity: 3, label: "左中右"),
        .init(code: "UD", idc: "⿱", arity: 2, label: "上下"),
        .init(code: "UU", idc: "⿳", arity: 3, label: "上中下"),
        .init(code: "RD", idc: "⿸", arity: 2, label: "左上かこみ"),
        .init(code: "RU", idc: "⿺", arity: 2, label: "左下かこみ"),
        .init(code: "LD", idc: "⿹", arity: 2, label: "右上かこみ"),
        .init(code: "LU", idc: "⿽", arity: 2, label: "右下かこみ"),
        .init(code: "OD", idc: "⿵", arity: 2, label: "上かこみ"),
        .init(code: "OR", idc: "⿷", arity: 2, label: "左かこみ"),
        .init(code: "OU", idc: "⿶", arity: 2, label: "下かこみ"),
        .init(code: "OL", idc: "⿼", arity: 2, label: "右かこみ"),
        .init(code: "OC", idc: "⿴", arity: 2, label: "全かこみ"),
        .init(code: "XX", idc: "⿻", arity: 2, label: "重なり"),
        .init(code: "MI", idc: "⿾", arity: 1, label: "鏡映"),
        .init(code: "RO", idc: "⿿", arity: 1, label: "回転"),
        .init(code: "SU", idc: "㇯", arity: 2, label: "除去"),
    ]

    /// 1画面目に出す操作子
    static let primaryCodes = [
        "LR", "UD", "OC", "RD", "RU", "LD", "OD", "OU", "LL", "UU", "OR", "XX",
    ]

    private static let code2idc: [String: Character] =
        Dictionary(uniqueKeysWithValues: operators.map { ($0.code, $0.idc) })
    private static let arityMap: [Character: Int] =
        Dictionary(uniqueKeysWithValues: operators.map { ($0.idc, $0.arity) })
    private static let idc2label: [Character: String] =
        Dictionary(uniqueKeysWithValues: operators.map { ($0.idc, $0.label) })

    static func isIdc(_ c: Character) -> Bool { arityMap[c] != nil }
    static func arity(_ c: Character) -> Int { arityMap[c] ?? 0 }
    static func idc(forCode code: String) -> Character? { code2idc[code.uppercased()] }

    /// ワイルドカード。入力の "?" はここへ寄せる
    static let wild: Character = "＊"

    /// 未符号化部品のプレースホルダ。①②③… = cjkvi 由来 / ？ = BabelStone・CHISE 由来
    static func isPlaceholder(_ c: Character) -> Bool {
        if c == "？" { return true }
        guard let v = c.unicodeScalars.first?.value else { return false }
        return v >= 0x2460 && v <= 0x24FF
    }

    /// 同じ形で符号位置が違う部品を寄せる(強い同一視)
    private static let normMap: [Character: Character] = [
        "⺼": "月", "⺾": "艹", "⻌": "辶", "⻍": "辶", "⻏": "阝", "⻖": "阝",
        "靑": "青", "飠": "食", "訁": "言", "釒": "金", "糹": "糸",
        "⺬": "礻", "⺭": "礻", "⺿": "艹", "⻂": "衤", "⺡": "氵", "⺘": "扌",
        "⺖": "忄", "⺨": "犭", "⺣": "灬", "⻊": "足",
        "⺝": "月", "⺗": "㣺", "⺕": "彐", "⺊": "卜", "⺆": "冂",
        "⺻": "聿", "⺶": "羊", "⺸": "羊", "⺵": "网", "⺲": "罒", "⺳": "罒",
        "⺪": "疋", "⺤": "爫", "⺥": "爫", "⺫": "目", "⺁": "厂", "⺇": "几",
        "㇐": "一", "㇑": "丨", "㇒": "丿", "㇓": "丿", "㇔": "丶",
        "㇙": "亅", "㇚": "亅", "㇟": "乚",
    ]

    /// 独立字とその偏旁形(弱い同一視)。閉包に正字も足して両方でヒットさせる
    static let soft: [Character: Character] = [
        "氵": "水", "扌": "手", "忄": "心", "犭": "犬", "灬": "火", "氺": "水",
        "礻": "示", "衤": "衣", "⺩": "玉", "王": "玉", "罒": "网", "⺌": "小",
        "亻": "人", "刂": "刀", "阝": "阜", "㣺": "心", "月": "肉",
    ]

    static func norm(_ c: Character) -> Character { normMap[c] ?? c }

    static func norm(_ s: String) -> String {
        guard s.count == 1, let c = s.first else { return s }
        return String(norm(c))
    }

    /// IDC文字はフォントによって豆腐になるので、表示用に日本語ラベルへ置き換える
    static func readable(_ ids: String) -> String {
        var out = ""
        for c in ids {
            if let label = idc2label[c] { out += "〈\(label)〉" } else { out.append(c) }
        }
        return out
    }

    // MARK: - IDS 構文木

    indirect enum Node {
        case leaf(String)
        case op(Character, [Node])
    }

    /// ⿲abc → ⿰a⿰bc / ⿳abc → ⿱a⿱bc に正規化(構造の揺れを吸収)
    private static func canon(_ op: Character, _ kids: [Node]) -> Node {
        switch op {
        case "⿲": return .op("⿰", [kids[0], .op("⿰", [kids[1], kids[2]])])
        case "⿳": return .op("⿱", [kids[0], .op("⿱", [kids[1], kids[2]])])
        default: return .op(op, kids)
        }
    }

    /// IDS文字列を構文木にする。足りない子はワイルドカード扱い(前方一致で使う)
    static func parse(_ ids: String) -> Node? {
        let ts = Array(ids)
        guard !ts.isEmpty else { return nil }
        var i = 0
        func read() -> Node {
            if i >= ts.count { return .leaf(String(wild)) }
            let t = ts[i]; i += 1
            if isIdc(t) {
                var kids: [Node] = []
                for _ in 0..<arity(t) { kids.append(read()) }
                return canon(t, kids)
            }
            return .leaf(String(norm(t)))
        }
        return read()
    }

    /// 入力文字列を IDS に直す。2文字コード(LR等)・IDC・部品・? が混ざる
    static func compile(_ input: String) -> String {
        let cs = Array(input)
        var out = ""
        var i = 0
        while i < cs.count {
            let c = cs[i]
            if c.isWhitespace { i += 1; continue }
            if c == "?" || c == "？" || c == "_" || c == "＿" || c == "*" || c == "＊" {
                out.append(wild); i += 1; continue
            }
            if c.isASCII, c.isLetter {
                let next = i + 1 < cs.count ? String(cs[i + 1]) : ""
                if let idc = code2idc[(String(c) + next).uppercased()] {
                    out.append(idc); i += 2
                } else {
                    i += 1 // コードでない英字は無視
                }
                continue
            }
            out.append(c); i += 1
        }
        return out
    }
}
