// The camera, in the Cities: Skylines mold. Babylon's ArcRotateCamera is only the container (target, yaw, pitch,
// distance); every input is handled here and Babylon's own inputs are cleared.
//
//   pan     left- or middle-drag grabs the ground (the point under the cursor stays under the cursor); W A S D and
//           the arrow keys move in the view's ground frame, faster the higher the camera sits
//   rotate  right-drag: yaw with horizontal motion, tilt with vertical; Q / E yaw from the keyboard
//   zoom    wheel dollies toward the point under the cursor; R / F from the keyboard. The pitch follows the
//           distance — top-down when far out, low and cinematic when close — plus whatever tilt the player added
//   bounds  the target stays over the map; the camera never dips under the terrain or the water
//   feel    every input sets a goal and the camera eases to it; drags are exact so the ground doesn't slip
//
// Right-click without a drag is still "remove" (placement.ts checks the drag distance), so nothing here fires
// on a plain click. Edge scrolling is off, as the brief asks.
import { ArcRotateCamera, Matrix, Scene, Vector3 } from "@babylonjs/core";
import { HALF } from "../sim/grid";
import { ground as groundHeight } from "../view/ground";

const GROUND_Y = 0.6;              // the plane drags and zooms are measured on (the flats' high-water line)
const MIN_DIST = 6, MAX_DIST = 110;
const MIN_BETA = 0.3, MAX_BETA = 1.42; // from the up axis: small = top-down, large = horizon
const MARGIN = 8;                  // how far past the map edge the target may go
const EASE = 12;                   // 1/s; higher snaps faster
const KEY_PAN = 0.9;               // fraction of the current distance per second
const KEY_YAW = 1.7;               // rad/s
const KEY_ZOOM = 1.1;              // ln(distance) per second
const DRAG_YAW = 0.0065, DRAG_TILT = 0.0045; // rad per pixel
const WHEEL_ZOOM = 0.0011;         // ln(distance) per wheel unit
const CLEARANCE = 0.9;             // camera height above ground or water

/** The pitch the camera settles to at a distance when the player hasn't tilted it: steep far out, low close in. */
function autoBeta(dist: number): number {
  const u = (Math.log(dist) - Math.log(MIN_DIST)) / (Math.log(MAX_DIST) - Math.log(MIN_DIST));
  return 1.18 - 0.68 * Math.max(0, Math.min(1, u));
}
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const ease = (cur: number, goal: number, dt: number) => cur + (goal - cur) * (1 - Math.exp(-EASE * dt));

export interface CameraPose { x: number; z: number; yaw: number; beta: number; dist: number }

export class CameraControl {
  private readonly keys = new Set<string>();
  private drag: { button: number; x: number; y: number; ground: Vector3 | null } | null = null;
  // Goals the camera eases toward; the ArcRotateCamera holds the current values.
  private goal: { x: number; z: number; yaw: number; dist: number };
  private tilt = 0;
  private waterLevel = 0;
  private readonly rect: () => DOMRect;
  /** Set to frame the town on Home. */
  onHome: () => void = () => {};
  /** Whether the left button grabs the ground; off while a tool draws lines with it. */
  leftDrag = true;
  /** Off while the World is shown: the canvas is shared, the pointer belongs to the globe then. */
  enabled = true;

