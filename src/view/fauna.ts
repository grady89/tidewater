// The later coasts' creatures (BIOMES.md §3.4–3.6), one thin-instanced mesh per kind, placed and moved from the
// ledger and view time every frame, nothing stored: the Delta's flamingos wading the flats, herons still at the
// channel edges, crocodiles basking on the banks at low water, fireflies over the reeds at night; the Cinder's
// iguanas on the black sand, boobies over the harbours, plankton glowing in the shallows after dark; the Dunes'
// pelicans on the piers, dolphins leaping in the lagoon, ghost crabs on the sand at night. The look's fauna list
// says which run. View only.
import { Color3, Matrix, Mesh, MeshBuilder, Quaternion, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import { BUILDINGS } from "../sim/balance";
import { isDaytime } from "../sim/daylight";
import { cellIndex, Grid, HALF, inBounds } from "../sim/grid";
import { materialCode } from "../sim/materials";
import { Building, SimState } from "../sim/state";
import { flatMaterial, mergeFlat, tint } from "../world/flatMesh";
import { waveHeight } from "../world/water";
import { BiomeLook, FaunaKind } from "./biomes";
import { ground } from "./ground";

interface Site { x: number; z: number; h: number; yaw: number; phase: number; k: number }
type Pose = { pos: Vector3; yaw: number; s?: number; pitch?: number };
interface Kind { mesh: Mesh | null; max: number; buf: Float32Array; count: number }

const REACH = 7;

export class CoastFauna {
  private fauna: ReadonlySet<FaunaKind> = new Set();
  private readonly kinds = new Map<FaunaKind, Kind>();
  private sites = new Map<string, Site[]>();
  private siteKey = "";

  constructor(private readonly scene: Scene, private readonly grid: Grid) {}

  setLook(look: BiomeLook): void {
    this.fauna = new Set(look.fauna);
    for (const [kind, k] of this.kinds) if (!this.fauna.has(kind) && k.mesh) k.mesh.setEnabled(false);
  }

  /** Live counts per kind, for probes. */
  get counts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [kind, k] of this.kinds) out[kind] = k.count;
    return out;
  }

  // ---------- meshes ----------

  private build(kind: FaunaKind): Mesh {
    const s = this.scene;
    const parts: Mesh[] = [];
    const sph = (d: number, sx: number, sy: number, sz: number, x: number, y: number, z: number, hex: string) => { const m = MeshBuilder.CreateSphere("f", { diameter: d, segments: 4 }, s); m.scaling.set(sx, sy, sz); m.position.set(x, y, z); parts.push(tint(m, hex)); };
    const bx = (w: number, h: number, d: number, x: number, y: number, z: number, hex: string, rz = 0, ry = 0) => { const m = MeshBuilder.CreateBox("f", { width: w, height: h, depth: d }, s); m.position.set(x, y, z); m.rotation.z = rz; m.rotation.y = ry; parts.push(tint(m, hex)); };
    const cone = (d: number, h: number, x: number, y: number, z: number, hex: string, rz = 0) => { const m = MeshBuilder.CreateCylinder("f", { diameterTop: 0, diameterBottom: d, height: h, tessellation: 4 }, s); m.rotation.z = rz; m.position.set(x, y, z); parts.push(tint(m, hex)); };
    let emissive: string | null = null;
    switch (kind) {
      case "flamingos":
        sph(0.24, 1.3, 0.8, 0.8, 0, 0.5, 0, "#e0705a");
        bx(0.025, 0.3, 0.025, 0.08, 0.72, 0, "#e0705a", 0.25); // the neck
        sph(0.07, 1, 1, 1, 0.13, 0.86, 0, "#e0705a");
        cone(0.04, 0.08, 0.18, 0.84, 0, "#2b2b2b", -Math.PI / 2);
        for (const z of [-0.03, 0.03]) bx(0.015, 0.42, 0.015, 0, 0.21, z, "#e0705a");
        break;
      case "herons":
        sph(0.2, 1.2, 0.7, 0.7, 0, 0.42, 0, "#8d8a83");
        bx(0.03, 0.26, 0.03, 0.06, 0.58, 0, "#b9b6ae", 0.15);
        sph(0.07, 1.1, 0.9, 0.9, 0.09, 0.72, 0, "#b9b6ae");
        cone(0.035, 0.16, 0.18, 0.71, 0, "#b9a377", -Math.PI / 2);
        for (const z of [-0.03, 0.03]) bx(0.015, 0.34, 0.015, 0, 0.17, z, "#5d6d7a");
        break;
      case "crocodiles":
        sph(0.34, 2.4, 0.35, 0.9, 0, 0.04, 0, "#3f5f44");
        bx(0.36, 0.05, 0.12, 0.48, 0.03, 0, "#3f5f44");
        bx(0.5, 0.05, 0.1, -0.55, 0.02, 0, "#3f5f44", 0, 0.1);
        for (let k = 0; k < 5; k++) bx(0.05, 0.04, 0.05, 0.3 - k * 0.16, 0.1, 0, "#2f4a34");
        for (const z of [-0.05, 0.05]) sph(0.05, 1, 1, 1, 0.38, 0.08, z, "#b9a377");
        break;
      case "fireflies":
        sph(0.07, 1, 1, 1, 0, 0, 0, "#ffb859");
        emissive = "#ffd27a";
        break;
      case "iguanas":
        sph(0.18, 2, 0.6, 0.9, 0, 0.06, 0, "#4a4644");
        bx(0.36, 0.04, 0.05, -0.34, 0.04, 0, "#4a4644", 0, 0.15);
        sph(0.09, 1.2, 0.8, 0.9, 0.22, 0.09, 0, "#5a5350");
        for (let k = 0; k < 4; k++) bx(0.02, 0.05, 0.02, 0.1 - k * 0.08, 0.12, 0, "#79ad5e");
        for (const [x, z] of [[0.1, 0.1], [0.1, -0.1], [-0.1, 0.1], [-0.1, -0.1]]) bx(0.08, 0.02, 0.03, x, 0.02, z, "#4a4644");
        break;
      case "boobies":
        sph(0.26, 1.35, 0.5, 0.6, 0, 0, 0, "#f2ece0");
        sph(0.1, 1, 1, 1, 0.19, 0.04, 0, "#f2ece0");
        cone(0.05, 0.1, 0.27, 0.03, 0, "#5d6d7a", -Math.PI / 2);
        for (const z of [-1, 1]) bx(0.2, 0.012, 0.5, -0.03, 0.02, z * 0.3, "#5a4636");
        for (const z of [-0.04, 0.04]) bx(0.06, 0.02, 0.04, -0.1, -0.07, z, "#2f6f8f");
        break;
      case "plankton":
        sph(0.06, 1.4, 0.4, 1.4, 0, 0, 0, "#9fe8dc");
        emissive = "#6fd6e0";
        break;
      case "pelicans":
        sph(0.34, 1.3, 0.8, 0.8, 0, 0.3, 0, "#f6f1e6");
        bx(0.04, 0.2, 0.04, 0.12, 0.48, 0, "#f6f1e6", -0.2);
        sph(0.09, 1, 1, 1, 0.15, 0.6, 0, "#f6f1e6");
        bx(0.28, 0.05, 0.07, 0.3, 0.55, 0, "#ffb859", 0.25);
        sph(0.1, 1.6, 0.5, 0.8, 0.3, 0.5, 0, "#ffb859");
        for (const z of [-0.05, 0.05]) bx(0.02, 0.14, 0.02, 0, 0.07, z, "#ffb859");
        break;
      case "dolphins":
        sph(0.36, 2.6, 0.55, 0.7, 0, 0, 0, "#5d6d7a");
        cone(0.2, 0.2, -0.05, 0.14, 0, "#5d6d7a");
        bx(0.2, 0.03, 0.34, -0.55, 0, 0, "#5d6d7a");
        cone(0.12, 0.3, 0.55, -0.02, 0, "#8d8a83", -Math.PI / 2);
        break;
      case "ghostCrabs":
        sph(0.16, 1.1, 0.5, 0.8, 0, 0.045, 0, "#e6dccb");
        for (const side of [-1, 1]) for (let k = 0; k < 3; k++) bx(0.08, 0.012, 0.012, side * 0.1, 0.03, -0.04 + k * 0.04, "#d9c9a5", -side * 0.5, side * (k - 1) * 0.3);
        for (const side of [-1, 1]) bx(0.012, 0.06, 0.012, side * 0.03, 0.09, 0.05, "#2b3a45");
        break;
      default: throw new Error(`no fauna kit ${kind}`);
    }
    const m = mergeFlat(kind, parts, s);
    if (emissive) {
      const mat = flatMaterial(s).clone(`${kind}Mat`) as StandardMaterial;
      mat.emissiveColor = Color3.FromHexString(emissive);
      mat.disableLighting = true;
      m.material = mat;
    }
    m.isPickable = false; m.alwaysSelectAsActiveMesh = true; m.setEnabled(false);
    return m;
  }

  private kind(kind: FaunaKind, max: number): Kind {
    let k = this.kinds.get(kind);
    if (!k) { k = { mesh: null, max, buf: new Float32Array(max * 16), count: 0 }; this.kinds.set(kind, k); }
    if (!k.mesh) k.mesh = this.build(kind);
    return k;
  }

  private show(kind: FaunaKind, max: number, poses: Pose[]): void {
    const k = this.kind(kind, max);
    const n = Math.min(max, poses.length);
    for (let i = 0; i < n; i++) {
      const p = poses[i], s = p.s ?? 1;
      Matrix.Compose(new Vector3(s, s, s), Quaternion.FromEulerAngles(0, p.yaw, p.pitch ?? 0), p.pos).copyToArray(k.buf, i * 16);
    }
    k.count = n;
    if (!n) { k.mesh!.setEnabled(false); return; }
    k.mesh!.setEnabled(true);
    k.mesh!.thinInstanceSetBuffer("matrix", k.buf.subarray(0, n * 16), 16, false);
  }

  // ---------- sites ----------

  /** Seeded sites near the town (within REACH of any building) whose cell passes `pred`, re-picked when the town changes. */
  private sitesFor(state: SimState, name: string, n: number, pred: (i: number, j: number) => boolean, seed: number, anywhere = false): Site[] {
    const cached = this.sites.get(name);
    if (cached) return cached;
    const cells = new Set<number>();
    const consider = (i: number, j: number) => { if (inBounds(i, j) && !this.grid.buildingAt({ i, j }) && pred(i, j)) cells.add(cellIndex(i, j)); };
    if (anywhere) { for (let i = -HALF; i < HALF; i++) for (let j = -HALF; j < HALF; j++) consider(i, j); }
    else for (const b of Object.values(state.buildings)) for (const c of b.cells) for (let di = -REACH; di <= REACH; di++) for (let dj = -REACH; dj <= REACH; dj++) consider(c.i + di, c.j + dj);
    const list = [...cells].sort((a, b) => a - b);
    let s = seed;
    const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    for (let k = list.length - 1; k > 0; k--) { const r = Math.floor(rnd() * (k + 1)); [list[k], list[r]] = [list[r], list[k]]; }
    const out = list.slice(0, n).map(k => {
      const x = Math.floor(k / 64) - HALF + 0.25 + rnd() * 0.5, z = (k % 64) - HALF + 0.25 + rnd() * 0.5;
      return { x, z, h: ground(x, z), yaw: rnd() * 6.28, phase: rnd() * 6.28, k };
    });
    this.sites.set(name, out);
    return out;
  }

  private refreshSites(state: SimState): void {
    const ids = Object.keys(state.buildings);
    const key = ids.length + ":" + ids[ids.length - 1] + ":" + this.grid.terrainVersion + ":" + state.world.seed + state.world.biome;
    if (key === this.siteKey) return;
    this.siteKey = key;
    this.sites.clear();
  }

  // ---------- per frame ----------

  sync(state: SimState, viewTime: number): void {
    this.refreshSites(state);
    const g = this.grid, level = state.tide.level, day = isDaytime(state.time);
    const hAt = (i: number, j: number) => g.heights[cellIndex(i, j)];
    const flat = (i: number, j: number) => g.classAt({ i, j }) === "flat";
    const bank = (i: number, j: number) => flat(i, j) && g.neighbors({ i, j }).some(n => g.classAt(n) === "deep");
    const nearWater = (i: number, j: number) => g.neighbors({ i, j }).some(n => g.water[cellIndex(n.i, n.j)]);
    const wave = (x: number, z: number) => level + waveHeight(x, z, viewTime);
    const on = (k: FaunaKind) => this.fauna.has(k);
    for (const [kind, k] of this.kinds) if (!on(kind) && k.mesh) { k.mesh.setEnabled(false); k.count = 0; }

    if (on("flamingos")) {
      // Wading the flats by day where the water is shallow; gone at night and when the tide is over them.
      const sites = this.sitesFor(state, "flamingos", 10, (i, j) => flat(i, j) && !bank(i, j), 51);
      const poses: Pose[] = [];
      if (day) for (const s of sites) { const depth = level - s.h; if (depth > 0.3) continue; const y = Math.max(s.h, level - 0.02); poses.push({ pos: new Vector3(s.x + 0.2 * Math.sin(viewTime * 0.1 + s.phase), y - Math.max(0, depth) * 0.9, s.z), yaw: s.yaw + 0.2 * Math.sin(viewTime * 0.3 + s.phase) }); }
      this.show("flamingos", 10, poses);
    }
    if (on("herons")) {
      const sites = this.sitesFor(state, "herons", 5, bank, 53);
      const poses = sites.filter(s => level - s.h < 0.35).map(s => ({ pos: new Vector3(s.x, Math.max(s.h, level - 0.1), s.z), yaw: s.yaw, pitch: Math.max(0, Math.sin(viewTime * 0.7 + s.phase) * 3 - 2.4) * 0.4 }));
      this.show("herons", 5, poses);
    }
    if (on("crocodiles")) {
      // Basking on the banks while the water is off them; slipping back in as it rises.
      const sites = this.sitesFor(state, "crocodiles", 4, bank, 57);
      const poses = sites.filter(s => s.h > level - 0.05).map(s => ({ pos: new Vector3(s.x, s.h + 0.02, s.z), yaw: s.yaw + 0.05 * Math.sin(viewTime * 0.2 + s.phase) }));
      this.show("crocodiles", 4, poses);
    }
    if (on("fireflies")) {
      const sites = this.sitesFor(state, "fireflies", 36, (i, j) => (flat(i, j) || g.materialAt({ i, j }) === "mangrove") && hAt(i, j) > level - 0.2, 59);
      const poses = day ? [] : sites.map(s => {
        const t = viewTime * 0.6 + s.phase;
        return { pos: new Vector3(s.x + 0.4 * Math.sin(t), Math.max(s.h, level) + 0.5 + 0.25 * Math.sin(t * 1.7), s.z + 0.4 * Math.cos(t * 0.8)), yaw: 0, s: 0.6 + 0.6 * Math.max(0, Math.sin(viewTime * 3 + s.phase * 5)) };
      });
      this.show("fireflies", 36, poses);
    }
    if (on("iguanas")) {
      const sites = this.sitesFor(state, "iguanas", 8, (i, j) => g.isBeach({ i, j }) || (g.classAt({ i, j }) === "high" && hAt(i, j) < 1.4 && nearWater(i, j)), 61);
      const poses = day ? sites.map(s => ({ pos: new Vector3(s.x + 0.1 * Math.sin(viewTime * 0.15 + s.phase), s.h + 0.01, s.z), yaw: s.yaw + 0.3 * Math.sin(viewTime * 0.2 + s.phase) })) : [];
      this.show("iguanas", 8, poses);
    }
    if (on("boobies")) {
      // Circling every harbour with boats, as gulls do elsewhere.
      const poses: Pose[] = [];
      for (const h of Object.values(state.buildings) as Building[]) {
        if ((BUILDINGS[h.kind].slots ?? 0) === 0 || h.boats === 0) continue;
        const c = h.cells[0];
        for (let k = 0; k < 3; k++) {
          const t = (k % 2 ? -1 : 1) * (viewTime * (0.5 - k * 0.05) + k * 1.4 + h.id), r = 1.8 + k * 0.5;
          poses.push({ pos: new Vector3(c.i + 0.5 + Math.cos(t) * r, h.floorY + 2.4 + k * 0.3, c.j + 0.5 + Math.sin(t) * r), yaw: -t - (k % 2 ? -1 : 1) * Math.PI / 2, s: 0.75 });
        }
      }
      this.show("boobies", 36, poses);
    }
    if (on("plankton")) {
      const sites = this.sitesFor(state, "plankton", 60, (i, j) => g.water[cellIndex(i, j)] === 1 && hAt(i, j) > -1.2 && nearWater(i, j), 67);
      const poses = day ? [] : sites.filter(s => level - s.h > 0.05).map(s => ({ pos: new Vector3(s.x + 0.3 * Math.sin(viewTime * 0.2 + s.phase), wave(s.x, s.z) - 0.03, s.z), yaw: s.phase, s: 0.5 + 0.8 * Math.max(0, Math.sin(viewTime * 1.3 + s.phase * 3)) }));
      this.show("plankton", 60, poses);
    }
    if (on("pelicans")) {
      // Two to a pier end, on the posts, heads turning.
      const poses: Pose[] = [];
      for (const h of Object.values(state.buildings) as Building[]) {
        if (h.kind !== "pier" && h.kind !== "dock") continue;
        const c = h.cells[h.cells.length - 1];
        for (const [dx, dz] of [[0.3, 0.3], [-0.3, 0.3]]) poses.push({ pos: new Vector3(c.i + 0.5 + dx, h.floorY + 0.02, c.j + 0.5 + dz), yaw: h.id + dx * 4 + 0.4 * Math.sin(viewTime * 0.3 + dx * 7) });
      }
      this.show("pelicans", 24, poses);
    }
    if (on("dolphins")) {
      // Arcs out of the lagoon: each rises and dives along its heading every few seconds.
      const lagoon = materialCode("lagoon");
      const sites = this.sitesFor(state, "dolphins", 4, (i, j) => g.materials[cellIndex(i, j)] === lagoon && hAt(i, j) < level - 0.3, 71, true);
      const poses: Pose[] = [];
      for (const s of sites) {
        const u = ((viewTime * 0.25 + s.phase) % 1 + 1) % 1;
        if (u > 0.35) continue;
        const a = u / 0.35;
        const dx = Math.cos(s.yaw), dz = Math.sin(s.yaw);
        poses.push({ pos: new Vector3(s.x + dx * (a - 0.5) * 1.6, level - 0.2 + Math.sin(a * Math.PI) * 0.5, s.z + dz * (a - 0.5) * 1.6), yaw: -s.yaw, pitch: (0.5 - a) * 1.6 });
      }
      this.show("dolphins", 4, poses);
    }
    if (on("ghostCrabs")) {
      const sites = this.sitesFor(state, "ghostCrabs", 16, (i, j) => g.isBeach({ i, j }) || (flat(i, j) && hAt(i, j) > 0.2), 73);
      const poses = day ? [] : sites.filter(s => s.h > level).map(s => { const t = viewTime * 0.9 + s.phase; return { pos: new Vector3(s.x + 0.3 * Math.sin(t), s.h + 0.01, s.z + 0.3 * Math.sin(t * 0.7)), yaw: t }; });
      this.show("ghostCrabs", 16, poses);
    }
  }
}
