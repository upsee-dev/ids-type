import UIKit

/// 漢字カタチ入力の iOS キーボード拡張。
///
/// 設定 > 一般 > キーボード > キーボード に「漢字カタチ入力」として追加される。
/// ネットワークを使わない設計なので「フルアクセス」は要求しない
/// (審査でもプライバシー訴求でも有利。docs/technical-roadmap.md 参照)。
///
/// 拡張のメモリ上限は約60MB。RN は載せず、UI もエンジンもここで完結させる。
/// UIInputViewAudioFeedback に準拠して enableInputClicksWhenVisible を true に
/// しないと、playInputClick() を呼んでもキー音は鳴らない。
final class KeyboardViewController: UIInputViewController, UIInputViewAudioFeedback {

    var enableInputClicksWhenVisible: Bool { true }


    private let dict = Dict()
    private lazy var engine = Engine(dict: dict)

    /// 入力中のかたちコード(例: "LR日")
    private var composing = "" {
        didSet { onComposingChanged() }
    }

    /// 部品パレットの種類。**かたち(操作子)はタブに含めない**。
    /// 「かたち→部品→部品」と続けて打つので、別タブにあると1字ごとに往復させられる。
    /// かたちは候補の下に常時出しておき、タブは部品の出し分けだけに使う。
    private enum Tab: Int { case common, radical }
    private var currentTab: Tab = .common
    private var strokeGroup = "common"
    private var searchSeq = 0
    /// ⌫長押しの連射タイマー
    private var repeatTimer: Timer?

    private static func rgb(_ hex: UInt32) -> UIColor {
        UIColor(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: 1,
        )
    }

    /// 着せ替え。テーマの定義は core/data/themes.ts の1か所(Themes.swift は生成物)。
    /// 選んだテーマは UserDefaults に覚える(既定 "auto" = 端末のライト/ダークに追従)。
    /// 🎨キーで切り替え。
    private var themeKey: String {
        UserDefaults.standard.string(forKey: "katachi.theme") ?? "auto"
    }

    /// テーマの1色。おまかせのときは OS のダーク切り替えに自動で追従する
    private func themeColor(_ pick: (Themes.Palette) -> UInt32) -> UIColor {
        if let p = Themes.palette(themeKey) { return Self.rgb(pick(p)) }
        let light = pick(Themes.palette(Themes.autoLight) ?? Themes.all[0])
        let dark = pick(Themes.palette(Themes.autoDark) ?? Themes.all[0])
        return UIColor { $0.userInterfaceStyle == .dark ? Self.rgb(dark) : Self.rgb(light) }
    }

    // 色は部品を作るときに焼き込まれる。テーマ変更時は applyTheme が作り直す
    private var colBg: UIColor { themeColor { $0.bg } }
    private var colCard: UIColor { themeColor { $0.card } }
    private var colBorder: UIColor { themeColor { $0.border } }
    private var colText: UIColor { themeColor { $0.text } }
    private var colSub: UIColor { themeColor { $0.sub } }
    private var colAccent: UIColor { themeColor { $0.accent } }
    private var colAccentBg: UIColor { themeColor { $0.accentBg } }

    /// テーマ変更時に塗り直す常設ボタン(⌫・消・🎨・あ)。キーや候補と違って
    /// 作り直されないので、ここで持っておいて applyTheme が直接塗り直す
    private var chromeButtons: [UIButton] = []

    @objc private func onCycleTheme() {
        let order = ["auto"] + Themes.all.map(\.key)
        let next = order[((order.firstIndex(of: themeKey) ?? 0) + 1) % order.count]
        UserDefaults.standard.set(next, forKey: "katachi.theme")
        applyTheme()
    }

    private func applyTheme() {
        view.backgroundColor = colBg
        for b in chromeButtons {
            b.setTitleColor(colSub, for: .normal)
            style(b, fill: colCard, stroke: colBorder)
        }
        buildOperators()
        buildStrokeChips()
        rebuildKeys()
        onComposingChanged() // ラベルの色を直し、候補も引き直す
    }

    private let composingLabel = UILabel()
    private let candidateScroll = UIScrollView()
    private let candidateRow = UIStackView()
    private let tabRow = UIStackView()
    /// かたち(操作子)の行。タブに関係なく常に出す
    private let opScroll = UIScrollView()
    private let opRow = UIStackView()
    private let strokeScroll = UIScrollView()
    private let strokeRow = UIStackView()
    private let keyArea = UIStackView()

    /// 拡張漢字用の同梱フォント(KatachiExt1/2)。端末の標準フォントは拡張B以降を
    /// 持っておらず、これが無いと候補も部品も ☒ で埋まって「見て選ぶ」画面が
    /// 成立しない。7.5万字は TrueType の65,535グリフ上限に収まらないので2つに
    /// 分かれており、どちらで描くかは ExtFonts.fontIndex が決める(自動生成)。
    /// Info.plist の UIAppFonts に載せていないと UIFont(name:) が nil になる。
    private lazy var extFont1 = UIFont(name: "KatachiExt1", size: 20)
    private lazy var extFont2 = UIFont(name: "KatachiExt2", size: 20)

