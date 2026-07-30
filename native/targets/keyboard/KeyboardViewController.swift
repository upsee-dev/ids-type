import UIKit

/// カタチ入力の iOS キーボード拡張。
///
/// 設定 > 一般 > キーボード > キーボード に「カタチ入力」として追加される。
/// ネットワークを使わない設計なので「フルアクセス」は要求しない
/// (審査でもプライバシー訴求でも有利。docs/technical-roadmap.md 参照)。
///
/// 拡張のメモリ上限は約60MB。RN は載せず、UI もエンジンもここで完結させる。
final class KeyboardViewController: UIInputViewController {

    private let dict = Dict()
    private lazy var engine = Engine(dict: dict)

    /// 入力中のかたちコード(例: "LR日")
    private var composing = "" {
        didSet { onComposingChanged() }
    }

    private enum Tab: Int { case shape, common, radical }
    private var currentTab: Tab = .shape
    private var strokeGroup = "common"
    private var searchSeq = 0

    // 色。Web/Android と揃える
    private let colBg = UIColor(red: 0.98, green: 0.98, blue: 0.976, alpha: 1)
    private let colCard = UIColor.white
    private let colBorder = UIColor(white: 0.90, alpha: 1)
    private let colText = UIColor(white: 0.11, alpha: 1)
    private let colSub = UIColor(white: 0.47, alpha: 1)
    private let colAccent = UIColor(red: 0.267, green: 0.216, blue: 0.819, alpha: 1)
    private let colAccentBg = UIColor(red: 0.933, green: 0.949, blue: 1, alpha: 1)

    private let composingLabel = UILabel()
    private let candidateScroll = UIScrollView()
    private let candidateRow = UIStackView()
    private let tabRow = UIStackView()
    private let strokeScroll = UIScrollView()
    private let strokeRow = UIStackView()
    private let keyArea = UIStackView()

    /// 部品パレット用サブセットフォント。拡張B〜Hの部品は標準フォントに無く、
    /// これが無いと □ が並んで「見て選ぶ」画面が成立しない
    private lazy var partsFont: UIFont = {
        UIFont(name: "KatachiParts", size: 20) ?? UIFont.systemFont(ofSize: 20)
    }()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = colBg
        buildLayout()

