import express from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import { actionsFor, openApp, openInTeardown, quarantine, quarantined, release, reveal, teardownInstalled, trash, update } from "./actions.js";
import { getProgress, lastResult, startAssay } from "./assay.js";
import { writeSpecimen } from "./models/specimen.js";
import { noticesSince } from "./notices.js";
import { startWatching } from "./watch.js";
import { CACHE_DIR, DATA_DIR, DIST_DIR, PORT, VERSION } from "./paths.js";
import { readPlist, run } from "./run.js";
import { getSettings, hash, updateSettings } from "./store.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

// Only Assay's own pages may call the engine. The Host check stops a web page from
// reaching it through DNS rebinding; requiring a matching Origin on anything that changes
// state stops other sites, and other local servers' pages, from triggering actions.
const OWN_PORTS = new Set([String(PORT), "4721"]);
const ownHost = (h: string) => {
  const m = h.match(/^(127\.0\.0\.1|localhost)(?::(\d+))?$/);
  return !!m && OWN_PORTS.has(m[2] ?? "80");
};
const ownOrigin = (o: string) => {
  const m = o.match(/^https?:\/\/(.+)$/);
  return o === "tauri://localhost" || (!!m && ownHost(m[1]));
};
app.use("/api", (req, res, next) => {
  if (!ownHost(req.headers.host ?? "")) return res.status(403).json({ error: "Assay only answers requests from this Mac." });
  const origin = req.headers.origin;
  const changes = req.method !== "GET" && req.method !== "HEAD";
  if ((origin && !ownOrigin(origin)) || (changes && !origin)) {
    return res.status(403).json({ error: "Assay only answers requests from its own window." });
  }
  next();
});

const wrap = (fn: (req: express.Request, res: express.Response) => Promise<unknown>) => (req: express.Request, res: express.Response) => {
  fn(req, res).catch((e: Error) => res.status(400).json({ error: e.message }));
};

app.get("/api/assay", wrap(async (_req, res) => {
  const r = await lastResult();
  res.json(r ? { ...r, actions: Object.fromEntries(r.items.map((i) => [i.id, actionsFor(i)])) } : null);
}));

app.post("/api/assay/run", wrap(async (_req, res) => {
  startAssay().catch(() => {});
  res.json(getProgress());
}));

app.get("/api/progress", wrap(async (req, res) => {
  res.json(getProgress(Math.max(0, Number(req.query.from) || 0)));
}));

app.get("/api/teardown", wrap(async (_req, res) => res.json({ installed: await teardownInstalled() })));
app.post("/api/actions/teardown", wrap(async (req, res) => res.json(await openInTeardown(req.body?.itemId, req.body?.page))));
app.get("/api/notifications", wrap(async (req, res) => res.json(await noticesSince(Number(req.query.since) || 0))));

app.get("/api/settings", wrap(async (_req, res) => res.json(await getSettings())));
app.put("/api/settings", wrap(async (req, res) => res.json(await updateSettings(req.body ?? {}))));

app.get("/api/quarantine", wrap(async (_req, res) => res.json(await quarantined())));
app.post("/api/actions/quarantine", wrap(async (req, res) => res.json(await quarantine(req.body?.itemId))));
app.post("/api/actions/release", wrap(async (req, res) => res.json(await release(req.body?.recordId))));
app.post("/api/actions/trash", wrap(async (req, res) => res.json(await trash(req.body?.itemId))));
app.post("/api/actions/update", wrap(async (req, res) => res.json(await update(req.body?.itemId))));
app.post("/api/actions/reveal", wrap(async (req, res) => {
  await reveal(req.body?.itemId);
  res.status(204).end();
}));
app.post("/api/actions/open", wrap(async (req, res) => {
  await openApp(req.body?.itemId);
  res.status(204).end();
}));
app.post("/api/open-data", wrap(async (_req, res) => {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await run("open", [DATA_DIR], 5_000);
  res.status(204).end();
}));

// Writes the harmless test specimen to Downloads so anyone can watch Assay catch it.
app.post("/api/specimen", wrap(async (_req, res) => res.json({ path: await writeSpecimen() })));

app.get("/api/about", wrap(async (_req, res) => res.json({ version: VERSION, dataDir: DATA_DIR, pid: process.pid })));

// App icons, converted once with sips and cached.
app.get("/api/icon", wrap(async (req, res) => {
  const p = String(req.query.path ?? "");
  if (!p.endsWith(".app") || !path.isAbsolute(p)) return res.status(400).end();
  const dir = path.join(CACHE_DIR, "icons");
  await fs.mkdir(dir, { recursive: true });
  const out = path.join(dir, `${hash(p)}.png`);
  if (!(await fs.access(out).then(() => true, () => false))) {
    const info = (await readPlist(path.join(p, "Contents", "Info.plist"))) ?? {};
    const icon = (info.CFBundleIconFile as string | undefined) ?? (info.CFBundleIconName as string | undefined);
    const resDir = path.join(p, "Contents", "Resources");
    let file = icon ? path.join(resDir, icon.endsWith(".icns") ? icon : `${icon}.icns`) : undefined;
    if (!file || !(await fs.access(file).then(() => true, () => false))) {
      const any = (await fs.readdir(resDir).catch(() => [] as string[])).find((f) => f.endsWith(".icns"));
      file = any ? path.join(resDir, any) : undefined;
    }
    if (!file) return res.status(404).end();
    const r = await run("sips", ["-s", "format", "png", "-Z", "128", file, "--out", out], 10_000);
    if (!r.ok) return res.status(404).end();
  }
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.sendFile(out, { dotfiles: "allow" });
}));

app.use(express.static(DIST_DIR));
app.get(/^\/(?!api\/).*/, (_req, res, next) => {
  res.sendFile(path.join(DIST_DIR, "index.html"), (err) => err && next());
});

// Started by the Mac app: exit if the app goes away without cleaning up.
if (process.env.ASSAY_APP) {
  const parent = process.ppid;
  setInterval(() => {
    try {
      process.kill(parent, 0);
    } catch {
      process.exit(0);
    }
  }, 3_000).unref();
}

startWatching().catch(() => {});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Assay engine on http://127.0.0.1:${PORT} (data in ${DATA_DIR})`);
});
