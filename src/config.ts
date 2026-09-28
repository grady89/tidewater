// World constants. Everything tunable about the island and the tide lives here.

/** World units across the island (terrain mesh width and depth). */
export const SIZE = 64;

/** Tide low / high water level in world Y. Flats sit between these. */
export const TIDE_LO = -0.35;
export const TIDE_HI = 0.6;

/** Game seconds for one full tide cycle (high -> low -> high). */
export const TIDE_PERIOD = 120;

/** Game seconds per simulation tick. The ledger advances in these fixed steps regardless of frame rate. */
export const SIM_TICK = 1 / 20;
/** How far the view shivers while the Cinder's mountain trembles (screen offset, world units at the target). */
export const TREMOR_SHAKE = 0.05;
/** A coast's storm haze (the sandstorm's `fog`) at full: how far it pulls the fog's near and far edges in, how far it tints toward the sand. */
export const HAZE_NEAR = 0.6;
export const HAZE_FAR = 0.45;
export const HAZE_TINT = 0.8;

/** Water above this is "high water" (boats sail, high-water producers run); below LOW is "low water". Between is slack. */
export const HIGH_WATER_MARK = 0.25;
export const LOW_WATER_MARK = 0.0;

/** Every SPRING_EVERY-th cycle is a spring tide: a deeper trough and a higher peak. */
export const SPRING_EVERY = 4;
export const SPRING_HI = 0.85;
export const SPRING_LO = -0.55;

/** Tide cycles per day. Day/night is visual only (plus lanterns and night swimming risk). */
export const DAY_CYCLES = 2;

/**
 * The stilt rule. Every standard piece sizes its own stilts: a deck stands at least STILT_MIN above its cell and
 * at least CLEARANCE above the tide it must clear — the ordinary high tide for a walkway, the spring tide for a
 * building. So nothing standard floods at an ordinary high tide, and only a walkway on ground below
 * SPRING_FLOOD_TERRAIN goes under at a spring peak. Low ground means long stilts, which cost more (balance.ts).
 */
/** The World: when true, the Tidewater biome may only be founded on temperate faces; when false, on any face. */
export const BAND_GATING = false;
/** Sea lanes (BIOMES.md §4, sim/lanes.ts): the World ledger and cargo between adjacent harbors. Off until it is finished. */
export const LANES_ENABLED = true;
/** Pirates on the lanes (BIOMES.md §4, sim/lanes.ts): v0, off — presence beside busy lanes, raids on cargo, the fort. */
export const PIRATES_ENABLED = false;

export const STILT_MIN = 0.5;
export const CLEARANCE = 0.1;
/** A standard walkway on terrain below this floods at spring tides (its stilts end below the spring peak). */
export const SPRING_FLOOD_TERRAIN = SPRING_HI - STILT_MIN;
/** Ground at or above this is dry at every tide: paths run here; below it a street is a walkway on stilts. */
export const DRY_TERRAIN = SPRING_HI + CLEARANCE;
/** Raised walkway deck height, absolute. Above any spring tide, at a fixed price. */
export const RAISED_FLOOR = 1.2;
/** An auto-sized deck rises to meet a neighbouring deck up to this much above its own height, so streets run
 *  level (longer stilts on the low side); it never drops below its own safe height. */
export const WALKWAY_SNAP = 1.2;

/** Seed for the terrain noise. 0 reproduces the island in reference/tidewater-study.html. */
export const TERRAIN_SEED = 0;

/** How fast the wet-sand band dries out (world units per second) once the water retreats below it. */
export const WET_SAND_DRY_RATE = 0.012;

/** Pier deck height, absolute. */
export const PIER_FLOOR = 1.0;

/** Stilts are sunk this far below the terrain surface so they never float over slope facets. */
export const STILT_SINK = 0.3;
