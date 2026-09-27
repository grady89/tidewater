// In-page dialogs in the game's own glass vocabulary, replacing window.confirm and window.prompt: promise-based,
// Enter confirms, Escape cancels, focus is trapped while one is open. One dialog at a time; a second request
// resolves the first as cancelled.
let host: HTMLElement | null = null;
let current: (() => void) | null = null;

function root(): HTMLElement {
  if (!host) {
    host = document.getElementById("dialog");
    if (!host) { host = document.createElement("div"); host.id = "dialog"; document.body.appendChild(host); }
    host.className = "dialog-host";
    host.hidden = true;
  }
  return host;
}

interface Base { message: string; ok?: string; cancel?: string; danger?: boolean }

function open(kind: "confirm" | "prompt" | "notice", o: Base & { initial?: string }, done: (value: string | null) => void): void {
  current?.();
  const h = root();
  const before = document.activeElement as HTMLElement | null;
  h.innerHTML = `<div class="dialog glass" role="dialog" aria-modal="true"><p class="dialog-message"></p>${kind === "prompt" ? `<input class="dialog-input" type="text" maxlength="40">` : ""}<div class="dialog-actions">${kind === "notice" ? "" : `<button type="button" class="dialog-cancel"></button>`}<button type="button" class="dialog-ok"></button></div></div>`;
  h.querySelector<HTMLElement>(".dialog-message")!.textContent = o.message;
  const okB = h.querySelector<HTMLButtonElement>(".dialog-ok")!;
  okB.textContent = o.ok ?? "OK";
  okB.classList.toggle("danger", !!o.danger);
  const cancelB = h.querySelector<HTMLButtonElement>(".dialog-cancel");
  if (cancelB) cancelB.textContent = o.cancel ?? "Cancel";
  const input = h.querySelector<HTMLInputElement>(".dialog-input");
  if (input) input.value = o.initial ?? "";
  h.hidden = false;
  const close = (value: string | null) => {
    current = null;
    window.removeEventListener("keydown", onKey, true);
    h.hidden = true;
    h.innerHTML = "";
    before?.focus?.();
    done(value);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); close(null); }
    else if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement && e.target !== okB)) { e.stopPropagation(); e.preventDefault(); close(input ? input.value : "ok"); }
    else if (e.key === "Tab") {
      // Trap: cycle between the dialog's focusable elements.
      const items = [...h.querySelectorAll<HTMLElement>("input, button")];
      const k = items.indexOf(document.activeElement as HTMLElement);
      const next = items[(k + (e.shiftKey ? -1 : 1) + items.length) % items.length];
      e.preventDefault(); next.focus();
    }
  };
  window.addEventListener("keydown", onKey, true);
  okB.addEventListener("click", () => close(input ? input.value : "ok"));
  cancelB?.addEventListener("click", () => close(null));
  current = () => close(null);
  (input ?? okB).focus();
  input?.select();
}

/** Yes/no. Resolves true on OK. */
export function confirmDialog(message: string, o: { ok?: string; cancel?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise(res => open("confirm", { message, ...o }, v => res(v !== null)));
}

/** A line of text. Resolves null when cancelled. */
export function promptDialog(message: string, initial = "", o: { ok?: string } = {}): Promise<string | null> {
  return new Promise(res => open("prompt", { message, initial, ...o }, v => res(v)));
}

/** A notice with one button. */
export function noticeDialog(message: string, ok = "OK"): Promise<void> {
  return new Promise(res => open("notice", { message, ok }, () => res()));
}

/** Is a dialog open (keys should go to it)? */
export function dialogOpen(): boolean {
  return !!host && !host.hidden;
}
