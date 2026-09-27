// The World's solid: a regular dodecahedron standing on a face, at island scale. Pure math (no Babylon) so the
// tests can check it: face centres, normals, local frames, vertex rings, edges, adjacency and bands, plus the
// pentagon-disc mesh the oceans use. Face 0 is the top polar face, 1–5 the upper ring (temperate) east-about,
// 6–10 the lower ring (tropical), 11 the bottom polar face.
import { bandOf, Band } from "../sim/sectors";

export type V3 = { x: number; y: number; z: number };
const v = (x: number, y: number, z: number): V3 => ({ x, y, z });
const add = (a: V3, b: V3) => v(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a: V3, b: V3) => v(a.x - b.x, a.y - b.y, a.z - b.z);
const mul = (a: V3, k: number) => v(a.x * k, a.y * k, a.z * k);
const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: V3, b: V3) => v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const len = (a: V3) => Math.hypot(a.x, a.y, a.z);
const norm = (a: V3) => mul(a, 1 / len(a));

/** Edge length in world units: a face's inradius is a × 0.6882 ≈ 40, room for a 64-unit island. */
export const EDGE = 58;
const PHI = (1 + Math.sqrt(5)) / 2;
/** The golden-ratio dodecahedron has edge 2/φ; scale it to EDGE. */
const SCALE = EDGE / (2 / PHI);
export const FACE_INRADIUS = EDGE * 0.6881909602;
export const FACE_CIRCUMRADIUS = EDGE * 0.8506508084;
/** Distance from the centre to a face (the solid's inradius) and to a vertex (its circumradius). */
export const SOLID_INRADIUS = EDGE * 1.1135163644;
export const SOLID_CIRCUMRADIUS = EDGE * 1.4012585384;

export interface Face {
  index: number;
  band: Band;
  centre: V3;
  normal: V3;
  /** Local axes: x east along the ring, y the normal, z toward the far pole (so local −z looks at the near pole). */
  xAxis: V3;
  zAxis: V3;
  /** The five corners in world space, counter-clockwise seen from outside. */
  corners: V3[];
  /** Indices of the five faces sharing an edge with this one, in corner order (edge k = corners k, k+1). */
  neighbours: number[];
  /** Babylon's row-major world matrix (x axis, y axis, z axis, position) as 16 numbers. */
  matrix: number[];
}

/** Rotate `p` so that `from` maps onto `to` (both unit), by the shortest arc. */
function rotateOnto(p: V3, from: V3, to: V3): V3 {
  const axis = cross(from, to), s = len(axis), c = dot(from, to);
  if (s < 1e-9) return c > 0 ? p : v(-p.x, p.y, -p.z);
  const k = norm(axis);
  // Rodrigues
  return add(add(mul(p, c), mul(cross(k, p), s)), mul(k, dot(k, p) * (1 - c)));
}

function build(): { faces: Face[]; edges: [V3, V3][] } {
  const raw: V3[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) raw.push(v(sx, sy, sz));
  for (const a of [-1, 1]) for (const b of [-1, 1]) {
    raw.push(v(0, a / PHI, b * PHI));
    raw.push(v(a / PHI, b * PHI, 0));
    raw.push(v(a * PHI, 0, b / PHI));
  }
  // The face normals of this dodecahedron are the cyclic permutations of (0, ±φ, ±1).
  const normalsRaw: V3[] = [];
  for (const a of [-1, 1]) for (const b of [-1, 1]) {
    normalsRaw.push(norm(v(0, a * PHI, b)));
    normalsRaw.push(norm(v(b, 0, a * PHI)));
    normalsRaw.push(norm(v(a * PHI, b, 0)));
  }
  // Stand it on a face: the normal (0, φ, 1) becomes straight up.
  const top = norm(v(0, PHI, 1)), up = v(0, 1, 0);
  const verts = raw.map(p => mul(rotateOnto(p, top, up), SCALE));
  const normals = normalsRaw.map(n => rotateOnto(n, top, up));
  const faces0 = normals.map(normal => {
    const d = verts.map(p => dot(p, normal));
    const max = Math.max(...d);
    const idx = verts.map((_, k) => k).filter(k => d[k] > max - 1e-6);
    const centre = mul(normal, max);
    return { normal, centre, idx };
  });
  // Order: top, upper ring by azimuth, lower ring by azimuth, bottom.
  const az = (f: { centre: V3 }) => Math.atan2(f.centre.z, f.centre.x);
  const topF = faces0.filter(f => f.normal.y > 0.99), botF = faces0.filter(f => f.normal.y < -0.99);
  const upper = faces0.filter(f => f.normal.y > 0.01 && f.normal.y < 0.99).sort((a, b) => az(a) - az(b));
  const lower = faces0.filter(f => f.normal.y < -0.01 && f.normal.y > -0.99).sort((a, b) => az(a) - az(b));
  const ordered = [...topF, ...upper, ...lower, ...botF];
  const faces: Face[] = ordered.map((f, index) => {
    const yAxis = f.normal;
    let xAxis: V3, zAxis: V3;
    if (Math.abs(yAxis.y) > 0.99) { xAxis = v(1, 0, 0); zAxis = cross(xAxis, yAxis); }
    else {
      xAxis = norm(cross(up, yAxis)); // east along the ring
      zAxis = cross(xAxis, yAxis);
      // Local −z should look at the near pole: the upper ring's z points down the globe, the lower ring's up.
      const wantDown = yAxis.y > 0;
      if ((zAxis.y < 0) !== wantDown) { xAxis = mul(xAxis, -1); zAxis = mul(zAxis, -1); }
    }
    const corners = f.idx.map(k => verts[k]).sort((a, b) => {
      const pa = sub(a, f.centre), pb = sub(b, f.centre);
      return Math.atan2(dot(pa, zAxis), dot(pa, xAxis)) - Math.atan2(dot(pb, zAxis), dot(pb, xAxis));
    });
    // Counter-clockwise seen from outside: (c1 − c0) × (c2 − c0) must point along the normal.
    if (dot(cross(sub(corners[1], corners[0]), sub(corners[2], corners[0])), yAxis) < 0) corners.reverse();
    const c = f.centre;
    return { index, band: bandOf(index), centre: c, normal: yAxis, xAxis, zAxis, corners, neighbours: [], matrix: [xAxis.x, xAxis.y, xAxis.z, 0, yAxis.x, yAxis.y, yAxis.z, 0, zAxis.x, zAxis.y, zAxis.z, 0, c.x, c.y, c.z, 1] };
  });
  const same = (a: V3, b: V3) => len(sub(a, b)) < 1e-6;
  const edges: [V3, V3][] = [];
  for (const f of faces) {
    for (let k = 0; k < 5; k++) {
      const a = f.corners[k], b = f.corners[(k + 1) % 5];
      const other = faces.find(g => g !== f && g.corners.some(p => same(p, a)) && g.corners.some(p => same(p, b)))!;
      f.neighbours.push(other.index);
      if (other.index > f.index) edges.push([a, b]);
    }
  }
  return { faces, edges };
}

