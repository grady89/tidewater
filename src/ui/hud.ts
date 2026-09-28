// The UI: resource bar, build menu by category, tide clock, last-cycle ledger, notifications. Plain DOM over the
// canvas, read-only over the sim.
import { Fate, isBuildingTool, Tool } from "../build/placement";
import { BOAT_COST, BUILDING_KINDS, BuildingKind, BUILDINGS, CATEGORIES, Category, CLEAR_TIMBER, LANDFILL_COST, LANTERN_COST, LIFT_STEP, LOAN_AMOUNT, LOAN_INTEREST, LOAN_REPAY_CYCLES, PLANK_ORDER_SIZE, PLANT_COST, TRADE_PLANK_PRICE } from "../sim/balance";
import { biomeFor, BiomeId, catalogFor, makesOf } from "../sim/biomes";
import { canAfford } from "../sim/economy";
import { GOOD_IDS, GOOD_ROLES, GoodId, GOODS, shownGoods } from "../sim/goods";
import { Grid } from "../sim/grid";
import { population, SimState } from "../sim/state";
import { cycleFraction, cyclesToSpring, isRising, secondsToHighTide, secondsToLowTide, tideNormalized } from "../sim/tide";
import { cyclesToShip } from "../sim/trade";
import { jobsAt } from "../sim/workers";
import { OverlayKind, OVERLAYS } from "../view/overlays";

export interface HudState {
  tool: Tool;
  blocker: string | null;
  warn: string | null;
  line: { count: number; cost: number } | null;
  /** Deck lift steps for the current tool, or null when the tool has no lift. */
  lift: number | null;
  /** The current tool is a building that R turns. */
  rotatable: boolean;
  /** Stilt length under the hovered footprint (0 for kinds that don't price stilts) and its full price. */
  stilt: number;
  cost: number;
  fate: Fate;
  state: SimState;
}

interface ToolDef { tool: Tool; label: string; category: Category; cost: string }
const TOOLS: ToolDef[] = [
  ...BUILDING_KINDS.map(kind => ({ tool: kind as Tool, label: BUILDINGS[kind].name, category: BUILDINGS[kind].category, cost: costOf(kind) })),
  { tool: "boat", label: "Boat", category: "Sea", cost: `${BOAT_COST}$` },
  { tool: "lanternPost", label: "Lantern post", category: "Streets", cost: `${LANTERN_COST}$` },
  { tool: "landfill", label: "Landfill", category: "Land", cost: `${LANDFILL_COST.money}$+${LANDFILL_COST.timber}t` },
  { tool: "plantTree", label: "Plant tree", category: "Land", cost: `${PLANT_COST}$` },
  { tool: "clearTree", label: "Clear tree", category: "Land", cost: `+${CLEAR_TIMBER}t` },
];
const KEYS = "123456789";

function costOf(kind: BuildingKind): string {
  const c = BUILDINGS[kind].cost;
  const parts = [`${c.money}$`];
  if (c.planks) parts.push(`${c.planks}p`);
  if (c.timber) parts.push(`${c.timber}t`);
  return parts.join("+");
}

const FATE_TEXT: Record<Fate | "line", string> = {
  safe: "Click to place · right-click to remove (half the cost comes back)",
  line: "Click to place, or drag to lay a run · right-click to remove",
  spring: "Low ground: floods at spring tides — a raised walkway or landfill stays dry",
  always: "Floods every high tide",
};
const LINE_TOOL_HINT: ReadonlySet<Tool> = new Set<Tool>(["walkway", "raisedWalkway", "path", "breakwater", "sharkNet", "seaWall"]);

/** The bar's fixed cells; the goods sit between money and population, grouped by role, per the island. */
const RESOURCES_HEAD = ["money"];
const RESOURCES_TAIL = ["population", "tourists", "happiness"];

// Tide dial geometry (SVG units). The fill rect is clipped to the inner disc.
const DIAL_R = 24, DIAL_TOP = 32 - DIAL_R, DIAL_H = DIAL_R * 2;

