import Foundation

/// 辞書。バンドル内のタブ区切りテキストを読む。
///
/// **iOS のキーボード拡張はメモリ上限が約60MB**しかない。10万字を Swift の String
/// として持つと、1文字あたりのオーバーヘッド(ヒープ確保＋参照カウント)だけで
/// 上限に近づく。そこで読み込んだ UTF-8 を1本の Data のまま抱え、
/// 各字・各IDSは「その中のバイト範囲」だけを Int32 で覚える。
/// String を作るのは実際に画面へ出す数十件だけにする。
final class Dict {

    /// 読み込んだ tsv 本体(ここだけがメモリを食う)
    private var blob = Data()

    /// 各エントリの範囲。char と ids の [開始, 終了) をバイト位置で持つ
    private var charStart: [Int32] = []
    private var charEnd: [Int32] = []
    private var idsStart: [Int32] = []
    private var idsEnd: [Int32] = []
    private var grade: [UInt8] = []
    private var freq: [Int32] = []

    /// 音読み＋訓読みの範囲(KANJIDIC2 収録字だけ)。読みから部品を引くのに使う。
    /// 中はタブ区切りのまま持ち、String にするのは突き合わせるときだけにする
    private var readStart: [Int32] = []
    private var readEnd: [Int32] = []

    /// 人名でだけ使う読み(nanori)の範囲。KANJIDIC2 収録字だけ
    private var nanoriStart: [Int32] = []
    private var nanoriEnd: [Int32] = []

    /// 参考・推定の読みの範囲。**拡張漢字も含めた全字ぶん**持つ
    /// (KANJIDIC2 が読みを持つのは13,108字だけなので、これが無いと
    ///  残り9万字は読みでは一生引けない。作り方は build-data/readings.mts)
    private var refStart: [Int32] = []
    private var refEnd: [Int32] = []

    /// 参考の読みの出所。0=なし 1=資料(Unihan) 2=異体字から 3=部品(声符)から推定。
    /// どの字から借りたかまでは要らない(キーボードは並べ替えにしか使わない)ので
    /// 1バイトに畳む
    private var refKind: [UInt8] = []

    /// 総画数。**拡張漢字も含めた全字ぶん**持つ(Unihan の kTotalStrokes)。
    /// 最大でも84画なので1バイトで足りる。0=データなし
    private var strokes: [UInt8] = []

    /// 別の分解(空白区切り)の範囲。同じ字でも表によって切り方が違うので
    /// (丟 = ⿱王厶 / ⿱一去)、**どの組み合わせで打っても引ける**よう控えてある。
    /// 作り方は web/scripts/build-data/merge.mts
    private var altStart: [Int32] = []
    private var altEnd: [Int32] = []

    /// 字(String) -> 添字。検索の閉包計算で引くので、これは作らざるを得ない
    private var index: [String: Int] = [:]

    /// 分解だけ持つ部品(候補には出さない)
    private var partIds: [String: String] = [:]

    /// KANJIDIC2 収録字の数。これ以降の添字は拡張漢字
    private(set) var jaCount = 0
    private(set) var extLoaded = false

    var count: Int { charStart.count }

    // MARK: - 参照

    func char(at i: Int) -> String { string(charStart[i], charEnd[i]) }
    func ids(at i: Int) -> String { string(idsStart[i], idsEnd[i]) }
    func isExt(_ i: Int) -> Bool { i >= jaCount }
    func grade(at i: Int) -> Int { i < jaCount ? Int(grade[i]) : 0 }
    func freq(at i: Int) -> Int { i < jaCount ? Int(freq[i]) : 0 }

    /// 音読み・訓読みをつないだもの(例: "メイ ミョウ\tあ.かり あか.るい")。
    /// 拡張漢字は KANJIDIC2 に無いので空
    func readings(at i: Int) -> String {
        i < jaCount ? string(readStart[i], readEnd[i]) : ""
    }

    /// 人名でだけ使う読み。正式な音訓ではない
    func nanori(at i: Int) -> String {
        i < jaCount ? string(nanoriStart[i], nanoriEnd[i]) : ""
    }

    /// 参考・推定の読み。正式な読みが無い字の手がかり
    func ref(at i: Int) -> String {
        i < refStart.count ? string(refStart[i], refEnd[i]) : ""
    }

