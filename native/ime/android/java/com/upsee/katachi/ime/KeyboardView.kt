package com.upsee.katachi.ime

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import kotlin.concurrent.thread

/**
 * キーボードの画面。Web版・アプリ版と同じ構成をビューで組む。
 *
 *   [ 入力中のかたち ]            [⌫] [消]
 *   [ 候補: 明 朝 晴 …                   ]
 *   [ かたち | よく使う部品 | 部首・偏旁 | あ ]
 *   [ キーの並び                          ]
 *
 * IDC文字(⿰⿱⿴…)は端末のフォントで豆腐になるので、操作子は日本語ラベルで出す。
 */
@SuppressLint("ViewConstructor")
class KeyboardView(context: Context, private val host: Host) : LinearLayout(context) {

    interface Host {
        val engine: Engine
        val dict: Dict
        val composingText: String
        fun insert(s: String)
        fun backspace()
        fun clear()
        fun commit(ch: String)
        fun switchToOtherIme()
    }

    private enum class Tab { SHAPE, COMMON, RADICAL }

    // 色。TextView の text/hint などと名前がぶつからないよう col 接頭辞をつける
    private val colBg = Color.parseColor("#FBFBF9")
    private val colCard = Color.WHITE
    private val colBorder = Color.parseColor("#E7E5E4")
    private val colText = Color.parseColor("#1C1917")
    private val colSub = Color.parseColor("#78716C")
    private val colAccent = Color.parseColor("#4437D1")
    private val colAccentBg = Color.parseColor("#EEF2FF")

    private val wrap = ViewGroup.LayoutParams.WRAP_CONTENT
    private val matchParent = ViewGroup.LayoutParams.MATCH_PARENT

    private var tabViews: List<TextView> = emptyList()
    private var tab = Tab.SHAPE
    private var strokeGroup = "common"
    private var searchSeq = 0
    private var cachedCommon: List<String>? = null

    private val composingLabel: TextView
    private val candidateRow: LinearLayout
    private val keyArea: LinearLayout
    private val strokeRow: HorizontalScrollView
    private val strokeInner: LinearLayout
    private val main = Handler(Looper.getMainLooper())

    /**
     * 部品パレット用のサブセットフォント(assets/KatachiParts.ttf)。
     * 「難輸入部件」は拡張B〜Hの字が多く端末の標準フォントに無いため、
     * これが無いとパレットに □ が並んで「見て選ぶ」画面が成立しない。
     * 収録していない字は OS が標準フォントへフォールバックする。
     */
    private val partsFont: Typeface = runCatching {
        Typeface.createFromAsset(context.assets, "KatachiParts.ttf")
    }.getOrDefault(Typeface.SERIF)

    init {
        orientation = VERTICAL
        setBackgroundColor(colBg)

        // ── 入力中の表示 ──
        val top = LinearLayout(context).apply {
            orientation = HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(8), dp(6), dp(8), dp(4))
        }
        composingLabel = TextView(context).apply {
            setTextColor(colText)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
            hint = "かたちと部品を選んでください"
            setHintTextColor(colSub)
            layoutParams = LayoutParams(0, wrap, 1f)
        }
        top.addView(composingLabel)
        top.addView(smallButton("⌫") { host.backspace() })
        top.addView(smallButton("消") { host.clear() })
        addView(top)

        // ── 候補 ──
        candidateRow = LinearLayout(context).apply {
            orientation = HORIZONTAL
            setPadding(dp(6), 0, dp(6), 0)
        }
        addView(
            HorizontalScrollView(context).apply {
                isHorizontalScrollBarEnabled = false
                addView(candidateRow)
                layoutParams = LayoutParams(matchParent, dp(52))
            },
        )

        // ── タブ ──
        val tabs = LinearLayout(context).apply {
            orientation = HORIZONTAL
            setPadding(dp(6), dp(2), dp(6), dp(2))
        }
        tabViews = listOf(
            Tab.SHAPE to "かたち",
            Tab.COMMON to "よく使う部品",
            Tab.RADICAL to "部首・偏旁",
        ).map { (t, label) ->
            tabButton(label) { tab = t; rebuildKeys() }.also { tabs.addView(it) }
        }
        tabs.addView(smallButton("あ") { host.switchToOtherIme() })
        addView(tabs)

