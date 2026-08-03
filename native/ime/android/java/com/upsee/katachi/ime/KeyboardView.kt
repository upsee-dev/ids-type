package com.upsee.katachi.ime

import android.annotation.SuppressLint
import android.content.Context
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.HapticFeedbackConstants
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
        /** 着せ替えの反映。色は生成時に決まるので、ビューを作り直してもらう */
        fun recreateKeyboard()
    }

    private enum class Tab { SHAPE, COMMON, RADICAL }

    private companion object {
        /** ⌫長押しの連射間隔。標準のキーボードと同じくらいの速さ */
        const val REPEAT_INTERVAL_MS = 60L

        /** 連射中に音を鳴らす頻度。毎回鳴らすと「ジジジ」と潰れて聞こえる */
        const val SOUND_EVERY_N_REPEATS = 3

        /** 着せ替えの保存キーと「おまかせ」の値 */
        const val PREF_THEME = "theme"
        const val THEME_AUTO = "auto"
    }

    /**
     * 着せ替え。テーマの定義は core/data/themes.ts が唯一の出所で、
     * Themes.kt は build:data の生成物。選んだテーマは SharedPreferences に
     * 覚える(既定 "auto" = 端末のライト/ダーク設定に追従)。
     * 🎨キーで切り替え → サービスがキーボードを作り直して反映する。
     */
    private val prefs = context.getSharedPreferences("katachi", Context.MODE_PRIVATE)

    private val night: Boolean =
        (context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
            Configuration.UI_MODE_NIGHT_YES

    private val palette: Themes.Palette =
        Themes.resolve(prefs.getString(PREF_THEME, THEME_AUTO), night)

    // 色。TextView の text/hint などと名前がぶつからないよう col 接頭辞をつける
    private val colBg = Color.parseColor(palette.bg)
    private val colCard = Color.parseColor(palette.card)
    private val colBorder = Color.parseColor(palette.border)
    private val colText = Color.parseColor(palette.text)
    private val colSub = Color.parseColor(palette.sub)
    private val colAccent = Color.parseColor(palette.accent)
    private val colAccentBg = Color.parseColor(palette.accentBg)

    private fun cycleTheme() {
        val order = listOf(THEME_AUTO) + Themes.ALL.map { it.key }
        val cur = prefs.getString(PREF_THEME, THEME_AUTO)
        val next = order[(order.indexOf(cur) + 1).mod(order.size)]
        prefs.edit().putString(PREF_THEME, next).apply()
        host.recreateKeyboard()
    }

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
     * 拡張漢字用の同梱フォント(assets/fonts/KatachiExt{1,2}.ttf)。
     * 端末の標準フォントは拡張B以降を持っておらず、これが無いと部品パレットも
     * 候補も ☒ で埋まって「見て選ぶ」画面が成立しない。
     *
     * RN アプリと同じファイルを読んでいる(app.json の expo-font プラグインが
     * assets/fonts/ に置く)ので、APK に入るのは1部だけでサイズは増えない。
     * 7.5万字は TrueType の65,535グリフ上限に収まらないため2つに分かれており、
     * どちらで描くかは符号位置で決まる(extFontRanges.ts と同じ切り方)。
     * 作り直し: scripts/build-font-app.py
     */
    private fun loadFont(name: String): Typeface = runCatching {
        Typeface.createFromAsset(context.assets, "fonts/$name.ttf")
    }.getOrDefault(Typeface.SERIF)

    private val extFont1: Typeface by lazy { loadFont("KatachiExt1") }
    private val extFont2: Typeface by lazy { loadFont("KatachiExt2") }

    /** 1字を描くフォント。どちらにも無い字は端末の標準フォント(明朝)に任せる */
    private fun fontFor(s: String): Typeface =
        when (if (s.isEmpty()) 0 else ExtFonts.fontIndex(s.codePointAt(0))) {
            1 -> extFont1
            2 -> extFont2
            else -> Typeface.SERIF
        }

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
        top.addView(repeatingButton("⌫") { host.backspace() })
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
        tabs.addView(smallButton("🎨") { cycleTheme() })
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

        // フォントは合計21MBある。最初のタップで読むとキーボードが固まるので、
        // 辞書と同じように裏で先に読んでおく(by lazy は同期化されているので安全)。
        thread(name = "katachi-font") {
            val loaded = listOf(extFont1, extFont2).first()
            main.post {
                // 入力中の表示は1字ずつ分けられないので、部品を多く含む1枚目を当てる。
                // このフォントに無い字(かな・常用漢字)は OS が標準フォントで描く
                composingLabel.typeface = loaded
                rebuildKeys()
            }
        }
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
                    typeface = fontFor(h.ch)
                    gravity = Gravity.CENTER
                    minWidth = dp(46)
                    setPadding(dp(6), dp(4), dp(6), dp(4))
                    background = keyBg(
                        if (h.exact) colAccentBg else colCard,
                        if (h.exact) colAccent else colBorder,
                    )
                    isClickable = true
                    setOnClickListener { host.commit(h.ch) }
                    feedbackOnPress()
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
                    feedbackOnPress()
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
            if (sizeSp >= 18f) typeface = fontFor(label)
            gravity = Gravity.CENTER
            background = keyBg(colCard, colBorder)
            isClickable = true
            setOnClickListener { onTap() }
            feedbackOnPress()
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
            feedbackOnPress()
            layoutParams = LinearLayout.LayoutParams(wrap, wrap).apply { marginStart = dp(4) }
        }

    /**
     * 長押しで連射するキー(⌫用)。1文字ずつタップさせると打ち直しが遅すぎるので、
     * 標準のキーボードと同じように押しっぱなしで消せるようにする。
     *
     * 連射中は触覚も音も**間引く**。60msごとに打鍵と同じ強さで返すと、
     * 手のひらが震えるだけの不快な連続振動になってしまう。触覚は連続で出す
     * ことを前提にした軽い刻み、音は数回に1回にしている。
     */
    @SuppressLint("ClickableViewAccessibility")
    private fun repeatingButton(label: String, onTap: () -> Unit): View {
        val v = smallButton(label, onTap)
        var ticks = 0
        val repeat = object : Runnable {
            override fun run() {
                v.performHapticFeedback(repeatTick)
                if (ticks++ % SOUND_EVERY_N_REPEATS == 0) {
                    audio?.playSoundEffect(AudioManager.FX_KEYPRESS_DELETE)
                }
                onTap()
                main.postDelayed(this, REPEAT_INTERVAL_MS)
            }
        }
        v.setOnLongClickListener {
            ticks = 0
            main.postDelayed(repeat, REPEAT_INTERVAL_MS)
            true // 長押しを消費する。onClick は走らない
        }
        // smallButton が張った押し下げ触覚のリスナーをここで置き換える
        // (1つのビューに OnTouchListener は1つしか付かないため、両方をここで見る)
        v.setOnTouchListener { view, e ->
            when (e.action) {
                android.view.MotionEvent.ACTION_DOWN -> view.pressFeedback()
                android.view.MotionEvent.ACTION_UP -> {
                    view.releaseFeedback()
                    main.removeCallbacks(repeat)
                }
                android.view.MotionEvent.ACTION_CANCEL -> main.removeCallbacks(repeat)
            }
            false // タップ・長押しの判定は View に任せる
        }
        return v
    }

    /**
     * 連射中の刻み。SEGMENT_TICK は「連続で出しても不快にならない強さ」として
     * Android 14 で入ったもの。古い端末は CLOCK_TICK(同じく軽い)で代用する。
     */
    private val repeatTick: Int
        get() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            HapticFeedbackConstants.SEGMENT_TICK
        } else {
            HapticFeedbackConstants.CLOCK_TICK
        }

    private fun tabButton(label: String, onTap: () -> Unit): TextView =
        TextView(context).apply {
            text = label
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            gravity = Gravity.CENTER
            setPadding(dp(4), dp(7), dp(4), dp(7))
            isClickable = true
            setOnClickListener { onTap() }
            feedbackOnPress()
            layoutParams = LinearLayout.LayoutParams(0, wrap, 1f).apply { marginEnd = dp(3) }
        }

    /**
     * 打鍵フィードバック。
     *
     * 気持ちよさは「指が触れた瞬間に返る」ことで決まるので、クリック(＝指を
     * 離したとき)ではなく ACTION_DOWN で鳴らす。離したときは KEYBOARD_RELEASE を
     * 返して、押し込み → 戻りの2段にする(標準のキーボードと同じ手触り)。
     *
     * 端末の「キー操作音」「操作時のバイブ」設定が切られていれば OS 側が黙って
     * 無視するので、ここで設定を見る必要はない。
     */
    private val audio by lazy {
        context.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
    }

    private fun View.pressFeedback(sound: Boolean = true) {
        performHapticFeedback(HapticFeedbackConstants.KEYBOARD_PRESS)
        if (sound) audio?.playSoundEffect(AudioManager.FX_KEYPRESS_STANDARD)
    }

    private fun View.releaseFeedback() {
        performHapticFeedback(HapticFeedbackConstants.KEYBOARD_RELEASE)
    }

    /**
     * 押した瞬間に触覚を返すようにする。onClick(離したとき)に任せると
     * 一拍遅れて、自分の指と手応えがずれる。
     */
    @SuppressLint("ClickableViewAccessibility")
    private fun View.feedbackOnPress() {
        setOnTouchListener { v, e ->
            when (e.action) {
                android.view.MotionEvent.ACTION_DOWN -> v.pressFeedback()
                android.view.MotionEvent.ACTION_UP -> v.releaseFeedback()
            }
            false // タップ判定そのものは View に任せる
        }
    }

    private fun keyBg(fill: Int, stroke: Int) = GradientDrawable().apply {
        setColor(fill)
        setStroke(dp(1), stroke)
        cornerRadius = dp(8).toFloat()
    }

    private fun dp(v: Int): Int =
        (v * resources.displayMetrics.density).toInt().coerceAtLeast(if (v > 0) 1 else 0)
}
