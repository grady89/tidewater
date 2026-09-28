// Blender-built meshes (docs/assets, the pilot): public/assets/<name>[.<look>].glb, made by tools/assets from the
// looks' palettes. Loaded once per name and look; every part is lifted out of the glTF hierarchy into the game's
// axes (Blender x, y, z → Babylon x, z, y), its colours turned back from glTF's linear values into the sRGB bytes
// the flat material expects, its triangles wound the way Babylon's own builders wind them, and checked flat. The
// loader's PBR material is never used: parts are drawn with flatMaterial like every primitive kit. The kits ask
// for meshes shaped exactly like their primitive builders' (a boat's hull and sail, a palm's trunks and canopies,
// the whale and its spout, the turtle) so Boats, Trees and Wildlife thin-instance them unchanged.
//
// Behind USE_BLENDER_ASSETS (config.ts, off), or `?assets=blender` in the URL for measuring. With both off nothing
// here runs and the glTF loader is never fetched (it is imported on first use).
import { Matrix, Mesh, MeshBuilder, Scene, SceneLoader, StandardMaterial, TransformNode, Vector3, VertexBuffer, VertexData } from "@babylonjs/core";
import { USE_BLENDER_ASSETS } from "../config";
import type { BiomeId } from "../sim/biomes";
import { flatMaterial } from "../world/flatMesh";
import type { BoatKit } from "./biomes";

export type AssetName = "dory" | "outrigger" | "longboat" | "whale" | "turtle" | "palm";
export const ASSET_NAMES: readonly AssetName[] = ["dory", "outrigger", "longboat", "whale", "turtle", "palm"];
/** The look each asset belongs to (its file has no suffix); boats also exist for the other two looks. */
export const ASSET_HOME: Record<AssetName, BiomeId> = { dory: "tidewater", outrigger: "atoll", longboat: "fjord", whale: "fjord", turtle: "atoll", palm: "atoll" };

/**
 * Where each asset sits against its primitive kit's origin: a boat's primitive keel is 0.02 under its origin; the
 * primitive whale's back is centred on its origin (the Blender one stands on it), and the spout is placed by the
 * game on its own, so it is re-based to its own foot.
 */
const FIT: Partial<Record<AssetName, { y?: number; rebase?: string[] }>> = {
  dory: { y: -0.02 }, outrigger: { y: -0.02 }, longboat: { y: -0.02 },
  whale: { y: -0.22, rebase: ["spout"] },
};

let urlSwitch: boolean | null = null;
/** Whether the kits draw the Blender assets: the config flag, or `?assets=blender` (for measurement). */
export function useBlenderAssets(): boolean {
  if (urlSwitch === null) urlSwitch = typeof location !== "undefined" && new URLSearchParams(location.search).get("assets") === "blender";
  return USE_BLENDER_ASSETS || urlSwitch;
}

export function assetFile(name: AssetName, look: BiomeId): string {
  return look === ASSET_HOME[name] ? name : `${name}.${look}`;
}

interface PartData { positions: Float32Array; normals: Float32Array; colors: Float32Array; indices: Uint32Array }
export interface AssetTemplate {
  file: string;
  parts: Map<string, PartData>;
  bytes: number;
  loadMs: number;
  triangles: number;
  /** Whether the file's normals were already flat (one normal per triangle); converted when not. */
  flat: boolean;
}

const templates = new Map<string, AssetTemplate>();
const pending = new Map<string, Promise<AssetTemplate>>();

const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

