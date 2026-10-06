export type PlaceholderKind =
  | "date"
  | "year"
  | "number"
  | "id"
  | "page number"
  | "slug"
  | "slug with date"
  | "mixed";

export type Placeholder = {
  /** Segment index in the path (0 = first segment). */
  position: number;
  kind: PlaceholderKind;
  examples: string[];
};

export type PatternGroup = {
  pattern: string;
  count: number;
  urls: string[];
  /** Percent of all URLs, one decimal. */
  share: number;
  lastmodNewest: string | null;
  lastmodOldest: string | null;
  /** Percent of the group's URLs that have a lastmod. */
  lastmodCoverage: number;
  placeholders: Placeholder[];
};

const MAX_DISTINCT_LITERALS = 6;
const MAX_LITERAL_LENGTH = 40;
const MAX_SINGLE_SEGMENT_WORDS = 3;

function segmentsOf(url: string): string[] {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url.split(/[?#]/)[0] ?? "";
  }
  return pathname.split("/").filter((segment) => segment.length > 0);
}

function looksVariable(segment: string): boolean {
  return /\d/.test(segment) || segment.length > MAX_LITERAL_LENGTH;
}

function wordCount(segment: string): number {
  return segment.split("-").filter((word) => word.length > 0).length;
}

/**
 * Groups URLs into path templates, e.g. /predictions/arsenal-vs-chelsea
 * becomes /predictions/*. Returns groups sorted by size, largest first.
 */
export function groupByPattern(urls: string[], lastmod?: ReadonlyMap<string, string>): PatternGroup[] {
  const parsed = urls.map((url) => ({ url, segments: segmentsOf(url) }));

  // Sections that have pages beneath them, e.g. "blog" when /blog/x exists.
  const sectionsWithChildren = new Set<string>();
  for (const { segments } of parsed) {
    if (segments.length > 1) sectionsWithChildren.add(segments[0]);
  }

  // Resolve the first segment, then bucket URLs by shape:
  // first segment + segment count.
  const shapes = new Map<string, { url: string; segments: string[]; head: string }[]>();
  for (const { url, segments } of parsed) {
    let head = "";
    if (segments.length === 1) {
      const first = segments[0];
      const keep =
        sectionsWithChildren.has(first) ||
        (!looksVariable(first) && wordCount(first) <= MAX_SINGLE_SEGMENT_WORDS);
      head = keep ? first : "*";
    } else if (segments.length > 1) {
      head = looksVariable(segments[0]) ? "*" : segments[0];
    }
    const key = `${head}\u0000${segments.length}`;
    const bucket = shapes.get(key);
    const entry = { url, segments, head };
    if (bucket) bucket.push(entry);
    else shapes.set(key, [entry]);
  }

  const groups = new Map<string, string[]>();
  for (const bucket of shapes.values()) {
    const depth = bucket[0].segments.length;

    // How often each value appears at each position within this shape.
    const frequencies: Map<string, number>[] = [];
    for (let position = 1; position < depth; position++) {
      const counts = new Map<string, number>();
      for (const { segments } of bucket) {
        const value = segments[position];
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      frequencies[position] = counts;
    }

    for (const { url, segments, head } of bucket) {
      let pattern = "/";
      if (depth > 0) {
        const parts = [head];
        for (let position = 1; position < depth; position++) {
          const value = segments[position];
          const counts = frequencies[position];
          const keep =
            !looksVariable(value) &&
            (counts.get(value) ?? 0) >= 2 &&
            counts.size <= MAX_DISTINCT_LITERALS;
          parts.push(keep ? value : "*");
        }
        pattern = `/${parts.join("/")}`;
      }
      const group = groups.get(pattern);
      if (group) group.push(url);
      else groups.set(pattern, [url]);
    }
  }

  const total = urls.length;
  return [...groups.entries()]
    .map(([pattern, groupUrls]) => describeGroup(pattern, groupUrls, total, lastmod))
    .sort((a, b) => b.count - a.count || a.pattern.localeCompare(b.pattern));
}

/** Same as groupByPattern; the name used in the analysis code. */
export const groupUrls = groupByPattern;

function describeGroup(
  pattern: string,
  urls: string[],
  total: number,
  lastmod?: ReadonlyMap<string, string>,
): PatternGroup {
  let newest: string | null = null;
  let oldest: string | null = null;
  let dated = 0;
  if (lastmod) {
    for (const url of urls) {
      const value = lastmod.get(url);
      if (!value) continue;
      dated++;
      if (!newest || value > newest) newest = value;
      if (!oldest || value < oldest) oldest = value;
    }
  }
  return {
    pattern,
    count: urls.length,
    urls,
    share: total ? Math.round((urls.length / total) * 1000) / 10 : 0,
    lastmodNewest: newest,
    lastmodOldest: oldest,
    lastmodCoverage: urls.length ? Math.round((dated / urls.length) * 100) : 0,
    placeholders: describePlaceholders(pattern, urls),
  };
}

// ---------------------------------------------------------------------------
// Placeholder kinds
// ---------------------------------------------------------------------------

const DATE_IN_TEXT = /(?:^|[-_.])(?:(?:19|20)\d{2}[-_.]\d{1,2}[-_.]\d{1,2}|\d{1,2}[-_.]\d{1,2}[-_.](?:19|20)\d{2})(?:$|[-_.])/;
const MONTH_IN_TEXT = /(?:^|[-_])(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*[-_]\d{1,2}(?:st|nd|rd|th)?[-_](?:19|20)\d{2}(?:$|[-_])/i;

export function classifySegment(value: string, previous: string | null): PlaceholderKind {
  const v = decodeURIComponent(value.replace(/%(?![0-9a-f]{2})/gi, "%25")).replace(/\.(?:html?|php|aspx?)$/i, "");
  if (/^(?:19|20)\d{2}-\d{1,2}-\d{1,2}$/.test(v) || /^\d{1,2}-\d{1,2}-(?:19|20)\d{2}$/.test(v) || /^(?:19|20)\d{6}$/.test(v)) {
    return "date";
  }
  if (/^(?:19|20)\d{2}$/.test(v)) return "year";
  if (/^page[-_]?\d+$/i.test(v) || (/^\d{1,4}$/.test(v) && previous !== null && /^(?:page|p|pages|seite|pagina)$/i.test(previous))) {
    return "page number";
  }
  if (/^\d{1,4}$/.test(v)) return "number";
  if (/^\d{5,}$/.test(v)) return "id";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) || /^[0-9a-f]{12,}$/i.test(v)) return "id";
  if (/^[a-z0-9]{6,}$/i.test(v) && /\d/.test(v) && /[a-z]/i.test(v) && !/^[a-z]+\d{1,3}$/i.test(v)) return "id";
  if (/[-_]/.test(v) && (DATE_IN_TEXT.test(v) || MONTH_IN_TEXT.test(v))) return "slug with date";
  if (/^[\p{L}\p{N}]+(?:[-_.~][\p{L}\p{N}]+)*$/u.test(v) && /\p{L}/u.test(v)) return "slug";
  return "mixed";
}

const PLACEHOLDER_SAMPLE = 500;

function describePlaceholders(pattern: string, urls: string[]): Placeholder[] {
  const parts = pattern === "/" ? [] : pattern.slice(1).split("/");
  const placeholders: Placeholder[] = [];
  const step = Math.max(1, Math.floor(urls.length / PLACEHOLDER_SAMPLE));
  const sample = urls.filter((_, index) => index % step === 0).slice(0, PLACEHOLDER_SAMPLE);
  const segmentsList = sample.map(segmentsOf);
  parts.forEach((part, position) => {
    if (part !== "*") return;
    const values = segmentsList.map((segments) => segments[position]).filter((value): value is string => Boolean(value));
    const counts = new Map<PlaceholderKind, number>();
    for (const value of values) {
      const previous = position > 0 ? parts[position - 1] : null;
      const kind = classifySegment(value, previous === "*" ? null : previous);
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
    let kind: PlaceholderKind = "mixed";
    for (const [candidate, count] of counts) {
      if (values.length && count / values.length >= 0.8) kind = candidate;
    }
    const distinct = [...new Set(values)];
    const examples =
      distinct.length <= 3
        ? distinct
        : [distinct[0], distinct[Math.floor(distinct.length / 2)], distinct[distinct.length - 1]];
    placeholders.push({ position, kind, examples });
  });
  return placeholders;
}

// ---------------------------------------------------------------------------
// Pattern matching
// ---------------------------------------------------------------------------

/**
 * The most specific pattern that matches a URL (or path), or null. Patterns
 * match on segment count; * matches exactly one segment; more literal
 * segments win; "/" only matches the root.
 */
export function matchPattern(url: string, patterns: readonly string[]): string | null {
  const segments = url.startsWith("/") ? url.split(/[?#]/)[0].split("/").filter(Boolean) : segmentsOf(url);
  let best: string | null = null;
  let bestScore = -1;
  for (const pattern of patterns) {
    const parts = pattern === "/" ? [] : pattern.replace(/^\//, "").split("/").filter(Boolean);
    if (parts.length !== segments.length) continue;
    let score = 0;
    let matches = true;
    for (let index = 0; index < parts.length; index++) {
      if (parts[index] === "*") continue;
      if (parts[index] !== segments[index]) {
        matches = false;
        break;
      }
      score++;
    }
    if (matches && score > bestScore) {
      best = pattern;
      bestScore = score;
    }
  }
  return best;
}

function tokens(text: string): string[] {
  return text.split(/\s+/).filter((token) => token.length > 0);
}

function same(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function longestCommonSubsequence(a: string[], b: string[]): string[] {
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i][j] = same(a[i], b[j]) ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const result: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (same(a[i], b[j])) {
      result.push(a[i]);
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) i++;
    else j++;
  }
  return result;
}

/** Which gaps around the shared words hold text in this title. */
function filledGaps(words: string[], common: string[]): boolean[] {
  const filled = new Array<boolean>(common.length + 1).fill(false);
  let position = 0;
  for (const word of words) {
    if (position < common.length && same(word, common[position])) position++;
    else filled[position] = true;
  }
  return filled;
}

/**
 * Finds the template behind a set of titles, e.g.
 * "Arsenal vs Chelsea Prediction | Site" and "Inter vs Milan Prediction | Site"
 * give "{…} vs {…} Prediction | Site". Returns null when nothing is shared.
 */
export function textTemplate(texts: string[]): string | null {
  const samples = texts.map(tokens).filter((words) => words.length > 0);
  if (samples.length < 2) return null;
  let common = samples[0];
  for (const words of samples.slice(1)) {
    common = longestCommonSubsequence(common, words);
    if (common.length === 0) return null;
  }
  const gaps = new Array<boolean>(common.length + 1).fill(false);
  for (const words of samples) {
    filledGaps(words, common).forEach((filled, index) => {
      if (filled) gaps[index] = true;
    });
  }
  const parts: string[] = [];
  common.forEach((word, index) => {
    if (gaps[index]) parts.push("{…}");
    parts.push(word);
  });
  if (gaps[common.length]) parts.push("{…}");
  return parts.join(" ");
}
