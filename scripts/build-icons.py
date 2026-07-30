#!/usr/bin/env python3
"""ロゴ1枚から Web/iOS/Android の配布用アイコン一式を書き出す。

    pip install pillow
    python3 scripts/build-icons.py

用途ごとに「キャンバスに対するロゴの大きさ」を変えて置き直している。
小さいアイコンほどロゴを大きく、マスクで外周が削られるアイコンほど小さくする。

ロゴは中央に「漢」の窓を持つ。単純に背景色を抜くとこの窓まで穴になるので、
不透過でよい書き出し(iOS・Web)は元画像をそのまま切り出して生成り地に置き、
透過が要る書き出し(Android前景・モノクロ・スプラッシュ)だけ、
画像の縁から flood fill して「外側の背景」だけを抜いている。
"""

import struct
import sys
from collections import deque
from io import BytesIO
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps
except ImportError:
    sys.exit("Pillow が要ります: pip install pillow")

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets-archive/logo/concept-c-kanji-input-v2-1024.png"

# ロゴから拾ったブランド色
BG = (0xFB, 0xFB, 0xF9)  # 生成り
INDIGO = (0x44, 0x37, 0xD1)
SKY = (0x34, 0xB5, 0xFC)

JP_FONT = "/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc"
FLOOD_TOL = 18  # 背景とみなす色の許容差
SEAL = 8  # 「漢」の窓と外周をつなぐ隙間を塞ぐ半径(px, 1024基準)


