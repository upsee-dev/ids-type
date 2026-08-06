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
 * 組み立てている「かたちコード」は**キーボードの中だけ**に置き、相手の
 * テキスト欄へは触らない。候補を選んで漢字1文字になった時点ではじめて
 * カーソル位置へ転記する。
 *
 * 以前は composing text として相手の欄に下線つきで出していたが、
 * 「LR日」のような組み立て途中の記号が相手のアプリの本文に見えてしまい、
 * 検索欄などでは打っている端から誤変換・オートコンプリートに巻き込まれた。
 * 見せる場所はキーボードの入力中の行1か所でよい。
 */
class KatachiImeService : InputMethodService() {

    private lateinit var dict: Dict
    private lateinit var engine: Engine
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
                // 使った字はアプリと共有の履歴へ。アプリで調べた字をキーボードで
                // 打つ／キーボードで打った字をアプリで見返す、を両方向でつなぐ
                sharedStore.remember(ch)
                view?.onComposingChanged()
                view?.onCommitted()
            }

            override fun switchToOtherIme() {
                // 「他のキーボード」。かな入力など別のキーボードへ移りたいときに押す。
                //
                // switchToNextInputMethod だと有効なIMEを順送りするだけなので、
                // 絵文字や音声入力に飛んでしまう。どれに移るかは本人に選ばせる。
                //
                // 組み立て途中のかたちコードは持って行けないので捨てる
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
        // 相手の欄には出さない。組み立て途中はキーボードの「入力中」の行だけで見せ、
        // 確定した漢字1文字だけを commitText でカーソルへ送る
        view?.onComposingChanged()
    }

    override fun onFinishInput() {
        super.onFinishInput()
        composing.setLength(0)
        view?.onComposingChanged()
    }

    override fun onDestroy() {
        view = null
        super.onDestroy()
    }
}
