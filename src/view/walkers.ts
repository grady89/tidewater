// Walkers as thin instances of one three-primitive figure with a per-instance colour. At every shift change the
// view spawns one walker per assigned worker (capped, sampled beyond the cap) and walks it over the walkway graph
// between home and work; a few loiterers mill about staffed markets. Nothing here writes to the sim.
import { Color4, Matrix, Mesh, MeshBuilder, Quaternion, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import { SIZE } from "../config";
import { BUILDINGS } from "../sim/balance";
import { cellCenter, cellIndex, Grid } from "../sim/grid";
import { Building, Cell, Phase, SimState } from "../sim/state";
import { flatMaterial, mergeFlat, tint } from "../world/flatMesh";

export const MAX_WALKERS = 200;
const SPEED = 1.6; // cells per second
const LOITERERS_PER_MARKET = 3;
const COLORS = ["#c9674f", "#4c5a66", "#2f6f8f", "#79ad5e", "#f4d9c6", "#b9543f", "#5d6d7a", "#e6d3a1"];

interface Walker {
  path: Vector3[];
  t0: number;
  duration: number;
  color: Color4;
}

interface Loiterer {
  centre: Vector3;
  seed: number;
  color: Color4;
  /** 1 for adults, smaller for kids. */
  scale: number;
}

export class Walkers {
  private readonly mesh: Mesh;
  private walkers: Walker[] = [];
  private loiterers: Loiterer[] = [];
  private lastPhase: Phase | null = null;
  private lastTime = 0;
  private matrices = new Float32Array(0);
  private colors = new Float32Array(0);
  private rng = 1;

  constructor(scene: Scene, private readonly grid: Grid) {
    const parts: Mesh[] = [];
    const body = MeshBuilder.CreateBox("wb", { width: 0.18, height: 0.32, depth: 0.12 }, scene);
    body.position.y = 0.16 + 0.1;
    parts.push(tint(body, "#ffffff"));
    const head = MeshBuilder.CreateSphere("wh", { diameter: 0.15, segments: 4 }, scene);
    head.position.y = 0.5;
    parts.push(tint(head, "#f4d9c6"));
    const hat = MeshBuilder.CreateCylinder("wt", { diameterTop: 0, diameterBottom: 0.24, height: 0.12, tessellation: 5 }, scene);
    hat.position.y = 0.6;
    parts.push(tint(hat, "#e6d3a1"));
    this.mesh = mergeFlat("walkers", parts, scene);
    this.mesh.material = flatMaterial(scene).clone("walkerMat") as StandardMaterial;
    this.mesh.isPickable = false;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.setEnabled(false);
  }

  get count(): number { return this.walkers.length; }
  get liveCount(): number { return this.walkers.length + this.loiterers.length; }
  swimmerCount(state: SimState): number { return this.swimmerPoses(state, 0).length; }

  private rand(): number {
    this.rng = (Math.imul(this.rng, 1664525) + 1013904223) >>> 0;
    return this.rng / 4294967296;
  }

  /** Walkable cells: reached, un-cut links and roots. */
  private walkable(c: Cell): boolean {
    const b = this.grid.buildingAt(c);
    return !!b && b.reached && !b.cut && BUILDINGS[b.kind].network !== "leaf";
  }

  private deckY(c: Cell): number {
    return this.grid.buildingAt(c)?.floorY ?? 1;
  }

  /** Shortest walk from a cell of `from` to a walkable cell touching `to`, as deck-height points. */
  private route(from: Building, to: Building): Vector3[] | null {
    const target = new Set<number>();
    for (const c of to.cells) for (const n of this.grid.neighbors(c)) if (this.walkable(n)) target.add(cellIndex(n.i, n.j));
    for (const c of to.cells) target.add(cellIndex(c.i, c.j));
    const prev = new Int32Array(SIZE * SIZE).fill(-2);
    const queue: Cell[] = [];
    for (const c of from.cells) for (const n of this.grid.neighbors(c)) {
      if (!this.walkable(n) && !target.has(cellIndex(n.i, n.j))) continue;
      const k = cellIndex(n.i, n.j);
      if (prev[k] !== -2) continue;
      prev[k] = cellIndex(c.i, c.j);
      queue.push(n);
    }
    let end: Cell | null = null;
    let head = 0;
    while (head < queue.length) {
      const c = queue[head++];
      if (target.has(cellIndex(c.i, c.j))) { end = c; break; }
      for (const n of this.grid.neighbors(c)) {
        const k = cellIndex(n.i, n.j);
        if (prev[k] !== -2 || !this.walkable(n)) continue;
        prev[k] = cellIndex(c.i, c.j);
        queue.push(n);
      }
    }
    if (!end) return null;
    const cells: Cell[] = [end];
    let k = cellIndex(end.i, end.j);
    const fromCells = new Set(from.cells.map(c => cellIndex(c.i, c.j)));
    while (!fromCells.has(k) && cells.length < 400) {
      const p = prev[k];
      if (p < 0) break;
      k = p;
      cells.push({ i: Math.floor(k / SIZE) - SIZE / 2, j: (k % SIZE) - SIZE / 2 });
    }
    cells.reverse();
    return cells.map(c => { const { x, z } = cellCenter(c); return new Vector3(x, this.deckY(c), z); });
  }

  /** Spawn the wave of walkers for a shift change: home → work when a shift starts, back when it ends. */
  private shiftChange(state: SimState, toWork: boolean, now: number): void {
    const total = state.assignments.reduce((n, a) => n + a.n, 0);
    const keep = total > MAX_WALKERS ? MAX_WALKERS / total : 1;
    for (const a of state.assignments) {
      const home = state.buildings[a.home], work = state.buildings[a.work];
      if (!home || !work) continue;
      const path = toWork ? this.route(home, work) : this.route(work, home);
      if (!path || path.length < 2) continue;
      for (let k = 0; k < a.n; k++) {
        if (this.rand() > keep) continue;
        if (this.walkers.length >= MAX_WALKERS) return;
        const jitter = new Vector3((this.rand() - 0.5) * 0.4, 0, (this.rand() - 0.5) * 0.4);
        this.walkers.push({
          path: path.map(p => p.add(jitter)),
          t0: now + this.rand() * 2,
          duration: path.length / SPEED,
          color: Color4.FromHexString(COLORS[Math.floor(this.rand() * COLORS.length)]),
        });
      }
    }
  }

  /** Stress test only: `n` more walkers on the town's existing routes. Pure view; the ledger is untouched. */
  spawnExtra(state: SimState, n: number, now: number): number {
    const pairs = state.assignments.map(a => [state.buildings[a.home], state.buildings[a.work]] as const).filter(([h, w]) => h && w);
    if (!pairs.length) return 0;
    let spawned = 0;
    for (let k = 0; k < n && this.walkers.length < MAX_WALKERS * 2; k++) {
      const [home, work] = pairs[Math.floor(this.rand() * pairs.length)];
      const path = this.route(home, work);
      if (!path || path.length < 2) continue;
      const jitter = new Vector3((this.rand() - 0.5) * 0.4, 0, (this.rand() - 0.5) * 0.4);
      this.walkers.push({ path: path.map(p => p.add(jitter)), t0: now + this.rand() * 4, duration: path.length / SPEED + 30, color: Color4.FromHexString(COLORS[Math.floor(this.rand() * COLORS.length)]) });
      spawned++;
    }
    return spawned;
  }

  private refreshLoiterers(state: SimState): void {
    this.loiterers = [];
    for (const b of Object.values(state.buildings)) {
      const is = b.cells.map(c => c.i), js = b.cells.map(c => c.j);
      const cx = (Math.min(...is) + Math.max(...is) + 1) / 2, cz = (Math.min(...js) + Math.max(...js) + 1) / 2;
      if ((b.kind === "market" || b.kind === "marketSquare") && b.reached && !b.cut && (b.kind === "marketSquare" || b.workers > 0)) {
        for (let k = 0; k < LOITERERS_PER_MARKET; k++) {
          this.loiterers.push({ centre: new Vector3(cx, b.floorY, cz), seed: b.id * 7 + k, color: Color4.FromHexString(COLORS[(b.id + k) % COLORS.length]), scale: 1 });
        }
      }
      // Kids play around homes that have grown.
      if (BUILDINGS[b.kind].residents > 0 && b.level >= 2 && b.residents > 0 && b.reached) {
        this.loiterers.push({ centre: new Vector3(cx, b.floorY, cz), seed: b.id * 11, color: Color4.FromHexString(COLORS[(b.id + 3) % COLORS.length]), scale: 0.6 });
      }
    }
  }

  /** Swimmers: bobbing figures in the water beside each beach cell that has people on it. */
  private swimmerPoses(state: SimState, viewTime: number): { pos: Vector3; yaw: number; color: Color4 }[] {
    const out: { pos: Vector3; yaw: number; color: Color4 }[] = [];
    if (state.phase !== "high") return out;
    const level = state.tide.level;
    for (const s of state.swimmers) {
      const ci = Math.floor(s.k / SIZE) - SIZE / 2, cj = (s.k % SIZE) - SIZE / 2;
      const beach = { i: ci, j: cj };
      const water = this.grid.neighbors(beach).find(n => this.grid.water[cellIndex(n.i, n.j)]);
      if (!water) continue;
      const count = Math.min(6, Math.round(s.n));
      for (let k = 0; k < count; k++) {
        const t = viewTime * 0.6 + k * 1.7 + s.k * 0.01;
        const x = water.i + 0.5 + Math.cos(t) * 0.3 + (k % 3 - 1) * 0.25, z = water.j + 0.5 + Math.sin(t * 0.8) * 0.3 + Math.floor(k / 3) * 0.3 - 0.15;
        out.push({ pos: new Vector3(x, level + Math.sin(viewTime * 2 + k) * 0.04 - 0.32, z), yaw: t, color: Color4.FromHexString(COLORS[(k + 2) % COLORS.length]) });
      }
    }
    return out;
  }

  sync(state: SimState, viewTime: number): void {
    if (this.lastPhase !== state.phase) {
      const prev = this.lastPhase;
      this.lastPhase = state.phase;
      if (prev !== null) {
        if (state.phase !== "slack") this.shiftChange(state, true, viewTime);
        else if (prev !== "slack") this.shiftChange(state, false, viewTime);
      }
      this.refreshLoiterers(state);
    }
    if (Math.floor(viewTime / 5) !== Math.floor(this.lastTime / 5)) this.refreshLoiterers(state);
    this.lastTime = viewTime;
    this.walkers = this.walkers.filter(w => viewTime < w.t0 + w.duration);
    const swimmers = this.swimmerPoses(state, viewTime);

    const n = this.walkers.length + this.loiterers.length + swimmers.length;
    if (this.matrices.length !== n * 16) { this.matrices = new Float32Array(n * 16); this.colors = new Float32Array(n * 4); }
    const scale = new Vector3(1, 1, 1);
    let k = 0;
    const put = (pos: Vector3, yaw: number, color: Color4, s = 1) => {
      scale.set(s, s, s);
      Matrix.Compose(scale, Quaternion.FromEulerAngles(0, yaw, 0), pos).copyToArray(this.matrices, k * 16);
      this.colors[k * 4] = color.r; this.colors[k * 4 + 1] = color.g; this.colors[k * 4 + 2] = color.b; this.colors[k * 4 + 3] = 1;
      k++;
    };
    for (const w of this.walkers) {
      const u = Math.min(1, Math.max(0, (viewTime - w.t0) / w.duration));
      const idx = u * (w.path.length - 1);
      const i0 = Math.min(w.path.length - 2, Math.floor(idx)), f = idx - i0;
      const a = w.path[i0], b = w.path[i0 + 1];
      const pos = new Vector3(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.z + (b.z - a.z) * f);
      const bob = u > 0 && u < 1 ? Math.abs(Math.sin(viewTime * 9)) * 0.03 : 0;
      pos.y += bob;
      put(pos, Math.atan2(b.x - a.x, b.z - a.z), w.color);
    }
    for (const l of this.loiterers) {
      const t = viewTime * (l.scale < 1 ? 0.8 : 0.35) + l.seed;
      const r = l.scale < 1 ? 0.7 : 0.55;
      const pos = new Vector3(l.centre.x + Math.cos(t) * r, l.centre.y, l.centre.z + Math.sin(t * 0.7) * r);
      put(pos, t + Math.PI / 2, l.color, l.scale);
    }
    for (const s of swimmers) put(s.pos, s.yaw, s.color);
    if (n === 0) { this.mesh.setEnabled(false); return; }
    this.mesh.setEnabled(true);
    this.mesh.thinInstanceSetBuffer("matrix", this.matrices, 16, false);
    this.mesh.thinInstanceSetBuffer("color", this.colors, 4, false);
  }

  clear(): void {
    this.walkers = [];
    this.loiterers = [];
    this.lastPhase = null;
    this.mesh.setEnabled(false);
  }
}
