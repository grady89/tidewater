# The longboat (BoatKit "longboat", the Fjord's boat): long and narrow, stem and stern posts rising high and curling
# inboard, a row of round shields along each gunwale, three oars a side, a mast and yard with a square sail in
# vertical stripes. Parts: hull (the tint mask), trim, mast, sail.
import math

from lib import Geo, Kit, loft, ring
from _boats import hull, roles, sheet, spar


def post(color, end, x0, z0):
    """A post rising from the hull's end and curling inboard: a chain of tapering segments along an arc."""
    g = Geo()
    pts = []
    for k in range(6):
        a = k / 5 * math.pi * 1.15  # up, then over and in
        rad = 0.2 - 0.024 * k
        pts.append((x0 + end * (0.05 + rad * math.sin(a) * 0.9), 0.0, z0 + rad * (1 - math.cos(a)) * 1.35))
    for k in range(len(pts) - 1):
        r0 = 0.032 - 0.005 * k
        g.extend(spar_between(color, pts[k], pts[k + 1], max(0.01, r0), max(0.008, r0 - 0.004)))
    return g


def spar_between(color, a, b, r0, r1):
    return spar(color, a, b, r0, r1, n=4)


def shield(color, rim_color, x, side, z):
    """A round shield hung on the gunwale: a hexagonal disc, its boss the rim's colour."""
    face = loft([ring(6, 0.075, 0.075, 0.0), ring(6, 0.075, 0.075, 0.018)], color)
    face.map(lambda p: (x + p[0], side * (0.205 + p[2]), z + p[1]))
    boss = loft([ring(5, 0.022, 0.022, 0.018), ring(5, 0.012, 0.012, 0.03)], rim_color)
    boss.map(lambda p: (x + p[0], side * (0.205 + p[2]), z + p[1]))
    return face.extend(boss)


def build(bpy, palette, look_id):
    kit = Kit("longboat", palette, look_id)
    r = roles(kit.pal)
    body = hull(r, length=1.56, beam=0.4, depth=0.26, rise=0.12, bottom=0.34, chine=0.88, deck_drop=0.06, fullness=2.6)
    kit.part("hull", body.take(lambda c: c == r["hull"]), mask_preview=r["hull_preview"])
    trim = body.take(lambda c: c != r["hull"])
    trim.extend(post(r["deck"], 1, 0.74, 0.34))
    trim.extend(post(r["deck"], -1, -0.74, 0.34))
    for i, x in enumerate((-0.44, -0.22, 0.0, 0.22, 0.44)):
        for side in (-1, 1):
            trim.extend(shield(r["stripe"] if (i + (side > 0)) % 2 else r["sail"], r["trim"], x, side, 0.3))
    for x in (-0.33, -0.03, 0.27):
        for side in (-1, 1):
            trim.extend(spar(r["wood"], (x, side * 0.2, 0.29), (x - 0.12, side * 0.62, 0.02), 0.012, 0.012, n=4))
    kit.part("trim", trim)
    mast = spar(r["spars"], (0.05, 0, 0.2), (0.05, 0, 1.3), 0.024, 0.016)
    mast.extend(spar(r["spars"], (0.03, -0.4, 1.2), (0.03, 0.4, 1.2), 0.014, 0.014))  # the yard, across the boat
    kit.part("mast", mast)
    # The square sail: hung from the yard, five vertical panels in two colours, bellied forward.
    sail = Geo()
    cols = 5
    for c in range(cols):
        y0, y1 = -0.36 + 0.72 * c / cols, -0.36 + 0.72 * (c + 1) / cols
        # a panel in the boat's cross plane (x fixed), made as a sheet in (y, z) then turned into place
        panel = sheet(r["stripe"] if c % 2 else r["sail"], [(y0, 1.18), (y1, 1.18), (y1, 0.56), (y0, 0.56)], thickness=0.012,
                      bulge=lambda u, v, c=c: 0.08 * math.sin(math.pi * min(1, (c + v) / cols)) * math.sin(math.pi * (0.2 + 0.8 * u)), rows=2)
        panel.map(lambda p: (0.04 + p[1], p[0], p[2]))
        sail.extend(panel)
    kit.part("sail", sail)
    return kit.build()
