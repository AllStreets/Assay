import { promises as fs } from "node:fs";
import path from "node:path";
import type { Item, ModelFile, ModelFormat, ModelReport, TensorGroup } from "../../shared/types.js";
import { readGguf } from "../models/gguf.js";
import { isZip, looksLikePickle, readSafetensors, scanPickleFile } from "../models/pickle.js";
import { readHead } from "../models/reader.js";
import { HOME } from "../paths.js";
import { cached, exists, getSettings, hash, list } from "../store.js";

const OLLAMA = path.join(HOME, ".ollama", "models");
const HF = process.env.HF_HUB_CACHE ?? path.join(process.env.HF_HOME ?? path.join(HOME, ".cache", "huggingface"), "hub");
const LMSTUDIO = [path.join(HOME, ".lmstudio", "models"), path.join(HOME, ".cache", "lm-studio", "models")];
const WEIGHT_EXT = /\.(gguf|safetensors|bin|pt|pth|ckpt|pkl|pickle)$/i;

// Reads one weight file by what its bytes say, not by its extension.
export async function readWeights(file: string): Promise<{ file: ModelFile; report?: Partial<ModelReport> }> {
  const st = await fs.stat(file);
  const head = await readHead(file, 16);
  const base: ModelFile = { path: file, format: "unknown", sizeBytes: st.size };
  // Decided before parsing, so a pickle that fails to parse is still known to be one.
  const pickleShaped = (await isZip(head)) || looksLikePickle(head);
  try {
    if (head.toString("latin1", 0, 4) === "GGUF") {
      const g = await cached("gguf", file, `${st.size}:${st.mtimeMs}`, () => readGguf(file));
      return {
        file: { ...base, format: "gguf" },
        report: {
          format: "gguf", architecture: g.architecture, parameters: g.parameters, quantization: g.quantization,
          contextLength: g.contextLength, layers: g.layers, license: g.license, chatTemplate: g.chatTemplate,
          tensorCount: g.tensorCount, groups: g.groups,
        },
      };
    }
    if (/\.safetensors$/i.test(file) || (head.length >= 9 && head[8] === 0x7b)) {
      const s = await cached("safetensors", file, `${st.size}:${st.mtimeMs}`, () => readSafetensors(file));
      return {
        file: { ...base, format: "safetensors" },
        report: { format: "safetensors", parameters: s.parameters, quantization: s.dtype, tensorCount: s.tensors, groups: s.groups },
      };
    }
    if (pickleShaped) {
      const p = await cached("pickle", file, `${st.size}:${st.mtimeMs}`, () => scanPickleFile(file));
      return { file: { ...base, format: p.format, imports: p.imports } };
    }
    return { file: base };
  } catch (e) {
    return { file: { ...base, format: pickleShaped ? ((await isZip(head)) ? "pytorch-zip" : "pickle") : base.format, error: (e as Error).message } };
  }
}

const codeCapable = (f: ModelFormat) => f === "pickle" || f === "pytorch-zip";

export function merge(files: { file: ModelFile; report?: Partial<ModelReport> }[]): ModelReport {
  const main = files.filter((f) => f.report).sort((a, b) => b.file.sizeBytes - a.file.sizeBytes)[0]?.report ?? {};
  const allGroups = new Map<string, TensorGroup>();
  let parameters = 0;
  let tensors = 0;
  for (const f of files) {
    parameters += f.report?.parameters ?? 0;
    tensors += f.report?.tensorCount ?? 0;
    for (const g of f.report?.groups ?? []) {
      const prev = allGroups.get(g.name);
      allGroups.set(g.name, prev ? { name: g.name, count: prev.count + g.count, params: prev.params + g.params } : { ...g });
    }
  }
  const formats = new Set(files.map((f) => f.file.format).filter((f) => f !== "unknown"));
  const format: ModelFormat = formats.has("pickle") ? "pickle" : formats.has("pytorch-zip") ? "pytorch-zip" : formats.has("gguf") ? "gguf" : formats.has("safetensors") ? "safetensors" : "unknown";
  return {
    ...main,
    format,
    parameters: parameters || undefined,
    tensorCount: tensors || undefined,
    groups: allGroups.size ? [...allGroups.values()] : undefined,
    files: files.map((f) => f.file),
    // Fails closed: a pickle Assay couldn't read to the end is not called safe.
    safeToLoad: files.every((f) => !(f.file.imports ?? []).some((i) => i.verdict !== "safe") && !(f.file.error && codeCapable(f.file.format))),
  };
}

// ---------- Ollama ----------

interface OllamaManifest {
  layers: { mediaType: string; digest: string; size: number }[];
}

