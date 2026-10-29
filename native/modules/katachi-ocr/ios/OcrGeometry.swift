import Foundation
import CoreGraphics

/// aspect-fill のプレビュー中央に描いた「短辺の72%の正方形」を画像座標へ戻す。
func ocrFocusRegion(width: Double, height: Double, previewAspect: Double) -> CGRect {
  guard width > 0, height > 0, previewAspect.isFinite, previewAspect > 0 else {
    return CGRect(x: 0, y: 0, width: 1, height: 1)
  }
  let imageAspect = width / height
  let visibleWidth = imageAspect > previewAspect ? height * previewAspect : width
  let visibleHeight = imageAspect > previewAspect ? height : width / previewAspect
  let side = min(visibleWidth, visibleHeight) * 0.72
  let w = side / width, h = side / height
  return CGRect(x: (1 - w) / 2, y: (1 - h) / 2, width: w, height: h)
}
