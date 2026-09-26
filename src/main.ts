// Bootstrap: engine, scene, the ledger, the fixed-timestep loop, and the dev/test console API.
import { ArcRotateCamera, Color4, DefaultRenderingPipeline, Engine, Scene, Vector3 } from "@babylonjs/core";
import { Placement, Tool } from "./build/placement";
import { SIM_TICK, TIDE_PERIOD } from "./config";
import { Grid } from "./sim/grid";
import { AUTOSAVE_KEY, deserialize, serialize } from "./sim/save";
import { newGame } from "./sim/start";
import { SimState } from "./sim/state";
import { advanceCycles, tick } from "./sim/tick";
import { cycleFraction } from "./sim/tide";
import { Hud } from "./ui/hud";
import { Boats } from "./view/boats";
import { BuildingViews } from "./view/buildingViews";
import { Trees } from "./view/trees";
import { Walkers } from "./view/walkers";
import { computeLighting, createLights, duskAt } from "./world/lighting";
import { createSky } from "./world/sky";
import { createTerrain } from "./world/terrain";
import { createWater } from "./world/water";

const SEED = 1;

const canvas = document.getElementById("c") as HTMLCanvasElement;
const engine = new Engine(canvas, true, { antialias: true, adaptToDeviceRatio: true });
const scene = new Scene(engine);
scene.clearColor = new Color4(0.81, 0.90, 0.95, 1);

const camera = new ArcRotateCamera("cam", -0.95, 1.05, 46, new Vector3(0, 0.6, 0), scene);
camera.lowerRadiusLimit = 14; camera.upperRadiusLimit = 95;
camera.upperBetaLimit = 1.45; camera.lowerBetaLimit = 0.25;
camera.wheelPrecision = 18; camera.panningSensibility = 0;
camera.minZ = 0.5; camera.maxZ = 900;
camera.attachControl(canvas, true);

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
const views = new BuildingViews(scene);
const boats = new Boats(scene, grid);
const walkers = new Walkers(scene, grid);
const trees = new Trees(scene);
const placement = new Placement(scene, camera, grid, canvas);
const hud = new Hud(document.getElementById("hud")!, document.getElementById("resources")!, document.getElementById("notes")!, grid, tool => placement.setTool(tool));

function newTown(): void {
  try { localStorage.removeItem(AUTOSAVE_KEY); } catch { /* ignore */ }
  state = newGame(SEED).state;
  grid.attach(state);
  views.clear();
  walkers.clear();
}

window.addEventListener("keydown", e => {
  if (hud.key(e.key)) e.preventDefault();
});

let speed = 1;
let acc = 0;
let viewTime = 0;

/** Everything the view derives from the ledger for one frame. */
function syncView(): void {
  const light = computeLighting(duskAt(state.time));
  lights.apply(light);
  terrain.setLighting(light);
  water.setLighting(light);
  sky.setLighting(light);
  views.sync(state, light.lamp);
  trees.sync(state);
  boats.sync(state, viewTime);
  walkers.sync(state, viewTime);
  terrain.update(camera.position, state.tide.level, state.tide.wetLevel);
  water.update(viewTime, camera.position, state.tide.level);
  hud.update({ tool: placement.tool, blocker: placement.blocker, fate: placement.fate, state });
}

engine.runRenderLoop(() => {
  const frameDt = Math.min(engine.getDeltaTime() / 1000, 0.1) * speed;
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
  fields: {} as Record<string, Float32Array>,
  ready: false,
  /** Place (and pay for) a building; "boat" buys a boat at the pier under (i, j). Null when blocked. */
  place(type: Tool, i: number, j: number) {
    placement.setTool(type);
    return placement.place({ i, j });
  },
  remove(i: number, j: number) {
    placement.remove({ i, j });
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
  setSpeed(n: number) {
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
    camera.target.set(x / n, 0.8, z / n);
    camera.radius = radius; camera.alpha = -0.8; camera.beta = 0.95;
  },
  /** Read-only view probes for the smoke scenario. */
  view: {
    boats: () => boats.poses,
    walkers: () => walkers.count,
    dusk: () => duskAt(state.time),
  },
  save,
  newTown,
  engine, scene, camera, placement,
};
(window as unknown as { __tidewater: typeof api }).__tidewater = api;
scene.executeWhenReady(() => { api.ready = true; });