    /// 1字を描くフォント。同梱フォントに無い字は OS の標準フォントに任せる
    private func font(for s: String, size: CGFloat) -> UIFont {
        guard let scalar = s.unicodeScalars.first else { return .systemFont(ofSize: size) }
        var base: UIFont?
        switch ExtFonts.fontIndex(scalar.value) {
        case 1: base = extFont1
        case 2: base = extFont2
        default: base = nil
        }
        return base?.withSize(size) ?? .systemFont(ofSize: size)
    }

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
        // 入力中の表示は1字ずつ分けられないので、部品を多く含む1枚目を当てる。
        // このフォントに無い字(かな・常用漢字)は OS が標準フォントで描く
        composingLabel.font = extFont1?.withSize(17) ?? .systemFont(ofSize: 17)
        composingLabel.text = ""
        top.addArrangedSubview(composingLabel)
        let backspace = smallButton("⌫", #selector(onBackspace))
        backspace.addGestureRecognizer(
            UILongPressGestureRecognizer(target: self, action: #selector(onBackspaceLongPress(_:))),
        )
        top.addArrangedSubview(backspace)
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

        // ── かたち(操作子) ──
        // タブの外に出して常時表示にする。「かたち→部品→部品」と続けて打つのに
        // タブ往復が要らなくなる
        opRow.axis = .horizontal
        opRow.spacing = 4
        opRow.translatesAutoresizingMaskIntoConstraints = false
        opScroll.addSubview(opRow)
        opScroll.showsHorizontalScrollIndicator = false
        NSLayoutConstraint.activate([
            opRow.topAnchor.constraint(equalTo: opScroll.topAnchor),
            opRow.bottomAnchor.constraint(equalTo: opScroll.bottomAnchor),
            opRow.leadingAnchor.constraint(equalTo: opScroll.leadingAnchor),
            opRow.trailingAnchor.constraint(equalTo: opScroll.trailingAnchor),
            opRow.heightAnchor.constraint(equalTo: opScroll.heightAnchor),
            opScroll.heightAnchor.constraint(equalToConstant: 44),
        ])
        root.addArrangedSubview(opScroll)
        buildOperators()

        // ── タブ ──
        tabRow.axis = .horizontal
        tabRow.spacing = 4
        tabRow.distribution = .fillEqually
        for (i, label) in ["よく使う部品", "部首・偏旁"].enumerated() {
            let b = UIButton(type: .system)
            b.setTitle(label, for: .normal)
            b.titleLabel?.font = .systemFont(ofSize: 12)
            b.tag = i
            b.addTarget(self, action: #selector(onTab(_:)), for: .touchUpInside)
            tabRow.addArrangedSubview(b)
        }
        let themeBtn = smallButton("🎨", #selector(onCycleTheme))
        let switchBtn = smallButton("あ", #selector(onSwitchKeyboard(_:event:)))
        // handleInputModeList は event が要るので、この1つだけ event 付きで受ける
        switchBtn.removeTarget(self, action: #selector(onSwitchKeyboard(_:event:)), for: .touchUpInside)
        switchBtn.addTarget(
            self, action: #selector(onSwitchKeyboard(_:event:)), for: .allTouchEvents,
        )
        let tabWrap = UIStackView(arrangedSubviews: [tabRow, themeBtn, switchBtn])
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
        currentTab = Tab(rawValue: sender.tag) ?? .common
        rebuildKeys()
    }

    @objc private func onBackspace() { deleteOne() }

    private func deleteOne() {
        if composing.isEmpty {
            textDocumentProxy.deleteBackward()
        } else {
            composing.removeLast()   // Character 単位なのでサロゲートペアも1文字
        }
    }

    /// ⌫の長押し。1文字ずつタップさせると打ち直しが遅すぎるので、標準の
    /// キーボードと同じく押しっぱなしで消せるようにする
    @objc private func onBackspaceLongPress(_ g: UILongPressGestureRecognizer) {
        switch g.state {
        case .began:
            repeatTimer?.invalidate()
            repeatTimer = Timer.scheduledTimer(withTimeInterval: 0.06, repeats: true) {
                [weak self] _ in
                self?.tapFeedback()
                self?.deleteOne()
            }
        case .ended, .cancelled, .failed:
            repeatTimer?.invalidate()
            repeatTimer = nil
        default:
            break
        }
    }

    /// 打鍵フィードバック。指が触れた瞬間に返したいので、呼ぶのは
    /// .touchDown(離したときの .touchUpInside ではない)。
    ///
    /// 音は playInputClick が端末の設定を見て鳴らす(フルアクセス不要)。
    /// 触覚(UIImpactFeedbackGenerator)はキーボード拡張ではフルアクセスを
    /// 許可しないと動かない。このアプリは通信もせず全部端末内で完結するので
    /// フルアクセスは要求しない方針(docs/technical-roadmap.md)。よって音だけ。
    private func tapFeedback() {
        UIDevice.current.playInputClick()
    }

    @objc private func onClear() { composing = "" }

    /// 「あ」キー。かな入力など別のキーボードへ移りたいときに押す。
    ///
    /// advanceToNextInputMode() だと有効なキーボードを順送りするだけなので、
    /// 絵文字に飛んでしまう。どれに移るかは本人に選ばせる
    /// (handleInputModeList は地球儀キーと同じ選択リストを出す)。
    ///
    /// 移る前に未確定の「かたちコード」を消しておく。残したままだと相手の
    /// テキスト欄に LR日 のような文字列が居座り、カーソルの位置も分からなくなる。
    /// .allTouchEvents で受けるので何度も呼ばれる。空にする処理は1回で足りる
    @objc private func onSwitchKeyboard(_ sender: UIButton, event: UIEvent) {
        if !composing.isEmpty { composing = "" }
        handleInputModeList(from: sender, with: event)
    }

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
            b.titleLabel?.font = font(for: h.ch, size: 23)
            b.setTitleColor(dict.isExt(h.index) ? colSub : colText, for: .normal)
            style(b, fill: h.exact ? colAccentBg : colCard, stroke: h.exact ? colAccent : colBorder)
            b.widthAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
            b.accessibilityLabel = h.ch
            b.addAction(UIAction { [weak self] _ in self?.tapFeedback() }, for: .touchDown)
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
            b.addAction(UIAction { [weak self] _ in self?.tapFeedback() }, for: .touchDown)
            b.addAction(UIAction { [weak self] _ in
                self?.strokeGroup = key
                self?.buildStrokeChips()
                self?.rebuildKeys()
            }, for: .touchUpInside)
            strokeRow.addArrangedSubview(b)
        }
    }

    /// かたちの並び。よく使う順を先頭にして横スクロールで全部出す。
    /// IDC文字(⿰⿱⿴…)は端末のフォントで豆腐になるので日本語ラベルで描く。
    private func buildOperators() {
        opRow.arrangedSubviews.forEach { $0.removeFromSuperview() }
        let codes = Ids.primaryCodes
            + Ids.operators.map(\.code).filter { !Ids.primaryCodes.contains($0) }
        for code in codes {
            guard let op = Ids.operators.first(where: { $0.code == code }) else { continue }
            let icon = OperatorIcons.all[code]

            // アプリ版と同じ配置図を矩形で描く。図が無い操作子(⇄ ↻ −)は記号を出す
            let label = UILabel()
            label.text = op.label
            label.font = .systemFont(ofSize: 9)
            label.textColor = colSub
            label.textAlignment = .center

            let stack = UIStackView()
            stack.axis = .vertical
            stack.alignment = .center
            stack.spacing = 1
            stack.isUserInteractionEnabled = false
            if icon?.rects != nil {
                stack.addArrangedSubview(OperatorIconView(icon: icon!, color: colText, size: 18))
            } else if let sym = icon?.symbol {
                let s = UILabel()
                s.text = sym
                s.font = .systemFont(ofSize: 15)
                s.textColor = colText
                stack.addArrangedSubview(s)
            }
            stack.addArrangedSubview(label)

            let b = UIButton(type: .system)
            style(b, fill: colCard, stroke: colBorder)
            b.addAction(UIAction { [weak self] _ in self?.tapFeedback() }, for: .touchDown)
            b.addAction(
                UIAction { [weak self] _ in self?.insert(op.code) }, for: .touchUpInside,
            )
            stack.translatesAutoresizingMaskIntoConstraints = false
            b.addSubview(stack)
            NSLayoutConstraint.activate([
                stack.centerXAnchor.constraint(equalTo: b.centerXAnchor),
                stack.centerYAnchor.constraint(equalTo: b.centerYAnchor),
                b.widthAnchor.constraint(greaterThanOrEqualTo: stack.widthAnchor, constant: 16),
                b.widthAnchor.constraint(greaterThanOrEqualToConstant: 46),
            ])
            opRow.addArrangedSubview(b)
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
        b.titleLabel?.font = size >= 18 ? font(for: label, size: size) : .systemFont(ofSize: size)
        b.setTitleColor(colText, for: .normal)
        style(b, fill: colCard, stroke: colBorder)
        b.heightAnchor.constraint(equalToConstant: 42).isActive = true
        // 音は触れた瞬間、実際の入力は離したとき(押し間違いを指をずらして取り消せる)
        b.addAction(UIAction { [weak self] _ in self?.tapFeedback() }, for: .touchDown)
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
        b.addAction(UIAction { [weak self] _ in self?.tapFeedback() }, for: .touchDown)
        b.addTarget(self, action: action, for: .touchUpInside)
        chromeButtons.append(b) // テーマ変更時に applyTheme が塗り直す
        return b
    }

    private func style(_ v: UIView, fill: UIColor, stroke: UIColor) {
        v.backgroundColor = fill
        v.layer.borderColor = stroke.cgColor
        v.layer.borderWidth = 1
        v.layer.cornerRadius = 8
    }
}
