# Helpers for the asset kits (tools/assets/kits/*.py), run inside Blender by build.py.
#
# Geometry is built as plain Python (vertices, faces, one palette hex per face) and only then turned into Blender
# meshes, so every kit reads as arithmetic, not as a sequence of bpy.ops. Conventions (docs/assets/decisions.md):
#   * 1 Blender unit = 1 grid cell = 1 game unit. Blender +X is the bow / the "front" (the game's +x), Blender +Y is
#     port (the game's +z; the outrigger's float), +Z is up. The loader maps Blender (x, y, z) to Babylon (x, z, y).
#   * Colours: one CORNER colour attribute named COLOR_0, every value a hex from the look's palette. The only
#     exceptions are the tint masks (#ffffff and two greys the conifer already uses): parts the game paints per
#     instance (boat hulls, palm fronds) are exported in them so the instance colour shows through.
#   * Every face flat-shaded; each part welded (merge by distance), triangulated, transforms applied; the whole
#     asset's origin at its base centre; one material; named child objects for the parts the view may animate.
import math

import bmesh
import bpy

MASKS = ("#ffffff", "#e4e4e4", "#c8c8c8")


def srgb(hexcol):
    h = hexcol.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


# ---------------------------------------------------------------- geometry (pure Python)

class Geo:
    """A part's geometry: vertices, faces (index tuples), and a hex per face."""

    def __init__(self):
        self.v = []
        self.f = []
        self.c = []

    def add(self, verts, faces, color):
        base = len(self.v)
        self.v.extend(verts)
        colors = color if isinstance(color, list) else [color] * len(faces)
        for face, col in zip(faces, colors):
            self.f.append(tuple(base + i for i in face))
            self.c.append(col)
        return self

    def extend(self, other):
        base = len(self.v)
        self.v.extend(other.v)
        self.f.extend(tuple(base + i for i in face) for face in other.f)
        self.c.extend(other.c)
        return self

    def map(self, fn):
        self.v = [fn(p) for p in self.v]
        return self

    def orient_outward(self):
        """For a closed solid: flip every face if the signed volume is negative (faces wound inward)."""
        vol = 0.0
        for face in self.f:
            a = self.v[face[0]]
            for k in range(1, len(face) - 1):
                b, c = self.v[face[k]], self.v[face[k + 1]]
                vol += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])
        if vol < 0:
            self.f = [tuple(reversed(face)) for face in self.f]
        return self

    def take(self, keep):
        """A new Geo with the faces whose hex passes keep(hex) (the vertices are shared, unused ones harmless)."""
        g = Geo()
        g.v = list(self.v)
        for face, col in zip(self.f, self.c):
            if keep(col):
                g.f.append(face)
                g.c.append(col)
        return g

    def paint(self, fn):
        """Repaint each face: fn(face_centre, face_normal, old_hex) -> hex."""
        out = []
        for face, col in zip(self.f, self.c):
            pts = [self.v[i] for i in face]
            cen = tuple(sum(p[k] for p in pts) / len(pts) for k in range(3))
            out.append(fn(cen, normal(pts), col))
        self.c = out
        return self


def normal(pts):
    nx = ny = nz = 0.0
    for i, a in enumerate(pts):
        b = pts[(i + 1) % len(pts)]
        nx += (a[1] - b[1]) * (a[2] + b[2])
        ny += (a[2] - b[2]) * (a[0] + b[0])
        nz += (a[0] - b[0]) * (a[1] + b[1])
    n = math.sqrt(nx * nx + ny * ny + nz * nz) or 1.0
    return (nx / n, ny / n, nz / n)


def rot_x(p, a):
    c, s = math.cos(a), math.sin(a)
    return (p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c)


def rot_y(p, a):
    c, s = math.cos(a), math.sin(a)
    return (p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c)


def rot_z(p, a):
    c, s = math.cos(a), math.sin(a)
    return (p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2])


def move(p, d):
    return (p[0] + d[0], p[1] + d[1], p[2] + d[2])


def box(color, size, centre=(0, 0, 0)):
    sx, sy, sz = (s / 2 for s in size)
    cx, cy, cz = centre
    v = [(cx + x * sx, cy + y * sy, cz + z * sz) for z in (-1, 1) for y in (-1, 1) for x in (-1, 1)]
    f = [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)]
    return Geo().add(v, f, color).orient_outward()


def ring(n, rx, ry, z, phase=0.0, centre=(0, 0)):
    return [(centre[0] + rx * math.cos(phase + 2 * math.pi * k / n), centre[1] + ry * math.sin(phase + 2 * math.pi * k / n), z) for k in range(n)]


def loft(rings, color, cap_start=True, cap_end=True):
    """Quads between consecutive rings (same point count, same winding); the ends capped with one polygon each."""
    g = Geo()
    n = len(rings[0])
    verts = [p for r in rings for p in r]
    faces = []
    for a in range(len(rings) - 1):
        for k in range(n):
            i0, i1 = a * n + k, a * n + (k + 1) % n
            faces.append((i0, i1, i1 + n, i0 + n))
    if cap_start:
        faces.append(tuple(reversed(range(n))))
    if cap_end:
        last = (len(rings) - 1) * n
        faces.append(tuple(last + k for k in range(n)))
    g.add(verts, faces, color)
    return g.orient_outward()


def cylinder(color, n, r0, r1, z0, z1, centre=(0, 0), squash=1.0, phase=0.0):
    """Along Z: radius r0 at z0 to r1 at z1 (0 = a cone), `squash` scales Y."""
    rings = [ring(n, max(r0, 1e-4), max(r0, 1e-4) * squash, z0, phase, centre), ring(n, max(r1, 1e-4), max(r1, 1e-4) * squash, z1, phase, centre)]
    return loft(rings, color)


