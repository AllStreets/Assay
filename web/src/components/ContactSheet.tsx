import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Item, Layer } from "../../../shared/types";
import { api } from "../api";
import { KIND_NAME, num, params } from "../format";
import { KindGlyph } from "./ui";

// The whole Mac on one proof sheet: apps by their icons, models set in type, and every
// extension, package and image name typeset in one block. What needs attention is marked
// the way an editor marks a proof, by hand, in red china marker, numbered to match the list.

export interface SheetMark {
  n: number;
  // Packages in a flagged install are underlined; anything else is circled.
  underline?: boolean;
}

interface Props {
  items: Item[] | null;
  counts: Record<Layer, { items: number; parts: number }>;
  marks: Map<string, SheetMark>;
  // Everything with a finding reads brighter; only the first few get a pencil mark.
  flagged: Set<string>;
  // Where an install's number goes: the label that starts its run of package names.
  envMarks: Map<string, number>;
  reading?: Layer;
  onOpen?: (id: string) => void;
}

type Stroke = { d: string; n?: number; nx?: number; ny?: number };

function seeded(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) % 10000) / 10000;
}

// A loop drawn in one movement: it starts somewhere on the ellipse, wobbles a little, and
// overshoots its start, the way a hand closes a circle.
function loop(cx: number, cy: number, rx: number, ry: number, rand: () => number) {
  const start = rand() * Math.PI * 2;
  const turns = 1.1 + rand() * 0.12;
  const pts: string[] = [];
  for (let k = 0; k <= 44; k++) {
    const t = start + (k / 44) * Math.PI * 2 * turns;
    const w = 1 + (rand() - 0.5) * 0.07;
    pts.push(`${(cx + Math.cos(t) * rx * w).toFixed(1)} ${(cy + Math.sin(t) * ry * w).toFixed(1)}`);
  }
  return "M" + pts.join(" L");
}

function underline(x0: number, x1: number, y: number, rand: () => number) {
  let d = `M${x0.toFixed(1)} ${y.toFixed(1)}`;
  for (let x = x0 + 3; x <= x1 + 1; x += 3) d += ` L${x.toFixed(1)} ${(y + (rand() - 0.5) * 1.3).toFixed(1)}`;
  return d;
}

const ENV_ORDER = (i: Item) => String(i.meta.envLabel ?? (i.kind === "brew" ? "Homebrew" : ""));

