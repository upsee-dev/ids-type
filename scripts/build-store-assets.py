#!/usr/bin/env python3
"""ストア提出用のグラフィックを書き出す。

    pip install pillow
    python3 scripts/build-store-assets.py

- Google Play のフィーチャーグラフィック（1024×500・PNG）
- スクリーンショットの装飾（実機キャプチャに文言を載せて所定サイズに整える）

実機キャプチャは scripts/capture-screenshots.sh が store/raw/ に集める。
"""
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    sys.exit("Pillow が要ります: pip install pillow")

ROOT = Path(__file__).resolve().parent.parent
LOGO = ROOT / "assets-archive/logo/concept-c-kanji-input-v2-1024.png"
OUT = ROOT / "store"

BG = (0xFB, 0xFB, 0xF9)
INDIGO = (0x44, 0x37, 0xD1)
SKY = (0x34, 0xB5, 0xFC)
INK = (0x1C, 0x19, 0x17)
SUB = (0x57, 0x53, 0x4E)

FONT_B = "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc"
FONT_R = "/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc"


def font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.load_default()


def logo(height):
    im = Image.open(LOGO).convert("RGB")
    # 生成り地ごと切り出す(背景色が同じなので違和感が出ない)
    bbox = (213, 190, 810, 834)
    im = im.crop(bbox)
    w = round(im.width * height / im.height)
    return im.resize((w, height), Image.LANCZOS)


def feature_graphic():
    """Google Play のフィーチャーグラフィック 1024×500。
    Play ストアでは中央付近にアプリ名が重なることがあるので、要素は左右に寄せる。"""
    W, H = 1024, 500
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    d.rectangle([0, H - 8, W, H], fill=INDIGO)
    d.rectangle([0, H - 8, W // 3, H], fill=SKY)

    g = logo(232)
    im.paste(g, (72, (H - g.height) // 2 - 8))

    x = 72 + g.width + 56
    d.text((x, 150), "カタチ入力", font=font(FONT_B, 62), fill=INK)
    d.text((x, 232), "読めない漢字を、見たまま打てる", font=font(FONT_R, 27), fill=SUB)
    d.text((x, 282), "左右＋日＋月 → 明", font=font(FONT_B, 25), fill=INDIGO)
    d.text((x, 324), "Unicodeの全CJK漢字 102,998字", font=font(FONT_R, 22), fill=SUB)
    OUT.mkdir(parents=True, exist_ok=True)
    p = OUT / "feature-graphic.png"
    im.save(p, optimize=True)
    print(f"  {p.relative_to(ROOT)}  {W}×{H}")


def framed(src: Path, size: tuple[int, int], caption: str, sub: str, dst: Path):
    """実機キャプチャを所定サイズの台紙に載せる。
    画面はそのまま(等倍で縮小)置き、上に短い説明を入れる。"""
    W, H = size
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)

    shot = Image.open(src).convert("RGB")
    # 文言のぶん上を空け、残りに収まるよう縮小
    top = round(H * 0.20)
    avail_h = H - top - round(H * 0.04)
    avail_w = round(W * 0.86)
    scale = min(avail_w / shot.width, avail_h / shot.height)
    shot = shot.resize((round(shot.width * scale), round(shot.height * scale)), Image.LANCZOS)
    im.paste(shot, ((W - shot.width) // 2, top))

    # 見出し
    fc = font(FONT_B, round(W * 0.052))
    fs = font(FONT_R, round(W * 0.030))
    tw = d.textlength(caption, font=fc)
    d.text(((W - tw) / 2, round(H * 0.065)), caption, font=fc, fill=INK)
    sw = d.textlength(sub, font=fs)
    d.text(((W - sw) / 2, round(H * 0.128)), sub, font=fs, fill=SUB)

    d.rectangle([0, H - 6, W, H], fill=INDIGO)
    dst.parent.mkdir(parents=True, exist_ok=True)
    im.save(dst, optimize=True)
    print(f"  {dst.relative_to(ROOT)}  {W}×{H}")


# 実機キャプチャ -> 提出サイズ。台紙は各ストアの要求サイズちょうどに作る
SHOTS = [
    # (元画像, 出力先, サイズ, 見出し, 補足)
    ("iphone/1-hero.png", "iphone/01.png", (1320, 2868),
     "読めない漢字を、見たまま打てる", "かたち＋部品で引く。読みは要りません"),
    ("iphone/2-structure.png", "iphone/02.png", (1320, 2868),
     "かたちで絞り込む", "「左右」を選べば、左右に分かれる字だけが並ぶ"),
    ("iphone/3-radicals.png", "iphone/03.png", (1320, 2868),
     "打てない部品も画数から", "かなキーボードでは出せない偏旁・筆画を収録"),
    ("iphone/4-parts.png", "iphone/04.png", (1320, 2868),
     "部品を含む字を全部", "Unicodeの全CJK漢字 102,998字から探せる"),
    ("ipad/1-hero.png", "ipad/01.png", (2064, 2752),
     "読めない漢字を、見たまま打てる", "かたち＋部品で引く。読みは要りません"),
    ("android/1-hero.png", "android/01.png", (1080, 2400),
     "読めない漢字を、見たまま打てる", "かたち＋部品で引く。読みは要りません"),
    ("android/2-system-keyboard.png", "android/02.png", (1080, 2400),
     "どのアプリでも使えます", "システムキーボードとして登録されます"),
    ("android/3-difficult-parts.png", "android/03.png", (1080, 2400),
     "難しい部品も画数から", "拡張漢字の部品もフォント同梱で表示"),
]


if __name__ == "__main__":
    feature_graphic()
    raw = OUT / "raw"
    made = 0
    for src, dst, size, cap, sub in SHOTS:
        s = raw / src
        if not s.exists():
            print(f"  スキップ(元画像なし): {src}")
            continue
        framed(s, size, cap, sub, OUT / "screenshots" / dst)
        made += 1
    print(f"\nスクリーンショット {made} 枚")
