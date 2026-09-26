// Trees on the high ground. Deterministic from a fixed seed; merged into one mesh.
import { Mesh, MeshBuilder, Scene } from "@babylonjs/core";
import { mergeFlat, tint } from "./flatMesh";
import { terrainHeight as H } from "./terrain";

const TRUNK = "#5b4634";
const LEAVES = ["#4a8a55", "#5a9a5c", "#3f7f4d"];

export function createTrees(scene: Scene): Mesh {
  let seed = 7;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };

  const parts: Mesh[] = [];
  let trees = 0;
  for (let tries = 0; tries < 3000 && trees < 70; tries++) {
    const x = (rnd() - 0.5) * 56, z = (rnd() - 0.5) * 56;
    const h = H(x, z);
    if (h < 1.3 || h > 5.2) continue;
    const slope = Math.abs(H(x + 0.6, z) - H(x - 0.6, z)) + Math.abs(H(x, z + 0.6) - H(x, z - 0.6));
    if (slope > 1.1) continue;
    const s = 0.8 + rnd() * 0.7;
    const trunk = MeshBuilder.CreateCylinder("t", { diameter: 0.22 * s, height: 0.9 * s, tessellation: 5 }, scene);
    trunk.position.set(x, h + 0.45 * s - 0.05, z);
    parts.push(tint(trunk, TRUNK));
    const cone = MeshBuilder.CreateCylinder("c", { diameterTop: 0, diameterBottom: 1.3 * s, height: 2.3 * s, tessellation: 6 }, scene);
    cone.position.set(x, h + 0.9 * s + 1.15 * s - 0.05, z);
    cone.rotation.y = rnd() * Math.PI;
    parts.push(tint(cone, LEAVES[trees % 3]));
    trees++;
  }
  return mergeFlat("trees", parts, scene);
}
