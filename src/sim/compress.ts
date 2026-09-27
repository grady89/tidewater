// A small LZW packer for the sector saves. localStorage counts UTF-16 code units and Firefox and Safari cap an
// origin at 5 MB, and twelve 300-building towns are 4 M characters of JSON (8 MB) uncompressed — most of it the
// fields' long decimals, which LZW folds well. Output is a string of 15-bit codes, one per character, offset by
// 32 so nothing lands in the surrogate range. No dependency; the decoder is the mirror image.
const FIRST = 130; // 0–127: ASCII; 128: ESCAPE (a raw UTF-16 unit follows in two chars); 129: RESET
const ESCAPE = 128, RESET = 129;
const MAX = 32768;
const OFFSET = 32;

function freshDict(): Map<string, number> {
  const d = new Map<string, number>();
  for (let k = 0; k < 128; k++) d.set(String.fromCharCode(k), k);
  return d;
}

export function compress(text: string): string {
  let dict = freshDict();
  let next = FIRST;
  const out: number[] = [];
  const add = (phrase: string) => {
    if (next >= MAX) { out.push(RESET); dict = freshDict(); next = FIRST; return; }
    dict.set(phrase, next++);
  };
  let w = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const wc = w + c;
    if (dict.has(wc)) { w = wc; continue; }
    if (w !== "") { out.push(dict.get(w)!); add(wc); }
    if (c.charCodeAt(0) < 128) { w = c; continue; }
    const cu = c.charCodeAt(0);
    out.push(ESCAPE, cu >> 8, cu & 255);
    add(c);
    w = "";
  }
  if (w !== "") out.push(dict.get(w)!);
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
