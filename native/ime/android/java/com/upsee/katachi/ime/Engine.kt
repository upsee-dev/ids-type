package com.upsee.katachi.ime

/**
 * 画数チップの上限。ここ以上は「30画以上」として1つに束ねる
 * (30画を超える字は10万字のうち1%ほどで、1画きざみでは選びにくい)。
 * core/engine.ts の STROKE_MAX・Swift の strokeMax と同じ値にすること。
 * キーボードの画面(KeyboardView)も同じ値でチップを並べるので、クラスの外に置く。
 */
const val STROKE_MAX = 30

/**
 * 検索エンジン。core/engine.ts の Kotlin 移植。
 *
 * 入力(かたちコード＋部品) → 候補漢字。やることは2つだけ:
 *   構造検索  … 入力に操作子が含まれる。IDS構文木どうしを突き合わせる
 *   部品検索  … 操作子なし。その部品を含む字を集める(再帰的な部品閉包)
 *
 * TypeScript 側と候補の並びまで一致させること(同点は辞書の並び順で決まる)。
 */
class Engine(private val dict: Dict) {

    private companion object {
        /**
         * 完全一致の下駄。**打ったものそのままの字はどの並びでも必ず先頭**に来るよう、
         * 残り(学年300,000＋頻度27,000＋拡張2,000,000)を全部足したより大きく取る。
         */
        const val EXACT_STEP = 3_000_000

        /** 拡張漢字(KANJIDIC2 に無い字)の下駄。日本語入力なので日本の漢字の後ろへ */
        const val EXT_STEP = 2_000_000

        /**
         * 「符号位置順」の段(完全一致→日本の漢字→拡張漢字)1つぶんの重み。
         * 符号位置の最大 0x10FFFF(1,114,111)より大きくして段が混ざらないようにする。
         */
        const val CP_STEP = 2_000_000

        /** 「近い順」で余分な部品1つぶんの重み。素点の最大(5,327,000)より大きくする */
        const val NEAR_STEP = 10_000_000

        /** 読みで引いたときの「段」(正式→人名→参考→推定)1つぶんの重み */
        const val READING_STEP = 10_000_000L

        /** 余分の数え上げの頭打ち。Int を溢れさせないため */
        const val NEAR_MAX = 99

    }

    data class Hit(val index: Int, val ch: String, val exact: Boolean)

    private val treeCache = HashMap<String, Ids.Node?>(4096)
    private val treesCache = HashMap<String, List<Ids.Node>>(4096)
    private val closureCache = HashMap<String, Set<String>>(4096)
    private val leafCountCache = HashMap<String, Int>(4096)

    // ---- 分解木 ----

    private fun tree(ch: String): Ids.Node? = treeCache.getOrPut(ch) {
        val s = dict.idsOf(ch)
        if (s.isNullOrEmpty()) null else Ids.parse(s)
    }

    /**
     * その字の分解**ぜんぶ**(主＋別の分解)を構文木にしたもの。
     *
     * 同じ字でも表によって切り方が違う(丟 = ⿱王厶 / ⿱一去)。どちらを思い浮かべるかは
     * 人によるので、**打った組み合わせがどれか1つに当たれば引ける**ようにする。
     * 並びは辞書のまま(主が先)＝TypeScript/Swift 版と候補の並びが揃う。
     */
    private fun trees(ch: String): List<Ids.Node> = treesCache.getOrPut(ch) {
        dict.idsListOf(ch).mapNotNull { Ids.parse(it) }
    }

    // ---- 部品の閉包(自身＋再帰的に到達できる全部品) ----

    fun closure(ch: String): Set<String> {
        val c = Ids.norm(ch)
        closureCache[c]?.let { return it }
        val set = HashSet<String>(16)
        closureCache[c] = set // 循環ガード。先に登録しておく
        add(c, set)
        return set
    }

    private fun add(x: String, set: MutableSet<String>) {
        val n = Ids.norm(x)
        if (set.add(n)) {
            for (s in subClosure(n)) set.add(s)
        }
        if (n.length == 1) Ids.SOFT[n[0]]?.let { set.add(it.toString()) }
    }

