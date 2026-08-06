package com.upsee.katachi.ime

import android.content.Context
import org.json.JSONArray

/**
 * 履歴とお気に入り。**アプリ(React Native)と同じ入れ物**を読み書きする。
 *
 * アプリで調べた字をキーボードで打つ、というのがこのアプリの筋道なので、
 * 2つが別々の履歴を持っていると意味がない。Android のキーボードは同じアプリの
 * Service なので、アプリ側(modules/katachi-shared)と同じ
 * SharedPreferences("katachi") を指すだけで共有できる。
 * 値の形も揃える必要がある（アプリは JSON の文字列配列で書く）。
 */
class Store(context: Context) {

    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private companion object {
        const val PREFS = "katachi"
        const val HISTORY = "katachi.history"
        const val FAVORITES = "katachi.favorites"

        /** 履歴の上限。アプリ側(HISTORY_LIMIT)と同じ */
        const val LIMIT = 60
    }

    private fun read(key: String): MutableList<String> {
        val raw = prefs.getString(key, null) ?: return ArrayList()
        return runCatching {
            val a = JSONArray(raw)
            val out = ArrayList<String>(a.length())
            for (i in 0 until a.length()) {
                // 壊れた値を読んでも落ちないようにする(1字ぶんの文字列だけ通す)
                (a.opt(i) as? String)?.let { out.add(it) }
            }
            out
        }.getOrDefault(ArrayList())
    }

    private fun write(key: String, list: List<String>) {
        prefs.edit().putString(key, JSONArray(list).toString()).apply()
    }

    fun history(): List<String> = read(HISTORY)

    fun favorites(): List<String> = read(FAVORITES)

    /** 使った字を履歴の先頭へ。すでにあれば先頭に繰り上げる(重複させない) */
    fun remember(ch: String) {
        val list = read(HISTORY)
        list.remove(ch)
        list.add(0, ch)
        write(HISTORY, list.take(LIMIT))
    }

    /** お気に入りの入り切り。入れたときだけ true */
    fun toggleFavorite(ch: String): Boolean {
        val list = read(FAVORITES)
        val added = if (list.remove(ch)) false else { list.add(0, ch); true }
        write(FAVORITES, list)
        return added
    }

    fun isFavorite(ch: String): Boolean = read(FAVORITES).contains(ch)
}
