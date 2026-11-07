"use client";

import { useEffect, useRef, type ComponentProps, type ReactNode } from "react";
import { X } from "lucide-react";
import { iniciais } from "@/lib/domain";

export const cx = (...c: (string | false | null | undefined)[]) =>
  c.filter(Boolean).join(" ");

const BTN = {
  primary: "bg-ink text-white hover:bg-ink-2 shadow-sm",
  gold: "bg-gold text-white hover:bg-gold-ink shadow-sm",
  outline: "border border-line bg-card text-ink hover:border-ink/30",
  ghost: "text-muted hover:bg-ink/5 hover:text-ink",
  danger: "bg-danger-soft text-danger hover:bg-danger hover:text-white",
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & {
  variant?: keyof typeof BTN;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <button
      type="button"
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-[background,color,border,transform] active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
        size === "sm" && "h-8 px-3 text-xs",
        size === "md" && "h-10 px-4 text-sm",
        size === "lg" && "h-12 px-6 text-base",
        BTN[variant],
        className,
      )}
      {...props}
    />
  );
}

// text-base (16px): abaixo disso o Safari do iPhone dá zoom no campo e não volta
const FIELD =
  "w-full rounded-xl border border-line bg-card px-3 text-base text-ink shadow-[inset_0_1px_1px_rgb(22_19_15/0.03)] placeholder:text-muted/70 transition focus:border-gold focus:outline-none focus:ring-4 focus:ring-gold/15 disabled:bg-paper disabled:text-muted";

export const Input = ({ className, ...p }: ComponentProps<"input">) => (
  <input className={cx(FIELD, "h-11", className)} {...p} />
);
export const Textarea = ({ className, ...p }: ComponentProps<"textarea">) => (
  <textarea className={cx(FIELD, "py-2.5", className)} rows={2} {...p} />
);
export const Select = ({ className, ...p }: ComponentProps<"select">) => (
  <select className={cx(FIELD, "h-11 cursor-pointer pr-8", className)} {...p} />
);

export function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx("flex flex-col gap-1.5", className)}>
      <span className="text-xs font-semibold tracking-wide text-muted uppercase">
        {label}
      </span>
      {children}
    </label>
  );
}

export const Card = ({ className, ...p }: ComponentProps<"div">) => (
  <div
    className={cx(
      "rounded-2xl border border-line/80 bg-card shadow-card",
      className,
    )}
    {...p}
  />
);

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "gold" | "danger" | "ok";
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap",
        tone === "neutral" && "bg-ink/5 text-muted",
        tone === "gold" && "bg-gold-soft text-gold-ink",
        tone === "danger" && "bg-danger-soft text-danger",
        tone === "ok" && "bg-ok-soft text-ok",
      )}
    >
      {children}
    </span>
  );
}

export function Avatar({
  nome,
  active,
  dark,
  size = 40,
}: {
  nome: string;
  active?: boolean;
  dark?: boolean;
  size?: number;
}) {
  return (
    <span
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      className={cx(
        "grid shrink-0 place-items-center rounded-full font-bold transition",
        active
          ? "bg-gold text-white"
          : dark
            ? "bg-side-active text-gold-bright"
            : "bg-gold-soft text-gold-ink",
      )}
    >
      {iniciais(nome)}
    </span>
  );
}

export function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    // relative: o input sr-only (absolute) fica preso ao label; sem isso o foco rola o <dialog> e o layout quebra
    <label
      className={cx(
        "relative inline-flex cursor-pointer items-center gap-3",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <input
        type="checkbox"
        role="switch"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="relative h-6 w-11 rounded-full bg-line transition peer-checked:bg-ok peer-focus-visible:ring-4 peer-focus-visible:ring-gold/25 after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5" />
      <span className="text-sm font-medium">{label}</span>
    </label>
  );
}

export function Tabs<T extends string>({
  value,
  onChange,
  items,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { value: T; label: string }[];
}) {
  return (
    <div
      role="tablist"
      className="flex w-full gap-1 overflow-x-auto rounded-2xl border border-line/80 bg-card p-1 shadow-card [scrollbar-width:none] sm:inline-flex sm:w-auto"
    >
      {items.map((it) => (
        <button
          key={it.value}
          role="tab"
          type="button"
          aria-selected={value === it.value}
          onClick={() => onChange(it.value)}
          className={cx(
            "h-9 flex-1 shrink-0 rounded-xl px-3.5 text-sm font-semibold whitespace-nowrap transition active:scale-[0.97] sm:flex-none sm:px-4",
            value === it.value
              ? "bg-ink text-white shadow-sm"
              : "text-muted hover:bg-ink/5 hover:text-ink",
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cx(
        // overflow-clip (não hidden): o dialog nunca é rolado por foco/scrollIntoView
        "mx-auto mt-auto mb-0 max-h-[92dvh] w-full max-w-none overflow-clip rounded-t-[1.75rem] bg-card p-0 text-ink shadow-2xl",
        "sm:m-auto sm:w-[calc(100%-2rem)] sm:rounded-3xl",
        wide ? "sm:max-w-3xl" : "sm:max-w-md",
      )}
    >
      {open && (
        <div className="flex max-h-[92dvh] flex-col">
          <header className="flex shrink-0 items-center justify-between gap-4 border-b border-line px-5 py-3.5 sm:px-6 sm:py-4">
            <h2 className="min-w-0 truncate font-display text-2xl font-bold">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="grid size-9 place-items-center rounded-full text-muted transition hover:bg-ink/5 hover:text-ink"
            >
              <X size={18} />
            </button>
          </header>
          <div className="overflow-y-auto overscroll-contain p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:p-6">
            {children}
          </div>
        </div>
      )}
    </dialog>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-3 sm:mb-6">
      <div>
        <h1 className="font-display text-[1.75rem] leading-tight font-bold sm:text-[1.875rem]">
          {title}
        </h1>
        {subtitle && <p className="mt-2 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

export const Empty = ({ children }: { children: ReactNode }) => (
  <div className="rounded-2xl border border-dashed border-line bg-card/50 px-6 py-12 text-center text-sm text-muted">
    {children}
  </div>
);

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card className="min-w-0 p-3.5 sm:p-4">
      <div className="truncate text-[11px] font-semibold tracking-wide text-muted uppercase sm:text-xs">
        {label}
      </div>
      <div className="num mt-1 font-display text-2xl leading-tight font-bold break-words sm:text-3xl">
        {value}
      </div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </Card>
  );
}

export function Tabela({
  head,
  rows,
  foot,
}: {
  head: string[];
  rows: ReactNode[][];
  foot?: ReactNode[];
}) {
  return (
    <Card className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-xs tracking-wide text-muted uppercase">
            {head.map((h, i) => (
              <th
                key={h}
                className={cx(
                  "px-4 py-3 font-semibold whitespace-nowrap sm:px-5",
                  i === 0 ? "text-left" : "text-right",
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-paper/60">
              {r.map((c, j) => (
                <td
                  key={j}
                  className={cx(
                    "px-4 py-3 sm:px-5",
                    j === 0
                      ? "font-semibold"
                      : "num text-right whitespace-nowrap",
                  )}
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {foot && (
          <tfoot>
            <tr className="border-t-2 border-ink/10 bg-paper font-bold">
              {foot.map((c, j) => (
                <td
                  key={j}
                  className={cx(
                    "px-4 py-3 sm:px-5",
                    j > 0 && "num text-right whitespace-nowrap",
                  )}
                >
                  {c}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </Card>
  );
}
