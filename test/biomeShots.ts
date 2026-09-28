// Screenshots of every charted biome beside Tidewater: a starter town on each with the coast's own kinds, framed
// wide and narrow, at noon, at dusk and at night, into shots/biomes/; contact sheets that put every coast beside
// Tidewater at noon and at dusk; and the World with four seas, two lanes and a cargo ship between them.
// `npm run shots:biomes`. Headless Chrome on the dev server, like the smoke.
import { chromium } from "playwright";
import type { Page } from "playwright";
import { mkdir, readFile } from "node:fs/promises";
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
      sc.biomeTown(s, grid, 3000, town); // the coast's own kinds
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
    await page.evaluate(() => { const api = (window as unknown as { __tidewater: Api }).__tidewater; api.tickSeconds(0.47 * 2 * 120 - (api.sim.time % (2 * 120)) + 2 * 120); api.frameTown(26); }); // dusk
    await page.waitForTimeout(600);
    await page.screenshot({ path: `shots/biomes/${b.id}-dusk-wide.png` });
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

  // The World with four seas, two lanes and a cargo ship: harbors on two pairs of neighbouring seas that do not
  // touch each other, cocoa for one of them to send, one World settlement.
  const lanes = await page.evaluate(async (faces: number[]) => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    const url = "/test/scenario.ts", url2 = "/src/globe/geometry.ts";
    const sc = (await import(url)) as typeof import("./scenario");
    const geo = (await import(url2)) as typeof import("../src/globe/geometry");
    const adj = (a: number, b: number) => geo.FACES[a].neighbours.includes(b);
    // Four seas as two separate neighbouring pairs (so exactly two lanes), as many of them coasts already built as
    // can be; a face nobody has built gets a Tidewater sea on the first seed whose island has a harbor site.
    const all = [...Array(12).keys()];
    const edges = all.flatMap(a => all.filter(b => b > a && adj(a, b)).map(b => [a, b] as [number, number]));
    let pairs: [number, number][] | null = null, best = -1;
    for (const [a, b] of edges) for (const [c, d] of edges) {
      if ([c, d].some(x => x <= a || x === b) || [c, d].some(x => adj(x, a) || adj(x, b))) continue;
      const built = [a, b, c, d].filter(f => faces.includes(f)).length;
      if (built > best) { best = built; pairs = [[a, b], [c, d]]; }
    }
    if (!pairs) return { error: "no two separate lanes on the World" };
    const harbors: string[] = [];
    for (const f of pairs.flat()) {
      const fresh = !faces.includes(f);
      let ok = false;
      for (let seed = 40 + f * 10; seed < 40 + f * 10 + 8 && !ok; seed++) {
        if (fresh) api.newSector(f, seed, `Lane sea ${f}`, "tidewater");
        await api.enterSector(f, { instant: true });
        const s = api.sim, g = api.grid;
        const pier = Object.values(s.buildings).find(x => x.kind === "pier") ?? (fresh ? sc.starterTown(s, g).pier : null);
        api.grant(4000, 200);
        ok = !!pier && !!sc.placeHarbor(s, g, pier.cells[0]);
        if (ok && (f === pairs[0][0] || f === pairs[1][0])) { api.grantGood("pearls", 120); api.grantGood("cocoa", 120); }
        await api.returnToWorld({ instant: true });
        if (!ok && fresh) api.clearSector(f);
        if (!fresh) break;
      }
      harbors.push(`${f}:${ok ? "harbor" : "no harbor"}`);
    }
    api.world.settle();
    await new Promise(r => setTimeout(r, 400));
    api.world.lookAt(pairs[0][0]);
    const L = api.world.ledger();
    return { pairs, harbors, drawn: api.world.lanes(), trade: api.world.openTrade(), atSea: L.consignments.length, last: L.last };
  }, BIOMES.map(b => b.face));
  console.log("[shots] lanes:", JSON.stringify(lanes));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "shots/globe/world-four-seas.png" });

  // Contact sheets: every coast beside Tidewater, at noon and at dusk.
  for (const when of ["day", "dusk"] as const) {
    const cells = await Promise.all(BIOMES.map(async b => `<figure><img src="data:image/png;base64,${(await readFile(`shots/biomes/${b.id}-${when}-wide.png`)).toString("base64")}"><figcaption>${b.id}</figcaption></figure>`));
    await page.setViewportSize({ width: 1920, height: 760 });
    await page.setContent(`<style>body{margin:0;background:#1b2a33;font:14px system-ui;color:#f2ece0}main{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:6px}figure{margin:0;position:relative}img{width:100%;display:block}figcaption{position:absolute;left:8px;top:6px;text-transform:capitalize;text-shadow:0 1px 4px #000}</style><main>${cells.join("")}</main>`);
    await page.waitForTimeout(200);
    await page.screenshot({ path: `shots/biomes/sheet-${when === "day" ? "noon" : "dusk"}.png`, fullPage: true });
  }
  if (errors.length) { console.log("[shots] page errors:", errors.slice(0, 5)); process.exitCode = 1; }
  else console.log("[shots] done → shots/biomes/");
} finally {
  await browser.close();
  await server.close();
}
