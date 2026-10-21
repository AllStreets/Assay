// Assay as an MCP server: lets an AI agent ask what this Mac is made of and what's known to be
// broken in it, and, with your approval, quarantine or release something. Every answer comes from
// the running Assay engine, which reads real files and OSV.dev advisories.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { AssayResult, Change, Finding, Item, QuarantineRecord } from "../shared/types.js";

const PORT = process.env.ASSAY_PORT ?? "4720";
const ENGINE = `http://127.0.0.1:${PORT}`;
// The engine only accepts state changes from its own pages, so the tool identifies as one.
const ORIGIN = ENGINE;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(ENGINE + path, init);
  } catch {
    throw new Error("Assay isn't running. Open the Assay app (or run `npm run dev`) and try again.");
  }
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `Engine returned ${r.status}`);
  return (r.status === 204 ? undefined : r.json()) as Promise<T>;
}
const post = <T>(path: string, body: unknown) => call<T>(path, { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: JSON.stringify(body) });
const text = (v: unknown) => ({ content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }] });

async function result() {
  const r = await call<AssayResult | null>("/api/assay");
  if (!r) throw new Error("No assay has been run yet. Use run_assay first.");
  return r;
}

function brief(i: Item, fs: Finding[]) {
  const mine = fs.filter((f) => f.itemId === i.id && f.severity !== "info");
  return {
    name: i.name, kind: i.kind, version: i.version, install: i.meta.envLabel, path: i.path,
    libraries: i.parts.length || undefined,
    advisories: new Set(mine.map((f) => f.advisory?.id).filter(Boolean)).size || undefined,
    runsCodeOnLoad: mine.some((f) => f.kind === "code-on-load") || undefined,
    canReach: i.meta.reach, notOpenedYet: i.meta.notOpened || undefined, id: i.id,
  };
}

async function resolve(name: string) {
  const r = await result();
  const l = name.toLowerCase();
  const hit = r.items.find((i) => i.id === name || i.path === name) ?? r.items.find((i) => i.name.toLowerCase() === l) ?? r.items.find((i) => i.name.toLowerCase().includes(l));
  if (!hit) throw new Error(`Nothing in the latest assay matches "${name}".`);
  return { r, item: hit };
}

const server = new McpServer({ name: "assay", version: "0.1.0" });

server.registerTool("summary", {
  description: "What this Mac's software is made of and what's known to be broken: counts by layer, how many items carry known vulnerabilities, any AI model that runs code when loaded, and the clean share of libraries.",
  inputSchema: {},
}, async () => {
  const r = await result();
  const flagged = new Set(r.findings.filter((f) => f.severity !== "info").map((f) => f.itemId));
  return text({
    assayed: new Date(r.finishedAt).toISOString(), items: r.items.length, layers: r.layers,
    carryingKnownVulnerabilities: [...flagged].filter((id) => r.findings.some((f) => f.itemId === id && f.kind === "vulnerability")).length,
    modelsThatRunCode: r.items.filter((i) => r.findings.some((f) => f.itemId === i.id && f.kind === "code-on-load")).map((i) => i.name),
    vulnerabilityCheck: r.vulnCheck, permissionsRead: r.access?.read,
  });
});

server.registerTool("list_findings", {
  description: "Items that need attention, worst first: models that run code when loaded, then software with known vulnerabilities, ranked by severity and by what each app can reach (screen recording, keystrokes, full disk).",
  inputSchema: { limit: z.number().int().min(1).max(200).optional() },
}, async ({ limit }) => {
  const r = await result();
  const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  const worst = (id: string) => Math.min(...r.findings.filter((f) => f.itemId === id).map((f) => rank[f.severity]));
  const ids = [...new Set(r.findings.filter((f) => f.severity !== "info").map((f) => f.itemId))];
  const items = ids.map((id) => r.items.find((i) => i.id === id)!).filter(Boolean)
    .sort((a, b) => worst(a.id) - worst(b.id) || ((b.meta.reach as string[] | undefined)?.length ?? 0) - ((a.meta.reach as string[] | undefined)?.length ?? 0));
  return text(items.slice(0, limit ?? 25).map((i) => brief(i, r.findings)));
});

server.registerTool("get_item", {
  description: "Everything Assay knows about one item (app, model, extension, package, image): its libraries with published advisories and fixed versions, what it can reach, and for models the format and every import a pickle would perform.",
  inputSchema: { name: z.string().describe("Name, path or id, e.g. Discord or qwen3") },
}, async ({ name }) => {
  const { r, item } = await resolve(name);
  const fs = r.findings.filter((f) => f.itemId === item.id);
  return text({
    ...brief(item, r.findings),
    model: item.model && { format: item.model.format, architecture: item.model.architecture, parameters: item.model.parameters, quantization: item.model.quantization, safeToLoad: item.model.safeToLoad, imports: item.model.files.flatMap((f) => f.imports ?? []) },
    findings: fs.map((f) => ({ severity: f.severity, title: f.title, library: f.part && `${f.part.name}@${f.part.version}`, advisory: f.advisory?.id, fixedIn: f.advisory?.fixed, url: f.advisory?.url })),
  });
});

