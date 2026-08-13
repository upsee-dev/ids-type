package com.upsee.katachi.ime

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Path
import android.view.MotionEvent
import android.view.View
import kotlin.math.hypot
import kotlin.math.min

/**
 * 読めない字を書いて引くための面。
 *
 * 認識は端末の中だけで完結する（[Handwriting]。通信はしない）。
 * 画を1本描き終えるたびに [Host.onStrokesChanged] を呼び、そのときまでの
 * 画で候補を引き直す。
 *
 * このビューは KeyboardView のスクロール面の中に置かれるので、指を置いた瞬間に
 * 親のスクロールを止める（止めないと縦画がスクロールに取られて字が書けない）。
 */
@SuppressLint("ViewConstructor")
class HandwritingView(
    context: Context,
    private val colText: Int,
    private val colBorder: Int,
    private val colAccent: Int,
    private val host: Host,
) : View(context) {

    interface Host {
        /** 1画描き終えた／消した。そのときまでの画で候補を引き直す */
        fun onStrokesChanged(strokes: List<DoubleArray>)
        /** 打鍵の手応え(音・触覚)は KeyboardView と同じものを使う */
        fun keyFeedback(v: View, down: Boolean)
    }

    /** 描いた画。1画は x,y を交互に並べたもの(Handwriting.match がそのまま受ける) */
    private val strokes = ArrayList<ArrayList<Double>>()
    private var current: ArrayList<Double>? = null

    /** 手ぶれ以下の点は捨てる(描画も照合も、点が多すぎると重いだけ) */
    private val minStep = dp(2).toFloat()

    val strokeCount: Int get() = strokes.size

    private val inkPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = dp(4).toFloat()
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
        color = colText
    }
    private val livePaint = Paint(inkPaint).apply { color = colAccent }

    /** 目安の枠と十字。手書き入力の流儀に合わせた点線 */
    private val guidePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = dp(1).toFloat()
        color = colBorder
        pathEffect = DashPathEffect(floatArrayOf(dp(3).toFloat(), dp(4).toFloat()), 0f)
    }

    private val path = Path()

    fun clear() {
        strokes.clear()
        current = null
        invalidate()
        host.onStrokesChanged(snapshot())
    }

    fun undo() {
        if (strokes.isEmpty()) return
        strokes.removeAt(strokes.size - 1)
        invalidate()
        host.onStrokesChanged(snapshot())
    }

    private fun snapshot(): List<DoubleArray> = strokes.map { it.toDoubleArray() }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.action) {
            MotionEvent.ACTION_DOWN -> {
                // 縦画をスクロールに取られないよう、親のスクロールを止める
                parent?.requestDisallowInterceptTouchEvent(true)
                host.keyFeedback(this, true)
                current = arrayListOf(event.x.toDouble(), event.y.toDouble())
                invalidate()
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                val cur = current ?: return true
                // 指の動きは端末が間引いて渡してくるので、間の点も拾う
                for (h in 0 until event.historySize) {
                    addPoint(cur, event.getHistoricalX(h), event.getHistoricalY(h))
                }
                addPoint(cur, event.x, event.y)
                invalidate()
                return true
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                parent?.requestDisallowInterceptTouchEvent(false)
                host.keyFeedback(this, false)
                val cur = current
                current = null
                // 動かさず点だけ打った「丶」も1画として拾う
                if (cur != null && cur.size >= 2) strokes.add(cur)
                invalidate()
                host.onStrokesChanged(snapshot())
                return true
            }
        }
        return super.onTouchEvent(event)
    }

    private fun addPoint(cur: ArrayList<Double>, x: Float, y: Float) {
        val dx = x - cur[cur.size - 2].toFloat()
        val dy = y - cur[cur.size - 1].toFloat()
        if (hypot(dx, dy) < minStep) return
        cur.add(x.toDouble())
        cur.add(y.toDouble())
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)

        // 枠は正方形。字は枠からはみ出しても認識に響かない(外接枠で正規化するため)
        val side = min(width, height) - dp(6)
        val left = (width - side) / 2f
        val top = (height - side) / 2f
        canvas.drawRect(left, top, left + side, top + side, guidePaint)
        canvas.drawLine(left, top + side / 2f, left + side, top + side / 2f, guidePaint)
        canvas.drawLine(left + side / 2f, top, left + side / 2f, top + side, guidePaint)

        for (s in strokes) draw(canvas, s, inkPaint)
        current?.let { draw(canvas, it, livePaint) }
    }

    private fun draw(canvas: Canvas, s: List<Double>, paint: Paint) {
        if (s.size < 2) return
        if (s.size == 2) {
            // 点だけの「丶」。長さ0の線は描かれないので円を打つ
            canvas.drawPoint(s[0].toFloat(), s[1].toFloat(), paint)
            return
        }
        path.reset()
        path.moveTo(s[0].toFloat(), s[1].toFloat())
        var i = 2
        while (i < s.size) {
            path.lineTo(s[i].toFloat(), s[i + 1].toFloat())
            i += 2
        }
        canvas.drawPath(path, paint)
    }

    private fun dp(v: Int): Int =
        (v * resources.displayMetrics.density).toInt().coerceAtLeast(if (v > 0) 1 else 0)
}
