// The pier suggestion: a pulsing ring on the deep cell the first pier should go on, shown until the town has one.
// Recomputed when the building set changes. View only.
import { Color3, Matrix, Mesh, MeshBuilder, Quaternion, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import { BUILDINGS } from "../sim/balance";
import { Grid } from "../sim/grid";
import { suggestPier } from "../sim/start";
import { Building, Cell, SimState } from "../sim/state";
import { PALETTE } from "./buildings";

export class PierMarker {
  private readonly ring: Mesh;
  private key = "";
  cell: Cell | null = null;

  constructor(scene: Scene, private readonly grid: Grid) {
    this.ring = MeshBuilder.CreateTorus("pierMarker", { diameter: 1.3, thickness: 0.12, tessellation: 24 }, scene);
    const mat = new StandardMaterial("pierMarkerMat", scene);
    mat.diffuseColor = Color3.FromHexString(PALETTE.lantern);
    mat.emissiveColor = Color3.FromHexString(PALETTE.lantern).scale(0.8);
    mat.specularColor = Color3.Black();
    this.ring.material = mat;
    this.ring.isPickable = false;
    this.ring.setEnabled(false);
  }

  sync(state: SimState, viewTime: number): void {
    const ids = Object.keys(state.buildings);
    const key = ids.length + ":" + ids[ids.length - 1];
    if (key !== this.key) {
      this.key = key;
      const hasPier = Object.values(state.buildings).some(b => b.kind === "pier" || b.kind === "dock" || b.kind === "harbor");
      this.cell = hasPier ? null : suggestPier(this.grid);
    }
    if (!this.cell) { this.ring.setEnabled(false); return; }
    const pulse = 1 + 0.12 * Math.sin(viewTime * 3);
    this.ring.position.set(this.cell.i + 0.5, state.tide.level + 0.15, this.cell.j + 0.5);
    this.ring.scaling.set(pulse, 1, pulse);
    this.ring.setEnabled(true);
  }
}

/**
 * A red diamond over every building the street doesn't reach: a home that will never fill, a workplace nobody can
 * walk to, a market that sells nothing. Streets themselves, piers and the pieces that need no street go unmarked.
 * The same idea as Cities: Skylines' "no road access" sign, so a gap in the street is seen, not read about. View only.
 */
export class StreetMarkers {
  private readonly mesh: Mesh;
  /** How many markers are up (a probe). */
  count = 0;

  constructor(scene: Scene) {
    const top = MeshBuilder.CreateCylinder("noStreetTop", { diameterTop: 0, diameterBottom: 0.32, height: 0.24, tessellation: 4 }, scene);
    top.position.y = 0.12;
    const bottom = MeshBuilder.CreateCylinder("noStreetBottom", { diameterTop: 0.32, diameterBottom: 0, height: 0.3, tessellation: 4 }, scene);
    bottom.position.y = -0.15;
    this.mesh = Mesh.MergeMeshes([top, bottom], true)!;
    this.mesh.name = "noStreetMarkers";
    const mat = new StandardMaterial("noStreetMat", scene);
    mat.diffuseColor = Color3.FromHexString(PALETTE.roofs[0]);
    mat.emissiveColor = Color3.FromHexString(PALETTE.roofs[0]).scale(0.7);
    mat.specularColor = Color3.Black();
    this.mesh.material = mat;
    this.mesh.isPickable = false;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.setEnabled(false);
  }

  sync(state: SimState, viewTime: number): void {
    const m: number[] = [];
    for (const b of Object.values(state.buildings)) {
      if (!needsStreet(b) || b.reached) continue;
      const is = b.cells.map(c => c.i), js = b.cells.map(c => c.j);
      const x = (Math.min(...is) + Math.max(...is) + 1) / 2, z = (Math.min(...js) + Math.max(...js) + 1) / 2;
      const y = b.floorY + 1.75 + 0.08 * Math.sin(viewTime * 2.2 + b.id);
      Matrix.Compose(Vector3.One(), Quaternion.FromEulerAngles(0, viewTime * 1.2 + b.id, 0), new Vector3(x, y, z)).copyToArray(m, m.length);
    }
    this.count = m.length / 16;
    if (!m.length) { this.mesh.setEnabled(false); return; }
    this.mesh.thinInstanceSetBuffer("matrix", new Float32Array(m), 16, false);
    this.mesh.setEnabled(true);
  }
}

/**
 * Small pins over a set of buildings, bobbing over the roofs: the damaged ones (amber, always up), or what the
 * selected building is tied to (the homes a well serves, where a home's people work, whose people work here).
 */
export class Pins {
  private readonly mesh: Mesh;
  /** How many pins are up (a probe). */
  count = 0;

  constructor(scene: Scene, name: string, hex: string, private readonly lift: number) {
    const m = MeshBuilder.CreateCylinder(name, { diameterTop: 0.26, diameterBottom: 0, height: 0.34, tessellation: 4 }, scene);
    const mat = new StandardMaterial(name + "Mat", scene);
    mat.diffuseColor = Color3.FromHexString(hex);
    mat.emissiveColor = Color3.FromHexString(hex).scale(0.75);
    mat.specularColor = Color3.Black();
    m.material = mat;
    m.isPickable = false;
    m.alwaysSelectAsActiveMesh = true;
    m.setEnabled(false);
    this.mesh = m;
  }

  show(bs: Building[], viewTime: number): void {
    const m: number[] = [];
    for (const b of bs) {
      const is = b.cells.map(c => c.i), js = b.cells.map(c => c.j);
      const x = (Math.min(...is) + Math.max(...is) + 1) / 2, z = (Math.min(...js) + Math.max(...js) + 1) / 2;
      const y = b.floorY + this.lift + 0.06 * Math.sin(viewTime * 2.6 + b.id);
      Matrix.Compose(Vector3.One(), Quaternion.FromEulerAngles(0, viewTime * 0.8 + b.id, 0), new Vector3(x, y, z)).copyToArray(m, m.length);
    }
    this.count = m.length / 16;
    if (!m.length) { this.mesh.setEnabled(false); return; }
    this.mesh.thinInstanceSetBuffer("matrix", new Float32Array(m), 16, false);
    this.mesh.setEnabled(true);
  }
}

/** Does this building need the street to do anything? Everything but streets, piers and the pieces that need none. */
export function needsStreet(b: Building): boolean {
  const def = BUILDINGS[b.kind];
  return def.network !== "root" && !def.offStreet && def.category !== "Streets";
}
