// Headless smoke scenario. Starts the Vite dev server in-process, drives the game through window.__tidewater in
// headless Chrome, asserts, and writes screenshots to shots/. Run with `npm run smoke` (Node 24 strips the types).
import { chromium } from "playwright";
import type { Page } from "playwright";
import { createServer } from "vite";

const PORT = 5181;

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error("smoke assertion failed: " + msg);
}

import type { TidewaterApi as Api } from "../src/main";
import type { Building, Cell } from "../src/sim/state";
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
  page.on("dialog", d => d.accept()); // the Town menu's "new town?" confirm

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
  // Backlog 7: the first boat pops an achievement within a second of sim time.
  const b7 = await page.evaluate(() => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    api.tickSeconds(1);
    const el = document.getElementById("achievement")!;
    return { earned: api.sim.achievements.slice(), shown: api.view.achievementsShown(), visible: !el.hidden, text: el.innerText.replace(/\s+/g, " ") };
  });
  console.log("B7 achievement:", JSON.stringify(b7));
  assert(b7.earned.includes("firstBoat") && b7.shown.includes("firstBoat") && b7.visible && /First boat/.test(b7.text), "first-boat popup shown");

  // UI: a clicked category tab stays selected while a tool of another category is active.
  await page.click("#hud .tabs button:nth-child(1)");
  await page.waitForTimeout(250);
  const tab = await page.evaluate(() => { const api = (window as unknown as { __tidewater: Api }).__tidewater; return { category: api.view.category(), active: document.querySelector("#hud .tabs button.active")?.textContent, visible: [...document.querySelectorAll<HTMLElement>("#hud .palette button")].filter(b => !b.hidden).length }; });
  console.log("UI tabs:", JSON.stringify(tab));
  assert(tab.category === "Homes" && tab.active === "Homes" && tab.visible > 0, "the Homes tab stays selected after a click");
  const overflow = await page.evaluate(() => { const hud = document.getElementById("hud")!.getBoundingClientRect(); return [...document.querySelectorAll("#hud button")].filter(b => b.getBoundingClientRect().right > hud.right + 0.5).length; });
  assert(overflow === 0, "no HUD button bleeds past the panel");

  // Camera: wheel zooms toward the cursor, drags grab the ground / rotate, keys pan and turn; nothing gets removed.
  const cam0 = await page.evaluate(() => { const api = (window as unknown as { __tidewater: Api }).__tidewater; api.frameTown(30); return { pose: api.view.camera(), n: Object.keys(api.sim.buildings).length, ground: api.groundAt(900, 300) }; });
  await page.mouse.move(900, 300);
  await page.mouse.wheel(0, -900);
  await page.waitForTimeout(700);
  const zoomed = await page.evaluate(() => { const api = (window as unknown as { __tidewater: Api }).__tidewater; return { pose: api.view.camera(), ground: api.groundAt(900, 300) }; });
  await page.mouse.move(640, 380);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(760, 380, { steps: 6 });
  await page.mouse.up({ button: "middle" });
  await page.waitForTimeout(300);
  const panned = await page.evaluate(() => (window as unknown as { __tidewater: Api }).__tidewater.view.camera());
  await page.mouse.move(640, 380);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(800, 380, { steps: 6 });
  await page.mouse.up({ button: "right" });
  await page.waitForTimeout(500);
  const turned = await page.evaluate(() => { const api = (window as unknown as { __tidewater: Api }).__tidewater; return { pose: api.view.camera(), n: Object.keys(api.sim.buildings).length }; });
  await page.keyboard.down("q");
  await page.waitForTimeout(400);
  await page.keyboard.up("q");
  await page.keyboard.down("w");
  await page.waitForTimeout(400);
  await page.keyboard.up("w");
  await page.waitForTimeout(400);
  const keyed = await page.evaluate(() => (window as unknown as { __tidewater: Api }).__tidewater.view.camera());
  console.log("Camera:", JSON.stringify({ start: cam0.pose, zoomed: zoomed.pose, groundDrift: cam0.ground && zoomed.ground ? Math.hypot(zoomed.ground.x - cam0.ground.x, zoomed.ground.z - cam0.ground.z) : null, panned, turned: turned.pose, keyed }));
  assert(zoomed.pose.dist < cam0.pose.dist * 0.6, "wheel zooms in");
  assert(cam0.ground && zoomed.ground && Math.hypot(zoomed.ground.x - cam0.ground.x, zoomed.ground.z - cam0.ground.z) < 1.5, "zoom keeps the point under the cursor");
  assert(Math.hypot(panned.x - zoomed.pose.x, panned.z - zoomed.pose.z) > 1, "middle-drag pans");
  assert(Math.abs(turned.pose.yaw - panned.yaw) > 0.4 && turned.n === cam0.n, "right-drag rotates and removes nothing");
  assert(Math.abs(keyed.yaw - turned.pose.yaw) > 0.2 && Math.hypot(keyed.x - turned.pose.x, keyed.z - turned.pose.z) > 1, "Q turns and W pans");
  await page.evaluate(() => (window as unknown as { __tidewater: Api }).__tidewater.frameTown());

  // Placement: drag a run of raised walkways with the left button (the camera must not pan), the hint prices the
  // run while dragging, the street's decks meet, and removing one refunds half.
  const runStart = await page.evaluate(() => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    api.grant(500);
    api.frameTown(18);
    api.place("raisedWalkway", -99, -99); // just selects the tool (off the map places nothing)
    // A free cell beside the street with three free non-high cells in a row beyond it (raised walkways take
    // flats and deep water alike).
    const grid = api.grid;
    for (let i = -30; i < 30; i++) for (let j = -30; j < 30; j++) {
      const c = { i, j };
      if (grid.classAt(c) === "high" || grid.buildingAt(c) || !grid.touchesLink([c])) continue;
      for (const d of [{ i: 1, j: 0 }, { i: -1, j: 0 }, { i: 0, j: 1 }, { i: 0, j: -1 }]) {
        const ok = [1, 2, 3].every(k => { const q = { i: i + d.i * k, j: j + d.j * k }; return grid.classAt(q) !== "high" && !grid.buildingAt(q); });
        if (ok) return { c, end: { i: i + d.i * 3, j: j + d.j * 3 }, n: Object.keys(api.sim.buildings).length, money: api.sim.resources.money, cam: api.view.camera() };
      }
    }
    return null;
  });
  assert(runStart, "a free row beside the street to drag along");
  // Raised walkways pick against their own deck height (1.2), so project the cells at that height.
  const toScreen = async (i: number, j: number) => page.evaluate(([i, j]) => (window as unknown as { __tidewater: Api }).__tidewater.screenOf(i + 0.5, j + 0.5, 1.2), [i, j] as [number, number]);
  const a = await toScreen(runStart.c.i, runStart.c.j), b = await toScreen(runStart.end.i, runStart.end.j);
  await page.mouse.move(a.x, a.y);
  await page.waitForTimeout(100);
  await page.mouse.down({ button: "left" });
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.waitForTimeout(100);
  const dragging = await page.evaluate(() => { const api = (window as unknown as { __tidewater: Api }).__tidewater; return { line: api.placement.line, hint: api.view.hint(), cam: api.view.camera() }; });
  await page.mouse.up({ button: "left" });
  await page.waitForTimeout(200);
  const laid = await page.evaluate(() => { const api = (window as unknown as { __tidewater: Api }).__tidewater; return { n: Object.keys(api.sim.buildings).length, money: api.sim.resources.money, cam: api.view.camera() }; });
  console.log("Placement drag:", JSON.stringify({ runStart: runStart.c, dragging, laid: { n: laid.n - runStart.n, spent: runStart.money - laid.money } }));
  assert(dragging.line && dragging.line.count >= 3 && /release to lay/.test(dragging.hint), "the hint prices the run while dragging: " + dragging.hint);
  assert(laid.n - runStart.n >= 3, "the drag laid at least three pieces");
  assert(Math.abs(laid.cam.x - runStart.cam.x) < 0.01 && Math.abs(laid.cam.z - runStart.cam.z) < 0.01, "left-drag with a street tool doesn't pan the camera");
  const refund = await page.evaluate(([i, j]) => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    const before = api.sim.resources.money;
    api.remove(i, j);
    return api.sim.resources.money - before;
  }, [runStart.end.i, runStart.end.j] as [number, number]);
  assert(refund === 6, "removing a raised walkway refunds 6$ (half of 12)");
  // The pier suggestion on a fresh town; then back to the starter town for the rest of M2.
  const marker = await page.evaluate(() => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    const town = api.saveJson();
    api.newTown(); api.tickSeconds(0.2);
    const marker = api.view.pierMarker();
    api.load(town);
    return { marker, n: Object.keys(api.sim.buildings).length };
  });
  assert(marker.marker !== null && marker.n === laid.n - 1, "a fresh town shows the pier suggestion; the starter town came back");

  // Loans: the button under the ledger lends once; the HUD shows what is owed until it is repaid.
  const loan = await page.evaluate(() => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    const before = api.sim.resources.money;
    (document.querySelector("#hud .loan") as HTMLButtonElement).click();
    api.tickSeconds(0.1);
    const status = document.querySelector("#hud .loan-status")?.textContent ?? "";
    const hidden = (document.querySelector("#hud .loan") as HTMLButtonElement).hidden;
    return { gained: api.sim.resources.money - before, owed: api.sim.loan.owed, status, hidden };
  });
  console.log("Loan:", JSON.stringify(loan));
  assert(loan.gained === 300 && loan.owed === 360 && /360\$ owed/.test(loan.status) && loan.hidden, "borrowing 300$ shows 360$ owed and hides the button");

  // Land tools: landfill raises the rendered ground and the cell's class; a tree can be planted on it.
  const land = await page.evaluate(() => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    api.grant(500, 0, 50);
    const grid = api.grid;
    let c: { i: number; j: number } | null = null;
    for (let i = -30; i < 30 && !c; i++) for (let j = -30; j < 30; j++) { const q = { i, j }; if (grid.classAt(q) === "flat" && !grid.buildingAt(q) && grid.heightAt(q) < 0.2 && !grid.neighbors(q).some(n => grid.buildingAt(n))) { c = q; break; } }
    if (!c) return null;
    const before = api.terrainHeight(c.i + 0.5, c.j + 0.5);
    api.place("landfill", c.i, c.j);
    const after = api.terrainHeight(c.i + 0.5, c.j + 0.5);
    const cls = grid.classAt(c);
    const extraBefore = api.sim.extraTrees.length;
    api.place("plantTree", c.i, c.j);
    const planted = api.sim.extraTrees.length === extraBefore + 1;
    const trees = api.sim.trees.length;
    api.place("clearTree", c.i, c.j);
    const cleared = api.sim.trees[trees - 1];
    return { c, before, after, cls, planted, cleared, landfill: api.sim.landfill.length };
  });
  console.log("Land:", JSON.stringify(land));
  assert(land && land.after > land.before + 0.3 && land.cls === "high" && land.planted && land.cleared === -1 && land.landfill === 1, "landfill raises the ground; plant and clear work on it");

  // Walkthrough card and deck lift: a fresh town opens on step 1 with the Sea tab pulsing; ] lifts the deck.
  const walk = await page.evaluate(() => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    const town = api.saveJson();
    api.newTown(); api.tickSeconds(0.2);
    const el = document.getElementById("tutorial")!;
    const out = { hidden: el.hidden, step: el.querySelector(".tut-step")?.textContent, title: el.querySelector("h3")?.textContent, pulsing: [...document.querySelectorAll("#hud .pulse")].map(b => b.textContent?.trim().split("\n")[0]), label: !document.getElementById("markerLabel")!.hidden };
    api.load(town);
    return out;
  });
  console.log("Walkthrough:", JSON.stringify(walk));
  assert(!walk.hidden && walk.step === "Step 1 of 6" && /pier/i.test(walk.title ?? "") && walk.pulsing.some(t => t === "Sea") && walk.label, "the walkthrough card opens on the pier step and pulses the Sea tab");
  await page.evaluate(() => (window as unknown as { __tidewater: Api }).__tidewater.place("walkway", -99, -99));
  await page.mouse.move(100, 300); // over the HUD panel: no hovered cell, so the hint shows the lift itself
  await page.waitForTimeout(100);
  await page.keyboard.press("]");
  await page.waitForTimeout(100);
  await page.keyboard.press("]");
  await page.waitForTimeout(100);
  const lift = await page.evaluate(() => { const api = (window as unknown as { __tidewater: Api }).__tidewater; return { lift: api.placement.lift, hint: api.view.hint(), focus: document.activeElement?.tagName }; });
  console.log("Lift:", JSON.stringify(lift));
  await page.keyboard.press("[");
  await page.keyboard.press("[");
  assert(lift.lift === 2 && /\+0\.4 m/.test(lift.hint), "] lifts the deck two steps and the hint says so: " + lift.hint);

  const ran = await page.evaluate(() => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    api.advance(4);
    const s = api.sim;
    let pop = 0; for (const b of Object.values(s.buildings) as Building[]) pop += b.residents;
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
    const market = (Object.values(api.sim.buildings) as Building[]).find(b => b.kind === "market")!;
    const removed: { i: number; j: number; kind: Building["kind"] }[] = [];
    for (const c of market.cells) for (const n of api.grid.neighbors(c)) {
      const b = api.grid.buildingAt(n);
      if (b && (b.kind === "walkway" || b.kind === "raisedWalkway")) { removed.push({ i: n.i, j: n.j, kind: b.kind }); api.remove(n.i, n.j); }
    }
    api.advance(1);
    const out = { reached: market.reached, sold: api.sim.last.fishSold, fish: api.sim.resources.fish, restored: 0 };
    // Put the street back so the later milestones inherit a working market.
    for (const r of removed) if (api.place(r.kind, r.i, r.j)) out.restored++;
    return out;
  });
  console.log("M2 market cut:", JSON.stringify(cut));
  assert(!cut.reached && cut.sold === 0, "sales stop when the market is cut off");
  assert(cut.restored > 0, "the market's walkway went back");

  // M3: low-water producers and a raised walkway go in; the 4th cycle is a spring tide.
  const m3 = await page.evaluate(async () => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    const url = "/test/scenario.ts";
    const sc = (await import(url)) as typeof import("./scenario");
    api.grant(600, 20);
    const s = api.sim, grid = api.grid;
    sc.growStreet(s, grid, 6);
    const oyster = sc.placeByWalkway(s, grid, "oysterBed", 1).length === 1;
    const clam = sc.placeByWalkway(s, grid, "clamCamp", 1).length === 1;
    const raised = sc.placeByWalkway(s, grid, "raisedWalkway", 1).length === 1;
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
  const m4setup = await page.evaluate(async () => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    const grid = api.grid;
    api.grant(600, 20);
    const s = api.sim;
    const pier = (Object.values(s.buildings) as Building[]).find(b => b.kind === "pier")!;
    // A second pier along the same shore and a dock against the first pier; boats set in the ledger (the shipyard is M5).
    let pier2: Cell | null = null, bd = Infinity;
    for (let i = -32; i < 32 && !pier2; i++) for (let j = -32; j < 32; j++) {
      const c = { i, j };
      if (grid.classAt(c) !== "deep" || !grid.footprint("pier", c) || grid.buildingAt(c)) continue;
      const d = Math.hypot(i - pier.cells[0].i, j - pier.cells[0].j);
      if (d >= 3 && d < bd) { bd = d; pier2 = c; }
    }
    const p2 = pier2 ? api.place("pier", pier2.i, pier2.j) : null;
    let dock: Building | null = null;
    for (const pc of pier.cells as Cell[]) for (const n of grid.neighbors(pc)) {
      for (let di = 0; di < 2 && !dock; di++) for (let dj = 0; dj < 2 && !dock; dj++) dock = api.place("dock", n.i - di, n.j - dj);
      if (dock) break;
    }
    if (p2) p2.boats = 2;
    if (dock) dock.boats = 2;
    const url4 = "/test/scenario.ts";
    const sc4 = (await import(url4)) as typeof import("./scenario");
    api.grant(0, 200);
    sc4.shelterHarbours(s, grid); // storms mustn't sink the boats we're about to count
    // Grow the street with raised walkways (they never flood) and hang houses off them, then let immigration run,
    // so there are hands for every boat after the pier and market fill.
    api.grant(1500);
    let laid = 0, huts = 0;
    for (let round = 0; round < 8; round++) {
      const links = (Object.values(s.buildings) as Building[]).filter(b => b.kind === "walkway" || b.kind === "raisedWalkway");
      let placed = false;
      for (const w of links) {
        for (const n of grid.neighbors(w.cells[0])) {
          if (grid.classAt(n) === "flat" && !grid.buildingAt(n) && api.place("raisedWalkway", n.i, n.j)) { laid++; placed = true; break; }
        }
        if (placed) break;
      }
      if (!placed) break;
    }
    for (const w of (Object.values(s.buildings) as Building[]).filter(b => b.kind === "raisedWalkway")) {
      for (const n of grid.neighbors(w.cells[0])) { if (huts >= 6) break; if (api.place("house", n.i, n.j)) huts++; }
    }
    api.advance(6);
    let pop = 0; for (const b of Object.values(s.buildings) as Building[]) pop += b.residents;
    return { pier2: !!p2, dock: !!dock, laid, houses: huts, pop, boats: (Object.values(s.buildings) as Building[]).reduce((n, b) => n + b.boats, 0) };
  });
  console.log("M4 setup:", JSON.stringify(m4setup));
  assert(m4setup.boats >= 4, "at least four boats in the ledger");

  const high = await page.evaluate(() => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    while (api.sim.storm.active) api.advance(1); // boats stay in through a storm; measure a fair-weather tide
    api.advanceTo(0.65); // slack water on the rise, so the view sees the coming shift change
    api.advanceTo(0.8);  // just inside high water: the shift has changed
    const walkersAtShift = api.view.walkers();
    api.advanceTo(0.0);  // the peak: boats are on their grounds
    api.frameTown(30);
    const boats = api.view.boats();
    const harbours = (Object.values(api.sim.buildings) as Building[]).filter(b => b.kind === "pier" || b.kind === "dock")
      .map(b => ({ kind: b.kind, boats: b.boats, workers: b.workers, reached: b.reached, atSea: b.atSea, ground: b.ground }));
    return { walkersAtShift, phase: api.sim.phase, away: boats.filter(b => b.atSea).length, total: boats.length, dusk: api.view.dusk(), harbours, assignments: api.sim.assignments, gulls: api.view.gulls(), crabs: api.view.crabs() };
  });
  console.log("M4 high water:", JSON.stringify(high));
  assert(high.phase === "high", "clock is at high water");
  assert(high.away >= 3, "at least 3 boats away from the docks at high water");
  assert(high.walkersAtShift > 0, "walkers spawned at shift change");
  // Backlog 3: gulls over harbours with boats; no crabs while the flats are under water.
  assert(high.gulls > 0, "gulls circle the harbours");
  assert(high.crabs === 0, "no crabs at high water");
  await page.waitForTimeout(300);
  await page.screenshot({ path: "shots/m4-high.png" });

  const low = await page.evaluate(() => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    api.advanceTo(0.5);
    const boats = api.view.boats();
    return { phase: api.sim.phase, moored: boats.filter(b => b.moored).length, away: boats.filter(b => b.atSea).length, crabs: api.view.crabs() };
  });
  console.log("M4 low water:", JSON.stringify(low));
  assert(low.phase === "low", "clock is at low water");
  assert(low.moored >= 3, "at least 3 boats at the docks at low water");
  assert(low.crabs > 0, "crabs on the exposed flats at low water");
  await page.waitForTimeout(300);
  await page.screenshot({ path: "shots/m4-low.png" });
  // The catch comes ashore: porters with baskets walked from the piers to the market when the boats landed.
  const porters = await page.evaluate(() => (window as unknown as { __tidewater: Api }).__tidewater.view.porters());
  console.log("Porters:", JSON.stringify(porters));
  assert(porters.spawned > 0, "porters carried the catch off the pier");

  // Day clock: from a fresh town, three quarters of a day on it is midnight — the sun is under the horizon,
  // the moon up, the stars out, and the scene lit by the moon; a quarter-day later it is noon again.
  const night = await page.evaluate(() => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    api.tickSeconds(0.75 * 2 * 120 - (api.sim.time % (2 * 120)));
    api.frameTown(26);
    return api.view.sky();
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: "shots/night.png" });
  const noon = await page.evaluate(() => { const api = (window as unknown as { __tidewater: Api }).__tidewater; api.tickSeconds(0.5 * 2 * 120); return api.view.sky(); });
  console.log("Sky:", JSON.stringify({ night, noon }));
  assert(night.sun.y < -0.7 && night.moon > 0.5 && night.night > 0.5 && night.lit.y > 0.5, "midnight: sun down, moon and stars up, moonlit");
  assert(noon.sun.y > 0.8 && noon.moon === 0 && noon.night === 0 && noon.lit.y === noon.sun.y, "noon: sun high, no moon, sunlit");

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
    sc.shelterHarbours(s, grid);
    const treesBefore = camp ? (await import("/src/sim/trees.ts" as string) as typeof import("../src/sim/trees")).grownTreesNear(s, camp.cells) : -1;
    const boatsBefore = (Object.values(s.buildings) as Building[]).reduce((n, b) => n + b.boats, 0);
    let yard = null, launched = -1;
    for (let cycle = 1; cycle <= 12; cycle++) {
      api.advance(1);
      if (!yard && s.resources.planks >= 40) yard = sc.placeShipyard(s, grid, town.pier.cells[0]);
      const boats = (Object.values(s.buildings) as Building[]).reduce((n, b) => n + b.boats, 0);
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
    let bed: Building | null = null, outfall: Building | null = null;
    for (let i = -32; i < 32 && !outfall; i++) for (let j = -32; j < 32 && !outfall; j++) {
      const c = { i, j };
      if (grid.classAt(c) !== "flat" || grid.buildingAt(c)) continue;
      const h = grid.heightAt(c);
      if (h < 0 || h > 0.45) continue;
      const deep = grid.neighbors(c).find(n => grid.classAt(n) === "deep" && grid.footprint("outfall", n) && grid.canPlace("outfall", grid.footprint("outfall", n)!));
      if (!deep) continue;
      bed = grid.place("oysterBed", [c]);
      outfall = api.place("outfall", deep.i, deep.j);
    }
    api.setOverlay("pollution");
    let died = -1;
    for (let cycle = 1; cycle <= 5; cycle++) { api.advance(1); if (!s.buildings[bed!.id]) { died = cycle; break; } }
    let peak = 0; for (const v of api.fields.pollution) if (v > peak) peak = v;
    api.frameAt(outfall!.cells[0].i + 0.5, outfall!.cells[0].j + 0.5, 18);
    return { bed: !!bed, outfall: !!outfall, died, peak, log: s.log.slice(-2) };
  });
  console.log("M6:", JSON.stringify(m6));
  assert(m6.bed && m6.outfall, "oyster bed and outfall placed");
  assert(m6.peak > 0, "pollution field has mass");
  assert(m6.died > 0 && m6.died <= 4, "oyster bed beside the outfall died within 4 cycles");
  await page.waitForTimeout(400);
  await page.screenshot({ path: "shots/m6.png" });
  await page.evaluate(() => (window as unknown as { __tidewater: Api }).__tidewater.setOverlay(null));

  // M7: services and lanterns lift a home to level 3; the info panel shows it.
  await page.evaluate(() => (window as unknown as { __tidewater: Api }).__tidewater.newTown());
  const m7 = await page.evaluate(async () => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    const url = "/test/scenario.ts";
    const sc = (await import(url)) as typeof import("./scenario");
    const s = api.sim, grid = api.grid;
    const town = sc.starterTown(s, grid);
    api.grant(2000);
    sc.growStreet(s, grid, 4);
    const well = sc.placeByWalkway(s, grid, "well", 1).length;
    const shrine = sc.placeByWalkway(s, grid, "shrine", 1).length;
    const tavern = sc.placeByWalkway(s, grid, "tavern", 1).length;
    let lanterns = 0;
    for (const w of (Object.values(s.buildings) as Building[]).filter(b => b.kind === "walkway" || b.kind === "raisedWalkway")) if (api.place("lanternPost", w.cells[0].i, w.cells[0].j)) lanterns++;
    api.advance(8);
    const best = town.huts.slice().sort((a, b) => b.level - a.level)[0];
    api.select(best.cells[0].i, best.cells[0].j);
    api.frameAt(best.cells[0].i + 0.5, best.cells[0].j + 0.5, 14);
    const panel = document.getElementById("info")!;
    return { well, shrine, tavern, lanterns, level: best.level, happiness: s.happiness, panelShown: !panel.hidden, panelText: panel.innerText.replace(/\s+/g, " ").slice(0, 160), district: panel.querySelector(".district")?.textContent?.replace(/\s+/g, " ") ?? "" };
  });
  console.log("M7:", JSON.stringify(m7));
  assert(m7.well && m7.shrine && m7.lanterns > 0, "services placed");
  assert(m7.level === 3, "a home reached level 3 within 8 cycles");
  // Backlog 5: the panel names the home's district and sums its people.
  assert(/^[A-Z][a-z]+ [A-Z][a-z]+\d+ buildings · \d+ \/ \d+ residents · \d+ \/ \d+ jobs/.test(m7.district), "district name and stats in the info panel: " + m7.district);
  assert(m7.panelShown && /level 3/.test(m7.panelText), "info panel shows the levelled home");
  await page.waitForTimeout(400);
  await page.screenshot({ path: "shots/m7.png" });
  await page.keyboard.press("Escape");

  // M8: swimmers at the beach at high water, a fin in the risky water off the market, an incident within 12 cycles.
  await page.evaluate(() => (window as unknown as { __tidewater: Api }).__tidewater.newTown());
  const m8 = await page.evaluate(async () => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    const url = "/test/scenario.ts";
    const sc = (await import(url)) as typeof import("./scenario");
    const s = api.sim, grid = api.grid;
    sc.starterTown(s, grid);
    api.grant(2000);
    sc.growStreet(s, grid, 6);
    sc.placeByWalkway(s, grid, "house", 6);
    const site = sc.pierByBeach(s, grid); // a busy pier beside the swimming beach
    if (!site) throw new Error("no pier site by a beach");
    sc.shelterHarbours(s, grid);
    api.setOverlay("shark");
    let firstIncident = -1, maxSwimmers = 0, fins = 0;
    for (let c = 1; c <= 12; c++) {
      api.advanceTo(0.65); api.advanceTo(0.85);
      maxSwimmers = Math.max(maxSwimmers, api.view.swimmers());
      fins = Math.max(fins, api.view.fins());
      api.advance(1);
      if (s.incidents > 0 && firstIncident < 0) firstIncident = c;
    }
    // Frame a beach with people on it at high water.
    api.advanceTo(0.65); api.advanceTo(0.9);
    const sw = s.swimmers[0];
    if (sw) api.frameAt(Math.floor(sw.k / 64) - 32 + 0.5, (sw.k % 64) - 32 + 0.5, 14);
    let risk = 0; for (const v of api.fields.shark) if (v > risk) risk = v;
    return { firstIncident, incidents: s.incidents, maxSwimmers, fins, risk, swimmersNow: api.view.swimmers(), log: s.log.filter((m: string) => /shark/.test(m)).slice(-1) };
  });
  console.log("M8:", JSON.stringify(m8));
  assert(m8.maxSwimmers > 0, "swimmers appear at the beach at high water");
  // Shark-net floats ride the water: the same net's floats sit ~a metre lower at low water than at high.
  const floats = await page.evaluate(() => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    api.grant(200);
    let net = null;
    for (let i = -30; i < 30 && !net; i++) for (let j = -30; j < 30 && !net; j++) { const c = { i, j }; if (api.grid.classAt(c) === "deep" && !api.grid.buildingAt(c) && api.grid.neighbors(c).some(n => api.grid.classAt(n) === "flat")) net = api.place("sharkNet", i, j); }
    api.setTide(0.6); api.tickSeconds(0.1);
    const high = api.view.netFloats();
    api.setTide(-0.35); api.tickSeconds(0.1);
    const low = api.view.netFloats();
    api.setTide(null);
    return { placed: !!net, high, low };
  });
  console.log("Net floats:", JSON.stringify(floats));
  assert(floats.placed && floats.high.count > 0 && floats.high.y - floats.low.y > 0.8, "net floats follow the water level");
  assert(m8.risk > 0 && m8.fins > 0, "shark risk builds off the market and a fin patrols it");
  assert(m8.incidents >= 1, "an unguarded beach sees an incident");
  await page.waitForTimeout(400);
  await page.screenshot({ path: "shots/m8.png" });
  await page.evaluate(() => (window as unknown as { __tidewater: Api }).__tidewater.setOverlay(null));

  // M9: a harbor and an inn; the trade ship sails in and out through its high water; tourists spend.
  await page.evaluate(() => (window as unknown as { __tidewater: Api }).__tidewater.newTown());
  const m9 = await page.evaluate(async () => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    const url = "/test/scenario.ts";
    const sc = (await import(url)) as typeof import("./scenario");
    const s = api.sim, grid = api.grid;
    const town = sc.starterTown(s, grid);
    api.grant(5000, 200);
    sc.growStreet(s, grid, 6);
    const harbor = sc.placeHarbor(s, grid, town.pier.cells[0]);
    const inn = sc.placeByWalkway(s, grid, "inn", 1).length === 1;
    api.orderPlanks();
    api.advance(1); // the harbor schedules its first visit for the next high water
    const visit = s.trade.nextVisit;
    // Into the rising half of the visit's high water: the ship is on its way in.
    api.advanceTo(0.65); api.advanceTo(0.81);
    const inbound = api.view.ship();
    if (harbor) api.frameAt(harbor.cells[4].i + 0.5, harbor.cells[4].j + 0.5, 30);
    return { harbor: !!harbor, inn, visit, cycle: s.tide.cycle, phase: s.phase, inbound };
  });
  console.log("M9 inbound:", JSON.stringify(m9));
  assert(m9.harbor && m9.inn, "harbor and inn placed");
  assert(m9.inbound && m9.inbound.leg === "in", "trade ship is sailing in");
  await page.waitForTimeout(400);
  await page.screenshot({ path: "shots/m9-in.png" });
  const m9out = await page.evaluate(() => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    api.advanceTo(0.13); // past the peak, still high water: the ship is leaving
    return { outbound: api.view.ship(), visits: api.sim.trade.visits, planks: api.sim.resources.planks, log: api.sim.log.slice(-2) };
  });
  console.log("M9 outbound:", JSON.stringify(m9out));
  assert(m9out.outbound && m9out.outbound.leg === "out", "trade ship is sailing out");
  assert(m9out.visits === 1 && m9out.planks >= 20, "the ship called and delivered the planks");
  assert(Math.hypot(m9out.outbound.x - m9.inbound.x, m9out.outbound.z - m9.inbound.z) > 1, "the ship moved");
  await page.waitForTimeout(400);
  await page.screenshot({ path: "shots/m9-out.png" });
  const m9tour = await page.evaluate(() => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    let tourism = 0, tourists = 0;
    for (let c = 0; c < 6; c++) { api.advance(1); tourism += api.sim.last.tourism; tourists = Math.max(tourists, api.sim.tourists); }
    return { tourism, tourists, visits: api.sim.trade.visits };
  });
  console.log("M9 tourism:", JSON.stringify(m9tour));
  assert(m9tour.tourists > 0 && m9tour.tourism > 0, "tourists came and spent");

  // Backlog 6: the isle is locked until a harbor stands; then the ferry runs and a settlement goes up on it.
  await page.evaluate(() => (window as unknown as { __tidewater: Api }).__tidewater.newTown());
  const b6 = await page.evaluate(async () => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    const url = "/test/scenario.ts";
    const sc = (await import(url)) as typeof import("./scenario");
    const s = api.sim, grid = api.grid;
    const t = sc.starterTown(s, grid);
    const lockedBlocker = api.blockerAt("hut", 22, 17);
    const lockedFerry = api.view.ferry();
    api.grant(5000, 300, 100);
    const harbor = sc.placeHarbor(s, grid, t.pier.cells[0]);
    // Task 3: the harbor bridged to the street becomes the ferry's terminal; a smokehouse leaves mainland jobs
    // open, so full isle huts send commuters across, and they ride the deck.
    const bridge = harbor ? sc.bridgeTo(s, grid, harbor).length : 0;
    sc.growStreet(s, grid, 6);
    const smokehouse = sc.placeByWalkway(s, grid, "smokehouse").length;
    const isle = sc.settleIsle(s, grid);
    for (const h of [...t.huts, ...isle.huts]) h.residents = 2;
    api.advance(2);
    api.tickSeconds(20);
    api.frameAt(22.5, 21, 16);
    return { lockedBlocker, lockedFerry, harbor: !!harbor, open: api.view.isleOpen(), pier: !!isle.pier, walkways: isle.walkways.length, huts: isle.huts.length, ferry: api.view.ferry(), reached: isle.huts.filter(h => h.reached).length, bridge, smokehouse, terminals: api.view.ferryTerminals(), commuters: api.view.commuters(), riders: api.view.riders(), log: s.log.slice(-4) };
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: "shots/b6-isle.png" });
  console.log("B6 isle:", JSON.stringify(b6));
  assert(/harbor/.test(b6.lockedBlocker ?? "") && b6.lockedFerry === null, "isle locked and no ferry before a harbor");
  assert(b6.harbor && b6.open, "a harbor opens the isle");
  assert(b6.pier && b6.walkways > 0 && b6.huts > 0, "pier, walkways and huts on the isle");
  assert(b6.ferry && ["out", "landed", "back", "berthed"].includes(b6.ferry.leg), "the ferry is running");
  assert(b6.bridge > 0 && b6.smokehouse === 1 && b6.terminals && b6.terminals.isle.length > 0, "harbor bridged and the isle pier is a terminal");
  assert(b6.commuters > 0 && b6.riders === Math.min(8, b6.commuters), "isle residents commute by ferry and ride its deck");

  // M10: a smokehouse catches fire — flames and smoke — burns out damaged, and the repair fund fixes it.
  await page.evaluate(() => (window as unknown as { __tidewater: Api }).__tidewater.newTown());
  const m10 = await page.evaluate(async () => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    const url = "/test/scenario.ts";
    const sc = (await import(url)) as typeof import("./scenario");
    const s = api.sim, grid = api.grid;
    sc.starterTown(s, grid);
    api.grant(3000, 0, 50);
    sc.growStreet(s, grid, 6);
    const smokehouse = sc.placeByWalkway(s, grid, "smokehouse", 1)[0];
    if (!smokehouse) throw new Error("no smokehouse");
    api.advance(2);
    api.setOverlay("fire");
    api.ignite(smokehouse.cells[0].i, smokehouse.cells[0].j);
    api.tickSeconds(6);
    api.frameAt(smokehouse.cells[0].i + 1, smokehouse.cells[0].j + 0.5, 12);
    return { burning: api.view.burning(), fire: smokehouse.fire, id: smokehouse.id, cell: smokehouse.cells[0] };
  });
  console.log("M10 burning:", JSON.stringify(m10));
  assert(m10.burning >= 1 && m10.fire > 0, "the smokehouse is burning with flames in view");
  await page.waitForTimeout(400);
  await page.screenshot({ path: "shots/m10-fire.png" });
  const m10b = await page.evaluate((id: number) => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    api.tickSeconds(30);
    const b = api.sim.buildings[id];
    const damaged = b.damaged;
    api.advance(1);
    return { damaged, repaired: !b.damaged, log: api.sim.log.filter((m: string) => /burnt|Repaired/.test(m)) };
  }, m10.id);
  console.log("M10 aftermath:", JSON.stringify(m10b));
  assert(m10b.damaged, "the smokehouse burnt out damaged");
  assert(m10b.repaired, "the repair fund fixed it at the next settlement");
  await page.waitForTimeout(300);
  await page.screenshot({ path: "shots/m10-repaired.png" });
  await page.evaluate(() => (window as unknown as { __tidewater: Api }).__tidewater.setOverlay(null));

  // M11: a storm darkens the sky and triples the swell; the tsunami pulls the water back, then a wave comes in.
  await page.evaluate(() => (window as unknown as { __tidewater: Api }).__tidewater.newTown());
  const m11 = await page.evaluate(async () => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    const url = "/test/scenario.ts";
    const sc = (await import(url)) as typeof import("./scenario");
    const s = api.sim, grid = api.grid;
    const town = sc.starterTown(s, grid);
    api.grant(3000, 100, 100);
    sc.growStreet(s, grid, 6);
    sc.placeByWalkway(s, grid, "house", 4);
    api.advance(2);
    api.forceStorm();
    api.tickSeconds(8);
    api.frameTown(30);
    return { storm: s.storm.active, mix: api.view.stormMix(), boats: town.pier.boats, log: s.log.slice(-2) };
  });
  console.log("M11 storm:", JSON.stringify(m11));
  assert(m11.storm && m11.mix > 0.5, "storm is blowing and the sky has darkened");
  await page.waitForTimeout(400);
  await page.screenshot({ path: "shots/m11-storm.png" });
  const m11t = await page.evaluate(() => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    const s = api.sim;
    api.advance(1); // the storm blows through
    api.forceTsunami();
    api.tickSeconds(19);
    return { stage: s.tsunami.stage, level: s.tide.level, storm: s.storm.active };
  });
  console.log("M11 drawdown:", JSON.stringify(m11t));
  assert(m11t.stage === "drawdown" && m11t.level < -1.0 && !m11t.storm, "the sea has pulled back");
  await page.waitForTimeout(300);
  await page.screenshot({ path: "shots/m11-drawdown.png" });
  const m11w = await page.evaluate(() => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    const s = api.sim;
    api.tickSeconds(4);
    // Run the front to the town's edge, then look at it.
    let guard = 0;
    while (s.tsunami.stage === "wave" && s.tsunami.front < -6 && guard++ < 200) api.tickSeconds(0.5);
    return { stage: s.tsunami.stage, front: s.tsunami.front, struck: s.tsunami.struck.length };
  });
  console.log("M11 wave:", JSON.stringify(m11w));
  assert(m11w.stage === "wave", "the wave is sweeping in");
  await page.waitForTimeout(300);
  await page.screenshot({ path: "shots/m11-wave.png" });
  const m11d = await page.evaluate(() => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    const s = api.sim;
    let guard = 0;
    while (s.tsunami.stage && guard++ < 400) api.tickSeconds(1);
    let damaged = 0; for (const b of Object.values(s.buildings) as Building[]) if (b.damaged) damaged++;
    return { stage: s.tsunami.stage, damaged, override: s.tide.override, log: s.log.filter((m: string) => /wave|sea/.test(m)).slice(-3) };
  });
  console.log("M11 after:", JSON.stringify(m11d));
  assert(m11d.stage === null && m11d.override === null, "the water came back");
  assert(m11d.damaged > 0, "the wave damaged the flats");

  // M12: a 300-building town with 200 walkers and 30 boats holds 60 fps; saving and reloading it takes < 2 s.
  await page.evaluate(() => (window as unknown as { __tidewater: Api }).__tidewater.newTown());
  const m12 = await page.evaluate(async () => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    const url = "/test/scenario.ts";
    const sc = (await import(url)) as typeof import("./scenario");
    const s = api.sim, grid = api.grid;
    sc.starterTown(s, grid);
    const built = sc.bigTown(s, grid);
    sc.shelterHarbours(s, grid);
    api.advance(2);
    while (s.storm.active) api.advance(1);
    api.advanceTo(0.65); api.advanceTo(0.8); // shift change: the streets fill
    const shiftWalkers = api.view.walkers();
    // The island's flats hold ~160 jobs; the rest of the 200-walker load is view-only stress on the same routes.
    const extra = shiftWalkers < 200 ? api.stressWalkers(200 - shiftWalkers) : 0;
    api.frameTown(40);
    return { ...built, shiftWalkers, extra, walkers: api.view.walkers(), away: api.view.boats().filter(b => b.atSea).length, assignments: s.assignments.reduce((n, a) => n + a.n, 0), roofs: api.view.roofs() };
  });
  console.log("M12 big town:", JSON.stringify(m12));
  // Backlog 4: the homes of a big town wear all three roof shapes.
  assert(m12.roofs.pyramid > 0 && m12.roofs.gable > 0 && m12.roofs.hipped > 0, "three roof shapes among the homes");
  // Backlog 7: a town of 230 has earned its fifty and its hundred.
  const m12Ach = await page.evaluate(() => (window as unknown as { __tidewater: Api }).__tidewater.sim.achievements.slice());
  assert(m12Ach.includes("fifty") && m12Ach.includes("hundred"), "big town achievements: " + m12Ach.join(","));
  assert(m12.buildings >= 300, "300 buildings placed");
  assert(m12.boats >= 30, "30 boats in the ledger");
  assert(m12.walkers >= 200, "200 walkers on the streets");
  await page.waitForTimeout(500);
  const bigFps = await page.evaluate(async () => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    let frames = 0;
    const obs = api.scene.onAfterRenderObservable.add(() => frames++);
    await new Promise(r => setTimeout(r, 5000));
    api.scene.onAfterRenderObservable.remove(obs);
    return frames / 5;
  });
  console.log(`M12 big-town fps: ${bigFps.toFixed(1)}`);
  await page.screenshot({ path: "shots/m12-bigtown.png" });
  assert(bigFps >= 60, "60 fps with 300 buildings, 200 walkers, 30 boats");
  // Backlog 1: planar reflections behind a toggle — on, the big town still holds 60 fps; the button flips it; off
  // again the colour path is the study's.
  await page.evaluate(() => (window as unknown as { __tidewater: Api }).__tidewater.setReflections(true));
  await page.waitForTimeout(300);
  const reflFps = await page.evaluate(async () => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    let frames = 0;
    const obs = api.scene.onAfterRenderObservable.add(() => frames++);
    await new Promise(r => setTimeout(r, 5000));
    api.scene.onAfterRenderObservable.remove(obs);
    return { fps: frames / 5, on: api.view.reflections(), targets: api.scene.customRenderTargets.length };
  });
  await page.screenshot({ path: "shots/b1-reflections.png" });
  await page.click("#speed .reflections");
  const reflOff = await page.evaluate(() => { const api = (window as unknown as { __tidewater: Api }).__tidewater; return { on: api.view.reflections(), targets: api.scene.customRenderTargets.length }; });
  console.log("B1 reflections:", JSON.stringify({ ...reflFps, off: reflOff }));
  assert(reflFps.on && reflFps.targets === 1, "reflections on: one mirror render target");
  assert(reflFps.fps >= 60, "60 fps with reflections on in the big town");
  assert(!reflOff.on && reflOff.targets === 0, "reflections button turns them off");
  await page.evaluate(() => (window as unknown as { __tidewater: Api }).__tidewater.save());
  const t0 = Date.now();
  await page.reload();
  await waitReady(page);
  const loadMs = Date.now() - t0;
  const bigLoaded = await page.evaluate(() => { const api = (window as unknown as { __tidewater: Api }).__tidewater; return { n: Object.keys(api.sim.buildings).length, bootMs: api.bootMs }; });
  console.log(`M12 reload: ${loadMs} ms wall (${bigLoaded.bootMs.toFixed(0)} ms boot), ${bigLoaded.n} buildings`);
  assert(bigLoaded.n === m12.buildings, "big town survived the reload");
  assert(loadMs < 2000, "a 300-building town loads in under 2 s");

  // M13: no sound until the first gesture; a click starts and resumes the audio context; mute is remembered.
  const audioBefore = await page.evaluate(() => (window as unknown as { __tidewater: Api }).__tidewater.view.audio());
  await page.mouse.click(640, 200);
  await page.waitForTimeout(300);
  const audioAfter = await page.evaluate(() => (window as unknown as { __tidewater: Api }).__tidewater.view.audio());
  await page.click("#speed .mute");
  const audioMuted = await page.evaluate(() => (window as unknown as { __tidewater: Api }).__tidewater.view.audio());
  await page.click("#speed .mute");
  console.log("M13 audio:", JSON.stringify({ before: audioBefore, after: audioAfter, muted: audioMuted }));
  assert(!audioBefore.started, "no audio context before the first gesture");
  assert(audioAfter.started && audioAfter.state === "running", "audio context runs after a click");
  assert(audioMuted.muted, "mute button mutes");
  // The ambient layer may already have called a gull on its own (gulls are up); a manual cry adds exactly one.
  const cried = await page.evaluate(() => { const api = (window as unknown as { __tidewater: Api }).__tidewater; const before = api.view.audio().cries; api.audioCry(); return { before, after: api.view.audio().cries }; });
  console.log("Gull cries:", JSON.stringify(cried));
  assert(cried.after === cried.before + 1, "a gull cry plays through the ambient layer");
  // The shift bell rings by day and stays silent between sunset and sunrise: walk eight shift changes and see.
  const bells = await page.evaluate(() => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    const out: { sunUp: boolean; rang: boolean }[] = [];
    for (let k = 0; k < 8; k++) {
      const before = api.view.audio().bells;
      api.advanceTo(0.65); api.advanceTo(0.8); // slack water → high water: a shift change
      out.push({ sunUp: api.view.sky().day < 0.5, rang: api.view.audio().bells > before });
    }
    return out;
  });
  console.log("Bells:", JSON.stringify(bells));
  assert(bells.some(b => b.sunUp) && bells.some(b => !b.sunUp), "the eight shifts span day and night");
  assert(bells.every(b => b.rang === b.sunUp), "the bell rings exactly at the daytime shift changes");
  assert((await page.evaluate(() => (window as unknown as { __tidewater: Api }).__tidewater.view.personScale())) === 0.4, "people are 0.4 scale");

  // Backlog 2: caustics brighten the shallows over a beach at high water and add nothing when off.
  const b2 = await page.evaluate(async () => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    api.setReflections(false);
    api.advanceTo(0);
    let beach: { i: number; j: number } | null = null;
    for (let j = -31; j < 31 && !beach; j++) for (let i = -31; i < 31; i++) if (api.grid.isBeach({ i, j }) && !api.grid.buildingAt({ i, j })) { beach = { i, j }; break; }
    if (!beach) return null;
    api.frameAt(beach.i + 0.5, beach.j + 0.5, 7);
    api.camera.beta = 0.7;
    const on = await api.brightness(440, 260, 400, 200);
    api.setCaustics(false);
    const off = await api.brightness(440, 260, 400, 200);
    api.setCaustics(true);
    return { beach, on, off, phase: api.sim.phase };
  });
  await page.screenshot({ path: "shots/b2-caustics.png" });
  console.log("B2 caustics:", JSON.stringify(b2));
  assert(b2 && b2.on > b2.off + 0.5, "caustics brighten the shallows");

  // Rotation: a hut placed by a walkway faces it; a smokehouse given a quarter turn stands on end; R turns the ghost.
  const rotation = await page.evaluate(() => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    const grid = api.grid;
    const open = (skip: { i: number; j: number }[]) => {
      for (let i = -30; i < 30; i++) for (let j = -30; j < 30; j++) {
        if (skip.some(s => Math.abs(s.i - i) < 4 && Math.abs(s.j - j) < 4)) continue;
        const cells = [{ i, j }, { i: i + 1, j }, { i: i - 1, j }, { i, j: j + 1 }, { i, j: j - 1 }, { i: i + 1, j: j + 1 }, { i: i + 1, j: j - 1 }];
        if (cells.every(c => grid.classAt(c) === "flat" && !grid.buildingAt(c)) && !grid.onIsle(cells)) return { i, j };
      }
      return null;
    };
    api.grant(2000, 0, 0);
    const a = open([])!;
    api.place("walkway", a.i, a.j + 1);
    const hut = api.place("hut", a.i, a.j);
    const b = open([a])!;
    const shed = api.place("smokehouse", b.i, b.j, 1);
    // R on the ghost: hover a third spot with the hut tool, press R twice, read the ghost's turn from the next placement.
    const c = open([a, b])!;
    api.placement.setTool("hut");
    api.placement.hover = c;
    api.placement.rotate(); api.placement.rotate();
    const turned = api.placement.place(c);
    api.frameAt(a.i + 0.5, a.j + 0.5, 6, -0.6, 1.0);
    return { hutRot: hut?.rot, shedRot: shed?.rot, shedCells: shed?.cells ?? [], turnedRot: turned?.rot, hint: api.view.hint() };
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: "shots/rotation.png" });
  console.log("Rotation:", JSON.stringify(rotation));
  assert(rotation.hutRot === 2, "a hut placed south of a walkway faces north to it");
  assert(rotation.shedRot === 1 && rotation.shedCells.length === 2 && rotation.shedCells[0].i === rotation.shedCells[1].i, "a quarter turn stands the smokehouse on end");
  assert(rotation.turnedRot === 2, "R twice turns the ghost half round");

  // Quality presets: the first launch's probe chose one; each preset sets what it says; Low drops the gulls and
  // halves the walkers; the choice survives a reload (checked in M1 below).
  const quality = await page.evaluate(() => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    const first = api.view.quality();
    api.setQuality("low");
    api.tickSeconds(0.1);
    const low = { ...api.view.quality(), gullsShown: api.view.gulls() };
    api.setQuality("high");
    api.tickSeconds(0.1);
    const high = { ...api.view.quality(), gullsShown: api.view.gulls() };
    api.setQuality("medium");
    const medium = api.view.quality();
    return { first, low, high, medium };
  });
  console.log("Quality:", JSON.stringify(quality));
  assert(quality.first.quality === "high" && !quality.first.probing, "the remembered preset (this context's first launch chose it) is High");
  assert(!quality.low.bloom && !quality.low.reflections && !quality.low.caustics && quality.low.walkersCap === 100 && !quality.low.gulls && quality.low.gullsShown === 0, "Low: no bloom, reflections, caustics, gulls; half the walkers");
  assert(quality.high.bloom && quality.high.reflections && quality.high.caustics && quality.high.walkersCap === 200 && quality.high.gulls && quality.high.gullsShown > 0, "High: everything on");
  assert(quality.medium.bloom && !quality.medium.reflections && quality.medium.caustics, "Medium: High without reflections");
  // The first-launch probe itself: forget the preset, reload, and within a few seconds the frame-rate probe has
  // chosen one (High on this GPU) and said so.
  await page.evaluate(() => { localStorage.removeItem("tidewater.quality"); });
  await page.reload();
  await waitReady(page);
  const probing = await page.evaluate(() => (window as unknown as { __tidewater: Api }).__tidewater.view.quality());
  await page.waitForTimeout(3600);
  const probed = await page.evaluate(() => { const api = (window as unknown as { __tidewater: Api }).__tidewater; return { ...api.view.quality(), stored: localStorage.getItem("tidewater.quality"), log: api.sim.log.slice(-3) }; });
  console.log("Quality probe:", JSON.stringify({ probing: probing.probing, note: probed.note, quality: probed.quality, stored: probed.stored }));
  assert(probing.probing && probing.quality === "high", "with nothing remembered the launch starts at High and probes");
  assert(!probed.probing && probed.quality === "high" && /Chosen at first launch: High \(\d+ fps measured\)/.test(probed.note) && probed.stored === "high", "the probe chose High on this GPU and remembered it");
  assert(probed.log.some((m: string) => m.startsWith("Quality set to High")), "the choice was logged");
  await page.evaluate(() => (window as unknown as { __tidewater: Api }).__tidewater.setQuality("medium"));

  // Playtest log (Session B task 5): switched on in the Town menu, it records placements, removals, warnings,
  // hints, walkthrough steps and a sample per cycle; "Export playtest log" downloads JSON with the notes in it.
  await page.evaluate(() => (window as unknown as { __tidewater: Api }).__tidewater.menu(true));
  await page.click("#menu .playtest-on");
  await page.fill("#menu .playtest-notes", "monkey notes");
  await page.keyboard.press("Escape");
  const logged = await page.evaluate(() => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    const grid = api.grid;
    let c: { i: number; j: number } | null = null;
    for (let i = -30; i < 30 && !c; i++) for (let j = -30; j < 30 && !c; j++) if (grid.classAt({ i, j }) === "flat" && !grid.buildingAt({ i, j }) && !grid.onIsle([{ i, j }])) c = { i, j };
    const w = api.place("walkway", c!.i, c!.j);
    api.remove(c!.i, c!.j);
    api.blockerAt("harbor", c!.i, c!.j); // a blocker hint
    api.advance(1);
    return { enabled: api.playtest.enabled, placed: !!w, exported: api.playtest.export() };
  });
  await page.evaluate(() => (window as unknown as { __tidewater: Api }).__tidewater.menu(true));
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 10_000 }), page.click("#menu .playtest-export")]);
  const downloaded = JSON.parse(await (await import("node:fs/promises")).readFile((await download.path())!, "utf8")) as { version: number; notes: string; events: { type: string }[]; samples: unknown[]; summary: Record<string, number> };
  await page.evaluate(() => { const api = (window as unknown as { __tidewater: Api }).__tidewater; api.playtest.enable(false); api.menu(false); });
  console.log("Playtest log:", JSON.stringify({ enabled: logged.enabled, placed: logged.placed, file: download.suggestedFilename(), summary: downloaded.summary, notes: downloaded.notes, types: [...new Set(downloaded.events.map(e => e.type))] }));
  assert(logged.enabled && logged.placed, "the menu switch turned the log on");
  assert(/^tidewater-playtest-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}\.json$/.test(download.suggestedFilename()), "the export downloads as a dated JSON file");
  assert(downloaded.version === 1 && downloaded.notes === "monkey notes", "the export carries the version and the notes");
  assert(downloaded.summary.placements >= 1 && downloaded.summary.removals >= 1 && downloaded.summary.cycles >= 1 && downloaded.events.some(e => e.type === "step"), "placements, removals, a cycle sample and the walkthrough step are in the export");

  // M1: save, reload the page, every building is back and the clock kept its place.
  const before = await page.evaluate(() => { const api = (window as unknown as { __tidewater: Api }).__tidewater; api.save(); return { n: Object.keys(api.sim.buildings).length, cycle: api.sim.tide.cycle, money: api.sim.resources.money, chunks: api.view.chunks() }; });
  await page.reload();
  await waitReady(page);
  const after = await page.evaluate(() => { const api = (window as unknown as { __tidewater: Api }).__tidewater; return { n: Object.keys(api.sim.buildings).length, cycle: api.sim.tide.cycle, money: api.sim.resources.money, chunks: api.view.chunks(), meshes: api.scene.meshes.filter(m => m.name.startsWith("chunk:")).length, quality: api.view.quality().quality }; });
  console.log("M1:", JSON.stringify({ before, after }));
  assert(after.n === before.n && before.n >= 5, "all buildings present after reload");
  assert(after.cycle === before.cycle && after.money === before.money, "ledger restored");
  assert(after.quality === "medium", "the quality preset is remembered across a reload");
  await page.evaluate(() => (window as unknown as { __tidewater: Api }).__tidewater.setQuality("high"));
  assert(after.chunks === before.chunks && after.meshes === after.chunks && after.chunks > 0 && after.chunks <= 64, "view rebuilt one merged mesh per chunk");
  await page.screenshot({ path: "shots/m1.png" });

  // Task 4: the Town menu's seed field starts a town on another island; Random fills the field; the autosave
  // carries the island through a reload; seed 0 is the original island again.
  const t4before = await page.evaluate(() => { const api = (window as unknown as { __tidewater: Api }).__tidewater; api.menu(true); return { h: api.terrainHeight(0.5, 0.5), seedShown: (document.querySelector("#menu .seed") as HTMLInputElement).value }; });
  await page.click("#menu .random");
  const randomValue = await page.inputValue("#menu .seed");
  await page.fill("#menu .seed", "7");
  await page.click("#menu .new");
  await page.waitForTimeout(300);
  const t4 = await page.evaluate(() => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    const hut = Object.values(api.sim.buildings)[0];
    return { menuOpen: !document.getElementById("menu")!.hidden, seed: api.sim.world.seed, island: api.view.island(), buildings: Object.keys(api.sim.buildings).length, hutClass: hut ? api.grid.classAt(hut.cells[0]) : null, h: api.terrainHeight(0.5, 0.5), trees: api.sim.trees.length, log: api.sim.log.slice(-2) };
  });
  await page.evaluate(() => { const api = (window as unknown as { __tidewater: Api }).__tidewater; api.frameTown(30); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: "shots/t4-island7.png" });
  await page.evaluate(() => (window as unknown as { __tidewater: Api }).__tidewater.save());
  await page.reload();
  await waitReady(page);
  const t4after = await page.evaluate(() => { const api = (window as unknown as { __tidewater: Api }).__tidewater; return { seed: api.sim.world.seed, h: api.terrainHeight(0.5, 0.5) }; });
  await page.evaluate(() => (window as unknown as { __tidewater: Api }).__tidewater.newTown());
  const t4zero = await page.evaluate(() => { const api = (window as unknown as { __tidewater: Api }).__tidewater; return { seed: api.sim.world.seed, h: api.terrainHeight(0.5, 0.5) }; });
  console.log("T4 islands:", JSON.stringify({ t4before, randomValue, t4, t4after, t4zero }));
  assert(t4before.seedShown === "0" && /^[1-9]\d*$/.test(randomValue), "seed field shows the current island and Random fills a positive seed");
  assert(!t4.menuOpen && t4.seed === 7 && t4.island.seed === 7 && t4.island.stats.flats >= 400, "new town on island 7, valid");
  assert(t4.buildings === 1 && t4.hutClass === "flat" && t4.trees > 0, "the starting hut stands on island 7's flats");
  assert(Math.abs(t4.h - t4before.h) > 0.05, "the rendered ground changed with the island");
  assert(t4after.seed === 7 && Math.abs(t4after.h - t4.h) < 1e-6, "the island survives a reload");
  assert(t4zero.seed === 0 && Math.abs(t4zero.h - t4before.h) < 1e-6, "seed 0 is the original island again");

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
