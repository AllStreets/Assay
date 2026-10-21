import { FlaskConical, FolderOpen, Lock, PackageOpen, Search, ShieldCheck, Unlock } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Layer, QuarantineRecord, Settings } from "../../../shared/types";
import { api, type Result } from "../api";
import { KIND_NAME, LAYER_NAME, LAYER_SUB, attention, bytes, num, params, when } from "../format";
import { Button, Empty, KindGlyph, PageHead, Sev, Toggle } from "./ui";

const LAYERS: Layer[] = ["apps", "models", "extensions", "packages", "containers"];

function Icon({ item }: { item: Result["items"][number] }) {
  return item.kind === "app" && item.path ? <img src={api.icon(item.path)} width={28} height={28} alt="" loading="lazy" /> : <KindGlyph kind={item.kind} size={28} />;
}

// ---------- Inventory ----------

export function Inventory({ result }: { result: Result }) {
  const [layer, setLayer] = useState<Layer | "all">("all");
  const [q, setQ] = useState("");
  // What each item carries, in the same units as its certificate: advisories, or "runs code".
  const flagged = useMemo(() => {
    const m = new Map<string, { adv: Set<string>; code: boolean; unread: boolean }>();
    for (const f of result.findings) {
      if (f.severity === "info") continue;
      const e = m.get(f.itemId) ?? { adv: new Set<string>(), code: false, unread: false };
      if (f.advisory) e.adv.add(f.advisory.id);
      if (f.kind === "code-on-load") e.code = true;
      if (f.kind === "unreadable") e.unread = true;
      m.set(f.itemId, e);
    }
    return m;
  }, [result]);
  const weight = (id: string) => { const e = flagged.get(id); return e ? (e.code ? 1e6 : 0) + (e.unread ? 1e5 : 0) + e.adv.size : 0; };
  const rows = result.items
    .filter((i) => layer === "all" || i.layer === layer)
    .filter((i) => !q || `${i.name} ${i.version ?? ""} ${i.parts.map((p) => p.name).join(" ")}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => weight(b.id) - weight(a.id) || a.name.localeCompare(b.name));
  const matchPart = q.length > 2 ? result.items.filter((i) => i.parts.some((p) => p.name.toLowerCase() === q.toLowerCase())) : [];

  return (
    <article className="page">
      <PageHead
        title="Inventory"
        stamp={["ASSAY NO. " + String(result.id).padStart(4, "0"), `${num(result.items.length)} PIECES`, `${num(result.layers.reduce((a, l) => a + l.parts, 0))} LIBRARIES`]}
        lede="Every piece of software Assay found, and what it was built from. Search a library name to see everything that carries it."
      />
      <div className="filters">
        <div className="chips" role="tablist">
          <button role="tab" aria-selected={layer === "all"} className="chip" onClick={() => setLayer("all")}>All <span>{num(result.items.length)}</span></button>
          {LAYERS.map((l) => (
            <button key={l} role="tab" aria-selected={layer === l} className="chip" onClick={() => setLayer(l)}>{LAYER_NAME[l]} <span>{num(result.items.filter((i) => i.layer === l).length)}</span></button>
          ))}
        </div>
        <label className="search"><Search size={15} aria-hidden /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find software or a library, like libwebp or lodash" aria-label="Search" /></label>
      </div>
      {matchPart.length > 0 && <p className="carry"><b>{matchPart.length}</b> {matchPart.length === 1 ? "item carries" : "items carry"} <code>{q}</code>: {matchPart.slice(0, 6).map((i) => i.name).join(", ")}{matchPart.length > 6 ? ` and ${matchPart.length - 6} more` : ""}.</p>}
      {layer !== "all" && <p className="muted layer-sub">{LAYER_SUB[layer]}</p>}
      <ul className="inv">
        {rows.slice(0, 600).map((i) => (
          <li key={i.id}>
            <a href={`#/item/${encodeURIComponent(i.id)}`} className="inv-row">
              <Icon item={i} />
              <span className="inv-name"><b>{i.name}</b><span className="muted">{KIND_NAME[i.kind]}{i.version ? ` ${i.version}` : ""}</span></span>
              <span className="inv-parts muted">{i.parts.length > 1 ? `${num(i.parts.length)} parts` : i.model ? params(i.model.parameters) : i.sizeBytes ? bytes(i.sizeBytes) : ""}</span>
              <span className="inv-state">{(() => { const e = flagged.get(i.id); if (!e) return <span className="ok">Clear</span>; if (e.code) return <span className="flag">Runs code on load</span>; if (!e.adv.size && e.unread) return <span className="flag">Couldn’t be checked</span>; return <span className="flag">{e.adv.size} {e.adv.size === 1 ? "advisory" : "advisories"}</span>; })()}</span>
            </a>
          </li>
        ))}
      </ul>
      {!rows.length && <Empty icon={Search} title="Nothing matches">Try a different name or layer.</Empty>}
    </article>
  );
}

