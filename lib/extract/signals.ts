import type { HTMLElement } from "node-html-parser";
import { allElements, attr, byTag, collapse, inlineText, unique } from "./dom";
import type { SchemaInfo, SignalsInfo, ThirdParty } from "./types";

const AD_CLASS = /(?:^|[\s_-])(?:ad-?slot|ad-?unit|ad-?container|ad-?wrapper|adsbygoogle|advert\w*|banner\w*|sponsor\w*|dfp-ad|gpt-ad)(?:$|[\s_-])/i;
const MODAL = /(?:^|[\s_-])(?:modal|popup|pop-up|lightbox|overlay|interstitial)(?:$|[\s_-])/i;
const LOCKED = /(?:^|[\s_-])(?:blur\w*|locked|lock|premium|vip|paywall\w*|members-only)(?:$|[\s_-])/i;
const PRICE =
  /(?:₦|\$|€|£|GH₵|GH¢|KSh|ZAR|NGN|KES|GHS|USD|EUR|GBP|UGX|TZS)\s?\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*(?:\.\d{1,2})?\s?(?:NGN|KES|GHS|USD|EUR|GBP|ZAR|naira|shillings?|cedis?)\b/gi;
const HELP_ORGS: [RegExp, string][] = [
  [/begambleaware/i, "BeGambleAware"],
  [/gamcare/i, "GamCare"],
  [/gamstop/i, "GamStop"],
  [/gamblers anonymous/i, "Gamblers Anonymous"],
  [/gambling therapy/i, "Gambling Therapy"],
  [/ncpg|national council on problem gambling|1-800-gambler/i, "NCPG"],
  [/responsible gambling council/i, "Responsible Gambling Council"],
];
const REGULATORS: [RegExp, string][] = [
  [/uk gambling commission|gambling commission/i, "UK Gambling Commission"],
  [/malta gaming authority|\bmga\b/i, "Malta Gaming Authority"],
  [/cura[cç]ao/i, "Curaçao"],
  [/national lottery regulatory commission|\bnlrc\b/i, "NLRC (Nigeria)"],
  [/lagos state lotteries/i, "Lagos State Lotteries and Gaming Authority"],
  [/betting control and licensing board|\bbclb\b/i, "BCLB (Kenya)"],
  [/gaming commission of ghana/i, "Gaming Commission of Ghana"],
  [/kahnawake/i, "Kahnawake Gaming Commission"],
  [/national gambling board/i, "National Gambling Board (South Africa)"],
];

type AnchorInfo = { text: string; href: string };

function anchorsOf(elements: HTMLElement[]): AnchorInfo[] {
  return byTag(elements, "a", "button").map((element) => ({
    text: collapse(inlineText(element)).toLowerCase().slice(0, 80),
    href: attr(element, "href").toLowerCase(),
  }));
}

function linkMatches(anchors: AnchorInfo[], text: RegExp, href?: RegExp): AnchorInfo[] {
  return anchors.filter((anchor) => text.test(anchor.text) || (href ? href.test(anchor.href) : false));
}

