import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ActionResult, Item, QuarantineRecord } from "../shared/types.js";
import { lastResult, restore, withdraw } from "./assay.js";
import { QUARANTINE_DIR, QUARANTINE_FILE } from "./paths.js";
import { run } from "./run.js";
import { duBytes, exists, hash, readJson, writeJson } from "./store.js";

// Which actions each kind of item supports. The interface reads this so it never offers
// something the engine would refuse.
export function actionsFor(item: Item): string[] {
  const a: string[] = ["reveal"];
  if (["app", "model-file", "hf-model", "ollama-model", "editor-extension"].includes(item.kind)) a.push("quarantine");
  if (["app", "model-file", "hf-model"].includes(item.kind)) a.push("trash");
  if (["brew", "npm-global", "pip"].includes(item.kind)) a.push("update");
  if (item.kind === "app") a.push("open");
  return a;
}

async function find(itemId: unknown): Promise<Item> {
  const r = await lastResult();
  const item = r?.items.find((i) => i.id === itemId);
  if (!item) throw new Error("Run an assay first; that item isn’t in the latest one.");
  return item;
}

// The file or folder an action moves. Ollama models move only their manifest, because
// weight blobs are shared between tags and Ollama finds them by digest.
function target(item: Item) {
  if (!item.path) throw new Error("This item has no location on disk.");
  if (item.kind === "hf-model") return path.dirname(path.dirname(item.path)); // models--org--name
  return item.path;
}

function safe(p: string) {
  const r = path.resolve(p);
  const home = os.homedir();
  if (r === "/" || r === home || r.split(path.sep).length < 3) return false;
  if (r.startsWith("/System/") || r.startsWith("/usr/") || r.startsWith("/bin/") || r.startsWith("/sbin/")) return false;
  return r.startsWith(home + path.sep) || r.startsWith("/Applications/");
}

const records = () => readJson<QuarantineRecord[]>(QUARANTINE_FILE, []);
const SIDECAR = ".assay-record.json";

// Quarantine and release run one at a time, so two calls can't overwrite each other's records.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const p = queue.then(fn, fn);
  queue = p.catch(() => {});
  return p;
}

// Every held item, including any whose move finished but whose entry in the list was never
// written (a crash in between). Each quarantine folder carries its own record for this.
async function held(): Promise<QuarantineRecord[]> {
  const listed = await records();
  const known = new Set(listed.map((r) => r.id));
  const dirs = await fs.readdir(QUARANTINE_DIR).catch(() => [] as string[]);
  const orphans: QuarantineRecord[] = [];
  for (const d of dirs) {
    if (known.has(d) || d.startsWith(".")) continue;
    const rec = await readJson<QuarantineRecord | null>(path.join(QUARANTINE_DIR, d, SIDECAR), null);
    if (rec && (await exists(rec.to))) orphans.push(rec);
  }
  return [...listed, ...orphans];
}

export const quarantine = (itemId: unknown) => serial(() => quarantineNow(itemId));
export const release = (recordId: unknown) => serial(() => releaseNow(recordId));

async function quarantineNow(itemId: unknown): Promise<ActionResult> {
  const item = await find(itemId);
  if (!actionsFor(item).includes("quarantine")) throw new Error("Assay can’t quarantine this kind of item.");
  const from = target(item);
  if (!safe(from)) throw new Error("Assay won’t move anything from that location.");
  if (!(await exists(from))) throw new Error("It’s already gone from where Assay found it.");
  if (item.kind === "app") {
    const ps = await run("ps", ["-axww", "-o", "comm="], 5_000);
    if (ps.stdout.includes(`${from}/`)) throw new Error(`Quit ${item.name} first, then quarantine it.`);
  }
  const id = hash(`${from}:${Date.now()}`);
  const dir = path.join(QUARANTINE_DIR, id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(QUARANTINE_DIR, ".metadata_never_index"), "").catch(() => {});
  const to = path.join(dir, path.basename(from) + (item.kind === "app" ? ".quarantined" : ""));
  const bytes = item.kind === "ollama-model" ? 0 : await duBytes(from);
  // The record goes down beside the destination before anything moves, so a move is never
  // left without a way back.
  const draft: QuarantineRecord = { id, itemId: item.id, name: item.name, from, to, at: Date.now(), bytes };
  await writeJson(path.join(dir, SIDECAR), draft);
  try {
    await fs.rename(from, to);
  } catch (e) {
    await fs.rm(dir, { recursive: true, force: true });
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EXDEV") throw new Error("That item is on another disk; Assay only quarantines within one disk so release is instant.");
    if (code === "EACCES" || code === "EPERM") throw new Error("macOS didn’t allow Assay to move it. It may belong to an administrator.");
    throw e;
  }
  const out = await withdraw(item.id).catch(() => undefined);
  const rec: QuarantineRecord = { ...draft, item: out?.item, findings: out?.findings };
  await writeJson(QUARANTINE_FILE, [rec, ...(await records())]);
  await writeJson(path.join(dir, SIDECAR), rec).catch(() => {});
  return { ok: true, message: `${item.name} is quarantined. It can’t be used until you release it.`, undo: id };
}