    private fun subClosure(ch: String): Set<String> {
        val out = HashSet<String>(8)
        // **主の分解だけでなく別の分解の部品も入れる**。表によって切り方が違うので、
        // 片方しか見ないと「その組み合わせでは引けない字」ができる
        for (s in dict.idsListOf(ch)) {
            for (t in Ids.tokens(s)) {
                if (t.length == 1 && Ids.isIdc(t[0])) continue
                val n = Ids.norm(t)
                if (n == ch) continue
                out.addAll(closure(n))
            }
        }
        return out
    }

    private fun closureOfNode(n: Ids.Node): Set<String> = when (n) {
        is Ids.Node.Leaf ->
            if (n.ch == Ids.WILD.toString()) emptySet() else closure(n.ch)
        is Ids.Node.Op -> {
            val out = HashSet<String>()
            for (k in n.kids) out.addAll(closureOfNode(k))
            out
        }
    }

    // ---- 構造マッチ: 2=完全一致, 1=包含, 0=不一致 ----

    private fun match(q: Ids.Node, c: Ids.Node, depth: Int = 0): Int {
        if (depth > 12) return 0
        if (q is Ids.Node.Leaf) {
            if (q.ch == Ids.WILD.toString()) return 2
            if (c is Ids.Node.Leaf) {
                if (q.ch == c.ch) return 2
                val qs = if (q.ch.length == 1) Ids.SOFT[q.ch[0]]?.toString() else null
                val cs = if (c.ch.length == 1) Ids.SOFT[c.ch[0]]?.toString() else null
                if (qs == c.ch || cs == q.ch) return 1
                return if (closure(c.ch).contains(q.ch)) 1 else 0
            }
            return if (closureOfNode(c).contains(q.ch)) 1 else 0
        }
        q as Ids.Node.Op
        if (c is Ids.Node.Leaf) {
            // 葉を展開して再帰(例: 果 → ⿱田木)。別の分解も順に試す
            for (sub in trees(c.ch)) {
                if (sub is Ids.Node.Leaf) continue
                if (match(q, sub, depth + 1) != 0) return 1
            }
            return 0
        }
        c as Ids.Node.Op
        if (q.op != c.op || q.kids.size != c.kids.size) return 0
        var best = 2
        for (i in q.kids.indices) {
            val m = match(q.kids[i], c.kids[i], depth + 1)
            if (m == 0) return 0
            if (m < best) best = m
        }
        return best
    }

    // ---- 並び順 ----
    // 完全一致(打ったものそのままの字)が最上位の鍵。拡張漢字の下駄より大きいので、
    // ぴったりの字が拡張漢字でも候補の先頭に出る。
    // 日本語入力なので、KANJIDIC2 に無い字は必ず日本の漢字の後ろへ。
    private fun score(i: Int, exact: Boolean): Int {
        var s = if (exact) 0 else EXACT_STEP
        val g = dict.gradeAt(i)
        s += (if (g in 1..6) g else if (g == 8) 7 else if (g == 9 || g == 10) 8 else 10) * 30_000
        val f = dict.freqAt(i)
        s += if (f > 0) f * 10 else 27_000
        if (dict.isExt(i)) s += EXT_STEP
        return s
    }

    /**
     * 候補の並び順。キーは core/engine.ts の SORT_MODES と同じ文字列で、
     * アプリの設定画面が共有領域(Store.SORT)に書いたものをそのまま受ける。
     */
    enum class Sort {
        /** 既定。完全一致を先頭に、あとは符号位置(Unicode)の順 */
        UNICODE,

        /** 完全一致 → 学年 → 使用頻度(拡張漢字は必ず後ろ) */
        COMMON,

        /** 打ったかたちに近い順。余分な部品が少ない字を先に */
        NEAR,
        ;

        companion object {
            fun of(key: String?): Sort = when (key) {
                "near" -> NEAR
                "common" -> COMMON
                else -> UNICODE
            }
        }
    }

