import UIKit

/// A separate OS input method. No RN runtime, networking, contacts access or telemetry.
final class JapaneseKeyboardViewController: UIInputViewController, FlickKanaViewDelegate, UIInputViewAudioFeedback {
    var enableInputClicksWhenVisible: Bool { true }
    private let store = SharedStore()
    private let lexicon = JapaneseLexicon()
    private let queue = DispatchQueue(label: "katachi.japanese.search", qos: .userInitiated)
    private var reading = ""
    private var sequence = 0
    private var page = 0
    private var total = 0
    private var order: [String] = []
    private var languages: [String] = []
    private var mode = "kana"
    private var caps = false
    private var root = UIStackView()
    private var content = UIStackView()
    private var candidates = UIStackView()
    private var composingLabel = UILabel()
    private var countLabel = UILabel()
    private var previous: UIButton?, nextPageButton: UIButton?
    private weak var flick: FlickKanaView?
    private var ownEdit = false
    private lazy var ext1 = UIFont(name: "KatachiExt1",size:22)
    private lazy var ext2 = UIFont(name: "KatachiExt2",size:22)
    override func viewDidLoad() {
        super.viewDidLoad()
        order = store.japaneseOrder
        languages = store.foreignReadings
        view.backgroundColor = .systemBackground
        root.axis = .vertical; root.spacing = 4; root.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(root)
        NSLayoutConstraint.activate([
            root.leadingAnchor.constraint(equalTo:view.leadingAnchor,constant:4), root.trailingAnchor.constraint(equalTo:view.trailingAnchor,constant:-4),
            root.topAnchor.constraint(equalTo:view.topAnchor,constant:4), root.bottomAnchor.constraint(equalTo:view.safeAreaLayoutGuide.bottomAnchor,constant:-4),
            view.heightAnchor.constraint(greaterThanOrEqualToConstant:420),
        ])
        let globe = button("🌐") {}
        globe.accessibilityLabel = "入力方式を切り替え"
        globe.addTarget(self,action:#selector(switchKeyboard(_:event:)),for:.allTouchEvents)
        let toolbar = row([globe,button("かな") { [weak self] in self?.mode = "kana"; self?.buildContent() },button("ABC/123") { [weak self] in self?.mode = "ascii"; self?.buildContent() },button("部首索引") { [weak self] in self?.mode = "radical"; self?.buildContent() },button("設定") { [weak self] in self?.mode = "settings"; self?.buildContent() }])
        toolbar.heightAnchor.constraint(equalToConstant:36).isActive = true; root.addArrangedSubview(toolbar)
        composingLabel.font = .systemFont(ofSize:17); composingLabel.numberOfLines = 1; composingLabel.adjustsFontSizeToFitWidth = true
        composingLabel.heightAnchor.constraint(equalToConstant:28).isActive = true; root.addArrangedSubview(composingLabel)
        content.axis = .vertical; content.spacing = 4; root.addArrangedSubview(content)
        buildContent()
    }
    override func viewWillAppear(_ animated: Bool) { super.viewWillAppear(animated); order = store.japaneseOrder; languages = store.foreignReadings; if mode == "settings" { buildContent() } else { refresh() } }
    override func viewWillDisappear(_ animated: Bool) { super.viewWillDisappear(animated); sequence += 1; reading = ""; flick?.resetToggle() }
    override func textWillChange(_ textInput: UITextInput?) {
        // Moving the host cursor must not send a stale composition into a different field.
        if !ownEdit && !reading.isEmpty { reading = ""; flick?.resetToggle(); refresh() }
    }
    @objc private func switchKeyboard(_ sender: UIButton, event: UIEvent) { handleInputModeList(from:sender,with:event) }
    private func button(_ text: String, _ action: @escaping () -> Void) -> UIButton {
        let b = UIButton(type:.system); b.setTitle(text,for:.normal); b.titleLabel?.font = .systemFont(ofSize:12)
        b.titleLabel?.numberOfLines = 2; b.titleLabel?.textAlignment = .center
        b.backgroundColor = .secondarySystemBackground; b.layer.cornerRadius = 5
        b.addAction(UIAction { _ in action() },for:.touchUpInside); return b
    }
    private func row(_ views: [UIView]) -> UIStackView {
        let s = UIStackView(arrangedSubviews:views); s.distribution = .fillEqually; s.spacing = 4; return s
    }
    private func font(_ ch: String, _ size: CGFloat) -> UIFont {
        let n = ch.unicodeScalars.first.map { ExtFonts.fontIndex($0.value) } ?? 0
        return (n == 1 ? ext1 : n == 2 ? ext2 : nil)?.withSize(size) ?? .systemFont(ofSize:size)
    }
    private func send(_ text: String) { ownEdit = true; textDocumentProxy.insertText(text); ownEdit = false }
    private func literal(_ text: String) {
        if !reading.isEmpty { send(reading); reading = "" }
        if !text.isEmpty { send(text) }; flick?.resetToggle(); refresh()
    }
    private func buildContent() {
        sequence += 1
        content.arrangedSubviews.forEach { $0.removeFromSuperview() }; flick = nil
        if mode == "settings" { buildSettings(); return }
        if mode == "radical" {
            content.addArrangedSubview(RadicalIndexView(commit: { [weak self] ch in self?.literal(ch) }, font: { [weak self] ch,size in self?.font(ch,size) ?? .systemFont(ofSize:size) })); return
        }
        candidates = UIStackView(); candidates.axis = .vertical; candidates.spacing = 3; candidates.distribution = .fillEqually
        candidates.heightAnchor.constraint(equalToConstant:92).isActive = true; content.addArrangedSubview(candidates)
        previous = button("‹ 前") { [weak self] in guard let self else { return }; self.page -= 1; self.refresh(resetPage:false) }
        nextPageButton = button("次 ›") { [weak self] in guard let self else { return }; self.page += 1; self.refresh(resetPage:false) }
        countLabel = UILabel(); countLabel.font = .systemFont(ofSize:11); countLabel.textAlignment = .center
        let nav = row([previous!,countLabel,nextPageButton!]); nav.heightAnchor.constraint(equalToConstant:28).isActive = true; content.addArrangedSubview(nav)
        if mode == "ascii" {
            let pad = UIStackView(); pad.axis = .vertical; pad.spacing = 3; pad.distribution = .fillEqually
            for raw in ["1234567890","qwertyuiop","asdfghjkl","zxcvbnm","⇧@.-_/:!?⌫"] {
                let chars = caps ? raw.uppercased() : raw
                pad.addArrangedSubview(row(chars.map { ch in button(String(ch)) { [weak self] in
                    if ch == "⌫" { self?.flickBackspace() }
                    else if ch == "⇧" { self?.caps.toggle(); self?.buildContent() }
                    else { self?.literal(String(ch)) }
                } }))
            }
            content.addArrangedSubview(pad)
        } else {
            let pad = FlickKanaView(text:.label,sub:.secondaryLabel,card:.secondarySystemBackground,border:.separator,accentBg:.tertiarySystemFill,layout:"flick")
            pad.delegate = self; flick = pad; content.addArrangedSubview(pad)
        }
        let actions = row([button("、") { [weak self] in self?.literal("、") },button("。") { [weak self] in self?.literal("。") },button("空白") { [weak self] in self?.literal(" ") },button("かな確定") { [weak self] in self?.literal("") },button("改行") { [weak self] in self?.literal("\n") }])
        actions.heightAnchor.constraint(equalToConstant:36).isActive = true; content.addArrangedSubview(actions)
        refresh()
    }
    private func buildSettings() {
        let scroll = UIScrollView(); let stack = UIStackView(); stack.axis = .vertical; stack.spacing = 2; stack.translatesAutoresizingMaskIntoConstraints = false
        scroll.addSubview(stack); content.addArrangedSubview(scroll)
        NSLayoutConstraint.activate([stack.topAnchor.constraint(equalTo:scroll.contentLayoutGuide.topAnchor),stack.bottomAnchor.constraint(equalTo:scroll.contentLayoutGuide.bottomAnchor),stack.leadingAnchor.constraint(equalTo:scroll.contentLayoutGuide.leadingAnchor),stack.trailingAnchor.constraint(equalTo:scroll.contentLayoutGuide.trailingAnchor),stack.widthAnchor.constraint(equalTo:scroll.frameLayoutGuide.widthAnchor)])
        let heading = UILabel(); heading.text = "外国語の読み（初期設定はすべてオフ）"; heading.font = .boldSystemFont(ofSize:13); stack.addArrangedSubview(heading)
        for (i,id) in JapaneseLexicon.languageIDs.enumerated() {
            let label = UILabel(); label.text = JapaneseLexicon.languageLabels[i]; label.font = .systemFont(ofSize:13)
            let toggle = UISwitch(); toggle.isOn = languages.contains(id); toggle.accessibilityLabel = "\(label.text!)の読みで入力"
            toggle.addAction(UIAction { [weak self, weak toggle] _ in
                guard let self, let toggle else { return }
                self.languages = JapaneseLexicon.languages(toggle.isOn ? self.languages + [id] : self.languages.filter { $0 != id })
                self.store.saveForeignReadings(self.languages)
            },for:.valueChanged)
            let line = UIStackView(arrangedSubviews:[label,toggle]); line.alignment = .center; line.heightAnchor.constraint(equalToConstant:40).isActive = true; stack.addArrangedSubview(line)
        }
        let explanation = UILabel(); explanation.text = "かなで入力。カナは発音の目安で声調は省略。候補に言語名と元の読みを表示します。"; explanation.numberOfLines = 0; explanation.font = .systemFont(ofSize:11); stack.addArrangedSubview(explanation)
        let priorityHeading = UILabel(); priorityHeading.text = "候補の優先順位"; priorityHeading.font = .boldSystemFont(ofSize:13); stack.addArrangedSubview(priorityHeading)
        for (i,id) in order.enumerated() {
            let label = UILabel(); label.text = "\(i+1). \(JapaneseLexicon.labels[JapaneseLexicon.ids.firstIndex(of:id)!])"; label.font = .systemFont(ofSize:13)
            let line = UIStackView(); line.addArrangedSubview(label)
            for step in [-1,1] {
                let b = button(step < 0 ? "↑" : "↓") { [weak self] in
                    guard let self, self.order.indices.contains(i+step) else { return }
                    self.order.swapAt(i,i+step); self.store.saveJapaneseOrder(self.order); self.buildContent()
                }
                b.isEnabled = order.indices.contains(i+step); b.accessibilityLabel = "\(label.text!)を\(step < 0 ? "上" : "下")へ"
                b.widthAnchor.constraint(equalToConstant:48).isActive = true; line.addArrangedSubview(b)
            }
            line.heightAnchor.constraint(equalToConstant:36).isActive = true; stack.addArrangedSubview(line)
        }
        let note = UILabel(); note.text = "上の分類を優先。出典・ライセンスは本アプリの設定に掲載。"; note.numberOfLines = 0; note.font = .systemFont(ofSize:11); stack.addArrangedSubview(note)
    }
    private func refresh(resetPage: Bool = true) {
        if resetPage { page = 0 }; sequence += 1
        composingLabel.text = reading.isEmpty ? "日本語拡張フリック" : reading
        guard mode == "kana" || mode == "ascii" else { return }
        candidates.arrangedSubviews.forEach { $0.removeFromSuperview() }
        previous?.isEnabled = false; nextPageButton?.isEnabled = false
        countLabel.text = reading.isEmpty ? "読みを入力" : "検索中…"
        let token = sequence, q = reading, p = page, priority = order, enabled = languages
        queue.async { [weak self] in
            guard let self else { return }
            self.lexicon.search(q,order:priority,languages:enabled)
            let total = self.lexicon.count, items = self.lexicon.page(offset:p*8,limit:8)
            DispatchQueue.main.async { [weak self] in
                guard let self, token == self.sequence else { return }
                self.total = total; self.countLabel.text = total == 0 ? "読みを入力" : "\(total)件 · \(p+1)/\((total+7)/8)"
                self.previous?.isEnabled = p > 0; self.nextPageButton?.isEnabled = (p+1)*8 < total
                for r in 0..<2 {
                    var cells: [UIView] = []
                    for c in 0..<4 {
                        let i = r*4+c
                        guard i < items.count else { cells.append(UIView()); continue }
                        let item = items[i]
                        let b = self.button(item.text+"\n"+JapaneseLexicon.label(item.mask,priority)) { [weak self] in
                            guard let self, self.reading == q else { return }
                            self.send(item.text); self.reading = String(q.dropFirst(item.consumed)); self.flick?.resetToggle(); self.refresh()
                        }
                        let attr = NSMutableAttributedString(string:item.text,attributes:[.font:UIFont.systemFont(ofSize:17)])
                        var position = 0
                        for scalar in item.text.unicodeScalars { let ch = String(scalar); let size = ch.utf16.count; attr.addAttribute(.font,value:self.font(ch,17),range:NSRange(location:position,length:size)); position += size }
                        let note = item.language.isEmpty ? (item.kind == 2 ? "先頭\(item.consumed)字" : JapaneseLexicon.shortLabel(item.mask,priority)) : JapaneseLexicon.languageLabel(item.language)+" "+item.original
                        attr.append(NSAttributedString(string:"\n"+note,attributes:[.font:UIFont.systemFont(ofSize:9)]))
                        b.setAttributedTitle(attr,for:.normal); b.accessibilityLabel = item.text+", "+item.reading+", "+(item.language.isEmpty ? JapaneseLexicon.label(item.mask,priority) : note)
                        b.titleLabel?.adjustsFontSizeToFitWidth = true; cells.append(b)
                    }
                    self.candidates.addArrangedSubview(self.row(cells))
                }
            }
        }
    }
    func flickAppend(_ ch: String) { reading += ch; refresh() }
    func flickReplaceLast(_ ch: String) { if !reading.isEmpty { reading.removeLast() }; reading += ch; refresh() }
    func flickCycleLast() { if let last = reading.last, let next = Kana.cycle(last) { reading.removeLast(); reading += next; refresh() } }
    func flickBackspace() { if !reading.isEmpty { reading.removeLast(); refresh() } else { ownEdit = true; textDocumentProxy.deleteBackward(); ownEdit = false } }
    func flickPreview(_ ch: String?) { composingLabel.text = reading + (ch ?? "") }
    func flickTapFeedback() { UIDevice.current.playInputClick() }
}
