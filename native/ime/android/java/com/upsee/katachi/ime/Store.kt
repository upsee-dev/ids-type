package com.upsee.katachi.ime

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

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

        /** 候補の並び順。アプリの設定画面(src/prefs.ts)が書き、ここは読むだけ */
        const val SORT = "katachi.order"

        /** キーボードの縦幅。同じくアプリの設定画面が書く */
        const val HEIGHT = "katachi.height"

        /** 履歴の上限。アプリ側(HISTORY_LIMIT)と同じ */
        const val LIMIT = 60

        /** 組みかけの置き場。履歴とは別のキーにする(打鍵のたびに書くため) */
        const val PENDING = "katachi.pending"

        /**
         * 組みかけを覚えておく時間。文章は端末のキーボードで打ち、読めない字の
         * ときだけこちらへ切り替える道具なので、往復のあいだは残す必要がある。
         * ただし翌日に開いて知らない字が残っているのは事故に見えるので10分で捨てる。
         */
        const val PENDING_TTL_MS = 10 * 60 * 1000L
    }

    /**
     * 組みかけの状態。他のキーボードへ移って戻ってきたとき、続きから打てるように
     * するためのもの（切り替えのたびにゼロからだと、この道具は使いものにならない）。
     */
    data class Pending(
        /** 組み立て中のかたちコード(例: "LR日") */
        val code: String,
        /** 打ちかけの読み */
        val reading: String,
        /** かなの面を出していたか */
        val kana: Boolean,
    )

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

    /**
     * 候補の並び順("unicode" / "common" / "near")。値は core/engine.ts の
     * SORT_MODES と同じ。既定は "unicode"(完全一致を先頭に、あとは符号位置順)。
     * キーボードに設定画面は無いので、アプリで選んだものをここで読むだけにする。
     * 打つたびに読むが、SharedPreferences は読み込み済みの Map なので安い。
     */
    fun sortMode(): String = prefs.getString(SORT, null) ?: "unicode"

    /**
     * キーボードの縦幅("small" / "medium" / "large")。
     * 値は core/data/keyboard.ts の KEY_HEIGHTS と同じ。
     */
    fun heightMode(): String = prefs.getString(HEIGHT, null) ?: "small"

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

    // ---- 組みかけ ----

    /** 何も無ければ消す。打鍵のたびに呼ばれるので、書く中身は小さく保つ */
    fun savePending(p: Pending) {
        if (p.code.isEmpty() && p.reading.isEmpty()) {
            prefs.edit().remove(PENDING).apply()
            return
        }
        val o = JSONObject()
            .put("code", p.code)
            .put("reading", p.reading)
            .put("kana", p.kana)
            .put("at", System.currentTimeMillis())
        prefs.edit().putString(PENDING, o.toString()).apply()
    }

    /** 10分より古いものは無かったことにする */
    fun loadPending(): Pending? {
        val raw = prefs.getString(PENDING, null) ?: return null
        return runCatching {
            val o = JSONObject(raw)
            if (System.currentTimeMillis() - o.optLong("at") > PENDING_TTL_MS) return null
            Pending(
                code = o.optString("code"),
                reading = o.optString("reading"),
                kana = o.optBoolean("kana"),
            )
        }.getOrNull()
    }

    fun clearPending() {
        prefs.edit().remove(PENDING).apply()
    }
}
