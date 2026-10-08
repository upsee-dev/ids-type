package com.upsee.katachi.ime

// 自動生成: core/data/age.ts から web の build:data が書き出す。直接編集しないこと。
//
// CJK漢字が Unicode のどの版で追加されたか。読みで引いた候補は
// **段(常用・人名用 → KANJIDIC2の残り → 拡張漢字) → 段内は追加された版の順**に
// 並べる(同じ版の中は符号位置順)。TypeScript 版と同じ並びになること。
object Age {
    /** [先頭cp, 末尾cp, 版の番号] を符号位置順に */
    private val RANGES = arrayOf(
        intArrayOf(0x3400, 0x4db5, 1), // 3.0
        intArrayOf(0x4db6, 0x4dbf, 12), // 13.0
        intArrayOf(0x4e00, 0x9fa5, 0), // 1.1
        intArrayOf(0x9fa6, 0x9fbb, 4), // 4.1
        intArrayOf(0x9fbc, 0x9fc3, 5), // 5.1
        intArrayOf(0x9fc4, 0x9fcb, 6), // 5.2
        intArrayOf(0x9fcc, 0x9fcc, 8), // 6.1
        intArrayOf(0x9fcd, 0x9fd5, 9), // 8.0
        intArrayOf(0x9fd6, 0x9fea, 10), // 10.0
        intArrayOf(0x9feb, 0x9fef, 11), // 11.0
        intArrayOf(0x9ff0, 0x9ffc, 12), // 13.0
        intArrayOf(0x9ffd, 0x9fff, 13), // 14.0
        intArrayOf(0xf900, 0xfa2d, 0), // 1.1
        intArrayOf(0xfa2e, 0xfa2f, 8), // 6.1
        intArrayOf(0xfa30, 0xfa6a, 3), // 3.2
        intArrayOf(0xfa6b, 0xfa6d, 6), // 5.2
        intArrayOf(0xfa70, 0xfad9, 4), // 4.1
        intArrayOf(0x20000, 0x2a6d6, 2), // 3.1
        intArrayOf(0x2a6d7, 0x2a6dd, 12), // 13.0
        intArrayOf(0x2a6de, 0x2a6df, 13), // 14.0
        intArrayOf(0x2a700, 0x2b734, 6), // 5.2
        intArrayOf(0x2b735, 0x2b738, 13), // 14.0
        intArrayOf(0x2b739, 0x2b739, 14), // 15.0
        intArrayOf(0x2b73a, 0x2b73f, 16), // 17.0
        intArrayOf(0x2b740, 0x2b81d, 7), // 6.0
        intArrayOf(0x2b81e, 0x2b81e, 17), // 18.0
        intArrayOf(0x2b820, 0x2cea1, 9), // 8.0
        intArrayOf(0x2cea2, 0x2cead, 16), // 17.0
        intArrayOf(0x2ceb0, 0x2ebe0, 10), // 10.0
        intArrayOf(0x2ebf0, 0x2ee5d, 15), // 15.1
        intArrayOf(0x2f800, 0x2fa1d, 2), // 3.1
        intArrayOf(0x30000, 0x3134a, 12), // 13.0
        intArrayOf(0x31350, 0x323af, 14), // 15.0
        intArrayOf(0x323b0, 0x33479, 16), // 17.0
    )

    /** 段を作るときの掛け数。TypeScript の AGE_STEP と同じ値 */
    const val STEP = 39845888L

    /** 並べ替え用の数値。版の番号を上位に、符号位置を下位に置く */
    fun key(ch: String): Long {
        val cp = ch.codePointAt(0)
        var lo = 0
        var hi = RANGES.size - 1
        while (lo <= hi) {
            val mid = (lo + hi) ushr 1
            val r = RANGES[mid]
            if (cp < r[0]) hi = mid - 1
            else if (cp > r[1]) lo = mid + 1
            else return r[2].toLong() * 0x200000L + cp
        }
        return 18L * 0x200000L + cp
    }
}
