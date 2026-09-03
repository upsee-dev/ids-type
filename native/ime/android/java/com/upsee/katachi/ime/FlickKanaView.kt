package com.upsee.katachi.ime

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.drawable.GradientDrawable
import android.os.SystemClock
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import kotlin.math.abs
import kotlin.math.max

/**
 * 読みを打つための12キーフリック面。
 *
 * このキーボードは自分が入力方式なので、読みを打ちたくても他のかなキーボードへ
 * 移れない。そこで、日本のスマホで標準のフリック入力をこの面として持つ。
 *
 * 指を置いてから離すまでの向きで段を決める（中央=あ、左=い、上=う、右=え、下=お）。
 * 途中経過は previewKana で読みの欄に薄く出す。**ポップアップは出さない**：
 * キーボードの上に別ウィンドウを重ねると端末によって位置がずれるので、
 * 「いま何が入るか」は読みの欄そのもので見せる方が確実で、目線も動かない。
 *
 * フリックできない人のために、同じキーを続けて叩くと あ→い→う→え→お と
 * 送るトグル入力も受ける（標準のかなキーボードと同じ）。
 *
 * **向きの取り方はここが要**。取りこぼしを無くすために3つ手を打ってある。
 *
 *  1. 押した瞬間に親へ `requestDisallowInterceptTouchEvent`。この面は
 *     縦スクロールできる入れ物(keyScroll)の中にあるので、そうしないと
 *     **下フリック(お段)や上フリック(う段)がスクロールに取られて**
 *     ACTION_CANCEL で消える。Android だけで起きる取りこぼしはこれが原因
 *  2. 指の**いちばん遠かった位置**で向きを決める。指を放るように動かすと
 *     離す瞬間には戻ってきていることがあり、終点だけ見ると中央(あ段)になる
 *  3. しきい値は**距離**で見る(縦横の大きいほうではなく)。斜めに払ったとき、
 *     縦横それぞれでは届かないのに実際は十分動いている、が無くなる
 *
 * 指の追跡は**押した指のID**で行う。2本目の指が同じキーに触れても
 * 座標が入れ替わらない(速く打つと親指2本が重なる)。
 */
