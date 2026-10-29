import UIKit

final class RadicalIndexView: UIStackView {
    private let index = UnicodeRadicalIndex()
    private var strokes: Int?, radical: Int?, residual: Int?
    private var page = 0
    private let commit: (String) -> Void
    private let glyphFont: (String, CGFloat) -> UIFont
    init(commit: @escaping (String) -> Void, font: @escaping (String, CGFloat) -> UIFont) {
        self.commit = commit; glyphFont = font
        super.init(frame: .zero)
        axis = .vertical; spacing = 4
        build()
    }
    required init(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    private func button(_ text: String, action: @escaping () -> Void) -> UIButton {
        let b = UIButton(type: .system)
        b.setTitle(text, for: .normal); b.titleLabel?.font = .systemFont(ofSize: 13)
        b.backgroundColor = .secondarySystemBackground; b.layer.cornerRadius = 5
        b.addAction(UIAction { _ in action() }, for: .touchUpInside)
        return b
    }
    private func build() {
        arrangedSubviews.forEach { $0.removeFromSuperview() }
        let title = strokes == nil ? "部首の画数" : radical == nil ? "\(strokes!)画の部首" : residual == nil ? "\(UnicodeRadicalIndex.label(radical!))：残りの画数" : "\(UnicodeRadicalIndex.label(radical!)) ＋ \(residual!)画"
        let back = button("‹ 戻る") { [weak self] in
            guard let self else { return }; self.page = 0
            if self.residual != nil { self.residual = nil } else if self.radical != nil { self.radical = nil } else { self.strokes = nil }; self.build()
        }
        back.isEnabled = strokes != nil
        let home = button("最初へ") { [weak self] in self?.strokes = nil; self?.radical = nil; self?.residual = nil; self?.page = 0; self?.build() }
        let label = UILabel(); label.text = title; label.textAlignment = .center; label.font = .systemFont(ofSize: 12); label.adjustsFontSizeToFitWidth = true
        let head = UIStackView(arrangedSubviews: [back,label,home]); head.spacing = 4; head.heightAnchor.constraint(equalToConstant: 32).isActive = true
        back.widthAnchor.constraint(equalToConstant: 60).isActive = true; home.widthAnchor.constraint(equalToConstant: 60).isActive = true
        addArrangedSubview(head)
        let isChars = residual != nil
        let numbers = strokes == nil ? Array(1...17) : radical == nil ? UnicodeRadicalIndex.radicals(strokes!) : residual == nil ? index.residuals(radical!) : []
        let items = isChars ? index.characters(radical!,residual!) : numbers.map(String.init)
        page = min(page, max(0,(items.count-1)/20))
        let grid = UIStackView(); grid.axis = .vertical; grid.spacing = 3; grid.distribution = .fillEqually
        for row in 0..<5 {
            let line = UIStackView(); line.spacing = 3; line.distribution = .fillEqually
            for col in 0..<4 {
                let at = page*20+row*4+col
                guard at < items.count else { line.addArrangedSubview(UIView()); continue }
                let value = items[at]
                let name = isChars ? value : radical == nil && strokes != nil ? UnicodeRadicalIndex.label(Int(value)!) : value+"画"
                let b = button(name) { [weak self] in
                    guard let self else { return }
                    if isChars { self.commit(value); return }
                    self.page = 0
                    if self.strokes == nil { self.strokes = Int(value) } else if self.radical == nil { self.radical = Int(value) } else { self.residual = Int(value) }
                    self.build()
                }
                if isChars {
                    b.titleLabel?.font = glyphFont(value, 24)
                    b.accessibilityLabel = "\(value) U+\(String(value.unicodeScalars.first!.value,radix:16).uppercased())を入力"
                }
                line.addArrangedSubview(b)
            }
            grid.addArrangedSubview(line)
        }
        addArrangedSubview(grid)
        let prev = button("‹ 前") { [weak self] in self?.page -= 1; self?.build() }; prev.isEnabled = page > 0
        let next = button("次 ›") { [weak self] in self?.page += 1; self?.build() }; next.isEnabled = (page+1)*20 < items.count
        let count = UILabel(); count.font = .systemFont(ofSize: 11); count.textAlignment = .center; count.text = "\(items.count)件 · \(page+1)/\(max(1,(items.count+19)/20))"
        let nav = UIStackView(arrangedSubviews:[prev,count,next]); nav.distribution = .fillEqually; nav.heightAnchor.constraint(equalToConstant: 30).isActive = true
        addArrangedSubview(nav)
    }
}
