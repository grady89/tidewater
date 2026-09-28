# Runs inside Blender (headless):
#   blender -b --factory-startup -P tools/assets/build.py -- [names...] [--look fjord]
# For each asset and look: build it from its kit (tools/assets/kits/<name>.py), enforce the triangle budget, export
# public/assets/<name>[.<look>].glb (glTF binary, +Y up, the COLOR_0 vertex colours, one material), and render a
# turntable to shots/assets/<name>[.<look>].png: one orthographic Workbench render of four copies (front,
# three-quarter, side, top) and a 1-cell reference cube, flat lighting, vertex colours, the look's sky behind.
# The file name carries the look only when it is not the asset's own (dory.glb is Tidewater's, dory.fjord.glb the Fjord's).
import importlib
import json
import math
import os
import sys

import bpy
from mathutils import Quaternion, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "kits"))
import lib  # noqa: E402

# name -> (the look that uses it in the game, the looks to build, the triangle budget)
BOATS = ("tidewater", "fjord", "atoll")
ASSETS = {
    "dory": ("tidewater", BOATS, 900),
    "outrigger": ("atoll", BOATS, 900),
    "longboat": ("fjord", BOATS, 900),
    "whale": ("fjord", ("fjord",), 600),
    "turtle": ("atoll", ("atoll",), 600),
    "palm": ("atoll", ("atoll",), 600),
}
TURNTABLE_PX = 800


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    look = None
    names = []
    i = 0
    while i < len(argv):
        if argv[i] == "--look":
            look = argv[i + 1]
            i += 2
            continue
        names.append(argv[i])
        i += 1
    unknown = [n for n in names if n not in ASSETS]
    if unknown:
        raise SystemExit(f"unknown asset(s): {', '.join(unknown)} (known: {', '.join(ASSETS)})")
    return names or list(ASSETS), look


def out_name(name, look):
    return name if look == ASSETS[name][0] else f"{name}.{look}"


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def export(root, path):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    root.select_set(True)
    for c in root.children:
        c.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_yup=True, export_apply=True,
        export_normals=True, export_vertex_color="ACTIVE", export_all_vertex_colors=False,
        export_materials="EXPORT", export_image_format="NONE", export_texcoords=False, export_tangents=False,
    )


def linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def turntable(root, palette, look, path):
    """Four copies of the asset in a 2x2 grid seen by one orthographic camera, and a 1-cell cube."""
    # The turntable shows the game's colour where the asset carries a tint mask (hull, fronds).
    for c in root.children:
        preview = c.get("tint_mask_preview", "")
        if preview:
            lib.set_colors(c, preview)
    mn = Vector((1e9, 1e9, 1e9))
    mx = Vector((-1e9, -1e9, -1e9))
    for c in root.children:
        for v in c.data.vertices:
            for k in range(3):
                mn[k] = min(mn[k], v.co[k])
                mx[k] = max(mx[k], v.co[k])
    size = max(mx - mn)
    centre = (mn + mx) / 2
    cell = size * 1.15 + 0.3
    # front (bow toward the camera), three-quarter, side (bow to the right), top (seen from above)
    views = [
        ("front", Quaternion((0, 0, 1), -math.pi / 2), (-0.5, 0.5)),
        ("three-quarter", Quaternion((1, 0, 0), math.radians(24)) @ Quaternion((0, 0, 1), math.radians(-38)), (0.5, 0.5)),
        ("side", Quaternion(), (-0.5, -0.5)),
        ("top", Quaternion((1, 0, 0), math.pi / 2), (0.5, -0.5)),
    ]
    for label, q, (gx, gz) in views:
        holder = bpy.data.objects.new(f"view-{label}", None)
        bpy.context.scene.collection.objects.link(holder)
        holder.rotation_mode = "QUATERNION"
        holder.rotation_quaternion = q
        holder.location = Vector((gx * cell, 0, gz * cell)) - q @ centre
        for c in root.children:
            dup = c.copy()
            bpy.context.scene.collection.objects.link(dup)
            dup.parent = holder
    root.hide_render = True
    for c in root.children:
        c.hide_render = True
    # The reference: one grid cell, in a strip of its own under the grid, at the left.
    strip = 1.4
    g = lib.box("#ffffff", (1, 1, 1))
    cube = lib.mesh_object("cell", g, lib.flat_material())
    grey = "#b9bcc0"
    lib.set_colors(cube, grey)
    cube.location = (-cell + 0.6, 0, -cell - strip / 2 - 0.5)
    scene = bpy.context.scene
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = cell * 2 + strip
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    cam.location = (0, -50, -strip / 2)
    cam.rotation_euler = (math.pi / 2, 0, 0)
    scene.camera = cam
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = round(TURNTABLE_PX * cell * 2 / (cell * 2 + strip))
    scene.render.resolution_y = TURNTABLE_PX
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.view_transform = "Standard"
    shading = scene.display.shading
    shading.light = "FLAT"
    shading.color_type = "VERTEX"
    shading.show_object_outline = True
    shading.object_outline_color = (0.12, 0.13, 0.15)
    shading.show_cavity = True
    shading.cavity_type = "WORLD"
    shading.cavity_ridge_factor = 1.0
    shading.cavity_valley_factor = 1.0
    world = bpy.data.worlds.new("sky")
    sky = lib.srgb(palette["looks"][look]["sky"])
    world.color = tuple(linear(c) for c in sky)
    scene.world = world
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def main():
    names, only_look = args()
    with open(os.path.join(HERE, "palette.json"), encoding="utf8") as f:
        palette = json.load(f)
    os.makedirs(os.path.join(ROOT, "public", "assets"), exist_ok=True)
    os.makedirs(os.path.join(ROOT, "shots", "assets"), exist_ok=True)
    for name in names:
        home, looks, budget = ASSETS[name]
        kit = importlib.import_module(name)
        for look in looks:
            if only_look and look != only_look:
                continue
            reset()
            root = kit.build(bpy, palette, look)
            tris = lib.triangles(root)
            if tris > budget:
                raise SystemExit(f"{name}.{look}: {tris} triangles is over the budget of {budget}")
            base = out_name(name, look)
            glb = os.path.join(ROOT, "public", "assets", base + ".glb")
            export(root, glb)
            png = os.path.join(ROOT, "shots", "assets", base + ".png")
            turntable(root, palette, look, png)
            parts = sorted(c.name for c in root.children)
            print("ASSET " + json.dumps({"name": name, "look": look, "file": base, "tris": tris, "budget": budget, "bytes": os.path.getsize(glb), "parts": parts}), flush=True)


main()
