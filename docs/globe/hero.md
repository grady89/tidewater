# The World — hero design

**The solid.** A regular dodecahedron, edge a = 58 units, standing on a face: face inradius 39.9, circumradius
of the solid 81.3. Faces are separate meshes so each can lift, light and carry its own materials; the edges are
one merged mesh of thirty thin wet-sand rails (0.6 wide, 0.35 high) with a small notch at each edge's midpoint —
the future sea-lane gate — so a neighbour reads as a place a boat could cross to.

**Per-face ocean.** A pentagon "disc" mesh (the pentagon's five triangles each subdivided 48 times — equal
triangles at the island's own water density, ~5,900 vertices) in the face's own frame (y up = face normal),
carrying the island's water ShaderMaterial with per-face uniforms: `frame` (inverse of the face's world
matrix), its own 128² heightmap, `waterLevel` as the mesh's offset along the normal, `fogNear/fogFar` (300/700
built, 250/430 uncharted), and the lighting set (the per-face `skyColor`/`sunColor` are dimmed by how far the
face turns from the sun, down to a 55 % shade floor, which is what makes the night side).

**Miniature.** For a built face, the sector's island: `island(seed).height` sampled on 2-unit cells across the
whole pentagon (landfill cells raised to `LANDFILL_HEIGHT`; beyond the island's 64-unit square the heights
continue its rim, as the heightmap's clamp does), vertices past the outline pulled onto it, flat-shaded with the
terrain ShaderMaterial and the same `frame` uniform. Water at the sector's real tide level. Roofs: three
thin-instanced roof primitives per face (pyramid / gable / hipped, 1.2 units wide, at the building's footprint
centre and floor) coloured from the real SimState. An empty face: the ocean alone, half fog at the front,
caustics off — the uncharted wash.

**Clouds.** Thin instances of one 5-sphere blob (sail colour, flat-shaded), 40 on High / 24 on Medium / 8 on
Low, on random orbits 18–30 units above the faces, drifting 0.02 rad/s, each with its own tilt so they cross
faces instead of ringing the equator.

**Night side.** One sun by the real clock; faces whose normal faces away from it get the shaders' ambient only
and darker per-face sky/sun uniforms; the sky shows moon and stars when the clock says night.

**Camera and spin.** The camera sits still on the globe's centre (radius 340, zoom 230–420 by wheel and
pinch) at 0.14 rad under a ring face's normal, so the horizon's glow shows along the top of the frame; the
globe itself turns under the pointer — a trackball, so any face including the poles comes round — with a
flick and inertia, and the sun stays fixed in the world. The face whose card is open wears a lantern-lit ring
just inside its outline. The globe stays centred: at 1280 wide the card clears it (the 12-unit offset planned
here was not needed).

**Typography.** "Tiny Tides" top-left, Instrument Serif 44 px, the sub-line IBM Plex Sans 13 px dim. The card is
the island's glass panel (same radius, blur, line). The hint sits bottom-centre in the speed bar's slot.

**Entrance.** t = 0: fog, sky visible, no globe. 0–1.6 s: the globe rises from 60 units below to 0,
easeOutCubic, while the fog pulls back from (20/60) to each face's band. 0.4–2.4 s: every face's swell settles from
3× to 1×. From 1.2 s: built faces surface one by one (terrain from −6 to 0, 0.5 s each, 0.25 s apart, last played
last); at each surfacing a ring of foam (the water's own foam band, driven by the terrain rising) marks it.
Then the card fades in. Reduced motion: everything at its final value on the first frame, card after 200 ms.

**Hover.** The face's group rises 2 units along its normal over 180 ms (easeOutCubic) and its `sunColor` gains
20 %; the edges around it brighten. Leaving reverses over 240 ms.

**Dive.** 1) `adopt(sector.state)` in the resident island scene (silent, off-screen). 2) The World camera
detaches from its orbit and flies (1.4 s, easeInOutCubic) to the pose that equals the island's `frameTown`
framing (target = the town's centroid, radius 22, yaw −0.8, beta 0.95) expressed in the face's frame — so the
miniature fills the viewport exactly as the island would. 3) Cut: the island scene renders with its camera at
that same framing and the same tide level; the water is the same shader at the same level, so it reads as
continuous. 4) The island eases out to radius 30 (its camera's own easing, ~0.3 s) and the HUD fades in. **Return** is the reverse:
the island camera's pose is mapped into the face's frame, the World cuts to it, then flies back to the orbit.
