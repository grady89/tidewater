// Field overlays: one mesh of 64×64 flat quads draped over the island (just above the water where it is wet),
// coloured per cell from a ledger field; the colour reaches full strength at the level where the field does harm,
// and a legend line says what it shows and the worst value now. Only buffers change, and only while one is shown. The sewer overlay is the one that isn't a
// field: it lays a tile on every cell the sewer runs through (sim/sewers.ts), on top of the street's deck, blue where
// the network has a way out and red where it backs up; draws the pipes, which are seen nowhere else; and stands an
// amber marker over every home whose waste goes into a cesspit. View only.
import { Color3, Color4, Matrix, Mesh, MeshBuilder, Quaternion, Scene, StandardMaterial, Vector3, VertexBuffer, VertexData } from "@babylonjs/core";
import { SIZE } from "../config";
import { BUILDINGS, FIRE_IGNITE_THRESHOLD, OYSTER_POLLUTION_KILL } from "../sim/balance";
import { CELLS } from "../sim/fields";
import { cellIndex, DIRS, Grid, HALF, inBounds } from "../sim/grid";
import { backedUpShares, sewerMap, SewerNet } from "../sim/sewers";
import { SimState } from "../sim/state";

export type OverlayKind = "pollution" | "fish" | "shark" | "fire" | "sewer";

export const OVERLAYS: { kind: OverlayKind; label: string }[] = [
  { kind: "pollution", label: "Pollution" },
  { kind: "fish", label: "Fish" },
  { kind: "shark", label: "Sharks" },
  { kind: "fire", label: "Fire" },
  { kind: "sewer", label: "Sewers" },
];

/** Colour ramps: [r, g, b] at full strength, reached at `full` (where the field does harm); alpha follows the square
 *  root of value / full, so a faint plume still shows. */
const RAMPS: Record<Exclude<OverlayKind, "sewer">, { color: [number, number, number]; full: number; deepOnly: boolean }> = {
  pollution: { color: [0.55, 0.22, 0.45], full: OYSTER_POLLUTION_KILL, deepOnly: false },
  fish: { color: [0.25, 0.85, 0.75], full: 1, deepOnly: true },
  shark: { color: [0.85, 0.3, 0.2], full: 0.3, deepOnly: false },
  fire: { color: [1.0, 0.55, 0.15], full: FIRE_IGNITE_THRESHOLD, deepOnly: false },
};
/** Below this share of `full` a cell stays clear. */
const RAMP_FLOOR = 0.01;
/** How far above the water a tile over it floats (clear of the swell's crests), and above the ground on land. */
const OVER_WATER = 0.13, OVER_GROUND = 0.08;

export class Overlays {
  private readonly mesh: Mesh;
  private readonly colors = new Float32Array(CELLS * 4 * 4);
  kind: OverlayKind | null = null;
  private frame = 0;
  /** Where the building in hand can go (Placement.placeable), tinted while no other overlay is up. */
  private placeable: Uint8Array | null = null;
  private placeableShown: Uint8Array | null = null;
  /** The sewer overlay: tiles, pipe segments (half-segments from a pipe cell's centre toward its sewered neighbours)
   *  and cesspit markers, as thin instances; rebuilt when what they show changes. */
  private readonly sewer: Record<"okTiles" | "badTiles" | "okPipes" | "badPipes" | "pits", Mesh>;
  private sewerKey = "";
  private readonly positions = new Float32Array(CELLS * 4 * 3);
  /** The terrain and water level the tiles were last laid at. */
  private drapedTerrain = -1;
  private drapedLevel = NaN;
  /** What the overlay shows and the worst of it now, for the legend under the buttons ("" when none is up). */
  legend = "";

