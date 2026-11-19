package com.upsee.katachi.ime

import java.text.Normalizer

/** A packed, single-kana shard. Only the displayed page becomes UI objects. */
class JapaneseLexicon(private val load: (String) -> ByteArray) {
    companion object {
        val ids = listOf("common", "name", "place", "kokuji", "symbol", "ketsuren", "jukujikun", "kanji", "plant", "mineral", "animal", "bird", "insect", "fish", "algae")
        val labels = listOf("日本語でよく使われる語", "人名・人名用字", "地名・地名用字", "国字", "記号", "欠画連綿詞", "熟字訓・義訓", "その他の漢字", "植物", "鉱物", "動物", "鳥類", "虫類", "魚類", "藻類")
        val shortLabels = listOf("一般語", "人名", "地名", "国字", "記号", "欠画連綿詞", "熟字訓・義訓", "漢字", "植物", "鉱物", "動物", "鳥類", "虫類", "魚類", "藻類")
        val languageIDs = listOf("ko", "zh", "vi", "tw")
        val languageLabels = listOf("韓国語", "中国語（普通話）", "越南（ベトナム語）", "台湾語（閩南語）")
        val languageShortLabels = listOf("韓国語", "中国語", "越南語", "台湾語")
        const val languageKey = "katachi.foreignReadings.v1"
        fun languages(values: List<String>) = languageIDs.filter { it in values }
        /** Chinese is typed as pinyin on QWERTY only (keys are toneless, ü = v); the kana flick pad never searches it. */
        const val pinyinLanguage = "zh"
        fun searchLanguages(values: List<String>, pinyin: Boolean) = languages(values).filter { (it == pinyinLanguage) == pinyin }
        fun languageLabel(id: String) = languageIDs.indexOf(id).let { if (it >= 0) languageShortLabels[it] else "" }
        const val orderKey = "katachi.japaneseOrder.v1"
        fun order(values: List<String>) = (values.filter { it in ids } + ids).distinct()
        fun label(mask: Int, order: List<String>): String = order.firstOrNull { mask and (1 shl ids.indexOf(it)) != 0 }?.let { labels[ids.indexOf(it)] } ?: "かな"
        fun shortLabel(mask: Int, order: List<String>): String = order.firstOrNull { mask and (1 shl ids.indexOf(it)) != 0 }?.let { shortLabels[ids.indexOf(it)] } ?: "かな"
    }
    data class Candidate(val reading: String, val text: String, val mask: Int, val consumed: Int, val kind: Int, val language: String = "", val original: String = "")
    private data class Hit(val row: Int, val kind: Int, val consumed: Int, val rank: Int, val cost: Int, val length: Int, val foreign: Int, val preferredKun: Int)
    private var blob = byteArrayOf()
    private var offsets = intArrayOf(0)
    private var shard = ""
    private var query = ""
    private var lastOrder = emptyList<String>()
    private var lastLanguages = emptyList<String>()
    private var leading = emptyList<String>()
    private var leadHit: Hit? = null
    private var fallbacks = emptyList<String>()
    private var hits = ArrayList<Hit>()
    private val leadCount: Int get() = leading.size + (if (leadHit != null) 1 else 0)
    val count: Int get() = if (query.isEmpty()) 0 else leadCount + hits.size + fallbacks.size
    private fun fields(row: Int) = String(blob, offsets[row], offsets[row+1]-offsets[row]-1, Charsets.UTF_8).split('\t')
    private fun reading(row: Int): String {
        val start = offsets[row]; var end = start
        while (end < blob.size && blob[end] != 9.toByte() && blob[end] != 10.toByte()) end++
        return String(blob, start, end-start, Charsets.UTF_8)
    }
    private fun lower(text: String): Int {
        var lo = 0; var hi = offsets.size-1
        while (lo < hi) { val mid = (lo+hi)/2; if (reading(mid) < text) lo = mid+1 else hi = mid }
        return lo
    }
    /** 0 = 4字以上の訓・熟字訓の完全一致、1 = 5字以上の訓の先頭が4字以上の入力と一致、2 = それ以外。core/reading-priority.ts と同じ */
    private fun kunRank(kind: Int, mask: Int, language: String, readingLength: Int): Int {
        if (query.length < 4 || language.isNotEmpty() || mask and ((1 shl 24) or (1 shl 6)) == 0) return 2
        if (kind == 0) return 0
        return if (kind == 1 && readingLength >= 5) 1 else 2
    }
    fun search(input: String, values: List<String>, enabled: List<String> = emptyList()) {
        val normalized = Kana.toHiragana(Normalizer.normalize(input, Normalizer.Form.NFC))
        val priority = order(values)
        val allowed = languages(enabled)
        if (normalized == query && priority == lastOrder && allowed == lastLanguages) return
        lastLanguages = allowed
        query = normalized; lastOrder = priority; leading = emptyList(); leadHit = null; fallbacks = emptyList(); hits.clear()
        if (query.isEmpty()) return
        val key = query.codePointAt(0).toString(16).padStart(4, '0')
        if (shard != key) {
            blob = load(key)
            offsets = IntArray(blob.count { it == 10.toByte() }+1)
            var n = 1
            blob.forEachIndexed { i, b -> if (b == 10.toByte()) offsets[n++] = i+1 }
            shard = key
        }
        fun append(row: Int, kind: Int, consumed: Int) {
            val f = fields(row)
            if (f.size != 4 && f.size != 6) return
            val language = f.getOrElse(4) { "" }
            if (language.isNotEmpty() && language !in allowed) return
            val mask = f[2].toIntOrNull() ?: return
            val rank = priority.indexOfFirst { mask and (1 shl ids.indexOf(it)) != 0 }.let { if (it < 0) priority.size else it }
            hits.add(Hit(row, kind, consumed, rank, f[3].toIntOrNull() ?: 8000, f[0].length, if (language.isEmpty()) 0 else 1, kunRank(kind, mask, language, f[0].length)))
        }
        var i = lower(query)
        while (i < offsets.size-1) {
            val r = reading(i)
            if (!r.startsWith(query)) break
            append(i, if (r == query) 0 else 1, query.length); i++
        }
        for (n in query.length-1 downTo 1) {
            val prefix = query.take(n); i = lower(prefix)
            while (i < offsets.size-1 && reading(i) == prefix) { append(i, 2, n); i++ }
        }
        hits.sortWith(compareBy<Hit> { it.preferredKun != 0 }.thenBy { it.kind }.thenBy { it.preferredKun }.thenBy { if (it.kind == 2) -it.consumed else 0 }.thenBy { it.foreign }.thenBy { it.rank }.thenBy { it.cost }.thenBy { it.length }.thenBy { it.row })
        val seen = HashSet<String>()
        hits = ArrayList(hits.filter { seen.add("${it.consumed}\t${fields(it.row)[1]}") })
        fallbacks = listOf(query).filter { seen.add("${query.length}\t$it") }
        // 入力全体のカタカナ表記を常に先頭へ（拼音のように変わらないときは出さない）。
        // 辞書に同じ表記があればその行を先頭へ移し、分類を保つ
        val katakana = query.map { if (it in 'ぁ'..'ゖ') (it.code+0x60).toChar() else it }.joinToString("")
        if (katakana != query) {
            val at = hits.indexOfFirst { it.consumed == query.length && it.foreign == 0 && fields(it.row)[1] == katakana }
            if (at >= 0) leadHit = hits.removeAt(at) else leading = listOf(katakana)
        }
    }
    fun page(offset: Int, limit: Int = 12): List<Candidate> {
        if (query.isEmpty() || offset < 0 || limit <= 0 || offset >= count) return emptyList()
        return (offset until minOf(count, offset+limit)).map { n ->
            if (n < leadCount && leadHit == null) Candidate(query, leading[n], 0, query.length, 3)
            else if (n - leadCount >= hits.size) Candidate(query, fallbacks[n-leadCount-hits.size], 0, query.length, 3)
            else { val h = if (n < leadCount) leadHit!! else hits[n-leadCount]; val f = fields(h.row); Candidate(f[0], f[1], f[2].toInt(), h.consumed, h.kind, f.getOrElse(4) { "" }, f.getOrElse(5) { "" }) }
        }
    }
}
