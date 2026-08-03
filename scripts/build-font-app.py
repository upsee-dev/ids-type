#!/usr/bin/env python3
"""アプリ同梱用の「端末に無い字」フォントを作る。

    pip install fonttools
    python3 scripts/build-font-app.py

Web版は unicode-range で分割フォントを出し分けられる（build-font-slices.py）が、
React Native と Android/iOS のネイティブビューには unicode-range が無い。
fontFamily に指定できるのは1つだけなので、**必要な字をTTFにまとめて**同梱する。

収録するのは「端末の標準フォントが持っていない範囲」だけ:

    U+2E80-2FFF   部首補助・康熙部首・IDC
    U+31C0-31EF   CJKの筆画
    U+20000-3FFFF 拡張B〜J・互換漢字補助（第2・第3面）

URO(U+4E00-9FFF)・拡張A(U+3400-4DBF)・互換漢字(U+F900-FAFF)は入れない。
Hiragino も Noto Sans CJK も持っており、入れても二重で重くなるだけだから。
入れなかった範囲は OS が標準フォントへフォールバックして描く。

対象は75,292字あり、TrueType の上限65,535グリフに収まらない。そこで元の
Plangothic P1/P2 の分担のまま2つに分け、どちらで描くかの範囲表も一緒に出す
（アプリは 1字ごとに fontFamily を選ぶ。native/src/extFontRanges.ts）。

出力:
    native/assets/fonts/KatachiExt1.ttf  第2面のほとんど（拡張B〜F ほか）
    native/assets/fonts/KatachiExt2.ttf  残り（部首補助・拡張G/H/I ほか）
    native/src/extFontRanges.ts          符号位置 → どちらのフォントか（自動生成）
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC_FONTS = [ROOT / "assets-archive/fonts/PlangothicP1-Regular.ttf",
             ROOT / "assets-archive/fonts/PlangothicP2-Regular.ttf"]
OUT_DIR = ROOT / "native/assets/fonts"
OUT_TS = ROOT / "native/src/extFontRanges.ts"
OUT_KT = ROOT / "native/ime/android/java/com/upsee/katachi/ime/ExtFonts.kt"
OUT_SWIFT = ROOT / "native/targets/keyboard/ExtFonts.swift"
FAMILY = "KatachiExt"  # 実際は KatachiExt1 / KatachiExt2 の2ファミリになる

# 端末の標準フォントが持っていない範囲だけ
RANGES = [
    (0x2E80, 0x2FFF),    # 部首補助・康熙部首・IDC
    (0x31C0, 0x31EF),    # CJKの筆画
    (0x20000, 0x3FFFF),  # 拡張B〜J・互換漢字補助
]
GLYPH_LIMIT = 65_535  # TrueType の上限。超えるとフォントが壊れる


def in_ranges(cp: int) -> bool:
    return any(lo <= cp <= hi for lo, hi in RANGES)


def main():
    try:
        from fontTools import subset
        from fontTools.ttLib import TTFont
    except ImportError:
        sys.exit("fonttools が要ります: pip install fonttools")

    missing = [p for p in SRC_FONTS if not p.exists()]
    if missing:
        sys.exit(
            "元フォントがありません:\n  "
            + "\n  ".join(str(p) for p in missing)
            + "\n\nPlangothic を assets-archive/fonts/ に置いてください:\n"
            "  https://github.com/Fitzgerald-Porthmouth-Koenigsegg/Plangothic_Project/releases"
        )

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # P1にある字はP2から入れない（重複グリフでむだに太らせない）
    taken: set[int] = set()
    plans: list[tuple[Path, list[int]]] = []
    for src in SRC_FONTS:
        cmap = set(TTFont(src, lazy=True).getBestCmap())
        cps = sorted(cp for cp in cmap if in_ranges(cp) and cp not in taken)
        taken.update(cps)
        plans.append((src, cps))
        print(f"{src.name}: {len(cps)} 字")

    for (src, cps), n in zip(plans, range(1, len(plans) + 1)):
        if len(cps) > GLYPH_LIMIT:
            sys.exit(
                f"{src.name} の {len(cps)} 字は TrueType の上限 {GLYPH_LIMIT} グリフを"
                "超えます。RANGES を狭めるか、分割数を増やしてください。"
            )

    ranges: list[tuple[int, int, int]] = []  # (先頭cp, 末尾cp, フォント番号)
    total_bytes = 0
    for n, (src, cps) in enumerate(plans, start=1):
        if not cps:
            continue
        options = subset.Options()
        options.layout_features = []
        options.hinting = False
        options.desubroutinize = True
        options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
        options.notdef_outline = True
        options.drop_tables += ["DSIG"]

        font = subset.load_font(str(src), options, lazy=True)
        subsetter = subset.Subsetter(options)
        subsetter.populate(unicodes=cps)
        subsetter.subset(font)

        family = f"{FAMILY}{n}"
        for rec in font["name"].names:
            if rec.nameID in (1, 3, 4, 6, 16):
                font["name"].setName(
                    family, rec.nameID, rec.platformID, rec.platEncID, rec.langID
                )
        out = OUT_DIR / f"{family}.ttf"
        subset.save_font(font, str(out), options)
        font.close()
        total_bytes += out.stat().st_size
        print(f"  -> {out.relative_to(ROOT)}  {out.stat().st_size / 1024 / 1024:.1f} MB")

        # 連続する符号位置を畳んで範囲表にする
        start = prev = cps[0]
        for cp in cps[1:]:
            if cp == prev + 1:
                prev = cp
                continue
            ranges.append((start, prev, n))
            start = prev = cp
        ranges.append((start, prev, n))

    ranges.sort()
    rows = ",\n  ".join(f"[{a}, {b}, {n}]" for a, b, n in ranges)
    OUT_TS.write_text(
        "// 自動生成: scripts/build-font-app.py が書き出す。直接編集しないこと。\n"
        "//\n"
        "// 同梱フォント(assets/fonts/KatachiExt1.ttf・KatachiExt2.ttf)の収録範囲。\n"
        "// [先頭cp, 末尾cp, フォント番号] を符号位置順に並べたもの。\n"
        "// React Native は unicode-range を持たないので、1字ごとにこの表を引いて\n"
        "// fontFamily を選ぶ(src/theme.ts の fontFor)。どちらにも無い字は OS の\n"
        "// 標準フォントに任せる。\n"
        f"export const EXT_FONT_RANGES: readonly (readonly [number, number, number])[] = [\n  {rows},\n];\n",
        encoding="utf-8",
    )

    # Android のシステムIME(Kotlin)も同じ表を使う。RN と同じ assets/fonts/ の
    # ファイルを読むので、APK に入るフォントは1部だけ
    kt_rows = "\n".join(f"        intArrayOf({a}, {b}, {n})," for a, b, n in ranges)
    OUT_KT.write_text(
        "package com.upsee.katachi.ime\n\n"
        "// 自動生成: scripts/build-font-app.py が書き出す。直接編集しないこと。\n"
        "//\n"
        "// 同梱フォント(assets/fonts/KatachiExt1.ttf・KatachiExt2.ttf)の収録範囲。\n"
        "// intArrayOf(先頭cp, 末尾cp, フォント番号) を符号位置順に並べたもの。\n"
        "object ExtFonts {\n"
        "    val RANGES = arrayOf(\n"
        f"{kt_rows}\n"
        "    )\n\n"
        "    /** 同梱フォントの何枚目で描くか。0=どちらにも無い(OSの標準フォントに任せる) */\n"
        "    fun fontIndex(cp: Int): Int {\n"
        "        var lo = 0\n"
        "        var hi = RANGES.size - 1\n"
        "        while (lo <= hi) {\n"
        "            val mid = (lo + hi) ushr 1\n"
        "            val r = RANGES[mid]\n"
        "            when {\n"
        "                cp < r[0] -> hi = mid - 1\n"
        "                cp > r[1] -> lo = mid + 1\n"
        "                else -> return r[2]\n"
        "            }\n"
        "        }\n"
        "        return 0\n"
        "    }\n"
        "}\n",
        encoding="utf-8",
    )

    # iOS のキーボード拡張(Swift)も同じ表を使う。拡張は自前のバンドルしか
    # 読めないので、フォントの実体は withKatachiIme.js が targets/keyboard/ へ複製する
    sw_rows = "\n".join(f"        ({a}, {b}, {n})," for a, b, n in ranges)
    OUT_SWIFT.write_text(
        "import Foundation\n\n"
        "// 自動生成: scripts/build-font-app.py が書き出す。直接編集しないこと。\n"
        "//\n"
        "// 同梱フォント(KatachiExt1.ttf・KatachiExt2.ttf)の収録範囲。\n"
        "// (先頭cp, 末尾cp, フォント番号) を符号位置順に並べたもの。\n"
        "enum ExtFonts {\n"
        "    static let ranges: [(UInt32, UInt32, Int)] = [\n"
        f"{sw_rows}\n"
        "    ]\n\n"
        "    /// 同梱フォントの何枚目で描くか。0=どちらにも無い(OSの標準フォントに任せる)\n"
        "    static func fontIndex(_ cp: UInt32) -> Int {\n"
        "        var lo = 0\n"
        "        var hi = ranges.count - 1\n"
        "        while lo <= hi {\n"
        "            let mid = (lo + hi) / 2\n"
        "            let r = ranges[mid]\n"
        "            if cp < r.0 { hi = mid - 1 }\n"
        "            else if cp > r.1 { lo = mid + 1 }\n"
        "            else { return r.2 }\n"
        "        }\n"
        "        return 0\n"
        "    }\n"
        "}\n",
        encoding="utf-8",
    )

    print(
        f"\nwrote {OUT_TS.relative_to(ROOT)} / {OUT_KT.relative_to(ROOT)} / "
        f"{OUT_SWIFT.relative_to(ROOT)} "
        f"({len(ranges)} 範囲) / "
        f"フォント計 {total_bytes / 1024 / 1024:.1f} MB ({len(taken)} 字)\n"
        "収録しなかった範囲(URO・拡張A・互換漢字・かな)は OS の標準フォントが描く"
    )


if __name__ == "__main__":
    main()