def outer_mask(im: Image.Image) -> bytearray:
    """画像の縁から flood fill して「ロゴの外側の背景」を 1 にしたマスクを返す。

    中央の「漢」の窓は生成り色で、外周とは細い隙間でつながっている。素直に flood fill
    すると窓まで抜けてしまい、透過を使う書き出し(Android前景・スプラッシュ)で
    窓が背景色に染まる。ダークなスプラッシュ地では窓の中の「漢」が沈んで見えなくなる。
    そこで flood fill の前に「ロゴ形状のクロージング(膨張→収縮)」で細い隙間だけを塞ぎ、
    窓を外周から切り離してから塗る。膨張のあと同量収縮するので輪郭は元のまま。
    """
    w, h = im.size
    px = im.load()

    # 1) 色だけで「背景っぽい画素」を拾う(連結は見ない)
    bg_like = Image.new("L", (w, h), 0)
    bg_like.putdata(
        [
            255
            if (
                abs(p[0] - BG[0]) <= FLOOD_TOL
                and abs(p[1] - BG[1]) <= FLOOD_TOL
                and abs(p[2] - BG[2]) <= FLOOD_TOL
            )
            else 0
            for p in im.getdata()
        ]
    )
    # 2) ロゴ形状をクロージングして、SEAL 幅未満の隙間を塞ぐ
    k = SEAL * 2 + 1
    glyph = ImageOps.invert(bg_like)
    sealed = glyph.filter(ImageFilter.MaxFilter(k)).filter(ImageFilter.MinFilter(k))
    sealed_px = sealed.load()

    # 3) 塞いだ形状の外側だけを縁から塗る
    seen = bytearray(w * h)
    dq = deque()

    def open_at(x, y):
        return sealed_px[x, y] < 128  # 背景側

    for x in range(w):
        for y in (0, h - 1):
            if not seen[y * w + x] and open_at(x, y):
                seen[y * w + x] = 1
                dq.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if not seen[y * w + x] and open_at(x, y):
                seen[y * w + x] = 1
                dq.append((x, y))
    while dq:
        x, y = dq.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx] and open_at(nx, ny):
                seen[ny * w + nx] = 1
                dq.append((nx, ny))

    # 4) クロージングで太らせたぶんを戻す。いま外側と判定できている画素から、
    #    「素の色判定で背景」の画素だけをたどり直す(窓は隙間を塞いだので届かない)
    bg_px = bg_like.load()
    dq = deque(
        (i % w, i // w) for i, v in enumerate(seen) if v
    )
    while dq:
        x, y = dq.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if (
                0 <= nx < w
                and 0 <= ny < h
                and not seen[ny * w + nx]
                and bg_px[nx, ny]
            ):
                seen[ny * w + nx] = 1
                dq.append((nx, ny))
    return seen


def bbox_of(im: Image.Image, outer: bytearray) -> tuple[int, int, int, int]:
    w, h = im.size
    xs0, ys0, xs1, ys1 = w, h, -1, -1
    for i, v in enumerate(outer):
        if v:
            continue
        x, y = i % w, i // w
        xs0, ys0 = min(xs0, x), min(ys0, y)
        xs1, ys1 = max(xs1, x), max(ys1, y)
    return xs0, ys0, xs1 + 1, ys1 + 1


def cutout(im: Image.Image, outer: bytearray, box) -> Image.Image:
    """外側だけ透過した RGBA。窓はロゴの一部として不透過のまま残す。"""
    w, h = im.size
    alpha = Image.new("L", (w, h), 255)
    alpha.putdata([0 if v else 255 for v in outer])
    # flood fill の境界は 1px 硬くなるので、わずかにぼかして輪郭をなじませる
    alpha = alpha.filter(ImageFilter.GaussianBlur(0.6))
    rgba = im.convert("RGBA")
    rgba.putalpha(alpha)
    return rgba.crop(box)


def ink_cutout(im: Image.Image, outer: bytearray, box) -> Image.Image:
    """Android 13+ のテーマアイコン用。塗りの濃さをそのまま alpha にするので、
    外形は塗りつぶし・中央の窓は抜け・「漢」は線として残る。色は黒一色。"""
    w, h = im.size
    px = im.load()
    a = []
    for i, v in enumerate(outer):
        if v:
            a.append(0)
            continue
        r, g, b = px[i % w, i // w]
        d = max(abs(r - BG[0]), abs(g - BG[1]), abs(b - BG[2])) / 255 * 1.6
        a.append(min(255, round(d * 255)))
    alpha = Image.new("L", (w, h))
    alpha.putdata(a)
    solid = Image.new("RGBA", (w, h), (0, 0, 0, 255))
    solid.putalpha(alpha)
    return solid.crop(box)


def fit(art: Image.Image, size: int, ratio: float) -> Image.Image:
    """size*ratio に収まるよう縮小した art を返す。"""
    scale = size * ratio / max(art.size)
    return art.resize(
        (max(1, round(art.width * scale)), max(1, round(art.height * scale))),
        Image.LANCZOS,
    )


def on_bg(art: Image.Image, size: int, ratio: float) -> Image.Image:
    """生成り地の不透過キャンバス中央に置く(iOS・Web 用。透過を持たせない)。"""
    canvas = Image.new("RGB", (size, size), BG)
    a = fit(art, size, ratio)
    canvas.paste(a, ((size - a.width) // 2, (size - a.height) // 2), a if a.mode == "RGBA" else None)
    return canvas


def on_clear(art: Image.Image, size: int, ratio: float) -> Image.Image:
    """透過キャンバス中央に置く(Android 前景・モノクロ・スプラッシュ用)。"""
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    a = fit(art, size, ratio)
    canvas.alpha_composite(a, ((size - a.width) // 2, (size - a.height) // 2))
    return canvas


def png_bytes(im: Image.Image) -> bytes:
    b = BytesIO()
    im.save(b, format="PNG", optimize=True)
    return b.getvalue()


def save_ico(art: Image.Image, path: Path, sizes=(16, 32, 48)):
    """favicon.ico。小さいほど字面を大きくしないと潰れるので size ごとに比率を変える。
    Pillow の ICO 書き出しは最大サイズから縮小してしまうので自前で組む。"""
    bufs = []
    for s in sizes:
        ratio = 0.90 if s <= 16 else 0.84 if s <= 32 else 0.80
        bufs.append(png_bytes(on_bg(art, s, ratio).convert("RGBA")))
    header = struct.pack("<HHH", 0, 1, len(bufs))
    offset = 6 + 16 * len(bufs)
    entries, data = b"", b""
    for s, buf in zip(sizes, bufs):
        entries += struct.pack("<BBBBHHII", s, s, 0, 0, 1, 32, len(buf), offset)
        offset += len(buf)
        data += buf
    path.write_bytes(header + entries + data)


def og_image(art: Image.Image, path: Path):
    """OGP カード。ロゴ＋アプリ名＋一行説明。"""
    W, H = 1200, 630
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    d.rectangle([0, H - 10, W, H], fill=INDIGO)
    d.rectangle([0, H - 10, W // 3, H], fill=SKY)

    g = fit(art, 1024, 0.30)  # 約 300px
    im.paste(g, (96, (H - g.height) // 2 - 10), g if g.mode == "RGBA" else None)

    try:
        title = ImageFont.truetype(JP_FONT, 76)
        sub = ImageFont.truetype(JP_FONT, 34)
        small = ImageFont.truetype(JP_FONT, 27)
    except OSError:
        title = sub = small = ImageFont.load_default()

    x = 96 + g.width + 72
    d.text((x, 214), "カタチ入力", font=title, fill=(0x1C, 0x19, 0x17))
    d.text((x, 316), "読めない漢字を、見たまま打てる", font=sub, fill=(0x57, 0x53, 0x4E))
    d.text((x, 372), "LR日月 → 明     UD宀子 → 字", font=small, fill=INDIGO)
    im.save(path, optimize=True)


def main():
    if not SRC.exists():
        sys.exit(f"元画像が見つかりません: {SRC}")
    src = Image.open(SRC).convert("RGB")
    print(f"元画像: {SRC.relative_to(ROOT)}  {src.width}×{src.height}")

    outer = outer_mask(src)
    box = bbox_of(src, outer)
    print(f"ロゴ範囲: {box}  ({box[2] - box[0]}×{box[3] - box[1]})")

    flat = src.crop(box)  # 不透過用: 生成り地ごと切り出す
    clear = cutout(src, outer, box)  # 透過用
    ink = ink_cutout(src, outer, box)  # モノクロ用

    native = ROOT / "native/assets"
    app = ROOT / "web/src/app"
    pub = ROOT / "web/public"

    jobs = [
        # --- Expo アプリ ---
        # iOS のアプリアイコンは透過を持てないので生成り地に焼き込む
        (native / "icon.png", on_bg(flat, 1024, 0.62)),
        # Android アダプティブアイコン。外周はマスクで削られるので内側 58% に収める
        (native / "android-icon-foreground.png", on_clear(clear, 1024, 0.58)),
        (native / "android-icon-background.png", Image.new("RGB", (1024, 1024), BG)),
        (native / "android-icon-monochrome.png", on_clear(ink, 1024, 0.58)),
        (native / "splash-icon.png", on_clear(clear, 1024, 0.45)),
        (native / "favicon.png", on_bg(flat, 48, 0.82)),
        # --- Web(Next.js の app ディレクトリ規約) ---
        (app / "icon.png", on_bg(flat, 512, 0.68)),
        (app / "apple-icon.png", on_bg(flat, 180, 0.68)),
        # --- PWA(manifest から参照) ---
        (pub / "icon-192.png", on_bg(flat, 192, 0.70)),
        (pub / "icon-512.png", on_bg(flat, 512, 0.68)),
        # maskable は外周 20% が削られる前提。安全域に収まるよう小さめに置く
        (pub / "icon-maskable-512.png", on_bg(flat, 512, 0.50)),
    ]
    for path, im in jobs:
        path.parent.mkdir(parents=True, exist_ok=True)
        im.save(path, optimize=True)
        print(f"  {path.relative_to(ROOT)}  {im.width}×{im.height}  {im.mode}")

    save_ico(flat, app / "favicon.ico")
    print(f"  {(app / 'favicon.ico').relative_to(ROOT)}  16/32/48")

    og_image(clear, app / "opengraph-image.png")
    print(f"  {(app / 'opengraph-image.png').relative_to(ROOT)}  1200×630")


if __name__ == "__main__":
    main()
