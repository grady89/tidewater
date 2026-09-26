// The UI: resource bar, build palette, tide clock, last-cycle ledger, notifications. Plain DOM over the canvas,
// read-only over the sim.
import { Tool } from "../build/placement";
import { BOAT_COST, BUILDING_KINDS, BuildingKind, BUILDINGS } from "../sim/balance";
import { canAfford } from "../sim/economy";
import { population, SimState } from "../sim/state";
import { cycleFraction, isRising, secondsToHighTide, secondsToLowTide, tideNormalized } from "../sim/tide";
import { jobsAt } from "../sim/workers";

export interface HudState {
  tool: Tool;
  blocker: string | null;
  state: SimState;
}

interface ToolDef { tool: Tool; label: string; key: string; cost: string }
const TOOLS: ToolDef[] = [
  ...BUILDING_KINDS.map((kind, i) => ({ tool: kind as Tool, label: BUILDINGS[kind].name, key: String(i + 1), cost: costOf(kind) })),
  { tool: "boat", label: "Boat", key: String(BUILDING_KINDS.length + 1), cost: `${BOAT_COST}$` },
];

function costOf(kind: BuildingKind): string {
  const c = BUILDINGS[kind].cost;
  const parts = [`${c.money}$`];
  if (c.planks) parts.push(`${c.planks}p`);
  if (c.timber) parts.push(`${c.timber}t`);
  return parts.join("+");
}

export function toolForKey(key: string): Tool | null {
  return TOOLS.find(t => t.key === key)?.tool ?? null;
}

// Tide dial geometry (SVG units). The fill rect is clipped to the inner disc.
const DIAL_R = 24, DIAL_TOP = 32 - DIAL_R, DIAL_H = DIAL_R * 2;

export class Hud {
  private readonly buttons = new Map<Tool, HTMLButtonElement>();
  private readonly res: Record<string, HTMLElement> = {};
  private readonly tideLevel: SVGRectElement;
  private readonly tideMarker: SVGCircleElement;
  private readonly tideValue: HTMLElement;
  private readonly tideSub: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly ledgerLabel: HTMLElement;
  private readonly ledgerValue: HTMLElement;
  private readonly notes: HTMLElement;
  private lastCycle = -1;
  private lastLogLen = -1;

  constructor(root: HTMLElement, resources: HTMLElement, notes: HTMLElement, onTool: (tool: Tool) => void) {
    resources.innerHTML = ["money", "fish", "population", "happiness"].map(k => `<div class="res" data-res="${k}"><label>${k}</label><span>0</span></div>`).join("");
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
        </div>
      </div>
      <div class="palette"></div>
      <p class="hint">Click to place · right-click to remove · drag to orbit</p>
      <div class="score">
        <label></label>
        <div class="score-value">—</div>
      </div>`;

    const palette = root.querySelector<HTMLElement>(".palette")!;
    for (const t of TOOLS) {
      const b = document.createElement("button");
      b.type = "button";
      b.innerHTML = `<span class="name">${t.label}</span><span class="cost">${t.cost}</span><kbd>${t.key}</kbd>`;
      b.addEventListener("click", () => onTool(t.tool));
      palette.appendChild(b);
      this.buttons.set(t.tool, b);
    }
    this.tideLevel = root.querySelector<SVGRectElement>(".tide-level")!;
    this.tideMarker = root.querySelector<SVGCircleElement>(".tide-marker")!;
    this.tideValue = root.querySelector<HTMLElement>(".tide-value")!;
    this.tideSub = root.querySelector<HTMLElement>(".tide-sub")!;
    this.hint = root.querySelector<HTMLElement>(".hint")!;
    this.ledgerLabel = root.querySelector<HTMLElement>(".score label")!;
    this.ledgerValue = root.querySelector<HTMLElement>(".score-value")!;
  }

  update(s: HudState): void {
    const { state } = s;
    const r = state.resources;
    for (const [tool, b] of this.buttons) {
      b.classList.toggle("active", tool === s.tool);
      const affordable = tool === "boat" ? r.money >= BOAT_COST : canAfford(state, BUILDINGS[tool].cost);
      b.classList.toggle("unaffordable", !affordable);
    }

    let jobs = 0;
    for (const b of Object.values(state.buildings)) jobs += jobsAt(b);
    this.res.money.textContent = `${Math.floor(r.money)}$`;
    this.res.fish.textContent = `${Math.floor(r.fish)}`;
    this.res.population.textContent = `${population(state)} / ${jobs} jobs`;
    this.res.happiness.textContent = `${Math.round(state.happiness * 100)}%`;

    const { tide } = state;
    const top = DIAL_TOP + (1 - tideNormalized(tide)) * DIAL_H;
    this.tideLevel.setAttribute("y", top.toFixed(2));
    this.tideLevel.setAttribute("height", (DIAL_TOP + DIAL_H - top).toFixed(2));
    this.tideMarker.setAttribute("transform", `rotate(${(cycleFraction(tide) * 360).toFixed(1)} 32 32)`);
    this.tideValue.textContent = `${tide.level >= 0 ? "+" : ""}${tide.level.toFixed(2)} m`;
    const phase = state.phase === "high" ? "high water" : state.phase === "low" ? "low water" : "slack";
    this.tideSub.textContent = isRising(tide)
      ? `${phase} · rising · high in ${Math.ceil(secondsToHighTide(tide))} s`
      : `${phase} · falling · low in ${Math.ceil(secondsToLowTide(tide))} s`;

    this.hint.textContent = s.blocker ?? "Click to place · right-click to remove · drag to orbit";
    this.hint.classList.toggle("blocked", s.blocker !== null);

    if (state.last.cycle !== this.lastCycle) {
      this.lastCycle = state.last.cycle;
      const l = state.last;
      if (l.cycle === 0) {
        this.ledgerLabel.textContent = "Ledger";
        this.ledgerValue.textContent = "First high tide pending";
      } else {
        const net = l.income - l.expenses;
        this.ledgerLabel.textContent = `Cycle ${l.cycle}`;
        this.ledgerValue.textContent = `${net >= 0 ? "+" : ""}${net.toFixed(0)}$ · ${l.fishCaught.toFixed(0)} fish landed · ${l.fishSold.toFixed(0)} sold`;
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
