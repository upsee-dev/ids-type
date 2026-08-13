import Foundation

/// 手書き検索の照合。**core/handwriting.ts の移植**（Android は Handwriting.kt）。
///
/// 描いた画を、KanjiVG 由来のストローク特徴（hw.tsv、生成は web の
/// `npm run build:handwriting`）と突き合わせて似ている字を返す。通信はしない。
/// 認識モデルではなく単純な形の照合なので、端末を選ばず数msで引ける。
///
/// 3つの実装が同じ候補を同じ順で返せるよう、数値の扱いを TypeScript 側に
/// 揃えてある（崩すと移植どうしがずれる。検証は ime/test/handwriting-cases.tsv）。
///   - 参照の点は 0〜63 の**整数のまま**持ち、距離を測るときだけ INV63 を掛ける
///   - 長さは hypot ではなく sqrt(dx*dx+dy*dy)
///   - 並べ替えはスコアが同点のとき辞書順(id)で割る。**Swift の sort は安定では
///     ない**ので、同点の順序を実装任せにしない
///
/// **拡張のメモリ上限は約60MB**。全字ぶんを1本の [UInt8] に詰めて持つ
/// （6,447字で約2.2MB）。1字ごとに配列を作ると小さな確保が2万個できてしまう。
final class Handwriting {

    struct Match {
        let ch: String
        let score: Double
        let strokes: Int
    }

    /// 逆向きに書いた画への加点
    private static let reversePenalty = 0.12
    /// 書き順が参照とずれている対応への、1画あたりの弱い加点
    private static let orderBias = 0.012
    /// 描かれずに余った参照1画あたりの加点
    private static let extraRef = 0.05
    /// 対応相手が無い(参照より多く描いた)画の距離
    private static let unmatched = 0.6
    /// 描いた画数との差をどこまで候補にするか
    private static let fewerOK = 2
    private static let moreOK = 6
    /// 続け書き(1画で参照の2画ぶんを書いた)対応への加点
    private static let mergePenalty = 0.05
    /// 粗選別で残す数。重心だけの安い距離で足切りしてから本照合する
    private static let prefilter = 400
    /// 量子化の段数(0〜63)。参照の1目盛りぶん
    private static let inv63 = 1.0 / 63.0

    private static let alphabet = Array(
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_".utf8,
    )

    /// 64進1文字 -> 0〜63。ASCII の表で引く
    private static let code: [UInt8] = {
        var t = [UInt8](repeating: 0, count: 128)
        for (i, c) in alphabet.enumerated() { t[Int(c)] = UInt8(i) }
        return t
    }()

    /// 1画あたりの点数。hw.tsv の1行目に入っている
    private var n = 8

    private var chars: [String] = []
    /// 全字の点を1本に詰めたもの
    private var pts: [UInt8] = []
    private var merged: [UInt8] = []
    private var cents: [Double] = []
    private var ptsAt: [Int32] = []
    private var mergedAt: [Int32] = []
    private var centsAt: [Int32] = []
    private var strokeCount: [Int32] = []
    /// 画数 -> その画数の字の id
    private var byCount: [Int: [Int32]] = [:]

    private(set) var ready = false
    var size: Int { chars.count }

    // MARK: - 読み込み

    /// 手書きの面を初めて開いたときにだけ読む(使わない人には払わせない)。
    /// 1.2MB あるので UI スレッドでは呼ばないこと。
    func load(bundle: Bundle = .main) {
        load(url: bundle.url(forResource: "hw", withExtension: "tsv"))
    }

