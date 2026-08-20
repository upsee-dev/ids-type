import UIKit

/// 漢字カタチ入力の iOS キーボード拡張。
///
/// 設定 > 一般 > キーボード > キーボード に「漢字カタチ入力」として追加される。
/// 通信は一切しない。「フルアクセス」は履歴・お気に入りをアプリと共有するため
/// (App Group を触る条件)だけにお願いしていて、許可されなくても入力はできる
/// (SharedStore.swift / docs/technical-roadmap.md 参照)。
///
/// 拡張のメモリ上限は約60MB。RN は載せず、UI もエンジンもここで完結させる。
/// UIInputViewAudioFeedback に準拠して enableInputClicksWhenVisible を true に
/// しないと、playInputClick() を呼んでもキー音は鳴らない。
///
///   [ 履歴 ★ 着せ替え                     🌐 ]  ← 道具の帯(打つ場所ではない)
///   [ (棚) 使った字 / お気に入りの字          ]
///   [ 入力中のかたち ]                [⌫] [消]
///   [ 候補 ] [ かたち ]
///   [ 部首・偏旁 |          読み | 手書き ]
///   [ 部品の並び / 読みのフリック面            ]
final class KeyboardViewController: UIInputViewController, UIInputViewAudioFeedback,
    FlickKanaViewDelegate, HandwritingViewDelegate
{

    var enableInputClicksWhenVisible: Bool { true }


    private let dict = Dict()
    private lazy var engine = Engine(dict: dict)

    /// 手書き照合。パターン(1.2MB)は手書きの面を初めて開いたときに読む
    /// (使わない人にこの読み込みとメモリを払わせない)
    private let handwriting = Handwriting()

    /// 履歴・お気に入り(アプリと App Group で共有)
    private let store = SharedStore()

    /// 入力中のかたちコード(例: "LR日")。相手の欄には触らず、ここだけで持つ
    private var composing = "" {
        didSet { onComposingChanged() }
    }

    /// 送る欄。候補から選んだ字がここに溜まり、「送る」で初めて相手の欄へ入る。
    /// 1字だけでなく続けて選べるのは、難しい字が続く語(人名・地名)を
    /// まとめて組めるようにするため
    private var outbox = "" {
        didSet { onOutboxChanged() }
    }

    /// 部品パレットの種類。**かたち(操作子)はタブに含めない**。
    /// 「かたち→部品→部品」と続けて打つので、別タブにあると1字ごとに往復させられる。
    /// かたちは候補の下に常時出しておき、タブは部品の出し分けだけに使う。
    ///
    /// 読みのかな面もタブにしない。タブにするとかたちの行も候補も引っ込んでしまい、
    /// 部品を1つ読みから出したいだけなのに面ごと往復させられる。
    /// かな面は**パレットと入れ替える出し入れ**にしてある

    /// かなの面を出しているか
    private var kanaOpen = false
    /// 手書きの面を出しているか。かなの面とは場所を取り合うので同時には出さない
    private var hwOpen = false
    private var strokeGroup = "common"
    private var searchSeq = 0
    private var readingSeq = 0
    private var hwSeq = 0
    /// 手書きパターンを読み込み中か(二重に走らせないため。触るのはメインだけ)
    private var hwLoading = false
    /// ⌫長押しの連射タイマー
    private var repeatTimer: Timer?

    /// 棚(履歴・お気に入り)の開き方
    private enum Shelf { case none, history, favorites }
    private var shelf: Shelf = .none

    /// 読みでさがす面の状態。読みそのものと、指を置いている間の仮の1字
    private var reading = ""
    private var readingPreview: String?
    private weak var readingLabel: UILabel?
    private weak var readingHits: UIStackView?
    private weak var flick: FlickKanaView?

    /// 手書きの面の部品
    private weak var hwHits: UIStackView?
    private weak var hwPad: HandwritingView?
    private weak var hwCount: UILabel?

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

    /// テーマ変更時に塗り直す常設ボタン(⌫・消・道具の帯)。キーや候補と違って
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
        for b in toolButtons {
            b.tintColor = colSub
            style(b, fill: .clear, stroke: colBorder)
        }
        toolSeparator.backgroundColor = colBorder
        shelfScroll.backgroundColor = colCard
        buildOperators()
        buildStrokeChips()
        rebuildKeys()
        refreshShelf()
        onComposingChanged() // ラベルの色を直し、候補も引き直す
    }

    private let composingLabel = UILabel()
    /// 送る欄と、その中身を相手の欄へ入れるボタン。
    /// 行ごと畳めるようにしてある(空のあいだは案内文しか出ないので場所がもったいない)
    private let outboxLabel = UILabel()
    private weak var outboxRow: UIStackView?
    private var sendButton: UIButton!
    /// 元の入力方法へ帰るボタン。送った直後だけ色を上げて次の一手を示す
    private var backButton: UIButton!
    /// かなの面・手書きの面の出し入れ
    private var kanaToggle: UIButton!
    private var hwToggle: UIButton!
    /// 他のキーボードから戻ってきたときの断り書き
    private let resumedNote = UILabel()
    private let candidateScroll = UIScrollView()
    private let candidateRow = UIStackView()

    /// いま何ページめの候補を出しているか(0始まり)。
    /// 候補は1ページ candPageSize 件ずつだが、めくれば全件たどれる
    private var candPage = 0
    private static let candPageSize = 60
    private let tabRow = UIStackView()
    /// 道具の帯。打つ場所ではないので線で区切って上端にまとめる
    private let toolSeparator = UIView()
    private let shelfScroll = UIScrollView()
    private let shelfRow = UIStackView()
    private var historyButton: UIButton?
    private var favoritesButton: UIButton?
    /// 道具の帯のボタン。塗りを持たないので chromeButtons とは別に塗り直す
    private var toolButtons: [UIButton] = []
    /// キーボードの最低の高さ。読みの面(フリック4段)のときだけ伸ばす
    private var minHeight: NSLayoutConstraint!
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

    /// キーボードが出るたび。アプリで縦幅の設定を変えていることがあるので当て直す
    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        applyHeight()
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = colBg
        buildLayout()
        refreshShelf() // 棚は閉じた状態。道具の帯のボタンの色をここで当てる
        restorePending() // 他のキーボードから戻ってきたなら続きを出す

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
        root.spacing = 3
        root.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(root)
        // 高さは面ごとに変える(applyHeight)。拡張は自分で高さを決められるので、
        // 「入る高さに中身を詰める」のではなく「要る高さを取る」ほうにしてある
        minHeight = view.heightAnchor.constraint(equalToConstant: 320)
        minHeight.priority = .required - 1 // 端末が別の高さを強いてきたら譲る
        NSLayoutConstraint.activate([
            root.topAnchor.constraint(equalTo: view.topAnchor, constant: 4),
            root.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 6),
            root.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -6),
            root.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -4),
            minHeight,
        ])

        // ── 道具の帯 ──
        // 履歴・お気に入り・着せ替えは「打つための場所」ではないので、いちばん上に
        // まとめ、下に線を引いて打鍵の面から切り離す。入力欄のすぐ隣に置くと、
        // 打つつもりで触ってしまう
        root.addArrangedSubview(buildToolRow())
        toolSeparator.backgroundColor = colBorder
        toolSeparator.heightAnchor.constraint(equalToConstant: 1).isActive = true
        root.addArrangedSubview(toolSeparator)

        // ── 棚(履歴・お気に入り) ──
        shelfRow.axis = .horizontal
        shelfRow.spacing = 4
        shelfRow.translatesAutoresizingMaskIntoConstraints = false
        shelfScroll.addSubview(shelfRow)
        shelfScroll.showsHorizontalScrollIndicator = false
        shelfScroll.backgroundColor = colCard
        shelfScroll.isHidden = true
        NSLayoutConstraint.activate([
            shelfRow.topAnchor.constraint(equalTo: shelfScroll.topAnchor),
            shelfRow.bottomAnchor.constraint(equalTo: shelfScroll.bottomAnchor),
            shelfRow.leadingAnchor.constraint(equalTo: shelfScroll.leadingAnchor),
            shelfRow.trailingAnchor.constraint(equalTo: shelfScroll.trailingAnchor),
            shelfRow.heightAnchor.constraint(equalTo: shelfScroll.heightAnchor),
            shelfScroll.heightAnchor.constraint(equalToConstant: 46),
        ])
        root.addArrangedSubview(shelfScroll)

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

        // ── 送る欄 ──
        // 組み立て中のかたちコードとは別物なので行を分けてラベルを付ける。
        // 候補を選んでもここに入るだけで、相手のテキスト欄はまだ変わらない
        // (押し間違いが相手の本文に残らないようにするため)。
        // 相手の欄に触るのは「送る」を押したときだけ
        let out = UIStackView()
        out.axis = .horizontal
        out.spacing = 6
        out.alignment = .center
        let outTag = UILabel()
        outTag.text = "送る"
        outTag.font = .systemFont(ofSize: 10)
        outTag.textColor = colSub
        outTag.setContentHuggingPriority(.required, for: .horizontal)
        out.addArrangedSubview(outTag)
        outboxLabel.font = extFont1?.withSize(19) ?? .systemFont(ofSize: 19)
        outboxLabel.textColor = colText
        out.addArrangedSubview(outboxLabel)
        // 選び直しは1字ずつ。全部やめたいときは長押し
        // (上の「消」は組み立て中のかたちコードだけを消す。選んだ字まで一緒に
        //  消えると、3字選んだあとに1字組み間違えただけで全部やり直しになる)
        let undo = smallButton("取消", #selector(onDropSelected))
        undo.addGestureRecognizer(
            UILongPressGestureRecognizer(target: self, action: #selector(onClearSelected(_:))),
        )
        out.addArrangedSubview(undo)
        sendButton = smallButton("送る", #selector(onSend))
        out.addArrangedSubview(sendButton)
        // 何も選んでいないあいだは畳む。案内文だけの行に1行ぶんの高さを
        // 使っていると、そのぶんフリック面や手書きの枠が削られる
        out.isHidden = true
        outboxRow = out
        root.addArrangedSubview(out)

        // 他のキーボードから戻ってきたとき、勝手に字が残っているように見えないよう
        // 1行だけ断る。打ち始めれば消える
        resumedNote.font = .systemFont(ofSize: 10)
        resumedNote.textColor = colAccent
        resumedNote.text = "前回の続きです"
        resumedNote.isHidden = true // 続きが無いときは行ごと出さない(restorePending で出す)
        root.addArrangedSubview(resumedNote)

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

        // ── タブ(部品パレットの出し分け)＋かなの面の出し入れ ──
        tabRow.axis = .horizontal
        tabRow.spacing = 4
        tabRow.distribution = .fillEqually
        // 部品パレットは「部首・偏旁」の1つだけ。読み・手書きの面から戻る口を
        // 兼ねているので、タブと同じ見た目のまま置いてある
        do {
            let b = UIButton(type: .system)
            b.setTitle("部首・偏旁", for: .normal)
            b.titleLabel?.font = .systemFont(ofSize: 12)
            b.addTarget(self, action: #selector(onTab(_:)), for: .touchUpInside)
            tabRow.addArrangedSubview(b)
        }
        // パレットに無い部品を読みから出すための面。タブではなく出し入れなので、
        // 出しても消してもかたちの行・候補・組み立て中の表示はそのまま残る。
        // 手書きも同じ扱い(読みも部品の見当もつかない字は、書いて引く)
        kanaToggle = smallButton("読み", #selector(onToggleKana))
        hwToggle = smallButton("手書き", #selector(onToggleHandwriting))
        let tabWrap = UIStackView(arrangedSubviews: [tabRow, kanaToggle, hwToggle])
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

        // ── 打鍵の面 ──
        // **スクロールに入れない**。読みのフリック面も手書きの枠も、指を置いて
        // 動かす場所なので、縦の動きをスクロールに取られると入力にならない
        // (部品パレットだけは数が多いので、その中に自前でスクロールを置く)。
        // 高さは余りを全部もらう＝画面が小さい端末では自動的に詰まるだけで、
        // 「下が見えない」状態にはならない
        keyArea.axis = .vertical
        keyArea.spacing = 4
        keyArea.setContentHuggingPriority(.defaultLow, for: .vertical)
        keyArea.setContentCompressionResistancePriority(.defaultLow, for: .vertical)
        root.addArrangedSubview(keyArea)

        buildStrokeChips()
        rebuildKeys()
        onOutboxChanged() // 送る欄の案内文と、押せない見た目の「送る」を最初に当てる
    }

    // MARK: - 道具の帯(履歴・お気に入り・着せ替え)

    /// 打つための場所ではないものを上端にまとめた帯。
    /// 塗りを持たせず、下に線を引いて打鍵の面と切り離してある。
    private func buildToolRow() -> UIView {
        let history = toolButton("clock", "履歴", #selector(onToggleHistory))
        let favorites = toolButton("star", "お気に入り", #selector(onToggleFavorites))
        historyButton = history
        favoritesButton = favorites
        let theme = toolButton("paintpalette", "着せ替え", #selector(onCycleTheme))

        // 「戻る」。文章の続きは普段のキーボードで打つ道具立てなので、
        // 帰り道を必ず出しておく。
        // ただし iOS のサードパーティのキーボードには「直前のキーボードへ戻る」APIが
        // 無く、advanceToNextInputMode() で次へ送るのが上限。戻り先は約束できないので
        // 読み上げのラベルもその言い方にする
        let back = toolButton("arrow.uturn.backward", "他のキーボードへ", #selector(onGoBack))
        backButton = back

        let spacer = UIView()
        spacer.setContentHuggingPriority(.defaultLow, for: .horizontal)

        var items: [UIView] = [history, favorites, theme, spacer, back]

        // 地球儀。OS が切り替えキーを求めるときだけ出す(要件を満たすため)。
        // handleInputModeList は event が要るので、これだけ .allTouchEvents で受ける
        if needsInputModeSwitchKey {
            let switchBtn = toolButton("globe", "キーボードを選ぶ", #selector(onSwitchKeyboard(_:event:)))
            switchBtn.removeTarget(
                self, action: #selector(onSwitchKeyboard(_:event:)), for: .touchUpInside,
            )
            switchBtn.addTarget(
                self, action: #selector(onSwitchKeyboard(_:event:)), for: .allTouchEvents,
            )
            items.append(switchBtn)
        }

        let row = UIStackView(arrangedSubviews: items)
        row.axis = .horizontal
        row.spacing = 4
        return row
    }

    private func toolButton(_ symbol: String, _ label: String, _ action: Selector) -> UIButton {
        let b = UIButton(type: .system)
        b.setImage(UIImage(systemName: symbol), for: .normal)
        b.tintColor = colSub
        b.accessibilityLabel = label
        b.contentEdgeInsets = UIEdgeInsets(top: 5, left: 10, bottom: 5, right: 10)
        style(b, fill: .clear, stroke: colBorder)
        b.addAction(UIAction { [weak self] _ in self?.tapFeedback() }, for: .touchDown)
        b.addTarget(self, action: action, for: .touchUpInside)
        toolButtons.append(b)
        return b
    }

    @objc private func onToggleHistory() {
        shelf = shelf == .history ? .none : .history
        refreshShelf()
    }

    @objc private func onToggleFavorites() {
        shelf = shelf == .favorites ? .none : .favorites
        refreshShelf()
    }

    /// 棚の中身。タップでその字をそのまま相手の欄へ入れる
    /// (もう一度かたちから組み直させないための近道)。長押しでお気に入りの入り切り。
    private func refreshShelf() {
        historyButton?.tintColor = shelf == .history ? colAccent : colSub
        favoritesButton?.tintColor = shelf == .favorites ? colAccent : colSub
        favoritesButton?.setImage(
            UIImage(systemName: shelf == .favorites ? "star.fill" : "star"), for: .normal,
        )
        shelfScroll.isHidden = shelf == .none
        shelfRow.arrangedSubviews.forEach { $0.removeFromSuperview() }
        guard shelf != .none else { return }

        let chars = shelf == .history ? store.history : store.favorites
        guard !chars.isEmpty else {
            let l = UILabel()
            l.text = shelf == .history
                ? "まだありません。字を確定するとここに残ります"
                : "まだありません。候補を長押しすると入ります"
            l.textColor = colSub
            l.font = .systemFont(ofSize: 11)
            shelfRow.addArrangedSubview(l)
            return
        }
        for ch in chars {
            let b = UIButton(type: .system)
            b.setTitle(ch, for: .normal)
            b.titleLabel?.font = font(for: ch, size: 22)
            b.setTitleColor(colText, for: .normal)
            style(b, fill: colCard, stroke: colBorder)
            b.widthAnchor.constraint(greaterThanOrEqualToConstant: 42).isActive = true
            b.addAction(UIAction { [weak self] _ in self?.tapFeedback() }, for: .touchDown)
            // 棚の字も「選ぶ」まで。相手の欄へ入るのは「送る」のとき
            b.addAction(UIAction { [weak self] _ in self?.select(ch) }, for: .touchUpInside)
            addFavoriteLongPress(to: b, ch: ch)
            shelfRow.addArrangedSubview(b)
        }
    }

    /// 長押しでお気に入りの入り切り。棚(★)から呼び出せるようになる
    private func addFavoriteLongPress(to view: UIView, ch: String) {
        let g = UILongPressGestureRecognizer(target: self, action: #selector(onFavoriteLongPress(_:)))
        view.addGestureRecognizer(g)
        view.accessibilityValue = ch // ジェスチャからどの字か引くため
    }

    @objc private func onFavoriteLongPress(_ g: UILongPressGestureRecognizer) {
        guard g.state == .began, let ch = g.view?.accessibilityValue else { return }
        store.toggleFavorite(ch)
        if shelf != .none { refreshShelf() }
        tapFeedback()
    }

    // MARK: - 操作

    @objc private func onTab(_ sender: UIButton) {
        kanaOpen = false
        hwOpen = false
        rebuildKeys()
    }

    /// かなの面の出し入れ。出すと部品パレットの代わりにフリック面が入る
    @objc private func onToggleKana() {
        kanaOpen.toggle()
        hwOpen = false
        dismissResumedNote()
        rebuildKeys()
        persist()
    }

    /// 手書きの面の出し入れ。かなの面とは場所を取り合うので、押した方だけが開く
    @objc private func onToggleHandwriting() {
        hwOpen.toggle()
        kanaOpen = false
        dismissResumedNote()
        rebuildKeys()
        persist()
    }

    @objc private func onBackspace() { deleteOne() }

    private func deleteOne() {
        if !composing.isEmpty {
            composing.removeLast()   // Character 単位なのでサロゲートペアも1文字
        } else if !outbox.isEmpty {
            // 組み立て中が空なら、選んだ字を1つ取り消す。相手の欄を消しに行く前に、
            // まず自分の手元を消すのが順番として自然
            outbox.removeLast()
        } else {
            textDocumentProxy.deleteBackward()
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

    @objc private func onDropSelected() {
        guard !outbox.isEmpty else { return }
        outbox.removeLast()
    }

    @objc private func onClearSelected(_ g: UILongPressGestureRecognizer) {
        guard g.state == .began, !outbox.isEmpty else { return }
        tapFeedback()
        outbox = ""
    }

    /// 送る欄の中身をカーソル位置へ。**ここが相手の欄に触る唯一の場所**。
    /// 自動では戻らない代わりに「戻る」の色を上げて次の一手を示す
    @objc private func onSend() {
        guard !outbox.isEmpty else { return }
        textDocumentProxy.insertText(outbox)
        outbox = ""
        composing = ""
        dismissResumedNote()
        store.clearPending()
        if let b = backButton {
            b.tintColor = colAccent
            style(b, fill: colAccentBg, stroke: colAccent)
        }
    }

    /// 「戻る」。文章の続きを打つために元のキーボードへ帰る。
    ///
    /// サードパーティのキーボードには「直前のキーボードへ戻る」APIが無いので、
    /// advanceToNextInputMode() で次へ送るのが上限（戻り先は約束できない）。
    /// 組みかけは捨てずに覚えておく。戻ってきたら続きから打てる
    @objc private func onGoBack() {
        persist()
        advanceToNextInputMode()
    }

    /// 地球儀キー。移り先を自分で選びたいときの選択リスト
    /// (.allTouchEvents で受けるので何度も呼ばれる。保存は毎回でも安い)
    @objc private func onSwitchKeyboard(_ sender: UIButton, event: UIEvent) {
        persist()
        handleInputModeList(from: sender, with: event)
    }

    private func insert(_ s: String) { composing += s }

    /// 候補を**選ぶ**。ここではまだ相手の欄に触らない。
    /// 触るのは [onSend] のときだけ(押し間違いを相手の本文に残さないため)
    private func select(_ ch: String) {
        composing = ""
        outbox += ch
        // 選んだ字はアプリと共有の履歴へ。アプリで調べた字をキーボードで打つ／
        // キーボードで打った字をアプリで見返す、を両方向でつなぐ
        store.remember(ch)
        dismissResumedNote()
        if shelf != .none { refreshShelf() }
    }

    /// 送る欄の見た目。何も選んでいないあいだは行ごと畳む
    private func onOutboxChanged() {
        let ready = !outbox.isEmpty
        outboxRow?.isHidden = !ready
        outboxLabel.text = outbox
        outboxLabel.textColor = colText
        outboxLabel.font = extFont1?.withSize(19) ?? .systemFont(ofSize: 19)
        guard let b = sendButton else { return }
        b.isEnabled = ready
        b.setTitleColor(ready ? themeColor { $0.onAccent } : colSub, for: .normal)
        style(b, fill: ready ? colAccent : colCard, stroke: ready ? colAccent : colBorder)
        persist()
    }

    /// 他のキーボードから戻ってきたときに続きを出す。
    /// 勝手に字が残っているように見えないよう、1行「前回の続き」と断る
    private func restorePending() {
        guard let p = store.loadPending() else { return }
        reading = p.reading
        readingPreview = nil
        kanaOpen = p.kana
        // 書いた画までは覚えていない。読みの面に戻すときは手書きの面を閉じる
        if p.kana { hwOpen = false }
        // didSet が persist を呼ぶので、時刻だけが更新されるが害はない
        outbox = p.outbox
        composing = p.code
        rebuildKeys()
        resumedNote.alpha = 1
        resumedNote.isHidden = p.code.isEmpty && p.outbox.isEmpty && p.reading.isEmpty
    }

    /// 断り書きを引っ込める。**行そのものは残して透明にするだけ**にする。
    /// isHidden にすると1行ぶん詰まって、下のフリック面・手書きの枠が
    /// 打っている最中に伸び縮みする(1字目でキーが動いて2字目が隣に入る)
    private func dismissResumedNote() {
        guard !resumedNote.isHidden else { return }
        resumedNote.alpha = 0
    }

    /// 組みかけを覚える。**iOS の拡張は予告なく落とされる**ので、
    /// 終了時の口には頼らず変わるたびに書いておく
    private func persist() {
        store.savePending(
            SharedStore.Pending(
                code: composing, outbox: outbox, reading: reading, kana: kanaOpen,
            ),
        )
    }

    private func onComposingChanged() {
        composingLabel.text = composing.isEmpty
            ? "かたちと部品を選んでください"
            : Ids.readable(Ids.compile(composing))
        composingLabel.textColor = composing.isEmpty ? colSub : colText
        if !composing.isEmpty {
            // 打ち始めたら断り書きと「戻る」の強調は引っ込める(組んでいる最中なので)
            dismissResumedNote()
            if let b = backButton {
                b.tintColor = colSub
                style(b, fill: .clear, stroke: colBorder)
            }
        }
        persist()
        runSearch()
    }

    // MARK: - 候補

    /// 候補を引き直す。打ち直したときは1ページめに戻し、
    /// ページ送りのときだけいまのページを保つ(resetPage: false)
    private func runSearch(resetPage: Bool = true) {
        let q = composing
        if resetPage { candPage = 0 }
        searchSeq += 1
        let seq = searchSeq
        guard !q.isEmpty else {
            candidateRow.arrangedSubviews.forEach { $0.removeFromSuperview() }
            return
        }
        // 並び順はアプリの設定画面で選ぶ(共有領域から読むだけ)
        let sort = Engine.Sort.of(store.sortMode)
        let from = candPage * Self.candPageSize
        // 10万字の走査は数十〜数百msかかるので UI スレッドを止めない
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            let r = self.engine.search(q, limit: Self.candPageSize, sort: sort, offset: from)
            DispatchQueue.main.async {
                guard seq == self.searchSeq else { return }  // 古い結果は捨てる
                self.showCandidates(r)
            }
        }
    }

    private func showCandidates(_ r: Engine.Result) {
        candidateRow.arrangedSubviews.forEach { $0.removeFromSuperview() }
        // ページ送り。候補は1ページぶんずつ出すが、めくれば全件たどれる
        let pages = (r.total + Self.candPageSize - 1) / Self.candPageSize
        if candPage > 0 {
            candidateRow.addArrangedSubview(pagerChip("◂ 前の\(Self.candPageSize)件") { [weak self] in
                self?.turnPage(-1)
            })
        }
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
            // タップは「選ぶ」だけ。相手のテキスト欄に入るのは「送る」のとき
            b.addAction(UIAction { [weak self] _ in self?.select(h.ch) }, for: .touchUpInside)
            addFavoriteLongPress(to: b, ch: h.ch)
            candidateRow.addArrangedSubview(b)
        }
        if pages > 1 {
            if candPage < pages - 1 {
                candidateRow.addArrangedSubview(pagerChip("次の\(Self.candPageSize)件 ▸") { [weak self] in
                    self?.turnPage(1)
                })
            }
            // いま何ページめか。押せないことが分かるよう枠を出さない
            let l = UILabel()
            l.text = "\(candPage + 1)/\(pages)"
            l.textColor = colSub
            l.font = .systemFont(ofSize: 11)
            candidateRow.addArrangedSubview(l)
        }
    }

    /// ページを1つ動かす。候補の先頭まで巻き戻してから引き直す
    /// (前のページの右端に居たまま次のページが出ると、どこを見ているのか分からない)
    private func turnPage(_ d: Int) {
        candPage = max(0, candPage + d)
        candidateScroll.setContentOffset(.zero, animated: false)
        runSearch(resetPage: false)
    }

    /// ページ送りのキー。候補と間違えて押さないよう、字を小さく色も落とす
    private func pagerChip(_ label: String, _ onTap: @escaping () -> Void) -> UIButton {
        let b = UIButton(type: .system)
        b.setTitle(label, for: .normal)
        b.titleLabel?.font = .systemFont(ofSize: 11)
        b.setTitleColor(colAccent, for: .normal)
        style(b, fill: .clear, stroke: colAccent)
        b.widthAnchor.constraint(greaterThanOrEqualToConstant: 66).isActive = true
        b.addAction(UIAction { [weak self] _ in self?.tapFeedback() }, for: .touchDown)
        b.addAction(UIAction { _ in onTap() }, for: .touchUpInside)
        return b
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
    /// 絵は端末のフォントに頼らない(矩形で描くか、同梱フォントの字形を描く)。
    /// 名前は IDC文字ではなく日本語ラベル。
    private func buildOperators() {
        opRow.arrangedSubviews.forEach { $0.removeFromSuperview() }
        let codes = Ids.primaryCodes
            + Ids.operators.map(\.code).filter { !Ids.primaryCodes.contains($0) }
        for code in codes {
            guard let op = Ids.operators.first(where: { $0.code == code }) else { continue }
            let icon = OperatorIcons.all[code]

            // アプリ版と同じ配置図を矩形で描く。配置図を持たない鏡映・回転・除去は
            // IDC の字形(⿾⿿㇯)を出す。端末の標準フォントには無い字なので、
            // 拡張漢字と同じく同梱フォント(font(for:size:))で描く
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
                s.font = font(for: sym, size: 18)
                s.textColor = colText.withAlphaComponent(0.85)
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

    /**
     * キーボードの高さ。面ごとに要るものが違うので出し分ける。
     *
     * 読みのフリック面(4段)も手書きの枠も、**スクロールさせずに全部出す**のが要件。
     * 上の帯(組み立て中・送る・候補・かたち・タブ)だけで 250pt ほど要るので、
     * その下に面ぶんを足した高さを自分で取りに行く。
     * ただし画面の 62% を超えない。小さい端末では面の側が詰まるだけで、
     * 「下が見えない」ことにはならない(フリックのキーも枠も余りを分け合うため)。
     */
    private func applyHeight() {
        let screen = view.window?.windowScene?.screen.bounds.height
            ?? UIScreen.main.bounds.height
        let h = Height.of(store.heightMode)
        let want: CGFloat = (kanaOpen ? 476 : (hwOpen ? 470 : 320)) * h.scale
        minHeight?.constant = Swift.min(want, screen * h.screenMax)
    }

    /// キーボードの縦幅(アプリの設定画面で選ぶ)。
    /// scale … 高さの倍率 / screenMax … 画面に占めてよい割合。
    /// 倍率だけ上げても頭打ちに引っかかるので、割合も一緒に上げる。
    /// キーは core/data/keyboard.ts の KEY_HEIGHTS と同じ。
    private enum Height: String {
        case small, medium, large

        var scale: CGFloat {
            switch self {
            case .small: return 1.0
            case .medium: return 1.15
            case .large: return 1.3
            }
        }

        var screenMax: CGFloat {
            switch self {
            case .small: return 0.62
            case .medium: return 0.70
            case .large: return 0.78
            }
        }

        static func of(_ key: String?) -> Height { Height(rawValue: key ?? "") ?? .small }
    }

    private func rebuildKeys() {
        let faceOpen = kanaOpen || hwOpen
        for v in tabRow.arrangedSubviews {
            guard let b = v as? UIButton else { continue }
            // 読み・手書きの面を出しているあいだ、部品パレットのタブは効いていない
            b.setTitleColor(!faceOpen ? colAccent : colSub, for: .normal)
            style(b, fill: !faceOpen ? colCard : .clear, stroke: !faceOpen ? colBorder : .clear)
        }
        for (toggle, on) in [(kanaToggle, kanaOpen), (hwToggle, hwOpen)] {
            guard let toggle else { continue }
            toggle.setTitleColor(on ? themeColor { $0.onAccent } : colSub, for: .normal)
            style(toggle, fill: on ? colAccent : colCard, stroke: on ? colAccent : colBorder)
        }
        strokeScroll.isHidden = faceOpen
        keyArea.arrangedSubviews.forEach { $0.removeFromSuperview() }
        readingLabel = nil
        readingHits = nil
        flick = nil
        hwHits = nil
        hwPad = nil
        hwCount = nil
        applyHeight()

        if kanaOpen {
            buildReadingArea()
            return
        }
        if hwOpen {
            buildHandwritingArea()
            return
        }

        // 部品パレットだけは数が多いので、この面の中に自前のスクロールを置く
        // (指を置いて動かす面ではないので、ここのスクロールは邪魔にならない)
        let grid = UIStackView()
        grid.axis = .vertical
        grid.spacing = 4
        grid.translatesAutoresizingMaskIntoConstraints = false
        let scroll = UIScrollView()
        scroll.addSubview(grid)
        NSLayoutConstraint.activate([
            grid.topAnchor.constraint(equalTo: scroll.topAnchor),
            grid.bottomAnchor.constraint(equalTo: scroll.bottomAnchor),
            grid.leadingAnchor.constraint(equalTo: scroll.leadingAnchor),
            grid.trailingAnchor.constraint(equalTo: scroll.trailingAnchor),
            grid.widthAnchor.constraint(equalTo: scroll.widthAnchor),
        ])
        keyArea.addArrangedSubview(scroll)

        let parts: [String] = strokeGroup == "common"
            ? Palettes.radical.map(String.init)
            : (Palettes.difficult.first { $0.strokes == strokeGroup }?.parts.map(String.init) ?? [])
        rows(parts.map { p in key(p, size: 20) { [weak self] in self?.insert(p) } },
             cols: 8, into: grid)
    }

    // MARK: - 読みでさがす

    /// 読みの面。断り書き・読みの欄・引けた字・フリックのかな面の4段。
    ///
    /// 引けた字はタップで**かたちコードに部品として足す**（つち→土 を足して
    /// 〈左右〉土… と組む）。長押しはその字を送る欄へ入れる
    /// （読みが分かっている字はこれが最短で、組み直す必要がない）。
    ///
    /// **文章を打つ面ではない**。ここで打ったかなが相手の欄に入ることはなく、
    /// 部品を読みから引くためだけにある。標準のかなキーボードに見えてしまうので、
    /// 面の頭にそれを1行で断っておく。
    private func buildReadingArea() {
        // 断り書きは**出しっぱなしにする**。打ち始めたら引っ込めれば1行ぶんの高さを
        // フリック面に回せるが、それをやると1字目を打った瞬間にキーの大きさと位置が
        // 変わり、2字目が隣のキーに入る。打っている最中に面が動かないことのほうが、
        // 1行ぶんの高さより大事
        let note = UILabel()
        note.text = "字の読みを打つと候補に出ます。文章は普段のキーボードで"
        note.font = .systemFont(ofSize: 10)
        note.textColor = colSub
        keyArea.addArrangedSubview(note)

        let label = UILabel()
        label.font = .systemFont(ofSize: 16)
        label.numberOfLines = 1
        readingLabel = label

        let clear = UIButton(type: .system)
        clear.setTitle("消", for: .normal)
        clear.titleLabel?.font = .systemFont(ofSize: 13)
        clear.setTitleColor(colSub, for: .normal)
        clear.contentEdgeInsets = UIEdgeInsets(top: 6, left: 12, bottom: 6, right: 12)
        style(clear, fill: colCard, stroke: colBorder)
        clear.addAction(UIAction { [weak self] _ in self?.tapFeedback() }, for: .touchDown)
        clear.addTarget(self, action: #selector(onClearReading), for: .touchUpInside)

        let head = UIStackView(arrangedSubviews: [label, clear])
        head.axis = .horizontal
        head.spacing = 6
        keyArea.addArrangedSubview(head)

        let hits = UIStackView()
        hits.axis = .horizontal
        hits.spacing = 4
        hits.translatesAutoresizingMaskIntoConstraints = false
        let scroll = UIScrollView()
        scroll.showsHorizontalScrollIndicator = false
        scroll.addSubview(hits)
        NSLayoutConstraint.activate([
            hits.topAnchor.constraint(equalTo: scroll.topAnchor),
            hits.bottomAnchor.constraint(equalTo: scroll.bottomAnchor),
            hits.leadingAnchor.constraint(equalTo: scroll.leadingAnchor),
            hits.trailingAnchor.constraint(equalTo: scroll.trailingAnchor),
            hits.heightAnchor.constraint(equalTo: scroll.heightAnchor),
            scroll.heightAnchor.constraint(equalToConstant: 44),
        ])
        readingHits = hits
        keyArea.addArrangedSubview(scroll)

        // フリック面は**残りの高さを全部もらう**。固定の高さを与えると、
        // 画面の小さい端末で下の段がはみ出して打てなくなる
        let pad = FlickKanaView(
            text: colText, sub: colSub, card: colCard, border: colBorder, accentBg: colAccentBg,
        )
        pad.delegate = self
        pad.setContentHuggingPriority(.defaultLow, for: .vertical)
        pad.setContentCompressionResistancePriority(.defaultLow, for: .vertical)
        pad.heightAnchor.constraint(greaterThanOrEqualToConstant: 150).isActive = true
        flick = pad
        keyArea.addArrangedSubview(pad)

        refreshReadingLabel()
        runReadingSearch()
    }

    /// 打った読みと、指を置いているあいだの仮の1字(色を変えて後ろに付ける)
    private func refreshReadingLabel() {
        guard let label = readingLabel else { return }
        if reading.isEmpty, readingPreview == nil {
            label.text = "読みを打つと部品が出ます（例: つち）"
            label.textColor = colSub
            return
        }
        label.textColor = colText
        guard let preview = readingPreview else {
            label.text = reading
            return
        }
        let s = NSMutableAttributedString(string: reading)
        s.append(NSAttributedString(string: preview, attributes: [.foregroundColor: colAccent]))
        label.attributedText = s
    }

    @objc private func onClearReading() {
        reading = ""
        flick?.resetToggle()
        afterReadingChanged()
    }

    /// 読みが変わった。**面は組み直さない**。組み直すとフリックのキーが動いて、
    /// 続けて打っている指が隣のキーに乗る
    private func afterReadingChanged() {
        readingPreview = nil
        dismissResumedNote()
        persist() // 読みも組みかけのうち。切り替えて戻ったら続きから打てる
        refreshReadingLabel()
        runReadingSearch()
    }

    private func runReadingSearch() {
        guard let hits = readingHits else { return }
        let q = reading
        readingSeq += 1
        let seq = readingSeq
        guard !q.isEmpty else {
            hits.arrangedSubviews.forEach { $0.removeFromSuperview() }
            return
        }
        // 1万3千字ぶんの読みを走査するので UI スレッドではやらない
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            let r = self.engine.byReading(q, limit: 60)
            DispatchQueue.main.async {
                guard seq == self.readingSeq else { return } // 古い結果は捨てる
                self.showReadingHits(r)
            }
        }
    }

    private func showReadingHits(_ chars: [String]) {
        guard let hits = readingHits else { return }
        hits.arrangedSubviews.forEach { $0.removeFromSuperview() }
        guard !chars.isEmpty else {
            let l = UILabel()
            l.text = dict.jaCount == 0 ? "辞書を読み込み中…" : "該当なし"
            l.textColor = colSub
            l.font = .systemFont(ofSize: 12)
            hits.addArrangedSubview(l)
            return
        }
        for ch in chars {
            let b = UIButton(type: .system)
            b.setTitle(ch, for: .normal)
            b.titleLabel?.font = font(for: ch, size: 22)
            b.setTitleColor(colText, for: .normal)
            style(b, fill: colCard, stroke: colBorder)
            b.widthAnchor.constraint(greaterThanOrEqualToConstant: 42).isActive = true
            b.accessibilityLabel = ch
            b.addAction(UIAction { [weak self] _ in self?.tapFeedback() }, for: .touchDown)
            b.addAction(UIAction { [weak self] _ in self?.commitReading(ch) }, for: .touchUpInside)
            // 長押しはそのまま入力。読みが分かっている字はこれが最短
            let g = UILongPressGestureRecognizer(target: self, action: #selector(onReadingHitLongPress(_:)))
            b.addGestureRecognizer(g)
            b.accessibilityValue = ch
            hits.addArrangedSubview(b)
        }
    }

    /// 読みから引けた字を**かたちコードへ入れて、読みを空にする**。
    ///
    /// 普通のかな漢字変換と同じ手触りにするため。「つき」と打って月を選んだ時点で
    /// その変換は済んでいるので、読みが残っていると次の部品を打つのに消す手間が要る。
    /// 空にすると上の候補欄も読みの結果から**組み立て中のかたちの候補へ戻る**ので、
    /// 〈左右〉日月 まで組んだところで「明」がそのまま出てくる
    private func commitReading(_ ch: String) {
        insert(ch)
        reading = ""
        flick?.resetToggle()
        afterReadingChanged()
    }

    /// 読みから出た字の長押し。その字そのものを入れたいときの近道(送る欄へ)。
    /// タップはかたちコードへ部品として足す方(読みで部品を出すのが主目的)
    @objc private func onReadingHitLongPress(_ g: UILongPressGestureRecognizer) {
        guard g.state == .began, let ch = g.view?.accessibilityValue else { return }
        tapFeedback()
        select(ch)
    }

    // MARK: - 手書きでさがす

    /// 手書きの面。断り書き・引けた字・書く枠の3段。
    ///
    /// 読みも部品の見当もつかない字は、書いて引く。認識は端末の中だけで完結する
    /// （通信はしない）。パターンは KanjiVG 由来の約6,400字で、常用・人名用・
    /// JIS第1〜2水準を覆う。ここに無い拡張漢字はかたちコードで組んで引く。
    ///
    /// 引けた字は**タップで送る欄へ**。読みの面（タップで部品に足す）と逆なのは、
    /// 手書きは「その字そのものが欲しい」から書くため。部品として使いたいときは
    /// 長押しでかたちコードに足せる。
    private func buildHandwritingArea() {
        let note = UILabel()
        note.text = "読めない字は書いて引けます。タップで送る欄へ・長押しで部品に"
        note.font = .systemFont(ofSize: 10)
        note.textColor = colSub
        keyArea.addArrangedSubview(note)

        let hits = UIStackView()
        hits.axis = .horizontal
        hits.spacing = 4
        hits.translatesAutoresizingMaskIntoConstraints = false
        let scroll = UIScrollView()
        scroll.showsHorizontalScrollIndicator = false
        scroll.addSubview(hits)
        NSLayoutConstraint.activate([
            hits.topAnchor.constraint(equalTo: scroll.topAnchor),
            hits.bottomAnchor.constraint(equalTo: scroll.bottomAnchor),
            hits.leadingAnchor.constraint(equalTo: scroll.leadingAnchor),
            hits.trailingAnchor.constraint(equalTo: scroll.trailingAnchor),
            hits.heightAnchor.constraint(equalTo: scroll.heightAnchor),
            scroll.heightAnchor.constraint(equalToConstant: 46),
        ])
        hwHits = hits
        keyArea.addArrangedSubview(scroll)

        let pad = HandwritingView(text: colText, border: colBorder, accent: colAccent)
        pad.delegate = self
        style(pad, fill: colCard, stroke: colBorder)
        hwPad = pad

        let count = UILabel()
        count.text = "手書き"
        count.font = .systemFont(ofSize: 10)
        count.textColor = colSub
        count.textAlignment = .center
        hwCount = count

        let undo = UIButton(type: .system)
        undo.setTitle("1画消す", for: .normal)
        let clear = UIButton(type: .system)
        clear.setTitle("全部消す", for: .normal)
        for (b, action) in [(undo, #selector(onHandwritingUndo)), (clear, #selector(onHandwritingClear))] {
            b.titleLabel?.font = .systemFont(ofSize: 12)
            b.setTitleColor(colSub, for: .normal)
            b.contentEdgeInsets = UIEdgeInsets(top: 8, left: 8, bottom: 8, right: 8)
            style(b, fill: colCard, stroke: colBorder)
            b.addAction(UIAction { [weak self] _ in self?.tapFeedback() }, for: .touchDown)
            b.addTarget(self, action: action, for: .touchUpInside)
        }

        let tools = UIStackView(arrangedSubviews: [count, undo, clear, UIView()])
        tools.axis = .vertical
        tools.spacing = 4
        tools.widthAnchor.constraint(equalToConstant: 76).isActive = true

        // 書く枠は**残りの高さを全部もらう**。固定にすると小さい端末で下が切れて、
        // 枠の下半分に書けなくなる
        let row = UIStackView(arrangedSubviews: [pad, tools])
        row.axis = .horizontal
        row.spacing = 6
        pad.setContentHuggingPriority(.defaultLow, for: .vertical)
        pad.setContentCompressionResistancePriority(.defaultLow, for: .vertical)
        pad.heightAnchor.constraint(greaterThanOrEqualToConstant: 130).isActive = true
        row.setContentHuggingPriority(.defaultLow, for: .vertical)
        keyArea.addArrangedSubview(row)

        showHandwritingNote(handwriting.ready ? "枠に字を書いてください" : "手書きの辞書を準備中…")
        // パターン(1.2MB)は手書きの面を初めて開いたときにだけ読む。
        // 開いて閉じてまた開くと二重に走らせてしまうので、走らせたかを覚えておく
        if !handwriting.ready, !hwLoading {
            hwLoading = true
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                guard let self else { return }
                self.handwriting.load(bundle: Bundle(for: type(of: self)))
                DispatchQueue.main.async {
                    self.hwLoading = false
                    if self.hwOpen { self.showHandwritingNote("枠に字を書いてください") }
                }
            }
        }
    }

    @objc private func onHandwritingUndo() { hwPad?.undo() }
    @objc private func onHandwritingClear() { hwPad?.clear() }

    /// 1画描き終えるたびに引き直す。描いた画がそのまま問いになる
    func handwritingStrokesChanged(_ strokes: [[Double]]) {
        dismissResumedNote()
        hwCount?.text = strokes.isEmpty ? "手書き" : "\(strokes.count)画"
        hwSeq += 1
        let seq = hwSeq
        guard !strokes.isEmpty else {
            showHandwritingNote(handwriting.ready ? "枠に字を書いてください" : "手書きの辞書を準備中…")
            return
        }
        guard handwriting.ready else { return }
        // 6,400字ぶんの照合は数msだが、描いた直後の指の動きを妨げないよう外へ出す
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            let hits = self.handwriting.match(strokes, limit: 24)
            DispatchQueue.main.async {
                guard seq == self.hwSeq, self.hwOpen else { return } // 古い結果は捨てる
                self.showHandwritingHits(hits)
            }
        }
    }

    func handwritingTapFeedback() { tapFeedback() }

    private func showHandwritingNote(_ text: String) {
        guard let hits = hwHits else { return }
        hits.arrangedSubviews.forEach { $0.removeFromSuperview() }
        let l = UILabel()
        l.text = text
        l.textColor = colSub
        l.font = .systemFont(ofSize: 12)
        hits.addArrangedSubview(l)
    }

    private func showHandwritingHits(_ matches: [Handwriting.Match]) {
        guard let hits = hwHits else { return }
        hits.arrangedSubviews.forEach { $0.removeFromSuperview() }
        guard !matches.isEmpty else {
            showHandwritingNote("似ている字が見つかりません")
            return
        }
        for m in matches {
            let b = UIButton(type: .system)
            b.setTitle(m.ch, for: .normal)
            b.titleLabel?.font = font(for: m.ch, size: 22)
            b.setTitleColor(colText, for: .normal)
            style(b, fill: colCard, stroke: colBorder)
            b.widthAnchor.constraint(greaterThanOrEqualToConstant: 42).isActive = true
            b.accessibilityLabel = m.ch
            b.addAction(UIAction { [weak self] _ in self?.tapFeedback() }, for: .touchDown)
            // タップは送る欄へ(手書きは「その字が欲しい」から書く)。
            // 部品として組みに使いたいときは長押しでかたちコードへ
            b.addAction(UIAction { [weak self] _ in self?.select(m.ch) }, for: .touchUpInside)
            let g = UILongPressGestureRecognizer(
                target: self, action: #selector(onHandwritingHitLongPress(_:)),
            )
            b.addGestureRecognizer(g)
            b.accessibilityValue = m.ch
            hits.addArrangedSubview(b)
        }
    }

    /// 手書きで引けた字の長押し。かたちコードへ部品として足す
    @objc private func onHandwritingHitLongPress(_ g: UILongPressGestureRecognizer) {
        guard g.state == .began, let ch = g.view?.accessibilityValue else { return }
        tapFeedback()
        insert(ch)
    }

    // MARK: - フリックのかな面から呼ばれる

    func flickAppend(_ ch: String) {
        reading += ch
        afterReadingChanged()
    }

    func flickReplaceLast(_ ch: String) {
        if !reading.isEmpty { reading.removeLast() }
        reading += ch
        afterReadingChanged()
    }

    func flickCycleLast() {
        guard let last = reading.last, let next = Kana.cycle(last) else { return }
        reading.removeLast()
        reading += next
        afterReadingChanged()
    }

    func flickBackspace() {
        guard !reading.isEmpty else { return }
        reading.removeLast()
        flick?.resetToggle()
        afterReadingChanged()
    }

    func flickPreview(_ ch: String?) {
        readingPreview = ch
        refreshReadingLabel()
    }

    func flickTapFeedback() { tapFeedback() }

    // MARK: - 部品

    private func rows(_ keys: [UIView], cols: Int, into container: UIStackView) {
        var row: UIStackView?
        for (i, k) in keys.enumerated() {
            if i % cols == 0 {
                let r = UIStackView()
                r.axis = .horizontal
                r.spacing = 4
                r.distribution = .fillEqually
                container.addArrangedSubview(r)
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
