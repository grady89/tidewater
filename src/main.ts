// Bootstrap: engine, scene, the ledger, the fixed-timestep loop, and the dev/test console API.
import { ArcRotateCamera, Color4, DefaultRenderingPipeline, Engine, Matrix, Scene, Vector3 } from "@babylonjs/core";
import { CameraControl } from "./build/cameraControl";
import { Placement, Tool } from "./build/placement";
import { SIM_TICK, TIDE_PERIOD } from "./config";
import { BUILDINGS, STORM_WAVE_AMP, WAVE_HEIGHT, WAVE_WIDTH } from "./sim/balance";
import { districtOf } from "./sim/districts";
import { startStorm, startTsunami } from "./sim/events";
import { ignite } from "./sim/fire";
import { Grid } from "./sim/grid";
import { AUTOSAVE_KEY, deserialize, serialize } from "./sim/save";
import { newGame } from "./sim/start";
import { notify, SimState } from "./sim/state";
import { advanceCycles, tick } from "./sim/tick";
import { cycleFraction } from "./sim/tide";
import { orderPlanks } from "./sim/trade";
import { Hud } from "./ui/hud";
import { InfoPanel } from "./ui/infoPanel";
import { SaveMenu } from "./ui/saveMenu";
import { Speed, SpeedControls } from "./ui/speed";
import { AchievementPopup } from "./ui/achievements";
import { MarkerLabel } from "./ui/markerLabel";
import { Tutorial } from "./ui/tutorial";
import { Audio } from "./view/audio";
import { Boats } from "./view/boats";
import { roofShape } from "./view/buildings";
import { BuildingViews } from "./view/buildingViews";
import { Effects } from "./view/effects";
import { Ferry } from "./view/ferry";
import { PierMarker } from "./view/marker";
import { OverlayKind, Overlays } from "./view/overlays";
import { Ship } from "./view/ship";
import { Trees } from "./view/trees";
import { Walkers } from "./view/walkers";
import { Wildlife } from "./view/wildlife";
import { computeLighting, createLights, duskAt } from "./world/lighting";
import { createSky } from "./world/sky";
import { createTerrain } from "./world/terrain";
import { createWater } from "./world/water";

const SEED = 1;
const bootStart = performance.now();

const canvas = document.getElementById("c") as HTMLCanvasElement;
const engine = new Engine(canvas, true, { antialias: true, adaptToDeviceRatio: true });
const scene = new Scene(engine);
scene.clearColor = new Color4(0.81, 0.90, 0.95, 1);

const camera = new ArcRotateCamera("cam", -0.95, 1.05, 46, new Vector3(0, 0.6, 0), scene);
camera.minZ = 0.5; camera.maxZ = 900;
camera.attachControl(canvas, true); // keeps the scene's pointer tracking; the camera's own inputs are cleared below
const cameraControl = new CameraControl(camera, canvas, scene);

const lights = createLights(scene);
const terrain = createTerrain(scene);
const water = createWater(scene, terrain.heightTex);
const sky = createSky(scene);

const pipe = new DefaultRenderingPipeline("pp", false, scene, [camera]);
pipe.fxaaEnabled = true;
pipe.bloomEnabled = true; pipe.bloomThreshold = 0.9; pipe.bloomWeight = 0.15; pipe.bloomKernel = 48; pipe.bloomScale = 0.5;

// ---------- the ledger ----------
function loadAutosave(): SimState | null {
  try {
    const json = localStorage.getItem(AUTOSAVE_KEY);
    return json ? deserialize(json) : null;
  } catch {
    return null;
  }
}
function save(): void {
  try { localStorage.setItem(AUTOSAVE_KEY, serialize(state)); } catch { /* storage unavailable: play on without autosave */ }
}

const loaded = loadAutosave();
let state: SimState;
let grid: Grid;
if (loaded) { state = loaded; grid = new Grid(state); }
else ({ state, grid } = newGame(SEED));

