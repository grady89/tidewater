// A six-step walkthrough card, then empty-state hints, told through one persistent card above the notifications.
// Each step says what to build, points at the tab and tool for it (the HUD pulses them), and clears itself when
// the town has done the thing. Progress lives in localStorage (UI state, not ledger state). Read-only over the sim.
import { BUILDINGS, Category } from "../sim/balance";
import { population, SimState } from "../sim/state";
import { Tool } from "../build/placement";

const KEY = "tidewater.tutorial";

export interface Step {
  title: string;
  text: string;
  /** What to point at while the step is open. */
  tab?: Category;
  tool?: Tool;
  done(state: SimState): boolean;
}

const has = (state: SimState, kind: string) => Object.values(state.buildings).some(b => b.kind === kind);
const count = (state: SimState, kind: string) => Object.values(state.buildings).filter(b => b.kind === kind).length;
const boats = (state: SimState) => Object.values(state.buildings).reduce((n, b) => n + b.boats, 0);

export const STEPS: Step[] = [
  { title: "Build a pier", text: "Open the Sea tab, pick Pier and click the gold ring by your hut. Piers stand in deep water against the shore; boats fish from them.", tab: "Sea", tool: "pier", done: s => has(s, "pier") },
  { title: "Buy a boat", text: "Sea tab → Boat, then click the pier. Boats sail at high water and bring back fish.", tab: "Sea", tool: "boat", done: s => boats(s) > 0 },
  { title: "Lay a street", text: "Streets → Walkway, then drag from the pier to your hut. An amber or red ghost means the tide will flood it: press ] to raise the deck, or use a raised walkway.", tab: "Streets", tool: "walkway", done: s => Object.values(s.buildings).some(b => b.kind === "hut" && b.reached) },
  { title: "Sell the catch", text: "Production → Fish market, on the street. It sells fish at every high-tide peak; that is your income.", tab: "Production", tool: "market", done: s => has(s, "market") },
  { title: "Make room", text: "Homes → Hut, beside the street. Residents move in while there is food, work and a free bed.", tab: "Homes", tool: "hut", done: s => count(s, "hut") + count(s, "house") >= 2 },
  { title: "Watch a tide", text: "Boats sail at high water; the ledger settles at the peak. Next: a well and a sewage outfall (Services) keep people happy.", done: s => s.tide.cycle >= 3 && population(s) >= 4 },
];

export class Tutorial {
  private step = 0;
  private readonly stepEl: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly textEl: HTMLElement;

  constructor(private readonly el: HTMLElement) {
    el.innerHTML = `<div class="tut-head"><span class="tut-step"></span><button type="button" class="skip" title="Skip the walkthrough">Skip</button></div><h3></h3><p></p>`;
    this.stepEl = el.querySelector<HTMLElement>(".tut-step")!;
    this.titleEl = el.querySelector("h3")!;
    this.textEl = el.querySelector("p")!;
    try { this.step = Math.min(STEPS.length, parseInt(localStorage.getItem(KEY) ?? "0", 10) || 0); } catch { this.step = 0; }
    el.querySelector("button")!.addEventListener("click", () => this.skip());
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

  /** The open step's pointers, for the HUD to pulse. */
  get current(): { tab?: Category; tool?: Tool } | null {
    if (this.step >= STEPS.length) return null;
    const s = STEPS[this.step];
    return { tab: s.tab, tool: s.tool };
  }

  get stepIndex(): number { return this.step; }

  /** The empty-state hint once the walkthrough is over: what the town is missing most. */
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
    return `No pier and not enough for one (${BUILDINGS.pier.cost.money}$). Right-click a building to remove it — half its cost comes back.`;
  }

  update(state: SimState): void {
    while (this.step < STEPS.length && STEPS[this.step].done(state)) { this.step++; this.persist(); }
    const stuck = Tutorial.stuck(state);
    let step = "", title = "", text = "";
    if (stuck) { step = "Stuck"; title = "Nothing can earn"; text = stuck; }
    else if (this.step < STEPS.length) { const s = STEPS[this.step]; step = `Step ${this.step + 1} of ${STEPS.length}`; title = s.title; text = s.text; }
    else text = this.hint(state);
    if (this.stepEl.textContent !== step) this.stepEl.textContent = step;
    if (this.titleEl.textContent !== title) this.titleEl.textContent = title;
    if (this.textEl.textContent !== text) this.textEl.textContent = text;
    this.el.classList.toggle("bare", title === "");
    this.el.hidden = text === "";
  }
}
