// Click a building: what it is, who works there, what it made, and why it might be idle. Read-only over the sim.
import { BUILDINGS, LEVEL_FOODS, MAX_LEVEL, ORDER_SIZE } from "../sim/balance";
import { districtOf } from "../sim/districts";
import { foodsInStock, foreignLuxuriesInStock } from "../sim/food";
import { GoodId, GOODS, isGood } from "../sim/goods";
import { companyCarries, companySells, onOrder, tradeInterval } from "../sim/trade";
import { Grid } from "../sim/grid";
import { at } from "../sim/fields";
import { Building, SimState } from "../sim/state";
import { jobsAt } from "../sim/workers";

export class InfoPanel {
  private selected: number | null = null;
  private readonly title: HTMLElement;
  private readonly body: HTMLElement;

  private readonly orders: HTMLElement;
  private bodyHtml = "";
  private ordersHtml = "";

  /** `onOrder` queues ORDER_SIZE of a good with the company (the harbor's purchase queue). */
  constructor(private readonly root: HTMLElement, private readonly grid: Grid, onOrder: (good: GoodId) => void = () => {}) {
    root.innerHTML = `<div class="info-head"><h2></h2><button type="button" class="close" aria-label="Close">×</button></div><div class="info-body"></div><div class="info-orders" hidden></div>`;
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
    if (!b.reached) return "Not connected to a pier";
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
    this.title.textContent = def.name + (def.residents > 0 ? ` · level ${b.level}` : "");
    const rows: [string, string][] = [["Status", InfoPanel.status(b)]];
    if (def.residents > 0) {
      rows.push(["Residents", `${b.residents} / ${this.grid.capacityOf(b)}`]);
      rows.push(["Happiness", `${Math.round(b.happiness * 100)}%`]);
      const c = b.cells[0], cov = state.fields.coverage;
      rows.push(["Water", at(cov.water, c) > 0 ? "yes" : "no well"]);
      rows.push(["Leisure", at(cov.leisure, c) > 0 ? `${Math.round(at(cov.leisure, c) * 100)}%` : "none"]);
      rows.push(["Lit at night", at(cov.night, c) > 0 ? "yes" : "no"]);
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
    rows.push(["Upkeep", `${def.upkeep}$ / cycle`]);
    const d = districtOf(this.grid, b);
    const district = d
      ? `<div class="district"><h3>${d.name}</h3><span>${d.buildings} buildings · ${d.residents} / ${d.capacity} residents · ${d.workers} / ${d.jobs} jobs${d.boats ? ` · ${d.boats} boats` : ""}${d.residents ? ` · ${Math.round(d.happiness * 100)}% happy` : ""}</span></div>`
      : `<div class="district"><span>Outlying — three touching buildings make a district</span></div>`;
    const html = rows.map(([k, v]) => `<div class="row"><label>${k}</label><span>${v}</span></div>`).join("") + `<p class="desc">${def.desc}</p>` + district;
    if (html !== this.bodyHtml) { this.bodyHtml = html; this.body.innerHTML = html; }
    this.updateOrders(state, b);
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
