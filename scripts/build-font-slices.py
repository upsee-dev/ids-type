#!/usr/bin/env python3
"""全CJK漢字を実際の字形で表示するための分割Webフォントを作る。

    pip install fonttools brotli
    python3 scripts/build-font-slices.py

拡張B〜Jの約9万字は端末の標準フォントに無く、候補や収録一覧が ☒ だらけになる。
Plangothic(SIL OFL 1.1)全体は32MBあって同梱できないが、1024符号位置ごとの
WOFF2 に割って unicode-range 付きの @font-face を並べれば、ブラウザは
**画面に出た字を含むスライスだけ**を取りに行く(Google Fonts のCJK配信と同じ方式)。

フォントスタックでは端末フォントより後ろに置くので、端末で描ける字は
いままでどおり端末のフォント(明朝)で描かれ、スライスは落ちてこない。
出力:
    web/public/fonts/plangothic/*.woff2   スライス本体
    web/src/app/plangothic.css            @font-face 一覧(自動生成)
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC_FONTS = [ROOT / "assets-archive/fonts/PlangothicP1-Regular.ttf",
             ROOT / "assets-archive/fonts/PlangothicP2-Regular.ttf"]
OUT_FONTS = ROOT / "web/public/fonts/plangothic"
OUT_CSS = ROOT / "web/src/app/plangothic.css"
FAMILY = "Plangothic"
SLICE = 0x400  # 1024符号位置 ≒ 150〜300KB/枚。粒度と枚数のバランス

# 収録対象(このアプリで表示しうる範囲)。URO・拡張Aも入れておくと
# CJKフォントを持たない環境(素のLinuxなど)でも一覧が成立する
RANGES = [
    (0x2E80, 0x2FFF),   # 部首補助・康熙部首・IDC
    (0x31C0, 0x31EF),   # CJKの筆画
    (0x3400, 0x4DBF),   # 拡張A
    (0x4E00, 0x9FFF),   # 基本(URO)
    (0xF900, 0xFAFF),   # 互換漢字
    (0x20000, 0x3FFFF), # 拡張B〜J・互換補助(第2・第3面)
]


def in_ranges(cp: int) -> bool:
    return any(lo <= cp <= hi for lo, hi in RANGES)


def css_range(cps: list[int]) -> str:
    """連続する符号位置を U+xxxx-yyyy に畳む"""
    runs = []
    start = prev = cps[0]
    for cp in cps[1:]:
        if cp == prev + 1:
            prev = cp
            continue
        runs.append((start, prev))
        start = prev = cp
    runs.append((start, prev))
    return ", ".join(
        f"U+{a:04X}" if a == b else f"U+{a:04X}-{b:04X}" for a, b in runs
    )


def main():
    try:
        from fontTools import subset
        from fontTools.ttLib import TTFont
    except ImportError:
        sys.exit("fonttools が要ります: pip install fonttools brotli")

    missing = [p for p in SRC_FONTS if not p.exists()]
    if missing:
        sys.exit(
            "元フォントがありません:\n  "
            + "\n  ".join(str(p) for p in missing)
            + "\n\nPlangothic を assets-archive/fonts/ に置いてください:\n"
            "  https://github.com/Fitzgerald-Porthmouth-Koenigsegg/Plangothic_Project/releases"
        )

    OUT_FONTS.mkdir(parents=True, exist_ok=True)
    for old in OUT_FONTS.glob("*.woff2"):
        old.unlink()

    faces: list[tuple[int, str, str]] = []  # (先頭cp, ファイル名, unicode-range)
    taken: set[int] = set()  # P1で出した字はP2から出さない(二重取得を防ぐ)
    total_bytes = 0

    for src in SRC_FONTS:
        prefix = "p1" if "P1" in src.name else "p2"
        cmap = set(TTFont(src, lazy=True).getBestCmap())
        cps = sorted(cp for cp in cmap if in_ranges(cp) and cp not in taken)
        taken.update(cps)

        buckets: dict[int, list[int]] = {}
        for cp in cps:
            buckets.setdefault(cp - cp % SLICE, []).append(cp)
        print(f"{src.name}: {len(cps)} 字 -> {len(buckets)} スライス")

        for start, bucket in sorted(buckets.items()):
            options = subset.Options()
            options.layout_features = []
            options.hinting = False
            options.desubroutinize = True
            options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
            options.notdef_outline = True
            options.flavor = "woff2"

            font = subset.load_font(str(src), options, lazy=True)
            subsetter = subset.Subsetter(options)
            subsetter.populate(unicodes=bucket)
            subsetter.subset(font)

            # ファミリ名を統一(P1/P2の区別はファイル名だけに残す)
            for rec in font["name"].names:
                if rec.nameID in (1, 3, 4, 6, 16):
                    font["name"].setName(
                        FAMILY, rec.nameID, rec.platformID, rec.platEncID, rec.langID
                    )

            name = f"{prefix}-{start:05x}.woff2"
            out = OUT_FONTS / name
            subset.save_font(font, str(out), options)
            font.close()
            total_bytes += out.stat().st_size
            faces.append((start, name, css_range(bucket)))

    faces.sort()
    lines = [
        "/*",
        " * 自動生成: scripts/build-font-slices.py が書き出す。直接編集しないこと。",
        " *",
        " * Plangothic (SIL OFL 1.1・public/fonts/OFL.txt) を符号位置1024ごとに",
        " * 割ったスライス。unicode-range により、画面に出た字を含むスライスだけを",
        " * ブラウザが取りに行く。端末フォントで描ける字はスタックの前段で解決される",
        f" * ため落ちてこない。全{len(faces)}枚・計{total_bytes / 1024 / 1024:.1f}MB(全部読んだ場合)。",
        " */",
    ]
    for _, name, urange in faces:
        lines += [
            "@font-face {",
            f'  font-family: "{FAMILY}";',
            f'  src: url("/fonts/plangothic/{name}") format("woff2");',
            "  font-display: swap;",
            f"  unicode-range: {urange};",
            "}",
        ]
    OUT_CSS.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(
        f"\nwrote {OUT_CSS.relative_to(ROOT)} ({len(faces)} faces) / "
        f"{OUT_FONTS.relative_to(ROOT)} 計 {total_bytes / 1024 / 1024:.1f} MB "
        f"({len(taken)} 字)"
    )


if __name__ == "__main__":
    main()
