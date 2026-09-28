// `npm run assets [-- names...] [-- --look fjord]`: the asset pipeline's entry. First the palette (fails if
// palette.json changed and was not committed), then Blender (resolved once and remembered in blender.json), then
// tools/assets/build.py inside it. `node tools/assets/run.ts --find` only resolves Blender.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PALETTE_JSON, writePalette } from "./palette.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const CACHE = join(HERE, "blender.json");

/** The major version a path's `--version` reports, or null if it doesn't run. */
function versionOf(path: string): { major: number; text: string } | null {
  try {
    const out = execFileSync(path, ["--version"], { encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "ignore"] });
    const m = /Blender (\d+)\.(\d+)(?:\.(\d+))?[^\n]*/.exec(out);
    return m ? { major: Number(m[1]), text: m[0].trim() } : null;
  } catch { return null; }
}

function candidates(): string[] {
  const out: string[] = [];
  if (process.env.BLENDER_PATH) out.push(process.env.BLENDER_PATH);
  out.push(process.platform === "win32" ? "blender.exe" : "blender");
  if (process.platform === "win32") {
    const base = "C:\\Program Files\\Blender Foundation";
    if (existsSync(base)) for (const d of readdirSync(base).filter(d => /^Blender \d/.test(d)).sort().reverse()) out.push(join(base, d, "blender.exe"));
  } else if (process.platform === "darwin") out.push("/Applications/Blender.app/Contents/MacOS/Blender");
  else if (existsSync(homedir())) for (const d of readdirSync(homedir()).filter(d => /^blender/i.test(d)).sort().reverse()) out.push(join(homedir(), d, "blender"));
  return out;
}

/** Blender 4 or later (docs/assets/decisions.md #1), remembered in blender.json so later runs don't search. */
export function findBlender(): { path: string; version: string } {
  if (existsSync(CACHE)) {
    const c = JSON.parse(readFileSync(CACHE, "utf8")) as { path: string; version: string };
    if (versionOf(c.path)) return c;
  }
  const tried: string[] = [];
  for (const path of candidates()) {
    tried.push(path);
    const v = versionOf(path);
    if (v && v.major >= 4) {
      const found = { path, version: v.text };
      writeFileSync(CACHE, JSON.stringify(found, null, 2) + "\n");
      return found;
    }
  }
  throw new Error(`Blender 4 or later not found. Tried: ${tried.join(", ")}. Set BLENDER_PATH to blender's executable.`);
}

function paletteCommitted(): boolean {
  const r = spawnSync("git", ["diff", "--quiet", "HEAD", "--", PALETTE_JSON], { cwd: ROOT });
  const tracked = spawnSync("git", ["ls-files", "--error-unmatch", PALETTE_JSON], { cwd: ROOT, stdio: "ignore" }).status === 0;
  return tracked && r.status === 0;
}

const argv = process.argv.slice(2);
if (argv.includes("--find")) {
  console.log(JSON.stringify(findBlender()));
} else {
  const changed = await writePalette();
  if (!paletteCommitted()) {
    console.error(`[assets] tools/assets/palette.json ${changed ? "changed" : "differs from HEAD"}: the looks moved. Commit it, then run again.`);
    process.exit(1);
  }
  const blender = findBlender();
  console.log(`[assets] ${blender.version} · ${blender.path}`);
  const t0 = Date.now();
  const r = spawnSync(blender.path, ["-b", "--factory-startup", "-P", join(HERE, "build.py"), "--", ...argv], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const lines = (r.stdout ?? "").split(/\r?\n/);
  const assets = lines.filter(l => l.startsWith("ASSET ")).map(l => JSON.parse(l.slice(6)) as { file: string; tris: number; budget: number; bytes: number; parts: string[] });
  for (const a of assets) console.log(`[assets] ${a.file.padEnd(20)} ${String(a.tris).padStart(4)} / ${a.budget} tris · ${(a.bytes / 1024).toFixed(1)} KB · ${a.parts.join(", ")}`);
  if (r.status !== 0 || !assets.length) {
    console.error((r.stdout ?? "").split(/\r?\n/).filter(l => /Error|error|Traceback|raise|line \d+|over the budget|not in the/.test(l)).slice(-25).join("\n"));
    console.error(r.stderr?.slice(-3000));
    process.exit(1);
  }
  console.log(`[assets] ${assets.length} built in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
