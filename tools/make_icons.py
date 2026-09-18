"""Generate the extension icons (red "no" sign) as PNGs with no dependencies."""
import math
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "icons"
RED = (229, 72, 77)
WHITE = (255, 255, 255)
SS = 4  # supersampling per axis


def shade(x, y, size):
    """Return RGBA for a point in [0,size) space."""
    c = size / 2
    dx, dy = x - c, y - c
    r = math.hypot(dx, dy)
    outer = size * 0.48
    if r > outer:
        return None
    # diagonal bar from top-left to bottom-right, clipped to inner disc
    ring = size * 0.12
    bar_half = size * 0.09
    dist_to_diag = abs(dx - dy) / math.sqrt(2)
    if r < outer - ring and dist_to_diag > bar_half:
        return WHITE
    return RED


def render(size):
    rows = []
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            acc = [0, 0, 0, 0]
            for sy in range(SS):
                for sx in range(SS):
                    col = shade(px + (sx + 0.5) / SS, py + (sy + 0.5) / SS, size)
                    if col:
                        acc[0] += col[0]; acc[1] += col[1]; acc[2] += col[2]; acc[3] += 255
            n = SS * SS
            covered = acc[3] / 255
            if covered:
                row += bytes([round(acc[0] / covered), round(acc[1] / covered), round(acc[2] / covered), round(acc[3] / n)])
            else:
                row += bytes(4)
        rows.append(bytes(row))
    return b"".join(rows)


def png(size, raw):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    for s in (16, 32, 48, 128):
        (OUT / f"icon{s}.png").write_bytes(png(s, render(s)))
        print(f"icons/icon{s}.png")