@SuppressLint("ViewConstructor")
class FlickKanaView(
    context: Context,
    private val colText: Int,
    private val colSub: Int,
    private val colCard: Int,
    private val colBorder: Int,
    private val colAccentBg: Int,
    private val host: Host,
) : LinearLayout(context) {

    interface Host {
        /** 1字打った */
        fun appendKana(ch: String)
        /** 同じキーの叩き直し。末尾1字を置き換える */
        fun replaceLastKana(ch: String)
        /** 「小゛゜」。末尾1字を濁点・小文字へ送る */
        fun cycleLastKana()
        fun backspaceKana()
        /** 指を置いているあいだの仮の字。離す/取り消しで null */
        fun previewKana(ch: String?)
        /** 打鍵の手応え(音・触覚)は KeyboardView と同じものを使う */
        fun keyFeedback(v: View, down: Boolean)
    }

    private companion object {
        /**
         * これ以上動いたらフリックとみなす(dp)。**距離**で見る。
         * 小さすぎると普通のタップが滑り、大きすぎると払ったつもりが中央になる。
         * キーの幅のおよそ1/4(標準のかなキーボードと同じ勘定)
         */
        const val FLICK_THRESHOLD_DP = 18

        /** 同じキーの叩き直しをトグルとして扱う間合い(ms) */
        const val TOGGLE_WINDOW_MS = 900L
    }

    /** 直前に叩いたキーと、そのとき何番目の字を出したか(トグル用) */
    private var lastKey: Kana.Key? = null
    private var lastStep = 0
    private var lastTapAt = 0L

    init {
        orientation = VERTICAL
        // 段は面の高さを等分する。固定の高さにすると、画面の小さい端末で
        // 下の段がはみ出して打てなくなる
        for (row in Kana.ROWS) {
            val line = LinearLayout(context).apply { orientation = HORIZONTAL }
            for (key in row) {
                line.addView(
                    keyView(key),
                    LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f)
                        .apply { setMargins(dp(2), dp(2), dp(2), dp(2)) },
                )
            }
            addView(line, LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        }
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun keyView(key: Kana.Key): View {
        val v = TextView(context).apply {
            text = key.label
            setTextColor(if (key.chars.isEmpty()) colSub else colText)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, if (key.chars.isEmpty()) 13f else 20f)
            gravity = Gravity.CENTER
            paint(this, colCard)
        }

        if (key.chars.isEmpty()) {
            // 「小゛゜」と「⌫」は向きを持たない。押した回数だけ効く
            v.isClickable = true
            v.setOnClickListener {
                if (key.label == Kana.BACKSPACE) host.backspaceKana() else host.cycleLastKana()
            }
            v.setOnTouchListener { view, e ->
                when (e.action) {
                    MotionEvent.ACTION_DOWN -> host.keyFeedback(view, true)
                    MotionEvent.ACTION_UP -> host.keyFeedback(view, false)
                }
                false // タップ判定は View に任せる
            }
            return v
        }

        var downX = 0f
        var downY = 0f
        // いちばん遠かった位置(と、そのときの距離の2乗)。向きはここで決める
        var farX = 0f
        var farY = 0f
        var farD2 = 0f
        // 押した指のID。2本目の指が同じキーに触れても取り違えないため
        var pointer = MotionEvent.INVALID_POINTER_ID

        fun track(x: Float, y: Float) {
            val dx = x - downX
            val dy = y - downY
            val d2 = dx * dx + dy * dy
            if (d2 > farD2) {
                farD2 = d2
                farX = dx
                farY = dy
            }
        }

        v.setOnTouchListener { view, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    pointer = e.getPointerId(0)
                    downX = e.x
                    downY = e.y
                    farX = 0f; farY = 0f; farD2 = 0f
                    // **この面は縦スクロールの中にある**。断っておかないと、
                    // 上下のフリックがスクロールに取られて ACTION_CANCEL になる
                    view.parent?.requestDisallowInterceptTouchEvent(true)
                    host.keyFeedback(view, true)
                    paint(view, colAccentBg)
                    host.previewKana(key.chars[0])
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val i = e.findPointerIndex(pointer)
                    if (i >= 0) {
                        track(e.getX(i), e.getY(i))
                        host.previewKana(charAt(key, direction(farX, farY)))
                    }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    val i = e.findPointerIndex(pointer)
                    if (i >= 0) track(e.getX(i), e.getY(i))
                    host.keyFeedback(view, false)
                    paint(view, colCard)
                    host.previewKana(null)
                    view.parent?.requestDisallowInterceptTouchEvent(false)
                    pointer = MotionEvent.INVALID_POINTER_ID
                    commit(key, direction(farX, farY))
                    true
                }
                MotionEvent.ACTION_CANCEL -> {
                    paint(view, colCard)
                    host.previewKana(null)
                    view.parent?.requestDisallowInterceptTouchEvent(false)
                    pointer = MotionEvent.INVALID_POINTER_ID
                    true
                }
                else -> false
            }
        }
        return v
    }

    /**
     * 0=中央 1=左 2=上 3=右 4=下。
     * しきい値は**指が動いた距離**で見る(縦横それぞれではなく)。斜めに払ったとき
     * 縦横のどちらも届かず中央になってしまう、が無くなる。
     * 端末の最小移動量(touchSlop)より小さくはしない——手ぶれがフリックになるので
     */
    private fun direction(dx: Float, dy: Float): Int {
        val t = max(dp(FLICK_THRESHOLD_DP).toFloat(), slop)
        if (dx * dx + dy * dy < t * t) return 0
        return if (abs(dx) > abs(dy)) (if (dx < 0) 1 else 3) else (if (dy < 0) 2 else 4)
    }

    /** 端末が「動かした」とみなす最小の移動量(px)。手ぶれの下限に使う */
    private val slop = ViewConfiguration.get(context).scaledTouchSlop.toFloat()

    /** 向きに割り当てが無ければ中央の字（や行の左右など） */
    private fun charAt(key: Kana.Key, dir: Int): String =
        key.chars.getOrNull(dir)?.takeIf { it.isNotEmpty() } ?: key.chars[0]

    private fun commit(key: Kana.Key, dir: Int) {
        val now = SystemClock.uptimeMillis()
        if (dir == 0 && key === lastKey && now - lastTapAt < TOGGLE_WINDOW_MS) {
            // 叩き直し。割り当てのある向きだけを あ→い→う→え→お の順に巡る
            val steps = key.chars.indices.filter { key.chars[it].isNotEmpty() }
            val next = steps[(steps.indexOf(lastStep) + 1).mod(steps.size)]
            lastStep = next
            lastTapAt = now
            host.replaceLastKana(key.chars[next])
            return
        }
        val ch = charAt(key, dir)
        lastKey = key
        // フリックで入れた字は、その向きから続けて巡らせる
        lastStep = key.chars.indexOf(ch).coerceAtLeast(0)
        lastTapAt = now
        host.appendKana(ch)
    }

    /** 巡りの起点を忘れる（⌫のあと、続けて叩いても前の字を置き換えない） */
    fun resetToggle() {
        lastKey = null
        lastTapAt = 0L
    }

    private fun paint(v: View, fill: Int) {
        v.background = GradientDrawable().apply {
            setColor(fill)
            setStroke(dp(1), colBorder)
            cornerRadius = dp(8).toFloat()
        }
    }

    private fun dp(v: Int): Int =
        (v * resources.displayMetrics.density).toInt().coerceAtLeast(if (v > 0) 1 else 0)
}
