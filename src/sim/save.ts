// Save/load is JSON.stringify of the ledger. The grid index is rebuilt from the pieces on load.
import { SimState } from "./state";

export const AUTOSAVE_KEY = "tidewater.autosave";

export function serialize(state: SimState): string {
  return JSON.stringify(state);
}

export function deserialize(json: string): SimState {
  const s = JSON.parse(json) as SimState;
  if (s.version !== 2) throw new Error(`unsupported save version ${String(s.version)}`);
  s.achievements ??= []; // saves from before backlog 7
  return s;
}

/** Order-independent content hash of the ledger, for determinism checks. */
export function stateHash(state: SimState): string {
  const s = serialize(state);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, "0");
}
