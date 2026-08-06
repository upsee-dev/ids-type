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
        var cuts: [Int] = []
        var i = from
        while i < to {
            if p[i] == tab { cuts.append(i) }
            i += 1
        }
        guard cuts.count >= (hasMeta ? 5 : 1) else { return }

        let c0 = Int32(from) + base, c1 = Int32(cuts[0]) + base
        // ja は char\tids\tgrade… と続くので ids は次のタブまで。
        // ext は char\tids だけなので行末まで
        let c1end = hasMeta ? cuts[1] : to
        let i0 = Int32(cuts[0] + 1) + base, i1 = Int32(c1end) + base

        let idx = charStart.count
        charStart.append(c0); charEnd.append(c1)
        idsStart.append(i0); idsEnd.append(i1)

        if hasMeta {
            grade.append(UInt8(clamping: int(p, cuts[1] + 1, cuts[2])))
            freq.append(Int32(clamping: int(p, cuts[2] + 1, cuts[3])))
            // 音読み(cuts[3]の次)から行末までが読み。訓読みとの間のタブは
            // 突き合わせのときに空白と同じ「区切り」として効くので残しておく
            readStart.append(Int32(cuts[3] + 1) + base)
            readEnd.append(Int32(to) + base)
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