    /**
     * 並べ替えの鍵。UNICODE は符号位置そのまま、NEAR は**打った部品のほかに
     * 余分な部品がいくつあるか**を先に見て、同じ数のなかを素点で並べる
     * (同じくらい近いなら、よく使う字が先)。
     */
    private fun sortKey(h: Hit, sort: Sort, asked: Int): Int {
        if (sort == Sort.UNICODE) return codeKey(h)
        val s = score(h.index, h.exact)
        if (sort != Sort.NEAR) return s
        val extra = (leafCount(h.ch) - asked).coerceIn(0, NEAR_MAX)
        return extra * NEAR_STEP + s
    }

    /**
     * 「符号位置順」の鍵。**完全一致 → 日本の漢字 → 拡張漢字**の3段に分け、
     * 段の中を符号位置(Unicode)で並べる。
     *
     * 段を分けずに符号位置だけで並べると、拡張A(U+3400〜)が統合漢字(U+4E00〜)より
     * 前に来て、木を打つと 林 の前に見たこともない字が数百字並ぶ。日本語入力として
     * 使いものにならないので、「拡張漢字は日本の漢字の後ろ」は符号位置順でも守る。
     */
    private fun codeKey(h: Hit): Int {
        val rank = (if (h.exact) 0 else 2) + (if (dict.isExt(h.index)) 1 else 0)
        return rank * CP_STEP + h.ch.codePointAt(0)
    }

    /**
     * 打った部品**だけ**でできている字か(並ぶ順番は問わない)。
     * 例: 「木」→ 木そのもの、「木木」→ 林(⿰木木)。呆(⿱口木)は口が余るので違う。
     *
     * 操作子なしで打ったときの「完全一致」の見分け方。当たった字は候補の先頭へ出す。
     */
    private fun madeOfExactly(ch: String, want: List<String>): Boolean {
        if (want.size == 1 && Ids.norm(ch) == want[0]) return true
        val sorted = want.sorted()
        // どれか1つの分解が打ったものと過不足なく一致すれば完全一致
        for (ids in dict.idsListOf(ch)) {
            val parts = Ids.tokens(ids)
                .filter { !(it.length == 1 && Ids.isIdc(it[0])) }
                .map { Ids.norm(it) }
            if (parts.size != want.size) continue
            if (parts.sorted() == sorted) return true
        }
        return false
    }

    /** 入力が求めている部品の数。? は数えない(埋まるぶんは「余分」として効く) */
    private fun askedLeaves(n: Ids.Node): Int = when (n) {
        is Ids.Node.Leaf -> if (n.ch == Ids.WILD.toString()) 0 else leafCount(n.ch)
        is Ids.Node.Op -> n.kids.sumOf { askedLeaves(it) }
    }

    /**
     * 再帰的に展開したときの部品(葉)の数＝字の複雑さ。「近い順」の物差し。
     * 分解を持たない字は1つ。循環しても止まるよう、先に1を入れてから数える。
     */
    private fun leafCount(ch: String, depth: Int = 0): Int {
        val c = Ids.norm(ch)
        leafCountCache[c]?.let { return it }
        val ids = dict.idsOf(c)
        if (ids.isNullOrEmpty()) {
            leafCountCache[c] = 1
            return 1
        }
        if (depth > 12) return 1 // 深さ依存なので覚えない
        leafCountCache[c] = 1 // 循環ガード。先に登録しておく
        var n = 0
        for (t in Ids.tokens(ids)) {
            if (t.length == 1 && Ids.isIdc(t[0])) continue
            val k = Ids.norm(t)
            n += if (k == c) 1 else leafCount(k, depth + 1)
        }
        val v = if (n == 0) 1 else n
        leafCountCache[c] = v
        return v
    }

    enum class Mode { EMPTY, STRUCTURE, PARTS }

    /** hits は1ページぶん。total は絞り込みの全件数(UI はこれでページを分ける) */
    data class Result(val hits: List<Hit>, val mode: Mode, val total: Int = 0)

    /**
     * 直前の検索の**全件**。ページ送りのために覚えておく。
     * 1ページめくるたびに10万字を走査し直すと数十〜数百ms かかるため。
     * 検索は打鍵ごとの別スレッドで走るので、3つの値をまとめて1つの参照で
     * 差し替える(途中の状態が見えないようにする)。
     */
    private class Cached(val key: String, val hits: List<Hit>, val mode: Mode)

