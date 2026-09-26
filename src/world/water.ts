// One water plane with the study's shader. Tide is the plane's Y.
import { Mesh, MeshBuilder, RawTexture, Scene, ShaderMaterial, Vector3 } from "@babylonjs/core";
import { SIZE } from "../config";
import { waterFS, waterVS } from "../../shaders/water";
import { Lighting, MORNING } from "./lighting";

export interface Water {
  mesh: Mesh;
  material: ShaderMaterial;
  setLighting(l: Lighting): void;
  update(time: number, camPos: Vector3, waterLevel: number): void;
}

/** The vertex shader's surface displacement, for anything that floats. Keep in step with shaders/water.ts. */
export function waveHeight(x: number, z: number, time: number): number {
  return 0.045 * Math.sin(x * 0.9 + time * 1.1) + 0.035 * Math.sin((x * 0.6 + z * 0.8) * 1.3 - time * 0.9) + 0.025 * Math.sin(z * 1.7 + time * 1.6);
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
  material.backFaceCulling = false;
  mesh.material = material;
  mesh.alphaIndex = 10;

  const water: Water = {
    mesh, material,
    setLighting(l) {
      material.setVector3("sunDir", l.sunDir).setVector3("sunColor", l.sunLit).setVector3("skyColor", l.waterSky)
        .setVector3("fogColor", l.fog).setFloat("dusk", l.k);
    },
    update(time, camPos, waterLevel) {
      mesh.position.y = waterLevel;
      material.setFloat("time", time).setVector3("camPos", camPos);
    },
  };
  water.setLighting(MORNING);
  return water;
}