export class Hud {
  private readonly buttons = new Map<Tool, HTMLButtonElement>();
  private readonly reasons = new Map<Tool, HTMLElement>();
  private readonly tabs = new Map<Category, HTMLButtonElement>();
  private readonly res: Record<string, HTMLElement> = {};
  private readonly resources: HTMLElement;
  private shownGoods: GoodId[] = [];
  private readonly tideLevel: SVGRectElement;
  private readonly tideMarker: SVGCircleElement;
  private readonly tideValue: HTMLElement;
  private readonly tideSub: HTMLElement;
  private readonly tideSpring: HTMLElement;
  private readonly tideShip: HTMLElement;
  private readonly tideEvent: HTMLElement;
  private readonly hint: HTMLElement;
  /** What the hint line shows, and whether it is just the tool's default prompt (for the playtest log). */
  lastHint = { text: "", isDefault: true };
  private readonly ledgerLabel: HTMLElement;
  private readonly ledgerValue: HTMLElement;
  private readonly tradeStatus: HTMLElement;
  private readonly orderButton: HTMLButtonElement;
  private readonly loanStatus: HTMLElement;
  private readonly loanButton: HTMLButtonElement;
  private readonly notes: HTMLElement;
  private _category: Category = "Homes";
  private lastTool: Tool | null = null;
  private lastCycle = -1;
  private lastLogLen = -1;

  constructor(root: HTMLElement, resources: HTMLElement, notes: HTMLElement, private readonly grid: Grid, private readonly onTool: (tool: Tool) => void, onOverlay: (kind: OverlayKind | null) => void, onOrder: () => void, onLoan: () => void = () => {}) {
    this.resources = resources;
    this.layoutResources([]);
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
          <div class="tide-event"></div>
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
        <div class="trade-row loan-row"><span class="loan-status"></span><button type="button" class="order loan" title="${LOAN_AMOUNT}$ now, ${Math.round(LOAN_AMOUNT * (1 + LOAN_INTEREST))}$ back over ${LOAN_REPAY_CYCLES} tides">Borrow ${LOAN_AMOUNT}$</button></div>
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
    this.tideEvent = root.querySelector<HTMLElement>(".tide-event")!;
    this.hint = root.querySelector<HTMLElement>(".hint")!;
    this.ledgerLabel = root.querySelector<HTMLElement>(".score label")!;
    this.ledgerValue = root.querySelector<HTMLElement>(".score-value")!;
    this.tradeStatus = root.querySelector<HTMLElement>(".trade-status")!;
    this.orderButton = root.querySelector<HTMLButtonElement>(".order")!;
    this.orderButton.addEventListener("click", () => onOrder());
    this.loanStatus = root.querySelector<HTMLElement>(".loan-status")!;
    this.loanButton = root.querySelector<HTMLButtonElement>(".loan")!;
    this.loanButton.addEventListener("click", () => onLoan());
    this.showCategory("Streets");
  }

  /** Rebuild the resource bar for a set of goods: money, then the goods grouped by role, then the people. */
  private layoutResources(goods: GoodId[]): void {
    const cell = (k: string, label: string) => `<div class="res" data-res="${k}"><label>${label}</label><span>0</span></div>`;
    const groups = GOOD_ROLES.map(role => goods.filter(g => GOODS[g].role === role)).filter(gs => gs.length)
      .map(gs => `<div class="res-group" data-role="${GOODS[gs[0]].role}">${gs.map(g => cell(g, GOODS[g].name)).join("")}</div>`);
    this.resources.innerHTML = [RESOURCES_HEAD.map(k => cell(k, k)).join(""), ...groups, RESOURCES_TAIL.map(k => cell(k, k)).join("")].join("");
    for (const k of Object.keys(this.res)) delete this.res[k];
    for (const el of this.resources.querySelectorAll<HTMLElement>(".res")) this.res[el.dataset.res!] = el.querySelector("span")!;
    this.shownGoods = goods;
  }

  /** The island's biome, for the catalog: tools outside base ∪ unique − excluded are hidden. */
  private biome: BiomeId = "tidewater";
  private inCatalog(t: ToolDef): boolean {
    return !isBuildingTool(t.tool) || catalogFor(this.biome).includes(t.tool);
  }
  /** Tools of the active category and the island's catalog, in palette order (number keys map onto these). */
  private visibleTools(): ToolDef[] {
    return TOOLS.filter(t => t.category === this._category && this.inCatalog(t));
  }

  get category(): Category { return this._category; }

  /** Pulse the tab and tool the walkthrough points at (null clears). */
  highlight(h: { tab?: Category; tool?: Tool } | null): void {
    for (const [c, b] of this.tabs) b.classList.toggle("pulse", !!h?.tab && c === h.tab);
    for (const [t, b] of this.buttons) b.classList.toggle("pulse", !!h?.tool && t === h.tool);
  }