    @Volatile
    private var cache: Cached? = null

    /**
     * 候補を1ページぶん返す。
     * offset を動かすと同じ絞り込みの続きが取れる(走査はやり直さない)。
     */
    fun search(
        input: String,
        limit: Int = 200,
        sort: Sort = Sort.UNICODE,
        offset: Int = 0,
    ): Result {
        val compiled = Ids.compile(input)
        if (compiled.isEmpty()) return Result(emptyList(), Mode.EMPTY, 0)
        val key = "$compiled\u0000$sort"
        val c = cache?.takeIf { it.key == key } ?: searchAll(compiled, sort).let {
            Cached(key, it.hits, it.mode).also { made -> cache = made }
        }
        val from = offset.coerceIn(0, c.hits.size)
        val to = (from + limit).coerceIn(from, c.hits.size)
        return Result(c.hits.subList(from, to), c.mode, c.hits.size)
    }

    /** 絞り込みの本体。全件を並べ替えて返す(切り出しは search がやる) */
    private fun searchAll(compiled: String, sort: Sort): Result {
        val hasIdc = compiled.any { Ids.isIdc(it) }
        val hits = ArrayList<Hit>(512)

        if (hasIdc) {
            val q = Ids.parse(compiled) ?: return Result(emptyList(), Mode.EMPTY)
            if (q is Ids.Node.Leaf) return Result(emptyList(), Mode.EMPTY)
            for (i in dict.chars.indices) {
                // 分解ぜんぶを試して、いちばん良く当たったものを採る。
                // 「⿱王厶」で打っても「⿱一去」で打っても 丟 が出る
                var m = 0
                for (t in trees(dict.chars[i])) {
                    if (t is Ids.Node.Leaf) continue
                    val v = match(q, t)
                    if (v > m) m = v
                    if (m == 2) break
                }
                if (m != 0) hits.add(Hit(i, dict.chars[i], m == 2))
            }
            val asked = askedLeaves(q)
            hits.sortBy { sortKey(it, sort, asked) }
            return Result(hits, Mode.STRUCTURE, hits.size)
        }

        // 部品包含検索(操作子なし)
        val want = Ids.tokens(compiled)
            .filter { it != Ids.WILD.toString() }
            .map { Ids.norm(it) }
        if (want.isEmpty()) return Result(emptyList(), Mode.EMPTY)
        // 打った部品そのものの字(「木」→ 木)も候補に入れる。**それが完全一致**なので、
        // 除いてしまうと「打ったものと同じ字を先頭に」が成り立たない
        for (i in dict.chars.indices) {
            val ch = dict.chars[i]
            val cl = closure(ch)
            if (want.all { cl.contains(it) }) hits.add(Hit(i, ch, madeOfExactly(ch, want)))
        }
        val asked = want.sumOf { leafCount(it) }
        hits.sortBy { sortKey(it, sort, asked) }
        return Result(hits, Mode.PARTS, hits.size)
    }

