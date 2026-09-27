// The World: a second Babylon Scene on the island's engine — a dodecahedron of twelve seas at island scale,
// each face the game's water shader with its own heightmap, built faces carrying a miniature of their real
// island (terrain shader, roof instances from the real buildings, water at the real tide). One sun by the
// player's clock, the island's sky, clouds, fog. Reads sector records; writes nothing into any ledger.
import { ArcRotateCamera, Color4, DefaultRenderingPipeline, Engine, FreeCamera, Matrix, Mesh, MeshBuilder, Quaternion, RawTexture, Scene, ShaderMaterial, StandardMaterial, Texture, TransformNode, Vector2, Vector3, VertexBuffer, VertexData } from "@babylonjs/core";
import { SIZE } from "../config";
import { DUSK_MIN } from "../sim/daylight";
import { HeightFn } from "../sim/heightfield";
import { island } from "../sim/island";
import { SectorRecord } from "../sim/sectors";
import { terrainFS, terrainVS } from "../../shaders/terrain";
import { waterFS, waterVS } from "../../shaders/water";
import { flatMaterial, mergeFlat, tint } from "../world/flatMesh";
import { computeLighting, createLights, Lighting, SceneLights } from "../world/lighting";
import { createSky, Sky } from "../world/sky";
import { encodeHeightInto, TERRAIN_UNIFORMS } from "../world/terrain";
import { WATER_UNIFORMS } from "../world/water";
import { EDGE, EDGES, Face, FACES, faceToward, insidePentagon, pentagonDisc, SOLID_INRADIUS, V3 } from "./geometry";
import { MINI_CELLS, miniatureHeights, roofPlacements } from "./miniature";

