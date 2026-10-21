import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Layer, Severity } from "../../../shared/types";
import { LAYER_COLOR, LAYER_NAME, num } from "../format";

export interface Mark {
  id: string;
  layer: Layer;
  severity: Severity;
  label: string;
}

interface Props {
  counts: Record<Layer, { items: number; parts: number }>;
  marks: Mark[];
  // While an assay runs: the layer being read now. Undefined when finished.
  drilling?: Layer;
  onMark?: (id: string) => void;
  selected?: string;
  // Before the first assay: the layers drawn as an outline, nothing drilled.
  idle?: boolean;
}

const STRATA: Layer[] = ["apps", "extensions", "packages", "containers"];
const ORDER: Layer[] = ["apps", "models", "extensions", "packages", "containers"];
const X = 36;
const W = 210;
const TOP = 30;
const TOTAL = 560;

function seeded(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) % 10000) / 10000;
}

function edge(y: number, seed: number, flat: boolean) {
  const pts: [number, number][] = [];
  for (let i = 0; i <= 10; i++) pts.push([X + (W * i) / 10, flat ? y : y + Math.sin(i * 1.3 + seed * 2.1) * 4.5]);
  return pts;
}

const reduce = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function CoreSample({ counts, marks, drilling, onMark, selected, idle }: Props) {
  // Band heights follow the square root of what was found, so a huge layer can't crush the rest.
  const bands = useMemo(() => {
    const weights = STRATA.map((l) => Math.sqrt(Math.max(1, counts[l].items)) + 4);
    const sum = weights.reduce((a, b) => a + b, 0);
    let y = TOP;
    return STRATA.map((l, i) => {
      const h = Math.max(64, (weights[i] / sum) * TOTAL);
      const b = { layer: l, y, h };
      y += h;
      return b;
    });
  }, [counts]);
  const bottom = bands.at(-1)!.y + bands.at(-1)!.h;

  // Depth of the drill: follows the layer being read, then sweeps to the bottom once.
  const [depth, setDepth] = useState(reduce() && !idle ? bottom : 0);
  useEffect(() => {
    if (idle) return setDepth(TOP - 10);
    if (reduce()) return setDepth(bottom);
    const target = drilling
      ? (() => {
          const idx = ORDER.indexOf(drilling);
          const band = bands.find((b) => b.layer === drilling) ?? bands[Math.min(bands.length - 1, Math.max(0, idx - 1))];
          return band.y + band.h * 0.85;
        })()
      : bottom;
    let raf = 0;
    const from = depth;
    const start = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / (drilling ? 900 : 1300));
      setDepth(from + (target - from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const done = setTimeout(() => setDepth(target), 1600);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(done);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drilling, bottom, idle]);

  const vein = `M${X - 4} ${TOP + 40} C ${X + 90} ${TOP + bottom * 0.28}, ${X + 30} ${TOP + bottom * 0.5}, ${X + 140} ${TOP + bottom * 0.66} S ${X + 190} ${bottom - 60}, ${X + W + 4} ${bottom - 20}`;

  // Marks sit inside their own layer; model marks sit on the vein itself.
  const veinRef = useRef<SVGPathElement>(null);
  const [veinPts, setVeinPts] = useState<[number, number][]>([]);
  useLayoutEffect(() => {
    const p = veinRef.current;
    if (!p) return setVeinPts([]);
    const len = p.getTotalLength();
    setVeinPts(Array.from({ length: 101 }, (_, i) => {
      const pt = p.getPointAtLength((len * i) / 100);
      return [pt.x, pt.y];
    }));
  }, [vein]);
  const placed = useMemo(() => {
    // Each mark takes the best of a few seeded spots, the one farthest from marks already
    // placed, so a crowded layer spreads out instead of stacking. Models go last, on top.
    const out: (Mark & { x: number; y: number })[] = [];
    const ordered = [...marks.filter((m) => m.layer !== "models"), ...marks.filter((m) => m.layer === "models")];
    for (const m of ordered) {
      const rand = seeded(m.id);
      let best: [number, number] = [0, 0];
      let bestD = -1;
      for (let k = 0; k < 12; k++) {
        let c: [number, number];
        if (m.layer === "models") {
          c = veinPts[Math.round((0.2 + rand() * 0.6) * 100)] ?? [X + W / 2, TOP + (bottom - TOP) / 2];
        } else {
          const b = bands.find((x) => x.layer === m.layer) ?? bands[0];
          c = [X + 18 + rand() * (W - 36), b.y + 16 + rand() * Math.max(10, b.h - 32)];
        }
        const d = out.reduce((min, o) => Math.min(min, Math.hypot(o.x - c[0], o.y - c[1])), Infinity);
        if (d > bestD) { bestD = d; best = c; }
        if (d > 26) break;
      }
      out.push({ ...m, x: best[0], y: best[1] });
    }
    return out;
  }, [marks, bands, bottom, veinPts]);

  const colorFor = (s: Severity) => (s === "critical" || s === "high" ? "#E0603F" : s === "medium" ? "#E89A4B" : "#B8AE9E");

  return (
    <svg className="core" viewBox={`0 0 520 ${bottom + 90}`} role="img" aria-label="A core sample of this Mac: software in layers, with AI models as a vein through them and marks where something needs attention">
      <defs>
        <clipPath id="drill"><rect x={X - 2} y={TOP - 10} width={W + 4} height={Math.max(0, depth - TOP + 10)} /></clipPath>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="5" /></filter>
        <pattern id="grain" width="6" height="6" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r=".7" fill="#000" fillOpacity=".22" /></pattern>
        <linearGradient id="sheen" x1="0" x2="1"><stop offset="0" stopColor="#000" stopOpacity=".25" /><stop offset=".35" stopColor="#fff" stopOpacity=".06" /><stop offset="1" stopColor="#000" stopOpacity=".3" /></linearGradient>
      </defs>
      <rect x={X - 7} y={TOP - 13} width={W + 14} height={bottom - TOP + 26} rx={14} fill="none" stroke="#34302B" />
      {idle && (
        <g className="core-ghost">
          {bands.slice(1).map((b, i) => (
            <path key={b.layer} d={"M" + edge(b.y, i + 1, false).map((p) => p.join(" ")).join(" L")} stroke="#34302B" strokeDasharray="4 5" fill="none" />
          ))}
          {bands.map((b) => (
            <text key={b.layer} x={X + W + 32} y={b.y + 25} className="core-name" style={{ fill: "#5E5850" }}>{LAYER_NAME[b.layer]}</text>
          ))}
          <path d={vein} stroke="#E8B04B" strokeOpacity={0.22} strokeWidth={2} strokeDasharray="3 6" fill="none" />
        </g>
      )}
      <g clipPath="url(#drill)">
        {bands.map((b, i) => {
          const top = edge(b.y, i, i === 0);
          const bot = edge(b.y + b.h, i + 1, i === bands.length - 1).reverse();
          const d = "M" + [...top, ...bot].map((p) => p.join(" ")).join(" L") + " Z";
          return (
            <g key={b.layer}>
              <path d={d} fill={LAYER_COLOR[b.layer]} />
              <path d={d} fill="url(#grain)" />
            </g>
          );
        })}
        <rect x={X} y={TOP} width={W} height={bottom - TOP} fill="url(#sheen)" />
        {counts.models.items > 0 && (
          <>
            <path d={vein} stroke="#E8B04B" strokeWidth={12} fill="none" opacity={0.5} filter="url(#glow)" />
            <path ref={veinRef} d={vein} stroke="#F3CB7A" strokeWidth={5} fill="none" strokeLinecap="round" />
          </>
        )}
      </g>
      {depth < bottom - 1 && <line x1={X - 14} x2={X + W + 14} y1={depth} y2={depth} stroke="#EFE6D8" strokeWidth={1.5} opacity={0.85} />}

      {bands.map((b) => {
        if (depth < b.y + 14) return null;
        const c = counts[b.layer];
        const lx = X + W + 32;
        return (
          <g key={b.layer} className="core-label">
            <line x1={X + W + 9} x2={lx - 8} y1={b.y + 20} y2={b.y + 20} stroke="#34302B" />
            <text x={lx} y={b.y + 25} className="core-name">{LAYER_NAME[b.layer]}</text>
            <text x={lx} y={b.y + 50} className="core-count">{num(c.items)}</text>
            <text x={lx} y={b.y + 72} className="core-sub">{c.parts ? `${num(c.parts)} libraries inside` : "items"}</text>
          </g>
        );
      })}
      {counts.models.items > 0 && depth > TOP + 120 && (
        <g className="core-label">
          <line x1={X + W - 12} x2={X + W - 12} y1={bottom - 26} y2={bottom + 26} stroke="#E8B04B" strokeOpacity={0.5} />
          <text x={X} y={bottom + 44} className="core-name" style={{ fill: "#E8B04B" }}>AI models, a vein through every layer</text>
          <text x={X} y={bottom + 68} className="core-sub">{num(counts.models.items)} models</text>
        </g>
      )}

      {!drilling && placed.map((m) => (
        <g key={m.id} className={`mark${m.severity === "critical" || m.severity === "high" ? " hot" : ""}${selected === m.id ? " on" : ""}`}
          onClick={() => onMark?.(m.id)} role="button" tabIndex={0} aria-label={m.label}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onMark?.(m.id)}>
          <circle cx={m.x} cy={m.y} r={12} fill={colorFor(m.severity)} opacity={0.35} filter="url(#glow)" />
          {m.layer === "models" && <circle cx={m.x} cy={m.y} r={13} fill="none" stroke="#EFE6D8" strokeOpacity={0.7} strokeWidth={1.2} />}
          <path d={`M${m.x} ${m.y - 7.5} L${m.x + 7.5} ${m.y} L${m.x} ${m.y + 7.5} L${m.x - 7.5} ${m.y} Z`} fill={selected === m.id ? "#EFE6D8" : colorFor(m.severity)} stroke="#121110" strokeWidth={1.5} />
          <title>{m.label}</title>
        </g>
      ))}
    </svg>
  );
}