def blob(color, n, rings_n, rx, ry, rz, centre=(0, 0, 0)):
    """A low-poly ellipsoid: n around, rings_n bands from pole to pole."""
    g = Geo()
    cx, cy, cz = centre
    verts = [(cx, cy, cz - rz)]
    for r in range(1, rings_n):
        t = math.pi * r / rings_n
        for k in range(n):
            a = 2 * math.pi * k / n
            verts.append((cx + rx * math.sin(t) * math.cos(a), cy + ry * math.sin(t) * math.sin(a), cz - rz * math.cos(t)))
    verts.append((cx, cy, cz + rz))
    top = len(verts) - 1
    faces = [(0, 1 + (k + 1) % n, 1 + k) for k in range(n)]
    for r in range(rings_n - 2):
        for k in range(n):
            a0, a1 = 1 + r * n + k, 1 + r * n + (k + 1) % n
            faces.append((a0, a1, a1 + n, a0 + n))
    last = 1 + (rings_n - 2) * n
    faces += [(last + k, last + (k + 1) % n, top) for k in range(n)]
    return g.add(verts, faces, color).orient_outward()


def slab(color, outline, z0, z1):
    """A flat polygon outline (x, y) extruded between z0 and z1 (both sides closed)."""
    return loft([[(x, y, z0) for x, y in outline], [(x, y, z1) for x, y in outline]], color)


# ---------------------------------------------------------------- Blender objects

class Kit:
    """Collects named parts for one asset and turns them into a root empty with mesh children."""

    def __init__(self, name, palette, look_id):
        self.name = name
        self.look = look_id
        self.pal = palette["looks"][look_id]
        self.allowed = set(self.pal["all"]) | set(MASKS)
        self.parts = []
        self.masks = {}

    def check(self, hexcol):
        h = hexcol.lower()
        if h not in self.allowed:
            raise ValueError(f"{self.name}.{self.look}: {h} is not in the {self.look} palette")
        return h

    def part(self, name, geo, mask_preview=None):
        """A named child. `mask_preview` is the hex the turntable shows instead of the tint mask (the game's instance colour)."""
        for c in geo.c:
            self.check(c)
        self.parts.append((name, geo))
        if mask_preview:
            self.masks[name] = self.check(mask_preview)
        return geo

    def build(self):
        """The root empty with one mesh child per part, origin at the asset's base centre."""
        pts = [g.v[i] for _, g in self.parts for face in g.f for i in face]
        cx = (min(p[0] for p in pts) + max(p[0] for p in pts)) / 2
        cy = (min(p[1] for p in pts) + max(p[1] for p in pts)) / 2
        z0 = min(p[2] for p in pts)
        root = bpy.data.objects.new(self.name, None)
        bpy.context.scene.collection.objects.link(root)
        mat = flat_material()
        for name, g in self.parts:
            g.map(lambda p: (p[0] - cx, p[1] - cy, p[2] - z0))
            obj = mesh_object(name, g, mat)
            obj.parent = root
            obj["tint_mask_preview"] = self.masks.get(name, "")
        root["look"] = self.look
        return root


def flat_material():
    mat = bpy.data.materials.get("flat")
    if mat is None:
        mat = bpy.data.materials.new("flat")
        mat.diffuse_color = (1, 1, 1, 1)
    return mat


def mesh_object(name, g, mat):
    """Weld, triangulate, flat-shade and colour one part (COLOR_0, sRGB bytes from the hexes)."""
    colors = sorted(set(g.c))
    index = {c: i for i, c in enumerate(colors)}
    bm = bmesh.new()
    verts = [bm.verts.new(p) for p in g.v]
    layer = bm.faces.layers.int.new("pal")
    for face, col in zip(g.f, g.c):
        try:
            f = bm.faces.new([verts[i] for i in face])
        except ValueError:
            continue  # a duplicate face (shared cap): skip
        f[layer] = index[col]
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    # A closed part (every edge shared by two faces) gets its normals made consistent and outward; an open one
    # (a hull split by colour, a frond's two sheets) keeps the winding it was built with.
    if bm.edges and all(e.is_manifold for e in bm.edges):
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    pal = [f[layer] for f in bm.faces]
    bm.free()
    for p in me.polygons:
        p.use_smooth = False
    attr = me.color_attributes.new(name="COLOR_0", type="BYTE_COLOR", domain="CORNER")
    for poly, pi in zip(me.polygons, pal):
        r, gg, b = srgb(colors[pi])
        for li in poly.loop_indices:
            attr.data[li].color_srgb = (r, gg, b, 1.0)
    me.color_attributes.active_color = attr
    me.color_attributes.render_color_index = me.color_attributes.find("COLOR_0")
    me.attributes.remove(me.attributes["pal"]) if "pal" in me.attributes else None
    me.materials.append(mat)
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def triangles(root):
    return sum(len(c.data.polygons) for c in root.children if c.type == "MESH")


def set_colors(obj, hexcol):
    """Repaint every corner of a part (the turntable's preview of a tint mask)."""
    attr = obj.data.color_attributes["COLOR_0"]
    r, g, b = srgb(hexcol)
    for d in attr.data:
        old = d.color_srgb
        # keep the mask's shade: a grey mask darkens the preview colour the way the instance colour is darkened
        d.color_srgb = (r * old[0], g * old[1], b * old[2], 1.0)
