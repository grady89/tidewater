// Pause / 1× / 2× / 4×, the town menu button, mute, and the reflections quality toggle. Speed is a view-loop
// multiplier; the ledger never sees any of this.
export const SPEEDS = [0, 1, 2, 4] as const;
export type Speed = (typeof SPEEDS)[number];

export interface SpeedCallbacks {
  onSpeed: (s: Speed) => void;
  onMenu: () => void;
  onMute: () => void;
  onReflections: () => void;
}

export class SpeedControls {
  private readonly buttons = new Map<Speed, HTMLButtonElement>();
  private readonly mute: HTMLButtonElement;
  private readonly reflections: HTMLButtonElement;

  constructor(root: HTMLElement, cb: SpeedCallbacks) {
    for (const s of SPEEDS) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = s === 0 ? "❚❚" : `${s}×`;
      b.title = s === 0 ? "Pause (space)" : `${s}× speed`;
      b.addEventListener("click", () => cb.onSpeed(s));
      root.appendChild(b);
      this.buttons.set(s, b);
    }
    const menu = document.createElement("button");
    menu.type = "button";
    menu.className = "menu-open";
    menu.textContent = "Town…";
    menu.title = "Save, load, new town (Esc)";
    menu.addEventListener("click", cb.onMenu);
    root.appendChild(menu);
    this.mute = document.createElement("button");
    this.mute.type = "button";
    this.mute.className = "mute";
    this.mute.title = "Mute";
    this.mute.addEventListener("click", cb.onMute);
    root.appendChild(this.mute);
    this.reflections = document.createElement("button");
    this.reflections.type = "button";
    this.reflections.className = "reflections";
    this.reflections.textContent = "Reflections";
    this.reflections.title = "Water reflections (costs a second render per frame)";
    this.reflections.addEventListener("click", cb.onReflections);
    root.appendChild(this.reflections);
  }

  update(current: number, muted = false, reflections = false): void {
    for (const [s, b] of this.buttons) b.classList.toggle("active", s === current);
    const label = muted ? "🔇" : "🔊";
    if (this.mute.textContent !== label) this.mute.textContent = label;
    this.reflections.classList.toggle("active", reflections);
  }
}
