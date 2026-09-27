// The World's sector model: twelve faces of a dodecahedron, each holding one town (a SimState) with metadata.
// Sim-only and JSON: the storage is an injected Store (localStorage in the game, a Map in the tests). Records
// live under "tidewater.sector.N" (the state, LZW-packed) and "tidewater.sector.N.meta" (a small metadata
// object read at every launch). The autosave and the three old save slots migrate here once.
import { BAND_GATING } from "../config";
import { compress, decompress, isPacked } from "./compress";
import { deserialize, serialize } from "./save";
import { population, SimState } from "./state";

export const FACES = 12;
export type Band = "polar" | "temperate" | "tropical";
/** Face 0 is the top polar face, 1–5 the upper ring, 6–10 the lower ring, 11 the bottom polar face. */
export function bandOf(face: number): Band {
  return face === 0 || face === 11 ? "polar" : face <= 5 ? "temperate" : "tropical";
}

export type Biome = "tidewater" | "delta" | "dunes" | "atoll" | "cinder" | "fjord";
export const BIOME_LABEL: Record<Biome, string> = { tidewater: "Tidewater", delta: "Delta", dunes: "Dunes", atoll: "Atoll", cinder: "Cinder", fjord: "Fjord" };
export const BIOMES_BY_BAND: Record<Band, Biome[]> = { temperate: ["tidewater", "delta", "dunes"], tropical: ["atoll", "cinder", "delta"], polar: ["fjord"] };
/** Only Tidewater exists tonight; everything else is uncharted. */
export const CHARTED: ReadonlySet<Biome> = new Set<Biome>(["tidewater"]);

/** The biomes a face offers, in the band's order, with Tidewater first when it may go there. */
export function biomesFor(face: number): { biome: Biome; charted: boolean }[] {
  const band = bandOf(face);
  const list = BIOMES_BY_BAND[band].slice();
  if (!BAND_GATING && !list.includes("tidewater")) list.unshift("tidewater");
  return list.map(biome => ({ biome, charted: CHARTED.has(biome) && (biome !== "tidewater" || !BAND_GATING || band === "temperate") }));
}
export function biomeAllowed(face: number, biome: Biome): boolean {
  return biomesFor(face).some(b => b.biome === biome && b.charted);
}

export interface SectorMeta {
  version: 1;
  face: number;
  name: string;
  seed: number;
  biome: Biome;
  band: Band;
  population: number;
  cycles: number;
  buildings: number;
  money: number;
  /** ms since the epoch. */
  created: number;
  lastPlayed: number;
}
export interface SectorRecord { version: 1; meta: SectorMeta; state: SimState }

export interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const sectorKey = (face: number) => `tidewater.sector.${face}`;
export const metaKey = (face: number) => `${sectorKey(face)}.meta`;
export const ACTIVE_KEY = "tidewater.sector.active";
export const MIGRATED_KEY = "tidewater.sectors.migrated";
const LEGACY_AUTOSAVE = "tidewater.autosave";
const LEGACY_SLOT = (n: number) => `tidewater.slot.${n}`;

function checkFace(face: number): void {
  if (!Number.isInteger(face) || face < 0 || face >= FACES) throw new Error(`no such face: ${face}`);
}

/** The metadata a state and its naming produce. */
export function summarize(state: SimState, face: number, base: { name: string; biome: Biome; created: number }, now: number): SectorMeta {
  return {
    version: 1, face, name: base.name, seed: state.world.seed, biome: base.biome, band: bandOf(face),
    population: population(state), cycles: state.tide.cycle, buildings: Object.keys(state.buildings).length,
    money: Math.round(state.resources.money), created: base.created, lastPlayed: now,
  };
}

export function readMeta(store: Store, face: number): SectorMeta | null {
  checkFace(face);
  try {
    const raw = store.getItem(metaKey(face));
    if (!raw) return null;
    const m = JSON.parse(raw) as Partial<SectorMeta>;
    if (m.version !== 1 || typeof m.name !== "string" || typeof m.seed !== "number") return null;
    return { ...m, face, band: bandOf(face) } as SectorMeta;
  } catch {
    return null;
  }
}

export function listMetas(store: Store): (SectorMeta | null)[] {
  const out: (SectorMeta | null)[] = [];
  for (let f = 0; f < FACES; f++) out.push(readMeta(store, f));
  return out;
}

/** Write a sector: the state packed, the metadata refreshed from it. Returns the metadata written. */
export function writeSector(store: Store, face: number, state: SimState, base: { name: string; biome: Biome; created?: number }, now = Date.now()): SectorMeta {
  checkFace(face);
  const meta = summarize(state, face, { name: base.name, biome: base.biome, created: base.created ?? now }, now);
  store.setItem(sectorKey(face), compress(serialize(state)));
  store.setItem(metaKey(face), JSON.stringify(meta));
  return meta;
}

