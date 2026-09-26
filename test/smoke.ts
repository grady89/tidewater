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

  // M0: a pier at the shore, a run of walkways, houses hanging off them; one cycle later they are reached.
  const m0 = await page.evaluate(() => {
    type Cell = { i: number; j: number };
    const tw = (window as unknown as { __tidewater: Api }).__tidewater;
    const grid = tw.grid;
    let anchor: Cell | null = null, best = Infinity;
    for (let i = -32; i < 32; i++) for (let j = -32; j < 32; j++) {
      const c = { i, j };
      if (grid.classAt(c) !== "deep" || !grid.footprint("pier", c)) continue;
      const d = Math.hypot(i, j);
      if (d < best) { best = d; anchor = c; }
    }
    if (!anchor) return { error: "no pier site" };
    const pier = tw.place("pier", anchor.i, anchor.j);
    const shore = grid.neighbors(anchor).find((n: Cell) => grid.classAt(n) === "flat");
    let cur: Cell | null = shore, walkways = 0;
    const seen = new Set<string>();
    for (let s = 0; s < 10 && cur; s++) {
      seen.add(cur.i + "," + cur.j);
      if (tw.place("walkway", cur.i, cur.j)) walkways++;
      const next = grid.neighbors(cur).filter((n: Cell) => grid.classAt(n) === "flat" && !seen.has(n.i + "," + n.j) && !grid.pieceAt(n));
      cur = next[0] ?? null;
    }
    let houses = 0;
    for (const p of Object.values(tw.sim.pieces) as any[]) {
      if (p.kind !== "walkway") continue;
      for (const n of grid.neighbors(p.cells[0])) {
        if (houses >= 4) break;
        if (grid.classAt(n) === "flat" && !grid.pieceAt(n) && tw.place("house", n.i, n.j)) houses++;
      }
    }
    tw.advance(1);
    const pieces = Object.values(tw.sim.pieces) as any[];
    return {
      pier: !!pier, walkways, houses, total: pieces.length,
      reached: pieces.filter(p => p.kind === "house" && p.reached).length,
      score: tw.sim.score, cycle: tw.sim.tide.cycle,
    };
  });
  console.log("M0:", JSON.stringify(m0));
  assert(!("error" in m0), String((m0 as { error?: string }).error));
  assert(m0.pier, "pier placed");
  assert(m0.walkways >= 5, "at least 5 walkways placed");
  assert(m0.houses === 4, "4 houses placed");
  assert(m0.reached === 4, "all houses reached");
  assert(m0.score && m0.score.reached === 4, "score snapshot taken at high tide");

  await page.evaluate(() => (window as unknown as { __tidewater: Api }).__tidewater.setTide(0.6));
  await page.waitForTimeout(300);
  await page.screenshot({ path: "shots/m0.png" });

  // M1: save, reload the page, every piece is back and the clock kept its place.
  const before = await page.evaluate(() => { const tw = (window as unknown as { __tidewater: Api }).__tidewater; tw.setTide(null); tw.save(); return { pieces: Object.keys(tw.sim.pieces).length, cycle: tw.sim.tide.cycle, hash: JSON.stringify(tw.sim).length }; });
  await page.reload();
  await waitReady(page);
  const after = await page.evaluate(() => { const tw = (window as unknown as { __tidewater: Api }).__tidewater; return { pieces: Object.keys(tw.sim.pieces).length, cycle: tw.sim.tide.cycle, meshes: tw.scene.meshes.filter((m: any) => ["house", "walkway", "pier"].includes(m.name)).length }; });
  console.log("M1:", JSON.stringify({ before, after }));
  assert(after.pieces === before.pieces && before.pieces >= 5, "all pieces present after reload");
  assert(after.cycle === before.cycle, "tide cycle restored");
  assert(after.meshes === before.pieces, "view rebuilt one mesh per piece");
  await page.screenshot({ path: "shots/m1.png" });

  // Headless fps on the real GPU, averaged over 5 s.
  const fps = await page.evaluate(async () => {
    const tw = (window as unknown as { __tidewater: Api }).__tidewater;
    let frames = 0;
    const obs = tw.scene.onAfterRenderObservable.add(() => frames++);
    await new Promise(r => setTimeout(r, 5000));
    tw.scene.onAfterRenderObservable.remove(obs);
    return frames / 5;
  });
  console.log(`headless fps: ${fps.toFixed(1)}`);
  assert(errors.length === 0, "no page errors: " + errors.join(" | "));
  console.log("smoke OK → shots/");
} finally {
  await browser.close();
  await server.close();
}
