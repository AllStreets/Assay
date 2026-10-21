import { promises as fs } from "node:fs";
import path from "node:path";
import type { Item, Part } from "../../shared/types.js";
import { HOME } from "../paths.js";
import { run } from "../run.js";
import { exists, hash, list } from "../store.js";

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

const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;

// Every copy of a tool on this Mac, not just the first one on PATH: a Mac app and a
// terminal see different PATHs, and version managers keep several side by side.
async function copies(name: string, known: string[]): Promise<string[]> {
  const fromShell = (await run("/bin/zsh", ["-lic", `whence -ap ${name}`], 8_000)).stdout.split("\n").map((s) => s.trim()).filter((s) => s.startsWith("/"));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of [...fromShell, ...known]) {
    const real = await fs.realpath(p).catch(() => undefined);
    if (!real || seen.has(real)) continue;
    seen.add(real);
    out.push(p);
  }
  return out;
}

async function versionDirs(root: string, bin: string) {
  return (await list(root)).map((v) => path.join(root, v, bin));
}

// Node installs Assay knows to look for besides PATH: Homebrew, the official installer,
// nvm, fnm, volta and asdf.
async function npmCandidates() {
  const known = [
    "/opt/homebrew/bin/npm", "/usr/local/bin/npm",
    ...(await versionDirs(path.join(HOME, ".nvm", "versions", "node"), "bin/npm")),
    ...(await versionDirs(path.join(HOME, "Library", "Application Support", "fnm", "node-versions"), "installation/bin/npm")),
    ...(await versionDirs(path.join(HOME, ".asdf", "installs", "nodejs"), "bin/npm")),
    path.join(HOME, ".volta", "bin", "npm"),
  ];
  return copies("npm", known);
}

async function pythonCandidates() {
  const known = [
    "/opt/homebrew/bin/python3", "/usr/local/bin/python3", "/usr/bin/python3",
    ...(await versionDirs("/Library/Frameworks/Python.framework/Versions", "bin/python3")),
    ...(await versionDirs(path.join(HOME, ".pyenv", "versions"), "bin/python3")),
    ...["anaconda3", "miniconda3", "miniforge3", "opt/anaconda3", "opt/miniconda3"].map((d) => path.join(HOME, d, "bin", "python3")),
  ];
  return copies("python3", known);
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

// The label shown for an install: "Node 22.23.0 (nvm)".
function nodeLabel(bin: string, version: string) {
  const via = bin.includes("/.nvm/") ? "nvm" : bin.startsWith("/opt/homebrew") ? "Homebrew" : bin.includes("/fnm/") ? "fnm" : bin.includes("/.volta/") ? "volta" : bin.includes("/.asdf/") ? "asdf" : "";
  return `Node ${version}${via ? ` (${via})` : ""}`;
}

async function npmGlobal(onItem: (i: Item) => void, items: Item[]) {
  const seen = new Set<string>();
  for (const npm of await npmCandidates()) {
    if (!(await exists(npm))) continue;
    const bin = path.dirname(npm);
    // Each npm runs with its own node first on PATH, the way its shell would run it.
    // A clean environment, so npm settings inherited by the engine (npm_config_prefix and
    // the like) can't point every install at the same folder.
    const sh = (args: string) => run("/bin/sh", ["-c", `/usr/bin/env -i HOME=${q(HOME)} PATH=${q(bin)}:/usr/bin:/bin ${q(npm)} ${args}`], 120_000);
    const root = (await sh("root -g")).stdout.trim();
    if (!root || seen.has(root)) continue;
    seen.add(root);
    const nodeVersion = (await run(path.join(bin, "node"), ["--version"], 5_000)).stdout.trim().replace(/^v/, "");
    const env = nodeLabel(bin, nodeVersion || "?");
    const r = await sh("ls -g --all --json --long=false");
    await npmTree(firstJson<NpmTree>(r.stdout), { bin, root, env }, onItem, items);
  }
}

async function npmTree(tree: NpmTree | undefined, at: { bin: string; root: string; env: string }, onItem: (i: Item) => void, items: Item[]) {
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
      id: `npm:${hash(at.root)}:${name}`,
      layer: "packages",
      kind: "npm-global",
      name,
      version: dep.version,
      path: path.join(at.root, name),
      evidence: `npm ls -g in ${at.root}`,
      parts: [{ ecosystem: "npm", name, version: dep.version, via: name }, ...parts],
      meta: { manager: "npm", envLabel: at.env, bin: at.bin },
    };
    items.push(item);
    onItem(item);
  }
}

// The label shown for an environment: "Python 3.9.13 (python.org)".
function pythonLabel(prefix: string, version = "?") {
  const via = /conda|miniforge/i.test(prefix) ? "Anaconda" : prefix.startsWith("/opt/homebrew") || prefix.includes("/Cellar/") ? "Homebrew"
    : prefix.includes("Python.framework") && prefix.startsWith("/Library/Frameworks") ? "python.org" : prefix.includes("CommandLineTools") || prefix.includes("Xcode") ? "Apple"
    : prefix.includes("/.pyenv/") ? "pyenv" : "";
  return `Python ${version}${via ? ` (${via})` : ""}`;
}

async function pip(onItem: (i: Item) => void, items: Item[]) {
  const seen = new Set<string>();
  for (const py of await pythonCandidates()) {
    if (!(await exists(py))) continue;
    const [real, pyVersion] = (await run(py, ["-c", "import sys,platform;print(sys.prefix);print(platform.python_version())"], 10_000)).stdout.trim().split("\n");
    if (!real || seen.has(real)) continue;
    seen.add(real);
    const r = await run(py, ["-m", "pip", "list", "--format=json", "--disable-pip-version-check"], 60_000);
    let pkgs = firstJson<{ name: string; version: string }[]>(r.stdout);
    let how = "pip list";
    if (!pkgs) {
      // pip itself can crash on one malformed package; Python's own metadata still lists them all.
      const meta = await run(py, ["-c", "import json,importlib.metadata as m;print(json.dumps(sorted({(d.metadata['Name'] or '').lower():{'name':d.metadata['Name'],'version':d.version} for d in m.distributions() if d.metadata['Name']}.values(),key=lambda x:x['name'].lower())))"], 30_000);
      pkgs = firstJson<{ name: string; version: string }[]>(meta.stdout);
      how = "Python’s package metadata";
    }
    if (!pkgs) continue;
    for (const p of pkgs) {
      const item: Item = {
        id: `pip:${hash(real)}:${p.name.toLowerCase()}`,
        layer: "packages",
        kind: "pip",
        name: p.name,
        version: p.version,
        evidence: `${how} in ${real}`,
        parts: [{ ecosystem: "PyPI", name: p.name, version: p.version, via: real }],
        meta: { manager: "pip", environment: real, envLabel: pythonLabel(real, pyVersion) },
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
