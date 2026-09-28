# The dory (BoatKit "dory", Tidewater's boat): after reference/boat, the primitive kit's proportions — a
# double-ended planked hull 1.24 cells long and half a cell wide, a dark waterline band, a pale gunwale, two thwarts
# and a coil of net, a mast with a boom and a tall bellied triangular sail. Parts: hull (the tint mask the game
# paints per boat), trim, mast, sail.
import math

from lib import Kit, blob, box
from _boats import hull, roles, sheet, spar


def build(bpy, palette, look_id):
    kit = Kit("dory", palette, look_id)
    r = roles(kit.pal)
    body = hull(r, length=1.24, beam=0.5, depth=0.28, rise=0.07)
    kit.part("hull", body.take(lambda c: c == r["hull"]), mask_preview=r["hull_preview"])
    trim = body.take(lambda c: c != r["hull"])
    for tx in (-0.3, 0.32):
        trim.extend(box(r["wood"], (0.08, 0.36, 0.03), (tx, 0, 0.245)))
    trim.extend(blob(r["wood"], 6, 3, 0.13, 0.1, 0.05, (-0.42, 0.04, 0.26)))  # the coil of net
    trim.extend(box(r["deck"], (0.05, 0.02, 0.2), (-0.66, 0, 0.14)))  # the rudder
    kit.part("trim", trim)
    mast = spar(r["spars"], (0.1, 0, 0.2), (0.1, 0, 1.36), 0.024, 0.014, n=5)
    mast.extend(spar(r["spars"], (0.1, 0, 0.46), (-0.52, 0, 0.46), 0.016, 0.012, n=5))  # the boom
    kit.part("mast", mast)
    # The sail: tack at the foot of the mast, head at the masthead, clew at the boom's end; a belly to leeward.
    outline = [(0.08, 0.5), (0.1, 1.33), (-0.1, 1.02), (-0.3, 0.74), (-0.5, 0.49)]
    sail = sheet(r["sail"], outline, thickness=0.012, bulge=lambda u, v: -0.07 * math.sin(math.pi * u) ** 0.8 * (0.3 + 0.7 * math.sin(math.pi * min(1, v)) ** 0.5), rows=3)
    kit.part("sail", sail)
    return kit.build()