/** Babylon's own winding: the sign of (b − a) × (c − a) · normal on a builder's triangle. */
let windingSign = 0;
function builderWinding(scene: Scene): number {
  if (windingSign) return windingSign;
  const box = MeshBuilder.CreateBox("windingProbe", { size: 1 }, scene);
  const p = box.getVerticesData(VertexBuffer.PositionKind)!, n = box.getVerticesData(VertexBuffer.NormalKind)!, idx = box.getIndices()!;
  const v = (i: number) => new Vector3(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
  const cross = Vector3.Cross(v(idx[1]).subtract(v(idx[0])), v(idx[2]).subtract(v(idx[0])));
  windingSign = Math.sign(Vector3.Dot(cross, new Vector3(n[idx[0] * 3], n[idx[0] * 3 + 1], n[idx[0] * 3 + 2]))) || 1;
  box.dispose();
  return windingSign;
}

/** Load (once) and return an asset's template. */
export function loadAsset(scene: Scene, name: AssetName, look: BiomeId = ASSET_HOME[name]): Promise<AssetTemplate> {
  const file = assetFile(name, look);
  const have = templates.get(file);
  if (have) return Promise.resolve(have);
  let p = pending.get(file);
  if (!p) {
    p = (async () => {
      await import("@babylonjs/loaders/glTF");
      const t0 = performance.now();
      const res = await fetch(`${import.meta.env.BASE_URL}assets/${file}.glb`);
      if (!res.ok) throw new Error(`asset ${file}: ${res.status}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      const container = await SceneLoader.LoadAssetContainerAsync("", buf, scene, undefined, ".glb");
      const sign = builderWinding(scene);
      // glTF → Babylon gives Blender (x, y, z) as (−x, z, −y); a half turn about y makes it (x, z, y).
      const fix = Matrix.RotationY(Math.PI);
      const parts = new Map<string, PartData>();
      let flat = true, triangles = 0;
      for (const m of container.meshes) {
        const pos = m.getVerticesData(VertexBuffer.PositionKind);
        const idx = m.getIndices();
        if (!pos || !idx) continue;
        const col = m.getVerticesData(VertexBuffer.ColorKind);
        const stride = col ? col.length / (pos.length / 3) : 0;
        const world = m.computeWorldMatrix(true).multiply(fix);
        const n = pos.length / 3;
        const positions = new Float32Array(n * 3), colors = new Float32Array(n * 4);
        const v = new Vector3();
        for (let i = 0; i < n; i++) {
          Vector3.TransformCoordinatesFromFloatsToRef(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], world, v);
          positions[i * 3] = v.x; positions[i * 3 + 1] = v.y; positions[i * 3 + 2] = v.z;
          for (let k = 0; k < 3; k++) colors[i * 4 + k] = col ? Math.round(toSrgb(col[i * stride + k]) * 255) / 255 : 1;
          colors[i * 4 + 3] = 1;
        }
        // The file's normals, carried into the game's axes, say which way each triangle faces; wind it Babylon's way.
        const nrm = m.getVerticesData(VertexBuffer.NormalKind);
        const indices = new Uint32Array(idx.length);
        const a = new Vector3(), b = new Vector3(), c = new Vector3(), fn = new Vector3();
        for (let t = 0; t < idx.length; t += 3) {
          const i0 = idx[t], i1 = idx[t + 1], i2 = idx[t + 2];
          a.set(positions[i0 * 3], positions[i0 * 3 + 1], positions[i0 * 3 + 2]);
          b.set(positions[i1 * 3], positions[i1 * 3 + 1], positions[i1 * 3 + 2]);
          c.set(positions[i2 * 3], positions[i2 * 3 + 1], positions[i2 * 3 + 2]);
          const cross = Vector3.Cross(b.subtract(a), c.subtract(a));
          if (nrm) {
            Vector3.TransformNormalFromFloatsToRef(nrm[i0 * 3], nrm[i0 * 3 + 1], nrm[i0 * 3 + 2], world, fn);
            for (const j of [i1, i2]) if (Math.abs(nrm[j * 3] - nrm[i0 * 3]) + Math.abs(nrm[j * 3 + 1] - nrm[i0 * 3 + 1]) + Math.abs(nrm[j * 3 + 2] - nrm[i0 * 3 + 2]) > 1e-3) flat = false;
          } else fn.copyFrom(cross);
          const swap = Math.sign(Vector3.Dot(cross, fn)) !== sign;
          indices[t] = i0; indices[t + 1] = swap ? i2 : i1; indices[t + 2] = swap ? i1 : i2;
        }
        const normals = new Float32Array(n * 3);
        VertexData.ComputeNormals(positions, indices, normals);
        const name = m.name.replace(/_primitive\d+$/, "");
        parts.set(name, { positions, normals, colors, indices });
        triangles += indices.length / 3;
      }
      container.dispose();
      const fit = FIT[name];
      if (fit) for (const [part, d] of parts) {
        let dx = 0, dy = fit.y ?? 0, dz = 0;
        if (fit.rebase?.includes(part)) {
          let minY = Infinity, sx = 0, sz = 0;
          const k = d.positions.length / 3;
          for (let i = 0; i < k; i++) { minY = Math.min(minY, d.positions[i * 3 + 1]); sx += d.positions[i * 3]; sz += d.positions[i * 3 + 2]; }
          dx = -sx / k; dy = -minY; dz = -sz / k;
        }
        for (let i = 0; i < d.positions.length; i += 3) { d.positions[i] += dx; d.positions[i + 1] += dy; d.positions[i + 2] += dz; }
      }
      const t: AssetTemplate = { file, parts, bytes: buf.byteLength, loadMs: performance.now() - t0, triangles, flat };
      templates.set(file, t);
      pending.delete(file);
      return t;
    })();
    pending.set(file, p);
  }
  return p;
}

/** A loaded template, or undefined while it loads (the kits fall back to their primitives). */
export function assetTemplate(name: AssetName, look: BiomeId = ASSET_HOME[name]): AssetTemplate | undefined {
  return templates.get(assetFile(name, look));
}

/** Every asset the three looks draw, loaded; resolves when all are in. */
export async function preloadAssets(scene: Scene): Promise<AssetTemplate[]> {
  return Promise.all([
    ...(["dory", "outrigger", "longboat"] as const).flatMap(n => (["tidewater", "fjord", "atoll"] as const).map(l => loadAsset(scene, n, l))),
    loadAsset(scene, "whale"), loadAsset(scene, "turtle"), loadAsset(scene, "palm"),
  ]);
}

/** One mesh from some of a template's parts, flat-shaded (converted if the file's normals were not flat). */
function meshOf(scene: Scene, t: AssetTemplate, name: string, keep: (part: string) => boolean): Mesh {
  const pos: number[] = [], nrm: number[] = [], col: number[] = [], idx: number[] = [];
  for (const [part, d] of t.parts) {
    if (!keep(part)) continue;
    const base = pos.length / 3;
    pos.push(...d.positions); nrm.push(...d.normals); col.push(...d.colors);
    for (const i of d.indices) idx.push(base + i);
  }
  const mesh = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = pos; vd.normals = nrm; vd.colors = col; vd.indices = idx;
  vd.applyToMesh(mesh);
  if (!t.flat) mesh.convertToFlatShadedMesh();
  mesh.material = flatMaterial(scene);
  mesh.isPickable = false;
  mesh.alwaysSelectAsActiveMesh = true;
  return mesh;
}

/** The boat kit's two meshes from the Blender asset: the hull (white, painted per boat) and the rest; null until loaded. */
export function boatAsset(scene: Scene, kit: BoatKit, look: BiomeId): { hull: Mesh; sail: Mesh } | null {
  const t = assetTemplate(kit, look) ?? assetTemplate(kit);
  if (!t) return null;
  const hull = meshOf(scene, t, "boatHulls", p => p === "hull");
  hull.material = flatMaterial(scene).clone("boatHullMat") as StandardMaterial;
  return { hull, sail: meshOf(scene, t, "boatSails", p => p !== "hull") };
}

/** The palm kit's two meshes: the trunk with its coconuts, and the fronds (painted per tree); null until loaded. */
export function palmAsset(scene: Scene): { trunks: Mesh; canopies: Mesh } | null {
  const t = assetTemplate("palm");
  if (!t) return null;
  const canopies = meshOf(scene, t, "treeCanopies", p => p.startsWith("frond"));
  canopies.material = flatMaterial(scene).clone("canopyMat") as StandardMaterial;
  return { trunks: meshOf(scene, t, "treeTrunks", p => !p.startsWith("frond")), canopies };
}

/** The whale's back and its spout, as Wildlife draws them; null until loaded. */
export function whaleAsset(scene: Scene): { whales: Mesh; spouts: Mesh } | null {
  const t = assetTemplate("whale");
  return t ? { whales: meshOf(scene, t, "whales", p => p !== "spout"), spouts: meshOf(scene, t, "spouts", p => p === "spout") } : null;
}

/** The turtle as one mesh (shell, head, four flippers), as Wildlife draws it; null until loaded. */
export function turtleAsset(scene: Scene): Mesh | null {
  const t = assetTemplate("turtle");
  return t ? meshOf(scene, t, "turtles", () => true) : null;
}

/** The asset with its hierarchy: a root node with one child mesh per named part (hull, sail, spout, flipper_fl, frond_3…). */
export function assetHierarchy(scene: Scene, t: AssetTemplate, name: string): TransformNode {
  const root = new TransformNode(name, scene);
  for (const part of t.parts.keys()) meshOf(scene, t, part, p => p === part).parent = root;
  return root;
}

/** Load statistics, for the probes and the pilot's report. */
export function assetStats(): { file: string; bytes: number; loadMs: number; triangles: number; flat: boolean; parts: string[] }[] {
  return [...templates.values()].map(t => ({ file: t.file, bytes: t.bytes, loadMs: t.loadMs, triangles: t.triangles, flat: t.flat, parts: [...t.parts.keys()] }));
}
