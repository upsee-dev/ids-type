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
 *   かたちと部品で組む → 候補から**選ぶ**(送る欄に入る) → **送る**(相手の欄へ)
 *   → **地球儀キー**(普段の入力方法へ移る)
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
        // アプリで縦幅の設定を変えていることがあるので、出すたびに当て直す
        view?.refreshHeight()
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
