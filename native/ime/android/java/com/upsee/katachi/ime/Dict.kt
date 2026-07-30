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
 */
class Dict {

    /** 候補になる字。日本語の字が先、拡張漢字が後ろ */
    val chars = ArrayList<String>(103_000)
    val ids = ArrayList<String>(103_000)
    private val grade = ArrayList<Int>(13_200)
    private val freq = ArrayList<Int>(13_200)
    private val on = ArrayList<String>(13_200)
    private val kun = ArrayList<String>(13_200)

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
    fun isExt(i: Int) = i >= jaCount

    /** 1段目。これが終われば日本語の漢字は引ける */
    fun loadJapanese(ctx: Context) {
        readLines(ctx, "dict-ja.tsv") { line ->
            // char \t ids \t grade \t freq \t on \t kun
            val f = line.split('\t')
            if (f.size >= 6) {
                index[f[0]] = chars.size
                chars.add(f[0]); ids.add(f[1])
                grade.add(f[2].toIntOrNull() ?: 0)
                freq.add(f[3].toIntOrNull() ?: 0)
                on.add(f[4]); kun.add(f[5])
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
            val f = line.split('\t')
            if (f.size >= 2) {
                index[f[0]] = chars.size
                chars.add(f[0]); ids.add(f[1])
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
