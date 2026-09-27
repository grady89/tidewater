// The heightfield mesh and the baked heightmap texture the water shader reads. Heights come from the sim's
// analytic heightfield so the view and the ledger always agree.
import { Mesh, MeshBuilder, RawTexture, Scene, ShaderMaterial, Texture, Vector3, VertexBuffer } from "@babylonjs/core";
import { SIZE } from "../config";
import { HeightFn, terrainHeight } from "../sim/heightfield";
import { Cell } from "../sim/state";
import { terrainFS, terrainVS } from "../../shaders/terrain";
import { Lighting, MORNING } from "./lighting";

// ---------- heightmap texture ----------
// 16-bit height split across r,g. Encodes (H + 5) / 12; the water shader decodes with the same constants.
const HEIGHT_TEX_SIZE = 256;

function encodeHeight(hdata: Uint8Array, row: number, col: number, h: number): void {
  const v = Math.min(1, Math.max(0, (h + 5) / 12));
  const q = Math.round(v * 65535);
  const i = (row * HEIGHT_TEX_SIZE + col) * 4;
  hdata[i] = q >> 8; hdata[i + 1] = q & 255; hdata[i + 2] = 0; hdata[i + 3] = 255;
}

function bakeHeightData(hdata: Uint8Array, sample: HeightFn): void {
  const TW = HEIGHT_TEX_SIZE;
  for (let row = 0; row < TW; row++) for (let col = 0; col < TW; col++) {
    const x = (col / (TW - 1) - 0.5) * SIZE, z = (row / (TW - 1) - 0.5) * SIZE;
    encodeHeight(hdata, row, col, sample(x, z));
  }
}

function bakeHeightTexture(scene: Scene, hdata: Uint8Array, sample: HeightFn): RawTexture {
  bakeHeightData(hdata, sample);
  const tex = RawTexture.CreateRGBATexture(hdata, HEIGHT_TEX_SIZE, HEIGHT_TEX_SIZE, scene, false, false, Texture.BILINEAR_SAMPLINGMODE);
  tex.wrapU = tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  return tex;
}

// ---------- mesh ----------
export interface Terrain {
  mesh: Mesh;
  material: ShaderMaterial;
  heightTex: RawTexture;
  setLighting(l: Lighting): void;
  update(camPos: Vector3, waterLevel: number, wetLevel: number): void;
  /** Height of the rendered ground at (x, z): the mesh's own triangles, landfill included. */
  heightAt(x: number, z: number): number;
  /** Raise the ground under these cells to `height` (landfill): mesh and heightmap. */
  raise(cells: Cell[], height: number): void;
  /** Back to the heightfield (a new town), optionally another island's. */
  reset(height?: HeightFn): void;
}

const SUBDIVISIONS = 170;

