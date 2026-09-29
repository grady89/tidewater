// Bootstrap: engine, scene, the ledger, the fixed-timestep loop, and the dev/test console API.
import { ArcRotateCamera, Color4, DefaultRenderingPipeline, Engine, Matrix, Scene, Vector3 } from "@babylonjs/core";
import { CameraControl } from "./build/cameraControl";
import { PIPE_TOOLS, Placement, Tool } from "./build/placement";
import { upgradeBuilding } from "./sim/upgrades";
import { HAZE_FAR, HAZE_NEAR, HAZE_TINT, LANES_ENABLED, SIM_TICK, SIZE, TIDE_PERIOD, TREMOR_SHAKE } from "./config";
import { BUILDINGS, COMPANY_SLIDE_UNITS, STORM_WAVE_AMP, WAVE_WIDTH } from "./sim/balance";
import { districtOf } from "./sim/districts";
import { startStorm, startTsunami } from "./sim/events";
import { ignite } from "./sim/fire";
import { biomeFor } from "./sim/biomes";
import { hatching } from "./sim/biomes/atoll";
import { seaIce, whaleSeason } from "./sim/biomes/fjord";
import { materialCode } from "./sim/materials";
import { GoodId, GOODS } from "./sim/goods";
import { Grid } from "./sim/grid";
import { crossCommuters, ferryTerminals } from "./sim/network";
import { deserialize, serialize } from "./sim/save";
import { applyPending, forgetFace, lanesFromMetas, readLedger, shipsAtSea, worldJob, WorldSettlement } from "./sim/lanes";
import { Biome, biomeAllowed, defaultName, deleteSector, exportSector, FACES, importSector, listMetas, migrateLegacy, readActive, readMeta, readSector, renameSector, SectorMeta, Store, writeActive, writeSector } from "./sim/sectors";
import { newGame } from "./sim/start";
import { CardTrade, TradePanel, WorldUi } from "./globe/ui";
import { Framing, World } from "./globe/world";
import { closeDialog, confirmDialog, dialogOpen, noticeDialog, promptDialog } from "./ui/dialog";
import { notify, onNotify, population, SimState } from "./sim/state";
import { playtestFileName, PlaytestLog, readPlaytestEnabled, readPlaytestNotes, writePlaytestEnabled, writePlaytestNotes } from "./ui/playtest";
import { advanceCycles, tick } from "./sim/tick";
import { cycleFraction } from "./sim/tide";
import { takeLoan } from "./sim/loan";
import { orderGood, orderPlanks } from "./sim/trade";
import { Hud } from "./ui/hud";
import { InfoPanel } from "./ui/infoPanel";
import { SaveMenu } from "./ui/saveMenu";
import { Speed, SpeedControls } from "./ui/speed";
import { PRESETS, PROBE_SECONDS, Quality, QUALITY_LABEL, qualityForFps, readQuality, SettingsPanel, writeQuality } from "./ui/settings";
import { AchievementPopup } from "./ui/achievements";
import { MarkerLabel } from "./ui/markerLabel";
import { Tutorial } from "./ui/tutorial";
import { Audio } from "./view/audio";
import { Boats } from "./view/boats";
import { BiomeLook, lookFor } from "./view/biomes";
import { applyPalette, roofShape } from "./view/buildings";
import { BuildingViews } from "./view/buildingViews";
import { Effects } from "./view/effects";
import { Ferry } from "./view/ferry";
import { PierMarker } from "./view/marker";
import { OverlayKind, Overlays } from "./view/overlays";
import { Ship } from "./view/ship";
import { MobileControls, phoneMode } from "./ui/mobile";
import { Trees } from "./view/trees";
import { PERSON_SCALE, Walkers } from "./view/walkers";
import { setGroundSampler } from "./view/ground";
import { Wildlife } from "./view/wildlife";
import { CoastFauna } from "./view/fauna";
import { computeLighting, createLights, dayFraction, duskAt, Lighting, MORNING } from "./world/lighting";
import { createSky } from "./world/sky";
import { createTerrain } from "./world/terrain";
import { createWater, FOG_FAR, FOG_NEAR } from "./world/water";

const SEED = 1;
const bootStart = performance.now();

const canvas = document.getElementById("c") as HTMLCanvasElement;
const engine = new Engine(canvas, true, { antialias: true, adaptToDeviceRatio: true });
const scene = new Scene(engine);
scene.clearColor = new Color4(0.81, 0.90, 0.95, 1);

const camera = new ArcRotateCamera("cam", -0.95, 1.05, 46, new Vector3(0, 0.6, 0), scene);
camera.minZ = 0.5; camera.maxZ = 900;
camera.attachControl(canvas, true); // keeps the scene's pointer tracking; the camera's own inputs are cleared below
const cameraControl = new CameraControl(camera, canvas, scene);

const lights = createLights(scene);
const terrain = createTerrain(scene);
setGroundSampler((x, z) => terrain.heightAt(x, z));
const water = createWater(scene, terrain.heightTex);
const sky = createSky(scene);
// Babylon's mirror clips StandardMaterials under the plane on its own; the terrain's custom shader needs telling,
// or the seabed reflects up across the sea as dark streaks.
water.mirror.onBeforeRenderObservable.add(() => terrain.material.setFloat("clipY", water.mesh.position.y));
water.mirror.onAfterRenderObservable.add(() => terrain.material.setFloat("clipY", -999));

const pipe = new DefaultRenderingPipeline("pp", false, scene, [camera]);
pipe.fxaaEnabled = true;
pipe.bloomEnabled = true; pipe.bloomThreshold = 0.9; pipe.bloomWeight = 0.15; pipe.bloomKernel = 48; pipe.bloomScale = 0.5;

