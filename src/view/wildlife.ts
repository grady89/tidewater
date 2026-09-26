// Gulls and crabs: decoration derived from the ledger every frame, two thin-instanced meshes, no state of their
// own. Gulls circle every harbour that has boats; crabs scuttle on flat cells near the town while the tide leaves
// them exposed. View only.
import { Matrix, Mesh, MeshBuilder, Quaternion, Scene, Vector3 } from "@babylonjs/core";
import { TIDE_HI, TIDE_LO } from "../config";
import { BUILDINGS } from "../sim/balance";
import { cellIndex, Grid, HALF, inBounds } from "../sim/grid";
import { terrainHeight } from "../sim/heightfield";
import { Building, SimState } from "../sim/state";
import { mergeFlat, tint } from "../world/flatMesh";

const GULLS_PER_HARBOUR = 2;
const GULLS_PER_BOAT = 1;
const MAX_GULLS = 48;
const CRAB_SITES = 22;
const CRAB_REACH = 4;
/** A crab sits still for most of each bout, then scuttles sideways to a new spot within its cell. */
const CRAB_BOUT = 3.2, CRAB_MOVE = 0.35;

interface CrabSite { x: number; z: number; h: number; phase: number }

export class Wildlife {
  private readonly gulls: Mesh;
  private readonly crabs: Mesh;
  private gullMatrices = new Float32Array(MAX_GULLS * 16);
  private crabMatrices = new Float32Array(CRAB_SITES * 16);
  private sites: CrabSite[] = [];
  private siteKey = "";
  gullCount = 0;
  crabCount = 0;

  constructor(scene: Scene, private readonly grid: Grid) {
    // A gull: a slim body and two wings swept up into a shallow V.
    const body = MeshBuilder.CreateBox("gb", { width: 0.28, height: 0.06, depth: 0.08 }, scene);
    const parts = [tint(body, "#f2ece0")];
    for (const side of [-1, 1]) {
      const wing = MeshBuilder.CreateBox("gw", { width: 0.1, height: 0.02, depth: 0.32 }, scene);
      wing.position.set(0, 0.04, side * 0.18);
      wing.rotation.x = side * 0.35;
      parts.push(tint(wing, "#e6e2d8"));
    }
    this.gulls = mergeFlat("gulls", parts, scene);
    // A crab: a flat oval of a shell with a claw either side.
    const shell = MeshBuilder.CreateCylinder("cs", { diameter: 0.16, height: 0.05, tessellation: 6 }, scene);
    shell.scaling.z = 0.7;
    shell.position.y = 0.04;
    const crabParts = [tint(shell, "#c9674f")];
    for (const side of [-1, 1]) {
      const claw = MeshBuilder.CreateBox("cc", { width: 0.05, height: 0.03, depth: 0.05 }, scene);
      claw.position.set(side * 0.1, 0.04, 0.05);
      crabParts.push(tint(claw, "#b9543f"));
    }
    this.crabs = mergeFlat("crabs", crabParts, scene);
    for (const m of [this.gulls, this.crabs]) { m.isPickable = false; m.alwaysSelectAsActiveMesh = true; m.setEnabled(false); }
  }

  /** Seeded crab sites: unbuilt flat cells within reach of the town, re-picked when the building set changes. */
  private pickSites(state: SimState): void {
    const ids = Object.keys(state.buildings);
    const key = ids.length + ":" + ids[ids.length - 1];
    if (key === this.siteKey) return;
    this.siteKey = key;
    const candidates = new Set<number>();
    for (const b of Object.values(state.buildings)) for (const c of b.cells) {
      for (let di = -CRAB_REACH; di <= CRAB_REACH; di++) for (let dj = -CRAB_REACH; dj <= CRAB_REACH; dj++) {
        const i = c.i + di, j = c.j + dj;
        if (!inBounds(i, j)) continue;
        const k = cellIndex(i, j);
        const h = this.grid.heights[k];
        if (h < TIDE_LO || h > TIDE_HI || this.grid.buildingAt({ i, j })) continue;
        candidates.add(k);
      }
    }
    const cells = [...candidates].sort((a, b) => a - b);
    let seed = 7;
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (let k = cells.length - 1; k > 0; k--) { const r = Math.floor(rnd() * (k + 1)); [cells[k], cells[r]] = [cells[r], cells[k]]; }
    this.sites = cells.slice(0, CRAB_SITES).map(k => {
      const x = Math.floor(k / 64) - HALF + 0.2 + rnd() * 0.6, z = (k % 64) - HALF + 0.2 + rnd() * 0.6;
      return { x, z, h: terrainHeight(x, z), phase: rnd() * 6.28 };
    });
  }