async function releaseNow(recordId: unknown): Promise<ActionResult> {
  const all = await held();
  const rec = all.find((r) => r.id === recordId);
  if (!rec) throw new Error("No quarantine record with that id.");
  if (!(await exists(rec.to))) {
    await writeJson(QUARANTINE_FILE, (await records()).filter((r) => r.id !== rec.id));
    throw new Error(`${rec.name} is no longer in quarantine, so there was nothing to put back.`);
  }
  if (await exists(rec.from)) throw new Error("Something new is already at the original location; move it aside first.");
  await fs.mkdir(path.dirname(rec.from), { recursive: true });
  await fs.rename(rec.to, rec.from);
  await fs.rm(path.dirname(rec.to), { recursive: true, force: true });
  await writeJson(QUARANTINE_FILE, (await records()).filter((r) => r.id !== rec.id));
  if (rec.item) await restore(rec.item, rec.findings ?? []);
  return { ok: true, message: `${rec.name} is back where it was.` };
}

export const quarantined = held;

export async function trash(itemId: unknown): Promise<ActionResult> {
  const item = await find(itemId);
  if (!actionsFor(item).includes("trash")) throw new Error("Assay can’t move this kind of item to the Trash.");
  const from = target(item);
  if (!safe(from)) throw new Error("Assay won’t move anything from that location.");
  const trashDir = path.join(os.homedir(), ".Trash");
  let dest = path.join(trashDir, path.basename(from));
  if (await exists(dest)) dest = path.join(trashDir, `${path.basename(from)} ${new Date().toISOString().replace(/[:.]/g, "-")}`);
  await fs.rename(from, dest);
  await withdraw(item.id);
  return { ok: true, message: `${item.name} is in the Trash. Put it back from there any time.` };
}

// Updates run the item's own package manager, so the result is exactly what that tool does.
export async function update(itemId: unknown): Promise<ActionResult> {
  const item = await find(itemId);
  let cmd: string[];
  if (item.kind === "brew") cmd = ["brew", "upgrade", item.name];
  else if (item.kind === "npm-global") cmd = [path.join(String(item.meta.bin), "npm"), "install", "-g", `${item.name}@latest`];
  else if (item.kind === "pip") cmd = [path.join(String(item.meta.environment), "bin", "python3"), "-m", "pip", "install", "--upgrade", item.name];
  else throw new Error("Assay can’t update this kind of item.");
  const quoted = cmd.map((c) => `'${c.replace(/'/g, "'\\''")}'`).join(" ");
  // npm runs with its own node first on PATH, so it updates the install it came from.
  const env = item.kind === "npm-global" ? `/usr/bin/env -u npm_config_prefix -u NPM_CONFIG_PREFIX PATH='${String(item.meta.bin).replace(/'/g, "'\\''")}':"$PATH" ` : "";
  const r = await run("/bin/sh", ["-lc", env + quoted], 600_000);
  if (!r.ok) throw new Error((r.stderr || r.stdout).trim().split("\n").slice(-3).join(" ") || "The update failed.");
  return { ok: true, message: `${item.name} was updated with ${cmd[0] === "brew" ? "Homebrew" : cmd.includes("pip") ? "pip" : "npm"}. Run the assay again to confirm the fix.` };
}

export async function reveal(itemId: unknown) {
  const item = await find(itemId);
  if (item.path) await run("open", ["-R", item.path], 5_000);
}

export async function openApp(itemId: unknown) {
  const item = await find(itemId);
  if (item.kind === "app" && item.path) await run("open", [item.path], 5_000);
}
