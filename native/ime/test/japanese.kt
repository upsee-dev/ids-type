package com.upsee.katachi.ime
import java.io.File

fun main(args: Array<String>) {
    val root = args[0]
    val lexicon = JapaneseLexicon { key -> File("$root/japanese-$key.tsv").let { if (it.exists()) it.readBytes() else byteArrayOf() } }
    var checks = 0
    val begin = System.nanoTime()
    File(args[1]).forEachLine { line ->
        val f = line.split('\t')
        if (f[0] == "Q") {
            lexicon.search(f[1],listOf(f[2]),f[4].split(',')); check(lexicon.count == f[3].toInt()) { "count ${f[1]}: ${lexicon.count} != ${f[3]}" }
        } else {
            val c = lexicon.page(f[1].toInt(),1)[0]
            check(listOf(c.reading,c.text,c.mask.toString(),c.consumed.toString(),c.kind.toString(),c.language,c.original) == f.drop(2)) { "candidate $f" }
        }
        checks++
    }
    check(JapaneseLexicon.order(listOf("place","bad","place")).size == JapaneseLexicon.ids.size)
    check(JapaneseLexicon.languages(emptyList()).isEmpty())
    check(JapaneseLexicon.languages(listOf("unknown", "ko", "ko")) == listOf("ko"))
    check(Kana.matchesLongKun("ココロザス", "こころざ.す"))
    check(!Kana.matchesLongKun("こころざ", "こころざ.す"))
    check(!Kana.matchesLongKun("いきお", "いきお"))
    check(!Kana.matchesLongKun("いずくんぞ", "", "いずくにかいずくんぞ", true))
    check(!Kana.matchesLongKun("いずくんぞ", "", "イズクンゾ", true))
    check(!Kana.matchesLongKun("いずくんぞ", "", "いずくんぞ"))
    val rows = listOf("いきお\t短名\t2\t1", "いきお\t短訓\t16777344\t9000", "いきおい\t名前\t2\t1", "いきおい\t勢\t16777344\t9000", "いきおい\t熟字訓\t64\t10000", "いきおい\t外国\t16777344\t0\tko\toriginal", "いきおいあ\t予測\t16777344\t0").sorted().joinToString("\n")+"\n"
    val synthetic = JapaneseLexicon { rows.toByteArray() }
    synthetic.search("いきおい", listOf("name"), listOf("ko"))
    check(synthetic.page(0,3).map { it.text } == listOf("熟字訓", "勢", "名前"))
    synthetic.search("いきお", listOf("name"))
    check(synthetic.page(0,1)[0].text == "短名")
    synthetic.search("いきおいあう", listOf("name"))
    check(synthetic.page(0,1)[0].text == "予測")
    val index = UnicodeRadicalIndex(File("$root/radical-index.tsv").readText())
    val ch = String(Character.toChars(0x3261e))
    check(ch in index.characters(5,1)); check(ch in index.characters(31,1))
    check((1..17).flatMap { UnicodeRadicalIndex.radicals(it) } == (1..214).toList())
    println("Kotlin Japanese/radical parity: $checks checks PASS (${(System.nanoTime()-begin)/1_000_000} ms)")
}
