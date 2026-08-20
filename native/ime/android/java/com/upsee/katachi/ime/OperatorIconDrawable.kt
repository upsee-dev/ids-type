package com.upsee.katachi.ime

import android.graphics.Canvas
import android.graphics.ColorFilter
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.drawable.Drawable

/**
 * 操作子の配置図。
 *
 * IDC文字(⿰⿱⿴…)は端末のフォントで豆腐になるので、文字ではなく矩形で描く。
 * アプリ版(src/OperatorIcon.tsx)とまったく同じ図で、図形の定義も
 * core/ids/operators.ts の1か所を共有している(OperatorIcons.kt は生成物)。
 *
 * 役割ごとに濃さを変えて「1つめの部品／2つめ／3つめ」を見分けられるようにする。
 *
 * 配置図を持たない鏡映・回転・除去だけは IDC の字形(⿾⿿㇯)を描く。この3字は
 * 端末の標準フォントには無いが**同梱フォント(KatachiExt1)が持っている**ので、
 * symbolFont にそれを渡せば端末に関係なく同じ絵が出る。
 */
class OperatorIconDrawable(
    private val icon: OperatorIcons.Icon,
    private val color: Int,
    private val sizePx: Int,
    /** symbol を描くフォント。同梱フォント(KeyboardView#fontFor)を渡すこと。null なら描かない */
    private val symbolFont: Typeface? = null,
) : Drawable() {

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val radius = sizePx * 0.06f
    private val inkBounds = Rect()

    override fun draw(canvas: Canvas) {
        val b = bounds
        // 正方形に収めて中央へ。キーの幅が余っても図が伸びないようにする
        val side = minOf(b.width(), b.height()).toFloat()
        val left = b.left + (b.width() - side) / 2f
        val top = b.top + (b.height() - side) / 2f
        val rects = icon.rects
        if (rects == null) {
            drawSymbol(canvas, left, top, side)
            return
        }
        var i = 0
        while (i + 4 < rects.size) {
            paint.color = color
            paint.alpha = alphaOf(rects[i + 4].toInt())
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

    /**
     * IDCの字形を、矩形の図と同じ大きさの正方形いっぱいに描く。
     * 字の実インク(getTextBounds)で測ってから合わせるので、フォントの
     * 字面率に関係なく他の操作子と粒がそろう。
     */
    private fun drawSymbol(canvas: Canvas, left: Float, top: Float, side: Float) {
        val sym = icon.symbol ?: return
        // 同梱フォントが渡っていないあいだは何も描かない。端末の標準フォントで
        // 描くと豆腐(□)が出てしまうので、空のままラベルだけ見せておく
        val face = symbolFont ?: return
        paint.color = color
        paint.alpha = alphaOf(1) // 1つめの部品と同じ濃さ
        paint.typeface = face
        paint.textSize = side
        paint.getTextBounds(sym, 0, sym.length, inkBounds)
        val ink = maxOf(inkBounds.width(), inkBounds.height())
        if (ink <= 0) return
        paint.textSize = side * side / ink
        paint.getTextBounds(sym, 0, sym.length, inkBounds)
        canvas.drawText(
            sym,
            left + (side - inkBounds.width()) / 2f - inkBounds.left,
            top + (side - inkBounds.height()) / 2f - inkBounds.top,
            paint,
        )
    }

    private fun alphaOf(role: Int): Int = when (role) {
        1 -> 217 // 0.85
        2 -> 97  // 0.38
        else -> 51 // 0.20
    }

    override fun getIntrinsicWidth(): Int = sizePx
    override fun getIntrinsicHeight(): Int = sizePx
    override fun setAlpha(alpha: Int) { paint.alpha = alpha }
    override fun setColorFilter(cf: ColorFilter?) { paint.colorFilter = cf }
    @Deprecated("Drawable の抽象メンバー", ReplaceWith("PixelFormat.TRANSLUCENT"))
    override fun getOpacity(): Int = PixelFormat.TRANSLUCENT
}