// ---------- the ledger and the World's sectors ----------
// Towns live in the World's twelve sectors (sim/sectors.ts, docs/globe). The active sector is the autosave:
// the island writes into it at every tide peak and when it returns to the World.
const store: Store = {
  getItem: k => { try { return localStorage.getItem(k); } catch { return null; } },
  setItem: (k, v) => { try { localStorage.setItem(k, v); } catch { /* full or unavailable: play on */ } },
  removeItem: k => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
const migrated = migrateLegacy(store);
let activeFace: number | null = readActive(store);
if (activeFace !== null && !readMeta(store, activeFace)) activeFace = null;
if (activeFace === null) { const first = listMetas(store).findIndex(m => !!m); activeFace = first >= 0 ? first : null; }
function sectorBase(face: number): { name: string; biome: Biome; created: number } {
  const m = readMeta(store, face);
  return m ? { name: m.name, biome: m.biome, created: m.created } : { name: defaultName(store), biome: "tidewater", created: Date.now() };
}
function save(): void {
  if (activeFace === null) return;
  writeSector(store, activeFace, state, sectorBase(activeFace));
}

const loadedRecord = activeFace !== null ? readSector(store, activeFace) : null;
let state: SimState;
let grid: Grid;
if (loadedRecord) { state = loadedRecord.state; grid = new Grid(state); }
else ({ state, grid } = newGame(SEED));

// ---------- the view ----------
const views = new BuildingViews(scene, grid);
const boats = new Boats(scene, grid);
const walkers = new Walkers(scene, grid);
const trees = new Trees(scene);
const overlays = new Overlays(scene, grid);
const effects = new Effects(scene);
const ship = new Ship(scene, grid);
const cargoShip = new Ship(scene, grid, "cargo");
const wildlife = new Wildlife(scene, grid);
const fauna = new CoastFauna(scene, grid);
const audio = new Audio();
const ferry = new Ferry(scene, grid);
const pierMarker = new PierMarker(scene, grid);
const placement = new Placement(scene, camera, grid, canvas);
const hud = new Hud(document.getElementById("hud")!, document.getElementById("resources")!, document.getElementById("notes")!, grid, tool => placement.setTool(tool), kind => overlays.show(kind), () => orderPlanks(state), () => takeLoan(state));
const info = new InfoPanel(document.getElementById("info")!, grid, good => orderGood(state, good));
const tutorial = new Tutorial(document.getElementById("tutorial")!);
const achievements = new AchievementPopup(document.getElementById("achievement")!);
const markerLabel = new MarkerLabel(document.getElementById("markerLabel")!, "Pier goes here");
achievements.adopt(state);
placement.onSelect = b => info.select(b);
placement.onLandfill = c => { terrain.raise([c], grid.tides.landfillHeight); trees.groundKey++; views.clear(); };
cameraControl.onHome = () => api.frameTown(30);

/** The look the island wears now (view/biomes): everything that reads a palette reads it from here. */
let look: BiomeLook = lookFor(state);
function applyLook(): void {
  look = lookFor(state);
  terrain.setLook(look, grid.tides.scale);
  water.setLook(look, grid.tides.scale);
  applyPalette(look);
  walkers.setLook(look);
  boats.setLook(look);
  trees.setLook(look);
  wildlife.setLook(look);
  fauna.setLook(look);
  effects.setLook(look);
  audio.setLook(look);
}
function syncGround(): void {
  applyLook();
  const mats = grid.materials;
  terrain.reset(grid.island.height, (x, z) => { const i = Math.floor(x), j = Math.floor(z); return i < -SIZE / 2 || i >= SIZE / 2 || j < -SIZE / 2 || j >= SIZE / 2 ? 0 : mats[(i + SIZE / 2) * SIZE + (j + SIZE / 2)]; });
  terrain.raise(state.landfill.map(k => ({ i: Math.floor(k / SIZE) - SIZE / 2, j: (k % SIZE) - SIZE / 2 })), grid.tides.landfillHeight);
  trees.groundKey++;
  views.clear();
}
function adopt(next: SimState): void {
  state = next;
  grid.attach(state);
  syncGround();
  views.clear();
  walkers.clear();
  info.select(null);
  achievements.adopt(state);
  syncView();
}
// The loaded ledger's ground and look, once every view exists (a seeded island, landfill, or another biome).
if (state.landfill.length || state.world.seed !== 0 || state.world.biome !== "tidewater") syncGround();
/** A fresh town on island `seed` (0 = the original island), replacing the active sector's town. */
function newTown(seed = 0): void {
  tutorial.reset();
  adopt(newGame(SEED, seed, state.world.biome).state); // the sector keeps its coast
  save();
}
function load(json: string): void {
  let next: SimState;
  try { next = deserialize(json); } catch { notify(state, "That save is from an older build and can't be loaded"); return; }
  adopt(next);
  save();
}

// ---------- playtest log (opt-in, local) ----------
const playtest = new PlaytestLog();
let playtestNotes = readPlaytestNotes();
function setPlaytest(on: boolean): void {
  writePlaytestEnabled(on);
  if (on) playtest.start(); else playtest.stop();
}
if (readPlaytestEnabled()) playtest.start();
onNotify(msg => playtest.record("warning", state.tide.cycle, state.resources.money, msg));
placement.onPlace = (tool, b, cost) => playtest.record("place", state.tide.cycle, state.resources.money, `${tool} at ${b.cells[0].i},${b.cells[0].j}${cost ? ` · ${Math.round(cost)}$` : ""}`);
placement.onRemove = (b, refund) => playtest.record("remove", state.tide.cycle, state.resources.money, `${b.kind} at ${b.cells[0].i},${b.cells[0].j} · refund ${refund}$`);
const menu = new SaveMenu(document.getElementById("menu")!, {
  cycle: () => state.tide.cycle, islandSeed: () => state.world.seed, newTown,
  sectorName: () => (activeFace !== null ? readMeta(store, activeFace)?.name ?? "An unnamed sea" : "No sea"),
  returnToWorld: () => { void returnToWorld(); },
  playtest: {
    enabled: () => playtest.enabled,
    setEnabled: setPlaytest,
    notes: () => playtestNotes,
    setNotes: text => { playtestNotes = text; writePlaytestNotes(text); },
    exportJson: () => JSON.stringify(playtest.export(playtestNotes), null, 2),
    fileName: () => playtestFileName(),
  },
});
let speed: Speed = 1;
/** The reflections toggle flips the live setting; the quality preset decides what a launch starts with. */
function setReflections(on: boolean): void {
  water.setReflections(on);
}
// ---------- the World (docs/globe) ----------
// A second scene on the same engine: the globe of twelve seas. main.ts owns which scene renders and which DOM
// is shown; the island's loop, tick and autosave pause while the World is up. The island scene stays resident.
let mode: "world" | "island" = "world";
let reducedOverride: boolean | null = null;
const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const reducedMotion = (): boolean => reducedOverride ?? reducedQuery.matches;
const world = new World(engine, canvas, { reducedMotion });
const worldRoot = document.getElementById("world")!;
function faceMeta(face: number): SectorMeta | null { return readMeta(store, face); }
function refreshFace(face: number): void { world.setSector(face, readSector(store, face)); }
for (let f = 0; f < FACES; f++) refreshFace(f);
/** The lanes, the cargo ships at sea and the storms on the globe, from the sectors' metadata and the World ledger. */
function refreshLanes(): void {
  if (!LANES_ENABLED) return;
  const L = readLedger(store);
  world.setLanes(lanesFromMetas(listMetas(store)), shipsAtSea(L).map(l => ({ from: l.from, to: l.to })), L.storms.map(s => ({ face: s.face, next: s.next })));
}
refreshLanes();
/** Seconds the World has been up since its last settlement (its clock: a settlement every TIDE_PERIOD). */
let worldIdle = 0;
/**
 * The World settlement runs as a job, a slice of at most WORLD_SLICE_MS a frame (sim/lanes.ts worldJob: it yields
 * after each stored sea), so a peak never stalls the frame however many seas are built. Anything else that reads or
 * writes the stored seas or the World ledger finishes the running job first.
 */
let worldRun: { job: Generator<void, WorldSettlement, void>; done: (out: WorldSettlement) => void } | null = null;
const WORLD_SLICE_MS = 4;
function startWorldJob(active: number | null, done: (out: WorldSettlement) => void): void {
  finishWorldJob();
  const job = active !== null ? worldJob(store, active, state, grid) : worldJob(store, null, null, null);
  if (job) worldRun = { job, done };
}
function stepWorldJob(budgetMs = WORLD_SLICE_MS): void {
  const t0 = performance.now();
  while (worldRun) {
    const r = worldRun.job.next();
    if (r.done) { const run = worldRun; worldRun = null; run.done(r.value); return; }
    if (performance.now() - t0 >= budgetMs) return;
  }
}
function finishWorldJob(): void { stepWorldJob(Infinity); }
window.addEventListener("pagehide", () => finishWorldJob());
/** One World cycle while the World itself is up: every built sea settles, cargo sails, the globe and the card follow. */
function settleIdleWorld(): void {
  startWorldJob(null, () => {
    refreshLanes();
    if (mode === "world" && worldUi.shownFace !== null && faceMeta(worldUi.shownFace)) worldUi.showCard(worldUi.shownFace, faceMeta(worldUi.shownFace));
    worldUi.refreshTrade();
  });
}
/** One World cycle at the played sea's peak: its changes (cargo landed and loaded) are saved when the job lands. */
function settleAtPeak(): void {
  const face = activeFace;
  if (face === null) return;
  startWorldJob(face, () => { if (activeFace === face) save(); });
}
function goodsLine(g: Partial<Record<GoodId, number>> | undefined): string {
  const parts = Object.entries(g ?? {}).filter(([, u]) => (u as number) >= 1).map(([k, u]) => `${Math.round(u as number)} ${GOODS[k as GoodId].name}`);
  return parts.length ? parts.join(", ") : "nothing";
}
/** A built sea's card: its lanes (the neighbours they reach), what the last World tide landed and loaded. */
function cardTrade(face: number): CardTrade | null {
  if (!LANES_ENABLED) return null;
  const metas = listMetas(store);
  const lanes = lanesFromMetas(metas).filter(([a, b]) => a === face || b === face).map(([a, b]) => metas[a === face ? b : a]!.name);
  const last = readLedger(store).last[face];
  return {
    lanes: lanes.length ? lanes.join(", ") : metas[face]?.harbor ? "none: no harbor next door" : "none: build a harbor",
    imports: goodsLine(last?.imports) + (last?.arrived ? ` · ${last.arrived} settlers` : ""),
    exports: goodsLine(last?.exports) + (last?.left ? ` · ${last.left} left` : ""),
  };
}
/** The Trade panel: every lane, what is at sea, the company's next calls and its prices, the storms. */
function tradePanel(): TradePanel {
  const metas = listMetas(store);
  const name = (f: number) => metas[f]?.name ?? "open sea";
  const L = readLedger(store);
  const lanes = lanesFromMetas(metas).map(([a, b]) => `${name(a)} ⇄ ${name(b)}`);
  const atSea = shipsAtSea(L).map(s => `${name(s.from)} → ${name(s.to)}: ${[goodsLine(s.goods) === "nothing" ? "" : goodsLine(s.goods), s.people ? `${s.people} settlers` : ""].filter(Boolean).join(" · ")}`);
  const company = Object.entries(L.company.visits).map(([key, visit]) => `Calls next at ${name(visit)} (its route: ${key.split("-").map(f => name(Number(f))).join(", ")})`);
  const slid = Object.entries(L.company.sold).filter(([, u]) => (u as number) >= 1).map(([g, u]) => `${GOODS[g as GoodId].name} ${Math.round(100 / (1 + (u as number) / COMPANY_SLIDE_UNITS))}%`);
  if (slid.length) company.push(`Its prices after what it bought lately: ${slid.join(", ")}`);
  const storms = L.storms.map(s => `A storm over ${name(s.face)}, bound for ${name(s.next)}`);
  return { lanes, atSea, company, storms };
}
function download(name: string, text: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
/** A fresh town on a face (not entered): island `seed`, named, on the chosen coast (an uncharted one falls back to Tidewater). */
function newSector(face: number, seed: number, name: string, biome: Biome = "tidewater"): SectorMeta {
  finishWorldJob();
  const coast: Biome = biomeAllowed(face, biome) ? biome : "tidewater";
  const meta = writeSector(store, face, newGame(SEED, seed, coast).state, { name: name.trim() || defaultName(store), biome: coast });
  refreshFace(face);
  return meta;
}
async function importSectorFile(file: File, face: number | null): Promise<void> {
  const text = await file.text();
  finishWorldJob();
  let target = face !== null && !faceMeta(face) ? face : listMetas(store).findIndex(m => !m);
  if (face !== null && faceMeta(face)) {
    const ok = await confirmDialog(`Replace ${faceMeta(face)!.name} with the imported sea?`, { ok: "Replace", danger: true });
    if (!ok) return;
    target = face;
  }
  if (target < 0) { await noticeDialog("Every sea has a town; clear one first."); return; }
  try {
    const meta = importSector(store, target, text);
    refreshFace(target);
    worldUi.showCard(target, meta);
    worldUi.setNotice(`${meta.name} imported.`);
  } catch (e) {
    await noticeDialog(`That file isn't a Tiny Tides sea (${(e as Error).message}).`);
  }
}
const worldUi = new WorldUi(worldRoot, {
  enter: face => { void enterSector(face); },
  begin: (face, seed, biome, name) => { newSector(face, seed, name, biome); void enterSector(face); },
  rename: async face => {
    const m = faceMeta(face);
    if (!m) return;
    const name = await promptDialog("Name this sea", m.name, { ok: "Rename" });
    if (name === null) return;
    renameSector(store, face, name);
    if (face === activeFace) hud.setTitle(faceMeta(face)?.name ?? name);
    worldUi.showCard(face, faceMeta(face));
  },
  remove: async face => {
    const m = faceMeta(face);
    if (!m) return;
    const ok = await confirmDialog(`Clear ${m.name}? The town on it is gone for good.`, { ok: "Clear the sea", danger: true });
    if (!ok || mode !== "world") return; // the World's actions only land in the World
    finishWorldJob();
    deleteSector(store, face);
    forgetFace(store, face);
    refreshLanes();
    if (activeFace === face) activeFace = readActive(store);
    refreshFace(face);
    worldUi.showCard(face, null);
  },
  exportSector: face => {
    const json = exportSector(store, face);
    const m = faceMeta(face);
    if (json && m) download(`tinytides-${m.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`, json);
  },
  importFile: (file, face) => { void importSectorFile(file, face); },
  preview: (face, seed, biome) => world.setPreview(face, seed, biome),
  trade: LANES_ENABLED ? face => cardTrade(face) : undefined,
  tradePanel: LANES_ENABLED ? () => tradePanel() : undefined,
  defaultName: () => defaultName(store),
});
/** The framing the island shows first: the town's centroid at Home's distance (docs/globe/hero.md). */
function townFraming(): Framing {
  let x = 0, z = 0, n = 0;
  for (const b of Object.values(state.buildings)) for (const c of b.cells) { x += c.i + 0.5; z += c.j + 0.5; n++; }
  return { cx: n ? x / n : 0, cz: n ? z / n : 0, targetY: 0.6, radius: LANDING_DIST, alpha: -0.8, beta: 0.95 };
}

// ---------- the hand-over between the World and the island ----------
// A dive and a return are one camera path, the World's flight. While the town is near, the island's own camera
// stands where the flight camera stands (in the face's frame), and the two scenes are dissolved into each other
// across HANDOVER_FAR..HANDOVER_NEAR of distance to the town: the World is drawn and copied into the veil (a 2D
// canvas over the game canvas), then the island is drawn under it. The coarse miniature never fills the screen,
// and nothing cuts. Reduced motion and `instant` keep the cuts.
const LANDING_DIST = 30;
const HANDOVER_FAR = 90, HANDOVER_NEAR = 40;
const DIVE_SECONDS = 1.8, RETURN_SECONDS = 1.6;
const veil = document.createElement("canvas");
veil.id = "veil";
veil.hidden = true;
canvas.after(veil);
const veilCtx = veil.getContext("2d")!;
let handover: { face: number; worldShare: number } | null = null;

/** One frame of a dive or a return: the flight moves on, and the scenes its distance to the town calls for are drawn. */
function handoverFrame(dt: number): void {
  const h = handover!;
  world.stepFlight();
  const pose = world.flightInFace(h.face);
  const rel = pose ? pose.position.subtract(pose.target) : null;
  const d = rel ? rel.length() : Infinity;
  const w = smoothstep(HANDOVER_NEAR, HANDOVER_FAR, d); // the World's share of the picture
  h.worldShare = w;
  if (w > 0) world.render(dt);
  if (w >= 1 || !pose || !rel) { veil.hidden = true; return; }
  if (w > 0) {
    if (veil.width !== canvas.width || veil.height !== canvas.height) { veil.width = canvas.width; veil.height = canvas.height; }
    veilCtx.clearRect(0, 0, veil.width, veil.height);
    veilCtx.drawImage(canvas, 0, 0);
    veil.style.opacity = String(w);
    veil.hidden = false;
  } else veil.hidden = true;
  cameraControl.follow(pose.target.x, pose.target.z, d, Math.atan2(rel.z, rel.x), Math.acos(Math.max(-1, Math.min(1, rel.y / d))));
  // The island's fog is set for a camera at play distances; further out it would wash the island out against the
  // miniature it is dissolving with, so it is pushed back by the extra distance, and is exactly itself on landing.
  setIslandFog(Math.max(0, d - LANDING_DIST));
  syncView();
  scene.render();
}
let fogExtra = 0, haze = 0;
function setIslandFog(extra: number): void {
  fogExtra = extra;
  applyIslandFog();
}
/** The island's fog distances: pushed back during the dive's hand-over, pulled in by a coast's haze (a sandstorm). */
function applyIslandFog(): void {
  const near = (FOG_NEAR + fogExtra) * (1 - HAZE_NEAR * haze), far = (FOG_FAR + fogExtra) * (1 - HAZE_FAR * haze);
  terrain.material.setFloat("fogNear", near).setFloat("fogFar", far);
  water.material.setFloat("fogNear", near).setFloat("fogFar", far);
  // The pieces, trees and boats take the same haze through the scene fog, only while there is haze.
  const mode = haze > 0 ? Scene.FOGMODE_LINEAR : Scene.FOGMODE_NONE;
  if (scene.fogMode !== mode) scene.fogMode = mode;
  scene.fogStart = near; scene.fogEnd = far;
}
/** The island's HUD fades in as the dive lands (it was hidden with the World up). */
function arrive(): void {
  document.body.classList.remove("arriving");
  void document.body.offsetWidth;
  document.body.classList.add("arriving");
  window.setTimeout(() => document.body.classList.remove("arriving"), 600);
}
function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
function islandFraming(): Framing {
  const p = cameraControl.pose;
  return { cx: p.x, cz: p.z, targetY: 0.6, radius: p.dist, alpha: p.yaw, beta: p.beta };
}
// A dialog belongs to the scene it was opened in: a switch cancels it, so a confirm can never land on the other
// scene (a "Clear the sea?" answered from its own island would delete the ground under the player).
function showWorld(): void {
  mobile?.reset();
  mode = "world";
  document.body.dataset.mode = "world";
  worldRoot.hidden = false;
  cameraControl.enabled = false;
  placement.enabled = false;
  menu.toggle(false);
  settings.toggle(false);
  info.select(null);
  closeDialog();
}
function showIsland(): void {
  mode = "island";
  document.body.dataset.mode = "island";
  worldRoot.hidden = true;
  cameraControl.enabled = true;
  placement.enabled = true;
  closeDialog();
}
let transition: Promise<void> | null = null;
/** The dive: adopt the sector's town in the resident island, fly the World camera into its face, cut, settle. */
async function enterSector(face: number, opts: { instant?: boolean } = {}): Promise<boolean> {
  if (transition || mode !== "world" || dialogOpen()) return false;
  finishWorldJob();
  const rec = readSector(store, face);
  if (!rec) return false;
  const run = async () => {
    activeFace = face;
    writeActive(store, face);
    adopt(rec.state);
    hud.setTitle(rec.meta.name);
    if (LANES_ENABLED) applyPending(store, face, state, grid); // what the World sent while it was away (an eruption's wave)
    if (rec.state.tide.cycle === 0) tutorial.reset(); // a fresh sea gets the walkthrough, whatever an earlier town did
    const framing = townFraming();
    const instant = !!opts.instant || reducedMotion();
    worldRoot.classList.add("fading");
    if (!instant) handover = { face, worldShare: 1 };
    try { await world.flyTo(face, framing, instant ? 0 : DIVE_SECONDS); } finally { handover = null; veil.hidden = true; setIslandFog(0); }
    cameraControl.jumpTo(framing.cx, framing.cz, framing.radius, framing.alpha, framing.beta);
    showIsland();
    if (!instant) arrive();
    worldRoot.classList.remove("fading");
    syncView();
    save();
  };
  transition = run();
  try { await transition; } finally { transition = null; }
  return true;
}
/** The return: save the town into its sector, refresh its miniature, cut to the World at the same framing, fly out. */
async function returnToWorld(opts: { instant?: boolean } = {}): Promise<boolean> {
  if (transition || mode !== "island") return false;
  // A town with no sea to save into (its sea was cleared under it) still gets back to the World: a cut.
  const face = activeFace ?? world.frontFace;
  const homeless = activeFace === null;
  finishWorldJob();
  const run = async () => {
    if (!homeless) { save(); refreshFace(face); }
    refreshLanes();
    worldIdle = 0;
    const framing = islandFraming();
    const instant = homeless || !!opts.instant || reducedMotion();
    showWorld();
    worldUi.hideCard();
    if (!instant) { handover = { face, worldShare: 0 }; worldRoot.classList.add("fading"); }
    try { await world.flyBack(face, framing, instant ? 0 : RETURN_SECONDS); } finally { handover = null; veil.hidden = true; setIslandFog(0); worldRoot.classList.remove("fading"); }
    cameraControl.jumpTo(framing.cx, framing.cz, framing.radius, framing.alpha, framing.beta); // the island's camera as the player left it
    worldUi.showCard(face, faceMeta(face));
  };
  transition = run();
  try { await transition; } finally { transition = null; }
  return true;
}
// Pointer on the globe: hover lifts a face and opens its card after a short intent delay; a still click dives
// into a built face (or opens the new-sector card on an empty one); a drag spins the globe (a trackball under
// the pointer, with inertia); two fingers are the camera's pinch zoom, not a spin.
let hoverTimer = 0, hoverCandidate: number | null = null;
let worldDown: { x: number; y: number; lastX: number; lastY: number; spinning: boolean } | null = null;
let worldPointers = 0;
const DRAG_DEAD_ZONE = 5;
canvas.addEventListener("pointermove", e => {
  if (mode !== "world" || transition) return;
  if (worldDown && (e.buttons & 1) && worldPointers === 1) {
    const dx = e.clientX - worldDown.lastX, dy = e.clientY - worldDown.lastY;
    if (!worldDown.spinning && Math.hypot(e.clientX - worldDown.x, e.clientY - worldDown.y) > DRAG_DEAD_ZONE) worldDown.spinning = true;
    if (worldDown.spinning) world.drag(dx, dy);
    worldDown.lastX = e.clientX; worldDown.lastY = e.clientY;
    return;
  }
  const f = world.pickFace(e.clientX, e.clientY);
  canvas.classList.toggle("hovering", f !== null);
  if (f !== world.hover) world.setHover(f);
  if (f !== null && f !== hoverCandidate) {
    hoverCandidate = f;
    clearTimeout(hoverTimer);
    hoverTimer = window.setTimeout(() => { if (mode === "world" && !transition && hoverCandidate === f && !worldDown) worldUi.showCard(f, faceMeta(f)); }, 120);
  }
  if (f === null) hoverCandidate = null;
});
canvas.addEventListener("pointerdown", e => {
  worldPointers++;
  if (mode !== "world" || e.button !== 0) return;
  worldDown = { x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, spinning: false };
  canvas.classList.add("dragging");
  canvas.setPointerCapture(e.pointerId);
  world.grab();
});
const worldPointerEnd = (e: PointerEvent) => {
  worldPointers = Math.max(0, worldPointers - 1);
  canvas.classList.remove("dragging");
  if (mode !== "world" || !worldDown || e.button !== 0) return;
  const down = worldDown;
  worldDown = null;
  world.release();
  if (down.spinning || transition || e.type === "pointercancel") return;
  const f = world.pickFace(e.clientX, e.clientY);
  if (f === null) return;
  const m = faceMeta(f);
  if (m && worldUi.shownFace === f) { void enterSector(f); return; }
  worldUi.showCard(f, m);
};
canvas.addEventListener("pointerup", worldPointerEnd);
canvas.addEventListener("pointercancel", worldPointerEnd);
canvas.addEventListener("pointerleave", () => { if (mode === "world" && !worldDown && !transition) { world.setHover(null); canvas.classList.remove("hovering"); hoverCandidate = null; } });

// ---------- quality presets ----------
// Remembered in localStorage; on the first launch a PROBE_SECONDS frame-rate probe at High picks one.
let quality: Quality = readQuality() ?? "high";
let qualityNote = readQuality() ? "" : "Measuring the frame rate for a few seconds…";
let probe: { frames: number; t0: number } | null = readQuality() ? null : { frames: 0, t0: performance.now() };
const settings = new SettingsPanel(document.getElementById("settings")!, { current: () => quality, apply: q => applyQuality(q), note: () => qualityNote });
function applyQuality(q: Quality): void {
  quality = q;
  const c = PRESETS[q];
  pipe.bloomEnabled = c.bloom;
  water.setReflections(c.reflections);
  water.setCaustics(c.caustics);
  walkers.cap = c.walkers;
  wildlife.showGulls = c.gulls;
  world.setQuality(c.bloom, q);
  writeQuality(q);
  settings.render();
}
function probeFrame(): void {
  if (!probe) return;
  probe.frames++;
  const s = (performance.now() - probe.t0) / 1000;
  if (s < PROBE_SECONDS) return;
  const fps = probe.frames / s;
  probe = null;
  const q = qualityForFps(fps);
  qualityNote = `Chosen at first launch: ${QUALITY_LABEL[q]} (${fps.toFixed(0)} fps measured)`;
  applyQuality(q);
  notify(state, `Quality set to ${QUALITY_LABEL[q]} (${fps.toFixed(0)} fps measured) — change it under Quality…`);
}
applyQuality(quality);
const speedControls = new SpeedControls(document.getElementById("speed")!, {
  onSpeed: s => { speed = s; },
  onMenu: () => menu.toggle(),
  onMute: () => audio.setMuted(!audio.muted),
  onReflections: () => setReflections(!water.reflections),
  onSettings: () => settings.toggle(),
});
/** Phones (portrait): the map-first layout and touch placement (ui/mobile.ts); null on everything else. */
const mobile: MobileControls | null = phoneMode()
  ? new MobileControls(canvas, {
    hudRoot: document.getElementById("hud")!, speedRoot: document.getElementById("speed")!, tutorialRoot: document.getElementById("tutorial")!,
    placement, camera: cameraControl, showCategory: cat => hud.showCategory(cat as Parameters<typeof hud.showCategory>[0]),
    buildingAt: c => grid.buildingAt(c), select: b => info.select(b),
  })
  : null;
info.onRemove = b => placement.remove(b.cells[0]);
info.onUpgrade = b => { if (upgradeBuilding(state, b)) playtest.record("upgrade", state.tide.cycle, state.resources.money, `${b.kind} to level ${b.level} at ${b.cells[0].i},${b.cells[0].j}`); };
/** A sewer tool in hand (laying pipe, or an outfall or treatment plant) shows the Sewers overlay until it is put down. */
let sewerView: { was: OverlayKind | null } | null = null;
function syncSewerView(): void {
  const tool = mobile && !mobile.armed ? null : placement.tool;
  const on = tool !== null && (PIPE_TOOLS.has(tool) || tool === "outfall" || tool === "treatmentPlant") && document.body.dataset.mode === "island";
  if (on && !sewerView) { sewerView = { was: overlays.kind }; overlays.show("sewer"); hud.markOverlay("sewer"); }
  else if (!on && sewerView) {
    // Put back what was showing, unless the player picked another overlay meanwhile.
    if (overlays.kind === "sewer") { overlays.show(sewerView.was); hud.markOverlay(sewerView.was); }
    sewerView = null;
  }
}

window.addEventListener("keydown", e => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || dialogOpen()) return;
  if (mode === "world") {
    if (transition) return;
    if (e.key === "ArrowLeft") world.step(-1, 0);
    else if (e.key === "ArrowRight") world.step(1, 0);
    else if (e.key === "ArrowUp") world.step(0, -1);
    else if (e.key === "ArrowDown") world.step(0, 1);
    else if (e.key === "Enter") {
      const f = worldUi.shownFace ?? world.frontFace;
      if (worldUi.shownFace !== f) worldUi.showCard(f, faceMeta(f));
      else if (faceMeta(f)) void enterSector(f);
      else worldUi.begin(f);
    } else if (e.key === "Escape") worldUi.hideCard();
    else return;
    e.preventDefault();
    return;
  }
  // Escape closes what is open, top down; at the island's top level it returns to the World (docs/globe/experience.md).
  if (e.key === "Escape") { if (settings.open) settings.toggle(false); else if (menu.open) menu.toggle(false); else if (info.selectedId !== null) info.select(null); else void returnToWorld(); return; }
  if (e.key === " ") { speed = speed === 0 ? 1 : 0; e.preventDefault(); return; }
  if (e.key === "]" || e.key === "[") { placement.adjustLift(e.key === "]" ? 1 : -1); e.preventDefault(); return; }
  if ((e.key === "r" || e.key === "R") && placement.rotatable) { placement.rotate(); e.preventDefault(); return; }
  if (cameraControl.keyDown(e.key)) { e.preventDefault(); return; }
  if (hud.key(e.key)) e.preventDefault();
});
window.addEventListener("keyup", e => cameraControl.keyUp(e.key));

