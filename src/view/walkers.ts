// Walkers as thin instances of one three-primitive figure with a per-instance colour. At every shift change the
// view spawns one walker per assigned worker (capped, sampled beyond the cap) and walks it over the walkway graph
// between home and work; a few loiterers mill about staffed markets. Nothing here writes to the sim.
import { Color4, Matrix, Mesh, MeshBuilder, Quaternion, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import { SIZE } from "../config";
import { BUILDINGS, SWIM_FRACTION } from "../sim/balance";
import { cellCenter, cellIndex, Grid } from "../sim/grid";
import { ground as groundHeight } from "./ground";
import { ferryTerminals } from "../sim/network";
import { Building, Cell, Phase, population, SimState } from "../sim/state";
import { flatMaterial, mergeFlat, tint } from "../world/flatMesh";
import { BiomeLook, HatKit } from "./biomes";

export const MAX_WALKERS = 200;
const SPEED = 1.6; // cells per second
const LOITERERS_PER_MARKET = 3;
const COLORS = ["#c9674f", "#4c5a66", "#2f6f8f", "#79ad5e", "#f4d9c6", "#b9543f", "#5d6d7a", "#e6d3a1"];

interface Walker {
  path: Vector3[];
  t0: number;
  duration: number;
  color: Color4;
  /** Workers stay at the end of their walk (at work) until the shift ends; others go indoors and fade. */
  stay: boolean;
  seed: number;
  /** Porters carry a basket of the catch from the harbour to the market. */
  carry: boolean;
}
/** Porters per landing, at most. */
const PORTERS_MAX = 4;
/** Seconds between going aboard on one side and stepping off on the other. */
const FERRY_CROSSING_SECONDS = 20;

export interface Rider { pos: Vector3; yaw: number }

/** The figure is 0.63 units tall at scale 1; at 0.4 a person is a quarter of a cell, about Cities: Skylines' ratio. */
export const PERSON_SCALE = 0.4;
/** The figure's chest height at PERSON_SCALE: swimmers sit so the waterline crosses here. */
const CHEST = 0.34 * PERSON_SCALE;
/** Seconds a homecoming walker takes to go indoors at the end of the walk. */
const FADE = 0.5;

interface Loiterer {
  centre: Vector3;
  seed: number;
  color: Color4;
  /** 1 for adults, smaller for kids. */
  scale: number;
}

export class Walkers {
  private readonly mesh: Mesh;
  private detail: Mesh;
  private readonly basket: Mesh;
  private readonly scene: Scene;
  /** The body parts the hat kits share (trousers, feet, hands); the head and hat are the kit. */
  private readonly fixedParts: Mesh[];
  private hatKit: HatKit = "straw";
  private palette: readonly string[] = COLORS;
  private readonly lastAtSea = new Map<number, boolean>();
  /** Porters spawned so far (a smoke probe). */
  portersSpawned = 0;
  private walkers: Walker[] = [];
  private loiterers: Loiterer[] = [];
  private lastPhase: Phase | null = null;
  private lastTime = 0;
  private matrices = new Float32Array(0);
  private colors = new Float32Array(0);
  private rng = 1;

  /** Live walkers at most; beyond it the view samples. The Low quality preset halves it. */
  cap = MAX_WALKERS;

  constructor(scene: Scene, private readonly grid: Grid) {
    // The figure, after reference/people: a wide conical straw hat over a round head, a tunic that flares to the
    // hem with stub sleeves, short dark trousers, bare feet. The tunic and sleeves are white so the per-instance
    // colour dresses them; everything else keeps its own colour in a second mesh driven by the same matrices.
    const tunicParts: Mesh[] = [];
    const tunic = MeshBuilder.CreateCylinder("wb", { diameterTop: 0.15, diameterBottom: 0.27, height: 0.23, tessellation: 6 }, scene);
    tunic.position.y = 0.295;
    tunicParts.push(tint(tunic, "#ffffff"));
    for (const side of [-1, 1]) {
      // Sleeves hang from the shoulder close to the body, a touch outward as in the references.
      const arm = MeshBuilder.CreateCylinder("wa", { diameter: 0.05, height: 0.15, tessellation: 5 }, scene);
      arm.position.set(side * 0.125, 0.3, 0);
      arm.rotation.z = -side * 0.1;
      tunicParts.push(tint(arm, "#ffffff"));
    }
    this.mesh = mergeFlat("walkers", tunicParts, scene);
    this.mesh.material = flatMaterial(scene).clone("walkerMat") as StandardMaterial;

    const fixedParts: Mesh[] = [];
    const trousers = MeshBuilder.CreateBox("wt", { width: 0.17, height: 0.13, depth: 0.13 }, scene);
    trousers.position.y = 0.115;
    fixedParts.push(tint(trousers, "#4c5a66"));
    for (const side of [-1, 1]) {
      const foot = MeshBuilder.CreateBox("wf", { width: 0.05, height: 0.05, depth: 0.07 }, scene);
      foot.position.set(side * 0.045, 0.025, 0.01);
      fixedParts.push(tint(foot, "#f4d9c6"));
      const hand = MeshBuilder.CreateSphere("wh", { diameter: 0.045, segments: 3 }, scene);
      hand.position.set(side * 0.14, 0.215, 0);
      fixedParts.push(tint(hand, "#f4d9c6"));
    }
    for (const p of fixedParts) p.setEnabled(false);
    this.scene = scene;
    this.fixedParts = fixedParts;
    this.detail = this.buildDetail("straw");
    // The basket a porter carries in front, at hip height: a tub with a dark band and a few fish on top.
    const tub = MeshBuilder.CreateCylinder("wk", { diameter: 0.17, diameterTop: 0.19, height: 0.12, tessellation: 6 }, scene);
    tub.position.set(0, 0.2, 0.13);
    const band = MeshBuilder.CreateCylinder("wkb", { diameter: 0.195, height: 0.025, tessellation: 6 }, scene);
    band.position.set(0, 0.23, 0.13);
    const catchTop = MeshBuilder.CreateSphere("wkf", { diameter: 0.14, segments: 3 }, scene);
    catchTop.scaling.set(1, 0.35, 1);
    catchTop.position.set(0, 0.265, 0.13);
    this.basket = mergeFlat("baskets", [tint(tub, "#b9a377"), tint(band, "#5a4636"), tint(catchTop, "#5d6d7a")], scene);
    for (const m of [this.mesh, this.detail, this.basket]) { m.isPickable = false; m.alwaysSelectAsActiveMesh = true; m.setEnabled(false); }
  }

  /** The head and the biome's hat over the shared body: a straw cone, a knit cap, or a hood that closes round the face. */
  private buildDetail(hat: HatKit): Mesh {
    const scene = this.scene;
    const parts = this.fixedParts.map(p => p.clone(p.name)!);
    const head = MeshBuilder.CreateSphere("wh", { diameter: 0.17, segments: 5 }, scene);
    head.position.y = 0.47;
    parts.push(tint(head, "#f4d9c6"));
    if (hat === "straw") {
      const cone = MeshBuilder.CreateCylinder("wt", { diameterTop: 0, diameterBottom: 0.38, height: 0.14, tessellation: 8 }, scene);
      cone.position.y = 0.56;
      parts.push(tint(cone, "#e6d3a1"));
    } else if (hat === "knit") {
      const cap = MeshBuilder.CreateSphere("wt", { diameter: 0.19, segments: 5 }, scene);
      cap.scaling.set(1, 0.7, 1);
      cap.position.y = 0.52;
      parts.push(tint(cap, "#b9543f"));
      const bobble = MeshBuilder.CreateSphere("wtb", { diameter: 0.06, segments: 3 }, scene);
      bobble.position.y = 0.6;
      parts.push(tint(bobble, "#f2ece0"));
    } else {
      const hood = MeshBuilder.CreateCylinder("wt", { diameterTop: 0.05, diameterBottom: 0.26, height: 0.26, tessellation: 6 }, scene);
      hood.position.set(0, 0.5, -0.02);
      parts.push(tint(hood, "#3d2e26"));
    }
    const m = mergeFlat("walkerDetail", parts, scene);
    m.isPickable = false; m.alwaysSelectAsActiveMesh = true; m.setEnabled(false);
    return m;
  }

  /** The biome look: hat kit and tunic colours (view/biomes). Rebuilds the detail mesh when the hat changes. */
  setLook(look: BiomeLook): void {
    this.palette = look.walker.colors;
    if (look.walker.hat === this.hatKit) return;
    this.hatKit = look.walker.hat;
    this.detail.dispose();
    this.detail = this.buildDetail(this.hatKit);
  }

  /** The catch comes ashore: when a harbour's boats land, porters carry baskets from it to the market. */
  private landings(state: SimState, now: number): void {
    for (const h of Object.values(state.buildings)) {
      if ((BUILDINGS[h.kind].slots ?? 0) === 0) continue;
      const was = this.lastAtSea.get(h.id);
      this.lastAtSea.set(h.id, h.atSea);
      if (was !== true || h.atSea || h.boats === 0) continue;
      const market = Object.values(state.buildings).find(b => b.kind === "market" && b.reached && !b.cut);
      if (!market) continue;
      const walk = this.route(h, market);
      if (!walk || walk.length < 1) continue;
      // Porters start on the deck itself: the harbour cell nearest the first step (a market right beside the
      // pier gives a one-cell walk, which is still a walk).
      const first = walk[0];
      const on = h.cells.slice().sort((a, b) => Math.hypot(a.i + 0.5 - first.x, a.j + 0.5 - first.z) - Math.hypot(b.i + 0.5 - first.x, b.j + 0.5 - first.z))[0];
      const path = [new Vector3(on.i + 0.5, h.floorY, on.j + 0.5), ...walk];
      const n = Math.min(PORTERS_MAX, h.boats);
      for (let k = 0; k < n; k++) {
        const jitter = new Vector3((this.rand() - 0.5) * 0.3, 0, (this.rand() - 0.5) * 0.3);
        this.walkers.push({ path: path.map(p => p.add(jitter)), t0: now + 0.5 + k * 0.9, duration: path.length / (SPEED * 0.8), color: Color4.FromHexString(this.palette[(h.id + k) % this.palette.length]), stay: false, seed: 0, carry: true });
        this.portersSpawned++;
      }
    }
  }

  get porters(): number { return this.walkers.filter(w => w.carry).length; }

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
    // The last shift's workers leave their posts (they become the homeward wave below).
    this.walkers = this.walkers.filter(w => !w.stay);
    const total = state.assignments.reduce((n, a) => n + a.n, 0);
    const keep = total > this.cap ? this.cap / total : 1;
    for (const a of state.assignments) {
      const home = state.buildings[a.home], work = state.buildings[a.work];
      if (!home || !work) continue;
      const from = toWork ? home : work, to = toWork ? work : home;
      // Across the water the walk has two legs: to the terminal on this side (then aboard), and — a crossing
      // later — from the far terminal on. On land it is one walk.
      const legs: { path: Vector3[]; delay: number }[] = [];
      if (this.grid.onIsle(from.cells) !== this.grid.onIsle(to.cells)) {
        const t = ferryTerminals(this.grid);
        if (!t) continue;
        const near = this.grid.onIsle(from.cells) ? t.isle[0] : t.harbor, far = this.grid.onIsle(to.cells) ? t.isle[0] : t.harbor;
        const leg1 = this.route(from, near), leg2 = this.route(far, to);
        if (!leg1 || leg1.length < 2 || !leg2 || leg2.length < 2) continue;
        legs.push({ path: leg1, delay: 0 }, { path: leg2, delay: leg1.length / SPEED + FERRY_CROSSING_SECONDS });
      } else {
        const path = this.route(from, to);
        if (!path || path.length < 2) continue;
        legs.push({ path, delay: 0 });
      }
      for (let k = 0; k < a.n; k++) {
        if (this.rand() > keep) continue;
        if (this.walkers.length >= this.cap) return;
        const jitter = new Vector3((this.rand() - 0.5) * 0.4, 0, (this.rand() - 0.5) * 0.4);
        const color = Color4.FromHexString(this.palette[Math.floor(this.rand() * this.palette.length)]);
        const start = now + this.rand() * 2;
        legs.forEach((leg, li) => {
          const last = li === legs.length - 1;
          this.walkers.push({
            path: leg.path.map(p => p.add(jitter)),
            t0: start + leg.delay,
            duration: leg.path.length / SPEED,
            color,
            stay: toWork && last,
            seed: this.rand() * 6.28,
            carry: false,
          });
        });
      }
    }
  }

  /** Stress test only: `n` more walkers on the town's existing routes. Pure view; the ledger is untouched. */
  spawnExtra(state: SimState, n: number, now: number): number {
    const pairs = state.assignments.map(a => [state.buildings[a.home], state.buildings[a.work]] as const).filter(([h, w]) => h && w);
    if (!pairs.length) return 0;
    let spawned = 0;
    for (let k = 0; k < n && this.walkers.length < this.cap * 2; k++) {
      const [home, work] = pairs[Math.floor(this.rand() * pairs.length)];
      const path = this.route(home, work);
      if (!path || path.length < 2) continue;
      const jitter = new Vector3((this.rand() - 0.5) * 0.4, 0, (this.rand() - 0.5) * 0.4);
      this.walkers.push({ path: path.map(p => p.add(jitter)), t0: now + this.rand() * 4, duration: path.length / SPEED + 30, color: Color4.FromHexString(this.palette[Math.floor(this.rand() * this.palette.length)]), stay: false, seed: 0, carry: false });
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
          this.loiterers.push({ centre: new Vector3(cx, b.floorY, cz), seed: b.id * 7 + k, color: Color4.FromHexString(this.palette[(b.id + k) % this.palette.length]), scale: 1 });
        }
      }
      // Kids play around homes that have grown.
      if (BUILDINGS[b.kind].residents > 0 && b.level >= 2 && b.residents > 0 && b.reached) {
        this.loiterers.push({ centre: new Vector3(cx, b.floorY, cz), seed: b.id * 11, color: Color4.FromHexString(this.palette[(b.id + 3) % this.palette.length]), scale: 0.6 });
      }
    }
  }

  /** Swimmers: bobbing figures in the water beside each beach cell that has people on it. */
  private swimmerPoses(state: SimState, viewTime: number): { pos: Vector3; yaw: number; color: Color4 }[] {
    const out: { pos: Vector3; yaw: number; color: Color4 }[] = [];
    if (state.phase !== "high") return out;
    const level = state.tide.level;
    // The ledger counts swimmers per beach cell for shark risk; the view shows at most a share of the town —
    // a few figures in the water, not a line along the whole shore — spread over the beaches with deep enough
    // water beside them.
    let budget = Math.max(0, Math.round(population(state) * SWIM_FRACTION));
    const spots: { water: Cell; k: number }[] = [];
    for (const s of state.swimmers) {
      const beach = { i: Math.floor(s.k / SIZE) - SIZE / 2, j: (s.k % SIZE) - SIZE / 2 };
      const water = this.grid.neighbors(beach).filter(n => this.grid.water[cellIndex(n.i, n.j)]).sort((a, b) => this.grid.heightAt(a) - this.grid.heightAt(b))[0];
      if (!water || level - this.grid.heightAt(water) < 0.12) continue; // at least knee-deep
      spots.push({ water, k: s.k });
    }
    for (let round = 0; round < 3 && budget > 0; round++) {
      for (const { water, k: sk } of spots) {
        if (budget-- <= 0) break;
        const k = round;
        const t = viewTime * 0.5 + k * 1.7 + sk * 0.01;
        const x = water.i + 0.5 + Math.cos(t) * 0.28 + (k - 1) * 0.22, z = water.j + 0.5 + Math.sin(t * 0.8) * 0.28;
        // Chest-deep: the waterline crosses the tunic.
        const y = Math.max(level + Math.sin(viewTime * 2 + k) * 0.02 - CHEST, groundHeight(x, z) + 0.02);
        out.push({ pos: new Vector3(x, y, z), yaw: t, color: Color4.FromHexString(this.palette[(k + sk) % this.palette.length]) });
      }
    }
    return out;
  }

  sync(state: SimState, viewTime: number, riders: Rider[] = []): void {
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
    this.landings(state, viewTime);
    this.walkers = this.walkers.filter(w => w.stay || viewTime < w.t0 + w.duration + FADE);
    const swimmers = this.swimmerPoses(state, viewTime);

    const n = this.walkers.length + this.loiterers.length + swimmers.length + riders.length;
    if (this.matrices.length !== n * 16) { this.matrices = new Float32Array(n * 16); this.colors = new Float32Array(n * 4); }
    const scale = new Vector3(1, 1, 1);
    let k = 0;
    const baskets: number[] = [];
    const put = (pos: Vector3, yaw: number, color: Color4, s = 1, carry = false) => {
      scale.set(s * PERSON_SCALE, s * PERSON_SCALE, s * PERSON_SCALE);
      const m = Matrix.Compose(scale, Quaternion.FromEulerAngles(0, yaw, 0), pos);
      m.copyToArray(this.matrices, k * 16);
      if (carry) m.copyToArray(baskets, baskets.length);
      this.colors[k * 4] = color.r; this.colors[k * 4 + 1] = color.g; this.colors[k * 4 + 2] = color.b; this.colors[k * 4 + 3] = 1;
      k++;
    };
    for (const w of this.walkers) {
      const raw = (viewTime - w.t0) / w.duration;
      const u = Math.min(1, Math.max(0, raw));
      const idx = u * (w.path.length - 1);
      const i0 = Math.min(w.path.length - 2, Math.floor(idx)), f = idx - i0;
      const a = w.path[i0], b = w.path[i0 + 1];
      const pos = new Vector3(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.z + (b.z - a.z) * f);
      let yaw = Math.atan2(b.x - a.x, b.z - a.z);
      let s = 1;
      if (raw < 1) {
        pos.y += u > 0 ? Math.abs(Math.sin(viewTime * 9)) * 0.03 : 0;
      } else if (w.stay) {
        // At work: stand at the post, turn slowly, shift weight now and then.
        yaw += Math.sin(viewTime * 0.3 + w.seed) * 0.8;
        pos.x += Math.sin(viewTime * 0.5 + w.seed) * 0.12;
        pos.z += Math.cos(viewTime * 0.4 + w.seed) * 0.12;
      } else {
        // Home: step inside — shrink away over FADE seconds.
        s = Math.max(0, 1 - (viewTime - (w.t0 + w.duration)) / FADE);
      }
      put(pos, yaw, w.color, s, w.carry);
    }
    for (const l of this.loiterers) {
      // Loiterers stand, then walk a few steps to a new spot and stand again — never glide. Each bout has a
      // seeded spot; the walk takes the first part of the bout and the figure faces where it is going.
      const bout = l.scale < 1 ? 2.6 : 4.5, walk = l.scale < 1 ? 1.0 : 1.3, r = l.scale < 1 ? 0.6 : 0.5;
      const t = viewTime / bout + l.seed;
      const n = Math.floor(t);
      const u = Math.min(1, ((t - n) * bout) / walk);
      const spot = (k: number) => { const h = Math.sin(k * 12.9898 + l.seed * 78.233) * 43758.5453; const a = (h - Math.floor(h)) * 6.283; const rr = r * (0.4 + 0.6 * ((h * 7) - Math.floor(h * 7))); return { x: rr * Math.cos(a), z: rr * Math.sin(a) }; };
      const from = spot(n - 1), to = spot(n);
      const e = u * u * (3 - 2 * u);
      const pos = new Vector3(l.centre.x + from.x + (to.x - from.x) * e, l.centre.y, l.centre.z + from.z + (to.z - from.z) * e);
      if (u < 1) pos.y += Math.abs(Math.sin(viewTime * 9)) * 0.03;
      put(pos, Math.atan2(to.x - from.x, to.z - from.z), l.color, l.scale);
    }
    for (const s of swimmers) put(s.pos, s.yaw, s.color);
    riders.forEach((r, k) => put(r.pos, r.yaw, Color4.FromHexString(this.palette[(k + 5) % this.palette.length])));
    if (n === 0) { this.mesh.setEnabled(false); this.detail.setEnabled(false); return; }
    this.mesh.setEnabled(true); this.detail.setEnabled(true);
    this.mesh.thinInstanceSetBuffer("matrix", this.matrices, 16, false);
    this.mesh.thinInstanceSetBuffer("color", this.colors, 4, false);
    this.detail.thinInstanceSetBuffer("matrix", this.matrices, 16, false);
    if (baskets.length) { this.basket.thinInstanceSetBuffer("matrix", new Float32Array(baskets), 16, false); this.basket.setEnabled(true); }
    else this.basket.setEnabled(false);
  }

  clear(): void {
    this.walkers = [];
    this.loiterers = [];
    this.lastAtSea.clear();
    this.lastPhase = null;
    this.mesh.setEnabled(false);
  }
}
