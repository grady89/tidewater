// Loads the built site the way GitHub Pages serves it — dist/ under the repository path — in headless Chrome and
// fails on any 404, page error or console error. `npm run check:dist` after `npm run build`. In CI (no Chrome
// channel) it uses Playwright's own Chromium.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { chromium } from "playwright";

const PORT = 5185;
const BASE = "/tidewater/";
const DIST = resolve("dist");
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".wasm": "application/wasm",
  ".woff": "font/woff", ".woff2": "font/woff2", ".txt": "text/plain",
};

if (!existsSync(join(DIST, "index.html"))) { console.error("[check:dist] no dist/index.html — run `npm run build` first"); process.exit(1); }

const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
  if (!url.startsWith(BASE)) { res.writeHead(404); res.end("outside the site path"); return; }
  let rel = url.slice(BASE.length);
  if (rel === "" || rel.endsWith("/")) rel += "index.html";
  const file = normalize(join(DIST, rel));
  if (!file.startsWith(DIST) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end("not found"); return; }
  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
});
await new Promise<void>(r => server.listen(PORT, r));

const browser = await chromium.launch(process.env.CI ? { headless: true } : { channel: "chrome", headless: true, args: ["--ignore-gpu-blocklist"] });
const problems: string[] = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("pageerror", e => problems.push(`page error: ${e.message}`));
  page.on("console", m => { if (m.type() === "error") problems.push(`console error: ${m.text()}`); });
  page.on("response", r => { if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`); });
  page.on("requestfailed", r => problems.push(`request failed: ${r.url()} ${r.failure()?.errorText ?? ""}`));
  await page.goto(`http://localhost:${PORT}${BASE}`);
  await page.waitForFunction(() => (window as unknown as { __tidewater?: { ready: boolean } }).__tidewater?.ready === true, null, { timeout: 120_000 });
  const info = await page.evaluate(() => {
    const api = (window as unknown as { __tidewater: { sim: { tide: { cycle: number } }; scene: { meshes: unknown[] } } }).__tidewater;
    return { meshes: api.scene.meshes.length, cycle: api.sim.tide.cycle, title: document.title };
  });
  console.log(`[check:dist] loaded ${BASE} · ${info.meshes} meshes · "${info.title}"`);
} catch (e) {
  problems.push(`load failed: ${(e as Error).message}`);
} finally {
  await browser.close();
  server.close();
}
if (problems.length) { console.log(`[check:dist] FAILED:\n  ${problems.join("\n  ")}`); process.exit(1); }
console.log("[check:dist] OK: no 404s, no errors");
