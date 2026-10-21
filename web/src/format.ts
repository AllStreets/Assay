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

// The permissions that let a flaw reach the rest of the Mac, as a clause.
export const STRONG_REACH = ["SystemPolicyAllFiles", "Accessibility", "ListenEvent", "ScreenCapture", "PostEvent"];
const REACH_CLAUSE: Record<string, string> = {
  SystemPolicyAllFiles: "has Full Disk Access", Accessibility: "can control your Mac", ListenEvent: "can see your keystrokes",
  ScreenCapture: "can record your screen", PostEvent: "can type and click for you",
};

function fixFor(item: Item, fs: Finding[]): string {
  const base = fixBase(item, fs);
  const strong = reachOf(item).filter((r) => STRONG_REACH.includes(r));
  if (!strong.length || !fs.some((f) => f.kind === "vulnerability")) return base;
  const clauses = strong.slice(0, 2).map((r) => REACH_CLAUSE[r]);
  return `${base} It ${clauses.join(" and ")}, so a flaw here reaches further than most.`;
}

function fixBase(item: Item, fs: Finding[]): string {
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
  if (item.kind === "npm-global") return `Update it with npm${item.meta.envLabel ? ` in ${item.meta.envLabel}` : ""}.`;
  if (item.kind === "pip") return `Update it with pip${vulns[0]?.advisory?.fixed ? ` to ${vulns.map((f) => f.advisory?.fixed).filter(Boolean).sort((a, b) => cmp(a!, b!)).at(-1)} or later` : ""}.`;
  if (item.kind === "editor-extension") return "Update it from your editor’s extensions view.";
  if (fs.every((f) => f.severity === "info")) return "Nothing to do now. Noted for awareness.";
  return "Review the advisories below.";
}

// The grants that make a flaw reach the rest of the Mac; mirrors server/grants.ts.
export const REACH_LABEL: Record<string, string> = {
  SystemPolicyAllFiles: "Full Disk Access", Accessibility: "Can control your Mac", ListenEvent: "Sees your keystrokes",
  ScreenCapture: "Can record your screen", PostEvent: "Sends keystrokes and clicks", AppleEvents: "Controls other apps",
  Microphone: "Microphone", Camera: "Camera", AudioCapture: "Records system audio", AddressBook: "Contacts", Photos: "Photos",
  Calendar: "Calendars", SystemPolicyDocumentsFolder: "Documents folder", SystemPolicyDesktopFolder: "Desktop folder", SystemPolicyDownloadsFolder: "Downloads folder",
};
const REACH_W: Record<string, number> = { SystemPolicyAllFiles: 5, Accessibility: 5, ListenEvent: 5, ScreenCapture: 4, PostEvent: 4, AppleEvents: 3, Microphone: 3, Camera: 3, AudioCapture: 3, AddressBook: 2, Photos: 2 };
export const reachOf = (i: Item) => (i.meta.reach as string[] | undefined) ?? [];
export const strongReach = (i: Item) => reachOf(i).filter((r) => ["SystemPolicyAllFiles", "Accessibility", "ListenEvent", "ScreenCapture", "PostEvent"].includes(r)).length;
export const reachWeight = (i: Item) => reachOf(i).reduce((a, s) => a + (REACH_W[s] ?? 1), 0);

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
  // Flaws times reach: within a severity, an app that can reach more of the Mac comes first.
  return out.sort((a, b) => Number(b.codeOnLoad) - Number(a.codeOnLoad) || SEVERITY_RANK[a.worst] - SEVERITY_RANK[b.worst] || strongReach(b.item) - strongReach(a.item) || b.advisories - a.advisories);
}

// One entry per thing you'd act on: an app, a model, or a whole package environment, since
// fifty outdated packages in one old Python install are one decision, not fifty.
export type Entry =
  | { type: "item"; a: Attention }
  | { type: "env"; key: string; label: string; manager: string; list: Attention[]; worst: Severity; advisories: number; fix: string };

const ENV_FIX: Record<string, (n: number) => string> = {
  pip: (n) => `${n} packages here have published advisories. Update them with pip in this environment, or remove the environment if nothing uses it.`,
  npm: (n) => `${n} global packages here have published advisories. Update them with npm, or remove ones you no longer use.`,
  Homebrew: (n) => `${n} formulae have published advisories. Run brew upgrade.`,
};

export function entries(list: Attention[]): Entry[] {
  const groups = new Map<string, Attention[]>();
  for (const a of list) {
    const label = a.item.layer === "packages" ? String(a.item.meta.envLabel ?? (a.item.kind === "brew" ? "Homebrew" : "")) : "";
    if (label && !a.codeOnLoad) groups.set(label, [...(groups.get(label) ?? []), a]);
  }
  const out: Entry[] = [];
  const done = new Set<string>();
  for (const a of list) {
    const label = a.item.layer === "packages" ? String(a.item.meta.envLabel ?? (a.item.kind === "brew" ? "Homebrew" : "")) : "";
    const g = label ? groups.get(label) : undefined;
    if (!g || g.length < 2) {
      out.push({ type: "item", a });
      continue;
    }
    if (done.has(label)) continue;
    done.add(label);
    const manager = String(g[0].item.meta.manager ?? "");
    out.push({
      type: "env", key: label, label, manager, list: g,
      worst: worst(g.flatMap((x) => x.findings)),
      advisories: new Set(g.flatMap((x) => x.vulns.map((f) => f.advisory?.id))).size,
      fix: (ENV_FIX[manager] ?? ENV_FIX.npm)(g.length),
    });
  }
  return out;
}

