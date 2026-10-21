import { ArrowRight, FlaskConical, ShieldCheck } from "lucide-react";
import type { Item, Layer, Progress } from "../../../shared/types";
import type { Result } from "../api";
import { LAYER_NAME, attention, entries, num } from "../format";

const ORDER: Layer[] = ["apps", "models", "extensions", "packages", "containers"];
import { ContactSheet, type SheetMark } from "./ContactSheet";
import { Button, KindGlyph } from "./ui";
import { api } from "../api";

const NONE = new Map<string, SheetMark>();
const NO_IDS = new Set<string>();
const NO_ENV = new Map<string, number>();

const ZERO: Record<Layer, { items: number; parts: number }> = {
  apps: { items: 0, parts: 0 }, models: { items: 0, parts: 0 }, extensions: { items: 0, parts: 0 }, packages: { items: 0, parts: 0 }, containers: { items: 0, parts: 0 },
};

export function Home({ result, progress, live, onRun, open }: { result: Result | null; progress: Progress | null; live: Item[]; onRun: () => void; open: (to: string) => void }) {
  const running = !!progress?.running;

  if (!result && !running) {
    return (
      <article className="home first">
        <ContactSheet items={null} counts={ZERO} marks={NONE} flagged={NO_IDS} envMarks={NO_ENV} />
        <section className="home-right">
          <h1 className="verdict">Assay reads every piece of software on this Mac, down to the libraries inside it, and checks each one against what’s known to be broken.</h1>
          <p className="lede">Apps, AI models, extensions, packages and containers. Models are read from their bytes, never loaded, and nothing changes until you say so.</p>
          <Button variant="gold" icon={FlaskConical} onClick={onRun}>Run the first assay</Button>
          <p className="fine">To check for known vulnerabilities, Assay sends package names and versions to OSV.dev, an open database of published advisories. Nothing else leaves this Mac, and Settings can turn it off.</p>
        </section>
      </article>
    );
  }

  if (running || !result) {
    const counts = progress?.found ?? ZERO;
    const checking = !!progress?.stage?.startsWith("Checking");
    const now = checking ? ORDER.length : ORDER.indexOf(progress?.layer ?? "apps");
    return (
      <article className="home">
        <ContactSheet items={live} counts={counts} marks={NONE} flagged={NO_IDS} envMarks={NO_ENV} reading={progress?.layer ?? "apps"} onOpen={() => {}} />
        <section className="home-right">
          <h1 className="verdict running">{progress?.stage ?? "Starting"}<span className="cursor" /></h1>
          <ol className="steps">
            {ORDER.map((l, i) => {
              const state = i < now ? "done" : i === now ? "now" : "wait";
              return (
                <li key={l} className={`step ${state}`}>
                  <span className="step-dot" aria-hidden />
                  <span className="step-name">{LAYER_NAME[l]}</span>
                  <span className="step-n">{state === "wait" ? "" : `${num(counts[l].items)}${counts[l].parts ? `, ${num(counts[l].parts)} libraries` : ""}`}</span>
                </li>
              );
            })}
            <li className={`step ${checking ? "now" : "wait"}`}>
              <span className="step-dot" aria-hidden />
              <span className="step-name">Known vulnerabilities</span>
              <span className="step-n">{checking ? "asking OSV.dev" : ""}</span>
            </li>
          </ol>
          <p className="fine">Models are opened at their headers only, so a malicious one can’t run while it’s being checked.</p>
        </section>
      </article>
    );
  }

  const list = attention(result.items, result.findings).filter((a) => a.worst !== "info");
  const vulnItems = list.filter((a) => a.vulns.length);
  const codeModels = list.filter((a) => a.codeOnLoad);
  const totalParts = result.layers.reduce((a, l) => a + l.parts, 0);
  const counts = Object.fromEntries(result.layers.map((l) => [l.layer, { items: l.items, parts: l.parts }])) as Record<Layer, { items: number; parts: number }>;
  const all = entries(list);
  // The first five decisions get a number and a pencil mark; an install's packages are
  // underlined together and share one number.
  const marks = new Map<string, SheetMark>();
  const envMarks = new Map<string, number>();
  all.slice(0, 5).forEach((e, k) => {
    if (e.type === "env") {
      envMarks.set(e.key, k + 1);
      for (const a of e.list) marks.set(a.item.id, { n: k + 1, underline: true });
    } else marks.set(e.a.item.id, { n: k + 1 });
  });
  const flagged = new Set(list.map((a) => a.item.id));
  const models = result.items.filter((i) => i.layer === "models");

  return (
    <article className="home">
      <ContactSheet items={result.items} counts={counts} marks={marks} flagged={flagged} envMarks={envMarks} onOpen={(id) => open(`#/item/${encodeURIComponent(id)}`)} />
      <section className="home-right">
        <h1 className="verdict">
          This Mac runs {num(result.items.length)} pieces of software built from {num(totalParts)} libraries.{" "}
          {vulnItems.length ? <>{num(vulnItems.length)} of them carry a known vulnerability</> : <>None of them carries a known vulnerability</>}
          {codeModels.length ? <>, and {codeModels.length === 1 ? "one AI model" : `${codeModels.length} AI models`} would run code as soon as {codeModels.length === 1 ? "it’s" : "they’re"} loaded.</> : models.length ? <>, and every AI model is safe to load.</> : "."}
        </h1>
        {!result.vulnCheck.ran && (
          <p className="fine warn">{result.vulnCheck.error ? `The vulnerability check couldn’t reach OSV.dev: ${result.vulnCheck.error}.` : "The online vulnerability check is off, so only model findings are shown."}</p>
        )}

        {all.length > 0 ? (
          <div className="attention">
            <h2 className="h2">Start here</h2>
            <ol className="first-list">
              {all.slice(0, 5).map((e, n) => {
                const key = e.type === "env" ? e.key : e.a.item.id;
                const to = e.type === "env" ? "#/findings" : `#/item/${encodeURIComponent(e.a.item.id)}`;
                const name = e.type === "env" ? e.label : e.a.item.name;
                const fix = e.type === "env" ? e.fix : e.a.fix;
                return (
                  <li key={key}>
                    <button className="first-row" onClick={() => open(to)}>
                      <span className="first-n">{n + 1}</span>
                      {e.type === "item" && e.a.item.kind === "app" && e.a.item.path ? <img src={api.icon(e.a.item.path)} width={30} height={30} alt="" /> : <KindGlyph kind={e.type === "env" ? e.list[0].item.kind : e.a.item.kind} size={30} />}
                      <span className="first-text"><b>{name}</b><span>{fix}</span></span>
                    </button>
                  </li>
                );
              })}
            </ol>
            {all.length > 5 && (
              <button className="link-more" onClick={() => open("#/findings")}>Everything that needs attention ({num(list.length)}) <ArrowRight size={14} aria-hidden /></button>
            )}
          </div>
        ) : (
          <p className="clean-state"><ShieldCheck size={18} aria-hidden /> Nothing on this Mac matches a known vulnerability or an unsafe model.</p>
        )}
      </section>
    </article>
  );
}
