import type { HTMLElement } from "node-html-parser";
import { attr, byTag, collapse } from "./dom";
import type { SchemaBlock, SchemaEntity, SchemaInfo } from "./types";

const MAX_RAW = 20_000;
const MAX_BLOCKS = 20;
const MAX_ENTITIES = 80;

type Json = Record<string, unknown>;

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
}

function typesOf(node: Json): string[] {
  return asArray(node["@type"]).filter((t): t is string => typeof t === "string");
}

/** A readable string for a schema value: text, a name, or an @id. */
function str(value: unknown): string {
  if (typeof value === "string") return collapse(value).slice(0, 300);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(str).filter(Boolean).join(", ");
  if (value && typeof value === "object") {
    const node = value as Json;
    return str(node.name ?? node.headline ?? node["@id"] ?? node.url ?? node.text ?? "");
  }
  return "";
}

function names(value: unknown): string[] {
  return asArray(value).map(str).filter(Boolean).slice(0, 10);
}

function detailsFor(types: string[], node: Json): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  const set = (key: string, value: string | string[]) => {
    if (Array.isArray(value) ? value.length > 0 : value) out[key] = value;
  };
  const has = (...wanted: string[]) => types.some((type) => wanted.includes(type));

  if (has("SportsEvent", "Event")) {
    set("name", str(node.name));
    set("startDate", str(node.startDate));
    set("endDate", str(node.endDate));
    set("location", str(node.location));
    set("homeTeam", str(node.homeTeam));
    set("awayTeam", str(node.awayTeam));
    set("competitors", names(node.competitor));
    set("eventStatus", str(node.eventStatus).replace("https://schema.org/", ""));
    set("sport", str(node.sport));
  }
  if (has("Article", "NewsArticle", "BlogPosting")) {
    set("headline", str(node.headline ?? node.name));
    set("datePublished", str(node.datePublished));
    set("dateModified", str(node.dateModified));
    set("author", names(node.author));
    set("publisher", str(node.publisher));
  }
  if (has("BreadcrumbList")) {
    const items = asArray(node.itemListElement)
      .map((item) => item as Json)
      .sort((a, b) => Number(a?.position ?? 0) - Number(b?.position ?? 0));
    set("trail", items.map((item) => str(item?.name ?? item?.item)).filter(Boolean));
  }
  if (has("FAQPage")) {
    set("questions", faqQuestionsOf(node));
  }
  if (has("Organization", "NewsMediaOrganization", "Corporation", "LocalBusiness", "SportsOrganization")) {
    set("name", str(node.name));
    set("url", str(node.url));
    set("logo", str(node.logo));
    set("sameAs", names(node.sameAs));
  }
  if (has("WebSite")) {
    set("name", str(node.name));
    set("url", str(node.url));
    const action = asArray(node.potentialAction).find((a) => typesOf(a as Json).includes("SearchAction")) as Json | undefined;
    if (action) set("search", str(action.target));
  }
  if (has("Product")) {
    set("name", str(node.name));
    set("brand", str(node.brand));
    const offer = asArray(node.offers)[0] as Json | undefined;
    if (offer) {
      set("price", str(offer.price ?? offer.lowPrice));
      set("priceCurrency", str(offer.priceCurrency));
    }
  }
  if (has("Review")) {
    set("itemReviewed", str(node.itemReviewed));
    set("rating", str((node.reviewRating as Json | undefined)?.ratingValue));
    set("author", names(node.author));
  }
  if (has("AggregateRating")) {
    set("ratingValue", str(node.ratingValue));
    set("ratingCount", str(node.ratingCount ?? node.reviewCount));
    set("bestRating", str(node.bestRating));
  }
  return out;
}

function faqQuestionsOf(node: Json): string[] {
  return asArray(node.mainEntity)
    .map((question) => str((question as Json)?.name))
    .filter(Boolean)
    .slice(0, 50);
}

function normaliseForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function analyseSchema(elements: HTMLElement[], visibleText: string): SchemaInfo {
  const blocks: SchemaBlock[] = [];
  const entities: SchemaEntity[] = [];
  const types = new Set<string>();
  const faqQuestions: string[] = [];

  const visit = (value: unknown, depth: number, nested: boolean) => {
    if (depth > 6 || entities.length >= MAX_ENTITIES) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth, nested);
      return;
    }
    if (!value || typeof value !== "object") return;
    const node = value as Json;
    if (node["@graph"]) visit(node["@graph"], depth, nested);
    const nodeTypes = typesOf(node);
    if (nodeTypes.length > 0) {
      if (!nested) nodeTypes.forEach((type) => types.add(type));
      entities.push({
        type: nodeTypes.join(", "),
        keys: Object.keys(node).filter((key) => key !== "@graph").slice(0, 40),
        details: detailsFor(nodeTypes, node),
        nested,
      });
      if (nodeTypes.includes("FAQPage")) faqQuestions.push(...faqQuestionsOf(node));
    }
    // Nested entities (offers, ratings, authors, teams) are recorded too.
    for (const [key, child] of Object.entries(node)) {
      if (key === "@graph" || key === "@context") continue;
      if (child && typeof child === "object") visit(child, depth + 1, nodeTypes.length > 0 || nested);
    }
  };

  const scripts = byTag(elements, "script").filter((element) => /ld\+json/i.test(attr(element, "type")));
  for (const script of scripts.slice(0, MAX_BLOCKS)) {
    const raw = script.rawText.trim().replace(/^<!\[CDATA\[|\]\]>$/g, "").trim();
    const block: SchemaBlock = {
      valid: true,
      error: null,
      raw: raw.slice(0, MAX_RAW),
      rawTruncated: raw.length > MAX_RAW,
    };
    try {
      visit(JSON.parse(raw), 0, false);
    } catch (error) {
      block.valid = false;
      block.error = error instanceof Error ? error.message : "Invalid JSON";
    }
    blocks.push(block);
  }

  const microdata = new Set<string>();
  const rdfa = new Set<string>();
  for (const element of elements) {
    const itemtype = attr(element, "itemtype");
    if (itemtype) itemtype.split(/\s+/).forEach((type) => microdata.add(type.replace(/^https?:\/\/schema\.org\//, "")));
    const typeof_ = attr(element, "typeof");
    if (typeof_) typeof_.split(/\s+/).forEach((type) => rdfa.add(type));
  }

  const visible = normaliseForMatch(visibleText);
  const uniqueQuestions = [...new Set(faqQuestions)];
  const notVisible = uniqueQuestions.filter((question) => {
    const needle = normaliseForMatch(question);
    return needle.length > 0 && !visible.includes(needle);
  });

  return {
    blocks,
    entities,
    types: [...types],
    microdata: [...microdata].slice(0, 30),
    rdfa: [...rdfa].slice(0, 30),
    faq: { questions: uniqueQuestions, notVisible },
  };
}
