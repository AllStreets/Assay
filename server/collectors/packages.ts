import type { Item, Part } from "../../shared/types.js";
import { run } from "../run.js";
import { hash } from "../store.js";

// Package managers print their own inventories; Assay asks each one directly.

function firstJson<T>(text: string): T | undefined {
  const i = text.search(/[[{]/);
  if (i < 0) return undefined;
  try {
    return JSON.parse(text.slice(i)) as T;
  } catch {
    return undefined;
  }
}

async function which(cmd: string) {
  const r = await run("/bin/sh", ["-lc", `command -v ${cmd}`], 5_000);
  return r.ok ? r.stdout.trim().split("\n")[0] : undefined;
}

interface BrewInfo {
  formulae: { name: string; full_name: string; desc?: string; installed: { version: string; installed_on_request?: boolean }[]; versions?: { stable?: string }; outdated?: boolean }[];
  casks: { token: string; name?: string[]; installed?: string; version?: string; outdated?: boolean }[];
}

async function homebrew(onItem: (i: Item) => void, items: Item[]) {
  const brew = (await which("brew")) ?? "/opt/homebrew/bin/brew";
  const r = await run(brew, ["info", "--json=v2", "--installed"], 120_000);
  const info = firstJson<BrewInfo>(r.stdout);
  if (!info) return;
  for (const f of info.formulae) {
    const inst = f.installed.at(-1);
    if (!inst) continue;
    const item: Item = {
      id: `brew:${f.full_name}`,
      layer: "packages",
      kind: "brew",
      name: f.full_name,
      version: inst.version,
      evidence: "brew info --json=v2 --installed",
      parts: [],
      meta: { manager: "Homebrew", description: f.desc, latest: f.versions?.stable, outdated: f.outdated, onRequest: inst.installed_on_request },
    };
    items.push(item);
    onItem(item);
  }
}

interface NpmTree {
  dependencies?: Record<string, { version?: string; dependencies?: NpmTree["dependencies"] }>;
}

async function npmGlobal(onItem: (i: Item) => void, items: Item[]) {
  const npm = await which("npm");
  if (!npm) return;
  const r = await run(npm, ["ls", "-g", "--all", "--json", "--long=false"], 120_000);
  const tree = firstJson<NpmTree>(r.stdout);
  for (const [name, dep] of Object.entries(tree?.dependencies ?? {})) {
    const parts: Part[] = [];
    const walk = (deps: NpmTree["dependencies"], via: string) => {
      for (const [n, d] of Object.entries(deps ?? {})) {
        parts.push({ ecosystem: "npm", name: n, version: d.version, via: `${via}/${n}` });
        walk(d.dependencies, `${via}/${n}`);
      }
    };
    walk(dep.dependencies, name);
    const item: Item = {
      id: `npm:${name}`,
      layer: "packages",
      kind: "npm-global",
      name,
      version: dep.version,
      evidence: `npm ls -g (${npm})`,
      parts: [{ ecosystem: "npm", name, version: dep.version, via: name }, ...parts],
      meta: { manager: "npm" },
    };
    items.push(item);
    onItem(item);
  }
}

async function pip(onItem: (i: Item) => void, items: Item[]) {
  const seen = new Set<string>();
  for (const cmd of ["python3", "/usr/bin/python3"]) {
    const py = cmd.startsWith("/") ? cmd : await which(cmd);
    if (!py) continue;
    const real = (await run(py, ["-c", "import sys;print(sys.prefix)"], 10_000)).stdout.trim();
    if (!real || seen.has(real)) continue;
    seen.add(real);
    const r = await run(py, ["-m", "pip", "list", "--format=json", "--disable-pip-version-check"], 60_000);
    const pkgs = firstJson<{ name: string; version: string }[]>(r.stdout) ?? [];
    for (const p of pkgs) {
      const item: Item = {
        id: `pip:${hash(real)}:${p.name.toLowerCase()}`,
        layer: "packages",
        kind: "pip",
        name: p.name,
        version: p.version,
        evidence: `pip list in ${real}`,
        parts: [{ ecosystem: "PyPI", name: p.name, version: p.version, via: real }],
        meta: { manager: "pip", environment: real },
      };
      items.push(item);
      onItem(item);
    }
  }
}

export async function collectPackages(onItem: (i: Item) => void): Promise<Item[]> {
  const items: Item[] = [];
  await homebrew(onItem, items).catch(() => {});
  await npmGlobal(onItem, items).catch(() => {});
  await pip(onItem, items).catch(() => {});
  return items;
}

// ---------- containers ----------

export async function collectContainers(onItem: (i: Item) => void): Promise<{ items: Item[]; note?: string }> {
  const docker = (await which("docker")) ?? (await run("/bin/ls", ["/usr/local/bin/docker"], 2_000)).stdout.trim();
  if (!docker) return { items: [], note: "Docker isn’t installed." };
  const r = await run(docker, ["images", "--format", "{{json .}}"], 30_000);
  if (!r.ok) return { items: [], note: /daemon|connect/i.test(r.stderr) ? "Docker is installed but not running, so its images weren’t read." : r.stderr.trim().split("\n")[0] };
  const items: Item[] = [];
  for (const line of r.stdout.split("\n")) {
    if (!line.trim()) continue;
    let img: { Repository: string; Tag: string; ID: string; Size: string; CreatedSince: string };
    try {
      img = JSON.parse(line);
    } catch {
      continue;
    }
    if (img.Repository === "<none>") continue;
    const item: Item = {
      id: `docker:${img.ID}`,
      layer: "containers",
      kind: "docker-image",
      name: img.Repository,
      version: img.Tag,
      evidence: "docker images",
      parts: [],
      meta: { imageId: img.ID, size: img.Size, created: img.CreatedSince },
    };
    items.push(item);
    onItem(item);
  }
  return { items };
}