// ---------- Models ----------

export function Models({ result }: { result: Result }) {
  const models = result.items.filter((i) => i.layer === "models").sort((a, b) => Number(a.model?.safeToLoad) - Number(b.model?.safeToLoad) || (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0));
  const unsafe = models.filter((m) => !m.model?.safeToLoad);
  const total = models.reduce((a, m) => a + (m.sizeBytes ?? 0), 0);
  return (
    <article className="page">
      <PageHead
        title="AI models"
        stamp={[`${models.length} MODELS`, bytes(total), unsafe.length ? `${unsafe.length} UNSAFE TO LOAD` : "ALL SAFE TO LOAD"]}
        lede="Every model on this Mac, read from its own bytes and never loaded. GGUF and safetensors files can’t carry code; pickle files can, so Assay lists every import a pickle would perform."
      />
      {!models.length && <Empty icon={PackageOpen} title="No models found">Assay looks in Ollama, the Hugging Face cache, LM Studio and the folders listed in Settings.</Empty>}
      <ul className="model-grid">
        {models.map((m) => (
          <li key={m.id}>
            <a className={`specimen${m.model?.safeToLoad ? "" : " danger"}`} href={`#/item/${encodeURIComponent(m.id)}`}>
              <div className="sp-top">
                <span className={`fmt fmt-${m.model?.format}`}>{m.model?.format}</span>
                <span className={m.model?.safeToLoad ? "ok" : "flag"}>{m.model?.safeToLoad ? "Safe to load" : m.model?.files.some((f) => f.imports?.some((i) => i.verdict === "dangerous")) ? "Runs code on load" : "Couldn’t be checked"}</span>
              </div>
              <p className="sp-name">{m.name}</p>
              <p className="sp-src muted">{String(m.meta.source ?? "")}</p>
              {m.model?.parameters ? <div className="sp-big">{params(m.model.parameters)}<span>params</span></div> : <div className="sp-big">{bytes(m.sizeBytes)}<span>{m.model?.format === "pickle" || m.model?.format === "pytorch-zip" ? "pickled weights" : "on disk"}</span></div>}
              <dl className="sp-facts">
                <dt>Architecture</dt><dd>{m.model?.architecture ?? "unknown"}</dd>
                <dt>Precision</dt><dd>{m.model?.quantization ?? "unknown"}</dd>
                <dt>Context</dt><dd>{m.model?.contextLength ? `${num(m.model.contextLength)}` : "unknown"}</dd>
                <dt>License</dt><dd>{m.model?.license?.split(/[\n.]/)[0].slice(0, 28) ?? "not stated"}</dd>
                <dt>On disk</dt><dd>{bytes(m.sizeBytes)}</dd>
              </dl>
            </a>
          </li>
        ))}
      </ul>
    </article>
  );
}

// ---------- Findings ----------

