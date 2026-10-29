package expo.modules.katachiocr

import android.net.Uri
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.japanese.JapaneseTextRecognizerOptions
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

/**
 * 写真から字を読み取る(Android)。
 *
 * ML Kit の**日本語・中国語モデルを同梱した**版を使う(build.gradle 参照)。
 * 未同梱版は初回に Google Play 経由で落としに行くので、
 * 「通信を一切しない」というこのアプリの約束を破ってしまう。
 *
 * 認識器は作るのに費用がかかるので使い回す(撮るたびに作らない)。
 *
 * 撮った写真は一時領域にファイルとして残るので、読み終わったら
 * [discardPhoto] で消してもらう(「写真はどこにも残りません」と断っているため)。
 */
class KatachiOcrModule : Module() {

    private val recognizer by lazy {
        TextRecognition.getClient(JapaneseTextRecognizerOptions.Builder().build())
    }
    private val chineseRecognizer by lazy {
        TextRecognition.getClient(ChineseTextRecognizerOptions.Builder().build())
    }

    override fun definition() = ModuleDefinition {
        Name("KatachiOcr")

        AsyncFunction("recognizeText") { uri: String, focus: Boolean, previewAspect: Double, promise: Promise ->
            val context = appContext.reactContext
            if (context == null) {
                promise.reject(CodedException("no_context", "画面がありません", null))
                return@AsyncFunction
            }
            runCatching { loadOcrBitmap(uri, focus, previewAspect) }
                .onFailure {
                    promise.reject(CodedException("bad_image", "写真を読めませんでした", it))
                }
                .onSuccess { bitmap ->
                    try {
                        val image = InputImage.fromBitmap(bitmap, 0)
                        val tasks = listOf(recognizer.process(image), chineseRecognizer.process(image))
                        Tasks.whenAllComplete(tasks).addOnCompleteListener {
                            try {
                                val texts = tasks.filter { it.isSuccessful }.map { it.result.text }
                                if (texts.isEmpty()) {
                                    promise.reject(CodedException("ocr_failed", "読み取れませんでした", tasks.first().exception))
                                } else {
                                    // 日本語の結果を先に、別のモデルで拾えた漢字を後に足す。
                                    promise.resolve(texts.joinToString("\n"))
                                }
                            } finally {
                                bitmap.recycle()
                            }
                        }
                    } catch (error: Exception) {
                        // 先のprocessが走り始めている場合があるので、ここではGCへ任せる。
                        promise.reject(CodedException("ocr_failed", "読み取れませんでした", error))
                    }
                }
        }

        // 読み終わった写真を捨てる。撮る → 読む → 使い捨て、で端末にも残さない。
        // 消せなくても失敗にはしない(読み取りは済んでいて、呼ぶ側にできることが無い)。
        // 消すのは自分たちが撮った file:// のファイルだけ(他所の写真には触らない)
        AsyncFunction("discardPhoto") { uri: String ->
            val path = runCatching { Uri.parse(uri) }
                .getOrNull()
                ?.takeIf { it.scheme == null || it.scheme == "file" }
                ?.path
            if (path != null) runCatching { File(path).delete() }
        }
    }
}

/** EXIFの全8方向を補正してから切り出す。写真・切り出し画像は外部へ送らない。 */
private fun loadOcrBitmap(uri: String, focus: Boolean, previewAspect: Double): Bitmap {
    val parsed = Uri.parse(uri)
    require(parsed.scheme == "file" || parsed.scheme == null)
    val path = requireNotNull(parsed.path)
    val original = requireNotNull(BitmapFactory.decodeFile(path)) { "bad image" }
    val matrix = Matrix()
    when (ExifInterface(path).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
        ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.setScale(-1f, 1f)
        ExifInterface.ORIENTATION_ROTATE_180 -> matrix.setRotate(180f)
        ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.setScale(1f, -1f)
        ExifInterface.ORIENTATION_TRANSPOSE -> { matrix.setRotate(90f); matrix.postScale(-1f, 1f) }
        ExifInterface.ORIENTATION_ROTATE_90 -> matrix.setRotate(90f)
        ExifInterface.ORIENTATION_TRANSVERSE -> { matrix.setRotate(-90f); matrix.postScale(-1f, 1f) }
        ExifInterface.ORIENTATION_ROTATE_270 -> matrix.setRotate(-90f)
    }
    val oriented = Bitmap.createBitmap(original, 0, 0, original.width, original.height, matrix, true)
    if (oriented !== original) original.recycle()
    if (!focus) return oriented
    val crop = ocrFocusCrop(oriented.width, oriented.height, previewAspect)
    val result = Bitmap.createBitmap(oriented, crop.x, crop.y, crop.width, crop.height)
    if (result !== oriented) oriented.recycle()
    return result
}
