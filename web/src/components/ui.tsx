// The small set of controls every Assay page is built from.
import { AppWindow, Beer, Container, Gem, LoaderCircle, Package, Puzzle, SquareCode, type LucideIcon } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import type { Severity } from "../../../shared/types";
import { SEVERITY_NAME } from "../format";

type Variant = "gold" | "ghost" | "danger" | "quiet";

export function Button({ variant = "ghost", icon: Icon, busy, children, ...rest }: { variant?: Variant; icon?: LucideIcon; busy?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...rest} className={`btn btn-${variant}${rest.className ? ` ${rest.className}` : ""}`} disabled={rest.disabled || busy} aria-busy={busy || undefined}>
      {busy ? <LoaderCircle size={15} aria-hidden className="spin" /> : Icon && <Icon size={15} aria-hidden />}
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

// Severity as a small cut shape and a word: filled for the two that need action now.
export function Sev({ s }: { s: Severity }) {
  return <span className={`sev sev-${s}`}><i aria-hidden />{SEVERITY_NAME[s]}</span>;
}

export function PageHead({ title, lede, meta, actions }: { title: string; lede?: ReactNode; meta?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1 className="page-title">{title}</h1>
        {meta && <p className="page-meta">{meta}</p>}
        {lede && <p className="page-lede">{lede}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

// The marks an assay office punches into metal it has tested: what it is, the verdict, and
// which assay it was. Here they head every certificate.
export function Hallmarks({ kind, clear, assay }: { kind: string; clear: boolean; assay: number }) {
  return (
    <div className="hallmarks" aria-hidden>
      <span className="punch punch-shield"><KindGlyph kind={kind} size={18} bare /></span>
      <span className="punch punch-oval">
        {clear ? <svg viewBox="0 0 12 12" width="11" height="11"><circle cx="6" cy="6" r="4.2" fill="currentColor" /></svg>
          : <svg viewBox="0 0 12 12" width="12" height="12"><path d="M6 .8 11.2 6 6 11.2.8 6Z" fill="currentColor" /></svg>}
      </span>
      <span className="punch punch-square">{assay}</span>
    </div>
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

export function KindGlyph({ kind, size = 36, bare }: { kind: string; size?: number; bare?: boolean }) {
  const Icon = GLYPH[kind] ?? Package;
  if (bare) return <Icon size={size} strokeWidth={1.7} aria-hidden />;
  return (
    <span className={`glyph${kind.includes("model") ? " glyph-model" : ""}`} style={{ width: size, height: size }} aria-hidden>
      <Icon strokeWidth={1.6} />
    </span>
  );
}
