// Bootstrap engine, scene, and the render loop.
import { ArcRotateCamera, Color4, DefaultRenderingPipeline, Engine, Scene, Vector3 } from "@babylonjs/core";
import { createLights } from "./world/lighting";
import { createTerrain } from "./world/terrain";
import { createWater } from "./world/water";
import { createSky } from "./world/sky";
import { TideClock } from "./sim/tide";
import { createTempDecoration } from "./tempDecoration";

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
camera.useAutoRotationBehavior = true;
camera.autoRotationBehavior!.idleRotationSpeed = 0.045;
camera.autoRotationBehavior!.idleRotationWaitTime = 2500;
camera.autoRotationBehavior!.idleRotationSpinupTime = 2500;

createLights(scene);
const terrain = createTerrain(scene);
const water = createWater(scene, terrain.heightTex);
createSky(scene);
createTempDecoration(scene);

const pipe = new DefaultRenderingPipeline("pp", false, scene, [camera]);
pipe.fxaaEnabled = true;
pipe.bloomEnabled = true; pipe.bloomThreshold = 0.9; pipe.bloomWeight = 0.15; pipe.bloomKernel = 48; pipe.bloomScale = 0.5;

const tide = new TideClock();
let t = 0;
engine.runRenderLoop(() => {
  const dt = Math.min(engine.getDeltaTime() / 1000, 0.1);
  t += dt;
  tide.update(dt);
  terrain.update(camera.position, tide.level, tide.wetLevel);
  water.update(t, camera.position, tide.level);
  scene.render();
});
window.addEventListener("resize", () => engine.resize());

if (import.meta.env.DEV) (window as unknown as { __tidewater: unknown }).__tidewater = { engine, scene, tide };
