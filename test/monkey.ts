// The UI monkey: `npm run monkey [-- --minutes 15 --seed 1]`. Headless Chrome with real pointer events: random
// clicks, drags (all three buttons), wheel, keys, speed changes, menu opens, resizes, and a reload during a tsunami
// and during a storm. Pass = no console error, no page error, no unhandled rejection, no stuck modal, and the
// frame rate never below 30 fps for more than 2 s. Each console error is reported with the actions before it.
import { chromium } from "playwright";
import type { Page } from "playwright";
import { createServer } from "vite";

const PORT = 5183;
const args = process.argv.slice(2);
const opt = (name: string, dflt: number): number => { const k = args.indexOf(`--${name}`); return k >= 0 ? Number(args[k + 1]) : dflt; };
const MINUTES = opt("minutes", 15);
const SEED = opt("seed", 1);
const SLOW_MS = 1000 / 30;
/** The in-page frame log: counts and the longest run of consecutive slow frames, kept incrementally (no buffer to age out of). */
interface MonkeyWindow { __monkey: { frames: number; first: number; last: number; run: number; worst: number; rejections: string[] } }
const SLOW_RUN_LIMIT_MS = 2000;

import type { TidewaterApi as Api } from "../src/main";

let rngState = SEED >>> 0;
const rand = (): number => {
  rngState = (rngState + 0x6d2b79f5) >>> 0;
  let t = rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
const between = (a: number, b: number): number => a + rand() * (b - a);

const KEYS = ["w", "a", "s", "d", "q", "e", "r", "f", "[", "]", "R", " ", "Escape", "Tab", "1", "2", "3", "4", "5", "6", "7", "8", "9", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", "Backspace", "x"];

interface Failure { at: string; what: string; recent: string[] }
const recent: string[] = [];
const failures: Failure[] = [];
const counts: Record<string, number> = {};
let elapsedLabel = "0:00";
const note = (s: string) => { recent.push(`${elapsedLabel} ${s}`); if (recent.length > 30) recent.shift(); };
const fail = (what: string) => { failures.push({ at: elapsedLabel, what, recent: recent.slice() }); console.log(`[monkey] ✗ ${elapsedLabel} ${what}`); };

/** Installed on every navigation: a frame-time log and an unhandled-rejection catcher. */
const INIT = `
  window.__monkey = { frames: 0, first: 0, last: 0, run: 0, worst: 0, rejections: [] };
  (function loop() { requestAnimationFrame(t => {
    const m = window.__monkey;
    if (m.frames === 0) m.first = t; else { const gap = t - m.last; if (gap > ${SLOW_MS}) { m.run += gap; if (m.run > m.worst) m.worst = m.run; } else m.run = 0; }
    m.last = t; m.frames++;
    loop();
  }); })();
  window.addEventListener("unhandledrejection", e => { const r = e.reason; window.__monkey.rejections.push("unhandledrejection: " + (r && r.stack || r && r.message || String(r))); });
`;

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as unknown as { __tidewater?: { ready: boolean } }).__tidewater?.ready === true, null, { timeout: 30_000 });
}

/** The longest run of consecutive slow frames (each gap over 1/30 s) since the page loaded, and the average fps. */
async function frameStats(page: Page): Promise<{ maxSlowRunMs: number; fps: number; frames: number }> {
  return page.evaluate(() => {
    const m = (window as unknown as MonkeyWindow).__monkey;
    const span = m.last - m.first;
    return { maxSlowRunMs: m.worst, fps: span > 0 ? (m.frames - 1) / (span / 1000) : 0, frames: m.frames };
  });
}

