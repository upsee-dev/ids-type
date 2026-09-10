package com.upsee.katachi.ime

/**
 * IDS(漢字の空間構造記述)まわり。core/ids/ の Kotlin 移植。
 *
 * キーボード拡張は使えるメモリが小さいので、拡張の中で JS を動かさず
 * エンジンごとネイティブへ移している(docs/technical-roadmap.md 参照)。
 * TypeScript 側 core/ids/{operators,normalize,parse}.ts と挙動を一致させること。
 */
object Ids {

    /** かたちコード ⇄ IDC。core/ids/operators.ts の OPERATORS と同じ並び */
    data class Operator(val code: String, val idc: Char, val arity: Int, val label: String)

    val OPERATORS = listOf(
        Operator("LR", '⿰', 2, "左右"),
        Operator("LL", '⿲', 3, "左中右"),
        Operator("UD", '⿱', 2, "上下"),
        Operator("UU", '⿳', 3, "上中下"),
        Operator("RD", '⿸', 2, "左上かこみ"),
        Operator("RU", '⿺', 2, "左下かこみ"),
        Operator("LD", '⿹', 2, "右上かこみ"),
        Operator("LU", '⿽', 2, "右下かこみ"),
        Operator("OD", '⿵', 2, "上かこみ"),
        Operator("OR", '⿷', 2, "左かこみ"),
        Operator("OU", '⿶', 2, "下かこみ"),
        Operator("OL", '⿼', 2, "右かこみ"),
        Operator("OC", '⿴', 2, "全かこみ"),
        Operator("XX", '⿻', 2, "重なり"),
        Operator("MI", '⿾', 1, "鏡映"),
        Operator("RO", '⿿', 1, "回転"),
        Operator("SU", '㇯', 2, "除去"),
    )

    /** スマホの1画面目に出す操作子 */
    val PRIMARY_CODES = listOf(
        "LR", "UD", "OC", "RD", "RU", "LD", "OD", "OU", "LL", "UU", "OR", "XX",
    )

    private val CODE2IDC = OPERATORS.associate { it.code to it.idc }
    private val ARITY = OPERATORS.associate { it.idc to it.arity }

    fun isIdc(c: Char) = ARITY.containsKey(c)
    fun arity(c: Char) = ARITY[c] ?: 0
    fun idcOf(code: String) = CODE2IDC[code.uppercase()]

    /** ワイルドカード。入力の "?" はここへ寄せる */
    const val WILD = '＊'

    /**
     * 未符号化部品のプレースホルダ。
     * ①②③… = cjkvi-ids 由来 / ？ = BabelStone・CHISE 由来。どちらも打てない。
     */
    fun isPlaceholder(c: Char) = c == '？' || (c in '①'..'⓿')

    /** 同じ形で符号位置が違う部品を寄せる(強い同一視)。core/ids/normalize.ts の NORM */
    private val NORM: Map<Char, Char> = mapOf(
        '⺼' to '月', '⺾' to '艹', '⻌' to '辶', '⻍' to '辶', '⻏' to '阝', '⻖' to '阝',
        '靑' to '青', '飠' to '食', '訁' to '言', '釒' to '金', '糹' to '糸',
        '⺬' to '礻', '⺭' to '礻', '⺿' to '艹', '⻂' to '衤', '⺡' to '氵', '⺘' to '扌',
        '⺖' to '忄', '⺨' to '犭', '⺣' to '灬', '⻊' to '足',
        // BabelStone / CHISE 由来。同じ形に別の符号位置を使うので打てる字へ寄せる
        '⺝' to '月', '⺗' to '㣺', '⺕' to '彐', '⺊' to '卜', '⺆' to '冂',
        '⺻' to '聿', '⺶' to '羊', '⺸' to '羊', '⺵' to '网', '⺲' to '罒', '⺳' to '罒',
        '⺪' to '疋', '⺤' to '爫', '⺥' to '爫', '⺫' to '目', '⺁' to '厂', '⺇' to '几',
        // CJK 筆画(U+31C0〜)のうち、同じ形の統合漢字があるもの
        '㇐' to '一', '㇑' to '丨', '㇒' to '丿', '㇓' to '丿', '㇔' to '丶',
        '㇙' to '亅', '㇚' to '亅', '㇟' to '乚',
        // 円は辞書の分解では 〇(U+3007)。記号の ○・◯ で打っても引けるようにする
        '○' to '〇', '◯' to '〇',
    )

