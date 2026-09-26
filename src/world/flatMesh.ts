// Helpers for flat-shaded, vertex-coloured props: many primitives, one material, one draw call per merged mesh.
import { Color3, Mesh, Scene, StandardMaterial, VertexBuffer } from "@babylonjs/core";

const materials = new WeakMap<Scene, StandardMaterial>();

/** One white material shared by every merged prop; colour comes from vertex data. */
export function flatMaterial(scene: Scene): StandardMaterial {
  let m = materials.get(scene);
  if (!m) {
    m = new StandardMaterial("flat", scene);
    m.diffuseColor = Color3.White();
    m.specularColor = new Color3(0.03, 0.03, 0.03);
    materials.set(scene, m);
  }
  return m;
}

/** Paint every vertex of `mesh` one colour. */
export function tint(mesh: Mesh, hex: string): Mesh {
  const c = Color3.FromHexString(hex);
  const n = mesh.getTotalVertices();
  const colors = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { colors[i * 4] = c.r; colors[i * 4 + 1] = c.g; colors[i * 4 + 2] = c.b; colors[i * 4 + 3] = 1; }
  mesh.setVerticesData(VertexBuffer.ColorKind, colors);
  return mesh;
}

/** Merge tinted parts into one flat-shaded mesh. Parts are disposed. */
export function mergeFlat(name: string, parts: Mesh[], scene: Scene): Mesh {
  const merged = Mesh.MergeMeshes(parts, true, true, undefined, false, false)!;
  merged.name = name;
  merged.convertToFlatShadedMesh();
  merged.material = flatMaterial(scene);
  merged.isPickable = false;
  return merged;
}
