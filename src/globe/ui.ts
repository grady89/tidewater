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
  /** Preview the island a seed would make on an empty face (null clears it). */
  preview(face: number | null, seed: number, biome: Biome): void;
  /** A built sea's lanes and last tide's cargo, for its card (null: the lanes are off). */
  trade?(face: number): CardTrade | null;
  /** The World's trade at a glance, for the Trade panel. */
  tradePanel?(): TradePanel;
}

export interface CardTrade { lanes: string; imports: string; exports: string }
export interface TradePanel { lanes: string[]; atSea: string[]; company: string[]; storms: string[] }

/** How long the seed field must rest before the preview follows it (typing a number is several changes). */
const PREVIEW_DEBOUNCE_MS = 150;

export class WorldUi {
  private readonly card: HTMLElement;
  private readonly notice: HTMLElement;
  private shown: number | null = null;
  private shownBuilt = false;
  private seedValue = "";
  private nameValue = "";
  private biomeValue: Biome = "tidewater";
  private previewTimer = 0;

  constructor(private readonly root: HTMLElement, private readonly hooks: WorldUiHooks) {
    root.innerHTML = `
      <div class="world-title"><h1>Tiny Tides</h1><p class="world-sub">A world of tidal towns. Pick a sea.</p></div>
      <div class="world-card glass" hidden></div>
      <div class="world-notice glass" hidden></div>
      <div class="world-bottom"><div class="world-hint">${matchMedia("(pointer: coarse)").matches ? "Drag to spin · Tap a sea" : "Drag to spin · Click a sea · Enter to dive"}</div><div class="world-actions glass"><button type="button" class="trade-toggle">Trade</button><button type="button" class="import">Import a sea…</button><input type="file" accept="application/json,.json" hidden></div></div>
      <div class="world-trade glass" hidden></div>`;
    this.card = root.querySelector<HTMLElement>(".world-card")!;
    this.notice = root.querySelector<HTMLElement>(".world-notice")!;
    const file = root.querySelector<HTMLInputElement>('input[type="file"]')!;
    root.querySelector(".import")!.addEventListener("click", () => file.click());
    file.addEventListener("change", () => { const f = file.files?.[0]; if (f) hooks.importFile(f, this.shown); file.value = ""; });
    this.trade = root.querySelector<HTMLElement>(".world-trade")!;
    const toggle = root.querySelector<HTMLButtonElement>(".trade-toggle")!;
    toggle.hidden = !hooks.tradePanel;
    toggle.addEventListener("click", () => { this.trade.hidden = !this.trade.hidden; toggle.classList.toggle("active", !this.trade.hidden); this.refreshTrade(); });
  }

  private readonly trade: HTMLElement;

