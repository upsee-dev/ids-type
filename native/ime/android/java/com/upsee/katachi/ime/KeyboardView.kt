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
import android.text.SpannableString
import android.text.Spanned
import android.text.style.ForegroundColorSpan
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
 *   [ 履歴 ★ 着せ替え            他のキーボード ]  ← 道具の帯(打つ場所ではない)
 *   [ (棚) 使った字 / お気に入りの字            ]
 *   [ 入力中のかたち ]                 [⌫] [消]
 *   [ 候補: 明 朝 晴 …                          ]
 *   [ かたち: 左右 上下 …                        ]
 *   [ よく使う部品 | 部首・偏旁 | 読みでさがす    ]
 *   [ キーの並び / 読みのフリック面               ]
 *
 * 上の帯だけは打つための場所ではないので、間に線を引いて色も落とし、
 * 打鍵の面から視覚的に切り離してある。
 *
 * IDC文字(⿰⿱⿴…)は端末のフォントで豆腐になるので、操作子は日本語ラベルで出す。
 */
@SuppressLint("ViewConstructor")
class KeyboardView(context: Context, private val host: Host) :
    LinearLayout(context), FlickKanaView.Host {

    interface Host {
        val engine: Engine
        val dict: Dict
        val composingText: String
        /** 履歴・お気に入り(アプリと共有) */
        val store: Store
        fun insert(s: String)
        fun backspace()
        fun clear()
        fun commit(ch: String)
        fun switchToOtherIme()
        /** 着せ替えの反映。色は生成時に決まるので、ビューを作り直してもらう */
        fun recreateKeyboard()
    }

    /**
     * キー面の種類。**かたち(操作子)はタブに含めない**。
     * 「⿰の左右」を選んでから部品を2つ選ぶ、という打ち方をするので、
     * かたちと部品が別タブにあると1字打つたびに往復させられる。
     * かたちは候補の下に常時出しておき、タブは部品の出し分けだけに使う。
     *
     * SEARCH は読みから部品を引く面。他のかなキーボードへ移らずに読みを
     * 打てるよう、フリックのかな面をこの中に持つ。
     */
    private enum class Tab { COMMON, RADICAL, SEARCH }

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
    private var tab = Tab.COMMON
    private var strokeGroup = "common"
    private var searchSeq = 0
    private var readingSeq = 0
    private var cachedCommon: List<String>? = null

    /** 棚(履歴・お気に入り)の開き方。閉じているときは高さを持たない */
    private enum class Shelf { NONE, HISTORY, FAVORITES }
    private var shelf = Shelf.NONE
    private lateinit var shelfScroll: HorizontalScrollView
    private lateinit var shelfInner: LinearLayout
    private lateinit var shelfButtons: Map<Shelf, TextView>

    /** 読みでさがす面の状態。読みそのものと、指を置いている間の仮の1字 */
    private val reading = StringBuilder()
    private var readingPreview: String? = null
    private var readingLabel: TextView? = null
    private var readingHits: LinearLayout? = null
    private var flick: FlickKanaView? = null

    private val composingLabel: TextView
    private val candidateRow: LinearLayout
    private val keyArea: LinearLayout
    private val keyScroll: ScrollView
    private val strokeRow: HorizontalScrollView
    private val strokeInner: LinearLayout
    /** かたち(操作子)の行。タブに関係なく常に出す */
    private val opInner: LinearLayout
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

        // ── 道具の帯 ──
        // 履歴・お気に入り・着せ替えは「打つための場所」ではないので、
        // いちばん上にまとめ、下に線を引いて打鍵の面から切り離す。
        // 入力欄のすぐ隣に置くと、打つつもりで触ってしまう
        addView(buildToolRow())
        addView(
            View(context).apply {
                setBackgroundColor(colBorder)
                layoutParams = LayoutParams(matchParent, dp(1))
            },
        )

        // ── 棚(履歴・お気に入り) ──
        shelfInner = LinearLayout(context).apply {
            orientation = HORIZONTAL
            setPadding(dp(6), dp(4), dp(6), dp(4))
        }
        shelfScroll = HorizontalScrollView(context).apply {
            isHorizontalScrollBarEnabled = false
            addView(shelfInner)
            visibility = View.GONE
            setBackgroundColor(colCard)
            layoutParams = LayoutParams(matchParent, wrap)
        }
        addView(shelfScroll)

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

        // ── かたち(操作子) ──
        // タブの外に出して常時表示にする。「かたち→部品→部品」と続けて打つのに
        // タブ往復が要らなくなる
        opInner = LinearLayout(context).apply {
            orientation = HORIZONTAL
            setPadding(dp(6), dp(4), dp(6), dp(4))
        }
        addView(
            HorizontalScrollView(context).apply {
                isHorizontalScrollBarEnabled = false
                addView(opInner)
                layoutParams = LayoutParams(matchParent, wrap)
            },
        )
        buildOperators()

        // ── タブ(部品パレットの出し分けだけ) ──
        val tabs = LinearLayout(context).apply {
            orientation = HORIZONTAL
            setPadding(dp(6), dp(2), dp(6), dp(2))
        }
        tabViews = listOf(
            Tab.COMMON to "よく使う部品",
            Tab.RADICAL to "部首・偏旁",
            Tab.SEARCH to "読みでさがす",
        ).map { (t, label) ->
            tabButton(label) { tab = t; rebuildKeys() }.also { tabs.addView(it) }
        }
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
        keyScroll = ScrollView(context).apply {
            addView(keyArea)
            // かたちの行を常時表示にしたぶん、キーボード全体が高くなりすぎない
            // よう部品グリッドを詰める(足りない分はスクロールで出す)。
            // 読みの面はフリック4段が入る高さが要るので rebuildKeys が伸ばす
            layoutParams = LayoutParams(matchParent, dp(168))
        }
        addView(keyScroll)

        buildStrokeChips()
        rebuildKeys()
        onComposingChanged()
        refreshShelf() // 棚は閉じた状態。道具の帯のボタンの色をここで当てる

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
        if (tab == Tab.SEARCH) runReadingSearch()
    }

    fun onComposingChanged() {
        composingLabel.text = readableComposing(host.composingText)
        runSearch()
    }

    /** 字を確定した。履歴が増えているので棚を開いていれば追いつかせる */
    fun onCommitted() {
        if (shelf != Shelf.NONE) refreshShelf()
    }

    // ---- 道具の帯(履歴・お気に入り・着せ替え) ----

    /**
     * 打つための場所ではないものを上端にまとめた帯。
     * 字を小さく色も落とし、下に線を引いて打鍵の面と切り離してある。
     */
    private fun buildToolRow(): View {
        val row = LinearLayout(context).apply {
            orientation = HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(6), dp(4), dp(6), dp(4))
            setBackgroundColor(colCard)
        }
        val history = toolButton(Icons.HISTORY, "履歴") { toggleShelf(Shelf.HISTORY) }
        val favorites = toolButton(Icons.STAR_OUTLINE, "★") { toggleShelf(Shelf.FAVORITES) }
        shelfButtons = mapOf(Shelf.HISTORY to history, Shelf.FAVORITES to favorites)
        row.addView(history)
        row.addView(favorites)
        row.addView(toolButton(Icons.PALETTE, "着せ替え") { cycleTheme() })
        // 残りを押し広げて「他のキーボード」を右端へ
        row.addView(View(context), LayoutParams(0, dp(1), 1f))
        row.addView(toolButton(Icons.GLOBE, "他のキーボード") { host.switchToOtherIme() })
        return row
    }

    /**
     * 道具の帯のアイコン。符号位置は Ionicons のもの。
     * (アプリ側が入れている @react-native-vector-icons/ionicons の字形)
     */
    private object Icons {
        const val HISTORY = 0xF5DE
        const val STAR = 0xF595
        const val STAR_OUTLINE = 0xF599
        const val PALETTE = 0xF27E
        const val GLOBE = 0xF350
    }

    /**
     * アイコンのフォント。RNアプリが入れている Ionicons を**同じAPKの assets から
     * 借りる**(fonts/Ionicons.ttf。@react-native-vector-icons/ionicons が置く)。
     * キーボードのためだけに同じフォントをもう1部積むのは無駄なので、
     * 拡張漢字フォントと同じ考え方で1部を共有する。
     * 読めなかったときは日本語のラベルに落とすので、フォントが消えても意味は伝わる。
     */
    private val iconFont: Typeface? by lazy {
        runCatching { Typeface.createFromAsset(context.assets, "fonts/Ionicons.ttf") }.getOrNull()
    }

    private fun toolButton(icon: Int, label: String, onTap: () -> Unit): TextView =
        TextView(context).apply {
            val font = iconFont
            if (font != null) {
                typeface = font
                text = String(Character.toChars(icon))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            } else {
                text = label
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
            }
            contentDescription = label
            setTextColor(colSub)
            gravity = Gravity.CENTER
            setPadding(dp(10), dp(5), dp(10), dp(5))
            background = keyBg(Color.TRANSPARENT, colBorder)
            isClickable = true
            setOnClickListener { onTap() }
            feedbackOnPress()
            layoutParams = LinearLayout.LayoutParams(wrap, wrap).apply { marginEnd = dp(4) }
        }

    private fun toggleShelf(kind: Shelf) {
        shelf = if (shelf == kind) Shelf.NONE else kind
        refreshShelf()
    }

    /**
     * 棚の中身。タップでその字をそのまま相手の欄へ入れる
     * (もう一度かたちから組み直させないための近道)。長押しでお気に入りの入り切り。
     */
    private fun refreshShelf() {
        for ((kind, view) in shelfButtons) {
            val active = shelf == kind
            view.setTextColor(if (active) colAccent else colSub)
            view.background = keyBg(
                if (active) colAccentBg else Color.TRANSPARENT,
                if (active) colAccent else colBorder,
            )
            // ★は開いているあいだ塗りつぶす(閉じているときは輪郭だけ)
            if (kind == Shelf.FAVORITES && iconFont != null) {
                view.text = String(Character.toChars(if (active) Icons.STAR else Icons.STAR_OUTLINE))
            }
        }
        shelfScroll.visibility = if (shelf == Shelf.NONE) View.GONE else View.VISIBLE
        shelfInner.removeAllViews()
        if (shelf == Shelf.NONE) return

        val chars = if (shelf == Shelf.HISTORY) host.store.history() else host.store.favorites()
        if (chars.isEmpty()) {
            shelfInner.addView(
                TextView(context).apply {
                    text = if (shelf == Shelf.HISTORY) {
                        "まだありません。字を確定するとここに残ります"
                    } else {
                        "まだありません。候補を長押しすると入ります"
                    }
                    setTextColor(colSub)
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
                    setPadding(dp(4), dp(10), dp(4), dp(10))
                },
            )
            return
        }
        for (ch in chars) {
            shelfInner.addView(
                TextView(context).apply {
                    text = ch
                    setTextColor(colText)
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
                    typeface = fontFor(ch)
                    gravity = Gravity.CENTER
                    minWidth = dp(42)
                    setPadding(dp(4), dp(2), dp(4), dp(2))
                    background = keyBg(colCard, colBorder)
                    isClickable = true
                    setOnClickListener { host.commit(ch) }
                    setOnLongClickListener { host.store.toggleFavorite(ch); refreshShelf(); true }
                    feedbackOnPress()
                    layoutParams = LinearLayout.LayoutParams(wrap, dp(42)).apply { marginEnd = dp(4) }
                },
            )
        }
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
                    // 長押しでお気に入り。上の★の棚から呼び出せるようになる
                    setOnLongClickListener {
                        host.store.toggleFavorite(h.ch)
                        if (shelf == Shelf.FAVORITES) refreshShelf()
                        performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
                        true
                    }
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

    /**
     * かたちの並び。よく使う順(PRIMARY_CODES)を先頭にして横スクロールで全部出す。
     * IDC文字(⿰⿱⿴…)は端末のフォントで豆腐になるので日本語ラベルで描く。
     */
    private fun buildOperators() {
        opInner.removeAllViews()
        val codes = Ids.PRIMARY_CODES +
            Ids.OPERATORS.map { it.code }.filter { it !in Ids.PRIMARY_CODES }
        for (code in codes) {
            val op = Ids.OPERATORS.first { it.code == code }
            val icon = OperatorIcons.ALL[op.code]
            opInner.addView(
                TextView(context).apply {
                    // アプリ版と同じ配置図を矩形で描く。図が無い操作子(⇄ ↻ −)だけ
                    // 記号を1行目に出す
                    if (icon?.rects != null) {
                        val d = OperatorIconDrawable(icon, colText, dp(20))
                        d.setBounds(0, 0, dp(20), dp(20))
                        setCompoundDrawables(null, d, null, null)
                        compoundDrawablePadding = dp(2)
                        text = op.label
                    } else {
                        text = icon?.symbol?.let { "$it\n${op.label}" } ?: op.label
                    }
                    setTextColor(colSub)
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 10f)
                    gravity = Gravity.CENTER
                    setPadding(dp(8), dp(6), dp(8), dp(6))
                    minWidth = dp(52)
                    background = keyBg(colCard, colBorder)
                    isClickable = true
                    setOnClickListener { host.insert(op.code) }
                    feedbackOnPress()
                    layoutParams = LinearLayout.LayoutParams(wrap, wrap)
                        .apply { marginEnd = dp(4) }
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
        readingLabel = null
        readingHits = null
        flick = null

        // 読みの面はフリック4段(と読みの欄・結果)が入る高さが要る
        keyScroll.layoutParams = LayoutParams(matchParent, dp(if (tab == Tab.SEARCH) 250 else 168))

        when (tab) {
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
            Tab.SEARCH -> buildReadingArea()
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

    // ---- 読みでさがす ----

    /**
     * 読みの面。読みの欄・引けた字・フリックのかな面の3段。
     *
     * 引けた字はタップで**かたちコードに部品として足す**（つち→土 を足して
     * 〈左右〉土… と組む）。長押しはその字をそのまま相手の欄へ入れる
     * （読みが分かっている字はこれが最短で、組み直す必要がない）。
     */
    private fun buildReadingArea() {
        val head = LinearLayout(context).apply {
            orientation = HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val label = TextView(context).apply {
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            setPadding(dp(2), dp(6), dp(2), dp(6))
            layoutParams = LinearLayout.LayoutParams(0, wrap, 1f)
        }
        readingLabel = label
        head.addView(label)
        head.addView(smallButton("消") { clearReading() })
        keyArea.addView(head, LayoutParams(matchParent, wrap))

        val hits = LinearLayout(context).apply { orientation = HORIZONTAL }
        readingHits = hits
        keyArea.addView(
            HorizontalScrollView(context).apply {
                isHorizontalScrollBarEnabled = false
                addView(hits)
            },
            LayoutParams(matchParent, dp(48)),
        )

        val pad = FlickKanaView(context, colText, colSub, colCard, colBorder, colAccentBg, this)
        flick = pad
        keyArea.addView(pad, LayoutParams(matchParent, wrap))

        refreshReadingLabel()
        runReadingSearch()
    }

    /** 打った読みと、指を置いているあいだの仮の1字(色を変えて後ろに付ける) */
    private fun refreshReadingLabel() {
        val label = readingLabel ?: return
        val typed = reading.toString()
        val preview = readingPreview
        if (typed.isEmpty() && preview == null) {
            label.text = "読みを打つと部品が出ます（例: つち）"
            label.setTextColor(colSub)
            return
        }
        label.setTextColor(colText)
        if (preview == null) {
            label.text = typed
            return
        }
        val s = SpannableString(typed + preview)
        s.setSpan(
            ForegroundColorSpan(colAccent),
            typed.length,
            s.length,
            Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
        )
        label.text = s
    }

    private fun clearReading() {
        reading.setLength(0)
        readingPreview = null
        flick?.resetToggle()
        refreshReadingLabel()
        runReadingSearch()
    }

    private fun afterReadingChanged() {
        readingPreview = null
        refreshReadingLabel()
        runReadingSearch()
    }

    private fun runReadingSearch() {
        val hits = readingHits ?: return
        val q = reading.toString()
        val seq = ++readingSeq
        if (q.isEmpty()) {
            hits.removeAllViews()
            return
        }
        // 1万3千字ぶんの読みを走査するので UI スレッドではやらない
        thread(name = "katachi-reading") {
            val r = host.engine.byReading(q, 60)
            main.post {
                if (seq == readingSeq) showReadingHits(r) // 古い結果は捨てる
            }
        }
    }

    private fun showReadingHits(chars: List<String>) {
        val hits = readingHits ?: return
        hits.removeAllViews()
        if (chars.isEmpty()) {
            hits.addView(
                TextView(context).apply {
                    text = if (host.dict.jaCount == 0) "辞書を読み込み中…" else "該当なし"
                    setTextColor(colSub)
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
                    setPadding(dp(4), dp(12), dp(4), 0)
                },
            )
            return
        }
        for (ch in chars) {
            hits.addView(
                TextView(context).apply {
                    text = ch
                    setTextColor(colText)
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
                    typeface = fontFor(ch)
                    gravity = Gravity.CENTER
                    minWidth = dp(42)
                    background = keyBg(colCard, colBorder)
                    isClickable = true
                    setOnClickListener { host.insert(ch) }
                    setOnLongClickListener {
                        host.commit(ch)
                        performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
                        true
                    }
                    feedbackOnPress()
                    layoutParams = LinearLayout.LayoutParams(wrap, dp(42)).apply { marginEnd = dp(4) }
                },
            )
        }
    }

    // ---- フリックのかな面から呼ばれる ----

    override fun appendKana(ch: String) {
        reading.append(ch)
        afterReadingChanged()
    }

    override fun replaceLastKana(ch: String) {
        if (reading.isNotEmpty()) reading.setLength(reading.length - 1)
        reading.append(ch)
        afterReadingChanged()
    }

    override fun cycleLastKana() {
        if (reading.isEmpty()) return
        val next = Kana.cycle(reading.last().toString()) ?: return
        reading.setLength(reading.length - 1)
        reading.append(next)
        afterReadingChanged()
    }

    override fun backspaceKana() {
        if (reading.isEmpty()) return
        reading.setLength(reading.length - 1)
        flick?.resetToggle()
        afterReadingChanged()
    }

    override fun previewKana(ch: String?) {
        readingPreview = ch
        refreshReadingLabel()
    }

    override fun keyFeedback(v: View, down: Boolean) {
        if (down) v.pressFeedback() else v.releaseFeedback()
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
