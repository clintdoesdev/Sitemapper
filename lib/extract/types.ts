/** Everything one page analysis returns. Pure data, safe to send to the browser. */

import type { RedirectHop } from "../fetcher";

export type Heading = { level: number; text: string };

export type HeadInfo = {
  title: string;
  titleLength: number;
  description: string;
  descriptionLength: number;
  robots: string;
  googlebot: string;
  xRobotsTag: string;
  canonical: { href: string; kind: "missing" | "self" | "other" | "relative" };
  lang: string;
  hreflang: { lang: string; href: string }[];
  viewport: string;
  charset: string;
  keywords: string;
  openGraph: Record<string, string>;
  twitter: Record<string, string>;
  themeColor: string;
  favicons: string[];
  manifest: string;
  resourceHints: { preconnect: string[]; preload: { href: string; as: string }[]; dnsPrefetch: string[] };
  amphtml: string;
  feeds: { type: string; href: string; title: string }[];
  prev: string;
  next: string;
};

export type SchemaEntity = {
  type: string;
  keys: string[];
  /** Key values for well-known types (names, dates, ratings, trail, questions). */
  details: Record<string, string | string[]>;
  nested: boolean;
};

export type SchemaBlock = {
  valid: boolean;
  error: string | null;
  raw: string;
  rawTruncated: boolean;
};

export type SchemaInfo = {
  blocks: SchemaBlock[];
  entities: SchemaEntity[];
  /** Top-level @type values (including @graph members), de-duplicated. */
  types: string[];
  microdata: string[];
  rdfa: string[];
  faq: { questions: string[]; notVisible: string[] };
};

export type Block = {
  tag: string;
  id: string;
  classes: string[];
  heading: string;
  words: number;
  links: number;
  tables: number;
  lists: number;
  images: number;
  forms: number;
  signature: string;
  landmark: boolean;
};

export type StructureInfo = {
  main: { source: "main" | "article" | "body"; words: number; paragraphs: number; textToHtmlRatio: number };
  headings: Heading[];
  h1Count: number;
  blocks: Block[];
  tables: { headers: string[]; rows: number }[];
  images: { count: number; missingAlt: number; lazy: number; missingDimensions: number; formats: Record<string, number> };
  iframes: { host: string; src: string }[];
  breadcrumb: string[];
  dates: { text: string; datetime: string; label: string }[];
  faqBlocks: { details: number; headings: string[] };
  sentences: string[];
};

export type LinkTarget = { pattern: string; count: number; anchors: string[] };

export type LinksInfo = {
  total: number;
  internal: number;
  external: number;
  nofollow: number;
  sponsored: number;
  ugc: number;
  internalNofollow: number;
  placement: { header: number; main: number; aside: number; footer: number; other: number };
  internalByPattern: LinkTarget[];
  /** Internal URLs matching no mapped pattern: linked but not in the sitemap. */
  unmatchedInternal: string[];
  queryParams: Record<string, number>;
  externalDomains: { domain: string; count: number; rels: string[] }[];
  affiliate: {
    redirectPaths: { url: string; count: number }[];
    trackingParams: Record<string, number>;
    networks: { host: string; count: number }[];
  };
  messaging: { kind: string; url: string }[];
  apps: { kind: string; url: string }[];
};

export type ThirdParty = { host: string; category: string; name: string };

export type TechInfo = {
  frameworks: { name: string; evidence: string }[];
  cms: { name: string; evidence: string }[];
  hosting: { name: string; evidence: string }[];
  rendering: "server-rendered" | "mostly client-rendered";
  thirdParties: ThirdParty[];
  tagIds: { ga4: string[]; gtm: string[]; adsense: string[]; metaPixel: string[]; universalAnalytics: string[] };
  embedded: { nextDataKeys: string[]; nuxtKeys: string[]; apiHosts: string[] };
};

export type SignalsInfo = {
  ads: { count: number; aboveFirstH2: number; belowFirstH2: number; markers: string[] };
  conversion: {
    login: number;
    register: number;
    pricing: number;
    newsletterForms: number;
    pushOptIn: string[];
    popups: number;
    locked: number;
    examples: string[];
  };
  prices: string[];
  trust: {
    ageNotice: boolean;
    responsibleGambling: boolean;
    helpOrganisations: string[];
    licence: string[];
    disclaimer: boolean;
    privacy: boolean;
    terms: boolean;
    about: boolean;
    contact: boolean;
    author: boolean;
    editorialPolicy: boolean;
  };
};

export type SportsSignals = {
  fixtures: string[];
  kickoffTimes: string[];
  timezones: string[];
  markets: string[];
  odds: { count: number; examples: string[]; formats: string[] };
  bookmakers: string[];
  tipLabels: string[];
  confidence: string[];
  accaTerms: string[];
  bookingCodes: string[];
  results: Record<string, number>;
};

export type NicheInfo = {
  niche: string;
  scores: Record<string, number>;
  signals: string[];
  sports: SportsSignals | null;
};

export type PerfInfo = {
  htmlBytes: number;
  responseMs: number;
  scripts: { external: number; inline: number; async: number; defer: number };
  stylesheetsInHead: number;
  inlineStyleBytes: number;
  fontHosts: string[];
  fontPreloads: number;
  images: number;
  lazyShare: number;
  missingImageDimensions: number;
  /** http:// resources on an https page. */
  mixedContent: string[];
  validators: { pageSpeed: string; richResults: string; schemaValidator: string };
};

export type PageData = {
  head: HeadInfo;
  schema: SchemaInfo;
  structure: StructureInfo;
  links: LinksInfo;
  tech: TechInfo;
  signals: SignalsInfo;
  niche: NicheInfo;
  perf: PerfInfo;
};

export type PageAnalysis = {
  url: string;
  pattern: string;
  finalUrl: string;
  status: number;
  /** "ok", or why there is no data. */
  outcome: "ok" | "blocked" | "robots" | "error" | "not-html" | "off-host";
  message: string | null;
  redirectChain: RedirectHop[];
  offHostRedirect: string | null;
  ms: number;
  bytes: number;
  truncated: boolean;
  headers: Record<string, string>;
  data: PageData | null;
};