// ---------- tuning (docs/globe/motion.md) ----------
const CAM_RADIUS = 340, CAM_MIN = 230, CAM_MAX = 420;
const CAM_BETA_MIN = 0.45, CAM_BETA_MAX = 2.1;
const INERTIA = 0.92, ANGULAR = 900, WHEEL_PRECISION = 24, PINCH_PRECISION = 60;
const IDLE_AFTER = 4, IDLE_RATE = 0.035, IDLE_RAMP = 2;
const HOVER_LIFT = 2, HOVER_UP = 0.18, HOVER_DOWN = 0.24, HOVER_SUN = 0.2;
const KEY_STEP_ALPHA = 0.4, KEY_STEP_BETA = 0.3, KEY_EASE = 0.3;
const FOG_WORLD: [number, number] = [220, 600], FOG_UNCHARTED: [number, number] = [30, 90], FOG_ENTRANCE: [number, number] = [20, 60];
const RISE_FROM = -60, RISE_SECONDS = 1.6, SWELL_FROM = 3, SWELL_START = 0.4, SWELL_END = 2.4;
const SURFACE_START = 1.2, SURFACE_EACH = 0.5, SURFACE_GAP = 0.25, SURFACE_FROM = -6;
/** Rings of the ocean disc: 48 puts the triangles at ~0.8 × 1.2 units, the island's own water grid density. */
const DISC_RINGS = 48;
const HEIGHT_TEX = 128;
const CLOUD_COUNT: Record<string, number> = { high: 40, medium: 24, low: 8 };
const CLOUD_RATE = 0.02;

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
  record: SectorRecord | null;
  lift: number;
  liftGoal: number;
  /** Terrain rise during the entrance, 0..1. */
  surfaced: number;
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
  private readonly sky: Sky;
  private readonly root: TransformNode;
  readonly faces: FaceView[] = [];
  private readonly dummyReflect: RawTexture;
  private readonly cloudMesh: Mesh;
  private clouds: { u: Vector3; v: Vector3; r: number; phase: number; speed: number; scale: number; yaw: number }[] = [];
  private cloudMatrices = new Float32Array(0);
  private cloudCount = CLOUD_COUNT.high;
  /** The thirty edge rails with their sea-lane gates, one merged mesh. */
  readonly edges: Mesh;
  hover: number | null = null;
  /** Pointer lift only; the keyboard/front face is `focus`. */
  private lastInput = 0;
  private idle = 0;
  private keyGoal: { alpha: number; beta: number; t: number } | null = null;
  private time = 0;
  private phase: "entering" | "idle" | "flying" | "away" = "idle";
  private entrance = 0;
  private lighting: Lighting = computeLighting(DUSK_MIN, 0.25);
  private flightAnim: { from: Pose; to: Pose; t: number; seconds: number; done: () => void } | null = null;
  private orbitPose: { alpha: number; beta: number; radius: number } | null = null;
  entranceDone = true;

  constructor(readonly engine: Engine, private readonly canvas: HTMLCanvasElement, private readonly opts: WorldOptions) {
    const scene = new Scene(engine);
    this.scene = scene;
    scene.clearColor = new Color4(0.81, 0.90, 0.95, 1);
    scene.autoClear = true;
    this.camera = new ArcRotateCamera("worldCam", -1.1, 1.2, CAM_RADIUS, Vector3.Zero(), scene);
    const cam = this.camera;
    cam.minZ = 1; cam.maxZ = 2000;
    cam.lowerRadiusLimit = CAM_MIN; cam.upperRadiusLimit = CAM_MAX;
    cam.lowerBetaLimit = CAM_BETA_MIN; cam.upperBetaLimit = CAM_BETA_MAX;
    cam.inertia = INERTIA;
    cam.angularSensibilityX = ANGULAR; cam.angularSensibilityY = ANGULAR;
    cam.wheelPrecision = WHEEL_PRECISION; cam.pinchPrecision = PINCH_PRECISION;
    cam.panningSensibility = 0;
    cam.useNaturalPinchZoom = true;
    cam.inputs.removeByType("ArcRotateCameraKeyboardMoveInput");
    this.flight = new FreeCamera("flight", new Vector3(0, 0, -CAM_RADIUS), scene);
    this.flight.minZ = 1; this.flight.maxZ = 2000;
    this.lights = createLights(scene);
    this.sky = createSky(scene);
    this.pipe = new DefaultRenderingPipeline("worldpp", false, scene, [cam, this.flight]);
    this.pipe.fxaaEnabled = true;
    this.pipe.bloomEnabled = true; this.pipe.bloomThreshold = 0.9; this.pipe.bloomWeight = 0.15; this.pipe.bloomKernel = 48; this.pipe.bloomScale = 0.5;
    this.root = new TransformNode("globe", scene);
    const dummy = new Uint8Array([120, 160, 180, 255]);
    this.dummyReflect = RawTexture.CreateRGBATexture(dummy, 1, 1, scene, false, false, Texture.NEAREST_SAMPLINGMODE);
    for (const face of FACES) this.faces.push(this.buildFace(face));
    this.edges = this.buildEdges();
    this.cloudMesh = this.buildClouds();
    this.setCloudCount(this.cloudCount);
    // The globe stands in the World's frame; the camera's own pointer inputs move only the camera.
    cam.attachControl(canvas, true);
    for (const ev of ["pointerdown", "pointermove", "wheel", "touchstart"]) canvas.addEventListener(ev, () => { this.lastInput = this.time; }, { passive: true });
  }

  // ---------- construction ----------

  private waterMaterial(name: string, heightTex: RawTexture): ShaderMaterial {
    const m = new ShaderMaterial(name, this.scene, { vertexSource: waterVS, fragmentSource: waterFS }, {
      attributes: ["position"], uniforms: WATER_UNIFORMS, samplers: ["heightTex", "reflectTex"], needAlphaBlending: true,
    });
    m.setTexture("heightTex", heightTex).setTexture("reflectTex", this.dummyReflect);
    m.setFloat("waveAmp", 1).setVector2("waveDir", new Vector2(0, 1)).setFloat("waveFront", -999).setFloat("waveHeight", 0).setFloat("waveWidth", 3);
    m.setFloat("reflectMix", 0).setFloat("caustics", 0).setFloat("time", 0).setMatrix("frame", Matrix.Identity());
    m.setFloat("fogNear", FOG_WORLD[0]).setFloat("fogFar", FOG_WORLD[1]);
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
    return { face, node, land, water, waterMat, heightTex, hdata, terrain: null, terrainMat: null, roofs: [], record: null, lift: 0, liftGoal: 0, surfaced: 1, fog: FOG_UNCHARTED, swell: 1 };
  }

  private buildEdges(): Mesh {
    const parts: Mesh[] = [];
    for (const [a, b] of EDGES) {
      const mid = new Vector3((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      const out = mid.normalize().clone();
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

  private buildClouds(): Mesh {
    const parts: Mesh[] = [];
    for (const [x, y, z, d] of [[0, 0, 0, 12], [7, -0.6, 2.4, 8.6], [-7.6, -0.9, -1.4, 7.6], [2.4, 1, -6.2, 6.8], [-3.4, 0.5, 5.8, 6.2]]) {
      const s = MeshBuilder.CreateSphere("cloud", { diameter: d, segments: 4 }, this.scene);
      s.scaling.y = 0.42;
      s.position.set(x, y, z);
      parts.push(tint(s, "#f7f3e8"));
    }
    const mesh = mergeFlat("clouds", parts, this.scene);
    mesh.material = (flatMaterial(this.scene).clone("cloudMat") as StandardMaterial);
    (mesh.material as StandardMaterial).alpha = 0.92;
    mesh.parent = this.root;
    mesh.alwaysSelectAsActiveMesh = true;
    return mesh;
  }

  /** Seeded orbits for the clouds: each drifts around its own great circle above the faces. */
  setCloudCount(n: number): void {
    this.cloudCount = n;
    let seed = 11;
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    this.clouds = [];
    for (let k = 0; k < n; k++) {
      const axis = new Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();
      const u = Vector3.Cross(axis, Math.abs(axis.y) < 0.9 ? Vector3.Up() : Vector3.Right()).normalize();
      const v = Vector3.Cross(axis, u).normalize();
      this.clouds.push({ u, v, r: SOLID_INRADIUS + 18 + rnd() * 12, phase: rnd() * Math.PI * 2, speed: CLOUD_RATE * (0.7 + rnd() * 0.6) * (rnd() < 0.5 ? 1 : -1), scale: 0.7 + rnd() * 0.7, yaw: rnd() * Math.PI * 2 });
    }
    this.cloudMatrices = new Float32Array(Math.max(1, n) * 16);
    this.cloudMesh.setEnabled(n > 0);
  }

  private syncClouds(): void {
    if (!this.clouds.length) return;
    const scale = new Vector3();
    this.clouds.forEach((c, k) => {
      const a = c.phase + this.time * c.speed;
      const pos = c.u.scale(Math.cos(a) * c.r).add(c.v.scale(Math.sin(a) * c.r));
      scale.setAll(c.scale);
      Matrix.Compose(scale, Quaternion.FromEulerAngles(0, c.yaw + a, 0), pos).copyToArray(this.cloudMatrices, k * 16);
    });
    this.cloudMesh.thinInstanceSetBuffer("matrix", this.cloudMatrices, 16, false);
  }

  // ---------- sectors ----------

  /** Show a sector on a face (a real miniature) or clear it (uncharted sea). */
  setSector(index: number, record: SectorRecord | null): void {
    const fv = this.faces[index];
    fv.record = record;
    fv.terrain?.dispose(); fv.terrain = null;
    fv.terrainMat?.dispose(); fv.terrainMat = null;
    for (const r of fv.roofs) r.dispose(false, true); // each roof mesh owns its cloned material
    fv.roofs = [];
    const level = record ? record.state.tide.level : 0;
    fv.water.position.y = level;
    if (!record) {
      for (let row = 0; row < HEIGHT_TEX; row++) for (let col = 0; col < HEIGHT_TEX; col++) encodeHeightInto(fv.hdata, HEIGHT_TEX, row, col, -1.5);
      fv.heightTex.update(fv.hdata);
      fv.fog = FOG_UNCHARTED;
      fv.waterMat.setFloat("caustics", 0);
      return;
    }
    const isl = island(record.state.world.seed);
    const filled = new Set(record.state.landfill);
    const height: HeightFn = (x, z) => {
      const i = Math.floor(x), j = Math.floor(z);
      const h = isl.height(x, z);
      return filled.has((i + SIZE / 2) * SIZE + (j + SIZE / 2)) ? Math.max(h, 1.0) : h;
    };
    for (let row = 0; row < HEIGHT_TEX; row++) for (let col = 0; col < HEIGHT_TEX; col++) {
      const x = (col / (HEIGHT_TEX - 1) - 0.5) * SIZE, z = (row / (HEIGHT_TEX - 1) - 0.5) * SIZE;
      encodeHeightInto(fv.hdata, HEIGHT_TEX, row, col, insidePentagon(fv.face, x, z, 1.5) ? height(x, z) : -8);
    }
    fv.heightTex.update(fv.hdata);
    fv.fog = FOG_WORLD;
    // The miniature: the island's heights on a coarse grid (the island's own ground layout: row 0 is z = +32),
    // sunk outside the pentagon, flat-shaded.
    const n = MINI_CELLS;
    const heights = miniatureHeights(isl.height, record.state.landfill, n);
    const terrain = MeshBuilder.CreateGround(`mini${index}`, { width: SIZE, height: SIZE, subdivisions: n }, this.scene);
    const pos = terrain.getVerticesData(VertexBuffer.PositionKind)!;
    for (let row = 0; row <= n; row++) for (let col = 0; col <= n; col++) {
      const k = row * (n + 1) + col;
      const x = pos[k * 3], z = pos[k * 3 + 2];
      const inside = insidePentagon(fv.face, x, z, 1.5);
      pos[k * 3 + 1] = inside ? heights[(n - row) * (n + 1) + col] : -8;
    }
    terrain.updateVerticesData(VertexBuffer.PositionKind, pos);
    terrain.convertToFlatShadedMesh();
    terrain.parent = fv.land;
    terrain.isPickable = false;
    const terrainMat = new ShaderMaterial(`miniMat${index}`, this.scene, { vertexSource: terrainVS, fragmentSource: terrainFS }, { attributes: ["position", "normal"], uniforms: TERRAIN_UNIFORMS });
    terrainMat.setFloat("clipY", -999).setMatrix("frame", Matrix.Identity()).setFloat("fogNear", FOG_WORLD[0]).setFloat("fogFar", FOG_WORLD[1]);
    terrainMat.setFloat("waterLevel", level).setFloat("wetLevel", level + 0.1);
    terrain.material = terrainMat;
    fv.terrain = terrain; fv.terrainMat = terrainMat;
    // Roofs from the real buildings: three shape meshes with thin instances and per-instance colours.
    const roofs = roofPlacements(record.state);
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
    const r = this.canvas.getBoundingClientRect();
    const k = this.engine.getHardwareScalingLevel();
    const hit = this.scene.pick((clientX - r.left) / k, (clientY - r.top) / k, m => m.metadata?.face !== undefined, false, this.scene.activeCamera);
    return hit?.hit && hit.pickedMesh ? (hit.pickedMesh.metadata as { face: number }).face : null;
  }

  setHover(face: number | null): void {
    this.hover = face;
    this.faces.forEach((fv, k) => { fv.liftGoal = k === face ? HOVER_LIFT : 0; });
  }

  /** The face the camera looks at most squarely (keyboard focus and the default card). */
  get frontFace(): number {
    return faceToward({ x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z });
  }

  /** Arrow keys: a quarter-turn-ish step, eased. */
  step(dAlpha: number, dBeta: number): void {
    this.lastInput = this.time;
    const goal = this.keyGoal ?? { alpha: this.camera.alpha, beta: this.camera.beta, t: 0 };
    goal.alpha += dAlpha * KEY_STEP_ALPHA;
    goal.beta = Math.min(CAM_BETA_MAX, Math.max(CAM_BETA_MIN, goal.beta + dBeta * KEY_STEP_BETA));
    goal.t = 0;
    this.keyGoal = goal;
    if (this.opts.reducedMotion()) { this.camera.alpha = goal.alpha; this.camera.beta = goal.beta; this.keyGoal = null; }
  }

  /** Turn the camera to look at a face squarely (the returning launch settles on the last-played face). */
  lookAt(face: number, instant = false): void {
    const n = FACES[face].normal;
    const alpha = Math.atan2(n.z, n.x), beta = Math.acos(Math.max(-1, Math.min(1, n.y)));
    const b = Math.min(CAM_BETA_MAX, Math.max(CAM_BETA_MIN, beta));
    if (instant || this.opts.reducedMotion()) { this.camera.alpha = alpha; this.camera.beta = b; this.keyGoal = null; return; }
    this.keyGoal = { alpha, beta: b, t: 0 };
  }

  /** Quality preset: bloom and how many clouds. */
  setQuality(bloom: boolean, preset: string): void {
    this.pipe.bloomEnabled = bloom;
    this.setCloudCount(CLOUD_COUNT[preset] ?? CLOUD_COUNT.high);
  }

  /** Begin the entrance choreography (docs/globe/hero.md). */
  enter(): void {
    this.time = 0; this.lastInput = 0; this.idle = 0;
    this.phase = "entering"; this.entrance = 0; this.entranceDone = false;
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
    const fc = FACES[face];
    const w = (p: V3) => V({ x: fc.centre.x + fc.xAxis.x * p.x + fc.normal.x * p.y + fc.zAxis.x * p.z, y: fc.centre.y + fc.xAxis.y * p.x + fc.normal.y * p.y + fc.zAxis.y * p.z, z: fc.centre.z + fc.xAxis.z * p.x + fc.normal.z * p.y + fc.zAxis.z * p.z });
    const target = w({ x: f.cx, y: f.targetY, z: f.cz });
    const position = w(arcPosition(f));
    const lift = this.faces[face].lift;
    const up = V(fc.normal);
    return { position: position.add(up.scale(lift)), target: target.add(up.scale(lift)), up };
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
      this.flightAnim = { from, to, t: 0, seconds, done };
    });
  }

  /** Arrive from the island at the face's framing and fly back up to the orbit. */
  flyBack(face: number, framing: Framing, seconds: number): Promise<void> {
    const from = this.poseFor(face, framing);
    const orbit = this.orbitPose ?? { alpha: this.camera.alpha, beta: this.camera.beta, radius: this.camera.radius };
    this.camera.alpha = orbit.alpha; this.camera.beta = orbit.beta; this.camera.radius = orbit.radius;
    this.camera.rebuildAnglesAndRadius();
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
      this.flightAnim = { from, to, t: 0, seconds, done };
    });
  }

  /** Where the World camera is, for probes. */
  get pose(): { alpha: number; beta: number; radius: number; phase: string; camera: string } {
    return { alpha: this.camera.alpha, beta: this.camera.beta, radius: this.camera.radius, phase: this.phase, camera: this.scene.activeCamera === this.flight ? "flight" : "orbit" };
  }

  get drawCalls(): number { return this.scene.getActiveMeshes().length; }

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
      this.entrance += dt;
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
      a.t += dt;
      const k = inOutCubic(a.t / a.seconds);
      const pose: Pose = { position: Vector3.Lerp(a.from.position, a.to.position, k), target: Vector3.Lerp(a.from.target, a.to.target, k), up: Vector3.Lerp(a.from.up, a.to.up, k).normalize() };
      this.applyPose(pose);
      if (a.t >= a.seconds) { this.flightAnim = null; a.done(); }
    }
    // Keyboard steps and idle drift, only on the orbit camera.
    if (this.scene.activeCamera === this.camera) {
      if (this.keyGoal) {
        const g = this.keyGoal;
        g.t += dt;
        const k = outCubic(g.t / KEY_EASE);
        this.camera.alpha += (g.alpha - this.camera.alpha) * Math.min(1, k + dt * 4);
        this.camera.beta += (g.beta - this.camera.beta) * Math.min(1, k + dt * 4);
        if (g.t >= KEY_EASE) { this.camera.alpha = g.alpha; this.camera.beta = g.beta; this.keyGoal = null; }
      } else if (!reduced && this.phase === "idle") {
        const since = this.time - this.lastInput;
        this.idle = since > IDLE_AFTER ? Math.min(1, this.idle + dt / IDLE_RAMP) : 0;
        if (this.idle > 0) this.camera.alpha += IDLE_RATE * outCubic(this.idle) * dt;
      }
    }
    // Hover lifts.
    for (const fv of this.faces) {
      const rate = fv.liftGoal > fv.lift ? 1 / HOVER_UP : 1 / HOVER_DOWN;
      fv.lift = reduced ? fv.liftGoal : fv.lift + (fv.liftGoal - fv.lift) * Math.min(1, dt * rate * 3);
      fv.node.position = V(fv.face.centre).add(V(fv.face.normal).scale(fv.lift));
      fv.land.position.y = SURFACE_FROM * (1 - fv.surfaced);
    }
    // Lighting: one sun by the clock; each face shaded by how much it turns toward it.
    const light = this.clockLighting();
    this.lighting = light;
    this.lights.apply(light);
    this.sky.setLighting(light);
    const camPos = this.scene.activeCamera!.position;
    for (const fv of this.faces) {
      const facing = fv.face.normal.x * light.sunDir.x + fv.face.normal.y * light.sunDir.y + fv.face.normal.z * light.sunDir.z;
      const day = 0.28 + 0.72 * smooth(-0.25, 0.35, facing);
      const boost = 1 + HOVER_SUN * (fv.lift / HOVER_LIFT);
      const fogNear = FOG_ENTRANCE[0] + (fv.fog[0] - FOG_ENTRANCE[0]) * fogT, fogFar = FOG_ENTRANCE[1] + (fv.fog[1] - FOG_ENTRANCE[1]) * fogT;
      const wm = fv.waterMat;
      fv.water.computeWorldMatrix(true);
      wm.setMatrix("frame", Matrix.Invert(fv.water.getWorldMatrix()));
      wm.setVector3("sunDir", light.sunDir).setVector3("sunColor", light.sunLit.scale(day * boost)).setVector3("skyColor", light.waterSky.scale(day * boost))
        .setVector3("fogColor", light.fog).setFloat("dusk", light.k).setFloat("time", this.time).setVector3("camPos", camPos)
        .setFloat("waveAmp", fv.swell).setFloat("fogNear", fogNear).setFloat("fogFar", fogFar);
      if (fv.terrain && fv.terrainMat) {
        fv.terrain.computeWorldMatrix(true);
        fv.terrainMat.setMatrix("frame", Matrix.Invert(fv.terrain.getWorldMatrix()));
        fv.terrainMat.setVector3("sunDir", light.sunDir).setVector3("sunColor", light.sunLit.scale(boost)).setVector3("skyAmb", light.skyAmbient.scale(day))
          .setVector3("groundAmb", light.groundAmbient.scale(day)).setVector3("fogColor", light.fog).setVector3("camPos", camPos)
          .setFloat("fogNear", fogNear).setFloat("fogFar", fogFar);
      }
    }
    this.syncClouds();
    this.scene.render();
  }

  /** For the audit: the current lighting. */
  get light(): Lighting { return this.lighting; }
}