// ---------- the view ----------
const views = new BuildingViews(scene, grid);
const boats = new Boats(scene, grid);
const walkers = new Walkers(scene, grid);
const trees = new Trees(scene);
const overlays = new Overlays(scene, grid);
const effects = new Effects(scene);
const ship = new Ship(scene, grid);
const wildlife = new Wildlife(scene, grid);
const ferry = new Ferry(scene, grid);
const pierMarker = new PierMarker(scene, grid);
const placement = new Placement(scene, camera, grid, canvas);
const hud = new Hud(document.getElementById("hud")!, document.getElementById("resources")!, document.getElementById("notes")!, grid, tool => placement.setTool(tool), kind => overlays.show(kind), () => orderPlanks(state));
const info = new InfoPanel(document.getElementById("info")!, grid);
const tutorial = new Tutorial(document.getElementById("tutorial")!);
const achievements = new AchievementPopup(document.getElementById("achievement")!);
const markerLabel = new MarkerLabel(document.getElementById("markerLabel")!, "Pier goes here");
achievements.adopt(state);
placement.onSelect = b => info.select(b);
cameraControl.onHome = () => api.frameTown(30);

/** Swap the whole ledger (load, new town) and let every view rebuild from it. */
function adopt(next: SimState): void {
  state = next;
  grid.attach(state);
  views.clear();
  walkers.clear();
  info.select(null);
  achievements.adopt(state);
  syncView();
}
function newTown(): void {
  try { localStorage.removeItem(AUTOSAVE_KEY); } catch { /* ignore */ }
  tutorial.reset();
  adopt(newGame(SEED).state);
}
function load(json: string): void {
  let next: SimState;
  try { next = deserialize(json); } catch { notify(state, "That save is from an older build and can't be loaded"); return; }
  adopt(next);
  save();
}

const menu = new SaveMenu(document.getElementById("menu")!, { serialize: () => serialize(state), cycle: () => state.tide.cycle, load, newTown });
let speed: Speed = 1;
const audio = new Audio();
const REFLECTIONS_KEY = "tidewater.reflections";
function setReflections(on: boolean): void {
  water.setReflections(on);
  try { localStorage.setItem(REFLECTIONS_KEY, on ? "1" : "0"); } catch { /* ignore */ }
}
try { if (localStorage.getItem(REFLECTIONS_KEY) === "1") water.setReflections(true); } catch { /* ignore */ }
const speedControls = new SpeedControls(document.getElementById("speed")!, {
  onSpeed: s => { speed = s; },
  onMenu: () => menu.toggle(),
  onMute: () => audio.setMuted(!audio.muted),
  onReflections: () => setReflections(!water.reflections),
});

window.addEventListener("keydown", e => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === "Escape") { if (menu.open) menu.toggle(false); else if (info.selectedId !== null) info.select(null); else menu.toggle(true); return; }
  if (e.key === " ") { speed = speed === 0 ? 1 : 0; e.preventDefault(); return; }
  if (e.key === "]" || e.key === "[") { placement.adjustLift(e.key === "]" ? 1 : -1); e.preventDefault(); return; }
  if (cameraControl.keyDown(e.key)) { e.preventDefault(); return; }
  if (hud.key(e.key)) e.preventDefault();
});
window.addEventListener("keyup", e => cameraControl.keyUp(e.key));

let acc = 0;
let viewTime = 0;
let stormMix = 0;
let lastFrameTime = 0;

/** Everything the view derives from the ledger for one frame. */
function syncView(): void {
  const frameDt = Math.max(0, Math.min(10, viewTime - lastFrameTime)); // scripted jumps settle in one sync
  lastFrameTime = viewTime;
  const target = state.storm.active ? 1 : 0;
  stormMix += (target - stormMix) * Math.min(1, frameDt / 3);
  // A storm drags the light toward the study's dusk palette; the tsunami crest rides the water shader.
  const light = computeLighting(Math.max(duskAt(state.time), stormMix * 0.95));
  lights.apply(light);
  terrain.setLighting(light);
  water.setLighting(light);
  sky.setLighting(light);
  water.setSwell(1 + (STORM_WAVE_AMP - 1) * stormMix);
  const ts = state.tsunami;
  water.setCrest(ts.dir, ts.stage === "wave" ? ts.front : -999, ts.stage === "wave" ? WAVE_HEIGHT : 0, WAVE_WIDTH);
  views.sync(state, light.lamp);
  trees.sync(state);
  overlays.sync(state);
  boats.sync(state, viewTime);
  walkers.sync(state, viewTime);
  effects.sync(state, viewTime);
  ship.sync(state, viewTime);
  wildlife.sync(state, viewTime);
  ferry.sync(state, viewTime);
  pierMarker.sync(state, viewTime);
  cameraControl.setWaterLevel(state.tide.level);
  terrain.update(camera.position, state.tide.level, state.tide.wetLevel);
  water.update(viewTime, camera.position, state.tide.level);
  cameraControl.leftDrag = !placement.dragsLine;
  hud.update({ tool: placement.tool, blocker: placement.blocker, warn: placement.warn, line: placement.line, lift: placement.liftable ? placement.lift : null, fate: placement.fate, state });
  info.update(state);
  tutorial.update(state);
  hud.highlight(tutorial.current);
  markerLabel.update(pierMarker.cell ? api.screenOf(pierMarker.cell.i + 0.5, pierMarker.cell.j + 0.5, state.tide.level + 0.2) : null);
  achievements.update(state, viewTime);
  speedControls.update(speed, audio.muted, water.reflections);
  audio.sync(state, stormMix);
}

