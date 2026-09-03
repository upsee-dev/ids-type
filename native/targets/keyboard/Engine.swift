import Foundation

/// 検索エンジン。core/engine.ts の Swift 移植。
///
/// 入力(かたちコード＋部品) → 候補漢字。やることは2つだけ:
///   構造検索  … 入力に操作子が含まれる。IDS構文木どうしを突き合わせる
///   部品検索  … 操作子なし。その部品を含む字を集める(再帰的な部品閉包)
///
/// TypeScript/Kotlin 版と候補の並びまで一致させること(同点は辞書の並び順で決まる)。
final class Engine {

    struct Hit {
        let index: Int
        let ch: String
        let exact: Bool
    }

    enum Mode { case empty, structure, parts }

    /// hits は1ページぶん。total は絞り込みの全件数(UI はこれでページを分ける)
    struct Result {
        let hits: [Hit]
        let mode: Mode
        var total: Int = 0
    }

    /// 直前の検索の**全件**。ページ送りのために覚えておく。
    /// 1ページめくるたびに10万字を走査し直すと数十〜数百ms かかるため。
    private struct Cached {
        let key: String
        let hits: [Hit]
        let mode: Mode
    }

    /// 閉包キャッシュの入れ物。
    /// TypeScript/Kotlin では Set が参照型なので「先に空で登録 → 再帰しながら育てる」
    /// という循環ガードが成立する。Swift の Set は値型なので同じ書き方だと
    /// 再帰先に空のコピーが渡り、相互参照する部品の閉包が取りこぼされる
    /// (LR日月 の候補が 76件→47件 に減る)。参照型で包んで挙動を合わせる。
    private final class ClosureBox {
        var set = Set<String>()
    }

    private let dict: Dict
    private var treeCache: [String: Ids.Node?] = [:]
    private var treesCache: [String: [Ids.Node]] = [:]
    private var closureCache: [String: ClosureBox] = [:]
    private var leafCountCache: [String: Int] = [:]
    private var cache: Cached?

    /// 完全一致の下駄。**打ったものそのままの字はどの並びでも必ず先頭**に来るよう、
    /// 残り(学年300,000＋頻度27,000＋拡張2,000,000)を全部足したより大きく取る
    private static let exactStep = 3_000_000

    /// 拡張漢字(KANJIDIC2 に無い字)の下駄。日本語入力なので日本の漢字の後ろへ
    private static let extStep = 2_000_000

    /// 「符号位置順」の段(完全一致→日本の漢字→拡張漢字)1つぶんの重み。
    /// 符号位置の最大 0x10FFFF(1,114,111)より大きくして段が混ざらないようにする
    private static let cpStep = 2_000_000

    /// 「近い順」で余分な部品1つぶんの重み。素点の最大(5,327,000)より大きくする
    private static let nearStep = 10_000_000

    /// 読みで引いたときの「段」(正式→人名→参考→推定)1つぶんの重み
    private static let readingStep = 10_000_000

    /// 余分の数え上げの頭打ち。Int を溢れさせないため
    private static let nearMax = 99

    /// 画数チップの上限。ここ以上は「30画以上」として1つに束ねる
    /// (30画を超える字は10万字のうち1%ほどで、1画きざみでは選びにくい)。
    /// core/engine.ts の STROKE_MAX・Kotlin の STROKE_MAX と同じ値にすること
    static let strokeMax = 30

    init(dict: Dict) { self.dict = dict }

    // MARK: - 分解木

    private func tree(_ ch: String) -> Ids.Node? {
        if let c = treeCache[ch] { return c }
        let s = dict.ids(of: ch)
        let t = (s?.isEmpty ?? true) ? nil : Ids.parse(s!)
        treeCache[ch] = t
        return t
    }

