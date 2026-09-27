# The World — review (stage 6)

The build checked against direction.md, experience.md, hero.md and motion.md, with the smoke's shots
(shots/globe) and a scratch reel of frames: the entrance at 0 and 0.7 s, the launch, a built face, its hover, a
face turned from the sun, the dive at 0.35 / 0.8 / 1.25 s, the island after the cut, the return at 0.3 / 0.7 /
1.1 s, dusk and night. Everything below was found by looking, not by the checks — which is why the reel exists.

## Fixed in this pass

1. **Rails at the globe's centre.** `Vector3.normalize()` works in place, so every edge rail was placed 1.25 units
   from the centre of the solid and showed through the translucent seas as dark spokes radiating from each
   face's middle. The thirty rails and their gates now ride the ridges.
2. **Uncharted seas were pure fog.** Fog at 30/90 with the camera at 340 fogged them completely: twelve pale
   pentagons the colour of the background. The band is now 250/430 — half fog on the front face, hazing to
   nine tenths on the far side — so an empty sea reads as a pale, misted sea.
3. **Built seas were a quarter fog.** 220/600 put 24 % of the fog colour on the front face; 300/700 leaves it
   nearly clear and hazes only the far side.
4. **A dark square under the water.** The miniature's ground covered the island's 64-unit square; its sea floor
   showed through the water at 8 % as a square inside the pentagon. The ground now covers the pentagon exactly
   (vertices beyond the outline are pulled onto it; heights continue the island's rim, as the heightmap's clamp
   does), so the depth is one surface across the face and nothing pokes out of the solid.
5. **Faces turned from the sun went near-black by day.** Their ambient was scaled to 28 %. A shade floor of 55 %
   keeps land readable on the far side at noon; the moonlit floor still carries the night.
6. **Flying through the clouds.** The dive and the return passed straight through the cloud layer — a white
   blob filled the frame at the cut. The clouds fade as the camera drops under 175 units from the centre, gone
   by 115. Seen from under the globe their bellies took the hemisphere's brown ground colour; a little
   self-light keeps them cloud-pale from every side.
7. **The card came before the entrance.** It now opens when the last sea has surfaced (at once with reduced
   motion), as hero.md has it.
8. **A flat background at noon.** Looking 27° down at a ring face, the whole frame behind the globe was the
   study's below-horizon colour (a warm grey at 11:00: the study's dusk curve never reaches zero). Ring faces
   are now looked at from 0.14 rad under their normal, which brings the horizon's blue glow into the top of the
   frame. The sky shader is untouched.
9. **The return could revive a stale orbit.** `rebuildAnglesAndRadius()` after setting the orbit's angles
   recomputed them from a position that had not been rendered since the dive; the position is updated from the
   angles instead.
10. **The narrow layout.** The hint sat under the card's bottom edge on a 400 px screen; the sheet sits 104 px
    up and the smoke asserts the order card / hint / import.
11. **Spokes in the ocean disc.** The disc's centre was a fan of fifty slivers and the water's facet normals come
    from screen derivatives, so the fan showed. Each face is now five triangles subdivided 48 times: equal
    areas everywhere, the island's own water density.
12. **A dive during the entrance left the globe half-risen.** The flight took over the phase, the rise stopped
    where it was, and the return showed the globe 30–50 units low (every smoke shot after a reload had it; the
    smoke asserts `globeY` now). A dive or a return during the entrance lands the globe first.
13. **A confirm could outlive its scene** (found by the five-minute monkey, stage 7: both of its "event did not
    survive the reload" failures were this). The World's DOM fades to invisible during the dive but stayed
    clickable, so "Delete" could open its confirm mid-flight; the island then came up under the open dialog,
    Enter confirmed it, and the sea under the player was cleared — no sector to autosave into, and the return
    refused for want of one. Now: a dive is refused while a dialog is open, the fading DOM is inert, a scene
    switch cancels any open dialog, the World's actions re-check they are still on the World, and a town whose
    sea is gone can still return (a cut). The smoke drives all three paths.

## Checked and kept

- **Entrance**: the rise from −60 over 1.6 s, the fog pulling out, the swell settling 3 → 1, built seas
  surfacing 0.25 s apart, last played last. At t = 0 the frame is the empty horizon; the globe comes up out of it.
- **Dive**: 1.4 s flight (inOutCubic) from the orbit to the pose that equals the island's frameTown framing in
  the face's frame; the cut lands the island camera at radius 22, yaw −0.8, beta 0.95 and it settles to 30. The
  settle uses the camera's own easing (~0.3 s), not the 0.8 s motion.md planned; it reads as an arrival and is
  kept. At the end of the flight the miniature is blocky for a few frames before the cut — accepted.
- **Return**: the island camera's pose mapped into the face's frame, 1.2 s back to the remembered orbit, the
  card back on the sea.
- **Reduced motion**: cuts (78 / 22 ms in the smoke), no drift, no rise, hover without easing.
- **Keyboard**: arrows step 0.4 rad, Enter opens the front face's card and dives, Escape hides the card on the
  World and returns from the island's top level (a change from the Town menu opening there; the speed bar's
  Town… still opens it, and the menu carries the World button).
- **Hover**: lift 2 units in 180 / 240 ms and a +20 % sun boost. At radius 340 the lift is a subtle shift and
  the boost barely reads; the card is the real hover feedback. Left as designed.
- **Dialogs**: rename (pre-filled, focused, Enter confirms), delete (cancel keeps, confirm clears to uncharted
  sea), the bad-file notice, the new-town confirm; no `window.confirm`/`prompt` anywhere.
- **Composition offset** (hero.md: the target 12 units left on wide screens): not needed — at 1280 wide the card
  clears the globe; the globe stays centred.

## Open

- **Touch**: pinch and tap go through Babylon's ArcRotateCamera inputs and the click path; unverified headless.
- **Only Tidewater exists**; the other biomes are shown uncharted and unselectable. `BAND_GATING` is off.
- **The miniature roofs** are three thin-instanced primitives 1.2 units wide; up close (the last frames of a
  dive) they are boxes. Fine at the orbit.
- **The below-horizon sky** by day is the study's horizon colour; the tilt shows the blue above it. If the World
  ever wants its own backdrop that is a new uniform on the sky shader (a below-horizon colour), not a rewrite.

## Numbers (smoke, RTX 4060 laptop, headless Chrome)

| What | Value |
|---|---|
| Boot into the World | 393 ms empty · 558 ms with twelve towns · 325 ms with the 300-building town |
| Draw calls | 15 empty · 39 with twelve one-hut towns · at most 63 (a miniature and three roof meshes per face) |
| Frame rate | 165 fps (the display cap) with twelve towns |
| Dive / return | 1416 ms / 1200 ms; 78 / 22 ms with reduced motion |
| Heap after 20 round trips (3 seas, after GC) | −1.4 % (69.6 → 68.7 MB) |
| Twelve sectors in localStorage | 25 keys; twelve fresh towns 20 k UTF-16 units; twelve 300-building towns < 2.6 M packed |