let acc = 0;
let viewTime = 0;
let lastLight: Lighting = MORNING;
let stormMix = 0;
let iceMix = 0;
let lastBleachCycle = -1;
/** The ground is redrawn when a lava flow makes land, and again when it cools (the Cinder). */
const landKeyOf = (s: SimState) => s.newLand.length + ":" + (s.biomeState.eruptions ?? 0) + ":" + s.world.seed + s.world.biome;
let lastLandKey = landKeyOf(state);
let bleachShown = false;
let lastFrameTime = 0;

/** Everything the view derives from the ledger for one frame. */
function syncView(): void {
  const frameDt = Math.max(0, Math.min(10, viewTime - lastFrameTime)); // scripted jumps settle in one sync
  lastFrameTime = viewTime;
  const target = state.storm.active ? 1 : 0;
  stormMix += (target - stormMix) * Math.min(1, frameDt / 3);
  // A storm drags the light toward the study's dusk palette; the tsunami crest rides the water shader.
  const hazeNow = stormMix * (biomeFor(state).storm?.fog ?? 0);
  if (Math.abs(hazeNow - haze) > 0.005 || (hazeNow === 0 && haze !== 0)) { haze = hazeNow; applyIslandFog(); }
  const light = computeLighting(Math.max(duskAt(state.time), stormMix * 0.95), dayFraction(state.time), { tint: look.sky.fogTint, mix: look.sky.fogMix + (1 - look.sky.fogMix) * haze * HAZE_TINT });
  lastLight = light;
  if (haze > 0) scene.fogColor.set(light.fog.x, light.fog.y, light.fog.z);
  lights.apply(light);
  terrain.setLighting(light);
  if (look.glow) terrain.setGlow(look.glow.amount * (0.3 + 0.7 * Math.min(1, light.lamp)));
  water.setLighting(light);
  sky.setLighting(light);
  sky.setAurora(look.sky.aurora * (1 - stormMix), viewTime);
  sky.setStars((look.sky.stars ?? 0) * (1 - stormMix));
  // The reef's bleaching reaches the water shader once a cycle (it only changes at the settlement).
  if (landKeyOf(state) !== lastLandKey) { lastLandKey = landKeyOf(state); syncGround(); }
  if (state.tide.cycle !== lastBleachCycle) { lastBleachCycle = state.tide.cycle; if (look.lagoon.mix > 0 || bleachShown) { terrain.setBleach(look.lagoon.mix > 0 ? state.fields.bleach : null); bleachShown = look.lagoon.mix > 0; } }
  const iceTarget = (state.biomeState.seaIce ?? 0) > 0 ? 1 : 0;
  iceMix += (iceTarget - iceMix) * Math.min(1, frameDt / 4);
  water.setIce(iceMix);
  water.setSwell((1 + (STORM_WAVE_AMP * (biomeFor(state).storm?.swell ?? 1) - 1) * stormMix) * (1 - 0.9 * iceMix));
  const ts = state.tsunami;
  water.setCrest(ts.dir, ts.stage === "wave" ? ts.front : -999, ts.stage === "wave" ? grid.tides.waveHeight : 0, WAVE_WIDTH);
  views.sync(state, light.lamp);
  trees.sync(state, stormMix);
  overlays.sync(state);
  boats.sync(state, viewTime);
  ferry.sync(state, viewTime, crossCommuters(state, grid));
  walkers.sync(state, viewTime, ferry.riders());
  effects.sync(state, grid, viewTime);
  // The mountain trembles: the view shivers (not with reduced motion); the target itself never moves.
  const shiver = reducedMotion() ? 0 : effects.shake * TREMOR_SHAKE;
  camera.targetScreenOffset.set(Math.sin(viewTime * 41) * shiver, Math.sin(viewTime * 29 + 1) * shiver);
  ship.sync(state, viewTime);
  cargoShip.sync(state, viewTime);
  wildlife.sync(state, viewTime);
  fauna.sync(state, viewTime);
  pierMarker.sync(state, viewTime);
  cameraControl.setWaterLevel(state.tide.level);
  terrain.update(camera.position, state.tide.level, state.tide.wetLevel);
  water.update(viewTime, camera.position, state.tide.level);
  cameraControl.leftDrag = mobile ? !mobile.drawing : !placement.dragsLine;
  mobile?.update();
  syncSewerView();
  hud.update({ tool: placement.tool, blocker: placement.blocker, warn: placement.warn, line: placement.line, lift: placement.liftable ? placement.lift : null, rotatable: placement.rotatable, stilt: placement.stilt, cost: placement.cost, fate: placement.fate, state });
  info.update(state);
  tutorial.update(state, grid);
  hud.highlight(tutorial.current);
  if (playtest.enabled) {
    playtest.hint(hud.lastHint.text, hud.lastHint.isDefault, state.tide.cycle, state.resources.money);
    playtest.step(tutorial.index, tutorial.title, state.tide.cycle, state.resources.money);
    playtest.sample(state.tide.cycle, state.resources.money, population(state)); // once per cycle (it dedupes)
  }
  markerLabel.update(pierMarker.cell ? api.screenOf(pierMarker.cell.i + 0.5, pierMarker.cell.j + 0.5, state.tide.level + 0.2) : null);
  placement.syncTag();
  achievements.update(state, viewTime);
  speedControls.update(speed, audio.muted, water.reflections);
  audio.sync(state, stormMix, { gulls: wildlife.gullCount });
}

