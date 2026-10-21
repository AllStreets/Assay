import os from "node:os";
import type { AssayResult, Finding, Item, Layer, Progress } from "../shared/types.js";
import { collectApps } from "./collectors/apps.js";
import { collectExtensions } from "./collectors/extensions.js";
import { collectModels } from "./collectors/models.js";
import { collectContainers, collectPackages } from "./collectors/packages.js";
import { bySeverity, modelFindings, vulnFindings } from "./findings.js";
import { RESULT_FILE } from "./paths.js";
import { getSettings, readJson, writeJson } from "./store.js";
import { check, checkable } from "./vuln/osv.js";
import { attachReach } from "./grants.js";
import { record } from "./history.js";

const LAYERS: Layer[] = ["apps", "models", "extensions", "packages", "containers"];
const empty = () => Object.fromEntries(LAYERS.map((l) => [l, { items: 0, parts: 0 }])) as Progress["found"];

let progress: Progress = { running: false, found: empty() };
let running: Promise<AssayResult> | undefined;
let last: AssayResult | null | undefined;

// Everything read so far in the running assay, lightened, so the page can show the sheet
// developing item by item.
let seen: Item[] = [];
export const getProgress = (from = 0) => ({ ...progress, fresh: seen.slice(from), seen: seen.length });

const layersOf = (items: Item[]) =>
  LAYERS.map((l) => ({ layer: l, items: items.filter((i) => i.layer === l).length, parts: items.filter((i) => i.layer === l).reduce((a, i) => a + i.parts.length, 0) }));

// After an action moves something, the saved assay follows: the item leaves it, and comes
// back with its findings when it is released, so no page shows a thing that isn't there.
export async function withdraw(itemId: string): Promise<{ item: Item; findings: Finding[] } | undefined> {
  const r = await lastResult();
  const item = r?.items.find((i) => i.id === itemId);
  if (!r || !item) return;
  const findings = r.findings.filter((f) => f.itemId === itemId);
  r.items = r.items.filter((i) => i.id !== itemId);
  r.findings = r.findings.filter((f) => f.itemId !== itemId);
  r.layers = layersOf(r.items);
  await writeJson(RESULT_FILE, r);
  return { item, findings };
}

export async function restore(item: Item, findings: Finding[]) {
  const r = await lastResult();
  if (!r || r.items.some((i) => i.id === item.id)) return;
  r.items.push(item);
  r.findings = [...r.findings, ...findings].sort(bySeverity);
  r.layers = layersOf(r.items);
  await writeJson(RESULT_FILE, r);
}

export async function lastResult(): Promise<AssayResult | null> {
  last ??= await readJson<AssayResult | null>(RESULT_FILE, null);
  return last;
}

export function startAssay(): Promise<AssayResult> {
  running ??= runAssay().finally(() => {
    running = undefined;
  });
  return running;
}

async function runAssay(): Promise<AssayResult> {
  const startedAt = Date.now();
  progress = { running: true, stage: "Starting", found: empty(), startedAt };
  seen = [];
  const items: Item[] = [];
  const settings = await getSettings();
  const hidden = new Set(settings.hiddenItems);
  // Hidden by id, or by path so a hide survives the item being re-read.
  const isHidden = (i: Item) => hidden.has(i.id) || (!!i.path && hidden.has(i.path));
  const onItem = (i: Item) => {
    items.push(i);
    if (isHidden(i)) return;
    // When it was read, in milliseconds from the start: the read log shows real timings.
    i.meta.readAt = Date.now() - startedAt;
    seen.push({ ...i, parts: [], meta: { ...i.meta, partCount: i.parts.length } });
    progress.found[i.layer].items++;
    progress.found[i.layer].parts += i.parts.length;
  };
  const stage = (layer: Layer, text: string) => {
    progress.layer = layer;
    progress.stage = text;
  };

  stage("apps", "Reading apps and the libraries inside them");
  await collectApps(onItem);
  stage("models", "Reading AI models without loading them");
  await collectModels(onItem);
  stage("extensions", "Reading browser and editor extensions");
  await collectExtensions(onItem);
  stage("packages", "Asking Homebrew, npm and pip what they installed");
  await collectPackages(onItem);
  stage("containers", "Listing Docker images");
  const containers = await collectContainers(onItem);

  const visible = items.filter((i) => !isHidden(i));

  const findings = visible.flatMap(modelFindings);
  const queries = visible.flatMap((i) => i.parts.filter((p) => checkable(p.ecosystem) && p.version).map((p) => ({ ecosystem: p.ecosystem, name: p.name, version: p.version! })));
  progress.stage = "Reading the permissions you’ve granted";
  const access = await attachReach(visible);
  const vulnCheck: AssayResult["vulnCheck"] = { ran: false, queried: new Set(queries.map((q) => `${q.ecosystem}:${q.name}@${q.version}`)).size };
  if (settings.checkOnline && queries.length) {
    progress.stage = `Checking ${vulnCheck.queried.toLocaleString()} library versions against OSV.dev`;
    try {
      const advisories = await check(queries);
      for (const i of visible) findings.push(...vulnFindings(i, advisories));
      vulnCheck.ran = true;
      vulnCheck.at = Date.now();
    } catch (e) {
      vulnCheck.error = (e as Error).message;
    }
  }
  findings.sort(bySeverity);

  const prev = await lastResult();
  const result: AssayResult = {
    id: (prev?.id ?? 0) + 1,
    startedAt,
    finishedAt: Date.now(),
    host: os.hostname().replace(/\.local$/, ""),
    items: visible,
    findings,
    layers: layersOf(visible),
    vulnCheck,
    access,
  };
  if (containers.note) result.notes = [containers.note];
  await writeJson(RESULT_FILE, result);
  await record(prev, result).catch(() => {});
  last = result;
  progress = { running: false, found: progress.found, stage: "Done", startedAt };
  return result;
}
