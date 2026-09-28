// The tide's numbers for one biome. Every level in config.ts is Tidewater's (scale 1); a biome multiplies them
// about the mean sea level, and everything that used to read a constant reads the scaled value here instead:
// the class thresholds, the stilt rule's clearances, the water marks, the flood lines, the wave, the beach band,
// the landfill height and the fixed deck heights. Pure data; the Grid carries the active set.
import {
  CLEARANCE, HIGH_WATER_MARK, LOW_WATER_MARK, PIER_FLOOR, RAISED_FLOOR, SPRING_HI, SPRING_LO, STILT_MIN, TIDE_HI, TIDE_LO,
} from "../config";
import { BEACH_MAX_HEIGHT, LANDFILL_HEIGHT, WAVE_MARGIN } from "./balance";

export interface Tides {
  /** The biome's multiplier on every level (1 = Tidewater). */
  scale: number;
  lo: number;
  hi: number;
  springLo: number;
  springHi: number;
  /** The highest the water ever comes: the spring peak, or a king tide on a coast with a river surge. Buildings clear it. */
  floodHi: number;
  /** Above this is high water, below `lowMark` low water; between is slack. */
  highMark: number;
  lowMark: number;
  /** Ground at or above this is dry at every tide (paths run here). */
  dryTerrain: number;
  /** A standard walkway on ground below this floods at a spring peak. */
  springFloodTerrain: number;
  /** The tsunami takes every unshielded deck below this. */
  waveHeight: number;
  /** Beach: high cells up to this height that touch water. */
  beachMax: number;
  /** What landfill raises a cell to. */
  landfillHeight: number;
  /** Fixed deck heights (piers, docks, the harbor, sea pieces) and the raised walkway. */
  pierFloor: number;
  raisedFloor: number;
  /** The lowest "ground" floor (hill kinds never sit below this). */
  groundFloor: number;
}

/** The tides for a biome: `scale` multiplies every level; `king` is a king tide's rise over the spring peak (0 without a river surge). */
export function tidesFor(scale = 1, king = 0): Tides {
  const hi = TIDE_HI * scale, lo = TIDE_LO * scale, springHi = SPRING_HI * scale, springLo = SPRING_LO * scale;
  const floodHi = springHi + king * scale;
  return {
    scale, lo, hi, springLo, springHi, floodHi,
    highMark: HIGH_WATER_MARK * scale, lowMark: LOW_WATER_MARK * scale,
    dryTerrain: floodHi + CLEARANCE,
    springFloodTerrain: springHi - STILT_MIN,
    waveHeight: floodHi + CLEARANCE + WAVE_MARGIN,
    beachMax: BEACH_MAX_HEIGHT * scale,
    landfillHeight: LANDFILL_HEIGHT * scale,
    pierFloor: (PIER_FLOOR + king) * scale,
    raisedFloor: (RAISED_FLOOR + king) * scale,
    groundFloor: (PIER_FLOOR + king) * scale,
  };
}

/** Tidewater's tides: every value equals its config constant. */
export const BASE_TIDES: Tides = tidesFor(1);

/** deep: always underwater. flat: the tidal flats, buildable. high: dry land above the tide. */
export function classFor(h: number, t: Tides): "deep" | "flat" | "high" {
  return h < t.lo ? "deep" : h <= t.hi ? "flat" : "high";
}
