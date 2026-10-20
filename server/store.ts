import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Settings } from "../shared/types.js";
import { CACHE_DIR, HOME, SETTINGS_FILE } from "./paths.js";

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

// Write through a temporary file so a crash never leaves half a file behind.
export async function writeJson(file: string, data: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data));
  await fs.rename(tmp, file);
}

export const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 20);

// A small disk cache keyed by a string and a validity stamp (usually a file's mtime).
export async function cached<T>(bucket: string, key: string, stamp: string | number, make: () => Promise<T>): Promise<T> {
  const file = path.join(CACHE_DIR, bucket, `${hash(key)}.json`);
  const hit = await readJson<{ stamp: string | number; data: T } | null>(file, null);
  if (hit && hit.stamp === stamp) return hit.data;
  const data = await make();
  await writeJson(file, { stamp, data });
  return data;
}

export const DEFAULT_SETTINGS: Settings = {
  checkOnline: true,
  modelFolders: [path.join(HOME, "Downloads"), path.join(HOME, "Documents"), path.join(HOME, "Desktop"), path.join(HOME, "models")],
  hiddenItems: [],
};

let current: Settings | undefined;

export async function getSettings(): Promise<Settings> {
  current ??= { ...DEFAULT_SETTINGS, ...(await readJson<Partial<Settings>>(SETTINGS_FILE, {})) };
  return current;
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const s = await getSettings();
  const next: Settings = {
    checkOnline: typeof patch.checkOnline === "boolean" ? patch.checkOnline : s.checkOnline,
    modelFolders: Array.isArray(patch.modelFolders) ? patch.modelFolders.filter((p): p is string => typeof p === "string" && path.isAbsolute(p)) : s.modelFolders,
    hiddenItems: Array.isArray(patch.hiddenItems) ? patch.hiddenItems.filter((p): p is string => typeof p === "string") : s.hiddenItems,
  };
  current = next;
  await writeJson(SETTINGS_FILE, next);
  return next;
}

export async function mtime(p: string) {
  try {
    return Math.round((await fs.stat(p)).mtimeMs);
  } catch {
    return 0;
  }
}

export async function exists(p: string) {
  return fs.access(p).then(() => true, () => false);
}

export async function list(dir: string) {
  return fs.readdir(dir).catch(() => [] as string[]);
}

export async function duBytes(p: string) {
  const { run } = await import("./run.js");
  const r = await run("du", ["-sk", p], 60_000);
  const kb = parseInt(r.stdout, 10);
  return Number.isFinite(kb) ? kb * 1024 : 0;
}
