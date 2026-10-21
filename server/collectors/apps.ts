import { promises as fs } from "node:fs";
import path from "node:path";
import type { Item, Part } from "../../shared/types.js";
import { HOME } from "../paths.js";
import { readPlist, run } from "../run.js";
import { cached, exists, hash, list, mtime } from "../store.js";

const PLACES = ["/Applications", path.join(HOME, "Applications")];

export async function appPaths(): Promise<string[]> {
  const out: string[] = [];
  for (const dir of PLACES) {
    for (const n of await list(dir)) {
      const p = path.join(dir, n);
      if (n.endsWith(".app")) out.push(p);
      else if (!n.startsWith(".")) {
        // Vendors such as Adobe nest their apps one folder deep.
        for (const inner of await list(p)) if (inner.endsWith(".app")) out.push(path.join(p, inner));
      }
    }
  }
  return out.sort();
}

interface AsarEntry {
  files?: Record<string, AsarEntry>;
  size?: number;
  offset?: string;
  unpacked?: boolean;
}

// Electron apps keep their JavaScript in app.asar: a JSON index followed by file bytes.
async function asarPackages(asarPath: string): Promise<Part[]> {
  const fh = await fs.open(asarPath, "r");
  try {
    const head = Buffer.alloc(16);
    await fh.read(head, 0, 16, 0);
    const pickleSize = head.readUInt32LE(4);
    const jsonLen = head.readUInt32LE(12);
    if (jsonLen > 256 * 1024 * 1024) return [];
    const json = Buffer.alloc(jsonLen);
    await fh.read(json, 0, jsonLen, 16);
    const root = JSON.parse(json.toString("utf8")) as AsarEntry;
    const dataStart = 8 + pickleSize;
    const read = async (e: AsarEntry, rel: string) => {
      if (e.unpacked) return fs.readFile(path.join(asarPath + ".unpacked", rel), "utf8").catch(() => undefined);
      if (e.offset === undefined || !e.size || e.size > 1_000_000) return undefined;
      const b = Buffer.alloc(e.size);
      await fh.read(b, 0, e.size, dataStart + Number(e.offset));
      return b.toString("utf8");
    };
    const parts: Part[] = [];
    // Every node_modules folder, not just the top one: nested copies are separate versions.
    const visit = async (dir: AsarEntry, rel: string) => {
      const nm = dir.files?.node_modules?.files;
      if (!nm) return;
      for (const [n, e] of Object.entries(nm)) {
        if (n.startsWith(".")) continue;
        const pkgs: [string, AsarEntry][] = n.startsWith("@") ? Object.entries(e.files ?? {}).map(([s, se]) => [`${n}/${s}`, se]) : [[n, e]];
        for (const [name, pe] of pkgs) {
          const at = `${rel}node_modules/${name}`;
          const pj = pe.files?.["package.json"];
          let version: string | undefined;
          if (pj) {
            try {
              version = JSON.parse((await read(pj, `${at}/package.json`)) ?? "{}").version;
            } catch {}
          }
          parts.push({ ecosystem: "npm", name, version, via: `app.asar/${at}` });
          await visit(pe, `${at}/`);
        }
      }
    };
    await visit(root, "");
    return parts;
  } finally {
    await fh.close();
  }
}

async function frameworkParts(app: string): Promise<{ parts: Part[]; electron?: string }> {
  const dir = path.join(app, "Contents", "Frameworks");
  const parts: Part[] = [];
  let electron: string | undefined;
  for (const f of await list(dir)) {
    if (!f.endsWith(".framework")) continue;
    const info = (await readPlist(path.join(dir, f, "Versions", "Current", "Resources", "Info.plist"))) ?? (await readPlist(path.join(dir, f, "Resources", "Info.plist")));
    const name = f.replace(/\.framework$/, "");
    const version = (info?.CFBundleShortVersionString as string | undefined) ?? (info?.CFBundleVersion as string | undefined);
    if (name === "Electron Framework") {
      electron = (info?.CFBundleVersion as string | undefined) ?? version;
      continue;
    }
    parts.push({ ecosystem: "framework", name, version, via: `Contents/Frameworks/${f}` });
  }
  return { parts, electron };
}

export async function readApp(app: string): Promise<Item | undefined> {
  const info = await readPlist(path.join(app, "Contents", "Info.plist"));
  if (!info) return undefined;
  const name = (info.CFBundleDisplayName as string | undefined) ?? (info.CFBundleName as string | undefined) ?? path.basename(app, ".app");
  const { parts, electron } = await frameworkParts(app);
  const asar = path.join(app, "Contents", "Resources", "app.asar");
  if (await exists(asar)) parts.push(...(await asarPackages(asar).catch(() => [])));
  if (electron) parts.unshift({ ecosystem: "npm", name: "electron", version: electron, via: "Contents/Frameworks/Electron Framework.framework" });
  return {
    id: `app:${hash(app)}`,
    layer: "apps",
    kind: "app",
    name,
    version: (info.CFBundleShortVersionString as string | undefined) ?? (info.CFBundleVersion as string | undefined),
    path: app,
    evidence: electron ? `Info.plist, Electron ${electron} framework, and the packages in app.asar` : "Info.plist and the frameworks it bundles",
    parts,
    meta: { bundleId: info.CFBundleIdentifier as string | undefined, electron },
  };
}

export async function collectApps(onItem: (i: Item) => void): Promise<Item[]> {
  const items: Item[] = [];
  for (const app of await appPaths()) {
    const stamp = await mtime(path.join(app, "Contents", "Info.plist"));
    const item = await cached("apps", app, stamp, () => readApp(app)).catch(() => undefined);
    if (item) {
      await markArrival(item);
      items.push(item);
      onItem(item);
    }
  }
  return items;
}

// macOS tags downloaded apps with com.apple.quarantine. Flag 0x40 is set the first time the app
// is opened, so a tag without it means the app arrived but has never run.
export async function markArrival(item: Item) {
  if (!item.path) return;
  const r = await run("xattr", ["-p", "com.apple.quarantine", item.path], 3_000);
  delete item.meta.notOpened;
  delete item.meta.arrivedAt;
  if (!r.ok) return;
  const [flags, stamp] = r.stdout.trim().split(";");
  const f = parseInt(flags, 16);
  if (!Number.isFinite(f) || f & 0x40) return;
  item.meta.notOpened = true;
  const at = parseInt(stamp, 16) * 1000;
  if (at) item.meta.arrivedAt = at;
}
