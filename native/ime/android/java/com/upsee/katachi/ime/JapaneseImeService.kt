package com.upsee.katachi.ime

import android.graphics.Color
import android.graphics.Typeface
import android.inputmethodservice.InputMethodService
import android.os.Handler
import android.os.Looper
import android.text.SpannableString
import android.text.Spanned
import android.text.style.MetricAffectingSpan
import android.text.TextPaint
import android.text.style.AbsoluteSizeSpan
import android.text.TextUtils
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Switch
import java.util.concurrent.Executors

/** Second, independently enableable IME. Dictionary and settings never leave the device. */
class JapaneseImeService : InputMethodService(), FlickKanaView.Host {
    private lateinit var store: Store
    private lateinit var lexicon: JapaneseLexicon
    private val executor = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    private var reading = ""
    @Volatile private var sequence = 0
    private var page = 0
    private var mode = "kana"
    private var caps = false
    private var order = JapaneseLexicon.ids
    private var languages = emptyList<String>()
    private var root: LinearLayout? = null
    private lateinit var content: LinearLayout
    private lateinit var composingLabel: TextView
    private var candidates: LinearLayout? = null
    private var countLabel: TextView? = null
    private var previous: TextView? = null
    private var next: TextView? = null
    private var flick: FlickKanaView? = null
    private val textColor = Color.rgb(35,35,40)
    private val cardColor = Color.rgb(241,241,245)
    private val accentColor = Color.rgb(68,55,209)
    private val ext1 by lazy { runCatching { Typeface.createFromAsset(assets,"fonts/KatachiExt1.ttf") }.getOrNull() }
    private val ext2 by lazy { runCatching { Typeface.createFromAsset(assets,"fonts/KatachiExt2.ttf") }.getOrNull() }
    private fun dp(n: Int) = (n*resources.displayMetrics.density).toInt()
    private fun font(ch: String): Typeface? = when (ExtFonts.fontIndex(ch.codePointAt(0))) { 1 -> ext1; 2 -> ext2; else -> Typeface.DEFAULT }
    override fun onCreate() {
        super.onCreate(); store = Store(this)
        lexicon = JapaneseLexicon { key -> runCatching { assets.open("japanese-$key.tsv").use { it.readBytes() } }.getOrDefault(byteArrayOf()) }
    }
    override fun onDestroy() { sequence++; executor.shutdownNow(); super.onDestroy() }
    override fun onStartInput(attribute: EditorInfo?, restarting: Boolean) {
        super.onStartInput(attribute,restarting); reading = ""; sequence++; page = 0; order = store.japaneseOrder(); languages = store.foreignReadings()
        flick?.resetToggle(); if (root != null) refresh()
    }
    override fun onStartInputView(info: EditorInfo?, restarting: Boolean) { super.onStartInputView(info,restarting); order = store.japaneseOrder(); languages = store.foreignReadings(); if (mode == "settings") buildContent() else refresh() }
    override fun onFinishInput() {
        currentInputConnection?.finishComposingText(); reading = ""; sequence++; flick?.resetToggle(); super.onFinishInput()
    }
    override fun onUpdateSelection(oldSelStart: Int, oldSelEnd: Int, newSelStart: Int, newSelEnd: Int, candidatesStart: Int, candidatesEnd: Int) {
        super.onUpdateSelection(oldSelStart,oldSelEnd,newSelStart,newSelEnd,candidatesStart,candidatesEnd)
        if (reading.isNotEmpty() && (newSelStart != candidatesEnd || newSelEnd != candidatesEnd)) {
            reading = ""; currentInputConnection?.finishComposingText(); flick?.resetToggle(); refresh()
        }
    }
    override fun onCreateInputView(): View {
        val outer = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.WHITE); setPadding(dp(4),dp(4),dp(4),dp(4)) }
        root = outer
        val keyboard = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        outer.addView(keyboard,LinearLayout.LayoutParams(-1,dp(420)))
        outer.setOnApplyWindowInsetsListener { v,insets ->
            val bottom = if (android.os.Build.VERSION.SDK_INT >= 30) insets.getInsets(android.view.WindowInsets.Type.navigationBars()).bottom else @Suppress("DEPRECATION") insets.systemWindowInsetBottom
            v.setPadding(dp(4),dp(4),dp(4),dp(4)+bottom); insets
        }
        keyboard.addView(row(listOf(
            button("🌐") { currentInputConnection?.finishComposingText(); (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).showInputMethodPicker() },
            button("かな") { mode = "kana"; buildContent() }, button("ABC/123") { mode = "ascii"; buildContent() },
            button("部首索引") { mode = "radical"; buildContent() }, button("設定") { mode = "settings"; buildContent() }
        )),LinearLayout.LayoutParams(-1,dp(36)))
        composingLabel = TextView(this).apply { textSize = 17f; setTextColor(textColor); isSingleLine = true }
        keyboard.addView(composingLabel,LinearLayout.LayoutParams(-1,dp(28)))
        content = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }; keyboard.addView(content,LinearLayout.LayoutParams(-1,0,1f))
        buildContent(); return outer
    }
    private fun button(label: String, action: () -> Unit) = TextView(this).apply {
        text = label; textSize = 12f; gravity = Gravity.CENTER; setTextColor(textColor); setBackgroundColor(cardColor)
        isClickable = true; isFocusable = true; setOnClickListener { action() }
        layoutParams = LinearLayout.LayoutParams(0,-1,1f).apply { setMargins(dp(2),dp(2),dp(2),dp(2)) }
    }
    private fun row(views: List<View>) = LinearLayout(this).apply { views.forEach { addView(it) } }
    private fun compose() { currentInputConnection?.setComposingText(reading,1); refresh() }
    private fun literal(text: String) {
        val ic = currentInputConnection
        ic?.beginBatchEdit()
        if (reading.isNotEmpty()) ic?.commitText(reading,1)
        reading = ""
        if (text.isNotEmpty()) ic?.commitText(text,1)
        ic?.endBatchEdit(); flick?.resetToggle(); refresh()
    }
    private fun enter() {
        if (reading.isNotEmpty()) { literal(""); return }
        val info = currentInputEditorInfo
        val action = info?.imeOptions?.and(EditorInfo.IME_MASK_ACTION) ?: EditorInfo.IME_ACTION_NONE
        if (info != null && info.imeOptions and EditorInfo.IME_FLAG_NO_ENTER_ACTION == 0 && action != EditorInfo.IME_ACTION_NONE && action != EditorInfo.IME_ACTION_UNSPECIFIED) currentInputConnection?.performEditorAction(action)
        else currentInputConnection?.commitText("\n",1)
    }
    private fun buildContent() {
        sequence++; content.removeAllViews(); flick = null; candidates = null
        if (mode == "settings") { buildSettings(); return }
        if (mode == "radical") { content.addView(RadicalIndexView(this,{ literal(it) },{ font(it) }),LinearLayout.LayoutParams(-1,-1)); return }
        val area = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }; candidates = area
        content.addView(area,LinearLayout.LayoutParams(-1,dp(92)))
        previous = button("‹ 前") { page--; refresh(false) }
        next = button("次 ›") { page++; refresh(false) }
        countLabel = button("") {}.apply { isClickable = false; textSize = 11f }
        content.addView(row(listOf(previous!!,countLabel!!,next!!)),LinearLayout.LayoutParams(-1,dp(28)))
        if (mode == "ascii") {
            val pad = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
            for (raw in listOf("1234567890","qwertyuiop","asdfghjkl","zxcvbnm","⇧@.-_/:!?⌫")) {
                val chars = if (caps) raw.uppercase(java.util.Locale.ROOT) else raw
                pad.addView(row(chars.map { ch -> button(ch.toString()) {
                    when (ch) { '⌫' -> backspaceKana(); '⇧' -> { caps = !caps; buildContent() }; else -> literal(ch.toString()) }
                } }),LinearLayout.LayoutParams(-1,0,1f))
            }
            content.addView(pad,LinearLayout.LayoutParams(-1,0,1f))
        } else {
            flick = FlickKanaView(this,textColor,Color.GRAY,cardColor,Color.LTGRAY,Color.rgb(223,220,255),"flick",this)
            content.addView(flick,LinearLayout.LayoutParams(-1,0,1f))
        }
        content.addView(row(listOf(button("、") { literal("、") },button("。") { literal("。") },button("空白") { literal(" ") },button("かな確定") { literal("") },button("確定/改行") { enter() })),LinearLayout.LayoutParams(-1,dp(36)))
        refresh()
    }
    private fun buildSettings() {
        val stack = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        stack.addView(TextView(this).apply { text = "外国語の読み（初期設定はすべてオフ）"; textSize = 13f; setTextColor(textColor) })
        for ((i,id) in JapaneseLexicon.languageIDs.withIndex()) {
            stack.addView(Switch(this).apply {
                text = JapaneseLexicon.languageLabels[i]; textSize = 13f; setTextColor(textColor)
                isChecked = id in languages; contentDescription = "${JapaneseLexicon.languageLabels[i]}の読みで入力"
                setOnCheckedChangeListener { _, enabled ->
                    languages = JapaneseLexicon.languages(if (enabled) languages + id else languages.filter { it != id })
                    store.saveForeignReadings(languages)
                }
            },LinearLayout.LayoutParams(-1,dp(44)))
        }
        stack.addView(TextView(this).apply { text = "かなで入力。カナは発音の目安で声調は省略。候補に言語名と元の読みを表示します。"; textSize = 11f; setTextColor(textColor) })
        stack.addView(TextView(this).apply { text = "候補の優先順位"; textSize = 13f; setTextColor(textColor) })
        for ((i,id) in order.withIndex()) {
            val line = LinearLayout(this)
            line.addView(button("${i+1}. ${JapaneseLexicon.labels[JapaneseLexicon.ids.indexOf(id)]}") {}.apply { isClickable = false; gravity = Gravity.CENTER_VERTICAL; layoutParams = LinearLayout.LayoutParams(0,-1,1f) })
            for (step in listOf(-1,1)) line.addView(button(if (step < 0) "↑" else "↓") {
                if (i+step in order.indices) { order = order.toMutableList().apply { java.util.Collections.swap(this,i,i+step) }; store.saveJapaneseOrder(order); buildContent() }
            }.apply { isEnabled = i+step in order.indices; contentDescription = "${JapaneseLexicon.labels[JapaneseLexicon.ids.indexOf(id)]}を${if (step < 0) "上" else "下"}へ"; layoutParams = LinearLayout.LayoutParams(dp(48),-1) })
            stack.addView(line,LinearLayout.LayoutParams(-1,dp(40)))
        }
        stack.addView(TextView(this).apply { text = "上の分類を優先。出典・ライセンスは本アプリの設定に掲載。"; textSize = 11f; setTextColor(textColor) })
        content.addView(ScrollView(this).apply { addView(stack) },LinearLayout.LayoutParams(-1,-1))
    }
    private fun refresh(resetPage: Boolean = true) {
        if (root == null) return
        if (resetPage) page = 0
        val token = ++sequence; val q = reading; val p = page; val priority = order.toList(); val enabled = languages.toList()
        composingLabel.text = if (q.isEmpty()) "日本語拡張フリック" else q
        if (mode != "kana" && mode != "ascii") return
        candidates?.removeAllViews(); previous?.isEnabled = false; next?.isEnabled = false
        countLabel?.text = if (q.isEmpty()) "読みを入力" else "検索中…"
        executor.execute {
            if (token != sequence) return@execute
            lexicon.search(q,priority,enabled); val total = lexicon.count; val items = lexicon.page(p*8,8)
            main.post {
                if (token != sequence) return@post
                countLabel?.text = if (total == 0) "読みを入力" else "${total}件 · ${p+1}/${(total+7)/8}"
                previous?.isEnabled = p > 0; next?.isEnabled = (p+1)*8 < total
                for (r in 0..1) {
                    val cells = (0..3).map { c ->
                        val item = items.getOrNull(r*4+c)
                        if (item == null) button("") {}.apply { visibility = View.INVISIBLE }
                        else button(item.text+"\n"+(if (item.language.isNotEmpty()) "${JapaneseLexicon.languageLabel(item.language)} ${item.original}" else if (item.kind == 2) "先頭${item.consumed}字" else JapaneseLexicon.shortLabel(item.mask,priority))) {
                            if (reading == q) {
                                val ic = currentInputConnection; ic?.beginBatchEdit(); ic?.commitText(item.text,1)
                                reading = q.drop(item.consumed)
                                if (reading.isNotEmpty()) ic?.setComposingText(reading,1)
                                ic?.endBatchEdit(); flick?.resetToggle(); refresh()
                            }
                        }.apply {
                            val note = if (item.language.isEmpty()) JapaneseLexicon.label(item.mask,priority) else "${JapaneseLexicon.languageLabel(item.language)} ${item.original}"
                            contentDescription = "${item.text}, ${item.reading}, $note"
                            // Typeface per Unicode scalar so a mixed word retains all extended glyphs.
                            val value = SpannableString(text); var at = 0
                            value.setSpan(AbsoluteSizeSpan(16,true),0,item.text.length,Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                            value.setSpan(AbsoluteSizeSpan(9,true),item.text.length,value.length,Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                            for (cp in item.text.codePoints().toArray()) {
                                val ch = String(Character.toChars(cp)); val tf = font(ch)
                                if (tf != null) value.setSpan(object : MetricAffectingSpan() {
                                    override fun updateDrawState(p: TextPaint) { p.typeface = tf }
                                    override fun updateMeasureState(p: TextPaint) { p.typeface = tf }
                                },at,at+ch.length,Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                                at += ch.length
                            }
                            text = value
                            maxLines = 2; ellipsize = TextUtils.TruncateAt.END
                            setOnLongClickListener { android.widget.Toast.makeText(this@JapaneseImeService,"${item.text}\n${item.reading}\n$note",android.widget.Toast.LENGTH_LONG).show(); true }
                        }
                    }
                    candidates?.addView(row(cells),LinearLayout.LayoutParams(-1,0,1f))
                }
            }
        }
    }
    override fun appendKana(ch: String) { reading += ch; compose() }
    override fun replaceLastKana(ch: String) { reading = reading.dropLast(1)+ch; compose() }
    override fun cycleLastKana() { reading.lastOrNull()?.let { Kana.cycle(it.toString())?.let { next -> reading = reading.dropLast(1)+next; compose() } } }
    override fun backspaceKana() {
        if (reading.isNotEmpty()) { reading = reading.dropLast(1); compose() }
        else currentInputConnection?.let { ic ->
            val selected = ic.getSelectedText(0)
            if (!selected.isNullOrEmpty()) ic.commitText("",1)
            else {
                val before = ic.getTextBeforeCursor(2048,0)?.toString().orEmpty()
                if (before.isNotEmpty()) {
                    val boundaries = android.icu.text.BreakIterator.getCharacterInstance(java.util.Locale.ROOT)
                    boundaries.setText(before); boundaries.last()
                    val start = boundaries.previous().coerceAtLeast(0)
                    ic.deleteSurroundingText(before.length-start,0)
                }
            }
        }
    }
    override fun previewKana(ch: String?) { composingLabel.text = reading+(ch ?: "") }
    override fun keyFeedback(v: View, down: Boolean) { if (down) v.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP) }
}
