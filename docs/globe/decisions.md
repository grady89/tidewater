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
18. **Each face is lit by its own sun** (polish two): the island's sun by the clock, expressed in the face's frame,
    for its water and its miniature — so every sea reads as its island does from any side of the globe, and the
    dive's cut lands on matching light. Before, one world sun lit every face, and at 11:00 it stood behind the
    globe: the faces in view were backlit and their islands nearly black.
19. **The stage light is fixed** (upper left, a little in front) and only drives the terminator: a face turned from
    it keeps 62 % of its light (the brief's "gentle"), eased over facing −0.35 … 0.3. The clock keeps the
    light's colour and the moonlit night, not its direction (replacing that half of #4): the night side now sits
    on the far limb and the faces pass through it as the globe turns.
20. **The stage is a vertex-coloured dome**, not the sky shader: the sky's gradient is pow(height, 0.4) clamped at
    its horizon, so a horizon at the globe's height drew a crease across the frame, and its stars are cells a
    few pixels square at the World's field of view. The dome's gradient and glow are computed per vertex in code
    (navy #0e1633 at the top, indigo #33295a at the globe's height, #221c40 below, a #7d6fb0 glow behind the
    globe); the stars are 420 thin-instanced octahedra (~2 px), none below the globe's height. The island's sky
    shader is untouched; the World no longer uses it.
21. **The atmosphere** is a sphere at the solid's circumradius + 5 with Babylon's opacity and emissive fresnel.
    Babylon's term is pow(bias + |N·V|, power) — 1 facing the camera — and the opacity term is *added* to the
    material's alpha, so that alpha stays ~0 (at 1 the shell was opaque). It fades with the clouds on a flight.
22. **The miniature's coast**: a terrain uniform `coastLift` (0 = the island, which renders as before) lifts the
    band mapping so dry sand runs 0.45 above the miniature's water line at any tide, then grass, then rock, in the
    look's own hexes. Measured with `api.world.coast`: a median band of 4 CSS px on the smoke's seed-0 sea (101 bounded runs), 4.7 px on a Tidewater face at high tide and 3.3 px on an Atoll face in the browser pane, and at least 4 px on seed 0 at every tide from −0.35 to 0.85.
23. **Clouds**: 18 on High and Medium, 15 on Low (one draw call either way; the brief asks 15–20), a third of the
    old size, #f4f2ec over a #d9dbe0 underside (by facet normal), in two drifting bands (latitude +24° tilted
    about x, −20° about z) on the atmosphere shell. A cloud over the hovered or selected face thins to 20 %
    through its per-instance colour alpha, over about a tenth of a second.
24. **"Seed preview and hover lift from the previous polish list"**: no earlier list exists in the repo or the
    transcripts, so read at face value. The seed preview: an empty face's new-sea card shows its seed's island
    on the face (roofless, water at mean sea level, surfacing over 0.5 s), following the seed field with a
    150 ms debounce, Random and the coast buttons; founding the sea replaces it with the real miniature. The
    hover lift: 5 units and +25 % light (review.md had noted 2 units barely read at the orbit).
25. **The dive's hand-over** (Grady: "very blocky and then it just switches to the higher fidelity view"). The flight
    no longer ends on the miniature: the island's camera follows the flight (`CameraControl.follow`, outside the
    player's pitch and distance limits, restored by the next `jumpTo`) and the scenes dissolve across 90 → 40
    units from the town, the World copied into a 2D veil canvas over the game canvas each frame and the island drawn
    under it. For the two pictures to match, the flight's aim (look-at and up) finishes turning in the first 45 % and
    its approach is paced on log distance, so the dissolve lasts about 0.4 s head-on (0.27 s from a face at the
    globe's edge, which comes in faster). The island's fog is pushed back by the camera's distance beyond 30 while it
    follows, or the island would haze out against the miniature. The landing is Home's radius 30 with no settle,
    instead of 22 easing back out to 30. The 2D copy costs one canvas blit per frame for about 25 frames.
