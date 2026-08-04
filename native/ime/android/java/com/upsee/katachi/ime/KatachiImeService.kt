package com.upsee.katachi.ime

import android.inputmethodservice.InputMethodService
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.inputmethod.InputMethodManager
import kotlin.concurrent.thread

/**
 * 漢字カタチ入力のシステムキーボード本体。
 *
 * Android の入力方式は InputMethodService を継承した Service として登録する
 * （設定 > 言語と入力 > 画面キーボード に出るのはこれ）。
 * Expo/React Native はここでは使えないので、UI もエンジンもネイティブで持つ。
 *
 * 打った内容は currentInputConnection 経由で相手のテキスト欄へ直接入れる。
 * 変換前の「かたちコード」は composing text として下線つきで見せ、
 * 候補を選んだ時点で漢字1文字に置き換える。
 */
class KatachiImeService : InputMethodService() {

    private lateinit var dict: Dict
    private lateinit var engine: Engine
    private var view: KeyboardView? = null
    private val main = Handler(Looper.getMainLooper())

    /** 入力中のかたちコード(例: "LR日") */
    private var composing = StringBuilder()

    override fun onCreate() {
        super.onCreate()
        dict = Dict()
        engine = Engine(dict)
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
                    // 未入力なら相手のテキストを消す
                    currentInputConnection?.deleteSurroundingText(1, 0)
                }
            }

            override fun clear() {
                composing.setLength(0)
                updateComposing()
            }

            override fun commit(ch: String) {
                composing.setLength(0)
                currentInputConnection?.commitText(ch, 1)
                view?.onComposingChanged()
            }

            override fun switchToOtherIme() {
                // 「あ」キー。かな入力など別のキーボードへ移りたいときに押す。
                //
                // switchToNextInputMethod だと有効なIMEを順送りするだけなので、
                // 絵文字や音声入力に飛んでしまう。どれに移るかは本人に選ばせる。
                //
                // 移る前に未確定の「かたちコード」を消しておく。残したままだと
                // 相手のテキスト欄に LR日 のような文字列と下線が居座り、
                // カーソルの位置も分からなくなる。
                currentInputConnection?.apply {
                    setComposingText("", 1)
                    finishComposingText()
                }
                composing.setLength(0)
                view?.onComposingChanged()

                val imm = getSystemService(InputMethodManager::class.java)
                imm?.showInputMethodPicker()
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
        // 未確定文字として下線つきで見せる。確定は候補タップのとき
        currentInputConnection?.setComposingText(composing.toString(), 1)
        view?.onComposingChanged()
    }

    override fun onFinishInput() {
        super.onFinishInput()
        composing.setLength(0)
        currentInputConnection?.finishComposingText()
        view?.onComposingChanged()
    }

    override fun onDestroy() {
        view = null
        super.onDestroy()
    }
}
