// Measures the three quality presets on the 300-building town in headless Chrome with the GPU off
// (`--disable-gpu`: SwiftShader software rendering, the worst-case proxy). `npm run quality [-- --gpu]` — with
// --gpu the real GPU is used instead, for reference. Prints fps per preset; the numbers go in QA.md.
import { chromium } from "playwright";
import type { Page } from "playwright";
import { createServer } from "vite";

const PORT = 5184;
const GPU = process.argv.includes("--gpu");
import type { TidewaterApi as Api } from "../src/main";
import type { Quality } from "../src/ui/settings";

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as unknown as { __tidewater?: { ready: boolean } }).__tidewater?.ready === true, null, { timeout: 60_000 });
}

const server = await createServer({ server: { port: PORT, strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ channel: "chrome", headless: true, args: GPU ? ["--ignore-gpu-blocklist"] : ["--disable-gpu"] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`http://localhost:${PORT}/`);
  await waitReady(page);
  const built = await page.evaluate(async () => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    const url = "/test/scenario.ts"; // served by the Vite dev server; typed loosely so Node's tsc doesn't resolve it
    const sc = (await import(url)) as typeof import("./scenario");
    // The game launches into the World: a sector to hold the town, entered without the flight.
    api.newSector(1, 0, "Quality");
    await api.enterSector(1, { instant: true });
    api.grant(100000, 5000, 5000);
    const b = sc.bigTown(api.sim, api.grid);
    api.advance(2);
    api.frameTown(30);
    return { ...b, renderer: api.engine.getGlInfo().renderer, chosen: api.view.quality() };
  });
  console.log(`[quality] ${GPU ? "GPU" : "SwiftShader (--disable-gpu)"} · ${built.renderer} · ${built.buildings} buildings, ${built.boats} boats · first-launch probe: ${built.chosen.note}`);
  const measure = async (): Promise<Record<string, number>> => {
    const results: Record<string, number> = {};
    for (const q of ["high", "medium", "low"] as const) {
      const fps = await page.evaluate(async (quality: Quality) => {
        const api = (window as unknown as { __tidewater: Api }).__tidewater;
        api.setQuality(quality);
        api.setSpeed(1);
        await new Promise(r => setTimeout(r, 1000));
        let frames = 0;
        const obs = api.scene.onAfterRenderObservable.add(() => frames++);
        const t0 = performance.now();
        await new Promise(r => setTimeout(r, 5000));
        api.scene.onAfterRenderObservable.remove(obs);
        return frames / ((performance.now() - t0) / 1000);
      }, q);
      results[q] = fps;
      console.log(`[quality] ${q}: ${fps.toFixed(1)} fps`);
    }
    return results;
  };
  console.log(`[quality] tidewater ${JSON.stringify(await measure())}`);
  // The other coasts (docs/biomes): the same big town on the Fjord and the Atoll, each preset.
  for (const [face, seed, biome] of [[0, 2, "fjord"], [6, 2, "atoll"]] as const) {
    const b2 = await page.evaluate(async ({ face, seed, biome }) => {
      const api = (window as unknown as { __tidewater: Api }).__tidewater;
      const url = "/test/scenario.ts";
      const sc = (await import(url)) as typeof import("./scenario");
      await api.returnToWorld({ instant: true });
      api.newSector(face, seed, `Quality ${biome}`, biome);
      await api.enterSector(face, { instant: true });
      api.grant(100000, 5000, 5000);
      const b = sc.bigTown(api.sim, api.grid);
      api.advance(2);
      api.frameTown(30);
      return b;
    }, { face, seed, biome });
    console.log(`[quality] ${biome}: ${b2.buildings} buildings, ${b2.boats} boats`);
    console.log(`[quality] ${biome} ${JSON.stringify(await measure())}`);
  }
  // The World at each preset: the big town's miniature on one face, eleven uncharted seas, the clouds by preset.
  await page.evaluate(async () => {
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    api.world.setClock(11);
    await api.returnToWorld({ instant: true });
  });
  const worldResults: Record<string, number> = {};
  for (const q of ["high", "medium", "low"] as const) {
    const r = await page.evaluate(async (quality: Quality) => {
      const api = (window as unknown as { __tidewater: Api }).__tidewater;
      api.setQuality(quality);
      await new Promise(r => setTimeout(r, 1000));
      let frames = 0;
      const obs = api.world.scene.onAfterRenderObservable.add(() => frames++);
      const t0 = performance.now();
      await new Promise(r => setTimeout(r, 5000));
      api.world.scene.onAfterRenderObservable.remove(obs);
      return { fps: frames / ((performance.now() - t0) / 1000), draws: api.world.drawCalls() };
    }, q);
    worldResults[q] = r.fps;
    console.log(`[quality] World ${q}: ${r.fps.toFixed(1)} fps · ${r.draws} draw calls`);
  }
  console.log(`[quality] World ${JSON.stringify(worldResults)}`);
} finally {
  await browser.close();
  await server.close();
}
