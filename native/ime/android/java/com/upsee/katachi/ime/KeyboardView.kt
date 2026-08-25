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
 *   [ 履歴 ★ 着せ替え                      戻る ]  ← 道具の帯(打つ場所ではない)
 *   [ (棚) 使った字 / お気に入りの字            ]
 *   [ 組み立て中のかたち ]             [⌫] [消]
 *   [ 送る: 明 ]                  [取消] [送る]
 *   [ 候補: 明 朝 晴 …                          ]
 *   [ かたち: 左右 上下 …                        ]
 *   [ 部首・偏旁 |            読み | 手書き ]
 *   [ 部品の並び / 読みのフリック面               ]
 *
 * 流れは **組む → 選ぶ → 送る → 戻る**。候補をタップしても入るのは「送る欄」までで、
 * 相手のテキスト欄に触るのは「送る」を押したときだけ。押し間違いが相手の本文に
 * 残らないようにするため、組み立て中と送る欄は行を分けてラベルを付けてある。
 *
 * 上の帯だけは打つための場所ではないので、間に線を引いて色も落とし、
 * 打鍵の面から視覚的に切り離してある。
 *
 * IDC文字(⿰⿱⿴…)は端末のフォントで豆腐になるので、操作子は日本語ラベルで出す。
 */
