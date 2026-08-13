package com.upsee.katachi.ime

import java.io.File

/**
 * Kotlin 版の手書き照合の検証。
 *
 * web の `npm run build:handwriting` が書き出した問題集
 * (handwriting-cases.tsv) を読み、TypeScript 実装が返したのと
 * **同じ候補が同じ順で**返るかを見る。数値の扱いが1つでもずれれば落ちる。
 *
 *   kotlinc ../android/java/com/upsee/katachi/ime/Handwriting.kt main.kt \
 *     -include-runtime -d hw-test.jar && java -jar hw-test.jar <ime/assets> <ime/test>
 */
fun main(args: Array<String>) {
    val assets = File(args[0])
    val cases = File(args[1])

    val hw = Handwriting()
    val t0 = System.currentTimeMillis()
    File(assets, "hw.tsv").inputStream().use { hw.load(it) }
    val t1 = System.currentTimeMillis()
    println("手書きパターン ${hw.size} 字 (${t1 - t0}ms)")

    val lines = File(cases, "handwriting-cases.tsv").readLines()
    val count = lines[0].trim().toInt()
    var fail = 0
    var totalMs = 0L
    for (i in 1..count) {
        val f = lines[i].split('\t')
        val expect = f[0]
        val strokes = f.drop(1).map { s ->
            val nums = s.trim().split(' ').flatMap { p -> p.split(',') }
            DoubleArray(nums.size) { nums[it].toDouble() }
        }
        val start = System.currentTimeMillis()
        val got = hw.match(strokes, 5).joinToString("") { it.ch }
        totalMs += System.currentTimeMillis() - start
        if (got != expect) {
            fail++
            println("NG  期待 $expect  実際 $got")
        }
    }
    println(
        if (fail == 0) {
            "ALL PASS ($count 問・TypeScript と同じ順序, ${totalMs / count}ms/問)"
        } else {
            "FAILED: $fail / $count"
        },
    )
    if (fail != 0) kotlin.system.exitProcess(1)
}
