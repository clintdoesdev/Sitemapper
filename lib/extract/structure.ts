import type { HTMLElement } from "node-html-parser";
import {
  allElements,
  attr,
  byTag,
  classesOf,
  collapse,
  countWords,
  hostOf,
  inlineText,
  isElement,
  resolveUrl,
  sentencesOf,
  tagOf,
  visibleText,
} from "./dom";
import type { Block, SchemaInfo, StructureInfo } from "./types";

const LANDMARKS = new Set(["header", "nav", "main", "section", "article", "aside", "footer", "form"]);
const CHROME = new Set(["nav", "header", "footer", "aside", "form", "script", "style", "noscript", "svg", "template"]);
const NOT_BLOCKS = new Set(["script", "style", "noscript", "template", "link", "meta", "br", "hr"]);
const MAX_BLOCKS = 40;
const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const DATE_TEXT = `(?:\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS}),?\\s+\\d{4}|(?:${MONTHS})\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[/.]\\d{1,2}[/.]\\d{2,4})`;
const LABELLED_DATE = new RegExp(`\\b(last updated|updated|published|posted|modified)\\b\\s*(?:on|:)?\\s*(${DATE_TEXT})`, "gi");

export type MainContent = { node: HTMLElement; source: "main" | "article" | "body"; text: string };

/** main or article if present, otherwise body minus nav, header, footer, aside and forms. */
export function findMainContent(root: HTMLElement, elements: HTMLElement[]): MainContent {
  const main = byTag(elements, "main")[0];
  if (main) return { node: main, source: "main", text: visibleText(main) };
  const article = byTag(elements, "article")[0];
  if (article) return { node: article, source: "article", text: visibleText(article) };
  const body = byTag(elements, "body")[0] ?? root;
  return { node: body, source: "body", text: visibleText(body, CHROME) };
}

function hasLandmarkAncestor(element: HTMLElement): boolean {
  let current = element.parentNode as HTMLElement | null;
  while (current && isElement(current)) {
    if (LANDMARKS.has(tagOf(current))) return true;
    current = current.parentNode as HTMLElement | null;
  }
  return false;
}

function describeBlock(element: HTMLElement): Block {
  const inner = allElements(element);
  const heading = inner.find((node) => /^h[1-6]$/.test(tagOf(node)));
  const tag = tagOf(element);
  const id = attr(element, "id");
  const classes = classesOf(element).slice(0, 3);
  return {
    tag,
    id,
    classes,
    heading: heading ? inlineText(heading).slice(0, 120) : "",
    words: countWords(visibleText(element)),
    links: inner.filter((node) => tagOf(node) === "a" && attr(node, "href")).length,
    tables: inner.filter((node) => tagOf(node) === "table").length,
    lists: inner.filter((node) => tagOf(node) === "ul" || tagOf(node) === "ol").length,
    images: inner.filter((node) => tagOf(node) === "img").length,
    forms: inner.filter((node) => tagOf(node) === "form").length,
    signature: [tag, id ? `#${id}` : "", classes[0] ? `.${classes[0]}` : ""].join(""),
    landmark: LANDMARKS.has(tag),
  };
}

function imageFormat(src: string): string {
  if (src.startsWith("data:")) return "data";
  try {
    const match = /\.([a-z0-9]{2,5})$/i.exec(new URL(src, "https://x.invalid").pathname);
    return match ? match[1].toLowerCase().replace("jpeg", "jpg") : "other";
  } catch {
    return "other";
  }
}

