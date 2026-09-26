// TEMPORARY DECORATION LAYER — ported from the study's props section so the scene reads like the
// reference (stilt houses, walkways, lanterns, trees). Delete this file once build/grid.ts and
// build/pieces.ts exist; nothing else may depend on it.
import { Color3, MeshBuilder, Scene, StandardMaterial, TransformNode } from "@babylonjs/core";
import { terrainHeight as H } from "./world/terrain";

export function createTempDecoration(scene: Scene): void {
  function flatMat(name: string, hex: string, emissive?: string): StandardMaterial {
    const m = new StandardMaterial(name, scene);
    m.diffuseColor = Color3.FromHexString(hex);
    m.specularColor = new Color3(0.03, 0.03, 0.03);
    if (emissive) m.emissiveColor = Color3.FromHexString(emissive);
    return m;
  }
  const wallMats = ["#f2ece0", "#f4d9c6", "#d5e6ea", "#ece3c3", "#f7e7d3"].map((h, i) => flatMat("wall" + i, h));
  const roofMats = ["#c9674f", "#4c5a66", "#b9543f", "#5d6d7a"].map((h, i) => flatMat("roof" + i, h));
  const woodMat = flatMat("wood", "#5a4636");
  const plankMat = flatMat("plank", "#8a6f52");
  // Lanterns are unlit under fixed late-morning light (the study's lamp term is 0 at dusk = 0.15).
  const lanternMat = flatMat("lantern", "#3a2a1a");
  const trunkMat = flatMat("trunk", "#5b4634");
  const leafMats = ["#4a8a55", "#5a9a5c", "#3f7f4d"].map((h, i) => flatMat("leaf" + i, h));

  let seed = 7;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };

  const FLOOR = 1.0;
  const houses: { x: number; z: number; h: number }[] = [];
  for (let tries = 0; tries < 4000 && houses.length < 12; tries++) {
    const x = (rnd() - 0.5) * 44, z = (rnd() - 0.5) * 44;
    const h = H(x, z);
    if (h < 0.02 || h > 0.42) continue;
    if (houses.some(p => Math.hypot(p.x - x, p.z - z) < 4.2)) continue;
    houses.push({ x, z, h });
  }
  houses.forEach((p, i) => {
    const root = new TransformNode("house" + i, scene);
    root.position.set(p.x, 0, p.z);
    root.rotation.y = rnd() * Math.PI;
    const w = 1.5 + rnd() * 0.6, d = 1.5 + rnd() * 0.6, hh = 1.0 + rnd() * 0.3;
    const box = MeshBuilder.CreateBox("b" + i, { width: w, depth: d, height: hh }, scene);
    box.position.y = FLOOR + hh / 2; box.parent = root; box.material = wallMats[i % wallMats.length];
    const roof = MeshBuilder.CreateCylinder("r" + i, { diameterTop: 0, diameterBottom: Math.max(w, d) * 1.55, height: 0.75, tessellation: 4 }, scene);
    roof.rotation.y = Math.PI / 4; roof.position.y = FLOOR + hh + 0.375; roof.parent = root; roof.material = roofMats[i % roofMats.length];
    roof.convertToFlatShadedMesh();
    const deck = MeshBuilder.CreateBox("d" + i, { width: w + 1.0, depth: d + 1.0, height: 0.1 }, scene);
    deck.position.y = FLOOR - 0.05; deck.parent = root; deck.material = plankMat;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const lx = sx * (w / 2 + 0.3), lz = sz * (d / 2 + 0.3);
      // stilt bottom must sit in terrain: sample world height at the rotated position
      const c = Math.cos(root.rotation.y), s = Math.sin(root.rotation.y);
      const wx = p.x + lx * c + lz * s, wz = p.z - lx * s + lz * c;
      const gh = H(wx, wz) - 0.3;
      const st = MeshBuilder.CreateCylinder("s", { diameter: 0.16, height: FLOOR - gh, tessellation: 6 }, scene);
      st.position.set(lx, gh + (FLOOR - gh) / 2, lz); st.parent = root; st.material = woodMat;
    }
    const post = MeshBuilder.CreateCylinder("lp", { diameter: 0.07, height: 0.9, tessellation: 5 }, scene);
    post.position.set(w / 2 + 0.35, FLOOR + 0.45, d / 2 + 0.35); post.parent = root; post.material = woodMat;
    const lamp = MeshBuilder.CreateSphere("l", { diameter: 0.2, segments: 6 }, scene);
    lamp.position.set(w / 2 + 0.35, FLOOR + 0.95, d / 2 + 0.35); lamp.parent = root; lamp.material = lanternMat;
  });
  // walkways: connect each house to its nearest neighbor
  houses.forEach((a, i) => {
    let best: { x: number; z: number } | null = null, bd = 1e9;
    for (const [j, b] of houses.entries()) { if (i === j) continue; const dd = Math.hypot(a.x - b.x, a.z - b.z); if (dd < bd) { bd = dd; best = b; } }
    if (!best || bd > 12) return;
    const len = bd - 1.6;
    const plank = MeshBuilder.CreateBox("walk" + i, { width: 0.55, height: 0.07, depth: len }, scene);
    plank.position.set((a.x + best.x) / 2, FLOOR - 0.06, (a.z + best.z) / 2);
    plank.rotation.y = Math.atan2(best.x - a.x, best.z - a.z);
    plank.material = plankMat;
    for (let k = 0; k <= Math.floor(len / 2.5); k++) {
      const t = (k + 0.5) / (Math.floor(len / 2.5) + 1);
      const x = a.x + (best.x - a.x) * t, z = a.z + (best.z - a.z) * t, gh = H(x, z) - 0.3;
      const st = MeshBuilder.CreateCylinder("ws", { diameter: 0.12, height: FLOOR - gh, tessellation: 5 }, scene);
      st.position.set(x, gh + (FLOOR - gh) / 2, z); st.material = woodMat;
    }
  });
  // trees on the high ground
  let trees = 0;
  for (let tries = 0; tries < 3000 && trees < 70; tries++) {
    const x = (rnd() - 0.5) * 56, z = (rnd() - 0.5) * 56;
    const h = H(x, z);
    if (h < 1.3 || h > 5.2) continue;
    const slope = Math.abs(H(x + 0.6, z) - H(x - 0.6, z)) + Math.abs(H(x, z + 0.6) - H(x, z - 0.6));
    if (slope > 1.1) continue;
    const s = 0.8 + rnd() * 0.7;
    const trunk = MeshBuilder.CreateCylinder("t", { diameter: 0.22 * s, height: 0.9 * s, tessellation: 5 }, scene);
    trunk.position.set(x, h + 0.45 * s - 0.05, z); trunk.material = trunkMat;
    const cone = MeshBuilder.CreateCylinder("c", { diameterTop: 0, diameterBottom: 1.3 * s, height: 2.3 * s, tessellation: 6 }, scene);
    cone.position.set(x, h + 0.9 * s + 1.15 * s - 0.05, z); cone.material = leafMats[trees % 3];
    cone.rotation.y = rnd() * Math.PI; cone.convertToFlatShadedMesh();
    trees++;
  }
}
