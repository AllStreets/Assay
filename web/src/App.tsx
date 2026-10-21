import { FlaskConical, Settings as Cog } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Item, Progress } from "../../shared/types";
import { api, type Result } from "./api";
import { Home } from "./components/Home";
import { ItemView } from "./components/ItemView";
import { Findings, Inventory, Models, Quarantine, SettingsPage } from "./components/Pages";
import { MetalDefs } from "./components/Metal";
import { Button } from "./components/ui";
import { num, when } from "./format";

const TABS = [
  ["#/", "Touchstone"],
  ["#/findings", "Findings"],
  ["#/models", "Models"],
  ["#/inventory", "Inventory"],
  ["#/quarantine", "Quarantine"],
] as const;

function useRoute() {
  const [hash, setHash] = useState(location.hash || "#/");
  useEffect(() => {
    const on = () => {
      setHash(location.hash || "#/");
      window.scrollTo(0, 0);
    };
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return hash;
}

export function App() {
  const route = useRoute();
  const [result, setResult] = useState<Result | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  // The running assay's items as they arrive.
  const live = useRef<Item[]>([]);
  const [liveItems, setLiveItems] = useState<Item[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number>(0);

  const refresh = useCallback(async () => {
    try {
      setResult(await api.result());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoaded(true);
    }
  }, []);

  const poll = useCallback(async () => {
    try {
      const p = await api.progress(live.current.length);
      if (p.fresh?.length && p.running) {
        live.current = [...live.current, ...p.fresh];
        setLiveItems(live.current);
      }
      setProgress(p);
      if (p.running) timer.current = window.setTimeout(poll, 500);
      else refresh();
    } catch {
      timer.current = window.setTimeout(poll, 1500);
    }
  }, [refresh]);

  useEffect(() => {
    refresh();
    poll();
    return () => clearTimeout(timer.current);
  }, [refresh, poll]);

  const run = async () => {
    try {
      live.current = [];
      setLiveItems([]);
      setProgress(await api.run());
      if (location.hash && location.hash !== "#/") location.hash = "#/";
      clearTimeout(timer.current);
      timer.current = window.setTimeout(poll, 300);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const running = !!progress?.running;
  const go = (to: string) => (location.hash = to);
  const flagged = result ? new Set(result.findings.filter((f) => f.severity !== "info").map((f) => f.itemId)).size : 0;

  let page: React.ReactNode;
  if (!loaded) page = null;
  else if (route === "#/" || running || (!result && !route.startsWith("#/settings"))) page = <Home result={result} progress={progress} live={liveItems} onRun={run} open={go} />;
  else if (route.startsWith("#/item/") && result) page = <ItemView key={route} result={result} id={decodeURIComponent(route.slice(7))} onChanged={refresh} />;
  else if (route === "#/findings" && result) page = <Findings result={result} />;
  else if (route === "#/models" && result) page = <Models result={result} />;
  else if (route === "#/inventory" && result) page = <Inventory result={result} />;
  else if (route === "#/quarantine") page = <Quarantine onChanged={refresh} />;
  else if (route === "#/settings") page = <SettingsPage result={result} />;
  else page = <Home result={result} progress={progress} live={liveItems} onRun={run} open={go} />;

  // A certificate belongs to the page it was reached from: models to Models, the rest to Inventory.
  const itemLayer = route.startsWith("#/item/") ? result?.items.find((i) => i.id === decodeURIComponent(route.slice(7)))?.layer : undefined;
  const tabOn = (href: string) =>
    href === "#/" ? route === "#/" : route.startsWith(href) || (itemLayer !== undefined && href === (itemLayer === "models" ? "#/models" : "#/inventory"));

  const libs = result ? result.layers.reduce((a, l) => a + l.parts, 0) : 0;

  return (
    <div className="shell">
      <MetalDefs />
      <a className="skip" href="#main">Skip to content</a>
      <header className="top">
        <a className="brand" href="#/" aria-label="Assay home">
          <BrandMark />
          <span className="brand-word">Assay</span>
        </a>
        <nav className="tabs" aria-label="Pages">
          {TABS.map(([href, label]) => (
            <a key={href} href={href} className="plate" aria-current={tabOn(href) ? "page" : undefined}>
              {label}
              {href === "#/findings" && flagged > 0 && <span className="tab-n">{num(flagged)}</span>}
            </a>
          ))}
        </nav>
        <div className="top-right">
          {result && !running && (
            <div className="readout" title={`Last assay ${new Date(result.finishedAt).toLocaleString()}`}>
              <span className="lcd">{num(libs)} libraries weighed</span>
              <span className="readout-note">{when(result.finishedAt)}</span>
            </div>
          )}
          <Button variant={result ? "plate" : "gold"} icon={FlaskConical} busy={running} onClick={run}>{running ? "Assaying" : result ? "Assay again" : "Run assay"}</Button>
          <a href="#/settings" className="icon-plate" aria-label="Settings" aria-current={route === "#/settings" ? "page" : undefined}><Cog size={16} /></a>
        </div>
      </header>
      {error && <p className="note-strip bad top-error" role="alert">Assay’s engine isn’t answering: {error}</p>}
      <main id="main">{page}</main>
    </div>
  );
}

// Two streaks on a black stone: one gold, one copper. Assay's mark.
function BrandMark() {
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden>
      <rect x="1" y="1" width="28" height="28" rx="5" fill="#07080a" />
      <rect x="1.5" y="1.5" width="27" height="27" rx="4.5" fill="none" stroke="#ffffff14" />
      <path d="M6 20.5 C10 19, 15 18.4, 24 17" stroke="url(#m-fine)" strokeWidth="3.4" strokeLinecap="round" fill="none" filter="url(#rub)" />
      <path d="M7 11.5 C11 11, 16 10.6, 21 9.8" stroke="url(#m-copper)" strokeWidth="2.6" strokeLinecap="round" fill="none" filter="url(#rub)" />
    </svg>
  );
}
