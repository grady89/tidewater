// Sky dome: gradient from horizon to zenith with a sun disc and halo.
import { Mesh, MeshBuilder, Scene, ShaderMaterial } from "@babylonjs/core";
import { skyFS, skyVS } from "../../shaders/sky";
import { Lighting, MORNING } from "./lighting";

export interface Sky {
  mesh: Mesh;
  setLighting(l: Lighting): void;
  /** The biome's aurora strength (0 = none) and the clock that moves its curtains. */
  setAurora(strength: number, time: number): void;
  /** The biome's extra field of faint stars (0 = the usual sky). */
  setStars(amount: number): void;
}

export function createSky(scene: Scene): Sky {
  const dome = MeshBuilder.CreateSphere("sky", { diameter: 600, segments: 24, sideOrientation: Mesh.BACKSIDE }, scene);
  const material = new ShaderMaterial("sky", scene, { vertexSource: skyVS, fragmentSource: skyFS }, {
    attributes: ["position"],
    uniforms: ["worldViewProjection", "zenith", "horizon", "sunDir", "sunColor", "dusk", "moonDir", "moon", "night", "aurora", "auroraTime", "starField"],
  });
  material.disableDepthWrite = true;
  material.setFloat("aurora", 0).setFloat("auroraTime", 0).setFloat("starField", 0);
  material.backFaceCulling = false;
  dome.material = material;
  dome.infiniteDistance = true;
  dome.isPickable = false;
  const sky: Sky = {
    mesh: dome,
    setLighting(l) {
      material.setVector3("zenith", l.zenith).setVector3("horizon", l.horizon)
        .setVector3("sunDir", l.skySun).setVector3("sunColor", l.sunColor).setFloat("dusk", l.k)
        .setVector3("moonDir", l.moonDir).setFloat("moon", l.moon).setFloat("night", l.night);
    },
    setAurora(strength, time) { material.setFloat("aurora", strength).setFloat("auroraTime", time); },
    setStars(amount) { material.setFloat("starField", amount); },
  };
  sky.setLighting(MORNING);
  return sky;
}