export function when(t?: number) {
  if (!t) return "";
  const d = Date.now() - t;
  if (d < 60_000) return "just now";
  if (d < 3_600_000) return `${Math.round(d / 60_000)} min ago`;
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)} h ago`;
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Fineness, the way an assay office states purity: parts per thousand. Here, the share of a
// piece of software's libraries with nothing published against them. A model that runs code
// when it's loaded is base metal; one Assay couldn't read has no fineness at all.
// "raw" is a streak laid down while the assay is still reading, before its metal is known.
export type Metal = "fine" | "gold" | "pale" | "rose" | "copper" | "base" | "unread" | "raw";

export function fineness(item: Item, findings: Finding[]): number | null {
  const mine = findings.filter((f) => f.itemId === item.id);
  if (mine.some((f) => f.kind === "code-on-load")) return 0;
  if (mine.some((f) => f.kind === "unreadable" && f.severity !== "info")) return null;
  const n = item.parts.length || Number(item.meta.partCount ?? 0);
  if (!n) return item.layer === "models" && item.model && !item.model.safeToLoad ? null : 999;
  const bad = new Set(mine.filter((f) => f.kind === "vulnerability" && f.part).map((f) => `${f.part!.name}@${f.part!.version}@${f.part!.via ?? ""}`)).size;
  // Known flaws lower fineness but never make it base: base is reserved for running code.
  return Math.max(1, Math.min(999, Math.floor(((n - bad) / n) * 1000)));
}

// An install's fineness: the share of its packages with nothing published against them.
export function envFineness(items: Item[], findings: Finding[], label: string) {
  const pkgs = items.filter((i) => i.layer === "packages" && String(i.meta.envLabel ?? (i.kind === "brew" ? "Homebrew" : "")) === label);
  if (!pkgs.length) return 999;
  const flagged = new Set(findings.filter((f) => f.kind === "vulnerability").map((f) => f.itemId));
  const bad = pkgs.filter((p) => flagged.has(p.id)).length;
  return Math.max(1, Math.floor(((pkgs.length - bad) / pkgs.length) * 1000));
}

export function macFineness(items: Item[], findings: Finding[]) {
  const total = items.reduce((a, i) => a + i.parts.length, 0);
  const bad = new Set(findings.filter((f) => f.kind === "vulnerability" && f.part).map((f) => `${f.itemId}|${f.part!.name}@${f.part!.version}@${f.part!.via ?? ""}`)).size;
  return { total, bad, fine: total ? Math.min(999, Math.floor(((total - bad) / total) * 1000)) : 999 };
}

export function metal(f: number | null): Metal {
  if (f === null) return "unread";
  if (f === 0) return "base";
  if (f >= 990) return "fine";
  if (f >= 950) return "gold";
  if (f >= 900) return "pale";
  if (f >= 750) return "rose";
  return "copper";
}

// The hallmarking standards, finest first, as reference needles on the stone.
export const STANDARDS: { fine: number; name: string; metal: Metal }[] = [
  { fine: 999, name: "Fine", metal: "fine" },
  { fine: 958, name: "Britannia", metal: "gold" },
  { fine: 925, name: "Sterling", metal: "pale" },
  { fine: 916, name: "22 carat", metal: "pale" },
  { fine: 750, name: "18 carat", metal: "rose" },
  { fine: 585, name: "14 carat", metal: "copper" },
  { fine: 0, name: "Base", metal: "base" },
];

export const standardOf = (f: number) => STANDARDS.find((s) => f >= s.fine) ?? STANDARDS[STANDARDS.length - 1];

// The maker of a model, from its name and architecture, for its logo. Unknown makers get none.
export function modelVendor(i: Item): string | null {
  if (i.layer !== "models") return null;
  const n = `${i.name} ${i.model?.architecture ?? ""}`.toLowerCase();
  if (n.includes("gpt-oss") || n.includes("openai")) return "openai";
  if (n.includes("qwen")) return "qwen-color";
  if (n.includes("llama")) return "meta-color";
  if (n.includes("gemma")) return "gemma-color";
  if (n.includes("mistral") || n.includes("mixtral")) return "mistral-color";
  if (n.includes("deepseek")) return "deepseek-color";
  if (n.includes("phi")) return "microsoft-color";
  if (n.includes("nemotron")) return "nvidia-color";
  if (i.kind === "hf-model" || n.includes("bert") || n.includes("bart")) return "huggingface-color";
  return null;
}