    /// URL 直指定版。コマンドラインから照合を検証するために切り出してある。
    /// 面を開いて閉じてまた開く、で二重に呼ばれうるので読み終えていれば何もしない
    func load(url: URL?) {
        guard !ready else { return }
        guard let url, let data = try? Data(contentsOf: url, options: .mappedIfSafe) else { return }

        let per = { () -> Int in
            // 1行目が1画あたりの点数
            var i = 0
            var v = 0
            while i < data.count, data[i] != 0x0A {
                if data[i] >= 0x30, data[i] <= 0x39 { v = v * 10 + Int(data[i] - 0x30) }
                i += 1
            }
            if v > 0 { n = v }
            return n * 2
        }()

        // 点のバイト数はファイルの大きさをほぼそのまま使える(1点=2文字)
        pts.reserveCapacity(data.count)
        merged.reserveCapacity(data.count)
        var counts: [Int: [Int32]] = [:]

        data.withUnsafeBytes { raw in
            let p = raw.bindMemory(to: UInt8.self)
            var i = 0
            // 1行目(点数)を読み飛ばす
            while i < p.count, p[i] != 0x0A { i += 1 }
            i += 1

            var joined = [Double](repeating: 0, count: per * 2)
            var out = [Double](repeating: 0, count: per)

            while i < p.count {
                var lineEnd = i
                while lineEnd < p.count, p[lineEnd] != 0x0A { lineEnd += 1 }
                defer { i = lineEnd + 1 }
                guard lineEnd > i else { continue }
                var tab = i
                while tab < lineEnd, p[tab] != 0x09 { tab += 1 }
                guard tab > i, tab < lineEnd else { continue }
                let m = (lineEnd - tab - 1) / per
                guard m >= 1 else { continue }

                let ch = String(
                    decoding: UnsafeBufferPointer(start: p.baseAddress! + i, count: tab - i),
                    as: UTF8.self,
                )
                let id = Int32(chars.count)
                chars.append(ch)
                ptsAt.append(Int32(pts.count))
                mergedAt.append(Int32(merged.count))
                centsAt.append(Int32(cents.count))
                strokeCount.append(Int32(m))
                counts[m, default: []].append(id)

                let base = pts.count
                for k in 0..<(m * per) { pts.append(Self.code[Int(p[tab + 1 + k])]) }
                for s in 0..<m {
                    var cx = 0.0
                    var cy = 0.0
                    for k in 0..<n {
                        cx += Double(pts[base + s * per + k * 2])
                        cy += Double(pts[base + s * per + k * 2 + 1])
                    }
                    cents.append((cx / Double(n)) * Self.inv63)
                    cents.append((cy / Double(n)) * Self.inv63)
                }
                // 続け書き用: 隣り合う2画をつなげ、同じ点数に引き直した形を先に作る
                // (画 s と画 s+1 を続けて1本の折れ線にする＝2画ぶん per*2 個ぶん)
                if m >= 2 {
                    for s in 0..<(m - 1) {
                        for k in 0..<(per * 2) {
                            joined[k] = Double(pts[base + s * per + k]) * Self.inv63
                        }
                        resample(joined, per * 2, &out)
                        for k in 0..<per { merged.append(Self.quantize(out[k])) }
                    }
                }
            }
        }
        byCount = counts
        ready = true
    }

    // MARK: - 照合