  private syncGulls(state: SimState, viewTime: number): void {
    let n = 0;
    const scale = new Vector3(0.7, 0.7, 0.7);
    for (const h of Object.values(state.buildings) as Building[]) {
      if ((BUILDINGS[h.kind].slots ?? 0) === 0 || h.boats === 0) continue;
      const is = h.cells.map(c => c.i), js = h.cells.map(c => c.j);
      const cx = (Math.min(...is) + Math.max(...is) + 1) / 2, cz = (Math.min(...js) + Math.max(...js) + 1) / 2;
      const flock = Math.min(5, GULLS_PER_HARBOUR + GULLS_PER_BOAT * h.boats);
      for (let k = 0; k < flock && n < MAX_GULLS; k++) {
        const dir = k % 2 === 0 ? 1 : -1;
        const r = 1.6 + k * 0.5, speed = 0.55 - k * 0.05;
        const t = dir * (viewTime * speed + k * 1.3 + h.id);
        const x = cx + Math.cos(t) * r, z = cz + Math.sin(t) * r;
        const y = h.floorY + 2.2 + k * 0.35 + 0.25 * Math.sin(viewTime * 1.7 + k);
        const flap = 0.25 * Math.sin(viewTime * 9 + k * 2);
        const q = Quaternion.FromEulerAngles(flap, -t - dir * Math.PI / 2, dir * 0.15);
        Matrix.Compose(scale, q, new Vector3(x, y, z)).copyToArray(this.gullMatrices, n++ * 16);
      }
    }
    this.gullCount = n;
    if (n === 0) { this.gulls.setEnabled(false); return; }
    this.gulls.setEnabled(true);
    this.gulls.thinInstanceSetBuffer("matrix", this.gullMatrices.subarray(0, n * 16), 16, false);
  }

  private syncCrabs(state: SimState, viewTime: number): void {
    this.pickSites(state);
    const level = state.tide.level;
    let n = 0;
    for (const s of this.sites) {
      const exposed = (s.h - level) / 0.08; // pops up over the first 8 cm of exposure
      if (exposed <= 0) continue;
      const sc = Math.min(1, exposed);
      // Bouts: each one has a seeded resting spot; the crab darts from the last spot to this one in the first
      // CRAB_MOVE seconds of the bout and then sits. Facing is sideways to the dart, as crabs walk.
      const t = viewTime / CRAB_BOUT + s.phase;
      const bout = Math.floor(t);
      const u = Math.min(1, ((t - bout) * CRAB_BOUT) / CRAB_MOVE);
      const spot = (k: number) => { const h = Math.sin(k * 12.9898 + s.phase * 78.233) * 43758.5453; const a = (h - Math.floor(h)) * 6.283; return { x: 0.3 * Math.cos(a), z: 0.3 * Math.sin(a) }; };
      const from = spot(bout - 1), to = spot(bout);
      const e = u * u * (3 - 2 * u);
      const ox = from.x + (to.x - from.x) * e, oz = from.z + (to.z - from.z) * e;
      const yaw = Math.atan2(to.x - from.x, to.z - from.z);
      const pos = new Vector3(s.x + ox, s.h, s.z + oz);
      Matrix.Compose(new Vector3(sc, sc, sc), Quaternion.FromEulerAngles(0, yaw, 0), pos).copyToArray(this.crabMatrices, n++ * 16);
    }
    this.crabCount = n;
    if (n === 0) { this.crabs.setEnabled(false); return; }
    this.crabs.setEnabled(true);
    this.crabs.thinInstanceSetBuffer("matrix", this.crabMatrices.subarray(0, n * 16), 16, false);
  }

  sync(state: SimState, viewTime: number): void {
    this.syncGulls(state, viewTime);
    this.syncCrabs(state, viewTime);
  }
}
