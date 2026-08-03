package com.upsee.katachi.ime

// 自動生成: scripts/build-font-app.py が書き出す。直接編集しないこと。
//
// 同梱フォント(assets/fonts/KatachiExt1.ttf・KatachiExt2.ttf)の収録範囲。
// intArrayOf(先頭cp, 末尾cp, フォント番号) を符号位置順に並べたもの。
object ExtFonts {
    val RANGES = arrayOf(
        intArrayOf(11904, 11929, 1),
        intArrayOf(11931, 12019, 1),
        intArrayOf(12032, 12245, 1),
        intArrayOf(12272, 12283, 2),
        intArrayOf(12284, 12287, 1),
        intArrayOf(12754, 12754, 1),
        intArrayOf(12772, 12773, 1),
        intArrayOf(12783, 12783, 1),
        intArrayOf(131072, 173791, 1),
        intArrayOf(173824, 178206, 1),
        intArrayOf(178208, 183981, 1),
        intArrayOf(183984, 191456, 1),
        intArrayOf(191472, 192093, 1),
        intArrayOf(194560, 195101, 1),
        intArrayOf(196608, 201546, 2),
        intArrayOf(201552, 202666, 2),
        intArrayOf(202667, 202667, 1),
        intArrayOf(202668, 203820, 2),
        intArrayOf(203821, 203821, 1),
        intArrayOf(203822, 204411, 2),
        intArrayOf(204412, 204412, 1),
        intArrayOf(204413, 207195, 2),
        intArrayOf(207196, 207196, 1),
        intArrayOf(207197, 210041, 2),
    )

    /** 同梱フォントの何枚目で描くか。0=どちらにも無い(OSの標準フォントに任せる) */
    fun fontIndex(cp: Int): Int {
        var lo = 0
        var hi = RANGES.size - 1
        while (lo <= hi) {
            val mid = (lo + hi) ushr 1
            val r = RANGES[mid]
            when {
                cp < r[0] -> hi = mid - 1
                cp > r[1] -> lo = mid + 1
                else -> return r[2]
            }
        }
        return 0
    }
}
