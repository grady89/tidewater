// Click a building: what it is, who works there, what it made, and why it might be idle. Read-only over the sim.
import { BUILDINGS } from "../sim/balance";
import { districtOf } from "../sim/districts";
import { Grid } from "../sim/grid";
import { at } from "../sim/fields";
import { Building, SimState } from "../sim/state";
import { jobsAt } from "../sim/workers";

export class InfoPanel {
  private selected: number | null = null;
  private readonly title: HTMLElement;
  private readonly body: HTMLElement;

  constructor(private readonly root: HTMLElement, private readonly grid: Grid) {
    root.innerHTML = `<div class="info-head"><h2></h2><button type="button" class="close" aria-label="Close">×</button></div><div class="info-body"></div>`;
    this.title = root.querySelector("h2")!;
    this.body = root.querySelector<HTMLElement>(".info-body")!;
    root.querySelector("button")!.addEventListener("click", () => this.select(null));
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
    }
    if (jobsAt(b) > 0) rows.push(["Workers", `${b.workers} / ${jobsAt(b)}`]);
    if ((def.slots ?? 0) > 0) rows.push(["Boats", `${b.boats} / ${def.slots}${b.atSea ? " · at sea" : ""}`]);
    if (def.workers > 0 || (def.slots ?? 0) > 0 || b.kind === "oysterBed") rows.push(["Last cycle", b.output.toFixed(1)]);
    if (b.lantern) rows.push(["Lantern", "lit at dusk"]);
    rows.push(["Upkeep", `${def.upkeep}$ / cycle`]);
    const d = districtOf(this.grid, b);
    const district = d
      ? `<div class="district"><h3>${d.name}</h3><span>${d.buildings} buildings · ${d.residents} / ${d.capacity} residents · ${d.workers} / ${d.jobs} jobs${d.boats ? ` · ${d.boats} boats` : ""}${d.residents ? ` · ${Math.round(d.happiness * 100)}% happy` : ""}</span></div>`
      : `<div class="district"><span>Outlying — three touching buildings make a district</span></div>`;
    this.body.innerHTML = rows.map(([k, v]) => `<div class="row"><label>${k}</label><span>${v}</span></div>`).join("") + `<p class="desc">${def.desc}</p>` + district;
  }
}
