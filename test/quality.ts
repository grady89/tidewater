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
    api.newTown();
    api.grant(100000, 5000, 5000);
    const b = sc.bigTown(api.sim, api.grid);
    api.advance(2);
    api.frameTown(30);
    return { ...b, renderer: api.engine.getGlInfo().renderer, chosen: api.view.quality() };
  });
  console.log(`[quality] ${GPU ? "GPU" : "SwiftShader (--disable-gpu)"} · ${built.renderer} · ${built.buildings} buildings, ${built.boats} boats · first-launch probe: ${built.chosen.note}`);
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
  console.log(`[quality] ${JSON.stringify(results)}`);
} finally {
  await browser.close();
  await server.close();
}
