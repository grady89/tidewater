// Seeded value noise and the analytic terrain height. Pure functions; the sim and the view both read them.
// The second island (backlog 6) is blended in at the end; the main island's heights are untouched.
import { TERRAIN_SEED } from "../config";
import { isleHeight, isleWeight } from "./isle";

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
  h += detail * (e > 0.3 ? 1.6 : 0.6);
  const w = isleWeight(x, z);
  if (w > 0) h = h * (1 - w) + (isleHeight(x, z) + detail * 0.5) * w;
  return h;
}