engine.runRenderLoop(() => {
  const realDt = Math.min(engine.getDeltaTime() / 1000, 0.1);
  cameraControl.update(realDt);
  const frameDt = realDt * speed;
  viewTime += frameDt;
  acc += frameDt;
  while (acc >= SIM_TICK) {
    tick(state, grid);
    acc -= SIM_TICK;
    if (state.tide.peaked) save();
  }
  syncView();
  scene.render();
});
window.addEventListener("resize", () => engine.resize());

// ---------- console / test API ----------
const api = {
  get sim() { return state; },
  grid,
  get fields() { return state.fields; },
  ready: false,
  /** Milliseconds from script start to the first ready frame. */
  bootMs: 0,
  setOverlay(kind: OverlayKind | null) {
    overlays.show(kind);
  },
  /** Place (and pay for) a building; "boat" buys a boat at the pier under (i, j). Null when blocked. */
  place(type: Tool, i: number, j: number) {
    placement.setTool(type);
    return placement.place({ i, j });
  },
  remove(i: number, j: number) {
    placement.remove({ i, j });
  },
  /** Open the info panel on the building at (i, j), or close it. */
  select(i: number, j: number) {
    info.select(grid.buildingAt({ i, j }));
    info.update(state);
  },
  setTide(level: number | null) {
    state.tide.override = level;
  },
  /** Advance the ledger by whole tide cycles in fixed ticks, independent of rendering. */
  advance(cycles: number) {
    advanceCycles(state, grid, cycles);
    viewTime += cycles * TIDE_PERIOD;
    syncView();
  },
  /** Advance to the next time the clock reaches `fraction` of the cycle (0 = high tide, 0.5 = low). */
  advanceTo(fraction: number) {
    const cap = Math.ceil(2 * TIDE_PERIOD / SIM_TICK);
    let prev = cycleFraction(state.tide);
    for (let k = 0; k < cap; k++) {
      tick(state, grid);
      viewTime += SIM_TICK;
      const f = cycleFraction(state.tide);
      const crossed = prev <= fraction ? f >= fraction && f - prev < 0.5 : f >= fraction && f < prev;
      prev = f;
      if (crossed) break;
    }
    syncView();
  },
  /** Tick the ledger for `seconds` of game time (for effects that live between shifts). */
  tickSeconds(seconds: number) {
    const n = Math.round(seconds / SIM_TICK);
    for (let k = 0; k < n; k++) { tick(state, grid); viewTime += SIM_TICK; }
    syncView();
  },
  setSpeed(n: Speed) {
    speed = n;
  },
  /** Cheat for scripted scenarios. */
  grant(money: number, planks = 0, timber = 0) {
    state.resources.money += money;
    state.resources.planks += planks;
    state.resources.timber += timber;
  },
  /** View only: aim the camera at the town's centroid for screenshots. */
  frameTown(radius = 22) {
    const bs = Object.values(state.buildings);
    if (!bs.length) return;
    let x = 0, z = 0, n = 0;
    for (const b of bs) for (const c of b.cells) { x += c.i + 0.5; z += c.j + 0.5; n++; }
    cameraControl.jumpTo(x / n, z / n, radius, -0.8, 0.95);
  },
  /** View only: aim the camera at a world point. */
  frameAt(x: number, z: number, radius = 16, yaw = -0.8, beta = 0.95) {
    cameraControl.jumpTo(x, z, radius, yaw, beta);
  },
  /** The screen position (client pixels) of a world point at height `y`, for pointer-driven checks. Placement
   *  picks against the tool's deck height, so pass that to land on a cell. */
  screenOf(x: number, z: number, y = 0.6) {
    const s = Vector3.Project(new Vector3(x, y, z), Matrix.Identity(), scene.getTransformMatrix(), camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()));
    const k = engine.getHardwareScalingLevel();
    const r = canvas.getBoundingClientRect();
    return { x: s.x * k + r.left, y: s.y * k + r.top };
  },
  /** The ground point under a screen position (client pixels), for camera checks. */
  groundAt(clientX: number, clientY: number) {
    const g = cameraControl.groundAt(clientX, clientY);
    return g ? { x: g.x, z: g.z } : null;
  },
  /** Read-only view probes for the smoke scenario. */
  view: {
    boats: () => boats.poses,
    walkers: () => walkers.count,
    swimmers: () => walkers.swimmerCount(state),
    fins: () => effects.finCount,
    ship: () => ship.pose,
    burning: () => effects.burning,
    dusk: () => duskAt(state.time),
    stormMix: () => stormMix,
    drawCalls: () => scene.getActiveMeshes().length,
    audio: () => ({ started: audio.started, state: audio.state, muted: audio.muted }),
    reflections: () => water.reflections,
    chunks: () => views.chunkCount,
    caustics: () => water.caustics,
    gulls: () => wildlife.gullCount,
    crabs: () => wildlife.crabCount,
    ferry: () => ferry.pose,
    isleOpen: () => grid.isleOpen(),
    achievementsShown: () => achievements.shown.slice(),
    camera: () => cameraControl.pose,
    category: () => hud.category,
    pierMarker: () => pierMarker.cell,
    hint: () => document.querySelector("#hud .hint")?.textContent ?? "",
    /** How many homes wear each roof shape. */
    roofs: () => {
      const out: Record<string, number> = { pyramid: 0, gable: 0, hipped: 0 };
      for (const b of Object.values(state.buildings)) if (BUILDINGS[b.kind].residents > 0) out[roofShape(b)]++;
      return out;
    },
  },
  /** The reflections quality toggle (remembered). */
  setReflections,
  /** Why the current tool can't go at (i, j), or null when it can. */
  blockerAt(type: Tool, i: number, j: number) {
    placement.setTool(type);
    return placement.check({ i, j });
  },
  /** The district of the building at (i, j), if any. */
  district(i: number, j: number) {
    const b = grid.buildingAt({ i, j });
    return b ? districtOf(grid, b) : null;
  },
  /** Caustics on/off (for A/B checks; on by default). */
  setCaustics(on: boolean) { water.setCaustics(on); },
  /** Mean brightness (0–255) of a viewport rectangle in the next rendered frame; (x, y) from the bottom-left. */
  async brightness(x: number, y: number, w: number, h: number): Promise<number> {
    const px = await new Promise<ArrayBufferView>(res => scene.onAfterRenderObservable.addOnce(() => { void engine.readPixels(x, y, w, h).then(res); }));
    const a = px as Uint8Array;
    let sum = 0;
    for (let i = 0; i < a.length; i += 4) sum += 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
    return sum / (a.length / 4);
  },
  orderPlanks() {
    return orderPlanks(state);
  },
  /** Set fire to the building at (i, j). */
  ignite(i: number, j: number) {
    const b = grid.buildingAt({ i, j });
    if (b) ignite(state, b);
  },
  /** Force the weather: a storm through this cycle, or the tsunami sequence now. */
  forceStorm() {
    startStorm(state, grid);
    syncView();
  },
  forceTsunami() {
    startTsunami(state, grid);
    syncView();
  },
  save,
  load,
  newTown,
  /** The ledger as JSON (what a save slot would hold). */
  saveJson: () => serialize(state),
  /** Open or close the town menu. */
  menu: (open: boolean) => menu.toggle(open),
  /** Stress test: extra walkers in the view only. Returns how many were added. */
  stressWalkers(n: number) {
    const added = walkers.spawnExtra(state, n, viewTime);
    syncView();
    return added;
  },
  engine, scene, camera, placement,
};
(window as unknown as { __tidewater: typeof api }).__tidewater = api;
scene.executeWhenReady(() => { api.ready = true; api.bootMs = performance.now() - bootStart; });
