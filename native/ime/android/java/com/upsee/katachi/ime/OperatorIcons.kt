package com.upsee.katachi.ime

// 自動生成: core/ids/operators.ts から web の build:data が書き出す。直接編集しないこと。
object OperatorIcons {
    /** rects は [x, y, w, h, 役割] の並び。0〜1 に正規化してある */
    data class Icon(val rects: FloatArray? = null, val symbol: String? = null)

    val ALL: Map<String, Icon> = mapOf(
        "LR" to Icon(rects = floatArrayOf(0f, 0f, 0.46f, 1f, 1f,  0.54f, 0f, 0.46f, 1f, 2f)),
        "LL" to Icon(rects = floatArrayOf(0f, 0f, 0.29f, 1f, 1f,  0.355f, 0f, 0.29f, 1f, 2f,  0.71f, 0f, 0.29f, 1f, 3f)),
        "UD" to Icon(rects = floatArrayOf(0f, 0f, 1f, 0.46f, 1f,  0f, 0.54f, 1f, 0.46f, 2f)),
        "UU" to Icon(rects = floatArrayOf(0f, 0f, 1f, 0.29f, 1f,  0f, 0.355f, 1f, 0.29f, 2f,  0f, 0.71f, 1f, 0.29f, 3f)),
        "RD" to Icon(rects = floatArrayOf(0f, 0f, 1f, 0.28f, 1f,  0f, 0f, 0.28f, 1f, 1f,  0.38f, 0.38f, 0.62f, 0.62f, 2f)),
        "RU" to Icon(rects = floatArrayOf(0f, 0f, 0.28f, 1f, 1f,  0f, 0.72f, 1f, 0.28f, 1f,  0.38f, 0f, 0.62f, 0.62f, 2f)),
        "LD" to Icon(rects = floatArrayOf(0f, 0f, 1f, 0.28f, 1f,  0.72f, 0f, 0.28f, 1f, 1f,  0f, 0.38f, 0.62f, 0.62f, 2f)),
        "LU" to Icon(rects = floatArrayOf(0.72f, 0f, 0.28f, 1f, 1f,  0f, 0.72f, 1f, 0.28f, 1f,  0f, 0f, 0.62f, 0.62f, 2f)),
        "OD" to Icon(rects = floatArrayOf(0f, 0f, 1f, 0.26f, 1f,  0f, 0f, 0.26f, 1f, 1f,  0.74f, 0f, 0.26f, 1f, 1f,  0.34f, 0.36f, 0.32f, 0.64f, 2f)),
        "OR" to Icon(rects = floatArrayOf(0f, 0f, 0.26f, 1f, 1f,  0f, 0f, 1f, 0.26f, 1f,  0f, 0.74f, 1f, 0.26f, 1f,  0.36f, 0.34f, 0.64f, 0.32f, 2f)),
        "OU" to Icon(rects = floatArrayOf(0f, 0.74f, 1f, 0.26f, 1f,  0f, 0f, 0.26f, 1f, 1f,  0.74f, 0f, 0.26f, 1f, 1f,  0.34f, 0f, 0.32f, 0.64f, 2f)),
        "OL" to Icon(rects = floatArrayOf(0.74f, 0f, 0.26f, 1f, 1f,  0f, 0f, 1f, 0.26f, 1f,  0f, 0.74f, 1f, 0.26f, 1f,  0f, 0.34f, 0.64f, 0.32f, 2f)),
        "OC" to Icon(rects = floatArrayOf(0f, 0f, 1f, 0.24f, 1f,  0f, 0.76f, 1f, 0.24f, 1f,  0f, 0f, 0.24f, 1f, 1f,  0.76f, 0f, 0.24f, 1f, 1f,  0.34f, 0.34f, 0.32f, 0.32f, 2f)),
        "XX" to Icon(rects = floatArrayOf(0f, 0.06f, 0.7f, 0.7f, 1f,  0.3f, 0.24f, 0.7f, 0.7f, 2f)),
        "MI" to Icon(symbol = "⿾"),
        "RO" to Icon(symbol = "⿿"),
        "SU" to Icon(symbol = "㇯"),
    )
}
