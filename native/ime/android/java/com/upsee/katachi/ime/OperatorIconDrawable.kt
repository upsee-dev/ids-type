package com.upsee.katachi.ime

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorFilter
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.RectF
import android.graphics.drawable.Drawable

/**
 * 操作子の配置図。
 *
 * IDC文字(⿰⿱⿴…)は端末のフォントで豆腐になるので、文字ではなく矩形で描く。
 * アプリ版(src/OperatorIcon.tsx)とまったく同じ図で、図形の定義も
 * core/ids/operators.ts の1か所を共有している(OperatorIcons.kt は生成物)。
 *
 * 役割ごとに濃さを変えて「1つめの部品／2つめ／3つめ」を見分けられるようにする。
 */
class OperatorIconDrawable(
    private val icon: OperatorIcons.Icon,
    private val color: Int,
    private val sizePx: Int,
) : Drawable() {

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val radius = sizePx * 0.06f

    override fun draw(canvas: Canvas) {
        val rects = icon.rects ?: return
        val b = bounds
        // 正方形に収めて中央へ。キーの幅が余っても図が伸びないようにする
        val side = minOf(b.width(), b.height()).toFloat()
        val left = b.left + (b.width() - side) / 2f
        val top = b.top + (b.height() - side) / 2f
        var i = 0
        while (i + 4 < rects.size) {
            paint.color = color
            paint.alpha = when (rects[i + 4].toInt()) {
                1 -> 217 // 0.85
                2 -> 97  // 0.38
                else -> 51 // 0.20
            }
            canvas.drawRoundRect(
                RectF(
                    left + rects[i] * side,
                    top + rects[i + 1] * side,
                    left + (rects[i] + rects[i + 2]) * side,
                    top + (rects[i + 1] + rects[i + 3]) * side,
                ),
                radius, radius, paint,
            )
            i += 5
        }
    }

    override fun getIntrinsicWidth(): Int = sizePx
    override fun getIntrinsicHeight(): Int = sizePx
    override fun setAlpha(alpha: Int) { paint.alpha = alpha }
    override fun setColorFilter(cf: ColorFilter?) { paint.colorFilter = cf }
    @Deprecated("Drawable の抽象メンバー", ReplaceWith("PixelFormat.TRANSLUCENT"))
    override fun getOpacity(): Int = PixelFormat.TRANSLUCENT

    companion object {
        /** 図を持たない操作子(⇄ ↻ − など)は記号を文字で出す */
        fun symbolOf(code: String): String? = OperatorIcons.ALL[code]?.symbol
    }
}
