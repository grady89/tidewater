// The sea lanes on the World (BIOMES.md §4): a lane is a dashed line of lantern light on the water from one harbor's
// face, through the edge's gate, into the next; cargo ships sail it while the ledger has goods on that leg; a storm
// crossing the World is a knot of grey cloud over its face, leaning toward where it goes next. Thin instances on
// three meshes, all children of the globe's root. View only: it reads what main hands it from the World ledger.
import { Color3, Matrix, Mesh, MeshBuilder, Quaternion, Scene, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";
import { Face, FACES } from "./geometry";
import { flatMaterial, mergeFlat, tint } from "../world/flatMesh";

const DASH = 1.8, GAP = 0.9, LIFT = 1.3, INTO = 0.62;
const KNOT_HEIGHT = 9;

const V = (p: { x: number; y: number; z: number }) => new Vector3(p.x, p.y, p.z);

/** The lane's polyline in globe space: a point part-way into face `a`, the shared edge's midpoint, a point into `b`. */
export function lanePoints(a: number, b: number): Vector3[] {
  const fa = FACES[a], fb = FACES[b];
  const k = fa.neighbours.indexOf(b);
  const c0 = V(fa.corners[k]), c1 = V(fa.corners[(k + 1) % 5]);
  const mid = c0.add(c1).scale(0.5);
  const into = (f: Face) => { const c = V(f.centre); return c.add(mid.subtract(c).scale(INTO)).add(V(f.normal).scale(LIFT)); };
  return [into(fa), mid.add(mid.clone().normalize().scale(LIFT + 0.3)), into(fb)];
}

function along(points: Vector3[], u: number): { pos: Vector3; dir: Vector3 } {
  const lens = points.slice(1).map((p, i) => p.subtract(points[i]).length());
  const total = lens.reduce((n, l) => n + l, 0);
  let d = Math.max(0, Math.min(1, u)) * total;
  for (let i = 0; i < lens.length; i++) {
    if (d <= lens[i] || i === lens.length - 1) {
      const dir = points[i + 1].subtract(points[i]).normalize();
      return { pos: points[i].add(dir.scale(Math.min(d, lens[i]))), dir };
    }
    d -= lens[i];
  }
  return { pos: points[0], dir: new Vector3(1, 0, 0) };
}

function orient(dir: Vector3, up: Vector3): Quaternion {
  const x = dir.normalizeToNew();
  const z = Vector3.Cross(x, up).normalize();
  const y = Vector3.Cross(z, x).normalize();
  const m = Matrix.Identity();
  Matrix.FromXYZAxesToRef(x, y, z, m);
  return Quaternion.FromRotationMatrix(m);
}

export interface LaneShip { from: number; to: number }
export interface LaneStorm { face: number; next: number }

export class LaneView {
  private readonly dashes: Mesh;
  private readonly ships: Mesh;
  private readonly knots: Mesh;
  private legs: LaneShip[] = [];
  private storms: LaneStorm[] = [];
  /** Counts drawn, for checks. */
  laneCount = 0;
  shipCount = 0;
  stormCount = 0;

  constructor(scene: Scene, root: TransformNode) {
    const lit = flatMaterial(scene).clone("laneMat") as StandardMaterial;
    lit.emissiveColor = Color3.FromHexString("#ffb859").scale(0.85);
    const dash = MeshBuilder.CreateBox("laneDash", { width: DASH, height: 0.3, depth: 0.75 }, scene);
    this.dashes = mergeFlat("laneDashes", [tint(dash, "#ffb859")], scene);
    this.dashes.material = lit;
    // A cargo ship: a blue hull, a pale deckhouse, a single square sail.
    const hull = MeshBuilder.CreateBox("csHull", { width: 2.4, height: 0.55, depth: 0.9 }, scene);
    hull.position.y = 0.2;
    const bow = MeshBuilder.CreateCylinder("csBow", { diameterTop: 0, diameterBottom: 0.9, height: 0.7, tessellation: 4 }, scene);
    bow.rotation.z = -Math.PI / 2; bow.position.set(1.5, 0.2, 0); bow.scaling.set(1, 1, 0.75);
    const house = MeshBuilder.CreateBox("csHouse", { width: 0.6, height: 0.4, depth: 0.6 }, scene);
    house.position.set(-0.7, 0.65, 0);
    const mast = MeshBuilder.CreateBox("csMast", { width: 0.08, height: 1.9, depth: 0.08 }, scene);
    mast.position.set(0.25, 1.4, 0);
    const sail = MeshBuilder.CreateBox("csSail", { width: 0.06, height: 1.2, depth: 1.1 }, scene);
    sail.position.set(0.3, 1.5, 0);
    const crate = MeshBuilder.CreateBox("csCrate", { size: 0.35 }, scene);
    crate.position.set(0.8, 0.65, 0);
    this.ships = mergeFlat("cargoShips", [tint(hull, "#2f6f8f"), tint(bow, "#2f6f8f"), tint(house, "#f2ece0"), tint(mast, "#5a4636"), tint(sail, "#f7f3e8"), tint(crate, "#b9a377")], scene);
    // A storm knot: grey puffs heaped round a darker core.
    const puffs: Mesh[] = [];
    const spots: [number, number, number, number, string][] = [[0, 0, 0, 5, "#5d6d7a"], [2.6, 0.6, 0.8, 3.6, "#8d8a83"], [-2.4, 0.4, -0.6, 3.8, "#8d8a83"], [0.6, 1.8, -2, 3.2, "#b8c2c9"], [-0.8, 1.2, 2.2, 3.4, "#b8c2c9"], [0, -1, 0, 3.6, "#4c5a66"]];
    for (const [x, y, z, d, hex] of spots) {
      const p = MeshBuilder.CreateSphere("knot", { diameter: d, segments: 4 }, scene);
      p.position.set(x, y, z);
      puffs.push(tint(p, hex));
    }
    this.knots = mergeFlat("stormKnots", puffs, scene);
    for (const m of [this.dashes, this.ships, this.knots]) {
      m.parent = root;
      m.isPickable = false;
      m.alwaysSelectAsActiveMesh = true;
      m.thinInstanceSetBuffer("matrix", new Float32Array(16), 16, false);
      m.thinInstanceCount = 0;
    }
  }

  /** What to draw: the lanes, the legs with cargo at sea, the storms. */
  set(lanes: [number, number][], legs: LaneShip[], storms: LaneStorm[]): void {
    this.legs = legs;
    this.storms = storms;
    const buf: number[] = [];
    const m = new Matrix();
    for (const [a, b] of lanes) {
      const pts = lanePoints(a, b);
      const up = V(FACES[a].normal).add(V(FACES[b].normal)).normalize();
      const lens = pts.slice(1).map((p, i) => p.subtract(pts[i]).length());
      const total = lens.reduce((n, l) => n + l, 0);
      for (let d = DASH / 2; d < total; d += DASH + GAP) {
        const { pos, dir } = along(pts, d / total);
        Matrix.ComposeToRef(Vector3.One(), orient(dir, up), pos, m);
        for (let k = 0; k < 16; k++) buf.push(m.m[k]);
      }
    }
    this.dashes.thinInstanceSetBuffer("matrix", new Float32Array(buf.length ? buf : new Array(16).fill(0)), 16, false);
    this.dashes.thinInstanceCount = buf.length / 16;
    this.laneCount = lanes.length;
  }

  /** Move the ships along their legs (u: 0..1 through the World cycle) and the storms toward their next face. */
  update(u: number, time: number): void {
    const m = new Matrix();
    const ships: number[] = [];
    this.legs.forEach((leg, i) => {
      const pts = lanePoints(leg.from, leg.to);
      const t = 0.12 + 0.76 * ((u + i * 0.07) % 1);
      const { pos, dir } = along(pts, t);
      const up = V(FACES[t < 0.5 ? leg.from : leg.to].normal);
      const bob = 0.08 * Math.sin(time * 1.6 + i);
      Matrix.ComposeToRef(new Vector3(1.7, 1.7, 1.7), orient(dir, up), pos.add(up.scale(bob)), m);
      for (let k = 0; k < 16; k++) ships.push(m.m[k]);
    });
    this.ships.thinInstanceSetBuffer("matrix", new Float32Array(ships.length ? ships : new Array(16).fill(0)), 16, false);
    this.ships.thinInstanceCount = ships.length / 16;
    this.shipCount = ships.length / 16;
    const knots: number[] = [];
    this.storms.forEach((s, i) => {
      const a = V(FACES[s.face].centre), b = V(FACES[s.next].centre);
      const at = a.add(b.subtract(a).scale(0.45 * u));
      const up = at.clone().normalize();
      const pos = at.add(up.scale(KNOT_HEIGHT + 0.5 * Math.sin(time * 0.7 + i)));
      const t0 = Vector3.Cross(up, Math.abs(up.y) < 0.9 ? Vector3.Up() : Vector3.Right()).normalize();
      const q = orient(Vector3.TransformNormal(t0, Matrix.RotationAxis(up, time * 0.15 + i)), up);
      const s2 = 1 + 0.06 * Math.sin(time * 1.1 + i * 2);
      Matrix.ComposeToRef(new Vector3(s2, s2 * 0.7, s2), q, pos, m);
      for (let k = 0; k < 16; k++) knots.push(m.m[k]);
    });
    this.knots.thinInstanceSetBuffer("matrix", new Float32Array(knots.length ? knots : new Array(16).fill(0)), 16, false);
    this.knots.thinInstanceCount = knots.length / 16;
    this.stormCount = knots.length / 16;
  }
}
