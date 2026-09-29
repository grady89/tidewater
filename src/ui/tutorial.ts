// A six-step walkthrough card, then empty-state hints, told through one persistent card above the notifications.
// Each step says what to build, points at the tab and tool for it (the HUD pulses them), and clears itself when
// the town has done the thing. Progress lives in localStorage (UI state, not ledger state). Read-only over the sim.
import { BUILDINGS, Category } from "../sim/balance";
import { Grid } from "../sim/grid";
import { serviceWhy } from "../sim/services";
import { backedUpShare } from "../sim/sewers";
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
  /** Why the step is still open, when the player has plainly tried (shown under the text). */
  why?(state: SimState): string | null;
}

const has = (state: SimState, kind: string) => Object.values(state.buildings).some(b => b.kind === kind);
/** Built and on the street. */
const reached = (state: SimState, kind: string) => Object.values(state.buildings).some(b => b.kind === kind && b.reached);
const offStreet = (state: SimState, kinds: string[]) => Object.values(state.buildings).some(b => kinds.includes(b.kind) && !b.reached);
const OFF_STREET_WHY = "isn't on the street yet: a walkway has to touch one of its sides (the red marker is over it). Drag one to it from the street.";
const count = (state: SimState, kind: string) => Object.values(state.buildings).filter(b => b.kind === kind).length;
const boats = (state: SimState) => Object.values(state.buildings).reduce((n, b) => n + b.boats, 0);

export const STEPS: Step[] = [
  { title: "Build a pier", text: "Open the Sea tab, pick Pier and click the gold ring by your hut. Piers stand in deep water against the shore; boats fish from them.", tab: "Sea", tool: "pier", done: s => has(s, "pier") },
  { title: "Buy a boat", text: "Sea tab → Boat, then click the pier. Boats sail at high water and bring back fish.", tab: "Sea", tool: "boat", done: s => boats(s) > 0 },
  { title: "Lay a street", text: "Streets → Walkway, then drag from the pier to your hut. Walkways size their own stilts, so they never flood at an ordinary tide; low ground just costs more. An amber ghost means a spring tide will reach it — a raised walkway there stays dry.", tab: "Streets", tool: "walkway", done: s => Object.values(s.buildings).some(b => b.kind === "hut" && b.reached),
    why: s => count(s, "walkway") + count(s, "raisedWalkway") + count(s, "path") === 0 ? null : "Your street doesn't reach the hut yet: it has to run from the pier without a gap and touch a side of the hut. Drag again from the last plank to the hut." },
  { title: "Sell the catch", text: "Production → Fish market, touching the street: the green cells are where it can go with a walkway beside it. It sells fish at every high-tide peak; that is your income.", tab: "Production", tool: "market", done: s => reached(s, "market"),
    why: s => (has(s, "market") && !reached(s, "market") ? "Your market " + OFF_STREET_WHY : null) },
  { title: "Make room", text: "Homes → Hut, beside the street. Residents arrive at each high-tide peak while a home on the street has a free bed, there is fish in store and the town is content.", tab: "Homes", tool: "hut", done: s => Object.values(s.buildings).filter(b => (b.kind === "hut" || b.kind === "house") && b.reached).length >= 2,
    why: s => (offStreet(s, ["hut", "house"]) ? "A hut you built " + OFF_STREET_WHY : null) },
  { title: "Watch a tide", text: "Boats sail at high water; the ledger settles at the peak. Next, from Services: a well for water, and a sewage outfall set against a street or a pier (or joined to one by a sewer pipe) so the waste has somewhere to go.", done: s => s.tide.cycle >= 3 && population(s) >= 4 },
];

/** Tides the "walkthrough done" card stays up. */
const DONE_TIDES = 2;

