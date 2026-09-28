// The World's DOM: the title, the hint, the sector card (built: facts and actions; empty: the new-sector flow),
// the import control and the notice line. It calls back into main; it holds no ledger.
import { agoLabel, bandOf, Biome, biomeBlurb, BIOME_LABEL, biomesFor, SectorMeta } from "../sim/sectors";

const BAND_LABEL = { polar: "Polar", temperate: "Temperate", tropical: "Tropical" } as const;

export interface WorldUiHooks {
  enter(face: number): void;
  begin(face: number, seed: number, biome: Biome, name: string): void;
  rename(face: number): void;
  remove(face: number): void;
  exportSector(face: number): void;
  importFile(file: File, face: number | null): void;
  defaultName(): string;
}

export class WorldUi {
  private readonly card: HTMLElement;
  private readonly notice: HTMLElement;
  private shown: number | null = null;
  private shownBuilt = false;
  private seedValue = "";
  private nameValue = "";
  private biomeValue: Biome = "tidewater";

  constructor(private readonly root: HTMLElement, private readonly hooks: WorldUiHooks) {
    root.innerHTML = `
      <div class="world-title"><h1>Tiny Tides</h1><p class="world-sub">A world of tidal towns. Pick a sea.</p></div>
      <div class="world-card glass" hidden></div>
      <div class="world-notice glass" hidden></div>
      <div class="world-bottom"><div class="world-hint">Drag to spin · Click a sea · Enter to dive</div><div class="world-actions glass"><button type="button" class="import">Import a sea…</button><input type="file" accept="application/json,.json" hidden></div></div>`;
    this.card = root.querySelector<HTMLElement>(".world-card")!;
    this.notice = root.querySelector<HTMLElement>(".world-notice")!;
    const file = root.querySelector<HTMLInputElement>('input[type="file"]')!;
    root.querySelector(".import")!.addEventListener("click", () => file.click());
    file.addEventListener("change", () => { const f = file.files?.[0]; if (f) hooks.importFile(f, this.shown); file.value = ""; });
  }

  get shownFace(): number | null { return this.shown; }

  /** Show the card for a face: a built sector's facts, or the new-sector flow for an empty one. */
  showCard(face: number, meta: SectorMeta | null, now = Date.now()): void {
    const built = !!meta;
    const same = this.shown === face && this.shownBuilt === built;
    this.shown = face; this.shownBuilt = built;
    this.card.hidden = false;
    this.card.dataset.face = String(face);
    if (meta) {
      this.card.innerHTML = `
        <div class="card-kicker">${BIOME_LABEL[meta.biome]} · ${BAND_LABEL[bandOf(face)]}</div>
        <h2 class="card-name"></h2>
        <div class="card-rows">
          <div class="row"><span>Population</span><span>${meta.population}</span></div>
          <div class="row"><span>Cycles played</span><span>${meta.cycles}</span></div>
          <div class="row"><span>Buildings</span><span>${meta.buildings}</span></div>
          <div class="row"><span>Last played</span><span>${agoLabel(meta.lastPlayed, now)}</span></div>
        </div>
        <div class="card-actions"><button type="button" class="enter primary">Enter</button><button type="button" class="rename">Rename</button><button type="button" class="export">Export</button><button type="button" class="delete">Delete</button></div>`;
      this.card.querySelector<HTMLElement>(".card-name")!.textContent = meta.name;
      this.card.querySelector(".enter")!.addEventListener("click", () => this.hooks.enter(face));
      this.card.querySelector(".rename")!.addEventListener("click", () => this.hooks.rename(face));
      this.card.querySelector(".export")!.addEventListener("click", () => this.hooks.exportSector(face));
      this.card.querySelector(".delete")!.addEventListener("click", () => this.hooks.remove(face));
      if (!same) this.reveal();
      return;
    }
    if (!same) { this.seedValue = String(Math.floor(Math.random() * 999999) + 1); this.nameValue = this.hooks.defaultName(); this.biomeValue = "tidewater"; }
    const biomes = biomesFor(face);
    this.card.innerHTML = `
      <div class="card-kicker">Uncharted sea · ${BAND_LABEL[bandOf(face)]}</div>
      <h2 class="card-name">A new sea</h2>
      <label class="card-field">Island seed <span class="seed-row"><input class="seed" type="number" min="0" step="1" inputmode="numeric"><button type="button" class="random">Random</button></span></label>
      <div class="card-field">Coast<div class="biomes">${biomes.map(b => `<button type="button" class="biome${b.charted ? "" : " uncharted"}" data-biome="${b.biome}" ${b.charted ? "" : "disabled"} title="${b.charted ? biomeBlurb(b.biome) : "Uncharted: not yet in this build"}">${BIOME_LABEL[b.biome]}${b.charted ? "" : "<span>uncharted</span>"}</button>`).join("")}</div><div class="biome-blurb"></div></div>
      <label class="card-field">Name <input class="name" type="text" maxlength="40"></label>
      <div class="card-actions"><button type="button" class="begin primary">Begin</button></div>`;
    const seed = this.card.querySelector<HTMLInputElement>(".seed")!, name = this.card.querySelector<HTMLInputElement>(".name")!;
    seed.value = this.seedValue; name.value = this.nameValue;
    seed.addEventListener("input", () => { this.seedValue = seed.value; });
    name.addEventListener("input", () => { this.nameValue = name.value; });
    for (const el of [seed, name]) el.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); this.begin(face); } });
    this.card.querySelector(".random")!.addEventListener("click", () => { seed.value = String(Math.floor(Math.random() * 999999) + 1); this.seedValue = seed.value; });
    const blurb = this.card.querySelector<HTMLElement>(".biome-blurb")!;
    blurb.textContent = biomeBlurb(this.biomeValue);
    for (const b of this.card.querySelectorAll<HTMLButtonElement>(".biome")) {
      b.classList.toggle("active", b.dataset.biome === this.biomeValue);
      b.addEventListener("click", () => { this.biomeValue = b.dataset.biome as Biome; blurb.textContent = biomeBlurb(this.biomeValue); for (const o of this.card.querySelectorAll(".biome")) o.classList.toggle("active", o === b); });
    }
    this.card.querySelector(".begin")!.addEventListener("click", () => this.begin(face));
    if (!same) this.reveal();
  }

  /** Begin from the new-sector card (the Enter key lands here too). */
  begin(face: number): void {
    const n = Math.floor(Number(this.seedValue));
    const seed = Number.isFinite(n) && n >= 0 ? n : 0;
    this.hooks.begin(face, seed, this.biomeValue, this.nameValue.trim() || this.hooks.defaultName());
  }

  private reveal(): void {
    this.card.classList.remove("reveal");
    void this.card.offsetWidth; // restart the animation
    this.card.classList.add("reveal");
  }

  hideCard(): void {
    this.card.hidden = true;
    this.shown = null;
  }

  /** A line above the hint (migration, import results); empty hides it. */
  setNotice(text: string): void {
    this.notice.textContent = text;
    this.notice.hidden = !text;
  }

  setHint(text: string): void {
    this.root.querySelector<HTMLElement>(".world-hint")!.textContent = text;
  }

  /** Is the pointer over the World's own DOM (so the canvas should not treat the click as a face click)? */
  static overUi(target: EventTarget | null): boolean {
    return target instanceof Element && !!target.closest("#world .glass, #world button, #world input, #dialog");
  }
}
