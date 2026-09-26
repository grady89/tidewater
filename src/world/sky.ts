// Sky dome: gradient from horizon to zenith with a sun disc and halo.
import { Mesh, MeshBuilder, Scene, ShaderMaterial } from "@babylonjs/core";
import { skyFS, skyVS } from "../../shaders/sky";
import { DUSK, SKY_HORIZON, SKY_ZENITH, SUN_COLOR, SUN_DIR } from "./lighting";

export function createSky(scene: Scene): Mesh {
  const dome = MeshBuilder.CreateSphere("sky", { diameter: 600, segments: 24, sideOrientation: Mesh.BACKSIDE }, scene);
  const material = new ShaderMaterial("sky", scene, { vertexSource: skyVS, fragmentSource: skyFS }, {
    attributes: ["position"],
    uniforms: ["worldViewProjection", "zenith", "horizon", "sunDir", "sunColor", "dusk"],
  });
  material.setVector3("zenith", SKY_ZENITH).setVector3("horizon", SKY_HORIZON)
    .setVector3("sunDir", SUN_DIR).setVector3("sunColor", SUN_COLOR).setFloat("dusk", DUSK);
  material.disableDepthWrite = true;
  material.backFaceCulling = false;
  dome.material = material;
  dome.infiniteDistance = true;
  dome.isPickable = false;
  return dome;
}