  constructor(private readonly camera: ArcRotateCamera, canvas: HTMLCanvasElement, private readonly scene: Scene) {
    camera.inputs.clear();
    camera.lowerRadiusLimit = MIN_DIST;
    camera.upperRadiusLimit = MAX_DIST;
    camera.lowerBetaLimit = MIN_BETA;
    camera.upperBetaLimit = MAX_BETA;
    this.goal = { x: camera.target.x, z: camera.target.z, yaw: camera.alpha, dist: camera.radius };
    this.tilt = camera.beta - autoBeta(camera.radius);
    this.rect = () => canvas.getBoundingClientRect();

    canvas.addEventListener("pointerdown", e => {
      if (!this.enabled || e.button > 2 || (e.button === 0 && !this.leftDrag)) return;
      this.drag = { button: e.button, x: e.clientX, y: e.clientY, ground: this.groundAt(e.clientX, e.clientY) };
      canvas.setPointerCapture(e.pointerId);
      if (e.button === 1) e.preventDefault();
    });
    canvas.addEventListener("pointermove", e => {
      const d = this.drag;
      if (!d) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      d.x = e.clientX; d.y = e.clientY;
      if (d.button === 2) {
        this.goal.yaw -= dx * DRAG_YAW;
        this.tilt = clamp(this.tilt + dy * DRAG_TILT, MIN_BETA - autoBeta(this.goal.dist), MAX_BETA - autoBeta(this.goal.dist));
        this.camera.alpha = this.goal.yaw; // exact while dragging
      } else if (d.ground) {
        // Grab: move the world so the grabbed point is back under the cursor. Exact, and applied at once.
        const now = this.groundAt(e.clientX, e.clientY);
        if (!now) return;
        this.goal.x += d.ground.x - now.x;
        this.goal.z += d.ground.z - now.z;
        this.clampTarget();
        this.camera.target.x = this.goal.x; this.camera.target.z = this.goal.z;
      }
    });
    const end = (e: PointerEvent) => { if (this.drag && this.drag.button === e.button) this.drag = null; };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", () => { this.drag = null; });
    canvas.addEventListener("auxclick", e => { if (e.button === 1) e.preventDefault(); });
    canvas.addEventListener("wheel", e => {
      if (!this.enabled) return;
      e.preventDefault();
      const units = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 800 : e.deltaY;
      this.zoomAt(Math.exp(units * WHEEL_ZOOM), e.clientX, e.clientY);
    }, { passive: false });
  }

  /** Dolly by `factor` toward the ground point under (clientX, clientY): that point stays under the cursor. */
  private zoomAt(factor: number, clientX: number, clientY: number): void {
    const next = clamp(this.goal.dist * factor, MIN_DIST, MAX_DIST);
    const k = 1 - next / this.goal.dist;
    const g = this.groundAt(clientX, clientY);
    if (g && k !== 0) {
      // The ground point is measured with the current camera, so aim the goal from the current target.
      this.goal.x = this.camera.target.x + (g.x - this.camera.target.x) * k + (this.goal.x - this.camera.target.x);
      this.goal.z = this.camera.target.z + (g.z - this.camera.target.z) * k + (this.goal.z - this.camera.target.z);
      this.clampTarget();
    }
    this.goal.dist = next;
  }

  /** Where the ray through a screen point (CSS pixels, client coordinates) meets the ground plane. */
  groundAt(clientX: number, clientY: number): Vector3 | null {
    const r = this.rect();
    const ray = this.scene.createPickingRay(clientX - r.left, clientY - r.top, Matrix.Identity(), this.camera);
    if (Math.abs(ray.direction.y) < 1e-4) return null;
    const t = (GROUND_Y - ray.origin.y) / ray.direction.y;
    if (t <= 0) return null;
    return ray.origin.add(ray.direction.scale(t));
  }

  /** Keys pressed while the canvas has focus; returns true when the key is ours. */
  private keyDownInner(key: string): boolean {
    const k = key.length === 1 ? key.toLowerCase() : key;
    if (k === "Home") { this.onHome(); return true; }
    if (!KEYS.has(k)) return false;
    this.keys.add(k);
    return true;
  }
  keyUp(key: string): void { this.keys.delete(key.length === 1 ? key.toLowerCase() : key); }

  /** Cut straight to a pose (framing for screenshots, Home). */
  /** Ease the distance to `dist` from wherever the camera is (the dive's settle after the cut). */
  settle(dist: number): void {
    this.goal.dist = clamp(dist, MIN_DIST, MAX_DIST);
  }

  keyDown(key: string): boolean {
    if (!this.enabled) return false;
    return this.keyDownInner(key);
  }