export function ContactSheet({ items, counts, marks, flagged, envMarks, reading, onOpen }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [hover, setHover] = useState<Item | null>(null);
  const [broken, setBroken] = useState<Set<string>>(new Set());

  const draw = useCallback(() => {
    const root = ref.current;
    if (!root || !items) return setStrokes([]);
    const box = root.getBoundingClientRect();
    const out: Stroke[] = [];
    const numbered = new Set<number>();
    for (const el of root.querySelectorAll<HTMLElement>("[data-id]")) {
      const m = marks.get(el.dataset.id!);
      if (!m) continue;
      const r = el.getBoundingClientRect();
      const rand = seeded(el.dataset.id!);
      const x = r.left - box.left, y = r.top - box.top;
      if (m.underline) {
        out.push({ d: underline(x - 1, x + r.width, y + r.height - 1, rand) });
        continue;
      }
      const cx = x + r.width / 2, cy = y + r.height / 2, rx = r.width / 2 + 7, ry = r.height / 2 + 6;
      const s: Stroke = { d: loop(cx, cy, rx, ry, rand) };
      if (!numbered.has(m.n)) {
        numbered.add(m.n);
        Object.assign(s, { n: m.n, nx: cx + rx + 3, ny: cy + 5 });
      }
      out.push(s);
    }
    for (const el of root.querySelectorAll<HTMLElement>("[data-env]")) {
      const n = envMarks.get(el.dataset.env!);
      if (!n || numbered.has(n)) continue;
      numbered.add(n);
      const r = el.getBoundingClientRect();
      out.push({ d: "", n, nx: r.left - box.left - 13, ny: r.top - box.top + 3 });
    }
    setStrokes(out);
  }, [items, marks, envMarks]);

  useLayoutEffect(() => {
    draw();
    let alive = true;
    document.fonts.ready.then(() => alive && draw());
    const ro = new ResizeObserver(() => draw());
    if (ref.current) ro.observe(ref.current);
    return () => {
      alive = false;
      ro.disconnect();
    };
  }, [draw]);

  // Icons arrive after layout; redraw once they have.
  useEffect(() => {
    const t = setTimeout(draw, 600);
    return () => clearTimeout(t);
  }, [draw]);

  const of = (l: Layer) => (items ?? []).filter((i) => i.layer === l);
  const apps = of("apps").sort((a, b) => a.name.localeCompare(b.name));
  const models = of("models");
  const exts = of("extensions").sort((a, b) => a.name.localeCompare(b.name));
  const pkgs = of("packages").sort((a, b) => ENV_ORDER(a).localeCompare(ENV_ORDER(b)) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  const images = of("containers");
  const envs = [...new Set(pkgs.map(ENV_ORDER))];

  const bind = (i: Item) => ({
    "data-id": i.id,
    onClick: () => onOpen?.(i.id),
    onMouseEnter: () => setHover(i),
    onMouseLeave: () => setHover((h) => (h === i ? null : h)),
    onFocus: () => setHover(i),
    "aria-label": `${i.name}${i.version ? ` ${i.version}` : ""}`,
  });
  // The same extension in three editors is one word with a count, not three words.
  const words = (list: Item[]) => {
    const groups = new Map<string, Item[]>();
    for (const i of list) groups.set(i.name, [...(groups.get(i.name) ?? []), i]);
    return [...groups.values()].map((g) => {
      const lead = g.find((i) => marks.has(i.id)) ?? g.find((i) => flagged.has(i.id)) ?? g[0];
      return (
        <button key={lead.id} className={`sw-word${g.some((i) => flagged.has(i.id)) ? " hit" : ""}`} {...bind(lead)}>
          {lead.name}{g.length > 1 && <sup>{g.length}</sup>}
        </button>
      );
    });
  };
  const ghosts = (n: number, cls: string) => Array.from({ length: Math.min(n, 400) }, (_, k) => <span key={k} className={cls} />);

  return (
    <div className={`sheet${items ? "" : " sheet-empty"}`} ref={ref}>
      <div className="sheet-caption" aria-live="polite">
        {hover ? <><b>{hover.name}</b> {KIND_NAME[hover.kind]}{hover.version ? ` ${hover.version}` : ""}{(hover.parts.length || Number(hover.meta.partCount ?? 0)) > 1 ? `, ${num(hover.parts.length || Number(hover.meta.partCount))} parts` : hover.model?.parameters ? `, ${params(hover.model.parameters)} parameters` : ""}</> : reading ? `Reading ${num((items ?? []).length)} so far` : items ? "Point at anything to read it. Click to open it." : "Nothing read yet."}
      </div>

      <section className="sheet-sec">
        <h3 className="sheet-h"><span>{num(counts.apps.items)} apps</span>{counts.apps.parts > 0 && <span>{num(counts.apps.parts)} libraries inside them</span>}</h3>
        <div className="sheet-apps">
          {items
            ? apps.map((a) => (
                <button key={a.id} className="sheet-app" {...bind(a)}>
                  {a.path && !broken.has(a.id) ? <img src={api.icon(a.path)} alt="" loading="lazy" onLoad={draw} onError={() => setBroken((b) => new Set(b).add(a.id))} /> : <KindGlyph kind="app" size={34} />}
                </button>
              ))
            : ghosts(counts.apps.items, "ghost-app")}
        </div>
      </section>

      <section className="sheet-sec">
        <h3 className="sheet-h"><span>{num(counts.models.items)} AI models</span></h3>
        <div className="sheet-models">
          {items
            ? models.map((m) => (
                <button key={m.id} className={`sheet-model${flagged.has(m.id) ? " hit" : ""}`} {...bind(m)}>
                  {m.name.split("/").pop()}
                  {m.model?.parameters ? <small>{params(m.model.parameters)}</small> : null}
                </button>
              ))
            : ghosts(counts.models.items, "ghost-model")}
        </div>
      </section>

      <section className="sheet-sec">
        <h3 className="sheet-h">
          <span>{num(counts.extensions.items)} extensions, {num(counts.packages.items)} packages{envs.length > 1 ? ` in ${envs.length} installs` : ""}, {num(counts.containers.items)} container images</span>
        </h3>
        <p className="sheet-type">
          {items ? (
            <>
              {words(exts)}
              {envs.map((env) => (
                <span key={env} className="sw-run">
                  <span className="sw-env" data-env={env}>{env || "Other"}</span>
                  {words(pkgs.filter((p) => ENV_ORDER(p) === env))}
                </span>
              ))}
              {images.length > 0 && <span className="sw-run"><span className="sw-env">Docker</span>{words(images)}</span>}
            </>
          ) : (
            ghosts(counts.extensions.items + counts.packages.items + counts.containers.items, "ghost-word")
          )}
        </p>
      </section>

      <svg className="pencil" aria-hidden>
        {strokes.map((s, k) => (
          <g key={k}>
            {s.d && <path d={s.d} />}
            {s.n !== undefined && <text x={s.nx} y={s.ny}>{s.n}</text>}
          </g>
        ))}
      </svg>
    </div>
  );
}