    /// ref の出所。0=なし 1=資料 2=異体字 3=推定(声符)
    func refKind(at i: Int) -> Int { i < refKind.count ? Int(refKind[i]) : 0 }

    /// 総画数。0=データなし
    func strokes(at i: Int) -> Int { i < strokes.count ? Int(strokes[i]) : 0 }

    /// その字の分解ぜんぶ(主＋別の分解)。並びは辞書のまま＝主が先。
    /// TypeScript/Kotlin 版と候補の並びを揃えるため、この順番は変えないこと
    func idsList(of ch: String) -> [String] {
        guard let i = index[ch] else {
            if let p = partIds[ch] { return [p] }
            return []
        }
        let primary = ids(at: i)
        if primary.isEmpty { return [] }
        guard i < altStart.count else { return [primary] }
        let a = string(altStart[i], altEnd[i])
        if a.isEmpty { return [primary] }
        return [primary] + a.split(separator: " ").map(String.init)
    }
    func index(of ch: String) -> Int? { index[ch] }

    func ids(of ch: String) -> String? {
        if let i = index[ch] { return ids(at: i) }
        return partIds[ch]
    }

    private func string(_ from: Int32, _ to: Int32) -> String {
        guard to > from else { return "" }
        return blob.withUnsafeBytes { raw -> String in
            let base = raw.bindMemory(to: UInt8.self).baseAddress! + Int(from)
            return String(decoding: UnsafeBufferPointer(start: base, count: Int(to - from)), as: UTF8.self)
        }
    }

    // MARK: - 読み込み

    /// 1段目。これが終われば日本語の漢字は引ける
    func loadJapanese(bundle: Bundle = .main) {
        loadJapanese(
            ja: bundle.url(forResource: "dict-ja", withExtension: "tsv"),
            parts: bundle.url(forResource: "dict-parts", withExtension: "tsv"),
        )
    }

    /// 2段目。拡張漢字。候補の後ろに付くだけなので遅れて読んでよい
    func loadExtensions(bundle: Bundle = .main) {
        loadExtensions(ext: bundle.url(forResource: "dict-ext", withExtension: "tsv"))
    }

    // ↓ URL 直指定版。コマンドラインからエンジンを検証するために切り出してある
    func loadJapanese(ja: URL?, parts: URL?) {
        guard let ja, let data = try? Data(contentsOf: ja, options: .mappedIfSafe) else { return }
        append(data, hasMeta: true)
        jaCount = charStart.count

        if let parts, let text = try? String(contentsOf: parts, encoding: .utf8) {
            for line in text.split(separator: "\n") {
                let f = line.split(separator: "\t", omittingEmptySubsequences: false)
                if f.count >= 2 { partIds[String(f[0])] = String(f[1]) }
            }
        }
    }

    func loadExtensions(ext: URL?) {
        guard let ext, let data = try? Data(contentsOf: ext, options: .mappedIfSafe) else { return }
        append(data, hasMeta: false)
        extLoaded = true
    }

    /// tsv を1本の blob に足しつつ、各フィールドのバイト位置を控える
    private func append(_ data: Data, hasMeta: Bool) {
        let base = Int32(blob.count)
        blob.append(data)

        let tab = UInt8(0x09), nl = UInt8(0x0A)
        data.withUnsafeBytes { raw in
            let p = raw.bindMemory(to: UInt8.self)
            var lineStart = 0
            var i = 0
            let n = p.count
            while i <= n {
                if i == n || p[i] == nl {
                    if i > lineStart {
                        parse(p, lineStart, i, base: base, hasMeta: hasMeta, tab: tab)
                    }
                    lineStart = i + 1
                }
                i += 1
            }
        }
    }

