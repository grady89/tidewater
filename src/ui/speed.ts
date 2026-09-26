// Pause / 1× / 2× / 4× and the town menu button. Speed is a view-loop multiplier; the ledger never sees it.
export const SPEEDS = [0, 1, 2, 4] as const;
export type Speed = (typeof SPEEDS)[number];

export class SpeedControls {
  private readonly buttons = new Map<Speed, HTMLButtonElement>();

  constructor(root: HTMLElement, onSpeed: (s: Speed) => void, onMenu: () => void) {
    for (const s of SPEEDS) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = s === 0 ? "❚❚" : `${s}×`;
      b.title = s === 0 ? "Pause (space)" : `${s}× speed`;
      b.addEventListener("click", () => onSpeed(s));
      root.appendChild(b);
      this.buttons.set(s, b);
    }
    const menu = document.createElement("button");
    menu.type = "button";
    menu.className = "menu-open";
    menu.textContent = "Town…";
    menu.title = "Save, load, new town (Esc)";
    menu.addEventListener("click", onMenu);
    root.appendChild(menu);
  }

  update(current: number): void {
    for (const [s, b] of this.buttons) b.classList.toggle("active", s === current);
  }
}
