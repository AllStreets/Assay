import { watch, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Item } from "../shared/types.js";
import { lastResult, restore } from "./assay.js";
import { markArrival, readApp } from "./collectors/apps.js";
import { collectModels, isWeightFile, modelFile } from "./collectors/models.js";
import { modelFindings, vulnFindings } from "./findings.js";
import { attachReach } from "./grants.js";
import { notify } from "./notices.js";
import { getSettings } from "./store.js";
import { check, checkable } from "./vuln/osv.js";

// Check before first run. Assay watches the places apps and models arrive, and reads each new
// one the moment it lands, before anything opens or loads it. What it finds joins the latest
// assay and becomes a notification.

const HOME = os.homedir();
const APP_DIRS = ["/Applications", path.join(HOME, "Applications")];
const MODEL_DIRS = [path.join(HOME, ".ollama", "models", "manifests"), process.env.HF_HUB_CACHE ?? path.join(HOME, ".cache", "huggingface", "hub")];

const pending = new Map<string, NodeJS.Timeout>();
// Waits for a burst of file events to settle, so a download is read once, when it's finished.
function settle(key: string, ms: number, fn: () => Promise<void>) {
  clearTimeout(pending.get(key));
  pending.set(key, setTimeout(() => {
    pending.delete(key);
    fn().catch(() => {});
  }, ms));
}

async function known(id: string) {
  return !!(await lastResult())?.items.some((i) => i.id === id);
}

async function hidden(item: Item) {
  const h = new Set((await getSettings()).hiddenItems);
  return h.has(item.id) || (!!item.path && h.has(item.path));
}

async function admit(item: Item, why: string) {
  if ((await known(item.id)) || (await hidden(item))) return;
  item.meta.readAt = 0;
  item.meta.caughtNew = Date.now();
  const findings = modelFindings(item);
  if ((await getSettings()).checkOnline && item.parts.length) {
    const qs = item.parts.filter((p) => checkable(p.ecosystem) && p.version).map((p) => ({ ecosystem: p.ecosystem, name: p.name, version: p.version! }));
    if (qs.length) findings.push(...vulnFindings(item, await check(qs).catch(() => new Map())));
  }
  await restore(item, findings);
  const target = `#/item/${encodeURIComponent(item.id)}`;
  if (findings.some((f) => f.kind === "code-on-load")) {
    await notify(`${item.name} would run code if loaded`, `Assay read it as it arrived, before anything opened it. Quarantine it from Assay.`, target);
  } else if (findings.some((f) => f.kind === "vulnerability")) {
    const n = new Set(findings.map((f) => f.advisory?.id).filter(Boolean)).size;
    await notify(`${item.name} arrived with ${n} known ${n === 1 ? "advisory" : "advisories"}`, `${why} Read it before opening it.`, target);
  } else {
    await notify(`${item.name} checked`, `${why} Nothing known against it.`, target);
  }
}

async function newApp(p: string) {
  if (!p.endsWith(".app")) return;
  const item = await readApp(p).catch(() => undefined);
  if (!item) return;
  await markArrival(item);
  await attachReach([item]);
  await admit(item, item.meta.notOpened ? "It hasn’t been opened yet." : "It was just installed.");
}

async function newModelFile(p: string, source: string) {
  if (!isWeightFile(p)) return;
  const st = await fs.stat(p).catch(() => undefined);
  if (!st || st.size < 1_000_000) return;
  const item = await modelFile(p, source);
  if (item) await admit(item, "It hasn’t been loaded yet.");
}

// Ollama and Hugging Face add models as several files; read the whole store again (cached) and
// admit whatever is new.
async function newStoreModels() {
  const items = await collectModels(() => {});
  for (const i of items) if (i.kind !== "model-file") await admit(i, "It hasn’t been loaded yet.");
}

export async function startWatching() {
  for (const dir of APP_DIRS) {
    try {
      watch(dir, (_e, f) => f && f.endsWith(".app") && settle(`app:${f}`, 4_000, () => newApp(path.join(dir, f))));
    } catch {}
  }
  for (const dir of MODEL_DIRS) {
    try {
      watch(dir, { recursive: true }, () => settle("stores", 6_000, newStoreModels));
    } catch {}
  }
  const folders = (await getSettings()).modelFolders;
  for (const dir of folders) {
    try {
      watch(dir, { recursive: true }, (_e, f) => f && isWeightFile(f) && settle(`file:${dir}/${f}`, 5_000, () => newModelFile(path.join(dir, f), "Folder")));
    } catch {}
  }
}
