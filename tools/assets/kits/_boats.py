# Shared by the three boat kits: the palette roles a boat is painted with, and the planked hull loft.
#
# Roles (the same for every boat and look, so a recolour is the palette alone — docs/assets/decisions.md):
#   band    the waterline band and bottom          roofs[1]
#   trim    gunwale rail and inner walls           accents.trim
#   deck    the floor boards and the posts        trees.trunk
#   wood    thwarts, oars, booms, the net's rope   terrain.sandDeep
#   spars   mast, boom, yard                       trees.trunk
#   sail    the palest of the walls and the sand   (by luminance)
#   stripe  a sail's stripe, a shield's paint      accents.door
#   hull    the upper strakes: a tint mask (#ffffff) the game paints per boat; the turntable shows accents.door
import math

from lib import Geo, MASKS, srgb


def luminance(h):
    r, g, b = srgb(h)
    return 0.299 * r + 0.587 * g + 0.114 * b


def roles(pal):
    sail = max(list(pal["walls"]) + [pal["terrain"]["sand"]], key=luminance)
    return {
        "band": pal["roofs"][1], "trim": pal["accents"]["trim"], "deck": pal["trees"]["trunk"],
        "wood": pal["terrain"]["sandDeep"], "spars": pal["trees"]["trunk"], "sail": sail,
        "stripe": pal["accents"]["door"], "hull": MASKS[0], "hull_preview": pal["accents"]["door"],
    }


def hull(r, length, beam, depth, rise, stations=9, bottom=0.36, chine=0.86, deck_drop=0.07, fullness=2.2):
    """
    The hull as one closed loft of eight-point sections from stern (x = -length/2) to bow: upper strakes (the tint
    mask), chine and bottom (the band), the gunwale's inner walls (trim) and the deck set down inside them. The
    sheer rises `rise` toward both ends; the ends close to a narrow stem. Returns the loft; split it by colour.
    """
    rings = []
    for s in range(stations):
        t = -1 + 2 * s / (stations - 1)
        x = t * length / 2
        half = max(0.012, beam / 2 * (1 - abs(t) ** fullness) ** 0.5)
        sheer = depth + rise * t * t
        keel = 0.06 * depth * t * t
        chine_z = keel + (sheer - keel) * 0.42
        w = half * bottom
        c = half * chine
        rings.append([
            (x, half, sheer), (x, c, chine_z), (x, w, keel), (x, -w, keel),
            (x, -c, chine_z), (x, -half, sheer), (x, -half * 0.8, sheer - deck_drop), (x, half * 0.8, sheer - deck_drop),
        ])
    colors = [r["hull"], r["band"], r["band"], r["band"], r["hull"], r["trim"], r["deck"], r["trim"]]
    g = Geo()
    n = 8
    verts = [p for ring in rings for p in ring]
    faces, cols = [], []
    for a in range(len(rings) - 1):
        for k in range(n):
            i0, i1 = a * n + k, a * n + (k + 1) % n
            faces.append((i0, i1, i1 + n, i0 + n))
            cols.append(colors[k])
    faces.append(tuple(reversed(range(n))))
    cols.append(r["trim"])
    last = (len(rings) - 1) * n
    faces.append(tuple(last + k for k in range(n)))
    cols.append(r["trim"])
    g.add(verts, faces, cols)
    return g.orient_outward()


def sheet(color, pts, thickness=0.012, bulge=None, rows=3):
    """
    A sail or a membrane: a triangle-fan-free patch over the polygon `pts` (x, z in the boat's centre plane),
    subdivided into `rows` bands from its first point, pushed sideways by bulge(u, v) for a belly, and given a
    back face `thickness` behind it and a rim, so it reads from both sides under back-face culling.
    """
    # Build rows of points between the first point (the tack) and the rest of the outline.
    tack = pts[0]
    rim = pts[1:]
    grid = [[tack]]
    for k in range(1, rows + 1):
        f = k / rows
        grid.append([(tack[0] + (p[0] - tack[0]) * f, tack[1] + (p[1] - tack[1]) * f) for p in rim])
    front = Geo()
    verts, faces = [], []
    index = {}

    def vid(row, col, side):
        key = (row, col if row else 0, side)
        if key in index:
            return index[key]
        x, z = grid[row][col if row else 0]
        u = row / rows
        v = (col / (len(rim) - 1)) if len(rim) > 1 else 0
        y = bulge(u, v) if bulge else 0.0
        index[key] = len(verts)
        verts.append((x, y + (thickness if side else 0.0), z))
        return index[key]

    for side in (0, 1):
        for row in range(rows):
            for col in range(len(rim) - 1):
                a, b = vid(row, col, side), vid(row, col + 1, side)
                c, d = vid(row + 1, col + 1, side), vid(row + 1, col, side)
                quad = [a, b, c, d] if row else [a, c, d]
                faces.append(tuple(quad) if side == 0 else tuple(reversed(quad)))
    # The rim: the outer edge and the two sides back to the tack, joined front to back.
    edge = [(rows, c) for c in range(len(rim))]
    edge += [(r_, len(rim) - 1) for r_ in range(rows - 1, 0, -1)] + [(0, 0)] + [(r_, 0) for r_ in range(1, rows)]
    for k in range(len(edge)):
        (r0, c0), (r1, c1) = edge[k], edge[(k + 1) % len(edge)]
        a, b = vid(r0, c0, 0), vid(r1, c1, 0)
        faces.append((a, b, vid(r1, c1, 1), vid(r0, c0, 1)))
    front.add(verts, faces, color)
    return front.orient_outward()


def spar(color, p0, p1, r0, r1=None, n=5):
    """A tapered round spar from p0 to p1 (3D points)."""
    r1 = r0 if r1 is None else r1
    d = [p1[k] - p0[k] for k in range(3)]
    length = math.sqrt(sum(c * c for c in d)) or 1.0
    ax = [c / length for c in d]
    helper = (0, 0, 1) if abs(ax[2]) < 0.9 else (1, 0, 0)
    u = [ax[1] * helper[2] - ax[2] * helper[1], ax[2] * helper[0] - ax[0] * helper[2], ax[0] * helper[1] - ax[1] * helper[0]]
    ul = math.sqrt(sum(c * c for c in u))
    u = [c / ul for c in u]
    v = [ax[1] * u[2] - ax[2] * u[1], ax[2] * u[0] - ax[0] * u[2], ax[0] * u[1] - ax[1] * u[0]]
    rings = []
    for p, r in ((p0, r0), (p1, r1)):
        rings.append([tuple(p[k] + r * (math.cos(2 * math.pi * j / n) * u[k] + math.sin(2 * math.pi * j / n) * v[k]) for k in range(3)) for j in range(n)])
    from lib import loft
    return loft(rings, color)
