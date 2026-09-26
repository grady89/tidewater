// The achievement popup: when the ledger's list grows, show the newest one for a few seconds of view time.
// Loading a town adopts its list without replaying it.
import { achievement } from "../sim/achievements";
import { SimState } from "../sim/state";

const SHOW_SECONDS = 6;

export class AchievementPopup {
  private seen = 0;
  private until = 0;
  /** Ids shown so far this session (a smoke probe). */
  shown: string[] = [];

  constructor(private readonly root: HTMLElement) {
    root.innerHTML = `<div class="star">★</div><div class="text"><h3></h3><p></p></div>`;
    root.hidden = true;
  }

  /** Take a (loaded) ledger as already seen. */
  adopt(state: SimState): void {
    this.seen = state.achievements.length;
    this.root.hidden = true;
  }

  update(state: SimState, viewTime: number): void {
    if (state.achievements.length > this.seen) {
      const id = state.achievements[this.seen++];
      const a = achievement(id);
      if (a) {
        this.root.querySelector("h3")!.textContent = a.title;
        this.root.querySelector("p")!.textContent = a.desc;
        this.root.hidden = false;
        this.until = viewTime + SHOW_SECONDS;
        this.shown.push(id);
      }
    }
    if (!this.root.hidden && viewTime > this.until) this.root.hidden = true;
  }
}
