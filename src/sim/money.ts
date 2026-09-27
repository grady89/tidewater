// Every change to the purse goes through `moveMoney`, so a listener (the fuzzer's double-entry check, a playtest
// log) sees each one as an entry with a reason. The listener is test instrumentation: it is not part of the state,
// never changes a number, and is null in the game.
import { SimState } from "./state";

export interface MoneyEntry {
  /** Signed: earnings positive, spending negative. */
  amount: number;
  /** The account: "build", "refund", "boat", "settlement", "trade", "tourism", "loan", "repair", "landfill", … */
  why: string;
}

let listener: ((e: MoneyEntry, state: SimState) => void) | null = null;

/** Subscribe to every money movement (null to stop). One listener at a time. */
export function auditMoney(fn: ((e: MoneyEntry, state: SimState) => void) | null): void {
  listener = fn;
}

/** Move `amount` into (positive) or out of (negative) the purse, and tell the listener why. */
export function moveMoney(state: SimState, amount: number, why: string): void {
  if (amount === 0) return;
  state.resources.money += amount;
  if (listener) listener({ amount, why }, state);
}
