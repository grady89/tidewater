// Headless smoke scenario. Starts the Vite dev server in-process, drives the game through window.__tidewater in
// headless Chrome, asserts, and writes screenshots to shots/. Run with `npm run smoke` (Node 24 strips the types).
import { chromium } from "playwright";
import type { Page } from "playwright";
import { createServer } from "vite";

const PORT = 5181;

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error("smoke assertion failed: " + msg);
}

import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TidewaterApi as Api } from "../src/main";
import type { Building, Cell } from "../src/sim/state";
async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as unknown as { __tidewater?: { ready: boolean } }).__tidewater?.ready === true, null, { timeout: 30_000 });
}
/** After a reload the game is up in the World (docs/globe): ready, and lit at noon so the shots are deterministic. */
async function waitReloaded(page: Page): Promise<void> {
  await waitReady(page);
  await page.evaluate(() => (window as unknown as { __tidewater: Api }).__tidewater.world.setClock(11));
}
/** Cut from the World into the active sector's island (what the island checks expect); returns the milliseconds it took. */
async function enterActive(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    const f = api.world.active();
    if (f === null) throw new Error("no active sector to enter");
    const t0 = performance.now();
    if (!await api.enterSector(f, { instant: true })) throw new Error("could not enter sector " + f);
    return performance.now() - t0;
  });
}

