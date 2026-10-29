import expo.modules.katachiocr.ocrFocusCrop
import kotlin.math.abs
import kotlin.math.min

fun main() {
    for ((width, height, aspect) in listOf(Triple(4032, 3024, 0.6), Triple(3024, 4032, 1.8), Triple(1200, 1200, 1.0))) {
        val crop = ocrFocusCrop(width, height, aspect)
        check(abs((crop.x + crop.width / 2.0) - width / 2.0) <= 0.5)
        check(abs((crop.y + crop.height / 2.0) - height / 2.0) <= 0.5)
        check(crop.width == crop.height)
        check(crop.x >= 0 && crop.y >= 0 && crop.x + crop.width <= width && crop.y + crop.height <= height)
        val side = min(min(width.toDouble(), height * aspect), min(height.toDouble(), width / aspect)) * 0.72
        check(abs(crop.width - side) <= 0.5)
    }
    check(ocrFocusCrop(1200, 1600, Double.NaN).width == 1200)
    println("PASS: Android OCR crop matches central preview frame for portrait, landscape and square images")
}
