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
  assert(errors.length === 0, "no page errors: " + errors.join(" | "));
  console.log("smoke OK → shots/");
} finally {
  await browser.close();
  await server.close();
}