    /** 独立字とその偏旁形(弱い同一視)。閉包に正字も足して両方でヒットさせる */
    val SOFT: Map<Char, Char> = mapOf(
        '氵' to '水', '扌' to '手', '忄' to '心', '犭' to '犬', '灬' to '火', '氺' to '水',
        '礻' to '示', '衤' to '衣', '⺩' to '玉', '王' to '玉', '罒' to '网', '⺌' to '小',
        '亻' to '人', '刂' to '刀', '阝' to '阜', '㣺' to '心', '月' to '肉',
    )

    fun norm(c: Char): Char = NORM[c] ?: c
    fun norm(s: String): String = if (s.length == 1) norm(s[0]).toString() else s

    /** IDC文字はフォントによって豆腐になるので、表示用に日本語ラベルへ置き換える */
    private val IDC2LABEL = OPERATORS.associate { it.idc to it.label }

    fun readable(ids: String): String = buildString {
        for (c in ids) {
            val label = IDC2LABEL[c]
            if (label != null) append('〈').append(label).append('〉') else append(c)
        }
    }

    // ---- IDS 構文木 ----

    /** 葉(部品1字 or ワイルドカード) か 節(操作子＋子) */
    sealed class Node {
        data class Leaf(val ch: String) : Node()
        data class Op(val op: Char, val kids: List<Node>) : Node()
    }

    /** コードポイント単位に切る(サロゲートペアを1つとして扱う) */
    fun tokens(s: String): List<String> {
        val out = ArrayList<String>(s.length)
        var i = 0
        while (i < s.length) {
            val cp = s.codePointAt(i)
            val n = Character.charCount(cp)
            out.add(s.substring(i, i + n))
            i += n
        }
        return out
    }

    /** ⿲abc → ⿰a⿰bc / ⿳abc → ⿱a⿱bc に正規化(構造の揺れを吸収) */
    private fun canon(op: Char, kids: List<Node>): Node = when (op) {
        '⿲' -> Node.Op('⿰', listOf(kids[0], Node.Op('⿰', listOf(kids[1], kids[2]))))
        '⿳' -> Node.Op('⿱', listOf(kids[0], Node.Op('⿱', listOf(kids[1], kids[2]))))
        else -> Node.Op(op, kids)
    }

    /** IDS文字列を構文木にする。足りない子はワイルドカード扱い(前方一致で使う) */
    fun parse(ids: String): Node? {
        val ts = tokens(ids)
        var i = 0
        fun read(): Node {
            if (i >= ts.size) return Node.Leaf(WILD.toString())
            val t = ts[i++]
            if (t.length == 1 && isIdc(t[0])) {
                val n = arity(t[0])
                val kids = ArrayList<Node>(n)
                repeat(n) { kids.add(read()) }
                return canon(t[0], kids)
            }
            return Node.Leaf(norm(t))
        }
        if (ts.isEmpty()) return null
        return read()
    }

    /**
     * 入力文字列を IDS に直す。
     * 2文字コード(LR等)・IDC・部品・? のワイルドカードが混ざる。
     */
    fun compile(input: String): String = buildString {
        val cs = tokens(input)
        var i = 0
        while (i < cs.size) {
            val c = cs[i]
            when {
                c.isBlank() -> i++
                c == "?" || c == "？" || c == "_" || c == "＿" || c == "*" || c == "＊" -> {
                    append(WILD); i++
                }
                c.length == 1 && c[0].isLetter() && c[0].code < 128 -> {
                    val pair = (c + (cs.getOrNull(i + 1) ?: "")).uppercase()
                    val idc = CODE2IDC[pair]
                    if (idc != null) { append(idc); i += 2 } else i++ // コードでない英字は無視
                }
                else -> { append(c); i++ }
            }
        }
    }
}
