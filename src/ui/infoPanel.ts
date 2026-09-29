// Click a building: what it is, who works there, what it made, and why it might be idle. Read-only over the sim.
import { BUILDINGS, LEVEL_FOODS, MAX_LEVEL, ORDER_SIZE, UPGRADES } from "../sim/balance";
import { districtOf } from "../sim/districts";
import { foodsInStock, foreignLuxuriesInStock } from "../sim/food";
import { GoodId, GOODS, isGood } from "../sim/goods";
import { companyCarries, companySells, onOrder, tradeInterval } from "../sim/trade";
import { cellIndex, Grid } from "../sim/grid";
import { at } from "../sim/fields";
import { netFlow, sewerMap } from "../sim/sewers";
import { serviceRadius } from "../sim/services";
import { Building, SimState } from "../sim/state";
import { costText, levelCapacity, levelName, upgradeBlocker, upgradeCost, upkeepOf } from "../sim/upgrades";
import { jobsAt } from "../sim/workers";

export class InfoPanel {
  private selected: number | null = null;
  private readonly title: HTMLElement;
  private readonly body: HTMLElement;

  private readonly orders: HTMLElement;
  private bodyHtml = "";
  private ordersHtml = "";

  /** Remove the selected building (phones: there is no right-click); shown only in the phone layout. */
  onRemove: (b: Building) => void = () => {};
  /** Raise the selected building a level (sim/upgrades.ts). */
  onUpgrade: (b: Building) => void = () => {};
  private readonly upgrade: HTMLButtonElement;

