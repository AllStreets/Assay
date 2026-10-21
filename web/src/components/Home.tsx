import { ArrowRight, FlaskConical, ShieldCheck } from "lucide-react";
import type { Layer, Progress } from "../../../shared/types";
import type { Result } from "../api";
import { LAYER_NAME, attention, entries, num } from "../format";

const ORDER: Layer[] = ["apps", "models", "extensions", "packages", "containers"];
import { CoreSample, type Mark } from "./CoreSample";
import { Button, KindGlyph, Sev } from "./ui";
import { api } from "../api";

const ZERO: Record<Layer, { items: number; parts: number }> = {
  apps: { items: 0, parts: 0 }, models: { items: 0, parts: 0 }, extensions: { items: 0, parts: 0 }, packages: { items: 0, parts: 0 }, containers: { items: 0, parts: 0 },
};

export function Home({ result, progress, onRun, open }: { result: Result | null; progress: Progress | null; onRun: () => void; open: (to: string) => void }) {
  const running = !!progress?.running;

  if (!result && !running) {
    return (
      <article className="home first">
        <CoreSample counts={ZERO} marks={[]} idle />
        <section className="home-right">
          <p className="phase">READY</p>
          <h1 className="verdict">Assay reads every piece of software on this Mac, down to the libraries inside it, and checks each one against what’s known to be broken.</h1>
          <p className="lede">Apps, AI models, extensions, packages and containers. Models are read from their bytes and never loaded. Nothing is changed until you press a button.</p>
          <Button variant="gold" icon={FlaskConical} onClick={onRun}>Run the first assay</Button>
          <p className="fine">The vulnerability check sends package names and versions to OSV.dev, the open vulnerability database that gathers GitHub’s advisories and many others. Nothing else leaves this Mac. You can turn it off in Settings.</p>
        </section>
      </article>
    );
  }

  if (running || !result) {
    const counts = progress?.found ?? ZERO;
    const total = Object.values(counts).reduce((a, c) => a + c.items, 0);
    const parts = Object.values(counts).reduce((a, c) => a + c.parts, 0);
    const checking = !!progress?.stage?.startsWith("Checking");
    return (
      <article className="home">
        <CoreSample counts={counts} marks={[]} drilling={progress?.layer ?? "apps"} />
        <section className="home-right">
          <p className="phase"><span>ASSAYING</span><b>{num(total)} PIECES</b><b>{num(parts)} LIBRARIES</b></p>
          <h1 className="verdict running">{progress?.stage ?? "Starting"}<span className="cursor" /></h1>
          <p className="lede">Each layer fills in as it’s read. Models are opened at their headers only, so a malicious one can’t run while it’s checked.</p>
          <ol className="steps">
            {ORDER.map((l, i) => {
              const now = checking ? ORDER.length : ORDER.indexOf(progress?.layer ?? "apps");
              const state = i < now ? "done" : i === now ? "now" : "wait";
              return (
                <li key={l} className={`step ${state}`}>
                  <span className="step-dot" aria-hidden />
                  <span className="step-name">{LAYER_NAME[l]}</span>
                  <span className="step-n">{state === "wait" ? "" : `${num(counts[l].items)}${counts[l].parts ? `  with ${num(counts[l].parts)} libraries` : ""}`}</span>
                </li>
              );
            })}
            <li className={`step ${checking ? "now" : "wait"}`}>
              <span className="step-dot" aria-hidden />
              <span className="step-name">Checking against OSV.dev</span>
              <span className="step-n" />
            </li>
          </ol>
        </section>
      </article>
    );
  }

  const list = attention(result.items, result.findings).filter((a) => a.worst !== "info");
  const vulnItems = list.filter((a) => a.vulns.length);
  const codeModels = list.filter((a) => a.codeOnLoad);
  const totalParts = result.layers.reduce((a, l) => a + l.parts, 0);
  const counts = Object.fromEntries(result.layers.map((l) => [l.layer, { items: l.items, parts: l.parts }])) as Record<Layer, { items: number; parts: number }>;
  const marks: Mark[] = list.map((a) => ({ id: a.item.id, layer: a.item.layer, severity: a.worst, label: `${a.item.name}: ${a.fix}` }));
  const models = result.items.filter((i) => i.layer === "models");

  return (
    <article className="home">
      <CoreSample counts={counts} marks={marks} onMark={(id) => open(`#/item/${encodeURIComponent(id)}`)} />
      <section className="home-right">
        <p className="phase"><span>ASSAYED</span><b>{num(result.items.length)} PIECES</b><b>{num(totalParts)} LIBRARIES</b><b>{num(models.length)} MODELS</b></p>
        <h1 className="verdict">
          This Mac runs <em>{num(result.items.length)}</em> pieces of software built from <em>{num(totalParts)}</em> libraries.{" "}
          {vulnItems.length ? <span className="red">{num(vulnItems.length)} carry a known vulnerability</span> : <span className="green">None carries a known vulnerability</span>}
          {codeModels.length ? <>, and <span className="red">{codeModels.length === 1 ? "one AI model" : `${codeModels.length} AI models`} would run code the moment {codeModels.length === 1 ? "it’s" : "they’re"} loaded.</span></> : models.length ? <>, and <span className="green">every AI model is safe to load.</span></> : "."}
        </h1>
        {!result.vulnCheck.ran && (
          <p className="fine warn">{result.vulnCheck.error ? `The vulnerability check couldn’t reach OSV.dev: ${result.vulnCheck.error}.` : "The online vulnerability check is off, so only model findings are shown."}</p>
        )}

        {list.length > 0 ? (
          <div className="attention">
            <p className="label">WHAT TO DO FIRST</p>
            <ul>
              {entries(list).slice(0, 5).map((e) => e.type === "env" ? (
                <li key={e.key}>
                  <button className="att-row" onClick={() => open("#/findings")}>
                    <KindGlyph kind={e.list[0].item.kind} size={34} />
                    <span className="att-text">
                      <b>{e.label}</b>
                      <span>{e.fix}</span>
                    </span>
                    <span className="att-meta">
                      <Sev s={e.worst} />
                      <span className="muted">{e.advisories} advisories</span>
                    </span>
                  </button>
                </li>
              ) : (() => { const a = e.a; return (
                <li key={a.item.id}>
                  <button className="att-row" onClick={() => open(`#/item/${encodeURIComponent(a.item.id)}`)}>
                    {a.item.kind === "app" && a.item.path ? <img src={api.icon(a.item.path)} width={34} height={34} alt="" /> : <KindGlyph kind={a.item.kind} size={34} />}
                    <span className="att-text">
                      <b>{a.item.name}</b>
                      <span>{a.fix}</span>
                    </span>
                    <span className="att-meta">
                      <Sev s={a.worst} />
                      {a.advisories > 0 && <span className="muted">{a.advisories} {a.advisories === 1 ? "advisory" : "advisories"}</span>}
                    </span>
                  </button>
                </li>
              ); })())}
            </ul>
            {entries(list).length > 5 && (
              <button className="link-more" onClick={() => open("#/findings")}>All {list.length} items that need attention <ArrowRight size={14} aria-hidden /></button>
            )}
          </div>
        ) : (
          <div className="clean-state"><ShieldCheck size={20} aria-hidden /> Nothing on this Mac matches a known vulnerability or an unsafe model.</div>
        )}
      </section>
    </article>
  );
}
