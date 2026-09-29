// Ambient effects driven by the ledger: shark fins roaming the risky open water; flames and smoke over burning
// buildings; the floats and buoys of every shark net, riding the water. View only.
import { Color3, Matrix, Mesh, MeshBuilder, Quaternion, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import { CELLS } from "../sim/fields";
import { cellCenter, Grid, HALF } from "../sim/grid";
import { SIZE } from "../config";
import { ashFalling, trembling } from "../sim/biomes/cinder";
import { materialCode } from "../sim/materials";
import { BUILDINGS } from "../sim/balance";
import { Building, SimState } from "../sim/state";
import type { BiomeLook } from "./biomes";
import { flatMaterial, mergeFlat, tint } from "../world/flatMesh";
import { waveHeight } from "../world/water";

const FLOATS_PER_NET = 5;

const FIN_COUNT = 3;
/** Fins show where the water draws sharks: open water (no deck over it) at least this risky and this deep. */
const FIN_MIN_RISK = 0.15;
const FIN_MIN_DEPTH = 0.2;
/** How far a fin keeps from any deck, so it never slides under a pier's edge. */
const FIN_CLEAR = 0.3;
/** Cells a second a fin swims, radians a second it turns, and how far it looks for the next stretch of water. */
const FIN_SPEED = 0.55, FIN_TURN = 1.6, FIN_ROAM = 5;
/** Seconds to surface or sink. */
const FIN_SURFACE = 1.2;

/** A fin under way: where it is and heads, the spot it swims to, and how far under it is (1 = gone). */
interface Fin { x: number; z: number; yaw: number; tx: number; tz: number; under: number }
const FLAMES_PER_FIRE = 4;
const PUFFS_PER_FIRE = 5;
const CHIMNEY_PUFFS = 3;

export class Effects {
  private fins: Mesh;
  private finKit: "fin" | "croc" = "fin";
  private readonly scene: Scene;
  private readonly flames: Mesh;
  private readonly smoke: Mesh;
  private readonly netFloats: Mesh;
  private readonly netBuoys: Mesh;
  /** Floats drawn this frame and the height of the first, for checks. */
  netFloatCount = 0;
  netFloatY = 0;
  /** Open water cells risky enough for a fin, refreshed every second or so. */
  private finCells: number[] = [];
  private finList: Fin[] = [];
  private finTime = -1;
  private frame = 0;
  private finMatrices = new Float32Array(FIN_COUNT * 16);
  private flameMatrices = new Float32Array(0);
  private smokeMatrices = new Float32Array(0);
  burning = 0;
  /** Steam puffs and ash flakes drawn this frame (the Cinder), for checks. */
  steamCount = 0;
  ashCount = 0;
  /** How hard the ground shakes (the mountain trembling), for the camera. */
  shake = 0;
  private steam: Mesh | null = null;
  private ash: Mesh | null = null;
  private ventCells: { x: number; y: number; z: number }[] = [];
  private ventKey = "";

  constructor(scene: Scene) {
    this.scene = scene;
    this.fins = this.buildFins("fin");

    // A flame: a slim cone, self-lit.
    const flame = MeshBuilder.CreateCylinder("flame", { diameterTop: 0, diameterBottom: 0.34, height: 0.7, tessellation: 5 }, scene);
    flame.position.y = 0.35;
    this.flames = mergeFlat("flames", [tint(flame, "#ffb859")], scene);
    const flameMat = new StandardMaterial("flameMat", scene);
    flameMat.diffuseColor = Color3.FromHexString("#ffb859");
    flameMat.emissiveColor = new Color3(1.0, 0.5, 0.15);
    flameMat.specularColor = Color3.Black();
    this.flames.material = flameMat;

    // A puff of smoke: a low-poly sphere.
    const puff = MeshBuilder.CreateSphere("puff", { diameter: 0.45, segments: 4 }, scene);
    this.smoke = mergeFlat("smoke", [tint(puff, "#8d8a83")], scene);
    const smokeMat = new StandardMaterial("smokeMat", scene);
    smokeMat.diffuseColor = new Color3(0.4, 0.4, 0.42);
    smokeMat.alpha = 0.7;
    this.smoke.material = smokeMat;

    // Shark-net floats (red and white, per-instance colour) and the marker buoy, placed on the water each frame.
    const fl = MeshBuilder.CreateCylinder("nf", { diameter: 0.08, height: 0.1, tessellation: 5 }, scene);
    this.netFloats = mergeFlat("sharkFloats", [tint(fl, "#ffffff")], scene);
    this.netFloats.material = flatMaterial(scene).clone("sharkFloatMat") as StandardMaterial;
    const bu = MeshBuilder.CreatePolyhedron("nb", { type: 1, size: 0.11 }, scene);
    this.netBuoys = mergeFlat("sharkBuoys", [tint(bu, "#c9674f")], scene);
    for (const m of [this.fins, this.flames, this.smoke, this.netFloats, this.netBuoys]) { m.isPickable = false; m.alwaysSelectAsActiveMesh = true; m.setEnabled(false); }
  }

  /** What patrols the risky water: a shark's fin, or (the Delta) a crocodile's eyes, snout and ridged back. */
  private buildFins(kit: "fin" | "croc"): Mesh {
    const scene = this.scene;
    const parts: Mesh[] = [];
    if (kit === "fin") {
      const fin = MeshBuilder.CreateCylinder("fin", { diameterTop: 0, diameterBottom: 0.5, height: 0.45, tessellation: 3 }, scene);
      fin.scaling.set(1, 1, 0.25);
      fin.position.y = 0.22;
      parts.push(tint(fin, "#4c5a66"));
    } else {
      const back = MeshBuilder.CreateSphere("croc", { diameter: 0.3, segments: 4 }, scene);
      back.scaling.set(2.6, 0.3, 0.8);
      back.position.y = 0.03;
      parts.push(tint(back, "#3f5f44"));
      const snout = MeshBuilder.CreateBox("snout", { width: 0.34, height: 0.05, depth: 0.1 }, scene);
      snout.position.set(0.5, 0.03, 0);
      parts.push(tint(snout, "#3f5f44"));
      for (const z of [-0.05, 0.05]) { const eye = MeshBuilder.CreateSphere("eye", { diameter: 0.06, segments: 3 }, scene); eye.position.set(0.3, 0.07, z); parts.push(tint(eye, "#b9a377")); }
      for (let k = 0; k < 4; k++) { const r = MeshBuilder.CreateBox("ridge", { width: 0.05, height: 0.04, depth: 0.05 }, scene); r.position.set(0.1 - k * 0.15, 0.08, 0); parts.push(tint(r, "#2f4a34")); }
    }
    const m = mergeFlat(kit === "fin" ? "sharkFins" : "crocs", parts, scene);
    m.isPickable = false; m.alwaysSelectAsActiveMesh = true; m.setEnabled(false);
    return m;
  }

  /** The look's predator: crocodiles where the fauna has them (the Delta), fins everywhere else. */
  setLook(look: BiomeLook): void {
    const kit = look.fauna.includes("crocodiles") ? "croc" : "fin";
    if (kit === this.finKit) return;
    this.finKit = kit;
    this.fins.dispose();
    this.fins = this.buildFins(kit);
  }

  /**
   * The mountain (the Cinder): white steam curling off every vent site, thick while the mountain trembles; grey
   * flakes drifting down over the town while the ash falls. Both are thin instances, built on first use.
   */
  private syncMountain(state: SimState, grid: Grid, viewTime: number): void {
    const vent = materialCode("vent");
    const key = grid.terrainVersion + ":" + state.world.seed + state.world.biome;
    if (key !== this.ventKey) {
      this.ventKey = key;
      this.ventCells = [];
      for (let k = 0; k < grid.materials.length; k++) if (grid.materials[k] === vent) this.ventCells.push({ x: Math.floor(k / SIZE) - HALF + 0.5, z: (k % SIZE) - HALF + 0.5, y: grid.heights[k] });
    }
    const shaking = trembling(state);
    this.shake = shaking ? 1 : 0;
    const puffs = shaking ? 6 : 3;
    if (this.ventCells.length) {
      if (!this.steam) {
        const p = MeshBuilder.CreateSphere("steam", { diameter: 0.5, segments: 4 }, this.scene);
        this.steam = mergeFlat("steam", [tint(p, "#f2ece0")], this.scene);
        const m = new StandardMaterial("steamMat", this.scene);
        m.diffuseColor = new Color3(0.95, 0.94, 0.92); m.emissiveColor = new Color3(0.35, 0.35, 0.35); m.alpha = 0.55;
        this.steam.material = m;
        this.steam.isPickable = false; this.steam.alwaysSelectAsActiveMesh = true;
      }
      const buf = new Float32Array(this.ventCells.length * puffs * 16);
      let n = 0;
      for (const [idx, v] of this.ventCells.entries()) for (let k = 0; k < puffs; k++) {
        const t = ((viewTime * (shaking ? 0.5 : 0.25) + k / puffs + idx * 0.37) % 1);
        const s = 0.4 + t * (shaking ? 2.2 : 1.4);
        Matrix.Compose(new Vector3(s, s * 0.8, s), Quaternion.Identity(), new Vector3(v.x + Math.sin(t * 5 + idx) * 0.3, v.y + 0.3 + t * (shaking ? 3.5 : 2), v.z + t * 0.6)).copyToArray(buf, n++ * 16);
      }
      this.steam.setEnabled(true);
      this.steam.thinInstanceSetBuffer("matrix", buf, 16, false);
      this.steamCount = n;
    } else if (this.steam) { this.steam.setEnabled(false); this.steamCount = 0; }
    if (ashFalling(state)) {
      if (!this.ash) {
        const f = MeshBuilder.CreateBox("ash", { width: 0.06, height: 0.015, depth: 0.06 }, this.scene);
        this.ash = mergeFlat("ash", [tint(f, "#6b6a66")], this.scene);
        this.ash.isPickable = false; this.ash.alwaysSelectAsActiveMesh = true;
      }
      const N = 220, buf = new Float32Array(N * 16);
      const bs = Object.values(state.buildings);
      const c = bs.length ? bs[0].cells[0] : { i: 0, j: 0 };
      for (let k = 0; k < N; k++) {
        const h = (k * 0.6180339887) % 1, g = (k * 0.7548776662) % 1;
        const fall = ((viewTime * 0.35 + h) % 1);
        Matrix.Compose(new Vector3(1, 1, 1), Quaternion.FromEulerAngles(k, viewTime + k, 0), new Vector3(c.i + (h - 0.5) * 30, 7 - fall * 7, c.j + (g - 0.5) * 30)).copyToArray(buf, k * 16);
      }
      this.ash.setEnabled(true);
      this.ash.thinInstanceSetBuffer("matrix", buf, 16, false);
      this.ashCount = N;
    } else if (this.ash) { this.ash.setEnabled(false); this.ashCount = 0; }
  }

  /** Every net's floats sit on the water: the tide and the swell carry them, the net hangs below. */
  private syncNets(state: SimState, viewTime: number): void {
    const nets: Building[] = [];
    for (const b of Object.values(state.buildings)) if (BUILDINGS[b.kind].stopsPredators) nets.push(b);
    this.netFloatCount = nets.length * FLOATS_PER_NET;
    if (!nets.length) { this.netFloats.setEnabled(false); this.netBuoys.setEnabled(false); return; }
    const level = state.tide.level;
    const fm = new Float32Array(nets.length * FLOATS_PER_NET * 16), fc = new Float32Array(nets.length * FLOATS_PER_NET * 4), bm = new Float32Array(nets.length * 16);
    const red = Color3.FromHexString("#c9674f"), white = Color3.FromHexString("#f7f3e8");
    nets.forEach((b, n) => {
      const { x, z } = cellCenter(b.cells[0]);
      for (let k = 0; k < FLOATS_PER_NET; k++) {
        const fx = x - 0.15 + k * 0.14;
        const y = level + waveHeight(fx, z, viewTime) + 0.02;
        if (n === 0 && k === 0) this.netFloatY = y;
        const idx = n * FLOATS_PER_NET + k;
        Matrix.Translation(fx, y, z).copyToArray(fm, idx * 16);
        const c = k % 2 ? red : white;
        fc[idx * 4] = c.r; fc[idx * 4 + 1] = c.g; fc[idx * 4 + 2] = c.b; fc[idx * 4 + 3] = 1;
      }
      Matrix.Translation(x - 0.35, level + waveHeight(x - 0.35, z, viewTime) + 0.06, z).copyToArray(bm, n * 16);
    });
    this.netFloats.setEnabled(true); this.netBuoys.setEnabled(true);
    this.netFloats.thinInstanceSetBuffer("matrix", fm, 16, false);
    this.netFloats.thinInstanceSetBuffer("color", fc, 4, false);
    this.netBuoys.thinInstanceSetBuffer("matrix", bm, 16, false);
  }

  /** Open water with room for a fin: deep enough at this tide, and no pier, dock or street over it or close by. */
  private swimmable(grid: Grid, level: number, x: number, z: number): boolean {
    const i = Math.floor(x), j = Math.floor(z);
    if (i < -HALF || i >= HALF || j < -HALF || j >= HALF) return false;
    if (level - grid.heights[(i + HALF) * SIZE + (j + HALF)] < FIN_MIN_DEPTH) return false;
    for (const [dx, dz] of [[0, 0], [FIN_CLEAR, 0], [-FIN_CLEAR, 0], [0, FIN_CLEAR], [0, -FIN_CLEAR]]) {
      const a = Math.floor(x + dx), b = Math.floor(z + dz);
      if (a >= -HALF && a < HALF && b >= -HALF && b < HALF && grid.buildingAtIJ(a, b)) return false;
    }
    return true;
  }

  /** The open water cells risky enough to draw a fin. */
  private pickCells(state: SimState, grid: Grid): void {
    const f = state.fields.shark, level = state.tide.level;
    this.finCells = [];
    for (let k = 0; k < CELLS; k++) {
      if (f[k] < FIN_MIN_RISK) continue;
      if (this.swimmable(grid, level, Math.floor(k / SIZE) - HALF + 0.5, (k % SIZE) - HALF + 0.5)) this.finCells.push(k);
    }
  }

  get finCount(): number { return this.finList.filter(f => f.under < 1).length; }
  /** Where each fin is and how far under (0 = surfaced), for checks. */
  finProbe(): { x: number; z: number; under: number }[] { return this.finList.map(f => ({ x: +f.x.toFixed(2), z: +f.z.toFixed(2), under: +f.under.toFixed(2) })); }

  /** A spot for a fin to swim to: a risky cell within reach, the riskier the likelier, with open water all the way. */
  private nextSpot(state: SimState, grid: Grid, fin: { x: number; z: number }): { x: number; z: number } | null {
    const f = state.fields.shark, level = state.tide.level;
    const near = this.finCells.filter(k => Math.hypot(Math.floor(k / SIZE) - HALF + 0.5 - fin.x, (k % SIZE) - HALF + 0.5 - fin.z) <= FIN_ROAM);
    for (let tries = 0; tries < 8 && near.length; tries++) {
      let total = 0;
      for (const k of near) total += f[k];
      let r = Math.random() * total, k = near[0];
      for (const c of near) { r -= f[c]; if (r <= 0) { k = c; break; } }
      const x = Math.floor(k / SIZE) - HALF + 0.2 + Math.random() * 0.6, z = (k % SIZE) - HALF + 0.2 + Math.random() * 0.6;
      const d = Math.hypot(x - fin.x, z - fin.z), steps = Math.ceil(d / 0.4);
      let clear = d > 0.6;
      for (let s = 1; s < steps && clear; s++) clear = this.swimmable(grid, level, fin.x + (x - fin.x) * s / steps, fin.z + (z - fin.z) * s / steps);
      if (clear) return { x, z };
    }
    return null;
  }

  /**
   * Fins roam the risky open water: each swims to a spot, turns and picks another nearby, so they wander the plume
   * instead of circling one cell. One surfaces for every few risky cells (up to FIN_COUNT) and sinks when the
   * water it is in stops drawing sharks.
   */
  private syncFins(state: SimState, grid: Grid, viewTime: number): void {
    if (this.frame % 60 === 0 || this.finTime < 0) this.pickCells(state, grid);
    const dt = this.finTime < 0 ? 0 : Math.min(0.1, Math.max(0, viewTime - this.finTime));
    this.finTime = viewTime;
    const level = state.tide.level;
    const want = Math.min(FIN_COUNT, Math.ceil(this.finCells.length / 4));
    if (this.finList.length < want) {
      const k = this.finCells[Math.floor(Math.random() * this.finCells.length)];
      const x = Math.floor(k / SIZE) - HALF + 0.5, z = (k % SIZE) - HALF + 0.5;
      this.finList.push({ x, z, yaw: Math.random() * Math.PI * 2, tx: x, tz: z, under: 1 });
    }
    let n = 0;
    const gone: Fin[] = [];
    this.finList.forEach((fin, idx) => {
      const i = Math.floor(fin.x) + HALF, j = Math.floor(fin.z) + HALF;
      const risky = i >= 0 && i < SIZE && j >= 0 && j < SIZE && state.fields.shark[i * SIZE + j] >= FIN_MIN_RISK * 0.5 && this.swimmable(grid, level, fin.x, fin.z);
      const leaving = !risky || idx >= want;
      fin.under = Math.min(1, Math.max(0, fin.under + (leaving ? dt : -dt) / FIN_SURFACE));
      if (leaving && fin.under >= 1) { gone.push(fin); return; }
      if (Math.hypot(fin.tx - fin.x, fin.tz - fin.z) < 0.25) {
        const spot = this.nextSpot(state, grid, fin);
        if (spot) { fin.tx = spot.x; fin.tz = spot.z; }
      }
      // Swim on toward the spot, turning at most FIN_TURN a second (a fin never spins on the spot).
      const want2 = Math.atan2(fin.tx - fin.x, fin.tz - fin.z);
      let turn = want2 - fin.yaw;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      fin.yaw += Math.max(-FIN_TURN * dt, Math.min(FIN_TURN * dt, turn));
      const go = Math.hypot(fin.tx - fin.x, fin.tz - fin.z) < 0.25 ? 0 : FIN_SPEED * dt * Math.max(0.2, Math.cos(turn));
      const nx = fin.x + Math.sin(fin.yaw) * go, nz = fin.z + Math.cos(fin.yaw) * go;
      if (this.swimmable(grid, level, nx, nz)) { fin.x = nx; fin.z = nz; } else { fin.tx = fin.x; fin.tz = fin.z; }
      if (fin.under >= 1) return;
      const pos = new Vector3(fin.x, level + waveHeight(fin.x, fin.z, viewTime) - 0.1 - fin.under * 0.45, fin.z);
      // The mesh's blade runs along x: a quarter turn past the heading lays it along the way it swims.
      Matrix.Compose(new Vector3(1, 1, 1), Quaternion.FromEulerAngles(0, fin.yaw + Math.PI / 2, 0), pos).copyToArray(this.finMatrices, n++ * 16);
    });
    if (gone.length) this.finList = this.finList.filter(f => !gone.includes(f));
    if (n === 0) { this.fins.setEnabled(false); return; }
    this.fins.setEnabled(true);
    this.fins.thinInstanceSetBuffer("matrix", this.finMatrices.subarray(0, n * 16), 16, false);
  }

  private syncFire(state: SimState, viewTime: number): void {
    const burning: Building[] = [];
    const working: Building[] = [];
    for (const b of Object.values(state.buildings)) {
      if (b.fire > 0) burning.push(b);
      else if (b.kind === "smokehouse" && b.workers > 0 && b.reached && !b.cut && !b.damaged) working.push(b);
    }
    this.burning = burning.length;
    if (!burning.length && !working.length) { this.flames.setEnabled(false); this.smoke.setEnabled(false); return; }
    const nf = burning.length * FLAMES_PER_FIRE, ns = burning.length * PUFFS_PER_FIRE + working.length * CHIMNEY_PUFFS;
    if (this.flameMatrices.length !== nf * 16) this.flameMatrices = new Float32Array(nf * 16);
    if (this.smokeMatrices.length !== ns * 16) this.smokeMatrices = new Float32Array(ns * 16);
    let fi = 0, si = 0;
    // A working smokehouse: thin puffs drifting up from the chimney top, so you can see it is at work.
    for (const b of working) {
      const is = b.cells.map(c => c.i), js = b.cells.map(c => c.j);
      const cx = (Math.min(...is) + Math.max(...is) + 1) / 2, cz = (Math.min(...js) + Math.max(...js) + 1) / 2;
      for (let k = 0; k < CHIMNEY_PUFFS; k++) {
        const u = ((viewTime * 0.25 + k / CHIMNEY_PUFFS + b.id * 0.17) % 1);
        const s = 0.25 + u * 0.5;
        Matrix.Compose(new Vector3(s, s, s), Quaternion.Identity(), new Vector3(cx + 0.6 + u * 0.3 + 0.08 * Math.sin(u * 9), b.floorY + 1.6 + u * 1.4, cz + 0.1)).copyToArray(this.smokeMatrices, si++ * 16);
      }
    }
    for (const b of burning) {
      const is = b.cells.map(c => c.i), js = b.cells.map(c => c.j);
      const cx = (Math.min(...is) + Math.max(...is) + 1) / 2, cz = (Math.min(...js) + Math.max(...js) + 1) / 2;
      const w = Math.max(...is) - Math.min(...is) + 1, d = Math.max(...js) - Math.min(...js) + 1;
      for (let k = 0; k < FLAMES_PER_FIRE; k++) {
        const a = k * 1.7 + b.id;
        const x = cx + Math.cos(a) * 0.3 * w, z = cz + Math.sin(a) * 0.3 * d;
        const s = 0.7 + 0.4 * Math.abs(Math.sin(viewTime * 7 + k * 1.3 + b.id));
        Matrix.Compose(new Vector3(s, s * 1.3, s), Quaternion.FromEulerAngles(0, viewTime * 2 + k, 0.1 * Math.sin(viewTime * 5 + k)), new Vector3(x, b.floorY + 0.3, z)).copyToArray(this.flameMatrices, fi++ * 16);
      }
      for (let k = 0; k < PUFFS_PER_FIRE; k++) {
        const u = ((viewTime * 0.35 + k / PUFFS_PER_FIRE + b.id * 0.13) % 1);
        const x = cx + Math.sin(k * 2.3 + b.id) * 0.25 + u * 0.4, z = cz + Math.cos(k * 1.9 + b.id) * 0.25;
        const s = 0.5 + u * 1.2;
        Matrix.Compose(new Vector3(s, s, s), Quaternion.Identity(), new Vector3(x, b.floorY + 1.0 + u * 2.4, z)).copyToArray(this.smokeMatrices, si++ * 16);
      }
    }
    this.flames.setEnabled(nf > 0); this.smoke.setEnabled(true);
    if (nf > 0) this.flames.thinInstanceSetBuffer("matrix", this.flameMatrices, 16, false);
    this.smoke.thinInstanceSetBuffer("matrix", this.smokeMatrices, 16, false);
  }

  sync(state: SimState, grid: Grid, viewTime: number): void {
    this.frame++;
    this.syncMountain(state, grid, viewTime);
    this.syncFins(state, grid, viewTime);
    this.syncFire(state, viewTime);
    this.syncNets(state, viewTime);
  }
}