  /** `onOrder` queues ORDER_SIZE of a good with the company (the harbor's purchase queue). */
  constructor(private readonly root: HTMLElement, private readonly grid: Grid, onOrder: (good: GoodId) => void = () => {}) {
    root.innerHTML = `<div class="info-head"><h2></h2><button type="button" class="close" aria-label="Close">×</button></div><div class="info-body"></div><div class="info-orders" hidden></div><button type="button" class="upgrade" hidden></button><button type="button" class="remove">Remove · half the price back</button>`;
    this.upgrade = root.querySelector<HTMLButtonElement>(".upgrade")!;
    this.upgrade.addEventListener("click", () => {
      const b = this.selected !== null ? this.grid.state.buildings[this.selected] : null;
      if (b && !this.upgrade.disabled) this.onUpgrade(b);
    });
    root.querySelector<HTMLButtonElement>(".remove")!.addEventListener("click", () => {
      const b = this.selected !== null ? this.grid.state.buildings[this.selected] : null;
      if (b) this.onRemove(b);
    });
    this.title = root.querySelector("h2")!;
    this.body = root.querySelector<HTMLElement>(".info-body")!;
    this.orders = root.querySelector<HTMLElement>(".info-orders")!;
    root.querySelector("button")!.addEventListener("click", () => this.select(null));
    this.orders.addEventListener("click", e => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button.order-good");
      if (btn && !btn.disabled && isGood(btn.dataset.good ?? "")) onOrder(btn.dataset.good as GoodId);
    });
    root.hidden = true;
  }

  select(b: Building | null): void {
    this.selected = b?.id ?? null;
    this.root.hidden = this.selected === null;
  }

  get selectedId(): number | null { return this.selected; }

  /** One line on what the building is doing. */
  static status(b: Building): string {
    const def = BUILDINGS[b.kind];
    if (b.cut) return "Cut off by the tide";
    if (b.damaged) return "Damaged: repaired when the purse allows";
    if (!b.reached && !def.offStreet) return "Not connected to a pier";
    if (b.kind === "oysterBed" && b.stress > 0) return "Sickening in foul water";
    if (jobsAt(b) > 0 && b.workers === 0) return "Idle: no workers";
    if (def.residents > 0) return b.residents === 0 ? "Empty" : "Lived in";
    if (b.kind === "shipyard") return b.progress > 0 ? "Building a boat" : "Waiting for planks and a berth";
    if (b.kind === "toolworks" && b.output <= 0) return "Idle: no iron";
    return "Working";
  }

  update(state: SimState): void {
    if (this.selected === null) return;
    const b = state.buildings[this.selected];
    if (!b) { this.select(null); return; }
    const def = BUILDINGS[b.kind];
    const up = UPGRADES[b.kind];
    this.title.textContent = (up ? levelName(b) : def.name) + (def.residents > 0 || up ? ` · level ${b.level}` : "");
    const rows: [string, string][] = [["Status", this.sewerStatus(b) ?? InfoPanel.status(b)]];
    if (up) rows.push(this.capacityRow(state, b));
    if (def.residents > 0) {
      rows.push(["Residents", `${b.residents} / ${this.grid.capacityOf(b)}`]);
      rows.push(["Happiness", `${Math.round(b.happiness * 100)}%`]);
      const c = b.cells[0], cov = state.fields.coverage;
      const water = at(cov.water, c);
      rows.push(["Water", water >= 0.99 ? "yes" : water > 0 ? `${Math.round(water * 100)}% of them: the well can't keep up` : b.residents > 0 && this.wellInReach(state, b) ? "none: the wells in reach are full" : "no well"]);
      rows.push(["Leisure", at(cov.leisure, c) > 0 ? `${Math.round(at(cov.leisure, c) * 100)}%` : "none"]);
      rows.push(["Lit at night", at(cov.night, c) > 0 ? "yes" : "no"]);
      rows.push(["Sewer", this.drainText(b)]);
      rows.push(["Pollution", at(state.fields.pollution, c).toFixed(2)]);
      // Biomes: the table decides the next level (sim/food.ts).
      const foods = foodsInStock(state), luxuries = foreignLuxuriesInStock(state);
      rows.push(["Foods", foods.length ? foods.map(g => GOODS[g].name).join(", ") : "none"]);
      if (b.level < MAX_LEVEL) {
        const next = b.level + 1;
        const wants = [`${LEVEL_FOODS[next]} food kinds${foods.length >= LEVEL_FOODS[next] ? " ✓" : ""}`];
        if (next >= 3) wants.push(`a foreign luxury${luxuries.length ? " ✓" : ""}`);
        rows.push([`Level ${next} needs`, wants.join(" · ")]);
      }
    }
    if (jobsAt(b) > 0) rows.push(["Workers", `${b.workers} / ${jobsAt(b)}`]);
    if ((def.slots ?? 0) > 0) rows.push(["Boats", `${b.boats} / ${def.slots}${b.atSea ? (b.ground ? ` · fishing ${Math.round(Math.hypot(b.ground.i - b.cells[0].i, b.ground.j - b.cells[0].j))} cells out` : " · at sea") : b.boats ? " · moored" : ""}`]);
    if (def.workers > 0 || (def.slots ?? 0) > 0 || b.kind === "oysterBed") rows.push(["Last cycle", b.output.toFixed(1)]);
    if (b.lantern) rows.push(["Lantern", "lit at dusk"]);
    if (def.floor === "stilts" || def.floor === "street") rows.push(["Stilts", `${Math.max(0, b.floorY - this.grid.groundUnder(b.cells)).toFixed(1)} m`]);
    rows.push(["Upkeep", `${+upkeepOf(b).toFixed(2)}$ / cycle`]);
    const d = districtOf(this.grid, b);
    const district = d
      ? `<div class="district"><h3>${d.name}</h3><span>${d.buildings} buildings · ${d.residents} / ${d.capacity} residents · ${d.workers} / ${d.jobs} jobs${d.boats ? ` · ${d.boats} boats` : ""}${d.residents ? ` · ${Math.round(d.happiness * 100)}% happy` : ""}</span></div>`
      : `<div class="district"><span>Outlying — three touching buildings make a district</span></div>`;
    const html = rows.map(([k, v]) => `<div class="row"><label>${k}</label><span>${v}</span></div>`).join("") + `<p class="desc">${def.desc}</p>` + district;
    if (html !== this.bodyHtml) { this.bodyHtml = html; this.body.innerHTML = html; }
    this.updateOrders(state, b);
    this.updateUpgrade(state, b);
  }

  /** The upgrade button: the next level's name and price, greyed with the reason when it can't be paid for. */
  private updateUpgrade(state: SimState, b: Building): void {
    const cost = upgradeCost(b);
    this.upgrade.hidden = !cost;
    if (!cost) return;
    const next = UPGRADES[b.kind]!.names?.[b.level] ?? `level ${b.level + 1}`;
    const text = `Upgrade to ${next} · ${costText(cost)}`;
    if (this.upgrade.textContent !== text) this.upgrade.textContent = text;
    const why = upgradeBlocker(state, b);
    this.upgrade.disabled = why !== null;
    this.upgrade.title = why ?? `Serves ${UPGRADES[b.kind]!.capacity[b.level]} ${UPGRADES[b.kind]!.unit}`;
  }

  /** What the building serves at its level, and what it served last cycle where that is counted. */
  private capacityRow(state: SimState, b: Building): [string, string] {
    const cap = levelCapacity(b)!;
    switch (b.kind) {
      case "well": return ["Served last tide", `${Math.round(b.output)} of ${cap} people`];
      case "treatmentPlant": return ["Cleaned last tide", `${Math.round(b.output)} of ${cap} people`];
      case "market": return ["Sells up to", `${cap} a cycle`];
      case "clinic": return ["Heals up to", `${cap} a cycle`];
      case "inn": return ["Beds", `${cap}`];
      case "fireWatch": return ["Reach", `${serviceRadius(state, b)} cells`];
      default: return ["Capacity", `${cap} ${UPGRADES[b.kind]!.unit}`];
    }
  }

  /** The sewer's two ends say what they are doing (sim/sewers.ts); null for everything else. */
  private sewerStatus(b: Building): string | null {
    if (b.kind !== "outfall" && b.kind !== "treatmentPlant") return null;
    if (b.damaged) return "Damaged: repaired when the purse allows";
    const map = sewerMap(this.grid);
    const n = map.nets[map.net[cellIndex(b.cells[0].i, b.cells[0].j)]];
    const f = n ? netFlow(n) : null;
    if (!n || !n.homes.length) return "No homes drain here: set it against a street, or lay a sewer pipe to one";
    if (b.kind === "outfall") return f!.toSea > 0 ? `Carries ${Math.round(f!.toSea)} people's waste to sea` : "Everything is cleaned before it gets here";
    return f!.people > f!.treated ? `Full: ${Math.round(f!.people - f!.treated)} people's waste goes past untreated` : "Cleaning all the network's waste";
  }

  /** Where a home's waste goes. */
  private drainText(b: Building): string {
    const n = sewerMap(this.grid).drainOf.get(b.id);
    if (!n) return "none: a cesspit (lay a sewer pipe, or build on a street)";
    const f = netFlow(n);
    if (f.backedUp > 0) return "backs up: its sewer has no outfall";
    if (f.people > 0 && f.treated >= f.people) return "cleaned at a treatment plant";
    if (f.treated > 0) return `${Math.round(f.treated / f.people * 100)}% cleaned, the rest out to sea`;
    return "out to sea through an outfall";
  }

  /** Is a well (or any people-serving water) within reach of the home? */
  private wellInReach(state: SimState, b: Building): boolean {
    return Object.values(state.buildings).some(w => w.kind === "well" && !w.damaged && w.cells.some(x => b.cells.some(c => Math.max(Math.abs(c.i - x.i), Math.abs(c.j - x.j)) <= serviceRadius(state, w))));
  }

  /**
   * The harbor's purchase queue: every good the company carries here, what is on order, and a button to order
   * ORDER_SIZE more (the plank order, generalised). Rebuilt only when its text would change, so clicks land.
   */
  private updateOrders(state: SimState, b: Building): void {
    if (b.kind !== "harbor") { if (this.ordersHtml) { this.ordersHtml = ""; this.orders.innerHTML = ""; } this.orders.hidden = true; return; }
    const lines = companyCarries(state).map(g => {
      const price = companySells(g), pending = onOrder(state, g);
      const can = state.resources.money >= price * ORDER_SIZE;
      return `<div class="row order-row" data-good="${g}"><label>${GOODS[g].name}${pending ? ` · ${pending} on order` : ""}</label><button type="button" class="order-good"${can ? "" : " disabled"} data-good="${g}">+${ORDER_SIZE} · ${price * ORDER_SIZE}$</button></div>`;
    });
    const html = `<h3>Trade Company</h3><p class="desc">The ship sells what this coast cannot make; it calls every ${tradeInterval(state)} tides.</p>${lines.join("")}`;
    if (html !== this.ordersHtml) { this.ordersHtml = html; this.orders.innerHTML = html; }
    this.orders.hidden = false;
  }
}
