"""
Draws the Lony mark: a leaf-shaped "L" in fresh green and teal.
  - the stem is a leaf: light green on top, deep teal below, split by a soft S-curve;
  - the foot is a second leaf, teal to green, resting on the stem with a soft shadow.
Run from mobile/:  python scripts/make-logo.py
Writes the Expo assets and the Android launcher/splash resources.
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SS = 4  # supersampling for smooth edges
ROOT = Path(__file__).resolve().parent.parent
RES = ROOT / 'android/app/src/main/res'

# Palette taken from the original icon, cleaned up.
GREEN = (124, 240, 150)
MINT = (40, 214, 170)
TEAL = (10, 160, 176)
DEEP_TOP = (8, 138, 116)
DEEP_BOTTOM = (4, 54, 66)
WHITE = (255, 255, 255, 255)


def gradient(n: int, start, end, a, b) -> Image.Image:
    """Linear gradient across an n×n canvas from point a (colour start) to point b (colour end)."""
    ys, xs = np.mgrid[0:n, 0:n].astype(np.float32) / n
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    t = ((xs - ax) * dx + (ys - ay) * dy) / (dx * dx + dy * dy)
    t = np.clip(t, 0, 1)[..., None]
    s = np.array(start, np.float32)
    e = np.array(end, np.float32)
    rgb = (s + (e - s) * t).astype(np.uint8)
    alpha = np.full((n, n, 1), 255, np.uint8)
    return Image.fromarray(np.concatenate([rgb, alpha], axis=2), 'RGBA')


def leaf(n: int, box, radii) -> Image.Image:
    """Mask of a rectangle with its own radius per corner (tl, tr, br, bl), in unit coords.
    The outline is traced with an arc at each corner; radii are capped so arcs never overlap."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    tl, tr, br, bl = radii
    # Cap each pair of neighbouring corners to the side they share.
    for side, (i, j) in ((w, (0, 1)), (w, (3, 2)), (h, (0, 3)), (h, (1, 2))):
        r = [tl, tr, br, bl]
        if r[i] + r[j] > side:
            k = side / (r[i] + r[j])
            r[i] *= k
            r[j] *= k
        tl, tr, br, bl = r
    pts = []
    steps = 48
    for (cx, cy, r, a0) in (
        (x0 + tl, y0 + tl, tl, 180),
        (x1 - tr, y0 + tr, tr, 270),
        (x1 - br, y1 - br, br, 0),
        (x0 + bl, y1 - bl, bl, 90),
    ):
        for i in range(steps + 1):
            th = np.radians(a0 + 90 * i / steps)
            pts.append(((cx + r * np.cos(th)) * n, (cy + r * np.sin(th)) * n))
    m = Image.new('L', (n, n), 0)
    ImageDraw.Draw(m).polygon(pts, fill=255)
    return m


def above_curve(n: int, left_y: float, right_y: float, x0: float, x1: float) -> Image.Image:
    """Mask of everything above a soft S-curve running from (x0, left_y) to (x1, right_y)."""
    pts = []
    for i in range(81):
        t = i / 80
        # One smooth sweep: leaves the left edge rising, meets the right edge almost upright.
        w = x1 - x0
        p0, p1, p2, p3 = (x0, left_y), (x0 + w * 0.45, left_y - 0.11), (x1 - w * 0.04, right_y + 0.16), (x1, right_y)
        x = (1 - t) ** 3 * p0[0] + 3 * (1 - t) ** 2 * t * p1[0] + 3 * (1 - t) * t ** 2 * p2[0] + t ** 3 * p3[0]
        y = (1 - t) ** 3 * p0[1] + 3 * (1 - t) ** 2 * t * p1[1] + 3 * (1 - t) * t ** 2 * p2[1] + t ** 3 * p3[1]
        pts.append((x * n, y * n))
    poly = [(0, 0), (n, 0), (n, pts[-1][1]), *reversed(pts), (0, pts[0][1])]
    m = Image.new('L', (n, n), 0)
    ImageDraw.Draw(m).polygon(poly, fill=255)
    return m