/** The card the launch opens once the entrance has surfaced every sea (docs/globe/hero.md). */
let cardAfterEntrance: number | null = null;
engine.runRenderLoop(() => {
  const realDt = Math.min(engine.getDeltaTime() / 1000, 0.1);
  if (handover) {
    handoverFrame(realDt);
    if (probe) probeFrame();
    return;
  }
  if (mode === "world") {
    // The World's clock: while it is up, every built sea settles once per TIDE_PERIOD (sim/lanes.ts).
    worldIdle += realDt;
    world.laneClock = Math.min(1, worldIdle / TIDE_PERIOD);
    if (LANES_ENABLED && worldIdle >= TIDE_PERIOD && !transition && !worldRun) { worldIdle = 0; settleIdleWorld(); }
    stepWorldJob();
    world.setSelected(worldUi.shownFace);
    world.render(realDt);
    if (cardAfterEntrance !== null && world.entranceDone) { worldUi.showCard(cardAfterEntrance, faceMeta(cardAfterEntrance)); cardAfterEntrance = null; }
    if (probe) probeFrame();
    return;
  }
  cameraControl.update(realDt);
  const frameDt = realDt * speed;
  viewTime += frameDt;
  acc += frameDt;
  while (acc >= SIM_TICK) {
    tick(state, grid);
    acc -= SIM_TICK;
    if (state.tide.peaked) {
      save();
      // The World settles on the sea's peaks while it is played; the sea is saved again when that lands.
      if (LANES_ENABLED) settleAtPeak();
    }
  }
  stepWorldJob();
  if (probe) probeFrame();
  syncView();
  scene.render();
});
window.addEventListener("resize", () => engine.resize());

