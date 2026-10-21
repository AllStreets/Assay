import type { Finding, Item, ItemKind, Layer, Severity } from "../../shared/types";

export function bytes(n?: number) {
  if (!n) return "";
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)} TB`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} KB`;
  return `${n} B`;
}

export function params(n?: number) {
  if (!n) return "";
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B`;
  if (n >= 1e6) return `${Math.round(n / 1e6)}M`;
  return `${Math.round(n / 1e3)}K`;
}

export const num = (n: number) => n.toLocaleString("en-US");

export const LAYER_NAME: Record<Layer, string> = {
  apps: "Apps",
  models: "AI models",
  extensions: "Extensions",
  packages: "Packages",
  containers: "Containers",
};

export const LAYER_SUB: Record<Layer, string> = {
  apps: "Applications and the frameworks and npm packages bundled inside them",
  models: "Ollama, Hugging Face, LM Studio and model files in your folders",
  extensions: "Browser and code editor extensions",
  packages: "Homebrew formulae, global npm packages and Python packages",
  containers: "Docker images",
};

// Strata colours, lightest at the surface.
export const LAYER_COLOR: Record<Layer, string> = {
  apps: "#B89A72",
  models: "#E8B04B",
  extensions: "#8A8072",
  packages: "#5F5950",
  containers: "#403B36",
};

export const KIND_NAME: Record<ItemKind, string> = {
  app: "App",
  "ollama-model": "Ollama model",
  "hf-model": "Hugging Face model",
  "model-file": "Model file",
  "browser-extension": "Browser extension",
  "editor-extension": "Editor extension",
  brew: "Homebrew formula",
  "npm-global": "Global npm package",
  pip: "Python package",
  "docker-image": "Docker image",
};

export const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
export const SEVERITY_NAME: Record<Severity, string> = { critical: "Critical", high: "High", medium: "Moderate", low: "Low", info: "Note" };

export function worst(fs: Finding[]): Severity {
  return fs.reduce<Severity>((w, f) => (SEVERITY_RANK[f.severity] < SEVERITY_RANK[w] ? f.severity : w), "info");
}

export interface Attention {
  item: Item;
  findings: Finding[];
  worst: Severity;
  codeOnLoad: boolean;
  vulns: Finding[];
  // What to do, in one line, from what the findings say.
  fix: string;
  advisories: number;
}

const cmp = (a: string, b: string) => {
  const pa = a.split(".").map((x) => parseInt(x, 10) || 0);
  const pb = b.split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
};

function fixFor(item: Item, fs: Finding[]): string {
  if (fs.some((f) => f.kind === "code-on-load")) return "Quarantine it. It runs code the moment it’s loaded.";
  if (fs.some((f) => f.kind === "unreadable" && f.severity !== "info")) return "Don’t load it until you know where it came from. Assay couldn’t finish reading it.";
  const vulns = fs.filter((f) => f.kind === "vulnerability");
  const electron = vulns.filter((f) => f.part?.name === "electron");
  const others = new Set(vulns.filter((f) => f.part?.name !== "electron").map((f) => f.part?.name)).size;
  if (item.kind === "app" && electron.length) {
    const adv = new Set(electron.map((f) => f.advisory?.id)).size;
    return `Update ${item.name}. It ships Electron ${electron[0].part?.version}, which has ${adv} published ${adv === 1 ? "advisory" : "advisories"}${others ? `, and ${others} other affected ${others === 1 ? "library" : "libraries"}` : ""}.`;
  }
  if (item.kind === "app") return `Update ${item.name} when its developer ships a fix. It bundles ${new Set(vulns.map((f) => f.part?.name)).size} affected ${new Set(vulns.map((f) => f.part?.name)).size === 1 ? "package" : "packages"}.`;
  if (item.kind === "npm-global") return `Update it with npm.`;
  if (item.kind === "pip") return `Update it with pip${vulns[0]?.advisory?.fixed ? ` to ${vulns.map((f) => f.advisory?.fixed).filter(Boolean).sort((a, b) => cmp(a!, b!)).at(-1)} or later` : ""}.`;
  if (item.kind === "editor-extension") return "Update it from your editor’s extensions view.";
  if (fs.every((f) => f.severity === "info")) return "Nothing to do now. Noted for awareness.";
  return "Review the advisories below.";
}

export function attention(items: Item[], findings: Finding[]): Attention[] {
  const by = new Map<string, Finding[]>();
  for (const f of findings) by.set(f.itemId, [...(by.get(f.itemId) ?? []), f]);
  const out: Attention[] = [];
  for (const [id, fs] of by) {
    const item = items.find((i) => i.id === id);
    if (!item) continue;
    const vulns = fs.filter((f) => f.kind === "vulnerability");
    out.push({
      item,
      findings: fs,
      worst: worst(fs),
      codeOnLoad: fs.some((f) => f.kind === "code-on-load"),
      vulns,
      fix: fixFor(item, fs),
      advisories: new Set(vulns.map((f) => f.advisory?.id)).size,
    });
  }
  return out.sort((a, b) => Number(b.codeOnLoad) - Number(a.codeOnLoad) || SEVERITY_RANK[a.worst] - SEVERITY_RANK[b.worst] || b.advisories - a.advisories);
}

export function when(t?: number) {
  if (!t) return "";
  const d = Date.now() - t;
  if (d < 60_000) return "just now";
  if (d < 3_600_000) return `${Math.round(d / 60_000)} min ago`;
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)} h ago`;
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
