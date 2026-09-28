# The whale (FaunaKind "whales", the Fjord's): the long surfacing back of a baleen whale — a blunt head, a low dorsal
# fin two thirds aft, the tail stock narrowing to flat flukes, a pale throat — and its spout as a separate object
# (the game raises and scales the spout on its own). Parts: back, spout.
import math

from lib import Geo, Kit, blob, loft


def build(bpy, palette, look_id):
    kit = Kit("whale", palette, look_id)
    pal = kit.pal
    dark, pale, mid = pal["roofs"][3], pal["terrain"]["snow"], pal["terrain"]["rock"]
    # The body: elliptical sections from the tail stock (x = -1.2) to the rounded head (x = +1.2).
    rings = []
    stations = [(-1.2, 0.06, 0.05), (-0.95, 0.13, 0.1), (-0.6, 0.27, 0.19), (-0.2, 0.38, 0.25), (0.2, 0.42, 0.27),
                (0.6, 0.4, 0.25), (0.92, 0.32, 0.2), (1.12, 0.2, 0.13), (1.22, 0.08, 0.06)]
    n = 10
    for x, half_w, half_h in stations:
        pts = []
        for k in range(n):
            a = 2 * math.pi * k / n
            y = half_w * math.cos(a)
            z = half_h * math.sin(a)
            if z < 0:
                z *= 0.8  # a flatter belly
            pts.append((x, y, z))
        rings.append(pts)
    body = loft(rings, dark)
    # A pale throat and belly, a lighter flank line between.
    body.paint(lambda c, nrm, old: pale if nrm[2] < -0.55 and c[0] > -0.2 else mid if nrm[2] < -0.1 else old)
    back = Geo().extend(body)
    # The dorsal fin: a low, swept triangle two thirds aft.
    fin = loft([[(-0.52, -0.02, 0.2), (-0.3, -0.02, 0.22), (-0.3, 0.02, 0.22), (-0.52, 0.02, 0.2)],
                [(-0.56, -0.008, 0.34), (-0.5, -0.008, 0.34), (-0.5, 0.008, 0.34), (-0.56, 0.008, 0.34)]], dark)
    back.extend(fin)
    # The flukes: two flat swept blades off the tail stock.
    for side in (-1, 1):
        fluke = loft([[(-1.18, 0.0, -0.015), (-1.18, 0.0, 0.015), (-1.3, side * 0.05, 0.015), (-1.3, side * 0.05, -0.015)],
                      [(-1.36, side * 0.34, -0.01), (-1.36, side * 0.34, 0.01), (-1.46, side * 0.3, 0.01), (-1.46, side * 0.3, -0.01)]], dark)
        back.extend(fluke)
    kit.part("back", back)
    # The spout: one plume of mist over the blowhole, narrow at the hole, billowing out, rounded over the top.
    profile = ((0.24, 0.025), (0.45, 0.07), (0.7, 0.14), (0.95, 0.2), (1.12, 0.21), (1.24, 0.15), (1.3, 0.05))
    rings = [[(0.62 + r * math.cos(2 * math.pi * k / 7 + z), r * math.sin(2 * math.pi * k / 7 + z), z) for k in range(7)] for z, r in profile]
    kit.part("spout", loft(rings, pale))
    return kit.build()
