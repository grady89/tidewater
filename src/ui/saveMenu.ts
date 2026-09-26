// Save slots and "new town": three named slots in localStorage beside the autosave. The menu only calls back into
// main; it never touches the ledger itself.
export interface SlotInfo { name: string; savedAt: number; cycle: number }

const SLOT_KEY = (n: number) => `tidewater.slot.${n}`;
const SLOT_META = (n: number) => `tidewater.slot.${n}.meta`;
export const SLOT_COUNT = 3;

export function readSlot(n: number): { json: string; meta: SlotInfo } | null {
  try {
    const json = localStorage.getItem(SLOT_KEY(n));
    const meta = localStorage.getItem(SLOT_META(n));
    if (!json || !meta) return null;
    return { json, meta: JSON.parse(meta) as SlotInfo };
  } catch {
    return null;
  }
}

export function writeSlot(n: number, json: string, meta: SlotInfo): boolean {
  try {
    localStorage.setItem(SLOT_KEY(n), json);
    localStorage.setItem(SLOT_META(n), JSON.stringify(meta));
    return true;
  } catch {
    return false;
  }
}

export interface SaveMenuHooks {
  serialize(): string;
  cycle(): number;
  load(json: string): void;
  newTown(): void;
}

export class SaveMenu {
  private readonly panel: HTMLElement;

  constructor(private readonly root: HTMLElement, private readonly hooks: SaveMenuHooks) {
    root.innerHTML = `<div class="menu-head"><h2>Town</h2><button type="button" class="close" aria-label="Close">×</button></div><div class="slots"></div><div class="menu-actions"><button type="button" class="new">New town</button></div>`;
    this.panel = root.querySelector<HTMLElement>(".slots")!;
    root.querySelector(".close")!.addEventListener("click", () => this.toggle(false));
    root.querySelector(".new")!.addEventListener("click", () => {
      if (window.confirm("Start a new town? The current one is kept only if you saved it to a slot.")) { hooks.newTown(); this.toggle(false); }
    });
    root.hidden = true;
    this.render();
  }

  get open(): boolean { return !this.root.hidden; }

  toggle(open = this.root.hidden): void {
    this.root.hidden = !open;
    if (open) this.render();
  }

  private render(): void {
    this.panel.innerHTML = "";
    for (let n = 1; n <= SLOT_COUNT; n++) {
      const slot = readSlot(n);
      const row = document.createElement("div");
      row.className = "slot";
      const label = slot ? `${slot.meta.name} · cycle ${slot.meta.cycle} · ${new Date(slot.meta.savedAt).toLocaleString()}` : "Empty";
      row.innerHTML = `<span class="slot-name">${n}. ${label}</span><span class="slot-buttons"><button type="button" class="save">Save</button><button type="button" class="load" ${slot ? "" : "disabled"}>Load</button></span>`;
      row.querySelector(".save")!.addEventListener("click", () => {
        const name = window.prompt("Name this save", slot?.meta.name ?? `Town ${n}`);
        if (name === null) return;
        writeSlot(n, this.hooks.serialize(), { name: name || `Town ${n}`, savedAt: Date.now(), cycle: this.hooks.cycle() });
        this.render();
      });
      row.querySelector(".load")!.addEventListener("click", () => {
        const s = readSlot(n);
        if (s) { this.hooks.load(s.json); this.toggle(false); }
      });
      this.panel.appendChild(row);
    }
  }
}
