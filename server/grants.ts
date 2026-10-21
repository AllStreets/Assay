import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Item } from "../shared/types.js";
import { run } from "./run.js";

// What you've actually allowed each app to reach, from macOS's own permission records (TCC).
// A known flaw matters more in an app that can record your screen than in one that can't, so
// Assay ranks by flaws and reach together. Reading needs Full Disk Access; without it Assay
// still works and says so.

const DBS = [
  path.join(os.homedir(), "Library", "Application Support", "com.apple.TCC", "TCC.db"),
  "/Library/Application Support/com.apple.TCC/TCC.db",
];

// The grants that turn a flaw in an app into a way into the rest of the Mac, strongest first.
export const REACH: Record<string, { label: string; weight: number }> = {
  SystemPolicyAllFiles: { label: "Full Disk Access", weight: 5 },
  Accessibility: { label: "Can control your Mac", weight: 5 },
  ListenEvent: { label: "Sees your keystrokes", weight: 5 },
  ScreenCapture: { label: "Can record your screen", weight: 4 },
  PostEvent: { label: "Sends keystrokes and clicks", weight: 4 },
  AppleEvents: { label: "Controls other apps", weight: 3 },
  Microphone: { label: "Microphone", weight: 3 },
  Camera: { label: "Camera", weight: 3 },
  AudioCapture: { label: "Records system audio", weight: 3 },
  AddressBook: { label: "Contacts", weight: 2 },
  Photos: { label: "Photos", weight: 2 },
  Calendar: { label: "Calendars", weight: 1 },
  SystemPolicyDocumentsFolder: { label: "Documents folder", weight: 1 },
  SystemPolicyDesktopFolder: { label: "Desktop folder", weight: 1 },
  SystemPolicyDownloadsFolder: { label: "Downloads folder", weight: 1 },
};

const SQL = "select service, client, client_type, auth_value from access";

interface Row { service: string; client: string; client_type: number; auth_value: number }

// sqlite3 first; if macOS blocks that helper but allows the engine, read a private copy.
async function query(db: string) {
  const direct = await run("/usr/bin/sqlite3", ["-readonly", "-json", db, SQL], 8_000);
  if (direct.ok) return direct;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "assay-tcc-"));
  try {
    for (const ext of ["", "-wal", "-shm"]) {
      await fs.copyFile(db + ext, path.join(dir, "TCC.db" + ext)).catch((e: NodeJS.ErrnoException) => {
        if (ext === "") throw e;
      });
    }
    return await run("/usr/bin/sqlite3", ["-readonly", "-json", path.join(dir, "TCC.db"), SQL], 8_000);
  } catch {
    return direct;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

// Writes each app's allowed grants into item.meta.reach (service keys, strongest first).
export async function attachReach(items: Item[]): Promise<{ read: boolean; reason?: string }> {
  const apps = items.filter((i) => i.kind === "app");
  const byId = new Map<string, Item>();
  for (const a of apps) if (a.meta.bundleId) byId.set(String(a.meta.bundleId), a);
  const byPath = (client: string) => {
    const at = client.indexOf(".app/");
    const p = at >= 0 ? client.slice(0, at + 4) : client;
    return apps.find((a) => a.path === p);
  };
  let read = false;
  let reason: string | undefined;
  const found = new Map<string, Set<string>>();
  for (const db of DBS) {
    const r = await query(db);
    if (!r.ok) {
      reason = /authorization denied|unable to open|not permitted/i.test(r.stderr) ? "Assay needs Full Disk Access to read the permissions you’ve granted." : r.stderr.trim().split("\n")[0];
      continue;
    }
    read = true;
    let rows: Row[] = [];
    try {
      rows = r.stdout.trim() ? (JSON.parse(r.stdout) as Row[]) : [];
    } catch {}
    for (const row of rows) {
      if (row.auth_value !== 2 && row.auth_value !== 3) continue;
      const service = row.service.replace(/^kTCCService/, "");
      if (!REACH[service]) continue;
      const app = row.client_type === 0 ? byId.get(row.client) : byPath(row.client);
      if (!app) continue;
      found.set(app.id, (found.get(app.id) ?? new Set()).add(service));
    }
  }
  for (const a of apps) {
    const s = found.get(a.id);
    if (s) a.meta.reach = [...s].sort((x, y) => REACH[y].weight - REACH[x].weight);
    else delete a.meta.reach;
  }
  return { read, reason: read ? undefined : reason };
}

export const reachWeight = (i: Item) => ((i.meta.reach as string[] | undefined) ?? []).reduce((a, s) => a + (REACH[s]?.weight ?? 0), 0);
