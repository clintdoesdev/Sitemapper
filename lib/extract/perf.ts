import type { HTMLElement } from "node-html-parser";
import { attr, byTag, hostOf, resolveUrl, unique } from "./dom";
import type { PerfInfo } from "./types";

/**
 * Performance proxies from the HTML and the response. These are not Core Web
 * Vitals; the validator links point to tools that measure the real thing.
 */
export function analysePerf(
  elements: HTMLElement[],
  input: { pageUrl: string; htmlBytes: number; responseMs: number },
): PerfInfo {
  const scripts = byTag(elements, "script").filter((script) => {
    const type = attr(script, "type").toLowerCase();
    return !type || /javascript|module|ecmascript/.test(type);
  });
  const external = scripts.filter((script) => attr(script, "src"));
  const head = byTag(elements, "head")[0];
  const headLinks = head ? byTag(elements, "link").filter((link) => isInside(link, head)) : [];
  const stylesheetsInHead = headLinks.filter((link) => /stylesheet/i.test(attr(link, "rel"))).length;
  const inlineStyleBytes = byTag(elements, "style").reduce((sum, style) => sum + style.rawText.length, 0);

  const fontHosts = unique(
    byTag(elements, "link")
      .map((link) => attr(link, "href"))
      .filter((href) => /fonts\.|typekit|font/i.test(href))
      .map((href) => hostOf(resolveUrl(href, input.pageUrl) ?? ""))
      .filter(Boolean),
  );
  const fontPreloads = byTag(elements, "link").filter(
    (link) => /preload/i.test(attr(link, "rel")) && attr(link, "as").toLowerCase() === "font",
  ).length;
  const images = byTag(elements, "img");
  const lazy = images.filter((image) => attr(image, "loading").toLowerCase() === "lazy" || attr(image, "data-src")).length;

  const mixedContent: string[] = [];
  if (input.pageUrl.startsWith("https:")) {
    for (const element of elements) {
      const tag = element.rawTagName?.toLowerCase();
      const value =
        tag === "script" || tag === "img" || tag === "iframe" || tag === "source" || tag === "video" || tag === "audio"
          ? attr(element, "src")
          : tag === "link" && /stylesheet|preload|icon/i.test(attr(element, "rel"))
            ? attr(element, "href")
            : "";
      if (/^http:\/\//i.test(value) && mixedContent.length < 20) mixedContent.push(value);
    }
  }

  const encoded = encodeURIComponent(input.pageUrl);
  return {
    htmlBytes: input.htmlBytes,
    responseMs: input.responseMs,
    scripts: {
      external: external.length,
      inline: scripts.length - external.length,
      async: external.filter((script) => script.getAttribute("async") !== undefined).length,
      defer: external.filter((script) => script.getAttribute("defer") !== undefined).length,
    },
    stylesheetsInHead,
    inlineStyleBytes,
    fontHosts,
    fontPreloads,
    images: images.length,
    lazyShare: images.length ? Math.round((lazy / images.length) * 100) : 0,
    missingImageDimensions: images.filter((image) => !attr(image, "width") || !attr(image, "height")).length,
    mixedContent,
    validators: {
      pageSpeed: `https://pagespeed.web.dev/analysis?url=${encoded}`,
      richResults: `https://search.google.com/test/rich-results?url=${encoded}`,
      schemaValidator: `https://validator.schema.org/#url=${encoded}`,
    },
  };
}

function isInside(node: HTMLElement, container: HTMLElement): boolean {
  let current = node.parentNode as HTMLElement | null;
  while (current) {
    if (current === container) return true;
    current = current.parentNode as HTMLElement | null;
  }
  return false;
}