    /**
     * 読みから字を引く。「つち」→ 土 圭 塩 … のように、部品として使いたい字を
     * パレットに無くても出せるようにするためのもの。
     *
     * 音読み(カタカナ)・訓読み(ひらがな)の両方を1本につないで部分一致で見る。
     * 訓読みの「あか.るい」「-がわ」の . と - は送り仮名・接辞の目印なので落とす。
     * 突き合わせ方は core/engine.ts の list({query}) と同じ。
     *
     * 読みは**正式・人名・参考・推定の4段階**で持っているので(readings.mts)、
     * 当たった読みの段を第一の並び順にする。そうしないと、声符から推しただけの
     * 字が、辞書に載っている読みの字を押しのけて前に出てしまう。
     *
     * **該当する字は打ち切らずに全部数える**。60件で切ると「この読みの字は
     * これで全部」なのか「まだ先にあるのか」が打つ側から分からないので、
     * total を返してページで送れるようにしてある。走査は10万字ぶんだが、
     * 呼ぶ側が別スレッドに逃がしている(KeyboardView#runReadingSearch)。
     *
     * strokes を渡すと**画数で絞り込む**(0=絞らない)。画数は Unihan の
     * kTotalStrokes で10万字ぜんぶにあるので、拡張漢字にも効く。
     * STROKE_MAX(30)は「30画以上」の意味。
     */
    fun byReading(
        query: String,
        strokes: Int = 0,
        offset: Int = 0,
        limit: Int = 60,
    ): Page {
        val kana = Kana.toHiragana(query.trim())
        if (kana.isEmpty()) return Page(emptyList(), 0)
        // 上位20bitに並び順(段→素点)、下位20bitに添字を詰めて Long 1本で並べる
        // (段と素点を別に持つと、比較のたびに読みを組み直すことになる)
        val hits = ArrayList<Long>(limit * 4)
        // 拡張漢字を読み終える前は**日本の字までしか見ない**。読み込みは別スレッドで
        // 走っていて、増えている最中の配列を端から舐めると、まだ書き終わっていない
        // 場所を読みかねない(extLoaded は @Volatile なので、true が見えた時点で
        // それまでの書き込みも見えている)。読み終わったあとは10万字ぜんぶを数える
        val n = if (dict.extLoaded) dict.chars.size else dict.jaCount
        for (i in 0 until n) {
            if (strokes > 0 && !strokeHit(dict.strokesAt(i), strokes)) continue
            val rank = readingRank(i, kana)
            if (rank == 0) continue
            val key = rank.toLong() * READING_STEP + score(i, false)
            hits.add((key shl 20) or i.toLong())
        }
        hits.sort()
        val page = hits.drop(offset).take(limit).map { dict.chars[(it and 0xFFFFF).toInt()] }
        return Page(page, hits.size)
    }

    /** 読みで引いた結果の1ページぶんと、該当した総数 */
    data class Page(val items: List<String>, val total: Int)

    /** 画数の絞り込み。STROKE_MAX は「それ以上」を束ねる */
    private fun strokeHit(n: Int, want: Int): Boolean =
        if (want >= STROKE_MAX) n >= STROKE_MAX else n == want

    /**
     * 打った読みがその字のどの読みに当たったか。小さいほど先に出す。0 = 当たらない。
     *   1 … 正式(KANJIDIC2 の音訓)
     *   2 … 人名(nanori)。正式ではないが実際に使われる
     *   3 … 参考(資料にある読み)
     *   4 … 推定(異体字・声符から。当たるのは6割ほど)
     */
    private fun readingRank(i: Int, kana: String): Int {
        fun hit(s: String): Boolean {
            if (s.isEmpty()) return false
            return Kana.toHiragana(s).replace(".", "").replace("-", "").contains(kana)
        }
        val on = dict.onAt(i)
        val kun = dict.kunAt(i)
        if ((on.isNotEmpty() || kun.isNotEmpty()) && hit("$on $kun")) return 1
        if (hit(dict.nanoriAt(i))) return 2
        if (hit(dict.refAt(i))) return if (dict.refKindAt(i).startsWith("u")) 3 else 4
        return 0
    }

    /** 表示用: 1段ずつ分解を展開する(例: 課 → [課 = 〈左右〉言果, 果 = 〈重なり〉日木]) */
    fun decompose(ch: String, maxLines: Int = 4): List<String> {
        val out = ArrayList<String>(maxLines)
        val seen = HashSet<String>().apply { add(ch) }
        val queue = ArrayDeque<String>().apply { add(ch) }
        while (queue.isNotEmpty() && out.size < maxLines) {
            val c = queue.removeFirst()
            val s = dict.idsOf(c)
            if (s.isNullOrEmpty() || s == c) continue
            out.add("$c = ${Ids.readable(s)}")
            for (t in Ids.tokens(s)) {
                if (t.length == 1 && Ids.isIdc(t[0])) continue
                if (!seen.add(t)) continue
                if (dict.idsOf(t) != null) queue.add(t)
            }
        }
        return out
    }
}