    private func parse(
        _ p: UnsafeBufferPointer<UInt8>, _ from: Int, _ to: Int,
        base: Int32, hasMeta: Bool, tab: UInt8
    ) {
        // フィールドの区切り位置を集める
        //   ja  : char\tids\tgrade\tfreq\ton\tkun\t人名\t参考\t参考の出所\t画数\t別の分解
        //   ext : char\tids\t参考\t参考の出所\t画数\t別の分解
        var cuts: [Int] = []
        var i = from
        while i < to {
            if p[i] == tab { cuts.append(i) }
            i += 1
        }
        guard cuts.count >= (hasMeta ? 5 : 1) else { return }

        let c0 = Int32(from) + base, c1 = Int32(cuts[0]) + base
        // ja は char\tids\tgrade… と続くので ids は次のタブまで。
        // ext は char\tids\t参考… なので、読みの列があるならその手前まで
        let c1end = hasMeta ? cuts[1] : (cuts.count >= 2 ? cuts[1] : to)
        let i0 = Int32(cuts[0] + 1) + base, i1 = Int32(c1end) + base

        let idx = charStart.count
        charStart.append(c0); charEnd.append(c1)
        idsStart.append(i0); idsEnd.append(i1)

        /// 読みの列の範囲。列が足りない古い辞書でも落ちないよう空を返す
        func span(_ n: Int) -> (Int32, Int32) {
            guard cuts.count > n else { return (0, 0) }
            let end = cuts.count > n + 1 ? cuts[n + 1] : to
            return (Int32(cuts[n] + 1) + base, Int32(end) + base)
        }

        if hasMeta {
            grade.append(UInt8(clamping: int(p, cuts[1] + 1, cuts[2])))
            freq.append(Int32(clamping: int(p, cuts[2] + 1, cuts[3])))
            // 音読み(cuts[3]の次)から訓読みの終わりまでが正式な読み。
            // 音と訓の間のタブは、突き合わせのときに空白と同じ「区切り」として効く
            let onKunEnd = cuts.count > 5 ? cuts[5] : to
            readStart.append(Int32(cuts[3] + 1) + base)
            readEnd.append(Int32(onKunEnd) + base)
            let (ns, ne) = span(5)
            nanoriStart.append(ns); nanoriEnd.append(ne)
            let (rs, re) = span(6)
            refStart.append(rs); refEnd.append(re)
            refKind.append(kindCode(p, cuts.count > 7 ? cuts[7] + 1 : to, to))
            // 画数と別の分解は後ろの列。列が無い古い辞書では 0 / 空
            strokes.append(
                UInt8(clamping: cuts.count > 8 ? int(p, cuts[8] + 1, to) : 0),
            )
            let (as9, ae9) = span(9)
            altStart.append(as9); altEnd.append(ae9)
        } else {
            let (rs, re) = span(1)
            refStart.append(rs); refEnd.append(re)
            refKind.append(kindCode(p, cuts.count > 2 ? cuts[2] + 1 : to, to))
            strokes.append(
                UInt8(clamping: cuts.count > 3 ? int(p, cuts[3] + 1, to) : 0),
            )
            let (as4, ae4) = span(4)
            altStart.append(as4); altEnd.append(ae4)
        }
        // Swift の String は正規等価で比較・ハッシュする。互換漢字(U+F902 車)は
        // 統合漢字(U+8ECA 車)と等価判定されるので、素直に代入すると後から読む
        // 拡張漢字が日本語の字の索引を上書きし、IDS を潰してしまう
        // (車 の分解が ⿻亘丨 から失われ、輸・輔・轍 が候補に出なくなる)。
        // 辞書は「KANJIDIC2 収録字 → それ以外」の順に読むので、先勝ちにする。
        // JS/Kotlin は UTF-16 単位の比較なのでこの問題は起きない。
        let key = string(c0, c1)
        if index[key] == nil { index[key] = idx }
    }

    /// 参考の読みの出所を1バイトに畳む。"u"=1(資料) "v"=2(異体字) "p"=3(推定)
    private func kindCode(_ p: UnsafeBufferPointer<UInt8>, _ from: Int, _ to: Int) -> UInt8 {
        guard from < to else { return 0 }
        switch p[from] {
        case UInt8(ascii: "u"): return 1
        case UInt8(ascii: "v"): return 2
        case UInt8(ascii: "p"): return 3
        default: return 0
        }
    }

    private func int(_ p: UnsafeBufferPointer<UInt8>, _ from: Int, _ to: Int) -> Int {
        var v = 0
        var i = from
        while i < to, p[i] >= 0x30, p[i] <= 0x39 {
            v = v * 10 + Int(p[i] - 0x30)
            i += 1
        }
        return v
    }
}
