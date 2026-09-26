// The UI: resource bar, build menu by category, tide clock, last-cycle ledger, notifications. Plain DOM over the
// canvas, read-only over the sim.
import { Fate, Tool } from "../build/placement";
import { BOAT_COST, BUILDING_KINDS, BuildingKind, BUILDINGS, CATEGORIES, Category, LANTERN_COST, PLANK_ORDER_SIZE, TRADE_PLANK_PRICE } from "../sim/balance";
import { canAfford } from "../sim/economy";
import { Grid } from "../sim/grid";
import { population, SimState } from "../sim/state";
import { cycleFraction, cyclesToSpring, isRising, secondsToHighTide, secondsToLowTide, tideNormalized } from "../sim/tide";
import { cyclesToShip } from "../sim/trade";
import { jobsAt } from "../sim/workers";
import { OverlayKind, OVERLAYS } from "../view/overlays";

export interface HudState {
  tool: Tool;
  blocker: string | null;
  fate: Fate;
  state: SimState;
}

interface ToolDef { tool: Tool; label: string; category: Category; cost: string }
const TOOLS: ToolDef[] = [
  ...BUILDING_KINDS.map(kind => ({ tool: kind as Tool, label: BUILDINGS[kind].name, category: BUILDINGS[kind].category, cost: costOf(kind) })),
  { tool: "boat", label: "Boat", category: "Sea", cost: `${BOAT_COST}$` },
  { tool: "lanternPost", label: "Lantern post", category: "Streets", cost: `${LANTERN_COST}$` },
];
const KEYS = "123456789";

function costOf(kind: BuildingKind): string {
  const c = BUILDINGS[kind].cost;
  const parts = [`${c.money}$`];
  if (c.planks) parts.push(`${c.planks}p`);
  if (c.timber) parts.push(`${c.timber}t`);
  return parts.join("+");
}

const FATE_TEXT: Record<Fate, string> = {
  safe: "Click to place · right-click to remove · drag to orbit",
  spring: "Floods at spring tides",
  always: "Floods every high tide",
};

const RESOURCES = ["money", "fish", "shellfish", "smoked", "timber", "planks", "population", "tourists", "happiness"];

// Tide dial geometry (SVG units). The fill rect is clipped to the inner disc.
const DIAL_R = 24, DIAL_TOP = 32 - DIAL_R, DIAL_H = DIAL_R * 2;

export class Hud {
  private readonly buttons = new Map<Tool, HTMLButtonElement>();
  private readonly reasons = new Map<Tool, HTMLElement>();
  private readonly tabs = new Map<Category, HTMLButtonElement>();
  private readonly res: Record<string, HTMLElement> = {};
  private readonly tideLevel: SVGRectElement;
  private readonly tideMarker: SVGCircleElement;
  private readonly tideValue: HTMLElement;
  private readonly tideSub: HTMLElement;
  private readonly tideSpring: HTMLElement;
  private readonly tideShip: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly ledgerLabel: HTMLElement;
  private readonly ledgerValue: HTMLElement;
  private readonly tradeStatus: HTMLElement;
  private readonly orderButton: HTMLButtonElement;
  private readonly notes: HTMLElement;
  private category: Category = "Homes";
  private lastCycle = -1;
  private lastLogLen = -1;

