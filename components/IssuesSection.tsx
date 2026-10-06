"use client";

import type { BlockedPage, Issue, Severity } from "@/lib/issues";
import { Muted, UrlLink } from "./bits";

const SEVERITY_STYLE: Record<Severity, string> = {
  high: "text-alert",
  medium: "text-ink",
  low: "text-muted",
};

const SEVERITY_LABEL: Record<Severity, string> = { high: "High", medium: "Medium", low: "Low" };

export function IssueList({ issues }: { issues: readonly Issue[] }) {
  return (
    <ul className="divide-y divide-rule border-y border-rule">
      {issues.map((issue) => (
        <li key={issue.id} className="py-3">
          <p className={`text-sm font-medium ${SEVERITY_STYLE[issue.severity]}`}>
            {issue.title} <span className="font-normal text-muted">({issue.severity})</span>
          </p>
          <p className="mt-1 max-w-[60ch] text-sm text-ink">{issue.explanation}</p>
          {issue.patterns.length > 0 && (
            <p className="mt-1 text-sm text-muted">
              Patterns: <span className="font-mono text-[13px] break-words">{issue.patterns.join(", ")}</span>
            </p>
          )}
          {issue.examples.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {issue.examples.map((url) => (
                <li key={url}>
                  <UrlLink href={url} />
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

export function IssuesSection({ issues, blocked }: { issues: readonly Issue[]; blocked: readonly BlockedPage[] }) {
  return (
    <section aria-labelledby="issues-heading" className="mt-4">
      <h2 id="issues-heading" className="sr-only">
        Issues
      </h2>
      <p className="max-w-[52ch] text-sm text-muted">Problems found on the studied pages and in the site checks, most serious first. Red ones matter most.</p>
      {issues.length === 0 && <p className="mt-4 text-sm text-muted">No issues found in the sampled pages.</p>}
      {(["high", "medium", "low"] as const).map((severity) => {
        const items = issues.filter((issue) => issue.severity === severity);
        if (items.length === 0) return null;
        return (
          <div key={severity} className="mt-6">
            <h3 className={`text-base font-medium ${SEVERITY_STYLE[severity]}`}>
              {SEVERITY_LABEL[severity]} <Muted>({items.length})</Muted>
            </h3>
            <div className="mt-2">
              <IssueList issues={items} />
            </div>
          </div>
        );
      })}
      {blocked.length > 0 && (
        <div className="mt-6">
          <h3 className="text-base font-medium text-ink">
            Blocked by bot protection <Muted>({blocked.length})</Muted>
          </h3>
          <p className="mt-1 max-w-[60ch] text-sm text-muted">
            Not counted as site issues. Open these in a browser with view-source: to study them manually.
          </p>
          <ul className="mt-2 space-y-0.5">
            {blocked.map((page) => (
              <li key={page.url}>
                <UrlLink href={page.url} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
