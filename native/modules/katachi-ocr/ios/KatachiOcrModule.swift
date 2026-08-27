import ExpoModulesCore
import Vision

/**
 * 写真から字を読み取る(iOS)。
 *
 * OS に入っている Vision を使う。日本語(ja-JP)は iOS 16 から読めて、
 * このアプリの下限は 16.4 なので条件を満たす。同梱物は増えず、通信もしない。
 *
 * 縦書きが多いので `usesLanguageCorrection` は切る。前後の並びから辞書で
 * 直されると、読めない字(＝辞書に出にくい字)ほど別の字に化けてしまう。
 *
 * 撮った写真は一時領域にファイルとして残るので、読み終わったら
 * `discardPhoto` で消してもらう(「写真はどこにも残りません」と断っているため)。
 */
public class KatachiOcrModule: Module {
  public func definition() -> ModuleDefinition {
    Name("KatachiOcr")

    AsyncFunction("recognizeText") { (uri: String, promise: Promise) in
      guard let url = URL(string: uri),
            let data = try? Data(contentsOf: url),
            let image = UIImage(data: data)?.cgImage
      else {
        promise.reject("bad_image", "写真を読めませんでした")
        return
      }

      let request = VNRecognizeTextRequest { request, error in
        if let error {
          promise.reject("ocr_failed", error.localizedDescription)
          return
        }
        let lines = (request.results as? [VNRecognizedTextObservation] ?? [])
          .compactMap { $0.topCandidates(1).first?.string }
        promise.resolve(lines.joined(separator: "\n"))
      }
      request.recognitionLevel = .accurate
      request.recognitionLanguages = ["ja-JP"]
      request.usesLanguageCorrection = false

      DispatchQueue.global(qos: .userInitiated).async {
        do {
          try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
        } catch {
          promise.reject("ocr_failed", error.localizedDescription)
        }
      }
    }

    /// 読み終わった写真を捨てる。撮る → 読む → 使い捨て、で端末にも残さない。
    /// 消せなくても失敗にはしない(読み取りは済んでいて、呼ぶ側にできることが無い)
    AsyncFunction("discardPhoto") { (uri: String) in
      guard let url = URL(string: uri), url.isFileURL else { return }
      try? FileManager.default.removeItem(at: url)
    }
  }
}
