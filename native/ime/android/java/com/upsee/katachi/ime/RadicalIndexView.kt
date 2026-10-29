package com.upsee.katachi.ime

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.TextView

class RadicalIndexView(context: Context, private val commit: (String) -> Unit, private val font: (String) -> Typeface?) : LinearLayout(context) {
    private val index = UnicodeRadicalIndex(context.assets.open("radical-index.tsv").bufferedReader().use { it.readText() })
    private var strokes: Int? = null
    private var radical: Int? = null
    private var residual: Int? = null
    private var page = 0
    private fun dp(n: Int) = (n*resources.displayMetrics.density).toInt()
    init { orientation = VERTICAL; build() }
    private fun button(label: String, action: () -> Unit) = TextView(context).apply {
        text = label; textSize = 13f; gravity = Gravity.CENTER; setTextColor(Color.rgb(40,40,45)); setBackgroundColor(Color.rgb(241,241,245))
        isClickable = true; isFocusable = true; setOnClickListener { action() }
        layoutParams = LayoutParams(0,LayoutParams.MATCH_PARENT,1f).apply { setMargins(dp(2),dp(2),dp(2),dp(2)) }
    }
    private fun build() {
        removeAllViews()
        val title = if (strokes == null) "部首の画数" else if (radical == null) "${strokes}画の部首" else if (residual == null) "${UnicodeRadicalIndex.label(radical!!)}：残り画数" else "${UnicodeRadicalIndex.label(radical!!)} ＋ ${residual}画"
        val head = LinearLayout(context)
        head.addView(button("‹ 戻る") { page = 0; if (residual != null) residual = null else if (radical != null) radical = null else strokes = null; build() }.apply { isEnabled = strokes != null })
        head.addView(button(title) {}.apply { isClickable = false; layoutParams = LayoutParams(0,LayoutParams.MATCH_PARENT,2.5f) })
        head.addView(button("最初へ") { strokes = null; radical = null; residual = null; page = 0; build() })
        addView(head,LayoutParams(LayoutParams.MATCH_PARENT,dp(36)))
        val isChars = residual != null
        val numbers = if (strokes == null) (1..17).toList() else if (radical == null) UnicodeRadicalIndex.radicals(strokes!!) else if (residual == null) index.residuals(radical!!) else emptyList()
        val items = if (isChars) index.characters(radical!!,residual!!) else numbers.map { it.toString() }
        page = minOf(page,maxOf(0,(items.size-1)/20))
        for (row in 0..4) {
            val line = LinearLayout(context)
            for (col in 0..3) {
                val at = page*20+row*4+col
                if (at >= items.size) { line.addView(button("") {}.apply { visibility = INVISIBLE }); continue }
                val value = items[at]
                val name = if (isChars) value else if (strokes != null && radical == null) UnicodeRadicalIndex.label(value.toInt()) else "${value}画"
                line.addView(button(name) {
                    if (isChars) commit(value) else {
                        page = 0
                        if (strokes == null) strokes = value.toInt() else if (radical == null) radical = value.toInt() else residual = value.toInt()
                        build()
                    }
                }.apply { if (isChars) { typeface = font(value); textSize = 24f; contentDescription = "$value U+${value.codePointAt(0).toString(16).uppercase()}を入力" } })
            }
            addView(line,LayoutParams(LayoutParams.MATCH_PARENT,0,1f))
        }
        val nav = LinearLayout(context)
        nav.addView(button("‹ 前") { page--; build() }.apply { isEnabled = page > 0 })
        nav.addView(button("${items.size}件 · ${page+1}/${maxOf(1,(items.size+19)/20)}") {}.apply { isClickable = false })
        nav.addView(button("次 ›") { page++; build() }.apply { isEnabled = (page+1)*20 < items.size })
        addView(nav,LayoutParams(LayoutParams.MATCH_PARENT,dp(32)))
    }
}