const built = build();
export const FACES: readonly Face[] = built.faces;
/** The thirty edges, each once, as world-space endpoints. */
export const EDGES: readonly [V3, V3][] = built.edges;

/** World point → the face's local frame (x east, y up the normal, z toward the far pole). */
export function toLocal(f: Face, p: V3): V3 {
  const d = sub(p, f.centre);
  return v(dot(d, f.xAxis), dot(d, f.normal), dot(d, f.zAxis));
}
export function toWorld(f: Face, l: V3): V3 {
  return add(add(add(f.centre, mul(f.xAxis, l.x)), mul(f.normal, l.y)), mul(f.zAxis, l.z));
}

/** Is a local (x, z) inside the face's pentagon, inset by `inset` units from every edge? */
export function insidePentagon(f: Face, x: number, z: number, inset = 0): boolean {
  for (let k = 0; k < 5; k++) {
    const a = toLocal(f, f.corners[k]), b = toLocal(f, f.corners[(k + 1) % 5]);
    // Edge direction and its inward normal (the centre is at the origin).
    const ex = b.x - a.x, ez = b.z - a.z;
    const l = Math.hypot(ex, ez);
    let nx = -ez / l, nz = ex / l;
    if (nx * a.x + nz * a.z > 0) { nx = -nx; nz = -nz; } // point the normal toward the centre
    const dist = (x - a.x) * nx + (z - a.z) * nz; // ≥ 0 inside
    if (dist < inset) return false;
  }
  return true;
}

/**
 * A pentagon "disc": the face's pentagon cut into five triangles from the centre, each subdivided `rings`
 * times, so every triangle has the same area (the water's facet normals come from screen-space derivatives,
 * and thin triangles near the centre would show as spokes). Ring k holds 5k points; positions are local
 * (x, 0, z); the last ring is the exact pentagon. 5·rings² triangles, 1 + 5·rings·(rings + 1)/2 vertices.
 */
export function pentagonDisc(f: Face, rings: number): { positions: number[]; indices: number[] } {
  const corners = f.corners.map(c => toLocal(f, c));
  const positions: number[] = [0, 0, 0];
  const indices: number[] = [];
  const ringStart = (k: number) => 1 + 5 * (k - 1) * k / 2;
  /** Point q of side `side` on ring k (q = k is the next side's first point); ring 0 is the centre. */
  const at = (k: number, side: number, q: number) => k === 0 ? 0 : ringStart(k) + (side * k + q) % (5 * k);
  for (let k = 1; k <= rings; k++) {
    const s = k / rings;
    for (let side = 0; side < 5; side++) {
      const a = corners[side], b = corners[(side + 1) % 5];
      for (let q = 0; q < k; q++) {
        const t = q / k;
        positions.push((a.x + (b.x - a.x) * t) * s, 0, (a.z + (b.z - a.z) * t) * s);
      }
    }
  }
  for (let k = 1; k <= rings; k++) {
    for (let side = 0; side < 5; side++) {
      for (let q = 0; q < k; q++) {
        indices.push(at(k, side, q), at(k, side, q + 1), at(k - 1, side, q));
        if (q < k - 1) indices.push(at(k - 1, side, q), at(k, side, q + 1), at(k - 1, side, q + 1));
      }
    }
  }
  return { positions, indices };
}

/** The face nearest a direction from the centre (for keyboard steps and the idle target). */
export function faceToward(dir: V3): number {
  let best = 0, bd = -Infinity;
  for (const f of FACES) { const d = dot(f.normal, norm(dir)); if (d > bd) { bd = d; best = f.index; } }
  return best;
}
