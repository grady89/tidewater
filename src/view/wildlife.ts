// Gulls and crabs: decoration derived from the ledger every frame, two thin-instanced meshes, no state of their
// own. Gulls circle every harbour that has boats; crabs scuttle on flat cells near the town while the tide leaves
// them exposed. View only.
import { Matrix, Mesh, MeshBuilder, Quaternion, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import { BUILDINGS } from "../sim/balance";
import { cellIndex, Grid, HALF, inBounds } from "../sim/grid";
import { ground as groundHeight } from "./ground";
import { Building, SimState } from "../sim/state";
import { flatMaterial, mergeFlat, tint } from "../world/flatMesh";
import { isDaytime } from "../sim/daylight";
import { materialCode } from "../sim/materials";
import { BiomeLook, FaunaKind } from "./biomes";

const GULLS_PER_HARBOUR = 2;
const GULLS_PER_BOAT = 1;
const MAX_GULLS = 48;
const CRAB_SITES = 22;
const CRAB_REACH = 4;
/** A crab sits still for most of each bout, then scuttles sideways to a new spot within its cell. */
const CRAB_BOUT = 3.2, CRAB_MOVE = 0.35;

interface CrabSite { x: number; z: number; h: number; phase: number }
interface ShoreSite { x: number; z: number; h: number; yaw: number; phase: number }
const SEAL_SITES = 10, PUFFIN_SITES = 14, SHORE_REACH = 6, WHALES = 3;
const SHOAL_SITES = 12;
const SHOAL_COLOURS: [number, number, number][] = [[0.88, 0.44, 0.35], [0.98, 0.82, 0.35], [0.25, 0.77, 0.78], [0.55, 0.77, 0.42], [0.95, 0.95, 0.9]];
interface LagoonSite { k: number; x: number; z: number; phase: number; hue: number }

const PALETTE_BEAK = "#ffb859";

export class Wildlife {
  private readonly gulls: Mesh;
  private readonly wingL: Mesh;
  private readonly wingR: Mesh;
  private readonly crabs: Mesh;
  private readonly seals: Mesh;
  private readonly frigates: Mesh;
  private readonly frigateWingL: Mesh;
  private readonly frigateWingR: Mesh;
  private readonly turtles: Mesh;
  private readonly shoals: Mesh;
  private turtleMatrices = new Float32Array(SEAL_SITES * 16);
  private shoalMatrices = new Float32Array(SHOAL_SITES * 16);
  private shoalColors = new Float32Array(SHOAL_SITES * 4);
  private shoalSites: LagoonSite[] = [];
  private lagoonKey = "";
  turtleCount = 0;
  shoalCount = 0;
  private readonly puffins: Mesh;
  private readonly whales: Mesh;
  private readonly spouts: Mesh;
  private sealMatrices = new Float32Array(SEAL_SITES * 16);
  private puffinMatrices = new Float32Array(PUFFIN_SITES * 16);
  private whaleMatrices = new Float32Array(WHALES * 16);
  private spoutMatrices = new Float32Array(WHALES * 16);
  private sealSites: ShoreSite[] = [];
  private puffinSites: ShoreSite[] = [];
  private shoreKey = "";
  sealCount = 0;
  puffinCount = 0;
  whaleCount = 0;
  private gullMatrices = new Float32Array(MAX_GULLS * 16);
  private wingLMatrices = new Float32Array(MAX_GULLS * 16);
  private wingRMatrices = new Float32Array(MAX_GULLS * 16);
  private crabMatrices = new Float32Array(CRAB_SITES * 16);
  private sites: CrabSite[] = [];
  private siteKey = "";
  gullCount = 0;
  /** The Low quality preset turns the gulls off. */
  showGulls = true;
  /** The biome look's fauna picks (view/biomes): which of the kits fly and scuttle here. */
  private fauna: ReadonlySet<FaunaKind> = new Set<FaunaKind>(["gulls", "crabs"]);
  setLook(look: BiomeLook): void { this.fauna = new Set(look.fauna); }
  crabCount = 0;

  constructor(scene: Scene, private readonly grid: Grid) {
    // A gull after reference/birds: a tapered white body with a small head, an orange beak, a wedge tail and red
    // legs; the wings are their own meshes, hinged at the shoulder, so the flock can flap.
    const body = MeshBuilder.CreateSphere("gb", { diameter: 0.3, segments: 4 }, scene);
    body.scaling.set(1.35, 0.5, 0.6);
    const head = MeshBuilder.CreateSphere("gh", { diameter: 0.12, segments: 4 }, scene);
    head.position.set(0.2, 0.05, 0);
    const beak = MeshBuilder.CreateCylinder("gk", { diameterTop: 0, diameterBottom: 0.05, height: 0.09, tessellation: 4 }, scene);
    beak.rotation.z = -Math.PI / 2;
    beak.position.set(0.29, 0.04, 0);
    const tail = MeshBuilder.CreateBox("gt", { width: 0.16, height: 0.02, depth: 0.12 }, scene);
    tail.position.set(-0.24, 0.02, 0);
    const parts = [tint(body, "#f2ece0"), tint(head, "#f2ece0"), tint(beak, PALETTE_BEAK), tint(tail, "#e6e2d8")];
    for (const side of [-1, 1]) {
      const leg = MeshBuilder.CreateBox("gl", { width: 0.04, height: 0.02, depth: 0.02 }, scene);
      leg.position.set(-0.06, -0.07, side * 0.04);
      parts.push(tint(leg, "#b9543f"));
    }
    this.gulls = mergeFlat("gulls", parts, scene);
    const wing = (side: number) => {
      const inner = MeshBuilder.CreateBox("gw", { width: 0.2, height: 0.015, depth: 0.22 }, scene);
      inner.position.set(-0.02, 0, side * 0.16);
      const outer = MeshBuilder.CreateBox("gw", { width: 0.13, height: 0.012, depth: 0.2 }, scene);
      outer.position.set(-0.08, 0, side * 0.36);
      outer.rotation.y = -side * 0.35;
      const tip = MeshBuilder.CreateBox("gw", { width: 0.07, height: 0.01, depth: 0.08 }, scene);
      tip.position.set(-0.13, 0, side * 0.49);
      tip.rotation.y = -side * 0.5;
      const m = mergeFlat("gullWing", [tint(inner, "#f2ece0"), tint(outer, "#e6e2d8"), tint(tip, "#5d6d7a")], scene);
      m.isPickable = false; m.alwaysSelectAsActiveMesh = true; m.setEnabled(false);
      return m;
    };
    this.wingL = wing(-1); this.wingR = wing(1);
    // A crab after reference/crabs: a rounded shell, two claws held forward, six jointed legs, eyes on stalks.
    const shell = MeshBuilder.CreateSphere("cs", { diameter: 0.2, segments: 4 }, scene);
    shell.scaling.set(1.05, 0.45, 0.75);
    shell.position.y = 0.055;
    const crabParts = [tint(shell, "#c9674f")];
    for (const side of [-1, 1]) {
      const arm = MeshBuilder.CreateBox("ca", { width: 0.04, height: 0.03, depth: 0.09 }, scene);
      arm.position.set(side * 0.11, 0.05, 0.1);
      arm.rotation.y = -side * 0.4;
      crabParts.push(tint(arm, "#b9543f"));
      const claw = MeshBuilder.CreateSphere("cc", { diameter: 0.06, segments: 3 }, scene);
      claw.scaling.set(1, 0.7, 1.3);
      claw.position.set(side * 0.13, 0.055, 0.16);
      crabParts.push(tint(claw, "#c9674f"));
      for (let k = 0; k < 3; k++) {
        const leg = MeshBuilder.CreateBox("cl", { width: 0.1, height: 0.015, depth: 0.015 }, scene);
        leg.position.set(side * 0.13, 0.03, -0.02 + k * 0.045 - 0.04);
        leg.rotation.z = -side * 0.5;
        leg.rotation.y = side * (k - 1) * 0.3;
        crabParts.push(tint(leg, "#b9543f"));
      }
      const eye = MeshBuilder.CreateSphere("ce", { diameter: 0.025, segments: 2 }, scene);
      eye.position.set(side * 0.04, 0.1, 0.07);
      crabParts.push(tint(eye, "#2b3a45"));
    }
    this.crabs = mergeFlat("crabs", crabParts, scene);
    for (const m of [this.gulls, this.crabs]) { m.isPickable = false; m.alwaysSelectAsActiveMesh = true; m.setEnabled(false); }
    // A seal: a tapered grey-brown body, a round head, two hind flippers; it lies on its belly on the shingle.
    const sealBody = MeshBuilder.CreateSphere("sb", { diameter: 0.5, segments: 4 }, scene);
    sealBody.scaling.set(1.5, 0.5, 0.8);
    sealBody.position.y = 0.11;
    const sealHead = MeshBuilder.CreateSphere("sh", { diameter: 0.22, segments: 4 }, scene);
    sealHead.position.set(0.36, 0.2, 0);
    const sealParts = [tint(sealBody, "#6b6a66"), tint(sealHead, "#7a756c")];
    for (const side of [-1, 1]) {
      const flipper = MeshBuilder.CreateBox("sf", { width: 0.16, height: 0.03, depth: 0.1 }, scene);
      flipper.position.set(-0.4, 0.05, side * 0.08);
      flipper.rotation.y = side * 0.4;
      sealParts.push(tint(flipper, "#5d5854"));
    }
    this.seals = mergeFlat("seals", sealParts, scene);
    // A puffin: a black back, a white front, an orange beak, standing upright on orange feet.
    const pBody = MeshBuilder.CreateSphere("pb", { diameter: 0.16, segments: 4 }, scene);
    pBody.scaling.set(0.8, 1.2, 0.8);
    pBody.position.y = 0.11;
    const pFront = MeshBuilder.CreateSphere("pf", { diameter: 0.12, segments: 4 }, scene);
    pFront.scaling.set(0.6, 1.0, 0.7);
    pFront.position.set(0.045, 0.1, 0);
    const pBeak = MeshBuilder.CreateCylinder("pk", { diameterTop: 0, diameterBottom: 0.05, height: 0.07, tessellation: 4 }, scene);
    pBeak.rotation.z = -Math.PI / 2;
    pBeak.position.set(0.1, 0.17, 0);
    const puffinParts = [tint(pBody, "#2b2b2b"), tint(pFront, "#f2ece0"), tint(pBeak, "#e0705a")];
    for (const side of [-1, 1]) {
      const foot = MeshBuilder.CreateBox("pft", { width: 0.05, height: 0.015, depth: 0.03 }, scene);
      foot.position.set(0.02, 0.008, side * 0.03);
      puffinParts.push(tint(foot, "#e0705a"));
    }
    this.puffins = mergeFlat("puffins", puffinParts, scene);
    // A whale's back: a long dark hump with a small fin; the spout a pale cone.
    const back = MeshBuilder.CreateSphere("wb", { diameter: 1.0, segments: 5 }, scene);
    back.scaling.set(2.4, 0.5, 0.9);
    const fin = MeshBuilder.CreateCylinder("wfn", { diameterTop: 0, diameterBottom: 0.3, height: 0.3, tessellation: 3 }, scene);
    fin.scaling.set(1, 1, 0.3);
    fin.position.set(-0.4, 0.3, 0);
    this.whales = mergeFlat("whales", [tint(back, "#2b3a45"), tint(fin, "#2b3a45")], scene);
    const spout = MeshBuilder.CreateCylinder("ws", { diameterTop: 0.5, diameterBottom: 0.06, height: 1.0, tessellation: 5 }, scene);
    spout.position.y = 0.5;
    this.spouts = mergeFlat("spouts", [tint(spout, "#e6eef2")], scene);
    for (const m of [this.seals, this.puffins, this.whales, this.spouts]) { m.isPickable = false; m.alwaysSelectAsActiveMesh = true; m.setEnabled(false); }
    // A frigatebird: a long dark body, a forked tail, the wings hinged like the gull's but longer and darker.
    const fBody = MeshBuilder.CreateSphere("fb", { diameter: 0.28, segments: 4 }, scene);
    fBody.scaling.set(1.5, 0.45, 0.5);
    const fHead = MeshBuilder.CreateSphere("fh", { diameter: 0.1, segments: 4 }, scene);
    fHead.position.set(0.22, 0.03, 0);
    const fBeak = MeshBuilder.CreateCylinder("fk", { diameterTop: 0, diameterBottom: 0.04, height: 0.14, tessellation: 4 }, scene);
    fBeak.rotation.z = -Math.PI / 2;
    fBeak.position.set(0.33, 0.02, 0);
    const frigateParts = [tint(fBody, "#2b2b2b"), tint(fHead, "#2b2b2b"), tint(fBeak, "#5d6d7a")];
    for (const side of [-1, 1]) {
      const tail = MeshBuilder.CreateBox("ft", { width: 0.22, height: 0.015, depth: 0.05 }, scene);
      tail.position.set(-0.3, 0, side * 0.05);
      tail.rotation.y = side * 0.25;
      frigateParts.push(tint(tail, "#2b2b2b"));
    }
    this.frigates = mergeFlat("frigatebirds", frigateParts, scene);
    const frigateWing = (side: number) => {
      const inner = MeshBuilder.CreateBox("fw", { width: 0.16, height: 0.012, depth: 0.3 }, scene);
      inner.position.set(-0.02, 0, side * 0.2);
      const outer = MeshBuilder.CreateBox("fw", { width: 0.1, height: 0.01, depth: 0.32 }, scene);
      outer.position.set(-0.1, 0, side * 0.5);
      outer.rotation.y = -side * 0.45;
      const m = mergeFlat("frigateWing", [tint(inner, "#2b2b2b"), tint(outer, "#1c1a1a")], scene);
      m.isPickable = false; m.alwaysSelectAsActiveMesh = true; m.setEnabled(false);
      return m;
    };
    this.frigateWingL = frigateWing(-1); this.frigateWingR = frigateWing(1);
    // A turtle: a domed shell, a small head, four flippers; it walks the beach at night and floats by day.
    const tShell = MeshBuilder.CreateSphere("ts", { diameter: 0.34, segments: 4 }, scene);
    tShell.scaling.set(1.2, 0.45, 1);
    tShell.position.y = 0.09;
    const tHead = MeshBuilder.CreateSphere("th", { diameter: 0.1, segments: 3 }, scene);
    tHead.position.set(0.24, 0.07, 0);
    const turtleParts = [tint(tShell, "#3f7346"), tint(tHead, "#5faa5a")];
    for (const [dx, dz] of [[0.12, 0.17], [0.12, -0.17], [-0.12, 0.15], [-0.12, -0.15]]) {
      const flipper = MeshBuilder.CreateBox("tf", { width: 0.14, height: 0.025, depth: 0.08 }, scene);
      flipper.position.set(dx, 0.03, dz);
      flipper.rotation.y = dz > 0 ? -0.6 : 0.6;
      turtleParts.push(tint(flipper, "#3f7346"));
    }
    this.turtles = mergeFlat("turtles", turtleParts, scene);
    // A reef-fish shoal: a flat rosette of coloured chips just under the surface, tinted per instance.
    const chips: Mesh[] = [];
    for (let k = 0; k < 7; k++) {
      const chip = MeshBuilder.CreateBox("rf", { width: 0.16, height: 0.02, depth: 0.08 }, scene);
      const a = k * 0.9;
      chip.position.set(Math.cos(a) * 0.22 * (k % 3 + 1) / 3, 0, Math.sin(a) * 0.22 * (k % 3 + 1) / 3);
      chip.rotation.y = a;
      chips.push(tint(chip, "#ffffff"));
    }
    this.shoals = mergeFlat("reefFish", chips, scene);
    this.shoals.material = flatMaterial(scene).clone("shoalMat") as StandardMaterial;
    for (const m of [this.frigates, this.turtles, this.shoals]) { m.isPickable = false; m.alwaysSelectAsActiveMesh = true; m.setEnabled(false); }
  }

  // ---------- the Fjord's fauna (BIOMES.md §3.3): seals on the shingle, whale spouts in season, puffins on the cliffs ----------


  // ---------- the Atoll's fauna (BIOMES.md §3.2): turtles, reef-fish shoals, frigatebirds ----------

  /** Seeded lagoon cells near the town for the shoals. */
  private pickLagoonSites(state: SimState): void {
    const ids = Object.keys(state.buildings);
    const key = ids.length + ":" + ids[ids.length - 1] + ":" + this.grid.terrainVersion;
    if (key === this.lagoonKey) return;
    this.lagoonKey = key;
    const lagoon = materialCode("lagoon");
    const cells: number[] = [];
    for (let k = 0; k < this.grid.materials.length; k++) if (this.grid.materials[k] === lagoon) cells.push(k);
    let seed = 31;
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (let k = cells.length - 1; k > 0; k--) { const r = Math.floor(rnd() * (k + 1)); [cells[k], cells[r]] = [cells[r], cells[k]]; }
    this.shoalSites = cells.slice(0, SHOAL_SITES).map(k => ({ k, x: Math.floor(k / 64) - HALF + 0.5, z: (k % 64) - HALF + 0.5, phase: rnd() * 6.28, hue: rnd() }));
  }

  private syncShoals(state: SimState, viewTime: number): void {
    if (!this.fauna.has("reefFish")) { this.shoalCount = 0; this.shoals.setEnabled(false); return; }
    this.pickLagoonSites(state);
    const level = state.tide.level;
    const bleach = state.fields.bleach;
    let n = 0;
    for (const s of this.shoalSites) {
      if (bleach[s.k] > 0.6) continue; // a bleached patch is empty
      const drift = 0.8 * Math.sin(viewTime * 0.25 + s.phase), dz = 0.8 * Math.cos(viewTime * 0.19 + s.phase * 1.3);
      const yaw = viewTime * 0.3 + s.phase;
      Matrix.Compose(new Vector3(1, 1, 1), Quaternion.FromEulerAngles(0, yaw, 0), new Vector3(s.x + drift, level - 0.12, s.z + dz)).copyToArray(this.shoalMatrices, n * 16);
      const c = SHOAL_COLOURS[Math.floor(s.hue * SHOAL_COLOURS.length)];
      this.shoalColors[n * 4] = c[0]; this.shoalColors[n * 4 + 1] = c[1]; this.shoalColors[n * 4 + 2] = c[2]; this.shoalColors[n * 4 + 3] = 1;
      n++;
    }
    this.shoalCount = n;
    if (n === 0) { this.shoals.setEnabled(false); return; }
    this.shoals.setEnabled(true);
    this.shoals.thinInstanceSetBuffer("matrix", this.shoalMatrices.subarray(0, n * 16), 16, false);
    this.shoals.thinInstanceSetBuffer("color", this.shoalColors.subarray(0, n * 4), 4, false);
  }

  /** Turtles: on the beach after dark (and every one of them during a hatching), floating in the lagoon by day. */
  private syncTurtles(state: SimState, viewTime: number): void {
    if (!this.fauna.has("turtles")) { this.turtleCount = 0; this.turtles.setEnabled(false); return; }
    this.pickShoreSites(state);
    this.pickLagoonSites(state);
    const night = !isDaytime(state.time);
    const hatching = (state.biomeState.hatching ?? -1) === state.tide.cycle;
    const level = state.tide.level;
    let n = 0;
    if (night) {
      const sites = hatching ? this.sealSites : this.sealSites.slice(0, 3);
      for (const s of sites) {
        const crawl = 0.15 * Math.sin(viewTime * 0.5 + s.phase);
        Matrix.Compose(new Vector3(1, 1, 1), Quaternion.FromEulerAngles(0, s.yaw, 0), new Vector3(s.x + crawl * Math.cos(s.yaw), s.h, s.z + crawl * Math.sin(s.yaw))).copyToArray(this.turtleMatrices, n++ * 16);
      }
    } else {
      for (const s of this.shoalSites.slice(0, 4)) {
        const bob = 0.02 * Math.sin(viewTime * 1.3 + s.phase);
        Matrix.Compose(new Vector3(1, 1, 1), Quaternion.FromEulerAngles(0, viewTime * 0.15 + s.phase, 0), new Vector3(s.x + Math.sin(viewTime * 0.1 + s.phase), level - 0.05 + bob, s.z)).copyToArray(this.turtleMatrices, n++ * 16);
      }
    }
    this.turtleCount = n;
    if (n === 0) { this.turtles.setEnabled(false); return; }
    this.turtles.setEnabled(true);
    this.turtles.thinInstanceSetBuffer("matrix", this.turtleMatrices.subarray(0, n * 16), 16, false);
  }

  /** Seeded beach cells near the town for the seals, and high cells against the water for the puffins. */
  private pickShoreSites(state: SimState): void {
    const ids = Object.keys(state.buildings);
    const key = ids.length + ":" + ids[ids.length - 1] + ":" + this.grid.terrainVersion;
    if (key === this.shoreKey) return;
    this.shoreKey = key;
    const beach = new Set<number>(), cliff = new Set<number>();
    for (const b of Object.values(state.buildings)) for (const c of b.cells) {
      for (let di = -SHORE_REACH; di <= SHORE_REACH; di++) for (let dj = -SHORE_REACH; dj <= SHORE_REACH; dj++) {
        const i = c.i + di, j = c.j + dj;
        if (!inBounds(i, j) || this.grid.buildingAt({ i, j })) continue;
        const k = cellIndex(i, j);
        const h = this.grid.heights[k];
        if (this.grid.beach[k]) beach.add(k);
        else if (h > this.grid.tides.hi + 0.8 && h < 3.5 && this.grid.neighbors({ i, j }).some(n => this.grid.water[cellIndex(n.i, n.j)])) cliff.add(k);
      }
    }
    let seed = 23;
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const pick = (set: Set<number>, n: number): ShoreSite[] => {
      const cells = [...set].sort((a, b) => a - b);
      for (let k = cells.length - 1; k > 0; k--) { const r = Math.floor(rnd() * (k + 1)); [cells[k], cells[r]] = [cells[r], cells[k]]; }
      return cells.slice(0, n).map(k => {
        const x = Math.floor(k / 64) - HALF + 0.25 + rnd() * 0.5, z = (k % 64) - HALF + 0.25 + rnd() * 0.5;
        return { x, z, h: groundHeight(x, z), yaw: rnd() * 6.28, phase: rnd() * 6.28 };
      });
    };
    this.sealSites = pick(beach, SEAL_SITES);
    this.puffinSites = pick(cliff, PUFFIN_SITES);
  }

  private syncSeals(state: SimState, viewTime: number): void {
    if (!this.fauna.has("seals")) { this.sealCount = 0; this.seals.setEnabled(false); return; }
    this.pickShoreSites(state);
    let n = 0;
    for (const s of this.sealSites) {
      // Hauled out while the water is off the shingle: they leave when the tide comes up over the site.
      const exposed = (s.h - state.tide.level) / 0.15;
      if (exposed <= 0) continue;
      const sc = Math.min(1, exposed);
      const lift = 0.06 * Math.max(0, Math.sin(viewTime * 0.6 + s.phase)); // the head comes up now and then
      Matrix.Compose(new Vector3(sc, sc, sc), Quaternion.FromEulerAngles(-lift, s.yaw, 0), new Vector3(s.x, s.h, s.z)).copyToArray(this.sealMatrices, n++ * 16);
    }
    this.sealCount = n;
    if (n === 0) { this.seals.setEnabled(false); return; }
    this.seals.setEnabled(true);
    this.seals.thinInstanceSetBuffer("matrix", this.sealMatrices.subarray(0, n * 16), 16, false);
  }

  private syncPuffins(state: SimState, viewTime: number): void {
    if (!this.fauna.has("puffins")) { this.puffinCount = 0; this.puffins.setEnabled(false); return; }
    this.pickShoreSites(state);
    let n = 0;
    for (const s of this.puffinSites) {
      const bob = 0.01 * Math.sin(viewTime * 3 + s.phase);
      Matrix.Compose(new Vector3(1, 1, 1), Quaternion.FromEulerAngles(0, s.yaw + 0.3 * Math.sin(viewTime * 0.4 + s.phase), 0), new Vector3(s.x, s.h + bob, s.z)).copyToArray(this.puffinMatrices, n++ * 16);
    }
    this.puffinCount = n;
    if (n === 0) { this.puffins.setEnabled(false); return; }
    this.puffins.setEnabled(true);
    this.puffins.thinInstanceSetBuffer("matrix", this.puffinMatrices.subarray(0, n * 16), 16, false);
  }

  /** Whales cruise the deep water in season, surfacing on a slow cycle; a spout rises for a moment each time. */
  private syncWhales(state: SimState, viewTime: number): void {
    const inSeason = this.fauna.has("whales") && (state.biomeState.whaleSeason ?? 0) > 0;
    if (!inSeason) { this.whaleCount = 0; this.whales.setEnabled(false); this.spouts.setEnabled(false); return; }
    let n = 0, ns = 0;
    const level = state.tide.level;
    for (let k = 0; k < WHALES; k++) {
      // A loop over the deepest water: a circle of cells off the mouth, each whale at its own phase.
      const t = viewTime * 0.05 + k * 2.1;
      const cx = Math.cos(t) * 9, cz = 22 + Math.sin(t) * 5;
      const gx = Math.floor(cx), gz = Math.floor(cz);
      if (!inBounds(gx, gz) || this.grid.heights[cellIndex(gx, gz)] > -2.0) continue;
      const surface = Math.sin(viewTime * 0.35 + k * 1.7);
      if (surface < 0.2) continue;
      const up = (surface - 0.2) / 0.8;
      const yaw = Math.atan2(-Math.sin(t) * 9, Math.cos(t) * 5);
      Matrix.Compose(new Vector3(1, 1, 1), Quaternion.FromEulerAngles(0, yaw, 0), new Vector3(cx, level - 0.35 + 0.4 * up, cz)).copyToArray(this.whaleMatrices, n++ * 16);
      if (up > 0.6) {
        const s = (up - 0.6) / 0.4;
        Matrix.Compose(new Vector3(0.6 + 0.6 * s, 0.6 + 1.2 * s, 0.6 + 0.6 * s), Quaternion.Identity(), new Vector3(cx, level + 0.1, cz)).copyToArray(this.spoutMatrices, ns++ * 16);
      }
    }
    this.whaleCount = n;
    if (n === 0) this.whales.setEnabled(false); else { this.whales.setEnabled(true); this.whales.thinInstanceSetBuffer("matrix", this.whaleMatrices.subarray(0, n * 16), 16, false); }
    if (ns === 0) this.spouts.setEnabled(false); else { this.spouts.setEnabled(true); this.spouts.thinInstanceSetBuffer("matrix", this.spoutMatrices.subarray(0, ns * 16), 16, false); }
  }


  /** Seeded crab sites: unbuilt flat cells within reach of the town, re-picked when the building set changes. */
  private pickSites(state: SimState): void {
    const ids = Object.keys(state.buildings);
    const key = ids.length + ":" + ids[ids.length - 1];
    if (key === this.siteKey) return;
    this.siteKey = key;
    const candidates = new Set<number>();
    for (const b of Object.values(state.buildings)) for (const c of b.cells) {
      for (let di = -CRAB_REACH; di <= CRAB_REACH; di++) for (let dj = -CRAB_REACH; dj <= CRAB_REACH; dj++) {
        const i = c.i + di, j = c.j + dj;
        if (!inBounds(i, j)) continue;
        const k = cellIndex(i, j);
        const h = this.grid.heights[k];
        if (h < this.grid.tides.lo || h > this.grid.tides.hi || this.grid.buildingAt({ i, j })) continue;
        candidates.add(k);
      }
    }
    const cells = [...candidates].sort((a, b) => a - b);
    let seed = 7;
    const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (let k = cells.length - 1; k > 0; k--) { const r = Math.floor(rnd() * (k + 1)); [cells[k], cells[r]] = [cells[r], cells[k]]; }
    this.sites = cells.slice(0, CRAB_SITES).map(k => {
      const x = Math.floor(k / 64) - HALF + 0.2 + rnd() * 0.6, z = (k % 64) - HALF + 0.2 + rnd() * 0.6;
      return { x, z, h: groundHeight(x, z), phase: rnd() * 6.28 };
    });
  }

  private syncGulls(state: SimState, viewTime: number): void {
    let n = 0;
    const scale = new Vector3(0.7, 0.7, 0.7);
    for (const h of Object.values(state.buildings) as Building[]) {
      if (!this.showGulls || !(this.fauna.has("gulls") || this.fauna.has("frigatebirds")) || (BUILDINGS[h.kind].slots ?? 0) === 0 || h.boats === 0) continue;
      const is = h.cells.map(c => c.i), js = h.cells.map(c => c.j);
      const cx = (Math.min(...is) + Math.max(...is) + 1) / 2, cz = (Math.min(...js) + Math.max(...js) + 1) / 2;
      const flock = Math.min(5, GULLS_PER_HARBOUR + GULLS_PER_BOAT * h.boats);
      for (let k = 0; k < flock && n < MAX_GULLS; k++) {
        const dir = k % 2 === 0 ? 1 : -1;
        const r = 1.6 + k * 0.5, speed = 0.55 - k * 0.05;
        const t = dir * (viewTime * speed + k * 1.3 + h.id);
        const x = cx + Math.cos(t) * r, z = cz + Math.sin(t) * r;
        const y = h.floorY + 2.2 + k * 0.35 + 0.25 * Math.sin(viewTime * 1.7 + k);
        // Gliding most of the time with a few quick beats: the flap angle is a clipped sine.
        const beat = Math.sin(viewTime * 7 + k * 2.1);
        const flap = Math.max(-0.2, Math.min(0.7, beat * 1.2)) * (Math.sin(viewTime * 0.6 + k) > -0.2 ? 1 : 0.15);
        const yaw = -t - dir * Math.PI / 2;
        const bank = dir * 0.18;
        const bodyM = Matrix.Compose(scale, Quaternion.FromEulerAngles(0, yaw, bank), new Vector3(x, y, z));
        bodyM.copyToArray(this.gullMatrices, n * 16);
        // Wings hinge about the body's forward (x) axis, opposite senses either side.
        Matrix.RotationX(-flap).multiply(bodyM).copyToArray(this.wingLMatrices, n * 16);
        Matrix.RotationX(flap).multiply(bodyM).copyToArray(this.wingRMatrices, n * 16);
        n++;
      }
    }
    this.gullCount = n;
    const frigate = this.fauna.has("frigatebirds") && !this.fauna.has("gulls");
    const body = frigate ? this.frigates : this.gulls, wl = frigate ? this.frigateWingL : this.wingL, wr = frigate ? this.frigateWingR : this.wingR;
    for (const m of [this.gulls, this.wingL, this.wingR, this.frigates, this.frigateWingL, this.frigateWingR]) if (n === 0 || (m !== body && m !== wl && m !== wr)) m.setEnabled(false);
    if (n === 0) return;
    for (const m of [body, wl, wr]) m.setEnabled(true);
    body.thinInstanceSetBuffer("matrix", this.gullMatrices.subarray(0, n * 16), 16, false);
    wl.thinInstanceSetBuffer("matrix", this.wingLMatrices.subarray(0, n * 16), 16, false);
    wr.thinInstanceSetBuffer("matrix", this.wingRMatrices.subarray(0, n * 16), 16, false);
  }

  private syncCrabs(state: SimState, viewTime: number): void {
    if (!this.fauna.has("crabs")) { this.crabCount = 0; this.crabs.setEnabled(false); return; }
    this.pickSites(state);
    const level = state.tide.level;
    let n = 0;
    for (const s of this.sites) {
      const exposed = (s.h - level) / 0.08; // pops up over the first 8 cm of exposure
      if (exposed <= 0) continue;
      const sc = Math.min(1, exposed);
      // Bouts: each one has a seeded resting spot; the crab darts from the last spot to this one in the first
      // CRAB_MOVE seconds of the bout and then sits. Facing is sideways to the dart, as crabs walk.
      const t = viewTime / CRAB_BOUT + s.phase;
      const bout = Math.floor(t);
      const u = Math.min(1, ((t - bout) * CRAB_BOUT) / CRAB_MOVE);
      const spot = (k: number) => { const h = Math.sin(k * 12.9898 + s.phase * 78.233) * 43758.5453; const a = (h - Math.floor(h)) * 6.283; return { x: 0.3 * Math.cos(a), z: 0.3 * Math.sin(a) }; };
      const from = spot(bout - 1), to = spot(bout);
      const e = u * u * (3 - 2 * u);
      const ox = from.x + (to.x - from.x) * e, oz = from.z + (to.z - from.z) * e;
      const yaw = Math.atan2(to.x - from.x, to.z - from.z);
      const pos = new Vector3(s.x + ox, s.h, s.z + oz);
      Matrix.Compose(new Vector3(sc, sc, sc), Quaternion.FromEulerAngles(0, yaw, 0), pos).copyToArray(this.crabMatrices, n++ * 16);
    }
    this.crabCount = n;
    if (n === 0) { this.crabs.setEnabled(false); return; }
    this.crabs.setEnabled(true);
    this.crabs.thinInstanceSetBuffer("matrix", this.crabMatrices.subarray(0, n * 16), 16, false);
  }

  sync(state: SimState, viewTime: number): void {
    this.syncGulls(state, viewTime);
    this.syncCrabs(state, viewTime);
    this.syncSeals(state, viewTime);
    this.syncPuffins(state, viewTime);
    this.syncWhales(state, viewTime);
    this.syncShoals(state, viewTime);
    this.syncTurtles(state, viewTime);
  }
}
