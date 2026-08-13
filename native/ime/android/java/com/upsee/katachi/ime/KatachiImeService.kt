package com.upsee.katachi.ime

import android.inputmethodservice.InputMethodService
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
 *   かたちと部品で組む → 候補から**選ぶ**(送る欄に入る) → **送る**(相手の欄へ)
 *   → **戻る**(元の入力方法へ)
 *
 * になっている。組み立て中のかたちコードも、選んだ字も、送るまで相手の
 * テキスト欄には一切触らない。押し間違いが相手の本文に残らないようにするため。
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

    /**
     * 送る欄。候補から選んだ字がここに溜まり、「送る」で初めて相手の欄へ入る。
     * 1字だけでなく続けて選べるようにしてあるのは、難しい字が続く語(人名・地名)を
     * まとめて組めるようにするため。
     */
    private var outbox = StringBuilder()

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
            override val outboxText get() = outbox.toString()

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
                } else if (outbox.isNotEmpty()) {
                    // 組み立て中が空なら、選んだ字を1つ取り消す。相手の欄を消しに
                    // 行く前に、まず自分の手元を消すのが順番として自然
                    dropSelected()
                } else {
                    // 手元に何も無ければ相手のテキストを消す
                    currentInputConnection?.deleteSurroundingText(1, 0)
                }
            }

            override fun clear() {
                composing.setLength(0)
                updateComposing()
            }

            /**
             * 候補を**選ぶ**。ここではまだ相手の欄に触らない。
             * 触るのは [send] のときだけ（押し間違いを相手の本文に残さないため）。
             */
            override fun select(ch: String) {
                composing.setLength(0)
                outbox.append(ch)
                // 選んだ字はアプリと共有の履歴へ。アプリで調べた字をキーボードで
                // 打つ／キーボードで打った字をアプリで見返す、を両方向でつなぐ
                sharedStore.remember(ch)
                view?.onComposingChanged()
                view?.onOutboxChanged()
                view?.onSelected()
                persist()
            }

            override fun dropSelected() {
                this@KatachiImeService.dropSelected()
            }

            override fun clearSelected() {
                outbox.setLength(0)
                view?.onOutboxChanged()
                persist()
            }

            /** 送る欄の中身をカーソル位置へ。ここが相手の欄に触る唯一の場所 */
            override fun send() {
                if (outbox.isEmpty()) return
                currentInputConnection?.commitText(outbox.toString(), 1)
                outbox.setLength(0)
                composing.setLength(0)
                view?.onComposingChanged()
                view?.onOutboxChanged()
                view?.onSent()
                sharedStore.clearPending()
            }

            /**
             * 「戻る」。文章の続きを打つために元の入力方法へ帰る。
             *
             * switchToPreviousInputMethod は直前に使っていた入力方法へ戻す
             * (API 28+)。使えない・戻れないときは選択リストを出して本人に選ばせる
             * (switchToNextInputMethod だと絵文字や音声入力に飛んでしまう)。
             *
             * 組みかけは捨てずに覚えておく。戻ってきたら続きから打てる
             */
            override fun goBack() {
                persist()
                val moved = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P &&
                    switchToPreviousInputMethod()
                if (!moved) openImePicker()
            }

            override fun openImePicker() {
                persist()
                getSystemService(InputMethodManager::class.java)?.showInputMethodPicker()
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
        // 送る欄の中身を「送る」で押したときだけ commitText でカーソルへ送る
        view?.onComposingChanged()
        persist()
    }

    /** 送る欄の末尾1字を取り消す(サロゲートペアは1字として) */
    private fun dropSelected() {
        if (outbox.isEmpty()) return
        val cp = outbox.codePointBefore(outbox.length)
        outbox.setLength(outbox.length - Character.charCount(cp))
        view?.onOutboxChanged()
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
                outbox = outbox.toString(),
                reading = view?.readingText ?: "",
                kana = view?.kanaOpen ?: false,
            ),
        )
    }

    /** キーボードが出るたび。前の続きがあれば戻す */
    override fun onStartInputView(info: EditorInfo?, restarting: Boolean) {
        super.onStartInputView(info, restarting)
        val p = sharedStore.loadPending() ?: return
        composing.setLength(0)
        composing.append(p.code)
        outbox.setLength(0)
        outbox.append(p.outbox)
        view?.restore(p)
    }

    override fun onFinishInput() {
        super.onFinishInput()
        // 覚えてから手元を空にする。次に開いたとき onStartInputView が戻す
        persist()
        composing.setLength(0)
        outbox.setLength(0)
        view?.onComposingChanged()
        view?.onOutboxChanged()
    }

    override fun onDestroy() {
        view = null
        super.onDestroy()
    }
}
