import UIKit

/// 操作子の配置図。
///
/// IDC文字(⿰⿱⿴…)は端末のフォントで豆腐になるので、文字ではなく矩形で描く。
/// アプリ版(src/OperatorIcon.tsx)とまったく同じ図で、図形の定義も
/// core/ids/operators.ts の1か所を共有している(OperatorIcons.swift は生成物)。
///
/// 役割ごとに濃さを変えて「1つめの部品／2つめ／3つめ」を見分けられるようにする。
final class OperatorIconView: UIView {

    private let rects: [CGFloat]
    private let color: UIColor

    init(icon: OperatorIcons.Icon, color: UIColor, size: CGFloat) {
        self.rects = icon.rects ?? []
        self.color = color
        super.init(frame: CGRect(x: 0, y: 0, width: size, height: size))
        backgroundColor = .clear
        isUserInteractionEnabled = false
        translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            widthAnchor.constraint(equalToConstant: size),
            heightAnchor.constraint(equalToConstant: size),
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    override func draw(_ rect: CGRect) {
        guard let ctx = UIGraphicsGetCurrentContext(), rects.count >= 5 else { return }
        // 正方形に収めて中央へ。キーの幅が余っても図が伸びないようにする
        let side = min(bounds.width, bounds.height)
        let ox = bounds.minX + (bounds.width - side) / 2
        let oy = bounds.minY + (bounds.height - side) / 2
        let radius = side * 0.06

        var i = 0
        while i + 4 < rects.count {
            let alpha: CGFloat
            switch Int(rects[i + 4]) {
            case 1: alpha = 0.85
            case 2: alpha = 0.38
            default: alpha = 0.20
            }
            let r = CGRect(
                x: ox + rects[i] * side,
                y: oy + rects[i + 1] * side,
                width: rects[i + 2] * side,
                height: rects[i + 3] * side,
            )
            ctx.setFillColor(color.withAlphaComponent(alpha).cgColor)
            ctx.addPath(UIBezierPath(roundedRect: r, cornerRadius: radius).cgPath)
            ctx.fillPath()
            i += 5
        }
    }
}
