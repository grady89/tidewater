// Bootstrap: engine, scene, the ledger, the fixed-timestep loop, and the dev/test console API.
import { ArcRotateCamera, Color4, DefaultRenderingPipeline, Engine, Scene, Vector3 } from "@babylonjs/core";
import { Placement, Tool } from "./build/placement";
import { SIM_TICK } from "./config";
import { Grid } from "./sim/grid";
import { AUTOSAVE_KEY, deserialize, serialize } from "./sim/save";
import { createState, SimState } from "./sim/state";
import { advanceCycles, tick } from "./sim/tick";
import { Hud, toolForKey } from "./ui/hud";
import { BuildingViews } from "./view/buildingViews";
import { createLights } from "./world/lighting";
import { createSky } from "./world/sky";
import { createTerrain } from "./world/terrain";
import { createTrees } from "./world/trees";
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

createLights(scene);
const terrain = createTerrain(scene);
const water = createWater(scene, terrain.heightTex);
createSky(scene);
createTrees(scene);

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

let state = loadAutosave() ?? createState(SEED);
const grid = new Grid(state);
const views = new BuildingViews(scene);
const placement = new Placement(scene, camera, grid, canvas);
const hud = new Hud(document.getElementById("hud")!, document.getElementById("resources")!, document.getElementById("notes")!, tool => placement.setTool(tool));

function newTown(): void {
  try { localStorage.removeItem(AUTOSAVE_KEY); } catch { /* ignore */ }
  state = createState(SEED);
  grid.attach(state);
  views.clear();
}

window.addEventListener("keydown", e => {
  const tool = toolForKey(e.key);
  if (tool) placement.setTool(tool);
});

// ---------- loop ----------
let speed = 1;
let acc = 0;
let viewTime = 0;
engine.runRenderLoop(() => {
  const frameDt = Math.min(engine.getDeltaTime() / 1000, 0.1) * speed;
  viewTime += frameDt;
  acc += frameDt;
  while (acc >= SIM_TICK) {
    tick(state, grid);
    acc -= SIM_TICK;
    if (state.tide.peaked) save();
  }
  views.sync(state);
  terrain.update(camera.position, state.tide.level, state.tide.wetLevel);
  water.update(viewTime, camera.position, state.tide.level);
  hud.update({ tool: placement.tool, blocker: placement.blocker, state });
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
    views.sync(state);
  },
  setSpeed(n: number) {
    speed = n;
  },
  /** Cheat for scripted scenarios. */
  grant(money: number) {
    state.resources.money += money;
  },
  save,
  newTown,
  engine, scene, camera, placement,
};
(window as unknown as { __tidewater: typeof api }).__tidewater = api;
scene.executeWhenReady(() => { api.ready = true; });
