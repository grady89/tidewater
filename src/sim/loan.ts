// A loan, the way city builders offer one: a lump sum now, repaid with interest in equal instalments at every
// settlement, one at a time. It is the way out of a bad start (money gone, nothing earning) and a way to bring
// a harbor forward; the interest keeps it from being free money.
import { LOAN_AMOUNT, LOAN_GRACE_CYCLES, LOAN_INTEREST, LOAN_REPAY_CYCLES } from "./balance";
import { moveMoney } from "./money";
import { notify, SimState } from "./state";

export function canBorrow(state: SimState): boolean {
  return state.loan.owed <= 0;
}

/** The instalment taken at each settlement. */
export function loanInstalment(): number {
  return (LOAN_AMOUNT * (1 + LOAN_INTEREST)) / LOAN_REPAY_CYCLES;
}

export function takeLoan(state: SimState): boolean {
  if (!canBorrow(state)) return false;
  moveMoney(state, LOAN_AMOUNT, "loan");
  state.loan.owed = LOAN_AMOUNT * (1 + LOAN_INTEREST);
  state.loan.perCycle = loanInstalment();
  state.loan.taken++;
  state.loan.holdUntil = state.tide.cycle + LOAN_GRACE_CYCLES;
  notify(state, `Borrowed ${LOAN_AMOUNT}$: up to ${Math.round(state.loan.perCycle)}$ a tide out of what the town earns, from ${LOAN_GRACE_CYCLES} tides on, until ${Math.round(state.loan.owed)}$ is repaid`);
  return true;
}

/**
 * At settlement: pay the instalment out of `surplus`, what the cycle earned above its upkeep — never out of the
 * purse, so a town that has stalled owes the loan but is not drained by it. Returns what was paid (an expense).
 */
export function repayLoan(state: SimState, surplus: number): number {
  if (state.loan.owed <= 0) return 0;
  if (state.tide.cycle <= (state.loan.holdUntil ?? -1)) return 0;
  const pay = Math.min(state.loan.owed, state.loan.perCycle, Math.max(0, surplus));
  if (pay <= 0) return 0;
  state.loan.owed -= pay;
  if (state.loan.owed < 1e-6) { state.loan.owed = 0; state.loan.perCycle = 0; notify(state, "The loan is paid off"); }
  return pay;
}