  showCategory(cat: Category): void {
    this._category = cat;
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
      this.showCategory(cats[(cats.indexOf(this._category) + 1) % cats.length]);
      return true;
    }
    return false;
  }

  /** Why a tool is greyed, or null. */
  private lock(state: SimState, tool: Tool): string | null {
    if (tool === "boat") return state.resources.money >= BOAT_COST ? null : "no money";
    if (tool === "lanternPost") return state.resources.money >= LANTERN_COST ? null : "no money";
    if (tool === "landfill") return state.resources.money < LANDFILL_COST.money ? "no money" : state.resources.timber < LANDFILL_COST.timber ? "no timber" : null;
    if (tool === "plantTree") return state.resources.money >= PLANT_COST ? null : "no money";
    if (tool === "clearTree") return null;
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
    if (state.world.biome !== this.biome) { this.biome = state.world.biome; this.showCategory(this._category); }
    // Follow the tool's category only when the tool changes; otherwise a clicked tab would snap straight back.
    if (s.tool !== this.lastTool) {
      this.lastTool = s.tool;
      const active = TOOLS.find(t => t.tool === s.tool);
      if (active && active.category !== this._category) this.showCategory(active.category);
    }
    for (const [tool, b] of this.buttons) {
      b.classList.toggle("active", tool === s.tool);
      const lock = this.lock(state, tool);
      b.classList.toggle("unaffordable", lock !== null);
      const reason = this.reasons.get(tool)!;
      if (reason.textContent !== (lock ?? "")) reason.textContent = lock ?? "";
    }

    let jobs = 0;
    for (const b of Object.values(state.buildings)) jobs += jobsAt(b);
    const goods = shownGoods(r, makesOf(state.world.biome));
    if (goods.length !== this.shownGoods.length || goods.some((g, i) => g !== this.shownGoods[i])) this.layoutResources(goods);
    this.res.money.textContent = `${Math.floor(r.money)}$`;
    for (const g of goods) {
      const text = `${Math.floor(r[g])}`;
      if (this.res[g].textContent !== text) this.res[g].textContent = text;
    }
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
    const orders = GOOD_IDS.filter(g => (state.trade.orders[g] ?? 0) > 0).map(g => `${state.trade.orders[g]} ${GOODS[g].name}`);
    const orderText = orders.length ? `On order: ${orders.join(", ")}` : "";
    if (this.tradeStatus.textContent !== orderText) this.tradeStatus.textContent = orderText;
    this.orderButton.hidden = toShip < 0;
    const loan = state.loan;
    const loanText = loan.owed > 0 ? `Loan: ${Math.ceil(loan.owed)}$ owed · ${Math.round(loan.perCycle)}$ a tide` : "";
    if (this.loanStatus.textContent !== loanText) this.loanStatus.textContent = loanText;
    this.loanButton.hidden = loan.owed > 0;
    const ts = state.tsunami.stage;
    const uneasy = ts === null && state.tsunami.due >= 0;
    const season = biomeFor(state).seasonLabel?.(state) ?? "";
    this.tideEvent.textContent = ts === "drawdown" ? "The sea is pulling back" : ts === "wave" ? "A wave is coming in" : ts === "settle" ? "The water returns" : uneasy ? "The sea is uneasy: a wave at the next peak" : state.storm.active ? "Storm: the boats stay in" : season;
    this.tideEvent.classList.toggle("now", ts !== null || state.storm.active || uneasy);

    const lineText = s.line ? `${s.line.count} × ${TOOLS.find(t => t.tool === s.tool)?.label.toLowerCase() ?? s.tool} · ${s.line.cost}$ — release to lay them` : null;
    const fateText = s.fate !== "safe" ? FATE_TEXT[s.fate] : null;
    // Auto-sized pieces show their stilts and the price they make: long stilts on low ground cost more.
    const stiltText = s.lift !== null ? `Stilts ${s.stilt.toFixed(1)} m · ${s.cost}$${s.lift > 0 ? ` · deck +${(s.lift * LIFT_STEP).toFixed(1)} m` : ""} · [ ] lifts the deck` : null;
    const base = LINE_TOOL_HINT.has(s.tool) ? FATE_TEXT.line : FATE_TEXT.safe;
    const turnText = s.rotatable ? "R turns it (the door faces the street on its own)" : null;
    const cautions = [s.warn, fateText, stiltText, turnText].filter((t): t is string => t !== null);
    const hintText = s.blocker ?? lineText ?? (cautions.length ? cautions.join(" · ") : base);
    this.lastHint = { text: hintText, isDefault: hintText === base };
    this.hint.textContent = hintText;
    this.hint.classList.toggle("blocked", s.blocker !== null);
    this.hint.classList.toggle("warn", s.blocker === null && !s.line && (s.warn !== null || s.fate !== "safe"));

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
