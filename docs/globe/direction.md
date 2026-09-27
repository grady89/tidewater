# The World — creative direction

**Concept.** Tiny Tides is a game about a town the sea keeps. The World is where those towns live: a small
planet of twelve seas, a dodecahedron standing on one face, floating in the same sky the island has. Each face is
one sea with room for one town. A new player looks at an empty world of misted water and one lit face waiting;
a returning player looks at their towns from the sky, each a real miniature of the island they built, its water
at the tide they left it, and picks up where they were. Filling the globe is the long game: twelve seas, twelve
tides, a planet of towns.

**What the bands say.** The two polar faces are the cold ends (fjords one day), the upper ring is temperate
(the tidal flats of Tidewater), the lower ring is tropical (atolls, cinder, deltas later). The band is a promise
about what kind of coast a face will hold; tonight only Tidewater exists, so with `BAND_GATING` off the player
may put a Tidewater town on any face and the card still tells them which band it sits in. The ring geometry
already says "neighbours": every face touches five others along its edges, and those edges are where sea lanes
will one day cross.

**Composition.** Wide screens: the globe a little right of centre, the title "Tiny Tides" top-left in Instrument
Serif, the sector card on the right against the sky, the hint line at the bottom centre where the speed bar lives
on the island. Narrow screens (400 px): globe centred and smaller, title top-centre, card slides up from the
bottom as a sheet, hint above it. The camera never lets the globe leave the frame: the zoom range is small
(1.6×) and the tilt is limited so the polar faces stay readable.

**Materials.** Everything is what the island already is. The seas are the island's water shader per face with
its own heightmap; built faces carry the terrain shader's sand, grass and rock; roofs are the palette's four
roof colours; edges are the wet-sand tone; clouds are the sail off-white. No new hex tonight. Nothing is
textured; the only "pictures" are the shaders' own gradients and noise.

**Lighting and atmosphere.** One sun for the whole World, placed by the player's real clock: noon at midday, a
long orange dusk in the evening, moon and stars at night. Because the globe is a solid, the faces turned from
the sun fall into shadow — that is the night side, and its seas reflect the darker sky. The fog is the island's
fog pushed out to the globe's far side, so the back edge softens into the sky instead of cutting against it.
Clouds drift slowly around the globe just above the faces, low-poly and few; on Low they are fewer. The sky
dome is the island's, unchanged.

**Motion language.** Slow, heavy, tidal. The globe never snaps: drags carry inertia and coast to rest, an
untouched globe drifts a few degrees a minute, a hovered face rises as if lifted by the water under it, and the
dive is one continuous fall into the sea until the miniature becomes the island. Every easing curve is a
cubic; nothing bounces.

**Goal.** A returning player is in their town in under ten seconds: the World is ready by the second frame, the
last-played face is already lit and centred, Enter dives. And they want to come back to the globe, because it is
the only place the whole of what they built can be seen at once.
