import { ArrowRight, FlaskConical } from "lucide-react";
import { useMemo } from "react";
import type { Item, Layer, Progress } from "../../../shared/types";
import type { Result } from "../api";
import { LAYER_NAME, attention, entries, envFineness, fineness, macFineness, num, standardOf } from "../format";
import { Punch } from "./Metal";
import { Touchstone, type StoneMark } from "./Touchstone";
import { Button } from "./ui";

const ORDER: Layer[] = ["apps", "models", "extensions", "packages", "containers"];
const NONE = new Map<string, StoneMark>();
const ZERO: Record<Layer, { items: number; parts: number }> = {
  apps: { items: 0, parts: 0 }, models: { items: 0, parts: 0 }, extensions: { items: 0, parts: 0 }, packages: { items: 0, parts: 0 }, containers: { items: 0, parts: 0 },
};

export function Home({ result, progress, live, onRun, open }: { result: Result | null; progress: Progress | null; live: Item[]; onRun: () => void; open: (to: string) => void }) {
  const running = !!progress?.running;

  const done = useMemo(() => {
    if (!result) return null;
    const list = attention(result.items, result.findings).filter((a) => a.worst !== "info");
    const all = entries(list);
    const fine = new Map(result.items.map((i) => [i.id, fineness(i, result.findings)] as const));
    // The first five decisions get the assayer's scratch and a number; an install's packages
    // share one number.
    const marks = new Map<string, StoneMark>();
    all.slice(0, 5).forEach((e, k) => {
      if (e.type === "env") for (const a of e.list) marks.set(a.item.id, { n: k + 1, underline: true });
      else marks.set(e.a.item.id, { n: k + 1 });
    });
    return { list, all, fine, marks, mac: macFineness(result.items, result.findings) };
  }, [result]);

  if (!result && !running) {
    return (
      <article className="home first">
        <Touchstone items={null} fine={null} marks={NONE} counts={ZERO} />
        <section className="home-right">
          <h1 className="verdict">Assay tests every piece of software on this Mac the way gold is tested: down to what it’s made of, against what’s known to be broken.</h1>
          <p className="lede">Apps, AI models, extensions, packages and containers. Models are read from their bytes, never loaded, and nothing changes until you say so.</p>
          <Button variant="gold" icon={FlaskConical} onClick={onRun}>Run the first assay</Button>
          <p className="fine">To check for known vulnerabilities, Assay sends package names and versions to OSV.dev, an open database of published advisories. Nothing else leaves this Mac, and Settings can turn it off.</p>
        </section>
      </article>
    );
  }

  if (running || !result || !done) {
    const counts = progress?.found ?? ZERO;
    const checking = !!progress?.stage?.startsWith("Checking");
    const now = checking ? ORDER.length : ORDER.indexOf(progress?.layer ?? "apps");
    return (
      <article className="home">
        <Touchstone items={live} fine={null} marks={NONE} counts={counts} reading />
        <section className="home-right">
          <p className="engraved kicker">Assaying</p>
          <h1 className="verdict running">{progress?.stage ?? "Starting"}<span className="cursor" /></h1>
          <ol className="steps">
            {ORDER.map((l, i) => {
              const state = i < now ? "done" : i === now ? "now" : "wait";
              return (
                <li key={l} className={`step ${state}`}>
                  <span className="step-dot" aria-hidden />
                  <span className="step-name engraved">{LAYER_NAME[l]}</span>
                  <span className="step-n">{state === "wait" ? "" : `${num(counts[l].items)}${counts[l].parts ? ` / ${num(counts[l].parts)} libraries` : ""}`}</span>
                </li>
              );
            })}
            <li className={`step ${checking ? "now" : "wait"}`}>
              <span className="step-dot" aria-hidden />
              <span className="step-name engraved">Known vulnerabilities</span>
              <span className="step-n">{checking ? "asking OSV.dev" : ""}</span>
            </li>
          </ol>
          <p className="fine">The streaks go down raw while Assay reads, and take their metal once every library has been checked. Models are opened at their headers only, so none can run while it’s tested.</p>
        </section>
      </article>
    );
  }

  const { list, all, fine, marks, mac } = done;
  const codeModels = list.filter((a) => a.codeOnLoad);
  const counts = Object.fromEntries(result.layers.map((l) => [l.layer, { items: l.items, parts: l.parts }])) as Record<Layer, { items: number; parts: number }>;
  const std = standardOf(mac.fine);
  const year = new Date(result.finishedAt).getFullYear() % 100;

  return (
    <article className="home">
      <Touchstone items={result.items} fine={fine} marks={marks} counts={counts} macFine={mac.fine} onOpen={(id) => open(`#/item/${encodeURIComponent(id)}`)} />
      <section className="home-right">
        <div className="marks" aria-label={`Hallmarks: Assay, ${mac.fine} fine, 20${year}`}>
          <Punch shape="shield" size="l">A</Punch>
          <Punch shape="oval" size="l">{mac.fine}</Punch>
          <Punch shape="square" size="l">{String(year).padStart(2, "0")}</Punch>
        </div>
        <p className="grade">{std.fine ? `${std.name} standard` : "Below standard"}</p>
        <h1 className="verdict">
          This Mac assays at {mac.fine} fine: {num(result.items.length)} pieces of software built from {num(mac.total)} libraries
          {codeModels.length ? <>, and {codeModels.length === 1 ? "one AI model" : `${codeModels.length} AI models`} that would run code when loaded.</> : "."}
        </h1>
        <p className="expl">{num(mac.total - mac.bad)} of its {num(mac.total)} libraries have nothing published against them. The rest show on the stone in rose and copper.</p>
        {!result.vulnCheck.ran && (
          <p className="fine warn">{result.vulnCheck.error ? `The vulnerability check couldn’t reach OSV.dev: ${result.vulnCheck.error}.` : "The online vulnerability check is off, so only model findings are counted."}</p>
        )}

        {all.length > 0 && (
          <div className="attention">
            <h2 className="engraved h-engraved">Start here</h2>
            <ol className="first-list">
              {all.slice(0, 5).map((e, n) => {
                const key = e.type === "env" ? e.key : e.a.item.id;
                const to = e.type === "env" ? "#/findings" : `#/item/${encodeURIComponent(e.a.item.id)}`;
                const name = e.type === "env" ? e.label : e.a.item.name;
                const fix = e.type === "env" ? e.fix : e.a.fix;
                const f = e.type === "env" ? envFineness(result.items, result.findings, e.key) : fine.get(e.a.item.id) ?? null;
                return (
                  <li key={key}>
                    <button className="first-row" onClick={() => open(to)}>
                      <Punch size="s" tone={f === 0 ? "base" : undefined}>{f === null ? "?" : f === 0 ? "base" : f}</Punch>
                      <span className="first-text"><b><span className="first-n">{n + 1}</span>{name}</b><span>{fix}</span></span>
                    </button>
                  </li>
                );
              })}
            </ol>
            {all.length > 5 && (
              <button className="link-more" onClick={() => open("#/findings")}>Everything that needs attention, {num(list.length)} in all <ArrowRight size={14} aria-hidden /></button>
            )}
          </div>
        )}
      </section>
    </article>
  );
}
