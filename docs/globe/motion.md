# The World — motion system

Values are what the code uses (src/globe/*). Easings by name: `outCubic` 1−(1−t)³, `inOutCubic`, `outQuint`.

| Motion | Values | Easing |
|---|---|---|
| Drag spin | the globe turns as a trackball: 0.0055 rad per px about the camera's up (horizontal) and right (vertical) axes, the flick's speed capped at 2.5 px/ms, inertia 0.92 per frame at 60 Hz (≈ 0.6 s to rest); a 5 px dead zone keeps clicks clicks; pinch precision 60, wheel precision 24 for the zoom | exponential decay |
| Idle drift | the globe turns +0.035 rad/s about world up after 4 s without input; fades in over 2 s; stops on any input | outCubic ramp |
| Selection ring | shown on the face whose card is open; lantern-lit rails just inside the outline, 0.9 units above the water | — |
| Zoom | radius 340 by default, 230 → 420, wheel and pinch | inertial |
| Hover lift | 2 units along the face normal, 180 ms up, 240 ms down; sun boost +20 % | outCubic |
| Card / text reveal | opacity 0→1 and 6 px rise over 220 ms; 120 ms hover intent delay; the launch card waits for the entrance | outCubic |
| Entrance rise | globe y −60 → 0 over 1.6 s; fog (20/60) → (300/700) built, (250/430) uncharted, over 1.6 s; swell 3 → 1 from 0.4 to 2.4 s | outCubic |
| Surfacing | per built face: terrain −6 → 0 over 0.5 s, 0.25 s apart, starting at 1.2 s, last played last | outCubic |
| Clouds on a flight | alpha 0.92 → 0 as the camera passes 175 → 115 units from the centre (through their layer) | smoothstep |
| Dive | 1.4 s camera flight to the face framing, 250 ms DOM crossfade, then the island eases radius 22 → 30 (its camera's easing, ~0.3 s) | inOutCubic (flight), exponential (settle) |
| Return | mirror of the dive: 1.2 s flight from the face framing back to the orbit | inOutCubic |
| Keyboard rotate | arrows turn the globe 0.4 rad about the camera's up (left/right) or right (up/down) axis, eased (rate 10/s) | exponential ease |

**Pointer, trackpad, touch.** Left drag spins; wheel and trackpad scroll zoom (Babylon's wheel input, precision
24, delta clamped); pinch zooms (Babylon's multi-touch pinch); tap = click; a drag under 5 px is a click.
Hover intent: the card switches 120 ms after the pointer settles on a face. Touch has no hover: the first tap
lifts and opens the card, the second tap dives.

**Reduced motion** (`prefers-reduced-motion: reduce`, or `world.reducedMotion = true` for tests): no idle
drift, no entrance rise (the globe is simply there; built faces present), hover lift and card reveal instant,
dive and return are cuts with a 200 ms DOM crossfade, keyboard rotation steps instantly. Every state reachable.

**Budget.** Draw calls in the World: 12 oceans + up to 12 miniatures + up to 36 roof instance meshes + 1 edges
+ 1 clouds + 1 sky = 15 empty, 63 at most (logged by `world.drawCalls()`; 39 with twelve one-hut towns). Per-face
heightmaps 128² RGBA = 64 KB each, 768 KB for twelve. Vertices ≈ 12 × 5.9 k ocean + 12 × 2.6 k terrain (×6
once flat-shaded) ≈ 260 k. Measured: 165 fps (the cap) on the 4060 with twelve towns; `npm run quality`
measures the World at each preset (see QA.md).