    /// その字の分解**ぜんぶ**(主＋別の分解)を構文木にしたもの。
    ///
    /// 同じ字でも表によって切り方が違う(丟 = ⿱王厶 / ⿱一去)。どちらを思い浮かべるかは
    /// 人によるので、**打った組み合わせがどれか1つに当たれば引ける**ようにする。
    /// 並びは辞書のまま(主が先)＝TypeScript/Kotlin 版と候補の並びが揃う。
    private func trees(_ ch: String) -> [Ids.Node] {
        if let c = treesCache[ch] { return c }
        let out = dict.idsList(of: ch).compactMap { Ids.parse($0) }
        treesCache[ch] = out
        return out
    }

    // MARK: - 部品の閉包(自身＋再帰的に到達できる全部品)

    func closure(_ ch: String) -> Set<String> {
        let c = Ids.norm(ch)
        if let hit = closureCache[c] { return hit.set }
        let box = ClosureBox()
        closureCache[c] = box          // 循環ガード。先に置く
        add(c, into: box)
        return box.set
    }

    private func add(_ x: String, into box: ClosureBox) {
        let n = Ids.norm(x)
        if box.set.insert(n).inserted {
            for s in subClosure(n) { box.set.insert(s) }
        }
        if n.count == 1, let f = n.first, let soft = Ids.soft[f] {
            box.set.insert(String(soft))
        }
    }

    private func subClosure(_ ch: String) -> Set<String> {
        var out = Set<String>()
        // **主の分解だけでなく別の分解の部品も入れる**。表によって切り方が違うので、
        // 片方しか見ないと「その組み合わせでは引けない字」ができる
        for s in dict.idsList(of: ch) {
            for t in s {
                if Ids.isIdc(t) { continue }
                let n = Ids.norm(String(t))
                if n == ch { continue }
                out.formUnion(closure(n))
            }
        }
        return out
    }

    private func closureOfNode(_ n: Ids.Node) -> Set<String> {
        switch n {
        case .leaf(let ch):
            return ch == String(Ids.wild) ? [] : closure(ch)
        case .op(_, let kids):
            var out = Set<String>()
            for k in kids { out.formUnion(closureOfNode(k)) }
            return out
        }
    }

    // MARK: - 構造マッチ: 2=完全一致, 1=包含, 0=不一致

    private func match(_ q: Ids.Node, _ c: Ids.Node, _ depth: Int = 0) -> Int {
        if depth > 12 { return 0 }
        switch q {
        case .leaf(let qch):
            if qch == String(Ids.wild) { return 2 }
            switch c {
            case .leaf(let cch):
                if qch == cch { return 2 }
                let qs = qch.count == 1 ? Ids.soft[qch.first!].map(String.init) : nil
                let cs = cch.count == 1 ? Ids.soft[cch.first!].map(String.init) : nil
                if qs == cch || cs == qch { return 1 }
                return closure(cch).contains(qch) ? 1 : 0
            case .op:
                return closureOfNode(c).contains(qch) ? 1 : 0
            }
        case .op(let qop, let qkids):
            switch c {
            case .leaf(let cch):
                // 葉を展開して再帰(例: 果 → ⿱田木)。別の分解も順に試す
                for sub in trees(cch) {
                    guard case .op = sub else { continue }
                    if match(q, sub, depth + 1) != 0 { return 1 }
                }
                return 0
            case .op(let cop, let ckids):
                guard qop == cop, qkids.count == ckids.count else { return 0 }
                var best = 2
                for i in qkids.indices {
                    let m = match(qkids[i], ckids[i], depth + 1)
                    if m == 0 { return 0 }
                    best = min(best, m)
                }
                return best
            }
        }
    }

    // MARK: - 並び順
    // 完全一致(打ったものそのままの字)が最上位の鍵。拡張漢字の下駄より大きいので、
    // ぴったりの字が拡張漢字でも候補の先頭に出る。
    // 日本語入力なので、KANJIDIC2 に無い字は必ず日本の漢字の後ろへ。
    private func score(_ i: Int, _ exact: Bool) -> Int {
        var s = exact ? 0 : Self.exactStep
        let g = dict.grade(at: i)
        s += (g >= 1 && g <= 6 ? g : g == 8 ? 7 : (g == 9 || g == 10) ? 8 : 10) * 30_000
        let f = dict.freq(at: i)
        s += f > 0 ? f * 10 : 27_000
        if dict.isExt(i) { s += Self.extStep }
        return s
    }