export function createTerrain(scene: Scene, height: HeightFn = terrainHeight): Terrain {
  let sample = height;
  const hdata = new Uint8Array(HEIGHT_TEX_SIZE * HEIGHT_TEX_SIZE * 4);
  const heightTex = bakeHeightTexture(scene, hdata, sample);

  // The un-flattened grid of heights is kept for sampling and for landfill; the drawn mesh is flat-shaded
  // (its vertices are unshared) and rebuilt from the grid whenever the ground changes.
  const N = SUBDIVISIONS;
  const gridH = new Float32Array((N + 1) * (N + 1));
  const vx = (col: number) => (col * SIZE) / N - SIZE / 2;
  const vz = (row: number) => ((N - row) * SIZE) / N - SIZE / 2;
  for (let row = 0; row <= N; row++) for (let col = 0; col <= N; col++) gridH[row * (N + 1) + col] = sample(vx(col), vz(row));

  const mesh = MeshBuilder.CreateGround("ground", { width: SIZE, height: SIZE, subdivisions: N }, scene);
  const applyGrid = () => {
    const base = MeshBuilder.CreateGround("groundBase", { width: SIZE, height: SIZE, subdivisions: N }, scene);
    const pos = base.getVerticesData(VertexBuffer.PositionKind)!;
    for (let row = 0; row <= N; row++) for (let col = 0; col <= N; col++) pos[(row * (N + 1) + col) * 3 + 1] = gridH[row * (N + 1) + col];
    base.updateVerticesData(VertexBuffer.PositionKind, pos);
    base.convertToFlatShadedMesh();
    mesh.setVerticesData(VertexBuffer.PositionKind, base.getVerticesData(VertexBuffer.PositionKind)!);
    mesh.setVerticesData(VertexBuffer.NormalKind, base.getVerticesData(VertexBuffer.NormalKind)!);
    mesh.setIndices(base.getIndices()!);
    base.dispose();
  };
  applyGrid();

  /** Bilinear-on-triangles height from the grid, matching how the mesh is triangulated (diagonal from the
   *  low-x/high-z corner to the high-x/low-z corner). */
  const heightAt = (x: number, z: number): number => {
    const fc = ((x + SIZE / 2) * N) / SIZE, fr = ((SIZE / 2 - z) * N) / SIZE;
    const col = Math.min(N - 1, Math.max(0, Math.floor(fc))), row = Math.min(N - 1, Math.max(0, Math.floor(fr)));
    const u = Math.min(1, Math.max(0, fc - col)), v = Math.min(1, Math.max(0, fr - row)); // v grows with row (toward −z)
    const h = (r: number, c: number) => gridH[r * (N + 1) + c];
    const h00 = h(row, col), h01 = h(row, col + 1), h10 = h(row + 1, col), h11 = h(row + 1, col + 1);
    // Triangles: [(row+1,col+1),(row,col+1),(row,col)] and [(row+1,col),(row+1,col+1),(row,col)]; the shared
    // edge runs (row,col)–(row+1,col+1), i.e. u = v.
    if (u >= v) return h00 + (h01 - h00) * u + (h11 - h01) * v;
    return h00 + (h10 - h00) * v + (h11 - h10) * u;
  };

  const material = new ShaderMaterial("terrain", scene, { vertexSource: terrainVS, fragmentSource: terrainFS }, {
    attributes: ["position", "normal"],
    uniforms: ["world", "worldViewProjection", "sunDir", "sunColor", "skyAmb", "groundAmb", "fogColor", "camPos", "waterLevel", "wetLevel", "clipY"],
  });
  material.setFloat("clipY", -999);
  mesh.material = material;

  const terrain: Terrain = {
    mesh, material, heightTex,
    setLighting(l) {
      material.setVector3("sunDir", l.sunDir).setVector3("sunColor", l.sunLit).setVector3("skyAmb", l.skyAmbient)
        .setVector3("groundAmb", l.groundAmbient).setVector3("fogColor", l.fog);
    },
    update(camPos, waterLevel, wetLevel) {
      material.setVector3("camPos", camPos).setFloat("waterLevel", waterLevel).setFloat("wetLevel", wetLevel);
    },
    heightAt,
    raise(cells, height) {
      if (!cells.length) return;
      for (const c of cells) {
        // Grid vertices inside the cell go flat at `height`; the ring just outside stays, so the fill has a
        // steep skirt one grid step wide.
        for (let row = 0; row <= N; row++) for (let col = 0; col <= N; col++) {
          const x = vx(col), z = vz(row);
          if (x >= c.i - 0.001 && x <= c.i + 1.001 && z >= c.j - 0.001 && z <= c.j + 1.001) gridH[row * (N + 1) + col] = Math.max(gridH[row * (N + 1) + col], height);
        }
        // The water's heightmap sees dry ground there too.
        const TW = HEIGHT_TEX_SIZE;
        for (let row = 0; row < TW; row++) for (let col = 0; col < TW; col++) {
          const x = (col / (TW - 1) - 0.5) * SIZE, z = (row / (TW - 1) - 0.5) * SIZE;
          if (x >= c.i && x <= c.i + 1 && z >= c.j && z <= c.j + 1) encodeHeight(hdata, row, col, Math.max(sample(x, z), height));
        }
      }
      applyGrid();
      heightTex.update(hdata);
    },
    reset(height) {
      if (height) sample = height;
      for (let row = 0; row <= N; row++) for (let col = 0; col <= N; col++) gridH[row * (N + 1) + col] = sample(vx(col), vz(row));
      bakeHeightData(hdata, sample);
      applyGrid();
      heightTex.update(hdata);
    },
  };
  terrain.setLighting(MORNING);
  return terrain;
}
