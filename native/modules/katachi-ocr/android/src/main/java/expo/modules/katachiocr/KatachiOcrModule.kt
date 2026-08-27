package expo.modules.katachiocr

import android.net.Uri
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.japanese.JapaneseTextRecognizerOptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

/**
 * 写真から字を読み取る(Android)。
 *
 * ML Kit の**日本語モデルを同梱した**版を使う(build.gradle 参照)。
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

    override fun definition() = ModuleDefinition {
        Name("KatachiOcr")

        AsyncFunction("recognizeText") { uri: String, promise: Promise ->
            val context = appContext.reactContext
            if (context == null) {
                promise.reject(CodedException("no_context", "画面がありません", null))
                return@AsyncFunction
            }
            runCatching { InputImage.fromFilePath(context, Uri.parse(uri)) }
                .onFailure {
                    promise.reject(CodedException("bad_image", "写真を読めませんでした", it))
                }
                .onSuccess { image ->
                    recognizer.process(image)
                        .addOnSuccessListener { promise.resolve(it.text) }
                        .addOnFailureListener {
                            promise.reject(CodedException("ocr_failed", "読み取れませんでした", it))
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
