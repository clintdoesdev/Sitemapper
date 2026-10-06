/**
 * Aggregation over analysed pages. Pure and browser-safe: no network, no
 * HTML parsing, only data from PageAnalysis results.
 */

import type { PageAnalysis, PageData } from "./extract/types";

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

function bare(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

/**
 * Picks up to `count` URLs on the mapped host from the start, middle and end
 * of a group (sitemaps are often ordered by date).
 */
export function pickSamples(urls: readonly string[], count: number, siteHost: string): string[] {
  const onHost = urls.filter((url) => {
    try {
      return bare(new URL(url).hostname) === bare(siteHost);
    } catch {
      return false;
    }
  });
  if (onHost.length <= count) return [...onHost];
  const positions = count === 1 ? [0] : count === 2 ? [0, onHost.length - 1] : [0, Math.floor(onHost.length / 2), onHost.length - 1];
  const picked = positions.slice(0, count).map((index) => onHost[index]);
  return [...new Set(picked)];
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const MONTH = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const DATE_PATTERNS = [
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}\\.?,?\\s+\\d{4}\\b`, "gi"), // 12 Oct 2026
  new RegExp(`\\b${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}\\b`, "gi"), // October 12, 2026
  /\b\d{4}-\d{2}-\d{2}\b/g, // 2026-10-12
  /\b\d{1,2}[/.]\d{1,2}[/.]\d{4}\b/g, // 12/10/2026
];

/** Replaces date expressions with {date}. */
export function maskDates(text: string): string {
  let out = text;
  for (const pattern of DATE_PATTERNS) out = out.replace(pattern, "{date}");
  return out;
}

export type TemplateResult = { template: string | null; needsMoreSamples: boolean; samples: number };

function tokensOf(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

function sameToken(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function lcs(a: string[], b: string[]): string[] {
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i][j] = sameToken(a[i], b[j]) ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (sameToken(a[i], b[j])) {
      out.push(a[i]);
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) i++;
    else j++;
  }
  return out;
}

/** The tokens between consecutive shared tokens, for one sample. */
function gapsOf(tokens: string[], common: string[]): string[][] {
  const gaps: string[][] = Array.from({ length: common.length + 1 }, () => []);
  let position = 0;
  for (const token of tokens) {
    if (position < common.length && sameToken(token, common[position])) position++;
    else gaps[position].push(token);
  }
  return gaps;
}

/**
 * Builds a template from sample texts: dates become {date}; tokens shared by
 * every sample stay literal; each differing run becomes {n} when every value
 * is a number, otherwise {x}. One sample gives only date masking.
 */
export function buildTemplate(texts: readonly string[]): TemplateResult {
  const samples = texts.map((text) => maskDates(text.trim())).filter(Boolean);
  if (samples.length === 0) return { template: null, needsMoreSamples: false, samples: 0 };
  if (samples.length === 1) return { template: samples[0], needsMoreSamples: true, samples: 1 };
  const tokenLists = samples.map(tokensOf);
  let common = tokenLists[0];
  for (const tokens of tokenLists.slice(1)) common = lcs(common, tokens);
  if (common.length === 0) return { template: null, needsMoreSamples: false, samples: samples.length };

  const gapsPerSample = tokenLists.map((tokens) => gapsOf(tokens, common));
  const placeholderFor = (index: number): string | null => {
    const values = gapsPerSample.map((gaps) => gaps[index].join(" "));
    if (values.every((value) => value === values[0])) return values[0] || null;
    const filled = values.filter(Boolean);
    return filled.length > 0 && filled.every((value) => /^[\d.,%+-]+$/.test(value)) ? "{n}" : "{x}";
  };
  const parts: string[] = [];
  common.forEach((token, index) => {
    const gap = placeholderFor(index);
    if (gap) parts.push(gap);
    parts.push(token);
  });
  const tail = placeholderFor(common.length);
  if (tail) parts.push(tail);
  return { template: parts.join(" "), needsMoreSamples: false, samples: samples.length };
}

// ---------------------------------------------------------------------------
// Content engine
// ---------------------------------------------------------------------------

/**
 * Words that commonly open a sentence. A capitalised first word is only kept
 * literal when it is one of these; otherwise it is treated as a name too
 * (programmatic sentences often start with a team or product name).
 */
const SENTENCE_OPENERS = new Set(
  (
    "a an the this that these those there here it its we our you your they their he she his her i my " +
    "in on at for from with by to of as if when while after before since during both all some most many " +
    "no not one two three each every any either neither yes so but and or also however although because " +
    "what who which where why how get see read find check bet back expect look take make use click join " +
    "tip tips prediction predictions odds today tonight tomorrow yesterday last next" 
  ).split(" "),
);

/** Masks numbers, dates and capitalised names ({n}, {date}, {name}). */
export function sentenceSkeleton(sentence: string): string {
  const tokens = tokensOf(maskDates(sentence));
  const out: string[] = [];
  tokens.forEach((token, index) => {
    const core = token.replace(/^[("“'‘]+|[)"”'’.,:;!?]+$/g, "");
    let masked = token;
    if (token.includes("{date}")) masked = "{date}";
    else if (/^[+-]?\d[\d.,:/%-]*$/.test(core)) masked = token.replace(core, "{n}");
    else if (
      /^\p{Lu}[\p{L}\p{M}'’.-]*$/u.test(core) &&
      !/^(?:I|A)$/.test(core) &&
      (index > 0 || !SENTENCE_OPENERS.has(core.toLowerCase()))
    ) {
      masked = token.replace(core, "{name}");
    }
    // Runs of names collapse into one.
    if (masked.startsWith("{name}") && out.length && out[out.length - 1] === "{name}") return;
    out.push(masked);
  });
  return out.join(" ");
}

function normaliseSentence(sentence: string): string {
  return sentence.toLowerCase().replace(/\s+/g, " ").trim();
}

function fiveGrams(sentences: readonly string[]): Set<string> {
  const grams = new Set<string>();
  for (const sentence of sentences) {
    const words = sentence.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    for (let i = 0; i + 5 <= words.length; i++) grams.add(words.slice(i, i + 5).join(" "));
  }
  return grams;
}

export type ContentEngine = {
  templated: { skeleton: string; example: string; samples: number }[];
  boilerplate: string[];
  /** Average share of each page's 5-word phrases not found on the other samples, 0 to 1. Null with one sample. */
  uniqueness: number | null;
};

export function contentEngine(pagesSentences: readonly (readonly string[])[]): ContentEngine {
  const skeletons = new Map<string, { samples: Set<number>; sentences: Set<string>; example: string }>();
  pagesSentences.forEach((sentences, sample) => {
    for (const sentence of sentences) {
      const skeleton = sentenceSkeleton(sentence);
      const entry = skeletons.get(skeleton) ?? { samples: new Set<number>(), sentences: new Set<string>(), example: sentence };
      entry.samples.add(sample);
      entry.sentences.add(normaliseSentence(sentence));
      skeletons.set(skeleton, entry);
    }
  });
  const templated = [...skeletons.entries()]
    .filter(([, entry]) => entry.samples.size >= 2 && entry.sentences.size >= 2)
    .sort((a, b) => b[1].samples.size - a[1].samples.size)
    .slice(0, 10)
    .map(([skeleton, entry]) => ({ skeleton, example: entry.example, samples: entry.samples.size }));

  let boilerplate: string[] = [];
  if (pagesSentences.length >= 2) {
    const sets = pagesSentences.map((sentences) => new Set(sentences.map(normaliseSentence)));
    boilerplate = [...new Set(pagesSentences[0])]
      .filter((sentence) => sets.every((set) => set.has(normaliseSentence(sentence))))
      .slice(0, 20);
  }

  let uniqueness: number | null = null;
  if (pagesSentences.length >= 2) {
    const grams = pagesSentences.map(fiveGrams);
    const shares = grams.map((own, index) => {
      if (own.size === 0) return 0;
      let unique = 0;
      for (const gram of own) {
        if (!grams.some((other, otherIndex) => otherIndex !== index && other.has(gram))) unique++;
      }
      return unique / own.size;
    });
    uniqueness = Math.round((shares.reduce((sum, share) => sum + share, 0) / shares.length) * 100) / 100;
  }
  return { templated, boilerplate, uniqueness };
}

// ---------------------------------------------------------------------------
// Per-pattern aggregate
// ---------------------------------------------------------------------------

export type PatternAggregate = {
  pattern: string;
  sampled: number;
  analysed: number;
  blocked: number;
  failed: number;
  templates: { title: TemplateResult; description: TemplateResult; h1: TemplateResult; ogTitle: TemplateResult };
  canonical: { self: number; other: number; missing: number; relative: number; summary: string };
  ogImage: "static" | "per page" | "missing" | "mixed" | "unknown";
  schema: { always: string[]; sometimes: string[] };
  blocks: { always: string[]; conditional: string[] };
  content: ContentEngine;
  tables: { headers: string[]; rows: number }[];
  averages: {
    words: number;
    internalLinks: number;
    externalLinks: number;
    images: number;
    scripts: number;
    htmlKb: number;
    responseMs: number;
  };
  outgoing: { pattern: string; links: number; pages: number }[];
};

function average(values: number[]): number {
  return values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10 : 0;
}

export function aggregatePattern(pattern: string, pages: readonly PageAnalysis[]): PatternAggregate {
  const ok = pages.filter((page): page is PageAnalysis & { data: PageData } => page.data !== null);
  const data = ok.map((page) => page.data);

  const canonical = { self: 0, other: 0, missing: 0, relative: 0 };
  for (const page of data) canonical[page.head.canonical.kind]++;
  const canonicalParts = (Object.entries(canonical) as [string, number][]).filter(([, count]) => count > 0);
  const canonicalSummary =
    data.length === 0
      ? "No pages analysed."
      : canonicalParts.length === 1
        ? `${canonicalParts[0][0]} on every sample`
        : canonicalParts.map(([kind, count]) => `${kind} on ${count}`).join(", ");

  const ogImages = data.map((page) => page.head.openGraph["og:image"] ?? "");
  let ogImage: PatternAggregate["ogImage"] = "unknown";
  if (data.length > 0) {
    if (ogImages.every((value) => !value)) ogImage = "missing";
    else if (ogImages.some((value) => !value)) ogImage = "mixed";
    else if (data.length === 1) ogImage = "unknown";
    else ogImage = new Set(ogImages).size === 1 ? "static" : "per page";
  }

  const typeCounts = new Map<string, number>();
  for (const page of data) for (const type of new Set(page.schema.types)) typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
  const schema = {
    always: [...typeCounts].filter(([, count]) => count === data.length).map(([type]) => type),
    sometimes: [...typeCounts].filter(([, count]) => count < data.length).map(([type]) => type),
  };

  // Template blocks, in the first sample's section order.
  const signatureSets = data.map((page) => new Set(page.structure.blocks.map((block) => block.signature)));
  const ordered: string[] = [];
  for (const page of data) for (const block of page.structure.blocks) if (!ordered.includes(block.signature)) ordered.push(block.signature);
  const blocks = {
    always: ordered.filter((signature) => signatureSets.every((set) => set.has(signature))),
    conditional: ordered.filter((signature) => !signatureSets.every((set) => set.has(signature))),
  };

  const outgoing = new Map<string, { links: number; pages: number }>();
  for (const page of data) {
    for (const target of page.links.internalByPattern) {
      const entry = outgoing.get(target.pattern) ?? { links: 0, pages: 0 };
      entry.links += target.count;
      entry.pages += 1;
      outgoing.set(target.pattern, entry);
    }
  }

  return {
    pattern,
    sampled: pages.length,
    analysed: ok.length,
    blocked: pages.filter((page) => page.outcome === "blocked").length,
    failed: pages.filter((page) => page.outcome !== "ok" && page.outcome !== "blocked").length,
    templates: {
      title: buildTemplate(data.map((page) => page.head.title)),
      description: buildTemplate(data.map((page) => page.head.description)),
      h1: buildTemplate(data.map((page) => page.structure.headings.find((heading) => heading.level === 1)?.text ?? "")),
      ogTitle: buildTemplate(data.map((page) => page.head.openGraph["og:title"] ?? "")),
    },
    canonical: { ...canonical, summary: canonicalSummary },
    ogImage,
    schema,
    blocks,
    content: contentEngine(data.map((page) => page.structure.sentences)),
    tables: data.find((page) => page.structure.tables.length > 0)?.structure.tables ?? [],
    averages: {
      words: average(data.map((page) => page.structure.main.words)),
      internalLinks: average(data.map((page) => page.links.internal)),
      externalLinks: average(data.map((page) => page.links.external)),
      images: average(data.map((page) => page.structure.images.count)),
      scripts: average(data.map((page) => page.perf.scripts.external + page.perf.scripts.inline)),
      htmlKb: average(ok.map((page) => page.bytes / 1024)),
      responseMs: average(ok.map((page) => page.ms)),
    },
    outgoing: [...outgoing.entries()]
      .map(([target, entry]) => ({ pattern: target, ...entry }))
      .sort((a, b) => b.links - a.links),
  };
}

// ---------------------------------------------------------------------------
// Site-wide (computed in the browser from every result)
// ---------------------------------------------------------------------------

export type LinkMap = {
  edges: { source: string; target: string; links: number; pages: number }[];
  homepageTargets: { pattern: string; links: number }[];
  /** Mapped patterns that no sampled page (or the homepage) links to. */
  unlinked: string[];
  /** Internal URLs that match no mapped pattern. */
  notInSitemap: string[];
};

export function buildLinkMap(
  results: readonly { pattern: string; pages: readonly PageAnalysis[] }[],
  homepage: PageAnalysis | null,
  allPatterns: readonly string[],
): LinkMap {
  const edges: LinkMap["edges"] = [];
  const linked = new Set<string>();
  const notInSitemap = new Set<string>();
  for (const result of results) {
    const aggregate = aggregatePattern(result.pattern, result.pages);
    for (const edge of aggregate.outgoing) {
      edges.push({ source: result.pattern, target: edge.pattern, links: edge.links, pages: edge.pages });
      if (edge.pattern !== result.pattern) linked.add(edge.pattern);
    }
    for (const page of result.pages) for (const url of page.data?.links.unmatchedInternal ?? []) notInSitemap.add(url);
  }
  const homepageTargets = (homepage?.data?.links.internalByPattern ?? []).map((target) => ({ pattern: target.pattern, links: target.count }));
  homepageTargets.forEach((target) => linked.add(target.pattern));
  for (const url of homepage?.data?.links.unmatchedInternal ?? []) notInSitemap.add(url);
  return {
    edges: edges.sort((a, b) => a.source.localeCompare(b.source) || b.links - a.links),
    homepageTargets,
    unlinked: allPatterns.filter((pattern) => pattern !== "/" && !linked.has(pattern)),
    notInSitemap: [...notInSitemap].slice(0, 300),
  };
}

export type TreeNode = { segment: string; path: string; count: number; pattern: string | null; children: TreeNode[] };

/** Patterns nested by path segment, with page counts summed up the tree. */
export function architectureTree(groups: readonly { pattern: string; count: number }[]): TreeNode {
  const root: TreeNode = { segment: "/", path: "/", count: 0, pattern: null, children: [] };
  for (const group of groups) {
    root.count += group.count;
    if (group.pattern === "/") {
      root.pattern = "/";
      continue;
    }
    let node = root;
    const parts = group.pattern.slice(1).split("/");
    parts.forEach((part, index) => {
      const path = `/${parts.slice(0, index + 1).join("/")}`;
      let child = node.children.find((candidate) => candidate.segment === part);
      if (!child) {
        child = { segment: part, path, count: 0, pattern: null, children: [] };
        node.children.push(child);
      }
      child.count += group.count;
      if (index === parts.length - 1) child.pattern = group.pattern;
      node = child;
    });
  }
  const sort = (node: TreeNode) => {
    node.children.sort((a, b) => b.count - a.count);
    node.children.forEach(sort);
  };
  sort(root);
  return root;
}

export type StackSummary = {
  pages: number;
  frameworks: { name: string; pages: number }[];
  cms: { name: string; pages: number }[];
  hosting: { name: string; pages: number }[];
  rendering: { server: number; client: number };
  thirdParties: { host: string; category: string; name: string; pages: number }[];
  niches: { niche: string; pages: number }[];
  schemaTypes: { type: string; pages: number }[];
};

function countNames(lists: string[][]): { name: string; pages: number }[] {
  const counts = new Map<string, number>();
  for (const list of lists) for (const name of new Set(list)) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts].map(([name, pages]) => ({ name, pages })).sort((a, b) => b.pages - a.pages);
}

export function stackSummary(pages: readonly PageAnalysis[]): StackSummary {
  const data = pages.map((page) => page.data).filter((value): value is PageData => value !== null);
  const parties = new Map<string, { host: string; category: string; name: string; pages: number }>();
  for (const page of data) {
    for (const party of page.tech.thirdParties) {
      const entry = parties.get(party.host) ?? { ...party, pages: 0 };
      entry.pages++;
      parties.set(party.host, entry);
    }
  }
  return {
    pages: data.length,
    frameworks: countNames(data.map((page) => page.tech.frameworks.map((f) => f.name))),
    cms: countNames(data.map((page) => page.tech.cms.map((c) => c.name))),
    hosting: countNames(data.map((page) => page.tech.hosting.map((h) => h.name))),
    rendering: {
      server: data.filter((page) => page.tech.rendering === "server-rendered").length,
      client: data.filter((page) => page.tech.rendering === "mostly client-rendered").length,
    },
    thirdParties: [...parties.values()].sort((a, b) => a.category.localeCompare(b.category) || b.pages - a.pages),
    niches: countNames(data.map((page) => [page.niche.niche])).map(({ name, pages }) => ({ niche: name, pages })),
    schemaTypes: countNames(data.map((page) => page.schema.types)).map(({ name, pages }) => ({ type: name, pages })),
  };
}
