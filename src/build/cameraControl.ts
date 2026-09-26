// Camera: orbit and zoom from Babylon's ArcRotateCamera, plus panning by middle-drag and WASD (right-drag is
// "remove", so it doesn't pan). The target is kept over the island.
import { ArcRotateCamera, Vector3 } from "@babylonjs/core";
import { HALF } from "../sim/grid";

const PAN_SPEED = 14; // world units per second at radius 30, scaled with distance
const MARGIN = 6;

export class CameraControl {
  private readonly keys = new Set<string>();
  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  constructor(private readonly camera: ArcRotateCamera, canvas: HTMLCanvasElement) {
    camera.panningSensibility = 0; // Babylon's own panning stays off; we do it here
    camera.lowerRadiusLimit = 8;
    camera.upperRadiusLimit = 90;
    canvas.addEventListener("pointerdown", e => { if (e.button === 1) { this.dragging = true; this.lastX = e.clientX; this.lastY = e.clientY; e.preventDefault(); } });
    window.addEventListener("pointerup", e => { if (e.button === 1) this.dragging = false; });
    window.addEventListener("pointermove", e => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX, dy = e.clientY - this.lastY;
      this.lastX = e.clientX; this.lastY = e.clientY;
      this.panScreen(-dx, -dy, camera.radius / 600);
    });
    canvas.addEventListener("auxclick", e => { if (e.button === 1) e.preventDefault(); });
  }

  /** Keys pressed while the canvas has focus; returns true when the key is ours. */
  keyDown(key: string): boolean {
    const k = key.toLowerCase();
    if (!"wasd".includes(k) || k.length !== 1) return false;
    this.keys.add(k);
    return true;
  }
  keyUp(key: string): void { this.keys.delete(key.toLowerCase()); }

  /** Move the target in the camera's ground-plane frame. */
  private panScreen(dx: number, dy: number, scale: number): void {
    const forward = this.camera.target.subtract(this.camera.position); forward.y = 0; forward.normalize();
    const right = Vector3.Cross(Vector3.Up(), forward).normalize();
    const t = this.camera.target;
    t.addInPlace(right.scale(dx * scale)).addInPlace(forward.scale(dy * scale));
    this.clamp();
  }

  private clamp(): void {
    const t = this.camera.target;
    t.x = Math.max(-HALF - MARGIN, Math.min(HALF + MARGIN, t.x));
    t.z = Math.max(-HALF - MARGIN, Math.min(HALF + MARGIN, t.z));
  }

  update(dt: number): void {
    if (!this.keys.size) return;
    const speed = PAN_SPEED * (this.camera.radius / 30) * dt;
    let dx = 0, dy = 0;
    if (this.keys.has("w")) dy += 1;
    if (this.keys.has("s")) dy -= 1;
    if (this.keys.has("d")) dx += 1;
    if (this.keys.has("a")) dx -= 1;
    if (dx || dy) this.panScreen(dx * speed, dy * speed, 1);
  }
}
