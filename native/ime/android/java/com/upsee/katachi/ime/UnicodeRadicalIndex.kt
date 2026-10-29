package com.upsee.katachi.ime

import java.text.Normalizer

class UnicodeRadicalIndex(tsv: String) {
    companion object {
        val ends = listOf(6,23,54,94,117,146,166,175,186,194,200,204,208,210,211,213,214)
        fun radicals(strokes: Int): List<Int> = if (strokes !in 1..17) emptyList() else ((if (strokes == 1) 1 else ends[strokes-2]+1)..ends[strokes-1]).toList()
        fun label(radical: Int): String = if (radical !in 1..214) "" else Normalizer.normalize(String(Character.toChars(0x2f00+radical-1)), Normalizer.Form.NFKC)+"部"
    }
    private val groups = tsv.lineSequence().mapNotNull { val f = it.split('\t',limit=2); if (f.size == 2) f[0] to f[1] else null }.toMap()
    fun residuals(radical: Int): List<Int> = groups.keys.filter { it.startsWith("$radical.") }.map { it.substringAfter('.').toInt() }.sorted()
    fun characters(radical: Int, residual: Int): List<String> = (groups["$radical.$residual"] ?: "").codePoints().toArray().map { String(Character.toChars(it)) }
}
