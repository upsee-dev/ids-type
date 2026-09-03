package com.upsee.katachi.ime

import android.content.Context
import java.io.BufferedReader

/**
 * 辞書。assets のタブ区切りテキストを読む。
 *
 * キーボードは呼ばれた瞬間に出ないと使えないので、
 *   1. まず日本語の字(13,108字)だけ読んで検索可能にする
 *   2. 拡張漢字(89,890字)はその後ろで読み足す
 * の2段構えにしている。読み終わる前に打ち始めても、日本語の字は既に引ける。
 *
 * 並びは TypeScript 側と同じ「KANJIDIC2 収録字 → それ以外」。同点のときの
 * 並び順がこの順序に依存するので、読み込む順番を入れ替えないこと。
 * (参考の読み ref は拡張漢字も持つので、添字が chars と揃うよう
 *  どちらの読み込みでも必ず1行につき1つ足す)
 */
class Dict {

    /** 候補になる字。日本語の字が先、拡張漢字が後ろ */
    val chars = ArrayList<String>(103_000)
    val ids = ArrayList<String>(103_000)
    private val grade = ArrayList<Int>(13_200)
    private val freq = ArrayList<Int>(13_200)
    private val on = ArrayList<String>(13_200)
    private val kun = ArrayList<String>(13_200)

    /** 人名でだけ使う読み(KANJIDIC2 の nanori)。KANJIDIC2 収録字だけ持つ */
    private val nanori = ArrayList<String>(13_200)

    /**
     * 参考・推定の読みと、その出所。**拡張漢字も含めた全字ぶん**持つ。
     * KANJIDIC2 が読みを持つのは13,108字だけなので、これが無いと
     * 残り9万字は読みでは一生引けない(作り方は web/scripts/build-data/readings.mts)
     */
    private val ref = ArrayList<String>(103_000)
    private val refKind = ArrayList<String>(103_000)

    /**
     * 総画数。**拡張漢字も含めた全字ぶん**持つ(Unihan の kTotalStrokes)。
     * KANJIDIC2 の画数は13,108字ぶんしか無いので、これが無いと
     * 「読み＋画数で絞る」が日本の字にしか効かない。
     * 値は1〜84なので Integer のキャッシュに収まり、箱詰めしても増えるのは参照だけ
     */
    private val strokes = ArrayList<Int>(103_000)

    /**
     * 別の分解(空白区切り。無ければ "")。同じ字でも表によって切り方が違うので
     * (丟 = ⿱王厶 / ⿱一去)、**どの組み合わせで打っても引ける**よう控えてある。
     * 作り方は web/scripts/build-data/merge.mts
     */
    private val alt = ArrayList<String>(103_000)

    /** 字 -> chars 内の添字 */
    private val index = HashMap<String, Int>(140_000)

    /** 分解だけ持つ部品(候補には出さない) */
    private val partIds = HashMap<String, String>(16)

    /** KANJIDIC2 収録字の数。これ以降の添字は拡張漢字 */
    var jaCount = 0
        private set

    @Volatile
    var extLoaded = false
        private set

    fun indexOf(ch: String): Int? = index[ch]
    fun idsOf(ch: String): String? = index[ch]?.let { ids[it] } ?: partIds[ch]
    fun gradeAt(i: Int) = if (i < jaCount) grade[i] else 0
    fun freqAt(i: Int) = if (i < jaCount) freq[i] else 0
    fun onAt(i: Int) = if (i < jaCount) on[i] else ""
    fun kunAt(i: Int) = if (i < jaCount) kun[i] else ""

    /** 人名でだけ使う読み。正式な音訓ではない */
    fun nanoriAt(i: Int) = if (i < jaCount) nanori[i] else ""

    /** 参考・推定の読み。正式な読みが無い字の手がかり */
    fun refAt(i: Int) = if (i < ref.size) ref[i] else ""

    /** ref の出所。"u"=資料 / "v:X"=異体字 / "p:X"=部品(声符)からの推定 */
    fun refKindAt(i: Int) = if (i < refKind.size) refKind[i] else ""

    /** 総画数。0=データなし */
    fun strokesAt(i: Int) = if (i < strokes.size) strokes[i] else 0

    /**
     * その字の分解ぜんぶ(主＋別の分解)。並びは辞書のまま＝主が先。
     * TypeScript/Swift 版と候補の並びを揃えるため、この順番は変えないこと
     */
    fun idsListOf(ch: String): List<String> {
        val i = index[ch] ?: return partIds[ch]?.let { listOf(it) } ?: emptyList()
        val primary = ids[i]
        val a = if (i < alt.size) alt[i] else ""
        if (primary.isEmpty()) return emptyList()
        if (a.isEmpty()) return listOf(primary)
        return listOf(primary) + a.split(' ').filter { it.isNotEmpty() }
    }
    fun isExt(i: Int) = i >= jaCount

    /** 1段目。これが終われば日本語の漢字は引ける */
    fun loadJapanese(ctx: Context) {
        readLines(ctx, "dict-ja.tsv") { line ->
            // char \t ids \t grade \t freq \t on \t kun \t 人名 \t 参考 \t 参考の出所 \t 画数 \t 別の分解
            val f = line.split('\t')
            if (f.size >= 6) {
                index[f[0]] = chars.size
                chars.add(f[0]); ids.add(f[1])
                grade.add(f[2].toIntOrNull() ?: 0)
                freq.add(f[3].toIntOrNull() ?: 0)
                on.add(f[4]); kun.add(f[5])
                // 読みの3列と画数は後から足したもの。古い辞書でも落ちないよう既定値を入れる
                nanori.add(f.getOrElse(6) { "" })
                ref.add(f.getOrElse(7) { "" })
                refKind.add(f.getOrElse(8) { "" })
                strokes.add(f.getOrNull(9)?.toIntOrNull() ?: 0)
                // 空の行は定数の "" を共有する(9万個の小さな確保を作らない)
                alt.add(f.getOrElse(10) { "" }.ifEmpty { "" })
            }
        }
        jaCount = chars.size
        readLines(ctx, "dict-parts.tsv") { line ->
            val f = line.split('\t')
            if (f.size >= 2) partIds[f[0]] = f[1]
        }
    }

    /** 2段目。拡張漢字。候補の後ろに付くだけなので遅れて読んでよい */
    fun loadExtensions(ctx: Context) {
        readLines(ctx, "dict-ext.tsv") { line ->
            // char \t ids \t 参考 \t 参考の出所 \t 画数 \t 別の分解
            val f = line.split('\t')
            if (f.size >= 2) {
                index[f[0]] = chars.size
                chars.add(f[0]); ids.add(f[1])
                ref.add(f.getOrElse(2) { "" })
                refKind.add(f.getOrElse(3) { "" })
                strokes.add(f.getOrNull(4)?.toIntOrNull() ?: 0)
                alt.add(f.getOrElse(5) { "" }.ifEmpty { "" })
            }
        }
        extLoaded = true
    }

    private inline fun readLines(ctx: Context, name: String, crossinline each: (String) -> Unit) {
        ctx.assets.open(name).bufferedReader().use { r: BufferedReader ->
            var line = r.readLine()
            while (line != null) {
                if (line.isNotEmpty()) each(line)
                line = r.readLine()
            }
        }
    }
}
