// Draws the ledger's buildings. Static geometry is merged per 8×8-cell chunk: one mesh, one draw call per chunk,
// rebuilt whenever any building in the chunk appears, leaves, or changes its mesh signature (level, lantern,
// damage). Lanterns are two thin-instanced spheres (lit, dark) refreshed when the lit set changes. Called every
// frame; read-only over the sim.
import { Color3, Matrix, Mesh, MeshBuilder, Scene } from "@babylonjs/core";
import { biomeFor } from "../sim/biomes";
import { Grid } from "../sim/grid";
import { Building, SimState } from "../sim/state";
import { mergeFlat } from "../world/flatMesh";
import { createBuildingMeshes, lanternMaterials, lanternOn, meshSignature, PALETTE } from "./buildings";

const LANTERN = Color3.FromHexString(PALETTE.lantern);
const CHUNK = 8;

interface Chunk {
  sig: string;
  mesh: Mesh | null;
  /** Lantern positions of the buildings in this chunk, by building id. */
  lanterns: Map<number, { x: number; y: number; z: number }>;
}

function chunkKey(b: Building): string {
  const c = b.cells[0];
  return `${Math.floor(c.i / CHUNK)},${Math.floor(c.j / CHUNK)}`;
}

export class BuildingViews {
  private readonly chunks = new Map<string, Chunk>();
  private readonly lit: Mesh;
  private readonly dark: Mesh;
  private lanternSig = "";

  constructor(private readonly scene: Scene, private readonly grid: Grid) {
    const mats = lanternMaterials(scene);
    this.lit = MeshBuilder.CreateSphere("lantern", { diameter: 0.14, segments: 5 }, scene);
    this.lit.material = mats.lit;
    this.dark = MeshBuilder.CreateSphere("lantern", { diameter: 0.14, segments: 5 }, scene);
    this.dark.material = mats.dark;
    for (const m of [this.lit, this.dark]) { m.isPickable = false; m.alwaysSelectAsActiveMesh = true; m.setEnabled(false); }
  }

  /** How many chunk meshes are live (a smoke probe). */
  get chunkCount(): number {
    let n = 0;
    for (const c of this.chunks.values()) if (c.mesh) n++;
    return n;
  }

  /** `lamp` is the lantern brightness from the time of day (0 by day). */
  sync(state: SimState, lamp = 0): void {
    // Group by chunk and fingerprint each group.
    const groups = new Map<string, { sig: string[]; buildings: Building[] }>();
    for (const b of Object.values(state.buildings)) {
      const key = chunkKey(b);
      let g = groups.get(key);
      if (!g) { g = { sig: [], buildings: [] }; groups.set(key, g); }
      g.sig.push(`${b.id}=${meshSignature(b, this.grid)}`);
      g.buildings.push(b);
    }
    for (const [key, c] of this.chunks) {
      if (groups.has(key)) continue;
      c.mesh?.dispose();
      this.chunks.delete(key);
    }
    for (const [key, g] of groups) {
      const sig = g.sig.join("|");
      const c = this.chunks.get(key);
      if (c && c.sig === sig) continue;
      c?.mesh?.dispose();
      this.chunks.set(key, { sig, ...this.buildChunk(key, g.buildings) });
    }

    // Lanterns: split the set into lit and dark, rebuild the instance buffers when it changes.
    lanternMaterials(this.scene).lit.emissiveColor = LANTERN.scale(0.25 + Math.min(1, lamp) * 0.9);
    const litM: number[] = [], darkM: number[] = [];
    const parts: string[] = [];
    for (const c of this.chunks.values()) {
      for (const [id, p] of c.lanterns) {
        const b = state.buildings[id];
        if (!b) continue;
        const on = lanternOn(b) && !(biomeFor(state).lanternDimmed?.(state, this.grid, b) ?? false);
        parts.push(`${id}${on ? "+" : "-"}`);
        Matrix.Translation(p.x, p.y, p.z).copyToArray(on ? litM : darkM, (on ? litM : darkM).length);
      }
    }
    const lsig = parts.join(",");
    if (lsig !== this.lanternSig) {
      this.lanternSig = lsig;
      this.setInstances(this.lit, litM);
      this.setInstances(this.dark, darkM);
    }
  }

  private setInstances(mesh: Mesh, m: number[]): void {
    if (m.length === 0) { mesh.setEnabled(false); return; }
    mesh.thinInstanceSetBuffer("matrix", new Float32Array(m), 16, false);
    mesh.setEnabled(true);
  }

  private buildChunk(key: string, buildings: Building[]): { mesh: Mesh | null; lanterns: Chunk["lanterns"] } {
    const lanterns: Chunk["lanterns"] = new Map();
    const roots: Mesh[] = [];
    for (const b of buildings) {
      const m = createBuildingMeshes(this.scene, b, this.grid);
      roots.push(m.root);
      if (m.lantern) {
        const p = m.lantern.position;
        lanterns.set(b.id, { x: p.x, y: p.y, z: p.z });
        m.lantern.dispose();
      }
    }
    const mesh = roots.length ? mergeFlat(`chunk:${key}`, roots, this.scene) : null;
    return { mesh, lanterns };
  }

  clear(): void {
    for (const c of this.chunks.values()) c.mesh?.dispose();
    this.chunks.clear();
    this.lanternSig = "";
    this.lit.setEnabled(false);
    this.dark.setEnabled(false);
  }
}