@SuppressLint("ViewConstructor")
class KeyboardView(context: Context, private val host: Host) :
    LinearLayout(context), FlickKanaView.Host, HandwritingView.Host {

    interface Host {
        val engine: Engine
        val dict: Dict
        /** 手書き照合。1.2MBのパターンを持つのでサービス側に置き、面を開くまで読まない */
        val handwriting: Handwriting
        val composingText: String
        /** 送る欄。候補から選んだ字 */
        val outboxText: String
        /** 履歴・お気に入り(アプリと共有) */
        val store: Store
        fun insert(s: String)
        fun backspace()
        fun clear()
        /** 候補を選ぶ。相手の欄にはまだ触らない */
        fun select(ch: String)
        /** 送る欄の末尾1字を取り消す */
        fun dropSelected()
        fun clearSelected()
        /** 送る欄の中身を相手のカーソル位置へ */
        fun send()
        /** 元の入力方法へ戻る */
        fun goBack()
        /** 入力方法の選択リスト(「戻る」の長押し) */
        fun openImePicker()
        /** カメラで字を読み取る。入力方式はカメラを持てないのでアプリを開く */
        fun openCamera()
        /** 組みかけを覚えておく(読み・かな面の状態が変わったとき) */
        fun persist()
        /** 着せ替えの反映。色は生成時に決まるので、ビューを作り直してもらう */
        fun recreateKeyboard()
    }


    private companion object {
        /** ⌫長押しの連射間隔。標準のキーボードと同じくらいの速さ */
        const val REPEAT_INTERVAL_MS = 60L

        /**
         * 候補1ページの件数。部品1つで引くと数千件出るので、1行に全部並べると
         * キーボードが出るまで固まる。ページに分けて**全件たどれる**ようにしてある。
         */
        const val CAND_PAGE = 60

        /** 連射中に音を鳴らす頻度。毎回鳴らすと「ジジジ」と潰れて聞こえる */
        const val SOUND_EVERY_N_REPEATS = 3

        /** 画数チップの高さ。指で狙える大きさ(dp)。候補キー44・部品キー46に合わせる */
        const val CHIP_DP = 40

        /** 打鍵の面より上(道具の帯〜タブ〜画数チップ)がだいたい使う高さ(dp) */
        const val CHROME_DP = 268f

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
    private val colOnAccent = Color.parseColor(palette.onAccent)

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
    private var strokeGroup = "common"
    private var searchSeq = 0
    private var readingSeq = 0

    /** 棚(履歴・お気に入り)の開き方。閉じているときは高さを持たない */
    private enum class Shelf { NONE, HISTORY, FAVORITES }
    private var shelf = Shelf.NONE
    private lateinit var shelfScroll: HorizontalScrollView
    private lateinit var shelfInner: LinearLayout
    private lateinit var shelfButtons: Map<Shelf, TextView>

    /** 読みの面の状態。読みそのものと、指を置いている間の仮の1字 */
    private val reading = StringBuilder()
    private var readingPreview: String? = null
    private var readingLabel: TextView? = null
    private var readingHits: LinearLayout? = null
    private var flick: FlickKanaView? = null

    /** かなの面を出しているか。出しているあいだ部品パレットは隠れる */
    var kanaOpen = false
        private set

    /** 手書きの面を出しているか。かなの面とは同時に出さない */
    private var hwOpen = false
    private var hwSeq = 0
    private var hwHits: LinearLayout? = null
    private var hwPad: HandwritingView? = null
    private var hwCount: TextView? = null

    /** 組みかけを覚えるためにサービスが読む */
    val readingText: String get() = reading.toString()

    private lateinit var kanaToggle: TextView
    private lateinit var hwToggle: TextView
    private lateinit var outboxLabel: TextView

    /** 送る欄の行。空のあいだは畳んで、その高さを打鍵の面へ回す */
    private lateinit var outboxRow: LinearLayout
    private lateinit var sendButton: TextView
    private lateinit var backButton: TextView
    private var resumedNote: TextView? = null

    private val composingLabel: TextView
    private val candidateRow: LinearLayout

    /** 候補の横スクロール。ページをめくったら先頭へ戻す */
    private val candScroll: HorizontalScrollView

    /** いま何ページめの候補を出しているか(0始まり) */
    private var candPage = 0
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

    /**
     * 同梱フォントを読み終わったか。読み込みは21MBあって数百ミリ秒かかるので、
     * **キーボードを組み立てている最中に fontFor を呼んではいけない**
     * (by lazy がその場で読みに行き、キーボードが出るまで固まる)。
     * 裏のスレッドが読み終えてから true にして、そこで組み直す。
     */
    private var fontsReady = false

    /**
     * このビューを組んだときの縦幅の設定。変わっていたら作り直す合図に使う。
     * (init より前に置くこと＝組み立て中に読めるようにしておく)
     */
    private var builtHeightMode = host.store.heightMode()

    /**
     * アイコンのフォント。RNアプリが入れている Ionicons を**同じAPKの assets から
     * 借りる**(fonts/Ionicons.ttf。@react-native-vector-icons/ionicons が置く)。
     * キーボードのためだけに同じフォントをもう1部積むのは無駄なので、
     * 拡張漢字フォントと同じ考え方で1部を共有する。
     * 読めなかったときは日本語のラベルに落とすので、フォントが消えても意味は伝わる。
     *
     * **init より前に置くこと**。道具の帯(buildToolRow)は init から組み立てるので、
     * この宣言が init より後ろにあると by lazy の受け皿がまだ null で、
     * キーボードを出した瞬間に NPE で落ちる(= 入力方式は選べるのに画面が出ない)。
     */
    private val iconFont: Typeface? by lazy {
        runCatching { Typeface.createFromAsset(context.assets, "fonts/Ionicons.ttf") }.getOrNull()
    }

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

        // ── 送る欄 ──
        // 組み立て中のかたちコードとは別物なので、行を分けてラベルを付ける。
        // 候補を選んでもここに入るだけで、相手のテキスト欄はまだ変わらない
        // （押し間違いが相手の本文に残らないようにするため）。
        // 「送る」を押したときだけカーソル位置へ入る
        val outRow = LinearLayout(context).apply {
            orientation = HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(8), 0, dp(8), dp(4))
        }
        outRow.addView(
            TextView(context).apply {
                text = "送る"
                setTextColor(colSub)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 10f)
                setPadding(0, 0, dp(6), 0)
            },
        )
        outboxLabel = TextView(context).apply {
            setTextColor(colText)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
            hint = "候補を選ぶとここに入ります"
            setHintTextColor(colSub)
            setSingleLine()
            layoutParams = LayoutParams(0, wrap, 1f)
        }
        outRow.addView(outboxLabel)
        // 選び直しは1字ずつ。全部やめたいときは長押し
        // (上の「消」は組み立て中のかたちコードだけを消す。選んだ字まで一緒に
        //  消えると、3字選んだあとに1字組み間違えただけで全部やり直しになる)
        outRow.addView(
            smallButton("取消") { host.dropSelected() }.apply {
                setOnLongClickListener {
                    host.clearSelected()
                    performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
                    true
                }
            },
        )
        sendButton = smallButton("送る") { host.send() }
        outRow.addView(sendButton)
        // 何も選んでいないあいだは行ごと畳む。案内文だけの行に1行ぶんの高さを
        // 使っていると、そのぶんフリック面や手書きの枠が削られる
        outRow.visibility = View.GONE
        outboxRow = outRow
        addView(outRow)

        // 他のキーボードから戻ってきたとき、勝手に字が残っているように見えないよう
        // 1行だけ断る。打ち始めれば消える
        resumedNote = TextView(context).apply {
            text = "前回の続きです"
            setTextColor(colAccent)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 10f)
            setPadding(dp(8), 0, dp(8), dp(2))
            visibility = View.GONE
        }
        addView(resumedNote)

        // ── 候補 ──
        candidateRow = LinearLayout(context).apply {
            orientation = HORIZONTAL
            setPadding(dp(6), 0, dp(6), 0)
        }
        candScroll = HorizontalScrollView(context).apply {
            isHorizontalScrollBarEnabled = false
            addView(candidateRow)
            layoutParams = LayoutParams(matchParent, dp(52))
        }
        addView(candScroll)

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

        // ── タブ(部品パレットの出し分け)＋かなの面の出し入れ ──
        val tabs = LinearLayout(context).apply {
            orientation = HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(6), dp(2), dp(6), dp(2))
        }
        // 部品パレットは「部首」の1つだけ。読み・手書きの面から戻る口を
        // 兼ねているので、タブと同じ見た目のまま置いてある
        val radicalTab = tabButton("部首") {
            kanaOpen = false
            hwOpen = false
            rebuildKeys()
        }
        tabViews = listOf(radicalTab)
        // パレットに無い部品を読みから出すための面。タブではなく出し入れなので、
        // 出しても消してもかたちの行・候補・組み立て中の表示はそのまま残る。
        // 手書きも同じ扱い(読みも部品の見当もつかない字は、書いて引く)
        kanaToggle = smallButton("読み") { toggleFace(kana = true) }
        hwToggle = smallButton("手書き") { toggleFace(kana = false) }
        // カメラは入力方式の中では持てない(権限を自分で求められない)ので、
        // ここは**アプリのカメラ面を開くだけ**の入口にしてある
        val cameraTab = smallButton("カメラ") { host.openCamera() }
        // **4つとも同じ幅**にする。並びとしては対等な引き方(部首／読み／手書き／カメラ)
        // なので、1つだけが余りを全部取ると狙う幅がばらばらになって押しにくい
        for ((i, v) in listOf(radicalTab, kanaToggle, hwToggle, cameraTab).withIndex()) {
            v.setPadding(dp(2), dp(7), dp(2), dp(7)) // 高さも揃える
            v.layoutParams = LinearLayout.LayoutParams(0, wrap, 1f).apply {
                if (i > 0) marginStart = dp(4)
            }
            tabs.addView(v)
        }
        addView(tabs)

        // ── 画数チップ(部首タブのときだけ) ──
        strokeInner = LinearLayout(context).apply {
            orientation = HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(6), dp(2), dp(6), dp(3))
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
            // **中身が足りないときは viewport いっぱいに広げる**。こうしておくと
            // 読みのフリック面も手書きの枠も weight で高さを分け合えるので、
            // 画面が小さい端末では詰まるだけで「下が見えない」ことにならない。
            // 部品パレット(数が多い)のときだけ、はみ出したぶんがスクロールする
            isFillViewport = true
            layoutParams = LayoutParams(matchParent, faceHeight())
        }
        addView(keyScroll)

        buildStrokeChips()
        rebuildKeys()
        onComposingChanged()
        onOutboxChanged()
        refreshShelf() // 棚は閉じた状態。道具の帯のボタンの色をここで当てる

        // フォントは合計21MBある。最初のタップで読むとキーボードが固まるので、
        // 辞書と同じように裏で先に読んでおく(by lazy は同期化されているので安全)。
        thread(name = "katachi-font") {
            val loaded = listOf(extFont1, extFont2).first()
            main.post {
                // 入力中の表示は1字ずつ分けられないので、部品を多く含む1枚目を当てる。
                // このフォントに無い字(かな・常用漢字)は OS が標準フォントで描く
                fontsReady = true
                composingLabel.typeface = loaded
                buildOperators() // 鏡映・回転・除去の字形は同梱フォントで描く
                rebuildKeys()
            }
        }
    }

    // ---- サービスから呼ばれる ----

    /**
     * アプリで縦幅の設定が変わっていないか見る。
     *
     * 変わっていたら**ビューごと作り直してもらう**(高さだけ差し替えても、
     * 入力方式のウィンドウは作り直したときの高さで出ることがあるため)。
     * キーボードを出すたびに呼ばれるので、アプリで選んで戻ってくれば次に開いた
     * ときには変わっている。
     */
    fun refreshHeight() {
        val now = host.store.heightMode()
        if (now == builtHeightMode) return
        builtHeightMode = now
        host.recreateKeyboard()
    }

    fun onDictReady() {
        runSearch()
        if (kanaOpen) runReadingSearch()
    }

    fun onComposingChanged() {
        composingLabel.text = readableComposing(host.composingText)
        if (host.composingText.isNotEmpty()) {
            clearResumedNote()
            calmBackButton()
        }
        runSearch()
    }

    /** 送る欄が変わった。中身が無いあいだ「送る」は押せない見た目にする */
    fun onOutboxChanged() {
        val out = host.outboxText
        val ready = out.isNotEmpty()
        outboxRow.visibility = if (ready) View.VISIBLE else View.GONE
        outboxLabel.text = out
        outboxLabel.typeface = if (out.isEmpty()) Typeface.DEFAULT else fontFor(out)
        sendButton.isEnabled = ready
        sendButton.setTextColor(if (ready) colOnAccent else colSub)
        sendButton.background = keyBg(
            if (ready) colAccent else Color.TRANSPARENT,
            if (ready) colAccent else colBorder,
        )
    }

    /** 字を選んだ。履歴が増えているので棚を開いていれば追いつかせる */
    fun onSelected() {
        clearResumedNote()
        if (shelf != Shelf.NONE) refreshShelf()
    }

    /**
     * 送った。読みは残す（同じ読みで次の字を探すことがある）。
     * 自動では戻らない代わりに「戻る」の色を上げて、次の一手を示す
     */
    fun onSent() {
        clearResumedNote()
        backButton.setTextColor(colAccent)
        backButton.background = keyBg(colAccentBg, colAccent)
    }

    /** 打ち始めたら「戻る」の強調は引っ込める（続けて組んでいる最中なので） */
    private fun calmBackButton() {
        backButton.setTextColor(colSub)
        backButton.background = keyBg(Color.TRANSPARENT, colBorder)
    }

    /**
     * 他のキーボードから戻ってきた。前の続きを画面に戻す。
     * 勝手に字が残っているように見えないよう、1行「前回の続き」と出す。
     */
    fun restore(p: Store.Pending) {
        reading.setLength(0)
        reading.append(p.reading)
        readingPreview = null
        kanaOpen = p.kana
        // 書いた画までは覚えていない。読みの面に戻すときは手書きの面を閉じる
        if (p.kana) hwOpen = false
        rebuildKeys()
        onComposingChanged()
        onOutboxChanged()
        if (p.code.isNotEmpty() || p.outbox.isNotEmpty() || p.reading.isNotEmpty()) {
            showResumedNote()
        }
    }

    private fun showResumedNote() {
        resumedNote?.visibility = View.VISIBLE
    }

    /**
     * 断り書きを引っ込める。**行そのものは残して透明にするだけ**にする。
     * GONE にすると1行ぶん詰まって、下のフリック面・手書きの枠が打っている
     * 最中に動く(1字目でキーがずれて、2字目が隣のキーに入る)
     */
    private fun clearResumedNote() {
        val note = resumedNote ?: return
        if (note.visibility == View.VISIBLE) note.visibility = View.INVISIBLE
    }

    /**
     * 読み／手書きの面の出し入れ。出すと部品パレットの代わりにその面が入る。
     * 2つは場所を取り合うので同時には出さない(押した方だけが開く)。
     */
    private fun toggleFace(kana: Boolean) {
        if (kana) {
            kanaOpen = !kanaOpen
            hwOpen = false
        } else {
            hwOpen = !hwOpen
            kanaOpen = false
        }
        clearResumedNote()
        rebuildKeys()
        host.persist()
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
        // 残りを押し広げて「戻る」を右端へ
        row.addView(View(context), LayoutParams(0, dp(1), 1f))
        // 文章の続きは普段のキーボードで打つ道具立てなので、帰り道を必ず出しておく。
        // 長押しなら入力方法の選択リスト(戻り先を自分で選びたいとき)
        backButton = toolButton(Icons.BACK, "戻る", onLongTap = { host.openImePicker() }) {
            host.goBack()
        }
        row.addView(backButton)
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

        /** 「戻る」(arrow-undo-outline)。元の入力方法へ帰る */
        const val BACK = 0xF143
    }

    private fun toolButton(
        icon: Int,
        label: String,
        onLongTap: (() -> Unit)? = null,
        onTap: () -> Unit,
    ): TextView =
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
            if (onLongTap != null) {
                setOnLongClickListener {
                    performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
                    onLongTap()
                    true
                }
            }
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
                    // 棚の字も「選ぶ」まで。相手の欄へ入るのは「送る」のとき
                    setOnClickListener { host.select(ch) }
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

    /**
     * 候補を引き直す。打ち直したときは1ページめに戻し、ページ送りのときだけ
     * いまのページを保つ(resetPage=false)。
     */
    private fun runSearch(resetPage: Boolean = true) {
        val q = host.composingText
        if (resetPage) candPage = 0
        val seq = ++searchSeq
        if (q.isEmpty()) {
            candidateRow.removeAllViews()
            return
        }
        // 10万字の走査は数十〜数百msかかるので UI スレッドを止めない
        val sort = Engine.Sort.of(host.store.sortMode())
        val from = candPage * CAND_PAGE
        thread(name = "katachi-search") {
            val r = host.engine.search(q, CAND_PAGE, sort, from)
            main.post {
                if (seq == searchSeq) showCandidates(r) // 古い結果は捨てる
            }
        }
    }

    private fun showCandidates(r: Engine.Result) {
        candidateRow.removeAllViews()
        // ページ送り。候補は1ページ CAND_PAGE 件ずつだが、全件たどれる
        val pages = (r.total + CAND_PAGE - 1) / CAND_PAGE
        if (candPage > 0) {
            candidateRow.addView(pagerChip("◂ 前の${CAND_PAGE}件") { turnPage(-1) })
        }
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
                    // タップは「選ぶ」だけ。相手のテキスト欄に入るのは「送る」のとき
                    setOnClickListener { host.select(h.ch) }
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
        if (pages > 1) {
            if (candPage < pages - 1) {
                candidateRow.addView(pagerChip("次の${CAND_PAGE}件 ▸") { turnPage(1) })
            }
            // いま何ページめか。押せないことが分かるよう枠を出さない
            candidateRow.addView(
                TextView(context).apply {
                    text = "${candPage + 1}/$pages"
                    setTextColor(colSub)
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
                    gravity = Gravity.CENTER
                    setPadding(dp(8), dp(4), dp(8), dp(4))
                    layoutParams = LinearLayout.LayoutParams(wrap, dp(44))
                },
            )
        }
    }

    /**
     * ページを1つ動かす。候補の先頭まで巻き戻してから引き直す
     * (前のページの右端に居たまま次のページが出ると、どこを見ているのか分からない)。
     */
    private fun turnPage(d: Int) {
        candPage = (candPage + d).coerceAtLeast(0)
        candScroll.scrollTo(0, 0)
        runSearch(resetPage = false)
    }

    /** ページ送りのキー。候補と間違えて押さないよう、字を小さく色も落とす */
    private fun pagerChip(label: String, onTap: () -> Unit): View =
        TextView(context).apply {
            text = label
            setTextColor(colAccent)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
            gravity = Gravity.CENTER
            setPadding(dp(10), dp(4), dp(10), dp(4))
            background = keyBg(Color.TRANSPARENT, colAccent)
            isClickable = true
            setOnClickListener { onTap() }
            feedbackOnPress()
            layoutParams = LinearLayout.LayoutParams(wrap, dp(44)).apply { marginEnd = dp(4) }
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
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
                    // 指で狙える大きさを確保する。字の見た目に合わせて詰めると
                    // 高さが20dpほどしかなくなり、隣の画数を押してしまう
                    gravity = Gravity.CENTER
                    setPadding(dp(14), dp(0), dp(14), dp(0))
                    minWidth = dp(52)
                    background = keyBg(
                        if (active) colAccentBg else Color.TRANSPARENT,
                        if (active) colAccent else colBorder,
                    )
                    isClickable = true
                    setOnClickListener { strokeGroup = key; buildStrokeChips(); rebuildKeys() }
                    feedbackOnPress()
                    layoutParams = LinearLayout.LayoutParams(wrap, dp(CHIP_DP))
                        .apply { marginEnd = dp(5) }
                },
            )
        }
    }

    /**
     * かたちの並び。よく使う順(PRIMARY_CODES)を先頭にして横スクロールで全部出す。
     * 絵は端末のフォントに頼らない(矩形で描くか、同梱フォントの字形を描く)。
     * 名前は IDC文字ではなく日本語ラベル。
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
                    // アプリ版と同じ配置図を矩形で描く。配置図を持たない鏡映・回転・
                    // 除去は IDC の字形(⿾⿿㇯)で、同梱フォントを当てて同じ大きさに
                    // 描く(端末の標準フォントには無い字なので fontFor が要る)
                    if (icon != null) {
                        val d = OperatorIconDrawable(
                            icon, colText, dp(20),
                            // フォントを読み終わるまでは絵を出さない(読みに行くと固まる)。
                            // 読み終わったところで buildOperators がもう一度走る
                            icon.symbol?.takeIf { fontsReady }?.let { fontFor(it) },
                        )
                        d.setBounds(0, 0, dp(20), dp(20))
                        setCompoundDrawables(null, d, null, null)
                        compoundDrawablePadding = dp(2)
                    }
                    text = op.label
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
        val faceOpen = kanaOpen || hwOpen
        for (v in tabViews) {
            v.setTextColor(if (!faceOpen) colAccent else colSub)
            v.background = keyBg(
                if (!faceOpen) colCard else Color.TRANSPARENT,
                if (!faceOpen) colBorder else Color.TRANSPARENT,
            )
        }
        // 読み・手書きの面を出しているあいだ、部品パレットのタブは効いていない
        for ((toggle, on) in listOf(kanaToggle to kanaOpen, hwToggle to hwOpen)) {
            toggle.setTextColor(if (on) colOnAccent else colSub)
            toggle.background = keyBg(
                if (on) colAccent else Color.TRANSPARENT,
                if (on) colAccent else colBorder,
            )
        }
        strokeRow.visibility = if (!faceOpen) View.VISIBLE else View.GONE
        keyArea.removeAllViews()
        readingLabel = null
        readingHits = null
        flick = null
        hwHits = null
        hwPad = null
        hwCount = null

        keyScroll.layoutParams = LayoutParams(matchParent, faceHeight())

        if (kanaOpen) {
            buildReadingArea()
            return
        }
        if (hwOpen) {
            buildHandwritingArea()
            return
        }

        val parts = if (strokeGroup == "common") {
            Ids.tokens(Palettes.RADICAL)
        } else {
            Ids.tokens(Palettes.DIFFICULT.first { it.strokes == strokeGroup }.parts)
        }
        grid(parts.size, 8) { i -> keyButton(parts[i], 20f) { host.insert(parts[i]) } }
    }

    /**
     * 打鍵の面の高さ。面ごとに要るものが違うので出し分ける。
     *
     * 読みのフリック面(4段)も手書きの枠も、**スクロールさせずに全部出す**のが要件。
     * ただし上の帯(組み立て中・送る・候補・かたち・タブ)だけで 250dp ほど使うので、
     * 画面の 62% を超えないところで頭を打たせる。足りないぶんはフリックのキーと
     * 手書きの枠が詰まって吸収する(下が切れて打てなくなるよりはよい)。
     */
    private fun faceHeight(): Int {
        val dm = resources.displayMetrics
        val screenDp = dm.heightPixels / dm.density
        val h = Height.of(host.store.heightMode())
        val cap = (screenDp * h.screenMax - CHROME_DP).toInt()
        val want = ((if (kanaOpen) 268 else if (hwOpen) 252 else 168) * h.scale).toInt()
        return dp(want.coerceAtMost(cap).coerceAtLeast(140))
    }

    /**
     * キーボードの縦幅(アプリの設定画面で選ぶ)。打鍵の面だけを伸ばす。
     * 上の帯(組み立て中・送る・候補・かたち・タブ)は打つための場所ではないので
     * 広げても意味がなく、伸ばすのは指が触る面だけにしてある。
     *
     * scale … 面の高さの倍率 / screenMax … キーボード全体が画面に占めてよい割合。
     * 倍率だけ上げても頭打ち(cap)に引っかかるので、割合も一緒に上げる。
     * キーは core/data/keyboard.ts の KEY_HEIGHTS と同じ。
     */
    private enum class Height(val key: String, val scale: Float, val screenMax: Float) {
        SMALL("small", 1.0f, 0.62f),
        MEDIUM("medium", 1.22f, 0.70f),
        LARGE("large", 1.45f, 0.78f),
        ;

        companion object {
            fun of(key: String?): Height = entries.firstOrNull { it.key == key } ?: SMALL
        }
    }

    // ---- 読みでさがす ----

    /**
     * 読みの面。断り書き・読みの欄・引けた字・フリックのかな面の4段。
     *
     * 引けた字はタップで**かたちコードに部品として足す**（つち→土 を足して
     * 〈左右〉土… と組む）。長押しはその字を送る欄へ入れる
     * （読みが分かっている字はこれが最短で、組み直す必要がない）。
     *
     * **文章を打つ面ではない**。ここで打ったかなが相手の欄に入ることはなく、
     * 部品を読みから引くためだけにある。標準のかなキーボードに見えてしまうので、
     * 面の頭にそれを1行で断っておく。
     */
    private fun buildReadingArea() {
        // 断り書きは**出しっぱなしにする**。打ち始めたら引っ込めれば1行ぶんの高さを
        // フリック面に回せるが、それをやると1字目を打った瞬間にキーの大きさと位置が
        // 変わり、2字目が隣のキーに入る。打っている最中に面が動かないことのほうが、
        // 1行ぶんの高さより大事
        keyArea.addView(
            TextView(context).apply {
                text = "字の読みを打つと候補に出ます。文章は普段のキーボードで"
                setTextColor(colSub)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 10f)
                setPadding(dp(2), dp(2), dp(2), 0)
            },
            LayoutParams(matchParent, wrap),
        )

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

        // フリック面は**残りの高さを全部もらう**。固定にすると画面の小さい端末で
        // 下の段がはみ出して打てなくなる
        val pad = FlickKanaView(context, colText, colSub, colCard, colBorder, colAccentBg, this)
        flick = pad
        keyArea.addView(pad, LayoutParams(matchParent, 0, 1f))

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
        host.persist()
    }

    /**
     * 読みが変わった。**面は組み直さない**。組み直すとフリックのキーが動いて、
     * 続けて打っている指が隣のキーに乗る
     */
    private fun afterReadingChanged() {
        readingPreview = null
        clearResumedNote()
        host.persist() // 読みも組みかけのうち。切り替えて戻ったら続きから打てる
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
                    // タップはかたちコードへ部品として足す(読みで部品を出すのが目的)。
                    // その字そのものを入れたいときは長押しで送る欄へ
                    setOnClickListener { commitReading(ch) }
                    setOnLongClickListener {
                        host.select(ch)
                        performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
                        true
                    }
                    feedbackOnPress()
                    layoutParams = LinearLayout.LayoutParams(wrap, dp(42)).apply { marginEnd = dp(4) }
                },
            )
        }
    }

    // ---- 手書きでさがす ----

    /**
     * 手書きの面。断り書き・引けた字・書く枠の3段。
     *
     * 読みも部品の見当もつかない字は、書いて引く。認識は端末の中だけで完結する
     * （通信はしない）。パターンは KanjiVG 由来の約6,400字で、常用・人名用・
     * JIS第1〜2水準を覆う。ここに無い拡張漢字はかたちコードで組んで引く。
     *
     * 引けた字は**タップで送る欄へ**。読みの面（タップで部品に足す）と逆なのは、
     * 手書きは「その字そのものが欲しい」から書くため。部品として使いたいときは
     * 長押しでかたちコードに足せる。
     */
    private fun buildHandwritingArea() {
        keyArea.addView(
            TextView(context).apply {
                text = "読めない字は書いて引けます。タップで送る欄へ・長押しで部品に"
                setTextColor(colSub)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 10f)
                setPadding(dp(2), dp(2), dp(2), 0)
            },
            LayoutParams(matchParent, wrap),
        )

        val hits = LinearLayout(context).apply { orientation = HORIZONTAL }
        hwHits = hits
        keyArea.addView(
            HorizontalScrollView(context).apply {
                isHorizontalScrollBarEnabled = false
                addView(hits)
            },
            LayoutParams(matchParent, dp(48)),
        )

        val row = LinearLayout(context).apply { orientation = HORIZONTAL }
        val pad = HandwritingView(context, colText, colBorder, colAccent, this)
        hwPad = pad
        row.addView(pad, LinearLayout.LayoutParams(0, matchParent, 1f))

        val tools = LinearLayout(context).apply {
            orientation = VERTICAL
            setPadding(dp(4), 0, 0, 0)
        }
        hwCount = TextView(context).apply {
            text = "手書き"
            setTextColor(colSub)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 10f)
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, dp(4))
        }
        tools.addView(hwCount, LinearLayout.LayoutParams(matchParent, wrap))
        tools.addView(
            smallButton("1画消す") { hwPad?.undo() }
                .apply { layoutParams = LinearLayout.LayoutParams(wrap, wrap) },
        )
        tools.addView(
            smallButton("全部消す") { hwPad?.clear() }.apply {
                layoutParams = LinearLayout.LayoutParams(wrap, wrap)
                    .apply { topMargin = dp(4) }
            },
        )
        row.addView(tools, LinearLayout.LayoutParams(wrap, wrap))
        // 書く枠は残りの高さを全部もらう(固定にすると下が切れて書けなくなる)
        keyArea.addView(row, LayoutParams(matchParent, 0, 1f))

        showHandwritingNote(if (host.handwriting.ready) "枠に字を書いてください" else "手書きの辞書を準備中…")
        // パターン(1.2MB)は手書きの面を初めて開いたときにだけ読む。
        // 使わない人にこの読み込みを払わせない
        if (!host.handwriting.ready) {
            thread(name = "katachi-hw") {
                host.handwriting.load(context.assets.open("hw.tsv"))
                main.post { if (hwOpen) showHandwritingNote("枠に字を書いてください") }
            }
        }
    }

    /** 1画描き終えるたびに引き直す。描いた画がそのまま問いになる */
    override fun onStrokesChanged(strokes: List<DoubleArray>) {
        clearResumedNote()
        hwCount?.text = if (strokes.isEmpty()) "手書き" else "${strokes.size}画"
        val seq = ++hwSeq
        if (strokes.isEmpty()) {
            showHandwritingNote(if (host.handwriting.ready) "枠に字を書いてください" else "手書きの辞書を準備中…")
            return
        }
        if (!host.handwriting.ready) return
        // 6,400字ぶんの照合は数msだが、端末によっては十数msかかる。
        // 描いた直後の指の動きを妨げないよう UI スレッドから外す
        thread(name = "katachi-hw-match") {
            val hits = host.handwriting.match(strokes, 24)
            main.post { if (seq == hwSeq && hwOpen) showHandwritingHits(hits) }
        }
    }

    private fun showHandwritingNote(text: String) {
        val hits = hwHits ?: return
        hits.removeAllViews()
        hits.addView(
            TextView(context).apply {
                setText(text)
                setTextColor(colSub)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
                setPadding(dp(4), dp(12), dp(4), 0)
            },
        )
    }

    private fun showHandwritingHits(matches: List<Handwriting.Match>) {
        val hits = hwHits ?: return
        hits.removeAllViews()
        if (matches.isEmpty()) {
            showHandwritingNote("似ている字が見つかりません")
            return
        }
        for (m in matches) {
            hits.addView(
                TextView(context).apply {
                    text = m.ch
                    setTextColor(colText)
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
                    typeface = fontFor(m.ch)
                    gravity = Gravity.CENTER
                    minWidth = dp(42)
                    background = keyBg(colCard, colBorder)
                    isClickable = true
                    // タップは送る欄へ(手書きは「その字が欲しい」から書く)。
                    // 部品として組みに使いたいときは長押しでかたちコードへ
                    setOnClickListener { host.select(m.ch) }
                    setOnLongClickListener {
                        host.insert(m.ch)
                        performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
                        true
                    }
                    feedbackOnPress()
                    layoutParams = LinearLayout.LayoutParams(wrap, dp(42)).apply { marginEnd = dp(4) }
                },
            )
        }
    }

    /**
     * 読みから引けた字を**かたちコードへ入れて、読みを空にする**。
     *
     * 普通のかな漢字変換と同じ手触りにするため。「つき」と打って月を選んだ時点で
     * その変換は済んでいるので、読みが残っていると次の部品を打つのに消す手間が要る。
     * 空にすると上の候補欄も読みの結果から**組み立て中のかたちの候補へ戻る**ので、
     * 〈左右〉日月 まで組んだところで「明」がそのまま出てくる。
     */
    private fun commitReading(ch: String) {
        host.insert(ch)
        reading.setLength(0)
        flick?.resetToggle()
        afterReadingChanged()
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

    // 「送る」やかな面の出し入れは、状態で色を塗り替えるので TextView のまま返す
    private fun smallButton(label: String, onTap: () -> Unit): TextView =
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
