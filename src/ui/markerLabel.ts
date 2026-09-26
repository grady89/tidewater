// A short label pinned to a screen position (the pier suggestion's ring), hidden when there is nothing to pin to.
export class MarkerLabel {
  constructor(private readonly el: HTMLElement, text: string) {
    el.textContent = text;
    el.hidden = true;
  }

  update(at: { x: number; y: number } | null): void {
    if (!at || at.x < 0 || at.y < 0 || at.x > window.innerWidth || at.y > window.innerHeight) { this.el.hidden = true; return; }
    this.el.style.left = `${at.x}px`;
    this.el.style.top = `${at.y}px`;
    this.el.hidden = false;
  }
}
