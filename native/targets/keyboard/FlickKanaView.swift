import UIKit

protocol FlickKanaViewDelegate: AnyObject {
    /// 1字打った
    func flickAppend(_ ch: String)
    /// 同じキーの叩き直し。末尾1字を置き換える
    func flickReplaceLast(_ ch: String)
    /// 「小゛゜」。末尾1字を濁点・小文字へ送る
    func flickCycleLast()
    func flickBackspace()
    /// 指を置いているあいだの仮の字。離す/取り消しで nil
    func flickPreview(_ ch: String?)
    /// 打鍵音はキーボード本体と同じものを使う
    func flickTapFeedback()
}

/// 読みを打つための12キーフリック面。
///
/// このキーボードは自分が入力方式なので、読みを打ちたくても他のかなキーボードへ
/// 移れない。そこで、日本のスマホで標準のフリック入力をこの面として持つ。
///
/// 指を置いてから離すまでの向きで段を決める（中央=あ、左=い、上=う、右=え、下=お）。
/// 途中経過は flickPreview で読みの欄に色を変えて出す。**ポップアップは出さない**：
/// キーボード拡張の上に別ウィンドウを重ねると端末や向きによって位置がずれるので、
/// 「いま何が入るか」は読みの欄そのもので見せる方が確実で、目線も動かない。
///
/// フリックできない人のために、同じキーを続けて叩くと あ→い→う→え→お と
/// 送るトグル入力も受ける（標準のかなキーボードと同じ）。
final class FlickKanaView: UIView {

    weak var delegate: FlickKanaViewDelegate?

    /// これ以上動いたらフリックとみなす。小さすぎると普通のタップが滑る
    private static let flickThreshold: CGFloat = 18

    /// 同じキーの叩き直しをトグルとして扱う間合い(秒)
    private static let toggleWindow: TimeInterval = 0.9

    private let colText: UIColor
    private let colSub: UIColor
    private let colCard: UIColor
    private let colBorder: UIColor
    private let colAccentBg: UIColor

    /// 直前に叩いたキー(ラベルで見分ける)と、そのとき何番目の字を出したか
    private var lastLabel: String?
    private var lastStep = 0
    private var lastTapAt: TimeInterval = 0

    init(text: UIColor, sub: UIColor, card: UIColor, border: UIColor, accentBg: UIColor) {
        colText = text
        colSub = sub
        colCard = card
        colBorder = border
        colAccentBg = accentBg
        super.init(frame: .zero)
        build()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    private func build() {
        let root = UIStackView()
        root.axis = .vertical
        root.spacing = 4
        root.distribution = .fillEqually
        root.translatesAutoresizingMaskIntoConstraints = false
        addSubview(root)
        NSLayoutConstraint.activate([
            root.topAnchor.constraint(equalTo: topAnchor),
            root.bottomAnchor.constraint(equalTo: bottomAnchor),
            root.leadingAnchor.constraint(equalTo: leadingAnchor),
            root.trailingAnchor.constraint(equalTo: trailingAnchor),
        ])

        for row in Kana.rows {
            let line = UIStackView()
            line.axis = .horizontal
            line.spacing = 4
            line.distribution = .fillEqually
            for key in row {
                line.addArrangedSubview(KanaKeyView(key: key, pad: self))
            }
            root.addArrangedSubview(line)
        }
    }

    /// 巡りの起点を忘れる（⌫のあと、続けて叩いても前の字を置き換えない）
    func resetToggle() {
        lastLabel = nil
        lastTapAt = 0
    }

    // MARK: - キーから呼ばれる

    fileprivate func style(_ v: UIView, pressed: Bool) {
        v.backgroundColor = pressed ? colAccentBg : colCard
        v.layer.borderColor = colBorder.cgColor
        v.layer.borderWidth = 1
        v.layer.cornerRadius = 8
    }

    fileprivate func labelColor(for key: Kana.Key) -> UIColor {
        key.chars.isEmpty ? colSub : colText
    }

    /// 0=中央 1=左 2=上 3=右 4=下。
    /// しきい値は**動いた距離**で見る(縦横それぞれではなく)。斜めに払ったときに
    /// 縦横のどちらも届かず中央(あ段)になってしまう、が無くなる
    fileprivate func direction(dx: CGFloat, dy: CGFloat) -> Int {
        let t = Self.flickThreshold
        if dx * dx + dy * dy < t * t { return 0 }
        if abs(dx) > abs(dy) { return dx < 0 ? 1 : 3 }
        return dy < 0 ? 2 : 4
    }

    /// 向きに割り当てが無ければ中央の字（や行の左右など）
    fileprivate func char(_ key: Kana.Key, _ dir: Int) -> String {
        let c = dir < key.chars.count ? key.chars[dir] : ""
        return c.isEmpty ? key.chars[0] : c
    }

    fileprivate func commit(_ key: Kana.Key, _ dir: Int) {
        let now = Date.timeIntervalSinceReferenceDate
        if dir == 0, key.label == lastLabel, now - lastTapAt < Self.toggleWindow {
            // 叩き直し。割り当てのある向きだけを あ→い→う→え→お の順に巡る
            let steps = key.chars.indices.filter { !key.chars[$0].isEmpty }
            let at = steps.firstIndex(of: lastStep) ?? 0
            let next = steps[(at + 1) % steps.count]
            lastStep = next
            lastTapAt = now
            delegate?.flickReplaceLast(key.chars[next])
            return
        }
        let ch = char(key, dir)
        lastLabel = key.label
        // フリックで入れた字は、その向きから続けて巡らせる
        lastStep = key.chars.firstIndex(of: ch) ?? 0
        lastTapAt = now
        delegate?.flickAppend(ch)
    }
}

/// 1キーぶん。フリックの向きを見たいので UIButton ではなく touches を直に受ける
private final class KanaKeyView: UIView {