export function analyseStructure(
  root: HTMLElement,
  elements: HTMLElement[],
  html: string,
  pageUrl: string,
  schema: SchemaInfo,
): { structure: StructureInfo; mainText: string } {
  const main = findMainContent(root, elements);
  const order = new Map(elements.map((element, index) => [element, index]));
  const mainElements = main.source === "body" ? elements.filter((element) => !closestChrome(element)) : allElements(main.node);

  // Headings in document order.
  const headings = byTag(elements, "h1", "h2", "h3", "h4", "h5", "h6")
    .map((element) => ({ level: Number(tagOf(element)[1]), text: inlineText(element).slice(0, 200) }))
    .filter((heading) => heading.text)
    .slice(0, 200);

  // Block map: top-level landmarks plus the direct children of main (or body).
  const body = byTag(elements, "body")[0] ?? root;
  const container = byTag(elements, "main")[0] ?? body;
  const candidates = new Set<HTMLElement>();
  for (const element of elements) {
    if (LANDMARKS.has(tagOf(element)) && !hasLandmarkAncestor(element)) candidates.add(element);
  }
  for (const child of container.childNodes) {
    if (isElement(child) && !NOT_BLOCKS.has(tagOf(child))) candidates.add(child);
  }
  const blocks = [...candidates]
    .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
    .slice(0, MAX_BLOCKS)
    .map(describeBlock);

  const tables = byTag(elements, "table")
    .slice(0, 5)
    .map((table) => {
      const inner = allElements(table);
      const rows = inner.filter((node) => tagOf(node) === "tr");
      const headerCells = inner.filter((node) => tagOf(node) === "th");
      const headers = (headerCells.length ? headerCells : rows[0] ? allElements(rows[0]).filter((node) => tagOf(node) === "td") : [])
        .slice(0, 15)
        .map((cell) => inlineText(cell).slice(0, 60));
      return { headers, rows: rows.length };
    });

  const images = byTag(elements, "img");
  const formats: Record<string, number> = {};
  for (const image of images) {
    const format = imageFormat(attr(image, "src") || attr(image, "data-src") || attr(image, "data-lazy-src"));
    formats[format] = (formats[format] ?? 0) + 1;
  }

  const iframes = byTag(elements, "iframe")
    .map((frame) => resolveUrl(attr(frame, "src") || attr(frame, "data-src"), pageUrl))
    .filter((src): src is string => Boolean(src))
    .slice(0, 20)
    .map((src) => ({ host: hostOf(src), src }));

  // Breadcrumb: schema first, then markup.
  let breadcrumb: string[] = [];
  const schemaTrail = schema.entities.find((entity) => entity.type.includes("BreadcrumbList"))?.details.trail;
  if (Array.isArray(schemaTrail) && schemaTrail.length) breadcrumb = schemaTrail;
  if (!breadcrumb.length) {
    const crumbs = elements.find(
      (element) =>
        /breadcrumb/i.test(attr(element, "aria-label")) ||
        /breadcrumb/i.test(attr(element, "class")) ||
        /breadcrumb/i.test(attr(element, "id")),
    );
    if (crumbs) {
      const items = allElements(crumbs).filter((node) => tagOf(node) === "li");
      const links = allElements(crumbs).filter((node) => tagOf(node) === "a");
      const source = items.length ? items : links;
      breadcrumb = (source.length ? source.map(inlineText) : inlineText(crumbs).split(/\s*[›»>/|]\s*/))
        .map((text) => text.replace(/^[›»>/|\s]+|[›»>/|\s]+$/g, ""))
        .filter(Boolean)
        .slice(0, 10);
    }
  }

  const dates: StructureInfo["dates"] = byTag(elements, "time")
    .slice(0, 10)
    .map((element) => ({ text: inlineText(element).slice(0, 80), datetime: attr(element, "datetime"), label: "time" }));
  const pageText = visibleText(body);
  for (const match of pageText.matchAll(LABELLED_DATE)) {
    if (dates.length >= 15) break;
    dates.push({ text: collapse(match[2]), datetime: "", label: match[1].toLowerCase() });
  }

  const details = byTag(elements, "details").filter((element) => allElements(element).some((node) => tagOf(node) === "summary"));
  const faqHeadings = headings.filter((heading) => /\bfaqs?\b|frequently asked/i.test(heading.text)).map((heading) => heading.text);

  const words = countWords(main.text);
  const paragraphs = mainElements.filter((element) => tagOf(element) === "p" && inlineText(element).length > 0).length;

  return {
    mainText: main.text,
    structure: {
      main: {
        source: main.source,
        words,
        paragraphs,
        textToHtmlRatio: html.length ? Math.round((main.text.length / html.length) * 1000) / 1000 : 0,
      },
      headings,
      h1Count: byTag(elements, "h1").length,
      blocks,
      tables,
      images: {
        count: images.length,
        missingAlt: images.filter((image) => image.getAttribute("alt") === undefined).length,
        lazy: images.filter((image) => attr(image, "loading").toLowerCase() === "lazy" || attr(image, "data-src") || attr(image, "data-lazy-src")).length,
        missingDimensions: images.filter((image) => !attr(image, "width") || !attr(image, "height")).length,
        formats,
      },
      iframes,
      breadcrumb,
      dates,
      faqBlocks: { details: details.length, headings: faqHeadings.slice(0, 10) },
      sentences: sentencesOf(main.text),
    },
  };
}

function closestChrome(element: HTMLElement): boolean {
  let current: HTMLElement | null = element;
  while (current && isElement(current)) {
    if (CHROME.has(tagOf(current))) return true;
    current = current.parentNode as HTMLElement | null;
  }
  return false;
}
