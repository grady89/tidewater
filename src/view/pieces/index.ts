// The later coasts' building meshes, one file per coast, registered here so view/buildings.ts dispatches to them
// without a branch per kind: COAST_PIECES by building kind, COAST_HOMES by the look's house kit.
import type { Scene } from "@babylonjs/core";
import type { BuildingKind } from "../../sim/balance";
import type { Grid } from "../../sim/grid";
import type { Building } from "../../sim/state";
import type { HouseKit } from "../biomes";
import type { BuildingMeshes } from "../buildings";
import { DELTA_HOMES, DELTA_PIECES } from "./delta";
import { CINDER_HOMES, CINDER_PIECES } from "./cinder";
import { DUNES_HOMES, DUNES_PIECES } from "./dunes";

export type PieceFactory = (scene: Scene, b: Building, grid: Grid) => BuildingMeshes;
export type HomeFactory = (scene: Scene, b: Building, bodyW: number, baseH: number) => BuildingMeshes;

export const COAST_PIECES: Partial<Record<BuildingKind, PieceFactory>> = { ...DELTA_PIECES, ...CINDER_PIECES, ...DUNES_PIECES };
export const COAST_HOMES: Partial<Record<HouseKit, HomeFactory>> = { ...DELTA_HOMES, ...CINDER_HOMES, ...DUNES_HOMES };
