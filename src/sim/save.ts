// Save/load is JSON.stringify of the ledger. The grid index is rebuilt from the pieces on load.
import { createState, SimState } from "./state";

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
  if (s.version !== 2) throw new Error(`unsupported save version ${String(s.version)}`);
  s.achievements ??= []; // saves from before backlog 7
  s.extraTrees ??= []; s.landfill ??= []; // saves from before the land tools
  s.loan ??= { owed: 0, perCycle: 0, taken: 0 };
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
