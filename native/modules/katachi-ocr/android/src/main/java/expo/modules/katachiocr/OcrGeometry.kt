package expo.modules.katachiocr

import kotlin.math.min
import kotlin.math.roundToInt

data class OcrCrop(val x: Int, val y: Int, val width: Int, val height: Int)

fun ocrFocusCrop(width: Int, height: Int, previewAspect: Double): OcrCrop {
    require(width > 0 && height > 0)
    if (!previewAspect.isFinite() || previewAspect <= 0) return OcrCrop(0, 0, width, height)
    val imageAspect = width.toDouble() / height
    val visibleWidth = if (imageAspect > previewAspect) height * previewAspect else width.toDouble()
    val visibleHeight = if (imageAspect > previewAspect) height.toDouble() else width / previewAspect
    val side = (min(visibleWidth, visibleHeight) * 0.72).roundToInt().coerceIn(1, min(width, height))
    return OcrCrop((width - side) / 2, (height - side) / 2, side, side)
}