    /// 候補の並び順。キーは core/engine.ts の SORT_MODES と同じ文字列で、
    /// アプリの設定画面が共有領域(SharedStore.sortMode)に書いたものを受ける。
    enum Sort {
        /// 既定。完全一致を先頭に、あとは符号位置(Unicode)の順
        case unicode
        /// 完全一致 → 学年 → 使用頻度(拡張漢字は必ず後ろ)
        case common
        /// 打ったかたちに近い順。余分な部品が少ない字を先に
        case near

        static func of(_ key: String?) -> Sort {
            switch key {
            case "near": return .near
            case "common": return .common
            default: return .unicode
            }
        }
    }

    /// 並べ替えの鍵。unicode は符号位置そのまま、near は**打った部品のほかに
    /// 余分な部品がいくつあるか**を先に見て、同じ数のなかを素点で並べる
    /// (同じくらい近いなら、よく使う字が先)。
    private func sortKey(_ h: Hit, _ sort: Sort, _ asked: Int) -> Int {
        if sort == .unicode { return codeKey(h) }
        let s = score(h.index, h.exact)
        if sort != .near { return s }
        let extra = min(Self.nearMax, max(0, leafCount(h.ch) - asked))
        return extra * Self.nearStep + s
    }

    /// 「符号位置順」の鍵。**完全一致 → 日本の漢字 → 拡張漢字**の3段に分け、
    /// 段の中を符号位置(Unicode)で並べる。
    ///
    /// 段を分けずに符号位置だけで並べると、拡張A(U+3400〜)が統合漢字(U+4E00〜)より
    /// 前に来て、木を打つと 林 の前に見たこともない字が数百字並ぶ。日本語入力として
    /// 使いものにならないので、「拡張漢字は日本の漢字の後ろ」は符号位置順でも守る。
    private func codeKey(_ h: Hit) -> Int {
        let rank = (h.exact ? 0 : 2) + (dict.isExt(h.index) ? 1 : 0)
        let cp = h.ch.unicodeScalars.first.map { Int($0.value) } ?? 0
        return rank * Self.cpStep + cp
    }

    /// 打った部品**だけ**でできている字か(並ぶ順番は問わない)。
    /// 例: 「木」→ 木そのもの、「木木」→ 林(⿰木木)。呆(⿱口木)は口が余るので違う。
    ///
    /// 操作子なしで打ったときの「完全一致」の見分け方。当たった字は候補の先頭へ出す。
    private func madeOfExactly(_ ch: String, _ want: [String]) -> Bool {
        if want.count == 1, Ids.norm(ch) == want[0] { return true }
        let sorted = want.sorted()
        // どれか1つの分解が打ったものと過不足なく一致すれば完全一致
        for ids in dict.idsList(of: ch) {
            let parts = ids.filter { !Ids.isIdc($0) }.map { Ids.norm(String($0)) }
            if parts.count != want.count { continue }
            if parts.sorted() == sorted { return true }
        }
        return false
    }

    /// 入力が求めている部品の数。? は数えない(埋まるぶんは「余分」として効く)
    private func askedLeaves(_ n: Ids.Node) -> Int {
        switch n {
        case .leaf(let ch):
            return ch == String(Ids.wild) ? 0 : leafCount(ch)
        case .op(_, let kids):
            return kids.reduce(0) { $0 + askedLeaves($1) }
        }
    }

    /// 再帰的に展開したときの部品(葉)の数＝字の複雑さ。「近い順」の物差し。
    /// 分解を持たない字は1つ。循環しても止まるよう、先に1を入れてから数える。
    private func leafCount(_ ch: String, _ depth: Int = 0) -> Int {
        let c = Ids.norm(ch)
        if let hit = leafCountCache[c] { return hit }
        guard let ids = dict.ids(of: c), !ids.isEmpty else {
            leafCountCache[c] = 1
            return 1
        }
        if depth > 12 { return 1 } // 深さ依存なので覚えない
        leafCountCache[c] = 1 // 循環ガード。先に登録しておく
        var n = 0
        for t in ids where !Ids.isIdc(t) {
            let k = Ids.norm(String(t))
            n += k == c ? 1 : leafCount(k, depth + 1)
        }
        let v = n == 0 ? 1 : n
        leafCountCache[c] = v
        return v
    }