    /// 描いた画から似ている字を返す(スコア昇順)。
    /// 画はキャンバス座標のまま渡してよい(正規化はここで行う)。
    /// 1画は x,y を交互に並べた [Double]。
    func match(_ strokes: [[Double]], limit: Int = 32) -> [Match] {
        guard ready else { return [] }
        let drawn = strokes.filter { $0.count >= 2 }
        guard !drawn.isEmpty else { return [] }
        let per = n * 2
        let k = drawn.count

        // 参照側と同じ正規化: 全画の外接枠 -> 等倍で 0..1 に中央寄せ
        var q = [Double](repeating: 0, count: k * per)
        var tmp = [Double](repeating: 0, count: per)
        var minX = Double.greatestFiniteMagnitude
        var minY = Double.greatestFiniteMagnitude
        var maxX = -Double.greatestFiniteMagnitude
        var maxY = -Double.greatestFiniteMagnitude
        for i in 0..<k {
            resample(drawn[i], drawn[i].count, &tmp)
            for p in 0..<n {
                let x = tmp[p * 2]
                let y = tmp[p * 2 + 1]
                q[i * per + p * 2] = x
                q[i * per + p * 2 + 1] = y
                minX = Swift.min(minX, x)
                maxX = Swift.max(maxX, x)
                minY = Swift.min(minY, y)
                maxY = Swift.max(maxY, y)
            }
        }
        var scale = Swift.max(maxX - minX, maxY - minY)
        if scale == 0 { scale = 1 }
        let midX = (minX + maxX) / 2
        let midY = (minY + maxY) / 2
        for i in stride(from: 0, to: k * per, by: 2) {
            q[i] = 0.5 + (q[i] - midX) / scale
            q[i + 1] = 0.5 + (q[i + 1] - midY) / scale
        }

        var qCents = [Double](repeating: 0, count: k * 2)
        for i in 0..<k {
            var cx = 0.0
            var cy = 0.0
            for p in 0..<n {
                cx += q[i * per + p * 2]
                cy += q[i * per + p * 2 + 1]
            }
            qCents[i * 2] = cx / Double(n)
            qCents[i * 2 + 1] = cy / Double(n)
        }

        // 1段目: 画の重心どうしの距離だけで粗く選ぶ(点8つの照合より1桁速い)。
        // 続け書きした画の重心は参照の2画の中間に来るので、隣り合う重心の中点も
        // 比較対象に含める。画数差の罰はここでは掛けない(続け書きの本命が沈む)
        var rough: [(id: Int32, cost: Double)] = []
        rough.reserveCapacity(4096)
        cents.withUnsafeBufferPointer { cs in
            for m in Swift.max(1, k - Self.fewerOK)...(k + Self.moreOK) {
                guard let ids = byCount[m] else { continue }
                for id in ids {
                    let cAt = Int(centsAt[Int(id)])
                    var total = 0.0
                    for i in 0..<k {
                        let qx = qCents[i * 2]
                        let qy = qCents[i * 2 + 1]
                        var best = Self.unmatched
                        for j in 0..<m {
                            var dx = qx - cs[cAt + j * 2]
                            var dy = qy - cs[cAt + j * 2 + 1]
                            let c = (dx * dx + dy * dy).squareRoot()
                            if c < best { best = c }
                            if j + 1 < m {
                                dx = qx - (cs[cAt + j * 2] + cs[cAt + j * 2 + 2]) / 2
                                dy = qy - (cs[cAt + j * 2 + 1] + cs[cAt + j * 2 + 3]) / 2
                                let cm = (dx * dx + dy * dy).squareRoot() + Self.mergePenalty
                                if cm < best { best = cm }
                            }
                        }
                        total += best
                    }
                    rough.append((id, total / Double(k)))
                }
            }
        }
        // 同点は辞書順(id)で割る。Swift の sort は安定ではないので明示する
        rough.sort { $0.cost != $1.cost ? $0.cost < $1.cost : $0.id < $1.id }

        // 2段目: 残った候補だけ、点列で貪欲に対応づけて本照合。
        // 対応相手は「参照の1画」か「隣り合う2画をつなげた形」(続け書き)のどちらか
        let take = Swift.min(rough.count, Self.prefilter)
        var scored: [(id: Int32, score: Double, m: Int)] = []
        scored.reserveCapacity(take)
        var used = [Bool](repeating: false, count: k + Self.moreOK + 1)
        q.withUnsafeBufferPointer { qp in
            pts.withUnsafeBufferPointer { pp in
                merged.withUnsafeBufferPointer { mp in
                    for r in 0..<take {
                        let id = rough[r].id
                        let m = Int(strokeCount[Int(id)])
                        let pAt = Int(ptsAt[Int(id)])
                        let mAt = Int(mergedAt[Int(id)])
                        var total = 0.0
                        var consumed = 0 // 対応づいた参照側の画数(続け書きは2と数える)
                        for j in 0..<m { used[j] = false }
                        for i in 0..<k {
                            var best = Self.unmatched
                            var bestJ = -1
                            var bestMerge = false
                            for j in 0..<m {
                                if used[j] { continue }
                                let bias = Self.orderBias * Double(abs(i - j))
                                let c = strokeDist(qp, i * per, pp, pAt + j * per) + bias
                                if c < best {
                                    best = c
                                    bestJ = j
                                    bestMerge = false
                                }
                                if j + 1 < m, !used[j + 1] {
                                    let cm = strokeDist(qp, i * per, mp, mAt + j * per)
                                        + Self.mergePenalty + bias
                                    if cm < best {
                                        best = cm
                                        bestJ = j
                                        bestMerge = true
                                    }
                                }
                            }
                            if bestJ >= 0 {
                                used[bestJ] = true
                                consumed += 1
                                if bestMerge {
                                    used[bestJ + 1] = true
                                    consumed += 1
                                }
                            }
                            total += best
                        }
                        // 対応が残らなかった参照の画(=描かれなかったぶん)だけを咎める
                        let score = total / Double(k) + Double(m - consumed) * Self.extraRef
                        scored.append((id, score, m))
                    }
                }
            }
        }
        scored.sort { $0.score != $1.score ? $0.score < $1.score : $0.id < $1.id }
        return scored.prefix(limit).map {
            Match(ch: chars[Int($0.id)], score: $0.score, strokes: $0.m)
        }
    }

