package com.upsee.katachi.ime

import android.content.Intent
import android.inputmethodservice.InputMethodService
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import kotlin.concurrent.thread

/**
 * 漢字カタチ入力のシステムキーボード本体。
 *
 * Android の入力方式は InputMethodService を継承した Service として登録する
 * （設定 > 言語と入力 > 画面キーボード に出るのはこれ）。
 * Expo/React Native はここでは使えないので、UI もエンジンもネイティブで持つ。
 *
 * このキーボードは**読めない漢字を1字入れるための道具**。文章そのものは端末の
 * 普段のキーボードで打ち、読めない字に出くわしたときだけこちらへ切り替える。
 * だから一連の流れは
 *
 *   かたちと部品で組む → 候補から**選ぶ**(その場で相手の欄へ入る)
 *   → **地球儀キー**(普段の入力方法へ移る)
 *
 * になっている。組み立て中のかたちコードは相手のテキスト欄には出さない
 * （「LR日」のような途中の記号が本文に見えないように）。相手の欄に入るのは
 * **選んだ字だけ**で、押し間違いは⌫（手元が空なら相手の欄を1字消す）で戻す。
 *
 * 以前は composing text として相手の欄に下線つきで出していたが、
 * 「LR日」のような組み立て途中の記号が相手のアプリの本文に見えてしまい、
 * 検索欄などでは打っている端から誤変換・オートコンプリートに巻き込まれた。
 * 見せる場所はキーボードの中だけでよい。
 *
 * 切り替えて戻ってくる前提の道具なので、組みかけは打鍵のたびに
 * [Store.savePending] で覚え、次に開いたとき続きから打てるようにしている。
 */
class KatachiImeService : InputMethodService() {

    private companion object {
        /** アプリを開くための scheme。app.json の expo.scheme と同じにすること */
        const val APP_SCHEME = "ids-kanji-type"
    }

    private lateinit var dict: Dict
    private lateinit var engine: Engine

    /**
     * 手書き照合。パターン(1.2MB)は手書きの面を初めて開いたときに読む。
     * ビューではなくサービスが持つので、着せ替えでキーボードを作り直しても読み直さない
     */
    private val handwriting = Handwriting()
    private lateinit var sharedStore: Store
    private var view: KeyboardView? = null
    private val main = Handler(Looper.getMainLooper())

    /** 入力中のかたちコード(例: "LR日")。相手の欄には出さない */
    private var composing = StringBuilder()

    override fun onCreate() {
        super.onCreate()
        dict = Dict()
        engine = Engine(dict)
        sharedStore = Store(applicationContext)
        // 辞書はキーボードの表示をブロックしないよう別スレッドで読む。
        // 日本語の字を読み終えた時点でいったん検索可能にし、拡張漢字は後追い。
        thread(name = "katachi-dict") {
            dict.loadJapanese(applicationContext)
            main.post { view?.onDictReady() }
            dict.loadExtensions(applicationContext)
            main.post { view?.onDictReady() }
        }
    }