  jumpTo(x: number, z: number, dist: number, yaw: number, beta: number): void {
    this.goal = { x, z, yaw, dist: clamp(dist, MIN_DIST, MAX_DIST) };
    this.clampTarget();
    this.tilt = clamp(beta, MIN_BETA, MAX_BETA) - autoBeta(this.goal.dist);
    this.camera.target.set(this.goal.x, GROUND_Y, this.goal.z);
    this.camera.alpha = yaw; this.camera.radius = this.goal.dist; this.camera.beta = clamp(beta, MIN_BETA, MAX_BETA);
  }

  get pose(): CameraPose {
    return { x: this.camera.target.x, z: this.camera.target.z, yaw: this.camera.alpha, beta: this.camera.beta, dist: this.camera.radius };
  }

  /** The water's current height, so the camera stays above it. */
  setWaterLevel(level: number): void { this.waterLevel = level; }

  private clampTarget(): void {
    this.goal.x = clamp(this.goal.x, -HALF - MARGIN, HALF + MARGIN);
    this.goal.z = clamp(this.goal.z, -HALF - MARGIN, HALF + MARGIN);
  }

  /** Keys move the goals; then the camera eases toward them and is kept out of the ground. */
  update(dt: number): void {
    if (this.keys.size) {
      const yaw = this.camera.alpha;
      // Screen-up on the ground is the direction from the camera to the target.
      // Right is up × forward in Babylon's left-handed frame: (fz, -fx).
      const fx = -Math.cos(yaw), fz = -Math.sin(yaw);
      const rx = fz, rz = -fx;
      let mx = 0, mz = 0;
      if (this.keys.has("w") || this.keys.has("ArrowUp")) { mx += fx; mz += fz; }
      if (this.keys.has("s") || this.keys.has("ArrowDown")) { mx -= fx; mz -= fz; }
      if (this.keys.has("d") || this.keys.has("ArrowRight")) { mx += rx; mz += rz; }
      if (this.keys.has("a") || this.keys.has("ArrowLeft")) { mx -= rx; mz -= rz; }
      const step = KEY_PAN * this.goal.dist * dt;
      this.goal.x += mx * step; this.goal.z += mz * step;
      if (this.keys.has("q")) this.goal.yaw += KEY_YAW * dt;
      if (this.keys.has("e")) this.goal.yaw -= KEY_YAW * dt;
      if (this.keys.has("r")) this.goal.dist = clamp(this.goal.dist * Math.exp(-KEY_ZOOM * dt), MIN_DIST, MAX_DIST);
      if (this.keys.has("f")) this.goal.dist = clamp(this.goal.dist * Math.exp(KEY_ZOOM * dt), MIN_DIST, MAX_DIST);
      this.clampTarget();
    }
    const c = this.camera;
    c.target.x = ease(c.target.x, this.goal.x, dt);
    c.target.z = ease(c.target.z, this.goal.z, dt);
    c.target.y = GROUND_Y;
    c.alpha = ease(c.alpha, this.goal.yaw, dt);
    c.radius = ease(c.radius, this.goal.dist, dt);
    let beta = clamp(autoBeta(c.radius) + this.tilt, MIN_BETA, MAX_BETA);
    // Keep the eye above the ground and the water: steepen the pitch until it clears.
    for (let k = 0; k < 4; k++) {
      const px = c.target.x + c.radius * Math.cos(c.alpha) * Math.sin(beta);
      const pz = c.target.z + c.radius * Math.sin(c.alpha) * Math.sin(beta);
      const floor = Math.max(groundHeight(px, pz), this.waterLevel) + CLEARANCE;
      const py = c.target.y + c.radius * Math.cos(beta);
      if (py >= floor) break;
      beta = clamp(Math.acos(clamp((floor - c.target.y) / c.radius, -1, 1)), MIN_BETA, MAX_BETA);
    }
    c.beta = ease(c.beta, beta, dt);
  }
}

const KEYS = new Set(["w", "a", "s", "d", "q", "e", "r", "f", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
