// The World's pure parts: the dodecahedron, the pentagon discs, and the miniatures.
import { describe, expect, it } from "vitest";
import { LANDFILL_HEIGHT } from "../src/sim/balance";
import { clampToPentagon, EDGE, EDGES, FACE_INRADIUS, FACES, faceToward, insidePentagon, pentagonDisc, SOLID_CIRCUMRADIUS, toLocal, toWorld } from "../src/globe/geometry";
import { MINI_CELLS, miniatureHeights, roofPlacements } from "../src/globe/miniature";
import { cellIndex } from "../src/sim/grid";
import { island } from "../src/sim/island";
import { newGame } from "../src/sim/start";
import { starterTown } from "./scenario";

const len = (a: { x: number; y: number; z: number }) => Math.hypot(a.x, a.y, a.z);
const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe("the World's solid", () => {
  it("is a regular dodecahedron standing on a face, banded top-ring-ring-bottom, with thirty edges", () => {
    expect(FACES.length).toBe(12);
    expect(EDGES.length).toBe(30);
    for (const [a, b] of EDGES) expect(dist(a, b)).toBeCloseTo(EDGE, 6);
    expect(FACES[0].normal.y).toBeCloseTo(1, 9);
    expect(FACES[11].normal.y).toBeCloseTo(-1, 9);
    expect(FACES.slice(1, 6).map(f => f.band)).toEqual(Array(5).fill("temperate"));
    expect(FACES.slice(6, 11).map(f => f.band)).toEqual(Array(5).fill("tropical"));
    expect(FACES[0].band).toBe("polar");
    for (const f of FACES) {
      expect(len(f.normal)).toBeCloseTo(1, 9);
      expect(f.corners.length).toBe(5);
      for (const c of f.corners) { expect(len(c)).toBeCloseTo(SOLID_CIRCUMRADIUS, 5); expect(Math.abs(toLocal(f, c).y)).toBeLessThan(1e-6); }
      expect(f.neighbours.length).toBe(5);
      expect(new Set(f.neighbours).size).toBe(5);
      for (const n of f.neighbours) expect(FACES[n].neighbours).toContain(f.index);
      // Local frame: right-handed, unit, the normal is y.
      expect(len(f.xAxis)).toBeCloseTo(1, 9);
      expect(Math.abs(f.xAxis.x * f.normal.x + f.xAxis.y * f.normal.y + f.xAxis.z * f.normal.z)).toBeLessThan(1e-9);
      const p = toWorld(f, { x: 3, y: 1, z: -2 });
      const l = toLocal(f, p);
      expect(l.x).toBeCloseTo(3, 9); expect(l.y).toBeCloseTo(1, 9); expect(l.z).toBeCloseTo(-2, 9);
      // The inradius: the centre of an edge is FACE_INRADIUS from the face centre.
      const mid = { x: (f.corners[0].x + f.corners[1].x) / 2, y: (f.corners[0].y + f.corners[1].y) / 2, z: (f.corners[0].z + f.corners[1].z) / 2 };
      expect(dist(mid, f.centre)).toBeCloseTo(FACE_INRADIUS, 4);
    }
    // Ring faces look at their pole along local −z.
    for (const f of FACES.slice(1, 6)) expect(toWorld(f, { x: 0, y: 0, z: -10 }).y).toBeGreaterThan(f.centre.y);
    for (const f of FACES.slice(6, 11)) expect(toWorld(f, { x: 0, y: 0, z: -10 }).y).toBeLessThan(f.centre.y);
    expect(faceToward({ x: 0, y: 1, z: 0 })).toBe(0);
    expect(faceToward({ x: 0, y: -1, z: 0 })).toBe(11);
    // The pentagon test: the centre is inside, a corner is on the boundary, beyond it is outside.
    const f = FACES[3];
    expect(insidePentagon(f, 0, 0)).toBe(true);
    expect(insidePentagon(f, 0, 0, 39)).toBe(true);
    expect(insidePentagon(f, 0, 0, 41)).toBe(false);
    const c = toLocal(f, f.corners[0]);
    expect(insidePentagon(f, c.x * 1.01, c.z * 1.01)).toBe(false);
    expect(insidePentagon(f, c.x * 0.98, c.z * 0.98)).toBe(true);
    // Clamping: inside points stay; outside points land on the outline (inside, within a hair of the boundary).
    expect(clampToPentagon(f, 3, -4)).toEqual({ x: 3, z: -4 });
    for (const [x, z] of [[c.x * 1.4, c.z * 1.4], [60, 0], [0, -70], [-50, 50], [45, 45]]) {
      const p = clampToPentagon(f, x, z);
      expect(insidePentagon(f, p.x, p.z, -1e-6)).toBe(true);
      expect(insidePentagon(f, p.x, p.z, 0.05)).toBe(false);
    }
  });
  it("builds a pentagon disc of equal triangles whose last ring is the face's own outline", () => {
    const f = FACES[7];
    const rings = 4;
    const disc = pentagonDisc(f, rings);
    expect(disc.positions.length / 3).toBe(1 + 5 * rings * (rings + 1) / 2);
    expect(disc.indices.length / 3).toBe(5 * rings * rings);
    const last = 1 + 5 * (rings - 1) * rings / 2;
    const c0 = toLocal(f, f.corners[0]);
    expect(disc.positions[last * 3]).toBeCloseTo(c0.x, 6);
    expect(disc.positions[last * 3 + 2]).toBeCloseTo(c0.z, 6);
    for (let k = 0; k < disc.positions.length / 3; k++) expect(insidePentagon(f, disc.positions[k * 3], disc.positions[k * 3 + 2], -1e-6)).toBe(true);
    for (const i of disc.indices) expect(i).toBeLessThan(disc.positions.length / 3);
    // Every triangle has the same area (no slivers at the centre) and they tile the pentagon exactly.
    const p = disc.positions;
    const areas: number[] = [];
    for (let t = 0; t < disc.indices.length; t += 3) {
      const [a, b, c] = [disc.indices[t], disc.indices[t + 1], disc.indices[t + 2]];
      areas.push(Math.abs((p[b * 3] - p[a * 3]) * (p[c * 3 + 2] - p[a * 3 + 2]) - (p[c * 3] - p[a * 3]) * (p[b * 3 + 2] - p[a * 3 + 2])) / 2);
    }
    for (const a of areas) expect(a).toBeCloseTo(areas[0], 6);
    const pentagonArea = 5 * EDGE * FACE_INRADIUS / 2;
    expect(areas.reduce((s, a) => s + a, 0)).toBeCloseTo(pentagonArea, 3);
  });
});

