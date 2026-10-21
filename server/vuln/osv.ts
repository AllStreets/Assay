import type { Ecosystem, Severity } from "../../shared/types.js";
import { cached, hash } from "../store.js";

// OSV.dev is the open vulnerability database that aggregates GitHub's advisories, PyPA and others.
// Assay sends only (ecosystem, package name, version) and keeps every answer on disk.

const API = "https://api.osv.dev/v1";
const CHECKABLE: Ecosystem[] = ["npm", "PyPI"];

export interface Query {
  ecosystem: Ecosystem;
  name: string;
  version: string;
}

export interface Advisory {
  id: string;
  aliases: string[];
  summary?: string;
  details?: string;
  severity: Severity;
  published?: string;
  fixed?: string;
  url: string;
  withdrawn?: boolean;
}

interface OsvVuln {
  id: string;
  aliases?: string[];
  summary?: string;
  details?: string;
  published?: string;
  withdrawn?: string;
  database_specific?: { severity?: string };
  severity?: { type: string; score: string }[];
  affected?: { package?: { name: string; ecosystem: string }; ranges?: { type: string; events: Record<string, string>[] }[] }[];
}

export const checkable = (e: Ecosystem) => CHECKABLE.includes(e);

const keyOf = (q: Query) => `${q.ecosystem}:${q.name.toLowerCase()}@${q.version}`;

async function post(path: string, body: unknown) {
  const r = await fetch(`${API}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`OSV.dev answered ${r.status}`);
  return r.json();
}

async function get(path: string) {
  const r = await fetch(`${API}${path}`, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`OSV.dev answered ${r.status}`);
  return r.json();
}

// Compares dotted versions numerically, which is enough to pick the nearest fix.
function cmp(a: string, b: string) {
  const pa = a.split(/[.+-]/).map((x) => parseInt(x, 10));
  const pb = b.split(/[.+-]/).map((x) => parseInt(x, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (Number.isNaN(x) || Number.isNaN(y)) return 0;
    if (x !== y) return x - y;
  }
  return 0;
}

// CVSS v3.x base score from its vector, per the FIRST specification.
export function cvss3(vector: string): number | undefined {
  const m = Object.fromEntries(vector.split("/").slice(1).map((p) => p.split(":")));
  const W = {
    AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 }, AC: { L: 0.77, H: 0.44 }, UI: { N: 0.85, R: 0.62 },
    CIA: { H: 0.56, L: 0.22, N: 0 },
  } as const;
  const changed = m.S === "C";
  const pr = { N: 0.85, L: changed ? 0.68 : 0.62, H: changed ? 0.5 : 0.27 }[m.PR as "N" | "L" | "H"];
  const av = W.AV[m.AV as keyof typeof W.AV], ac = W.AC[m.AC as keyof typeof W.AC], ui = W.UI[m.UI as keyof typeof W.UI];
  const [c, i, a] = [m.C, m.I, m.A].map((x) => W.CIA[x as keyof typeof W.CIA]);
  if ([pr, av, ac, ui, c, i, a].some((x) => x === undefined)) return undefined;
  const iss = 1 - (1 - c) * (1 - i) * (1 - a);
  const impact = changed ? 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15) : 6.42 * iss;
  if (impact <= 0) return 0;
  const exploit = 8.22 * av * ac * pr * ui;
  const roundUp = (x: number) => { const n = Math.round(x * 100000); return n % 10000 === 0 ? n / 100000 : (Math.floor(n / 10000) + 1) / 10; };
  return roundUp(Math.min(changed ? 1.08 * (impact + exploit) : impact + exploit, 10));
}

function severityOf(v: OsvVuln): Severity {
  const s = v.database_specific?.severity?.toUpperCase();
  if (s === "CRITICAL") return "critical";
  if (s === "HIGH") return "high";
  if (s === "MODERATE" || s === "MEDIUM") return "medium";
  if (s === "LOW") return "low";
  // Many PyPA advisories carry only a CVSS vector; score it rather than guess.
  const vec = v.severity?.find((x) => x.type === "CVSS_V3")?.score;
  const score = vec ? cvss3(vec) : undefined;
  if (score === undefined) return "medium";
  return score >= 9 ? "critical" : score >= 7 ? "high" : score >= 4 ? "medium" : score > 0 ? "low" : "info";
}

function advisory(v: OsvVuln, q: Query): Advisory {
  const fixes: string[] = [];
  for (const a of v.affected ?? []) {
    if (a.package && a.package.name.toLowerCase() !== q.name.toLowerCase()) continue;
    // GIT ranges name commits, not releases; only version ranges say what to install.
    for (const r of a.ranges ?? []) if (r.type !== "GIT") for (const e of r.events) if (e.fixed) fixes.push(e.fixed);
  }
  const fixed = fixes.filter((f) => cmp(f, q.version) > 0).sort(cmp)[0] ?? fixes.sort(cmp).at(-1);
  const ghsa = [v.id, ...(v.aliases ?? [])].find((a) => a.startsWith("GHSA-"));
  return {
    id: v.id,
    aliases: v.aliases ?? [],
    summary: v.summary ?? v.details?.split("\n")[0]?.slice(0, 200),
    details: v.details?.slice(0, 1200),
    severity: severityOf(v),
    published: v.published,
    fixed,
    url: ghsa ? `https://github.com/advisories/${ghsa}` : `https://osv.dev/vulnerability/${v.id}`,
    withdrawn: !!v.withdrawn,
  };
}

// Returns, for every query that has known vulnerabilities, the advisories that apply.
export async function check(queries: Query[]): Promise<Map<string, Advisory[]>> {
  const unique = [...new Map(queries.filter((q) => checkable(q.ecosystem) && q.version).map((q) => [keyOf(q), q])).values()];
  const ids = new Map<string, string[]>();
  const day = Math.floor(Date.now() / 86_400_000);
  for (let i = 0; i < unique.length; i += 500) {
    const batch = unique.slice(i, i + 500);
    const res = await cached("osv-batch", batch.map(keyOf).join("|"), day, async () => {
      const body = { queries: batch.map((q) => ({ package: { name: q.name, ecosystem: q.ecosystem }, version: q.version })) };
      return (await post("/querybatch", body)).results as { vulns?: { id: string; modified: string }[] }[];
    });
    res.forEach((r, j) => {
      if (r.vulns?.length) ids.set(keyOf(batch[j]), r.vulns.map((v) => `${v.id}|${v.modified}`));
    });
  }

  const details = new Map<string, OsvVuln>();
  const all = [...new Set([...ids.values()].flat())];
  let next = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (next < all.length) {
      const [id, modified] = all[next++].split("|");
      try {
        details.set(id, await cached("osv-vuln", id, modified, () => get(`/vulns/${encodeURIComponent(id)}`)));
      } catch {}
    }
  }));

  const out = new Map<string, Advisory[]>();
  for (const q of unique) {
    const list = (ids.get(keyOf(q)) ?? [])
      .map((x) => details.get(x.split("|")[0]))
      .filter((v): v is OsvVuln => !!v)
      .map((v) => advisory(v, q))
      .filter((a) => !a.withdrawn);
    if (list.length) out.set(keyOf(q), list);
  }
  return out;
}

export { keyOf, hash as _hash };
