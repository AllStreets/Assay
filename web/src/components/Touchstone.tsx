import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Item, Layer } from "../../../shared/types";
import { KIND_NAME, STANDARDS, metal, num, params, type Metal } from "../format";

// The touchstone: how gold has been tested for two thousand years. You rub the metal on a
// black stone and read the colour of the streak. Here every piece of software on the Mac
// leaves one streak; its colour is its fineness. While an assay runs the streaks go down
// raw, and take their metal when the reading is done.

export interface StoneMark {
  n: number;
  underline?: boolean;
}

interface Props {
  items: Item[] | null;
  fine: Map<string, number | null> | null;
  marks: Map<string, StoneMark>;
  counts: Record<Layer, { items: number; parts: number }>;
  macFine?: number;
  reading?: boolean;
  onOpen?: (id: string) => void;
}

const ROWS: [Layer, string][] = [["apps", "Apps"], ["models", "Models"], ["extensions", "Extensions"], ["packages", "Packages"], ["containers", "Images"]];
const GUTTER = 108;

function seeded(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) % 10000) / 10000;
}

const ENV = (i: Item) => String(i.meta.envLabel ?? (i.kind === "brew" ? "Homebrew" : ""));

interface Laid { item: Item; d: string; drag: string; w: number; x1: number; x2: number; y: number }

// Lays a row of streaks like strokes on a stone: each as long as what it carries, a little
// off level, the next starting where the hand lifted.
function lay(items: Item[], layer: Layer, width: number) {
  const out: Laid[] = [];
  const lineH = layer === "packages" ? 13 : layer === "apps" ? 22 : 18;
  const w = layer === "packages" ? 3.6 : layer === "models" ? 7 : layer === "apps" ? 5.6 : 4.4;
  let x = 0;
  let y = 10;
  for (const item of items) {
    const R = seeded(item.id);
    const parts = item.parts.length || Number(item.meta.partCount ?? 0);
    const len =
      layer === "packages" ? 9 + R() * 18
      : layer === "models" ? 34 + Math.log10(Math.max(1e7, item.model?.parameters ?? 1e8)) * 10
      : Math.min(160, 16 + Math.sqrt(Math.max(1, parts)) * 5.2);
    if (x + len > width) {
      x = 0;
      y += lineH;
    }
    const tilt = (R() - 0.5) * 0.16;
    const yy = y + (R() - 0.5) * 3.4;
    const x1 = x, x2 = x + len;
    const d = `M${x1.toFixed(1)} ${yy.toFixed(1)} C ${(x1 + len * 0.3).toFixed(1)} ${(yy - len * tilt - 0.8).toFixed(1)}, ${(x1 + len * 0.7).toFixed(1)} ${(yy + len * tilt + 0.8).toFixed(1)}, ${x2.toFixed(1)} ${(yy + len * tilt * 0.5).toFixed(1)}`;
    // A fainter second pass, where the metal dragged as the hand lifted.
    const drag = `M${(x1 + len * 0.15).toFixed(1)} ${(yy + w * 0.55).toFixed(1)} L ${(x2 - len * 0.1).toFixed(1)} ${(yy + w * 0.45 + len * tilt * 0.4).toFixed(1)}`;
    out.push({ item, d, drag, w, x1, x2, y: yy });
    x += len + 4 + R() * 9;
  }
  return { laid: out, height: y + lineH };
}

// Where a fineness falls along the reference needles, from 0 (finest) to 1 (base).
function needlePos(f: number) {
  const s = STANDARDS;
  for (let i = 0; i < s.length - 1; i++) {
    if (f <= s[i].fine && f >= s[i + 1].fine) return (i + (s[i].fine - f) / (s[i].fine - s[i + 1].fine || 1)) / (s.length - 1);
  }
  return f > s[0].fine ? 0 : 1;
}

