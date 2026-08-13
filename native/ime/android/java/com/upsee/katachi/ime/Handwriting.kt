package com.upsee.katachi.ime

import java.io.InputStream
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * 手書き検索の照合。**core/handwriting.ts の移植**（iOS は Handwriting.swift）。
 *
 * 描いた画を、KanjiVG 由来のストローク特徴（assets/hw.tsv、生成は web の
 * `npm run build:handwriting`）と突き合わせて似ている字を返す。通信はしない。
 * 認識モデルではなく単純な形の照合なので、端末を選ばず数msで引ける。
 *
 * 3つの実装が同じ候補を同じ順で返せるよう、数値の扱いを TypeScript 側に
 * 揃えてある（崩すと移植どうしがずれる。検証は ime/test/handwriting-cases.tsv）。
 *   - 参照の点は 0〜63 の**整数のまま**持ち、距離を測るときだけ INV63 を掛ける
 *   - 長さは hypot ではなく sqrt(dx*dx+dy*dy)
 *   - 並べ替えはスコアが同点のとき辞書順(id)で割る
 *
 * メモリは全字ぶんを1本の ByteArray に詰めて持つ（6,447字で約2MB）。
 * 1字ごとに配列を作ると小さな確保が2万個できてしまう。
 */
class Handwriting {

    class Match(val ch: String, val score: Double, val strokes: Int)

    private companion object {
        /** 逆向きに書いた画への加点 */
        const val REVERSE_PENALTY = 0.2

        /**
         * 書き順が参照とずれている対応への弱い加点。
         * 見るのは画の**番号の差ではなく、書き進みの割合の差**(続け書きで画が
         * つながると番号だけが遅れるので、番号で測ると続けて書いた人ほど損をする)
         */
        const val ORDER_BIAS = 0.4

        /** 描かれずに余った参照1画あたりの加点。重くすると画数ぴったりの字ばかり上に来る */
        const val EXTRA_REF = 0.02

        /** 対応相手が無い(参照より多く描いた)画の距離 */
        const val UNMATCHED = 0.4

        /**
         * 置き場所のずれをどれだけ重く見るか(形の違いを 1.0 としたとき)。
         * 1画の距離は「重心を合わせたときの形の違い」と「重心のずれ」に分けて測る
         */
        const val POS_WEIGHT = 1.3

        /** 描いた画数との差をどこまで候補にするか */
        const val FEWER_OK = 2
        const val MORE_OK = 6

        /** 続け書き(1画で参照の2画ぶんを書いた)対応への加点 */
        const val MERGE_PENALTY = 0.05

        /** 粗選別で残す数。重心だけの安い距離で足切りしてから本照合する */
        const val PREFILTER = 400

        /** 量子化の段数(0〜63)。参照の1目盛りぶん */
        const val INV63 = 1.0 / 63.0

        val ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"

        /** 64進1文字 -> 0〜63。ASCII の表で引く(HashMap より速い) */
        val CODE = IntArray(128).also { t ->
            for ((i, c) in ALPHABET.withIndex()) t[c.code] = i
        }
    }

    /** 1画あたりの点数。hw.tsv の1行目に入っている */
    private var n = 8

    private var chars: Array<String> = emptyArray()

    /** 全字の点を1本に詰めたもの。字 id の画 j の点 k は pts[ptsAt[id] + j*per + k*2] */
    private var pts = ByteArray(0)
    private var merged = ByteArray(0)
    private var cents = DoubleArray(0)
    private var ptsAt = IntArray(0)
    private var mergedAt = IntArray(0)
    private var centsAt = IntArray(0)
    private var strokeCount = IntArray(0)

    /** 画数 -> その画数の字の id。画数で足切りするために引く */
    private var byCount = HashMap<Int, IntArray>()

    @Volatile
    var ready = false
        private set

    val size: Int get() = chars.size

