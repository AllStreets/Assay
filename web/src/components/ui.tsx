// The small set of controls every Assay page is built from.
import { AppWindow, Beer, Container, Gem, Package, Puzzle, SquareCode, type LucideIcon } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import type { Severity } from "../../../shared/types";
import { SEVERITY_NAME } from "../format";

type Variant = "gold" | "ghost" | "danger" | "quiet";

export function Button({ variant = "ghost", icon: Icon, busy, children, ...rest }: { variant?: Variant; icon?: LucideIcon; busy?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...rest} className={`btn btn-${variant}${rest.className ? ` ${rest.className}` : ""}`} disabled={rest.disabled || busy} aria-busy={busy || undefined}>
      {Icon && <Icon size={15} aria-hidden className={busy ? "spin" : undefined} />}
      {children}
    </button>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={checked} aria-label={label} className="toggle" onClick={() => onChange(!checked)}>
      <span className="toggle-knob" />
    </button>
  );
}

export function Sev({ s }: { s: Severity }) {
  return <span className={`sev sev-${s}`}>{SEVERITY_NAME[s]}</span>;
}

export function Stamp({ items }: { items: (string | number | false | null | undefined)[] }) {
  return (
    <p className="stamp" aria-hidden>
      {items.filter((x) => x !== false && x !== null && x !== undefined && x !== "").map((x, i) => <span key={i}>{x}</span>)}
    </p>
  );
}

export function PageHead({ title, lede, stamp, actions }: { title: string; lede?: ReactNode; stamp?: (string | number | false | null | undefined)[]; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        {stamp && <Stamp items={stamp} />}
        <h1 className="page-title">{title}</h1>
        {lede && <p className="page-lede">{lede}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function Empty({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon size={22} aria-hidden />
      <p className="empty-title">{title}</p>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}

export function Dialog({ open, title, children, onClose, actions }: { open: boolean; title: string; children: ReactNode; onClose: () => void; actions: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="dialog" aria-labelledby={id} onClose={onClose} onCancel={onClose}>
      <h2 id={id} className="dialog-title">{title}</h2>
      <div className="dialog-body">{children}</div>
      <div className="dialog-actions">{actions}</div>
    </dialog>
  );
}

const GLYPH: Record<string, LucideIcon> = {
  "ollama-model": Gem, "hf-model": Gem, "model-file": Gem, "browser-extension": Puzzle, "editor-extension": SquareCode,
  brew: Beer, "npm-global": Package, pip: Package, "docker-image": Container, app: AppWindow,
};

export function KindGlyph({ kind, size = 36 }: { kind: string; size?: number }) {
  const Icon = GLYPH[kind] ?? Package;
  return (
    <span className={`glyph${kind.includes("model") ? " glyph-model" : ""}`} style={{ width: size, height: size }} aria-hidden>
      <Icon strokeWidth={1.6} />
    </span>
  );
}
