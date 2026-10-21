import { ArrowRight, FlaskConical } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import type { Finding, Item, Layer, Progress, Severity } from "../../../shared/types";
import type { Result } from "../api";
import { LAYER_NAME, SEVERITY_RANK, attention, entries, envFineness, fineness, macFineness, num, params } from "../format";
import { Clean, ItemLogo, LibStrip, Ticks } from "./Metal";
import { Button, Sev } from "./ui";

const ORDER: Layer[] = ["apps", "models", "extensions", "packages", "containers"];
const ZERO: Record<Layer, { items: number; parts: number }> = {
  apps: { items: 0, parts: 0 }, models: { items: 0, parts: 0 }, extensions: { items: 0, parts: 0 }, packages: { items: 0, parts: 0 }, containers: { items: 0, parts: 0 },
};

export function Home({ result, progress, live, onRun, open }: { result: Result | null; progress: Progress | null; live: Item[]; onRun: () => void; open: (to: string) => void }) {
  const running = !!progress?.running;
  const items = running || !result ? live : result.items;
  const findings: Finding[] = running || !result ? [] : result.findings;

  const view = useMemo(() => {
    const adv = new Map<string, number>();
    const code = new Set<string>();
    const flagged = new Set<string>();
    for (const f of findings) {
      if (f.severity === "info") continue;
      flagged.add(f.itemId);
      if (f.kind === "code-on-load") code.add(f.itemId);
    }
    const seen = new Map<string, Set<string>>();
    for (const f of findings) if (f.advisory) seen.set(f.itemId, (seen.get(f.itemId) ?? new Set()).add(f.advisory.id));
    for (const [k, v] of seen) adv.set(k, v.size);
    return { adv, code, flagged, mac: macFineness(items, findings) };
  }, [items, findings]);

  if (!result && !running) {
    return (
      <div className="bench bench-first">
        <section className="col col-wide first-pane">
          <p className="lbl"><span>Ready</span><span>nothing read yet</span></p>
          <h1 className="first-title">Assay reads every piece of software on this Mac, down to the libraries inside it, and checks each one against what’s known to be broken.</h1>
          <p className="first-body">Apps, AI models, extensions, packages and containers. Models are read from their bytes and never loaded. Nothing changes until you press a key.</p>
          <Button variant="go" icon={FlaskConical} onClick={onRun}>Run the first assay</Button>
          <p className="fine">To check for known vulnerabilities, Assay sends package names and versions to OSV.dev, an open database of published advisories. Nothing else leaves this Mac, and Settings can turn it off.</p>
        </section>
      </div>
    );
  }

  const counts = running ? progress?.found ?? ZERO : (Object.fromEntries(result!.layers.map((l) => [l.layer, { items: l.items, parts: l.parts }])) as Record<Layer, { items: number; parts: number }>);
  const list = result && !running ? attention(result.items, result.findings).filter((a) => a.worst !== "info") : [];
  const todo = entries(list).slice(0, 4);
  const apps = items.filter((i) => i.layer === "apps").sort((a, b) => (view.adv.get(b.id) ?? 0) - (view.adv.get(a.id) ?? 0) || a.name.localeCompare(b.name));
  const models = items.filter((i) => i.layer === "models").sort((a, b) => Number(view.code.has(b.id)) - Number(view.code.has(a.id)) || (b.model?.parameters ?? 0) - (a.model?.parameters ?? 0));
  const maxP = Math.max(1, ...models.map((m) => m.model?.parameters ?? 0));
  const flaggedApps = apps.filter((a) => view.adv.has(a.id) || view.code.has(a.id));
  const libs = libraryRows(items, findings);
  const envs = installRows(items, findings);
  const flaggedIn = (l: Layer) => items.filter((i) => i.layer === l && view.flagged.has(i.id)).length;

  return (
    <div className="bench">
      <section className="col col-left">
        <p className="lbl"><span>Clean share</span><span>{running ? "reading" : "per 1,000 libraries"}</span></p>
        <div className="readout-big">{running ? "···" : view.mac.fine}<sup>‰</sup></div>
        <p className="readout-note">
          {running ? progress?.stage ?? "Starting" : <>{num(view.mac.total - view.mac.bad)} of {num(view.mac.total)} libraries have nothing published against them{view.code.size ? <>, and <b>{view.code.size === 1 ? "one model runs code" : `${view.code.size} models run code`}</b> when loaded.</> : "."}</>}
        </p>
        <p className="lbl"><span>Layers</span><span>items / flagged</span></p>
        {ORDER.map((l) => {
          const now = running && progress?.layer === l;
          return (
            <div className={`meter${now ? " now" : ""}`} key={l}>
              <p className="meter-row"><span>{LAYER_NAME[l]}</span><span>{num(counts[l].items)}{running ? "" : ` / ${flaggedIn(l)} flagged`}</span></p>
              <Ticks total={counts[l].items} flagged={running ? 0 : flaggedIn(l)} />
            </div>
          );
        })}
        {!running && result?.access?.read === false && (
          <p className="fine warn">Give Assay Full Disk Access in System Settings to rank flaws by what each app can reach.</p>
        )}
        {!running && result && !result.vulnCheck.ran && (
          <p className="fine warn">{result.vulnCheck.error ? `OSV.dev couldn’t be reached: ${result.vulnCheck.error}.` : "The online check is off, so only models are judged."}</p>
        )}
        {todo.length > 0 && (
          <>
            <p className="lbl lbl-gap"><span>Start here</span><span>{num(list.length)} in all</span></p>
            <ol className="todo">
              {todo.map((e) => {
                const to = e.type === "env" ? "#/findings" : `#/item/${encodeURIComponent(e.a.item.id)}`;
                const f = e.type === "env" ? envFineness(result!.items, result!.findings, e.key) : fineness(e.a.item, result!.findings);
                return (
                  <li key={e.type === "env" ? e.key : e.a.item.id}>
                    <button onClick={() => open(to)}>
                      <span className="todo-text"><b>{e.type === "env" ? e.label : e.a.item.name}</b><span>{e.type === "env" ? e.fix : e.a.fix}</span></span>
                      <Clean f={f} />
                    </button>
                  </li>
                );
              })}
            </ol>
            <button className="link-more" onClick={() => open("#/findings")}>All findings <ArrowRight size={13} aria-hidden /></button>
          </>
        )}
      </section>

      <section className="col col-mid">
        <p className="lbl"><span>AI models <b>{num(counts.models.items)}</b></span><span>{running ? "as read" : view.code.size ? `${view.code.size} runs code` : "all safe to load"}</span></p>
        <div className="model-rows">
          {models.map((m) => {
            const x = view.code.has(m.id);
            return (
              <button key={m.id} className={`model-row${x ? " x" : ""}`} onClick={() => !running && open(`#/item/${encodeURIComponent(m.id)}`)}>
                <ItemLogo item={m} size={22} />
                <b>{m.name}</b>
                <span className="mr-meta">{x ? "Runs code when loaded" : [params(m.model?.parameters), m.model?.quantization, m.model?.format].filter(Boolean).join("  ")}</span>
                <span className="mr-bar"><i style={{ width: `${x ? 100 : Math.max(2, ((m.model?.parameters ?? 0) / maxP) * 100)}%` }} /></span>
              </button>
            );
          })}
        </div>

        <p className="lbl lbl-gap"><span>Flawed libraries <b>{running ? "" : num(libs.length)}</b></span><span>{running ? "checked when reading ends" : "inside your software"}</span></p>
        {!running && (
          <div className="lib-rows">
            {libs.slice(0, 9).map((l) => (
              <button key={l.key} className="lib-row" onClick={() => open(l.carriers.length === 1 ? `#/item/${encodeURIComponent(l.carriers[0].id)}` : "#/findings")}>
                <Sev s={l.worst} />
                <span className="lr-name"><code>{l.name}</code><span>{l.version}</span></span>
                <span className="lr-carriers" title={l.carriers.map((c) => c.name).join(", ")}>
                  {l.carriers.slice(0, 5).map((c) => <ItemLogo key={c.id} item={c} size={18} />)}
                  <span>{l.carriers.length === 1 ? `in ${l.carriers[0].layer === "packages" ? String(l.carriers[0].meta.envLabel ?? "Homebrew") : l.carriers[0].name}` : `in ${l.carriers.length}`}</span>
                </span>
                <span className="lr-adv">{l.advisories} adv</span>
                <span className="lr-fix">{l.fixed ? `fix ${l.fixed}` : "no fix"}</span>
              </button>
            ))}
            {libs.length > 9 && <button className="link-more" onClick={() => open("#/findings")}>{num(libs.length - 9)} more <ArrowRight size={13} aria-hidden /></button>}
          </div>
        )}

        <p className="lbl lbl-gap"><span>Installs <b>{num(envs.length)}</b></span><span>packages / flagged</span></p>
        <div className="env-rows">
          {envs.map((e) => (
            <button key={e.label} className="env-row" onClick={() => !running && open("#/inventory")}>
              <b>{e.label}</b>
              <span className="er-n">{num(e.total)} / <em className={e.flagged ? "hot" : undefined}>{e.flagged}</em></span>
              <LibStrip total={e.total} bad={e.flagged} max={140} />
              {!running && <Clean f={e.fine} />}
            </button>
          ))}
        </div>

        <p className="lbl lbl-gap"><span>Apps <b>{num(counts.apps.items)}</b></span><span>{running ? "as read" : `${flaggedApps.length} carry advisories`}</span></p>
        <div className="app-strip">
          {(running ? apps : flaggedApps).slice(0, 40).map((a) => {
            const n = view.adv.get(a.id);
            return (
              <button key={a.id} className={`icon-cell${n ? " x" : ""}`} onClick={() => !running && open(`#/item/${encodeURIComponent(a.id)}`)} title={`${a.name}${n ? `: ${n} advisories` : ""}`}>
                <ItemLogo item={a} size={26} />
                {n ? <span className="cnt">{n}</span> : null}
              </button>
            );
          })}
          {!running && apps.length > flaggedApps.length && <a className="app-more" href="#/inventory">+{num(apps.length - flaggedApps.length)} clean</a>}
        </div>
      </section>

      <section className="col col-right">
        <ReadLog items={items} adv={view.adv} code={view.code} running={running} assay={result?.id} />
      </section>
    </div>
  );
}