/** Read a sector's record (null when the face is empty or unreadable). */
export function readSector(store: Store, face: number): SectorRecord | null {
  const meta = readMeta(store, face);
  if (!meta) return null;
  try {
    const raw = store.getItem(sectorKey(face));
    if (!raw) return null;
    const state = deserialize(isPacked(raw) ? decompress(raw) : raw);
    return { version: 1, meta, state };
  } catch {
    return null;
  }
}

export function deleteSector(store: Store, face: number): void {
  checkFace(face);
  store.removeItem(sectorKey(face));
  store.removeItem(metaKey(face));
  if (readActive(store) === face) store.removeItem(ACTIVE_KEY);
}

export function renameSector(store: Store, face: number, name: string): SectorMeta | null {
  const meta = readMeta(store, face);
  if (!meta) return null;
  const next = { ...meta, name: name.trim() || meta.name };
  store.setItem(metaKey(face), JSON.stringify(next));
  return next;
}

/** The sector as portable JSON (metadata + the plain state), or null for an empty face. */
export function exportSector(store: Store, face: number): string | null {
  const rec = readSector(store, face);
  return rec ? JSON.stringify(rec) : null;
}

/** Import a record onto a face. Throws on anything that isn't a sector record with a loadable state. */
export function importSector(store: Store, face: number, json: string, now = Date.now()): SectorMeta {
  checkFace(face);
  let parsed: Partial<SectorRecord>;
  try { parsed = JSON.parse(json) as Partial<SectorRecord>; } catch { throw new Error("not JSON"); }
  if (!parsed || parsed.version !== 1 || !parsed.meta || !parsed.state) throw new Error("not a sector record");
  const state = deserialize(JSON.stringify(parsed.state)); // throws on a foreign or older state
  const m = parsed.meta as Partial<SectorMeta>;
  const name = typeof m.name === "string" && m.name.trim() ? m.name.trim() : "Imported Sea";
  const biome: Biome = m.biome && m.biome in BIOME_LABEL ? m.biome : "tidewater";
  return writeSector(store, face, state, { name, biome, created: typeof m.created === "number" ? m.created : now }, now);
}

export function readActive(store: Store): number | null {
  const raw = store.getItem(ACTIVE_KEY);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n < FACES ? n : null;
}
export function writeActive(store: Store, face: number | null): void {
  if (face === null) store.removeItem(ACTIVE_KEY); else { checkFace(face); store.setItem(ACTIVE_KEY, String(face)); }
}

const ORDINALS = ["First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Tenth", "Eleventh", "Twelfth"];
/** "First Sea", "Second Sea", … by how many seas already have towns (skipping names already taken). */
export function defaultName(store: Store): string {
  const taken = new Set(listMetas(store).filter((m): m is SectorMeta => !!m).map(m => m.name));
  const built = taken.size;
  for (let k = built; k < ORDINALS.length + built; k++) {
    const name = `${ORDINALS[k % ORDINALS.length]} Sea`;
    if (!taken.has(name)) return name;
  }
  return "New Sea";
}

/**
 * First run with the old layout: the autosave becomes face 1 and the three slots faces 2–4, keeping their island
 * seeds and slot names. Runs once (MIGRATED_KEY); the old keys are left where they were. Returns what moved.
 */
export function migrateLegacy(store: Store, now = Date.now()): SectorMeta[] {
  if (store.getItem(MIGRATED_KEY)) return [];
  const moved: SectorMeta[] = [];
  const tryState = (raw: string | null): SimState | null => { if (!raw) return null; try { return deserialize(raw); } catch { return null; } };
  const auto = tryState(store.getItem(LEGACY_AUTOSAVE));
  if (auto && !readMeta(store, 1)) {
    moved.push(writeSector(store, 1, auto, { name: "First Sea", biome: "tidewater", created: now }, now));
    writeActive(store, 1);
  }
  for (let n = 1; n <= 3; n++) {
    const face = n + 1;
    const state = tryState(store.getItem(LEGACY_SLOT(n)));
    if (!state || readMeta(store, face)) continue;
    let name = `Town ${n}`, savedAt = now;
    try {
      const meta = JSON.parse(store.getItem(`${LEGACY_SLOT(n)}.meta`) ?? "{}") as { name?: string; savedAt?: number };
      if (typeof meta.name === "string" && meta.name.trim()) name = meta.name.trim();
      if (typeof meta.savedAt === "number") savedAt = meta.savedAt;
    } catch { /* keep the defaults */ }
    moved.push(writeSector(store, face, state, { name, biome: "tidewater", created: savedAt }, savedAt));
  }
  store.setItem(MIGRATED_KEY, "1");
  return moved;
}

/** "2 hours ago", for the card. */
export function agoLabel(then: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}
