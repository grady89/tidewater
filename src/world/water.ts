// One water plane with the study's shader. Tide is the plane's Y.
import { Mesh, MeshBuilder, RawTexture, Scene, ShaderMaterial, Vector3 } from "@babylonjs/core";
import { SIZE } from "../config";
import { waterFS, waterVS } from "../../shaders/water";
import { DUSK, FOG_COLOR, SUN_DIR, SUN_LIT, WATER_SKY } from "./lighting";

export interface Water {
  mesh: Mesh;
  material: ShaderMaterial;
  update(time: number, camPos: Vector3, waterLevel: number): void;
}

export function createWater(scene: Scene, heightTex: RawTexture): Water {
  const mesh = MeshBuilder.CreateGround("water", { width: SIZE * 3.2, height: SIZE * 3.2, subdivisions: 260 }, scene);
  const material = new ShaderMaterial("water", scene, { vertexSource: waterVS, fragmentSource: waterFS }, {
    attributes: ["position"],
    uniforms: ["world", "worldViewProjection", "time", "sunDir", "sunColor", "skyColor", "fogColor", "camPos", "dusk"],
    samplers: ["heightTex"],
    needAlphaBlending: true,
  });
  material.setTexture("heightTex", heightTex);
  material.setVector3("sunDir", SUN_DIR).setVector3("sunColor", SUN_LIT).setVector3("skyColor", WATER_SKY)
    .setVector3("fogColor", FOG_COLOR).setFloat("dusk", DUSK);
  material.backFaceCulling = false;
  mesh.material = material;
  mesh.alphaIndex = 10;

  return {
    mesh, material,
    update(time, camPos, waterLevel) {
      mesh.position.y = waterLevel;
      material.setFloat("time", time).setVector3("camPos", camPos);
    },
  };
}
