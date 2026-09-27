// Gulls and crabs: decoration derived from the ledger every frame, two thin-instanced meshes, no state of their
// own. Gulls circle every harbour that has boats; crabs scuttle on flat cells near the town while the tide leaves
// them exposed. View only.
import { Matrix, Mesh, MeshBuilder, Quaternion, Scene, Vector3 } from "@babylonjs/core";
import { TIDE_HI, TIDE_LO } from "../config";
import { BUILDINGS } from "../sim/balance";
import { cellIndex, Grid, HALF, inBounds } from "../sim/grid";
import { ground as groundHeight } from "./ground";
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

const PALETTE_BEAK = "#ffb859";

export class Wildlife {
  private readonly gulls: Mesh;
  private readonly wingL: Mesh;
  private readonly wingR: Mesh;
  private readonly crabs: Mesh;
  private gullMatrices = new Float32Array(MAX_GULLS * 16);
  private wingLMatrices = new Float32Array(MAX_GULLS * 16);
  private wingRMatrices = new Float32Array(MAX_GULLS * 16);
  private crabMatrices = new Float32Array(CRAB_SITES * 16);
  private sites: CrabSite[] = [];
  private siteKey = "";
  gullCount = 0;
  crabCount = 0;

  constructor(scene: Scene, private readonly grid: Grid) {
    // A gull after reference/birds: a tapered white body with a small head, an orange beak, a wedge tail and red
    // legs; the wings are their own meshes, hinged at the shoulder, so the flock can flap.
    const body = MeshBuilder.CreateSphere("gb", { diameter: 0.3, segments: 4 }, scene);
    body.scaling.set(1.35, 0.5, 0.6);
    const head = MeshBuilder.CreateSphere("gh", { diameter: 0.12, segments: 4 }, scene);
    head.position.set(0.2, 0.05, 0);
    const beak = MeshBuilder.CreateCylinder("gk", { diameterTop: 0, diameterBottom: 0.05, height: 0.09, tessellation: 4 }, scene);
    beak.rotation.z = -Math.PI / 2;
    beak.position.set(0.29, 0.04, 0);
    const tail = MeshBuilder.CreateBox("gt", { width: 0.16, height: 0.02, depth: 0.12 }, scene);
    tail.position.set(-0.24, 0.02, 0);
    const parts = [tint(body, "#f2ece0"), tint(head, "#f2ece0"), tint(beak, PALETTE_BEAK), tint(tail, "#e6e2d8")];
    for (const side of [-1, 1]) {
      const leg = MeshBuilder.CreateBox("gl", { width: 0.04, height: 0.02, depth: 0.02 }, scene);
      leg.position.set(-0.06, -0.07, side * 0.04);
      parts.push(tint(leg, "#b9543f"));
    }
    this.gulls = mergeFlat("gulls", parts, scene);
    const wing = (side: number) => {
      const inner = MeshBuilder.CreateBox("gw", { width: 0.2, height: 0.015, depth: 0.22 }, scene);
      inner.position.set(-0.02, 0, side * 0.16);
      const outer = MeshBuilder.CreateBox("gw", { width: 0.13, height: 0.012, depth: 0.2 }, scene);
      outer.position.set(-0.08, 0, side * 0.36);
      outer.rotation.y = -side * 0.35;
      const tip = MeshBuilder.CreateBox("gw", { width: 0.07, height: 0.01, depth: 0.08 }, scene);
      tip.position.set(-0.13, 0, side * 0.49);
      tip.rotation.y = -side * 0.5;
      const m = mergeFlat("gullWing", [tint(inner, "#f2ece0"), tint(outer, "#e6e2d8"), tint(tip, "#5d6d7a")], scene);
      m.isPickable = false; m.alwaysSelectAsActiveMesh = true; m.setEnabled(false);
      return m;
    };
    this.wingL = wing(-1); this.wingR = wing(1);
    // A crab after reference/crabs: a rounded shell, two claws held forward, six jointed legs, eyes on stalks.
    const shell = MeshBuilder.CreateSphere("cs", { diameter: 0.2, segments: 4 }, scene);
    shell.scaling.set(1.05, 0.45, 0.75);
    shell.position.y = 0.055;
    const crabParts = [tint(shell, "#c9674f")];
    for (const side of [-1, 1]) {
      const arm = MeshBuilder.CreateBox("ca", { width: 0.04, height: 0.03, depth: 0.09 }, scene);
      arm.position.set(side * 0.11, 0.05, 0.1);
      arm.rotation.y = -side * 0.4;
      crabParts.push(tint(arm, "#b9543f"));
      const claw = MeshBuilder.CreateSphere("cc", { diameter: 0.06, segments: 3 }, scene);
      claw.scaling.set(1, 0.7, 1.3);
      claw.position.set(side * 0.13, 0.055, 0.16);
      crabParts.push(tint(claw, "#c9674f"));
      for (let k = 0; k < 3; k++) {
        const leg = MeshBuilder.CreateBox("cl", { width: 0.1, height: 0.015, depth: 0.015 }, scene);
        leg.position.set(side * 0.13, 0.03, -0.02 + k * 0.045 - 0.04);
        leg.rotation.z = -side * 0.5;
        leg.rotation.y = side * (k - 1) * 0.3;
        crabParts.push(tint(leg, "#b9543f"));
      }
      const eye = MeshBuilder.CreateSphere("ce", { diameter: 0.025, segments: 2 }, scene);
      eye.position.set(side * 0.04, 0.1, 0.07);
      crabParts.push(tint(eye, "#2b3a45"));
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
      return { x, z, h: groundHeight(x, z), phase: rnd() * 6.28 };
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
        // Gliding most of the time with a few quick beats: the flap angle is a clipped sine.
        const beat = Math.sin(viewTime * 7 + k * 2.1);
        const flap = Math.max(-0.2, Math.min(0.7, beat * 1.2)) * (Math.sin(viewTime * 0.6 + k) > -0.2 ? 1 : 0.15);
        const yaw = -t - dir * Math.PI / 2;
        const bank = dir * 0.18;
        const bodyM = Matrix.Compose(scale, Quaternion.FromEulerAngles(0, yaw, bank), new Vector3(x, y, z));
        bodyM.copyToArray(this.gullMatrices, n * 16);
        // Wings hinge about the body's forward (x) axis, opposite senses either side.
        Matrix.RotationX(-flap).multiply(bodyM).copyToArray(this.wingLMatrices, n * 16);
        Matrix.RotationX(flap).multiply(bodyM).copyToArray(this.wingRMatrices, n * 16);
        n++;
      }
    }
    this.gullCount = n;
    if (n === 0) { for (const m of [this.gulls, this.wingL, this.wingR]) m.setEnabled(false); return; }
    for (const m of [this.gulls, this.wingL, this.wingR]) m.setEnabled(true);
    this.gulls.thinInstanceSetBuffer("matrix", this.gullMatrices.subarray(0, n * 16), 16, false);
    this.wingL.thinInstanceSetBuffer("matrix", this.wingLMatrices.subarray(0, n * 16), 16, false);
    this.wingR.thinInstanceSetBuffer("matrix", this.wingRMatrices.subarray(0, n * 16), 16, false);
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
