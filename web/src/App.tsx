import { FlaskConical, Moon, Settings as Cog, Sun } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Item, Progress } from "../../shared/types";
import { api, type Result } from "./api";
import { Home } from "./components/Home";
import { ItemView } from "./components/ItemView";
import { Changes, Findings, Inventory, Models, Quarantine, SettingsPage } from "./components/Pages";
import { Button } from "./components/ui";
import { num, when } from "./format";

const TABS = [
  ["#/", "overview"],
  ["#/findings", "findings"],
  ["#/changes", "changes"],
  ["#/models", "models"],
  ["#/inventory", "inventory"],
  ["#/quarantine", "quarantine"],
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
  else if (route === "#/changes") page = <Changes result={result} />;
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
    <div className="frame">
      <a className="skip" href="#main">Skip to content</a>
      <header className="top">
        <a className="brand" href="#/" aria-label="Assay home">
          <BrandMark />
          <span className="brand-text"><b>assay</b><small>software bill of materials / mac</small></span>
        </a>
        <nav className="keys" aria-label="Pages">
          {TABS.map(([href, label]) => (
            <a key={href} href={href} className="key" aria-current={tabOn(href) ? "page" : undefined}>
              <i className="lamp" aria-hidden />
              {label}
              {href === "#/findings" && flagged > 0 && <span className="key-n">{num(flagged)}</span>}
            </a>
          ))}
        </nav>
        <div className="keys keys-right">
          <ThemeKey />
          <a href="#/settings" className="key" aria-current={route === "#/settings" ? "page" : undefined}><Cog size={14} aria-hidden />settings</a>
          <Button variant="go" icon={FlaskConical} busy={running} onClick={run}>{running ? "assaying" : result ? "assay again" : "run assay"}</Button>
        </div>
      </header>
      {error && <p className="note-strip bad top-error" role="alert">Assay’s engine isn’t answering: {error}</p>}
      <main id="main" className="main">{page}</main>
      <footer className="status">
        {result ? (
          <>
            <span>host <b>{result.host}</b></span>
            <span>items <b>{num(result.items.length)}</b></span>
            <span>libraries <b>{num(libs)}</b></span>
            <span>osv <b>{result.vulnCheck.ran ? `${num(result.vulnCheck.queried)} versions` : "off"}</b></span>
            <span>assayed <b>{when(result.finishedAt)}</b></span>
          </>
        ) : <span>no assay yet</span>}
        <span className="status-r">local only / nothing loaded</span>
      </footer>
    </div>
  );
}

// Light is the bench; dark is the same bench after hours. Remembered per viewer.
function ThemeKey() {
  const [dark, setDark] = useState(() => {
    try { return localStorage.getItem("assay-theme") === "dark"; } catch { return false; }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    try { localStorage.setItem("assay-theme", dark ? "dark" : "light"); } catch { /* private window */ }
  }, [dark]);
  return (
    <button className="key key-icon" onClick={() => setDark((d) => !d)} aria-label={dark ? "Switch to light" : "Switch to dark"} aria-pressed={dark}>
      {dark ? <Sun size={14} /> : <Moon size={14} />}
    </button>
  );
}

// A reticle with one lit point: something found. Assay's mark.
function BrandMark() {
  return (
    <svg className="brand-mark" width="34" height="34" viewBox="0 0 34 34" aria-hidden>
      <rect x="1" y="1" width="32" height="32" rx="8" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="17" cy="17" r="8" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M17 9V5M17 29v-4M9 17H5M29 17h-4" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="22.6" cy="11.4" r="2.6" fill="var(--hot)" />
    </svg>
  );
}
