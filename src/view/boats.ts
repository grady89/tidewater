// Boats as thin instances: hulls (per-instance colour) and sails (one draw call each). Positions are a pure
// function of sim state and view time: moored at their harbour, heeled on the mud when the water is gone, or on a
// trip while the sim says they're at sea. A trip is one continuous track per boat: out along its own lane of the
// deep-water route to its own spot on the harbour's ground, a hold there with the net out (drifting, swinging on
// the net), a U-turn, and home along the other lane. Boats of one harbour spread across the ground and leave a
// little apart, so no two share a line. The hull always points along its motion. View only.
import { Color4, Matrix, Mesh, MeshBuilder, Quaternion, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import { BUILDINGS } from "../sim/balance";
import { cellCenter, Grid, worldToCell } from "../sim/grid";
import { ground as groundHeight } from "./ground";
import { seaEntry, seaPath } from "../sim/sea";
import { SIZE } from "../config";
import { Visit, VISIT_SAIL } from "./walkers";
import { Building, Cell, SimState } from "../sim/state";
import { phaseProgress } from "../sim/tide";
import { flatMaterial, mergeFlat, tint } from "../world/flatMesh";
import { waveHeight } from "../world/water";
import { PALETTE } from "./buildings";
import { BiomeLook, BoatKit } from "./biomes";

const DRAFT = 0.12;
const HEEL = 0.42; // radians, resting on the mud
/** Trip fractions of the working phase: out until OUT, the net out until BACK, then a U-turn lasting TURN and home. */
const OUT = 0.27, BACK = 0.58, TURN = 0.08;
/** Half the gap between a route's outbound and homebound lanes (the U-turn's radius) for the first boat, the step
 *  wider for each boat after it, and the spread of boats across the ground. */
const LANE = 0.45, LANE_STEP = 0.3, LANE_MAX = 1.35, SPREAD = 1.2;
/** Each boat after the first leaves (and turns for home) this much later, a fraction of the phase; a big fleet shares
 *  at most STAGGER_TOTAL between them, so the last is still home by the end of the phase. */
const STAGGER = 0.035, STAGGER_TOTAL = 0.12;

export interface BoatPose { x: number; z: number; atSea: boolean; moored: boolean; fishing?: boolean }

/** Two rounds of corner-cutting (Chaikin) over the cell centres; the ends stay put. */
function smooth(points: Vector3[]): Vector3[] {
  let pts = points;
  for (let round = 0; round < 2 && pts.length > 2; round++) {
    const out: Vector3[] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      out.push(new Vector3(a.x * 0.75 + b.x * 0.25, 0, a.z * 0.75 + b.z * 0.25));
      out.push(new Vector3(a.x * 0.25 + b.x * 0.75, 0, a.z * 0.25 + b.z * 0.75));
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}

/** A polyline with its running length, so a boat moves along it at an even speed. */
interface Track { pts: Vector3[]; cum: number[]; len: number }
function track(pts: Vector3[]): Track {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  return { pts, cum, len: cum[cum.length - 1] };
}
/** The point `d` along a track (clamped to its ends). */
function along(t: Track, d: number): { x: number; z: number } {
  if (t.pts.length === 1 || d <= 0) return { x: t.pts[0].x, z: t.pts[0].z };
  if (d >= t.len) { const p = t.pts[t.pts.length - 1]; return { x: p.x, z: p.z }; }
  let i = 1;
  while (i < t.cum.length - 1 && t.cum[i] < d) i++;
  const a = t.pts[i - 1], b = t.pts[i], f = (d - t.cum[i - 1]) / Math.max(1e-6, t.cum[i] - t.cum[i - 1]);
  return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f };
}
/** The travel heading (atan2(dx, dz)) at `d` along a track, from a short look either side. */
function headingAt(t: Track, d: number): number {
  const a = along(t, Math.max(0, d - 0.12)), b = along(t, Math.min(t.len, d + 0.12));
  return Math.atan2(b.x - a.x, b.z - a.z);
}
const easeInOut = (u: number) => u * u * (3 - 2 * u);
const clamp01 = (u: number) => Math.min(1, Math.max(0, u));

/**
 * A lane of a route: every point pushed `off` to the left of the direction of travel, easing in from nothing over
 * 1.5 units at the mooring's end (the start going out, the end coming home) so the lane still meets the mooring.
 */
function lane(pts: Vector3[], off: number, mooringAtEnd: boolean): Vector3[] {
  const run = [0];
  for (let i = 1; i < pts.length; i++) run.push(run[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  const total = run[run.length - 1];
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
    const k = off * easeInOut(clamp01((mooringAtEnd ? total - run[i] : run[i]) / 1.5));
    return new Vector3(p.x - (dz / l) * k, 0, p.z + (dx / l) * k);
  });
}

/** One boat's trip: its lanes out and home, the U-turn between them, and where it holds with the net out. */
interface Trip { out: Track; turn: Track; back: Track; hold: { x: number; z: number; heading: number } }

interface Instance { pos: Vector3; yaw: number; roll: number; color: Color4 }

export class Boats {
  private hull: Mesh;
  private sail: Mesh;
  private readonly floats: Mesh;
  private readonly scene: Scene;
  private kit: BoatKit = "dory";
  private readonly paths = new Map<string, Vector3[]>();
  private readonly trips = new Map<string, Trip>();
  /** A visiting boat's way in from open water to where it lies alongside, per landing and spot. */
  private readonly approaches = new Map<string, Track | null>();
  private matrices = new Float32Array(0);
  private colors = new Float32Array(0);
  private sailMatrices = new Float32Array(0);
  poses: BoatPose[] = [];

  constructor(scene: Scene, private readonly grid: Grid) {
    this.scene = scene;
    ({ hull: this.hull, sail: this.sail } = this.buildKit("dory"));
    // Net floats, shown trailing a boat while it fishes.
    const ring = MeshBuilder.CreateTorus("nf", { diameter: 0.12, thickness: 0.05, tessellation: 6 }, scene);
    this.floats = mergeFlat("netFloats", [tint(ring, PALETTE.roofs[0])], scene);
    this.floats.isPickable = false; this.floats.alwaysSelectAsActiveMesh = true;
    this.floats.setEnabled(false);
  }

  /** The biome look's boat kit (view/biomes): rebuilds the hull and sail meshes when the kit changes. */
  setLook(look: BiomeLook): void {
    if (look.boat === this.kit) return;
    this.kit = look.boat;
    this.hull.dispose(); this.sail.dispose();
    ({ hull: this.hull, sail: this.sail } = this.buildKit(this.kit));
  }

  /**
   * One boat kit as two meshes. The hull mesh is white so the instance colour paints it; the sail mesh carries
   * everything with its own colour. Dory: after reference/boat, a double-ended planked hull (a hexagonal prism
   * stretched along x gives the pointed bow and stern in six flat facets), a dark band at the waterline, a pale
   * gunwale, an open cockpit with two thwarts and a coil of net, a mast with a boom and a tall triangular sail.
   * Longboat: longer and narrower, a dark tarred hull, high stem and stern posts, oars along the gunwale and a
   * square sail on a yard. Outrigger: a slim dugout with a float on two booms to one side and a crab-claw sail.
   */
  private buildKit(kit: BoatKit): { hull: Mesh; sail: Mesh } {
    const scene = this.scene;
    const hullParts: Mesh[] = [];
    const sailParts: Mesh[] = [];
    const stretch = kit === "longboat" ? 3.1 : kit === "outrigger" || kit === "dugout" ? 2.6 : kit === "dhow" ? 2.9 : kit === "sampan" ? 2.5 : 2.4;
    const beam = kit === "longboat" ? 0.8 : kit === "outrigger" || kit === "dugout" ? 0.62 : kit === "sampan" ? 1.05 : kit === "dhow" ? 0.95 : 1;
    const upper = MeshBuilder.CreateCylinder("hb", { diameter: 0.5, height: 0.16, tessellation: 6 }, scene);
    upper.scaling.set(stretch, 1, beam);
    upper.position.set(0, 0.2, 0);
    hullParts.push(tint(upper, "#ffffff"));
    const hull = mergeFlat("boatHulls", hullParts, scene);
    hull.material = flatMaterial(scene).clone("boatHullMat") as StandardMaterial;

    const lower = MeshBuilder.CreateCylinder("hl", { diameterTop: 0.5, diameterBottom: 0.3, height: 0.14, tessellation: 6 }, scene);
    lower.scaling.set(stretch, 1, beam);
    lower.position.set(0, 0.05, 0);
    sailParts.push(tint(lower, kit === "longboat" ? "#2b2b2b" : "#4c5a66"));
    const gunwale = MeshBuilder.CreateCylinder("gw", { diameter: 0.54, height: 0.035, tessellation: 6 }, scene);
    gunwale.scaling.set(stretch, 1, beam);
    gunwale.position.set(0, 0.29, 0);
    sailParts.push(tint(gunwale, kit === "longboat" ? "#5a4636" : "#f2ece0"));
    const cockpit = MeshBuilder.CreateCylinder("ck", { diameter: 0.36, height: 0.03, tessellation: 6 }, scene);
    cockpit.scaling.set(stretch - 0.2, 1, beam);
    cockpit.position.set(0, 0.29, 0);
    sailParts.push(tint(cockpit, "#5a4636"));
    for (const tx of [-0.3, 0.32]) {
      const thwart = MeshBuilder.CreateBox("tw", { width: 0.08, height: 0.03, depth: 0.34 * beam }, scene);
      thwart.position.set(tx, 0.32, 0);
      sailParts.push(tint(thwart, PALETTE.planks));
    }
    if (kit === "dory") {
      const net = MeshBuilder.CreateSphere("net", { diameter: 0.2, segments: 4 }, scene);
      net.scaling.set(1.3, 0.55, 1);
      net.position.set(-0.46, 0.33, 0.05);
      sailParts.push(tint(net, "#b9a377"));
      const mast = MeshBuilder.CreateCylinder("mast", { diameter: 0.04, height: 1.05, tessellation: 4 }, scene);
      mast.position.set(0.08, 0.8, 0);
      sailParts.push(tint(mast, PALETTE.wood));
      const boom = MeshBuilder.CreateCylinder("boom", { diameter: 0.03, height: 0.62, tessellation: 4 }, scene);
      boom.rotation.z = Math.PI / 2;
      boom.position.set(-0.22, 0.45, 0.02);
      sailParts.push(tint(boom, PALETTE.wood));
      // The sail: a three-sided prism squashed flat, then stretched tall; its foot lies along the boom.
      const sail = MeshBuilder.CreateCylinder("sail", { diameter: 0.6, height: 0.02, tessellation: 3 }, scene);
      sail.rotation.x = Math.PI / 2;
      sail.rotation.y = Math.PI;
      sail.scaling.set(1, 1, 1);
      sail.position.set(-0.2, 0.74, 0.03);
      sail.scaling.set(1.0, 1, 2.0);
      sailParts.push(tint(sail, PALETTE.sail));
    } else if (kit === "longboat") {
      for (const end of [-1, 1]) {
        const post = MeshBuilder.CreateCylinder("post", { diameterTop: 0.03, diameterBottom: 0.07, height: 0.34, tessellation: 4 }, scene);
        post.position.set(end * 0.72, 0.4, 0);
        post.rotation.z = -end * 0.35;
        sailParts.push(tint(post, "#2b2b2b"));
      }
      for (const side of [-1, 1]) for (const tx of [-0.35, -0.05, 0.25]) {
        const oar = MeshBuilder.CreateBox("oar", { width: 0.03, height: 0.02, depth: 0.5 }, scene);
        oar.position.set(tx, 0.31, side * 0.34);
        oar.rotation.x = side * 0.5;
        sailParts.push(tint(oar, PALETTE.planks));
      }
      const mast = MeshBuilder.CreateCylinder("mast", { diameter: 0.04, height: 1.0, tessellation: 4 }, scene);
      mast.position.set(0.05, 0.78, 0);
      sailParts.push(tint(mast, PALETTE.wood));
      const yard = MeshBuilder.CreateCylinder("yard", { diameter: 0.03, height: 0.7, tessellation: 4 }, scene);
      yard.rotation.x = Math.PI / 2;
      yard.position.set(0.05, 1.18, 0);
      sailParts.push(tint(yard, PALETTE.wood));
      const sail = MeshBuilder.CreateBox("sail", { width: 0.02, height: 0.6, depth: 0.66 }, scene);
      sail.position.set(0.02, 0.86, 0);
      sailParts.push(tint(sail, "#c9a86a"));
      const stripe = MeshBuilder.CreateBox("sailStripe", { width: 0.025, height: 0.6, depth: 0.1 }, scene);
      stripe.position.set(0.02, 0.86, 0.18);
      sailParts.push(tint(stripe, "#8a3f33"));
    } else if (kit === "sampan") {
      // A flat-bottomed sampan: a woven bamboo canopy arched over the middle, a long stern oar (yuloh), a pole.
      const canopy = MeshBuilder.CreateCylinder("canopy", { diameter: 0.46, height: 0.46, tessellation: 8, arc: 0.5 }, scene);
      canopy.rotation.z = Math.PI / 2;
      canopy.rotation.y = Math.PI / 2;
      canopy.position.set(-0.05, 0.32, 0);
      canopy.scaling.set(1, 1, 1);
      sailParts.push(tint(canopy, "#b89a63"));
      for (const tx of [-0.28, 0.18]) {
        const hoop = MeshBuilder.CreateTorus("hoop", { diameter: 0.46, thickness: 0.025, tessellation: 10 }, scene);
        hoop.rotation.z = Math.PI / 2;
        hoop.position.set(tx, 0.32, 0);
        sailParts.push(tint(hoop, "#8a6f52"));
      }
      const oar = MeshBuilder.CreateBox("yuloh", { width: 0.9, height: 0.03, depth: 0.04 }, scene);
      oar.position.set(-0.85, 0.3, 0.04);
      oar.rotation.z = 0.25;
      sailParts.push(tint(oar, PALETTE.wood));
      const pole = MeshBuilder.CreateCylinder("pole", { diameter: 0.025, height: 1.1, tessellation: 4 }, scene);
      pole.rotation.z = Math.PI / 2 - 0.15;
      pole.position.set(0.2, 0.36, -0.2);
      sailParts.push(tint(pole, "#b9a377"));
    } else if (kit === "dugout") {
      // A dugout log with one square-ish sail on a short mast, a paddle across it.
      const mast = MeshBuilder.CreateCylinder("mast", { diameter: 0.035, height: 0.85, tessellation: 4 }, scene);
      mast.position.set(0.12, 0.66, 0);
      sailParts.push(tint(mast, PALETTE.wood));
      const sail = MeshBuilder.CreateBox("sail", { width: 0.02, height: 0.5, depth: 0.46 }, scene);
      sail.position.set(0.1, 0.72, 0);
      sail.rotation.x = 0.1;
      sailParts.push(tint(sail, "#e6dccb"));
      const band = MeshBuilder.CreateBox("sailBand", { width: 0.022, height: 0.1, depth: 0.46 }, scene);
      band.position.set(0.1, 0.84, 0);
      sailParts.push(tint(band, "#c9674f"));
      const paddle = MeshBuilder.CreateBox("paddle", { width: 0.04, height: 0.02, depth: 0.7 }, scene);
      paddle.position.set(-0.35, 0.32, 0);
      paddle.rotation.y = 0.4;
      sailParts.push(tint(paddle, PALETTE.planks));
    } else if (kit === "dhow") {
      // A dhow: a raked mast with a long lateen yard and a great triangular sail, a high stern.
      const mast = MeshBuilder.CreateCylinder("mast", { diameter: 0.045, height: 1.1, tessellation: 4 }, scene);
      mast.position.set(0.15, 0.8, 0);
      mast.rotation.z = 0.18;
      sailParts.push(tint(mast, PALETTE.wood));
      const yard = MeshBuilder.CreateCylinder("yard", { diameter: 0.03, height: 1.7, tessellation: 4 }, scene);
      yard.rotation.z = Math.PI / 2 - 0.5;
      yard.position.set(0.1, 1.05, 0.02);
      sailParts.push(tint(yard, PALETTE.wood));
      const sail = MeshBuilder.CreateCylinder("sail", { diameter: 1.0, height: 0.02, tessellation: 3 }, scene);
      sail.rotation.x = Math.PI / 2;
      sail.rotation.z = -0.5;
      sail.position.set(0.05, 0.9, 0.04);
      sail.scaling.set(1.2, 1, 1.0);
      sailParts.push(tint(sail, PALETTE.sail));
      const stern = MeshBuilder.CreateBox("stern", { width: 0.22, height: 0.2, depth: 0.44 }, scene);
      stern.position.set(-0.6, 0.38, 0);
      sailParts.push(tint(stern, "#8a6f52"));
    } else {
      // The float (ama) on two booms to port, and a crab-claw sail leaning with its mast.
      const ama = MeshBuilder.CreateCylinder("ama", { diameter: 0.14, height: 1.1, tessellation: 5 }, scene);
      ama.rotation.z = Math.PI / 2;
      ama.position.set(0, 0.1, 0.62);
      sailParts.push(tint(ama, "#5a4636"));
      for (const tx of [-0.28, 0.28]) {
        const boom = MeshBuilder.CreateBox("ob", { width: 0.05, height: 0.03, depth: 0.7 }, scene);
        boom.position.set(tx, 0.28, 0.3);
        sailParts.push(tint(boom, PALETTE.planks));
      }
      const mast = MeshBuilder.CreateCylinder("mast", { diameter: 0.035, height: 0.9, tessellation: 4 }, scene);
      mast.position.set(0.1, 0.72, -0.05);
      mast.rotation.z = -0.25;
      sailParts.push(tint(mast, PALETTE.wood));
      const sail = MeshBuilder.CreateCylinder("sail", { diameter: 0.55, height: 0.02, tessellation: 3 }, scene);
      sail.rotation.x = Math.PI / 2;
      sail.rotation.z = -0.25;
      sail.position.set(0.0, 0.78, -0.02);
      sail.scaling.set(1.0, 1, 1.9);
      sailParts.push(tint(sail, "#f7f1e3"));
    }
    const sail = mergeFlat("boatSails", sailParts, scene);
    for (const m of [hull, sail]) { m.isPickable = false; m.alwaysSelectAsActiveMesh = true; }
    return { hull, sail };
  }

  /** The sea route as cell centres, with the harbour's own cells dropped (a trip starts from the mooring). */
  private pathFor(harbour: Building, ground: Cell): Vector3[] {
    const key = `${harbour.id}:${ground.i},${ground.j}`;
    let p = this.paths.get(key);
    if (!p) {
      p = seaPath(this.grid, harbour, ground)
        .filter(c => !harbour.cells.some(h => h.i === c.i && h.j === c.j))
        .map(c => { const { x, z } = cellCenter(c); return new Vector3(x, 0, z); });
      this.paths.set(key, p);
    }
    return p;
  }

  /**
   * Boat `k` of `n` at harbour `h`, from its mooring `m` to the ground: the route smoothed, its end moved across to
   * the boat's own spot, the outbound lane on one side, a U-turn round the spot, the homebound lane on the other.
   */
  private tripFor(h: Building, ground: Cell, route: Vector3[], k: number, n: number, m: { x: number; z: number }): Trip {
    const key = `${h.id}:${ground.i},${ground.j}:${k}/${n}:${m.x.toFixed(2)},${m.z.toFixed(2)}`;
    let trip = this.trips.get(key);
    if (trip) return trip;
    const base = smooth([new Vector3(m.x, 0, m.z), ...route]);
    const end = base[base.length - 1], prev = base[Math.max(0, base.length - 2)];
    let dx = end.x - prev.x, dz = end.z - prev.z;
    const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    // Spread the boats across the ground, perpendicular to the way in; the last stretch bends over to the spot.
    const spread = (k - (n - 1) / 2) * SPREAD;
    const reach = Math.min(base.length - 1, 6);
    const pts = base.map((p, i) => {
      const w = i < base.length - reach ? 0 : easeInOut((i - (base.length - reach)) / Math.max(1, reach - 1));
      return new Vector3(p.x - dz * spread * w, 0, p.z + dx * spread * w);
    });
    // Each boat keeps its own pair of lanes, a little wider than the boat before it.
    const width = Math.min(LANE_MAX, LANE + k * LANE_STEP);
    const out = lane(pts, width, false);
    const back = lane(pts.slice().reverse(), width, true);
    // The U-turn: from the outbound lane's end round the far side of the spot to the homebound lane's start.
    const o = out[out.length - 1], bk = back[0];
    const turn: Vector3[] = [];
    for (let q = 0; q <= 10; q++) {
      const th = (q / 10) * Math.PI;
      // Lerp across the lanes on a half-circle bulging forward (dx, dz) past the spot.
      const lx = o.x + (bk.x - o.x) * (1 - Math.cos(th)) / 2, lz = o.z + (bk.z - o.z) * (1 - Math.cos(th)) / 2;
      turn.push(new Vector3(lx + dx * width * Math.sin(th), 0, lz + dz * width * Math.sin(th)));
    }
    trip = { out: track(out), turn: track(turn), back: track(back), hold: { x: o.x, z: o.z, heading: Math.atan2(dx, dz) } };
    this.trips.set(key, trip);
    return trip;
  }

  /** Mooring positions alongside the harbour's deck, skipping cells something else stands on (a walkway laid
   *  beside a pier, say), so no boat is ever parked inside a deck. */
  private moorings(h: Building): { x: number; z: number; yaw: number }[] {
    const slots = BUILDINGS[h.kind].slots ?? 0;
    const candidates: { x: number; z: number; yaw: number }[] = [];
    if (h.kind === "pier") {
      const a = cellCenter(h.cells[0]), s = cellCenter(h.cells[h.cells.length - 1]);
      const alongX = a.z === s.z;
      const mx = (a.x + s.x) / 2, mz = (a.z + s.z) / 2;
      const tip = { x: s.x + Math.sign(s.x - a.x) * 0.9, z: s.z + Math.sign(s.z - a.z) * 0.9 };
      for (const along of [-0.2, 0.6]) for (const side of [-1, 1]) {
        candidates.push(alongX ? { x: mx + along, z: mz + side * 0.78, yaw: 0 } : { x: mx + side * 0.78, z: mz + along, yaw: Math.PI / 2 });
      }
      candidates.push({ x: tip.x, z: tip.z, yaw: alongX ? Math.PI / 2 : 0 });
    } else {
      const is = h.cells.map(c => c.i), js = h.cells.map(c => c.j);
      const cx = (Math.min(...is) + Math.max(...is) + 1) / 2, cz = (Math.min(...js) + Math.max(...js) + 1) / 2;
      const w = Math.max(...is) - Math.min(...is) + 1, d = Math.max(...js) - Math.min(...js) + 1;
      candidates.push(
        { x: cx - w / 2 - 0.5, z: cz - 0.35, yaw: Math.PI / 2 }, { x: cx + w / 2 + 0.5, z: cz + 0.35, yaw: Math.PI / 2 },
        { x: cx - 0.35, z: cz - d / 2 - 0.5, yaw: 0 }, { x: cx + 0.35, z: cz + d / 2 + 0.5, yaw: 0 },
        { x: cx - w / 2 - 0.5, z: cz + 0.6, yaw: Math.PI / 2 }, { x: cx + w / 2 + 0.5, z: cz - 0.6, yaw: Math.PI / 2 },
        { x: cx - 0.35, z: cz + d / 2 + 0.5, yaw: 0 }, { x: cx + 0.35, z: cz - d / 2 - 0.5, yaw: 0 },
      );
    }
    // A moored boat turns so its outboard side (the outrigger's float sits on local +z) faces away from the deck:
    // the hull's bow is +x, so a hull along x takes yaw 0 or π and one along z takes ±π/2, whichever points out.
    const centre = h.kind === "pier" ? (() => { const a = cellCenter(h.cells[0]), s = cellCenter(h.cells[h.cells.length - 1]); return { x: (a.x + s.x) / 2, z: (a.z + s.z) / 2 }; })() : (() => { const is = h.cells.map(c => c.i), js = h.cells.map(c => c.j); return { x: (Math.min(...is) + Math.max(...is) + 1) / 2, z: (Math.min(...js) + Math.max(...js) + 1) / 2 }; })();
    for (const m of candidates) {
      const ox = m.x - centre.x, oz = m.z - centre.z;
      const hullAlongX = Math.abs(Math.cos(m.yaw)) > 0.5;
      m.yaw = hullAlongX ? (oz >= 0 ? 0 : Math.PI) : (ox >= 0 ? Math.PI / 2 : -Math.PI / 2);
    }
    const free = candidates.filter(m => !this.grid.buildingAt(worldToCell(m.x, m.z)));
    const pool = free.length ? free : candidates;
    const out: { x: number; z: number; yaw: number }[] = [];
    for (let k = 0; k < slots; k++) out.push(pool[k % pool.length]);
    return out;
  }

  sync(state: SimState, viewTime: number, visits: Visit[] = []): void {
    const level = state.tide.level;
    const instances: Instance[] = [];
    const poses: BoatPose[] = [];
    const floats: Vector3[] = [];
    let colorIndex = 0;
    for (const h of Object.values(state.buildings)) {
      if ((BUILDINGS[h.kind].slots ?? 0) === 0 || h.boats === 0) continue;
      const moorings = this.moorings(h);
      const route = h.atSea && h.ground ? this.pathFor(h, h.ground) : null;
      const u = h.atSea ? phaseProgress(state.tide, this.grid.tides.highMark, this.grid.tides.lowMark) : 0;
      for (let k = 0; k < h.boats; k++) {
        const color = Color4.FromHexString(PALETTE.hulls[(colorIndex++) % PALETTE.hulls.length]);
        // A trip starts from the boat's own mooring and joins the sea route outside the harbour, so it never
        // sails through the deck. The route is smoothed so the boat rounds corners on an arc, and the hull
        // always points along its own motion: a boat moves along its keel, never sideways.
        const m0 = moorings[k % moorings.length];
        if (route && route.length > 0) {
          const trip = this.tripFor(h, h.ground!, route, k, h.boats, m0);
          const lag = k * Math.min(STAGGER, STAGGER_TOTAL / Math.max(1, h.boats - 1));
          const turnAt = BACK + lag;
          let x: number, z: number, heading: number, fishing = false;
          if (u < OUT) {
            // Out along the outbound lane, easing away from the mooring and slowing onto the spot.
            const d = trip.out.len * easeInOut(clamp01((u - lag) / (OUT - lag)));
            ({ x, z } = along(trip.out, d));
            heading = headingAt(trip.out, d);
          } else if (u < turnAt) {
            // The net is out: the boat lies on its spot, drifting a little ahead and back and swinging on the net.
            const t = (u - OUT) / (turnAt - OUT);
            const drift = 0.3 * Math.sin(Math.PI * t);
            x = trip.hold.x + Math.sin(trip.hold.heading) * drift;
            z = trip.hold.z + Math.cos(trip.hold.heading) * drift;
            heading = trip.hold.heading + 0.18 * Math.sin(Math.PI * 2 * t);
            fishing = true;
          } else if (u < turnAt + TURN) {
            const d = trip.turn.len * easeInOut((u - turnAt) / TURN);
            ({ x, z } = along(trip.turn, d));
            heading = headingAt(trip.turn, d);
          } else {
            // Home along the other lane, done a moment before the phase ends so it's moored when the sim says so.
            const d = trip.back.len * easeInOut(clamp01((u - turnAt - TURN) / (0.98 - turnAt - TURN)));
            ({ x, z } = along(trip.back, d));
            heading = headingAt(trip.back, d);
          }
          // The hull's bow is +x, so the yaw that puts +x onto the travel direction is heading − π/2.
          const yaw = heading - Math.PI / 2;
          instances.push({ pos: new Vector3(x, level + waveHeight(x, z, viewTime) - DRAFT * 0.3, z), yaw, roll: 0.04 * Math.sin(viewTime * 1.3 + k), color });
          poses.push({ x, z, atSea: true, moored: false, fishing });
          if (fishing) {
            // On the ground: the net is out — a line of floats trails off the quarter, bobbing.
            for (let f = 0; f < 4; f++) {
              const fx = x - Math.cos(yaw) * (0.45 + f * 0.28) + Math.sin(yaw) * 0.25, fz = z + Math.sin(yaw) * (0.45 + f * 0.28) + Math.cos(yaw) * 0.25;
              floats.push(new Vector3(fx, level + waveHeight(fx, fz, viewTime) + 0.02 + 0.02 * Math.sin(viewTime * 2.5 + f), fz));
            }
          }
        } else {
          const m = moorings[k % moorings.length];
          const bed = groundHeight(m.x, m.z);
          const afloat = level - bed > DRAFT;
          const y = afloat ? level + waveHeight(m.x, m.z, viewTime) - DRAFT * 0.3 : bed + 0.05;
          const roll = afloat ? 0.03 * Math.sin(viewTime * 1.1 + k * 2) : HEEL * (k % 2 === 0 ? 1 : -1);
          instances.push({ pos: new Vector3(m.x, y, m.z), yaw: m.yaw, roll, color });
          poses.push({ x: m.x, z: m.z, atSea: false, moored: true });
        }
      }
    }
    // Visiting boats: in from open water, alongside the landing while the newcomers climb off, then away again.
    visits.forEach((v, n) => {
      const port = state.buildings[v.port];
      const way = port ? this.approachFor(port, v) : null;
      if (!way) return;
      const t = viewTime - v.at;
      // It stops with its bow at the deck's edge, where the newcomers climb off.
      const berth = Math.max(0, way.len - 0.55);
      let d: number;
      if (t < VISIT_SAIL) d = berth * (1 - Math.pow(1 - t / VISIT_SAIL, 2));
      else if (t < VISIT_SAIL + v.stay) d = berth;
      else d = berth * (1 - Math.pow(Math.min(1, (t - VISIT_SAIL - v.stay) / VISIT_SAIL), 2));
      const { x, z } = along(way, d);
      const leaving = t >= VISIT_SAIL + v.stay;
      const heading = headingAt(way, d) + (leaving ? Math.PI : 0);
      instances.push({ pos: new Vector3(x, level + waveHeight(x, z, viewTime) - DRAFT * 0.3, z), yaw: heading - Math.PI / 2, roll: 0.04 * Math.sin(viewTime * 1.2 + n), color: Color4.FromHexString(PALETTE.hulls[3]) });
    });
    this.poses = poses;
    this.write(instances);
    if (floats.length === 0) this.floats.setEnabled(false);
    else {
      const m = new Float32Array(floats.length * 16);
      floats.forEach((p, k) => Matrix.Translation(p.x, p.y, p.z).copyToArray(m, k * 16));
      this.floats.thinInstanceSetBuffer("matrix", m, 16, false);
      this.floats.setEnabled(true);
    }
  }

  /** Another sea: its harbours and grounds share ids and cells with the last one's, so the routes start over. */
  clear(): void {
    this.paths.clear();
    this.trips.clear();
    this.approaches.clear();
  }

  /** From the open-water edge of the map to the spot beside the landing where the newcomers climb off. */
  private approachFor(port: Building, v: Visit): Track | null {
    const key = `${port.id}:${v.x.toFixed(2)},${v.z.toFixed(2)}`;
    if (this.approaches.has(key)) return this.approaches.get(key)!;
    const entry = seaEntry(this.grid, port);
    const cells = entry ? seaPath(this.grid, port, entry, SIZE * 2).filter(c => !port.cells.some(h => h.i === c.i && h.j === c.j)) : [];
    const t = cells.length ? track(smooth([...cells.slice().reverse().map(c => { const { x, z } = cellCenter(c); return new Vector3(x, 0, z); }), new Vector3(v.x, 0, v.z)])) : null;
    this.approaches.set(key, t);
    return t;
  }

  private write(instances: Instance[]): void {
    const n = instances.length;
    if (this.matrices.length !== n * 16) {
      this.matrices = new Float32Array(n * 16);
      this.sailMatrices = new Float32Array(n * 16);
      this.colors = new Float32Array(n * 4);
    }
    const scale = new Vector3(1, 1, 1);
    for (let k = 0; k < n; k++) {
      const it = instances[k];
      const q = Quaternion.FromEulerAngles(0, it.yaw, it.roll);
      Matrix.Compose(scale, q, it.pos).copyToArray(this.matrices, k * 16);
      Matrix.Compose(scale, q, it.pos).copyToArray(this.sailMatrices, k * 16);
      this.colors[k * 4] = it.color.r; this.colors[k * 4 + 1] = it.color.g; this.colors[k * 4 + 2] = it.color.b; this.colors[k * 4 + 3] = 1;
    }
    if (n === 0) { this.hull.setEnabled(false); this.sail.setEnabled(false); return; }
    this.hull.setEnabled(true); this.sail.setEnabled(true);
    this.hull.thinInstanceSetBuffer("matrix", this.matrices, 16, false);
    this.hull.thinInstanceSetBuffer("color", this.colors, 4, false);
    this.sail.thinInstanceSetBuffer("matrix", this.sailMatrices, 16, false);
  }
}