        // ── 画数チップ(部首タブのときだけ) ──
        strokeInner = LinearLayout(context).apply {
            orientation = HORIZONTAL
            setPadding(dp(6), 0, dp(6), dp(2))
        }
        strokeRow = HorizontalScrollView(context).apply {
            isHorizontalScrollBarEnabled = false
            addView(strokeInner)
            visibility = View.GONE
        }
        addView(strokeRow)

        // ── キー ──
        keyArea = LinearLayout(context).apply {
            orientation = VERTICAL
            setPadding(dp(6), 0, dp(6), dp(8))
        }
        addView(
            ScrollView(context).apply {
                addView(keyArea)
                layoutParams = LayoutParams(matchParent, dp(210))
            },
        )

        buildStrokeChips()
        rebuildKeys()
        onComposingChanged()
    }

    // ---- サービスから呼ばれる ----

    fun onDictReady() {
        cachedCommon = null
        if (tab == Tab.COMMON) rebuildKeys()
        runSearch()
    }

    fun onComposingChanged() {
        composingLabel.text = readableComposing(host.composingText)
        runSearch()
    }

    /** 打った "LR日" を「〈左右〉日」と読める形にする(IDC文字は豆腐になるため) */
    private fun readableComposing(s: String): String =
        if (s.isEmpty()) "" else Ids.readable(Ids.compile(s))

    // ---- 候補 ----

    private fun runSearch() {
        val q = host.composingText
        val seq = ++searchSeq
        if (q.isEmpty()) {
            candidateRow.removeAllViews()
            return
        }
        // 10万字の走査は数十〜数百msかかるので UI スレッドを止めない
        thread(name = "katachi-search") {
            val r = host.engine.search(q, 60)
            main.post {
                if (seq == searchSeq) showCandidates(r) // 古い結果は捨てる
            }
        }
    }

    private fun showCandidates(r: Engine.Result) {
        candidateRow.removeAllViews()
        if (r.hits.isEmpty()) {
            candidateRow.addView(
                TextView(context).apply {
                    text = if (host.dict.jaCount == 0) "辞書を読み込み中…" else "該当なし"
                    setTextColor(colSub)
                    setPadding(dp(10), dp(14), dp(10), 0)
                },
            )
            return
        }
        for (h in r.hits) {
            candidateRow.addView(
                TextView(context).apply {
                    text = h.ch
                    setTextColor(if (host.dict.isExt(h.index)) colSub else colText)
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 24f)
                    typeface = partsFont
                    gravity = Gravity.CENTER
                    minWidth = dp(46)
                    setPadding(dp(6), dp(4), dp(6), dp(4))
                    background = keyBg(
                        if (h.exact) colAccentBg else colCard,
                        if (h.exact) colAccent else colBorder,
                    )
                    isClickable = true
                    setOnClickListener { host.commit(h.ch) }
                    layoutParams = LinearLayout.LayoutParams(wrap, dp(44)).apply { marginEnd = dp(4) }
                },
            )
        }
    }

    // ---- キーの並び ----

    private fun buildStrokeChips() {
        strokeInner.removeAllViews()
        val groups = listOf("common" to "よく使う") +
            Palettes.DIFFICULT.map { it.strokes to "${it.strokes}画" }
        for ((key, label) in groups) {
            val active = strokeGroup == key
            strokeInner.addView(
                TextView(context).apply {
                    text = label
                    setTextColor(if (active) colAccent else colSub)
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
                    setPadding(dp(10), dp(4), dp(10), dp(4))
                    background = keyBg(
                        if (active) colAccentBg else Color.TRANSPARENT,
                        if (active) colAccent else colBorder,
                    )
                    isClickable = true
                    setOnClickListener { strokeGroup = key; buildStrokeChips(); rebuildKeys() }
                    layoutParams = LinearLayout.LayoutParams(wrap, wrap).apply { marginEnd = dp(4) }
                },
            )
        }
    }

    private fun rebuildKeys() {
        tabViews.forEachIndexed { i, v ->
            val active = i == tab.ordinal
            v.setTextColor(if (active) colAccent else colSub)
            v.background = keyBg(
                if (active) colCard else Color.TRANSPARENT,
                if (active) colBorder else Color.TRANSPARENT,
            )
        }
        strokeRow.visibility = if (tab == Tab.RADICAL) View.VISIBLE else View.GONE
        keyArea.removeAllViews()

        when (tab) {
            Tab.SHAPE -> {
                // 操作子。IDC文字ではなく日本語ラベルを出す
                val codes = Ids.PRIMARY_CODES +
                    Ids.OPERATORS.map { it.code }.filter { it !in Ids.PRIMARY_CODES }
                grid(codes.size, 4) { i ->
                    val op = Ids.OPERATORS.first { it.code == codes[i] }
                    keyButton(op.label, 13f) { host.insert(op.code) }
                }
            }
            Tab.COMMON -> {
                val parts = commonParts()
                if (parts.isEmpty()) {
                    keyArea.addView(
                        TextView(context).apply {
                            text = "辞書を読み込み中…"
                            setTextColor(colSub)
                            setPadding(dp(10), dp(20), dp(10), 0)
                        },
                    )
                } else {
                    grid(parts.size, 8) { i -> keyButton(parts[i], 20f) { host.insert(parts[i]) } }
                }
            }
            Tab.RADICAL -> {
                val parts = if (strokeGroup == "common") {
                    Ids.tokens(Palettes.RADICAL)
                } else {
                    Ids.tokens(Palettes.DIFFICULT.first { it.strokes == strokeGroup }.parts)
                }
                grid(parts.size, 8) { i -> keyButton(parts[i], 20f) { host.insert(parts[i]) } }
            }
        }
    }

    /** 辞書内で構成要素として多く出てくる部品。日本語の字だけで数える */
    private fun commonParts(): List<String> {
        cachedCommon?.let { return it }
        if (host.dict.jaCount == 0) return emptyList()
        val count = HashMap<String, Int>(4096)
        for (i in 0 until host.dict.jaCount) {
            val ids = host.dict.ids[i]
            if (ids.isEmpty()) continue
            for (t in Ids.tokens(ids)) {
                if (t.length == 1 && (Ids.isIdc(t[0]) || Ids.isPlaceholder(t[0]))) continue
                if (t == host.dict.chars[i]) continue
                count[t] = (count[t] ?: 0) + 1
            }
        }
        val out = count.entries
            .sortedWith(compareByDescending<Map.Entry<String, Int>> { it.value }.thenBy { it.key })
            .take(120)
            .map { it.key }
        cachedCommon = out
        return out
    }

    // ---- 部品 ----

    private inline fun grid(count: Int, cols: Int, key: (Int) -> View) {
        var row: LinearLayout? = null
        for (i in 0 until count) {
            if (i % cols == 0) {
                row = LinearLayout(context).apply { orientation = HORIZONTAL }
                keyArea.addView(row)
            }
            row?.addView(
                key(i).apply {
                    layoutParams = LinearLayout.LayoutParams(0, dp(46), 1f)
                        .apply { setMargins(dp(2), dp(2), dp(2), dp(2)) }
                },
            )
        }
    }

    private fun keyButton(label: String, sizeSp: Float, onTap: () -> Unit): View =
        TextView(context).apply {
            text = label
            setTextColor(colText)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp)
            if (sizeSp >= 18f) typeface = partsFont
            gravity = Gravity.CENTER
            background = keyBg(colCard, colBorder)
            isClickable = true
            setOnClickListener { onTap() }
        }

    private fun smallButton(label: String, onTap: () -> Unit): View =
        TextView(context).apply {
            text = label
            setTextColor(colSub)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            gravity = Gravity.CENTER
            setPadding(dp(12), dp(6), dp(12), dp(6))
            background = keyBg(colCard, colBorder)
            isClickable = true
            setOnClickListener { onTap() }
            layoutParams = LinearLayout.LayoutParams(wrap, wrap).apply { marginStart = dp(4) }
        }

    private fun tabButton(label: String, onTap: () -> Unit): TextView =
        TextView(context).apply {
            text = label
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            gravity = Gravity.CENTER
            setPadding(dp(4), dp(7), dp(4), dp(7))
            isClickable = true
            setOnClickListener { onTap() }
            layoutParams = LinearLayout.LayoutParams(0, wrap, 1f).apply { marginEnd = dp(3) }
        }

    private fun keyBg(fill: Int, stroke: Int) = GradientDrawable().apply {
        setColor(fill)
        setStroke(dp(1), stroke)
        cornerRadius = dp(8).toFloat()
    }

    private fun dp(v: Int): Int =
        (v * resources.displayMetrics.density).toInt().coerceAtLeast(if (v > 0) 1 else 0)
}
