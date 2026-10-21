import { useState } from "react";
import type { Item } from "../../../shared/types";
import { api } from "../api";
import { modelVendor, num } from "../format";
import { KindGlyph } from "./ui";

// The bench's small instruments, shared by every page.

// Clean share in parts per thousand: what share of an item's libraries has nothing
// published against it. "code" for a model that runs code when loaded.
export function Clean({ f, size = "s" }: { f: number | null; size?: "s" | "m" }) {
  const cls = f === null ? "unread" : f === 0 ? "code" : f < 900 ? "low" : f < 990 ? "mid" : "ok";
  return (
    <span className={`clean clean-${size} clean-${cls}`} title={f === null ? "Couldn’t be read" : f === 0 ? "Runs code when loaded" : `${f} of every 1,000 libraries clean`}>
      {f === null ? "?" : f === 0 ? "code" : <>{f}<i>‰</i></>}
    </span>
  );
}

// Every library inside an item as one cell; the ones with published advisories are lit.
export function LibStrip({ total, bad, max = 420 }: { total: number; bad: number; max?: number }) {
  if (total < 2) return null;
  // Very large apps are sampled down so the strip stays readable; lit cells are kept.
  const step = total > max ? Math.ceil(total / max) : 1;
  const cells = Math.ceil(total / step);
  const lit = Math.min(cells, Math.max(bad ? 1 : 0, Math.round(bad / step)));
  return (
    <span className={`libstrip${cells > 160 ? " dense" : ""}`} role="img" aria-label={`${num(total)} libraries, ${num(bad)} with published advisories`}>
      {Array.from({ length: cells }, (_, k) => <i key={k} className={k < lit ? "x" : undefined} />)}
    </span>
  );
}

// A meter of ticks: the share of a layer that's flagged, read right to left.
export function Ticks({ total, flagged, n = 40 }: { total: number; flagged: number; n?: number }) {
  const x = flagged ? Math.max(1, Math.round((flagged / Math.max(1, total)) * n)) : 0;
  return <span className="ticks" aria-hidden>{Array.from({ length: n }, (_, k) => <i key={k} className={k >= n - x ? "x" : undefined} />)}</span>;
}

// An item's own face: an app's icon, a model maker's logo, or a drawn glyph.
export function ItemLogo({ item, size = 28 }: { item: Item; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (item.kind === "app" && item.path && !broken) return <img className="logo-img" src={api.icon(item.path)} width={size} height={size} alt="" loading="lazy" onError={() => setBroken(true)} />;
  const v = modelVendor(item);
  if (v) return <span className="vendor" style={{ width: size, height: size }}><img src={`/model-logos/${v}.svg`} alt="" /></span>;
  return <KindGlyph kind={item.kind} size={size} />;
}
