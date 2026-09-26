// Headless smoke scenario. Starts the Vite dev server in-process, drives the game through window.__tidewater in
// headless Chrome, asserts, and writes screenshots to shots/. Run with `npm run smoke` (Node 24 strips the types).
import { chromium } from "playwright";
import type { Page } from "playwright";
import { createServer } from "vite";

const PORT = 5181;

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error("smoke assertion failed: " + msg);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Api = any;
async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as unknown as { __tidewater?: { ready: boolean } }).__tidewater?.ready === true, null, { timeout: 30_000 });
}

const server = await createServer({ server: { port: PORT, strictPort: true }, logLevel: "error" });
await server.listen();

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  // Headless Chrome uses the real GPU with the blocklist ignored (verified: ANGLE D3D11 on the RTX 4060).
  args: ["--ignore-gpu-blocklist"],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(m.text()); });
  page.on("response", r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });

  await page.goto(`http://localhost:${PORT}/`);
  await waitReady(page);
  await page.evaluate(() => (window as unknown as { __tidewater: Api }).__tidewater.newTown());

  // M2: the starter town, four cycles, positive net money; cutting the market's walkway stops sales.
  const built = await page.evaluate(async () => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    const url = "/test/scenario.ts"; // served by the Vite dev server; typed loosely so Node's tsc doesn't resolve it
    const scenario = (await import(url)) as typeof import("./scenario");
    const t = scenario.starterTown(api.sim, api.grid);
    return { pier: !!t.pier, boats: t.pier.boats, walkways: t.walkways.length, huts: t.huts.length, market: !!t.market, money: api.sim.resources.money };
  });
  console.log("M2 built:", JSON.stringify(built));
  assert(built.pier && built.boats === 2 && built.huts === 3 && built.market && built.walkways >= 2, "starter town placed");
  assert(built.money >= 0, "starter town affordable");

  const ran = await page.evaluate(() => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    api.advance(4);
    const s = api.sim;
    let pop = 0; for (const b of Object.values(s.buildings) as any[]) pop += b.residents;
    return { money: s.resources.money, pop, last: s.last, happiness: s.happiness, log: s.log.slice(-3) };
  });
  console.log("M2 after 4 cycles:", JSON.stringify(ran));
  assert(ran.money > built.money, "net money positive over 4 cycles");
  assert(ran.pop > 0, "residents arrived");
  assert(ran.last.fishSold > 0, "market sold fish");
  await page.evaluate(() => (window as unknown as { __tidewater: Api }).__tidewater.setTide(0.6));
  await page.waitForTimeout(300);
  await page.screenshot({ path: "shots/m2.png" });

  const cut = await page.evaluate(() => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    api.setTide(null);
    const market = (Object.values(api.sim.buildings) as any[]).find(b => b.kind === "market");
    for (const c of market.cells) for (const n of api.grid.neighbors(c)) {
      const b = api.grid.buildingAt(n);
      if (b && (b.kind === "walkway" || b.kind === "raisedWalkway")) api.remove(n.i, n.j);
    }
    api.advance(1);
    return { reached: market.reached, sold: api.sim.last.fishSold, fish: api.sim.resources.fish };
  });
  console.log("M2 market cut:", JSON.stringify(cut));
  assert(!cut.reached && cut.sold === 0, "sales stop when the market is cut off");

  // M3: low-water producers and a raised walkway go in; the 4th cycle is a spring tide.
  const m3 = await page.evaluate(() => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    api.grant(400, 20);
    const grid = api.grid;
    const placeByWalkway = (kind: string): boolean => {
      for (const w of (Object.values(api.sim.buildings) as any[]).filter(b => b.kind === "walkway" || b.kind === "raisedWalkway")) {
        for (const n of grid.neighbors(w.cells[0])) {
          for (let di = 0; di < 2; di++) for (let dj = 0; dj < 2; dj++) if (api.place(kind, n.i - di, n.j - dj)) return true;
        }
      }
      return false;
    };
    const oyster = placeByWalkway("oysterBed");
    const clam = placeByWalkway("clamCamp");
    const raised = placeByWalkway("raisedWalkway");
    api.advance((4 - (api.sim.tide.cycle % 4)) % 4 || 4); // to the next spring peak
    const springText = document.querySelector(".tide-spring")?.textContent ?? "";
    return { oyster, clam, raised, cycle: api.sim.tide.cycle, level: api.sim.tide.level, springText, log: api.sim.log.slice(-2) };
  });
  console.log("M3:", JSON.stringify(m3));
  assert(m3.clam && m3.raised, "clam camp and raised walkway placed");
  assert(m3.cycle % 4 === 0 && m3.level > 0.84, "every 4th cycle peaks as a spring tide");
  assert(/spring/i.test(m3.springText), "tide clock announces the spring tide");
  await page.evaluate(() => { const api = (window as unknown as { __tidewater: Api }).__tidewater; api.setTide(-0.55); api.frameTown(20); });
  await page.waitForTimeout(400);
  await page.screenshot({ path: "shots/m3.png" });
  await page.evaluate(() => (window as unknown as { __tidewater: Api }).__tidewater.setTide(null));

  // M4: boats out at high water, moored (and heeled) at low water; walkers at shift change; ≥ 60 fps.
  const m4setup = await page.evaluate(() => {
    type Cell = { i: number; j: number };
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    const grid = api.grid;
    api.grant(600, 20);
    const s = api.sim;
    const pier = (Object.values(s.buildings) as any[]).find(b => b.kind === "pier");
    // A second pier along the same shore and a dock against the first pier; boats set in the ledger (the shipyard is M5).
    let pier2: any = null, bd = Infinity;
    for (let i = -32; i < 32 && !pier2; i++) for (let j = -32; j < 32; j++) {
      const c = { i, j };
      if (grid.classAt(c) !== "deep" || !grid.footprint("pier", c) || grid.buildingAt(c)) continue;
      const d = Math.hypot(i - pier.cells[0].i, j - pier.cells[0].j);
      if (d >= 3 && d < bd) { bd = d; pier2 = c; }
    }
    const p2 = pier2 ? api.place("pier", pier2.i, pier2.j) : null;
    let dock: any = null;
    for (const pc of pier.cells as Cell[]) for (const n of grid.neighbors(pc)) {
      for (let di = 0; di < 2 && !dock; di++) for (let dj = 0; dj < 2 && !dock; dj++) dock = api.place("dock", n.i - di, n.j - dj);
      if (dock) break;
    }
    if (p2) p2.boats = 2;
    if (dock) dock.boats = 2;
    // Grow the street with raised walkways (they never flood) and hang houses off them, then let immigration run,
    // so there are hands for every boat after the pier and market fill.
    api.grant(1500);
    let laid = 0, huts = 0;
    for (let round = 0; round < 8; round++) {
      const links = (Object.values(s.buildings) as any[]).filter(b => b.kind === "walkway" || b.kind === "raisedWalkway");
      let placed = false;
      for (const w of links) {
        for (const n of grid.neighbors(w.cells[0])) {
          if (grid.classAt(n) === "flat" && !grid.buildingAt(n) && api.place("raisedWalkway", n.i, n.j)) { laid++; placed = true; break; }
        }
        if (placed) break;
      }
      if (!placed) break;
    }
    for (const w of (Object.values(s.buildings) as any[]).filter(b => b.kind === "raisedWalkway")) {
      for (const n of grid.neighbors(w.cells[0])) { if (huts >= 6) break; if (api.place("house", n.i, n.j)) huts++; }
    }
    api.advance(6);
    let pop = 0; for (const b of Object.values(s.buildings) as any[]) pop += b.residents;
    return { pier2: !!p2, dock: !!dock, laid, houses: huts, pop, boats: (Object.values(s.buildings) as any[]).reduce((n, b) => n + b.boats, 0) };
  });
  console.log("M4 setup:", JSON.stringify(m4setup));
  assert(m4setup.boats >= 4, "at least four boats in the ledger");

  const high = await page.evaluate(() => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    api.advanceTo(0.65); // slack water on the rise, so the view sees the coming shift change
    api.advanceTo(0.8);  // just inside high water: the shift has changed
    const walkersAtShift = api.view.walkers();
    api.advanceTo(0.0);  // the peak: boats are on their grounds
    api.frameTown(30);
    const boats = api.view.boats();
    const harbours = (Object.values(api.sim.buildings) as any[]).filter(b => b.kind === "pier" || b.kind === "dock")
      .map(b => ({ kind: b.kind, boats: b.boats, workers: b.workers, reached: b.reached, atSea: b.atSea, ground: b.ground }));
    return { walkersAtShift, phase: api.sim.phase, away: boats.filter((b: any) => b.atSea).length, total: boats.length, dusk: api.view.dusk(), harbours, assignments: api.sim.assignments };
  });
  console.log("M4 high water:", JSON.stringify(high));
  assert(high.phase === "high", "clock is at high water");
  assert(high.away >= 3, "at least 3 boats away from the docks at high water");
  assert(high.walkersAtShift > 0, "walkers spawned at shift change");
  await page.waitForTimeout(300);
  await page.screenshot({ path: "shots/m4-high.png" });

  const low = await page.evaluate(() => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    api.advanceTo(0.5);
    const boats = api.view.boats();
    return { phase: api.sim.phase, moored: boats.filter((b: any) => b.moored).length, away: boats.filter((b: any) => b.atSea).length };
  });
  console.log("M4 low water:", JSON.stringify(low));
  assert(low.phase === "low", "clock is at low water");
  assert(low.moored >= 3, "at least 3 boats at the docks at low water");
  await page.waitForTimeout(300);
  await page.screenshot({ path: "shots/m4-low.png" });

  // M5: on a fresh town, the wood chain — camp on the hill, sawmill, shipyard — launches a boat within 12 cycles;
  // trees near the camp thin out.
  await page.evaluate(() => (window as unknown as { __tidewater: Api }).__tidewater.newTown());
  const m5 = await page.evaluate(async () => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    const url = "/test/scenario.ts";
    const sc = (await import(url)) as typeof import("./scenario");
    const s = api.sim, grid = api.grid;
    const town = sc.starterTown(s, grid);
    api.grant(3000);
    const end = sc.reachHill(s, grid);
    const camp = end ? sc.placeLumberCamp(s, grid, end) : null;
    const mill = sc.placeByWalkway(s, grid, "sawmill", 1)[0] ?? null;
    sc.growStreet(s, grid, 6);
    sc.placeByWalkway(s, grid, "house", 6);
    sc.placeSecondPier(s, grid, town.pier.cells[0]); // a berth for the boat to come
    const treesBefore = camp ? (await import("/src/sim/trees.ts" as string) as typeof import("../src/sim/trees")).grownTreesNear(s, camp.cells) : -1;
    const boatsBefore = (Object.values(s.buildings) as any[]).reduce((n, b) => n + b.boats, 0);
    let yard = null, launched = -1;
    for (let cycle = 1; cycle <= 12; cycle++) {
      api.advance(1);
      if (!yard && s.resources.planks >= 40) yard = sc.placeShipyard(s, grid, town.pier.cells[0]);
      const boats = (Object.values(s.buildings) as any[]).reduce((n, b) => n + b.boats, 0);
      if (boats > boatsBefore) { launched = cycle; break; }
    }
    const treesAfter = camp ? (await import("/src/sim/trees.ts" as string) as typeof import("../src/sim/trees")).grownTreesNear(s, camp.cells) : -1;
    api.frameTown(26);
    return { camp: !!camp, mill: !!mill, yard: !!yard, launched, treesBefore, treesAfter, planks: s.resources.planks, timber: s.resources.timber, log: s.log.slice(-3) };
  });
  console.log("M5:", JSON.stringify(m5));
  assert(m5.camp && m5.mill && m5.yard, "camp, sawmill and shipyard placed");
  assert(m5.launched > 0 && m5.launched <= 12, "shipyard launched a boat within 12 cycles");
  assert(m5.treesAfter < m5.treesBefore, "trees near the camp thinned out");
  await page.waitForTimeout(300);
  await page.screenshot({ path: "shots/m5.png" });

  // M6: an outfall fouls the water; the pollution overlay shows it and an oyster bed beside it dies.
  const m6 = await page.evaluate(() => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    const s = api.sim, grid = api.grid;
    api.grant(500);
    let bed: any = null, outfall: any = null;
    for (let i = -32; i < 32 && !outfall; i++) for (let j = -32; j < 32 && !outfall; j++) {
      const c = { i, j };
      if (grid.classAt(c) !== "flat" || grid.buildingAt(c)) continue;
      const h = grid.heightAt(c);
      if (h < 0 || h > 0.45) continue;
      const deep = grid.neighbors(c).find((n: any) => grid.classAt(n) === "deep" && grid.footprint("outfall", n) && grid.canPlace("outfall", grid.footprint("outfall", n)));
      if (!deep) continue;
      bed = grid.place("oysterBed", [c]);
      outfall = api.place("outfall", deep.i, deep.j);
    }
    api.setOverlay("pollution");
    let died = -1;
    for (let cycle = 1; cycle <= 5; cycle++) { api.advance(1); if (!s.buildings[bed.id]) { died = cycle; break; } }
    let peak = 0; for (const v of api.fields.pollution) if (v > peak) peak = v;
    api.frameAt(outfall.cells[0].i + 0.5, outfall.cells[0].j + 0.5, 18);
    return { bed: !!bed, outfall: !!outfall, died, peak, log: s.log.slice(-2) };
  });
  console.log("M6:", JSON.stringify(m6));
  assert(m6.bed && m6.outfall, "oyster bed and outfall placed");
  assert(m6.peak > 0, "pollution field has mass");
  assert(m6.died > 0 && m6.died <= 4, "oyster bed beside the outfall died within 4 cycles");
  await page.waitForTimeout(400);
  await page.screenshot({ path: "shots/m6.png" });
  await page.evaluate(() => (window as unknown as { __tidewater: Api }).__tidewater.setOverlay(null));

  // M1: save, reload the page, every building is back and the clock kept its place.
  const before = await page.evaluate(() => { const api = (window as unknown as { __tidewater: Api }).__tidewater; api.save(); return { n: Object.keys(api.sim.buildings).length, cycle: api.sim.tide.cycle, money: api.sim.resources.money }; });
  await page.reload();
  await waitReady(page);
  const after = await page.evaluate(() => { const api = (window as unknown as { __tidewater: Api }).__tidewater; const kinds = new Set((Object.values(api.sim.buildings) as any[]).map(b => b.kind)); return { n: Object.keys(api.sim.buildings).length, cycle: api.sim.tide.cycle, money: api.sim.resources.money, meshes: api.scene.meshes.filter((m: any) => kinds.has(m.name)).length }; });
  console.log("M1:", JSON.stringify({ before, after }));
  assert(after.n === before.n && before.n >= 5, "all buildings present after reload");
  assert(after.cycle === before.cycle && after.money === before.money, "ledger restored");
  assert(after.meshes === before.n, "view rebuilt one mesh per building");
  await page.screenshot({ path: "shots/m1.png" });

  // Headless fps on the real GPU, averaged over 5 s.
  const fps = await page.evaluate(async () => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    let frames = 0;
    const obs = api.scene.onAfterRenderObservable.add(() => frames++);
    await new Promise(r => setTimeout(r, 5000));
    api.scene.onAfterRenderObservable.remove(obs);
    return frames / 5;
  });
  console.log(`headless fps: ${fps.toFixed(1)}`);
  assert(fps >= 60, "60 fps in headless");
  assert(errors.length === 0, "no page errors: " + errors.join(" | "));
  console.log("smoke OK → shots/");
} finally {
  await browser.close();
  await server.close();
}
