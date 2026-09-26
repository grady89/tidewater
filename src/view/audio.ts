// Procedural sound, all Web Audio, no samples: surf from filtered noise whose gain follows the water and the
// storm; a soft bell at each shift change; a low thrum while the sea pulls back and the wave comes in. The context
// is created on the first click or key (browsers require a gesture). Mute is remembered. View only.
import { Phase, SimState } from "../sim/state";
import { tideNormalized } from "../sim/tide";

const MUTE_KEY = "tidewater.muted";

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private surfGain: GainNode | null = null;
  private surfFilter: BiquadFilterNode | null = null;
  private thrumGain: GainNode | null = null;
  private lastPhase: Phase | null = null;
  muted = false;

  constructor() {
    try { this.muted = localStorage.getItem(MUTE_KEY) === "1"; } catch { /* ignore */ }
    const start = () => { this.start(); };
    window.addEventListener("pointerdown", start, { passive: true });
    window.addEventListener("keydown", start);
  }

  get started(): boolean { return this.ctx !== null; }
  get state(): string { return this.ctx?.state ?? "none"; }

  /** Build the graph and resume the context. Safe to call repeatedly. */
  start(): void {
    if (this.ctx) { if (this.ctx.state === "suspended") void this.ctx.resume(); return; }
    const Ctx = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(ctx.destination);

    // Surf: two seconds of noise, looped, through a low-pass that opens with the water.
    const seconds = 2;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 1;
    for (let i = 0; i < data.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; data[i] = (seed / 4294967296) * 2 - 1; }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    this.surfFilter = ctx.createBiquadFilter();
    this.surfFilter.type = "lowpass";
    this.surfFilter.frequency.value = 500;
    this.surfGain = ctx.createGain();
    this.surfGain.gain.value = 0.05;
    noise.connect(this.surfFilter).connect(this.surfGain).connect(this.master);
    noise.start();

    // Thrum: a low sine with a slow wobble, silent until the sea does something.
    const thrum = ctx.createOscillator();
    thrum.type = "sine";
    thrum.frequency.value = 46;
    const wobble = ctx.createOscillator();
    wobble.frequency.value = 0.6;
    const wobbleGain = ctx.createGain();
    wobbleGain.gain.value = 6;
    wobble.connect(wobbleGain).connect(thrum.frequency);
    this.thrumGain = ctx.createGain();
    this.thrumGain.gain.value = 0;
    thrum.connect(this.thrumGain).connect(this.master);
    thrum.start(); wobble.start();

    if (ctx.state === "suspended") void ctx.resume();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    try { localStorage.setItem(MUTE_KEY, m ? "1" : "0"); } catch { /* ignore */ }
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.05);
  }

  /** A soft bell: a sine with a fifth above it, ringing out over a second. */
  private bell(): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    for (const [freq, level] of [[660, 0.12], [990, 0.05]] as [number, number][]) {
      const osc = this.ctx.createOscillator();
      osc.frequency.value = freq;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(level, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
      osc.connect(g).connect(this.master);
      osc.start(t); osc.stop(t + 1.3);
    }
  }

  /** Every frame: follow the ledger. */
  sync(state: SimState, stormMix: number): void {
    if (!this.ctx || !this.surfGain || !this.surfFilter || !this.thrumGain) return;
    const t = this.ctx.currentTime;
    const water = Math.max(0, Math.min(1.2, tideNormalized(state.tide)));
    this.surfGain.gain.setTargetAtTime(0.04 + 0.08 * water + 0.25 * stormMix, t, 0.3);
    this.surfFilter.frequency.setTargetAtTime(350 + 400 * water + 900 * stormMix, t, 0.3);
    const stage = state.tsunami.stage;
    const thrum = stage === "drawdown" ? 0.18 : stage === "wave" ? 0.3 : 0;
    this.thrumGain.gain.setTargetAtTime(thrum, t, 0.5);
    if (this.lastPhase !== null && state.phase !== this.lastPhase && state.phase !== "slack") this.bell();
    this.lastPhase = state.phase;
  }
}
