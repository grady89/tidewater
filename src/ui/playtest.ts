// Playtest instrumentation, local only: an opt-in log (off by default, toggled in the Town menu) of what the player
// did and what the game told them, for the first 30 minutes of a session. Placements and removals with the cycle
// and the purse, every warning and hint shown, the walkthrough's steps with timestamps, and money and population
// once per cycle. "Export playtest log" hands the player a JSON file; the free-text notes go in with it. No
// servers: nothing leaves the machine unless the player sends the file. Pure data; the DOM work is in main.ts.
export const PLAYTEST_KEY = "tidewater.playtest";
export const PLAYTEST_NOTES_KEY = "tidewater.playtest.notes";
export const PLAYTEST_MINUTES = 30;
export const PLAYTEST_VERSION = 1;

export type PlaytestEventType = "place" | "remove" | "upgrade" | "warning" | "hint" | "step" | "note";

export interface PlaytestEvent {
  /** Seconds since the log started. */
  t: number;
  type: PlaytestEventType;
  cycle: number;
  money: number;
  /** What happened: the kind and cell for a placement, the text for a warning or hint, the step for the walkthrough. */
  text: string;
}

export interface PlaytestSample { t: number; cycle: number; money: number; population: number }

export interface PlaytestExport {
  version: number;
  startedAt: string;
  /** Seconds the log ran (capped at PLAYTEST_MINUTES × 60). */
  seconds: number;
  notes: string;
  events: PlaytestEvent[];
  samples: PlaytestSample[];
  summary: { placements: number; removals: number; warnings: number; hints: number; steps: number; cycles: number };
}

export class PlaytestLog {
  private events: PlaytestEvent[] = [];
  private samples: PlaytestSample[] = [];
  private startedAt = 0;
  private startedIso = "";
  private lastHint = "";
  private lastStep = -1;
  private lastCycle = -1;
  enabled = false;

  /** `now` is a clock in milliseconds (performance.now or Date.now); tests hand in their own. */
  constructor(private readonly now: () => number = () => performance.now()) {}

  /** Start (or restart) a session's log. Called when recording is switched on, and at every page load with it on. */
  start(): void {
    this.enabled = true;
    this.events = []; this.samples = [];
    this.startedAt = this.now();
    this.startedIso = new Date().toISOString();
    this.lastHint = ""; this.lastStep = -1; this.lastCycle = -1;
  }

  stop(): void { this.enabled = false; }

  /** Seconds since the log started. */
  get elapsed(): number { return (this.now() - this.startedAt) / 1000; }

  /** Recording, and still inside the first PLAYTEST_MINUTES. */
  get live(): boolean { return this.enabled && this.elapsed <= PLAYTEST_MINUTES * 60; }

  record(type: PlaytestEventType, cycle: number, money: number, text: string): void {
    if (!this.live) return;
    this.events.push({ t: Math.round(this.elapsed * 10) / 10, type, cycle, money: Math.round(money), text });
  }

  /** The HUD's hint line: logged when it changes to something that isn't the default prompt. */
  hint(text: string, isDefault: boolean, cycle: number, money: number): void {
    if (text === this.lastHint) return;
    this.lastHint = text;
    if (text && !isDefault) this.record("hint", cycle, money, text);
  }

  /** The walkthrough's current step (0-based; STEPS.length when done). */
  step(step: number, title: string, cycle: number, money: number): void {
    if (step === this.lastStep) return;
    this.lastStep = step;
    this.record("step", cycle, money, title);
  }

  /** Once per cycle: money and population. */
  sample(cycle: number, money: number, population: number): void {
    if (!this.live || cycle === this.lastCycle) return;
    this.lastCycle = cycle;
    this.samples.push({ t: Math.round(this.elapsed * 10) / 10, cycle, money: Math.round(money), population });
  }

  export(notes: string): PlaytestExport {
    const count = (type: PlaytestEventType) => this.events.filter(e => e.type === type).length;
    return {
      version: PLAYTEST_VERSION,
      startedAt: this.startedIso,
      seconds: Math.round(Math.min(this.elapsed, PLAYTEST_MINUTES * 60)),
      notes,
      events: this.events.slice(),
      samples: this.samples.slice(),
      summary: { placements: count("place"), removals: count("remove"), warnings: count("warning"), hints: count("hint"), steps: count("step"), cycles: this.samples.length },
    };
  }
}

export function readPlaytestEnabled(): boolean {
  try { return localStorage.getItem(PLAYTEST_KEY) === "1"; } catch { return false; }
}
export function writePlaytestEnabled(on: boolean): void {
  try { localStorage.setItem(PLAYTEST_KEY, on ? "1" : "0"); } catch { /* storage unavailable */ }
}
export function readPlaytestNotes(): string {
  try { return localStorage.getItem(PLAYTEST_NOTES_KEY) ?? ""; } catch { return ""; }
}
export function writePlaytestNotes(text: string): void {
  try { localStorage.setItem(PLAYTEST_NOTES_KEY, text); } catch { /* storage unavailable */ }
}

/** A file name for the export: tidewater-playtest-2026-09-27T05-12.json. */
export function playtestFileName(iso = new Date().toISOString()): string {
  return `tidewater-playtest-${iso.slice(0, 16).replace(":", "-")}.json`;
}