// ---------- console / test API ----------
const api = {
  get sim() { return state; },
  grid,
  get fields() { return state.fields; },
  ready: false,
  /** Milliseconds from script start to the first ready frame. */
  bootMs: 0,
  setOverlay(kind: OverlayKind | null) {
    overlays.show(kind);
    hud.markOverlay(kind);
  },
  /** Place (and pay for) a building; "boat" buys a boat at the pier under (i, j). Null when blocked. */
  /** Place the tool at (i, j); `rot` is a quarter turn for buildings (omit to face the street). */
  place(type: Tool, i: number, j: number, rot: number | null = null) {
    placement.setTool(type);
    return placement.place({ i, j }, rot);
  },
  remove(i: number, j: number) {
    placement.remove({ i, j });
  },
  /** Raise the building at (i, j) a level (sim/upgrades.ts); false when it can't. */
  upgrade(i: number, j: number) {
    const b = grid.buildingAt({ i, j });
    return !!b && upgradeBuilding(state, b);
  },
  /** Open the info panel on the building at (i, j), or close it. */
  select(i: number, j: number) {
    info.select(grid.buildingAt({ i, j }));
    info.update(state);
  },
  setTide(level: number | null) {
    state.tide.override = level;
  },
  /** Advance the ledger by whole tide cycles in fixed ticks, independent of rendering. */
  advance(cycles: number) {
    advanceCycles(state, grid, cycles);
    viewTime += cycles * TIDE_PERIOD;
    syncView();
  },
  /** Advance to the next time the clock reaches `fraction` of the cycle (0 = high tide, 0.5 = low). */
  advanceTo(fraction: number) {
    const cap = Math.ceil(2 * TIDE_PERIOD / SIM_TICK);
    let prev = cycleFraction(state.tide);
    for (let k = 0; k < cap; k++) {
      tick(state, grid);
      viewTime += SIM_TICK;
      const f = cycleFraction(state.tide);
      const crossed = prev <= fraction ? f >= fraction && f - prev < 0.5 : f >= fraction && f < prev;
      prev = f;
      if (crossed) break;
    }
    syncView();
  },
  /** Tick the ledger for `seconds` of game time (for effects that live between shifts). */
  tickSeconds(seconds: number) {
    const n = Math.round(seconds / SIM_TICK);
    for (let k = 0; k < n; k++) { tick(state, grid); viewTime += SIM_TICK; }
    syncView();
  },
  setSpeed(n: Speed) {
    speed = n;
  },
  /** Cheat for scripted scenarios. */
  grant(money: number, planks = 0, timber = 0) {
    state.resources.money += money;
    state.resources.planks += planks;
    state.resources.timber += timber;
  },
  /** Cheat: `n` units of any registry good (the company's cargo without the ship). */
  grantGood(good: GoodId, n: number) {
    state.resources[good] += n;
  },
  /** View only: aim the camera at the town's centroid for screenshots. */
  frameTown(radius = 22) {
    const bs = Object.values(state.buildings);
    if (!bs.length) return;
    let x = 0, z = 0, n = 0;
    for (const b of bs) for (const c of b.cells) { x += c.i + 0.5; z += c.j + 0.5; n++; }
    cameraControl.jumpTo(x / n, z / n, radius, -0.8, 0.95);
  },
  /** View only: aim the camera at a world point. */
  frameAt(x: number, z: number, radius = 16, yaw = -0.8, beta = 0.95) {
    cameraControl.jumpTo(x, z, radius, yaw, beta);
  },
  /** The screen position (client pixels) of a world point at height `y`, for pointer-driven checks. Placement
   *  picks against the tool's deck height, so pass that to land on a cell. */
  screenOf(x: number, z: number, y = 0.6) {
    const s = Vector3.Project(new Vector3(x, y, z), Matrix.Identity(), scene.getTransformMatrix(), camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()));
    const k = engine.getHardwareScalingLevel();
    const r = canvas.getBoundingClientRect();
    return { x: s.x * k + r.left, y: s.y * k + r.top };
  },
  /** Rendered ground height (landfill included) at a world point. */
  terrainHeight: (x: number, z: number) => terrain.heightAt(x, z),
  /** The ground point under a screen position (client pixels), for camera checks. */
  groundAt(clientX: number, clientY: number) {
    const g = cameraControl.groundAt(clientX, clientY);
    return g ? { x: g.x, z: g.z } : null;
  },
  /** Read-only view probes for the smoke scenario. */
  view: {
    boats: () => boats.poses,
    walkers: () => walkers.count,
    swimmers: () => walkers.swimmerCount(state),
    fins: () => effects.finCount,
    ship: () => ship.pose,
    burning: () => effects.burning,
    dusk: () => duskAt(state.time),
    sky: () => ({ day: dayFraction(state.time), sun: { x: lastLight.skySun.x, y: lastLight.skySun.y, z: lastLight.skySun.z }, moon: lastLight.moon, night: lastLight.night, lit: { x: lastLight.sunDir.x, y: lastLight.sunDir.y, z: lastLight.sunDir.z } }),
    stormMix: () => stormMix,
    /** A coast's storm haze this frame (the sandstorm), 0..1; the night market's crowd. */
    haze: () => haze,
    crowd: () => walkers.nightCrowd,
    drawCalls: () => scene.getActiveMeshes().length,
    audio: () => ({ started: audio.started, state: audio.state, muted: audio.muted, cries: audio.cries, hammers: audio.hammers, bells: audio.bells, horns: audio.horns, creaks: audio.creaks, chirps: audio.chirps, frogs: audio.frogs }),
    netFloats: () => ({ count: effects.netFloatCount, y: effects.netFloatY }),
    personScale: () => PERSON_SCALE,
    porters: () => ({ now: walkers.porters, spawned: walkers.portersSpawned }),
    reflections: () => water.reflections,
    quality: () => ({ quality, bloom: pipe.bloomEnabled, reflections: water.reflections, caustics: water.caustics, walkersCap: walkers.cap, gulls: wildlife.showGulls, note: qualityNote, probing: probe !== null }),
    chunks: () => views.chunkCount,
    caustics: () => water.caustics,
    gulls: () => wildlife.gullCount,
    crabs: () => wildlife.crabCount,
    /** Every fauna kit's live count (the coast's picks). */
    fauna: () => ({ gulls: wildlife.gullCount, crabs: wildlife.crabCount, seals: wildlife.sealCount, puffins: wildlife.puffinCount, whales: wildlife.whaleCount, turtles: wildlife.turtleCount, shoals: wildlife.shoalCount, ...fauna.counts } as Record<string, number>),
    /** What the view shows of the coast: the look in use, sea ice, the aurora, the hatching's dark lanterns, the bleached count. */
    biome: () => ({ look: look.id, ice: iceMix, aurora: look.sky.aurora, hatching: hatching(state), lanterns: views.lanternCounts, bleached: state.biomeState.bleached ?? 0, palms: look.trees.kit, boat: look.boat, hat: look.walker.hat, house: look.house, stars: look.sky.stars ?? 0 }),
    /** The mountain (the Cinder): steam puffs, ash flakes, the shiver, the lava's glow this frame. */
    mountain: () => ({ steam: effects.steamCount, ash: effects.ashCount, shake: effects.shake, glow: look.glow ? look.glow.amount : 0 }),
    ferry: () => ferry.pose,
    /** The lanes' cargo ship in this sea, when it is in view. */
    cargoShip: () => cargoShip.pose,
    ferryTerminals: () => { const t = ferryTerminals(grid); return t ? { harbor: t.harbor.id, isle: t.isle.map(b => b.id) } : null; },
    commuters: () => crossCommuters(state, grid),
    riders: () => ferry.riders().length,
    isleOpen: () => grid.isleOpen(),
    island: () => { const i = grid.island; return { seed: i.seed, noiseSeed: i.noiseSeed, rerolls: i.rerolls, stats: i.stats }; },
    achievementsShown: () => achievements.shown.slice(),
    camera: () => cameraControl.pose,
    category: () => hud.category,
    pierMarker: () => pierMarker.cell,
    hint: () => document.querySelector("#hud .hint")?.textContent ?? "",
    /** How many homes wear each roof shape. */
    roofs: () => {
      const out: Record<string, number> = { pyramid: 0, gable: 0, hipped: 0 };
      for (const b of Object.values(state.buildings)) if (BUILDINGS[b.kind].residents > 0) out[roofShape(b)]++;
      return out;
    },
  },
  /** The reflections toggle (live; the quality preset sets the launch state). */
  setReflections,
  /** Apply and remember a quality preset. */
  setQuality: applyQuality,
  /** The playtest log: switch it, read the export (with the notes the menu holds). */
  playtest: { enable: setPlaytest, export: () => playtest.export(playtestNotes), get enabled() { return playtest.enabled; } },
  /** Why the current tool can't go at (i, j), or null when it can. */
  blockerAt(type: Tool, i: number, j: number) {
    placement.setTool(type);
    return placement.check({ i, j });
  },
  /** The district of the building at (i, j), if any. */
  district(i: number, j: number) {
    const b = grid.buildingAt({ i, j });
    return b ? districtOf(grid, b) : null;
  },
  /** Caustics on/off (for A/B checks; on by default). */
  setCaustics(on: boolean) { water.setCaustics(on); },
  /** Mean brightness (0–255) of a viewport rectangle in the next rendered frame; (x, y) from the bottom-left. */
  async brightness(x: number, y: number, w: number, h: number): Promise<number> {
    const px = await new Promise<ArrayBufferView>(res => scene.onAfterRenderObservable.addOnce(() => { void engine.readPixels(x, y, w, h).then(res); }));
    const a = px as Uint8Array;
    let sum = 0;
    for (let i = 0; i < a.length; i += 4) sum += 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
    return sum / (a.length / 4);
  },
  orderPlanks() {
    return orderPlanks(state);
  },
  /** Queue ORDER_SIZE of any good the company carries here (the harbor panel's buttons, without the click). */
  orderGood(good: GoodId, count?: number) {
    return orderGood(state, good, count);
  },
  takeLoan() {
    return takeLoan(state);
  },
  /** Play one gull cry (audio check). */
  audioCry() { audio.cry(); },
  /** Set fire to the building at (i, j). */
  ignite(i: number, j: number) {
    const b = grid.buildingAt({ i, j });
    if (b) ignite(state, b);
  },
  /** Force the weather: a storm through this cycle, or the tsunami sequence now. */
  /** Force a coast's hazard or moment (the smoke): advances the clock to it, or starts it, and syncs the view. */
  forceBiome(event: string) {
    const cycle0 = state.tide.cycle;
    const until = (done: () => boolean) => { for (let k = 0; k < 40 && !done(); k++) advanceCycles(state, grid, 1); };
    switch (event) {
      case "whaleSeason": until(() => whaleSeason(state.tide.cycle)); break;
      case "seaIce": until(() => seaIce(state.tide.cycle)); break;
      case "avalanche": startStorm(state, grid); advanceCycles(state, grid, 2); break;
      case "hatching": until(() => hatching(state)); break;
      case "bleach": {
        const lagoon = materialCode("lagoon");
        const emitters: { k: number; rate: number }[] = [];
        for (let k = 0; k < grid.materials.length; k++) if (grid.materials[k] === lagoon) { state.fields.pollution[k] = 0.6; if (k % 7 === 0) emitters.push({ k, rate: 0.02 }); }
        state.emitters = emitters;
        advanceCycles(state, grid, 3);
        break;
      }
      case "cyclone": startStorm(state, grid); break;
      default: {
        // The later coasts name their own moments (Biome.force): the king tide, the eruption, the drought…
        const own = biomeFor(state).force?.[event];
        if (!own) throw new Error(`${state.world.biome} has no moment called ${event}`);
        own(state, grid);
      }
    }
    viewTime += (state.tide.cycle - cycle0) * TIDE_PERIOD;
    syncView();
    return { event, cycle: state.tide.cycle, biomeState: { ...state.biomeState }, storm: state.storm.active, damaged: Object.values(state.buildings).filter(b => b.damaged).length, log: state.log.slice(-2) };
  },
  forceStorm() {
    startStorm(state, grid);
    syncView();
  },
  forceTsunami() {
    startTsunami(state, grid);
    syncView();
  },
  save,
  load,
  newTown,
  // ---- the World ----
  /** Which scene is up. */
  get mode() { return mode; },
  /** A fresh town on face `n` (island `seed`, named), not entered. */
  newSector,
  /** Clear a face without the confirm (the smoke). */
  clearSector(face: number) { finishWorldJob(); deleteSector(store, face); forgetFace(store, face); if (activeFace === face) activeFace = readActive(store); refreshFace(face); refreshLanes(); },
  /** Dive into face `n` (the sector must exist); `instant` skips the flight. Resolves true once the island is up. */
  enterSector,
  /** Back to the World from the island; `instant` skips the flight. */
  returnToWorld,
  world: {
    faces: () => listMetas(store),
    /** A sea's export (the JSON the card's Export button downloads), for testers whose browser drops downloads. */
    export: (face: number) => exportSector(store, face),
    active: () => activeFace,
    hover: () => world.hover,
    front: () => world.frontFace,
    shownCard: () => worldUi.shownFace,
    /** The sea lanes as drawn (lanes, cargo ships, storm knots), the World ledger, and a World settlement now. */
    lanes: () => ({ lanes: world.lanes.laneCount, ships: world.lanes.shipCount, storms: world.lanes.stormCount }),
    ledger: () => readLedger(store),
    /** A World settlement now: from inside a sea, as at its peak (the sea being played takes part); from the World, as its clock would. */
    settle: () => { if (mode === "island" && activeFace !== null) { settleAtPeak(); finishWorldJob(); syncView(); } else { settleIdleWorld(); finishWorldJob(); } },
    /** Is a World settlement still running a slice a frame? */
    settling: () => worldRun !== null,
    openTrade: () => { const b = document.querySelector<HTMLButtonElement>("#world .trade-toggle"); if (b && !worldUi.tradeOpen) b.click(); return [...document.querySelectorAll("#world .trade-line")].map(e => e.textContent ?? ""); },
    cardText: () => document.querySelector("#world .world-card")?.textContent ?? "",
    /** Open a face's card (as a click would) and return its text. */
    card: (face: number) => { worldUi.showCard(face, faceMeta(face)); return document.querySelector("#world .world-card")?.textContent ?? ""; },
    pose: () => world.pose,
    /** Hold a running dive or return at a fraction of its time (null lets it run on); the hand-over as it stands. */
    holdFlight: (u: number | null) => world.holdFlight(u),
    handover: () => (handover ? { ...handover, veil: !veil.hidden } : null),
    drawCalls: () => world.drawCalls,
    entranceDone: () => world.entranceDone,
    reducedMotion: () => reducedMotion(),
    /** Force reduced motion on or off for a test (null = follow the media query). */
    setReducedMotion: (on: boolean | null) => { reducedOverride = on; },
    /** Faces that show a miniature, with how many roof instances each carries. */
    miniatures: () => world.faces.map(f => ({ face: f.face.index, built: !!f.record, roofs: f.roofs.reduce((n, m) => n + m.thinInstanceCount, 0), level: f.water.position.y })),
    /** The seed preview on an empty face's card: which face, seed and coast, and whether its ground is up. */
    preview: () => { const p = world.previewing; return p ? { ...p, ground: !!world.faces[p.face].terrain, surfaced: world.faces[p.face].surfaced } : null; },
    /** Each face's terminator shade (1 lit, down to the floor turned away) and hover lift. */
    faceLight: () => world.faceLight,
    /** The stage as rendered: the mean colour of a strip along the top and of one beside the globe at its height (0–255), and the stars. */
    async stage() {
      const W = engine.getRenderWidth(), H = engine.getRenderHeight();
      const read = (x: number, y: number, w: number, h: number) => new Promise<number[]>(res => world.scene.onAfterRenderObservable.addOnce(() => { void engine.readPixels(Math.round(x * W), Math.round(H - (y + h) * H), Math.round(w * W), Math.round(h * H)).then(px => { const a = px as Uint8Array; const s = [0, 0, 0]; for (let i = 0; i < a.length; i += 4) { s[0] += a[i]; s[1] += a[i + 1]; s[2] += a[i + 2]; } const n = a.length / 4; res(s.map(v => Math.round(v / n))); }); }));
      const top = await read(0.3, 0.02, 0.4, 0.04);
      const side = await read(0.02, 0.47, 0.1, 0.06);
      return { top, side, stars: world.starCount };
    },
    /** The clouds over a face: how many, the most opaque of them and of the rest, their mean radius. */
    clouds: (face: number) => world.cloudProbe(face),
    /**
     * The coast of a face's miniature as rendered. Pixels around the face's centre are classed sea (water, foam, or
     * flats seen through the water: sand hues darker than 0.68), sand (sand hues, lit and dry), green; then every
     * row and column is walked for runs of sand with sea on one side and green on the other. Returns how many such
     * runs there are and their median width in CSS pixels — the sand band between the foam and the green.
     */
    async coast(face: number, halfPx = 120) {
      const c = api.world.screenOf(face);
      const k = engine.getHardwareScalingLevel();
      const r = canvas.getBoundingClientRect();
      const W = engine.getRenderWidth(), H = engine.getRenderHeight();
      const half = Math.round(halfPx / k);
      const cx = Math.round((c.x - r.left) / k), cy = Math.round((c.y - r.top) / k);
      const x0 = Math.max(0, cx - half), x1 = Math.min(W, cx + half), yTop = Math.max(0, cy - half), yBot = Math.min(H, cy + half);
      const w = x1 - x0, h = yBot - yTop;
      const px = await new Promise<ArrayBufferView>(res => world.scene.onAfterRenderObservable.addOnce(() => { void engine.readPixels(x0, H - yBot, w, h).then(res); }));
      const a = px as Uint8Array;
      const SEA = 1, SAND = 2, GREEN = 3;
      const cls = new Uint8Array(w * h);
      let sand = 0, green = 0, sea = 0;
      for (let i = 0; i < w * h; i++) {
        const R = a[i * 4] / 255, G = a[i * 4 + 1] / 255, B = a[i * 4 + 2] / 255;
        const mx = Math.max(R, G, B), mn = Math.min(R, G, B), v = mx, s = mx > 0 ? (mx - mn) / mx : 0;
        let hue = 0;
        if (mx > mn) { if (mx === R) hue = 60 * (((G - B) / (mx - mn)) % 6); else if (mx === G) hue = 60 * ((B - R) / (mx - mn) + 2); else hue = 60 * ((R - G) / (mx - mn) + 4); }
        if (hue < 0) hue += 360;
        const sandHue = hue >= 20 && hue <= 62 && s >= 0.12;
        const cl = sandHue && v >= 0.68 && s <= 0.55 ? SAND : sandHue ? SEA : hue > 65 && hue < 165 && s > 0.15 && v > 0.2 ? GREEN : (s < 0.12 && v > 0.75) || (hue >= 170 && hue <= 240 && s > 0.12) ? SEA : 0;
        cls[i] = cl;
        if (cl === SAND) sand++; else if (cl === GREEN) green++; else if (cl === SEA) sea++;
      }
      // Runs of sand along rows and columns, bounded by sea on one side and green on the other.
      const widths: number[] = [];
      const walk = (len: number, at: (t: number) => number) => {
        let t = 0;
        while (t < len) {
          if (at(t) !== SAND) { t++; continue; }
          const from = t;
          while (t < len && at(t) === SAND) t++;
          const before = from > 0 ? at(from - 1) : 0, after = t < len ? at(t) : 0;
          if ((before === SEA && after === GREEN) || (before === GREEN && after === SEA)) widths.push((t - from) * k);
        }
      };
      for (let y = 0; y < h; y++) walk(w, x => cls[y * w + x]);
      for (let x = 0; x < w; x++) walk(h, y => cls[y * w + x]);
      widths.sort((p, q) => p - q);
      const median = widths.length ? widths[Math.floor(widths.length / 2)] : 0;
      return { sand, green, sea, runs: widths.length, median, box: [x0, yTop, w, h] };
    },
    lookAt: (face: number) => world.lookAt(face, true),
    hoverFace: (face: number | null) => { world.setHover(face); if (face !== null) worldUi.showCard(face, faceMeta(face)); },
    migrated: () => migrated.map(m => m.name),
    /** Light the World as if it were this hour (null = the real clock), for screenshots and the probe. */
    setClock: (hours: number | null) => { world.clockOverride = hours; },
    clock: () => world.clockOverride,
    /** The pointer-independent way to open a face's card (touch's first tap). */
    showCard: (face: number) => worldUi.showCard(face, faceMeta(face)),
    setNotice: (text: string) => worldUi.setNotice(text),
    /** The screen position (client pixels) of a face's centre, for pointer-driven checks. */
    screenOf: (face: number) => {
      const p = world.faces[face].node.getAbsolutePosition();
      const s = Vector3.Project(p, Matrix.Identity(), world.scene.getTransformMatrix(), world.scene.activeCamera!.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()));
      const k = engine.getHardwareScalingLevel();
      const r = canvas.getBoundingClientRect();
      return { x: s.x * k + r.left, y: s.y * k + r.top };
    },
    /** The World's own Babylon scene (frame counting; nothing in the ledger touches it). */
    scene: world.scene,
    /** The globe's height (0 once the entrance has landed it). */
    globeY: () => world.globeY,
    /** The globe's spin as a quaternion [x, y, z, w]. */
    spin: () => world.spin.asArray(),
    /** The globe's scale as rendered (the determinant of a sea's world matrix): 1 unless the spin has gone wrong. */
    scale: () => { const m = world.faces[1].water; m.computeWorldMatrix(true); return m.getWorldMatrix().determinant(); },
    /** Spin the globe as a pointer drag of (dx, dy) pixels would (without the flick). */
    drag: (dx: number, dy: number) => { world.grab(); world.drag(dx, dy, false); world.release(); },
  },
  /** The ledger as JSON (what a save slot would hold). */
  saveJson: () => serialize(state),
  /** Open or close the town menu. */
  menu: (open: boolean) => menu.toggle(open),
  /** Stress test: extra walkers in the view only. Returns how many were added. */
  stressWalkers(n: number) {
    const added = walkers.spawnExtra(state, n, viewTime);
    syncView();
    return added;
  },
  engine, scene, camera, placement,
};
(window as unknown as { __tidewater: typeof api }).__tidewater = api;
/** The console/test API's shape, for the headless scripts under test/ (a type-only import: they never load this module). */
export type TidewaterApi = typeof api;

// ---------- boot: into the World ----------
showWorld();
world.enter();
const startFace = activeFace ?? 1;
world.lookAt(startFace, true);
cardAfterEntrance = startFace;
if (migrated.length) worldUi.setNotice(`${migrated.length === 1 ? "Your town" : `${migrated.length} towns`} moved onto the World: ${migrated.map(m => m.name).join(", ")}.`);
world.scene.executeWhenReady(() => { api.ready = true; api.bootMs = performance.now() - bootStart; });
