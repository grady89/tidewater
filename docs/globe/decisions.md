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
