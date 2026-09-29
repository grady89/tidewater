// Save/load is JSON.stringify of the ledger. The grid index is rebuilt from the pieces on load.
import { zeros } from "./fields";
import { GOOD_IDS } from "./goods";
import { Building, createState, SimState, TradeState } from "./state";

export const AUTOSAVE_KEY = "tidewater.autosave";

export function serialize(state: SimState): string {
  return JSON.stringify(state);
}

/**
 * Parse a save. Throws on anything the current ledger can't run — the wrong version, or a save from a build
 * that lacked fields the state has now — so callers fall back to a new town instead of crashing mid-frame.
 * Fields added since are filled where that is safe (achievements).
 */
export function deserialize(json: string): SimState {
  const s = JSON.parse(json) as Partial<SimState>;
  const version = s.version as number | undefined;
  if (version !== 2 && version !== 3) throw new Error(`unsupported save version ${String(s.version)}`);
  // Version 2 → 3 (biomes): stockpiles keyed by the goods registry, a biome on the world, the ship's order book.
  if (s.resources) for (const g of GOOD_IDS) (s.resources as Record<string, number>)[g] ??= 0;
  if (s.world && (s.world as { biome?: unknown }).biome === undefined) (s.world as { biome?: string }).biome = "tidewater";
  if (s.trade) {
    const t = s.trade as Partial<TradeState> & { plankOrder?: number };
    t.orders ??= {};
    if (t.plankOrder !== undefined) { if (t.plankOrder > 0) t.orders.planks = (t.orders.planks ?? 0) + t.plankOrder; delete t.plankOrder; }
  }
  if (s.tide && (s.tide as { scale?: number }).scale === undefined) (s.tide as { scale?: number }).scale = 1;
  s.biomeState ??= {};
  if (s.fields && !(s.fields as Partial<SimState["fields"]>).bleach) (s.fields as SimState["fields"]).bleach = zeros();
  s.version = 3;
  s.achievements ??= []; // saves from before backlog 7
  s.extraTrees ??= []; s.landfill ??= []; // saves from before the land tools
  s.newLand ??= []; s.outbox ??= []; // saves from before the Cinder and the World's event bus
  s.sewers ??= []; delete (s as { wasteBacklog?: unknown }).wasteBacklog; // saves from before the sewers
  if (s.fields) delete (s.fields.coverage as { treatment?: unknown }).treatment;
  s.cargoShips ??= 0; s.cargo ??= { due: -1, cycle: -1 }; s.stormComing ??= null; // saves from before the sea lanes
  delete (s as { inbox?: unknown }).inbox;
  s.loan ??= { owed: 0, perCycle: 0, taken: 0 };
  s.world ??= { seed: 0, biome: "tidewater" }; // saves from before seeded islands: the original island
  for (const b of Object.values(s.buildings ?? {})) (b as Partial<Building>).rot ??= 0; // saves from before rotation
  if (s.tsunami && s.tsunami.due === undefined) s.tsunami.due = -1; // saves from before the warning cycle
  const fresh = createState();
  for (const key of Object.keys(fresh) as (keyof SimState)[]) {
    if (s[key] === undefined) throw new Error(`save is missing "${key}"`);
  }
  for (const key of Object.keys(fresh.fields) as (keyof SimState["fields"])[]) {
    if (s.fields![key] === undefined) throw new Error(`save is missing fields.${key}`);
  }
  return s as SimState;
}

/** Order-independent content hash of the ledger, for determinism checks. */
export function stateHash(state: SimState): string {
  const s = serialize(state);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, "0");
}
