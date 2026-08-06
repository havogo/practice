#!/usr/bin/env python3
"""Generate the app icons.

Writes icons/icon.svg plus the PNG sizes iOS and Android ask for. PNGs are
encoded by hand (zlib + struct) so the project needs no imaging library.

Usage: python3 tools/make_icons.py
"""

import os
import struct
import zlib

BRAND = (14, 101, 114)      # --brand-600
BRAND_DARK = (11, 81, 92)   # --brand-700
WHITE = (255, 255, 255)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "icons")

SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#17808c"/>
      <stop offset="1" stop-color="#0b515c"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#g)"/>
  <g fill="none" stroke="#ffffff" stroke-width="34" stroke-linecap="round" stroke-linejoin="round">
    <path d="M170 150v212"/>
    <path d="M170 150h56a52 52 0 0 1 0 104h-56"/>
    <path d="M232 262l116 110"/>
    <path d="M248 372l92 -100"/>
  </g>
</svg>
"""


def png_chunk(tag, data):
    return (struct.pack(">I", len(data)) + tag + data +
            struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))


def write_png(path, pixels, width, height):
    """`pixels` is a flat list of (r, g, b, a) rows-major."""
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter type 0
        for x in range(width):
            raw.extend(pixels[y * width + x])

    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)  # 8-bit RGBA
    body = (b"\x89PNG\r\n\x1a\n" +
            png_chunk(b"IHDR", header) +
            png_chunk(b"IDAT", zlib.compress(bytes(raw), 9)) +
            png_chunk(b"IEND", b""))
    with open(path, "wb") as fh:
        fh.write(body)


def blend(bottom, top, alpha):
    return tuple(round(b + (t - b) * alpha) for b, t in zip(bottom, top))


def coverage(px, py, inside, samples=3):
    """Anti-alias by sampling a few points inside each pixel."""
    hits = 0
    step = 1.0 / (samples + 1)
    for i in range(1, samples + 1):
        for j in range(1, samples + 1):
            if inside(px + i * step, py + j * step):
                hits += 1
    return hits / (samples * samples)


def rounded_square(size, radius):
    def inside(x, y):
        cx = min(max(x, radius), size - radius)
        cy = min(max(y, radius), size - radius)
        return (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius
    return inside


def stroke_segment(x1, y1, x2, y2, width):
    """Distance to a capsule: a line segment thickened by `width`."""
    half = width / 2
    dx, dy = x2 - x1, y2 - y1
    length_sq = dx * dx + dy * dy

    def inside(x, y):
        if length_sq == 0:
            t = 0.0
        else:
            t = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / length_sq))
        px, py = x1 + t * dx, y1 + t * dy
        return (x - px) ** 2 + (y - py) ** 2 <= half * half
    return inside


def ring_arc(cx, cy, radius, width, start_deg, end_deg):
    """The bowl of the R: an arc from start to end, measured clockwise."""
    half = width / 2
    import math

    def inside(x, y):
        d = math.hypot(x - cx, y - cy)
        if abs(d - radius) > half:
            return False
        angle = math.degrees(math.atan2(y - cy, x - cx)) % 360
        if start_deg <= end_deg:
            return start_deg <= angle <= end_deg
        return angle >= start_deg or angle <= end_deg
    return inside


def render(size, *, maskable=False):
    s = size / 512.0
    radius = (size * 0.5) if maskable else (112 * s)
    # A maskable icon must keep its mark inside the safe circle, so shrink it.
    scale = 0.78 if maskable else 1.0
    offset = (1 - scale) * 256

    def tx(v):
        return (offset + v * scale) * s

    bg = rounded_square(size, radius)
    stroke = 34 * s * scale

    marks = [
        stroke_segment(tx(170), tx(150), tx(170), tx(362), stroke),   # stem of R
        stroke_segment(tx(170), tx(150), tx(226), tx(150), stroke),   # top of bowl
        stroke_segment(tx(170), tx(254), tx(226), tx(254), stroke),   # bottom of bowl
        ring_arc((tx(226)), (tx(202)), 52 * s * scale, stroke, 270, 90),
        stroke_segment(tx(232), tx(262), tx(348), tx(372), stroke),   # descending leg
        stroke_segment(tx(248), tx(372), tx(340), tx(272), stroke),   # bar that crosses it
    ]

    pixels = []
    for y in range(size):
        for x in range(size):
            a = coverage(x, y, bg)
            if a <= 0:
                pixels.append((0, 0, 0, 0))
                continue
            # Vertical gradient across the tile.
            t = y / max(size - 1, 1)
            base = blend((23, 128, 140), BRAND_DARK, t)
            mark = max((coverage(x, y, m) for m in marks), default=0.0)
            colour = blend(base, WHITE, mark) if mark else base
            pixels.append((*colour, round(255 * a)))
    return pixels


def main():
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "icon.svg"), "w", encoding="utf-8") as fh:
        fh.write(SVG)
    print("icons/icon.svg")

    for size, name in [(180, "icon-180.png"), (192, "icon-192.png"), (512, "icon-512.png")]:
        write_png(os.path.join(OUT, name), render(size), size, size)
        print(f"icons/{name}")

    write_png(os.path.join(OUT, "icon-maskable-512.png"), render(512, maskable=True), 512, 512)
    print("icons/icon-maskable-512.png")


if __name__ == "__main__":
    main()
