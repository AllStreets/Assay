// The data model shared by the engine and the interface.

export type Layer = "apps" | "models" | "extensions" | "packages" | "containers";

export type ItemKind =
  | "app"
  | "ollama-model"
  | "hf-model"
  | "model-file"
  | "browser-extension"
  | "editor-extension"
  | "brew"
  | "npm-global"
  | "pip"
  | "docker-image";

// Ecosystems follow OSV.dev naming where one exists.
export type Ecosystem = "npm" | "PyPI" | "Homebrew" | "framework" | "chromium" | "docker";

// Something inside an item: a library, a framework, a bundled runtime.
export interface Part {
  ecosystem: Ecosystem;
  name: string;
  version?: string;
  // Where inside the item it was found, for the trace and the evidence.
  via?: string;
}

export interface Item {
  id: string;
  layer: Layer;
  kind: ItemKind;
  name: string;
  version?: string;
  path?: string;
  // How the item was identified, in words a reader can check.
  evidence: string;
  sizeBytes?: number;
  parts: Part[];
  // Kind-specific facts: an app's bundle id, a model's architecture.
  meta: Record<string, string | number | boolean | string[] | undefined>;
  // A model's full reading, when the item is a model.
  model?: ModelReport;
}

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export type FindingKind = "vulnerability" | "code-on-load" | "unsafe-format" | "unreadable";

export interface Finding {
  id: string;
  itemId: string;
  kind: FindingKind;
  severity: Severity;
  title: string;
  detail: string;
  // The part the finding is about, when it is inside the item.
  part?: Part;
  // The fact that proves it: an import in a pickle, an advisory id.
  evidence: string;
  advisory?: { id: string; aliases: string[]; summary?: string; fixed?: string; url: string; published?: string };
}

// ---------- models ----------

export type ModelFormat = "gguf" | "safetensors" | "pickle" | "pytorch-zip" | "unknown";

export interface PickleImport {
  module: string;
  name: string;
  // Whether this import can run code when the file is loaded.
  verdict: "safe" | "unknown" | "dangerous";
}

export interface TensorGroup {
  name: string;
  count: number;
  params: number;
}

export interface ModelFile {
  path: string;
  format: ModelFormat;
  sizeBytes: number;
  imports?: PickleImport[];
  error?: string;
}

export interface ModelReport {
  format: ModelFormat;
  architecture?: string;
  parameters?: number;
  quantization?: string;
  contextLength?: number;
  license?: string;
  chatTemplate?: string;
  tensorCount?: number;
  // Tensors grouped by block (embeddings, each layer, output), for the X-ray.
  groups?: TensorGroup[];
  layers?: number;
  files: ModelFile[];
  // True when no file in the model can run code on load.
  safeToLoad: boolean;
}

// ---------- the assay ----------

export interface LayerSummary {
  layer: Layer;
  items: number;
  parts: number;
}

export interface AssayResult {
  id: number;
  startedAt: number;
  finishedAt: number;
  host: string;
  items: Item[];
  findings: Finding[];
  layers: LayerSummary[];
  vulnCheck: { ran: boolean; queried: number; at?: number; error?: string };
  // Whether the permissions you've granted could be read (needs Full Disk Access).
  access?: { read: boolean; reason?: string };
  // Layers Assay couldn't read, said plainly (for example, Docker not running).
  notes?: string[];
}

export interface Progress {
  running: boolean;
  stage?: string;
  layer?: Layer;
  found: Record<Layer, { items: number; parts: number }>;
  startedAt?: number;
  // Items read so far in this assay, after the first `from` the page already has; parts are
  // left out to keep each poll small.
  fresh?: Item[];
  seen?: number;
}

export interface Settings {
  checkOnline: boolean;
  modelFolders: string[];
  hiddenItems: string[];
}

export interface QuarantineRecord {
  id: string;
  itemId: string;
  name: string;
  from: string;
  to: string;
  at: number;
  bytes: number;
  // The item and its findings as they were, so release puts them back in the assay.
  item?: Item;
  findings?: Finding[];
}

export interface ActionResult {
  ok: boolean;
  message: string;
  undo?: string;
}

// ---------- Changes between assays ----------
export interface ChangeItem {
  id: string;
  name: string;
  kind: string;
  layer: string;
  version?: string;
  install?: string;
  advisories: number;
  runsCode?: boolean;
  fromVersion?: string;
  fixed?: string[];
  introduced?: string[];
}

export interface Change {
  from: number;
  to: number;
  at: number;
  cleanBefore: number;
  cleanAfter: number;
  added: ChangeItem[];
  removed: ChangeItem[];
  updated: ChangeItem[];
  newlyPublished: ChangeItem[];
}
