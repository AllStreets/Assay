import { promises as fs } from "node:fs";
import path from "node:path";
import type { Item, Part } from "../../shared/types.js";
import { HOME } from "../paths.js";
import { hash, list } from "../store.js";

const AS = path.join(HOME, "Library", "Application Support");
const BROWSERS: [string, string][] = [
  ["Google Chrome", path.join(AS, "Google", "Chrome")],
  ["Chrome Beta", path.join(AS, "Google", "Chrome Beta")],
  ["Brave", path.join(AS, "BraveSoftware", "Brave-Browser")],
  ["Microsoft Edge", path.join(AS, "Microsoft Edge")],
  ["Arc", path.join(AS, "Arc", "User Data")],
  ["Vivaldi", path.join(AS, "Vivaldi")],
  ["Chromium", path.join(AS, "Chromium")],
  ["Comet", path.join(AS, "Comet")],
  ["ChatGPT Atlas", path.join(AS, "com.openai.atlas")],
];
const EDITORS: [string, string][] = [
  ["VS Code", path.join(HOME, ".vscode", "extensions")],
  ["VS Code Insiders", path.join(HOME, ".vscode-insiders", "extensions")],
  ["Cursor", path.join(HOME, ".cursor", "extensions")],
  ["Windsurf", path.join(HOME, ".windsurf", "extensions")],
];

const readJson = async (p: string) => JSON.parse(await fs.readFile(p, "utf8"));

// Chrome extensions name themselves "__MSG_key__" and keep the text in _locales.
async function resolveName(dir: string, manifest: Record<string, unknown>) {
  const raw = String(manifest.name ?? "");
  const m = raw.match(/^__MSG_(.+)__$/);
  if (!m) return raw;
  // The Mac's own language first, then the extension's default, then English.
  const sys = Intl.DateTimeFormat().resolvedOptions().locale.replace("-", "_");
  const locale = String(manifest.default_locale ?? "en");
  for (const loc of [sys, sys.split("_")[0], locale, "en", "en_US"]) {
    try {
      const msgs = await readJson(path.join(dir, "_locales", loc, "messages.json"));
      const hit = Object.entries(msgs).find(([k]) => k.toLowerCase() === m[1].toLowerCase());
      if (hit) return String((hit[1] as { message: string }).message);
    } catch {}
  }
  return raw;
}

async function browserExtensions(onItem: (i: Item) => void, items: Item[]) {
  for (const [browser, root] of BROWSERS) {
    for (const profile of await list(root)) {
      const extDir = path.join(root, profile, "Extensions");
      for (const id of await list(extDir)) {
        const versions = (await list(path.join(extDir, id))).filter((v) => !v.startsWith("."));
        const version = versions.sort().at(-1);
        if (!version) continue;
        const dir = path.join(extDir, id, version);
        let manifest: Record<string, unknown>;
        try {
          manifest = await readJson(path.join(dir, "manifest.json"));
        } catch {
          continue;
        }
        const perms = [...((manifest.permissions as string[]) ?? []), ...((manifest.host_permissions as string[]) ?? [])];
        const allSites = perms.some((p) => p === "<all_urls>" || p === "*://*/*" || p === "http://*/*" || p === "https://*/*");
        const item: Item = {
          id: `ext:${hash(dir)}`,
          layer: "extensions",
          kind: "browser-extension",
          name: await resolveName(dir, manifest),
          version: String(manifest.version ?? version),
          path: dir,
          evidence: `${browser} profile “${profile}”, manifest.json`,
          parts: [],
          meta: { host: browser, extensionId: id, permissions: perms.length, allSites, manifestVersion: manifest.manifest_version as number },
        };
        items.push(item);
        onItem(item);
      }
    }
  }
}

async function nodeModules(dir: string): Promise<Part[]> {
  const parts: Part[] = [];
  const nm = path.join(dir, "node_modules");
  for (const n of await list(nm)) {
    if (n.startsWith(".")) continue;
    const names = n.startsWith("@") ? (await list(path.join(nm, n))).map((s) => `${n}/${s}`) : [n];
    for (const name of names) {
      try {
        const pj = await readJson(path.join(nm, name, "package.json"));
        parts.push({ ecosystem: "npm", name, version: pj.version, via: `node_modules/${name}` });
      } catch {}
    }
  }
  return parts;
}

async function editorExtensions(onItem: (i: Item) => void, items: Item[]) {
  for (const [editor, root] of EDITORS) {
    for (const d of await list(root)) {
      if (d.startsWith(".") || !/-\d/.test(d)) continue;
      const dir = path.join(root, d);
      let pj: Record<string, unknown>;
      try {
        pj = await readJson(path.join(dir, "package.json"));
      } catch {
        continue;
      }
      const item: Item = {
        id: `ext:${hash(dir)}`,
        layer: "extensions",
        kind: "editor-extension",
        name: String(pj.displayName && !String(pj.displayName).startsWith("%") ? pj.displayName : pj.name),
        version: String(pj.version ?? ""),
        path: dir,
        evidence: `${editor} extension folder, package.json and its node_modules`,
        parts: await nodeModules(dir),
        meta: { host: editor, publisher: pj.publisher as string | undefined, extensionId: `${pj.publisher}.${pj.name}` },
      };
      items.push(item);
      onItem(item);
    }
  }
}

export async function collectExtensions(onItem: (i: Item) => void): Promise<Item[]> {
  const items: Item[] = [];
  await browserExtensions(onItem, items).catch(() => {});
  await editorExtensions(onItem, items).catch(() => {});
  return items;
}
