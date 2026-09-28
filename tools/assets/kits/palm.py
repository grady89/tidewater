# The palm (TreeKit "palm", the Atoll's tree): a trunk curving up and over in ringed segments of two browns, a
# crown, eight fronds as separate objects — each a folded blade that rises from the crown and droops toward its tip —
# and a cluster of green coconuts. The fronds are a tint mask (the game paints each tree's leaves per instance);
# the coconuts ride with the trunk so they keep their own colour. Parts: trunk, coconuts, frond_0 … frond_7.
import math

from lib import Geo, MASKS, Kit, blob, loft, ring

HEIGHT = 2.6
LEAN = 0.38
FRONDS = 8


def spine(s):
    """The trunk's centre line at s in 0..1 (base to crown)."""
    return (LEAN * s * s, 0.0, HEIGHT * s)


def frond(k, top, shade):
    """One blade: a spine from the crown out along azimuth k, rising a little then drooping; a V fold down its middle."""
    az = 2 * math.pi * k / FRONDS + (0.2 if k % 2 else 0.0)
    ca, sa = math.cos(az), math.sin(az)
    segs = 5
    length = 1.15 + 0.12 * (k % 3) / 2
    left, mid, right = [], [], []
    for i in range(segs + 1):
        s = i / segs
        r = length * s
        z = top[2] + 0.22 * s - (0.95 + 0.1 * (k % 2)) * s * s
        w = 0.26 * math.sin(math.pi * min(1.0, s * 0.95 + 0.05)) ** 0.7
        cx, cy = top[0] + r * ca, top[1] + r * sa
        mid.append((cx, cy, z + 0.035))  # the fold's ridge
        left.append((cx - w * sa, cy + w * ca, z - 0.02))
        right.append((cx + w * sa, cy - w * ca, z - 0.02))
    g = Geo()
    verts, faces, cols = [], [], []
    base = {}

    def v(key, p):
        if key not in base:
            base[key] = len(verts)
            verts.append(p)
        return base[key]
    drop = 0.012  # the underside, a hair below the top so the two sheets never weld
    for i in range(segs):
        for edge, name, col in ((left, "l", shade), (right, "r", MASKS[1] if shade == MASKS[0] else MASKS[2])):
            a, b = v(("m", i), mid[i]), v(("m", i + 1), mid[i + 1])
            c, d = v((name, i + 1), edge[i + 1]), v((name, i), edge[i])
            top_face = (a, d, c, b) if name == "l" else (a, b, c, d)
            faces.append(top_face)
            cols.append(col)
            a2, b2 = v(("mu", i), (mid[i][0], mid[i][1], mid[i][2] - drop)), v(("mu", i + 1), (mid[i + 1][0], mid[i + 1][1], mid[i + 1][2] - drop))
            c2, d2 = v((name + "u", i + 1), (edge[i + 1][0], edge[i + 1][1], edge[i + 1][2] - drop)), v((name + "u", i), (edge[i][0], edge[i][1], edge[i][2] - drop))
            under = (a2, d2, c2, b2) if name == "l" else (a2, b2, c2, d2)
            faces.append(tuple(reversed(under)))
            cols.append(col)
    g.add(verts, faces, cols)
    return g


def build(bpy, palette, look_id):
    kit = Kit("palm", palette, look_id)
    pal = kit.pal
    bark, ring_col, nut = pal["trees"]["trunk"], pal["roofs"][1], pal["trees"]["leaves"][2]
    # The trunk: eight ringed segments along the curve, tapering from 0.12 to 0.075.
    segs = 8
    rings = []
    for i in range(segs + 1):
        s = i / segs
        cx, cy, cz = spine(s)
        rad = 0.12 - 0.045 * s
        rings.append([(cx + p[0], cy + p[1], cz) for p in ring(6, rad, rad, 0.0, phase=i * 0.25)])
    trunk = loft(rings, bark)
    trunk.paint(lambda c, nrm, old: ring_col if int(c[2] / HEIGHT * segs) % 2 and abs(nrm[2]) < 0.7 else old)
    top = spine(1.0)
    trunk.extend(blob(bark, 6, 3, 0.13, 0.13, 0.09, (top[0], top[1], top[2] + 0.02)))  # the crown's knot
    kit.part("trunk", trunk)
    nuts = Geo()
    for k in range(3):
        a = k * 2.1 + 0.4
        nuts.extend(blob(nut, 5, 3, 0.075, 0.075, 0.08, (top[0] + 0.16 * math.cos(a), top[1] + 0.16 * math.sin(a), top[2] - 0.14)))
    kit.part("coconuts", nuts)
    for k in range(FRONDS):
        kit.part(f"frond_{k}", frond(k, (top[0], top[1], top[2] + 0.06), MASKS[0] if k % 2 == 0 else MASKS[1]), mask_preview=pal["trees"]["leaves"][k % len(pal["trees"]["leaves"])])
    return kit.build()
