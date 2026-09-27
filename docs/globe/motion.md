# The World — motion system

Values are what the code uses (src/globe/*). Easings by name: `outCubic` 1−(1−t)³, `inOutCubic`, `outQuint`.

| Motion | Values | Easing |
|---|---|---|
| Drag spin | ArcRotateCamera, angularSensibilityX/Y 900 (rad per px⁻¹ in Babylon's units), inertia 0.92 per frame at 60 Hz (≈ 0.6 s to rest), pinch precision 60, wheel precision 24 | Babylon's inertial damping |
| Idle drift | +0.035 rad/s in alpha after 4 s without input; fades in over 2 s; stops on any input | outCubic ramp |
| Zoom | radius 230 → 150, wheel and pinch; keyboard +/− steps of 20 | inertial |
| Hover lift | 2 units along the face normal, 180 ms up, 240 ms down; sun boost +20 % | outCubic |
| Card / text reveal | opacity 0→1 and 6 px rise over 220 ms; 120 ms hover intent delay | outCubic |
| Entrance rise | globe y −60 → 0 over 1.6 s; fog (20/60) → (220/600) over 1.6 s; swell 3 → 1 from 0.4 to 2.4 s | outCubic |
| Surfacing | per built face: terrain −6 → 0 over 0.5 s, 0.25 s apart, starting at 1.2 s, last played last | outCubic |
| Dive | 1.4 s camera flight to the face framing, 250 ms DOM crossfade, then the island eases radius 22 → 30 over 0.8 s | inOutCubic (flight), outCubic (settle) |
| Return | mirror of the dive: 1.2 s flight from the face framing back to the orbit | inOutCubic |
| Keyboard rotate | arrows step alpha ±0.4 rad / beta ±0.3 rad, eased over 300 ms | outCubic |

**Pointer, trackpad, touch.** Left drag spins; wheel and trackpad scroll zoom (Babylon's wheel input, precision
24, delta clamped); pinch zooms (Babylon's multi-touch pinch); tap = click; a drag under 5 px is a click.
Hover intent: the card switches 120 ms after the pointer settles on a face. Touch has no hover: the first tap
lifts and opens the card, the second tap dives.

**Reduced motion** (`prefers-reduced-motion: reduce`, or `world.reducedMotion = true` for tests): no idle
drift, no entrance rise (the globe is simply there; built faces present), hover lift and card reveal instant,
dive and return are cuts with a 200 ms DOM crossfade, keyboard rotation steps instantly. Every state reachable.

**Budget.** Draw calls in the World: 12 oceans + up to 12 miniatures + up to 36 roof instance meshes + 1 edges
+ 1 clouds + 1 sky ≈ 30–60 (logged by `world.drawCalls()`). Per-face heightmaps 128² RGBA = 64 KB each,
768 KB for twelve. Vertices ≈ 12 × 1.6 k ocean + 12 × 2.2 k terrain ≈ 45 k. Floor: 60 fps on the 4060 at every
preset, 30 fps under the SwiftShader proxy on Low (`npm run quality` measures the World at each preset).
