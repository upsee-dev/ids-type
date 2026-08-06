package expo.modules.katachishared

import android.content.Context
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * アプリとキーボードで共有する保存領域(Android)。
 *
 * Android のキーボードは同じアプリの中の Service(KatachiImeService)なので、
 * サンドボックスを跨ぐ必要はない。IME が着せ替えを覚えているのと同じ
 * SharedPreferences("katachi") をそのまま指しておけば、アプリで確定した字も
 * キーボードで確定した字も同じ1つの履歴になる。
 */
class KatachiSharedModule : Module() {

  private val prefs
    get() = appContext.reactContext?.getSharedPreferences("katachi", Context.MODE_PRIVATE)

  override fun definition() = ModuleDefinition {
    Name("KatachiShared")

    Function("getItem") { key: String ->
      prefs?.getString(key, null)
    }

    Function("setItem") { key: String, value: String ->
      prefs?.edit()?.putString(key, value)?.apply()
    }
  }
}
