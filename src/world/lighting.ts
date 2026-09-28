// Time of day: the study's NOON → DUSK palette lerp, driven by sim time, plus a sun that arcs over the island
// and a moon that takes over at night. Every light-dependent uniform is derived from one `dusk` value in 0..1 and
// the day fraction; the shaders' colour math is the study's (they take these as uniforms).
import { Color3, DirectionalLight, HemisphericLight, Scene, Vector3 } from "@babylonjs/core";
import { dayFraction, DUSK_MIN, duskAt, moonVector, sunVector } from "../sim/daylight";

export { DUSK_MIN, duskAt, dayFraction };

const c3 = (h: string) => { const c = Color3.FromHexString(h); return new Vector3(c.r, c.g, c.b); };
const NOON = { sun: c3("#fff5e2"), zen: c3("#6fb0de"), hor: c3("#dbeef8"), skyAmb: c3("#a9c8dc"), grAmb: c3("#7d6f58"), fog: c3("#cfe3ef"), water: c3("#bfe0f0") };
const DUSK = { sun: c3("#ff9855"), zen: c3("#4a3f7e"), hor: c3("#f2a878"), skyAmb: c3("#6a5a8e"), grAmb: c3("#3b2e44"), fog: c3("#d99a7d"), water: c3("#c98f86") };
/** Moonlight: cool and dim. */
const MOON = c3("#b9c8e0");
/**
 * Exposure: the study lit a fixed low sun, and with the sun arcing overhead the sand's sunlight plus ambient
 * passes white by late morning (a neon glow once bloom catches it). Above EXPOSURE_KNEE of elevation the eye
 * stops down: sun and ambient scale by 1 / (1 + EXPOSURE_GAIN × (elevation − knee)), ≈ 0.65 at noon, so flat
 * ground stays about as bright at noon as at nine. The sky, fog and horizon are not exposed (they are the
 * light source, not the lit).
 */
const EXPOSURE_KNEE = 0.3;
const EXPOSURE_GAIN = 1.0;

export interface Lighting {
  /** The study's blend factor k = dusk^0.8. */
  k: number;
  /** The direction the scene is lit from: the sun by day, the moon once the sun is under the horizon. */
  sunDir: Vector3;
  sunColor: Vector3;
  sunIntensity: number;
  /** Light colour as fed to the terrain and water shaders (colour × intensity). */
  sunLit: Vector3;
  /** The sun itself, for the sky's disc — may be below the horizon. */
  skySun: Vector3;
  moonDir: Vector3;
  /** How much moon to draw, 0 by day. */
  moon: number;
  /** How dark the sky is, for the stars: 0 by day, 1 at midnight. */
  night: number;
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
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * @param dusk the palette blend, 0 = the study's noon, 1 = its dusk (storms push it up)
 * @param day the day fraction, 0 = dawn, 0.25 = noon, 0.5 = sunset, 0.75 = midnight
 */
export function computeLighting(dusk: number, day = 0.25, fogTint: { tint: string; mix: number } | null = null): Lighting {
  const sv = sunVector(day), mv = moonVector(day);
  const skySun = new Vector3(sv.x, sv.y, sv.z);
  const moonDir = new Vector3(mv.x, mv.y, mv.z);
  const k = Math.pow(dusk, 0.8);
  // The sun lights the scene while it is up; as it sets the light thins to nothing and the moon's cool light
  // comes in as it rises. Both are dim near the horizon, so the hand-over is between two faint states.
  const sunUp = smooth(-0.02, 0.25, sv.y), moonUp = smooth(0.0, 0.3, mv.y);
  const useMoon = sv.y < 0.02;
  const sunColor = useMoon ? MOON : lerp3(NOON.sun, DUSK.sun, k);
  const exposure = 1 / (1 + EXPOSURE_GAIN * Math.max(0, sv.y - EXPOSURE_KNEE));
  const sunIntensity = (useMoon ? 0.35 * moonUp : (1.0 - 0.35 * k) * (0.25 + 0.75 * sunUp)) * exposure;
  // Past dusk the sky keeps darkening toward a deep blue-black as the sun sinks: the study's dusk palette is
  // the sunset, not the night. Everything the sky feeds (horizon, fog, ambient, the water's sky) dims together.
  const night = smooth(0.6, 0.95, dusk) * smooth(-0.1, 0.05, -sv.y);
  const dim = 1 - 0.62 * night;
  const NIGHT_ZEN = new Vector3(0.05, 0.06, 0.12), NIGHT_HOR = new Vector3(0.12, 0.13, 0.22);
  return {
    k, sunDir: useMoon ? moonDir : skySun, sunColor, sunIntensity,
    sunLit: sunColor.scale(sunIntensity),
    skySun, moonDir,
    moon: moonUp * smooth(0.5, 0.75, dusk),
    night,
    zenith: lerp3(lerp3(NOON.zen, DUSK.zen, k), NIGHT_ZEN, night),
    horizon: fogTint && fogTint.mix > 0 ? lerp3(lerp3(lerp3(NOON.hor, DUSK.hor, k), NIGHT_HOR, night), c3(fogTint.tint).scale(dim), fogTint.mix * 0.6) : lerp3(lerp3(NOON.hor, DUSK.hor, k), NIGHT_HOR, night),
    skyAmbient: lerp3(NOON.skyAmb, DUSK.skyAmb, k).scale(dim * exposure),
    groundAmbient: lerp3(NOON.grAmb, DUSK.grAmb, k).scale(dim * exposure),
    fog: fogTint && fogTint.mix > 0 ? lerp3(lerp3(lerp3(NOON.fog, DUSK.fog, k), NIGHT_HOR, night), c3(fogTint.tint).scale(dim), fogTint.mix) : lerp3(lerp3(NOON.fog, DUSK.fog, k), NIGHT_HOR, night),
    waterSky: lerp3(NOON.water, DUSK.water, k).scale(1 - 0.5 * night),
    lamp: Math.pow(Math.max(0, (dusk - 0.45) / 0.55), 1.5) * 2.2,
  };
}

/** The fixed noon set, for anything that doesn't animate. */
export const MORNING = computeLighting(DUSK_MIN, 0.25);

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
