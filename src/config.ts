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

/** Water above this is "high water" (boats sail, high-water producers run); below LOW is "low water". Between is slack. */
export const HIGH_WATER_MARK = 0.25;
export const LOW_WATER_MARK = 0.0;

/** Every SPRING_EVERY-th cycle is a spring tide: a deeper trough and a higher peak. */
export const SPRING_EVERY = 4;
export const SPRING_HI = 0.85;
export const SPRING_LO = -0.55;

/** Tide cycles per day. Day/night is visual only (plus lanterns and night swimming risk). */
export const DAY_CYCLES = 2;

/** Standard walkway deck height above the cell's terrain. */
export const STILT_LENGTH = 0.5;
/** Raised walkway deck height, absolute. Above any spring tide. */
export const RAISED_FLOOR = 1.2;

/** Seed for the terrain noise. 0 reproduces the island in reference/tidewater-study.html. */
export const TERRAIN_SEED = 0;

/** How fast the wet-sand band dries out (world units per second) once the water retreats below it. */
export const WET_SAND_DRY_RATE = 0.012;

/**
 * Floor heights (top of deck) in absolute world Y. Absolute rather than terrain-relative so walkways stay level
 * across cells; stilt length is what varies with terrain. See NOTES.md on the cut rule.
 */
export const HOUSE_FLOOR = 1.0;
export const WALKWAY_FLOOR = 0.95;
export const PIER_FLOOR = 1.0;

/** Stilts are sunk this far below the terrain surface so they never float over slope facets. */
export const STILT_SINK = 0.3;
