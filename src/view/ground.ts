// Ground height under the town, for everything the view stands on the terrain. main.ts swaps in the rendered
// terrain (landfill included); the default is the heightfield so factories work without a scene.
import { terrainHeight } from "../sim/heightfield";

let sampler: (x: number, z: number) => number = terrainHeight;
export function ground(x: number, z: number): number { return sampler(x, z); }
export function setGroundSampler(f: (x: number, z: number) => number): void { sampler = f; }
