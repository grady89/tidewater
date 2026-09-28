# The outrigger (BoatKit "outrigger", the Atoll's boat): a slim dugout with a float (ama) on two booms to port — the
# game's +z, where the moorings keep it outboard — and a crab-claw sail between two curved spars from a tack at the
# bow. Parts: hull (the tint mask), trim, float, mast, sail.
import math

from lib import Geo, Kit, box, loft, ring
from _boats import hull, roles, sheet, spar


def build(bpy, palette, look_id):
    kit = Kit("outrigger", palette, look_id)
    r = roles(kit.pal)
    body = hull(r, length=1.3, beam=0.31, depth=0.24, rise=0.1, bottom=0.5, chine=0.9, deck_drop=0.05, fullness=1.8)
    kit.part("hull", body.take(lambda c: c == r["hull"]), mask_preview=r["hull_preview"])
    kit.part("trim", body.take(lambda c: c != r["hull"]))
    # The float: a pointed log 1.1 long abeam to port, and the two booms (with a stanchion each) that carry it.
    rings = []
    for s in range(7):
        t = -1 + 2 * s / 6
        rad = max(0.012, 0.065 * (1 - abs(t) ** 2.5) ** 0.5)
        rings.append([(t * 0.55, 0.62 + p[0], 0.07 + p[1]) for p in [(rad * math.cos(a), rad * math.sin(a)) for a in [2 * math.pi * k / 6 for k in range(6)]]])
    float_ = Geo()
    ama = loft([[(p[0], p[1], p[2]) for p in rg] for rg in rings], r["deck"])
    float_.extend(ama)
    for tx in (-0.28, 0.28):
        float_.extend(box(r["wood"], (0.05, 0.72, 0.035), (tx, 0.3, 0.27)))
        float_.extend(box(r["wood"], (0.03, 0.03, 0.18), (tx, 0.6, 0.18)))
    kit.part("float", float_)
    # The mast leans aft; the two spars of the crab claw spring from a tack at the bow.
    tack = (0.46, 0.0, 0.24)
    upper = (-0.34, 0.0, 1.2)
    lower = (-0.56, 0.0, 0.5)
    mast = spar(r["spars"], (0.1, 0, 0.18), (-0.02, 0, 0.92), 0.02, 0.013)
    mast.extend(spar(r["spars"], tack, upper, 0.013, 0.01))
    mast.extend(spar(r["spars"], tack, lower, 0.013, 0.01))
    kit.part("mast", mast)
    # The claw: from the tack out along both spars, the outer edge bowed in toward the tack between the tips.
    tips = []
    for k in range(6):
        f = k / 5
        x = upper[0] + (lower[0] - upper[0]) * f
        z = upper[2] + (lower[2] - upper[2]) * f
        pull = 0.26 * math.sin(math.pi * f)  # the claw's hollow
        tips.append((x + (tack[0] - x) * pull, z + (tack[2] - z) * pull))
    outline = [(tack[0], tack[2])] + tips
    kit.part("sail", sheet(r["sail"], outline, thickness=0.012, bulge=lambda u, v: -0.05 * math.sin(math.pi * u) ** 0.8, rows=3))
    return kit.build()
