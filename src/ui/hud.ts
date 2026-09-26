// The whole UI: build palette, tide clock, score readout. Plain DOM over the canvas, read-only over the sim.
import { PieceKind, Score, TideState } from "../sim/state";
import { cycleFraction, isRising, secondsToHighTide, secondsToLowTide, tideNormalized } from "../sim/tide";

export interface HudState {
  tool: PieceKind;
  tide: TideState;
  score: Score | null;
}

const TOOLS: { kind: PieceKind; label: string; key: string }[] = [
  { kind: "house", label: "House", key: "1" },
  { kind: "walkway", label: "Walkway", key: "2" },
  { kind: "pier", label: "Pier", key: "3" },
];

// Tide dial geometry (SVG units). The fill rect is clipped to the inner disc.
const DIAL_R = 24, DIAL_TOP = 32 - DIAL_R, DIAL_H = DIAL_R * 2;

export class Hud {
  private readonly buttons = new Map<PieceKind, HTMLButtonElement>();
  private readonly tideLevel: SVGRectElement;
  private readonly tideMarker: SVGCircleElement;
  private readonly tideValue: HTMLElement;
  private readonly tideSub: HTMLElement;
  private readonly scoreLabel: HTMLElement;
  private readonly scoreValue: HTMLElement;
  private lastScoreCycle = -1;

  constructor(root: HTMLElement, onTool: (kind: PieceKind) => void) {
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
      b.innerHTML = `<span>${t.label}</span><kbd>${t.key}</kbd>`;
      b.addEventListener("click", () => onTool(t.kind));
      palette.appendChild(b);
      this.buttons.set(t.kind, b);
    }
    this.tideLevel = root.querySelector<SVGRectElement>(".tide-level")!;
    this.tideMarker = root.querySelector<SVGCircleElement>(".tide-marker")!;
    this.tideValue = root.querySelector<HTMLElement>(".tide-value")!;
    this.tideSub = root.querySelector<HTMLElement>(".tide-sub")!;
    this.scoreLabel = root.querySelector<HTMLElement>(".score label")!;
    this.scoreValue = root.querySelector<HTMLElement>(".score-value")!;
  }

  update(s: HudState): void {
    for (const [kind, b] of this.buttons) b.classList.toggle("active", kind === s.tool);

    const { tide } = s;
    const top = DIAL_TOP + (1 - tideNormalized(tide)) * DIAL_H;
    this.tideLevel.setAttribute("y", top.toFixed(2));
    this.tideLevel.setAttribute("height", (DIAL_TOP + DIAL_H - top).toFixed(2));
    this.tideMarker.setAttribute("transform", `rotate(${(cycleFraction(tide) * 360).toFixed(1)} 32 32)`);
    this.tideValue.textContent = `${tide.level >= 0 ? "+" : ""}${tide.level.toFixed(2)} m`;
    this.tideSub.textContent = isRising(tide)
      ? `rising · high tide in ${Math.ceil(secondsToHighTide(tide))} s`
      : `falling · low tide in ${Math.ceil(secondsToLowTide(tide))} s`;

    if (!s.score) {
      this.scoreLabel.textContent = "Score";
      this.scoreValue.textContent = "— · first high tide pending";
      this.lastScoreCycle = -1;
    } else if (s.score.cycle !== this.lastScoreCycle) {
      this.lastScoreCycle = s.score.cycle;
      this.scoreLabel.textContent = `High tide ${s.score.cycle}`;
      this.scoreValue.textContent = `${s.score.reached} of ${s.score.houses} households reached`;
      this.scoreValue.classList.remove("flash");
      void this.scoreValue.offsetWidth;
      this.scoreValue.classList.add("flash");
    }
  }
}
