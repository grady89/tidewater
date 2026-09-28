// Phones in portrait: the map first. A slim strip on top (the resources in one scrolling row, the tide in a line, the
// speed buttons); a bar of build categories at the bottom that opens a one-row drawer of cards; once a card is
// picked, a panel for the piece being placed (a tap pins the ghost, a street tool's drag lays out a run, and nothing
// is built until Place); the building sheet with a Remove button; everything else (the full tide clock, overlays,
// the ledger and loan, Town…, sound, reflections, quality) under More. On only for touch screens the size of a phone
// (or ?mobile=1; ?mobile=0 turns it off); the desktop layout is untouched. View only: it calls what the mouse calls.
import type { CameraControl } from "../build/cameraControl";
import type { Placement } from "../build/placement";
import type { Building, Cell } from "../sim/state";

/** Is this a phone? A coarse pointer on a screen whose short side is a phone's; the URL can force it either way. */
export function phoneMode(): boolean {
  const q = new URLSearchParams(location.search).get("mobile");
  if (q === "1") return true;
  if (q === "0") return false;
  return matchMedia("(pointer: coarse)").matches && Math.min(screen.width, screen.height) <= 600;
}

/** A tap: a finger that lifts within this many pixels and milliseconds of where and when it landed. */
const TAP_SLOP_PX = 10, TAP_MS = 450;

export interface MobileHooks {
  hudRoot: HTMLElement;
  speedRoot: HTMLElement;
  tutorialRoot: HTMLElement;
  placement: Placement;
  camera: CameraControl;
  /** Show a category's cards in the drawer (Hud.showCategory). */
  showCategory: (category: string) => void;
  /** The building on a cell, and opening its sheet. */
  buildingAt: (c: Cell) => Building | null;
  select: (b: Building | null) => void;
}

export class MobileControls {
  /** A card has been picked: taps pin its ghost instead of opening buildings. */
  armed = false;
  private readonly bar: HTMLElement;
  private readonly status: HTMLElement;
  private readonly tideLine: HTMLElement;
  private readonly place: HTMLElement;
  private readonly toolName: HTMLElement;
  private readonly note: HTMLElement;
  private readonly go: HTMLButtonElement;
  private readonly turn: HTMLButtonElement;
  private readonly lower: HTMLButtonElement;
  private readonly raise: HTMLButtonElement;
  private readonly more: HTMLElement;
  private readonly catButtons = new Map<string, HTMLButtonElement>();
  private touch: { id: number; x: number; y: number; t: number; moved: boolean; multi: boolean } | null = null;

