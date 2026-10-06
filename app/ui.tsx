"use client";

export type Group = {
  pattern: string;
  count: number;
  urls: string[];
  share?: number;
  lastmodNewest?: string | null;
  lastmodOldest?: string | null;
  lastmodCoverage?: number;
  placeholders?: import("@/lib/patterns").Placeholder[];
};

export function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${formatNumber(count)} ${count === 1 ? singular : pluralForm}`;
}

/** URLs on the site's origin arrive as paths; everything else is absolute. */
export function toAbsolute(url: string, origin: string): string {
  return url.startsWith("/") ? origin + url : url;
}

export function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy approach.
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}

export function Icon({ children, className = "size-4" }: { children: React.ReactNode; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {children}
    </svg>
  );
}

export const CopyIcon = () => (
  <Icon>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V6a2 2 0 0 1 2-2h8" />
  </Icon>
);

export const CheckIcon = () => (
  <Icon>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Icon>
);

export const ExtractIcon = () => (
  <Icon>
    <path d="M6 3.5h8l4 4v13H6z" />
    <path d="M9.5 12h5M9.5 15.5h5" />
  </Icon>
);

export const DownloadIcon = () => (
  <Icon>
    <path d="M12 4v11" />
    <path d="M7.5 10.5L12 15l4.5-4.5" />
    <path d="M5 19h14" />
  </Icon>
);

export const ChevronIcon = ({ open }: { open: boolean }) => (
  <Icon className={`size-4 shrink-0 transition-transform duration-150 ${open ? "rotate-90" : ""}`}>
    <path d="M9 6l6 6-6 6" />
  </Icon>
);

export const secondaryButton =
  "inline-flex h-11 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-rule bg-transparent px-3 text-sm sm:px-4 font-medium text-ink transition-colors hover:border-contour hover:text-contour disabled:cursor-not-allowed disabled:text-muted disabled:hover:border-rule sm:flex-none";

/** Saves text as a file download. Works on mobile Chrome. */
export function downloadText(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

/** Builds a CSV (header + rows, every cell quoted) and saves it as a download. */
export function downloadCsv(filename: string, header: string[], rows: string[][]) {
  const lines = [header.join(","), ...rows.map((row) => row.map(csvCell).join(","))];
  // The byte order mark makes Excel read the file as UTF-8, so dashes and accents survive.
  const blob = new Blob(["\uFEFF" + lines.join("\r\n") + "\r\n"], { type: "text/csv;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}
