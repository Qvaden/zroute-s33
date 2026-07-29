#!/usr/bin/env python3
"""
Рисует иконки для установки на телефон и картинку для превью ссылок.

Запускается один раз — результат лежит в репозитории готовыми файлами,
поэтому для работы сайта Python не нужен. Скрипт нужен только чтобы
перерисовать иконки, если поменяется фирменный цвет или номер сервера.

Запуск:  python3 scripts/make-icons.py
Выход:   public/icons/*.png, public/og.png
"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = "public"
FONT_BOLD = "/usr/share/fonts/dejavu-sans-fonts/DejaVuSans-Bold.ttf"

# Те же цвета, что в src/styles.css
BG_DARK = (10, 11, 13)
ACCENT_FROM = (255, 160, 74)   # #ffa04a
ACCENT_TO = (255, 106, 43)     # #ff6a2b
INK = (20, 16, 12)             # тёмный текст на оранжевом
TEXT = (244, 246, 249)
DIM = (140, 148, 160)


def font(size):
    return ImageFont.truetype(FONT_BOLD, size)


def centered(draw, box, text, fnt, fill):
    """Рисует текст по центру прямоугольника с учётом реальных границ глифов."""
    x0, y0, x1, y1 = box
    l, t, r, b = draw.textbbox((0, 0), text, font=fnt)
    draw.text(
        (x0 + (x1 - x0 - (r - l)) / 2 - l, y0 + (y1 - y0 - (b - t)) / 2 - t),
        text, font=fnt, fill=fill,
    )


def gradient(size, c1, c2):
    """Диагональный градиент — как у плашки «33» в шапке сайта."""
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            px[x, y] = tuple(round(a + (b - a) * t) for a, b in zip(c1, c2))
    return img


def badge(size, corner_ratio=0.22, pad=0):
    """
    Плашка «33»: оранжевый градиент, скруглённые углы, тёмные цифры.

    pad — отступ от краёв в долях размера. Нужен для maskable-иконки:
    Android обрезает её по кругу, и всё важное должно оставаться
    внутри центральных 80 процентов, иначе цифры срежет.
    """
    inner = round(size * (1 - 2 * pad))
    off = round(size * pad)

    tile = gradient(inner, ACCENT_FROM, ACCENT_TO)
    mask = Image.new("L", (inner, inner), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, inner - 1, inner - 1], radius=round(inner * corner_ratio), fill=255
    )

    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    img.paste(tile, (off, off), mask)

    draw = ImageDraw.Draw(img)
    centered(draw, (off, off, off + inner, off + inner), "33", font(round(inner * 0.52)), INK)
    return img


def og_image():
    """Картинка для превью ссылки — её видно, когда сайт кидают в чат."""
    W, H = 1200, 630
    img = Image.new("RGB", (W, H), BG_DARK)
    draw = ImageDraw.Draw(img)

    # Мягкое оранжевое свечение слева сверху, как на сайте.
    glow = Image.new("RGB", (W, H), BG_DARK)
    gd = glow.load()
    for y in range(0, H, 2):
        for x in range(0, W, 2):
            d = ((x / W - 0.08) ** 2 + (y / H - 0.0) ** 2) ** 0.5
            k = max(0.0, 1 - d * 1.9) ** 2 * 0.5
            base = BG_DARK
            c = tuple(round(b + (a - b) * k) for a, b in zip(ACCENT_TO, base))
            for dy in range(2):
                for dx in range(2):
                    if x + dx < W and y + dy < H:
                        gd[x + dx, y + dy] = c
    img = glow
    draw = ImageDraw.Draw(img)

    # Диагональная штриховка справа — единственный фактурный элемент, как в hero.
    for i in range(-H, W, 13):
        draw.line([(W - 260 + i, H), (W - 260 + i + H, 0)], fill=(30, 24, 20), width=3)

    # Плашка
    b = badge(150)
    img.paste(b, (72, 96), b)

    # Плашка уже говорит «33», поэтому в подписи номер не повторяем.
    draw.text((248, 128), "СЕРВЕР 33", font=font(52), fill=TEXT)
    draw.text((250, 190), "неофициальный сайт сообщества", font=font(26), fill=DIM)

    draw.text((72, 300), "Рейтинг альянсов", font=font(78), fill=TEXT)
    draw.text((72, 392), "по итогам VS", font=font(78), fill=ACCENT_TO)

    draw.text((72, 512), "Z ROUTE: REDEMPTION", font=font(30), fill=DIM)
    draw.text((72, 556), "Победа +1  ·  Поражение −1", font=font(30), fill=(110, 118, 130))
    return img


os.makedirs(f"{OUT}/icons", exist_ok=True)

# Обычные иконки
for size in (16, 32, 180, 192, 512):
    badge(size).save(f"{OUT}/icons/icon-{size}.png")
    print(f"  icons/icon-{size}.png")

# Maskable: с отступом, чтобы Android не срезал цифры при обрезке по кругу.
badge(512, corner_ratio=0.5, pad=0.14).save(f"{OUT}/icons/maskable-512.png")
print("  icons/maskable-512.png")

og_image().save(f"{OUT}/og.png")
print("  og.png")
print("\nГотово.")
