#!/usr/bin/env python3
"""部品パレットの字だけを含むサブセットフォントを作る。

    pip install fonttools brotli
    python3 scripts/build-font-subset.py

「難輸入部件」541件には拡張B〜Hの字が多く、端末の標準フォントには入っていない
（macOS でも117件が □ になる。Android はもっと多い）。部品パレットは
「見て選ぶ」ための画面なので、□ が並ぶと機能そのものが成立しない。

そこで Plangothic（SIL OFL 1.1・拡張A〜Iを収録）から**パレットの字だけ**を
切り出して同梱する。全部入れると32MBだが、541字なら数十KBで済む。
フォントに無い字はブラウザ/OSが次のフォントにフォールバックするので、
このサブセットをフォントスタックの先頭に置けばよい。
"""

import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PALETTE_TS = ROOT / "core/data/palettes.ts"
SRC_FONTS = [ROOT / "assets-archive/fonts/PlangothicP1-Regular.ttf",
             ROOT / "assets-archive/fonts/PlangothicP2-Regular.ttf"]
OUT_WEB = ROOT / "web/public/fonts"
OUT_NATIVE = ROOT / "native/assets/fonts"
FAMILY = "KatachiParts"


def palette_chars() -> list[str]:
    """core/data/palettes.ts から部品を全部拾う(RADICAL_PALETTE と DIFFICULT_COMPONENTS)"""
    src = PALETTE_TS.read_text(encoding="utf-8")
    chars = "".join(re.findall(r'parts: "([^"]*)"', src))
    chars += "".join(re.findall(r'^\s*"(.+?)",\s*$', src, re.M))
    return list(dict.fromkeys(c for c in chars if not c.isascii()))


def main():
    try:
        from fontTools.ttLib import TTFont
        from fontTools.merge import Merger
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

    chars = palette_chars()
    print(f"部品パレット: {len(chars)} 字")

    OUT_WEB.mkdir(parents=True, exist_ok=True)
    OUT_NATIVE.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp:
        subsets = []
        for src in SRC_FONTS:
            cmap = set(TTFont(src, lazy=True).getBestCmap())
            hit = [c for c in chars if ord(c) in cmap]
            if not hit:
                continue
            out = Path(tmp) / f"{src.stem}-subset.ttf"
            subprocess.run(
                [sys.executable, "-m", "fontTools.subset", str(src),
                 f"--text={''.join(hit)}",
                 "--layout-features=", "--no-hinting", "--desubroutinize",
                 "--name-IDs=0,1,2,3,4,5,6,13,14", "--notdef-outline",
                 f"--output-file={out}"],
                check=True, capture_output=True,
            )
            print(f"  {src.name}: {len(hit)} 字を切り出し")
            subsets.append(out)

        merged = Path(tmp) / "merged.ttf"
        if len(subsets) > 1:
            Merger().merge([str(p) for p in subsets]).save(merged)
        else:
            merged = subsets[0]

        # ファミリ名を差し替える(元の名前のまま配ると別物と紛らわしいため)
        f = TTFont(merged)
        for rec in f["name"].names:
            if rec.nameID in (1, 3, 4, 6, 16):
                f["name"].setName(FAMILY, rec.nameID, rec.platformID, rec.platEncID, rec.langID)
        f.save(OUT_NATIVE / f"{FAMILY}.ttf")

        f.flavor = "woff2"
        f.save(OUT_WEB / f"{FAMILY}.woff2")

    covered = len(TTFont(OUT_NATIVE / f"{FAMILY}.ttf", lazy=True).getBestCmap())
    for p in (OUT_WEB / f"{FAMILY}.woff2", OUT_NATIVE / f"{FAMILY}.ttf"):
        print(f"  {p.relative_to(ROOT)}  {p.stat().st_size / 1024:.0f} KB  ({covered} 字)")
    print(f"\n収録できなかった {len(chars) - covered} 字は端末のフォントにフォールバックする")


if __name__ == "__main__":
    main()