    /// 1画の距離。逆向きに書いた画も小さな加点で許す
    private func strokeDist(
        _ q: UnsafeBufferPointer<Double>, _ qAt: Int,
        _ ref: UnsafeBufferPointer<UInt8>, _ refAt: Int,
    ) -> Double {
        var fwd = 0.0
        var rev = 0.0
        for k in 0..<n {
            let ax = q[qAt + k * 2]
            let ay = q[qAt + k * 2 + 1]
            var dx = ax - Double(ref[refAt + k * 2]) * Self.inv63
            var dy = ay - Double(ref[refAt + k * 2 + 1]) * Self.inv63
            fwd += (dx * dx + dy * dy).squareRoot()
            let r = refAt + (n - 1 - k) * 2
            dx = ax - Double(ref[r]) * Self.inv63
            dy = ay - Double(ref[r + 1]) * Self.inv63
            rev += (dx * dx + dy * dy).squareRoot()
        }
        return Swift.min(fwd / Double(n), rev / Double(n) + Self.reversePenalty)
    }

    /// 折れ線(x,y の交互)を弧長で等間隔 n 点に間引く。
    /// src の先頭 count 個だけを見て、out(n*2)へ書く。
    private func resample(_ src: [Double], _ count: Int, _ out: inout [Double]) {
        let points = count / 2
        guard points > 0 else { return }
        if points == 1 {
            for k in 0..<n {
                out[k * 2] = src[0]
                out[k * 2 + 1] = src[1]
            }
            return
        }
        var acc = [Double](repeating: 0, count: points)
        for i in 1..<points {
            let dx = src[i * 2] - src[(i - 1) * 2]
            let dy = src[i * 2 + 1] - src[(i - 1) * 2 + 1]
            acc[i] = acc[i - 1] + (dx * dx + dy * dy).squareRoot()
        }
        let total = acc[points - 1]
        var j = 0
        for k in 0..<n {
            let target = total * Double(k) / Double(n - 1)
            while j < points - 2, acc[j + 1] < target { j += 1 }
            let seg = acc[j + 1] - acc[j]
            let t = seg > 0 ? (target - acc[j]) / seg : 0
            out[k * 2] = src[j * 2] + (src[(j + 1) * 2] - src[j * 2]) * t
            out[k * 2 + 1] = src[j * 2 + 1] + (src[(j + 1) * 2 + 1] - src[j * 2 + 1]) * t
        }
    }

    /// 0〜1 を 0〜63 の目盛りへ。丸めは3実装で同じ規則(正の値の四捨五入)
    private static func quantize(_ v: Double) -> UInt8 {
        let q = (v * 63).rounded()
        return UInt8(q < 0 ? 0 : (q > 63 ? 63 : q))
    }
}