async function ollama(onItem: (i: Item) => void, items: Item[]) {
  const root = path.join(OLLAMA, "manifests");
  const blob = (digest: string) => path.join(OLLAMA, "blobs", digest.replace(":", "-"));
  for (const host of await list(root)) {
    for (const ns of await list(path.join(root, host))) {
      for (const model of await list(path.join(root, host, ns))) {
        for (const tag of await list(path.join(root, host, ns, model))) {
          const mpath = path.join(root, host, ns, model, tag);
          let m: OllamaManifest;
          try {
            m = JSON.parse(await fs.readFile(mpath, "utf8"));
          } catch {
            continue;
          }
          const weights = m.layers.filter((l) => l.mediaType.endsWith(".model") || l.mediaType.endsWith(".projector") || l.mediaType.endsWith(".adapter"));
          const read = await Promise.all(weights.map((l) => readWeights(blob(l.digest)).catch(() => undefined)));
          const report = merge(read.filter(Boolean) as { file: ModelFile; report?: Partial<ModelReport> }[]);
          const lic = m.layers.find((l) => l.mediaType.endsWith(".license"));
          if (lic && !report.license) {
            const text = await fs.readFile(blob(lic.digest), "utf8").catch(() => "");
            report.license = text.split("\n").map((s) => s.trim()).find((s) => s.length > 3)?.slice(0, 120);
          }
          const tpl = m.layers.find((l) => l.mediaType.endsWith(".template"));
          if (tpl) report.chatTemplate = await fs.readFile(blob(tpl.digest), "utf8").catch(() => report.chatTemplate);
          const name = ns === "library" ? model : `${ns}/${model}`;
          const item: Item = {
            id: `ollama:${hash(mpath)}`,
            layer: "models",
            kind: "ollama-model",
            name: tag === "latest" ? name : `${name}:${tag}`,
            version: tag,
            path: mpath,
            evidence: "Ollama manifest, and the GGUF header of each weight blob",
            sizeBytes: m.layers.reduce((a, l) => a + (l.size ?? 0), 0),
            parts: [],
            meta: { source: host, architecture: report.architecture, quantization: report.quantization },
            model: report,
          };
          items.push(item);
          onItem(item);
        }
      }
    }
  }
}

// ---------- Hugging Face cache ----------

async function huggingface(onItem: (i: Item) => void, items: Item[]) {
  for (const dir of await list(HF)) {
    const m = dir.match(/^models--(.+)$/);
    if (!m) continue;
    const repo = m[1].replace(/--/g, "/");
    const snaps = path.join(HF, dir, "snapshots");
    const ref = (await fs.readFile(path.join(HF, dir, "refs", "main"), "utf8").catch(() => "")).trim();
    const snap = ref && (await exists(path.join(snaps, ref))) ? ref : (await list(snaps))[0];
    if (!snap) continue;
    const files: string[] = [];
    const walk = async (d: string) => {
      for (const f of await list(d)) {
        const p = path.join(d, f);
        const st = await fs.stat(p).catch(() => undefined);
        if (st?.isDirectory()) await walk(p);
        else if (st && WEIGHT_EXT.test(f)) files.push(p);
      }
    };
    await walk(path.join(snaps, snap));
    if (!files.length) continue;
    const read = await Promise.all(files.map((f) => readWeights(f)));
    const report = merge(read);
    const config = JSON.parse(await fs.readFile(path.join(snaps, snap, "config.json"), "utf8").catch(() => "{}"));
    report.architecture ??= (config.architectures?.[0] as string | undefined) ?? config.model_type;
    report.layers ??= config.num_hidden_layers ?? config.n_layer;
    report.contextLength ??= config.max_position_embeddings;
    const item: Item = {
      id: `hf:${hash(dir)}`,
      layer: "models",
      kind: "hf-model",
      name: repo,
      version: snap.slice(0, 7),
      path: path.join(snaps, snap),
      evidence: "Hugging Face cache snapshot, config.json, and the header of each weight file",
      sizeBytes: read.reduce((a, r) => a + r.file.sizeBytes, 0),
      parts: [],
      meta: { source: "Hugging Face", revision: snap, architecture: report.architecture },
      model: report,
    };
    items.push(item);
    onItem(item);
  }
}

export const isWeightFile = (f: string) => WEIGHT_EXT.test(f);

async function files(paths: string[], source: string, onItem: (i: Item) => void, items: Item[]) {
  for (const p of paths) {
    const item = await modelFile(p, source);
    if (!item) continue;
    items.push(item);
    onItem(item);
  }
}

// ---------- LM Studio and loose files ----------

async function looseFiles(roots: string[], depth: number, skip: string[]): Promise<string[]> {
  const out: string[] = [];
  const walk = async (d: string, left: number) => {
    if (skip.some((s) => d.startsWith(s))) return;
    for (const f of await list(d)) {
      if (f.startsWith(".") || f === "node_modules" || f.endsWith(".app")) continue;
      const p = path.join(d, f);
      const st = await fs.lstat(p).catch(() => undefined);
      if (!st || st.isSymbolicLink()) continue;
      if (st.isDirectory() && left > 0) await walk(p, left - 1);
      else if (st.isFile() && WEIGHT_EXT.test(f) && st.size > 1_000_000) out.push(p);
    }
  };
  for (const r of roots) await walk(r, depth);
  return out;
}

// One loose weight file as an item, or nothing if its bytes aren't a model.
export async function modelFile(p: string, source: string): Promise<Item | undefined> {
    const r = await readWeights(p);
    // A .bin that is not a model (an installer, a firmware image) has no recognisable header.
    if (r.file.format === "unknown" && !/\.(gguf|safetensors|ckpt|pt|pth)$/i.test(p)) return undefined;
    const report = merge([r]);
    return {
      id: `file:${hash(p)}`,
      layer: "models",
      kind: "model-file",
      name: path.basename(p),
      path: p,
      evidence: `The file’s own header (${r.file.format})`,
      sizeBytes: r.file.sizeBytes,
      parts: [],
      meta: { source: source === "Folder" ? path.dirname(p).replace(HOME, "~") : source, architecture: report.architecture, quantization: report.quantization },
      model: report,
    };
}

export async function collectModels(onItem: (i: Item) => void): Promise<Item[]> {
  const items: Item[] = [];
  await ollama(onItem, items).catch(() => {});
  await huggingface(onItem, items).catch(() => {});
  const lm = [];
  for (const d of LMSTUDIO) if (await exists(d)) lm.push(d);
  await files(await looseFiles(lm, 4, []), "LM Studio", onItem, items);
  const settings = await getSettings();
  await files(await looseFiles(settings.modelFolders, 4, [OLLAMA, HF, ...LMSTUDIO]), "Folder", onItem, items);
  return items;
}