  constructor(canvas: HTMLCanvasElement, private readonly h: MobileHooks) {
    document.body.classList.add("mobile");
    h.placement.touchMode = true;

    // The status strip: the tide in a line (tap for the whole clock, under More) and the speed buttons.
    this.status = el("div", "glass", { id: "mstatus" });
    this.tideLine = el("button", "mtide", { type: "button" });
    this.tideLine.addEventListener("click", () => this.setMore(true));
    this.status.append(this.tideLine, h.speedRoot);
    document.body.appendChild(this.status);

    // More: the full tide clock, the overlays, the ledger (trade and loan) from the panel, and the bar's other buttons.
    this.more = el("div", "glass", { id: "mmore" });
    const head = el("div", "menu-head");
    head.innerHTML = `<h2>More</h2>`;
    const close = el("button", "close", { type: "button", "aria-label": "Close" });
    close.textContent = "×";
    close.addEventListener("click", () => this.setMore(false));
    head.appendChild(close);
    this.more.appendChild(head);
    for (const sel of [".tide", ".overlays", ".score"]) { const part = h.hudRoot.querySelector(sel); if (part) this.more.appendChild(part); }
    const extras = el("div", "mrow");
    for (const sel of [".menu-open", ".mute", ".reflections", ".settings-open"]) {
      const b = h.speedRoot.querySelector<HTMLButtonElement>(sel);
      if (b) { extras.appendChild(b); b.addEventListener("click", () => { if (sel === ".menu-open" || sel === ".settings-open") this.setMore(false); }); }
    }
    this.more.appendChild(extras);
    document.body.appendChild(this.more);

    // The bottom bar: the panel's categories, then More.
    this.bar = el("nav", "glass", { id: "mbar", "aria-label": "Build" });
    for (const tab of h.hudRoot.querySelectorAll<HTMLButtonElement>(".tabs button")) {
      const cat = tab.textContent ?? "";
      const b = el("button", "", { type: "button" }) as HTMLButtonElement;
      b.textContent = cat === "Production" ? "Work" : cat;
      b.addEventListener("click", () => this.openCategory(cat));
      this.bar.appendChild(b);
      this.catButtons.set(cat, b);
    }
    const moreButton = el("button", "", { type: "button" }) as HTMLButtonElement;
    moreButton.textContent = "More";
    moreButton.addEventListener("click", () => this.setMore(!document.body.classList.contains("more-open")));
    this.bar.appendChild(moreButton);
    document.body.appendChild(this.bar);

    // Picking a card arms it and closes the drawer.
    h.hudRoot.querySelector(".palette")!.addEventListener("click", e => {
      const card = (e.target as HTMLElement).closest("button");
      if (!card) return;
      this.toolName.textContent = card.querySelector(".name")?.textContent ?? "";
      this.arm(true);
      document.body.classList.remove("drawer-open");
    });

    // The placing panel: what is armed, what the pinned ghost costs or why it can't go, and the buttons.
    this.place = el("div", "glass", { id: "mplace" });
    const top = el("div", "mtool");
    this.toolName = el("span", "mname");
    const disarm = el("button", "mclose", { type: "button", "aria-label": "Stop placing" });
    disarm.textContent = "×";
    disarm.addEventListener("click", () => this.arm(false));
    top.append(this.toolName, disarm);
    this.note = el("div", "mnote");
    const actions = el("div", "mactions");
    this.turn = button("Turn", () => h.placement.rotate());
    this.lower = button("−", () => h.placement.adjustLift(-1), "Lower the deck");
    this.raise = button("+", () => h.placement.adjustLift(1), "Raise the deck");
    const cancel = button("Cancel", () => h.placement.cancel());
    this.go = button("Place", () => { h.placement.confirm(); });
    this.go.classList.add("mgo");
    actions.append(this.turn, this.lower, this.raise, cancel, this.go);
    this.place.append(top, this.note, actions);
    document.body.appendChild(this.place);

    // The walkthrough banner opens and closes on a tap.
    h.tutorialRoot.addEventListener("click", e => { if (!(e.target as HTMLElement).closest("button")) h.tutorialRoot.classList.toggle("open"); });

    // Fingers on the map.
    const at = (e: PointerEvent) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    canvas.addEventListener("pointerdown", e => {
      if (e.pointerType !== "touch" || document.body.dataset.mode !== "island") return;
      if (this.touch) {
        // A second finger: the camera takes the gesture, and a run being drawn is dropped.
        this.touch.multi = true;
        h.placement.touchAbort();
        return;
      }
      const p = at(e);
      this.touch = { id: e.pointerId, x: p.x, y: p.y, t: performance.now(), moved: false, multi: h.camera.fingers > 1 };
      if (this.drawing && !this.touch.multi) h.placement.touchStart(p.x, p.y);
    });
    canvas.addEventListener("pointermove", e => {
      const t = this.touch;
      if (!t || e.pointerId !== t.id || t.multi) return;
      const p = at(e);
      if (Math.hypot(p.x - t.x, p.y - t.y) > TAP_SLOP_PX) t.moved = true;
      if (this.drawing) h.placement.touchMove(p.x, p.y);
    });
    const up = (e: PointerEvent) => {
      const t = this.touch;
      if (!t || e.pointerType !== "touch") return;
      if (e.pointerId !== t.id) { if (h.camera.fingers === 0) this.touch = null; return; }
      this.touch = null;
      if (t.multi || e.type === "pointercancel") return;
      const p = at(e);
      const tap = !t.moved && performance.now() - t.t < TAP_MS;
      if (this.armed) {
        if (this.drawing || tap) h.placement.touchEnd(p.x, p.y);
      } else if (tap) {
        const c = h.placement.cellAt(p.x, p.y);
        h.select(c ? h.buildingAt(c) : null);
      }
    };
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
  }