    /// 候補を1ページぶん返す。
    /// offset を動かすと同じ絞り込みの続きが取れる(走査はやり直さない)。
    func search(_ input: String, limit: Int = 60, sort: Sort = .unicode, offset: Int = 0) -> Result {
        let compiled = Ids.compile(input)
        if compiled.isEmpty { return Result(hits: [], mode: .empty) }
        let key = "\(compiled)\u{0}\(sort)"
        let c: Cached
        if let hit = cache, hit.key == key {
            c = hit
        } else {
            let found = searchAll(compiled, sort)
            c = Cached(key: key, hits: found.hits, mode: found.mode)
            cache = c
        }
        let from = min(max(0, offset), c.hits.count)
        let to = min(from + limit, c.hits.count)
        return Result(hits: Array(c.hits[from..<to]), mode: c.mode, total: c.hits.count)
    }

    /// 絞り込みの本体。全件を並べ替えて返す(切り出しは search がやる)
    /// 並べ替えの比較。**同点は辞書の並び順**で決める。
    /// Swift の sort は安定ではないので、ここを書かないと同点の候補の前後が
    /// 実行のたびに変わり、TypeScript/Kotlin 版(安定ソート)とも食い違う。
    private func less(_ a: Hit, _ b: Hit, _ sort: Sort, _ asked: Int) -> Bool {
        let ka = sortKey(a, sort, asked)
        let kb = sortKey(b, sort, asked)
        return ka == kb ? a.index < b.index : ka < kb
    }

    private func searchAll(_ compiled: String, _ sort: Sort) -> Result {
        let hasIdc = compiled.contains(where: { Ids.isIdc($0) })
        var hits: [Hit] = []
        hits.reserveCapacity(512)

        // 互換漢字(U+F900〜)は統合漢字と正規等価で、見た目も同じ。
        // Swift の Set<String> は正規等価で判定するので、これに入れるだけで
        // 「同じ字が2つ並ぶ」のを防げる。辞書は日本語の字を先に読むので、
        // 残るのは KANJIDIC2 側(読み・学年つき)になる。
        var seen = Set<String>()

        if hasIdc {
            guard let q = Ids.parse(compiled), case .op = q else {
                return Result(hits: [], mode: .empty)
            }
            for i in 0..<dict.count {
                let ch = dict.char(at: i)
                // 分解ぜんぶを試して、いちばん良く当たったものを採る。
                // 「⿱王厶」で打っても「⿱一去」で打っても 丟 が出る
                var m = 0
                for t in trees(ch) {
                    guard case .op = t else { continue }
                    m = max(m, match(q, t))
                    if m == 2 { break }
                }
                if m != 0, seen.insert(ch).inserted {
                    hits.append(Hit(index: i, ch: ch, exact: m == 2))
                }
            }
            let asked = askedLeaves(q)
            hits.sort { less($0, $1, sort, asked) }
            return Result(hits: hits, mode: .structure, total: hits.count)
        }

        // 部品包含検索(操作子なし)
        let want = compiled.filter { $0 != Ids.wild }.map { Ids.norm(String($0)) }
        if want.isEmpty { return Result(hits: [], mode: .empty) }
        // 打った部品そのものの字(「木」→ 木)も候補に入れる。**それが完全一致**なので、
        // 除いてしまうと「打ったものと同じ字を先頭に」が成り立たない
        for i in 0..<dict.count {
            let ch = dict.char(at: i)
            let cl = closure(ch)
            if want.allSatisfy({ cl.contains($0) }), seen.insert(ch).inserted {
                hits.append(Hit(index: i, ch: ch, exact: madeOfExactly(ch, want)))
            }
        }
        let asked = want.reduce(0) { $0 + leafCount($1) }
        hits.sort { less($0, $1, sort, asked) }
        return Result(hits: hits, mode: .parts, total: hits.count)
    }

