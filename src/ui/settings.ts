// Quality presets: High / Medium / Low, chosen once by a frame-rate probe on first launch and remembered in
// localStorage; the settings panel lets the player change them. The view applies them (main.ts); the ledger never
// sees any of this.
export type Quality = "high" | "medium" | "low";

export interface QualityConfig {
  bloom: boolean;
  reflections: boolean;
  caustics: boolean;
  /** Live walkers at most (the view samples beyond it). */
  walkers: number;
  gulls: boolean;
}

export const QUALITIES: readonly Quality[] = ["high", "medium", "low"];
export const PRESETS: Record<Quality, QualityConfig> = {
  high: { bloom: true, reflections: true, caustics: true, walkers: 200, gulls: true },
  medium: { bloom: true, reflections: false, caustics: true, walkers: 200, gulls: true },
  low: { bloom: false, reflections: false, caustics: false, walkers: 100, gulls: false },
};
export const QUALITY_LABEL: Record<Quality, string> = { high: "High", medium: "Medium", low: "Low" };
export const QUALITY_DESC: Record<Quality, string> = {
  high: "Bloom, water reflections, caustics, every walker, gulls",
  medium: "As High without the water reflections (a second render each frame)",
  low: "No bloom, reflections or caustics; half the walkers; no gulls",
};

export const QUALITY_KEY = "tidewater.quality";
/** The probe's verdict: at or above these frame rates the preset is chosen (else the next one down). */
export const PROBE_SECONDS = 3;
export const PROBE_HIGH_FPS = 55;
export const PROBE_MEDIUM_FPS = 35;

export function qualityForFps(fps: number): Quality {
  return fps >= PROBE_HIGH_FPS ? "high" : fps >= PROBE_MEDIUM_FPS ? "medium" : "low";
}

export function readQuality(): Quality | null {
  try {
    const q = localStorage.getItem(QUALITY_KEY);
    return q === "high" || q === "medium" || q === "low" ? q : null;
  } catch {
    return null;
  }
}

export function writeQuality(q: Quality): void {
  try { localStorage.setItem(QUALITY_KEY, q); } catch { /* storage unavailable */ }
}

export interface SettingsHooks {
  current(): Quality;
  apply(q: Quality): void;
  /** A line about how the preset was chosen ("chosen at first launch: Medium, 48 fps"), or "". */
  note(): string;
}

export class SettingsPanel {
  private readonly buttons = new Map<Quality, HTMLButtonElement>();
  private readonly noteEl: HTMLElement;

  constructor(private readonly root: HTMLElement, private readonly hooks: SettingsHooks) {
    root.innerHTML = `<div class="menu-head"><h2>Settings</h2><button type="button" class="close" aria-label="Close">×</button></div><div class="presets"></div><p class="settings-note"></p>`;
    const presets = root.querySelector<HTMLElement>(".presets")!;
    for (const q of QUALITIES) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "preset";
      b.dataset.quality = q;
      b.innerHTML = `<span class="preset-name">${QUALITY_LABEL[q]}</span><span class="preset-desc">${QUALITY_DESC[q]}</span>`;
      b.addEventListener("click", () => { hooks.apply(q); this.render(); });
      presets.appendChild(b);
      this.buttons.set(q, b);
    }
    this.noteEl = root.querySelector<HTMLElement>(".settings-note")!;
    root.querySelector(".close")!.addEventListener("click", () => this.toggle(false));
    root.hidden = true;
    this.render();
  }

  get open(): boolean { return !this.root.hidden; }

  toggle(open = this.root.hidden): void {
    this.root.hidden = !open;
    if (open) this.render();
  }

  render(): void {
    const current = this.hooks.current();
    for (const [q, b] of this.buttons) b.classList.toggle("active", q === current);
    const note = this.hooks.note();
    if (this.noteEl.textContent !== note) this.noteEl.textContent = note;
  }
}
