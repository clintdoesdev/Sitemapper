import type { HTMLElement } from "node-html-parser";
import { sameSite } from "../guard";
import { matchPattern } from "../patterns";
import { attr, byTag, closest, collapse, hostOf, inlineText, resolveUrl, tally } from "./dom";
import { classifyHost } from "./hosts";
import type { LinksInfo } from "./types";

/** Internal paths sites use to send visitors on to affiliates. Recorded, never fetched. */
export const AFFILIATE_PATH = /^\/(?:go|out|visit|recommends|link|bet|refer|redirect|goto|click)\//i;
const TRACKING_PARAM = /^(?:aff|affid|aff_id|affiliate|ref|btag|clickid|click_id|subid|sub_id|pid|utm_[a-z]+)$/i;
const MESSAGING: [RegExp, string][] = [
  [/^(?:[\w-]+\.)?t\.me$|^telegram\.me$/, "Telegram"],
  [/^wa\.me$/, "WhatsApp"],
  [/^chat\.whatsapp\.com$/, "WhatsApp group"],
  [/^(?:www\.)?whatsapp\.com$/, "WhatsApp"],
  [/^(?:www\.)?(?:x|twitter)\.com$/, "X (Twitter)"],
  [/^(?:[\w-]+\.)?facebook\.com$|^fb\.me$/, "Facebook"],
  [/^(?:www\.)?instagram\.com$/, "Instagram"],
  [/^(?:www\.)?tiktok\.com$/, "TikTok"],
  [/^(?:www\.|m\.)?youtube\.com$|^youtu\.be$/, "YouTube"],
];

export function analyseLinks(
  elements: HTMLElement[],
  pageUrl: string,
  patterns: readonly string[],
): LinksInfo {
  const pageHost = hostOf(pageUrl);
  const info: LinksInfo = {
    total: 0,
    internal: 0,
    external: 0,
    nofollow: 0,
    sponsored: 0,
    ugc: 0,
    internalNofollow: 0,
    placement: { header: 0, main: 0, aside: 0, footer: 0, other: 0 },
    internalByPattern: [],
    unmatchedInternal: [],
    queryParams: {},
    externalDomains: [],
    affiliate: { redirectPaths: [], trackingParams: {}, networks: [] },
    messaging: [],
    apps: [],
  };

  const byPattern = new Map<string, { count: number; anchors: string[] }>();
  const unmatched = new Set<string>();
  const external = new Map<string, { count: number; rels: Set<string> }>();
  const redirects: string[] = [];
  const networks: string[] = [];
  const messaging = new Map<string, string>();
  const apps = new Map<string, string>();

  for (const anchor of byTag(elements, "a", "area")) {
    const raw = attr(anchor, "href").trim();
    if (!raw || raw.startsWith("#") || /^(?:mailto|tel|javascript|sms|data):/i.test(raw)) continue;
    const href = resolveUrl(raw, pageUrl);
    if (!href) continue;
    const url = new URL(href);
    url.hash = "";

    info.total++;
    const rel = attr(anchor, "rel").toLowerCase().split(/\s+/).filter(Boolean);
    if (rel.includes("nofollow")) info.nofollow++;
    if (rel.includes("sponsored")) info.sponsored++;
    if (rel.includes("ugc")) info.ugc++;

    const region = closest(anchor, ["header", "nav", "footer", "aside", "main", "article"]);
    const regionTag = region ? region.rawTagName.toLowerCase() : "";
    if (regionTag === "header" || regionTag === "nav") info.placement.header++;
    else if (regionTag === "footer") info.placement.footer++;
    else if (regionTag === "aside") info.placement.aside++;
    else if (regionTag === "main" || regionTag === "article") info.placement.main++;
    else info.placement.other++;

    for (const key of url.searchParams.keys()) {
      if (TRACKING_PARAM.test(key)) info.affiliate.trackingParams[key] = (info.affiliate.trackingParams[key] ?? 0) + 1;
    }

    const host = url.hostname.toLowerCase();
    if (sameSite(host, pageHost)) {
      info.internal++;
      if (rel.includes("nofollow")) info.internalNofollow++;
      for (const key of url.searchParams.keys()) info.queryParams[key] = (info.queryParams[key] ?? 0) + 1;
      if (AFFILIATE_PATH.test(url.pathname)) {
        redirects.push(url.href);
        continue;
      }
      const pattern = matchPattern(url.href, patterns);
      if (pattern) {
        const entry = byPattern.get(pattern) ?? { count: 0, anchors: [] };
        entry.count++;
        const text = collapse(inlineText(anchor) || attr(anchor, "title") || attr(anchor, "aria-label")).slice(0, 80);
        if (text) entry.anchors.push(text);
        byPattern.set(pattern, entry);
      } else if (patterns.length > 0) {
        unmatched.add(url.href);
      }
    } else {
      info.external++;
      const domain = host.replace(/^www\./, "");
      const entry = external.get(domain) ?? { count: 0, rels: new Set<string>() };
      entry.count++;
      rel.forEach((value) => entry.rels.add(value));
      external.set(domain, entry);
      if (classifyHost(host).category === "affiliate network") networks.push(domain);

      for (const [pattern, kind] of MESSAGING) {
        if (pattern.test(host) && !messaging.has(url.href)) messaging.set(url.href, kind);
      }
      if (host === "play.google.com") apps.set(url.href, "Google Play");
      if (host === "apps.apple.com" || host === "itunes.apple.com") apps.set(url.href, "App Store");
    }
    if (/\.apk(?:$|\?)/i.test(url.pathname)) apps.set(url.href, "APK download");
  }

  info.internalByPattern = [...byPattern.entries()]
    .map(([pattern, entry]) => ({
      pattern,
      count: entry.count,
      anchors: tally(entry.anchors).slice(0, 5).map((item) => item.value),
    }))
    .sort((a, b) => b.count - a.count);
  info.unmatchedInternal = [...unmatched].slice(0, 50);
  info.externalDomains = [...external.entries()]
    .map(([domain, entry]) => ({ domain, count: entry.count, rels: [...entry.rels] }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 50);
  info.affiliate.redirectPaths = tally(redirects)
    .slice(0, 20)
    .map((item) => ({ url: item.value, count: item.count }));
  info.affiliate.networks = tally(networks).map((item) => ({ host: item.value, count: item.count }));
  info.messaging = [...messaging.entries()].slice(0, 30).map(([url, kind]) => ({ kind, url }));
  info.apps = [...apps.entries()].slice(0, 20).map(([url, kind]) => ({ kind, url }));
  return info;
}
