import { ArrowLeft, ArrowUp, ExternalLink, FolderSearch, Lock, Play, RefreshCw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { Finding, Item, Part } from "../../../shared/types";
import { api, type Result } from "../api";
import { KIND_NAME, LAYER_NAME, SEVERITY_RANK, attention, bytes, fineness, num, params } from "../format";
import { ModelXray } from "./ModelXray";
import { Button, Dialog, Hallmarks, KindGlyph, Sev } from "./ui";

type Act = "quarantine" | "trash" | "update";

const CONFIRM: Record<Act, { title: (n: string) => string; body: string; button: string }> = {
  quarantine: { title: (n) => `Quarantine ${n}?`, body: "It moves into Assay’s quarantine folder, where nothing can open or load it. Release it from the Quarantine page to put it back exactly where it was.", button: "Quarantine" },
  trash: { title: (n) => `Move ${n} to the Trash?`, body: "Nothing is deleted until you empty the Trash.", button: "Move to Trash" },
  update: { title: (n) => `Update ${n}?`, body: "Assay runs the package manager that installed it. Run the assay again afterwards to confirm the fix.", button: "Update" },
};

// How a flaw reaches you: the flaw, where it sits, and the thing you actually use.
function Trace({ finding, item }: { finding: Finding; item: Item }) {
  const p = finding.part;
  if (finding.kind === "code-on-load") {
    const file = item.model?.files.find((f) => f.imports?.some((i) => i.verdict === "dangerous"));
    const bad = file?.imports?.filter((i) => i.verdict === "dangerous") ?? [];
    return (
      <ol className="trace">
        <li className="t-node bad">
          <span className="t-k">Calls</span>
          <b>{bad.map((i) => `${i.module}.${i.name}`).join(", ") || finding.evidence}</b>
          <span>{bad.length === 1 ? "A function that can run any program on this Mac" : "Functions that can run programs on this Mac"}</span>
        </li>
        <li className="t-joint" aria-hidden><ArrowUp size={13} /></li>
        <li className="t-node">
          <span className="t-k">Inside</span>
          <b>The pickle instructions in {file?.path.split("/").pop() ?? item.name}</b>
          <span>Python carries them out as it rebuilds the weights</span>
        </li>
        <li className="t-joint" aria-hidden><ArrowUp size={13} /></li>
        <li className="t-node">
          <span className="t-k">Runs when</span>
          <b>Anything loads it</b>
          <span>torch.load, a notebook, or a tool that opens the file for you</span>
        </li>
      </ol>
    );
  }
  return (
    <ol className="trace">
      <li className="t-node bad">
        <span className="t-k">Flaw</span>
        <b>{p ? `${p.name} ${p.version ?? ""}` : finding.title}</b>
        <span>{finding.advisory ? `${finding.advisory.id}${finding.advisory.fixed ? `, fixed in ${finding.advisory.fixed}` : ""}` : finding.evidence}</span>
      </li>
      {p?.via && (
        <>
          <li className="t-joint" aria-hidden><ArrowUp size={13} /></li>
          <li className="t-node">
            <span className="t-k">Inside</span>
            <b>{p.via.split("/").slice(-3).join("/")}</b>
            <span>{p.name === "electron" ? "The Electron runtime the app ships with" : "Where Assay found it in the app"}</span>
          </li>
        </>
      )}
      <li className="t-joint" aria-hidden><ArrowUp size={13} /></li>
      <li className="t-node">
        <span className="t-k">Used by</span>
        <b>{item.name}{item.version ? ` ${item.version}` : ""}</b>
        <span>{KIND_NAME[item.kind]}</span>
      </li>
    </ol>
  );
}

const cmpVer = (a: string, b: string) => {
  const pa = a.split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
};

interface LibGroup { key: string; part: Part; findings: Finding[]; worst: Finding["severity"]; fixed?: string }

// Vulnerabilities folded into one row per affected library, worst first.
function byLibrary(findings: Finding[]): LibGroup[] {
  const m = new Map<string, LibGroup>();
  for (const f of findings) {
    if (f.kind !== "vulnerability" || !f.part) continue;
    const key = `${f.part.name}@${f.part.version}@${f.part.via ?? ""}`;
    const g = m.get(key) ?? { key, part: f.part, findings: [], worst: "info" as Finding["severity"] };
    if (!g.findings.some((x) => x.advisory?.id === f.advisory?.id)) g.findings.push(f);
    if (SEVERITY_RANK[f.severity] < SEVERITY_RANK[g.worst]) g.worst = f.severity;
    const fx = f.advisory?.fixed;
    if (fx && (!g.fixed || cmpVer(fx, g.fixed) > 0)) g.fixed = fx;
    m.set(key, g);
  }
  return [...m.values()].sort((a, b) => SEVERITY_RANK[a.worst] - SEVERITY_RANK[b.worst] || b.findings.length - a.findings.length || a.part.name.localeCompare(b.part.name));
}

export function ItemView({ result, id, onChanged }: { result: Result; id: string; onChanged: () => void }) {
  const item = result.items.find((i) => i.id === id);
  const findings = useMemo(() => result.findings.filter((f) => f.itemId === id).sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]), [result, id]);
  const att = useMemo(() => (item ? attention([item], findings)[0] : undefined), [item, findings]);
  const [confirm, setConfirm] = useState<Act | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [showAll, setShowAll] = useState(false);

  if (!item) return <div className="empty-page"><p>That item isn’t in the latest assay.</p><a className="btn btn-ghost" href="#/inventory">Inventory</a></div>;
  const actions = result.actions[item.id] ?? [];

  const act = async (a: Act) => {
    setBusy(true);
    setNote(null);
    try {
      const r = a === "quarantine" ? await api.quarantine(item.id) : a === "trash" ? await api.trash(item.id) : await api.update(item.id);
      setNote({ ok: true, text: r.message });
      onChanged();
    } catch (e) {
      setNote({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  // Parts grouped by ecosystem; affected ones first.
  const affected = new Set(findings.map((f) => f.part && `${f.part.name}@${f.part.version}`).filter(Boolean));
  const groups = new Map<string, Part[]>();
  for (const p of item.parts) groups.set(p.ecosystem, [...(groups.get(p.ecosystem) ?? []), p]);
  const advisories = [...new Map(findings.filter((f) => f.advisory).map((f) => [f.advisory!.id, f])).values()];
  const libs = byLibrary(findings);
  const others = findings.filter((f) => f.kind !== "vulnerability");
  const shownLibs = showAll ? libs : libs.slice(0, 12);
  const lead = findings[0];

  return (
    <article className="page item">
      <a className="back" href={item.layer === "models" ? "#/models" : "#/inventory"}><ArrowLeft size={15} aria-hidden /> {item.layer === "models" ? "AI models" : "Inventory"}</a>
      <Hallmarks kind={item.kind} fine={fineness(item, result.findings)} assay={result.id} />
      <header className="item-head">
        {item.kind === "app" && item.path ? <img src={api.icon(item.path)} width={64} height={64} alt="" /> : <KindGlyph kind={item.kind} size={64} />}
        <div>
          <h1>{item.name}</h1>
          {item.meta.envLabel ? <p className="env">Installed in {String(item.meta.envLabel)}</p> : null}
          {item.path && <code className="path">{item.path.replace(/^\/Users\/[^/]+/, "~")}</code>}
        </div>
        <div className="item-actions">
          {actions.includes("update") && <Button variant="gold" icon={RefreshCw} onClick={() => setConfirm("update")}>Update</Button>}
          {actions.includes("open") && att?.vulns.length ? <Button icon={Play} onClick={() => api.open(item.id)}>Open to update</Button> : null}
          {actions.includes("quarantine") && <Button variant={att?.codeOnLoad ? "gold" : "ghost"} icon={Lock} onClick={() => setConfirm("quarantine")}>Quarantine</Button>}
          {actions.includes("trash") && <Button variant="quiet" icon={Trash2} onClick={() => setConfirm("trash")}>Trash</Button>}
          <Button variant="quiet" icon={FolderSearch} onClick={() => api.reveal(item.id)}>Show</Button>
        </div>
      </header>

      {note && <p className={`note-strip ${note.ok ? "ok" : "bad"}`} role="status">{note.text}</p>}

      <div className="cert">
        <section className="cert-col">
          <div className="cert-block">
            <p className="cert-verdict">
              {att ? att.fix : item.model ? (item.model.safeToLoad ? "Safe to load. No file in it can run code when it’s opened." : "Don’t load it until you know where it came from.") : "Nothing known against it."}
            </p>
          </div>
          <div className="cert-block">
            <h2 className="h3">Identified by</h2>
            <p>{item.evidence}</p>
          </div>
          {item.model && (
            <div className="cert-block">
              <h2 className="h3">The model</h2>
              <dl className="facts">
                {item.model.architecture && <><dt>Architecture</dt><dd>{item.model.architecture}</dd></>}
                {item.model.parameters ? <><dt>Parameters</dt><dd>{params(item.model.parameters)}</dd></> : null}
                {item.model.quantization && <><dt>Precision</dt><dd>{item.model.quantization}</dd></>}
                {item.model.contextLength ? <><dt>Context</dt><dd>{num(item.model.contextLength)} tokens</dd></> : null}
                {item.model.layers ? <><dt>Layers</dt><dd>{item.model.layers}</dd></> : null}
                {item.model.license && <><dt>License</dt><dd>{item.model.license}</dd></>}
                <dt>Format</dt><dd>{item.model.format}</dd>
              </dl>
            </div>
          )}
          {item.parts.length > 0 && (
            <div className="cert-block">
              <h2 className="h3">{num(item.parts.length)} {item.parts.length === 1 ? "part" : "parts"} inside</h2>
              {[...groups.entries()].map(([eco, ps]) => (
                <details key={eco} className="parts" open={ps.length < 12}>
                  <summary>{eco === "framework" ? "Frameworks" : eco === "PyPI" ? "Python packages" : eco === "npm" ? "npm packages" : eco} <span className="muted">{num(ps.length)}</span></summary>
                  <ul>
                    {[...ps].sort((a, b) => Number(affected.has(`${b.name}@${b.version}`)) - Number(affected.has(`${a.name}@${a.version}`)) || a.name.localeCompare(b.name)).slice(0, 400).map((p, i) => (
                      <li key={i} className={affected.has(`${p.name}@${p.version}`) ? "hit" : undefined}><code>{p.name}</code><span className="muted">{p.version}</span></li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          )}
        </section>

        <section className="cert-col wide">
          {item.model && <ModelXray item={item} />}
          {lead && lead.severity !== "info" && (
            <div className="reach">
              <h2 className="h2">How it reaches you</h2>
              <Trace finding={lead} item={item} />
            </div>
          )}
          {others.length > 0 && (
            <>
              <h2 className="h2">{item.model ? "What the file does" : "Notes"}</h2>
              <ul className="finds">
                {others.map((f) => (
                  <li key={f.id} className={`find sev-row-${f.severity}`}>
                    <div className="find-head"><Sev s={f.severity} /><b>{f.title}</b></div>
                    <p className="find-detail">{f.detail}</p>
                  </li>
                ))}
              </ul>
            </>
          )}
          {libs.length > 0 && (
            <>
              <h2 className="h2">{libs.length} affected {libs.length === 1 ? "library" : "libraries"}, {advisories.length} {advisories.length === 1 ? "advisory" : "advisories"}</h2>
              <ul className="libs">
                {shownLibs.map((g) => (
                  <li key={g.key}>
                    <details className={`lib sev-row-${g.worst}`}>
                      <summary>
                        <Sev s={g.worst} />
                        <span className="lib-name"><code>{g.part.name}</code><span className="muted">{g.part.version}</span></span>
                        <span className="lib-meta">
                          <span className="lib-n">{g.findings.length} {g.findings.length === 1 ? "advisory" : "advisories"}</span>
                          <span className="lib-fix">{g.fixed ? `Fixed in ${g.fixed}` : "No fix listed"}</span>
                        </span>
                      </summary>
                      <div className="lib-body">
                        {g.part.via && <p className="lib-via muted">Inside <code>{g.part.via.replace(/^\/Users\/[^/]+/, "~")}</code></p>}
                        <ul className="advs">
                          {[...g.findings].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]).map((f) => (
                            <li key={f.id}>
                              <Sev s={f.severity} />
                              <span className="adv-title">{f.advisory?.summary ?? f.title}</span>
                              {f.advisory && <a href={f.advisory.url} target="_blank" rel="noreferrer" className="adv">{f.advisory.id} <ExternalLink size={12} aria-hidden /></a>}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
              {libs.length > 12 && !showAll && <button className="link-more" onClick={() => setShowAll(true)}>Show all {libs.length} affected libraries</button>}
            </>
          )}
          {!findings.length && (
            <>
              <h2 className="h2">Findings</h2>
              <p className="muted">Nothing found.{item.parts.length ? " None of its parts matches a published advisory." : ""}</p>
            </>
          )}
          {findings.some((f) => f.kind === "vulnerability") && (
            <p className="fine">A library being present means the app ships it, not that the app uses the affected feature. The advisory says which feature is affected.</p>
          )}
        </section>
      </div>

      <Dialog
        open={confirm !== null}
        title={confirm ? CONFIRM[confirm].title(item.name) : ""}
        onClose={() => setConfirm(null)}
        actions={<><Button variant="quiet" onClick={() => setConfirm(null)}>Cancel</Button>{confirm && <Button variant={confirm === "trash" ? "danger" : "gold"} busy={busy} onClick={() => act(confirm)}>{CONFIRM[confirm].button}</Button>}</>}
      >
        <p>{confirm && CONFIRM[confirm].body}</p>
      </Dialog>
    </article>
  );
}
