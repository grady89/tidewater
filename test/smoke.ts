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

/** Runs in the page: the M2 starter town through the console API (mirrors test/scenario.ts). */
function buildStarterTown(): { pier: boolean; boats: number; walkways: number; huts: number; market: boolean; money: number } {
  type Cell = { i: number; j: number };
  const api = (window as unknown as { __tidewater: Api }).__tidewater;
  const grid = api.grid;
  let site: Cell | null = null, bd = Infinity;
  for (let i = -32; i < 32; i++) for (let j = -32; j < 32; j++) {
    const c = { i, j };
    if (grid.classAt(c) !== "deep" || !grid.footprint("pier", c)) continue;
    const d = Math.hypot(i, j);
    if (d < bd) { bd = d; site = c; }
  }
  if (!site) throw new Error("no pier site");
  const pier = api.place("pier", site.i, site.j);
  let boats = 0;
  if (api.place("boat", site.i, site.j)) boats++;
  if (api.place("boat", site.i, site.j)) boats++;
  let cur: Cell | null = grid.neighbors(site).find((c: Cell) => grid.classAt(c) === "flat") ?? null;
  let walkways = 0;
  const seen = new Set<string>();
  while (cur && walkways < 8) {
    seen.add(cur.i + "," + cur.j);
    if (api.place("walkway", cur.i, cur.j)) walkways++;
    const next: Cell[] = grid.neighbors(cur).filter((c: Cell) => grid.classAt(c) === "flat" && !seen.has(c.i + "," + c.j) && !grid.buildingAt(c));
    cur = next[0] ?? null;
  }
  const byWalkway = (kind: string, count: number): number => {
    let placed = 0;
    const ws = (Object.values(api.sim.buildings) as any[]).filter(b => b.kind === "walkway");
    for (const w of ws) {
      if (placed >= count) break;
      for (const n of grid.neighbors(w.cells[0])) {
        if (placed >= count) break;
        for (let di = 0; di < 2 && placed < count; di++) for (let dj = 0; dj < 2 && placed < count; dj++) {
          if (api.place(kind, n.i - di, n.j - dj)) { placed++; break; }
        }
      }
    }
    return placed;
  };
  const huts = byWalkway("hut", 3);
  const market = byWalkway("market", 1) === 1;
  return { pier: !!pier, boats, walkways, huts, market, money: api.sim.resources.money };
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
  const built = await page.evaluate(buildStarterTown);
  console.log("M2 built:", JSON.stringify(built));
  assert(built.pier && built.boats === 2 && built.huts === 3 && built.market && built.walkways >= 6, "starter town placed");
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
      if (b && b.kind === "walkway") api.remove(n.i, n.j);
    }
    api.advance(1);
    return { reached: market.reached, sold: api.sim.last.fishSold, fish: api.sim.resources.fish };
  });
  console.log("M2 market cut:", JSON.stringify(cut));
  assert(!cut.reached && cut.sold === 0, "sales stop when the market is cut off");

  // M1: save, reload the page, every building is back and the clock kept its place.
  const before = await page.evaluate(() => { const api = (window as unknown as { __tidewater: Api }).__tidewater; api.save(); return { n: Object.keys(api.sim.buildings).length, cycle: api.sim.tide.cycle, money: api.sim.resources.money }; });
  await page.reload();
  await waitReady(page);
  const after = await page.evaluate(() => { const api = (window as unknown as { __tidewater: Api }).__tidewater; return { n: Object.keys(api.sim.buildings).length, cycle: api.sim.tide.cycle, money: api.sim.resources.money, meshes: api.scene.meshes.filter((m: any) => ["hut", "house", "walkway", "pier", "market"].includes(m.name)).length }; });
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