export function Touchstone({ items, fine, marks, counts, macFine, reading, onOpen }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  const [tip, setTip] = useState<{ x: number; y: number; item: Item } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(320, el.clientWidth - GUTTER - 52)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rows = useMemo(() => {
    if (!items) return [];
    return ROWS.map(([layer, name]) => {
      let list = items.filter((i) => i.layer === layer);
      if (layer === "packages") list = [...list].sort((a, b) => ENV(a).localeCompare(ENV(b)) || a.name.localeCompare(b.name));
      if (layer === "apps") list = [...list].sort((a, b) => a.name.localeCompare(b.name));
      return { layer, name, ...lay(list, layer, width) };
    });
  }, [items, width]);

  const tone = (i: Item): Metal => (fine ? metal(fine.get(i.id) ?? 999) : "raw");

  if (!items) {
    return (
      <div className="stone stone-blank" ref={ref}>
        <p className="blank-title">The stone is clean.</p>
        <p className="blank-body">Run the first assay and every app, model, extension and package on this Mac leaves a streak here, in the colour of what it’s made of.</p>
        <Needles />
      </div>
    );
  }

  return (
    <div className={`stone${reading ? " stone-reading" : ""}`} ref={ref} onMouseLeave={() => setTip(null)}>
      {rows.map((r) => (
        <div className="stone-row" key={r.layer}>
          <div className="stone-label">
            <span className="engraved">{r.name}</span>
            <span className="stone-count">{num(counts[r.layer].items)}</span>
          </div>
          {r.laid.length > 0 ? (
            <svg className="streaks" width={width} height={r.height} viewBox={`0 0 ${width} ${r.height}`}>
              <g filter="url(#rub)">
                {r.laid.map((s) => {
                  const m = tone(s.item);
                  return (
                    <g
                      key={s.item.id}
                      className="streak"
                      onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, item: s.item })}
                      onClick={() => onOpen?.(s.item.id)}
                    >
                      <path d={s.drag} stroke={`url(#m-${m})`} strokeWidth={s.w * 0.35} strokeLinecap="round" fill="none" opacity={0.35} />
                      <path d={s.d} pathLength={1} stroke={`url(#m-${m})`} strokeWidth={s.w} strokeLinecap="round" fill="none" className="streak-main" />
                      <path d={s.d} stroke="transparent" strokeWidth={s.w + 8} fill="none" />
                    </g>
                  );
                })}
              </g>
              {/* The assayer's own marks, scratched beside what to fix first. */}
              {r.laid.map((s) => {
                const m = marks.get(s.item.id);
                if (!m) return null;
                const first = m.underline ? r.laid.find((o) => marks.get(o.item.id)?.n === m.n) === s : true;
                return (
                  <g key={`m-${s.item.id}`} className="scratch">
                    <path d={`M${s.x1 - 3} ${s.y + s.w + 2.5} q ${(s.x2 - s.x1) / 2} 2.6 ${s.x2 - s.x1 + 6} 0`} />
                    {first && <text x={s.x2 + 5} y={s.y + 5}>{m.n}</text>}
                  </g>
                );
              })}
            </svg>
          ) : (
            <div className="stone-empty-row">{reading ? "" : "None found"}</div>
          )}
        </div>
      ))}
      <Needles at={macFine} />
      {tip && (
        <div className="stone-tip" style={{ left: tip.x + 14, top: tip.y + 16 }}>
          <b>{tip.item.name}</b>
          <span>
            {KIND_NAME[tip.item.kind]}
            {tip.item.version ? ` ${tip.item.version}` : ""}
            {ENV(tip.item) && tip.item.layer === "packages" ? `, ${ENV(tip.item)}` : ""}
          </span>
          {fine && <span className="stone-tip-fine">{fineLabel(fine.get(tip.item.id) ?? 999, tip.item)}</span>}
        </div>
      )}
    </div>
  );
}

function fineLabel(f: number | null, i: Item) {
  if (f === null) return "Couldn’t be read to the end";
  if (f === 0) return "Base: runs code when loaded";
  const parts = i.parts.length || Number(i.meta.partCount ?? 0);
  return `${f} fine${parts > 1 ? `, across ${num(parts)} libraries` : ""}${i.model?.parameters ? `, ${params(i.model.parameters)} parameters` : ""}`;
}

// The reference needles an assayer compares a streak against, finest to base.
function Needles({ at }: { at?: number }) {
  return (
    <div className="needles">
      {at !== undefined && (
        <div className="needle-at" style={{ left: `calc(${needlePos(at) * 100}% * (6 / 7) + (100% / 14))` }}>
          <span>This Mac, {at}</span>
        </div>
      )}
      {STANDARDS.map((s) => (
        <div className="needle" key={s.name}>
          <svg width="100%" height="8" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden>
            <path d="M6 4.2 C 30 3.4, 70 4.8, 94 3.8" stroke={`url(#m-${s.metal})`} strokeWidth="4.2" strokeLinecap="round" fill="none" filter="url(#rub)" />
          </svg>
          <span className="engraved">{s.fine || "Base"}</span>
          <span className="needle-name">{s.fine ? s.name : "Runs code"}</span>
        </div>
      ))}
    </div>
  );
}
