// A small LZW packer for the sector saves. localStorage counts UTF-16 code units and Firefox and Safari cap an
// origin at 5 MB, and twelve 300-building towns are 4 M characters of JSON (8 MB) uncompressed — most of it the
// fields' long decimals, which LZW folds well. Output is a string of 15-bit codes, one per character, offset by
// 32 so nothing lands in the surrogate range. No dependency; the decoder is the mirror image.
const FIRST = 130; // 0–127: ASCII; 128: ESCAPE (a raw UTF-16 unit follows in two chars); 129: RESET
const ESCAPE = 128, RESET = 129;
const MAX = 32768;
const OFFSET = 32;

export function compress(text: string): string {
  // The dictionary maps (the code of a phrase, the next character) to the code of the longer phrase — the same
  // phrases and codes as building the phrase strings, without building them. The ASCII characters are codes 0–127
  // (no entry); a lone non-ASCII character is (-1, its code).
  let dict = new Map<number, number>();
  let next = FIRST;
  const out: number[] = [];
  const key = (p: number, c: number) => (p + 1) * 65536 + c;
  const lookup = (p: number, c: number): number | undefined => (p < 0 && c < 128 ? c : dict.get(key(p, c)));
  const add = (p: number, c: number) => {
    if (next >= MAX) { out.push(RESET); dict = new Map(); next = FIRST; return; }
    dict.set(key(p, c), next++);
  };
  let w = -1; // the code of the phrase so far; -1 = none
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const wc = lookup(w, c);
    if (wc !== undefined) { w = wc; continue; }
    if (w >= 0) { out.push(w); add(w, c); }
    if (c < 128) { w = c; continue; }
    out.push(ESCAPE, c >> 8, c & 255);
    add(-1, c);
    w = -1;
  }
  if (w >= 0) out.push(w);
  let s = "";
  for (let k = 0; k < out.length; k += 8192) s += String.fromCharCode(...out.slice(k, k + 8192).map(v => v + OFFSET));
  return s;
}

export function decompress(packed: string): string {
  let dict: string[] = [];
  const reset = () => { dict = []; for (let k = 0; k < 128; k++) dict.push(String.fromCharCode(k)); dict.length = FIRST; };
  reset();
  const add = (phrase: string) => { if (dict.length < MAX) dict.push(phrase); };
  const parts: string[] = [];
  let prev = "";
  for (let i = 0; i < packed.length; i++) {
    const code = packed.charCodeAt(i) - OFFSET;
    if (code === RESET) { reset(); prev = ""; continue; }
    if (code === ESCAPE) {
      const c = String.fromCharCode(((packed.charCodeAt(i + 1) - OFFSET) << 8) | (packed.charCodeAt(i + 2) - OFFSET));
      i += 2;
      if (prev) add(prev + c);
      add(c);
      parts.push(c);
      prev = "";
      continue;
    }
    let entry: string;
    if (code < dict.length && dict[code] !== undefined) entry = dict[code];
    else if (code === dict.length && prev) entry = prev + prev[0];
    else throw new Error(`corrupt packed save at ${i}`);
    parts.push(entry);
    if (prev) add(prev + entry[0]);
    prev = entry;
  }
  return parts.join("");
}

/** Packed strings never start with "{" (the first code is at least 32 + 0 and JSON starts with 0x7B = 123 → 155). */
export function isPacked(s: string): boolean {
  return s.length > 0 && s[0] !== "{" && s[0] !== "[";
}
