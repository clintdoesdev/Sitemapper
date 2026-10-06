import type { HTMLElement } from "node-html-parser";
import { sameSite } from "../guard";
import { attr, byTag, hostOf, inlineText, resolveUrl, unique } from "./dom";
import { classifyHost } from "./hosts";
import type { TechInfo, ThirdParty } from "./types";

type Finding = { name: string; evidence: string };
type Rule = { name: string; test: (ctx: Context) => string | null };
type Context = {
  html: string;
  headers: Record<string, string>;
  cookies: string;
  generator: string;
  scripts: string[];
};

const has = (ctx: Context, pattern: RegExp, evidence: string) => (pattern.test(ctx.html) ? evidence : null);
const header = (ctx: Context, name: string, pattern: RegExp) => {
  const value = ctx.headers[name];
  return value && pattern.test(value) ? `${name}: ${value.slice(0, 60)}` : null;
};
const cookie = (ctx: Context, pattern: RegExp, evidence: string) => (pattern.test(ctx.cookies) ? evidence : null);
const generator = (ctx: Context, pattern: RegExp) =>
  pattern.test(ctx.generator) ? `generator meta: ${ctx.generator.slice(0, 60)}` : null;

const FRAMEWORKS: Rule[] = [
  { name: "Next.js (pages router)", test: (c) => has(c, /id=["']?__NEXT_DATA__/, "__NEXT_DATA__ script") },
  { name: "Next.js (app router)", test: (c) => has(c, /self\.__next_f/, "self.__next_f payload") },
  {
    name: "Next.js",
    test: (c) => has(c, /\/_next\/static\//, "/_next/ assets") ?? header(c, "x-powered-by", /next\.js/i),
  },
  { name: "Nuxt", test: (c) => has(c, /window\.__NUXT__|id=["']?__NUXT_DATA__|\/_nuxt\/|id=["']?__nuxt["'\s>]/, "Nuxt payload or /_nuxt/ assets") },
  { name: "SvelteKit", test: (c) => has(c, /__sveltekit_|\/_app\/immutable\/|data-sveltekit-/, "SvelteKit runtime") },
  { name: "Astro", test: (c) => has(c, /<astro-island|\/_astro\//, "astro-island or /_astro/ assets") ?? generator(c, /astro/i) },
  { name: "Gatsby", test: (c) => has(c, /id=["']?___gatsby|\/page-data\/app-data\.json/, "___gatsby root") ?? generator(c, /gatsby/i) },
  { name: "Remix", test: (c) => has(c, /window\.__remixContext|__remixManifest/, "__remixContext") },
  { name: "Angular", test: (c) => has(c, /\sng-version=["']|_nghost-|ng-app=/, "ng-version attribute") },
  { name: "Vue", test: (c) => has(c, /\sdata-v-app\b|\sdata-v-[0-9a-f]{8}\b|vue(?:\.runtime)?(?:\.global)?(?:\.prod)?\.js/, "Vue attributes or bundle") },
  { name: "React", test: (c) => has(c, /data-reactroot|react-dom(?:\.production)?(?:\.min)?\.js|__REACT_DEVTOOLS/, "React DOM markers") },
  { name: "jQuery", test: (c) => (c.scripts.some((src) => /jquery(?:[.-]\d|\.min)?\.js/i.test(src)) ? "jquery script" : null) },
  { name: "Laravel", test: (c) => cookie(c, /laravel_session|XSRF-TOKEN/i, "laravel_session cookie") },
  { name: "Django", test: (c) => cookie(c, /csrftoken=/i, "csrftoken cookie") ?? has(c, /csrfmiddlewaretoken/, "csrfmiddlewaretoken field") },
  { name: "PHP", test: (c) => header(c, "x-powered-by", /php/i) ?? cookie(c, /PHPSESSID/i, "PHPSESSID cookie") },
  { name: "Express", test: (c) => header(c, "x-powered-by", /express/i) },
  { name: "ASP.NET", test: (c) => header(c, "x-powered-by", /asp\.net/i) ?? header(c, "x-aspnet-version", /./) ?? cookie(c, /ASP\.NET_SessionId/i, "ASP.NET cookie") },
  { name: "Ruby on Rails", test: (c) => cookie(c, /_session=.*rails|_rails_session/i, "Rails session cookie") ?? has(c, /csrf-param["'][^>]+authenticity_token/, "authenticity_token meta") },
];

const CMS: Rule[] = [
  {
    name: "WordPress",
    test: (c) => has(c, /\/wp-content\/|\/wp-includes\//, "wp-content assets") ?? generator(c, /wordpress/i) ?? has(c, /\/wp-json\//, "wp-json API link"),
  },
  { name: "Yoast SEO", test: (c) => has(c, /Yoast SEO plugin|yoast-schema-graph/i, "Yoast markup") },
  { name: "Rank Math", test: (c) => has(c, /rank-math|Rank Math/i, "Rank Math markup") },
  { name: "Elementor", test: (c) => has(c, /elementor-(?:element|section|widget)|\/elementor\//, "Elementor classes") },
  { name: "WooCommerce", test: (c) => has(c, /woocommerce/i, "WooCommerce markup") },
  { name: "Shopify", test: (c) => has(c, /cdn\.shopify\.com|Shopify\.theme/, "Shopify assets") ?? header(c, "x-shopid", /./) },
  { name: "Webflow", test: (c) => has(c, /data-wf-site|website-files\.com|webflow\.js/, "Webflow attributes") ?? generator(c, /webflow/i) },
  { name: "Wix", test: (c) => has(c, /wixstatic\.com|static\.parastorage\.com/, "Wix assets") ?? header(c, "x-wix-request-id", /./) },
  { name: "Squarespace", test: (c) => has(c, /static1\.squarespace\.com|squarespace-cdn\.com/, "Squarespace assets") },
  { name: "Ghost", test: (c) => generator(c, /ghost/i) ?? has(c, /ghost-portal|\/ghost\/api\//, "Ghost portal") },
  { name: "Drupal", test: (c) => generator(c, /drupal/i) ?? has(c, /Drupal\.settings|\/sites\/default\/files\//, "Drupal assets") ?? header(c, "x-generator", /drupal/i) },
  { name: "Joomla", test: (c) => generator(c, /joomla/i) ?? has(c, /\/media\/jui\/|\/components\/com_/, "Joomla assets") },
  { name: "Blogger", test: (c) => generator(c, /blogger/i) ?? has(c, /blogger\.com\/static/, "Blogger assets") },
  { name: "HubSpot CMS", test: (c) => has(c, /hs-scripts\.com|hubspot\.net\/hub/, "HubSpot assets") },
];

const HOSTING: Rule[] = [
  { name: "Cloudflare", test: (c) => header(c, "server", /cloudflare/i) ?? header(c, "cf-ray", /./) },
  { name: "Vercel", test: (c) => header(c, "x-vercel-id", /./) ?? header(c, "server", /vercel/i) },
  { name: "Netlify", test: (c) => header(c, "x-nf-request-id", /./) ?? header(c, "server", /netlify/i) },
  { name: "Fastly", test: (c) => header(c, "x-served-by", /cache-/i) ?? header(c, "x-fastly-request-id", /./) ?? header(c, "via", /varnish/i) },
  { name: "Akamai", test: (c) => header(c, "server", /akamai/i) ?? header(c, "x-akamai-transformed", /./) },
  { name: "Amazon CloudFront", test: (c) => header(c, "x-amz-cf-id", /./) ?? header(c, "via", /cloudfront/i) },
  { name: "GitHub Pages", test: (c) => header(c, "x-github-request-id", /./) },
  { name: "Kinsta", test: (c) => header(c, "x-kinsta-cache", /./) },
  { name: "WP Engine", test: (c) => header(c, "x-powered-by", /wp engine/i) ?? header(c, "wpe-backend", /./) },
  { name: "Pantheon", test: (c) => header(c, "x-pantheon-styx-hostname", /./) },
  { name: "Sucuri", test: (c) => header(c, "x-sucuri-id", /./) ?? header(c, "server", /sucuri/i) },
  { name: "LiteSpeed", test: (c) => header(c, "server", /litespeed/i) ?? header(c, "x-litespeed-cache", /./) },
  { name: "Hostinger", test: (c) => header(c, "platform", /hostinger/i) ?? header(c, "x-hcdn-request-id", /./) },
  { name: "Google Cloud", test: (c) => header(c, "server", /google frontend|gws/i) ?? header(c, "via", /google/i) },
  { name: "Fly.io", test: (c) => header(c, "fly-request-id", /./) },
  { name: "Render", test: (c) => header(c, "x-render-origin-server", /./) },
  { name: "Heroku", test: (c) => header(c, "via", /vegur/i) },
  { name: "nginx", test: (c) => header(c, "server", /nginx|openresty/i) },
  { name: "Apache", test: (c) => header(c, "server", /apache/i) },
  { name: "Microsoft IIS", test: (c) => header(c, "server", /iis/i) },
];

function run(rules: Rule[], ctx: Context): Finding[] {
  const out: Finding[] = [];
  for (const rule of rules) {
    const evidence = rule.test(ctx);
    if (evidence) out.push({ name: rule.name, evidence });
  }
  return out;
}

/** Hosts that appear in inline scripts as identifiers rather than loaded resources. */
const NOT_THIRD_PARTY = new Set(["schema.org", "www.w3.org", "w3.org", "ogp.me", "purl.org", "json-schema.org"]);

const ROOT_IDS = ["root", "app", "__next", "__nuxt", "___gatsby", "svelte", "main-app"];

function tagIds(html: string): TechInfo["tagIds"] {
  const all = (pattern: RegExp) => unique([...html.matchAll(pattern)].map((match) => match[1])).slice(0, 10);
  return {
    ga4: all(/\b(G-[A-Z0-9]{6,12})\b/g),
    gtm: all(/\b(GTM-[A-Z0-9]{4,9})\b/g),
    adsense: all(/\b(ca-pub-\d{10,20})\b/g),
    metaPixel: all(/fbq\(\s*["']init["']\s*,\s*["'](\d{10,20})["']/g),
    universalAnalytics: all(/\b(UA-\d{4,10}-\d{1,4})\b/g),
  };
}

function embeddedData(elements: HTMLElement[], pageUrl: string): TechInfo["embedded"] {
  let nextDataKeys: string[] = [];
  let nuxtKeys: string[] = [];
  const apiHosts = new Set<string>();
  for (const script of byTag(elements, "script")) {
    const id = attr(script, "id");
    const text = script.rawText;
    if (id === "__NEXT_DATA__") {
      try {
        const data = JSON.parse(text) as { props?: { pageProps?: Record<string, unknown> } };
        nextDataKeys = Object.keys(data.props?.pageProps ?? {}).slice(0, 40);
      } catch {
        // Not JSON; ignore.
      }
    }
    if (id === "__NUXT_DATA__") {
      try {
        const data = JSON.parse(text) as unknown;
        const first = Array.isArray(data) ? data.find((item) => item && typeof item === "object" && !Array.isArray(item)) : data;
        if (first && typeof first === "object") nuxtKeys = Object.keys(first as object).slice(0, 40);
      } catch {
        // Not JSON; ignore.
      }
    }
    if (attr(script, "src") || !text) continue;
    for (const match of text.slice(0, 500_000).matchAll(/https?:\\?\/\\?\/([a-z0-9.-]+\.[a-z]{2,})((?:\\?\/[\w.~%-]*)*)/gi)) {
      const host = match[1].toLowerCase();
      const path = match[2].replace(/\\\//g, "/");
      const looksLikeApi =
        /^api[.-]|[.-]api\.|graphql/.test(host) || /\/(?:api|graphql|v[1-3])\b/.test(path) || classifyHost(host).category === "sports data";
      if (looksLikeApi) apiHosts.add(host);
    }
  }
  return { nextDataKeys, nuxtKeys, apiHosts: [...apiHosts].slice(0, 20) };
}

export function analyseTech(
  elements: HTMLElement[],
  html: string,
  headers: Record<string, string>,
  pageUrl: string,
  mainWords: number,
): TechInfo {
  const generatorMeta = byTag(elements, "meta").find((meta) => attr(meta, "name").toLowerCase() === "generator");
  const scripts = byTag(elements, "script");
  const scriptSrcs = scripts.map((script) => attr(script, "src")).filter(Boolean);
  const ctx: Context = {
    html,
    headers,
    cookies: headers["set-cookie"] ?? "",
    generator: generatorMeta ? attr(generatorMeta, "content") : headers["x-generator"] ?? "",
    scripts: scriptSrcs,
  };
  let frameworks = run(FRAMEWORKS, ctx);
  // The specific Next.js router entries make the generic one redundant.
  if (frameworks.some((f) => f.name.startsWith("Next.js ("))) frameworks = frameworks.filter((f) => f.name !== "Next.js");

  const emptyRoot = elements.some((element) => ROOT_IDS.includes(attr(element, "id")) && inlineText(element).length < 20);
  const clientRendered = mainWords < 50 && emptyRoot && scriptSrcs.length >= 2;
  if (clientRendered && !frameworks.some((f) => /react|vue|angular|next|nuxt|svelte|remix|gatsby|astro/i.test(f.name))) {
    frameworks.push({ name: "JavaScript SPA", evidence: "empty root container and script bundles" });
  }

  // Third-party hosts from src, srcset, href (not page links) and inline scripts.
  const pageHost = hostOf(pageUrl);
  const hosts = new Set<string>();
  const add = (raw: string) => {
    const url = resolveUrl(raw, pageUrl);
    if (!url) return;
    const host = hostOf(url);
    if (host && !sameSite(host, pageHost)) hosts.add(host);
  };
  for (const element of elements) {
    const tag = element.rawTagName?.toLowerCase();
    if (tag === "a") continue;
    const src = attr(element, "src") || attr(element, "data-src");
    if (src) add(src);
    if (tag === "link" || tag === "use") {
      const href = attr(element, "href");
      if (href) add(href);
    }
    const srcset = attr(element, "srcset");
    if (srcset) srcset.split(",").forEach((part) => add(part.trim().split(/\s+/)[0]));
  }
  for (const script of scripts) {
    // Structured data (JSON-LD) names vocabularies, not resources.
    if (attr(script, "src") || /ld\+json/i.test(attr(script, "type"))) continue;
    for (const match of script.rawText.slice(0, 300_000).matchAll(/(?:https?:)?\\?\/\\?\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi)) {
      const host = match[1].toLowerCase();
      if (!sameSite(host, pageHost) && /\.[a-z]{2,}$/.test(host) && !NOT_THIRD_PARTY.has(host)) hosts.add(host);
    }
  }
  const thirdParties: ThirdParty[] = [...hosts]
    .map((host) => ({ host, ...classifyHost(host) }))
    .sort((a, b) => a.category.localeCompare(b.category) || a.host.localeCompare(b.host))
    .slice(0, 150);

  return {
    frameworks,
    cms: run(CMS, ctx),
    hosting: run(HOSTING, ctx),
    rendering: clientRendered ? "mostly client-rendered" : "server-rendered",
    thirdParties,
    tagIds: tagIds(html),
    embedded: embeddedData(elements, pageUrl),
  };
}
