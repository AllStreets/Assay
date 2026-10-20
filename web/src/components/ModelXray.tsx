import { useMemo, useState } from "react";
import type { Item, TensorGroup } from "../../../shared/types";
import { bytes, num, params } from "../format";

// A model drawn as a cross-section from its own tensor table: embeddings, one slice per
// layer, the output head. Each slice's height is its share of the parameters.
// Ollama stores weights as content-addressed blobs; say what the blob is.
function fileLabel(p: string) {
  const base = p.split("/").pop() ?? p;
  const m = base.match(/^sha256[-:]([0-9a-f]{64})$/);
  return m ? `Weights, blob sha256:${m[1].slice(0, 12)}` : base;
}

export function ModelXray({ item }: { item: Item }) {
  const m = item.model!;
  const [hover, setHover] = useState<TensorGroup | null>(null);
  const groups = useMemo(() => {
    const g = (m.groups ?? []).filter((x) => x.params > 0);
    // Collapse the many small top-level tensors (norms, rope tables) into one slice.
    const small = g.filter((x) => !/^layer \d+$/.test(x.name) && x.params / Math.max(1, m.parameters ?? 1) < 0.002);
    const rest = g.filter((x) => !small.includes(x));
    const misc = small.length ? [{ name: `${small.length} small tensors`, count: small.reduce((a, x) => a + x.count, 0), params: small.reduce((a, x) => a + x.params, 0) }] : [];
    return [...rest, ...misc];
  }, [m]);
  const total = groups.reduce((a, g) => a + g.params, 0) || 1;
  const layers = groups.filter((g) => /^layer \d+$/.test(g.name));
  const H = 360;
  let y = 0;
  const shown = hover ?? null;

  return (
    <div className="xray">
      {groups.length > 0 && (
        <div className="xray-plate">
          <svg viewBox={`0 0 260 ${H}`} className="xray-svg" role="img" aria-label={`Cross-section of ${item.name}: ${layers.length} layers between the embeddings and the output`}>
            <defs>
              <linearGradient id="slice" x1="0" x2="1"><stop offset="0" stopColor="#7A5A22" /><stop offset=".45" stopColor="#E8B04B" /><stop offset="1" stopColor="#8A6526" /></linearGradient>
              <linearGradient id="slice-edge" x1="0" x2="1"><stop offset="0" stopColor="#5E5850" /><stop offset=".5" stopColor="#B89A72" /><stop offset="1" stopColor="#5E5850" /></linearGradient>
            </defs>
            {groups.map((g) => {
              const h = Math.max(layers.length > 60 ? 1.5 : 2.5, (g.params / total) * H);
              const r = { y, h };
              y += h;
              const isLayer = /^layer \d+$/.test(g.name);
              return (
                <rect key={g.name} x={isLayer ? 40 : 20} width={isLayer ? 180 : 220} y={r.y} height={Math.max(1, r.h - (isLayer && r.h > 4 ? 1 : 0))}
                  fill={isLayer ? "url(#slice)" : "url(#slice-edge)"} opacity={hover && hover !== g ? 0.35 : 1}
                  onMouseEnter={() => setHover(g)} onMouseLeave={() => setHover(null)}>
                  <title>{`${g.name}: ${params(g.params)} parameters in ${g.count} tensors`}</title>
                </rect>
              );
            })}
          </svg>
          <div className="xray-key">
            <p className="xray-big">{params(m.parameters)}</p>
            <p className="muted">parameters in {num(m.tensorCount ?? 0)} tensors</p>
            <p className="xray-row"><span className="sw edge" />Embeddings and output</p>
            <p className="xray-row"><span className="sw gold" />{layers.length} transformer layers</p>
            <p className="xray-hover">{shown ? `${shown.name}: ${params(shown.params)} in ${shown.count} tensors` : "Hover a slice to read it"}</p>
          </div>
        </div>
      )}

      <p className="label">FILES</p>
      <ul className="mfiles">
        {m.files.map((f) => (
          <li key={f.path}>
            <div className="mf-head">
              <code>{fileLabel(f.path)}</code>
              <span className={`fmt fmt-${f.format}`}>{f.format}</span>
              <span className="muted">{bytes(f.sizeBytes)}</span>
            </div>
            {f.imports && (
              <ul className="imports">
                {f.imports.map((i) => (
                  <li key={`${i.module}.${i.name}`} className={`imp imp-${i.verdict}`}>
                    <code>{i.module}.{i.name}</code>
                    <span>{i.verdict === "dangerous" ? "can run code" : i.verdict === "unknown" ? "unrecognised" : "rebuilds tensors"}</span>
                  </li>
                ))}
              </ul>
            )}
            {f.format === "gguf" && <p className="muted mf-note">GGUF stores weights and metadata only. It has no way to carry code.</p>}
            {f.format === "safetensors" && <p className="muted mf-note">Safetensors stores tensors and a JSON header only. It has no way to carry code.</p>}
          </li>
        ))}
      </ul>

      {m.chatTemplate && (
        <details className="template">
          <summary>Chat template <span className="muted">{num(m.chatTemplate.length)} characters</span></summary>
          <pre>{m.chatTemplate}</pre>
        </details>
      )}
    </div>
  );
}