export function analyseSignals(
  elements: HTMLElement[],
  order: Map<HTMLElement, number>,
  pageText: string,
  schema: SchemaInfo,
  thirdParties: ThirdParty[],
): SignalsInfo {
  // Ads, and whether each sits above or below the first H2.
  const firstH2 = byTag(elements, "h2")[0];
  const firstH2Order = firstH2 ? order.get(firstH2) ?? Infinity : Infinity;
  const adElements = new Set<HTMLElement>();
  const markers: string[] = [];
  for (const element of elements) {
    const tag = element.rawTagName?.toLowerCase();
    const classes = attr(element, "class");
    const id = attr(element, "id");
    let marker = "";
    if (tag === "ins" && /adsbygoogle/.test(classes)) marker = "AdSense ins";
    else if (element.getAttribute("data-ad-slot") !== undefined) marker = "data-ad-slot";
    else if (/^div-gpt-ad/.test(id)) marker = "Google Ad Manager slot";
    else if (tag !== "body" && tag !== "html" && (AD_CLASS.test(classes) || AD_CLASS.test(id))) marker = id ? `#${id}` : `.${classes.split(/\s+/).find((c) => AD_CLASS.test(` ${c} `)) ?? classes.split(/\s+/)[0]}`;
    if (!marker) continue;
    // Count the outermost element only.
    let parent = element.parentNode as HTMLElement | null;
    let nested = false;
    while (parent && parent.rawTagName) {
      if (adElements.has(parent)) {
        nested = true;
        break;
      }
      parent = parent.parentNode as HTMLElement | null;
    }
    if (nested) continue;
    adElements.add(element);
    markers.push(marker);
  }
  const googletagSlots = byTag(elements, "script").reduce(
    (sum, script) => sum + (script.rawText.match(/googletag\.defineSlot\(/g)?.length ?? 0),
    0,
  );
  if (googletagSlots) markers.push(`googletag.defineSlot x${googletagSlots}`);
  let above = 0;
  let below = 0;
  for (const element of adElements) ((order.get(element) ?? 0) < firstH2Order ? above++ : below++);

  // Conversion.
  const anchors = anchorsOf(elements);
  const login = linkMatches(anchors, /^(?:log ?in|sign ?in|member login)\b/, /\/(?:login|signin|sign-in|log-in|wp-login\.php)(?:[/?]|$)/);
  const register = linkMatches(anchors, /\b(?:sign ?up|register|create (?:an )?account|join (?:now|free|us))\b/, /\/(?:register|signup|sign-up|join)(?:[/?]|$)/);
  const pricing = linkMatches(anchors, /\b(?:pricing|vip|premium|subscribe|subscription|plans?|upgrade|buy (?:a )?plan)\b/, /\/(?:pricing|vip|premium|subscribe|plans?|subscription|membership)(?:[/?]|$)/);
  const forms = byTag(elements, "form");
  const newsletterForms = forms.filter((form) => {
    const inner = allElements(form);
    const email = inner.some((node) => node.rawTagName?.toLowerCase() === "input" && attr(node, "type").toLowerCase() === "email");
    const password = inner.some((node) => attr(node, "type").toLowerCase() === "password");
    return email && !password;
  }).length;
  const popups = elements.filter((element) => MODAL.test(attr(element, "class")) || MODAL.test(attr(element, "id"))).length;
  const locked = elements.filter((element) => LOCKED.test(attr(element, "class"))).length;
  const pushOptIn = unique(thirdParties.filter((party) => party.category === "push").map((party) => party.name || party.host));
  const examples = [
    ...login.slice(0, 2).map((a) => `login: ${a.text || a.href}`),
    ...register.slice(0, 2).map((a) => `register: ${a.text || a.href}`),
    ...pricing.slice(0, 3).map((a) => `pricing: ${a.text || a.href}`),
  ].slice(0, 10);

  const prices = unique([...pageText.matchAll(PRICE)].map((match) => collapse(match[0]))).slice(0, 10);

  // Trust and compliance.
  const text = pageText;
  const licence = unique([
    ...REGULATORS.filter(([pattern]) => pattern.test(text)).map(([, name]) => name),
    ...[...text.matchAll(/\b(?:licen[cs]ed|regulated)\s+(?:and regulated\s+)?by\s+(?:the\s+)?([A-Z][\w&.'’ -]{2,60}?)(?=[.,;\n]|$)/g)].map((m) => collapse(m[1])),
  ]).slice(0, 6);
  const authorInSchema = schema.entities.some((entity) => Array.isArray(entity.details.author) && entity.details.author.length > 0);
  const authorMarkup = elements.some(
    (element) =>
      attr(element, "rel").toLowerCase() === "author" ||
      /(?:^|\s)(?:author|byline|post-author|entry-author)(?:$|\s|-)/i.test(attr(element, "class")) ||
      attr(element, "itemprop") === "author",
  );

  return {
    ads: { count: adElements.size + googletagSlots, aboveFirstH2: above, belowFirstH2: below + googletagSlots, markers: markers.slice(0, 20) },
    conversion: {
      login: login.length,
      register: register.length,
      pricing: pricing.length,
      newsletterForms,
      pushOptIn,
      popups,
      locked,
      examples,
    },
    prices,
    trust: {
      ageNotice: /(?:^|[^\d])(?:18|21)\s?\+|\bover 18\b|\b18 years\b|\b18 and over\b/i.test(text),
      responsibleGambling: /responsible gambling|gamble responsibly|bet responsibly|play responsibly|when the fun stops/i.test(text),
      helpOrganisations: HELP_ORGS.filter(([pattern]) => pattern.test(text) || anchors.some((a) => pattern.test(a.href))).map(([, name]) => name),
      licence,
      disclaimer: /\bdisclaimer\b/i.test(text) || linkMatches(anchors, /disclaimer/, /disclaimer/).length > 0,
      privacy: linkMatches(anchors, /privacy/, /privacy/).length > 0,
      terms: linkMatches(anchors, /terms|conditions/, /terms|conditions|\/tos\b/).length > 0,
      about: linkMatches(anchors, /^about\b|about us/, /\/about(?:-us)?(?:[/?]|$)/).length > 0,
      contact: linkMatches(anchors, /^contact\b|contact us/, /\/contact(?:-us)?(?:[/?]|$)|^mailto:/).length > 0,
      author: authorInSchema || authorMarkup,
      editorialPolicy: linkMatches(anchors, /editorial (?:policy|guidelines|standards)|fact.?check|how we (?:test|review|rate)/, /editorial|fact-check/).length > 0,
    },
  };
}