const server = await createServer({ server: { port: PORT, strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--ignore-gpu-blocklist"] });
const t0 = performance.now();
let worstSlowRun = 0, fpsSum = 0, fpsSamples = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.addInitScript(INIT);
  page.on("pageerror", e => fail(`page error: ${e.message}`));
  page.on("console", m => { if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) fail(`console error: ${m.text()}`); });
  page.on("response", r => { if (r.status() >= 400) fail(`${r.status()} ${r.url()}`); });
  page.on("dialog", d => { const accept = rand() < 0.5; note(`dialog ${d.type()} "${d.message().slice(0, 40)}" → ${accept ? "accept" : "dismiss"}`); void (accept ? d.accept(d.type() === "prompt" ? "monkey" : undefined) : d.dismiss()); });

  await page.goto(`http://localhost:${PORT}/`);
  await waitReady(page);
  let size = { width: 1280, height: 720 };

  const canvasClick = async (button: "left" | "right" | "middle"): Promise<void> => {
    const x = between(20, size.width - 20), y = between(140, size.height - 60);
    note(`${button} click ${x.toFixed(0)},${y.toFixed(0)}`);
    await page.mouse.click(x, y, { button });
  };
  const drag = async (button: "left" | "right" | "middle"): Promise<void> => {
    const x0 = between(340, size.width - 40), y0 = between(140, size.height - 80);
    const x1 = x0 + between(-300, 300), y1 = y0 + between(-200, 200);
    note(`${button} drag ${x0.toFixed(0)},${y0.toFixed(0)} → ${x1.toFixed(0)},${y1.toFixed(0)}`);
    await page.mouse.move(x0, y0);
    await page.mouse.down({ button });
    const steps = 2 + Math.floor(rand() * 6);
    for (let k = 1; k <= steps; k++) await page.mouse.move(x0 + (x1 - x0) * k / steps, y0 + (y1 - y0) * k / steps);
    await page.mouse.up({ button });
  };
  const wheel = async (): Promise<void> => {
    await page.mouse.move(between(340, size.width - 40), between(140, size.height - 80));
    const dy = pick([-600, -240, -120, 120, 240, 600]);
    note(`wheel ${dy}`);
    await page.mouse.wheel(0, dy);
  };
  const key = async (): Promise<void> => {
    const k = pick(KEYS);
    note(`key ${JSON.stringify(k)}`);
    if ("wasdqerf".includes(k)) { await page.keyboard.down(k); await page.waitForTimeout(between(40, 300)); await page.keyboard.up(k); }
    else await page.keyboard.press(k);
  };
  const button = async (): Promise<void> => {
    const boxes = await page.evaluate(() => [...document.querySelectorAll("button")].filter(b => !b.disabled && b.offsetParent !== null).map(b => { const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, label: (b.textContent ?? "").trim().slice(0, 24) }; }));
    if (!boxes.length) return;
    const b = pick(boxes);
    note(`button "${b.label}"`);
    await page.mouse.click(b.x, b.y);
  };
  const typeSeed = async (): Promise<void> => {
    const box = await page.evaluate(() => { const el = document.querySelector("#menu .seed") as HTMLInputElement | null; if (!el || el.offsetParent === null) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    if (!box) return;
    const text = pick(["42", "-3", "abc", "1e9", "", "7"]);
    note(`type seed "${text}"`);
    await page.mouse.click(box.x, box.y, { clickCount: 3 });
    await page.keyboard.type(text);
  };
  const resize = async (): Promise<void> => {
    size = { width: Math.round(between(700, 1600)), height: Math.round(between(500, 900)) };
    note(`resize ${size.width}×${size.height}`);
    await page.setViewportSize(size);
  };
  const reloadDuring = async (event: "storm" | "tsunami"): Promise<void> => {
    const before = await frameStats(page);
    worstSlowRun = Math.max(worstSlowRun, before.maxSlowRunMs); fpsSum += before.fps; fpsSamples++;
    note(`force ${event}, save, reload`);
    const forced = await page.evaluate(async (ev: string) => {
      const api = (window as unknown as { __tidewater: Api }).__tidewater;
      // The monkey may be up in the World: get onto an island (creating a sea if it never began one) so the
      // save lands in a sector; a flight already under way finishes first.
      const mode = () => api.mode; // read through a call: TS would otherwise narrow the getter inside the branch
      const before = { mode: mode(), active: api.world.active(), dialog: !(document.getElementById("dialog")?.hidden ?? true) };
      if (mode() === "world") {
        let f = api.world.active();
        if (f === null) { api.newSector(1, 0, "Monkey"); f = 1; }
        for (let k = 0; k < 40 && mode() !== "island"; k++) { if (!await api.enterSector(f, { instant: true })) await new Promise(r => setTimeout(r, 100)); }
      }
      api.setSpeed(1);
      if (ev === "storm") api.forceStorm(); else api.forceTsunami();
      api.tickSeconds(ev === "tsunami" ? 8 : 2);
      const live = ev === "storm" ? api.sim.storm.active : api.sim.tsunami.stage;
      api.save();
      const active = api.world.active();
      const raw = active !== null ? localStorage.getItem(`tidewater.sector.${active}`) : null;
      return { before, mode: mode(), active, activeKey: localStorage.getItem("tidewater.sector.active"), live, saved: raw ? raw.length : 0, n: Object.keys(api.sim.buildings).length, cycle: api.sim.tide.cycle };
    }, event);
    console.log(`[monkey] ${elapsedLabel} forced a ${event}: ${JSON.stringify(forced)}`);
    await page.reload();
    await waitReady(page);
    const state = await page.evaluate(async () => {
      const api = (window as unknown as { __tidewater: Api }).__tidewater;
      const f = api.world.active();
      const atBoot = { active: f, storm: api.sim.storm.active, stage: api.sim.tsunami.stage, n: Object.keys(api.sim.buildings).length };
      const entered = f !== null ? await api.enterSector(f, { instant: true }) : null;
      return { atBoot, entered, storm: api.sim.storm.active, stage: api.sim.tsunami.stage, n: Object.keys(api.sim.buildings).length, mode: api.mode };
    });
    counts[`reload-${event}`] = (counts[`reload-${event}`] ?? 0) + 1;
    console.log(`[monkey] ${elapsedLabel} reloaded during a ${event}: ${JSON.stringify(state)}`);
    if (event === "storm" && !state.storm) fail("the storm did not survive the reload");
    if (event === "tsunami" && !state.stage) fail("the tsunami did not survive the reload");
    size = { width: 1280, height: 720 };
    await page.setViewportSize(size);
  };

  const ACTIONS: [string, number, () => Promise<void>][] = [
    ["leftClick", 22, () => canvasClick("left")], ["rightClick", 8, () => canvasClick("right")], ["middleClick", 2, () => canvasClick("middle")],
    ["leftDrag", 10, () => drag("left")], ["rightDrag", 8, () => drag("right")], ["middleDrag", 6, () => drag("middle")],
    ["wheel", 10, wheel], ["key", 16, key], ["button", 14, button], ["typeSeed", 2, typeSeed], ["resize", 1, resize],
  ];
  const total = ACTIONS.reduce((n, [, w]) => n + w, 0);
  const end = t0 + MINUTES * 60_000;
  const reloads: [number, "tsunami" | "storm"][] = [[t0 + MINUTES * 60_000 * 0.35, "tsunami"], [t0 + MINUTES * 60_000 * 0.7, "storm"]];
  let lastReport = t0;
  let n = 0;
  while (performance.now() < end) {
    const now = performance.now();
    elapsedLabel = `${Math.floor((now - t0) / 60000)}:${String(Math.floor(((now - t0) % 60000) / 1000)).padStart(2, "0")}`;
    if (reloads.length && now >= reloads[0][0]) { await reloadDuring(reloads.shift()![1]); continue; }
    let roll = rand() * total;
    for (const [name, w, run] of ACTIONS) {
      roll -= w;
      if (roll >= 0) continue;
      counts[name] = (counts[name] ?? 0) + 1;
      try { await run(); } catch (e) { fail(`${name} threw: ${(e as Error).message.split("\n")[0]}`); }
      break;
    }
    n++;
    if (now - lastReport > 60_000) {
      lastReport = now;
      const fs = await frameStats(page);
      const rejections = await page.evaluate(() => (window as unknown as MonkeyWindow).__monkey.rejections.splice(0) as string[]);
      for (const r of rejections) fail(r);
      console.log(`[monkey] ${elapsedLabel} · ${n} actions · fps ${fs.fps.toFixed(0)} · worst slow run ${(fs.maxSlowRunMs / 1000).toFixed(2)} s · failures ${failures.length}`);
    }
  }
  // Wind down: the menu must close, nothing must be stuck open, and the last page's frames count.
  const fs = await frameStats(page);
  worstSlowRun = Math.max(worstSlowRun, fs.maxSlowRunMs); fpsSum += fs.fps; fpsSamples++;
  const rejections = await page.evaluate(() => (window as unknown as MonkeyWindow).__monkey.rejections.splice(0) as string[]);
  for (const r of rejections) fail(r);
  for (let k = 0; k < 3; k++) await page.keyboard.press("Escape");
  const stuck = await page.evaluate(() => {
    const menu = document.getElementById("menu")!;
    const api = (window as unknown as { __tidewater: Api }).__tidewater;
    api.menu(false);
    return { menuHidden: menu.hidden, dialogHidden: document.getElementById("dialog")?.hidden ?? true, mode: api.mode, ready: api.ready, buildings: Object.keys(api.sim.buildings).length, cycle: api.sim.tide.cycle };
  });
  if (!stuck.menuHidden) fail("the Town menu stays open");
  if (!stuck.dialogHidden) fail("a dialog stays open after Escape");
  if (worstSlowRun > SLOW_RUN_LIMIT_MS) fail(`frame rate under 30 fps for ${(worstSlowRun / 1000).toFixed(2)} s`);
  console.log(`[monkey] done: ${n} actions in ${MINUTES} min · ${JSON.stringify(counts)} · mean fps ${(fpsSum / Math.max(1, fpsSamples)).toFixed(0)} · worst slow run ${(worstSlowRun / 1000).toFixed(2)} s · end state ${JSON.stringify(stuck)}`);
  if (failures.length) {
    console.log(`[monkey] ${failures.length} failure(s):`);
    for (const f of failures.slice(0, 20)) { console.log(`  ✗ ${f.at} ${f.what}`); console.log(`    actions before it:\n      ${f.recent.slice(-10).join("\n      ")}`); }
    process.exitCode = 1;
  } else console.log("[monkey] OK");
} finally {
  await browser.close();
  await server.close();
}
