# The World — decisions the brief left open

One line each, in the order they were made. The reasoning is "most consistent with the existing game".

1. **Scale.** The World is built at island scale: a face's inradius is ~40 units so a 64-unit island fits its
   pentagon, the globe's circumradius is ~81 units and the camera sits ~230 units out. Reason: the water and
   terrain shaders' wave sizes, colour bands and foam are in world units, and the dive must end at exactly the
   framing the island scene uses — true scale makes the cut a pure camera hand-over.
2. **Static globe, orbiting camera.** Dragging orbits an ArcRotateCamera around a globe that never moves
   (Babylon's own pointer/touch/pinch inputs with tuned inertia), rather than spinning the globe. Reason: the
   sun stays fixed in the world so the night side is a real place; every per-face uniform (frame, heightmap)
   is constant; touch and trackpad come for free.
3. **Shader extension.** `frame` (mat4, identity by default) added to the water and terrain shaders: world
   positions and normals are mapped through it before the existing height/depth/uv math, so a tilted face is
   shaded as if it were flat. `fogNear`/`fogFar` (45/140 by default, the study's literals) added to both so the
   World can push its fog out. With the defaults the island renders bit for bit as before.
4. **The sun follows the player's real clock** (local hour → the sim's day fraction: 06:00 dawn, 12:00 noon,
   18:00 sunset, 00:00 midnight). Reason: the globe is the place the towns live in, not a town; it should be
   evening on the World when it is evening for the player, and the night side moves around it through the day.
5. **Faces.** 0 = top polar, 1–5 = the upper ring (temperate), 6–10 = the lower ring (tropical), 11 = bottom
   polar. Adjacency from the polyhedron. Migration puts the autosave on face 1 and slots 1–3 on faces 2–4.
6. **Roofs are thin instances**, three shape meshes per built face with a per-instance colour buffer (the
   walkers' technique), coloured by `roofFor`/`roofShape` for homes and slate for everything else with a roof.
7. **Sector storage**: `tidewater.sector.N` holds the sector's SimState JSON and `tidewater.sector.N.meta` a
   small metadata record, so the World reads twelve metas at boot and only the built sectors' states. Whether
   the JSON is compressed is decided by the storage-budget test (stage 5b).
8. **Uncharted faces** are the same water shader with the fog pulled close, caustics off and the sea level at 0:
   a faint wash, nothing new invented.
9. **Return framing.** The return starts from wherever the island camera is (mapped into the face's frame) and
   flies back to the orbit; the World remembers its last orbit pose per session.
10. **The active sector is the autosave.** The old "tidewater.autosave" key is migrated once and then left
    alone; the island scene saves into `tidewater.sector.<active>` at every tide peak and on return.
11. **Sector states are LZW-packed** (src/sim/compress.ts, ~90 lines, no dependency). Measured: a 300-building
    town is 337 k JSON characters, twelve are 4.04 M (8 MB of UTF-16 — over the 5 MB Firefox/Safari quota);
    packed they are under 2.6 M code units. `isPacked` keeps plain JSON readable, so nothing else changes.
12. **The ocean disc is five subdivided triangles** (ring k carries 5k points), not concentric rings with a fixed
    point count: the water's facet normals come from screen-space derivatives, and the sliver fan a fixed count
    makes at the centre showed as dark spokes. 48 rings ≈ the island's own water grid density.
13. **The heap check lives in the smoke** (Chrome launched with `--js-flags=--expose-gc`), not a separate script:
    it needs the same dev server, the same API and the same GPU flags, and CI runs the smoke anyway.
14. **Escape at the island's top level returns to the World** (experience.md's keyboard section); before, it
    opened the Town menu. The menu still opens from the speed bar and has the "World" button.
15. **The World's frame-rate probe.** The first-launch quality probe now measures the World (that is what a first
    launch shows); the preset it picks applies to both scenes.
16. **The globe spins; the camera only zooms** (replacing #2, at Grady's request after playing: an orbiting
    camera can't cross the poles). A drag is a trackball turn about the camera's up and right axes with a capped
    flick and 0.92 inertia; arrows step the same turns; lookAt turns the globe so the face looks at the camera
    with its standing "up" toward the top of the screen; idle drift turns it about world up. The sun is still
    fixed in the world, so the night side is still a real place — it just moves over the globe as you turn it.
    Every per-face uniform is recomputed from the node's world matrix each frame, as it already was.
17. **Selection ring.** The face whose card is open wears five lantern-lit rails just inside its outline (a
    merged flat mesh per face, one shown at a time), because the hover lift alone did not say which sea a click
    would dive into.
