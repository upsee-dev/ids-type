import Foundation
import CoreGraphics

@main struct OcrGeometryTest {
  static func main() {
    for (width, height, aspect) in [(4032.0, 3024.0, 0.6), (3024.0, 4032.0, 1.8), (1200.0, 1200.0, 1.0)] {
      let region = ocrFocusRegion(width: width, height: height, previewAspect: aspect)
      precondition(abs(region.midX - 0.5) < 1e-9 && abs(region.midY - 0.5) < 1e-9)
      precondition(region.minX >= 0 && region.maxX <= 1 && region.minY >= 0 && region.maxY <= 1)
      precondition(abs(region.width * width - region.height * height) < 1e-6)
      let visibleWidth = min(width, height * aspect)
      let visibleHeight = min(height, width / aspect)
      precondition(abs(region.width * width - min(visibleWidth, visibleHeight) * 0.72) < 1e-6)
    }
    precondition(ocrFocusRegion(width: 1200, height: 1600, previewAspect: .nan) == CGRect(x: 0, y: 0, width: 1, height: 1))
    print("PASS: iOS OCR crop matches central preview frame for portrait, landscape and square images")
  }
}