def mark(n: int) -> Image.Image:
    """The mark on a transparent n×n canvas (unit box 0..1 fills the canvas)."""
    out = Image.new('RGBA', (n, n), (0, 0, 0, 0))

    stem_box = (0.20, 0.12, 0.53, 0.88)
    stem = leaf(n, stem_box, (0.26, 0.05, 0.12, 0.17))
    foot_box = (0.25, 0.64, 0.82, 0.88)
    foot = leaf(n, foot_box, (0.19, 0.18, 0.04, 0.05))

    # Stem, lower part: deep teal.
    out.paste(gradient(n, DEEP_TOP, DEEP_BOTTOM, (0.53, 0.30), (0.20, 0.86)), (0, 0), stem)
    # Stem, upper leaf: green to teal, above the S-curve.
    top = Image.composite(stem, Image.new('L', (n, n), 0), above_curve(n, 0.66, 0.27, 0.20, 0.53))
    out.paste(gradient(n, GREEN, TEAL, (0.53, 0.12), (0.20, 0.64)), (0, 0), top)

    # Soft shadow of the foot over the stem, for depth.
    shadow = foot.filter(ImageFilter.GaussianBlur(n * 0.025))
    shadow = Image.composite(shadow, Image.new('L', (n, n), 0), stem)
    out.paste(Image.new('RGBA', (n, n), (0, 30, 36, 255)), (0, -int(n * 0.012)), shadow.point(lambda v: int(v * 0.45)))

    # Foot leaf: teal to green.
    out.paste(gradient(n, TEAL, GREEN, (0.30, 0.88), (0.80, 0.64)), (0, 0), foot)
    return out


def render(px: int, *, mark_scale=0.8, bg=None, shape='square', corner=0.225) -> Image.Image:
    n = px * SS
    img = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    if bg is not None:
        d = ImageDraw.Draw(img)
        if shape == 'square':
            d.rectangle([0, 0, n, n], fill=bg)
        elif shape == 'rounded':
            d.rounded_rectangle([0, 0, n - 1, n - 1], radius=corner * n, fill=bg)
        elif shape == 'circle':
            d.ellipse([0, 0, n - 1, n - 1], fill=bg)
    m = int(n * mark_scale)
    img.alpha_composite(mark(m), ((n - m) // 2, (n - m) // 2))
    return img.resize((px, px), Image.LANCZOS)


def save(img: Image.Image, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.suffix == '.webp':
        img.save(path, 'WEBP', lossless=True)
    else:
        img.save(path, 'PNG', optimize=True)
    print('wrote', path.relative_to(ROOT), img.size)


if __name__ == '__main__':
    assets = ROOT / 'assets'
    # Store / iOS icon: white square (the system rounds it).
    save(render(1024, bg=WHITE, shape='square', mark_scale=0.78), assets / 'icon.png')
    # Android adaptive foreground: transparent, inside the safe zone (background colour is white).
    save(render(1024, mark_scale=0.6), assets / 'adaptive-icon.png')
    # Splash and in-app logos: the mark alone.
    save(render(1024, mark_scale=0.7), assets / 'splash-icon.png')
    for name in ('lony-logo.png', 'logo.png'):
        save(render(1024, mark_scale=0.9), assets / name)

    densities = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
    for dens, k in densities.items():
        legacy = int(48 * k)
        save(render(legacy, bg=WHITE, shape='rounded', mark_scale=0.74), RES / f'mipmap-{dens}/ic_launcher.webp')
        save(render(legacy, bg=WHITE, shape='circle', mark_scale=0.66), RES / f'mipmap-{dens}/ic_launcher_round.webp')
        save(render(int(108 * k), mark_scale=0.6), RES / f'mipmap-{dens}/ic_launcher_foreground.webp')

    splash = {'mdpi': 288, 'hdpi': 432, 'xhdpi': 576, 'xxhdpi': 864, 'xxxhdpi': 1152}
    for dens, px in splash.items():
        save(render(px, mark_scale=0.7), RES / f'drawable-{dens}/splashscreen_logo.png')
