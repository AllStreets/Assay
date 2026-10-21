import type { Metal } from "../format";

// The assayer's materials, drawn once and referenced everywhere: a rough edge for streaks
// rubbed on the stone, and a gradient for each metal a streak can leave.

const GRADIENTS: Record<Metal, [string, string, string]> = {
  fine: ["#f8e7b0", "#dbb764", "#9f7c35"],
  gold: ["#f1dc9f", "#cfab5c", "#94733a"],
  pale: ["#ecdcb3", "#c4ab78", "#8a764d"],
  rose: ["#ebb393", "#c47e5c", "#8a4e35"],
  copper: ["#e48a5f", "#b8552f", "#7a3018"],
  base: ["#ff8a68", "#e0573a", "#9c2c16"],
  unread: ["#9aa0a6", "#6b7076", "#44484d"],
  raw: ["#dcd8d0", "#a8a39b", "#6c6861"],
};

export function MetalDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden focusable="false">
      <defs>
        {/* A streak's edge breaks up along its length, the way metal catches on stone. */}
        <filter id="rub" x="-5%" y="-80%" width="110%" height="260%">
          <feTurbulence type="fractalNoise" baseFrequency="0.05 0.9" numOctaves="2" seed="8" result="t" />
          <feDisplacementMap in="SourceGraphic" in2="t" scale="4" />
        </filter>
        <filter id="rough" x="-5%" y="-60%" width="110%" height="220%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9 0.25" numOctaves="2" seed="3" />
          <feDisplacementMap in="SourceGraphic" scale="3" />
        </filter>
        {(Object.keys(GRADIENTS) as Metal[]).map((m) => (
          <linearGradient key={m} id={`m-${m}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={GRADIENTS[m][0]} />
            <stop offset="0.5" stopColor={GRADIENTS[m][1]} />
            <stop offset="1" stopColor={GRADIENTS[m][2]} />
          </linearGradient>
        ))}
      </defs>
    </svg>
  );
}

// A short rubbed mark in a metal: the swatch that stands for a verdict in lists.
export function Streak({ metal, width = 34, height = 8 }: { metal: Metal; width?: number; height?: number }) {
  const y = height / 2;
  return (
    <svg className="streak-swatch" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <path d={`M3 ${y + 0.6} C ${width * 0.35} ${y - 1.2}, ${width * 0.65} ${y + 1.2}, ${width - 3} ${y - 0.4}`} stroke={`url(#m-${metal})`} strokeWidth={height * 0.5} strokeLinecap="round" fill="none" filter="url(#rub)" />
    </svg>
  );
}

// A hallmark punch: struck into the surface, carrying a fineness or a mark.
export function Punch({ children, shape = "oval", size = "m", tone }: { children: React.ReactNode; shape?: "oval" | "shield" | "square"; size?: "s" | "m" | "l"; tone?: "base" }) {
  return <span className={`punch punch-${shape} punch-${size}${tone ? ` punch-${tone}` : ""}`}>{children}</span>;
}
