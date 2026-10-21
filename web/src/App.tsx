import { FlaskConical, Settings as Cog } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Progress } from "../../shared/types";
import { api, type Result } from "./api";
import { Home } from "./components/Home";
import { ItemView } from "./components/ItemView";
import { Findings, Inventory, Models, Quarantine, SettingsPage } from "./components/Pages";
import { Button } from "./components/ui";
import { num, when } from "./format";

const TABS = [
  ["#/", "Assay"],
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
      const p = await api.progress();
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
  else if (route === "#/" || running || (!result && !route.startsWith("#/settings"))) page = <Home result={result} progress={progress} onRun={run} open={go} />;
  else if (route.startsWith("#/item/") && result) page = <ItemView key={route} result={result} id={decodeURIComponent(route.slice(7))} onChanged={refresh} />;
  else if (route === "#/findings" && result) page = <Findings result={result} />;
  else if (route === "#/models" && result) page = <Models result={result} />;
  else if (route === "#/inventory" && result) page = <Inventory result={result} />;
  else if (route === "#/quarantine") page = <Quarantine onChanged={refresh} />;
  else if (route === "#/settings") page = <SettingsPage result={result} />;
  else page = <Home result={result} progress={progress} onRun={run} open={go} />;

  // A certificate belongs to the page it was reached from: models to Models, the rest to Inventory.
  const itemLayer = route.startsWith("#/item/") ? result?.items.find((i) => i.id === decodeURIComponent(route.slice(7)))?.layer : undefined;
  const tabOn = (href: string) =>
    href === "#/" ? route === "#/" : route.startsWith(href) || (itemLayer !== undefined && href === (itemLayer === "models" ? "#/models" : "#/inventory"));

  return (
    <div className="shell">
      <a className="skip" href="#main">Skip to content</a>
      <header className="top">
        <a className="brand" href="#/" aria-label="Assay home">
          <img src="/seal.svg" alt="" width={26} height={26} />
          <span>Assay</span>
        </a>
        <nav className="tabs" aria-label="Pages">
          {TABS.map(([href, label]) => (
            <a key={href} href={href} className="tab" aria-current={tabOn(href) ? "page" : undefined}>
              {label}
              {href === "#/findings" && flagged > 0 && <span className="tab-n">{num(flagged)}</span>}
            </a>
          ))}
        </nav>
        <div className="top-right">
          {result && !running && <span className="top-stamp">Assayed {when(result.finishedAt)}</span>}
          <Button variant="ghost" icon={FlaskConical} busy={running} onClick={run}>{running ? "Assaying" : result ? "Run again" : "Run assay"}</Button>
          <a href="#/settings" className="icon-btn" aria-label="Settings" aria-current={route === "#/settings" ? "page" : undefined}><Cog size={17} /></a>
        </div>
      </header>
      {error && <p className="note-strip bad top-error" role="alert">Assay’s engine isn’t answering: {error}</p>}
      <main id="main">{page}</main>
    </div>
  );
}