    /**
     * assets/hw.tsv を読む。1.2MB あるので UI スレッドでは呼ばないこと。
     * 手書きの面を初めて開いたときにだけ読む(使わない人には払わせない)。
     *
     * 面を開いて閉じてまた開く・着せ替えでビューを作り直す、で二重に呼ばれうる。
     * 読み終えていれば何もしない(synchronized なので途中の状態は見えない)。
     */
    @Synchronized
    fun load(stream: InputStream) {
        if (ready) return
        val lines = stream.bufferedReader().readLines()
        if (lines.isEmpty()) return
        n = lines[0].trim().toIntOrNull() ?: 8
        val per = n * 2

        val chs = ArrayList<String>(lines.size)
        val encs = ArrayList<String>(lines.size)
        var totalStrokes = 0
        for (i in 1 until lines.size) {
            val line = lines[i]
            if (line.isEmpty()) continue
            val tab = line.indexOf('\t')
            if (tab <= 0) continue
            val enc = line.substring(tab + 1)
            val m = enc.length / per
            if (m < 1) continue
            chs.add(line.substring(0, tab))
            encs.add(enc)
            totalStrokes += m
        }

        val count = chs.size
        chars = chs.toTypedArray()
        pts = ByteArray(totalStrokes * per)
        // つなげた形は隣り合う画のぶんだけ(1画の字は0本)
        merged = ByteArray(max(0, totalStrokes - count) * per)
        cents = DoubleArray(totalStrokes * 2)
        ptsAt = IntArray(count)
        mergedAt = IntArray(count)
        centsAt = IntArray(count)
        strokeCount = IntArray(count)

        val counts = HashMap<Int, ArrayList<Int>>()
        var pAt = 0
        var mAt = 0
        var cAt = 0
        val joined = DoubleArray(per * 2)
        val out = DoubleArray(per)
        for (id in 0 until count) {
            val enc = encs[id]
            val m = enc.length / per
            ptsAt[id] = pAt
            mergedAt[id] = mAt
            centsAt[id] = cAt
            strokeCount[id] = m
            counts.getOrPut(m) { ArrayList() }.add(id)

            for (k in 0 until m * per) pts[pAt + k] = CODE[enc[k].code].toByte()
            for (s in 0 until m) {
                var cx = 0.0
                var cy = 0.0
                for (k in 0 until n) {
                    cx += pts[pAt + s * per + k * 2].toInt()
                    cy += pts[pAt + s * per + k * 2 + 1].toInt()
                }
                cents[cAt + s * 2] = (cx / n) * INV63
                cents[cAt + s * 2 + 1] = (cy / n) * INV63
            }
            // 続け書き用: 隣り合う2画をつなげ、同じ点数に引き直した形を先に作る
            // (画 s と画 s+1 を続けて1本の折れ線にする＝2画ぶん per*2 個ぶん)
            for (s in 0 until m - 1) {
                for (k in 0 until per * 2) {
                    joined[k] = pts[pAt + s * per + k].toInt() * INV63
                }
                resample(joined, per * 2, out)
                for (k in 0 until per) merged[mAt + s * per + k] = quantize(out[k])
            }
            pAt += m * per
            mAt += max(0, m - 1) * per
            cAt += m * 2
        }
        for ((m, ids) in counts) byCount[m] = ids.toIntArray()
        ready = true
    }

