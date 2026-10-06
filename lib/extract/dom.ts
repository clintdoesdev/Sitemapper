import { parse, type HTMLElement, type Node } from "node-html-parser";

/** Elements whose contents are never visible text. */
const INVISIBLE = new Set(["script", "style", "noscript", "template", "svg", "head", "iframe", "object"]);
const BLOCK = new Set([
  "p", "div", "section", "article", "main", "header", "footer", "nav", "aside", "li", "ul", "ol", "tr", "table",
  "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "dd", "dt", "dl", "figure", "figcaption", "br", "hr",
  "td", "th", "form", "fieldset", "details", "summary", "label", "option", "address",
]);

export function parseDocument(html: string): HTMLElement {
  return parse(html, {
    comment: false,
    lowerCaseTagName: false,
    blockTextElements: { script: true, style: true, noscript: true, pre: true, textarea: true },
  });
}

export function tagOf(node: Node): string {
  return node.nodeType === 1 ? (node as HTMLElement).rawTagName?.toLowerCase() ?? "" : "";
}

export function isElement(node: Node): node is HTMLElement {
  return node.nodeType === 1;
}

export function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Visible text of a node, with blocks separated by newlines. `skip` adds tags to leave out. */
export function visibleText(root: Node, skip?: ReadonlySet<string>): string {
  const out: string[] = [];
  const stack: { node: Node; closing: boolean }[] = [{ node: root, closing: false }];
  while (stack.length) {
    const { node, closing } = stack.pop()!;
    if (closing) {
      out.push("\n");
      continue;
    }
    if (node.nodeType === 3) {
      out.push(node.text);
      continue;
    }
    if (!isElement(node)) continue;
    const tag = tagOf(node);
    if (INVISIBLE.has(tag) || (skip?.has(tag) && node !== root)) continue;
    if (node.getAttribute("hidden") !== undefined || /display\s*:\s*none/i.test(node.getAttribute("style") ?? "")) continue;
    const block = BLOCK.has(tag);
    if (block) {
      out.push("\n");
      stack.push({ node, closing: true });
    }
    const children = node.childNodes;
    for (let i = children.length - 1; i >= 0; i--) stack.push({ node: children[i], closing: false });
  }
  return out
    .join("")
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** Visible text on one line. */
export function inlineText(node: Node): string {
  return collapse(visibleText(node));
}

export function countWords(text: string): number {
  return (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
}

/** Every element in document order. */
export function allElements(root: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  const stack: Node[] = [root];
  while (stack.length) {
    const node = stack.pop()!;
    if (!isElement(node)) continue;
    out.push(node);
    const children = node.childNodes;
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }
  return out;
}

/** Position of each element in document order. */
export function documentOrder(root: HTMLElement): Map<HTMLElement, number> {
  const order = new Map<HTMLElement, number>();
  allElements(root).forEach((element, index) => order.set(element, index));
  return order;
}

export function byTag(elements: HTMLElement[], ...tags: string[]): HTMLElement[] {
  const wanted = new Set(tags);
  return elements.filter((element) => wanted.has(tagOf(element)));
}

/** Nearest ancestor (or self) whose tag is in `tags`. */
export function closest(node: HTMLElement, tags: string[]): HTMLElement | null {
  let current: HTMLElement | null = node;
  while (current) {
    if (tags.includes(tagOf(current))) return current;
    current = current.parentNode as HTMLElement | null;
    if (current && !isElement(current)) return null;
  }
  return null;
}

export function attr(element: HTMLElement, name: string): string {
  return element.getAttribute(name) ?? "";
}

export function classesOf(element: HTMLElement): string[] {
  return attr(element, "class").split(/\s+/).filter(Boolean);
}

export function resolveUrl(href: string, base: string): string | null {
  try {
    const url = new URL(href.trim(), base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.href;
  } catch {
    return null;
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** Splits text into sentences of 6 to 60 words. */
export function sentencesOf(text: string, max = 300): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    for (const sentence of line.split(/(?<=[.!?])\s+(?=[\p{Lu}\p{N}"“'‘(])/u)) {
      const clean = collapse(sentence);
      const words = countWords(clean);
      if (words >= 6 && words <= 60) out.push(clean);
      if (out.length >= max) return out;
    }
  }
  return out;
}

/** Counts by key, sorted by count. */
export function tally(values: string[]): { value: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
}

export function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
