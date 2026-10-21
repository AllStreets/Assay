import path from "node:path";
import type { AssayResult, Change, ChangeItem } from "../shared/types.js";
import { notify } from "./notices.js";
import { DATA_DIR } from "./paths.js";
import { readJson, writeJson } from "./store.js";

// What changed between one assay and the next: software that arrived or left, updates and
// the advisories each one fixed or brought in, advisories newly published against software
// that didn't change, and how the clean share moved. Kept as a short history on disk.

const FILE = path.join(DATA_DIR, "history.json");
const KEEP = 60;

interface Summary { id: string; name: string; kind: string; layer: string; version?: string; install?: string; adv: Set<string>; code: boolean }

// Items the watcher caught after an assay are folded into it; when it's the earlier side of a
// diff, they count as arrivals of the next interval, not as things that were already there.
function summarize(r: AssayResult, earlier = false) {
  const m = new Map<string, Summary>();
  for (const i of r.items) if (!(earlier && i.meta.caughtNew)) m.set(i.id, { id: i.id, name: i.name, kind: i.kind, layer: i.layer, version: i.version, install: i.meta.envLabel as string | undefined, adv: new Set(), code: false });
  for (const f of r.findings) {
    const s = m.get(f.itemId);
    if (!s) continue;
    if (f.advisory) s.adv.add(f.advisory.id);
    if (f.kind === "code-on-load") s.code = true;
  }
  return m;
}

// Clean share, per 1,000 libraries; the same sum the interface shows.
export function cleanShare(r: AssayResult) {
  const total = r.items.reduce((a, i) => a + i.parts.length, 0);
  const bad = new Set(r.findings.filter((f) => f.kind === "vulnerability" && f.part).map((f) => `${f.itemId}|${f.part!.name}@${f.part!.version}@${f.part!.via ?? ""}`)).size;
  return total ? Math.min(999, Math.floor(((total - bad) / total) * 1000)) : 999;
}

const brief = (s: Summary): ChangeItem => ({ id: s.id, name: s.name, kind: s.kind, layer: s.layer, version: s.version, install: s.install, advisories: s.adv.size, runsCode: s.code || undefined });

export function diff(prev: AssayResult, next: AssayResult): Change {
  const a = summarize(prev, true), b = summarize(next);
  const c: Change = {
    from: prev.id, to: next.id, at: next.finishedAt,
    cleanBefore: cleanShare(prev), cleanAfter: cleanShare(next),
    added: [], removed: [], updated: [], newlyPublished: [],
  };
  for (const [id, s] of b) {
    const o = a.get(id);
    if (!o) { c.added.push(brief(s)); continue; }
    const fixed = [...o.adv].filter((x) => !s.adv.has(x));
    const introduced = [...s.adv].filter((x) => !o.adv.has(x));
    if (o.version !== s.version) c.updated.push({ ...brief(s), fromVersion: o.version, fixed, introduced });
    else if (introduced.length) c.newlyPublished.push({ ...brief(s), introduced });
  }
  for (const [id, s] of a) if (!b.has(id)) c.removed.push(brief(s));
  return c;
}

export const isEmpty = (c: Change) => !c.added.length && !c.removed.length && !c.updated.length && !c.newlyPublished.length;

export async function changes(): Promise<Change[]> {
  return readJson<Change[]>(FILE, []);
}

export async function record(prev: AssayResult | null, next: AssayResult) {
  if (!prev) return;
  const c = diff(prev, next);
  const list = await changes();
  await writeJson(FILE, [c, ...list].slice(0, KEEP));
  if (isEmpty(c)) return;
  // One notification per assay, leading with what matters most.
  const fixed = c.updated.reduce((n, u) => n + (u.fixed?.length ?? 0), 0);
  const brought = c.updated.reduce((n, u) => n + (u.introduced?.length ?? 0), 0) + c.newlyPublished.reduce((n, u) => n + (u.introduced?.length ?? 0), 0);
  const parts: string[] = [];
  if (c.updated.length) parts.push(`${c.updated.length} updated`);
  if (c.added.length) parts.push(`${c.added.length} new`);
  if (c.removed.length) parts.push(`${c.removed.length} gone`);
  const coder = c.added.find((x) => x.runsCode);
  const title = coder ? `${coder.name} arrived, and would run code if loaded` : fixed && fixed >= brought ? `Updates fixed ${fixed} known ${fixed === 1 ? "advisory" : "advisories"}` : brought ? `${brought} new ${brought === 1 ? "advisory" : "advisories"} since the last assay` : "Changes since the last assay";
  await notify(title, `${parts.join(", ") || "No software changed"}. Clean share ${c.cleanBefore} to ${c.cleanAfter} per 1,000.`, "#/changes");
}
