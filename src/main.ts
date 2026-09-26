// Bootstrap engine, scene, and the render loop.
import { ArcRotateCamera, Color4, DefaultRenderingPipeline, Engine, Scene, Vector3 } from "@babylonjs/core";
import { Grid, PieceKind } from "./build/grid";
import { Placement } from "./build/placement";
import { updateNetwork } from "./sim/network";
import { TideClock } from "./sim/tide";
import { Hud, Score } from "./ui/hud";
import { createLights } from "./world/lighting";
import { createSky } from "./world/sky";
import { createTerrain } from "./world/terrain";
import { createTrees } from "./world/trees";
import { createWater } from "./world/water";

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

// Game state.
const tide = new TideClock();
const grid = new Grid();
const placement = new Placement(scene, camera, grid, canvas);
const hud = new Hud(document.getElementById("hud")!, kind => placement.setTool(kind));
let score: Score | null = null;

const TOOL_KEYS: Record<string, PieceKind> = { "1": "house", "2": "walkway", "3": "pier" };
window.addEventListener("keydown", e => {
  const kind = TOOL_KEYS[e.key];
  if (kind) placement.setTool(kind);
});

let t = 0;
engine.runRenderLoop(() => {
  const dt = Math.min(engine.getDeltaTime() / 1000, 0.1);
  t += dt;
  tide.update(dt);
  const stats = updateNetwork(grid, tide.level);
  if (tide.peaked) score = { cycle: tide.cycle, reached: stats.reached, houses: stats.houses };
  placement.syncVisuals();
  terrain.update(camera.position, tide.level, tide.wetLevel);
  water.update(t, camera.position, tide.level);
  hud.update({ tool: placement.tool, tide, score });
  scene.render();
});
window.addEventListener("resize", () => engine.resize());

if (import.meta.env.DEV) (window as unknown as { __tidewater: unknown }).__tidewater = { engine, scene, tide, grid, placement };
