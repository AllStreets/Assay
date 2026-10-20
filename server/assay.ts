import os from "node:os";
import type { AssayResult, Item, Layer, Progress } from "../shared/types.js";
import { collectApps } from "./collectors/apps.js";
import { collectExtensions } from "./collectors/extensions.js";
import { collectModels } from "./collectors/models.js";
import { collectContainers, collectPackages } from "./collectors/packages.js";
import { bySeverity, modelFindings, vulnFindings } from "./findings.js";
import { RESULT_FILE } from "./paths.js";
import { getSettings, readJson, writeJson } from "./store.js";
import { check, checkable } from "./vuln/osv.js";

const LAYERS: Layer[] = ["apps", "models", "extensions", "packages", "containers"];
const empty = () => Object.fromEntries(LAYERS.map((l) => [l, { items: 0, parts: 0 }])) as Progress["found"];

let progress: Progress = { running: false, found: empty() };
let running: Promise<AssayResult> | undefined;
let last: AssayResult | null | undefined;

export const getProgress = () => progress;

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
  const items: Item[] = [];
  const settings = await getSettings();
  const hidden = new Set(settings.hiddenItems);
  // Hidden by id, or by path so a hide survives the item being re-read.
  const isHidden = (i: Item) => hidden.has(i.id) || (!!i.path && hidden.has(i.path));
  const onItem = (i: Item) => {
    items.push(i);
    if (isHidden(i)) return;
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
    layers: LAYERS.map((l) => ({ layer: l, items: visible.filter((i) => i.layer === l).length, parts: visible.filter((i) => i.layer === l).reduce((a, i) => a + i.parts.length, 0) })),
    vulnCheck,
  };
  if (containers.note) result.notes = [containers.note];
  await writeJson(RESULT_FILE, result);
  last = result;
  progress = { running: false, found: progress.found, stage: "Done", startedAt };
  return result;
}
