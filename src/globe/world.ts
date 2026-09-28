// The World: a second Babylon Scene on the island's engine — a dodecahedron of twelve seas at island scale,
// each face the game's water shader with its own heightmap, built faces carrying a miniature of their real
// island (terrain shader, roof instances from the real buildings, water at the real tide). Each face is lit by its
// own sun (the island's, by the player's clock) and dimmed by a gentle terminator away from the stage light; the
// stage behind is a dusk gradient with a glow and stars; an atmosphere shell carries two bands of clouds. An
// empty face whose card is open previews the island its seed would make. Reads sector records; writes nothing
// into any ledger.
import { ArcRotateCamera, Color3, Color4, DefaultRenderingPipeline, Engine, FreeCamera, FresnelParameters, Matrix, Mesh, MeshBuilder, Quaternion, RawTexture, Scene, ShaderMaterial, StandardMaterial, Texture, TransformNode, Vector2, Vector3, VertexBuffer, VertexData } from "@babylonjs/core";
import { SIZE } from "../config";
import { DUSK_MIN } from "../sim/daylight";
import { HeightFn } from "../sim/heightfield";
import { biomeOf, BiomeId } from "../sim/biomes";
import { island } from "../sim/island";
import { tidesFor } from "../sim/tides";
import { SectorRecord } from "../sim/sectors";
import { SimState } from "../sim/state";
import { terrainFS, terrainVS } from "../../shaders/terrain";
import { waterFS, waterVS } from "../../shaders/water";
import { flatMaterial, mergeFlat, tint } from "../world/flatMesh";
import { computeLighting, createLights, Lighting, SceneLights } from "../world/lighting";
import { applyTerrainLook, encodeHeightInto, TERRAIN_SAMPLERS, TERRAIN_UNIFORMS } from "../world/terrain";
import { applyWaterLook, WATER_UNIFORMS } from "../world/water";
import { lookOf, TIDEWATER_LOOK } from "../view/biomes";
import { clampToPentagon, EDGE, EDGES, Face, FACE_CIRCUMRADIUS, FACES, faceToward, insidePentagon, pentagonDisc, SOLID_CIRCUMRADIUS, toLocal, V3 } from "./geometry";
import { MINI_CELLS, miniatureHeights, roofPlacements } from "./miniature";

// ---------- tuning (docs/globe/motion.md) ----------
const CAM_RADIUS = 340, CAM_MIN = 230, CAM_MAX = 420;
const INERTIA = 0.92, WHEEL_PRECISION = 24, PINCH_PRECISION = 60;
const IDLE_AFTER = 4, IDLE_RATE = 0.035, IDLE_RAMP = 2;
/** The hovered face rises and brightens: 2 units barely read at the orbit (review.md), 5 do. */
const HOVER_LIFT = 5, HOVER_UP = 0.18, HOVER_DOWN = 0.24, HOVER_SUN = 0.25;
/** The globe is the thing that turns (a trackball under the pointer); the camera only zooms. */
const SPIN_RAD_PER_PX = 0.0055, SPIN_EASE = 10, SPIN_STOP = 0.0004, SPIN_FLICK_MAX = 2.5;
const KEY_STEP = 0.4;
/** The camera looks at the globe from a touch below a ring face's normal, so the horizon's glow shows along the top. */
const LOOK_TILT = 0.14;
const RING_Y = 0.9, RING_INSET = 0.965;
// Fog bands from the camera (which orbits at 230–420): a built sea is nearly clear at the front and hazes toward
// the far side; an uncharted sea is half fog at the front — a pale wash that still reads as water; the entrance
// starts inside the fog and pulls it out.
const FOG_WORLD: [number, number] = [300, 700], FOG_UNCHARTED: [number, number] = [250, 430], FOG_ENTRANCE: [number, number] = [20, 60];
const RISE_FROM = -60, RISE_SECONDS = 1.6, SWELL_FROM = 3, SWELL_START = 0.4, SWELL_END = 2.4;
const SURFACE_START = 1.2, SURFACE_EACH = 0.5, SURFACE_GAP = 0.25, SURFACE_FROM = -6;
/** Rings of the ocean disc: 48 puts the triangles at ~0.8 × 1.2 units, the island's own water grid density. */
const DISC_RINGS = 48;
const HEIGHT_TEX = 128;
// Clouds: two drifting bands on the atmosphere shell, a third of the old size, white over a grey-blue underside.
const CLOUD_COUNT: Record<string, number> = { high: 18, medium: 18, low: 15 };
const CLOUD_BANDS = [
  { lat: 0.42, jitter: 0.14, tiltX: 0.2, tiltZ: 0, speed: 0.03 },
  { lat: -0.35, jitter: 0.12, tiltX: 0, tiltZ: -0.18, speed: 0.021 },
];
const CLOUD_TOP = "#f4f2ec", CLOUD_UNDER = "#d9dbe0";
const CLOUD_ALPHA = 0.97, CLOUD_FADE_NEAR = 115, CLOUD_FADE_FAR = 175;
/** A cloud over the hovered or selected face thins to this, over about a tenth of a second. */
const CLOUD_OVER_FACE = 0.2, CLOUD_FADE_RATE = 9;
// The stage (docs/globe/review.md, polish two): behind the globe a dusk gradient — deep navy at the top of the
// frame, a warmer indigo at the globe's height, a little darker below — with a soft lavender glow behind the
// globe and a sparse field of small stars. The gradient and glow are vertex colours on a dome computed in code
// (the island's sky shader has a crease at its horizon that showed as a line across the frame); the stars are
// thin instances. The faces keep daylight.
const STAGE_TOP = "#0e1633", STAGE_MID = "#33295a", STAGE_LOW = "#221c40", STAGE_GLOW = "#7d6fb0";
/** The glow's strength at its centre (behind the globe) and its angular width (radians). */
const STAGE_GLOW_STRENGTH = 0.45, STAGE_GLOW_WIDTH = 0.3;
const STAGE_RADIUS = 900, STAR_COUNT = 420, STAR_RADIUS = 850, STAR_SIZE = 2.2;
/** The stage light (toward it, world space): upper left, a little in front, so the terminator sits on the far limb. */
const STAGE_SUN = new Vector3(-0.5, 0.62, -0.6).normalize();
/** The terminator: a face turned from the stage light keeps this much of its light (gentle, not night). */
const TERMINATOR_FLOOR = 0.62, TERMINATOR_FROM = -0.35, TERMINATOR_TO = 0.3;
/** The atmosphere: a translucent shell just outside the solid, bright at the limb (fresnel), the clouds ride on it. */
const ATMOS_R = SOLID_CIRCUMRADIUS + 5, ATMOS_COLOR = "#9cc3e6", ATMOS_RIM = 0.75, ATMOS_FADE_NEAR = 95, ATMOS_FADE_FAR = 150;
/**
 * The miniature's sand band: the bands are lifted so dry sand runs this far above the water line at any tide (world
 * units). Measured at the default distance (api.world.coast): a median band of 4.7 CSS px on a Tidewater face at
 * high tide, 3.3 px on the Atoll; at 0.2 the Tidewater band is 2.7 px and the Atoll's under 1.
 */
const SAND_RISE = 0.45;
/** A seed preview surfaces over this long; its water sits at mean sea level. */
const PREVIEW_RISE = 0.5, PREVIEW_LEVEL = 0;