        // 辞書はキーボードの表示をブロックしないよう別スレッドで読む。
        // 日本語の字を読み終えた時点でいったん検索可能にし、拡張漢字は後追い。
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            self.dict.loadJapanese(bundle: Bundle(for: type(of: self)))
            DispatchQueue.main.async { self.rebuildKeys(); self.runSearch() }
            self.dict.loadExtensions(bundle: Bundle(for: type(of: self)))
            DispatchQueue.main.async { self.runSearch() }
        }
    }

    // MARK: - レイアウト

    private func buildLayout() {
        let root = UIStackView()
        root.axis = .vertical
        root.spacing = 4
        root.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(root)
        NSLayoutConstraint.activate([
            root.topAnchor.constraint(equalTo: view.topAnchor, constant: 6),
            root.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 6),
            root.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -6),
            root.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -6),
            view.heightAnchor.constraint(greaterThanOrEqualToConstant: 300),
        ])

        // ── 入力中の表示 ──
        let top = UIStackView()
        top.axis = .horizontal
        top.spacing = 6
        composingLabel.textColor = colText
        composingLabel.font = .systemFont(ofSize: 17)
        composingLabel.text = ""
        top.addArrangedSubview(composingLabel)
        top.addArrangedSubview(smallButton("⌫", #selector(onBackspace)))
        top.addArrangedSubview(smallButton("消", #selector(onClear)))
        root.addArrangedSubview(top)

        // ── 候補 ──
        candidateRow.axis = .horizontal
        candidateRow.spacing = 4
        candidateRow.translatesAutoresizingMaskIntoConstraints = false
        candidateScroll.addSubview(candidateRow)
        candidateScroll.showsHorizontalScrollIndicator = false
        NSLayoutConstraint.activate([
            candidateRow.topAnchor.constraint(equalTo: candidateScroll.topAnchor),
            candidateRow.bottomAnchor.constraint(equalTo: candidateScroll.bottomAnchor),
            candidateRow.leadingAnchor.constraint(equalTo: candidateScroll.leadingAnchor),
            candidateRow.trailingAnchor.constraint(equalTo: candidateScroll.trailingAnchor),
            candidateRow.heightAnchor.constraint(equalTo: candidateScroll.heightAnchor),
            candidateScroll.heightAnchor.constraint(equalToConstant: 46),
        ])
        root.addArrangedSubview(candidateScroll)

        // ── タブ ──
        tabRow.axis = .horizontal
        tabRow.spacing = 4
        tabRow.distribution = .fillEqually
        for (i, label) in ["かたち", "よく使う部品", "部首・偏旁"].enumerated() {
            let b = UIButton(type: .system)
            b.setTitle(label, for: .normal)
            b.titleLabel?.font = .systemFont(ofSize: 12)
            b.tag = i
            b.addTarget(self, action: #selector(onTab(_:)), for: .touchUpInside)
            tabRow.addArrangedSubview(b)
        }
        let switchBtn = smallButton("あ", #selector(onSwitchKeyboard))
        let tabWrap = UIStackView(arrangedSubviews: [tabRow, switchBtn])
        tabWrap.axis = .horizontal
        tabWrap.spacing = 4
        root.addArrangedSubview(tabWrap)

        // ── 画数チップ ──
        strokeRow.axis = .horizontal
        strokeRow.spacing = 4
        strokeRow.translatesAutoresizingMaskIntoConstraints = false
        strokeScroll.addSubview(strokeRow)
        strokeScroll.showsHorizontalScrollIndicator = false
        NSLayoutConstraint.activate([
            strokeRow.topAnchor.constraint(equalTo: strokeScroll.topAnchor),
            strokeRow.bottomAnchor.constraint(equalTo: strokeScroll.bottomAnchor),
            strokeRow.leadingAnchor.constraint(equalTo: strokeScroll.leadingAnchor),
            strokeRow.trailingAnchor.constraint(equalTo: strokeScroll.trailingAnchor),
            strokeRow.heightAnchor.constraint(equalTo: strokeScroll.heightAnchor),
            strokeScroll.heightAnchor.constraint(equalToConstant: 28),
        ])
        root.addArrangedSubview(strokeScroll)

        // ── キー ──
        keyArea.axis = .vertical
        keyArea.spacing = 4
        let keyScroll = UIScrollView()
        keyArea.translatesAutoresizingMaskIntoConstraints = false
        keyScroll.addSubview(keyArea)
        NSLayoutConstraint.activate([
            keyArea.topAnchor.constraint(equalTo: keyScroll.topAnchor),
            keyArea.bottomAnchor.constraint(equalTo: keyScroll.bottomAnchor),
            keyArea.leadingAnchor.constraint(equalTo: keyScroll.leadingAnchor),
            keyArea.trailingAnchor.constraint(equalTo: keyScroll.trailingAnchor),
            keyArea.widthAnchor.constraint(equalTo: keyScroll.widthAnchor),
        ])
        root.addArrangedSubview(keyScroll)

        buildStrokeChips()
        rebuildKeys()
    }

    // MARK: - 操作

    @objc private func onTab(_ sender: UIButton) {
        currentTab = Tab(rawValue: sender.tag) ?? .shape
        rebuildKeys()
    }

    @objc private func onBackspace() {
        if composing.isEmpty {
            textDocumentProxy.deleteBackward()
        } else {
            composing.removeLast()   // Character 単位なのでサロゲートペアも1文字
        }
    }

    @objc private func onClear() { composing = "" }

    @objc private func onSwitchKeyboard() { advanceToNextInputMode() }

    private func insert(_ s: String) { composing += s }

    private func commit(_ ch: String) {
        composing = ""
        textDocumentProxy.insertText(ch)
    }

    private func onComposingChanged() {
        composingLabel.text = composing.isEmpty
            ? "かたちと部品を選んでください"
            : Ids.readable(Ids.compile(composing))
        composingLabel.textColor = composing.isEmpty ? colSub : colText
        runSearch()
    }

    // MARK: - 候補

    private func runSearch() {
        let q = composing
        searchSeq += 1
        let seq = searchSeq
        guard !q.isEmpty else {
            candidateRow.arrangedSubviews.forEach { $0.removeFromSuperview() }
            return
        }
        // 10万字の走査は数十〜数百msかかるので UI スレッドを止めない
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            let r = self.engine.search(q, limit: 60)
            DispatchQueue.main.async {
                guard seq == self.searchSeq else { return }  // 古い結果は捨てる
                self.showCandidates(r)
            }
        }
    }

    private func showCandidates(_ r: Engine.Result) {
        candidateRow.arrangedSubviews.forEach { $0.removeFromSuperview() }
        guard !r.hits.isEmpty else {
            let l = UILabel()
            l.text = dict.jaCount == 0 ? "辞書を読み込み中…" : "該当なし"
            l.textColor = colSub
            l.font = .systemFont(ofSize: 13)
            candidateRow.addArrangedSubview(l)
            return
        }
        for h in r.hits {
            let b = UIButton(type: .system)
            b.setTitle(h.ch, for: .normal)
            b.titleLabel?.font = partsFont.withSize(23)
            b.setTitleColor(dict.isExt(h.index) ? colSub : colText, for: .normal)
            style(b, fill: h.exact ? colAccentBg : colCard, stroke: h.exact ? colAccent : colBorder)
            b.widthAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
            b.accessibilityLabel = h.ch
            b.addAction(UIAction { [weak self] _ in self?.commit(h.ch) }, for: .touchUpInside)
            candidateRow.addArrangedSubview(b)
        }
    }

    // MARK: - キーの並び

    private func buildStrokeChips() {
        strokeRow.arrangedSubviews.forEach { $0.removeFromSuperview() }
        let groups = [("common", "よく使う")] + Palettes.difficult.map { ($0.strokes, "\($0.strokes)画") }
        for (key, label) in groups {
            let active = strokeGroup == key
            let b = UIButton(type: .system)
            b.setTitle(label, for: .normal)
            b.titleLabel?.font = .systemFont(ofSize: 11)
            b.setTitleColor(active ? colAccent : colSub, for: .normal)
            b.contentEdgeInsets = UIEdgeInsets(top: 2, left: 8, bottom: 2, right: 8)
            style(b, fill: active ? colAccentBg : .clear, stroke: active ? colAccent : colBorder)
            b.addAction(UIAction { [weak self] _ in
                self?.strokeGroup = key
                self?.buildStrokeChips()
                self?.rebuildKeys()
            }, for: .touchUpInside)
            strokeRow.addArrangedSubview(b)
        }
    }

    private func rebuildKeys() {
        for (i, v) in tabRow.arrangedSubviews.enumerated() {
            guard let b = v as? UIButton else { continue }
            let active = i == currentTab.rawValue
            b.setTitleColor(active ? colAccent : colSub, for: .normal)
            style(b, fill: active ? colCard : .clear, stroke: active ? colBorder : .clear)
        }
        strokeScroll.isHidden = currentTab != .radical
        keyArea.arrangedSubviews.forEach { $0.removeFromSuperview() }

        switch currentTab {
        case .shape:
            // 操作子。IDC文字ではなく日本語ラベルを出す
            let codes = Ids.primaryCodes + Ids.operators.map(\.code).filter { !Ids.primaryCodes.contains($0) }
            grid(codes.map { code in
                let op = Ids.operators.first { $0.code == code }!
                return key(op.label, size: 13) { [weak self] in self?.insert(op.code) }
            }, cols: 4)
        case .common:
            let parts = commonParts()
            if parts.isEmpty {
                let l = UILabel()
                l.text = "辞書を読み込み中…"
                l.textColor = colSub
                keyArea.addArrangedSubview(l)
            } else {
                grid(parts.map { p in key(p, size: 20) { [weak self] in self?.insert(p) } }, cols: 8)
            }
        case .radical:
            let parts: [String] = strokeGroup == "common"
                ? Palettes.radical.map(String.init)
                : (Palettes.difficult.first { $0.strokes == strokeGroup }?.parts.map(String.init) ?? [])
            grid(parts.map { p in key(p, size: 20) { [weak self] in self?.insert(p) } }, cols: 8)
        }
    }

    /// 辞書内で構成要素として多く出てくる部品。日本語の字だけで数える
    private var cachedCommon: [String]?
    private func commonParts() -> [String] {
        if let c = cachedCommon { return c }
        guard dict.jaCount > 0 else { return [] }
        var count: [String: Int] = [:]
        for i in 0..<dict.jaCount {
            let ids = dict.ids(at: i)
            if ids.isEmpty { continue }
            let ch = dict.char(at: i)
            for t in ids {
                if Ids.isIdc(t) || Ids.isPlaceholder(t) { continue }
                let s = String(t)
                if s == ch { continue }
                count[s, default: 0] += 1
            }
        }
        let out = count.sorted { $0.value != $1.value ? $0.value > $1.value : $0.key < $1.key }
            .prefix(120).map(\.key)
        cachedCommon = out
        return out
    }

    // MARK: - 部品

    private func grid(_ keys: [UIView], cols: Int) {
        var row: UIStackView?
        for (i, k) in keys.enumerated() {
            if i % cols == 0 {
                let r = UIStackView()
                r.axis = .horizontal
                r.spacing = 4
                r.distribution = .fillEqually
                keyArea.addArrangedSubview(r)
                row = r
            }
            row?.addArrangedSubview(k)
        }
        // 最終行が埋まらないぶんは空ビューで詰める(幅が伸びるのを防ぐ)
        if let r = row {
            let missing = (cols - keys.count % cols) % cols
            for _ in 0..<missing { r.addArrangedSubview(UIView()) }
        }
    }

    private func key(_ label: String, size: CGFloat, _ onTap: @escaping () -> Void) -> UIView {
        let b = UIButton(type: .system)
        b.setTitle(label, for: .normal)
        b.titleLabel?.font = size >= 18 ? partsFont.withSize(size) : .systemFont(ofSize: size)
        b.setTitleColor(colText, for: .normal)
        style(b, fill: colCard, stroke: colBorder)
        b.heightAnchor.constraint(equalToConstant: 42).isActive = true
        b.addAction(UIAction { _ in onTap() }, for: .touchUpInside)
        return b
    }

    private func smallButton(_ label: String, _ action: Selector) -> UIButton {
        let b = UIButton(type: .system)
        b.setTitle(label, for: .normal)
        b.titleLabel?.font = .systemFont(ofSize: 13)
        b.setTitleColor(colSub, for: .normal)
        b.contentEdgeInsets = UIEdgeInsets(top: 6, left: 12, bottom: 6, right: 12)
        style(b, fill: colCard, stroke: colBorder)
        b.addTarget(self, action: action, for: .touchUpInside)
        return b
    }

    private func style(_ v: UIView, fill: UIColor, stroke: UIColor) {
        v.backgroundColor = fill
        v.layer.borderColor = stroke.cgColor
        v.layer.borderWidth = 1
        v.layer.cornerRadius = 8
    }
}