  /** The Trade panel: the lanes, what is at sea, the company's route and prices, the storms. Refreshed while open. */
  refreshTrade(): void {
    if (this.trade.hidden || !this.hooks.tradePanel) return;
    const t = this.hooks.tradePanel();
    const section = (title: string, lines: string[], empty: string) => `<div class="trade-section"><div class="trade-title">${title}</div>${(lines.length ? lines : [empty]).map(() => `<div class="trade-line"></div>`).join("")}</div>`;
    this.trade.innerHTML = `<h2 class="card-name">Trade</h2>${section("Lanes", t.lanes, "No lanes yet: two harbors on neighbouring seas make one")}${section("At sea", t.atSea, "Nothing at sea")}${section("The company", t.company, "The company calls at each harbor on its own")}${section("Weather", t.storms, "Fair across the World")}`;
    // Text goes in as text (sea names are the player's).
    const lines = [...(t.lanes.length ? t.lanes : ["No lanes yet: two harbors on neighbouring seas make one"]), ...(t.atSea.length ? t.atSea : ["Nothing at sea"]), ...(t.company.length ? t.company : ["The company calls at each harbor on its own"]), ...(t.storms.length ? t.storms : ["Fair across the World"])];
    this.trade.querySelectorAll<HTMLElement>(".trade-line").forEach((el, i) => { el.textContent = lines[i] ?? ""; });
  }
  get tradeOpen(): boolean { return !this.trade.hidden; }

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
          <div class="row trade-row" hidden><span>Lanes</span><span class="lanes"></span></div>
          <div class="row trade-row" hidden><span>Last tide in</span><span class="imports"></span></div>
          <div class="row trade-row" hidden><span>Last tide out</span><span class="exports"></span></div>
        </div>
        <div class="card-actions"><button type="button" class="enter primary">Enter</button><button type="button" class="rename">Rename</button><button type="button" class="export">Export</button><button type="button" class="delete">Delete</button></div>`;
      this.card.querySelector<HTMLElement>(".card-name")!.textContent = meta.name;
      const trade = this.hooks.trade?.(face) ?? null;
      if (trade) {
        for (const row of this.card.querySelectorAll<HTMLElement>(".trade-row")) row.hidden = false;
        this.card.querySelector<HTMLElement>(".lanes")!.textContent = trade.lanes;
        this.card.querySelector<HTMLElement>(".imports")!.textContent = trade.imports;
        this.card.querySelector<HTMLElement>(".exports")!.textContent = trade.exports;
      }
      this.card.querySelector(".enter")!.addEventListener("click", () => this.hooks.enter(face));
      this.card.querySelector(".rename")!.addEventListener("click", () => this.hooks.rename(face));
      this.card.querySelector(".export")!.addEventListener("click", () => this.hooks.exportSector(face));
      this.card.querySelector(".delete")!.addEventListener("click", () => this.hooks.remove(face));
      this.previewNow(null);
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
    seed.addEventListener("input", () => { this.seedValue = seed.value; this.previewSoon(face); });
    name.addEventListener("input", () => { this.nameValue = name.value; });
    for (const el of [seed, name]) el.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); this.begin(face); } });
    this.card.querySelector(".random")!.addEventListener("click", () => { seed.value = String(Math.floor(Math.random() * 999999) + 1); this.seedValue = seed.value; this.previewNow(face); });
    const blurb = this.card.querySelector<HTMLElement>(".biome-blurb")!;
    blurb.textContent = biomeBlurb(this.biomeValue);
    for (const b of this.card.querySelectorAll<HTMLButtonElement>(".biome")) {
      b.classList.toggle("active", b.dataset.biome === this.biomeValue);
      b.addEventListener("click", () => { this.biomeValue = b.dataset.biome as Biome; blurb.textContent = biomeBlurb(this.biomeValue); for (const o of this.card.querySelectorAll(".biome")) o.classList.toggle("active", o === b); this.previewNow(face); });
    }
    this.card.querySelector(".begin")!.addEventListener("click", () => this.begin(face));
    this.previewNow(face);
    if (!same) this.reveal();
  }

  /** The seed field as a seed: a whole number from 0, else 0 (what Begin would use). */
  private get seedNumber(): number {
    const n = Math.floor(Number(this.seedValue));
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  /** Show the island for the card's seed and coast on `face` now (null clears any preview). */
  private previewNow(face: number | null): void {
    clearTimeout(this.previewTimer);
    this.hooks.preview(face, this.seedNumber, this.biomeValue);
  }

  private previewSoon(face: number): void {
    clearTimeout(this.previewTimer);
    this.previewTimer = window.setTimeout(() => { if (this.shown === face && !this.shownBuilt) this.hooks.preview(face, this.seedNumber, this.biomeValue); }, PREVIEW_DEBOUNCE_MS);
  }

  /** Begin from the new-sector card (the Enter key lands here too). */
  begin(face: number): void {
    this.hooks.begin(face, this.seedNumber, this.biomeValue, this.nameValue.trim() || this.hooks.defaultName());
  }

  private reveal(): void {
    this.card.classList.remove("reveal");
    void this.card.offsetWidth; // restart the animation
    this.card.classList.add("reveal");
  }

  hideCard(): void {
    this.card.hidden = true;
    this.shown = null;
    this.previewNow(null);
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