const outCubic = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const inOutCubic = (t: number) => { t = Math.min(1, Math.max(0, t)); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const V = (p: V3) => new Vector3(p.x, p.y, p.z);

/** A camera framing in a face's own (island) coordinates: what the island's ArcRotateCamera would show. */
export interface Framing { cx: number; cz: number; targetY: number; radius: number; alpha: number; beta: number }
/** A free camera pose in world space. */
interface Pose { position: Vector3; target: Vector3; up: Vector3 }

export interface WorldOptions {
  /** Reduced motion: no drift, no rise, cuts instead of flights. */
  reducedMotion: () => boolean;
  /** Local time of day in hours (0–24); the sun follows it. */
  clock?: () => number;
}

interface FaceView {
  face: Face;
  node: TransformNode;
  land: TransformNode;
  water: Mesh;
  waterMat: ShaderMaterial;
  heightTex: RawTexture;
  hdata: Uint8Array;
  terrain: Mesh | null;
  terrainMat: ShaderMaterial | null;
  roofs: Mesh[];
  ring: Mesh;
  record: SectorRecord | null;
  lift: number;
  liftGoal: number;
  /** Terrain rise during the entrance (or a seed preview's surfacing), 0..1. */
  surfaced: number;
  /** When a seed preview started surfacing (performance.now()), or null. */
  riseStart: number | null;
  /** The terminator's share of the light this frame (1 toward the stage light, TERMINATOR_FLOOR turned away). */
  shade: number;
  fog: [number, number];
  swell: number;
}

/** The island camera's position for a framing (Babylon's ArcRotateCamera formula), in face-local units. */
function arcPosition(f: Framing): V3 {
  return { x: f.cx + f.radius * Math.cos(f.alpha) * Math.sin(f.beta), y: f.targetY + f.radius * Math.cos(f.beta), z: f.cz + f.radius * Math.sin(f.alpha) * Math.sin(f.beta) };
}

export class World {
  readonly scene: Scene;
  readonly camera: ArcRotateCamera;
  readonly flight: FreeCamera;
  readonly pipe: DefaultRenderingPipeline;
  private readonly lights: SceneLights;
  /** The stage's frame: the camera's up and forward at the orbit (the gradient runs along up, the glow sits on forward). */
  private readonly stageUp: Vector3;
  private readonly stageForward: Vector3;
  private readonly root: TransformNode;
  readonly faces: FaceView[] = [];
  private readonly dummyReflect: RawTexture;
  private readonly cloudMesh: Mesh;
  private readonly atmosphere: Mesh;
  private readonly stars: Mesh;
  private clouds: { band: number; lat: number; lon: number; r: number; speed: number; scale: number; yaw: number; alpha: number }[] = [];
  private cloudMatrices = new Float32Array(0);
  private cloudColors = new Float32Array(0);
  /** The empty face whose card previews a seed's island, if any. */
  private preview: { face: number; seed: number; biome: BiomeId } | null = null;
  private cloudCount = CLOUD_COUNT.high;
  /** The thirty edge rails with their sea-lane gates, one merged mesh. */
  readonly edges: Mesh;
  hover: number | null = null;
  private selected: number | null = null;
  private lastInput = 0;
  private idle = 0;
  /** The globe's spin: where it is, where it is easing to, and the drag's leftover velocity (pixels per frame). */
  private spinNow = Quaternion.Identity();
  private spinGoal = Quaternion.Identity();
  private spinVel = { x: 0, y: 0 };
  private dragging = false;
  private dragAt = 0;
  private readonly ringMat: StandardMaterial;
  private time = 0;
  private phase: "entering" | "idle" | "flying" | "away" = "idle";
  private entrance = 0;
  private lighting: Lighting = computeLighting(DUSK_MIN, 0.25);
  /** Flights and the entrance run on the wall clock, so a tab that stalls or throttles its frames lands them on its next frame. */
  private flightAnim: { from: Pose; to: Pose; start: number; seconds: number; done: () => void } | null = null;
  private entranceStart = 0;
  private orbitPose: { alpha: number; beta: number; radius: number } | null = null;
  entranceDone = true;

  constructor(readonly engine: Engine, private readonly canvas: HTMLCanvasElement, private readonly opts: WorldOptions) {
    const scene = new Scene(engine);
    this.scene = scene;
    const clear = Color3.FromHexString(STAGE_TOP);
    scene.clearColor = new Color4(clear.r, clear.g, clear.b, 1);
    scene.autoClear = true;
    // The camera sits still (its angles are pinned) and only zooms; drags spin the globe under it.
    const lookBeta = Math.acos(FACES[1].normal.y) + LOOK_TILT, lookAlpha = -Math.PI / 2;
    this.camera = new ArcRotateCamera("worldCam", lookAlpha, lookBeta, CAM_RADIUS, Vector3.Zero(), scene);
    const cam = this.camera;
    cam.minZ = 1; cam.maxZ = 2000;
    cam.lowerRadiusLimit = CAM_MIN; cam.upperRadiusLimit = CAM_MAX;
    cam.lowerAlphaLimit = lookAlpha; cam.upperAlphaLimit = lookAlpha;
    cam.lowerBetaLimit = lookBeta; cam.upperBetaLimit = lookBeta;
    cam.inertia = INERTIA;
    cam.wheelPrecision = WHEEL_PRECISION; cam.pinchPrecision = PINCH_PRECISION;
    cam.panningSensibility = 0;
    cam.useNaturalPinchZoom = true;
    cam.inputs.removeByType("ArcRotateCameraKeyboardMoveInput");
    this.flight = new FreeCamera("flight", new Vector3(0, 0, -CAM_RADIUS), scene);
    this.flight.minZ = 1; this.flight.maxZ = 2000;
    this.lights = createLights(scene);
    const elev = Math.PI / 2 - lookBeta;
    this.stageUp = new Vector3(0, Math.cos(elev), Math.sin(elev));
    this.stageForward = new Vector3(0, -Math.sin(elev), Math.cos(elev));
    this.buildStage();
    this.pipe = new DefaultRenderingPipeline("worldpp", false, scene, [cam, this.flight]);
    this.pipe.fxaaEnabled = true;
    this.pipe.bloomEnabled = true; this.pipe.bloomThreshold = 0.9; this.pipe.bloomWeight = 0.15; this.pipe.bloomKernel = 48; this.pipe.bloomScale = 0.5;
    this.root = new TransformNode("globe", scene);
    this.root.rotationQuaternion = Quaternion.Identity();
    const dummy = new Uint8Array([120, 160, 180, 255]);
    this.dummyReflect = RawTexture.CreateRGBATexture(dummy, 1, 1, scene, false, false, Texture.NEAREST_SAMPLINGMODE);
    // The selection ring's material: lantern light, a little of it self-lit so the bloom catches it.
    this.ringMat = flatMaterial(scene).clone("ringMat") as StandardMaterial;
    this.ringMat.emissiveColor = Color3.FromHexString("#ffb859").scale(0.45);
    for (const face of FACES) this.faces.push(this.buildFace(face));
    this.edges = this.buildEdges();
    this.atmosphere = this.buildAtmosphere();
    this.stars = this.buildStars();
    this.cloudMesh = this.buildClouds();
    this.setCloudCount(this.cloudCount);
    // The camera's own inputs keep only the zoom (wheel, pinch): its angles are pinned above.
    cam.attachControl(canvas, true);
    for (const ev of ["pointerdown", "pointermove", "wheel", "touchstart"]) canvas.addEventListener(ev, () => { this.lastInput = this.time; }, { passive: true });
  }

  // ---------- the spin ----------

  /** `q` followed by a turn of `angle` about a world-space `axis`. */
  private static turned(q: Quaternion, axis: Vector3, angle: number): Quaternion {
    if (angle === 0) return q.clone();
    // Always back to unit length: a quaternion that drifts off it becomes a scale on the globe.
    return Quaternion.FromRotationMatrix(q.toRotationMatrix(new Matrix()).multiply(Matrix.RotationAxis(axis.normalizeToNew(), angle))).normalize();
  }

  /** A pointer drag of (dx, dy) pixels turns the globe about the camera's up and right axes. */
  drag(dx: number, dy: number, flick = true): void {
    this.lastInput = this.time;
    this.dragging = true;
    // The flick's speed in pixels per millisecond from the gap since the last event, capped (bursts can't over-spin).
    const now = performance.now();
    const ms = Math.min(100, Math.max(4, now - this.dragAt));
    this.dragAt = now;
    const cap = (v: number) => Math.max(-SPIN_FLICK_MAX, Math.min(SPIN_FLICK_MAX, v));
    this.spinVel = flick ? { x: cap(dx / ms), y: cap(dy / ms) } : { x: 0, y: 0 };
    this.spinNow = this.turnBy(this.spinNow, dx, dy);
    this.spinGoal = this.spinNow.clone();
  }
  /** The pointer went down: whatever was still turning stops. */
  grab(): void { this.spinVel = { x: 0, y: 0 }; this.dragging = true; this.dragAt = performance.now(); this.spinGoal = this.spinNow.clone(); }
  /** The pointer came up: the last drag's speed carries on and decays. */
  release(): void { this.dragging = false; }

  private turnBy(q: Quaternion, dx: number, dy: number): Quaternion {
    const up = this.camera.getDirection(Vector3.Up()), right = this.camera.getDirection(Vector3.Right());
    return World.turned(World.turned(q, up, -dx * SPIN_RAD_PER_PX), right, -dy * SPIN_RAD_PER_PX);
  }

  /** The face the camera sees head-on, in the globe's own (unspun) frame. */
  private toGlobe(dirWorld: Vector3): V3 {
    const inv = Matrix.Invert(this.spinNow.toRotationMatrix(new Matrix()));
    const d = Vector3.TransformNormal(dirWorld, inv);
    return { x: d.x, y: d.y, z: d.z };
  }

  /** The globe's spin, for probes. */
  get spin(): Quaternion { return this.spinNow.clone(); }

  // ---------- construction ----------

  private waterMaterial(name: string, heightTex: RawTexture): ShaderMaterial {
    const m = new ShaderMaterial(name, this.scene, { vertexSource: waterVS, fragmentSource: waterFS }, {
      attributes: ["position"], uniforms: WATER_UNIFORMS, samplers: ["heightTex", "reflectTex"], needAlphaBlending: true,
    });
    m.setTexture("heightTex", heightTex).setTexture("reflectTex", this.dummyReflect);
    m.setFloat("waveAmp", 1).setVector2("waveDir", new Vector2(0, 1)).setFloat("waveFront", -999).setFloat("waveHeight", 0).setFloat("waveWidth", 3);
    m.setFloat("reflectMix", 0).setFloat("caustics", 0).setFloat("time", 0).setMatrix("frame", Matrix.Identity());
    m.setFloat("fogNear", FOG_WORLD[0]).setFloat("fogFar", FOG_WORLD[1]);
    applyWaterLook(m, TIDEWATER_LOOK);
    m.backFaceCulling = false;
    return m;
  }

  private buildFace(face: Face): FaceView {
    const scene = this.scene;
    const node = new TransformNode(`face${face.index}`, scene);
    node.parent = this.root;
    node.rotationQuaternion = Quaternion.FromRotationMatrix(Matrix.FromArray(face.matrix).getRotationMatrix());
    node.position = V(face.centre);
    const land = new TransformNode(`land${face.index}`, scene);
    land.parent = node;
    const disc = pentagonDisc(face, DISC_RINGS);
    const water = new Mesh(`sea${face.index}`, scene);
    const vd = new VertexData();
    vd.positions = disc.positions; vd.indices = disc.indices;
    const normals: number[] = [];
    for (let k = 0; k < disc.positions.length / 3; k++) normals.push(0, 1, 0);
    vd.normals = normals;
    vd.applyToMesh(water);
    water.parent = node;
    water.alphaIndex = 10;
    water.isPickable = true;
    water.metadata = { face: face.index };
    const hdata = new Uint8Array(HEIGHT_TEX * HEIGHT_TEX * 4);
    for (let row = 0; row < HEIGHT_TEX; row++) for (let col = 0; col < HEIGHT_TEX; col++) encodeHeightInto(hdata, HEIGHT_TEX, row, col, -1.5);
    const heightTex = RawTexture.CreateRGBATexture(hdata, HEIGHT_TEX, HEIGHT_TEX, scene, false, false, Texture.BILINEAR_SAMPLINGMODE);
    heightTex.wrapU = Texture.CLAMP_ADDRESSMODE; heightTex.wrapV = Texture.CLAMP_ADDRESSMODE;
    const waterMat = this.waterMaterial(`seaMat${face.index}`, heightTex);
    water.material = waterMat;
    const ring = this.buildRing(face);
    ring.parent = node;
    ring.setEnabled(false);
    return { face, node, land, water, waterMat, heightTex, hdata, terrain: null, terrainMat: null, roofs: [], ring, record: null, lift: 0, liftGoal: 0, surfaced: 1, riseStart: null, shade: 1, fog: FOG_UNCHARTED, swell: 1 };
  }

  /** The selection ring: five lantern-lit rails just inside a face's outline, shown on the face whose card is open. */
  private buildRing(face: Face): Mesh {
    const parts: Mesh[] = [];
    const up = Vector3.Up();
    for (let k = 0; k < 5; k++) {
      const a = toLocal(face, face.corners[k]), b = toLocal(face, face.corners[(k + 1) % 5]);
      const along = new Vector3(b.x - a.x, 0, b.z - a.z).normalize();
      const across = Vector3.Cross(along, up).normalize();
      const seg = MeshBuilder.CreateBox("ringSeg", { width: EDGE * RING_INSET - 1.2, height: 0.35, depth: 0.6 }, this.scene);
      const rot = Matrix.Identity();
      Matrix.FromXYZAxesToRef(along, up, across, rot);
      seg.rotationQuaternion = Quaternion.FromRotationMatrix(rot);
      seg.position.set(((a.x + b.x) / 2) * RING_INSET, RING_Y, ((a.z + b.z) / 2) * RING_INSET);
      parts.push(tint(seg, "#ffb859"));
    }
    const ring = mergeFlat(`ring${face.index}`, parts, this.scene);
    ring.material = this.ringMat;
    return ring;
  }

  private buildEdges(): Mesh {
    const parts: Mesh[] = [];
    for (const [a, b] of EDGES) {
      const mid = new Vector3((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      const out = mid.clone().normalize(); // (normalize() works in place: keep the midpoint itself)
      const along = V(b).subtract(V(a)).normalize();
      const across = Vector3.Cross(along, out).normalize();
      const rail = MeshBuilder.CreateBox("rail", { width: EDGE - 1.2, height: 0.35, depth: 0.6 }, this.scene);
      const gate = MeshBuilder.CreateBox("gate", { width: 3.2, height: 0.45, depth: 1.4 }, this.scene);
      for (const [m, hex] of [[rail, "#b9a377"], [gate, "#e6d3a1"]] as [Mesh, string][]) {
        const rot = Matrix.Identity();
        Matrix.FromXYZAxesToRef(along, out, across, rot);
        m.rotationQuaternion = Quaternion.FromRotationMatrix(rot);
        m.position = mid.add(out.scale(0.25));
        parts.push(tint(m, hex));
      }
    }
    const edges = mergeFlat("edges", parts, this.scene);
    edges.parent = this.root;
    return edges;
  }

  /** The stage dome: a sphere around the camera, coloured per vertex by its height up the frame and its angle from the globe. */
  private buildStage(): Mesh {
    const dome = MeshBuilder.CreateSphere("stage", { diameter: 2 * STAGE_RADIUS, segments: 64, sideOrientation: Mesh.BACKSIDE }, this.scene);
    const pos = dome.getVerticesData(VertexBuffer.PositionKind)!;
    const top = Color3.FromHexString(STAGE_TOP), mid = Color3.FromHexString(STAGE_MID), low = Color3.FromHexString(STAGE_LOW), glow = Color3.FromHexString(STAGE_GLOW);
    const colors = new Float32Array((pos.length / 3) * 4);
    const d = new Vector3();
    for (let v = 0; v < pos.length / 3; v++) {
      d.set(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]).normalize();
      const up = Vector3.Dot(d, this.stageUp);
      const c = up >= 0 ? Color3.Lerp(mid, top, smooth(-0.02, 0.42, up)) : Color3.Lerp(mid, low, smooth(0, -0.55, up));
      const angle = Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(d, this.stageForward))));
      const g = STAGE_GLOW_STRENGTH * Math.exp(-((angle / STAGE_GLOW_WIDTH) ** 2));
      colors[v * 4] = Math.min(1, c.r + glow.r * g); colors[v * 4 + 1] = Math.min(1, c.g + glow.g * g); colors[v * 4 + 2] = Math.min(1, c.b + glow.b * g); colors[v * 4 + 3] = 1;
    }
    dome.setVerticesData(VertexBuffer.ColorKind, colors);
    const mat = new StandardMaterial("stageMat", this.scene);
    mat.disableLighting = true;
    mat.emissiveColor = Color3.White();
    mat.backFaceCulling = false;
    dome.material = mat;
    dome.infiniteDistance = true;
    dome.isPickable = false;
    return dome;
  }

  /** Small flat stars scattered over the stage, thicker toward the top, none below the globe's height. */
  private buildStars(): Mesh {
    const star = MeshBuilder.CreatePolyhedron("star", { type: 1, size: STAR_SIZE / 2 }, this.scene);
    tint(star, "#ffffff");
    const mat = new StandardMaterial("starMat", this.scene);
    mat.disableLighting = true;
    mat.emissiveColor = Color3.White();
    star.material = mat;
    star.isPickable = false;
    star.infiniteDistance = true;
    const upQ = new Quaternion();
    Quaternion.FromUnitVectorsToRef(Vector3.Up(), this.stageUp, upQ);
    const up = upQ.toRotationMatrix(new Matrix());
    let seed = 7;
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const m: number[] = [], c: number[] = [];
    while (m.length < STAR_COUNT * 16) {
      // Uniform on the sphere, kept above the stage's horizon (thinning as they near it).
      const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z);
      const local = new Vector3(r * Math.cos(a), z, r * Math.sin(a));
      if (local.y < 0.04 || rnd() > local.y * 2.5) continue;
      const d = Vector3.TransformNormal(local, up).scale(STAR_RADIUS);
      const k = 0.5 + rnd() * 0.9;
      Matrix.Compose(new Vector3(k, k, k), Quaternion.RotationYawPitchRoll(rnd() * 6, rnd() * 6, 0), d).copyToArray(m, m.length);
      const b = 0.55 + rnd() * 0.45;
      c.push(b, b, Math.min(1, b * 1.08), 1);
    }
    star.thinInstanceSetBuffer("matrix", new Float32Array(m), 16, false);
    star.thinInstanceSetBuffer("color", new Float32Array(c), 4, false);
    star.alwaysSelectAsActiveMesh = true;
    return star;
  }

  /** The atmosphere: a sphere just outside the solid, clear where it faces the camera and bright at the limb. */
  private buildAtmosphere(): Mesh {
    const shell = MeshBuilder.CreateSphere("atmosphere", { diameter: 2 * ATMOS_R, segments: 48 }, this.scene);
    const m = new StandardMaterial("atmosphereMat", this.scene);
    const c = Color3.FromHexString(ATMOS_COLOR);
    m.diffuseColor = c.scale(0.35);
    m.specularColor = Color3.Black();
    m.emissiveColor = c;
    // Babylon's fresnel term is pow(bias + |N·V|, power): 1 facing the camera, 0 at the limb; left is the limb's
    // value, right the centre's. The opacity term is added to the material's alpha, so that stays near zero.
    m.emissiveFresnelParameters = new FresnelParameters({ bias: 0, power: 0.6, leftColor: Color3.White(), rightColor: Color3.Black() });
    m.opacityFresnelParameters = new FresnelParameters({ bias: 0, power: 0.45, leftColor: new Color3(ATMOS_RIM, ATMOS_RIM, ATMOS_RIM), rightColor: Color3.Black() });
    m.alpha = 0.001;
    m.disableDepthWrite = true;
    m.backFaceCulling = true;
    shell.material = m;
    shell.alphaIndex = 20;
    shell.isPickable = false;
    shell.parent = this.root;
    return shell;
  }

  /** One cloud: five flattened blobs, white on top and grey-blue underneath (by each facet's normal). */
  private buildClouds(): Mesh {
    const parts: Mesh[] = [];
    for (const [x, y, z, d] of [[0, 0, 0, 12], [7, -0.6, 2.4, 8.6], [-7.6, -0.9, -1.4, 7.6], [2.4, 1, -6.2, 6.8], [-3.4, 0.5, 5.8, 6.2]]) {
      const b = MeshBuilder.CreateSphere("cloud", { diameter: d / 3, segments: 4 }, this.scene);
      b.scaling.y = 0.42;
      b.position.set(x / 3, y / 3, z / 3);
      parts.push(tint(b, CLOUD_TOP));
    }
    const mesh = mergeFlat("clouds", parts, this.scene);
    const normals = mesh.getVerticesData(VertexBuffer.NormalKind)!;
    const colors = mesh.getVerticesData(VertexBuffer.ColorKind)!;
    const top = Color3.FromHexString(CLOUD_TOP), under = Color3.FromHexString(CLOUD_UNDER);
    for (let v = 0; v < normals.length / 3; v++) {
      const k = normals[v * 3 + 1] < -0.15 ? under : top;
      colors[v * 4] = k.r; colors[v * 4 + 1] = k.g; colors[v * 4 + 2] = k.b; colors[v * 4 + 3] = 1;
    }
    mesh.setVerticesData(VertexBuffer.ColorKind, colors);
    const mat = flatMaterial(this.scene).clone("cloudMat") as StandardMaterial;
    mat.alpha = CLOUD_ALPHA;
    // Mostly self-lit, so they read white on the shaded side and from under the globe; the sun adds the rest.
    mat.emissiveColor = new Color3(0.72, 0.72, 0.72);
    mesh.material = mat;
    mesh.parent = this.root;
    mesh.alphaIndex = 30;
    mesh.alwaysSelectAsActiveMesh = true;
    return mesh;
  }

  /** Seeded places in the two bands: a latitude jittered about the band's, a longitude, a size, a heading. */
  setCloudCount(n: number): void {
    this.cloudCount = n;
    let seed = 11;
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    this.clouds = [];
    for (let k = 0; k < n; k++) {
      const band = k % CLOUD_BANDS.length, b = CLOUD_BANDS[band];
      this.clouds.push({ band, lat: b.lat + (rnd() - 0.5) * 2 * b.jitter, lon: rnd() * Math.PI * 2, r: ATMOS_R + rnd() * 1.5, speed: b.speed * (0.85 + rnd() * 0.3), scale: 0.8 + rnd() * 0.6, yaw: rnd() * Math.PI * 2, alpha: 1 });
    }
    this.cloudMatrices = new Float32Array(Math.max(1, n) * 16);
    this.cloudColors = new Float32Array(Math.max(1, n) * 4).fill(1);
    this.cloudMesh.setEnabled(n > 0);
  }

  /** Where a cloud is, in the globe's own (unspun) frame: its band's circle, turned by the band's tilt. */
  private cloudAt(c: { band: number; lat: number; lon: number; r: number }): Vector3 {
    const b = CLOUD_BANDS[c.band];
    const p = new Vector3(Math.cos(c.lat) * Math.cos(c.lon), Math.sin(c.lat), Math.cos(c.lat) * Math.sin(c.lon)).scale(c.r);
    return Vector3.TransformCoordinates(p, Matrix.RotationX(b.tiltX).multiply(Matrix.RotationZ(b.tiltZ)));
  }

  /** Does a cloud at `pos` (globe frame, footprint radius `r`) lie over face `face`? Its centre or any rim point. */
  private static cloudOver(pos: Vector3, r: number, face: number): boolean {
    const d = pos.normalizeToNew();
    const t1 = Vector3.Cross(d, Math.abs(d.y) < 0.9 ? Vector3.Up() : Vector3.Right()).normalize(), t2 = Vector3.Cross(d, t1);
    const at = (v: Vector3) => faceToward({ x: v.x, y: v.y, z: v.z }) === face;
    if (at(d)) return true;
    for (const t of [t1, t1.scale(-1), t2, t2.scale(-1)]) if (at(pos.add(t.scale(r)))) return true;
    return false;
  }

  private syncClouds(dt: number): void {
    if (!this.clouds.length) return;
    const tilt = new Quaternion(), tiltMat = new Matrix();
    const faded = [this.hover, this.selected].filter((f): f is number => f !== null);
    const k = this.opts.reducedMotion() ? 1 : Math.min(1, dt * CLOUD_FADE_RATE);
    this.clouds.forEach((c, i) => {
      c.lon += c.speed * dt;
      const pos = this.cloudAt(c);
      // A cloud lies flat over the face beneath it: its up is the radial direction, whatever the globe's spin.
      Quaternion.FromUnitVectorsToRef(Vector3.Up(), pos.normalizeToNew(), tilt);
      Matrix.FromQuaternionToRef(tilt, tiltMat);
      Matrix.Scaling(c.scale, c.scale, c.scale).multiply(Matrix.RotationY(c.yaw + c.lon)).multiply(tiltMat).multiply(Matrix.Translation(pos.x, pos.y, pos.z)).copyToArray(this.cloudMatrices, i * 16);
      const goal = faded.some(f => World.cloudOver(pos, 4 * c.scale, f)) ? CLOUD_OVER_FACE : 1;
      c.alpha += (goal - c.alpha) * k;
      this.cloudColors[i * 4 + 3] = c.alpha;
    });
    this.cloudMesh.thinInstanceSetBuffer("matrix", this.cloudMatrices, 16, false);
    this.cloudMesh.thinInstanceSetBuffer("color", this.cloudColors, 4, false);
  }

  /** For probes: each cloud's opacity and whether it lies over a face. */
  cloudProbe(face: number): { n: number; over: number; overAlpha: number; otherAlpha: number; radius: number } {
    let over = 0, overAlpha = 0, otherAlpha = 0, radius = 0;
    for (const c of this.clouds) {
      const pos = this.cloudAt(c);
      radius += pos.length() / this.clouds.length;
      if (World.cloudOver(pos, 4 * c.scale, face)) { over++; overAlpha = Math.max(overAlpha, c.alpha); } else otherAlpha = Math.max(otherAlpha, c.alpha);
    }
    return { n: this.clouds.length, over, overAlpha, otherAlpha, radius };
  }

  // ---------- sectors ----------

  /** Show a sector on a face (a real miniature) or clear it (uncharted sea). A real sector replaces any preview. */
  setSector(index: number, record: SectorRecord | null): void {
    const fv = this.faces[index];
    if (this.preview?.face === index) this.preview = null;
    fv.record = record;
    fv.riseStart = null;
    this.clearMiniature(fv);
    if (!record) { this.uncharted(fv); return; }
    this.buildMiniature(fv, { seed: record.state.world.seed, biome: record.state.world.biome, landfill: record.state.landfill, level: record.state.tide.level, state: record.state });
  }

  /**
   * Preview the island a seed would make on an empty face (the new-sea card): the miniature without roofs, water at
   * mean sea level, surfacing like the entrance's seas. Null (or a built face) clears the preview.
   */
  setPreview(face: number | null, seed = 0, biome: BiomeId = "tidewater"): void {
    const prev = this.preview;
    if (prev && prev.face === face && prev.seed === seed && prev.biome === biome && !this.faces[prev.face].record) return;
    if (prev && !this.faces[prev.face].record) { const old = this.faces[prev.face]; this.clearMiniature(old); this.uncharted(old); old.riseStart = null; old.surfaced = 1; }
    this.preview = null;
    if (face === null || this.faces[face].record) return;
    const fv = this.faces[face];
    this.preview = { face, seed, biome };
    this.buildMiniature(fv, { seed, biome, landfill: [], level: PREVIEW_LEVEL, state: null });
    if (this.opts.reducedMotion()) { fv.surfaced = 1; fv.riseStart = null; } else { fv.surfaced = 0; fv.riseStart = performance.now(); }
  }

  /** Each face's terminator shade and hover lift this frame, for probes. */
  get faceLight(): { face: number; shade: number; lift: number }[] { return this.faces.map(f => ({ face: f.face.index, shade: f.shade, lift: f.lift })); }

  /** The stage's star count, for probes. */
  get starCount(): number { return this.stars.thinInstanceCount; }

  /** The seed preview, for probes. */
  get previewing(): { face: number; seed: number; biome: BiomeId } | null { return this.preview ? { ...this.preview } : null; }

  private clearMiniature(fv: FaceView): void {
    fv.terrain?.dispose(); fv.terrain = null;
    fv.terrainMat?.dispose(); fv.terrainMat = null;
    for (const r of fv.roofs) r.dispose(false, true); // each roof mesh owns its cloned material
    fv.roofs = [];
  }

  /** An empty sea: the misted wash at mean sea level, in Tidewater's water. */
  private uncharted(fv: FaceView): void {
    fv.water.position.y = 0;
    for (let row = 0; row < HEIGHT_TEX; row++) for (let col = 0; col < HEIGHT_TEX; col++) encodeHeightInto(fv.hdata, HEIGHT_TEX, row, col, -1.5);
    fv.heightTex.update(fv.hdata);
    fv.fog = FOG_UNCHARTED;
    applyWaterLook(fv.waterMat, TIDEWATER_LOOK);
    fv.waterMat.setFloat("caustics", 0);
  }

  /** A miniature of an island on a face: its heightmap, its ground, its water level and look, and (for a town) its roofs. */
  private buildMiniature(fv: FaceView, o: { seed: number; biome: BiomeId; landfill: number[]; level: number; state: SimState | null }): void {
    const index = fv.face.index;
    const level = o.level;
    fv.water.position.y = level;
    const isl = island(o.seed, o.biome);
    const filled = new Set(o.landfill);
    const tides = tidesFor(biomeOf(o.biome).tide);
    const landfillHeight = tides.landfillHeight;
    const height: HeightFn = (x, z) => {
      const i = Math.floor(x), j = Math.floor(z);
      const h = isl.height(x, z);
      return filled.has((i + SIZE / 2) * SIZE + (j + SIZE / 2)) ? Math.max(h, landfillHeight) : h;
    };
    for (let row = 0; row < HEIGHT_TEX; row++) for (let col = 0; col < HEIGHT_TEX; col++) {
      const x = (col / (HEIGHT_TEX - 1) - 0.5) * SIZE, z = (row / (HEIGHT_TEX - 1) - 0.5) * SIZE;
      const ci = Math.floor(x), cj = Math.floor(z);
      const mat = ci < -SIZE / 2 || ci >= SIZE / 2 || cj < -SIZE / 2 || cj >= SIZE / 2 ? 0 : isl.materials[(ci + SIZE / 2) * SIZE + (cj + SIZE / 2)];
      encodeHeightInto(fv.hdata, HEIGHT_TEX, row, col, height(x, z), mat);
    }
    fv.heightTex.update(fv.hdata);
    fv.fog = FOG_WORLD;
    // The miniature: the island's heights on a coarse grid (2-unit cells, like MINI_CELLS over the island's own
    // square) that covers the whole pentagon and no more — vertices outside it are pulled onto its outline — so
    // the sea floor continues the island's rim under every part of the face's water (the heightmap clamps the
    // same way) and nothing pokes out of the solid. Flat-shaded. CreateGround's row 0 is z = +extent.
    const ext = FACE_CIRCUMRADIUS + 1;
    const n = Math.round(ext * MINI_CELLS / (SIZE / 2));
    const heights = miniatureHeights(isl.height, o.landfill, n, ext, landfillHeight);
    const terrain = MeshBuilder.CreateGround(`mini${index}`, { width: 2 * ext, height: 2 * ext, subdivisions: n }, this.scene);
    const pos = terrain.getVerticesData(VertexBuffer.PositionKind)!;
    const half = SIZE / 2, clampHalf = (v: number) => Math.max(-half, Math.min(half, v));
    for (let row = 0; row <= n; row++) for (let col = 0; col <= n; col++) {
      const k = row * (n + 1) + col;
      const x = pos[k * 3], z = pos[k * 3 + 2];
      if (insidePentagon(fv.face, x, z)) { pos[k * 3 + 1] = heights[(n - row) * (n + 1) + col]; continue; }
      const p = clampToPentagon(fv.face, x, z);
      pos[k * 3] = p.x; pos[k * 3 + 2] = p.z;
      pos[k * 3 + 1] = height(clampHalf(p.x), clampHalf(p.z));
    }
    terrain.updateVerticesData(VertexBuffer.PositionKind, pos);
    terrain.convertToFlatShadedMesh();
    terrain.parent = fv.land;
    terrain.isPickable = false;
    const terrainMat = new ShaderMaterial(`miniMat`, this.scene, { vertexSource: terrainVS, fragmentSource: terrainFS }, { attributes: ["position", "normal"], uniforms: TERRAIN_UNIFORMS, samplers: TERRAIN_SAMPLERS });
    const look = lookOf(o.biome);
    terrainMat.setTexture("heightTex", fv.heightTex);
    applyTerrainLook(terrainMat, look, tides.scale);
    applyWaterLook(fv.waterMat, look, tides.scale);
    terrainMat.setFloat("clipY", -999).setMatrix("frame", Matrix.Identity()).setFloat("fogNear", FOG_WORLD[0]).setFloat("fogFar", FOG_WORLD[1]);
    terrainMat.setFloat("waterLevel", level).setFloat("wetLevel", level + 0.1);
    // The coast, exaggerated: lift the bands so sand runs SAND_RISE above the water line at any tide, then grass, then rock.
    terrainMat.setFloat("coastLift", Math.max(0, level + SAND_RISE - 0.55 * tides.scale));
    terrain.material = terrainMat;
    fv.terrain = terrain; fv.terrainMat = terrainMat;
    // Roofs from the real buildings: three shape meshes with thin instances and per-instance colours.
    if (!o.state) { fv.waterMat.setFloat("caustics", 1); return; }
    const roofs = roofPlacements(o.state);
    const byShape: Record<string, { m: number[]; c: number[] }> = { pyramid: { m: [], c: [] }, gable: { m: [], c: [] }, hipped: { m: [], c: [] } };
    const s = new Vector3(), q = Quaternion.Identity();
    for (const r of roofs) {
      if (!insidePentagon(fv.face, r.x, r.z, 1.5)) continue;
      s.set(r.w * 1.05, 1, r.d * 1.05);
      Matrix.Compose(s, q, new Vector3(r.x, r.y, r.z)).copyToArray(byShape[r.shape].m, byShape[r.shape].m.length);
      const rgb = parseInt(r.colour.slice(1), 16);
      byShape[r.shape].c.push(((rgb >> 16) & 255) / 255, ((rgb >> 8) & 255) / 255, (rgb & 255) / 255, 1);
    }
    for (const [shape, data] of Object.entries(byShape)) {
      if (!data.m.length) continue;
      const mesh = this.roofPrimitive(shape, index);
      mesh.parent = fv.land;
      mesh.thinInstanceSetBuffer("matrix", new Float32Array(data.m), 16, false);
      mesh.thinInstanceSetBuffer("color", new Float32Array(data.c), 4, false);
      fv.roofs.push(mesh);
    }
    fv.waterMat.setFloat("caustics", 1);
  }

  private roofPrimitive(shape: string, face: number): Mesh {
    const scene = this.scene;
    let m: Mesh;
    if (shape === "gable") {
      m = MeshBuilder.CreateCylinder(`roof-gable-${face}`, { diameter: 1.15, height: 1, tessellation: 3 }, scene);
      m.rotation.z = Math.PI / 2;
      m.bakeCurrentTransformIntoVertices();
      m.scaling.set(1, 0.7, 1);
    } else {
      m = MeshBuilder.CreateCylinder(`roof-${shape}-${face}`, { diameterTop: shape === "hipped" ? 0.4 : 0, diameterBottom: 1.45, height: shape === "hipped" ? 0.45 : 0.6, tessellation: 4 }, scene);
      m.rotation.y = Math.PI / 4;
    }
    m.position.y = 0.3;
    m.bakeCurrentTransformIntoVertices();
    tint(m, "#ffffff");
    m.convertToFlatShadedMesh();
    m.material = flatMaterial(scene).clone(`roofMat${face}${shape}`) as StandardMaterial;
    m.isPickable = false;
    return m;
  }

  // ---------- state ----------

  /** The face under a client position, or null. */
  pickFace(clientX: number, clientY: number): number | null {
    // Client pixels: Babylon's picking ray applies the hardware scaling level itself.
    const r = this.canvas.getBoundingClientRect();
    const hit = this.scene.pick(clientX - r.left, clientY - r.top, m => m.metadata?.face !== undefined, false, this.scene.activeCamera);
    return hit?.hit && hit.pickedMesh ? (hit.pickedMesh.metadata as { face: number }).face : null;
  }

  setHover(face: number | null): void {
    this.hover = face;
    this.faces.forEach((fv, k) => { fv.liftGoal = k === face ? HOVER_LIFT : 0; });
  }

  /** The face whose card is open wears the ring. */
  setSelected(face: number | null): void {
    if (face === this.selected) return;
    this.selected = face;
    this.faces.forEach((fv, k) => fv.ring.setEnabled(k === face));
  }

  /** The face the camera sees head-on (keyboard focus and the default card). */
  get frontFace(): number {
    return faceToward(this.toGlobe(this.camera.position.subtract(this.root.position).normalize()));
  }

  /** Arrow keys: a step of the globe about the camera's up (dx) or right (dy) axis, eased. */
  step(dx: number, dy: number): void {
    this.lastInput = this.time;
    this.spinVel = { x: 0, y: 0 };
    this.spinGoal = this.turnBy(this.spinGoal, dx * KEY_STEP / SPIN_RAD_PER_PX, dy * KEY_STEP / SPIN_RAD_PER_PX);
    if (this.opts.reducedMotion()) this.spinNow = this.spinGoal.clone();
  }

  /**
   * Turn the globe so a face looks at the camera (the returning launch settles on the last-played face), with
   * the face's original "up" as near the top of the screen as it can be.
   */
  lookAt(face: number, instant = false): void {
    const f = FACES[face];
    const n = new Vector3(f.normal.x, f.normal.y, f.normal.z);
    const to = this.camera.position.subtract(this.root.position).normalize();
    const q = new Quaternion();
    Quaternion.FromUnitVectorsToRef(n, to, q);
    // Roll about the view axis: the direction that was world-up on the standing globe (or, on a polar face, the
    // face's own −z) should point toward the camera's up.
    const polar = Math.abs(f.normal.y) > 0.99;
    const upL = polar ? new Vector3(0, 0, -1) : new Vector3(f.xAxis.y, f.normal.y, f.zAxis.y);
    const camUp = this.camera.getDirection(Vector3.Up());
    const flat = (v: Vector3) => v.subtract(to.scale(Vector3.Dot(v, to))).normalize();
    const have = flat(Vector3.TransformNormal(upL, q.toRotationMatrix(new Matrix()))), want = flat(camUp);
    const angle = Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(have, want))));
    // Try the turn both ways round the axis and keep the one that lands closer (no handedness guesswork).
    const a = World.turned(q, to, angle), b = World.turned(q, to, -angle);
    const score = (r: Quaternion) => Vector3.Dot(flat(Vector3.TransformNormal(upL, r.toRotationMatrix(new Matrix()))), want);
    this.spinGoal = score(a) >= score(b) ? a : b;
    this.spinVel = { x: 0, y: 0 };
    if (instant || this.opts.reducedMotion()) this.spinNow = this.spinGoal.clone();
  }

  /** Quality preset: bloom and how many clouds. */
  setQuality(bloom: boolean, preset: string): void {
    this.pipe.bloomEnabled = bloom;
    this.setCloudCount(CLOUD_COUNT[preset] ?? CLOUD_COUNT.high);
  }

  /** Begin the entrance choreography (docs/globe/hero.md). */
  enter(): void {
    this.time = 0; this.lastInput = 0; this.idle = 0;
    this.phase = "entering"; this.entrance = 0; this.entranceStart = performance.now(); this.entranceDone = false;
    if (this.opts.reducedMotion()) { this.finishEntrance(); return; }
    this.root.position.y = RISE_FROM;
    for (const fv of this.faces) { fv.surfaced = fv.record ? 0 : 1; fv.swell = SWELL_FROM; }
  }

  private finishEntrance(): void {
    this.root.position.y = 0;
    for (const fv of this.faces) { fv.surfaced = 1; fv.swell = 1; }
    this.phase = "idle"; this.entranceDone = true;
  }

  /** The order built faces surface in: last played last. */
  private surfacingOrder(): number[] {
    return this.faces.filter(f => f.record).sort((a, b) => a.record!.meta.lastPlayed - b.record!.meta.lastPlayed).map(f => f.face.index);
  }

  // ---------- flights (dive / return) ----------

  /** The world-space pose of an island framing on a face. */
  poseFor(face: number, f: Framing): Pose {
    // The face node carries the face's frame, its hover lift, and the globe's spin and rise.
    const node = this.faces[face].node;
    node.computeWorldMatrix(true);
    const m = node.getWorldMatrix();
    const w = (p: V3) => Vector3.TransformCoordinates(new Vector3(p.x, p.y, p.z), m);
    return { position: w(arcPosition(f)), target: w({ x: f.cx, y: f.targetY, z: f.cz }), up: Vector3.TransformNormal(Vector3.Up(), m).normalize() };
  }

  private orbitAsPose(): Pose {
    return { position: this.camera.position.clone(), target: this.camera.target.clone(), up: Vector3.Up() };
  }

  private applyPose(p: Pose): void {
    this.flight.upVector = p.up.clone();
    this.flight.position = p.position.clone();
    this.flight.setTarget(p.target);
  }

  /** Fly the World camera from its orbit down to the face's framing. Resolves at the end (at once with reduced motion). */
  flyTo(face: number, framing: Framing, seconds: number): Promise<void> {
    this.lastInput = this.time;
    if (this.phase === "entering") this.finishEntrance(); // a dive during the entrance is "hurry up": the globe lands first
    this.orbitPose = { alpha: this.camera.alpha, beta: this.camera.beta, radius: this.camera.radius };
    const to = this.poseFor(face, framing);
    const from = this.orbitAsPose();
    this.camera.detachControl();
    this.scene.activeCamera = this.flight;
    this.applyPose(from);
    this.phase = "flying";
    return new Promise(resolve => {
      const done = () => { this.applyPose(to); this.phase = "away"; resolve(); };
      if (seconds <= 0 || this.opts.reducedMotion()) { done(); return; }
      this.flightAnim = { from, to, start: performance.now(), seconds, done };
    });
  }

  /** Arrive from the island at the face's framing and fly back up to the orbit. */
  flyBack(face: number, framing: Framing, seconds: number): Promise<void> {
    if (this.phase === "entering") this.finishEntrance();
    const from = this.poseFor(face, framing);
    const orbit = this.orbitPose ?? { alpha: this.camera.alpha, beta: this.camera.beta, radius: this.camera.radius };
    this.camera.alpha = orbit.alpha; this.camera.beta = orbit.beta; this.camera.radius = orbit.radius;
    // The orbit camera has not rendered since the dive: bring its position up to date with its angles before
    // reading it (rebuildAnglesAndRadius would do the reverse and revive the stale position).
    this.camera.getViewMatrix(true);
    const to = this.orbitAsPose();
    this.scene.activeCamera = this.flight;
    this.applyPose(from);
    this.phase = "flying";
    this.lastInput = this.time;
    return new Promise(resolve => {
      const done = () => {
        this.scene.activeCamera = this.camera;
        this.camera.attachControl(this.canvas, true);
        this.phase = "idle";
        resolve();
      };
      if (seconds <= 0 || this.opts.reducedMotion()) { done(); return; }
      this.flightAnim = { from, to, start: performance.now(), seconds, done };
    });
  }

  /** Where the World camera is, for probes. */
  get pose(): { alpha: number; beta: number; radius: number; phase: string; camera: string } {
    return { alpha: this.camera.alpha, beta: this.camera.beta, radius: this.camera.radius, phase: this.phase, camera: this.scene.activeCamera === this.flight ? "flight" : "orbit" };
  }

  get drawCalls(): number { return this.scene.getActiveMeshes().length; }

  /** The globe's rise, for probes: −60 at the start of the entrance, 0 once landed. */
  get globeY(): number { return this.root.position.y; }

  // ---------- per frame ----------

  /** Hours (0–24) to light the World by instead of the real clock; null follows the clock. */
  clockOverride: number | null = null;

  /**
   * The sun by the clock: 06:00 dawn, 12:00 noon, 18:00 sunset, 00:00 midnight (the sim's day fractions). At
   * night the World keeps a moonlit floor the island doesn't need: the seas and the miniatures must stay
   * readable from the sky, so the light never falls below a bright moon.
   */
  private clockLighting(): Lighting {
    const hours = this.clockOverride ?? (this.opts.clock ? this.opts.clock() : (() => { const d = new Date(); return d.getHours() + d.getMinutes() / 60; })());
    const day = (((hours - 6) / 24) % 1 + 1) % 1;
    const dusk = DUSK_MIN + (1 - DUSK_MIN) * (0.5 - 0.5 * Math.cos(2 * Math.PI * (day - 0.25)));
    const l = computeLighting(dusk, day);
    const night = smooth(0.5, 0.15, l.sunIntensity);
    if (night > 0) {
      const moonlit = new Vector3(0.55, 0.62, 0.78);
      l.sunLit = Vector3.Maximize(l.sunLit, moonlit.scale(0.55 * night));
      l.waterSky = Vector3.Maximize(l.waterSky, new Vector3(0.30, 0.40, 0.56).scale(night));
      l.skyAmbient = Vector3.Maximize(l.skyAmbient, new Vector3(0.28, 0.33, 0.45).scale(night));
      l.groundAmbient = Vector3.Maximize(l.groundAmbient, new Vector3(0.20, 0.20, 0.26).scale(night));
      l.sunIntensity = Math.max(l.sunIntensity, 0.5 * night);
    }
    return l;
  }

  render(dt: number): void {
    this.time += dt;
    const reduced = this.opts.reducedMotion();
    // Entrance.
    if (this.phase === "entering") {
      this.entrance = (performance.now() - this.entranceStart) / 1000;
      const e = this.entrance;
      this.root.position.y = RISE_FROM * (1 - outCubic(e / RISE_SECONDS));
      const order = this.surfacingOrder();
      let all = e >= RISE_SECONDS && e >= SWELL_END;
      for (const fv of this.faces) {
        fv.swell = SWELL_FROM + (1 - SWELL_FROM) * outCubic((e - SWELL_START) / (SWELL_END - SWELL_START));
        if (fv.record) {
          const k = order.indexOf(fv.face.index);
          const start = SURFACE_START + k * SURFACE_GAP;
          fv.surfaced = outCubic((e - start) / SURFACE_EACH);
          if (fv.surfaced < 1) all = false;
        }
      }
      if (all) this.finishEntrance();
    }
    const fogT = this.phase === "entering" ? outCubic(this.entrance / RISE_SECONDS) : 1;
    // Flights.
    if (this.flightAnim) {
      const a = this.flightAnim;
      const t = (performance.now() - a.start) / 1000;
      const k = inOutCubic(t / a.seconds);
      const pose: Pose = { position: Vector3.Lerp(a.from.position, a.to.position, k), target: Vector3.Lerp(a.from.target, a.to.target, k), up: Vector3.Lerp(a.from.up, a.to.up, k).normalize() };
      this.applyPose(pose);
      if (t >= a.seconds) { this.flightAnim = null; a.done(); }
    } else if (this.scene.activeCamera === this.flight && this.phase !== "away") {
      // Watchdog: a flight camera left active with no flight running is a bug elsewhere; the orbit is the safe place.
      this.scene.activeCamera = this.camera;
      this.camera.attachControl(this.canvas, true);
      this.phase = "idle";
    }
    // The spin: a drag's leftover speed decays; keyboard and lookAt goals are eased to; idle drifts the globe.
    if (this.scene.activeCamera === this.camera) {
      const ms = dt * 1000, stop = SPIN_STOP / SPIN_RAD_PER_PX / 16;
      if (!this.dragging && (Math.abs(this.spinVel.x) > stop || Math.abs(this.spinVel.y) > stop)) {
        this.spinGoal = this.turnBy(this.spinGoal, this.spinVel.x * ms, this.spinVel.y * ms);
        this.spinNow = this.spinGoal.clone();
        const decay = Math.pow(INERTIA, dt * 60);
        this.spinVel = { x: this.spinVel.x * decay, y: this.spinVel.y * decay };
      } else if (!reduced && this.phase === "idle" && !this.dragging) {
        const since = this.time - this.lastInput;
        this.idle = since > IDLE_AFTER ? Math.min(1, this.idle + dt / IDLE_RAMP) : 0;
        if (this.idle > 0) { this.spinGoal = World.turned(this.spinGoal, Vector3.Up(), IDLE_RATE * outCubic(this.idle) * dt); this.spinNow = this.spinGoal.clone(); }
      }
      if (!this.spinNow.equalsWithEpsilon(this.spinGoal, 1e-7)) { Quaternion.SlerpToRef(this.spinNow, this.spinGoal, reduced ? 1 : 1 - Math.exp(-SPIN_EASE * dt), this.spinNow); this.spinNow.normalize(); }
    }
    this.root.rotationQuaternion!.copyFrom(this.spinNow.normalize());
    // Hover lifts, and a seed preview surfacing.
    const nowMs = performance.now();
    for (const fv of this.faces) {
      if (fv.riseStart !== null) { fv.surfaced = outCubic((nowMs - fv.riseStart) / 1000 / PREVIEW_RISE); if (fv.surfaced >= 1) fv.riseStart = null; }
      const rate = fv.liftGoal > fv.lift ? 1 / HOVER_UP : 1 / HOVER_DOWN;
      fv.lift = reduced ? fv.liftGoal : fv.lift + (fv.liftGoal - fv.lift) * Math.min(1, dt * rate * 3);
      fv.node.position = V(fv.face.centre).add(V(fv.face.normal).scale(fv.lift));
      fv.land.position.y = SURFACE_FROM * (1 - fv.surfaced);
    }
    // Lighting. The clock gives the light's colour (and the moon at night); each face is lit by its own sun — the
    // island's, in the face's frame — so every miniature reads as its island does; the stage light, fixed upper left,
    // puts a gentle terminator on the faces turned from it. Props (roofs, clouds, the atmosphere) take the stage light.
    const light = this.clockLighting();
    this.lighting = light;
    this.lights.apply({ ...light, sunDir: STAGE_SUN });
    const dim = 1 - 0.45 * light.night;
    const fog = Color3.FromHexString(ATMOS_COLOR).scale(dim);
    const fogV = new Vector3(fog.r, fog.g, fog.b);
    const camPos = this.scene.activeCamera!.position;
    // Clouds and the atmosphere thin out as a flight drops through them.
    const camDist = camPos.subtract(this.root.position).length();
    (this.cloudMesh.material as StandardMaterial).alpha = CLOUD_ALPHA * smooth(CLOUD_FADE_NEAR, CLOUD_FADE_FAR, camDist);
    const atmos = this.atmosphere.material as StandardMaterial;
    const rim = ATMOS_RIM * smooth(ATMOS_FADE_NEAR, ATMOS_FADE_FAR, camDist);
    atmos.opacityFresnelParameters!.leftColor = new Color3(rim, rim, rim);
    atmos.emissiveColor = Color3.FromHexString(ATMOS_COLOR).scale(dim);
    for (const fv of this.faces) {
      fv.node.computeWorldMatrix(true);
      const nodeW = fv.node.getWorldMatrix();
      const nW = Vector3.TransformNormal(Vector3.Up(), nodeW).normalize();
      const faceSun = Vector3.TransformNormal(light.sunDir, nodeW).normalize();
      const facing = Vector3.Dot(nW, STAGE_SUN);
      const shade = TERMINATOR_FLOOR + (1 - TERMINATOR_FLOOR) * smooth(TERMINATOR_FROM, TERMINATOR_TO, facing);
      fv.shade = shade;
      const boost = 1 + HOVER_SUN * (fv.lift / HOVER_LIFT);
      const fogNear = FOG_ENTRANCE[0] + (fv.fog[0] - FOG_ENTRANCE[0]) * fogT, fogFar = FOG_ENTRANCE[1] + (fv.fog[1] - FOG_ENTRANCE[1]) * fogT;
      const wm = fv.waterMat;
      fv.water.computeWorldMatrix(true);
      wm.setMatrix("frame", Matrix.Invert(fv.water.getWorldMatrix()));
      wm.setVector3("sunDir", faceSun).setVector3("sunColor", light.sunLit.scale(shade * boost)).setVector3("skyColor", light.waterSky.scale(shade * boost))
        .setVector3("fogColor", fogV).setFloat("dusk", light.k).setFloat("time", this.time).setVector3("camPos", camPos)
        .setFloat("waveAmp", fv.swell).setFloat("fogNear", fogNear).setFloat("fogFar", fogFar);
      if (fv.terrain && fv.terrainMat) {
        fv.terrain.computeWorldMatrix(true);
        fv.terrainMat.setMatrix("frame", Matrix.Invert(fv.terrain.getWorldMatrix()));
        fv.terrainMat.setVector3("sunDir", faceSun).setVector3("sunColor", light.sunLit.scale(shade * boost)).setVector3("skyAmb", light.skyAmbient.scale(shade))
          .setVector3("groundAmb", light.groundAmbient.scale(shade)).setVector3("fogColor", fogV).setVector3("camPos", camPos)
          .setFloat("fogNear", fogNear).setFloat("fogFar", fogFar);
      }
    }
    this.syncClouds(dt);
    this.scene.render();
  }

  /** For the audit: the current lighting. */
  get light(): Lighting { return this.lighting; }
}