  /** A street tool is armed: one finger draws with it (the camera pans with two). */
  get drawing(): boolean { return this.armed && this.h.placement.dragsLine; }

  private arm(on: boolean): void {
    this.armed = on;
    document.body.classList.toggle("placing", on);
    if (!on) this.h.placement.cancel();
  }

  private openCategory(cat: string): void {
    const open = document.body.classList.contains("drawer-open");
    const same = this.catButtons.get(cat)?.classList.contains("active");
    this.setMore(false);
    this.h.select(null);
    if (open && same) { document.body.classList.remove("drawer-open"); return; }
    this.h.showCategory(cat);
    document.body.classList.add("drawer-open");
  }

  private setMore(on: boolean): void {
    document.body.classList.toggle("more-open", on);
    if (on) { document.body.classList.remove("drawer-open"); this.h.select(null); }
  }

  /** Leaving the island (to the World) closes everything and puts the tool down. */
  reset(): void {
    document.body.classList.remove("drawer-open", "more-open");
    this.arm(false);
  }

  /** Every frame: the tide line, the category marks, and the placing panel's state. */
  update(): void {
    const p = this.h.placement;
    const value = this.more.querySelector(".tide-value")?.textContent ?? "";
    const sub = this.more.querySelector(".tide-sub")?.textContent ?? "";
    const event = this.more.querySelector(".tide-event")?.textContent ?? "";
    const line = [value, event || sub].filter(Boolean).join(" · ");
    if (this.tideLine.textContent !== line) this.tideLine.textContent = line;
    const drawer = document.body.classList.contains("drawer-open");
    for (const [cat, b] of this.catButtons) {
      const tab = [...this.h.hudRoot.querySelectorAll<HTMLButtonElement>(".tabs button")].find(x => x.textContent === cat);
      b.classList.toggle("active", drawer && !!tab?.classList.contains("active"));
      b.classList.toggle("pulse", !!tab?.classList.contains("pulse"));
    }
    if (!this.armed) return;
    const pending = p.pending;
    let note: string, ok = false, label = "Place";
    if (pending === "run") {
      const n = p.line?.count ?? 0;
      ok = n > 0;
      note = ok ? `${n} piece${n === 1 ? "" : "s"} · ${p.line!.cost}$` : "Nothing can be laid there";
      label = ok ? `Build ${n}` : "Place";
    } else if (pending === "piece") {
      ok = !p.blocker;
      note = p.blocker ?? [`${p.cost}$`, p.warn].filter(Boolean).join(" · ");
    } else note = p.dragsLine ? "Drag along the map to lay it, or tap one spot" : "Tap the map where it goes";
    if (this.note.textContent !== note) this.note.textContent = note;
    this.note.classList.toggle("blocked", !!pending && !ok);
    if (this.go.textContent !== label) this.go.textContent = label;
    this.go.disabled = !pending || !ok;
    this.turn.hidden = !p.rotatable || pending !== "piece";
    this.lower.hidden = this.raise.hidden = !p.liftable || !pending;
  }
}

function el(tag: string, cls: string, attrs: Record<string, string> = {}): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}
function button(label: string, onClick: () => void, title = ""): HTMLButtonElement {
  const b = el("button", "", { type: "button" }) as HTMLButtonElement;
  b.textContent = label;
  if (title) { b.title = title; b.setAttribute("aria-label", title); }
  b.addEventListener("click", onClick);
  return b;
}