    /**
     * 描いた画から似ている字を返す(スコア昇順)。
     * 画はキャンバス座標のまま渡してよい(正規化はここで行う)。
     * 1画は x,y を交互に並べた DoubleArray。
     */
    fun match(strokes: List<DoubleArray>, limit: Int = 32): List<Match> {
        if (!ready) return emptyList()
        val drawn = strokes.filter { it.size >= 2 }
        if (drawn.isEmpty()) return emptyList()
        val per = n * 2
        val k = drawn.size

        // 参照側と同じ正規化: 全画の外接枠 -> 等倍で 0..1 に中央寄せ
        val q = DoubleArray(k * per)
        val tmp = DoubleArray(per)
        var minX = Double.MAX_VALUE
        var minY = Double.MAX_VALUE
        var maxX = -Double.MAX_VALUE
        var maxY = -Double.MAX_VALUE
        for (i in 0 until k) {
            resample(drawn[i], drawn[i].size, tmp)
            for (p in 0 until n) {
                val x = tmp[p * 2]
                val y = tmp[p * 2 + 1]
                q[i * per + p * 2] = x
                q[i * per + p * 2 + 1] = y
                if (x < minX) minX = x
                if (x > maxX) maxX = x
                if (y < minY) minY = y
                if (y > maxY) maxY = y
            }
        }
        var scale = max(maxX - minX, maxY - minY)
        if (scale == 0.0) scale = 1.0
        val midX = (minX + maxX) / 2
        val midY = (minY + maxY) / 2
        for (i in 0 until k * per step 2) {
            q[i] = 0.5 + (q[i] - midX) / scale
            q[i + 1] = 0.5 + (q[i + 1] - midY) / scale
        }

        val qCents = DoubleArray(k * 2)
        for (i in 0 until k) {
            var cx = 0.0
            var cy = 0.0
            for (p in 0 until n) {
                cx += q[i * per + p * 2]
                cy += q[i * per + p * 2 + 1]
            }
            qCents[i * 2] = cx / n
            qCents[i * 2 + 1] = cy / n
        }

        // 1段目: 画の重心どうしの距離だけで粗く選ぶ(点8つの照合より1桁速い)。
        // 続け書きした画の重心は参照の2画の中間に来るので、隣り合う重心の中点も
        // 比較対象に含める。画数差の罰はここでは掛けない(続け書きの本命が沈む)
        val roughId = ArrayList<Int>(4096)
        val roughCost = ArrayList<Double>(4096)
        for (m in max(1, k - FEWER_OK)..(k + MORE_OK)) {
            val ids = byCount[m] ?: continue
            for (id in ids) {
                val cAt = centsAt[id]
                var total = 0.0
                for (i in 0 until k) {
                    val qx = qCents[i * 2]
                    val qy = qCents[i * 2 + 1]
                    var best = UNMATCHED
                    for (j in 0 until m) {
                        var dx = qx - cents[cAt + j * 2]
                        var dy = qy - cents[cAt + j * 2 + 1]
                        val c = sqrt(dx * dx + dy * dy)
                        if (c < best) best = c
                        if (j + 1 < m) {
                            dx = qx - (cents[cAt + j * 2] + cents[cAt + j * 2 + 2]) / 2
                            dy = qy - (cents[cAt + j * 2 + 1] + cents[cAt + j * 2 + 3]) / 2
                            val cm = sqrt(dx * dx + dy * dy) + MERGE_PENALTY
                            if (cm < best) best = cm
                        }
                    }
                    total += best
                }
                roughId.add(id)
                roughCost.add(total / k)
            }
        }
        // 同点は辞書順(id)で割る。roughId は id の昇順に入っていないので明示する
        val order = roughId.indices.sortedWith(
            compareBy({ roughCost[it] }, { roughId[it] }),
        )

        // 2段目: 残った候補だけ、点列で貪欲に対応づけて本照合。
        // 対応相手は「参照の1画」か「隣り合う2画をつなげた形」(続け書き)のどちらか
        val take = min(order.size, PREFILTER)
        val hits = ArrayList<Match>(take)
        val hitId = IntArray(take)
        val used = BooleanArray(k + MORE_OK + 1)
        for (r in 0 until take) {
            val id = roughId[order[r]]
            val m = strokeCount[id]
            val pAt = ptsAt[id]
            val mAt = mergedAt[id]
            var total = 0.0
            var consumed = 0 // 対応づいた参照側の画数(続け書きは2と数える)
            java.util.Arrays.fill(used, 0, m, false)
            val jStep = if (m > 1) 1.0 / (m - 1) else 0.0
            val iStep = if (k > 1) 1.0 / (k - 1) else 0.0
            for (i in 0 until k) {
                val iAt = i * iStep
                var best = UNMATCHED
                var bestJ = -1
                var bestMerge = false
                for (j in 0 until m) {
                    if (used[j]) continue
                    val bias = ORDER_BIAS * abs(iAt - j * jStep)
                    val c = strokeDist(q, i * per, pts, pAt + j * per) + bias
                    if (c < best) {
                        best = c
                        bestJ = j
                        bestMerge = false
                    }
                    if (j + 1 < m && !used[j + 1]) {
                        val cm = strokeDist(q, i * per, merged, mAt + j * per) +
                            MERGE_PENALTY + bias
                        if (cm < best) {
                            best = cm
                            bestJ = j
                            bestMerge = true
                        }
                    }
                }
                if (bestJ >= 0) {
                    used[bestJ] = true
                    consumed++
                    if (bestMerge) {
                        used[bestJ + 1] = true
                        consumed++
                    }
                }
                total += best
            }
            // 対応が残らなかった参照の画(=描かれなかったぶん)だけを咎める
            hitId[r] = id
            hits.add(Match(chars[id], total / k + (m - consumed) * EXTRA_REF, m))
        }
        return hits.indices
            .sortedWith(compareBy({ hits[it].score }, { hitId[it] }))
            .take(limit)
            .map { hits[it] }
    }

