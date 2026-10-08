package com.upsee.katachi.ime

/**
 * かな入力の表。
 *
 * このキーボードは自分が入力方式なので、読みを打ちたくても他のかなキーボードへ
 * 移ることができない（移った時点でかたちコードごと相手のアプリに渡ってしまう）。
 * そこで読み入力の面をキーボードの中に持つ。並びは日本のスマホで標準の
 * 12キーフリック（あ行〜わ行＋濁点＋⌫）。
 *
 * iOS 側(targets/keyboard/Kana.swift)と同じ表を手で二重に持っている。
 * かたちの配置図や着せ替えのように core/ から生成していないのは、
 * これが辞書でもデータでもなく「かなキーボードの並び」だけの表で、
 * Web版には存在しない（Web版は端末のキーボードで読みを打てる）ため。
 */
object Kana {

    /**
     * フリック1キーぶん。chars は [中央, 左, 上, 右, 下] の順で、
     * 空文字は「その向きには何も割り当てない（中央のまま）」を表す。
     */
    data class Key(val label: String, val chars: List<String>)

    /** 濁点キー・⌫キーの目印（label で見分ける） */
    const val DAKUTEN = "小゛゜"
    const val BACKSPACE = "⌫"

    val ROWS: List<List<Key>> = listOf(
        listOf(row("あ", "い", "う", "え", "お"), row("か", "き", "く", "け", "こ"), row("さ", "し", "す", "せ", "そ")),
        listOf(row("た", "ち", "つ", "て", "と"), row("な", "に", "ぬ", "ね", "の"), row("は", "ひ", "ふ", "へ", "ほ")),
        listOf(row("ま", "み", "む", "め", "も"), row("や", "", "ゆ", "", "よ"), row("ら", "り", "る", "れ", "ろ")),
        listOf(
            Key(DAKUTEN, emptyList()),
            row("わ", "を", "ん", "ー", "〜"),
            Key(BACKSPACE, emptyList()),
        ),
    )

    private fun row(center: String, left: String, up: String, right: String, down: String) =
        Key(center, listOf(center, left, up, right, down))

    /**
     * 「小゛゜」キーで1字を送る輪。標準のかなキーボードと同じで、
     * 押すたび 濁点 → 半濁点 → 小文字 → 元 と巡る。
     */
    private val RINGS = listOf(
        "あぁ", "いぃ", "うぅゔ", "えぇ", "おぉ",
        "かが", "きぎ", "くぐ", "けげ", "こご",
        "さざ", "しじ", "すず", "せぜ", "そぞ",
        "ただ", "ちぢ", "つっづ", "てで", "とど",
        "はばぱ", "ひびぴ", "ふぶぷ", "へべぺ", "ほぼぽ",
        "やゃ", "ゆゅ", "よょ", "わゎ",
    )

    /** 末尾1字を輪の次へ送る。輪に無い字（ん・ー など）は null */
    fun cycle(ch: String): String? {
        if (ch.isEmpty()) return null
        for (ring in RINGS) {
            val i = ring.indexOf(ch[0])
            if (i >= 0) return ring[(i + 1) % ring.length].toString()
        }
        return null
    }

    /**
     * 読みの突き合わせ用。カタカナをひらがなに寄せる
     * (KANJIDIC2 の音読みはカタカナ・訓読みはひらがなで入っているため)。
     * core/engine.ts の toHiragana と同じ規則。
     */
    fun toHiragana(s: String): String {
        val sb = StringBuilder(s.length)
        for (c in s) {
            sb.append(if (c in 'ァ'..'ヶ') (c - 0x60) else c)
        }
        return sb.toString()
    }

    /**
     * ローマ字をかなに直す。表は Romaji.TABLE(core/data/romaji.ts から生成)。
     * 打ちかけ(k・ky)は変換できないので second に残し、次の字と合わせて見る。
     * TypeScript 版 romajiToKana と同じ結果になること。
     */
    fun romajiToKana(input: String): Pair<String, String> {
        val kana = StringBuilder()
        var buf = input.lowercase()
        var rest = ""
        while (buf.isNotEmpty()) {
            // 促音: 同じ子音が2つ続いたら「っ」
            if (buf.length >= 2 && buf[0] == buf[1] && buf[0] !in "aiueo" && buf[0] != 'n') {
                kana.append("っ")
                buf = buf.substring(1)
                continue
            }
            var hit = ""
            for (n in minOf(3, buf.length) downTo 1) {
                val k = buf.substring(0, n)
                if (Romaji.TABLE.containsKey(k)) {
                    hit = k
                    break
                }
            }
            if (hit.isNotEmpty()) {
                // "n" は次が母音や y なら な行になりうるので、1字だけなら待つ
                if (hit == "n" && buf.length == 1) {
                    rest = buf
                    break
                }
                kana.append(Romaji.TABLE[hit])
                buf = buf.substring(hit.length)
                continue
            }
            if (buf[0] == 'n' && buf.length >= 2 && buf[1] !in "aiueoy'") {
                kana.append("ん")
                buf = buf.substring(1)
                continue
            }
            if (Romaji.TABLE.keys.any { it.startsWith(buf) }) {
                rest = buf
                break
            }
            buf = buf.substring(1)
        }
        return Pair(kana.toString(), rest)
    }
}