describe("miniatures", () => {
  it("samples the island's heights with landfill raised, and places coloured roofs from the real buildings", () => {
    const { state, grid } = newGame(1);
    const t = starterTown(state, grid);
    const h0 = miniatureHeights(grid.island.height, []);
    expect(h0.length).toBe((MINI_CELLS + 1) ** 2);
    // Row 0 is z = −32, column 0 is x = −32; the centre vertex samples the island centre.
    const mid = (MINI_CELLS / 2) * (MINI_CELLS + 1) + MINI_CELLS / 2;
    expect(h0[mid]).toBeCloseTo(grid.island.height(0, 0), 5);
    expect(h0[0]).toBeCloseTo(grid.island.height(-32, -32), 5);
    const hut = t.huts[0].cells[0];
    const h1 = miniatureHeights(grid.island.height, [cellIndex(hut.i, hut.j)]);
    const col = Math.round((hut.i + 32) / 2), row = Math.round((hut.j + 32) / 2);
    const k = row * (MINI_CELLS + 1) + col;
    const vx = -32 + col * 2, vz = -32 + row * 2;
    if (vx >= hut.i && vx <= hut.i + 1 && vz >= hut.j && vz <= hut.j + 1) expect(h1[k]).toBeCloseTo(LANDFILL_HEIGHT, 5);
    const roofs = roofPlacements(state);
    expect(roofs.length).toBe(t.huts.length + 1); // three huts and the market; the pier and walkways have no roof
    const market = roofs.find(r => r.w === 2 && r.d === 2)!;
    expect(market.shape).toBe("hipped");
    for (const r of roofs.filter(r => r.w === 1)) expect(["pyramid", "gable", "hipped"]).toContain(r.shape);
    expect(roofs.every(r => /^#[0-9a-f]{6}$/.test(r.colour))).toBe(true);
    expect(roofs.every(r => r.y > 0)).toBe(true);
    expect(island(7).trees.length).toBe(70);
  });
});