server.registerTool("which_carry", {
  description: "Which apps, packages and extensions on this Mac carry a given library, at which versions, and whether those versions have published advisories. Use it to answer questions like 'what ships an old Electron?' or 'do I have log4j anywhere?'.",
  inputSchema: { library: z.string().describe("Library name, e.g. electron, lodash, tar, requests") },
}, async ({ library }) => {
  const r = await result();
  const l = library.toLowerCase();
  const rows = [];
  for (const i of r.items) for (const p of i.parts) if (p.name.toLowerCase() === l) {
    const adv = r.findings.filter((f) => f.itemId === i.id && f.part?.name.toLowerCase() === l && f.part.version === p.version);
    rows.push({ in: i.name, kind: i.kind, version: p.version, advisories: new Set(adv.map((f) => f.advisory?.id)).size, fixedIn: adv.map((f) => f.advisory?.fixed).filter(Boolean)[0] });
  }
  return text(rows.length ? rows : `Nothing in the latest assay carries ${library}.`);
});

server.registerTool("list_models", {
  description: "Every AI model on this Mac (Ollama, Hugging Face cache, LM Studio, loose files) with format, size, precision, and whether it's safe to load or would run code.",
  inputSchema: {},
}, async () => {
  const r = await result();
  return text(r.items.filter((i) => i.layer === "models").map((m) => ({ name: m.name, source: m.meta.source, format: m.model?.format, parameters: m.model?.parameters, quantization: m.model?.quantization, safeToLoad: m.model?.safeToLoad, path: m.path })));
});

server.registerTool("recent_changes", {
  description: "What changed between recent assays: software that arrived or left, updates and the advisories each fixed or brought in, advisories newly published against unchanged software, and how the clean share moved.",
  inputSchema: { limit: z.number().int().min(1).max(20).optional() },
}, async ({ limit }) => {
  const list = await call<Change[]>("/api/changes");
  const shown = list.filter((c) => c.added.length || c.removed.length || c.updated.length || c.newlyPublished.length).slice(0, limit ?? 5);
  return text(shown.length ? shown.map((c) => ({
    from: c.from, to: c.to, at: new Date(c.at).toISOString(), cleanShare: `${c.cleanBefore} to ${c.cleanAfter} per 1,000`,
    updated: c.updated.map((u) => ({ name: u.name, from: u.fromVersion, to: u.version, fixed: u.fixed, introduced: u.introduced })),
    newlyPublished: c.newlyPublished.map((u) => ({ name: u.name, version: u.version, advisories: u.introduced })),
    arrived: c.added.map((u) => ({ name: u.name, kind: u.kind, advisories: u.advisories, runsCode: u.runsCode })),
    gone: c.removed.map((u) => u.name),
  })) : "No changes recorded yet. Run another assay after something updates.");
});

server.registerTool("run_assay", {
  description: "Run a fresh assay of the whole Mac. Takes about fifteen seconds; returns when it's done.",
  inputSchema: {},
}, async () => {
  await post("/api/assay/run", {});
  for (let i = 0; i < 240; i++) {
    const p = await call<{ running: boolean }>("/api/progress");
    if (!p.running) break;
    await new Promise((res) => setTimeout(res, 1000));
  }
  const r = await result();
  return text(`Assay ${r.id} finished: ${r.items.length} items.`);
});

server.registerTool("quarantine", {
  description: "Move an AI model, app or editor extension into Assay's quarantine, where nothing will open or load it. Fully reversible with release. Only do this when the user has agreed.",
  inputSchema: { name: z.string() },
}, async ({ name }) => {
  const { item } = await resolve(name);
  return text(await post("/api/actions/quarantine", { itemId: item.id }));
});

server.registerTool("release", {
  description: "Put a quarantined item back exactly where it was. Lists what's held when called without a name.",
  inputSchema: { name: z.string().optional() },
}, async ({ name }) => {
  const held = await call<QuarantineRecord[]>("/api/quarantine");
  if (!name) return text(held.map((h) => ({ name: h.name, from: h.from, at: new Date(h.at).toISOString() })));
  const rec = held.find((h) => h.name.toLowerCase().includes(name.toLowerCase()));
  if (!rec) throw new Error(`Nothing quarantined matches "${name}".`);
  return text(await post("/api/actions/release", { recordId: rec.id }));
});

await server.connect(new StdioServerTransport());