export function Findings({ result }: { result: Result }) {
  const list = attention(result.items, result.findings).filter((a) => a.worst !== "info");
  const notes = attention(result.items, result.findings).filter((a) => a.worst === "info");
  const sev = (s: string) => list.filter((a) => a.worst === s).length;
  return (
    <article className="page">
      <PageHead
        title="Findings"
        stamp={[`${list.length} ITEMS NEED ATTENTION`, `${sev("critical")} CRITICAL`, `${sev("high")} HIGH`, result.vulnCheck.ran ? `CHECKED ${when(result.vulnCheck.at).toUpperCase()}` : "ONLINE CHECK OFF"]}
        lede="Grouped by what you can do about them, worst first. Every vulnerability comes from a published advisory on OSV.dev; every model finding from the file’s own bytes."
      />
      {!list.length && <Empty icon={ShieldCheck} title="Nothing needs attention">No piece of software matches a known vulnerability or an unsafe model.</Empty>}
      <ul className="att-list">
        {list.map((a) => (
          <li key={a.item.id}>
            <a href={`#/item/${encodeURIComponent(a.item.id)}`} className="att-card">
              <Icon item={a.item} />
              <div className="att-body">
                <p className="att-title"><b>{a.item.name}</b><span className="muted">{KIND_NAME[a.item.kind]}{a.item.version ? ` ${a.item.version}` : ""}</span></p>
                <p className="att-fix">{a.fix}</p>
                <p className="att-parts muted">{a.codeOnLoad ? a.findings.find((f) => f.kind === "code-on-load")?.evidence : [...new Set(a.vulns.map((f) => `${f.part?.name} ${f.part?.version}`))].slice(0, 4).join(", ") + (new Set(a.vulns.map((f) => f.part?.name)).size > 4 ? " and more" : "")}</p>
              </div>
              <div className="att-side">
                <Sev s={a.worst} />
                {a.advisories > 0 && <span className="muted">{a.advisories} {a.advisories === 1 ? "advisory" : "advisories"}</span>}
              </div>
            </a>
          </li>
        ))}
      </ul>
      {notes.length > 0 && (
        <>
          <p className="label section-label">NOTES</p>
          <ul className="att-list quiet">
            {notes.map((a) => (
              <li key={a.item.id}>
                <a href={`#/item/${encodeURIComponent(a.item.id)}`} className="att-card">
                  <Icon item={a.item} />
                  <div className="att-body"><p className="att-title"><b>{a.item.name}</b></p><p className="att-fix muted">{a.findings[0].title}. {a.findings[0].detail}</p></div>
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </article>
  );
}

// ---------- Quarantine ----------

export function Quarantine({ onChanged }: { onChanged: () => void }) {
  const [recs, setRecs] = useState<QuarantineRecord[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => api.quarantined().then(setRecs).catch(() => setRecs([]));
  useEffect(() => {
    load();
  }, []);
  return (
    <article className="page">
      <PageHead title="Quarantine" stamp={[`${recs?.length ?? 0} HELD`]} lede="Items you quarantined are held here, where nothing can open or load them. Release puts each one back exactly where it was." />
      {msg && <p className="note-strip ok" role="status">{msg}</p>}
      {recs && !recs.length && <Empty icon={Lock} title="Nothing is quarantined">Quarantine an item from its certificate page.</Empty>}
      <ul className="att-list">
        {recs?.map((r) => (
          <li key={r.id} className="att-card static">
            <KindGlyph kind={r.item?.kind ?? "model-file"} size={28} />
            <div className="att-body">
              <p className="att-title"><b>{r.name}</b><span className="muted">quarantined {when(r.at)}</span></p>
              <p className="att-parts muted"><code>{r.from.replace(/^\/Users\/[^/]+/, "~")}</code></p>
            </div>
            <Button icon={Unlock} onClick={async () => {
              try {
                const res = await api.release(r.id);
                setMsg(res.message);
                load();
                onChanged();
              } catch (e) {
                setMsg((e as Error).message);
              }
            }}>Release</Button>
          </li>
        ))}
      </ul>
    </article>
  );
}

// ---------- Settings ----------

export function SettingsPage({ result }: { result: Result | null }) {
  const [s, setS] = useState<Settings | null>(null);
  const [about, setAbout] = useState<{ version: string; dataDir: string } | null>(null);
  const [folder, setFolder] = useState("");
  const [spec, setSpec] = useState<string | null>(null);
  useEffect(() => {
    api.settings().then(setS);
    api.about().then(setAbout);
  }, []);
  const save = async (p: Partial<Settings>) => setS(await api.saveSettings(p));
  if (!s) return null;
  return (
    <article className="page settings">
      <PageHead title="Settings" stamp={[about && `VERSION ${about.version}`, "LOCAL ONLY"]} lede="What Assay checks, where it looks, and what leaves this Mac." />

      <section className="panel">
        <h2>Vulnerability check</h2>
        <div className="row">
          <div><p className="row-title">Check libraries against OSV.dev</p><p className="row-desc">Sends only package names and versions to OSV.dev, the open vulnerability database that gathers GitHub’s advisories and many others, and caches every answer. Turn it off and Assay still reads everything and checks models, offline.{result?.vulnCheck.ran ? ` Last check: ${num(result.vulnCheck.queried)} versions, ${when(result.vulnCheck.at)}.` : ""}</p></div>
          <Toggle label="Check online" checked={s.checkOnline} onChange={(v) => save({ checkOnline: v })} />
        </div>
      </section>

      <section className="panel">
        <h2>Model folders</h2>
        <p className="row-desc">Besides Ollama, the Hugging Face cache and LM Studio, Assay looks for model files in these folders, four levels deep.</p>
        <ul className="folders">
          {s.modelFolders.map((f) => (
            <li key={f}><code>{f.replace(/^\/Users\/[^/]+/, "~")}</code><Button variant="quiet" onClick={() => save({ modelFolders: s.modelFolders.filter((x) => x !== f) })}>Remove</Button></li>
          ))}
        </ul>
        <form className="add-folder" onSubmit={(e) => { e.preventDefault(); if (folder.startsWith("/")) { save({ modelFolders: [...s.modelFolders, folder] }); setFolder(""); } }}>
          <input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="/Users/you/models" aria-label="Folder to add" />
          <Button type="submit" disabled={!folder.startsWith("/")}>Add folder</Button>
        </form>
      </section>

      <section className="panel">
        <h2>Test specimen</h2>
        <div className="row">
          <div><p className="row-title">See Assay catch a malicious model</p><p className="row-desc">Writes <code>assay-test-specimen.pt</code> to your Downloads folder: a model file that imports <code>os.system</code>, the pattern real malicious models use. Its command only prints a line, so it’s harmless even if loaded, like the EICAR test file antivirus tools use. Run the assay again to see it flagged.</p>{spec && <p className="row-desc ok-text">Written to {spec.replace(/^\/Users\/[^/]+/, "~")}.</p>}</div>
          <Button icon={FlaskConical} onClick={async () => setSpec((await api.specimen()).path)}>Write test specimen</Button>
        </div>
      </section>

      <section className="panel">
        <h2>Privacy</h2>
        <p className="row-desc">Assay runs on this Mac. It has no account, no analytics and no server. It reads files and asks Homebrew, npm, pip and Docker what they installed. Models are read at their headers and never loaded. The only network request is the optional OSV.dev check above. Everything it keeps is in one folder.</p>
        <div className="row"><div><p className="row-title">Data folder</p><p className="row-desc"><code>{about?.dataDir.replace(/^\/Users\/[^/]+/, "~")}</code></p></div><Button icon={FolderOpen} onClick={() => api.openData()}>Show in Finder</Button></div>
        <div className="row"><div><p className="row-title">Hidden items</p>{s.hiddenItems.length ? <details className="hidden-list"><summary className="row-desc">{s.hiddenItems.length} {s.hiddenItems.length === 1 ? "item is" : "items are"} left out of every assay</summary><ul>{s.hiddenItems.map((h) => <li key={h}><code>{h.replace(/^\/Users\/[^/]+/, "~")}</code></li>)}</ul></details> : <p className="row-desc">Nothing is hidden.</p>}</div>{s.hiddenItems.length > 0 && <Button variant="quiet" onClick={() => save({ hiddenItems: [] })}>Show them again</Button>}</div>
      </section>
    </article>
  );
}