    /**
     * 1画の距離。逆向きに書いた画も小さな加点で許す。
     * 形の違い(重心を合わせたときの点どうしの差)と、重心そのもののずれに分けて測る
     */
    private fun strokeDist(q: DoubleArray, qAt: Int, ref: ByteArray, refAt: Int): Double {
        // それぞれの重心
        var qx = 0.0
        var qy = 0.0
        var rx = 0.0
        var ry = 0.0
        for (k in 0 until n) {
            qx += q[qAt + k * 2]
            qy += q[qAt + k * 2 + 1]
            rx += ref[refAt + k * 2].toInt()
            ry += ref[refAt + k * 2 + 1].toInt()
        }
        qx /= n
        qy /= n
        rx = (rx / n) * INV63
        ry = (ry / n) * INV63
        val ox = qx - rx
        val oy = qy - ry
        val pos = sqrt(ox * ox + oy * oy)

        // 重心を合わせたうえでの形の違い(前向き・逆向きの近いほう)
        var fwd = 0.0
        var rev = 0.0
        for (k in 0 until n) {
            val ax = q[qAt + k * 2] - qx
            val ay = q[qAt + k * 2 + 1] - qy
            var dx = ax - (ref[refAt + k * 2].toInt() * INV63 - rx)
            var dy = ay - (ref[refAt + k * 2 + 1].toInt() * INV63 - ry)
            fwd += sqrt(dx * dx + dy * dy)
            val r = refAt + (n - 1 - k) * 2
            dx = ax - (ref[r].toInt() * INV63 - rx)
            dy = ay - (ref[r + 1].toInt() * INV63 - ry)
            rev += sqrt(dx * dx + dy * dy)
        }
        return min(fwd / n, rev / n + REVERSE_PENALTY) + POS_WEIGHT * pos
    }

    /**
     * 折れ線(x,y の交互)を弧長で等間隔 n 点に間引く。
     * src の先頭 count 個だけを見て、out(n*2)へ書く。
     */
    private fun resample(src: DoubleArray, count: Int, out: DoubleArray) {
        val points = count / 2
        if (points <= 0) return
        if (points == 1) {
            for (k in 0 until n) {
                out[k * 2] = src[0]
                out[k * 2 + 1] = src[1]
            }
            return
        }
        val acc = DoubleArray(points)
        for (i in 1 until points) {
            val dx = src[i * 2] - src[(i - 1) * 2]
            val dy = src[i * 2 + 1] - src[(i - 1) * 2 + 1]
            acc[i] = acc[i - 1] + sqrt(dx * dx + dy * dy)
        }
        val total = acc[points - 1]
        var j = 0
        for (k in 0 until n) {
            val target = total * k / (n - 1)
            while (j < points - 2 && acc[j + 1] < target) j++
            val seg = acc[j + 1] - acc[j]
            val t = if (seg > 0) (target - acc[j]) / seg else 0.0
            out[k * 2] = src[j * 2] + (src[(j + 1) * 2] - src[j * 2]) * t
            out[k * 2 + 1] = src[j * 2 + 1] + (src[(j + 1) * 2 + 1] - src[j * 2 + 1]) * t
        }
    }

    /** 0〜1 を 0〜63 の目盛りへ。丸めは3実装で同じ規則(正の値の四捨五入) */
    private fun quantize(v: Double): Byte {
        val q = Math.round(v * 63).toInt()
        return (if (q < 0) 0 else if (q > 63) 63 else q).toByte()
    }
}
