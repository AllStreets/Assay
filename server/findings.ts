import path from "node:path";
import type { Finding, Item, PickleImport } from "../shared/types.js";
import { hash } from "./store.js";
import type { Advisory } from "./vuln/osv.js";
import { keyOf } from "./vuln/osv.js";

const describe = (i: PickleImport) => `${i.module}.${i.name}`;

const DANGER_WHY: [RegExp, string][] = [
  [/^(os|posix|nt|subprocess|pty|commands)\b/, "run any command on your Mac"],
  [/^(builtins|__builtin__)\.(eval|exec|compile|__import__)/, "run arbitrary Python"],
  [/^(socket|requests|urllib|http|aiohttp|ftplib|smtplib|telnetlib|webbrowser)/, "reach the network"],
  [/^(builtins|__builtin__)\.open|^shutil/, "read, write or delete files"],
  [/^runpy|^importlib|^code\b|^types\b/, "load and run other code"],
];

function why(i: PickleImport) {
  return DANGER_WHY.find(([re]) => re.test(describe(i)))?.[1] ?? "do more than rebuild tensors";
}

export function modelFindings(item: Item): Finding[] {
  const out: Finding[] = [];
  for (const f of item.model?.files ?? []) {
    const file = path.basename(f.path);
    const dangerous = (f.imports ?? []).filter((i) => i.verdict === "dangerous");
    const unknown = (f.imports ?? []).filter((i) => i.verdict === "unknown");
    if (dangerous.length) {
      out.push({
        id: `f:${hash(`${item.id}:${f.path}:danger`)}`,
        itemId: item.id,
        kind: "code-on-load",
        severity: "critical",
        title: "Runs code the moment it’s loaded",
        detail: `${file} would import ${dangerous.map(describe).join(", ")} when a program loads it, which lets it ${why(dangerous[0])}. Nothing was executed to find this.`,
        evidence: `Pickle instructions import ${dangerous.map(describe).join(", ")}`,
      });
    } else if (unknown.length) {
      out.push({
        id: `f:${hash(`${item.id}:${f.path}:unknown`)}`,
        itemId: item.id,
        kind: "unsafe-format",
        severity: "low",
        title: "Runs library code when loaded",
        detail: `${file} imports ${unknown.slice(0, 3).map(describe).join(", ")}${unknown.length > 3 ? ` and ${unknown.length - 3} more` : ""} on load. That’s normal for some checkpoints, but it means the file isn’t safe by format.`,
        evidence: `Pickle instructions import ${unknown.map(describe).join(", ")}`,
      });
    } else if (f.format === "pickle" || f.format === "pytorch-zip") {
      out.push({
        id: `f:${hash(`${item.id}:${f.path}:pickle`)}`,
        itemId: item.id,
        kind: "unsafe-format",
        severity: "info",
        title: "Stored as a pickle",
        detail: `${file} only rebuilds tensors today, but the pickle format can carry code. Safetensors or GGUF can’t.`,
        evidence: `${f.format === "pytorch-zip" ? "PyTorch zip" : "Pickle"} with only standard tensor imports`,
      });
    }
    if (f.error) {
      const pickle = f.format === "pickle" || f.format === "pytorch-zip";
      out.push({
        id: `f:${hash(`${item.id}:${f.path}:error`)}`,
        itemId: item.id,
        kind: "unreadable",
        // A pickle that can't be followed to the end could be hiding anything, so it ranks high.
        severity: pickle ? "high" : "info",
        title: pickle ? "Couldn’t be checked" : "Couldn’t read one file",
        detail: pickle
          ? `Assay couldn’t follow ${file}’s pickle instructions to the end (${f.error}), so it can’t say what loading it would do. Treat it as unsafe until you know where it came from.`
          : `${file}: ${f.error}`,
        evidence: f.path,
      });
    }
  }
  return out;
}

export function vulnFindings(item: Item, advisories: Map<string, Advisory[]>): Finding[] {
  const out: Finding[] = [];
  const seen = new Set<string>();
  for (const part of item.parts) {
    if (!part.version) continue;
    const list = advisories.get(keyOf({ ecosystem: part.ecosystem, name: part.name, version: part.version })) ?? [];
    for (const a of list) {
      const key = `${a.id}:${part.name}@${part.version}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: `f:${hash(`${item.id}:${key}`)}`,
        itemId: item.id,
        kind: "vulnerability",
        severity: a.severity,
        title: a.summary ?? `Known vulnerability in ${part.name}`,
        detail: `${part.name} ${part.version}${a.fixed ? ` is fixed in ${a.fixed}` : " has no fixed version yet"}.`,
        part,
        evidence: `${a.id}${a.aliases.length ? ` (${a.aliases.slice(0, 2).join(", ")})` : ""} lists ${part.name} ${part.version} as affected`,
        advisory: { id: a.id, aliases: a.aliases, summary: a.summary, fixed: a.fixed, url: a.url, published: a.published },
      });
    }
  }
  return out;
}

const RANK = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
export const bySeverity = (a: Finding, b: Finding) => RANK[a.severity] - RANK[b.severity];