    private let key: Kana.Key
    private unowned let pad: FlickKanaView
    private var down = CGPoint.zero

    /// 指が**いちばん遠かった**ところ(と、そのときの距離の2乗)。向きはここで決める。
    /// 放るように払うと離す瞬間には戻ってきていることがあり、終点だけ見ると
    /// 中央(あ段)になってしまう
    private var far = CGPoint.zero
    private var farD2: CGFloat = 0

    /// 指のいまの位置を控える。いちばん遠かったところだけ残す
    private func track(_ p: CGPoint) {
        let dx = p.x - down.x
        let dy = p.y - down.y
        let d2 = dx * dx + dy * dy
        if d2 > farD2 {
            farD2 = d2
            far = CGPoint(x: dx, y: dy)
        }
    }

    init(key: Kana.Key, pad: FlickKanaView) {
        self.key = key
        self.pad = pad
        super.init(frame: .zero)

        let label = UILabel()
        label.text = key.label
        label.textAlignment = .center
        label.textColor = pad.labelColor(for: key)
        label.font = .systemFont(ofSize: key.chars.isEmpty ? 13 : 20)
        label.translatesAutoresizingMaskIntoConstraints = false
        label.isUserInteractionEnabled = false
        addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: centerXAnchor),
            label.centerYAnchor.constraint(equalTo: centerYAnchor),
            // 面の高さは端末に合わせて伸び縮みする。ここを高く縛ると、
            // 画面の小さい端末で下の段がはみ出して打てなくなる
            heightAnchor.constraint(greaterThanOrEqualToConstant: 34),
        ])
        pad.style(self, pressed: false)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let t = touches.first else { return }
        down = t.location(in: self)
        far = .zero
        farD2 = 0
        pad.style(self, pressed: true)
        pad.delegate?.flickTapFeedback()
        if !key.chars.isEmpty { pad.delegate?.flickPreview(key.chars[0]) }
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let t = touches.first, !key.chars.isEmpty else { return }
        track(t.location(in: self))
        pad.delegate?.flickPreview(pad.char(key, pad.direction(dx: far.x, dy: far.y)))
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        pad.style(self, pressed: false)
        pad.delegate?.flickPreview(nil)

        // 「小゛゜」と「⌫」は向きを持たない。押した回数だけ効く
        if key.chars.isEmpty {
            if key.label == Kana.backspace {
                pad.delegate?.flickBackspace()
            } else {
                pad.delegate?.flickCycleLast()
            }
            return
        }
        guard let t = touches.first else { return }
        track(t.location(in: self))
        pad.commit(key, pad.direction(dx: far.x, dy: far.y))
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
        pad.style(self, pressed: false)
        pad.delegate?.flickPreview(nil)
    }
}
