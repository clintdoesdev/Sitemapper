import type { HTMLElement } from "node-html-parser";
import { attr, byTag, collapse, inlineText, resolveUrl } from "./dom";
import type { HeadInfo } from "./types";

function sameUrl(a: string, b: string): boolean {
  try {
    const x = new URL(a);
    const y = new URL(b);
    x.hash = "";
    y.hash = "";
    return x.href === y.href;
  } catch {
    return false;
  }
}

export function analyseHead(
  elements: HTMLElement[],
  pageUrl: string,
  headers: Record<string, string>,
): HeadInfo {
  const metas = byTag(elements, "meta");
  const links = byTag(elements, "link");
  const meta = (key: string) => {
    const found = metas.find((element) => (attr(element, "name") || attr(element, "property")).toLowerCase() === key);
    return found ? collapse(attr(found, "content")) : "";
  };
  const linksWithRel = (rel: string) =>
    links.filter((element) => attr(element, "rel").toLowerCase().split(/\s+/).includes(rel));
  const hrefOf = (element: HTMLElement | undefined) =>
    element ? resolveUrl(attr(element, "href"), pageUrl) ?? attr(element, "href") : "";

  const titleElement = byTag(elements, "title").find((element) => !element.parentNode || (element.parentNode as HTMLElement).rawTagName?.toLowerCase() !== "svg");
  const title = titleElement ? collapse(titleElement.text) : "";
  const description = meta("description");

  const canonicalElement = linksWithRel("canonical")[0];
  const canonicalRaw = canonicalElement ? attr(canonicalElement, "href").trim() : "";
  const canonicalHref = canonicalRaw ? resolveUrl(canonicalRaw, pageUrl) ?? canonicalRaw : "";
  const canonicalKind: HeadInfo["canonical"]["kind"] = !canonicalRaw
    ? "missing"
    : !/^(?:https?:)?\/\//i.test(canonicalRaw)
      ? "relative"
      : sameUrl(canonicalHref, pageUrl)
        ? "self"
        : "other";

  const prefixed = (prefix: string, attribute: "property" | "name") => {
    const out: Record<string, string> = {};
    for (const element of metas) {
      const key = (attr(element, attribute) || attr(element, attribute === "property" ? "name" : "property")).toLowerCase();
      if (key.startsWith(prefix) && !(key in out)) out[key] = collapse(attr(element, "content")).slice(0, 500);
    }
    return out;
  };

  const charsetMeta = metas.find((element) => element.getAttribute("charset") !== undefined);
  const httpEquiv = metas.find((element) => attr(element, "http-equiv").toLowerCase() === "content-type");
  const htmlElement = byTag(elements, "html")[0];

  return {
    title,
    titleLength: [...title].length,
    description,
    descriptionLength: [...description].length,
    robots: meta("robots"),
    googlebot: meta("googlebot"),
    xRobotsTag: headers["x-robots-tag"] ?? "",
    canonical: { href: canonicalHref, kind: canonicalKind },
    lang: htmlElement ? attr(htmlElement, "lang") : "",
    hreflang: linksWithRel("alternate")
      .filter((element) => attr(element, "hreflang"))
      .slice(0, 100)
      .map((element) => ({ lang: attr(element, "hreflang"), href: hrefOf(element) })),
    viewport: meta("viewport"),
    charset: charsetMeta ? attr(charsetMeta, "charset") : httpEquiv ? (/charset=([\w-]+)/i.exec(attr(httpEquiv, "content"))?.[1] ?? "") : "",
    keywords: meta("keywords"),
    openGraph: prefixed("og:", "property"),
    twitter: prefixed("twitter:", "name"),
    themeColor: meta("theme-color"),
    favicons: [...linksWithRel("icon"), ...linksWithRel("apple-touch-icon"), ...linksWithRel("mask-icon")]
      .map(hrefOf)
      .filter(Boolean)
      .slice(0, 10),
    manifest: hrefOf(linksWithRel("manifest")[0]),
    resourceHints: {
      preconnect: linksWithRel("preconnect").map(hrefOf).filter(Boolean).slice(0, 30),
      preload: linksWithRel("preload")
        .slice(0, 30)
        .map((element) => ({ href: hrefOf(element), as: attr(element, "as") })),
      dnsPrefetch: linksWithRel("dns-prefetch").map(hrefOf).filter(Boolean).slice(0, 30),
    },
    amphtml: hrefOf(linksWithRel("amphtml")[0]),
    feeds: linksWithRel("alternate")
      .filter((element) => /rss|atom/i.test(attr(element, "type")))
      .slice(0, 10)
      .map((element) => ({ type: attr(element, "type"), href: hrefOf(element), title: attr(element, "title") })),
    prev: hrefOf(linksWithRel("prev")[0]),
    next: hrefOf(linksWithRel("next")[0]),
  };
}

/** The <title> text, for places that only need that. */
export function titleOf(elements: HTMLElement[]): string {
  const element = byTag(elements, "title")[0];
  return element ? inlineText(element) : "";
}
