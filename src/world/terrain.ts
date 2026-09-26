// Seeded value noise, the heightfield mesh, and the baked heightmap texture the water shader reads.
import { Mesh, MeshBuilder, RawTexture, Scene, ShaderMaterial, Texture, Vector3, VertexBuffer } from "@babylonjs/core";
import { SIZE, TERRAIN_SEED } from "../config";
import { terrainFS, terrainVS } from "../../shaders/terrain";
import { FOG_COLOR, GROUND_AMBIENT, SKY_AMBIENT, SUN_DIR, SUN_LIT } from "./lighting";

// ---------- procedural terrain ----------
function hash(ix: number, iz: number): number {
  let n = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(TERRAIN_SEED, 0x27d4eb2f);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  n = n ^ (n >>> 16);
  return (n >>> 0) / 4294967295;
}
function vnoise(x: number, z: number): number {
  const ix = Math.floor(x), iz = Math.floor(z);
  let fx = x - ix, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz;
}
function fbm(x: number, z: number, oct: number, f0: number): number {
  let s = 0, amp = 0.5, f = f0, norm = 0;
  for (let i = 0; i < oct; i++) { s += vnoise(x * f + i * 17.3, z * f - i * 9.1) * amp; norm += amp; amp *= 0.5; f *= 2; }
  return s / norm;
}

/** Terrain height in world Y at world (x, z). Pure function of the seed. */
export function terrainHeight(x: number, z: number): number {
  let e = (fbm(x + 40, z - 20, 5, 1 / 22) - 0.5) * 2.2;
  const r = Math.sqrt(x * x + z * z) / 32;
  e -= r * r * r * 1.3;
  e += 0.12;
  const detail = (fbm(x * 3 + 7, z * 3 - 3, 3, 1 / 6) - 0.5) * 0.25;
  let h;
  if (e < 0) h = e * 4.0;
  else if (e < 0.3) h = (e / 0.3) * 0.5;
  else h = 0.5 + (e - 0.3) * 9.0;
  return h + detail * (e > 0.3 ? 1.6 : 0.6);
}

// ---------- heightmap texture ----------
// 16-bit height split across r,g. Encodes (H + 5) / 12; the water shader decodes with the same constants.
const HEIGHT_TEX_SIZE = 256;

function bakeHeightTexture(scene: Scene): RawTexture {
  const TW = HEIGHT_TEX_SIZE;
  const hdata = new Uint8Array(TW * TW * 4);
  for (let row = 0; row < TW; row++) for (let col = 0; col < TW; col++) {
    const x = (col / (TW - 1) - 0.5) * SIZE, z = (row / (TW - 1) - 0.5) * SIZE;
    let v = (terrainHeight(x, z) + 5) / 12; v = Math.min(1, Math.max(0, v));
    const q = Math.round(v * 65535);
    const i = (row * TW + col) * 4;
    hdata[i] = q >> 8; hdata[i + 1] = q & 255; hdata[i + 2] = 0; hdata[i + 3] = 255;
  }
  const tex = RawTexture.CreateRGBATexture(hdata, TW, TW, scene, false, false, Texture.BILINEAR_SAMPLINGMODE);
  tex.wrapU = tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  return tex;
}

// ---------- mesh ----------
export interface Terrain {
  mesh: Mesh;
  material: ShaderMaterial;
  heightTex: RawTexture;
  update(camPos: Vector3, waterLevel: number, wetLevel: number): void;
}

export function createTerrain(scene: Scene): Terrain {
  const heightTex = bakeHeightTexture(scene);

  const mesh = MeshBuilder.CreateGround("ground", { width: SIZE, height: SIZE, subdivisions: 170 }, scene);
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind)!;
  for (let i = 0; i < pos.length; i += 3) pos[i + 1] = terrainHeight(pos[i], pos[i + 2]);
  mesh.updateVerticesData(VertexBuffer.PositionKind, pos);
  mesh.convertToFlatShadedMesh();

  const material = new ShaderMaterial("terrain", scene, { vertexSource: terrainVS, fragmentSource: terrainFS }, {
    attributes: ["position", "normal"],
    uniforms: ["world", "worldViewProjection", "sunDir", "sunColor", "skyAmb", "groundAmb", "fogColor", "camPos", "waterLevel", "wetLevel"],
  });
  material.setVector3("sunDir", SUN_DIR).setVector3("sunColor", SUN_LIT).setVector3("skyAmb", SKY_AMBIENT)
    .setVector3("groundAmb", GROUND_AMBIENT).setVector3("fogColor", FOG_COLOR);
  mesh.material = material;

  return {
    mesh, material, heightTex,
    update(camPos, waterLevel, wetLevel) {
      material.setVector3("camPos", camPos).setFloat("waterLevel", waterLevel).setFloat("wetLevel", wetLevel);
    },
  };
}
