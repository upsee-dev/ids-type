package com.upsee.katachi.ime

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.drawable.GradientDrawable
import android.os.SystemClock
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import kotlin.math.abs

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
        /** これ以上動いたらフリックとみなす(dp)。小さすぎると普通のタップが滑る */
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
        v.setOnTouchListener { view, e ->
            when (e.action) {
                MotionEvent.ACTION_DOWN -> {
                    downX = e.x
                    downY = e.y
                    host.keyFeedback(view, true)
                    paint(view, colAccentBg)
                    host.previewKana(key.chars[0])
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    host.previewKana(charAt(key, direction(e.x - downX, e.y - downY)))
                    true
                }
                MotionEvent.ACTION_UP -> {
                    host.keyFeedback(view, false)
                    paint(view, colCard)
                    host.previewKana(null)
                    commit(key, direction(e.x - downX, e.y - downY))
                    true
                }
                MotionEvent.ACTION_CANCEL -> {
                    paint(view, colCard)
                    host.previewKana(null)
                    true
                }
                else -> false
            }
        }
        return v
    }

    /** 0=中央 1=左 2=上 3=右 4=下 */
    private fun direction(dx: Float, dy: Float): Int {
        val t = dp(FLICK_THRESHOLD_DP)
        if (abs(dx) < t && abs(dy) < t) return 0
        return if (abs(dx) > abs(dy)) (if (dx < 0) 1 else 3) else (if (dy < 0) 2 else 4)
    }

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