  constructor(scene: Scene, private readonly grid: Grid) {
    const part = (name: string, hex: string, alpha: number, shape: "box" | "pin") => {
      const m = shape === "box" ? MeshBuilder.CreateBox(name, { size: 1 }, scene) : MeshBuilder.CreateCylinder(name, { diameterTop: 0.34, diameterBottom: 0, height: 0.45, tessellation: 4 }, scene);
      const mat = new StandardMaterial(name + "Mat", scene);
      mat.disableLighting = true;
      mat.emissiveColor = Color3.FromHexString(hex);
      mat.alpha = alpha;
      m.material = mat; m.isPickable = false; m.alphaIndex = 21; m.setEnabled(false);
      return m;
    };
    this.sewer = {
      okTiles: part("sewerTilesOk", "#3fb3eb", 0.5, "box"), badTiles: part("sewerTilesBad", "#f2543f", 0.55, "box"),
      okPipes: part("sewerPipesOk", "#1f5f7f", 1, "box"), badPipes: part("sewerPipesBad", "#8f2f25", 1, "box"),
      pits: part("sewerPits", "#f29a26", 1, "pin"),
    };
    const positions = this.positions;
    const indices = new Uint32Array(CELLS * 6);
    for (let i = -HALF; i < HALF; i++) for (let j = -HALF; j < HALF; j++) {
      const k = cellIndex(i, j);
      const corners = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
      corners.forEach(([x, z], c) => { const o = (k * 4 + c) * 3; positions[o] = x + (c === 0 || c === 3 ? 0.03 : -0.03); positions[o + 2] = z + (c < 2 ? 0.03 : -0.03); });
      const b = k * 4, o = k * 6;
      indices[o] = b; indices[o + 1] = b + 2; indices[o + 2] = b + 1;
      indices[o + 3] = b; indices[o + 4] = b + 3; indices[o + 5] = b + 2;
    }
    this.mesh = new Mesh("overlay", scene);
    const vd = new VertexData();
    vd.positions = positions;
    vd.indices = indices;
    vd.colors = this.colors;
    vd.applyToMesh(this.mesh, true);
    const mat = new StandardMaterial("overlayMat", scene);
    mat.disableLighting = true;
    mat.emissiveColor.set(1, 1, 1);
    mat.alpha = 0.999;
    mat.backFaceCulling = false;
    this.mesh.material = mat;
    this.mesh.hasVertexAlpha = true;
    this.mesh.isPickable = false;
    this.mesh.alphaIndex = 20;
    this.mesh.setEnabled(false);
  }

  /** Lay the tiles on this island's ground, or just above the water where the tide covers it; again when either moves. */
  private drape(level: number): void {
    if (this.drapedTerrain === this.grid.terrainVersion && Math.abs(level - this.drapedLevel) < 0.02) return;
    this.drapedTerrain = this.grid.terrainVersion; this.drapedLevel = level;
    for (let k = 0; k < CELLS; k++) {
      const y = Math.max(this.grid.heights[k] + OVER_GROUND, level + OVER_WATER);
      for (let c = 0; c < 4; c++) this.positions[(k * 4 + c) * 3 + 1] = y;
    }
    this.mesh.updateVerticesData(VertexBuffer.PositionKind, this.positions);
    this.mesh.refreshBoundingInfo();
  }

  /** Tint where the building in hand can go: green where a street reaches the spot, pale gold where it can go but nothing would reach it. */
  showPlaceable(mask: Uint8Array | null): void {
    this.placeable = mask;
    if (this.kind === null) this.mesh.setEnabled(mask !== null);
  }

  private syncPlaceable(): void {
    if (!this.placeable || this.placeable === this.placeableShown) return;
    this.placeableShown = this.placeable;
    for (let k = 0; k < CELLS; k++) {
      const v = this.placeable[k];
      const c = v === 2 ? [0.35, 0.85, 0.45, 0.42] : v === 1 ? [1.0, 0.78, 0.3, 0.3] : [0, 0, 0, 0];
      for (let q = 0; q < 4; q++) { const o = (k * 4 + q) * 4; this.colors[o] = c[0]; this.colors[o + 1] = c[1]; this.colors[o + 2] = c[2]; this.colors[o + 3] = c[3]; }
    }
    this.mesh.updateVerticesData(VertexBuffer.ColorKind, this.colors);
  }

  show(kind: OverlayKind | null): void {
    this.kind = kind;
    this.placeableShown = null;
    this.mesh.setEnabled((kind !== null && kind !== "sewer") || (kind === null && this.placeable !== null));
    if (kind !== "sewer") for (const m of Object.values(this.sewer)) m.setEnabled(false);
    this.sewerKey = "";
    this.frame = 0;
  }

  /** The overlay's height over a cell (as last draped: just above the ground, or the water). */
  private yAt(k: number): number {
    return this.positions[k * 12 + 1];
  }

  /** The height a sewer tile sits at in a cell: on the street's deck, or just over the ground or the water. */
  private sewerY(k: number, i: number, j: number): number {
    const b = this.grid.buildingAtIJ(i, j);
    return (b && BUILDINGS[b.kind].network !== "leaf" ? b.floorY : this.yAt(k)) + 0.03;
  }

