# The turtle (FaunaKind "turtles", the Atoll's): a bevelled dome shell with a scute pattern and a brown rim over a
# pale plastron, a head reaching forward, a stub of a tail, and four flippers as separate objects (the front pair
# long and swept, the back pair short). Parts: shell, head, flipper_fl, flipper_fr, flipper_bl, flipper_br.
import math

from lib import Geo, Kit, blob, cylinder, loft, ring, slab


def flipper(color, root, length, width, sweep, side):
    """A flat paddle: a leaf-shaped outline from the root, swept back by `sweep` radians, 0.025 thick."""
    outline = [(0, -width * 0.35), (length * 0.45, -width * 0.5), (length, -width * 0.12), (length * 0.9, width * 0.2), (length * 0.3, width * 0.5), (0, width * 0.35)]
    g = slab(color, outline, -0.0125, 0.0125)
    ang = side * (math.pi / 2 + sweep)
    ca, sa = math.cos(ang), math.sin(ang)
    return g.map(lambda p: (root[0] + p[0] * ca - p[1] * sa * side, root[1] + p[0] * sa + p[1] * ca * side, root[2] + p[2] - 0.02 * p[0] / length))


def build(bpy, palette, look_id):
    kit = Kit("turtle", palette, look_id)
    pal = kit.pal
    dark, light, rim, belly, skin = pal["trees"]["leaves"][2], pal["terrain"]["grassHi"], pal["trees"]["trunk"], pal["terrain"]["sand"], pal["terrain"]["grassLo"]
    # The shell: plastron edge, a bevelled rim, then the dome in three rings; ten sides, slightly longer than wide.
    n = 10
    rings = [ring(n, 0.2, 0.17, 0.035), ring(n, 0.245, 0.205, 0.06), ring(n, 0.235, 0.195, 0.085),
             ring(n, 0.2, 0.165, 0.13), ring(n, 0.13, 0.105, 0.165), ring(n, 0.045, 0.036, 0.182)]
    shell = loft(rings, dark)
    # Paint by band: the rim brown, the plastron pale, the dome's scutes alternating dark and light.
    def band(c, nrm, old):
        if nrm[2] < -0.5:
            return belly
        if c[2] < 0.09:
            return rim
        a = math.atan2(c[1] / 0.2, c[0] / 0.24)
        return light if (int((a + math.pi) / (2 * math.pi) * 5) + (c[2] > 0.15)) % 2 else dark
    shell.paint(band)
    kit.part("shell", shell)
    head = blob(skin, 6, 4, 0.07, 0.05, 0.045, (0.3, 0.0, 0.08))
    head.extend(cylinder(skin, 6, 0.045, 0.03, 0, 0.1, centre=(0, 0)).map(lambda p: (0.2 + p[2], p[1], 0.075 + p[0] * 0.8)))  # the neck
    head.extend(cylinder(skin, 4, 0.03, 0.0, 0, 0.08).map(lambda p: (-0.24 - p[2], p[1], 0.05 + p[0])))  # the tail
    kit.part("head", head)
    kit.part("flipper_fl", flipper(skin, (0.13, 0.15, 0.05), 0.24, 0.1, 0.55, 1))
    kit.part("flipper_fr", flipper(skin, (0.13, -0.15, 0.05), 0.24, 0.1, 0.55, -1))
    kit.part("flipper_bl", flipper(skin, (-0.14, 0.13, 0.045), 0.12, 0.08, 1.1, 1))
    kit.part("flipper_br", flipper(skin, (-0.14, -0.13, 0.045), 0.12, 0.08, 1.1, -1))
    return kit.build()
