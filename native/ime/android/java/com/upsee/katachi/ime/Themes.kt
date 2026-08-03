package com.upsee.katachi.ime

// 自動生成: core/data/themes.ts から web の build:data が書き出す。直接編集しないこと。
object Themes {
    data class Palette(
        val key: String,
        val label: String,
        val dark: Boolean,
        val bg: String,
        val card: String,
        val keyFill: String,
        val border: String,
        val text: String,
        val sub: String,
        val faint: String,
        val accent: String,
        val accentBg: String,
        val onAccent: String,
    )

    val ALL = listOf(
        Palette("standard", "スタンダード", false, "#FAFAF9", "#FFFFFF", "#FAFAF9", "#E7E5E4", "#1C1917", "#78716C", "#A8A29E", "#4F46E5", "#EEF2FF", "#FFFFFF"),
        Palette("sakura", "サクラ", false, "#FDF2F8", "#FFFFFF", "#FDF2F8", "#FBCFE8", "#4A1D31", "#A34D6E", "#CE9CB0", "#DB2777", "#FCE7F3", "#FFFFFF"),
        Palette("soda", "ソーダ", false, "#ECFEFF", "#FFFFFF", "#ECFEFF", "#A5F3FC", "#164E63", "#45788A", "#85AEBB", "#0E7490", "#CFFAFE", "#FFFFFF"),
        Palette("himawari", "ヒマワリ", false, "#FFFBEB", "#FFFFFF", "#FFFBEB", "#FDE68A", "#451A03", "#93702B", "#C0A566", "#B45309", "#FEF3C7", "#FFFFFF"),
        Palette("matcha", "マッチャ", false, "#F0FDF4", "#FFFFFF", "#F0FDF4", "#BBF7D0", "#14532D", "#4D7C5F", "#8FBA9E", "#15803D", "#DCFCE7", "#FFFFFF"),
        Palette("dark", "ダーク", true, "#0C0A09", "#1C1917", "#0C0A09", "#292524", "#E7E5E4", "#A8A29E", "#78716C", "#818CF8", "#1E1B4B", "#FFFFFF"),
        Palette("yozora", "ヨゾラ", true, "#0F172A", "#1E293B", "#0F172A", "#334155", "#E2E8F0", "#94A3B8", "#64748B", "#A78BFA", "#312E81", "#1E1B4B"),
    )

    /** key からテーマを引く。"auto"・不明な key は端末のダーク設定に追従する */
    fun resolve(key: String?, systemDark: Boolean): Palette {
        val fallback = if (systemDark) "dark" else "standard"
        return ALL.firstOrNull { it.key == key } ?: ALL.first { it.key == fallback }
    }
}
