// Walkers as thin instances of one three-primitive figure with a per-instance colour. Every walk goes door to
// door over the walkway graph: a resident steps out of a home's door and is hidden inside until then; a worker
// stands at the workplace's door through the shift and walks home from that spot when it ends, going in at the
// home's door. Newcomers climb up onto the pier with a bundle and walk to their new home; porters climb up with the
// catch and carry it to the market. Walks climb the stairs between decks instead of sliding through them. A few
// loiterers mill about staffed markets, and kids play in front of homes that have grown. Nothing here writes to the sim.
import { Color4, Matrix, Mesh, MeshBuilder, Quaternion, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import { SIZE } from "../config";
import { BUILDINGS, SWIM_FRACTION } from "../sim/balance";
import { cellCenter, cellIndex, Grid } from "../sim/grid";
import { ground as groundHeight } from "./ground";
import { Stair, stairHeight, stairsOn } from "./buildings";
import { ferryTerminals } from "../sim/network";
import { Building, Cell, Phase, population, SimState } from "../sim/state";
import { flatMaterial, mergeFlat, tint } from "../world/flatMesh";
import { BiomeLook, HatKit } from "./biomes";

export const MAX_WALKERS = 200;
const SPEED = 1.6; // cells per second
const LOITERERS_PER_MARKET = 3;
const NIGHT_MARKET_CROWD = 6;
const COLORS = ["#c9674f", "#4c5a66", "#2f6f8f", "#79ad5e", "#f4d9c6", "#b9543f", "#5d6d7a", "#e6d3a1"];

/** How a walk begins: inside a building (hidden until the wall), climbing up over a deck's far edge from a boat, or
 *  where a worker stands at a door. */
type Start = "inside" | "deck" | "door";
/** How it ends: in at a door (hidden past the wall), standing at a door for the shift, at a building's middle
 *  (a porter at the market's counter), or climbing down over a deck's far edge into a boat. */
type End = "inside" | "door" | "middle" | "board";

interface Walker {
  path: Vector3[];
  /** Running length along the path. */
  cum: number[];
  len: number;
  t0: number;
  /** Cells a second. */
  speed: number;
  color: Color4;
  /** Hidden before this far along (still inside the building it leaves) and past `to` (inside the one it enters). */
  from: number;
  to: number;
  /** Workers stand at their workplace's door from the end of the walk until the shift ends. */
  stay: boolean;
  seed: number;
  /** Porters carry a basket of the catch; newcomers a bundle of their things. */
  carry: "fish" | "bundle" | null;
  /** Climbs up onto the deck at the start (off a boat or the ferry): rises from below the deck's edge. */
  climb: boolean;
  /** Climbs down off the deck's edge at the end (into a boat or the ferry). */
  descend: boolean;
  /** Seconds it stays standing at the end of the walk before it is gone (a porter at the counter). */
  linger: number;
  /** Stands at the start, visible, until it sets off (a worker leaving the post). */
  waits: boolean;
  /** A worker's home and workplace, so the walk home starts where they stand. */
  home?: number;
  work?: number;
}
/** Porters per landing, at most. */
const PORTERS_MAX = 4;
/** Newcomers walked in per settlement, at most (the rest arrive unseen). */
const ARRIVALS_MAX = 12;
/** Seconds between going aboard on one side and stepping off on the other. */
const FERRY_CROSSING_SECONDS = 20;
/** How far inside a cell's edge a building's wall stands (a walker is hidden past it), and where a worker waits outside. */
const WALL = 0.16, STAND = 0.2;
/** Where a walk crosses a cell with stairs, it follows the treads in steps this long. */
const STAIR_SAMPLE = 0.08;
/** Seconds to climb up onto a deck. */
const CLIMB = 0.4;
/** Newcomers come on a visiting boat: seconds for it to sail in from open water, and to sail away again. */
export const VISIT_SAIL = 9;
/** The four sides of a cell, in door-turn order (0 = −z, 1 = −x, 2 = +z, 3 = +x). */
const SIDES: readonly Cell[] = [{ i: 0, j: -1 }, { i: -1, j: 0 }, { i: 0, j: 1 }, { i: 1, j: 0 }];

export interface Rider { pos: Vector3; yaw: number }

/** The figure is 0.63 units tall at scale 1; at 0.4 a person is a quarter of a cell, about Cities: Skylines' ratio. */
export const PERSON_SCALE = 0.4;
/** The figure's chest height at PERSON_SCALE: swimmers sit so the waterline crosses here. */
const CHEST = 0.34 * PERSON_SCALE;

interface Loiterer {
  centre: Vector3;
  seed: number;
  color: Color4;
  /** 1 for adults, smaller for kids. */
  scale: number;
  /** How far from the centre they wander. */
  r: number;
}

/** The point `d` along a walk, and its heading (atan2(dx, dz)). */
function along(w: { path: Vector3[]; cum: number[]; len: number }, d: number): { pos: Vector3; yaw: number } {
  const p = w.path;
  if (p.length === 1) return { pos: p[0].clone(), yaw: 0 };
  let i = 1;
  while (i < w.cum.length - 1 && w.cum[i] < d) i++;
  const a = p[i - 1], b = p[i];
  const seg = Math.max(1e-6, w.cum[i] - w.cum[i - 1]);
  const f = Math.min(1, Math.max(0, (d - w.cum[i - 1]) / seg));
  // Face along the ground: a stair's riser has no run, so look at the nearest segment that does.
  let k = i, dx = b.x - a.x, dz = b.z - a.z;
  while (Math.hypot(dx, dz) < 1e-3 && k < p.length - 1) { k++; dx = p[k].x - p[k - 1].x; dz = p[k].z - p[k - 1].z; }
  return { pos: new Vector3(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.z + (b.z - a.z) * f), yaw: Math.atan2(dx, dz) };
}

/** A visiting boat bringing newcomers: which landing, when it set out, how long it lies alongside, and where. */
export interface Visit { port: number; at: number; stay: number; x: number; z: number }

/** How far along its walk a walker is at `t`: a climber first spends CLIMB seconds getting up onto the deck. */
function distance(w: Walker, t: number): number {
  return Math.min(w.len, Math.max(0, t - w.t0 - (w.climb ? CLIMB : 0)) * w.speed);
}
/** When a walker is done: at the end of the walk, after climbing down if it climbs down. */
function doneAt(w: Walker): number {
  return w.t0 + (w.climb ? CLIMB : 0) + w.len / w.speed + (w.descend ? CLIMB : 0);
}
/** How far below the deck a climber is at `t` (up at the start, down at the end), 0 once it's on the deck. */
function below(w: Walker, t: number): number {
  const ease = (c: number) => c * c * (3 - 2 * c);
  if (w.climb && t - w.t0 < CLIMB) return (1 - ease(Math.max(0, t - w.t0) / CLIMB)) * 0.3;
  if (w.descend) { const past = t - (doneAt(w) - CLIMB); if (past > 0) return ease(Math.min(1, past / CLIMB)) * 0.3; }
  return 0;
}

export class Walkers {
  private readonly mesh: Mesh;
  private detail: Mesh;
  private readonly basket: Mesh;
  private readonly bundle: Mesh;
  private readonly scene: Scene;
  /** The body parts the hat kits share (trousers, feet, hands); the head and hat are the kit. */
  private readonly fixedParts: Mesh[];
  private hatKit: HatKit = "straw";
  private palette: readonly string[] = COLORS;
  private readonly lastAtSea = new Map<number, boolean>();
  /** Each home's residents as last seen, so newcomers can be walked in; empty until the first look at a town. */
  private readonly residents = new Map<number, number>();
  private primed = false;
  /** Porters spawned so far (a smoke probe). */
  portersSpawned = 0;
  /** Newcomers walked in so far (a probe). */
  arrivalsSpawned = 0;
  private walkers: Walker[] = [];
  private visitList: Visit[] = [];
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
    // A newcomer's bundle: a cloth sack slung on the back, tied at the neck, with a rolled mat across the top.
    const sack = MeshBuilder.CreateSphere("wn", { diameter: 0.2, segments: 4 }, scene);
    sack.scaling.set(1, 1.1, 0.8);
    sack.position.set(0, 0.33, -0.13);
    const tie = MeshBuilder.CreateCylinder("wnt", { diameter: 0.07, height: 0.05, tessellation: 5 }, scene);
    tie.position.set(0, 0.45, -0.13);
    const mat = MeshBuilder.CreateCylinder("wnm", { diameter: 0.06, height: 0.26, tessellation: 5 }, scene);
    mat.rotation.z = Math.PI / 2;
    mat.position.set(0, 0.46, -0.17);
    this.bundle = mergeFlat("bundles", [tint(sack, "#d5c7a1"), tint(tie, "#8a6f52"), tint(mat, "#b9543f")], scene);
    for (const m of [this.mesh, this.detail, this.basket, this.bundle]) { m.isPickable = false; m.alwaysSelectAsActiveMesh = true; m.setEnabled(false); }
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
    } else if (hat === "conical") {
      // A tall conical hat of palm leaf, taller and narrower than the straw brim.
      const cone = MeshBuilder.CreateCylinder("wt", { diameterTop: 0, diameterBottom: 0.34, height: 0.2, tessellation: 8 }, scene);
      cone.position.y = 0.58;
      parts.push(tint(cone, "#d9c9a5"));
    } else if (hat === "bandana") {
      const band = MeshBuilder.CreateSphere("wt", { diameter: 0.18, segments: 5 }, scene);
      band.scaling.set(1, 0.55, 1);
      band.position.y = 0.52;
      parts.push(tint(band, "#b9543f"));
      const knot = MeshBuilder.CreateBox("wtk", { width: 0.05, height: 0.04, depth: 0.08 }, scene);
      knot.position.set(-0.09, 0.5, 0);
      parts.push(tint(knot, "#b9543f"));
    } else if (hat === "wrap") {
      const wrap = MeshBuilder.CreateTorus("wt", { diameter: 0.15, thickness: 0.07, tessellation: 10 }, scene);
      wrap.position.y = 0.53;
      parts.push(tint(wrap, "#f6f1e6"));
      const crown = MeshBuilder.CreateSphere("wtc", { diameter: 0.14, segments: 4 }, scene);
      crown.scaling.set(1, 0.6, 1);
      crown.position.y = 0.56;
      parts.push(tint(crown, "#f6f1e6"));
      const tail = MeshBuilder.CreateBox("wtt", { width: 0.03, height: 0.14, depth: 0.06 }, scene);
      tail.position.set(-0.08, 0.46, 0.02);
      parts.push(tint(tail, "#f6f1e6"));
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

  /** The catch comes ashore: when a harbour's boats land, porters climb up with baskets and carry them to the market. */
  private landings(state: SimState, now: number): void {
    for (const h of Object.values(state.buildings)) {
      if ((BUILDINGS[h.kind].slots ?? 0) === 0) continue;
      const was = this.lastAtSea.get(h.id);
      this.lastAtSea.set(h.id, h.atSea);
      if (was !== true || h.atSea || h.boats === 0) continue;
      const market = Object.values(state.buildings).find(b => b.kind === "market" && b.reached && !b.cut);
      if (!market) continue;
      const there = this.walk(h, market, "deck", "middle"), back = this.walk(market, h, "door", "board");
      if (!there || !back) continue;
      const n = Math.min(PORTERS_MAX, h.boats);
      for (let k = 0; k < n; k++) {
        const color = Color4.FromHexString(this.palette[(h.id + k) % this.palette.length]);
        const w = this.spawn(there, now + 0.5 + k * 0.9, color, { speed: SPEED * 0.8, carry: "fish", climb: true, linger: 1.2 });
        // Back from the counter, empty-handed, and down into the boat.
        const home = { path: [w.path[w.path.length - 1].clone(), ...back.path], from: 0, to: Infinity };
        this.spawn(home, doneAt(w) + w.linger, color, { descend: true, keepStart: true, waits: false });
        this.portersSpawned++;
      }
    }
  }

  /**
   * Newcomers: a home with more residents than last seen had people move in. A visiting boat brings them to the
   * town's landing (the harbor if there is one, else the pier with the most berths); they climb up off it with a
   * bundle each, one after another, and walk to their doors.
   */
  private arrivals(state: SimState, now: number): void {
    const homes = Object.values(state.buildings).filter(b => BUILDINGS[b.kind].residents > 0);
    if (!this.primed) { for (const h of homes) this.residents.set(h.id, h.residents); this.primed = true; return; }
    const port = Object.values(state.buildings)
      .filter(b => (BUILDINGS[b.kind].slots ?? 0) > 0 && b.reached && !b.cut)
      .sort((a, b) => (b.kind === "harbor" ? 1 : 0) - (a.kind === "harbor" ? 1 : 0) || (BUILDINGS[b.kind].slots ?? 0) - (BUILDINGS[a.kind].slots ?? 0) || a.id - b.id)[0];
    let spawned = 0;
    let alongside: Vector3 | null = null;
    const seen = new Set<number>();
    for (const h of homes) {
      seen.add(h.id);
      const was = this.residents.get(h.id) ?? 0;
      this.residents.set(h.id, h.residents);
      if (h.residents <= was || !port || spawned >= ARRIVALS_MAX) continue;
      const walk = this.walk(port, h, "deck", "inside");
      if (!walk) continue;
      alongside ??= walk.path[0];
      for (let k = 0; k < h.residents - was && spawned < ARRIVALS_MAX; k++, spawned++) {
        this.spawn(walk, now + VISIT_SAIL + 0.4 + spawned * 0.7, Color4.FromHexString(this.palette[Math.floor(this.rand() * this.palette.length)]), { carry: "bundle", climb: true });
        this.arrivalsSpawned++;
      }
    }
    if (spawned && port && alongside) this.visitList.push({ port: port.id, at: now, stay: 1.2 + spawned * 0.7 + CLIMB, x: alongside.x, z: alongside.z });
    for (const id of [...this.residents.keys()]) if (!seen.has(id)) this.residents.delete(id);
  }

  get porters(): number { return this.walkers.filter(w => w.carry === "fish").length; }

  /** The visiting boats still on the water at `now` (the boats view sails them). */
  visits(now: number): Visit[] {
    this.visitList = this.visitList.filter(v => now < v.at + VISIT_SAIL * 2 + v.stay);
    return this.visitList;
  }

  /** Every walker drawn at `viewTime`, where and doing what (a probe for the movement checks). */
  probe(viewTime: number): { x: number; y: number; z: number; stage: "waiting" | "climbing" | "walking" | "standing"; carry: string | null; d: number; from: number; to: number }[] {
    const out: { x: number; y: number; z: number; stage: "waiting" | "climbing" | "walking" | "standing"; carry: string | null; d: number; from: number; to: number }[] = [];
    for (const w of this.walkers) {
      if (viewTime < w.t0 && !w.waits) continue;
      const d = distance(w, viewTime);
      if (d < w.from || (!w.stay && d > w.to)) continue;
      const { pos } = along(w, d);
      const stage = viewTime < w.t0 ? "waiting" : below(w, viewTime) > 0 ? "climbing" : d >= w.len ? "standing" : "walking";
      out.push({ x: +pos.x.toFixed(2), y: +(pos.y - below(w, viewTime)).toFixed(3), z: +pos.z.toFixed(2), stage, carry: w.carry, d: +d.toFixed(2), from: +w.from.toFixed(2), to: Number.isFinite(w.to) ? +w.to.toFixed(2) : -1 });
    }
    return out;
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

  private stairCache = new Map<number, Stair[]>();
  private stairLayout = -1;
  /** The stairs standing on a cell (as the meshes draw them), kept until the layout changes. */
  private stairs(c: Cell): Stair[] {
    if (this.grid.layoutVersion !== this.stairLayout) { this.stairCache.clear(); this.stairLayout = this.grid.layoutVersion; }
    const k = cellIndex(c.i, c.j);
    let s = this.stairCache.get(k);
    if (!s) { s = stairsOn(this.grid, c); this.stairCache.set(k, s); }
    return s;
  }

  /** The height a figure stands at on a cell: the deck, or the ground under a path at that point; on a stair's treads where one stands. */
  private footY(c: Cell, x: number, z: number): number {
    const b = this.grid.buildingAt(c);
    if (!b) return groundHeight(x, z);
    const own = BUILDINGS[b.kind].floor === "terrain" ? groundHeight(x, z) + 0.05 : b.floorY;
    const stairs = this.stairs(c);
    return stairs.length ? Math.max(own, stairHeight(stairs, c, x, z)) : own;
  }

  /** Where a boat comes alongside `b`: the middle of its cell farthest from `near`, and a point just past that cell's
   *  outer edge, over the water. */
  private farEdge(b: Building, near: Cell): { tip: Vector3; over: Vector3 } {
    const tip = b.cells.slice().sort((p, q) => Math.hypot(q.i - near.i, q.j - near.j) - Math.hypot(p.i - near.i, p.j - near.j))[0];
    const t = cellCenter(tip);
    let dx = tip.i - near.i, dz = tip.j - near.j;
    if (dx === 0 && dz === 0) {
      // One-cell deck: away from the street, toward whichever side has no building.
      const side = [{ i: 1, j: 0 }, { i: -1, j: 0 }, { i: 0, j: 1 }, { i: 0, j: -1 }].find(d => !this.grid.buildingAt({ i: tip.i + d.i, j: tip.j + d.j })) ?? { i: 1, j: 0 };
      dx = side.i; dz = side.j;
    }
    const l = Math.hypot(dx, dz);
    return { tip: new Vector3(t.x, b.floorY, t.z), over: new Vector3(t.x + (dx / l) * 0.62, b.floorY, t.z + (dz / l) * 0.62) };
  }

  /**
   * The shortest walk from `from` to `to` over walkable cells: the cell of `from` it leaves by, the street between,
   * and the cell of `to` it arrives at. Null when the street doesn't join them.
   */
  private routeCells(from: Building, to: Building): { first: Cell; cells: Cell[]; last: Cell } | null {
    const fromCells = new Set(from.cells.map(c => cellIndex(c.i, c.j)));
    const toCells = new Set(to.cells.map(c => cellIndex(c.i, c.j)));
    const prev = new Int32Array(SIZE * SIZE).fill(-2);
    const queue: Cell[] = [];
    // A walk leaves by the street: straight into a neighbouring building only off a deck (a pier beside the market),
    // never through the wall a home shares with its workplace.
    const fromDeck = this.walkable(from.cells[0]);
    for (const c of from.cells) for (const n of this.grid.neighbors(c)) {
      const k = cellIndex(n.i, n.j);
      if (fromCells.has(k) || prev[k] !== -2 || (!this.walkable(n) && !(fromDeck && toCells.has(k)))) continue;
      prev[k] = cellIndex(c.i, c.j);
      queue.push(n);
    }
    let end: Cell | null = null;
    for (let head = 0; head < queue.length && !end; head++) {
      const c = queue[head];
      const kc = cellIndex(c.i, c.j);
      if (toCells.has(kc) || this.grid.neighbors(c).some(n => toCells.has(cellIndex(n.i, n.j)))) { end = c; break; }
      for (const n of this.grid.neighbors(c)) {
        const k = cellIndex(n.i, n.j);
        if (prev[k] !== -2 || fromCells.has(k) || !this.walkable(n)) continue;
        prev[k] = kc;
        queue.push(n);
      }
    }
    if (!end) return null;
    const at = (k: number): Cell => ({ i: Math.floor(k / SIZE) - SIZE / 2, j: (k % SIZE) - SIZE / 2 });
    const chain: Cell[] = [end];
    let k = cellIndex(end.i, end.j);
    while (chain.length < 400) {
      const p = prev[k];
      if (p < 0) break;
      k = p;
      if (fromCells.has(k)) break;
      chain.push(at(k));
    }
    chain.reverse();
    const first = at(k);
    // The walk ends on a cell of `to` if it reached one, else beside it: step onto the neighbouring cell of `to`.
    const tail = chain[chain.length - 1];
    let last: Cell;
    if (toCells.has(cellIndex(tail.i, tail.j))) { last = chain.pop()!; }
    else last = this.grid.neighbors(tail).find(n => toCells.has(cellIndex(n.i, n.j)))!;
    return { first, cells: chain, last };
  }

  /**
   * A walk from `from` to `to` as points at foot height: out of a door (hidden until past the wall), along the
   * street with the stairs climbed where two decks meet at different heights, and in at a door, up to a worker's
   * post outside it, or onto a deck's middle. Returns the points and where the figure is visible along them.
   */
  private walk(from: Building, to: Building, start: Start, end: End, startAt?: Vector3): { path: Vector3[]; from: number; to: number } | null {
    const route = this.routeCells(from, to);
    if (!route) return null;
    const chain = [route.first, ...route.cells, route.last];
    const pts: Vector3[] = [];
    /** Whether the stretch from each point to the next lies on the street's surface (so it follows any stairs). */
    const onDeck: boolean[] = [];
    let hideBefore = -1, hideAfter = -1;
    const P = (x: number, y: number, z: number, deck = true) => { pts.push(new Vector3(x, y, z)); onDeck.push(deck); };
    for (let i = 0; i < chain.length - 1; i++) {
      const A = chain[i], B = chain[i + 1];
      const ca = cellCenter(A), cb = cellCenter(B);
      const dx = B.i - A.i, dz = B.j - A.j;
      const ex = (ca.x + cb.x) / 2, ez = (ca.z + cb.z) / 2;
      const yA = this.footY(A, ex - dx * 0.01, ez - dz * 0.01), yB = this.footY(B, ex + dx * 0.01, ez + dz * 0.01);
      const terrain = (c: Cell) => { const b = this.grid.buildingAt(c); return !!b && BUILDINGS[b.kind].floor === "terrain"; };
      const bothGround = terrain(A) && terrain(B);
      const foot = Math.min(0.42, Math.max(0.15, Math.abs(yA - yB) * 0.6));
      const lastLink = i === chain.length - 2;
      if (i === 0) {
        if (start === "door") {
          // A worker standing at their post: the walk starts there, already outside.
          const s = startAt ?? new Vector3(ex + dx * STAND, this.footY(B, ex + dx * STAND, ez + dz * STAND), ez + dz * STAND);
          P(s.x, s.y, s.z);
        } else {
          if (start === "deck") {
            // Up over the far edge from a boat alongside, onto the deck, and along it to the street.
            const e = this.farEdge(from, A);
            P(e.over.x, e.over.y, e.over.z, false);
            if (Math.hypot(e.tip.x - ca.x, e.tip.z - ca.z) > 0.01) P(e.tip.x, e.tip.y, e.tip.z);
          }
          P(ca.x, this.footY(A, ca.x, ca.z), ca.z);
          if (start === "inside") { P(ex - dx * WALL, yA, ez - dz * WALL); hideBefore = pts.length - 1; }
        }
      }
      if (lastLink && end === "door") {
        // The worker's post: on the street just outside the door, facing it (the last step points at the building).
        const sx = ex - dx * STAND, sz = ez - dz * STAND;
        if (i > 0 || start !== "door") P(sx - dx * 0.02, this.footY(A, sx, sz), sz - dz * 0.02);
        P(sx, this.footY(A, sx, sz), sz);
        break;
      }
      if (!(i === 0 && start === "door")) {
        if (bothGround) P(ex, groundHeight(ex, ez) + 0.05, ez);
        else if (this.stairs(A).length || this.stairs(B).length) P(ex, Math.max(yA, yB), ez);
        else {
          const top = Math.max(yA, yB);
          if (yA < yB - 0.02) P(ex - dx * foot, yA, ez - dz * foot);
          P(ex, top, ez);
          if (yB < yA - 0.02) P(ex + dx * foot, yB, ez + dz * foot);
        }
      }
      if (lastLink) {
        if (end === "inside") { P(ex + dx * WALL, yB, ez + dz * WALL, false); hideAfter = pts.length - 1; P(ex + dx * 0.34, yB, ez + dz * 0.34); }
        else if (end === "board") {
          // Along the deck to its far edge, and over it (down into the boat alongside).
          P(cb.x, this.footY(B, cb.x, cb.z), cb.z);
          const e = this.farEdge(to, B);
          if (Math.hypot(e.tip.x - cb.x, e.tip.z - cb.z) > 0.01) P(e.tip.x, e.tip.y, e.tip.z);
          onDeck[onDeck.length - 1] = false;
          P(e.over.x, e.over.y, e.over.z);
        } else if (end === "middle") {
          const is = to.cells.map(c => c.i), js = to.cells.map(c => c.j);
          const mx = (Math.min(...is) + Math.max(...is) + 1) / 2, mz = (Math.min(...js) + Math.max(...js) + 1) / 2;
          P(cb.x, this.footY(B, cb.x, cb.z), cb.z);
          if (Math.hypot(mx - cb.x, mz - cb.z) > 0.01) P(mx, to.floorY, mz);
        } else P(cb.x, this.footY(B, cb.x, cb.z), cb.z);
      } else P(cb.x, this.footY(B, cb.x, cb.z), cb.z);
    }
    if (pts.length < 2) return null;
    // Across a cell with stairs, follow the treads instead of cutting through them.
    const path: Vector3[] = [], at: number[] = [];
    for (let k = 0; k < pts.length; k++) {
      if (k > 0 && onDeck[k - 1]) {
        const a = pts[k - 1], b = pts[k];
        const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / STAIR_SAMPLE);
        for (let s = 1; s < steps; s++) {
          const x = a.x + (b.x - a.x) * s / steps, z = a.z + (b.z - a.z) * s / steps;
          const c = { i: Math.floor(x), j: Math.floor(z) };
          if (this.stairs(c).length) path.push(new Vector3(x, this.footY(c, x, z), z));
        }
      }
      at.push(path.length);
      path.push(pts[k]);
    }
    const cum = [0];
    for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y, path[i].z - path[i - 1].z));
    return { path, from: hideBefore >= 0 ? cum[at[hideBefore]] : 0, to: hideAfter >= 0 ? cum[at[hideAfter]] : Infinity };
  }

  /** Put a walker on a walk. A small sideways offset keeps a crowd from walking in one file. */
  private spawn(walk: { path: Vector3[]; from: number; to: number }, t0: number, color: Color4, o: { speed?: number; carry?: Walker["carry"]; climb?: boolean; descend?: boolean; stay?: boolean; home?: number; work?: number; keepStart?: boolean; waits?: boolean; linger?: number } = {}): Walker {
    // A walk home starts exactly where the worker stood; the rest of every walk gets its own small offset.
    const jx = (this.rand() - 0.5) * 0.3, jz = (this.rand() - 0.5) * 0.3;
    const path = walk.path.map((p, i) => {
      if (i === 0 && o.keepStart) return p.clone();
      const x = p.x + jx, z = p.z + jz;
      // By a stair the offset can land on another tread: a point on the street's surface stays on it.
      const c0 = { i: Math.floor(p.x), j: Math.floor(p.z) }, c1 = { i: Math.floor(x), j: Math.floor(z) };
      const onStair = (this.stairs(c0).length > 0 || this.stairs(c1).length > 0) && Math.abs(p.y - this.footY(c0, p.x, p.z)) < 1e-3;
      return new Vector3(x, onStair ? this.footY(c1, x, z) : p.y, z);
    });
    const cum = [0];
    for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y, path[i].z - path[i - 1].z));
    const w: Walker = { path, cum, len: cum[cum.length - 1], t0, speed: o.speed ?? SPEED, color, from: walk.from, to: walk.to, stay: !!o.stay, seed: this.rand() * 6.28, carry: o.carry ?? null, climb: !!o.climb, descend: !!o.descend, linger: o.linger ?? 0, waits: o.waits ?? !!o.keepStart, home: o.home, work: o.work };
    this.walkers.push(w);
    return w;
  }

  /** Where a standing worker is now (the end of the walk that brought them). */
  private standing(w: Walker): Vector3 {
    return w.path[w.path.length - 1].clone();
  }

  /**
   * The walk between a home and a workplace, one leg or two across the water (to the ferry's terminal on this side,
   * aboard, and on from the far one a crossing later). To work: out of the home's door, to the post at the
   * workplace's door. Home: from the post, in at the home's door.
   */
  private commute(home: Building, work: Building, toWork: boolean, startAt?: Vector3): { walk: { path: Vector3[]; from: number; to: number }; delay: number; climb: boolean; last: boolean }[] | null {
    const from = toWork ? home : work, to = toWork ? work : home;
    const s: Start = toWork ? "inside" : "door", e: End = toWork ? "door" : "inside";
    if (this.grid.onIsle(from.cells) !== this.grid.onIsle(to.cells)) {
      const t = ferryTerminals(this.grid);
      if (!t) return null;
      const near = this.grid.onIsle(from.cells) ? t.isle[0] : t.harbor, far = this.grid.onIsle(to.cells) ? t.isle[0] : t.harbor;
      const leg1 = this.walk(from, near, s, "board", startAt), leg2 = this.walk(far, to, "deck", e);
      if (!leg1 || !leg2) return null;
      let walked = 0;
      for (let i = 1; i < leg1.path.length; i++) walked += Math.hypot(leg1.path[i].x - leg1.path[i - 1].x, leg1.path[i].z - leg1.path[i - 1].z);
      return [{ walk: leg1, delay: 0, climb: false, last: false }, { walk: leg2, delay: walked / SPEED + CLIMB + FERRY_CROSSING_SECONDS, climb: true, last: true }];
    }
    const leg = this.walk(from, to, s, e, startAt);
    return leg ? [{ walk: leg, delay: 0, climb: false, last: true }] : null;
  }

  /**
   * A shift change. Going to work (a high or low phase begins): a walker per worker (sampled beyond the cap) comes
   * out of home and stands at the workplace's door. Going home (slack): every worker standing at a door walks home
   * from there, keeping their colour.
   */
  private shiftChange(state: SimState, toWork: boolean, now: number): void {
    if (!toWork) {
      const standing = this.walkers.filter(w => w.stay);
      this.walkers = this.walkers.filter(w => !w.stay);
      for (const w of standing) {
        const home = w.home !== undefined ? state.buildings[w.home] : undefined, work = w.work !== undefined ? state.buildings[w.work] : undefined;
        if (!home || !work) continue;
        const legs = this.commute(home, work, false, this.standing(w));
        if (!legs) continue;
        const start = now + this.rand() * 1.5;
        legs.forEach((leg, i) => this.spawn(leg.walk, start + leg.delay, w.color, { climb: leg.climb, descend: !leg.last, keepStart: i === 0 }));
      }
      return;
    }
    this.walkers = this.walkers.filter(w => !w.stay);
    const total = state.assignments.reduce((n, a) => n + a.n, 0);
    const keep = total > this.cap ? this.cap / total : 1;
    for (const a of state.assignments) {
      const home = state.buildings[a.home], work = state.buildings[a.work];
      if (!home || !work || a.n === 0) continue;
      const legs = this.commute(home, work, true);
      if (!legs) continue;
      for (let k = 0; k < a.n; k++) {
        if (this.rand() > keep) continue;
        if (this.walkers.length >= this.cap) return;
        const color = Color4.FromHexString(this.palette[Math.floor(this.rand() * this.palette.length)]);
        const start = now + this.rand() * 2;
        for (const leg of legs) this.spawn(leg.walk, start + leg.delay, color, { climb: leg.climb, descend: !leg.last, stay: leg.last, home: home.id, work: work.id });
      }
    }
  }

  /** Stress test only: `n` more walkers standing at the town's workplaces. Pure view; the ledger is untouched. */
  spawnExtra(state: SimState, n: number, now: number): number {
    const pairs = state.assignments.map(a => [state.buildings[a.home], state.buildings[a.work]] as const).filter(([h, w]) => h && w);
    if (!pairs.length) return 0;
    let spawned = 0;
    for (let k = 0; k < n && this.walkers.length < this.cap * 2; k++) {
      const [home, work] = pairs[Math.floor(this.rand() * pairs.length)];
      const walk = this.walk(home, work, "inside", "door");
      if (!walk) continue;
      this.spawn(walk, now + this.rand() * 4, Color4.FromHexString(this.palette[Math.floor(this.rand() * this.palette.length)]), { stay: true });
      spawned++;
    }
    return spawned;
  }

  /** Walkers in the night market's crowd (the Dunes), for checks. */
  nightCrowd = 0;

  private refreshLoiterers(state: SimState): void {
    this.loiterers = [];
    this.nightCrowd = 0;
    for (const b of Object.values(state.buildings)) {
      const is = b.cells.map(c => c.i), js = b.cells.map(c => c.j);
      const cx = (Math.min(...is) + Math.max(...is) + 1) / 2, cz = (Math.min(...js) + Math.max(...js) + 1) / 2;
      if ((b.kind === "market" || b.kind === "marketSquare") && b.reached && !b.cut && (b.kind === "marketSquare" || b.workers > 0)) {
        for (let k = 0; k < LOITERERS_PER_MARKET; k++) {
          this.loiterers.push({ centre: new Vector3(cx, b.floorY, cz), seed: b.id * 7 + k, color: Color4.FromHexString(this.palette[(b.id + k) % this.palette.length]), scale: 1, r: 0.5 });
        }
      }
      // The night market (the Dunes): the square and the tavern crowd for the night.
      if ((b.kind === "marketSquare" || b.kind === "tavern") && b.reached && (state.biomeState.nightMarket ?? -9) === state.tide.cycle) {
        this.nightCrowd += NIGHT_MARKET_CROWD;
        for (let k = 0; k < NIGHT_MARKET_CROWD; k++) this.loiterers.push({ centre: new Vector3(cx, b.floorY, cz), seed: b.id * 13 + k + 5, color: Color4.FromHexString(this.palette[(b.id + k + 1) % this.palette.length]), scale: 1, r: 0.5 });
      }
      // Kids play out front of homes that have grown: on the street before the door, never inside the walls.
      if (BUILDINGS[b.kind].residents > 0 && b.level >= 2 && b.residents > 0 && b.reached) {
        const c = b.cells[0], side = SIDES[b.rot & 3];
        const front = { i: c.i + side.i, j: c.j + side.j };
        const onStreet = this.walkable(front);
        const x = c.i + 0.5 + side.i * (onStreet ? 0.95 : 0.62), z = c.j + 0.5 + side.j * (onStreet ? 0.95 : 0.62);
        const y = onStreet ? this.footY(front, x, z) : b.floorY;
        this.loiterers.push({ centre: new Vector3(x, y, z), seed: b.id * 11, color: Color4.FromHexString(this.palette[(b.id + 3) % this.palette.length]), scale: 0.6, r: onStreet ? 0.3 : 0.1 });
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
    this.arrivals(state, viewTime);
    this.walkers = this.walkers.filter(w => w.stay || viewTime < doneAt(w) + w.linger);
    const swimmers = this.swimmerPoses(state, viewTime);

    const n = this.walkers.length + this.loiterers.length + swimmers.length + riders.length;
    if (this.matrices.length < n * 16) { this.matrices = new Float32Array(n * 16); this.colors = new Float32Array(n * 4); }
    const scale = new Vector3(1, 1, 1);
    let k = 0;
    const baskets: number[] = [], bundles: number[] = [];
    const put = (pos: Vector3, yaw: number, color: Color4, s = 1, carry: Walker["carry"] = null) => {
      scale.set(s * PERSON_SCALE, s * PERSON_SCALE, s * PERSON_SCALE);
      const m = Matrix.Compose(scale, Quaternion.FromEulerAngles(0, yaw, 0), pos);
      m.copyToArray(this.matrices, k * 16);
      if (carry === "fish") m.copyToArray(baskets, baskets.length);
      else if (carry === "bundle") m.copyToArray(bundles, bundles.length);
      this.colors[k * 4] = color.r; this.colors[k * 4 + 1] = color.g; this.colors[k * 4 + 2] = color.b; this.colors[k * 4 + 3] = 1;
      k++;
    };
    for (const w of this.walkers) {
      // Not out yet (still indoors, or still in the boat), or gone in at the far door: nothing to draw. A worker about
      // to walk home from their post is already standing there.
      if (viewTime < w.t0 && !w.waits) continue;
      const d = distance(w, viewTime);
      if (d < w.from || (!w.stay && d > w.to)) continue;
      const { pos, yaw: heading } = along(w, d);
      let yaw = heading;
      if (d > 0 && d < w.len) pos.y += Math.abs(Math.sin(viewTime * 9 + w.seed)) * 0.03;
      else if (w.stay) {
        // At the post: stand facing the work, shifting weight now and then. No wandering.
        yaw += Math.sin(viewTime * 0.35 + w.seed) * 0.15;
      }
      // Climbing up onto the deck from a boat or the ferry: rise from just below the deck's edge.
      // Climbing up onto the deck from a boat or the ferry, or down into one, past the deck's edge.
      pos.y -= below(w, viewTime);
      put(pos, yaw, w.color, 1, w.carry);
    }
    for (const l of this.loiterers) {
      // Loiterers stand, then walk a few steps to a new spot and stand again — never glide. Each bout has a
      // seeded spot; the walk takes the first part of the bout and the figure faces where it is going.
      const bout = l.scale < 1 ? 2.6 : 4.5, walk = l.scale < 1 ? 1.0 : 1.3, r = l.r;
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
    riders.forEach((r, i) => put(r.pos, r.yaw, Color4.FromHexString(this.palette[(i + 5) % this.palette.length])));
    if (k === 0) { this.mesh.setEnabled(false); this.detail.setEnabled(false); this.basket.setEnabled(false); this.bundle.setEnabled(false); return; }
    this.mesh.setEnabled(true); this.detail.setEnabled(true);
    const matrices = this.matrices.subarray(0, k * 16);
    this.mesh.thinInstanceSetBuffer("matrix", matrices, 16, false);
    this.mesh.thinInstanceSetBuffer("color", this.colors.subarray(0, k * 4), 4, false);
    this.detail.thinInstanceSetBuffer("matrix", matrices, 16, false);
    for (const [mesh, list] of [[this.basket, baskets], [this.bundle, bundles]] as [Mesh, number[]][]) {
      if (list.length) { mesh.thinInstanceSetBuffer("matrix", new Float32Array(list), 16, false); mesh.setEnabled(true); }
      else mesh.setEnabled(false);
    }
  }

  clear(): void {
    this.walkers = [];
    this.loiterers = [];
    this.lastAtSea.clear();
    this.residents.clear();
    this.visitList = [];
    this.primed = false;
    this.lastPhase = null;
    this.mesh.setEnabled(false);
    this.detail.setEnabled(false);
    this.basket.setEnabled(false);
    this.bundle.setEnabled(false);
  }
}
