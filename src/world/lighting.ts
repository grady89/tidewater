// Time of day: the study's NOON → DUSK lerp, driven by sim time. Every light-dependent uniform is derived from one
// `dusk` value in 0..1; the shaders themselves are untouched (they already take these uniforms).
import { Color3, DirectionalLight, HemisphericLight, Scene, Vector3 } from "@babylonjs/core";
import { DUSK_MIN, duskAt } from "../sim/daylight";

export { DUSK_MIN, duskAt };

const c3 = (h: string) => { const c = Color3.FromHexString(h); return new Vector3(c.r, c.g, c.b); };
const NOON = { sun: c3("#fff5e2"), zen: c3("#6fb0de"), hor: c3("#dbeef8"), skyAmb: c3("#a9c8dc"), grAmb: c3("#7d6f58"), fog: c3("#cfe3ef"), water: c3("#bfe0f0") };
const DUSK = { sun: c3("#ff9855"), zen: c3("#4a3f7e"), hor: c3("#f2a878"), skyAmb: c3("#6a5a8e"), grAmb: c3("#3b2e44"), fog: c3("#d99a7d"), water: c3("#c98f86") };

export interface Lighting {
  /** The study's blend factor k = dusk^0.8. */
  k: number;
  sunDir: Vector3;
  sunColor: Vector3;
  sunIntensity: number;
  /** Sun colour as fed to the terrain and water shaders. */
  sunLit: Vector3;
  zenith: Vector3;
  horizon: Vector3;
  skyAmbient: Vector3;
  groundAmbient: Vector3;
  fog: Vector3;
  /** Sky tint reflected by the water's fresnel term. */
  waterSky: Vector3;
  /** Lantern brightness, 0 by day. */
  lamp: number;
}

const lerp3 = (a: Vector3, b: Vector3, k: number) => new Vector3(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);

export function computeLighting(dusk: number): Lighting {
  const elev = (65 - 57 * dusk) * Math.PI / 180, az = (-40 + 30 * dusk) * Math.PI / 180;
  const sunDir = new Vector3(Math.cos(elev) * Math.sin(az), Math.sin(elev), Math.cos(elev) * Math.cos(az)).normalize();
  const k = Math.pow(dusk, 0.8);
  const sunColor = lerp3(NOON.sun, DUSK.sun, k);
  const sunIntensity = 1.0 - 0.35 * k;
  return {
    k, sunDir, sunColor, sunIntensity,
    sunLit: sunColor.scale(sunIntensity),
    zenith: lerp3(NOON.zen, DUSK.zen, k),
    horizon: lerp3(NOON.hor, DUSK.hor, k),
    skyAmbient: lerp3(NOON.skyAmb, DUSK.skyAmb, k),
    groundAmbient: lerp3(NOON.grAmb, DUSK.grAmb, k),
    fog: lerp3(NOON.fog, DUSK.fog, k),
    waterSky: lerp3(NOON.water, DUSK.water, k),
    lamp: Math.pow(Math.max(0, (dusk - 0.45) / 0.55), 1.5) * 2.2,
  };
}

/** The fixed late-morning set, for anything that doesn't animate. */
export const MORNING = computeLighting(DUSK_MIN);

export interface SceneLights {
  sun: DirectionalLight;
  hemi: HemisphericLight;
  apply(l: Lighting): void;
}

/** Scene lights for StandardMaterial props. The terrain/water/sky shaders take the Lighting values directly. */
export function createLights(scene: Scene): SceneLights {
  const sun = new DirectionalLight("sun", MORNING.sunDir.scale(-1), scene);
  const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.9;
  const lights: SceneLights = {
    sun, hemi,
    apply(l) {
      sun.direction = l.sunDir.scale(-1);
      sun.diffuse = new Color3(l.sunColor.x, l.sunColor.y, l.sunColor.z);
      sun.intensity = 1.1 * l.sunIntensity;
      hemi.diffuse = new Color3(l.skyAmbient.x, l.skyAmbient.y, l.skyAmbient.z);
      hemi.groundColor = new Color3(l.groundAmbient.x, l.groundAmbient.y, l.groundAmbient.z);
    },
  };
  lights.apply(MORNING);
  return lights;
}
