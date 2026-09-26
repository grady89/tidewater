// Fixed late-morning light. Values are baked from the study's time-of-day system
// at its default slider position (dusk = 0.15): NOON/DUSK palettes lerped by k = 0.15^0.8.
import { Color3, DirectionalLight, HemisphericLight, Scene, Vector3 } from "@babylonjs/core";

/** Unit vector pointing toward the sun (elevation 56.45 deg, azimuth -35.5 deg). */
export const SUN_DIR = new Vector3(-0.3209, 0.8334, 0.4499);
export const SUN_COLOR = new Vector3(1.0, 0.8808, 0.7651);
export const SUN_INTENSITY = 0.9233;
/** Sun color as fed to the terrain and water shaders. */
export const SUN_LIT = SUN_COLOR.scale(SUN_INTENSITY);

export const SKY_ZENITH = new Vector3(0.4035, 0.5931, 0.7881);
export const SKY_HORIZON = new Vector3(0.8786, 0.8732, 0.8625);
export const SKY_AMBIENT = new Vector3(0.6086, 0.6897, 0.7957);
export const GROUND_AMBIENT = new Vector3(0.4335, 0.3794, 0.3279);
export const FOG_COLOR = new Vector3(0.8204, 0.8274, 0.8393);
/** Sky tint reflected by the water's fresnel term. */
export const WATER_SKY = new Vector3(0.7576, 0.8088, 0.8501);
/** The study's `dusk` blend factor k; the shaders still take it as a uniform. */
export const DUSK = 0.2192;

/** Scene lights for StandardMaterial props. The terrain/water/sky shaders use the constants above directly. */
export function createLights(scene: Scene): void {
  const sun = new DirectionalLight("sun", SUN_DIR.scale(-1), scene);
  sun.diffuse = new Color3(SUN_COLOR.x, SUN_COLOR.y, SUN_COLOR.z);
  sun.intensity = 1.1 * SUN_INTENSITY;

  const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
  hemi.diffuse = new Color3(SKY_AMBIENT.x, SKY_AMBIENT.y, SKY_AMBIENT.z);
  hemi.groundColor = new Color3(GROUND_AMBIENT.x, GROUND_AMBIENT.y, GROUND_AMBIENT.z);
  hemi.intensity = 0.9;
}
