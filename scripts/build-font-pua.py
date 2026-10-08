#!/usr/bin/env python3
"""分解の中に出てくる「符号化されていない部品」を描くフォントを作る。

    pip install fonttools brotli
    python3 scripts/build-font-pua.py

即 の左（皀から点を取った形）や 鳥 の外側のように、Unicode に字が無い部品がある。
BabelStone IDS はそれを {18} のような番号で書き、ヘッダで番号ごとに
「BabelStone Han PUA」フォントの私用領域の符号位置（{18} → U+F2B4）を示している。
build:data はその符号位置の字を分解にそのまま入れるので、このフォントさえあれば
⑤ や ？ ではなく実際の形で見せられる。

元フォントは5MBあるが、使うのはヘッダにある部品ぶん（120字ほど）だけなので
そこだけ切り出す。Arphic Public License なので、配るときは許諾書を添える
(web/public/fonts・native/assets/fonts の ARPHIC-PUBLIC-LICENSE.txt)。
"""

import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC_FONT = ROOT / "assets-archive/fonts/BabelStoneHanPUA.ttf"
IDS_TXT = ROOT / "data-src/ids/babelstone.txt"
OUT_WEB = ROOT / "web/public/fonts"
OUT_NATIVE = ROOT / "native/assets/fonts"
FAMILY = "KatachiPUA"
LICENSE_NAME = "ARPHIC-PUBLIC-LICENSE.txt"


def component_codepoints() -> list[int]:
    """IDS.TXT のヘッダ "#\\t{18}\\tleft of 即 (F2B4 \\uF2B4)\\t？" から符号位置を拾う"""
    text = IDS_TXT.read_text(encoding="utf-8-sig")
    return sorted(
        {int(m[1], 16) for m in re.finditer(r"^#\t\{\d+\}\t.*?\(([0-9A-F]{4,5})\b", text, re.M)}
    )


def main():
    try:
        from fontTools.ttLib import TTFont
    except ImportError:
        sys.exit("fonttools が要ります: pip install fonttools brotli")

    if not SRC_FONT.exists():
        sys.exit(
            f"元フォントがありません: {SRC_FONT}\n\n"
            "BabelStone Han PUA を assets-archive/fonts/ に置いてください:\n"
            "  https://babelstone.co.uk/Fonts/Download/BabelStoneHanPUA.ttf"
        )

    cps = component_codepoints()
    src = TTFont(SRC_FONT, lazy=True)
    have = set(src.getBestCmap())
    hit = [cp for cp in cps if cp in have]
    print(f"未符号化部品: {len(cps)} 個 / フォントにある: {len(hit)} 個")

    OUT_WEB.mkdir(parents=True, exist_ok=True)
    OUT_NATIVE.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "subset.ttf"
        subprocess.run(
            [sys.executable, "-m", "fontTools.subset", str(SRC_FONT),
             f"--unicodes={','.join(f'{cp:X}' for cp in hit)}",
             "--layout-features=", "--no-hinting", "--desubroutinize",
             "--name-IDs=0,1,2,3,4,5,6,13,14", "--notdef-outline",
             f"--output-file={out}"],
            check=True, capture_output=True,
        )

        # ファミリ名を差し替える(元の名前のまま配ると別物と紛らわしいため)
        f = TTFont(out)
        license_text = f["name"].getDebugName(13) or ""
        for rec in f["name"].names:
            if rec.nameID in (1, 3, 4, 6, 16):
                f["name"].setName(FAMILY, rec.nameID, rec.platformID, rec.platEncID, rec.langID)
        f.save(OUT_NATIVE / f"{FAMILY}.ttf")

        f.flavor = "woff2"
        f.save(OUT_WEB / f"{FAMILY}.woff2")

    # 許諾書はフォントの name テーブル(ID 13)に全文が入っているので、それを書き出す
    for d in (OUT_WEB, OUT_NATIVE):
        (d / LICENSE_NAME).write_text(license_text.replace("\r\n", "\n").strip() + "\n", encoding="utf-8")

    for p in (OUT_WEB / f"{FAMILY}.woff2", OUT_NATIVE / f"{FAMILY}.ttf"):
        print(f"  {p.relative_to(ROOT)}  {p.stat().st_size / 1024:.0f} KB  ({len(hit)} 字)")


if __name__ == "__main__":
    main()