  constructor(root: HTMLElement, resources: HTMLElement, notes: HTMLElement, private readonly grid: Grid, private readonly onTool: (tool: Tool) => void, onOverlay: (kind: OverlayKind | null) => void, onOrder: () => void) {
    resources.innerHTML = RESOURCES.map(k => `<div class="res" data-res="${k}"><label>${k}</label><span>0</span></div>`).join("");
    for (const el of resources.querySelectorAll<HTMLElement>(".res")) this.res[el.dataset.res!] = el.querySelector("span")!;
    this.notes = notes;

    root.innerHTML = `
      <h1>Tidewater</h1>
      <div class="tide">
        <svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
          <defs><clipPath id="tideClip"><circle cx="32" cy="32" r="${DIAL_R}"/></clipPath></defs>
          <circle cx="32" cy="32" r="${DIAL_R}" fill="rgba(255,255,255,0.06)"/>
          <rect class="tide-level" x="${DIAL_TOP}" y="32" width="${DIAL_H}" height="${DIAL_R}" clip-path="url(#tideClip)"/>
          <circle cx="32" cy="32" r="29" fill="none" class="tide-track"/>
          <line x1="32" y1="1" x2="32" y2="6" class="tide-tick"/>
          <line x1="32" y1="58" x2="32" y2="63" class="tide-tick"/>
          <circle class="tide-marker" cx="32" cy="3" r="3"/>
        </svg>
        <div>
          <div class="tide-value">+0.00 m</div>
          <div class="tide-sub"></div>
          <div class="tide-spring"></div>
          <div class="tide-ship"></div>
        </div>
      </div>
      <div class="tabs"></div>
      <div class="palette"></div>
      <p class="hint"></p>
      <div class="overlays"><label>Overlay</label></div>
      <div class="score">
        <label></label>
        <div class="score-value">—</div>
        <div class="trade-row"><span class="trade-status"></span><button type="button" class="order">Order ${PLANK_ORDER_SIZE} planks · ${PLANK_ORDER_SIZE * TRADE_PLANK_PRICE}$</button></div>
      </div>`;

    const tabs = root.querySelector<HTMLElement>(".tabs")!;
    for (const cat of CATEGORIES) {
      if (!TOOLS.some(t => t.category === cat)) continue;
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = cat;
      b.addEventListener("click", () => this.showCategory(cat));
      tabs.appendChild(b);
      this.tabs.set(cat, b);
    }
    const palette = root.querySelector<HTMLElement>(".palette")!;
    for (const t of TOOLS) {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.category = t.category;
      b.innerHTML = `<span class="name">${t.label}</span><span class="cost">${t.cost}</span><span class="reason"></span><kbd></kbd>`;
      b.addEventListener("click", () => onTool(t.tool));
      palette.appendChild(b);
      this.buttons.set(t.tool, b);
      this.reasons.set(t.tool, b.querySelector<HTMLElement>(".reason")!);
    }
    const overlays = root.querySelector<HTMLElement>(".overlays")!;
    for (const o of [{ kind: null, label: "None" }, ...OVERLAYS]) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = o.label;
      b.classList.toggle("active", o.kind === null);
      b.addEventListener("click", () => {
        for (const x of overlays.querySelectorAll("button")) x.classList.toggle("active", x === b);
        onOverlay(o.kind);
      });
      overlays.appendChild(b);
    }
    this.tideLevel = root.querySelector<SVGRectElement>(".tide-level")!;
    this.tideMarker = root.querySelector<SVGCircleElement>(".tide-marker")!;
    this.tideValue = root.querySelector<HTMLElement>(".tide-value")!;
    this.tideSub = root.querySelector<HTMLElement>(".tide-sub")!;
    this.tideSpring = root.querySelector<HTMLElement>(".tide-spring")!;
    this.tideShip = root.querySelector<HTMLElement>(".tide-ship")!;
    this.hint = root.querySelector<HTMLElement>(".hint")!;
    this.ledgerLabel = root.querySelector<HTMLElement>(".score label")!;
    this.ledgerValue = root.querySelector<HTMLElement>(".score-value")!;
    this.tradeStatus = root.querySelector<HTMLElement>(".trade-status")!;
    this.orderButton = root.querySelector<HTMLButtonElement>(".order")!;
    this.orderButton.addEventListener("click", () => onOrder());
    this.showCategory("Streets");
  }

  /** Tools of the active category, in palette order (number keys map onto these). */
  private visibleTools(): ToolDef[] {
    return TOOLS.filter(t => t.category === this.category);
  }

  showCategory(cat: Category): void {
    this.category = cat;
    for (const [c, b] of this.tabs) b.classList.toggle("active", c === cat);
    const visible = this.visibleTools();
    for (const [tool, b] of this.buttons) {
      const idx = visible.findIndex(t => t.tool === tool);
      b.hidden = idx < 0;
      b.querySelector("kbd")!.textContent = idx >= 0 ? KEYS[idx] ?? "" : "";
    }
  }

  /** Keyboard: digits pick within the active category; Tab cycles categories. */
  key(key: string): boolean {
    const idx = KEYS.indexOf(key);
    if (idx >= 0) {
      const t = this.visibleTools()[idx];
      if (t) { this.onTool(t.tool); return true; }
      return false;
    }
    if (key === "Tab") {
      const cats = [...this.tabs.keys()];
      this.showCategory(cats[(cats.indexOf(this.category) + 1) % cats.length]);
      return true;
    }
    return false;
  }

  /** Why a tool is greyed, or null. */
  private lock(state: SimState, tool: Tool): string | null {
    if (tool === "boat") return state.resources.money >= BOAT_COST ? null : "no money";
    if (tool === "lanternPost") return state.resources.money >= LANTERN_COST ? null : "no money";
    const def = BUILDINGS[tool];
    if (def.requires && !this.grid.has(def.requires)) return `needs ${BUILDINGS[def.requires].name.toLowerCase()}`;
    if (!canAfford(state, def.cost)) {
      const r = state.resources;
      if (r.money < def.cost.money) return "no money";
      if ((def.cost.planks ?? 0) > r.planks) return "no planks";
      return "no timber";
    }
    return null;
  }

  update(s: HudState): void {
    const { state } = s;
    const r = state.resources;
    const active = TOOLS.find(t => t.tool === s.tool);
    if (active && active.category !== this.category) this.showCategory(active.category);
    for (const [tool, b] of this.buttons) {
      b.classList.toggle("active", tool === s.tool);
      const lock = this.lock(state, tool);
      b.classList.toggle("unaffordable", lock !== null);
      const reason = this.reasons.get(tool)!;
      if (reason.textContent !== (lock ?? "")) reason.textContent = lock ?? "";
    }

    let jobs = 0;
    for (const b of Object.values(state.buildings)) jobs += jobsAt(b);
    this.res.money.textContent = `${Math.floor(r.money)}$`;
    this.res.fish.textContent = `${Math.floor(r.fish)}`;
    this.res.shellfish.textContent = `${Math.floor(r.shellfish)}`;
    this.res.smoked.textContent = `${Math.floor(r.smoked)}`;
    this.res.timber.textContent = `${Math.floor(r.timber)}`;
    this.res.planks.textContent = `${Math.floor(r.planks)}`;
    this.res.population.textContent = `${population(state)} / ${jobs} jobs`;
    this.res.tourists.textContent = `${state.tourists}`;
    this.res.happiness.textContent = `${Math.round(state.happiness * 100)}%`;

    const { tide } = state;
    const top = DIAL_TOP + (1 - Math.min(1, Math.max(0, tideNormalized(tide)))) * DIAL_H;
    this.tideLevel.setAttribute("y", top.toFixed(2));
    this.tideLevel.setAttribute("height", (DIAL_TOP + DIAL_H - top).toFixed(2));
    this.tideMarker.setAttribute("transform", `rotate(${(cycleFraction(tide) * 360).toFixed(1)} 32 32)`);
    this.tideValue.textContent = `${tide.level >= 0 ? "+" : ""}${tide.level.toFixed(2)} m`;
    const phase = state.phase === "high" ? "high water" : state.phase === "low" ? "low water" : "slack";
    this.tideSub.textContent = isRising(tide)
      ? `${phase} · rising · high in ${Math.ceil(secondsToHighTide(tide))} s`
      : `${phase} · falling · low in ${Math.ceil(secondsToLowTide(tide))} s`;
    const toSpring = cyclesToSpring(tide);
    this.tideSpring.textContent = toSpring === 1 ? "Spring tide at the next high water" : `Spring tide in ${toSpring} high tides`;
    this.tideSpring.classList.toggle("now", toSpring === 1);
    const toShip = cyclesToShip(state);
    this.tideShip.textContent = toShip < 0 ? "" : toShip === 0 ? "Trade ship in port" : `Trade ship in ${toShip} high tide${toShip > 1 ? "s" : ""}`;
    this.tradeStatus.textContent = state.trade.plankOrder > 0 ? `${state.trade.plankOrder} planks on order` : "";
    this.orderButton.hidden = toShip < 0;

    this.hint.textContent = s.blocker ?? FATE_TEXT[s.fate];
    this.hint.classList.toggle("blocked", s.blocker !== null);
    this.hint.classList.toggle("warn", s.blocker === null && s.fate !== "safe");

    if (state.last.cycle !== this.lastCycle) {
      this.lastCycle = state.last.cycle;
      const l = state.last;
      if (l.cycle === 0) {
        this.ledgerLabel.textContent = "Ledger";
        this.ledgerValue.textContent = "First high tide pending";
      } else {
        const net = l.income - l.expenses;
        this.ledgerLabel.textContent = `Cycle ${l.cycle}`;
        const extras = [l.tourism > 0 ? `${l.tourism.toFixed(0)}$ tourism` : "", l.trade !== 0 ? `${l.trade >= 0 ? "+" : ""}${l.trade.toFixed(0)}$ trade` : ""].filter(Boolean);
        this.ledgerValue.textContent = `${net >= 0 ? "+" : ""}${net.toFixed(0)}$ · ${l.fishCaught.toFixed(0)} fish landed · ${(l.fishSold + l.shellfishSold).toFixed(0)} sold${extras.length ? " · " + extras.join(" · ") : ""}`;
        this.ledgerValue.classList.remove("flash");
        void this.ledgerValue.offsetWidth;
        this.ledgerValue.classList.add("flash");
      }
    }

    if (state.log.length !== this.lastLogLen) {
      this.lastLogLen = state.log.length;
      this.notes.innerHTML = state.log.slice(-4).map(m => `<div>${m}</div>`).join("");
    }
  }
}
