"use client";

import { useId } from "react";

/** A row in a definition list: label on the left from sm, stacked on mobile. */
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-2.5 sm:grid sm:grid-cols-[10rem_1fr] sm:gap-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-0.5 min-w-0 text-sm break-words text-ink sm:mt-0">{children}</dd>
    </div>
  );
}

export function FieldList({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <dl className={`divide-y divide-rule border-y border-rule ${className}`}>{children}</dl>;
}

export function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-muted">{children}</span>;
}

export function Mono({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span className="font-mono text-[13px] break-words" title={title}>
      {children}
    </span>
  );
}

/** A thin horizontal bar showing a value relative to the largest. */
export function Bar({ value, max }: { value: number; max: number }) {
  return (
    <span className="mt-1.5 block h-1 w-full rounded-full bg-contour-soft" aria-hidden="true">
      <span className="block h-full rounded-full bg-contour" style={{ width: `${max ? Math.max((value / max) * 100, 1) : 0}%` }} />
    </span>
  );
}

export function ExternalLink({ href, children, className = "" }: { href: string; children?: React.ReactNode; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`text-ink underline decoration-rule underline-offset-2 hover:text-contour hover:decoration-contour ${className}`}
    >
      {children ?? href}
    </a>
  );
}

/** A URL shown as a link, monospace, truncated to one line. */
export function UrlLink({ href, label }: { href: string; label?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={href}
      className="block truncate font-mono text-[13px] text-ink hover:text-contour hover:underline"
    >
      {label ?? href}
    </a>
  );
}

export function Notice({ children, tone = "alert" }: { children: React.ReactNode; tone?: "alert" | "muted" }) {
  return (
    <p className={`border-l-2 pl-3 text-sm ${tone === "alert" ? "border-alert text-ink" : "border-rule text-muted"}`}>
      {children}
    </p>
  );
}

export function ValueList({ values, empty = "None found", mono = false }: { values: readonly string[]; empty?: string; mono?: boolean }) {
  if (values.length === 0) return <Muted>{empty}</Muted>;
  return (
    <ul className="space-y-0.5">
      {values.map((value, index) => (
        <li key={`${value}-${index}`} className={mono ? "font-mono text-[13px] break-words" : "break-words"}>
          {value}
        </li>
      ))}
    </ul>
  );
}

/**
 * A segmented control: a radio group with a visually hidden legend. Native
 * radios give arrow-key navigation; the visible chip shows focus and state.
 */
export function Segmented<T extends string | number>({
  legend,
  options,
  value,
  onChange,
  size = "md",
}: {
  legend: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
}) {
  const name = useId();
  return (
    <fieldset className="min-w-0">
      <legend className="sr-only">{legend}</legend>
      <div className="max-w-full overflow-x-auto p-1">
        <div className="inline-flex rounded-md border border-rule bg-sheet p-0.5">
          {options.map((option) => (
            <label key={String(option.value)} className="relative cursor-pointer">
              <input
                type="radio"
                name={name}
                value={String(option.value)}
                checked={option.value === value}
                onChange={() => onChange(option.value)}
                className="peer sr-only"
              />
              <span
                className={`block rounded-[5px] whitespace-nowrap text-ink transition-colors hover:text-contour peer-checked:bg-ink peer-checked:text-sheet peer-checked:hover:text-sheet peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-contour ${
                  size === "sm" ? "px-2.5 py-1 text-[13px]" : "px-3.5 py-1.5 text-sm"
                }`}
              >
                {option.label}
              </span>
            </label>
          ))}
        </div>
      </div>
    </fieldset>
  );
}

export function percent(value: number | null): string {
  return value === null ? "needs 2+ samples" : `${Math.round(value * 100)}%`;
}

export function day(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "n/a";
}
