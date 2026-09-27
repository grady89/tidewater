// Procedural sound, all Web Audio, no samples. Surf from filtered noise whose gain follows the water and the
// storm; a soft bell at each shift change; a low thrum while the sea pulls back and the wave comes in; a quiet
// harmonic pad that breathes with the day; gull cries when a flock is about; hammering from a busy shipyard.
// The context is created on the first click or key (browsers require a gesture). Mute is remembered. View only.
import { dayFraction, isSunUp } from "../sim/daylight";
import { Phase, SimState } from "../sim/state";
import { tideNormalized } from "../sim/tide";

const MUTE_KEY = "tidewater.muted";

/** What the view knows that the ledger doesn't, for the ambient layer. */
export interface Ambient {
  /** Gulls in the air right now. */
  gulls: number;
}

/** The pad's wandering voice steps through these (Hz): a pentatonic set two octaves up from the root. */
const PAD_ROOT = 110, PAD_FIFTH = 165;
const PAD_VOICES = [330, 370, 440, 494, 554, 660];

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private surfGain: GainNode | null = null;
  private surfFilter: BiquadFilterNode | null = null;
  private thrumGain: GainNode | null = null;
  private padGain: GainNode | null = null;
  private padVoice: OscillatorNode | null = null;
  private padFilter: BiquadFilterNode | null = null;
  private lastPhase: Phase | null = null;
  private nextCry = 0;
  private nextStep = 0;
  private nextHammer = 0;
  /** Gull cries, hammer blows and bells played so far (smoke probes). */
  cries = 0;
  hammers = 0;
  bells = 0;
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
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer(2);
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

    // Pad: a root and a fifth, slightly detuned pairs so they beat, a wandering upper voice that glides between
    // pentatonic notes every few seconds, all through a gentle low-pass, breathing on a slow LFO.
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = "lowpass";
    this.padFilter.frequency.value = 900;
    this.padFilter.Q.value = 0.5;
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0.0;
    this.padFilter.connect(this.padGain).connect(this.master);
    for (const [f, level] of [[PAD_ROOT, 0.5], [PAD_ROOT * 1.004, 0.35], [PAD_FIFTH, 0.3], [PAD_FIFTH * 0.997, 0.22]] as [number, number][]) {
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = level;
      o.connect(g).connect(this.padFilter);
      o.start();
    }
    this.padVoice = ctx.createOscillator();
    this.padVoice.type = "sine";
    this.padVoice.frequency.value = PAD_VOICES[2];
    const vg = ctx.createGain();
    vg.gain.value = 0.18;
    this.padVoice.connect(vg).connect(this.padFilter);
    this.padVoice.start();
    const breath = ctx.createOscillator();
    breath.frequency.value = 0.07;
    const breathGain = ctx.createGain();
    breathGain.gain.value = 0.012;
    breath.connect(breathGain).connect(this.padGain.gain);
    breath.start();

    if (ctx.state === "suspended") void ctx.resume();
  }

  private noiseBuffer(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 1;
    for (let i = 0; i < data.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; data[i] = (seed / 4294967296) * 2 - 1; }
    return buffer;
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

  /**
   * A gull: a sawtooth swept down through a band-pass with a fast tremolo, then a shorter second yelp — the
   * "kee-yah" of a herring gull, thin and far off.
   */
  cry(): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = 0.05 + Math.random() * 0.03;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = 1600; bp.Q.value = 2.5;
    bp.connect(out).connect(this.master);
    const yelp = (start: number, f0: number, f1: number, len: number, level: number) => {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(f0, start);
      o.frequency.exponentialRampToValueAtTime(f1, start + len);
      const trem = ctx.createOscillator();
      trem.frequency.value = 28;
      const tremGain = ctx.createGain();
      tremGain.gain.value = 0.45;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(level, start + 0.04);
      g.gain.setValueAtTime(level, start + len * 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, start + len);
      trem.connect(tremGain).connect(g.gain);
      o.connect(g).connect(bp);
      o.start(start); o.stop(start + len + 0.05);
      trem.start(start); trem.stop(start + len + 0.05);
    };
    const base = 1100 + Math.random() * 400;
    yelp(t, base * 1.3, base * 0.85, 0.38, 1);
    if (Math.random() < 0.7) yelp(t + 0.45, base * 1.15, base * 0.9, 0.22, 0.7);
    this.cries++;
  }

  /** One hammer blow at the shipyard: a short burst of noise through a band-pass, with a woody knock under it. */
  private hammer(): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(0.08);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = 2200 + Math.random() * 600; bp.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.09, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t);
    const knock = ctx.createOscillator();
    knock.frequency.setValueAtTime(180, t);
    knock.frequency.exponentialRampToValueAtTime(90, t + 0.05);
    const kg = ctx.createGain();
    kg.gain.setValueAtTime(0.05, t);
    kg.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    knock.connect(kg).connect(this.master);
    knock.start(t); knock.stop(t + 0.08);
    this.hammers++;
  }

  /** Every frame: follow the ledger and the view. */
  sync(state: SimState, stormMix: number, ambient: Ambient = { gulls: 0 }): void {
    if (!this.ctx || !this.surfGain || !this.surfFilter || !this.thrumGain || !this.padGain || !this.padVoice || !this.padFilter) return;
    const t = this.ctx.currentTime;
    const water = Math.max(0, Math.min(1.2, tideNormalized(state.tide)));
    this.surfGain.gain.setTargetAtTime(0.04 + 0.08 * water + 0.25 * stormMix, t, 0.3);
    this.surfFilter.frequency.setTargetAtTime(350 + 400 * water + 900 * stormMix, t, 0.3);
    const stage = state.tsunami.stage;
    const thrum = stage === "drawdown" ? 0.18 : stage === "wave" ? 0.3 : 0;
    this.thrumGain.gain.setTargetAtTime(thrum, t, 0.5);
    // The shift bell rings by day only: nobody rings a bell over a sleeping town.
    if (this.lastPhase !== null && state.phase !== this.lastPhase && state.phase !== "slack" && isSunUp(state.time)) { this.bell(); this.bells++; }
    this.lastPhase = state.phase;

    // The pad: quiet by day, a little fuller at dusk and dawn, ducked under a storm; the voice wanders.
    const d = dayFraction(state.time);
    const evening = 0.5 - 0.5 * Math.cos(2 * Math.PI * (d - 0.5)); // 1 at dusk/dawn edges, 0 at noon/midnight
    this.padGain.gain.setTargetAtTime((0.028 + 0.014 * evening) * (1 - 0.6 * stormMix), t, 1.0);
    this.padFilter.frequency.setTargetAtTime(700 + 500 * evening, t, 1.0);
    if (t > this.nextStep) {
      const note = PAD_VOICES[Math.floor(Math.random() * PAD_VOICES.length)];
      this.padVoice.frequency.setTargetAtTime(note, t, 1.6);
      this.nextStep = t + 6 + Math.random() * 8;
    }

    // Gulls: the more in the air, the more often one calls; never at night.
    if (ambient.gulls > 0 && state.phase !== "slack" && d < 0.55) {
      if (t > this.nextCry) {
        this.cry();
        this.nextCry = t + 4 + Math.random() * 10 / Math.min(4, Math.max(1, ambient.gulls / 3));
      }
    } else this.nextCry = Math.max(this.nextCry, t + 2);

    // Hammering while a shipyard has a boat on the ways and hands to build it.
    const building = Object.values(state.buildings).some(b => b.kind === "shipyard" && b.progress > 0 && b.workers > 0 && b.reached && !b.cut);
    if (building && t > this.nextHammer) { this.hammer(); this.nextHammer = t + 0.55 + Math.random() * 0.5; }
  }
}