export class Tutorial {
  private step = 0;
  /** Where this sea's progress is kept (each sea has its own walkthrough). */
  private key = KEY;
  /** The tide the walkthrough finished on in this sea, while its "done" card is up; -1 otherwise. */
  private doneAt = -1;
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
    try { localStorage.setItem(this.key, String(this.step)); } catch { /* ignore */ }
  }

  /**
   * Point the walkthrough at a sea (its own progress, under its face's key). A sea with no progress kept starts at
   * step 1 if it is fresh (nothing built but its hut), else where the old shared progress was.
   */
  bind(face: number, fresh: boolean): void {
    this.key = `${KEY}.${face}`;
    this.doneAt = -1;
    let kept: string | null = null;
    try { kept = localStorage.getItem(this.key); } catch { kept = null; }
    if (kept !== null) this.step = Math.min(STEPS.length, parseInt(kept, 10) || 0);
    else if (fresh) this.step = 0;
    this.persist();
  }

  skip(): void {
    this.step = STEPS.length;
    this.doneAt = -1;
    this.persist();
  }

  reset(): void {
    this.step = 0;
    this.doneAt = -1;
    this.persist();
  }

  /** The open step's pointers, for the HUD to pulse. */
  /** The current step's index (STEPS.length once the walkthrough is done) and title, for the playtest log. */
  get index(): number { return this.step; }
  get title(): string { return STEPS[this.step]?.title ?? "Walkthrough done"; }

  get current(): { tab?: Category; tool?: Tool } | null {
    if (this.step >= STEPS.length) return null;
    const s = STEPS[this.step];
    return { tab: s.tab, tool: s.tool };
  }

  get stepIndex(): number { return this.step; }

  /** The empty-state hint once the walkthrough is over: what the town is missing most. */
  private hint(state: SimState, grid: Grid | null): string {
    const bs = Object.values(state.buildings);
    if (!bs.some(b => b.kind === "pier" || b.kind === "dock" || b.kind === "harbor")) return "No pier: nothing can fish. Sea tab.";
    if (boats(state) === 0) return "No boats: buy one at the pier, or build a shipyard.";
    if (!bs.some(b => b.kind === "market")) return "No fish market: the catch has nowhere to go.";
    if (grid && bs.some(b => b.residents > 0 && backedUpShare(grid, b) > 0)) return bs.some(b => b.kind === "outfall")
      ? "Waste is backing up at some homes: their sewer has no way out. Join it to an outfall with a sewer pipe (Services tab), or give it its own."
      : "Waste is backing up into cesspits: a sewage outfall (Services tab) against a street, or joined to one by a sewer pipe, puts it in the sea.";
    // Water from anywhere counts: a well, the Delta's river, the Dunes' cistern — as the town stands now, not at the
    // last peak (a well built since serves already), and the hint says why a home goes without.
    if (grid) {
      const dry = bs.filter(b => BUILDINGS[b.kind].residents > 0 && b.residents > 0).map(b => serviceWhy(state, grid, "water", b)).filter(w => w !== "served" && w !== "partial");
      if (dry.includes("full")) return "The wells can't keep up: some homes in reach go without water. Click a well to upgrade it, or build another.";
      if (dry.includes("broken")) return "A damaged well serves no one: click it and Repair now.";
      if (dry.includes("offStreet")) return "A well that isn't on the street serves no one: lay a walkway up to one of its sides.";
      if (dry.length) return "Homes without water stay unhappy: a well (Services tab) within reach of them.";
    }
    return "";
  }

  /** A town with no pier and no money for one has nothing to earn with: say how to get out. */
  static stuck(state: SimState): string | null {
    const bs = Object.values(state.buildings);
    if (bs.some(b => b.kind === "pier" || b.kind === "dock" || b.kind === "harbor")) return null;
    if (state.resources.money >= BUILDINGS.pier.cost.money) return null;
    return `No pier and not enough for one (${BUILDINGS.pier.cost.money}$). Borrow (the button under the ledger), or right-click a building to remove it — half its cost comes back.`;
  }

  update(state: SimState, grid: Grid | null = null): void {
    while (this.step < STEPS.length && STEPS[this.step].done(state)) { this.step++; this.persist(); if (this.step === STEPS.length) this.doneAt = state.tide.cycle; }
    if (this.doneAt >= 0 && state.tide.cycle >= this.doneAt + DONE_TIDES) this.doneAt = -1;
    const stuck = Tutorial.stuck(state);
    let step = "", title = "", text = "";
    if (stuck) { step = "Stuck"; title = "Nothing can earn"; text = stuck; }
    else if (this.doneAt >= 0) { step = "Walkthrough complete"; title = "The town runs itself now"; text = "Your boats fish at high water and the market sells the catch at every peak. Next: a well and a sewage outfall (Services) keep people happy, a second food lets homes grow, and a hut whenever a job stands empty brings more hands."; }
    else if (this.step < STEPS.length) { const s = STEPS[this.step]; step = `Step ${this.step + 1} of ${STEPS.length}`; title = s.title; text = s.text; const why = s.why?.(state); if (why) text += ` — ${why}`; }
    else text = this.hint(state, grid);
    if (this.stepEl.textContent !== step) this.stepEl.textContent = step;
    if (this.titleEl.textContent !== title) this.titleEl.textContent = title;
    // Phones tap; the walkthrough's words follow.
    if (document.body.classList.contains("mobile")) text = text.replace("right-click a building to remove it", "tap a building and press Remove").replace("(the button under the ledger)", "(under More)").replace(/ tab\b/g, "").replace(/\bclicked\b/g, "tapped").replace(/\bclick(s?)\b/g, "tap$1");
    if (this.textEl.textContent !== text) this.textEl.textContent = text;
    this.el.classList.toggle("bare", title === "");
    this.el.hidden = text === "";
  }
}
