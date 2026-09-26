// The heightfield mesh and the baked heightmap texture the water shader reads. Heights come from the sim's
// analytic heightfield so the view and the ledger always agree.
import { Mesh, MeshBuilder, RawTexture, Scene, ShaderMaterial, Texture, Vector3, VertexBuffer } from "@babylonjs/core";
import { SIZE } from "../config";
import { terrainHeight } from "../sim/heightfield";
import { terrainFS, terrainVS } from "../../shaders/terrain";
import { FOG_COLOR, GROUND_AMBIENT, SKY_AMBIENT, SUN_DIR, SUN_LIT } from "./lighting";

export { terrainHeight };

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
