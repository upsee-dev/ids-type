import UIKit

protocol HandwritingViewDelegate: AnyObject {
    /// 1画描き終えた／消した。そのときまでの画で候補を引き直す
    func handwritingStrokesChanged(_ strokes: [[Double]])
    /// 打鍵音はキーボード本体と同じものを使う
    func handwritingTapFeedback()
}

/// 読めない字を書いて引くための面。
///
/// 認識は端末の中だけで完結する（`Handwriting`。通信はしない）。
/// 画を1本描き終えるたびに delegate を呼び、そのときまでの画で候補を引き直す。
///
/// 指の軌跡は `touches` を直に受ける（UIGestureRecognizer だと、途中の点を
/// 間引かれて字の形が崩れる）。`coalescedTouches` まで拾うと、速く書いても
/// 折れ線がなめらかになる。
final class HandwritingView: UIView {

    weak var delegate: HandwritingViewDelegate?

    /// 手ぶれ以下の点は捨てる(描画も照合も、点が多すぎると重いだけ)
    private static let minStep: CGFloat = 2

    private let colText: UIColor
    private let colBorder: UIColor
    private let colAccent: UIColor

    /// 描いた画。1画は x,y を交互に並べたもの(Handwriting.match がそのまま受ける)
    private var strokes: [[Double]] = []
    private var current: [Double] = []

    var strokeCount: Int { strokes.count }

    init(text: UIColor, border: UIColor, accent: UIColor) {
        colText = text
        colBorder = border
        colAccent = accent
        super.init(frame: .zero)
        backgroundColor = .clear
        isMultipleTouchEnabled = false
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func clear() {
        strokes.removeAll()
        current.removeAll()
        setNeedsDisplay()
        delegate?.handwritingStrokesChanged(strokes)
    }

    func undo() {
        guard !strokes.isEmpty else { return }
        strokes.removeLast()
        setNeedsDisplay()
        delegate?.handwritingStrokesChanged(strokes)
    }

    // MARK: - 指の軌跡

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let t = touches.first else { return }
        delegate?.handwritingTapFeedback()
        let p = t.location(in: self)
        current = [Double(p.x), Double(p.y)]
        setNeedsDisplay()
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let t = touches.first, !current.isEmpty else { return }
        // 端末が間引いて渡してくる中間の点も拾う(速く書いても形が崩れない)
        for c in event?.coalescedTouches(for: t) ?? [t] {
            add(c.location(in: self))
        }
        setNeedsDisplay()
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        endStroke()
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
        endStroke()
    }

    private func endStroke() {
        let cur = current
        current = []
        // 動かさず点だけ打った「丶」も1画として拾う
        if cur.count >= 2 { strokes.append(cur) }
        setNeedsDisplay()
        delegate?.handwritingStrokesChanged(strokes)
    }

    private func add(_ p: CGPoint) {
        let dx = p.x - CGFloat(current[current.count - 2])
        let dy = p.y - CGFloat(current[current.count - 1])
        if (dx * dx + dy * dy).squareRoot() < Self.minStep { return }
        current.append(Double(p.x))
        current.append(Double(p.y))
    }

    // MARK: - 描画

    override func draw(_ rect: CGRect) {
        // 枠は正方形。字は枠からはみ出しても認識に響かない(外接枠で正規化するため)
        let side = min(bounds.width, bounds.height) - 6
        let box = CGRect(
            x: (bounds.width - side) / 2, y: (bounds.height - side) / 2,
            width: side, height: side,
        )
        let guide = UIBezierPath(rect: box)
        guide.move(to: CGPoint(x: box.minX, y: box.midY))
        guide.addLine(to: CGPoint(x: box.maxX, y: box.midY))
        guide.move(to: CGPoint(x: box.midX, y: box.minY))
        guide.addLine(to: CGPoint(x: box.midX, y: box.maxY))
        guide.lineWidth = 1
        guide.setLineDash([3, 4], count: 2, phase: 0)
        colBorder.setStroke()
        guide.stroke()

        for s in strokes { draw(s, colText) }
        if current.count >= 2 { draw(current, colAccent) }
    }

    private func draw(_ s: [Double], _ color: UIColor) {
        guard s.count >= 2 else { return }
        let path = UIBezierPath()
        path.lineWidth = 4
        path.lineCapStyle = .round
        path.lineJoinStyle = .round
        let start = CGPoint(x: s[0], y: s[1])
        if s.count == 2 {
            // 点だけの「丶」。長さ0の線は描かれないので、丸を1つ置く
            color.setFill()
            UIBezierPath(
                ovalIn: CGRect(x: start.x - 2, y: start.y - 2, width: 4, height: 4),
            ).fill()
            return
        }
        color.setStroke()
        path.move(to: start)
        var i = 2
        while i + 1 < s.count {
            path.addLine(to: CGPoint(x: s[i], y: s[i + 1]))
            i += 2
        }
        path.stroke()
    }
}
