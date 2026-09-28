// The fort (pirates, behind PIRATES_ENABLED): a squat stone redoubt, crenellated, two guns over the water, a flag.
import { Mesh } from "@babylonjs/core";
import type { BuildingKind } from "../../sim/balance";
import { mergeFlat } from "../../world/flatMesh";
import { KIT, PALETTE } from "../buildings";
import type { PieceFactory } from "./index";

const fort: PieceFactory = (scene, b) => {
  const { box, cyl, bounds, accents } = KIT;
  const { cx, cz, w, d } = bounds(b.cells, b.rot);
  const F = b.floorY;
  const parts: Mesh[] = [];
  const stone = accents().stone, light = accents().stoneLight;
  const W = w - 0.3, D = d - 0.3, H = 0.6;
  parts.push(box(scene, W, H, D, cx, F + H / 2, cz, stone));
  // Crenellations round the top.
  for (let k = 0; k < 6; k++) {
    const u = -W / 2 + 0.12 + k * (W - 0.24) / 5;
    for (const sz of [-1, 1]) parts.push(box(scene, 0.16, 0.16, 0.12, cx + u, F + H + 0.08, cz + sz * (D / 2 - 0.06), light));
    for (const sx of [-1, 1]) parts.push(box(scene, 0.12, 0.16, 0.16, cx + sx * (W / 2 - 0.06), F + H + 0.08, cz + u * (D / W), light));
  }
  // A round tower at one corner, a flag above it.
  parts.push(cyl(scene, 0.55, 0.9, cx + W / 2 - 0.3, F + 0.45, cz - D / 2 + 0.3, light, 8));
  parts.push(box(scene, 0.04, 0.7, 0.04, cx + W / 2 - 0.3, F + 1.25, cz - D / 2 + 0.3, PALETTE.wood));
  parts.push(box(scene, 0.32, 0.2, 0.02, cx + W / 2 - 0.14, F + 1.48, cz - D / 2 + 0.3, "#c9674f"));
  // Two guns over the parapet.
  for (const sx of [-0.35, 0.25]) {
    const gun = cyl(scene, 0.12, 0.6, cx + sx, F + H + 0.12, cz - D / 2 + 0.05, "#4c5a66", 6);
    gun.rotation.x = Math.PI / 2;
    parts.push(gun);
  }
  return { root: mergeFlat("fort", parts, scene) };
};

export const FORT_PIECES: Partial<Record<BuildingKind, PieceFactory>> = { fort };