  private syncSewers(state: SimState): void {
    const map = sewerMap(this.grid);
    const backed = backedUpShares(state, this.grid);
    const wayOut = (n: SewerNet) => n.outfalls.some(o => !o.damaged) || n.plants.some(p => !p.damaged);
    const pits = Object.values(state.buildings).filter(b => b.residents > 0 && (backed.get(b.id) ?? 0) > 0).sort((a, b) => a.id - b.id);
    const key = `${this.grid.layoutVersion}|${map.nets.map(n => (wayOut(n) ? 1 : 0)).join("")}|${pits.map(b => b.id).join(",")}`;
    if (key === this.sewerKey) return;
    this.sewerKey = key;
    const buf: Record<keyof typeof this.sewer, number[]> = { okTiles: [], badTiles: [], okPipes: [], badPipes: [], pits: [] };
    const put = (into: number[], sx: number, sy: number, sz: number, x: number, y: number, z: number) =>
      Matrix.Compose(new Vector3(sx, sy, sz), Quaternion.Identity(), new Vector3(x, y, z)).copyToArray(into, into.length);
    for (const n of map.nets) {
      const ok = wayOut(n);
      for (const k of n.cells) {
        const i = Math.floor(k / SIZE) - HALF, j = (k % SIZE) - HALF;
        const y = this.sewerY(k, i, j);
        put(ok ? buf.okTiles : buf.badTiles, 0.92, 0.02, 0.92, i + 0.5, y, j + 0.5);
        if (this.grid.pipes[k] !== 1) continue;
        const pipes = ok ? buf.okPipes : buf.badPipes;
        put(pipes, 0.2, 0.08, 0.2, i + 0.5, y + 0.03, j + 0.5);
        for (const d of DIRS) {
          const ni = i + d.i, nj = j + d.j;
          if (!inBounds(ni, nj) || map.net[cellIndex(ni, nj)] < 0) continue;
          put(pipes, d.i ? 0.5 : 0.12, 0.06, d.j ? 0.5 : 0.12, i + 0.5 + d.i * 0.25, y + 0.03, j + 0.5 + d.j * 0.25);
        }
      }
    }
    // A marker over each home with a cesspit, above its roof.
    for (const b of pits) {
      const is = b.cells.map(c => c.i), js = b.cells.map(c => c.j);
      put(buf.pits, 1, 1, 1, (Math.min(...is) + Math.max(...is) + 1) / 2, b.floorY + 1.9, (Math.min(...js) + Math.max(...js) + 1) / 2);
    }
    for (const [name, m] of Object.entries(buf) as [keyof typeof this.sewer, number[]][]) {
      const mesh = this.sewer[name];
      if (!m.length) { mesh.setEnabled(false); continue; }
      mesh.thinInstanceSetBuffer("matrix", new Float32Array(m), 16, false);
      mesh.setEnabled(true);
    }
  }

  sync(state: SimState): void {
    if (!this.kind) { this.legend = ""; if (this.placeable) { this.drape(state.tide.level); this.syncPlaceable(); } return; }
    if (this.frame++ % 6 !== 0) return;
    this.drape(state.tide.level);
    if (this.kind === "sewer") { this.legend = "Blue: the sewer drains to an outfall or a treatment plant. Red: it has no way out and backs up. Amber pins: homes on a cesspit."; this.syncSewers(state); return; }
    const ramp = RAMPS[this.kind];
    const field = state.fields[this.kind];
    const c = new Color4(0, 0, 0, 0);
    let worst = 0, least = Infinity;
    for (let k = 0; k < CELLS; k++) {
      let a = 0;
      if (!ramp.deepOnly || this.grid.deep[k]) {
        const v = field[k];
        worst = Math.max(worst, v); least = Math.min(least, v);
        a = v < ramp.full * RAMP_FLOOR ? 0 : Math.min(1, Math.sqrt(v / ramp.full));
      }
      c.set(ramp.color[0], ramp.color[1], ramp.color[2], a * 0.65);
      for (let v = 0; v < 4; v++) { const o = (k * 4 + v) * 4; this.colors[o] = c.r; this.colors[o + 1] = c.g; this.colors[o + 2] = c.b; this.colors[o + 3] = c.a; }
    }
    this.mesh.updateVerticesData(VertexBuffer.ColorKind, this.colors);
    this.legend = legendFor(this.kind, worst, least);
  }
}

/** The legend line: what the colour means, and the worst of it on the map now. */
function legendFor(kind: Exclude<OverlayKind, "sewer">, worst: number, least: number): string {
  const faint = worst < RAMPS[kind].full * RAMP_FLOOR;
  switch (kind) {
    case "pollution": return faint ? "No pollution in the water yet. Waste from homes without a sewer, the outfalls and some workshops fouls it."
      : `Waste in the water, full colour where oysters and coral die (${OYSTER_POLLUTION_KILL}). Worst now: ${worst.toFixed(2)}.`;
    case "fish": return `Fish in the sea: boats go to the richest water in reach and thin it. Richest now ${Math.round(worst * 100)}%, thinnest ${Math.round((Number.isFinite(least) ? least : 0) * 100)}%.`;
    case "shark": return faint ? "Nothing draws sharks yet. Fish waste from markets and docks does; swimmers near it are at risk."
      : `Sharks drawn by fish waste from markets and docks; swimmers on a beach in the red are at risk. Worst now: ${worst.toFixed(2)}.`;
    case "fire": return faint ? "No fire risk anywhere. Smokehouses, taverns and lanterns raise it; a fire watch damps it."
      : `Fire risk from smokehouses, taverns and lanterns; at full colour a fire can start. Worst now: ${worst.toFixed(2)}.`;
  }
}

export { SIZE };
