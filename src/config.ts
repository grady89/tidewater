// World constants. Everything tunable about the island and the tide lives here.

/** World units across the island (terrain mesh width and depth). */
export const SIZE = 64;

/** Tide low / high water level in world Y. Flats sit between these. */
export const TIDE_LO = -0.35;
export const TIDE_HI = 0.6;

/** Seconds for one full tide cycle (low -> high -> low). */
export const TIDE_PERIOD = 80;

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