    /// 読みから字を引く。「つち」→ 土 圭 塩 … のように、部品として使いたい字を
    /// パレットに無くても出せるようにするためのもの。
    ///
    /// 音読み(カタカナ)・訓読み(ひらがな)の両方を1本に見て部分一致で拾う。
    /// 訓読みの「あか.るい」「-がわ」の . と - は送り仮名・接辞の目印なので落とす。
    ///
    /// 読みは**正式・人名・参考・推定の4段階**で持っているので(readings.mts)、
    /// 当たった読みの段を第一の並び順にする。そうしないと、声符から推しただけの
    /// 字が、辞書に載っている読みの字を押しのけて前に出てしまう。
    ///
    /// **該当する字は打ち切らずに全部数える**。60件で切ると「この読みの字は
    /// これで全部」なのか「まだ先にあるのか」が打つ側から分からないので、
    /// total を返してページで送れるようにしてある。走査は10万字ぶんだが、
    /// 呼ぶ側が別スレッドに逃がしている(runReadingSearch)。
    ///
    /// strokes を渡すと**画数で絞り込む**(0=絞らない)。画数は Unihan の
    /// kTotalStrokes で10万字ぜんぶにあるので、拡張漢字にも効く。
    /// strokeMax(30)は「30画以上」の意味。
    func byReading(
        _ query: String,
        strokes: Int = 0,
        offset: Int = 0,
        limit: Int = 60,
    ) -> (items: [String], total: Int) {
        let kana = Kana.toHiragana(query.trimmingCharacters(in: .whitespaces))
        if kana.isEmpty { return ([], 0) }
        // 上位に並び順(段→素点)、下位20bitに添字を詰めて Int 1本で並べる
        var hits: [Int] = []
        hits.reserveCapacity(limit * 4)
        // 拡張漢字を読み終える前は**日本の字までしか見ない**。読み込みは別スレッドで
        // 走っていて、増えている最中の配列を端から舐めると、まだ書き終わっていない
        // 場所を読みかねない。読み終わったあとは10万字ぜんぶを数える
        let n = dict.extLoaded ? dict.count : dict.jaCount
        for i in 0..<n {
            if strokes > 0, !strokeHit(dict.strokes(at: i), strokes) { continue }
            let rank = readingRank(i, kana)
            if rank == 0 { continue }
            let key = rank * Self.readingStep + score(i, false)
            hits.append((key << 20) | i)
        }
        hits.sort()
        let page = hits.dropFirst(offset).prefix(limit).map { dict.char(at: $0 & 0xF_FFFF) }
        return (page, hits.count)
    }

    /// 画数の絞り込み。strokeMax は「それ以上」を束ねる
    private func strokeHit(_ n: Int, _ want: Int) -> Bool {
        want >= Self.strokeMax ? n >= Self.strokeMax : n == want
    }

    /// 打った読みがその字のどの読みに当たったか。小さいほど先に出す。0 = 当たらない。
    ///   1 … 正式(KANJIDIC2 の音訓)
    ///   2 … 人名(nanori)。正式ではないが実際に使われる
    ///   3 … 参考(資料にある読み)
    ///   4 … 推定(異体字・声符から。当たるのは6割ほど)
    private func readingRank(_ i: Int, _ kana: String) -> Int {
        func hit(_ s: String) -> Bool {
            if s.isEmpty { return false }
            return Kana.toHiragana(s)
                .replacingOccurrences(of: ".", with: "")
                .replacingOccurrences(of: "-", with: "")
                .contains(kana)
        }
        if hit(dict.readings(at: i)) { return 1 }
        if hit(dict.nanori(at: i)) { return 2 }
        if hit(dict.ref(at: i)) { return dict.refKind(at: i) == 1 ? 3 : 4 }
        return 0
    }
}
