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
  }
}
