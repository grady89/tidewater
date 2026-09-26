// A five-step tutorial and the empty-state hints, told through one persistent line above the notifications.
// Progress lives in localStorage (it's UI state, not ledger state); each step clears itself when the town has done
// the thing. Read-only over the sim.
import { BUILDINGS } from "../sim/balance";
import { population, SimState } from "../sim/state";

const KEY = "tidewater.tutorial";

interface Step { text: string; done(state: SimState): boolean }

const has = (state: SimState, kind: string) => Object.values(state.buildings).some(b => b.kind === kind);
const boats = (state: SimState) => Object.values(state.buildings).reduce((n, b) => n + b.boats, 0);

export const STEPS: Step[] = [
  { text: "1 · Build a pier: open the Sea tab and click deep water against the shore.", done: s => has(s, "pier") },
  { text: "2 · Buy a boat: pick Boat in the Sea tab and click your pier.", done: s => boats(s) > 0 },
  { text: "3 · Lay walkways (Streets tab) from the pier to your hut. Low ground floods — the ghost turns amber or red; use raised walkways there.", done: s => Object.values(s.buildings).some(b => b.kind === "hut" && b.reached) },
  { text: "4 · Build a fish market (Production tab) on the walkways so the catch can be sold, and more huts for the crew.", done: s => has(s, "market") },
  { text: "5 · Watch the tide clock: boats sail at high water and the market settles at the peak. Residents arrive while there is food, work and room.", done: s => s.tide.cycle >= 3 && population(s) >= 4 },
];

export class Tutorial {
  private step = 0;

  constructor(private readonly el: HTMLElement) {
    try { this.step = Math.min(STEPS.length, parseInt(localStorage.getItem(KEY) ?? "0", 10) || 0); } catch { this.step = 0; }
    el.addEventListener("click", () => this.skip());
  }

  private persist(): void {
    try { localStorage.setItem(KEY, String(this.step)); } catch { /* ignore */ }
  }

  skip(): void {
    this.step = STEPS.length;
    this.persist();
  }

  reset(): void {
    this.step = 0;
    this.persist();
  }

  /** The empty-state hint once the tutorial is over: what the town is missing most. */
  private hint(state: SimState): string {
    const bs = Object.values(state.buildings);
    if (!bs.some(b => b.kind === "pier" || b.kind === "dock" || b.kind === "harbor")) return "No pier: nothing can fish. Sea tab.";
    if (boats(state) === 0) return "No boats: buy one at the pier, or build a shipyard.";
    if (!bs.some(b => b.kind === "market")) return "No fish market: the catch has nowhere to go.";
    if (!bs.some(b => b.kind === "outfall") && state.wasteBacklog > 0) return "Waste is piling up: a sewage outfall (Services tab) puts it in the sea.";
    if (!bs.some(b => b.kind === "well")) return "No well: homes without water stay unhappy.";
    return "";
  }

  /** A town with no pier and no money for one has nothing to earn with: say how to get out. */
  static stuck(state: SimState): string | null {
    const bs = Object.values(state.buildings);
    if (bs.some(b => b.kind === "pier" || b.kind === "dock" || b.kind === "harbor")) return null;
    if (state.resources.money >= BUILDINGS.pier.cost.money) return null;
    return `Stuck: no pier and not enough for one (${BUILDINGS.pier.cost.money}$). Right-click a building to remove it — half its cost comes back.`;
  }

  update(state: SimState): void {
    while (this.step < STEPS.length && STEPS[this.step].done(state)) { this.step++; this.persist(); }
    const text = Tutorial.stuck(state) ?? (this.step < STEPS.length ? STEPS[this.step].text + "  (click to skip)" : this.hint(state));
    if (this.el.textContent !== text) this.el.textContent = text;
    this.el.hidden = text === "";
  }
}