const server = await createServer({ server: { port: PORT, strictPort: true }, logLevel: "error" });
await server.listen();

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  // Headless Chrome uses the real GPU with the blocklist ignored (verified: ANGLE D3D11 on the RTX 4060).
  // gc() is exposed for the World's heap check.
  args: ["--ignore-gpu-blocklist", "--js-flags=--expose-gc"],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(m.text()); });
  page.on("response", r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  page.on("dialog", d => { errors.push("native dialog: " + d.message()); void d.dismiss(); }); // every dialog is in-page now

  await page.goto(`http://localhost:${PORT}/`);
  await waitReady(page);
  // The World (docs/globe): a fresh context launches into the globe with no towns, the pre-lit face's card open
  // in the new-sector state. Create a sea, dive into it, and every island check below runs on that island.
  const launch = await page.evaluate(() => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    api.world.setClock(11); // noon, so the World's light is the same in every run
    return { mode: api.mode, built: api.world.faces().filter(m => m).length, active: api.world.active(), card: api.world.shownCard(), entranceDone: api.world.entranceDone(), title: document.querySelector("#world h1")?.textContent, worldShown: !document.getElementById("world")!.hidden, hudHidden: getComputedStyle(document.getElementById("hud")!).display === "none", bootMs: api.bootMs, draws: api.world.drawCalls(), reduced: api.world.reducedMotion() };
  });
  console.log("World launch:", JSON.stringify(launch));
  assert(launch.mode === "world" && launch.built === 0 && launch.active === null && launch.worldShown && launch.hudHidden && launch.title === "Tiny Tides", "a fresh context launches into an empty World with the island's HUD hidden");
  assert(launch.card === null && !launch.entranceDone, "the entrance is playing and the card waits for it");
  await page.waitForFunction(() => (window as unknown as { __tidewater: Api }).__tidewater.world.entranceDone(), null, { timeout: 10_000 });
  await page.waitForTimeout(300);
  const surfaced = await page.evaluate(() => { const api = (window as unknown as { __tidewater: Api }).__tidewater; return { card: api.world.shownCard(), cardText: document.querySelector("#world .world-card")?.textContent?.replace(/\s+/g, " ").trim() ?? "" }; });
  assert(surfaced.card === 1 && /Uncharted sea · Temperate/.test(surfaced.cardText) && /Begin/.test(surfaced.cardText), "after the entrance the pre-lit face's new-sector card is open");
  await page.screenshot({ path: "shots/globe/world-first-launch.png" });
  const dive = await page.evaluate(async () => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    const meta = api.newSector(1, 0, "Smoke");
    const minis = api.world.miniatures().filter(m => m.built);
    const t0 = performance.now();
    const ok = await api.enterSector(1);
    return { meta: { face: meta.face, name: meta.name, seed: meta.seed, buildings: meta.buildings }, minis, ok, ms: performance.now() - t0, mode: api.mode, active: api.world.active(), pose: api.world.pose(), cam: api.view.camera(), buildings: Object.keys(api.sim.buildings).length, hudShown: getComputedStyle(document.getElementById("hud")!).display !== "none", worldHidden: document.getElementById("world")!.hidden };
  });
  console.log("World dive:", JSON.stringify(dive));
  assert(dive.meta.face === 1 && dive.meta.name === "Smoke" && dive.meta.seed === 0 && dive.meta.buildings === 1, "newSector wrote a fresh town onto face 1");
  assert(dive.minis.length === 1 && dive.minis[0].face === 1 && dive.minis[0].roofs === 1, "the face's miniature carries the starting hut's roof");
  assert(dive.ok && dive.mode === "island" && dive.active === 1 && dive.ms >= 1000 && dive.ms < 6000 && dive.pose.phase === "away", "the dive flew for ~1.4 s and landed on the island");
  assert(Math.abs(dive.cam.dist - 22) < 0.5 && Math.abs(dive.cam.yaw + 0.8) < 0.01 && dive.buildings === 1 && dive.hudShown && dive.worldHidden, "the island is up at the town framing with its HUD");
  await page.waitForTimeout(400);
  await page.screenshot({ path: "shots/globe/island-after-dive.png" });
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
    // Biomes: level 2 wants two foods, level 3 three and a foreign luxury (what the company carries).
    // The market sells any food above the reserve at 30 a cycle, so the imported kinds are topped up half way.
    api.grantGood("shellfish", 100); api.grantGood("rice", 100); api.grantGood("coffee", 10);
    api.advance(4);
    api.grantGood("shellfish", 100); api.grantGood("rice", 100);
    api.advance(4);
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
  // What stands at the save is what must come back (an oyster bed can die between the build and the save).
  const savedN = await page.evaluate(() => { const api = (window as unknown as { __tidewater: Api }).__tidewater; api.save(); return Object.keys(api.sim.buildings).length; });
  const t0 = Date.now();
  await page.reload();
  await waitReloaded(page);
  const loadMs = Date.now() - t0;
  const bigLoaded = await page.evaluate(() => { const api = (window as unknown as { __tidewater: Api }).__tidewater; return { n: Object.keys(api.sim.buildings).length, bootMs: api.bootMs, mode: api.mode, active: api.world.active(), roofs: api.world.miniatures().filter(m => m.built).map(m => m.roofs) }; });
  const enterMs = await enterActive(page);
  console.log(`M12 reload: ${loadMs} ms wall to the World (${bigLoaded.bootMs.toFixed(0)} ms boot, roofs on the face: ${bigLoaded.roofs}), ${enterMs.toFixed(0)} ms into the island, ${bigLoaded.n} buildings`);
  assert(bigLoaded.n === savedN && savedN >= 290, "big town survived the reload");
  assert(loadMs < 2000, "a 300-building town loads in under 2 s");
  assert(bigLoaded.mode === "world" && bigLoaded.active === 1 && bigLoaded.roofs.length === 1 && bigLoaded.roofs[0] > 50, "the reload lands in the World with the big town's roofs on its face");
  assert(enterMs < 2000, "the cut into the big town takes under 2 s");

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
    api.setQuality("high"); // the first-launch probe may have picked Low on a loaded machine, and Low turns caustics off
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
    return { beach, on, off, phase: api.sim.phase, day: api.view.sky().day, dusk: api.view.dusk(), cycle: api.sim.tide.cycle, time: api.sim.time };
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
  await page.evaluate(() => { const api = (window as unknown as { __tidewater: Api }).__tidewater; api.setQuality("medium"); api.world.setClock(11); });
  await enterActive(page);

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
  await waitReloaded(page);
  await enterActive(page);
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
  const newTownAsk = (await page.textContent("#dialog .dialog-message")) ?? ""; // the in-page confirm (no window.confirm)
  await page.click("#dialog .dialog-ok");
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
  await waitReloaded(page);
  await enterActive(page);
  const t4after = await page.evaluate(() => { const api = (window as unknown as { __tidewater: Api }).__tidewater; return { seed: api.sim.world.seed, h: api.terrainHeight(0.5, 0.5) }; });
  await page.evaluate(() => (window as unknown as { __tidewater: Api }).__tidewater.newTown());
  const t4zero = await page.evaluate(() => { const api = (window as unknown as { __tidewater: Api }).__tidewater; return { seed: api.sim.world.seed, h: api.terrainHeight(0.5, 0.5) }; });
  console.log("T4 islands:", JSON.stringify({ t4before, randomValue, newTownAsk, t4, t4after, t4zero }));
  assert(t4before.seedShown === "0" && /^[1-9]\d*$/.test(randomValue), "seed field shows the current island and Random fills a positive seed");
  assert(/^Start a new town on island 7\?/.test(newTownAsk), "New town asks through the in-page confirm");
  assert(!t4.menuOpen && t4.seed === 7 && t4.island.seed === 7 && t4.island.stats.flats >= 400, "new town on island 7, valid");
  assert(t4.buildings === 1 && t4.hutClass === "flat" && t4.trees > 0, "the starting hut stands on island 7's flats");
  assert(Math.abs(t4.h - t4before.h) > 0.05, "the rendered ground changed with the island");
  assert(t4after.seed === 7 && Math.abs(t4after.h - t4.h) < 1e-6, "the island survives a reload");
  assert(t4zero.seed === 0 && Math.abs(t4zero.h - t4before.h) < 1e-6, "seed 0 is the original island again");

  // ---- Biomes (docs/biomes): the Fjord and the Atoll beside Tidewater ----
  // Each coast: a sector of its own, the starter town positive over four cycles, every unique kind producing, its
  // hazard and its moment forced through the console API and seen by the view, and shots by day and night.
  for (const coast of [{ id: "fjord" as const, face: 0, seed: 2 }, { id: "atoll" as const, face: 6, seed: 2 }]) {
    const founded = await page.evaluate(async ({ id, face, seed }) => {
      const api = (window as unknown as { __tidewater: Api }).__tidewater;
      const url = "/test/scenario.ts";
      const sc = (await import(url)) as typeof import("./scenario");
      await api.returnToWorld({ instant: true });
      const meta = api.newSector(face, seed, `${id} smoke`, id);
      const ok = await api.enterSector(face, { instant: true });
      const s = api.sim, grid = api.grid;
      let town: ReturnType<typeof sc.starterTown>;
      try { town = sc.starterTown(s, grid); } catch (e) {
        const hut = Object.values(s.buildings)[0];
        const site = sc.pierSite(grid, hut.cells[0]);
        const fp = grid.footprint("pier", site);
        throw new Error(`${(e as Error).message} · money ${s.resources.money} biome ${s.world.biome} seed ${s.world.seed} hut ${JSON.stringify(hut.cells[0])} site ${JSON.stringify(site)} fp ${JSON.stringify(fp)} canPlace ${fp ? grid.canPlace("pier", fp) : null} inCatalog ${grid.inCatalog("pier")} classes ${JSON.stringify(fp?.map(c => grid.classAt(c)))} scale ${grid.tides.scale} island ${grid.island.seed} buildings ${Object.keys(s.buildings).length}`);
      }
      const money0 = s.resources.money; // after the starter is paid for
      api.advance(4);
      const money4 = s.resources.money;
      const built = sc.biomeTown(s, grid, 4000, town); // the starter is already down: only the coast's own kinds go up
      const bio = api.view.biome();
      return { meta: { biome: meta.biome, seed: meta.seed }, ok, biome: s.world.biome, tide: s.tide.scale, money0, money4, spent: money0 - money4, huts: town.huts.length, extras: Object.keys(built.extras), look: bio.look, boat: bio.boat, hat: bio.hat, house: bio.house, palms: bio.palms, catalogHasOyster: grid.inCatalog("oysterBed"), goodsShown: [...document.querySelectorAll("#resources .res")].map(e => e.getAttribute("data-res")) };
    }, coast);
    console.log(`Biome ${coast.id} founded:`, JSON.stringify(founded));
    assert(founded.ok && founded.meta.biome === coast.id && founded.biome === coast.id && founded.look === coast.id, `${coast.id}: the sector carries its coast and the view wears its look`);
    assert(founded.money4 > founded.money0 && founded.spent < 0, `${coast.id}: the starter town nets positive money over four cycles`);
    assert(!founded.catalogHasOyster && founded.extras.length >= 3, `${coast.id}: the catalog is the coast's own and its kinds went up: ${founded.extras.join(",")}`);
    assert(founded.goodsShown.includes(coast.id === "fjord" ? "stockfish" : "coconut") && !founded.goodsShown.includes("shellfish"), `${coast.id}: the resource bar shows the coast's foods, not Tidewater's shellfish`);
    if (coast.id === "fjord") {
      assert(founded.tide === 1.6 && founded.boat === "longboat" && founded.hat === "hood" && founded.house === "stave" && founded.palms === "pine", "the Fjord's tide, longboats, hoods, stave houses and pines");
      const fj = await page.evaluate(async () => {
        const api = (window as unknown as { __tidewater: Api }).__tidewater;
        const s = api.sim, grid = api.grid;
        const kinds = (k: string) => (Object.values(s.buildings) as Building[]).filter(b => b.kind === k);
        // Hands for every job (a few more houses: the mine is the farthest work and nearest-first fills it last), fish and salt for the racks, a boat for the station.
        const url2 = "/test/scenario.ts";
        const sc2 = (await import(url2)) as typeof import("./scenario");
        api.grant(2000);
        sc2.growStreet(s, grid, 3);
        sc2.placeByWalkway(s, grid, "house", 4);
        for (const b of Object.values(s.buildings) as Building[]) if (b.residents !== undefined && ["hut", "house"].includes(b.kind)) b.residents = grid.capacityOf(b);
        for (const b of kinds("pier")) b.boats = 0;
        api.grantGood("fish", 80); api.grantGood("salt", 30);
        for (const b of kinds("whalingStation")) b.boats = 1;
        api.advance(2);
        const racks = kinds("stockfishRacks")[0], mine = kinds("ironMine")[0], ice = kinds("iceHouse")[0], station = kinds("whalingStation")[0];
        const produced = { racks: racks?.output ?? -1, mine: mine?.output ?? -1, mineReached: mine?.reached, mineWorkers: mine?.workers, ice: !!ice, stockfish: s.resources.stockfish, iron: s.resources.iron, stationWorkers: station?.workers ?? -1 };
        // Whale season: the station runs, spouts rise, a horn sounds; then the ice, then a storm's avalanche onto a slope hut.
        const season = api.forceBiome("whaleSeason");
        await new Promise(r => setTimeout(r, 700));
        let whales = 0;
        for (let k = 0; k < 6; k++) { whales = Math.max(whales, api.view.fauna().whales); await new Promise(r => setTimeout(r, 250)); }
        api.advance(1);
        const oil = s.resources.whaleOil, stationOut = station?.output ?? -1;
        const ice0 = api.forceBiome("seaIce");
        await new Promise(r => setTimeout(r, 300));
        const iceView = api.view.biome().ice, iceLabel = document.querySelector("#hud .tide-event")?.textContent ?? "";
        // A hut on the treed slope, then storms until the snow comes down.
        let slopeHut = null;
        const sites = grid.island.trees;
        for (let i = -30; i < 30 && !slopeHut; i++) for (let j = -30; j < 30 && !slopeHut; j++) {
          const c = { i, j };
          if (grid.classAt(c) !== "high" || grid.heightAt(c) < 2.0 || grid.heightAt(c) > 3.6 || grid.buildingAt(c)) continue;
          if (!sites.some(t => Math.abs(t.cell.i - i) <= 3 && Math.abs(t.cell.j - j) <= 3 && grid.heightAt(t.cell) > grid.heightAt(c) + 1.0)) continue;
          slopeHut = api.place("hut", i, j);
        }
        let avalanche = null;
        for (let k = 0; k < 6 && !(slopeHut && slopeHut.damaged); k++) avalanche = api.forceBiome("avalanche");
        api.frameTown(26);
        return { produced, season: { cycle: season.cycle, whaleSeason: season.biomeState.whaleSeason }, whales, oil, stationOut, horns: api.view.audio().horns ?? 0, ice: { seaIce: ice0.biomeState.seaIce, view: iceView, label: iceLabel }, slopeHut: !!slopeHut, buried: !!slopeHut?.damaged, avalanches: avalanche?.biomeState.avalanches ?? 0, aurora: api.view.biome().aurora, fauna: api.view.fauna() };
      });
      console.log("Biome fjord:", JSON.stringify(fj));
      assert(fj.produced.racks > 0 && fj.produced.stockfish > 0 && fj.produced.mine > 0 && fj.produced.iron > 0 && fj.produced.ice, "Fjord: the racks dried fish and the mine dug iron; the ice house stands");
      assert(fj.season.whaleSeason === 1 && fj.oil > 0, "Fjord: whale season came and the station made whale oil");
      assert(fj.whales > 0, "Fjord: whales surface in season");
      assert(fj.ice.seaIce === 1 && fj.ice.view > 0.5 && /frozen/.test(fj.ice.label), "Fjord: sea ice: the water whitens and the tide clock says so");
      assert(fj.slopeHut && fj.buried && fj.avalanches > 0, "Fjord: a storm's avalanche buried the hut on the slope");
      assert(fj.aurora === 1 && (fj.fauna.seals + fj.fauna.puffins) > 0, "Fjord: the aurora is on and seals or puffins are about");
    } else {
      assert(founded.tide === 0.6 && founded.boat === "outrigger" && founded.hat === "straw" && founded.house === "round" && founded.palms === "palm", "the Atoll's tide, outriggers, straw hats, round huts and palms");
      const at = await page.evaluate(async () => {
        const api = (window as unknown as { __tidewater: Api }).__tidewater;
        const s = api.sim, grid = api.grid;
        const kinds = (k: string) => (Object.values(s.buildings) as Building[]).filter(b => b.kind === k);
        for (const b of Object.values(s.buildings) as Building[]) if (["hut", "house"].includes(b.kind)) b.residents = grid.capacityOf(b);
        for (const b of kinds("pier")) b.boats = 0;
        // Lanterns on every walkway for the hatching to darken.
        let lanterns = 0;
        for (const w of [...kinds("walkway"), ...kinds("raisedWalkway")]) if (api.place("lanternPost", w.cells[0].i, w.cells[0].j)) lanterns++;
        api.advance(3);
        const grove = kinds("coconutGrove")[0], platform = kinds("divePlatform")[0], house = kinds("pearlHouse")[0], nursery = kinds("reefNursery")[0];
        const palmsNear = grove ? grid.island.trees.filter(t => grove.cells.some(c => Math.abs(t.cell.i - c.i) <= 6 && Math.abs(t.cell.j - c.j) <= 6)).length : 0;
        const produced = { grove: grove?.output ?? -1, palmsNear, coconut: s.resources.coconut, platformWorkers: platform?.workers ?? -1, pearls: s.resources.pearls, house: !!house, nursery: !!nursery, lanterns };
        // The cyclone, the reef bleaching and recovering, the turtles' night.
        const storm = api.forceBiome("cyclone");
        await new Promise(r => setTimeout(r, 400));
        const cyclone = { log: storm.log, storm: storm.storm, swell: api.view.stormMix() };
        const bleach = api.forceBiome("bleach");
        await new Promise(r => setTimeout(r, 300));
        const bleached = { count: bleach.biomeState.bleached, view: api.view.biome().bleached, shoals: api.view.fauna().shoals };
        const hatch = api.forceBiome("hatching");
        await new Promise(r => setTimeout(r, 500));
        const hatching = { on: api.view.biome().hatching, lanterns: api.view.biome().lanterns, bonus: hatch.biomeState.turtleBonus, turtles: api.view.fauna().turtles, label: document.querySelector("#hud .tide-event")?.textContent ?? "" };
        api.frameTown(26);
        return { produced, cyclone, bleached, hatching, fauna: api.view.fauna() };
      });
      console.log("Biome atoll:", JSON.stringify(at));
      assert((at.produced.coconut > 0 || at.produced.palmsNear === 0) && at.produced.pearls > 0 && at.produced.house && at.produced.nursery, "Atoll: the grove gathered coconuts (where palms stand near it), the divers brought up pearls, the pearl house and nursery stand");
      assert(at.cyclone.storm && at.cyclone.log.some(m => /cyclone/.test(m)), "Atoll: the storm is a cyclone");
      assert(at.bleached.count > 0 && at.bleached.view > 0, "Atoll: foul water bleached the lagoon");
      assert(at.hatching.on && at.hatching.lanterns.dark > 0 && at.hatching.bonus > 0 && /hatching/i.test(at.hatching.label), "Atoll: the hatching darkens the beach lanterns and earns the tourism bonus");
      assert(at.hatching.turtles > 0 && (at.fauna.shoals + at.fauna.gulls) >= 0, "Atoll: turtles cross the beach on the hatching night");
    }
    // Shots: noon and midnight, wide and close.
    for (const [when, target] of [["day", 0.25], ["night", 0.75]] as const) {
      await page.evaluate((t: number) => { const api = (window as unknown as { __tidewater: Api }).__tidewater; api.tickSeconds(t * 2 * 120 - (api.sim.time % (2 * 120)) + 2 * 120); api.frameTown(26); }, target);
      await page.waitForTimeout(500);
      await page.screenshot({ path: `shots/biomes/${coast.id}-${when}-wide.png` });
      await page.evaluate(() => (window as unknown as { __tidewater: Api }).__tidewater.frameTown(12));
      await page.waitForTimeout(300);
      await page.screenshot({ path: `shots/biomes/${coast.id}-${when}-close.png` });
    }
    // Back to Tidewater's sea, the coast's sector cleared so the World checks below count what they expect.
    await page.evaluate(async (face: number) => { const api = (window as unknown as { __tidewater: Api }).__tidewater; await api.returnToWorld({ instant: true }); api.clearSector(face); await api.enterSector(1, { instant: true }); }, coast.face);
  }
  await page.evaluate(() => (window as unknown as { __tidewater: Api }).__tidewater.newTown());

  // ---- The World (docs/globe) ----
  // Back up to the globe: the town's roofs on its face, the card with its counts, the shots wide and narrow.
  const back = await page.evaluate(async () => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    const grid = api.grid;
    let placed = null;
    for (let i = -30; i < 30 && !placed; i++) for (let j = -30; j < 30 && !placed; j++) { const c = { i, j }; if (grid.classAt(c) === "flat" && !grid.buildingAt(c) && !grid.onIsle([c]) && grid.neighbors(c).every(n => !grid.buildingAt(n))) placed = api.place("hut", i, j); }
    const t0 = performance.now();
    const ok = await api.returnToWorld();
    return { placed: !!placed, ok, ms: performance.now() - t0, mode: api.mode, pose: api.world.pose(), card: api.world.shownCard(), minis: api.world.miniatures().filter(m => m.built), meta: api.world.faces()[1], hudHidden: getComputedStyle(document.getElementById("hud")!).display === "none", globeY: api.world.globeY(), entranceDone: api.world.entranceDone() };
  });
  console.log("World return:", JSON.stringify(back));
  assert(back.placed && back.ok && back.mode === "world" && back.ms >= 1000 && back.hudHidden, "the return flew back up to the World");
  assert(back.globeY === 0 && back.entranceDone, "a dive taken during the entrance lands the globe first (it is not left half-risen)");
  assert(back.pose.camera === "orbit" && back.pose.phase === "idle" && back.card === 1, "the orbit camera is back with the sea's card open");
  assert(back.minis.length === 1 && back.minis[0].face === 1 && back.minis[0].roofs === 2 && back.meta?.buildings === 2 && back.meta?.name === "Smoke", "the miniature shows both roofs and the card counts them");
  await page.waitForTimeout(400);
  await page.screenshot({ path: "shots/globe/world-wide.png" });
  await page.setViewportSize({ width: 400, height: 800 });
  await page.waitForTimeout(400);
  const narrow = await page.evaluate(() => {
    const box = (sel: string) => { const r = document.querySelector(sel)!.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
    return { card: box("#world .world-card"), hint: box("#world .world-hint"), actions: box("#world .world-actions"), title: box("#world .world-title"), w: innerWidth, h: innerHeight };
  });
  console.log("World narrow:", JSON.stringify(narrow));
  assert(narrow.card.left >= 0 && narrow.card.right <= narrow.w && narrow.card.bottom <= narrow.hint.top && narrow.actions.bottom <= narrow.h && narrow.title.right <= narrow.w, "on a 400 px screen the card is a bottom sheet above the hint and the import button");
  await page.screenshot({ path: "shots/globe/world-narrow.png" });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(300);

  // The card's actions through the in-page dialogs: rename, export (a download), delete, import the download back.
  await page.click("#world .world-card .rename");
  const promptShown = await page.evaluate(() => ({ open: !document.getElementById("dialog")!.hidden, value: (document.querySelector("#dialog .dialog-input") as HTMLInputElement | null)?.value, focused: document.activeElement?.className }));
  await page.fill("#dialog .dialog-input", "Smoke Renamed");
  await page.keyboard.press("Enter");
  const renamed = await page.evaluate(() => { const api = (window as unknown as { __tidewater: Api }).__tidewater; return { name: api.world.faces()[1]?.name, cardName: document.querySelector("#world .card-name")?.textContent, dialogHidden: document.getElementById("dialog")!.hidden, mode: api.mode }; });
  console.log("World rename:", JSON.stringify({ promptShown, renamed }));
  assert(promptShown.open && promptShown.value === "Smoke" && promptShown.focused === "dialog-input", "Rename opens the in-page prompt, pre-filled and focused");
  assert(renamed.name === "Smoke Renamed" && renamed.cardName === "Smoke Renamed" && renamed.dialogHidden && renamed.mode === "world", "Enter renames the sea and closes the prompt without diving");
  const [exp] = await Promise.all([page.waitForEvent("download", { timeout: 10_000 }), page.click("#world .world-card .export")]);
  const expPath = (await exp.path())!;
  const expJson = JSON.parse(await readFile(expPath, "utf8")) as { version: number; meta: { name: string; buildings: number; seed: number }; state: { buildings: Record<string, unknown> } };
  console.log("World export:", JSON.stringify({ file: exp.suggestedFilename(), version: expJson.version, meta: expJson.meta }));
  assert(exp.suggestedFilename() === "tinytides-smoke-renamed.json" && expJson.version === 1 && expJson.meta.name === "Smoke Renamed" && Object.keys(expJson.state.buildings).length === 2, "Export downloads the sector record");
  await page.click("#world .world-card .delete");
  const deleteText = (await page.textContent("#dialog .dialog-message")) ?? "";
  await page.click("#dialog .dialog-cancel");
  const kept = await page.evaluate(() => (window as unknown as { __tidewater: Api }).__tidewater.world.faces()[1]?.name);
  await page.click("#world .world-card .delete");
  await page.click("#dialog .dialog-ok");
  const deleted = await page.evaluate(() => { const api = (window as unknown as { __tidewater: Api }).__tidewater; return { meta: api.world.faces()[1], active: api.world.active(), minis: api.world.miniatures().filter(m => m.built).length, level: api.world.miniatures()[1].level, card: document.querySelector("#world .world-card")?.textContent?.replace(/\s+/g, " ") ?? "" }; });
  console.log("World delete:", JSON.stringify({ deleteText, kept, deleted }));
  assert(/^Clear Smoke Renamed\?/.test(deleteText) && kept === "Smoke Renamed", "Delete asks first; Cancel keeps the sea");
  assert(deleted.meta === null && deleted.active === null && deleted.minis === 0 && deleted.level === 0 && /Uncharted sea/.test(deleted.card), "confirming clears the face back to uncharted sea");
  const badFile = join(tmpdir(), "tinytides-bad.json");
  await writeFile(badFile, JSON.stringify({ hello: "world" }));
  await page.setInputFiles('#world input[type="file"]', badFile);
  await page.waitForSelector("#dialog:not([hidden])", { timeout: 5000 });
  const badText = (await page.textContent("#dialog .dialog-message")) ?? "";
  await page.click("#dialog .dialog-ok");
  await page.setInputFiles('#world input[type="file"]', expPath);
  await page.waitForFunction(() => (window as unknown as { __tidewater: Api }).__tidewater.world.faces()[1] !== null, null, { timeout: 10_000 });
  const imported = await page.evaluate(() => { const api = (window as unknown as { __tidewater: Api }).__tidewater; const m = api.world.faces()[1]!; return { name: m.name, buildings: m.buildings, seed: m.seed, minis: api.world.miniatures().filter(x => x.built).map(x => ({ face: x.face, roofs: x.roofs })), notice: document.querySelector("#world .world-notice")?.textContent, card: api.world.shownCard(), built: api.world.faces().filter(x => x).length }; });
  console.log("World import:", JSON.stringify({ badText, imported }));
  assert(/isn't a Tiny Tides sea/.test(badText) && imported.built === 1, "a foreign file gets a notice and changes nothing");
  assert(imported.name === "Smoke Renamed" && imported.buildings === 2 && imported.seed === 0 && imported.minis.length === 1 && imported.minis[0].roofs === 2 && /imported/.test(imported.notice ?? "") && imported.card === 1, "Import puts the exported sea back on the shown face with its roofs");

  // Dialogs and flights: a dive is refused while a dialog is open; the fading World DOM is inert during the
  // flight; a confirm left open on the island is cancelled by the scene switch rather than applied later (the
  // monkey once confirmed "Clear the sea?" from the island of that very sea).
  await page.click("#world .world-card .delete");
  const refused = await page.evaluate(async () => { const api = (window as unknown as { __tidewater: Api }).__tidewater; return { dialog: !document.getElementById("dialog")!.hidden, entered: await api.enterSector(1), mode: api.mode }; });
  await page.click("#dialog .dialog-cancel");
  assert(refused.dialog && !refused.entered && refused.mode === "world", "a dive is refused while a dialog is open");
  const inert = await page.evaluate(async () => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    void api.enterSector(1);
    await new Promise(r => setTimeout(r, 400));
    const b = document.querySelector("#world .world-card .delete")!.getBoundingClientRect();
    const under = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
    return { flying: api.world.pose().phase, fading: document.getElementById("world")!.classList.contains("fading"), under: under?.tagName };
  });
  await page.waitForFunction(() => (window as unknown as { __tidewater: Api }).__tidewater.mode === "island", null, { timeout: 10_000 });
  assert(inert.flying === "flying" && inert.fading && inert.under === "CANVAS", "the World's buttons are inert while the dive flies: " + JSON.stringify(inert));
  await page.evaluate(() => (window as unknown as { __tidewater: Api }).__tidewater.menu(true));
  await page.click("#menu .new");
  const straddle = await page.evaluate(async () => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    const open = !document.getElementById("dialog")!.hidden;
    const n = Object.keys(api.sim.buildings).length;
    await api.returnToWorld({ instant: true });
    await new Promise(r => setTimeout(r, 100));
    return { open, closed: document.getElementById("dialog")!.hidden, n, after: Object.keys(api.sim.buildings).length, stored: api.world.faces()[1]?.buildings, mode: api.mode, card: api.world.shownCard() };
  });
  console.log("World dialogs:", JSON.stringify({ refused, inert, straddle }));
  assert(straddle.open && straddle.closed && straddle.after === straddle.n && straddle.stored === straddle.n && straddle.mode === "world" && straddle.card === 1, "a confirm left open on the island is cancelled by the return, not applied");

  // Twelve seas: fill every face, dive into each and come back, reload, and all twelve are still there.
  const twelve = await page.evaluate(async () => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    const t0 = performance.now();
    for (let f = 0; f < 12; f++) if (!api.world.faces()[f]) api.newSector(f, 100 + f, `Sea ${f}`);
    const createdMs = performance.now() - t0;
    const seeds: number[] = [];
    const t1 = performance.now();
    for (let f = 0; f < 12; f++) {
      if (!await api.enterSector(f, { instant: true })) throw new Error("could not enter face " + f);
      seeds.push(api.sim.world.seed);
      if (!await api.returnToWorld({ instant: true })) throw new Error("could not leave face " + f);
    }
    const keys = Object.keys(localStorage).filter(k => k.startsWith("tidewater.sector."));
    return { built: api.world.faces().filter(m => m).length, seeds, createdMs, roundTripsMs: performance.now() - t1, keys: keys.length, units: keys.reduce((n, k) => n + (localStorage.getItem(k)?.length ?? 0), 0), active: api.world.active() };
  });
  console.log("World twelve:", JSON.stringify(twelve));
  assert(twelve.built === 12 && twelve.seeds.every((s, f) => s === (f === 1 ? 0 : 100 + f)) && twelve.active === 11, "twelve seas, each entered and left with its own island");
  assert(twelve.keys === 25 && twelve.units < 2_600_000, "twelve sectors and metas (plus the active key) sit within the storage budget");
  await page.reload();
  await waitReloaded(page);
  await page.waitForFunction(() => (window as unknown as { __tidewater: Api }).__tidewater.world.entranceDone(), null, { timeout: 15_000 });
  const twelveBack = await page.evaluate(async () => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    let frames = 0;
    const obs = api.world.scene.onAfterRenderObservable.add(() => frames++);
    await new Promise(r => setTimeout(r, 3000));
    api.world.scene.onAfterRenderObservable.remove(obs);
    return { built: api.world.faces().filter(m => m).length, names: api.world.faces().map(m => m?.name ?? null), active: api.world.active(), card: api.world.shownCard(), minis: api.world.miniatures().filter(m => m.built).length, draws: api.world.drawCalls(), fps: frames / 3, bootMs: api.bootMs };
  });
  console.log("World twelve after reload:", JSON.stringify(twelveBack));
  assert(twelveBack.built === 12 && twelveBack.minis === 12 && twelveBack.names[1] === "Smoke Renamed" && twelveBack.names[7] === "Sea 7", "all twelve seas survived the reload with their miniatures");
  assert(twelveBack.active === 11 && twelveBack.card === 11, "the launch settled on the last-played sea with its card open");
  assert(twelveBack.draws <= 70, "draw calls in the World with twelve towns: " + twelveBack.draws);
  assert(twelveBack.fps >= 60, "60 fps in the World with twelve towns");
  await page.screenshot({ path: "shots/globe/world-twelve.png" });
  await page.evaluate(() => (window as unknown as { __tidewater: Api }).__tidewater.world.setClock(1.5));
  await page.waitForTimeout(300);
  await page.screenshot({ path: "shots/globe/world-night.png" });
  await page.evaluate(() => (window as unknown as { __tidewater: Api }).__tidewater.world.setClock(11));

  // Heap: twenty World → sea → World round trips across three seas leave the JS heap within 10 % after GC.
  const heap = await page.evaluate(async () => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    const w = window as unknown as { gc?: () => void };
    const mem = () => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? -1;
    const collect = async () => { for (let k = 0; k < 3; k++) { w.gc?.(); await new Promise(r => setTimeout(r, 150)); } };
    const trip = async (f: number) => { if (!await api.enterSector(f, { instant: true })) throw new Error("enter " + f); if (!await api.returnToWorld({ instant: true })) throw new Error("return " + f); };
    for (let k = 0; k < 3; k++) await trip(1 + k); // warm every cache first
    await collect();
    const before = mem();
    const t0 = performance.now();
    for (let k = 0; k < 20; k++) await trip(1 + k % 3);
    const ms = performance.now() - t0;
    await collect();
    const after = mem();
    return { gc: !!w.gc, before, after, growth: (after - before) / before, ms, mode: api.mode, worldMaterials: api.world.scene.materials.length, worldMeshes: api.world.scene.meshes.length, islandMeshes: api.scene.meshes.length, islandMaterials: api.scene.materials.length };
  });
  console.log("World heap:", JSON.stringify(heap));
  assert(heap.gc && heap.before > 0, "Chrome exposes gc() and performance.memory for the heap check");
  assert(heap.growth < 0.10, `the heap grew ${(heap.growth * 100).toFixed(1)} % over twenty round trips`);

  // Migration: an old-layout localStorage (autosave + a named slot, no sectors) lands on the World, once.
  const legacy = await page.evaluate(async () => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    await api.enterSector(2, { instant: true });
    const json = api.saveJson();
    const n = Object.keys(api.sim.buildings).length, seed = api.sim.world.seed;
    await api.returnToWorld({ instant: true });
    for (const k of Object.keys(localStorage)) if (k.startsWith("tidewater.sector")) localStorage.removeItem(k);
    localStorage.setItem("tidewater.autosave", json);
    localStorage.setItem("tidewater.slot.2", json);
    localStorage.setItem("tidewater.slot.2.meta", JSON.stringify({ name: "Old Harbour", savedAt: Date.now() - 3_600_000 }));
    return { n, seed };
  });
  await page.reload();
  await waitReloaded(page);
  await page.waitForFunction(() => (window as unknown as { __tidewater: Api }).__tidewater.world.entranceDone(), null, { timeout: 15_000 }); // the card opens after the entrance
  const migrated = await page.evaluate(() => { const api = (window as unknown as { __tidewater: Api }).__tidewater; const faces = api.world.faces(); return { moved: api.world.migrated(), names: faces.map(m => m?.name ?? null), active: api.world.active(), card: api.world.shownCard(), notice: document.querySelector("#world .world-notice")?.textContent, buildings: Object.keys(api.sim.buildings).length, seed: api.sim.world.seed, flag: localStorage.getItem("tidewater.sectors.migrated"), autosaveKept: !!localStorage.getItem("tidewater.autosave"), lastPlayed: faces[3]?.lastPlayed ?? 0, globeY: api.world.globeY() }; });
  console.log("World migration:", JSON.stringify({ legacy, migrated }));
  assert(migrated.moved.length === 2 && migrated.names[1] === "First Sea" && migrated.names[3] === "Old Harbour" && migrated.names.filter(n => n).length === 2, "the autosave became face 1 and slot 2 face 3, named");
  assert(migrated.active === 1 && migrated.card === 1 && migrated.buildings === legacy.n && migrated.seed === legacy.seed && migrated.globeY === 0, "the launch opens on the migrated autosave with the globe risen");
  assert(/2 towns moved onto the World: First Sea, Old Harbour/.test(migrated.notice ?? "") && migrated.flag === "1" && migrated.autosaveKept && Date.now() - migrated.lastPlayed > 3_000_000, "the notice says so; the old keys stay; the slot's date is kept");
  await page.reload();
  await waitReloaded(page);
  const again = await page.evaluate(() => { const api = (window as unknown as { __tidewater: Api }).__tidewater; return { moved: api.world.migrated(), noticeHidden: document.querySelector<HTMLElement>("#world .world-notice")!.hidden, built: api.world.faces().filter(m => m).length }; });
  assert(again.moved.length === 0 && again.noticeHidden && again.built === 2, "the migration runs once");

  // Reduced motion: the dive and the return are cuts.
  const reduced = await page.evaluate(async () => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    api.world.setReducedMotion(true);
    const t0 = performance.now();
    const dived = await api.enterSector(1);
    const dive = performance.now() - t0;
    const t1 = performance.now();
    const returned = await api.returnToWorld();
    const back = performance.now() - t1;
    const on = api.world.reducedMotion();
    api.world.setReducedMotion(null);
    return { on, dived, returned, dive, back, mode: api.mode, pose: api.world.pose(), off: api.world.reducedMotion() };
  });
  console.log("World reduced motion:", JSON.stringify(reduced));
  assert(reduced.on && reduced.dived && reduced.returned && reduced.dive < 800 && reduced.back < 800 && reduced.mode === "world" && reduced.pose.camera === "orbit" && !reduced.off, "with reduced motion the dive and the return are cuts");

  // Keyboard: Escape closes the card, arrows turn the globe, Enter opens the front face's card then dives, Escape
  // on the island (nothing open) returns.
  await page.keyboard.press("Escape");
  const kb0 = await page.evaluate(() => { const api = (window as unknown as { __tidewater: Api }).__tidewater; return { card: api.world.shownCard(), spin: api.world.spin(), front: api.world.front(), at: api.world.screenOf(1) }; });
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(500);
  const kb1 = await page.evaluate(() => { const api = (window as unknown as { __tidewater: Api }).__tidewater; return { card: api.world.shownCard(), spin: api.world.spin(), front: api.world.front(), at: api.world.screenOf(1) }; });
  // The angle between the two spins (ArrowRight turns the globe 0.4 rad about the camera's up; face 1 moves right).
  const spun = 2 * Math.acos(Math.min(1, Math.abs(kb0.spin.reduce((s, v, i) => s + v * kb1.spin[i], 0))));
  // A drag spins the same way: a rightward drag moves the front face right, a downward drag moves it down.
  const dragged = await page.evaluate(async () => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    api.world.lookAt(1);
    await new Promise(r => setTimeout(r, 50));
    const a = api.world.screenOf(1);
    api.world.drag(60, 0);
    await new Promise(r => setTimeout(r, 50));
    const b = api.world.screenOf(1);
    api.world.lookAt(1);
    await new Promise(r => setTimeout(r, 50));
    api.world.drag(0, 60);
    await new Promise(r => setTimeout(r, 50));
    const c = api.world.screenOf(1);
    api.world.lookAt(1);
    return { right: b.x - a.x, down: c.y - a.y };
  });
  await page.keyboard.press("Enter");
  const kb2 = await page.evaluate(() => { const api = (window as unknown as { __tidewater: Api }).__tidewater; return { card: api.world.shownCard(), front: api.world.front(), built: !!api.world.faces()[api.world.front()] }; });
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => (window as unknown as { __tidewater: Api }).__tidewater.mode === "island", null, { timeout: 10_000 });
  const kb3 = await page.evaluate(() => { const api = (window as unknown as { __tidewater: Api }).__tidewater; return { mode: api.mode, active: api.world.active(), menuOpen: !document.getElementById("menu")!.hidden }; });
  await page.keyboard.press("Escape");
  // The mode flips as the return starts; the card comes back when the flight has landed on the orbit.
  await page.waitForFunction(() => { const api = (window as unknown as { __tidewater: Api }).__tidewater; return api.mode === "world" && api.world.pose().camera === "orbit"; }, null, { timeout: 10_000 });
  const kb4 = await page.evaluate(() => { const api = (window as unknown as { __tidewater: Api }).__tidewater; return { mode: api.mode, card: api.world.shownCard() }; });
  console.log("World keyboard:", JSON.stringify({ kb0, kb1, spun, dragged, kb2, kb3, kb4 }));
  assert(kb0.card === null && Math.abs(spun - 0.4) < 0.02 && kb1.at.x > kb0.at.x + 20 && kb1.card === null, "Escape closes the card; ArrowRight turns the globe 0.4 rad, the front face moving right");
  assert(dragged.right > 20 && dragged.down > 20, "a drag takes the globe with the pointer: " + JSON.stringify(dragged));
  // Flinging the globe hard from the corners (Grady's bug: the spin drifted off unit length and became a scale,
  // putting the camera under the water) leaves it the same size, on the orbit camera at the same distance.
  for (let k = 0; k < 24; k++) {
    const x0 = k % 2 ? 40 : 1240, y0 = k % 4 < 2 ? 30 : 690, x1 = 640 + (k % 3 - 1) * 900, y1 = 360 + (k % 5 - 2) * 500;
    await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x1, y1, { steps: 2 }); await page.mouse.up();
    await page.waitForTimeout(25);
  }
  await page.waitForTimeout(1200);
  const flung = await page.evaluate(() => { const api = (window as unknown as { __tidewater: Api }).__tidewater; const c = api.world.scene.activeCamera!; return { scale: api.world.scale(), camera: c.name, dist: c.position.length(), pose: api.world.pose() }; });
  console.log("World fling:", JSON.stringify(flung));
  assert(Math.abs(flung.scale - 1) < 1e-3 && flung.camera === "worldCam" && Math.abs(flung.dist - 340) < 0.5, "hard flings leave the globe its size and the camera on its orbit");
  await page.evaluate(() => (window as unknown as { __tidewater: Api }).__tidewater.world.lookAt(1));
  await page.waitForTimeout(400);
  assert(kb2.card === kb1.front && kb2.built && kb3.mode === "island" && kb3.active === kb2.front && !kb3.menuOpen, "Enter opens the front face's card; Enter again dives into it");
  assert(kb4.mode === "world" && kb4.card === kb3.active, "Escape on the island returns to the World with the sea's card open");
  // Back onto the island for the frame-rate check.
  await enterActive(page);

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
