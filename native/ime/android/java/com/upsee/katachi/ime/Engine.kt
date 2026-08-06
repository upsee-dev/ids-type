package com.upsee.katachi.ime

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

    data class Hit(val index: Int, val ch: String, val exact: Boolean)

    private val treeCache = HashMap<String, Ids.Node?>(4096)
    private val closureCache = HashMap<String, Set<String>>(4096)

    // ---- 分解木 ----

    private fun tree(ch: String): Ids.Node? = treeCache.getOrPut(ch) {
        val s = dict.idsOf(ch)
        if (s.isNullOrEmpty()) null else Ids.parse(s)
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
        val s = dict.idsOf(ch) ?: return emptySet()
        val out = HashSet<String>(8)
        for (t in Ids.tokens(s)) {
            if (t.length == 1 && Ids.isIdc(t[0])) continue
            val n = Ids.norm(t)
            if (n == ch) continue
            out.addAll(closure(n))
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
            // 葉を展開して再帰(例: 果 → ⿱田木)
            val sub = tree(c.ch)
            if (sub == null || sub is Ids.Node.Leaf) return 0
            return if (match(q, sub, depth + 1) != 0) 1 else 0
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
    // 日本語入力なので、KANJIDIC2 に無い字は必ず日本の漢字の後ろへ。
    // 素点の最大(500000+300000+27000)より大きい下駄を履かせて確実に分離する。
    private fun score(i: Int, exact: Boolean): Int {
        var s = if (exact) 0 else 500_000
        val g = dict.gradeAt(i)
        s += (if (g in 1..6) g else if (g == 8) 7 else if (g == 9 || g == 10) 8 else 10) * 30_000
        val f = dict.freqAt(i)
        s += if (f > 0) f * 10 else 27_000
        if (dict.isExt(i)) s += 2_000_000
        return s
    }

    enum class Mode { EMPTY, STRUCTURE, PARTS }

    data class Result(val hits: List<Hit>, val mode: Mode)

    /** 入力文字列から候補を返す */
    fun search(input: String, limit: Int = 200): Result {
        val compiled = Ids.compile(input)
        if (compiled.isEmpty()) return Result(emptyList(), Mode.EMPTY)

        val hasIdc = compiled.any { Ids.isIdc(it) }
        val hits = ArrayList<Hit>(limit * 2)

        if (hasIdc) {
            val q = Ids.parse(compiled) ?: return Result(emptyList(), Mode.EMPTY)
            if (q is Ids.Node.Leaf) return Result(emptyList(), Mode.EMPTY)
            for (i in dict.chars.indices) {
                val t = tree(dict.chars[i])
                if (t == null || t is Ids.Node.Leaf) continue
                val m = match(q, t)
                if (m != 0) hits.add(Hit(i, dict.chars[i], m == 2))
            }
            hits.sortBy { score(it.index, it.exact) }
            return Result(hits.take(limit), Mode.STRUCTURE)
        }

        // 部品包含検索(操作子なし)
        val want = Ids.tokens(compiled)
            .filter { it != Ids.WILD.toString() }
            .map { Ids.norm(it) }
        if (want.isEmpty()) return Result(emptyList(), Mode.EMPTY)
        for (i in dict.chars.indices) {
            val ch = dict.chars[i]
            if (want.size == 1 && ch == want[0]) continue // 自分自身は除外
            val cl = closure(ch)
            if (want.all { cl.contains(it) }) hits.add(Hit(i, ch, false))
        }
        hits.sortBy { score(it.index, it.exact) }
        return Result(hits.take(limit), Mode.PARTS)
    }

    /**
     * 読みから字を引く。「つち」→ 土 圭 塩 … のように、部品として使いたい字を
     * パレットに無くても出せるようにするためのもの。
     *
     * 音読み(カタカナ)・訓読み(ひらがな)の両方を1本につないで部分一致で見る。
     * 訓読みの「あか.るい」「-がわ」の . と - は送り仮名・接辞の目印なので落とす。
     * 突き合わせ方は core/engine.ts の list({query}) と同じ。
     * 読みを持つのは KANJIDIC2 収録字だけなので、走査も jaCount までで済む。
     */
    fun byReading(query: String, limit: Int = 60): List<String> {
        val kana = Kana.toHiragana(query.trim())
        if (kana.isEmpty()) return emptyList()
        val hits = ArrayList<Int>(limit * 4)
        for (i in 0 until dict.jaCount) {
            val on = dict.onAt(i)
            val kun = dict.kunAt(i)
            if (on.isEmpty() && kun.isEmpty()) continue
            val r = Kana.toHiragana("$on $kun").replace(".", "").replace("-", "")
            if (r.contains(kana)) hits.add(i)
        }
        // 常用に近い字・よく使う字を先に。score は exact でない前提でよい
        hits.sortBy { score(it, false) }
        return hits.take(limit).map { dict.chars[it] }
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
