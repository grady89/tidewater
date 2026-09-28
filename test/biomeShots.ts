// Screenshots of every charted biome beside Tidewater: a starter town on each, framed wide and narrow, by day
// and at night, into shots/biomes/. `npm run shots:biomes`. Headless Chrome on the dev server, like the smoke.
import { chromium } from "playwright";
import type { Page } from "playwright";
import { mkdir } from "node:fs/promises";
import { createServer } from "vite";
import type { TidewaterApi as Api } from "../src/main";

const PORT = 5186;
const BIOMES: { id: "tidewater" | "fjord" | "atoll" | "delta" | "cinder" | "dunes"; face: number; seed: number }[] = [
  { id: "tidewater", face: 1, seed: 0 },
  { id: "fjord", face: 0, seed: 2 },
  { id: "atoll", face: 6, seed: 2 },
  { id: "delta", face: 2, seed: 2 },
  { id: "cinder", face: 7, seed: 2 },
  { id: "dunes", face: 3, seed: 2 },
];

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as unknown as { __tidewater?: { ready: boolean } }).__tidewater?.ready === true, null, { timeout: 60_000 });
}

await mkdir("shots/biomes", { recursive: true });
const server = await createServer({ server: { port: PORT, strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--ignore-gpu-blocklist"] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(m.text()); });
  await page.goto(`http://localhost:${PORT}/`);
  await waitReady(page);
  await page.evaluate(() => (window as unknown as { __tidewater: Api }).__tidewater.world.setClock(11));
  for (const b of BIOMES) {
    const built = await page.evaluate(async ({ id, face, seed }) => {
      const api = (window as unknown as { __tidewater: Api }).__tidewater;
      const url = "/test/scenario.ts";
      const sc = (await import(url)) as typeof import("./scenario");
      api.newSector(face, seed, `${id} shots`, id);
      await api.enterSector(face, { instant: true });
      const s = api.sim, grid = api.grid;
      const town = sc.starterTown(s, grid);
      api.grant(3000, 100);
      sc.growStreet(s, grid, 6);
      sc.placeByWalkway(s, grid, "house", 4);
      sc.placeByWalkway(s, grid, "well", 1);
      sc.placeByWalkway(s, grid, "warehouse", 1);
      for (const kind of ["stockfishRacks", "iceHouse", "pearlHouse", "coconutGrove", "toolworks", "ricePaddy", "saltPan", "indigoVats", "wardenTower"] as const) if (grid.inCatalog(kind)) sc.placeByWalkway(s, grid, kind, 1);
      api.advance(6);
      api.frameTown(26);
      return { biome: s.world.biome, buildings: Object.keys(s.buildings).length, money: Math.round(s.resources.money), pop: town.huts.reduce((n, h) => n + h.residents, 0), log: s.log.slice(-2) };
    }, b);
    console.log(`[shots] ${b.id}:`, JSON.stringify(built));
    await page.evaluate(() => { const api = (window as unknown as { __tidewater: Api }).__tidewater; api.tickSeconds(0.25 * 2 * 120 - (api.sim.time % (2 * 120)) + 2 * 120); api.frameTown(26); }); // noon
    await page.waitForTimeout(600);
    await page.screenshot({ path: `shots/biomes/${b.id}-day-wide.png` });
    await page.evaluate(() => { const api = (window as unknown as { __tidewater: Api }).__tidewater; api.frameTown(12); });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `shots/biomes/${b.id}-day-close.png` });
    await page.evaluate(() => { const api = (window as unknown as { __tidewater: Api }).__tidewater; api.tickSeconds(0.75 * 2 * 120 - (api.sim.time % (2 * 120)) + 2 * 120); api.frameTown(12); }); // midnight
    await page.waitForTimeout(600);
    await page.screenshot({ path: `shots/biomes/${b.id}-night-close.png` });
    await page.evaluate(() => { const api = (window as unknown as { __tidewater: Api }).__tidewater; api.frameTown(26); });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `shots/biomes/${b.id}-night-wide.png` });
    await page.evaluate(async () => { const api = (window as unknown as { __tidewater: Api }).__tidewater; await api.returnToWorld({ instant: true }); });
  }
  await page.waitForTimeout(500);
  await page.screenshot({ path: "shots/biomes/world.png" });
  if (errors.length) { console.log("[shots] page errors:", errors.slice(0, 5)); process.exitCode = 1; }
  else console.log("[shots] done → shots/biomes/");
} finally {
  await browser.close();
  await server.close();
}