// Everything in the order it was read, with the real time it took to get there.
function ReadLog({ items, adv, code, running, assay }: { items: Item[]; adv: Map<string, number>; code: Set<string>; running: boolean; assay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => [...items].sort((a, b) => Number(a.meta.readAt ?? 0) - Number(b.meta.readAt ?? 0)), [items]);
  useEffect(() => {
    if (running && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [rows.length, running]);
  return (
    <>
      <p className="lbl"><span>Read log</span><span>{running ? "live" : assay ? `assay ${assay}` : ""}</span></p>
      <div className="log" ref={ref}>
        {rows.map((i) => {
          const parts = i.parts.length || Number(i.meta.partCount ?? 0);
          const x = code.has(i.id) || adv.has(i.id);
          const t = i.meta.readAt === undefined ? "" : `+${(Number(i.meta.readAt) / 1000).toFixed(2)}s`;
          return (
            <div key={i.id} className={x ? "x" : undefined}>
              <span className="log-t">{t}</span>
              <span className="log-n">{i.name}</span>
              <span className="log-v">{code.has(i.id) ? "code" : adv.has(i.id) ? `${adv.get(i.id)} adv` : parts > 1 ? `${num(parts)} libs` : "ok"}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}

interface LibRow { key: string; name: string; version: string; carriers: Item[]; advisories: number; worst: Severity; fixed?: string }

const cmpVer = (a: string, b: string) => {
  const pa = a.split(/[.+-]/).map((x) => parseInt(x, 10) || 0), pb = b.split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
};

// The machine's flawed libraries, each once: which version, inside how many things.
function libraryRows(items: Item[], findings: Finding[]): LibRow[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const rows = new Map<string, LibRow & { adv: Set<string>; ids: Set<string> }>();
  for (const f of findings) {
    if (f.kind !== "vulnerability" || !f.part) continue;
    const key = `${f.part.name}@${f.part.version}`;
    const r = rows.get(key) ?? { key, name: f.part.name, version: f.part.version ?? "", carriers: [], advisories: 0, worst: "info" as Severity, adv: new Set<string>(), ids: new Set<string>() };
    if (f.advisory) r.adv.add(f.advisory.id);
    const item = byId.get(f.itemId);
    if (item && !r.ids.has(item.id)) { r.ids.add(item.id); r.carriers.push(item); }
    if (SEVERITY_RANK[f.severity] < SEVERITY_RANK[r.worst]) r.worst = f.severity;
    const fx = f.advisory?.fixed;
    if (fx && (!r.fixed || cmpVer(fx, r.fixed) > 0)) r.fixed = fx;
    rows.set(key, r);
  }
  return [...rows.values()]
    .map((r) => ({ ...r, advisories: r.adv.size }))
    .sort((a, b) => SEVERITY_RANK[a.worst] - SEVERITY_RANK[b.worst] || b.carriers.length * b.advisories - a.carriers.length * a.advisories);
}

interface EnvRow { label: string; total: number; flagged: number; fine: number }

// Every place packages are installed: Homebrew, each Node, each Python.
function installRows(items: Item[], findings: Finding[]): EnvRow[] {
  const flagged = new Set(findings.filter((f) => f.kind === "vulnerability").map((f) => f.itemId));
  const m = new Map<string, EnvRow>();
  for (const i of items) {
    if (i.layer !== "packages") continue;
    const label = String(i.meta.envLabel ?? (i.kind === "brew" ? "Homebrew" : "Other"));
    const r = m.get(label) ?? { label, total: 0, flagged: 0, fine: 999 };
    r.total++;
    if (flagged.has(i.id)) r.flagged++;
    m.set(label, r);
  }
  return [...m.values()].map((r) => ({ ...r, fine: Math.min(999, Math.max(1, Math.floor(((r.total - r.flagged) / r.total) * 1000))) })).sort((a, b) => b.flagged - a.flagged || b.total - a.total);
}
