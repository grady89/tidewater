// The Town menu: the sea this town lives on and the way back to the World, a new town on this sea (island seed
// with Random; an in-page confirm), the opt-in playtest log, and Quality. The three save slots that used to
// live here are the World's sectors now (docs/globe). The menu only calls back into main; it never touches the
// ledger itself.
import { confirmDialog } from "./dialog";

export interface SaveMenuHooks {
  cycle(): number;
  /** The seed of the island the town stands on (0 = the original island). */
  islandSeed(): number;
  /** The name of the sea (sector) this town lives on. */
  sectorName(): string;
  newTown(seed: number): void;
  /** Back to the World (the town is saved first). */
  returnToWorld(): void;
  /** The opt-in playtest log: its switch, the notes that go into the export, and the export itself. */
  playtest: {
    enabled(): boolean;
    setEnabled(on: boolean): void;
    notes(): string;
    setNotes(text: string): void;
    exportJson(): string;
    fileName(): string;
  };
}

/** The seed a typed value means: a whole number from 0 up; anything else is the original island. */
export function parseSeed(text: string): number {
  const n = Math.floor(Number(text));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export class SaveMenu {
  private readonly seedInput: HTMLInputElement;
  private readonly sectorLine: HTMLElement;

  constructor(private readonly root: HTMLElement, private readonly hooks: SaveMenuHooks) {
    root.innerHTML = `<div class="menu-head"><h2>Town</h2><button type="button" class="close" aria-label="Close">×</button></div>`
      + `<div class="sector-line"><span class="sector-name"></span><button type="button" class="world">World</button></div>`
      + `<div class="menu-actions"><label class="seed-field">Island seed <input class="seed" type="number" min="0" step="1" inputmode="numeric" aria-label="Island seed"></label><button type="button" class="random">Random</button><button type="button" class="new">New town</button></div>`
      + `<div class="playtest"><label class="playtest-switch"><input type="checkbox" class="playtest-on"> Record a playtest log (the first 30 minutes; it stays on this machine)</label><textarea class="playtest-notes" rows="2" placeholder="Notes to go in the export"></textarea><div class="menu-actions"><button type="button" class="playtest-export">Export playtest log</button></div></div>`;
    this.seedInput = root.querySelector<HTMLInputElement>(".seed")!;
    this.sectorLine = root.querySelector<HTMLElement>(".sector-name")!;
    const playtestOn = root.querySelector<HTMLInputElement>(".playtest-on")!;
    const notes = root.querySelector<HTMLTextAreaElement>(".playtest-notes")!;
    playtestOn.checked = hooks.playtest.enabled();
    notes.value = hooks.playtest.notes();
    playtestOn.addEventListener("change", () => hooks.playtest.setEnabled(playtestOn.checked));
    notes.addEventListener("input", () => hooks.playtest.setNotes(notes.value));
    root.querySelector(".playtest-export")!.addEventListener("click", () => {
      const blob = new Blob([hooks.playtest.exportJson()], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = hooks.playtest.fileName();
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    root.querySelector(".close")!.addEventListener("click", () => this.toggle(false));
    root.querySelector(".world")!.addEventListener("click", () => { this.toggle(false); hooks.returnToWorld(); });
    root.querySelector(".random")!.addEventListener("click", () => { this.seedInput.value = String(1 + Math.floor(Math.random() * 999999)); });
    root.querySelector(".new")!.addEventListener("click", () => {
      const seed = parseSeed(this.seedInput.value);
      const where = seed === 0 ? "the original island" : `island ${seed}`;
      void confirmDialog(`Start a new town on ${where}? This sea's town is replaced; the World keeps the others.`, { ok: "New town", danger: true })
        .then(ok => { if (ok) { hooks.newTown(seed); this.toggle(false); } });
    });
    root.hidden = true;
    this.render();
  }

  get open(): boolean { return !this.root.hidden; }

  toggle(open = this.root.hidden): void {
    this.root.hidden = !open;
    if (open) { this.seedInput.value = String(this.hooks.islandSeed()); this.render(); }
  }

  private render(): void {
    this.sectorLine.textContent = `${this.hooks.sectorName()} · cycle ${this.hooks.cycle()}`;
  }
}