    override fun onCreateInputView(): View {
        val v = KeyboardView(this, object : KeyboardView.Host {
            override val engine get() = this@KatachiImeService.engine
            override val dict get() = this@KatachiImeService.dict
            override val handwriting get() = this@KatachiImeService.handwriting
            override val store get() = this@KatachiImeService.sharedStore
            override val composingText get() = composing.toString()

            override fun insert(s: String) {
                composing.append(s)
                updateComposing()
            }

            override fun backspace() {
                if (composing.isNotEmpty()) {
                    // サロゲートペア(𠮟 など)を1文字として消す
                    val cp = composing.codePointBefore(composing.length)
                    composing.setLength(composing.length - Character.charCount(cp))
                    updateComposing()
                } else {
                    // 組み立て中が空なら相手のテキストを消す。選んだ字はその場で
                    // 送っているので、押し間違いの取り消しもここが受ける。
                    // **拡張漢字(𠮟 など)はUTF-16で2つ**。1つだけ消すとペアの片割れが
                    // 残って豆腐になるので、サロゲートペアは2つまとめて消す
                    val ic = currentInputConnection
                    val before = ic?.getTextBeforeCursor(2, 0) ?: ""
                    val pair = before.length == 2 &&
                        Character.isSurrogatePair(before[0], before[1])
                    ic?.deleteSurroundingText(if (pair) 2 else 1, 0)
                }
            }

            override fun clear() {
                composing.setLength(0)
                updateComposing()
            }

            /**
             * 候補を選ぶ＝**その場で相手のカーソル位置へ送る**。
             *
             * 以前は「送る欄」にいったん溜めて、「送る」を押したときだけ相手の欄に
             * 触っていた（押し間違いが本文に残らないように）。ただしこの道具は
             * 1字を入れるために呼ばれるので、選んだあとにもう一手要ることのほうが
             * 高くつく——押し間違いは⌫1回で消せるが、毎回の余分な1手は消せない。
             *
             * 消すのは⌫（組み立て中が空なら相手の欄を1字消す）。
             */
            override fun select(ch: String) {
                composing.setLength(0)
                currentInputConnection?.commitText(ch, 1)
                // 送った字はアプリと共有の履歴へ。アプリで調べた字をキーボードで
                // 打つ／キーボードで打った字をアプリで見返す、を両方向でつなぐ
                sharedStore.remember(ch)
                view?.onComposingChanged()
                view?.onSelected()
                view?.onSent()
                persist()
            }

            /**
             * 地球儀キー。文章の続きを打つために別の入力方法へ移る。
             *
             * **ほかの日本語入力と同じ振る舞い**にしてある。押すと次の入力方法へ
             * 順に移り(switchToNextInputMethod)、長押しで選択リストが出る。
             * 見慣れた地球儀を押せば普段のキーボードへ帰れるほうが、この道具
             * だけの決まりを覚えるより速い。
             *
             * 移れなかったとき(次が無い・Android 8以前で API が無い)は選択リストを
             * 出して本人に選ばせる。押しても何も起きない行き止まりを作らないため。
             * ※ どちらの API も 28+。このアプリの下限は 24 なので必ず版で分ける。
             *
             * 組みかけは捨てずに覚えておく。戻ってきたら続きから打てる
             */
            override fun switchKeyboard() {
                persist()
                val moved = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P &&
                    (switchToNextInputMethod(false) || switchToPreviousInputMethod())
                if (!moved) openImePicker()
            }

            /** 地球儀キーの長押し。移り先を自分で選びたいとき */
            override fun openImePicker() {
                persist()
                getSystemService(InputMethodManager::class.java)?.showInputMethodPicker()
            }

            /**
             * カメラで字を読み取る。
             *
             * 入力方式(Service)はカメラの権限を自分で求められない(Activity が要る)ので、
             * ここではアプリのカメラ面を開くだけにする。組みかけは覚えたまま行くので、
             * アプリで字を拾って戻ってくれば続きから打てる。
             */
            override fun openCamera() {
                persist()
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse("$APP_SCHEME://camera"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                runCatching { startActivity(intent) }
            }

            override fun persist() {
                this@KatachiImeService.persist()
            }

            override fun recreateKeyboard() {
                // 🎨キー(着せ替え)。色はビュー生成時に決まるので作り直して反映する
                setInputView(onCreateInputView())
            }
        })
        view = v
        return v
    }

    private fun updateComposing() {
        // 相手の欄には出さない。組み立て途中はキーボードの中だけで見せ、
        // 候補を選んだ時点で commitText でカーソルへ送る
        view?.onComposingChanged()
        persist()
    }

    /**
     * 組みかけを覚える。打鍵のたびに呼ばれる。
     *
     * iOS の拡張ほどではないが、Android の入力方式も他のキーボードへ移れば
     * いつ止められてもおかしくない。終了時の口に頼らず、変わるたびに書いておく。
     */
    private fun persist() {
        sharedStore.savePending(
            Store.Pending(
                code = composing.toString(),
                reading = view?.readingText ?: "",
                kana = view?.kanaOpen ?: false,
            ),
        )
    }

    /** キーボードが出るたび。前の続きがあれば戻す */
    override fun onStartInputView(info: EditorInfo?, restarting: Boolean) {
        super.onStartInputView(info, restarting)
        // アプリで縦幅の設定を変えていることがあるので、出すたびに当て直す
        view?.refreshHeight()
        val p = sharedStore.loadPending() ?: return
        composing.setLength(0)
        composing.append(p.code)
        view?.restore(p)
    }

    override fun onFinishInput() {
        super.onFinishInput()
        // 覚えてから手元を空にする。次に開いたとき onStartInputView が戻す
        persist()
        composing.setLength(0)
        view?.onComposingChanged()
    }

    override fun onDestroy() {
        view = null
        super.onDestroy()
    }
}
