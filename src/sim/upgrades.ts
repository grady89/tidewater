// Upgrades: the services that serve a number of people (or a reach) grow from level 1 to MAX_LEVEL in place, for
// money and planks (balance.UPGRADES). A town that sprawls builds more of them; a dense one upgrades what it has.
// The level is the building's own `level` (homes grow theirs on their own, and are not upgraded).
import { BUILDINGS, Cost, MAX_LEVEL, UPGRADE_UPKEEP_STEP, UPGRADES, UpgradeDef } from "./balance";
import { moveMoney } from "./money";
import { Building, notify, SimState } from "./state";

export function upgradeOf(b: Building): UpgradeDef | null {
  return UPGRADES[b.kind] ?? null;
}

/** What the building serves at its level (people, goods a cycle, beds, cells of reach), or null for kinds without levels. */
export function levelCapacity(b: Building): number | null {
  const u = UPGRADES[b.kind];
  return u ? u.capacity[Math.min(MAX_LEVEL, Math.max(1, b.level)) - 1] : null;
}

/** The name of the building at its level (a well that has grown is a cistern). */
export function levelName(b: Building): string {
  return UPGRADES[b.kind]?.names?.[Math.min(MAX_LEVEL, Math.max(1, b.level)) - 1] ?? BUILDINGS[b.kind].name;
}

/** The price of the next level, or null at the top (or for kinds without levels). */
export function upgradeCost(b: Building): Cost | null {
  const u = UPGRADES[b.kind];
  return u && b.level < MAX_LEVEL ? u.costs[b.level - 1] : null;
}

export function costText(c: Cost): string {
  return [`${c.money}$`, c.planks ? `${c.planks} planks` : "", c.timber ? `${c.timber} timber` : ""].filter(Boolean).join(" + ");
}

/** Why the building can't go up a level now, or null when it can. */
export function upgradeBlocker(state: SimState, b: Building): string | null {
  const cost = upgradeCost(b);
  if (!cost) return UPGRADES[b.kind] ? "At its highest level" : "Has no levels";
  if (b.damaged) return "Repair it first";
  const r = state.resources;
  if (r.money < cost.money || r.planks < (cost.planks ?? 0) || r.timber < (cost.timber ?? 0)) return `Costs ${costText(cost)}`;
  return null;
}

/** Pay for and raise the building one level. Returns whether it went up. */
export function upgradeBuilding(state: SimState, b: Building): boolean {
  if (upgradeBlocker(state, b)) return false;
  const cost = upgradeCost(b)!;
  const was = levelName(b);
  moveMoney(state, -cost.money, "upgrade");
  state.resources.planks -= cost.planks ?? 0;
  state.resources.timber -= cost.timber ?? 0;
  b.level++;
  const now = levelName(b);
  notify(state, now !== was ? `The ${was.toLowerCase()} is a ${now.toLowerCase()} now` : `The ${was.toLowerCase()} went up to level ${b.level}`);
  return true;
}

/** Money per cycle to keep the building: the catalog's upkeep, plus UPGRADE_UPKEEP_STEP of it per level above the first. */
export function upkeepOf(b: Building): number {
  const base = BUILDINGS[b.kind].upkeep;
  return UPGRADES[b.kind] ? base * (1 + UPGRADE_UPKEEP_STEP * (b.level - 1)) : base;
}
